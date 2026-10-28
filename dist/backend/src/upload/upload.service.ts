import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream, promises as fsp } from 'fs';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { SettingsService } from '../settings/settings.service';
import { SysConfigService } from '../settings/sysconfig.service';
import { ChannelsService } from '../channels/channels.controller';
import { StorageChannelService, StorageChannelInfo } from '../storage/storage-channel.service';
import { createAdapter, toCopyInfo } from '../adapters/adapter.factory';
import { localFileAbs } from '../adapters/local.adapter';
import { AdapterError, ChannelInfo, StorageAdapter } from '../adapters/adapter.interface';
import { normalizeUploadSource, fileTypeOf, channelShort } from '../common/file-view';
import { appLog } from '../common/app-log';
import { joinObjectKey, renderFileName, renderObjectPrefix, supportsPrefix } from '../common/path-template';
import { compressFile, compressMedia, readDimensions, readDimensionsFile } from '../common/compress';

/**
 * 压缩上限（字节）：超过就不压。
 * v2.8.3 起大文件压缩走磁盘路径（ffmpeg / sharp 直接读文件），不再整份读内存，
 * 所以上限从 512MB 提高到默认 4GB（可用 COMPRESS_MAX_MB 调整）。
 */
const COMPRESS_MAX_BYTES = Math.max(512, Number(process.env.COMPRESS_MAX_MB || 4096)) * 1024 * 1024;

/**
 * 没有「流式写入」能力的渠道（http-post / immich / aliyun 等）超过该阈值直接报错，
 * 而不是把 500MB 读进内存把进程拖垮。S3 / 本地 / WebDAV 走 uploadFile，不受此限。
 */
const STREAM_REQUIRED_BYTES = 256 * 1024 * 1024;

interface UploadOptions {
  /** 渠道类型过滤（cos/minio/r2…）：仅用于「按类型挑一条可用渠道」 */
  uploadChannel?: string;
  /**
   * 指定具体渠道 —— **只接受渠道 ID**（6 位 code，或数据库主键 id）。
   * 渠道名（name）仅作展示标识，不参与任何查找匹配。
   */
  channelId?: string;
  uploadNameType?: string; // default | index | original
  serverCompress?: boolean;
  /** 压缩期望：压缩后体积占原文件的百分比（10-100）；0/缺省时读后台「网页设置 → 默认压缩期望」 */
  compressPercent?: number;
  uploadFolder?: string;
  uploader?: string;
  /** 上传者 IP（用于归属地查询、黑白名单统计） */
  ip?: string;
  /** 初始（压缩前）字节数 —— 前端本地压缩后仍会带上原始大小，缺省时用 buffer 长度 */
  originalSize?: number;
  /** 是否对本次上传执行备份（前端「上传设置 → 是否备份」开关；缺省 true） */
  backup?: boolean;
  /**
   * 指定备份渠道（**只接受渠道 ID**：6 位 code 或主键 id）。
   * 用于 API Token 的 `backup` 参数 —— 不指定时由 getStorageChannel 依次退回
   * 「Token 级 → 账户级 → 全局备份渠道」。
   */
  backupChannelId?: string;
  /** 指定上传文件的归属账户（API Token 上传统一归属管理员账户） */
  owner?: string;
  /**
   * 上传渠道（上传来源入口），落库到 FileRecord.uploadSource，用于后台文件详情展示：
   *   Default（默认）—— go-imgbed 前端上传页
   *   WebDAV          —— 对外 WebDAV
   *   API-Web         —— API Token 的「Web 通用」通道
   *   API-S3          —— API Token 的「S3 协议」通道
   * 未传时按 Default 处理。
   */
  uploadSource?: string;
  /**
   * 上传开始时间（请求到达服务端的时刻）—— 用于详情页「上传时长 / 上传速度」。
   * 分块上传传第一片的 init 时刻；缺省时用 upload() 内部计时起点。
   */
  uploadStartedAt?: Date;
  /**
   * 本次上传的「允许的上传格式 / 单文件大小上限」覆盖值。
   * 前端上传页右下角设置里填了就用它，否则退回后台「上传相关配置」的全局值。
   */
  limitsOverride?: { exts?: string[]; maxMB?: number };
  /**
   * API Token 主键 id —— 交给 StorageChannelService 读取该 Token 上配置的
   * 默认主/备渠道（优先级高于账户级与全局设置）。
   */
  tokenId?: string;
  /**
   * 渠道解析时跳过「uploader 账户在用户管理里绑定的渠道」。
   * 「Web 通用」Token 未传 username 时使用：规则要求渠道优先级严格为
   * 「Token 上配置的渠道 → 全局默认」，不允许 owner 账户的绑定渠道插队。
   */
  ignoreUploaderChannel?: boolean;
  /**
   * 指定对外文件标识（fileRecord.name）。
   * S3 协议场景传入客户端上传时的 Object Key，使得客户端用「自定义域名 + key」
   * 自行拼出的地址恰好命中本站签发链接（否则客户端只能拼出一个不存在的地址）。
   */
  presetFileId?: string;
  /**
   * 跳过「文件类型白名单 + 大小上限」校验（默认 false）。
   *
   * 专供对外 WebDAV 通道：WebDAV 的定位是「同步 / 备份型传输通道」
   * （笔记平台、阅读平台、网盘客户端等），上传的可能是任意类型的文件，
   * 体积也常常远超网页上传的限制，因此不受这两项限制。
   * 注意：仅为「跳过类型与大小」，魔数比对、MIME 归一化等仍照常执行。
   */
  skipFileLimits?: boolean;
  /** 主渠道失败时按渠道 ID 顺序自动切换下一个渠道 */
  autoRetry?: boolean;
}

interface UploadInput {
  buffer: Buffer;
  mime: string;
  originalName: string;
  /**
   * v2.8.3：大文件以「磁盘路径」形式传入（分片合并结果 / 链接暂存），
   * 避免把 500MB 读进内存。有 path 时 buffer 允许为空。
   */
  path?: string;
  /** 文件字节数（有 path 时用于限额/校验/落库，避免反复 stat） */
  size?: number;
}

@Injectable()
export class UploadService {
  /** 上传选项：IP 用于归属地查询与限制策略 */
  private static readonly DEFAULT_EXT = [
    'jpg', 'png', 'gif', 'jpeg', 'webp', 'bmp',
    'mp4', 'webm', 'mov', 'm4v',
    'mp3', 'm4a', 'aac', 'ogg',
  ];

  constructor(
    private settings: SettingsService,
    private channels: ChannelsService,
    private sysConfig: SysConfigService,
    private storageChannel: StorageChannelService,
  ) {}

  /**
   * 正在进行的「主渠道上传」数量（覆盖校验 → 压缩 → 写主渠道 → 落库全过程）。
   * 备份（低优先级）任务据此让路：主渠道上传期间备份不抢带宽，保证上传速度优先。
   */
  private activeUploads = 0;

  /**
   * 备用库轮转游标（v202610221824）。
   * 每次主渠道失败需要切换时取模决定从备用库池的哪一条开始，
   * 让多次上传均摊到各备用库，而不是永远先试同一条。
   */
  private poolCursor = 0;

  /**
   * 低优先级（备份）任务串行链。
   * 作用有两个：
   *   1) 串行化 —— 同一时刻最多只有一个备份上传在跑，不与主渠道争抢带宽；
   *   2) 让路 —— 每个任务真正开始前等待主渠道上传全部结束（见 waitForUploadIdle）。
   */
  private lowPriorityChain: Promise<unknown> = Promise.resolve();

