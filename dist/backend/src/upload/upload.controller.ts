import { Body, Controller, Get, HttpCode, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFile, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { OptionalAuthGuard, currentSession } from '../auth/auth.guard';
import { UploadService } from './upload.service';
import { SettingsService } from '../settings/settings.service';
import { NO_BACKUP_VALUES } from '../storage/storage-channel.service';

/**
 * 分块上传的内存暂存（单实例 SQLite 部署形态下够用；大并发场景可换落盘）。
 * startedAt = 第一片 init 到达的时刻，合并后作为「上传开始时间」写库，
 * 这样详情页的「上传时长」覆盖整个分块传输过程，而不是只剩合并那一下。
 */
const chunkStore = new Map<
  string,
  { chunks: Map<number, Buffer>; totalChunks: number; originalName: string; mime: string; startedAt: number }
>();

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
  try {
    const restored = Buffer.from(raw, 'latin1').toString('utf8');
    if (!restored.includes('\uFFFD') && /[^\u0000-\u007F]/.test(restored)) return restored;
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
  ) {}

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

  /** 核心上传：POST /upload —— 兼容前端契约（query 参数 + multipart） */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 512 * 1024 * 1024 } }))
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
      /** 前端上传设置临时指定的允许格式（逗号分隔）—— 传了覆盖后台全局配置 */
      allowedExtensions?: string;
      /** 前端上传设置临时指定的单文件大小上限（MB）—— 传了覆盖后台全局配置 */
      maxFileSizeMB?: string;
    },
    @Body() body: Record<string, string>,
    @Req() req: Request & { session?: { user: string } },
    @Res() res: Response,
  ) {
    // 分块清理
    if (q.cleanup === 'true' && q.uploadId) {
      chunkStore.delete(q.uploadId);
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

    // 分块初始化
    if (q.initChunked === 'true') {
      const uploadId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      chunkStore.set(uploadId, {
        chunks: new Map(),
        totalChunks: Number(body.totalChunks || q.totalChunks || 0),
        originalName: fixFilename(body.originalFileName || 'chunked.bin'),
        mime: body.originalFileType || 'application/octet-stream',
        // 第一片 init 的时刻 = 这次分块上传的开始时间
        startedAt: arrivedAt,
      });
      return res.json({ success: true, uploadId });
    }

    // 分块接收 / 合并
    //
    // 契约（与前端 UploadForm.vue 严格对齐）：
    //   ?chunked=true            → 收单个分片，体含 chunkIndex/uploadId，响应内容前端不读
    //   ?chunked=true&merge=true → 全部分片到齐后的合并请求，**响应体必须是裸数组** `[{src,name}]`
    // 注意：绝不能在「最后一片到达时自动合并上传」——前端随后还会发 merge 请求，
    //       那样 merge 会找不到 uploadId（历史 bug：这里会 400，分块上传必失败）。
    if (q.chunked === 'true') {
      const uploadId = body.uploadId || q.uploadId || '';
      const store = chunkStore.get(uploadId);
      if (!store) return res.status(400).json({ success: false, message: 'uploadId 无效或已过期' });

      if (q.merge === 'true') {
        const total = Number(store.totalChunks || body.totalChunks || q.totalChunks || 0);
        const merged = Buffer.concat(
          Array.from({ length: total }, (_, i) => store.chunks.get(i) || Buffer.alloc(0)),
        );
        chunkStore.delete(uploadId);
        const originalName = fixFilename(body.originalFileName || store.originalName);
        const r = await this.svc.upload(
          { buffer: merged, mime: store.mime, originalName },
          // 合并请求的时刻不是上传起点：用第一片 init 的时刻算时长
          { ...opts, uploadStartedAt: new Date(store.startedAt || arrivedAt) },
        );
        if (r.error) return res.status(500).json({ success: false, message: r.error });
        return res.json([{ src: await this.signedSrc(r.id, req), name: originalName }]);
      }

      const idx = Number(body.chunkIndex ?? q.chunkIndex ?? 0);
      store.chunks.set(idx, file?.buffer || Buffer.alloc(0));
      return res.json({ success: true });
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
    return res.json([{ src: await this.signedSrc(r.id, req), name: originalName }]);
  }

  /**
   * 链接上传：POST /api/fetchRes { url }
   *
   * 契约：**返回文件字节流（blob）+ Content-Disposition 文件名**，而不是上传结果。
   * 前端拿到 blob 后会自己构造 File 再走 /upload 正常上传（因此这里只做安全拉取）。
   *
   * ⚠️ 必须显式 @HttpCode(200)：NestJS 对 POST 默认返回 201，而前端判定的是
   * `response.status == 200`，此前「转存模式」报「粘贴板中的URL地址请求失败」正是这个原因。
   */
  @Post('api/fetchRes')
  @HttpCode(200)
  async fetchRes(@Body() body: { url?: string }, @Res() res: Response) {
    const url = body.url || '';
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ success: false, message: 'URL 无效' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ success: false, message: '仅支持 http/https' });
    }
    if (isBlockedFetchHost(parsed.hostname)) {
      return res.status(400).json({ success: false, message: '禁止访问该地址（云元数据/组播地址）' });
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
      if (!resp.ok) return res.status(400).json({ success: false, message: `拉取失败 HTTP ${resp.status}` });
      const buf = Buffer.from(await resp.arrayBuffer());
      // 兜底上限放宽到 512MB：真正的「单文件大小上限」由后台设置（默认 150MB）决定，
      // 这里只防极端大文件把内存撑爆。
      if (buf.length > 512 * 1024 * 1024) {
        return res.status(400).json({ success: false, message: '文件超过 512MB 上限' });
      }
      // 文件名：优先 URL 末段（解码），其次按 MIME 猜扩展名
      let name = decodeURIComponent(parsed.pathname.split('/').pop() || '');
      const mime = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
      if (!name || !name.includes('.')) {
        const ext = UploadController.MIME_EXT[mime] || 'bin';
        name = `${name || 'PastedFile' + Date.now()}.${ext}`;
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
      return res.status(400).json({ success: false, message: `拉取失败: ${(err as Error).message}` });
    } finally {
      clearTimeout(timer);
    }
  }
}
