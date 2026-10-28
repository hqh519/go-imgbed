import { Body, Controller, Get, HttpCode, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFile, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { createWriteStream, promises as fsp } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { OptionalAuthGuard, currentSession } from '../auth/auth.guard';
import { UploadService } from './upload.service';
import { SettingsService } from '../settings/settings.service';
import { NO_BACKUP_VALUES } from '../storage/storage-channel.service';
import { resolveVideoFromHtml } from './video-resolve';
import { appLog } from '../common/app-log';
import {
  createSession,
  createStaging,
  findSessionByKey,
  getSession,
  getStaging,
  markSessionCompleted,
  mergeSession,
  receivedChunks,
  removeSession,
  removeStaging,
  stagingFilePath,
  startUploadSweeper,
  touchSession,
  updateStaging,
  writeChunk,
} from './upload-session';

/**
 * 链接转存时「多大的文件交给服务端暂存」。
 * 小于该值仍按老方式把字节回传给浏览器（图片需要前端裁剪，必须拿到 File）；
 * 超过该值的图片/视频/音频留在服务端磁盘，浏览器只拿 stagingId，
 * 上传时由服务端直接写渠道 —— 避免「服务器→浏览器→服务器」的三倍流量。
 */
const STAGE_DIRECT_BYTES = 32 * 1024 * 1024;
/** 单次请求体硬上限（分片上传每片 16MB，这里只保护「非分片直传 / API 客户端」） */
const MAX_SINGLE_BYTES = Math.max(512, Number(process.env.UPLOAD_MAX_SINGLE_MB || 4096)) * 1024 * 1024;
/** 链接转存（暂存/回传）体积上限 */
const MAX_FETCH_BYTES = Math.max(512, Number(process.env.UPLOAD_FETCH_MAX_MB || 4096)) * 1024 * 1024;

/**
 * 链接转存（/api/fetchRes）的目标地址安全策略。
 *
 * 背景：本系统是自部署图床，用户经常需要转存「同一实例 / 内网对象存储（MinIO、NAS、
 * 局域网图床）」上的链接，早期版本一刀切封禁内网地址，导致转存自己站点的外链
 * 直接报「粘贴板中的URL地址请求失败」。现改为：
 *   - 仅封禁云元数据地址（169.254.169.254）与组播/保留地址等真正的危险目标
 *   - 允许 localhost 与 RFC1918 内网地址（自部署场景的常见来源）
 * 其余仍受协议白名单、15s 超时、100MB 体积上限约束。
 */
function isBlockedFetchHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === '0.0.0.0') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 169 && b === 254) return true; // 云元数据 169.254.169.254
    if (a >= 224) return true; // 组播 / 保留
  }
  if (h.startsWith('fe80')) return true; // IPv6 link-local
  return false;
}

/**
 * multipart 文件名编码修复。
 *
 * multer / busboy 默认把 `filename` 按 latin1 解码，中文文件名会变成乱码
 * （如「测试.png」→「æµ‹è¯•.png」）。这里尝试「latin1 → utf8」还原：
 *   - 还原结果不含替换符 U+FFFD 且含非 ASCII 字符 → 说明原值就是被误解码的 UTF-8，采用还原值
 *   - 否则保持原值（本来是纯 ASCII 或本来就是 latin1 编码）
 */
function fixFilename(name?: string): string {
  const raw = String(name || '');
  if (!raw) return raw;
  /*
   * v2.8.5 加固：只有当原值呈现「latin1 误解码」特征（含 U+0080–U+00FF 高位字符）
   * 时才尝试还原。正确解码的中文/日文文件名字符码都 > 0xFF，不会落入该区间，
   * 直接原样返回 —— 杜绝「本已正确的名字被二次转换成乱码」的误伤类。
   */
  if (!/[\u0080-\u00FF]/.test(raw)) return raw;
  try {
    const restored = Buffer.from(raw, 'latin1').toString('utf8');
    if (!restored.includes('\uFFFD') && /[^\u0000-\u007F]/.test(restored)) {
      console.log(`[upload] multipart 文件名编码已还原: ${raw} -> ${restored}`);
      return restored;
    }
  } catch {
    /* 忽略，返回原值 */
  }
  return raw;
}