  /** 低优先级任务：等主渠道空闲后串行执行；返回任务自身的返回值（异常会抛给调用方） */
  private enqueueLowPriority<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lowPriorityChain.then(async () => {
      await this.waitForUploadIdle();
      return task();
    });
    // 让链本身不因单个任务失败而中断，同时把异常照常抛给 await 的调用方
    this.lowPriorityChain = run.catch((err) => {
      console.error('[backup] 低优先级任务异常:', (err as Error)?.message || err);
      return undefined;
    });
    return run;
  }

  /**
   * 后台任务队列（不等待主渠道空闲）：用于「打标签 / IP 归属地补写 / IP 计数」这类
   * 毫秒级、不占带宽的收尾工作 —— 上传响应不必等它们，也不该被备份任务挡住。
   */
  private backgroundChain: Promise<unknown> = Promise.resolve();
  private enqueueBackground<T>(task: () => Promise<T>): Promise<T> {
    const run = this.backgroundChain.then(task);
    this.backgroundChain = run.catch((err) => {
      console.warn('[bg] 后台任务异常:', (err as Error)?.message || err);
      return undefined;
    });
    return run;
  }

  /**
   * 等待主渠道上传空闲。
   * 超时后仍继续执行 —— 否则主渠道持续繁忙时备份会被永久饿死（备份必须最终完成）。
   */
  private async waitForUploadIdle(maxWaitMs = 20000): Promise<void> {
    const started = Date.now();
    while (this.activeUploads > 0 && Date.now() - started < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  /**
   * 账户级「类型和大小限制」开关（后台「用户管理 → 编辑」里的同名开关）。
   *
   *   true  —— 受「允许上传格式 + 单文件大小上限」两项约束（默认）
   *   false —— 跳过这两项限制，可直接上传任意格式 / 任意体积
   *
   * 账户不存在时按 true 处理（初始管理员不在 users 表中，仍受限制；
   * 未登录的匿名上传同样受限），避免"查不到就放行"的安全缺口。
   */
  async userEnforceLimits(username: string): Promise<boolean> {
    const name = String(username || '').trim();
    if (!name) return true;
    try {
      const row = await prisma.user.findUnique({
        where: { username: name },
        select: { enforceLimits: true },
      });
      if (row) return row.enforceLimits !== false;
      /*
       * 内建管理员不在 users 表中：改读「用户管理 → 编辑管理员」保存的同名开关
       * （adminProfile）。读不到时仍按 true（受限），保持原有的保守默认。
       */
      const security: any = await this.sysConfig.get('security');
      const adminName =
        String(security?.auth?.admin?.adminUsername || '').trim() ||
        (process.env.ADMIN_USER || '').trim() ||
        'admin';
      if (name === adminName) {
        const prof: any = await this.sysConfig.get('adminProfile');
        return prof?.enforceLimits !== false;
      }
      return true;
    } catch {
      return true;
    }
  }

  /** 读取上传限制（来自「系统设置 → 页面设置」，缺失时用兜底值） */
  private async limits(): Promise<{ exts: string[]; maxMB: number }> {    try {
      const page: any = await this.sysConfig.get('page');
      const get = (id: string) => (page?.config || []).find((x: any) => x.id === id)?.value;
      const raw = get('allowedExtensions');
      const exts = String(raw || UploadService.DEFAULT_EXT.join(','))
        .split(',')
        .map((s: string) => s.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean);
      const maxMB = Number(get('maxUploadSizeMB')) || 1024;
      return { exts: exts.length ? exts : UploadService.DEFAULT_EXT, maxMB };
    } catch {
      return { exts: UploadService.DEFAULT_EXT, maxMB: 1024 };
    }
  }

  /** 文件签名（magic bytes）比对：true 匹配 / false 不匹配 / null 无法判定（放行） */
  private signatureOk(buf: Buffer, ext: string): boolean | null {
    if (buf.length < 4) return null;
    const hex = buf.subarray(0, 16).toString('hex');
    const a4 = buf.subarray(0, 4).toString('latin1');
    const b4 = buf.subarray(4, 8).toString('latin1');
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return hex.startsWith('ffd8ff');
      case 'png':
        return hex.startsWith('89504e47');
      case 'gif':
        return a4 === 'GIF8';
      case 'webp':
        return a4 === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
      case 'bmp':
        return hex.startsWith('424d');
      case 'webm':
        return hex.startsWith('1a45dfa3');
      case 'ogg':
        return a4 === 'OggS';
      case 'mp4':
      case 'm4v':
      case 'm4a':
        return b4 === 'ftyp';
      case 'mov':
        return b4 === 'ftyp' || ['moov', 'mdat', 'free', 'wide'].includes(b4);
      case 'aac':
        return /^fff[019]/.test(hex);
      case 'mp3':
        return hex.startsWith('494433') || /^ff[ef][0-9a-f]/.test(hex);
      default:
        return null;
    }
  }

  /** 图片类扩展名集合（v2.8.2 图片互串宽容判定用） */
  private static readonly IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

  /** 按魔数识别真实图片格式；非已知图片签名返回 null（v2.8.2） */
  private static detectImageExt(buf: Buffer): string | null {
    if (buf.length < 12) return null;
    const hex = buf.subarray(0, 16).toString('hex');
    const a4 = buf.subarray(0, 4).toString('latin1');
    if (hex.startsWith('ffd8ff')) return 'jpg';
    if (hex.startsWith('89504e47')) return 'png';
    if (a4 === 'GIF8') return 'gif';
    if (a4 === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
    if (hex.startsWith('424d')) return 'bmp';
    return null;
  }

  /** 扩展名 → 权威 MIME 映射（与上传白名单一一对应） */
  private static readonly EXT_MIME: Record<string, string> = {    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
  };

  /**
   * MIME 归一化：以扩展名为准给出权威 MIME。
   *
   * 为什么必须做：curl、部分浏览器、以及各类脚本客户端对 mp4 / mp3 / m4a 等
   * 会统一发送 `application/octet-stream`。若原样落库，会导致：
   *   - 「视频按 MIME 分流」失效（视频被当成未知二进制）
   *   - 随机图 API 的 ?category=video|audio 筛选永远查不到
   *   - 后台列表的类型图标、前端预览方式判错
   * 因此落库前一律按扩展名归一化；白名单外的扩展名（用户自定义时）才回退客户端值。
   */
  private normalizeMime(originalName: string, clientMime: string): string {
    const ext = (originalName.split('.').pop() || '').toLowerCase();
    const mapped = UploadService.EXT_MIME[ext];
    if (mapped) return mapped;
    const cm = (clientMime || '').split(';')[0].trim().toLowerCase();
    if (cm && cm !== 'application/octet-stream') return cm;
    return 'application/octet-stream';
  }

  /** 扩展名白名单 + 魔数 + 大小：三重服务端校验（客户端校验可被绕过） */
  private async validate(input: UploadInput, override?: { exts?: string[]; maxMB?: number }): Promise<string | null> {
    const base = await this.limits();
    const exts = override?.exts && override.exts.length ? override.exts : base.exts;
    const maxMB = override?.maxMB && override.maxMB > 0 ? override.maxMB : base.maxMB;
    const ext = (input.originalName.split('.').pop() || '').toLowerCase();
    if (!ext || ext === input.originalName.toLowerCase()) {
      return '无法识别文件类型（缺少扩展名）';
    }
    if (!exts.includes(ext)) {
      return `不支持的格式 .${ext}，允许：${exts.join('/')}`;
    }
    const size = Number(input.size || 0) || (input.path ? (await fsp.stat(input.path)).size : input.buffer.length);
    if (size > maxMB * 1024 * 1024) {
      return `文件超过 ${maxMB}MB 上限（当前 ${(size / 1024 / 1024).toFixed(1)}MB），请到「其他设置 → 上传相关配置」调大单文件大小上限`;
    }
    // 魔数只看文件头 64 字节：大文件不读整份，避免校验本身把内存吃掉
    const head = input.buffer.length ? input.buffer.subarray(0, 64) : await this.readHead(input.path || '', 64);
    if (this.signatureOk(head, ext) === false) {
      /*
       * v2.8.2：图片格式互串放行 —— 从网页保存的图片常被按 URL 命名，
       * 扩展名 .jpg 但内容其实是 PNG（浏览器渲染按内容嗅探，不受影响）。
       * 声明扩展名与真实内容同为图片格式时放行并记系统日志；
       * 跨大类（如 exe 改名 .jpg）仍然拒绝。
       */
      const realExt = UploadService.detectImageExt(head);
      if (realExt && UploadService.IMG_EXTS.has(ext) && UploadService.IMG_EXTS.has(realExt)) {
        appLog.warn(
          'upload',
          `图片格式互串放行：声明 .${ext}，实际内容为 .${realExt}`,
          input.originalName,
        );
        return null;
      }
      appLog.warn('upload', `魔数校验拒绝：声明 .${ext} 与内容不符`, input.originalName);
      return `文件内容与扩展名不符（.${ext}），已拒绝上传`;
    }
    return null;
  }

  /** 读取文件头（最多 n 字节），用于大文件魔数校验 */
  private async readHead(path: string, n: number): Promise<Buffer> {
    if (!path) return Buffer.alloc(0);
    const fh = await fsp.open(path, 'r');
    try {
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fh.read(buf, 0, n, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close().catch(() => undefined);
    }
  }

  /**
   * 图像审查 —— 按「系统设置 → 安全设置 → 上传审查」的配置调用第三方接口。
   * 返回非空字符串表示被拒绝（含原因）。审查接口异常时放行，避免第三方故障阻断上传。
   */
  private async moderate(buffer: Buffer, mime: string): Promise<string | null> {
    if (!mime.startsWith('image/')) return null;
    let cfg: any;
    try {
      const security: any = await this.sysConfig.get('security');
      cfg = security?.upload?.moderate;
    } catch {
      return null;
    }
    if (!cfg?.enabled) return null;

    const timeout = AbortSignal.timeout(8000);
    try {
      if (cfg.channel === 'moderatecontent.com') {
        if (!cfg.moderateContentApiKey) return null;
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), 'image');
        const resp = await fetch(
          `https://api.moderatecontent.com/moderate/?key=${encodeURIComponent(cfg.moderateContentApiKey)}`,
          { method: 'POST', body: form, signal: timeout },
        );
        const json: any = await resp.json();
        // rating_index: 1..5（1 最安全）；3 及以上视为不宜内容
        const idx = Number(json?.rating_index);
        if (Number.isFinite(idx) && idx >= 3) {
          return `图片未通过内容审查（评级 ${json?.rating_letter || idx}）`;
        }
      } else if (cfg.channel === 'nsfwjs') {
        if (!cfg.nsfwApiPath) return null;
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), 'image');
        const resp = await fetch(cfg.nsfwApiPath, { method: 'POST', body: form, signal: timeout });
        const json: any = await resp.json();
        let porn = 0;
        if (typeof json?.porn === 'number') {
          porn = json.porn;
        } else if (Array.isArray(json?.predictions)) {
          porn = Math.max(
            0,
            ...json.predictions
              .filter((p: any) => ['Porn', 'Hentai', 'Sexy'].includes(p?.className))
              .map((p: any) => Number(p?.probability) || 0),
          );
        }
        if (porn >= 0.6) {
          return `图片未通过内容审查（敏感度 ${porn.toFixed(2)}）`;
        }
      }
    } catch (err) {
      console.warn('[moderate] 审查接口异常，放行:', (err as Error).message);
    }
    return null;
  }

  /**
   * 只读缓存里的归属地（1 次 SQLite 查询，约 1ms）。
   * 上传主链路用它 —— 未命中时不再同步请求外部 API（最多会拖 6 秒），
   * 落库后由后台任务补写，上传速度不受归属地查询影响。
   */
  private async cachedAddress(ip: string): Promise<string> {
    if (!ip) return '';
    try {
      const cached = await prisma.ipRecord.findUnique({ where: { ip } });
      if (cached && (cached.country || cached.region || cached.city)) {
        return [cached.country, cached.region, cached.city].filter(Boolean).join(' ');
      }
    } catch {
      /* 忽略缓存查询失败 */
    }
    return '';
  }

  /**
   * IP 归属地查询 —— 结果写入 ip_records 表并缓存，重复 IP 不再请求。
   * 支持「自定义 API」（参数/响应字段可配）与默认 ip-api.com。
   */
  private async resolveAddress(ip: string): Promise<string> {
    if (!ip) return '';
    try {
      const cached = await prisma.ipRecord.findUnique({ where: { ip } });
      if (cached && (cached.country || cached.region || cached.city)) {
        return [cached.country, cached.region, cached.city].filter(Boolean).join(' ');
      }
    } catch {
      /* 忽略缓存查询失败 */
    }

    let cfg: any;
    try {
      const security: any = await this.sysConfig.get('security');
      cfg = security?.upload?.ipQuery;
    } catch {
      return '';
    }
    if (!cfg?.enabled) return '';

    const timeout = AbortSignal.timeout(6000);
    try {
      let country = '';
      let region = '';
      let city = '';
      if (cfg.channel === 'customApi' && cfg.customApi?.url) {
        let url = String(cfg.customApi.url);
        for (const p of cfg.customApi.params || []) {
          if (!p?.key) continue;
          url = url.replace(new RegExp(`\\{${p.key}\\}`, 'g'), encodeURIComponent(p.value === '{ip}' ? ip : p.value));
        }
        const resp = await fetch(url, { signal: timeout });
        const json: any = await resp.json();
        const pick = (path: string) =>
          String(path)
            .split('.')
            .reduce((o: any, k: string) => (o == null ? '' : o[k]), json) || '';
        const fields: string[] = cfg.customApi.responseFields || [];
        const parts = fields.map(pick).filter(Boolean);
        const address = parts.join(' ');
        if (address) await this.cacheAddress(ip, '', '', address);
        return address;
      }
      // 默认：ip-api.com（免费、无需 key）
      const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`, {
        signal: timeout,
      });
      const json: any = await resp.json();
      country = json?.country || '';
      region = json?.regionName || '';
      city = json?.city || '';
      const address = [country, region, city].filter(Boolean).join(' ');
      if (address) await this.cacheAddress(ip, country, region, [city].filter(Boolean).join(' '));
      return address;
    } catch (err) {
      console.warn('[ipQuery] 归属地查询失败:', (err as Error).message);
      return '';
    }
  }

  /** 归属地写库（缓存 + 上传计数） */
  private async cacheAddress(ip: string, country: string, region: string, city: string) {
    await prisma.ipRecord.upsert({
      where: { ip },
      update: { country, region, city },
      create: { ip, country, region, city },
    });
  }

  /** 上传计数与最近活跃时间（用于「用户管理」按 IP 汇总） */
  private async touchIp(ip: string, address: string) {
    if (!ip) return;
    try {
      const parts = (address || '').split(' ');
      await prisma.ipRecord.upsert({
        where: { ip },
        update: { uploadCount: { increment: 1 } },
        create: {
          ip,
          country: parts[0] || '',
          region: parts[1] || '',
          city: parts.slice(2).join(' '),
          uploadCount: 1,
        },
      });
    } catch (err) {
      console.warn('[ipRecord] 计数失败:', (err as Error).message);
    }
  }

  /**
   * 上传成功后异步打标签（不阻塞上传响应）：
   *   文件类型（image / video / audio / other）
   *   扩展名（不含点，如 png）
   *   存储渠道类型简称（COS / ALI / EI / LS / IM / MI / R2 / S3 / WD / DIY）
   *   上传渠道（Default / WebDAV / API-Web / API-S3）
   *   当前年份（如 2026）
   * 开关：settings.autoTagEnabled（缺省开启，设成 false 可关闭）。
   * 全程 try/catch —— 打标签失败绝不能影响已经成功的上传。
   */
  private async autoTag(
    fileId: string,
    info: { originalName: string; mime: string; channelType: string; uploadSource?: string },
  ): Promise<void> {
    try {
      if ((await this.settings.get('autoTagEnabled', 'true')) === 'false') return;
      const ext = info.originalName.includes('.') ? String(info.originalName.split('.').pop() || '').toLowerCase() : '';
      const names = Array.from(
        new Set(
          [
            fileTypeOf(info.mime),
            ext.replace(/^\./, ''),
            channelShort(info.channelType),
            normalizeUploadSource(info.uploadSource),
            String(new Date().getFullYear()),
          ]
            .map((v) => String(v || '').trim())
            .filter(Boolean),
        ),
      );
      for (const name of names) {
        const tag = await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
        const exists = await prisma.fileTag.findFirst({
          where: { fileId, tagId: tag.id },
          select: { id: true },
        });
        if (!exists) await prisma.fileTag.create({ data: { fileId, tagId: tag.id } });
      }
    } catch (err) {
      appLog.warn('upload', `自动打标签失败（不影响文件本身）`, (err as Error)?.message || String(err));
    }
  }

  /** 解析渠道为适配器入参结构 */
  private toChannelInfo(c: { id: string; name: string; type: string; config: string }): ChannelInfo {
    return { id: c.id, name: c.name, type: c.type, config: this.channels.decryptConfig(c.type, c.config), metas: {} };
  }

  /**
   * 渠道是否仍可写入 —— 启用容量限制且用量达到告警阈值时暂停写入。
   * 返回 true 表示可写。
   */
  async channelWritable(c: { id: string; config: string }): Promise<boolean> {
    let cfg: Record<string, string> = {};
    try {
      cfg = JSON.parse(c.config || '{}');
    } catch {
      return true;
    }
    if (cfg.quotaEnabled !== 'true') return true;
    const limitGB = Number(cfg.quotaLimitGB) || 10;
    const threshold = Number(cfg.quotaThreshold) || 95;
    const rows = await prisma.fileCopy.findMany({
      where: { channelId: c.id, status: 'active' },
      include: { file: { select: { size: true } } },
    });
    const usedGB = rows.reduce((a, b) => a + (b.file?.size || 0), 0) / 1024 / 1024 / 1024;
    return usedGB / limitGB < threshold / 100;
  }

  /**
   * 按渠道 ID 查找启用中的渠道（委托给 StorageChannelService，全站口径统一）。
   *
   * 只认「渠道 ID」：6 位 `code`（后台渠道列表展示的渠道 ID）或数据库主键 `id`。
   * 渠道名（name）不参与匹配 —— 它只是便于人看的标识，可随意改名，
   * 拿名字做匹配会在改名后静默失配（历史上就出现过这类问题）。
   */
  async findChannelById(key?: string) {
    return this.storageChannel.findById(key);
  }

  /**
   * 主渠道解析 —— 统一走 StorageChannelService.getStorageChannelCandidates('main')。
   *
   * 候选优先级（详见 StorageChannelService）：
   *   explicitId（前端上传设置里选的渠道 ID）
   *   → tokenId（API Token 上配置的默认渠道）
   *   → uploader（「用户管理」里为账户指定的渠道）
   *   → 全局（后台「上传设置」里指定的主渠道）
   *   → 兜底（按「渠道类型」在本类型内选）
   *
   * 候选里跳过已达容量阈值的渠道；显式指定的渠道超限时直接抛错（与旧行为一致）。
   */
  async resolveMainChannel(q: {
    channelId?: string;
    channelType?: string;
    uploader?: string;
    tokenId?: string;
    preferredId?: string;
  } = {}): Promise<StorageChannelInfo | null> {
    /*
     * v2.8.6：显式指定的渠道被停用 → 直接报错，绝不静默改投别的渠道。
     * 历史上 findById 会把停用渠道过滤掉，调用方于是一路回退到全局主渠道，
     * 用户完全无感（以为传到了自己选的渠道）。任何来源（网页 / WebDAV / API）都走这里。
     */
    if (q.channelId) {
      const raw = await this.storageChannel.findRawById(q.channelId);
      if (raw && !raw.enabled) {
        appLog.warn('upload', `拒绝上传：渠道「${raw.name}」已停用`, `渠道 ID=${raw.code}`);
        throw new Error(`渠道「${raw.name}」已停用，请先在后台「上传设置 → 存储渠道管理」启用后再上传`);
      }
    }
    const list = await this.storageChannel.getStorageChannelCandidates('main', {
      explicitId: q.channelId,
      channelType: q.channelType,
      uploader: q.uploader,
      tokenId: q.tokenId,
    });
    // 兼容旧调用方传入的「账户级渠道 ID」
    if (q.preferredId && !list.some((c) => c.id === q.preferredId)) {
      const extra = await this.storageChannel.findById(q.preferredId);
      if (extra) list.push(extra);
    }
    for (const c of list) {
      if (await this.channelWritable(c)) return c;
    }
    // 显式指定的渠道存在但已达容量阈值：报错，避免用户以为上传成功其实没写进去
    if (q.channelId && list.length) {
      throw new Error(`渠道「${list[0].name}」已达到容量阈值，写入已暂停`);
    }
    return null;
  }

  /**
   * 备份渠道解析 —— 统一走 StorageChannelService.getStorageChannelCandidates('backup')。
   *   explicitId（调用方显式指定）→ tokenId（Token 配置）→ uploader（账户指定）→ 全局备份渠道
   */
  async resolveBackupChannel(q: {
    explicitId?: string;
    uploader?: string;
    tokenId?: string;
    preferredId?: string;
  } = {}): Promise<StorageChannelInfo | null> {
    const list = await this.storageChannel.getStorageChannelCandidates('backup', {
      explicitId: q.explicitId,
      uploader: q.uploader,
      tokenId: q.tokenId,
    });
    if (q.preferredId && !list.some((c) => c.id === q.preferredId)) {
      const extra = await this.storageChannel.findById(q.preferredId);
      if (extra) list.push(extra);
    }
    for (const c of list) {
      if (await this.channelWritable(c)) return c;
    }
    return null;
  }

  /** 备份功能总开关 + 是否配置了备份渠道 */
  async backupEnabled(): Promise<boolean> {
    const sw = await this.settings.get('backupEnabled', 'true');
    return sw === 'true';
  }

  /**
   * 按命名策略生成存储 key。
   *
   * 两类渠道分开处理（v202610221824）：
   *   A. 支持「对象前缀 / 自定义文件命名」的渠道（minio / cos / aliyun / r2 / s3 / webdav）：
   *      前缀取渠道配置 objectPrefix，占位符 {y}{m}{d}；为空时默认 `年/月`（2026/10）。
   *      文件名取渠道配置 customName，占位符 {filename}{uuid}{md5}{timestamp}{ext}；
   *      为空时默认 `文件名-时间戳`。
   *   B. 其它渠道（local / easyimages / lsky / immich / custom）：沿用历史 `YYYYMM/随机名`，
   *      本地存储据此识别「首段 6 位数字」再叠加用户目录，不能随意改格式。
   */
  private makeKeyFor(
    channel: StorageChannelInfo,
    originalName: string,
    nameType: string | undefined,
    md5: string,
  ): string {
    const dot = originalName.lastIndexOf('.');
    const ext = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : '';
    const stem = dot > 0 ? originalName.slice(0, dot) : originalName;

    if (supportsPrefix(channel.type)) {
      let cfg: Record<string, string> = {};
      try {
        cfg = this.channels.decryptConfig(channel.type, channel.config);
      } catch {
        cfg = {};
      }
      // 上传设置的「命名策略」（default/index/original）仅在渠道未自定义命名时生效
      let fileName: string;
      const customName = String(cfg.customName || '').trim();
      if (customName) {
        fileName = renderFileName(customName, { originalName, stem, ext, md5, timestamp: Date.now() });
      } else if (nameType === 'original') {
        fileName = ext ? `${stem}.${ext}` : stem;
      } else if (nameType === 'index') {
        fileName = `${Date.now()}.${ext || 'bin'}`;
      } else {
        // 默认：文件名-时间戳（需求规定的兜底格式）
        fileName = renderFileName('', { originalName, stem, ext, md5, timestamp: Date.now() });
      }
      // 前缀模板：优先新字段 objectPrefix，兼容历史字段 keyPrefix（cos/aliyun 旧称「指定存储路径」）。
      // 两者都为空 → renderObjectPrefix 内部兜底为 `年/月`。
      // 注意：前缀由这里统一渲染进 key，适配器不再二次拼接 keyPrefix，
      // 否则「对象前缀」会被重复叠加（img/2026/10/img/2026/10/x.png）。
      const prefix = renderObjectPrefix(cfg.objectPrefix || cfg.keyPrefix);
      return joinObjectKey(prefix, fileName);
    }

    // B 类：历史格式保持不变
    const date = new Date();
    const datePath = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
    let name: string;
    switch (nameType) {
      case 'original':
        name = stem;
        break;
      case 'index':
        name = datePath + String(date.getTime());
        break;
      default: // default：随机短 ID
        name = CryptoService.shortId();
    }
    return `${datePath}/${name}${ext ? '.' + ext : ''}`;
  }

  /**
   * 解析上传目录（逻辑分类）：
   *   1) 前端上传页指定的目录（最优先）
   *   2) 后台「网页设置 → 客户端设置 → 默认上传目录」
   *   3) 兜底：按「年份/月份」自动分类，如 2026/10（每次上传实时计算）
   */
  private async resolveFolder(input?: string): Promise<string> {
    const clean = (input || '').replace(/^\/+|\/+$/g, '');
    if (clean) return clean;
    try {
      const page: any = await this.sysConfig.get('page');
      const v = String((page?.config || []).find((x: any) => x.id === 'defaultUploadFolder')?.value || '').trim();
      const dv = v.replace(/^\/+|\/+$/g, '');
      if (dv) return dv;
    } catch {
      /* 配置读取失败 → 走年月兜底 */
    }
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** 后台默认压缩期望（百分比），非法时回退 80 */
  private async defaultCompressPercent(): Promise<number> {
    try {
      const page: any = await this.sysConfig.get('page');
      const v = Number((page?.config || []).find((x: any) => x.id === 'defaultCompressQuality')?.value);
      if (Number.isFinite(v) && v >= 10 && v <= 100) return v;
    } catch {
      /* 忽略 */
    }
    return 80;
  }

  /** 对外文件标识（/file/:name 的 name）：48 位数字+大小写字母组合，防随机遍历命中 */
  private makeFileId(): string {
    return CryptoService.fileId(48);
  }

  /**
   * 清洗外部传入的文件标识（S3 的 Object Key）。
   *   - 去掉协议头与查询串，去掉前导斜杠、`..` 等会破坏路由/越权的片段
   *   - 保留目录层级（/file/* 支持多级路径，如 `web/202610/ab.png`）
   */
  private sanitizeFileId(raw: string): string {
    let s = String(raw || '').trim();
    s = s.replace(/^https?:\/\/[^/]+/i, '');
    s = s.split('?')[0].split('#')[0];
    s = s
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    s = s.replace(/[\u0000-\u001f<>:"|*\\]/g, '_');
    return s.slice(0, 200);
  }

  /** 保证文件标识唯一：已存在时追加 `-1`、`-2`…（保留扩展名） */
  private async uniqueFileId(base: string): Promise<string> {
    const fallback = base || this.makeFileId();
    const ext = /\.[A-Za-z0-9]{1,8}$/.test(fallback) ? fallback.slice(fallback.lastIndexOf('.')) : '';
    const stem = ext ? fallback.slice(0, -ext.length) : fallback;
    for (let i = 0; i < 50; i += 1) {
      const candidate = i === 0 ? fallback : `${stem}-${i}${ext}`;
      const exists = await prisma.fileRecord.findFirst({
        where: { name: candidate },
        select: { id: true, name: true, status: true },
      });
      if (!exists) return candidate;
      /*
       * 名字被「回收站文件」占用 → 彻底删除它，把名字让给这次上传。
       * 典型场景：S3 客户端 DELETE（软删除进回收站）后重新 PUT 同名 key ——
       * 客户端拼的外链永远指向这个名字，不能因为回收站占用而变成 xxx-1。
       * 回收站那条的远端副本一并清理，不会留孤儿资源。
       */
      if (exists.status === 'deleted') {
        await this.removeFile(exists.id, exists.name);
        continue;
      }
    }
    return this.makeFileId();
  }

  /** 上传去重开关（后台「存储与分发设置」可开关） */
  private async dedupEnabled(): Promise<boolean> {
    try {
      return (await this.settings.get('dedupEnabled', 'false')) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * 去重范围（仅当去重开关打开时生效）：
   *   all     —— 全库范围内比较（默认）：任意渠道上已有相同内容即复用外链
   *   channel —— 仅在同一「渠道名称」内比较：先比渠道名，渠道名相同再比大小 + MD5
   */
  private async dedupScope(): Promise<'all' | 'channel'> {
    try {
      return (await this.settings.get('dedupScope', 'all')) === 'channel' ? 'channel' : 'all';
    } catch {
      return 'all';
    }
  }

  /** 流式计算文件 MD5（大文件不读进内存） */
  private hashFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('md5');
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk as Buffer));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 统一渠道写入：有 path 且适配器支持流式 → uploadFile；
   * 否则回退到整块 Buffer（并对超大文件设阈值，避免把进程撑爆）。
   */
  private async uploadToAdapter(
    adapter: StorageAdapter,
    file: UploadInput,
    key: string,
    info: ChannelInfo,
    owner?: string,
  ): Promise<{ remoteKey: string; remoteUrl?: string; metas?: Record<string, unknown> }> {
    if (file.path && typeof adapter.uploadFile === 'function') {
      return adapter.uploadFile(
        file.path,
        file.size || 0,
        { mime: file.mime, originalName: file.originalName },
        key,
        info,
        { owner },
      );
    }
    if (file.path) {
      const size = file.size || 0;
      if (size > STREAM_REQUIRED_BYTES) {
        throw new AdapterError(
          `渠道「${info.name || info.type}」不支持大文件流式写入，${Math.round(size / 1024 / 1024)}MB 超过直传安全阈值；请改用 S3 / 本地存储 / WebDAV 渠道`,
          info.type,
        );
      }
      const buffer = await fsp.readFile(file.path);
      return adapter.upload({ buffer, mime: file.mime, originalName: file.originalName }, key, info, { owner });
    }
    return adapter.upload({ buffer: file.buffer, mime: file.mime, originalName: file.originalName }, key, info, { owner });
  }

  /**
   * 服务端压缩（v2.3.0 起统一委托给 common/compress.ts）。
   * 保留这个薄封装是为了兼容历史调用点（内部已不再直接使用 sharp）。
   */
  private async compress(buffer: Buffer, mime: string, percent: number): Promise<{ buffer: Buffer; mime: string; ext: string }> {
    const ext = mime.split('/')[1] || '';
    const r = await compressMedia(buffer, mime, ext, percent);
    if (r.compressed) return { buffer: r.buffer, mime: r.mime || mime, ext: r.ext || `.${ext}` };
    return { buffer, mime, ext: ext ? `.${ext}` : '' };
  }

  /**
   * 「默认开启压缩」开关（后台 → 网页设置 → 默认开启压缩）。
   * 用于没有前端开关的上传入口（API Token / WebDAV）：前端上传页会显式传 serverCompress。
   */
  private async defaultServerCompress(): Promise<boolean> {
    try {
      const page: any = await this.sysConfig.get('page');
      const item = (page?.config || []).find((x: any) => x.id === 'defaultCustomerCompress');
      return item ? item.value === true || item.value === 'true' : true;
    } catch {
      return true;
    }
  }

  /**
   * 「视频兼容转码」开关（v2.8.4 引入；v2.8.5 起挂在后台 → 其他设置 → 上传相关配置）。
   * 只对浏览器播不了的编码（H.265/HEVC 等）转 H.264，与压缩开关相互独立 ——
   * 即使关闭压缩，华为等设备的 HEVC 视频也会被转码，解决「只有声音没画面」。
   */
  private async videoTranscodeEnabled(): Promise<boolean> {
    try {
      const page: any = await this.sysConfig.get('page');
      const item = (page?.config || []).find((x: any) => x.id === 'videoTranscodeIncompatible');
      // 未保存过时 value 可能是 undefined，此时回退到 default 字段（默认开）
      if (!item) return true;
      if (item.value === undefined || item.value === null || item.value === '') return item.default !== false;
      return item.value === true || item.value === 'true';
    } catch {
      return true;
    }
  }

  /**
   * 核心上传入口 —— 主渠道同步 → 建记录 → 备份渠道异步（低优先级，自动让路）。
   * 返回对外文件标识（/file/:id）。
   *
   * 注意：整段流程都计入 activeUploads，因此上传过程中触发的备份任务
   * 会一直等到本次（以及后续并发的）主渠道上传结束后才开始传输。
   */
  async upload(input: UploadInput, opts: UploadOptions): Promise<{ id: string; error?: string; dedup?: boolean; finalName?: string }> {
    this.activeUploads += 1;
    try {
      return await this.uploadInner(input, opts);
    } finally {
      this.activeUploads -= 1;
    }
  }

  private async uploadInner(input: UploadInput, opts: UploadOptions): Promise<{ id: string; error?: string; dedup?: boolean; finalName?: string }> {
    let { buffer, mime, originalName } = input;
    // v2.8.3：大文件走磁盘路径；small 文件仍是内存 Buffer。
    // size 统一在这里确定，后面所有限额/落库/备份都用它，避免 path/buffer 双份逻辑。
    let srcPath = input.path || '';
    let size = Number(input.size || 0);
    if (!size) {
      size = srcPath ? (await fsp.stat(srcPath)).size : buffer.length;
    }

    /*
     * 服务端校验：扩展名白名单 + 魔数 + 大小上限（客户端校验不可信）。
     * WebDAV 通道（opts.skipFileLimits）**完全跳过**这三项 —— 它的定位是
     * 「同步 / 备份型传输通道」，可能上传任意类型、任意体积的文件。
     */
    if (!opts.skipFileLimits) {
      const invalid = await this.validate(input, opts.limitsOverride);
      if (invalid) return { id: '', error: invalid };
    }

    // 初始（压缩前）大小：前端本地压缩后仍会带原始字节数上来；缺省时用实际大小
    const originalSize = opts.originalSize && opts.originalSize > 0 ? opts.originalSize : size;

    // MIME 归一化：以扩展名为准（curl 等会把 mp4/mp3 传成 application/octet-stream）
    mime = this.normalizeMime(originalName, mime);

    // IP 归属地用的请求 IP（后面所有日志都用它）
    const uploadIp = opts.ip || '';

    // 主渠道 / 备份渠道统一由 StorageChannelService 按优先级解析：
    //   本次请求显式指定 → API Token 配置 → 「用户管理」账户指定 → 后台「上传设置」全局渠道
    // （ignoreUploaderChannel：Web 通用 Token 分支跳过「账户指定」一级，见 UploadOptions）
    // v2.8.5：解析提前到压缩之前 —— 去重需要按渠道范围比对，早点拿到渠道避免白压一遍
    let main: StorageChannelInfo | null = null;
    try {
      main = await this.resolveMainChannel({
        channelId: opts.channelId,
        channelType: opts.uploadChannel,
        uploader: opts.ignoreUploaderChannel ? undefined : opts.uploader,
        tokenId: opts.tokenId,
      });
    } catch (err) {
      return { id: '', error: (err as Error).message };
    }
    if (!main) {
      const hint = opts.channelId
        ? `渠道 ID「${opts.channelId}」不存在或已禁用`
        : opts.uploadChannel
          ? `没有可用的「${opts.uploadChannel}」渠道，且未设置全局主渠道`
          : '未指定渠道，且「用户管理」「上传设置」里都没有可用的主渠道';
      return { id: '', error: `未配置可用的主渠道（${hint}），请先在后台「存储渠道」检查` };
    }

    /*
     * 去重（可开关）—— v2.8.5 重做，核心变化：
     *   1) MD5 与大小一律按「压缩前的原文件」计算，且在压缩之前就查库：
     *      命中直接返回已有外链，不再做图像审查 / 压缩 / 转码 / 上传，真正的秒传；
     *   2) 用原始大小比对，而不是压缩后大小 —— 同一份原文件在不同压缩档位下
     *      压出来的字节数并不稳定（JPEG 重编码、ffmpeg 转码都带浮动），
     *      拿压缩后的大小 + 压缩后的 MD5 去比，会出现「同一个文件却判不成重复」；
     *   3) 库里 md5 列从本版起统一存「原始文件内容 MD5」，所以原样上传的历史记录
     *      也能被命中；老记录里 originalSize 为 0 的，用 size 兜底比较。
     * 范围（dedupScope）：
     *   all     —— 全库比较（默认）
     *   channel —— 只在「同一渠道」内比较（按渠道 ID 比对；渠道名可变，不能作为匹配依据）
     */
    const md5 = srcPath ? await this.hashFile(srcPath) : createHash('md5').update(buffer).digest('hex');
    if (await this.dedupEnabled()) {
      const scope = await this.dedupScope();
      const dup = await prisma.fileRecord.findFirst({
        where: {
          status: 'active',
          md5,
          // 原始大小优先；老数据 originalSize 缺省为 0 时用 size 兜底（未压缩时两者相同）
          OR: [{ originalSize }, { size: originalSize }],
        },
        select: {
          name: true,
          originalName: true,
          copies: { select: { channelId: true, status: true, isPrimary: true } },
        },
      });
      let hit = dup;
      if (dup && scope === 'channel') {
        // 取该文件「主渠道」的渠道 ID 与本次目标渠道 ID 比对，不一致则视为不重复
        const primaryCopy = dup.copies.find((c) => c.isPrimary) || dup.copies[0];
        if (!primaryCopy || primaryCopy.channelId !== main.id) {
          hit = null;
          appLog.info(
            'upload',
            `去重跳过：${originalName} 与已有文件 ${dup.name} 内容相同，但渠道不同（去重范围为「仅同一渠道」）`,
            `目标渠道=${main.name} ｜ 已有文件渠道=${primaryCopy ? primaryCopy.channelId : '未知'}`,
            uploadIp,
          );
        }
      }
      if (hit) {
        appLog.info(
          'upload',
          `命中去重：${originalName} 与已有文件 ${hit.originalName}（${hit.name}）内容相同，复用已有外链`,
          `md5=${md5} ｜ 原始大小=${originalSize}B ｜ 范围=${scope === 'channel' ? `同渠道（${main.name}）` : '全部渠道'}`,
          uploadIp,
        );
        return { id: hit.name, dedup: true, finalName: originalName };
      }
    }

    /*
     * 图像审查（可开关；接口异常时放行）。
     * 大文件（>64MB 的图片极罕见）跳过：审查接口要求整图上传，读进内存不划算。
     */
    if (mime.startsWith('image/') && size <= 64 * 1024 * 1024) {
      const reviewBuffer = buffer.length ? buffer : await fsp.readFile(srcPath);
      const rejected = await this.moderate(reviewBuffer, mime);
      if (rejected) return { id: '', error: rejected };
    }

    // IP 归属地（可开关）：主链路只读缓存，未命中则落库后异步补写 ——
    // 归属地查询是外部网络请求（最长 6 秒），绝不能挡在上传主链路上。
    const uploadAddress = await this.cachedAddress(uploadIp);

    /*
     * 压缩（v2.3.0）：
     *   · 覆盖图片 / 视频 / 音频，具体能不能压、压成什么格式统一由 common/compress.ts 判定
     *     （gif 会丢帧、png 必须保透明、没有 ffmpeg 就跳过视频音频 …… 都在那里处理）；
     *   · 开关优先级：本次请求显式传入（前端上传设置） > 后台「网页设置 → 默认开启压缩」；
     *     API Token / WebDAV 这类"没有前端开关"的入口因此也会跟随后台默认值；
     *   · 压缩失败 / 压不动 → 原文件照常上传（需求明确要求"跳过压缩直接上传"）。
     * v2.8.3：大文件走 compressFile（输入/输出都是磁盘路径，不再整份读内存）。
     * v2.8.4：新增「视频兼容转码」—— 与压缩开关独立，只对浏览器播不了的编码
     *   （H.265/HEVC 等，华为手机默认录像编码）转 H.264，解决「只有声音没画面」。
     */
    const wantCompress = opts.serverCompress ?? (await this.defaultServerCompress());
    const wantTranscode = await this.videoTranscodeEnabled();
    const isVideo = (mime || '').startsWith('video/');
    if (wantCompress || (wantTranscode && isVideo)) {
      const srcExt = originalName.includes('.') ? String(originalName.split('.').pop() || '') : '';
      const pct =
        opts.compressPercent && opts.compressPercent > 0 ? opts.compressPercent : await this.defaultCompressPercent();
      // 超大文件不压缩：sharp/ffmpeg 都要把内容整体读进内存，几百 MB 的视频会把进程拖垮
      if (size > COMPRESS_MAX_BYTES) {
        console.log(`[upload] 跳过压缩：文件 ${(size / 1024 / 1024).toFixed(1)}MB 超过压缩上限`);
      } else if (srcPath) {
        const r = await compressFile(srcPath, mime, srcExt, pct, { videoTranscode: wantTranscode, videoCompress: wantCompress === true });
        if (r.compressed) {
          srcPath = r.path;
          size = r.size;
          mime = r.mime || mime;
          if (r.ext) originalName = originalName.replace(/\.[^.]+$/, '') + r.ext;
          appLog.info(
            'upload',
            `已压缩（流式）：${originalSize}B → ${size}B（${Math.round((1 - size / Math.max(1, originalSize)) * 100)}%）`,
            `${originalName} ｜ 期望 ${pct}%`,
            uploadIp,
          );
        } else if (r.reason) {
          appLog.info('upload', `跳过压缩：${r.reason}`, originalName, uploadIp);
        }
      } else {
        const r = await compressMedia(buffer, mime, srcExt, pct, { videoTranscode: wantTranscode, videoCompress: wantCompress === true });
        if (r.compressed) {
          const before = buffer.length;
          buffer = r.buffer;
          size = buffer.length;
          mime = r.mime || mime;
          if (r.ext) originalName = originalName.replace(/\.[^.]+$/, '') + r.ext;
          appLog.info(
            'upload',
            `已压缩：${before}B → ${buffer.length}B（${Math.round((1 - buffer.length / before) * 100)}%）`,
            `${originalName} ｜ 期望 ${pct}%`,
            uploadIp,
          );
        } else if (r.reason) {
          appLog.info('upload', `跳过压缩：${r.reason}`, originalName, uploadIp);
        }
      }
    }

    // 尺寸（图片走 sharp）：详情页「图片尺寸」一直显示「无」就是因为这里从来没写过 metas.Width/Height。
    // 放在压缩之后读，拿到的是最终文件的真实尺寸。
    const dims = srcPath
      ? await readDimensionsFile(srcPath, mime, mime.split('/')[1] || '')
      : await readDimensions(buffer, mime, mime.split('/')[1] || '');

    const folder = await this.resolveFolder(opts.uploadFolder);
    const key = this.makeKeyFor(main, originalName, opts.uploadNameType, md5);

    /*
     * 主渠道上传失败后的切换链：
     *   1) 「更多 → 设为备用库」标记的渠道（backupPool=true）组成备用库池，
     *      按轮转游标依次尝试 —— 每次上传把起点后移一位，避免总压在同一个备用库上；
     *   2) 池为空且调用方允许自动切换时，退回历史行为（全部启用渠道按 code 升序）。
     * 备份渠道（isBackup）不参与切换：备份失败只记日志，绝不反复重传。
     */
    const chain: StorageChannelInfo[] = [main];
    if (opts.autoRetry) {
      const pool = await prisma.channel.findMany({
        where: { enabled: true, backupPool: true, NOT: { id: main.id } },
        orderBy: { code: 'asc' },
      });
      if (pool.length) {
        const start = this.poolCursor++ % pool.length;
        const rotated = [...pool.slice(start), ...pool.slice(0, start)];
        for (const c of rotated) {
          chain.push({ id: c.id, code: c.code, name: c.name, type: c.type, config: c.config });
        }
      } else {
        const others = await prisma.channel.findMany({
          where: { enabled: true, NOT: { id: main.id } },
          orderBy: { code: 'asc' },
        });
        chain.push(...others);
      }
    }

    const startedAt = Date.now();
    let result: { remoteKey: string; remoteUrl?: string } | undefined;
    let usedChannel = main;
    let lastErr = '';
    for (const ch of chain) {
      if (ch.id !== main.id && !(await this.channelWritable(ch))) continue;
      try {
        const info = this.toChannelInfo(ch);
        result = await this.uploadToAdapter(createAdapter(info), {
          buffer,
          path: srcPath,
          size,
          mime,
          originalName,
        }, key, info, opts.uploader);
        usedChannel = ch;
        break;
      } catch (err) {
        lastErr = (err as Error).message || String(err);
        // 关键：渠道报错必须回传给前端（否则界面只有「上传失败」没有原因），
        // 同时写一条结构化日志，便于在后台「系统日志」里排查。
        appLog.warn(
          'upload',
          `渠道上传失败：${ch.name}（${ch.type}）${opts.autoRetry ? '，尝试自动切换下一个渠道' : ''}`,
          `${lastErr} ｜ key=${key} ｜ 大小=${size}B ｜ 文件=${originalName}`,
          uploadIp,
        );
      }
    }
    if (!result) {
      return {
        id: '',
        error: opts.autoRetry
          ? `所有可用渠道均上传失败（最后错误：${lastErr}）`
          : `存储渠道「${main.name}」上传失败：${lastErr}`,
      };
    }
    if (usedChannel.id !== main.id) {
      appLog.info('upload', `自动切换成功：${main.name} → ${usedChannel.name}（${usedChannel.type}）`, `key=${key}`, uploadIp);
    }
    appLog.info(
      'upload',
      `上传成功：${usedChannel.name}（${usedChannel.type}）`,
      `${key} ｜ ${size}B ｜ 耗时 ${Date.now() - startedAt}ms ｜ 文件=${originalName}`,
      uploadIp,
    );

    // 文件对外标识（/file/<name>）：
    //   默认用系统生成的随机 ID；S3 协议场景用客户端上传时的 Object Key，
    //   这样客户端用「自定义域名 + key」自行拼出的地址恰好就是本站的签发链接。
    const fileId = opts.presetFileId
      ? await this.uniqueFileId(this.sanitizeFileId(opts.presetFileId))
      : this.makeFileId();
    const record = await prisma.fileRecord.create({
      data: {
        name: fileId,
        // 重命名历史：第一次的名字先写进来，之后重命名只更新 prevName（v2.3.0）
        firstName: fileId,
        prevName: '',
        originalName,
        size,
        originalSize,
        mime,
        md5,
        folder, // 逻辑分类（无指定目录时按 年份/月份 自动创建）
        uploader: opts.uploader || '',
        // 上传渠道（Default / WebDAV / API-S3 / API-Web）—— 后台文件详情里展示
        uploadSource: normalizeUploadSource(opts.uploadSource),
        ip: uploadIp,
        // 上传计时：开始（请求到达 / 第一片 init）→ 完成（记录落库），详情页据此算时长与速度
        uploadStartedAt: opts.uploadStartedAt || new Date(startedAt),
        uploadFinishedAt: new Date(),
        // metas 里带上归属地 + 真实尺寸（详情页「图片尺寸」读的就是这里）
        metas: JSON.stringify({
          UploadAddress: uploadAddress,
          ...(dims.width && dims.height ? { Width: dims.width, Height: dims.height } : {}),
        }),
        // 主渠道副本与文件记录一次写入（嵌套 create = 同一事务），少一次往返
        // isPrimary 补记（v1.8.0：此前只靠「第一条副本即主副本」的隐式约定，字段一直是 false）
        copies: {
          create: {
            channelId: usedChannel.id,
            remoteKey: result.remoteKey,
            remoteUrl: result.remoteUrl || '',
            status: 'active',
            isPrimary: true,
          },
        },
      },
    });

    /*
     * 以下三项都是「不影响上传结果」的收尾工作，全部丢到后台队列串行执行：
     *   1) IP 上传计数（用户管理按 IP 汇总）
     *   2) 归属地补写（缓存未命中时才会真的请求外部 API）
     *   3) 自动打标签（文件类型 / 扩展名 / 渠道简称 / 上传渠道 / 年份）
     * 上传响应立刻返回，不再等这些毫秒级甚至秒级的收尾动作。
     */
    this.enqueueBackground(() => this.touchIp(uploadIp, uploadAddress));
    if (uploadIp && !uploadAddress) {
      this.enqueueBackground(async () => {
        const addr = await this.resolveAddress(uploadIp);
        if (!addr) return;
        // 用最新的 metas 合并写回，避免覆盖期间其它字段的改动
        const cur = await prisma.fileRecord.findUnique({ where: { id: record.id }, select: { metas: true } });
        if (!cur) return;
        let metas: Record<string, unknown> = {};
        try {
          metas = JSON.parse(cur.metas || '{}');
        } catch {
          metas = {};
        }
        await prisma.fileRecord.update({
          where: { id: record.id },
          data: { metas: JSON.stringify({ ...metas, UploadAddress: addr }) },
        });
        await this.touchIp(uploadIp, addr);
      });
    }
    this.enqueueBackground(() =>
      this.autoTag(record.id, {
        originalName,
        mime,
        channelType: usedChannel.type,
        uploadSource: opts.uploadSource,
      }),
    );

    // 备份渠道异步上传：进入「低优先级队列」—— 不阻塞响应，且在主渠道上传期间让路，
    // 保证上传速度优先；失败标 failed，可后台补备份。
    // 前端「上传设置 → 是否备份」关闭（opts.backup === false）时跳过本次备份；
    // 备份渠道与本次实际使用的主渠道 ID 相同时也不备份。
    // 备份渠道统一由 StorageChannelService 解析：
    //   调用方显式指定（API 的 backup 参数）→ Token 配置 → 账户指定 → 全局备份渠道
    // 解析本身（查开关 + 查渠道）也放到后台队列执行，响应路径上不再多两次数据库查询。
    if (opts.backup !== false) {
      const payload: UploadInput = { buffer, path: srcPath, size, mime, originalName };
      this.enqueueBackground(async () => {
        if (!(await this.backupEnabled())) return;
        const backup = await this.resolveBackupChannel({
          explicitId: opts.backupChannelId,
          uploader: opts.ignoreUploaderChannel ? undefined : opts.uploader,
          tokenId: opts.tokenId,
        });
        if (!backup || backup.id === usedChannel.id) return;
        await this.enqueueLowPriority(async () => {
          await this.backupUpload(record.id, payload, key, backup, opts.uploader);
        });
      });
    }

    return { id: fileId, finalName: originalName };
  }

  private async backupUpload(
    fileId: string,
    file: UploadInput,
    key: string,
    backup: { id: string; name: string; type: string; config: string },
    owner?: string,
  ) {
    await prisma.fileCopy.upsert({
      where: { fileId_channelId: { fileId, channelId: backup.id } },
      update: { status: 'pending' },
      create: { fileId, channelId: backup.id, remoteKey: '', remoteUrl: '', status: 'pending' },
    });
    try {
      const info = this.toChannelInfo(backup);
      const adapter = createAdapter(info);
      const t0 = Date.now();
      const result = await this.uploadToAdapter(adapter, file, key, info, owner);
      await prisma.fileCopy.update({
        where: { fileId_channelId: { fileId, channelId: backup.id } },
        data: { remoteKey: result.remoteKey, remoteUrl: result.remoteUrl || '', status: 'active' },
      });
      appLog.info(
        'backup',
        `备份完成：${backup.name}（${backup.type}）`,
        `${key} ｜ ${file.size || file.buffer.length}B ｜ 耗时 ${Date.now() - t0}ms（低优先级，主渠道上传期间自动让路）`,
      );
    } catch (err) {
      appLog.error('backup', `备份渠道写入失败：${backup.name}（${backup.type}）`, `${(err as Error).message} ｜ key=${key}`);
      await prisma.fileCopy.update({
        where: { fileId_channelId: { fileId, channelId: backup.id } },
        data: { status: 'failed', metas: JSON.stringify({ error: (err as Error).message }) },
      });
    }
  }

  /**
   * 批量补备份（管理后台工具 / 文件管理「一键备份所有文件」批量操作）。
   * 入参既接受文件主键 id，也接受对外 File_ID（name）—— 前端文件列表里只有 name。
   * 已有备份的文件跳过并计入 skipped。
   */
  async rebackup(fileIds: string[]): Promise<{ ok: number; fail: number; skipped: number; total: number }> {
    let ok = 0;
    let fail = 0;
    let skipped = 0;
    const keys = (fileIds || []).filter(Boolean);
    const records = await prisma.fileRecord.findMany({
      where: { OR: [{ id: { in: keys } }, { name: { in: keys } }] },
      include: { copies: true },
    });
    // 备份渠道按「文件所属用户」解析 —— 用户管理里为该账户指定了备份渠道就用它，
    // 没指定则回退到后台「上传设置」里的全局备份渠道。
    const cache = new Map<string, StorageChannelInfo | null>();
    const backupFor = async (uploader?: string) => {
      const k = String(uploader || '');
      if (!cache.has(k)) cache.set(k, await this.resolveBackupChannel({ uploader: k || undefined }));
      return cache.get(k) ?? null;
    };
    for (const rec of records) {
      const backup = await backupFor(rec.uploader);
      if (!backup) {
        fail += 1;
        continue;
      }
      // 低优先级：等主渠道上传空闲后才拉取 + 写入，避免影响上传速度
      const outcome = await this.enqueueLowPriority<'ok' | 'fail' | 'skipped'>(async () => {
        if (!rec.copies.some((c) => c.status === 'active' && c.remoteKey)) return 'fail';
        // 已在备份渠道有 active 副本 → 跳过（不计入成功）
        if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active')) return 'skipped';
        try {
          await this.backupSingleFromMain(rec, backup);
          return 'ok';
        } catch (err) {
          console.error('[rebackup] 补备份失败:', rec.name, (err as Error).message);
          return 'fail';
        }
      });
      if (outcome === 'ok') ok += 1;
      else if (outcome === 'skipped') skipped += 1;
      else fail += 1;
    }
    return { ok, fail, skipped, total: records.length };
  }

  /**
   * 删除文件：先清「各渠道远端副本」，再删库记录（copies 随级联删除）。
   *
   * 供「文件管理 → 删除」与「S3 协议 DELETE /s3/<bucket>/<key>」共用 ——
   * 早期这段逻辑只写在 ManageController 的私有方法里，S3 通道无法复用，
   * 第三方客户端（插件 / 脚本）的删除请求永远失败。
   *
   * 远端删除失败**不阻断**流程（只记日志后继续删库）：否则残留记录会长期挂在
   * 文件列表里、点开却是死链，比"远端多留一个孤儿对象"更糟。
   */
  /**
   * 软删除：标记进回收站（status='deleted' + deletedAt），**不动任何远端副本**。
   * 恢复（restoreFile）即原样回到正常列表；只有回收站里的「彻底删除」才走 removeFile。
   */
  async softDeleteFile(id: string, name = ''): Promise<void> {
    await prisma.fileRecord.update({
      where: { id },
      data: { status: 'deleted', deletedAt: new Date() },
    });
    appLog.info('upload', `移入回收站：${name || id}`);
  }

  /** 从回收站恢复：清掉标记，远端副本从未被删，无需任何补偿动作 */
  async restoreFile(id: string, name = ''): Promise<void> {
    await prisma.fileRecord.update({
      where: { id },
      data: { status: 'active', deletedAt: null },
    });
    appLog.info('upload', `从回收站恢复：${name || id}`);
  }

  /**
   * 彻底删除：先删各渠道远端副本（远端失败不阻断，但记录日志），再删库记录。
   * 入口：回收站里的「彻底删除」。
   *
   * 实现已收敛到这一处 —— 与「S3 协议 DELETE /s3/<bucket>/<key>」
   * 通道共用同一套逻辑，避免两处实现各自漂移（早前 S3 通道就是因为拿不到这段逻辑，
   * 删除请求一律 404，第三方插件只能"传得上、删不掉"）。
   */
  async removeFile(id: string, name = ''): Promise<void> {
    const copies = await prisma.fileCopy.findMany({ where: { fileId: id } });
    for (const copy of copies) {
      const ch = await prisma.channel.findUnique({ where: { id: copy.channelId } });
      if (!ch) continue;
      try {
        const info: ChannelInfo = {
          id: ch.id,
          name: ch.name,
          type: ch.type,
          config: this.channels.decryptConfig(ch.type, ch.config),
          metas: {},
        };
        await createAdapter(info).delete(toCopyInfo(copy), info);
      } catch (err) {
        appLog.warn('upload', `远端删除失败（继续删库）${name || id}`, (err as Error).message);
      }
    }
    await prisma.fileRecord.delete({ where: { id } });
    appLog.info('upload', `删除文件：${name || id}`, `远端副本 ${copies.length} 个`);
  }

  /** 一键备份任务状态（内存态，服务重启即清零） */
  private backupAllJob: {
    running: boolean; total: number; done: number; ok: number; fail: number; startedAt: number; finishedAt: number;
  } | null = null;

  /**
   * 一键备份所有文件：找出「当前备份渠道上没有 active 副本」的文件，
   * 放入后台队列逐个补备份；已有备份的文件自动跳过。
   */
  startBackupAll(): { started: boolean; message?: string } {
    if (this.backupAllJob?.running) {
      return { started: false, message: '已有备份任务在进行中，请稍候' };
    }
    this.backupAllJob = { running: true, total: 0, done: 0, ok: 0, fail: 0, startedAt: Date.now(), finishedAt: 0 };
    void this.runBackupAll().catch((err) => {
      appLog.error('backup', `一键备份任务异常终止：${(err as Error).message}`);
      if (this.backupAllJob) {
        this.backupAllJob.running = false;
        this.backupAllJob.finishedAt = Date.now();
      }
    });
    return { started: true };
  }

  backupAllStatus() {
    return this.backupAllJob || { running: false, total: 0, done: 0, ok: 0, fail: 0, startedAt: 0, finishedAt: 0 };
  }

  private async runBackupAll() {
    const job = this.backupAllJob!;
    const records = await prisma.fileRecord.findMany({
      where: { status: 'active' },
      include: { copies: true },
      orderBy: { createdAt: 'desc' },
    });
    // 备份渠道按「文件所属用户」分别解析：
    //   用户管理里为该账户指定了备份渠道 → 用指定渠道；
    //   未指定 → 后台「上传设置」里的全局备份渠道。
    const cache = new Map<string, StorageChannelInfo | null>();
    const backupFor = async (uploader?: string) => {
      const k = String(uploader || '');
      if (!cache.has(k)) cache.set(k, await this.resolveBackupChannel({ uploader: k || undefined }));
      return cache.get(k) ?? null;
    };
    const pending: { rec: (typeof records)[number]; backup: StorageChannelInfo }[] = [];
    for (const rec of records) {
      const backup = await backupFor(rec.uploader);
      if (!backup) continue; // 该文件没有可用备份渠道，跳过
      if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active')) continue; // 已有备份
      pending.push({ rec, backup });
    }
    job.total = pending.length;
    if (!pending.length) {
      appLog.info('backup', '一键备份：所有文件均已有备份，无需处理');
      job.running = false;
      job.finishedAt = Date.now();
      return;
    }
    appLog.info('backup', `一键备份开始：共 ${pending.length} 个文件待备份`);
    for (const { rec, backup } of pending) {
      // 低优先级：逐个让路 —— 主渠道有上传任务时先让上传跑完，再补备份
      const okOne = await this.enqueueLowPriority(async () => {
        try {
          await this.backupSingleFromMain(rec, backup);
          return true;
        } catch (err) {
          appLog.error('backup', `一键备份失败：${rec.name}（${rec.originalName}）`, (err as Error).message);
          return false;
        }
      });
      if (okOne) job.ok += 1;
      else job.fail += 1;
      job.done += 1;
    }
    job.running = false;
    job.finishedAt = Date.now();
    appLog.info('backup', `一键备份完成：成功 ${job.ok}，失败 ${job.fail}，共 ${job.total}`);
  }

  /** 从主渠道副本拉回原文件并写入备份渠道 */
  private async backupSingleFromMain(
    rec: {
      id: string; name: string; mime: string; originalName: string;
      copies: { channelId: string; remoteKey: string; remoteUrl: string; status: string }[];
    },
    backup: { id: string; name: string; type: string; config: string },
  ) {
    if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active')) return; // 已有备份
    const mainCopy = rec.copies.find((c) => c.status === 'active' && c.remoteKey);
    if (!mainCopy) throw new Error('没有可用的主渠道副本');
    const mainCh = await prisma.channel.findUnique({ where: { id: mainCopy.channelId } });
    if (!mainCh) throw new Error('主渠道记录不存在');
    const mainInfo = this.toChannelInfo(mainCh);
    const mainAdapter = createAdapter(mainInfo);

    /*
     * 取源文件字节：
     *   普通渠道 → 用直链 HTTP 拉取；
     *   本地渠道 → 没有直链（buildDirectUrl 恒为 null），直接读磁盘。
     * 早期实现只走 HTTP，导致「主渠道是本地存储」时备份功能直接报「无法构造直链」。
     */
    let buf: Buffer;
    if (mainCh.type === 'local') {
      const abs = localFileAbs(mainCopy.remoteKey);
      if (!abs) throw new Error('本地文件不存在，无法备份');
      buf = await fsp.readFile(abs);
    } else {
      const url = mainAdapter.buildDirectUrl(toCopyInfo(mainCopy), mainInfo);
      if (!url) throw new Error('无法构造主渠道直链');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`源文件拉取失败 HTTP ${resp.status}`);
      buf = Buffer.from(await resp.arrayBuffer());
    }
    const info = this.toChannelInfo(backup);
    const adapter = createAdapter(info);
    const result = await adapter.upload(
      { buffer: buf, mime: rec.mime, originalName: rec.originalName },
      mainCopy.remoteKey,
      info,
    );
    await prisma.fileCopy.upsert({
      where: { fileId_channelId: { fileId: rec.id, channelId: backup.id } },
      update: { remoteKey: result.remoteKey, remoteUrl: result.remoteUrl || '', status: 'active' },
      create: { fileId: rec.id, channelId: backup.id, remoteKey: result.remoteKey, remoteUrl: result.remoteUrl || '', status: 'active' },
    });
  }
}