@Controller()
@UseGuards(OptionalAuthGuard)
export class UploadController {
  /** 链接上传时按 MIME 兜底补扩展名（URL 无后缀时） */
  private static readonly MIME_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
  };

  constructor(
    private svc: UploadService,
    private settings: SettingsService,
  ) {
    // 分片会话 / 链接暂存的 24h TTL 清理（启动即跑一次，之后每 30 分钟）
    startUploadSweeper();
  }

  /**
   * 上传成功后对外返回的文件链接 —— 走全站统一出口
   * （上传设置里的「自定义访问域名」> 页面设置默认URL前缀 > 本站 /file/）。
   * 外链始终是 `/file/<File_ID>`，扩展名只作直观提示。
   */
  private async signedSrc(id: string, req: Request): Promise<string> {
    const origin = `${req.protocol}://${req.get('host')}`;
    const prefix = await this.settings.getLinkPrefix(origin);
    return `${prefix}${encodeURIComponent(id)}`;
  }

  /** 取客户端真实 IP（反代场景读 X-Forwarded-For 首段） */
  private clientIp(req: Request): string {
    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    return (fwd || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  }

  /**
   * 分片会话清理：GET /upload?cleanup=true&uploadId=xxx
   *
   * 前端 releaseItem()（移除条目 / 清空列表 / 清空已上传）用 GET 调用，
   * 而清理分支原本只写在 @Post('upload') 里 —— GET 请求落到 404，
   * 会话目录就一直留在磁盘上等 24h TTL（v2.8.2 是内存泄漏，这里是磁盘泄漏）。
   * 这里补一个只认 cleanup 的 GET 入口，其他 GET 一律 400。
   */
  @Get('upload')
  async cleanupChunked(@Query() q: { cleanup?: string; uploadId?: string }, @Res() res: Response) {
    if (q.cleanup === 'true' && q.uploadId) {
      await removeSession(q.uploadId);
      return res.json({ success: true });
    }
    return res.status(400).json({ success: false, message: '无效的清理请求' });
  }

  /** 核心上传：POST /upload —— 兼容前端契约（query 参数 + multipart） */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SINGLE_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query()
    q: {
      uploadChannel?: string;
      /** 指定具体渠道：**渠道 ID**（6 位 code / 主键 id）。兼容历史参数名 channelName（值同样是渠道 ID） */
      channelId?: string;
      channelName?: string;
      uploadNameType?: string;
      serverCompress?: string;
      autoRetry?: string;
      uploadFolder?: string;
      /** 初始（压缩前）大小 —— 前端本地压缩后仍把原始字节数带上来，供详情页展示「初始 / 当前」 */
      originalSize?: string;
      /** 压缩期望：体积占原文件的百分比（10-100），0/缺省表示用后台默认值 */
      compressPercent?: string;
      /** 指定备份渠道：**渠道 ID**（6 位 code / 主键 id）；传 none 表示本次不备份 */
      backupChannelId?: string;
      backupChannel?: string;
      /** 是否备份本次上传（'false' 关闭；缺省开启）—— 兼容旧前端 */
      backup?: string;
      initChunked?: string;
      chunked?: string;
      merge?: string;
      chunkIndex?: string;
      totalChunks?: string;
      uploadId?: string;
      originalFileName?: string;
      originalFileType?: string;
      cleanup?: string;
      /** 前端声明的文件总字节数（分块合并后校验完整性） */
      fileSize?: string;
      /** 前端稳定指纹（名称+大小+修改时间）—— 用于断点续传 */
      uploadKey?: string;
      /** 链接转存暂存 ID（大文件不经过浏览器，上传时按暂存文件直接写渠道） */
      stagingId?: string;
      /** 前端上传设置临时指定的允许格式（逗号分隔）—— 传了覆盖后台全局配置 */
      allowedExtensions?: string;
      /** 前端上传设置临时指定的单文件大小上限（MB）—— 传了覆盖后台全局配置 */
      maxFileSizeMB?: string;
    },
    @Body() body: Record<string, string>,
    @Req() req: Request & { session?: { user: string } },
    @Res() res: Response,
  ) {
    // 分块清理：删除整个会话目录（分片 + manifest）
    if (q.cleanup === 'true' && q.uploadId) {
      await removeSession(q.uploadId);
      return res.json({ success: true });
    }

    /*
     * 备份渠道（前端「上传设置 → 备份渠道」下拉，与 Token / 用户管理共用同一个下拉函数）：
     *   ''      → 未指定，按 getStorageChannel(账户, 'backup') 的默认备份渠道执行
     *   'none'  → 明确「不备份」，本次跳过备份
     *   渠道 ID → 指定备份渠道（同时隐含「要备份」）
     */
    const backupRaw = String(q.backupChannelId ?? q.backupChannel ?? '').trim();
    const backupOff = NO_BACKUP_VALUES.includes(backupRaw.toLowerCase());
    const backupChannelId = !backupOff && backupRaw ? backupRaw : undefined;

    /*
     * 当前上传账户（优先取守卫注入的会话，回退 Cookie 解析）——
     * 用于解析「用户管理」里为该账户配置的主/备渠道与「类型和大小限制」开关。
     */
    const uploader = currentSession(req)?.user || req.session?.user || '';
    /*
     * 「类型和大小限制」（用户管理 → 编辑用户）：
     *   开启（默认）→ 受「允许上传格式 + 单文件大小上限」约束
     *   关闭        → 跳过这两项限制（魔数比对仍照常执行）
     */
    const enforceLimits = await this.svc.userEnforceLimits(uploader);

    /*
     * 前端上传页「上传设置」里的临时限制（右侧设置弹窗填了才传）：
     *   允许的上传格式（逗号分隔）与单文件大小上限（MB）——
     * 传了就覆盖后台「上传相关配置」的全局值，不传则后端读全局设置。
     * 刷新页面即清空，不做持久化。
     */
    const overrideExts = String(q.allowedExtensions || '')
      .split(',')
      .map((s: string) => s.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean);
    const overrideMaxMB = Number(q.maxFileSizeMB || 0) || 0;

    const arrivedAt = Number((req as unknown as { _arrivedAt?: number })._arrivedAt) || Date.now();
    const opts = {
      uploadChannel: q.uploadChannel,
      // 渠道一律按 ID 匹配；兼容老前端传来的 channelName 参数名（其值同样是渠道 ID）
      channelId: q.channelId ?? q.channelName,
      uploadNameType: q.uploadNameType,
      /*
       * 压缩开关（v2.3.0）：
       *   显式传了 serverCompress → 完全听调用方（前端上传设置里的开关）；
       *   没传（curl / 第三方客户端 / ShareX 之类直连 /upload）→ 交给 UploadService
       *   按后台「网页设置 → 默认开启压缩」兜底，避免这些入口静默地不压缩。
       */
      serverCompress:
        q.serverCompress === undefined ? undefined : q.serverCompress === 'true' || q.serverCompress === '1',
      uploadFolder: q.uploadFolder || '',
      uploader,
      ip: this.clientIp(req),
      // 初始大小：前端本地压缩后仍会带原始字节数；缺省时后端用收到的 buffer 长度
      originalSize: Number(q.originalSize || body.originalSize || 0) || 0,
      // 压缩期望百分比（前端上传设置优先，缺省由后端读「网页设置 → 客户端设置」）
      compressPercent: Number(q.compressPercent || body.compressPercent || 0) || 0,
      /*
       * 备份开关：
       *   - 备份渠道下拉选了 none → 本次不备份
       *   - 选了具体渠道 / 默认（空）→ 备份；后者由 StorageChannelService 解析默认备份渠道
       *   - 旧的 backup=false 参数仍兼容
       */
      backup: backupOff ? false : q.backup !== 'false' && q.backup !== '0',
      backupChannelId,
      // 主渠道失败时按渠道 ID 顺序自动切换下一个渠道
      autoRetry: q.autoRetry === 'true' || q.autoRetry === '1',
      // 账户关闭了「类型和大小限制」→ 跳过白名单与大小上限
      skipFileLimits: !enforceLimits,
      // 上传渠道：走「默认」通道（前端上传页）
      uploadSource: 'Default',
      // 上传开始时间（请求到达时刻）→ 详情页「上传时长 / 上传速度」
      uploadStartedAt: new Date(arrivedAt),
      // 前端临时指定的格式/大小限制（空值表示沿用后台全局设置）
      limitsOverride: {
        exts: overrideExts.length ? overrideExts : undefined,
        maxMB: overrideMaxMB > 0 ? overrideMaxMB : undefined,
      },
    };

    // 分块初始化（v2.8.3：会话落盘 + 断点续传）
    if (q.initChunked === 'true') {
      const totalChunks = Math.max(1, Number(body.totalChunks || q.totalChunks || 0));
      const originalName = fixFilename(body.originalFileName || q.originalFileName || 'chunked.bin');
      const mime = body.originalFileType || q.originalFileType || 'application/octet-stream';
      const size = Number(body.fileSize || q.fileSize || 0) || 0;
      // 指纹只用于命中同一个文件的旧会话，做长度/字符收敛，避免写进 manifest 的垃圾数据
      const uploadKey = String(body.uploadKey || q.uploadKey || '').slice(0, 200);

      if (uploadKey) {
        const exist = await findSessionByKey(uploadKey);
        if (exist && exist.totalChunks === totalChunks) {
          const received = await receivedChunks(exist.uploadId);
          console.log(`[upload] 续传命中：${originalName}（已收 ${received.length}/${totalChunks} 片）`);
          return res.json({ success: true, uploadId: exist.uploadId, received, resumed: true });
        }
      }

      const session = await createSession({ totalChunks, originalName, mime, size, uploadKey });
      return res.json({ success: true, uploadId: session.uploadId, received: [], resumed: false });
    }

    // 分块接收 / 合并
    //
    // 契约（与前端 UploadForm.vue 严格对齐）：
    //   ?chunked=true            → 收单个分片，体含 chunkIndex/uploadId，响应内容前端不读
    //   ?chunked=true&merge=true → 全部分片到齐后的合并请求，**响应体必须是裸数组** `[{src,name}]`
    // v2.8.3：分片直接写磁盘（<tmp>/sessions/<uploadId>/000001.part），不再堆内存；
    //         缺片/大小不符一律报错，绝不补零；只有真正落库成功后才标记完成。
    if (q.chunked === 'true') {
      const uploadId = body.uploadId || q.uploadId || '';
      const session = await getSession(uploadId);
      if (!session) {
        return res.status(400).json({ success: false, message: '上传会话不存在或已过期，请重新上传' });
      }

      if (q.merge === 'true') {
        let merged: { path: string; size: number };
        try {
          merged = await mergeSession(session);
        } catch (err) {
          const msg = (err as Error).message || '分片合并失败';
          appLog.warn('upload', `分片合并失败：${session.originalName}`, msg);
          // 会话与分片全部保留，前端可直接重试合并（不必重传）
          return res.status(400).json({ success: false, message: msg });
        }
        const originalName = fixFilename(body.originalFileName || session.originalName);
        try {
          const r = await this.svc.upload(
            {
              buffer: Buffer.alloc(0),
              path: merged.path,
              size: merged.size,
              mime: session.mime,
              originalName,
            },
            // 合并请求的时刻不是上传起点：用第一片 init 的时刻算时长
            { ...opts, uploadStartedAt: new Date(session.startedAt || arrivedAt) },
          );
          if (r.error) {
            // 写渠道失败：分片保留 24h，前端重试合并即可，不需要重传 500MB
            return res.status(500).json({ success: false, message: r.error });
          }
          await markSessionCompleted(session);
          return res.json([{ src: await this.signedSrc(r.id, req), name: r.finalName || originalName }]);
        } catch (err) {
          appLog.error('upload', `分片合并后上传异常：${originalName}`, (err as Error).message);
          return res.status(500).json({ success: false, message: (err as Error).message });
        }
      }

      const idx = Number(body.chunkIndex ?? q.chunkIndex ?? -1);
      if (!Number.isInteger(idx) || idx < 0 || idx >= session.totalChunks) {
        return res.status(400).json({ success: false, message: `分片序号无效（${idx}）` });
      }
      if (!file?.buffer?.length) {
        return res.status(400).json({ success: false, message: '分片内容为空' });
      }
      await writeChunk(uploadId, idx, file.buffer);
      await touchSession(session);
      return res.json({ success: true, chunkIndex: idx });
    }

    // 链接转存暂存提交：文件早已在服务端磁盘上，这里只做压缩 + 写渠道，浏览器不再传一遍
    const stagingId = String(body.stagingId || q.stagingId || '');
    if (stagingId) {
      const meta = await getStaging(stagingId);
      if (!meta) return res.status(400).json({ success: false, message: '暂存文件不存在或已过期，请重新转存' });
      let st: { size: number } | null = null;
      try {
        st = await fsp.stat(stagingFilePath(stagingId));
      } catch {
        st = null;
      }
      if (!st) return res.status(400).json({ success: false, message: '暂存文件已丢失，请重新转存' });
      const originalName = fixFilename(body.originalFileName || q.originalFileName || meta.name);
      const r = await this.svc.upload(
        {
          buffer: Buffer.alloc(0),
          path: stagingFilePath(stagingId),
          size: st.size,
          mime: meta.mime,
          originalName,
        },
        {
          ...opts,
          originalSize: Number(q.originalSize || 0) || st.size,
          uploadStartedAt: new Date(meta.createdAt || arrivedAt),
        },
      );
      if (r.error) return res.status(500).json({ success: false, message: r.error });
      // 标记已提交：再保留 2h 供异步备份读取，之后由 TTL 清理
      await updateStaging(meta, { committedAt: Date.now() });
      return res.json([{ src: await this.signedSrc(r.id, req), name: r.finalName || originalName }]);
    }

    // 常规上传
    if (!file) return res.status(400).json({ success: false, message: '缺少文件' });
    const originalName = fixFilename(file.originalname);
    const r = await this.svc.upload(
      { buffer: file.buffer, mime: file.mimetype, originalName },
      opts,
    );
    if (r.error) return res.status(500).json({ success: false, message: r.error });
    // ⚠️ 前端读取 response.data[0].src —— 响应体必须是【裸数组】，不能包 {success,data}
    // src 是「全站统一出口」的完整外链（自定义访问域名优先）
    return res.json([{ src: await this.signedSrc(r.id, req), name: r.finalName || originalName }]);
  }

  /**
   * 链接上传：POST /api/fetchRes { url }
   *
   * 契约：**返回文件字节流（blob）+ Content-Disposition 文件名**，而不是上传结果。
   * 前端拿到 blob 后会自己构造 File 再走 /upload 正常上传（因此这里只做安全拉取）。
   *
   * v2.5.0（v20261023-2）：支持「视频播放页」链接 —— 拉到的内容是网页时，
   * 自动解析出真实视频地址（B 站 API / og:video / <video> 标签等）再回传视频字节流。
   *
   * ⚠️ 必须显式 @HttpCode(200)：NestJS 对 POST 默认返回 201，而前端判定的是
   * `response.status == 200`，此前「转存模式」报「粘贴板中的URL地址请求失败」正是这个原因。
   */
  @Post('api/fetchRes')
  @HttpCode(200)
  async fetchRes(@Body() body: { url?: string; stage?: boolean | string }, @Res() res: Response) {
    const url = body.url || '';
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      appLog.warn('fetch', `链接转存失败：URL 无效`, url.slice(0, 200));
      return res.status(400).json({ success: false, message: 'URL 无效' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      appLog.warn('fetch', `链接转存失败：仅支持 http/https`, url.slice(0, 200));
      return res.status(400).json({ success: false, message: '仅支持 http/https' });
    }
    if (isBlockedFetchHost(parsed.hostname)) {
      appLog.warn('fetch', `链接转存失败：目标为云元数据/组播地址，已拦截`, url.slice(0, 200));
      return res.status(400).json({ success: false, message: '禁止访问该地址（云元数据/组播地址）' });
    }

    const UA =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const firstCtrl = new AbortController();
    const firstTimer = setTimeout(() => firstCtrl.abort(), 15000);
    try {
      // 第一次抓取：判断内容类型 —— 网页（HTML）→ 视频解析；其余 → 原样转存
      let resp = await fetch(url, {
        signal: firstCtrl.signal,
        redirect: 'follow',
        headers: { 'user-agent': UA },
      });
      if (!resp.ok) {
        appLog.warn('fetch', `链接转存失败：HTTP ${resp.status}`, url.slice(0, 200));
        return res.status(400).json({ success: false, message: `拉取失败 HTTP ${resp.status}` });
      }
      const firstMime = resp.headers.get('content-type')?.split(';')[0]?.trim() || '';

      /*
       * v2.5.0（v20261023-2）：网页 → 播放页解析。
       * B 站 API / og:video / <video> 标签等；解析失败给出明确错误。
       * 非 HTML（图片 / 直链视频 / 音频等）保持原有行为，完全不受影响。
       */
      let referer: string | undefined;
      let suggestedName = '';
      if (/^text\/html/i.test(firstMime)) {
        const html = await resp.text();
        /*
         * v2.6.0（v20261024-1）：传【重定向后的最终地址】而不是原始 url ——
         * b23.tv / v.douyin.com 等短链会 302 到正式域，B 站解析靠 hostname
         * 判断平台，传 b23.tv 会直接跳过专用解析导致失败。
         */
        const finalUrl = resp.url || url;
        const r = await resolveVideoFromHtml(finalUrl, html);
        if (!r.ok) {
          appLog.warn('video', `视频解析失败：${url.slice(0, 120)}`, r.message);
          return res.status(400).json({ success: false, message: r.message });
        }
        referer = r.video.referer;
        suggestedName = r.video.name || '';
        // 视频文件通常较大，下载放宽到 2 分钟
        const secondCtrl = new AbortController();
        const secondTimer = setTimeout(() => secondCtrl.abort(), 120000);
        try {
          resp = await fetch(r.video.directUrl, {
            signal: secondCtrl.signal,
            redirect: 'follow',
            headers: { 'user-agent': UA, ...(referer ? { referer } : {}) },
          });
        } finally {
          clearTimeout(secondTimer);
        }
        if (!resp.ok) {
          appLog.warn('fetch', `视频转存失败：HTTP ${resp.status}`, url.slice(0, 200));
          return res.status(400).json({ success: false, message: `视频拉取失败 HTTP ${resp.status}` });
        }
      }

      // 文件名：优先 URL 末段（解码），其次按 MIME 猜扩展名
      let name = decodeURIComponent(safeTargetUrl(resp.url || url).pathname.split('/').pop() || '');
      const mime = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
      if (!name || !name.includes('.')) {
        const ext = UploadController.MIME_EXT[mime] || 'bin';
        name = `${name || 'PastedFile' + Date.now()}.${ext}`;
      }
      // 视频解析场景：页面标题给出的文件名优先（比 CDN 随机串可读）
      if (suggestedName) name = suggestedName;

      /*
       * v2.8.3：大文件 / 音视频不再回传浏览器 —— 直接流式落到服务端暂存目录。
       * 原因：老流程是「源站→服务器内存→浏览器→服务器→渠道」，
       * 200MB 文件要跑 3 遍流量、浏览器还要占 200MB 内存。
       * 图片仍然回传字节（前端需要 File 才能裁剪），只有超大图片才走暂存。
       */
      const declaredLen = Number(resp.headers.get('content-length') || 0) || 0;
      const isImage = /^image\//i.test(mime);
      const wantStage = !isImage || declaredLen > 256 * 1024 * 1024;

      if (wantStage) {
        if (!resp.body) {
          return res.status(400).json({ success: false, message: '目标地址没有返回可读取的内容' });
        }
        const staged = await createStaging({ name, mime, size: declaredLen, sourceUrl: url });
        try {
          await pipeline(
            Readable.fromWeb(resp.body as any),
            createWriteStream(stagingFilePath(staged.stagingId)),
          );
        } catch (err) {
          await removeStaging(staged.stagingId);
          throw err;
        }
        const st = await fsp.stat(stagingFilePath(staged.stagingId));
        if (st.size > MAX_FETCH_BYTES) {
          await removeStaging(staged.stagingId);
          appLog.warn('fetch', `链接转存失败：文件超过 ${Math.round(MAX_FETCH_BYTES / 1024 / 1024)}MB 上限`, url.slice(0, 200));
          return res.status(400).json({ success: false, message: `文件超过 ${Math.round(MAX_FETCH_BYTES / 1024 / 1024)}MB 上限` });
        }
        const updated = await updateStaging(staged, { size: st.size });
        appLog.info('fetch', `链接已暂存到服务端：${name}`, `${st.size}B ｜ ${url.slice(0, 180)}`);
        return res.json({
          success: true,
          staged: true,
          stagingId: updated.stagingId,
          name,
          size: st.size,
          mime,
        });
      }

      const buf = Buffer.from(await resp.arrayBuffer());
      // 兜底上限：真正的「单文件大小上限」由后台设置决定，这里只防极端大文件把内存撑爆。
      if (buf.length > MAX_FETCH_BYTES) {
        appLog.warn('fetch', `链接转存失败：文件超过 ${Math.round(MAX_FETCH_BYTES / 1024 / 1024)}MB 上限`, url.slice(0, 200));
        return res.status(400).json({ success: false, message: `文件超过 ${Math.round(MAX_FETCH_BYTES / 1024 / 1024)}MB 上限` });
      }
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', String(buf.length));
      // 同时给出 filename 与 RFC5987 的 filename*，前端两种正则都能解析
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
      return res.send(buf);
    } catch (err) {
      appLog.error('fetch', `链接转存异常：${(err as Error).message}`, url.slice(0, 200));
      return res.status(400).json({ success: false, message: `拉取失败: ${(err as Error).message}` });
    } finally {
      clearTimeout(firstTimer);
    }
  }

  /**
   * 删除链接暂存（前端移除列表项 / 清空列表时调用）。
   * 失败一律返回 success，避免清理动作影响用户操作。
   */
  @Post('api/staging/delete')
  @HttpCode(200)
  async deleteStaging(@Body() body: { stagingId?: string }) {
    const id = String(body?.stagingId || '');
    if (!id) return { success: true };
    try {
      await removeStaging(id);
    } catch {
      /* 已过期/已删除都视为成功 */
    }
    return { success: true };
  }
}

/** 安全解析（parse 失败时兜底返回空路径对象，避免抛异常中断响应） */
function safeTargetUrl(u: string): URL {
  try {
    return new URL(u);
  } catch {
    return new URL('http://invalid.local/');
  }
}
