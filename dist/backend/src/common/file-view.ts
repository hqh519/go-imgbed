/**
 * 文件视图工具 —— 把 go-imgbed 的 FileRecord 序列化为前端（Sanyue-ImgHub）
 * 期望的 `{ name, metadata }` 结构。
 *
 * 说明：metadata 的字段名与原系统（CloudFlare-ImgBed）严格保持一致，
 * 前端管理页 / 上传页 / 批量操作均依赖这些字段名，改动会导致页面失效。
 */
import type { Channel, FileCopy, FileRecord } from '@prisma/client';

export type FileTypeName = 'image' | 'video' | 'audio' | 'other';

/**
 * 「上传渠道」—— 文件是从哪个入口传上来的（落库 FileRecord.uploadSource）。
 * 后台文件详情的「上传用户」后面会显示这个值。
 *   Default —— go-imgbed 前端上传页
 *   WebDAV  —— 对外 WebDAV
 *   API-Web —— API Token 的「Web 通用」通道
 *   API-S3  —— API Token 的「S3 协议」通道
 */
export const UPLOAD_SOURCES = ['Default', 'WebDAV', 'API-Web', 'API-S3'] as const;

/** 归一化上传渠道值：空值/未知值一律按 Default（历史数据的文件都是前端上传页传的） */
export function normalizeUploadSource(raw?: string | null): string {
  const v = String(raw || '').trim();
  return (UPLOAD_SOURCES as readonly string[]).includes(v) ? v : 'Default';
}

/**
 * 上传计时派生字段（文件详情 →「上传时长 / 上传速度」）：
 *   UploadStartedAt / UploadFinishedAt —— ISO 字符串（空串 = 无记录）
 *   UploadDurationMs                   —— 毫秒（0 = 无记录）
 *   UploadSpeedMBps                    —— MB/s，按「当前文件体积 ÷ 耗时」计算，保留两位小数
 * 1.9.1 之前的记录没有这两列，统一返回 0/''，前端显示「未知」。
 */
export function buildUploadTiming(rec: {
  uploadStartedAt?: Date | null;
  uploadFinishedAt?: Date | null;
  size?: number;
}): Record<string, unknown> {
  const start = rec.uploadStartedAt ? new Date(rec.uploadStartedAt).getTime() : 0;
  const end = rec.uploadFinishedAt ? new Date(rec.uploadFinishedAt).getTime() : 0;
  const dur = start && end && end >= start ? end - start : 0;
  const bytes = Number(rec.size) || 0;
  const speed = dur > 0 && bytes > 0 ? bytes / (dur / 1000) / 1024 / 1024 : 0;
  return {
    UploadStartedAt: start ? new Date(start).toISOString() : '',
    UploadFinishedAt: end ? new Date(end).toISOString() : '',
    UploadDurationMs: dur,
    UploadSpeedMBps: speed ? Number(speed.toFixed(2)) : 0,
  };
}

/** 渠道类型 → 前端展示名（metadata.Channel） */
export const CHANNEL_LABEL: Record<string, string> = {
  cos: 'Tencent',
  minio: 'MinIO',
  r2: 'R2',
  s3: 'S3',
  aliyun: 'Aliyun',
  easyimages: 'Easy',
  lsky: 'Lsky',
  webdav: 'WebDAV',
  immich: 'Immich',
  custom: 'External',
  local: 'Local',
};

/**
 * 渠道类型 → 简称（全站唯一来源）。
 *   腾讯云 COS = COS ｜ 阿里云 OSS = ALI ｜ 简单图床 = EI ｜ 兰空图床 = LS
 *   Immich = IM ｜ MinIO = MI ｜ R2 = R2 ｜ S3 = S3 ｜ WebDAV = WD ｜ 自定义 Web = DIY
 *   本地存储 = LOCAL
 * 文件管理卡片左上角角标、上传后自动标签、元数据 ChannelShort 均调用 channelShort()，
 * 新增渠道类型只需在这里加一行。
 */
export const CHANNEL_SHORT: Record<string, string> = {
  easyimages: 'EI',
  lsky: 'LS',
  cos: 'COS',
  aliyun: 'ALI',
  immich: 'IM',
  minio: 'MI',
  r2: 'R2',
  s3: 'S3',
  webdav: 'WD',
  custom: 'DIY',
  local: 'LCL',
};

/**
 * 取某个渠道类型的简称。入参可以是类型（cos）或展示名（Tencent），
 * 兼容历史数据里直接存展示名的情况；未知类型原样大写返回（最多 4 位）。
 */
export function channelShort(typeOrLabel?: string | null): string {
  const raw = String(typeOrLabel || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  if (CHANNEL_SHORT[key]) return CHANNEL_SHORT[key];
  // 展示名反查：Tencent → COS、Easy → EI、External → DIY …
  const byLabel = Object.keys(CHANNEL_LABEL).find((t) => CHANNEL_LABEL[t].toLowerCase() === key);
  if (byLabel && CHANNEL_SHORT[byLabel]) return CHANNEL_SHORT[byLabel];
  return raw.slice(0, 4).toUpperCase();
}

export function fileTypeOf(mime: string): FileTypeName {
  if (!mime) return 'other';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'other';
}

/**
 * 从原始文件名取扩展名（小写、不带点）。
 * 优先 originalName；它缺失时用 MIME 反查；再无则空串。
 * 用于「文件类型」列展示成 `image / jpeg`，以及外链末尾补扩展名。
 */
export function fileExtOf(originalName: string, mime?: string): string {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(originalName || ''));
  if (m) return m[1].toLowerCase();
  const sub = String(mime || '').split('/')[1] || '';
  const cleaned = sub.split(';')[0].replace(/^x-/, '').trim().toLowerCase();
  if (!cleaned) return '';
  return cleaned === 'jpeg' ? 'jpg' : cleaned;
}

/** 标识末尾是否已带扩展名（如 abc.png、2026/10/ab.webp） */
export function hasFileExt(id: string): boolean {
  return /\.[A-Za-z0-9]{1,12}$/.test(String(id || ''));
}

/**
 * 生成对外链接末尾【应当追加】的扩展名后缀（含点；不需要追加时返回空串）。
 *
 * 规则：链接里已经有扩展名 → 一律不再追加（避免出现 `abc.png.jpg` 这种重复标识）；
 *       没有扩展名 → 追加原文件的扩展名，仅作「直观展示文件类型」用。
 * 后端按「去掉最后一段扩展名」查库，所以带不带扩展名都能正常访问。
 */
export function extSuffixFor(id: string, originalName: string): string {
  if (hasFileExt(id)) return '';
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(originalName || ''));
  return m ? `.${m[1].toLowerCase()}` : '';
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${i === 0 ? n : n.toFixed(2)} ${units[i]}`;
}

/** 安全解析 JSON 字符串，失败返回 {} */
export function safeParse(raw?: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface DirectoryTreeNode {
  name: string;
  path: string;
  children: DirectoryTreeNode[];
}

/**
 * 扁平目录列表 → 嵌套树（对齐原系统 /api/directoryTree 的响应结构）。
 * 输入 ['photos/', 'photos/2024/'] →
 * { name:'/', path:'', children:[{ name:'photos', path:'photos/', children:[…] }] }
 */
export function buildDirectoryTree(directories: string[]): DirectoryTreeNode {
  const root: DirectoryTreeNode = { name: '/', path: '', children: [] };
  const nodeMap = new Map<string, DirectoryTreeNode>([['', root]]);
  for (const dirPath of [...directories].sort()) {
    if (!dirPath) continue;
    const normalized = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    const parts = normalized.split('/').filter(Boolean);
    let currentPath = '';
    let parent = root;
    for (const part of parts) {
      currentPath += `${part}/`;
      const existing = nodeMap.get(currentPath);
      if (existing) {
        parent = existing;
        continue;
      }
      const node: DirectoryTreeNode = { name: part, path: currentPath, children: [] };
      parent.children.push(node);
      nodeMap.set(currentPath, node);
      parent = node;
    }
  }
  const sortChildren = (node: DirectoryTreeNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sortChildren);
  };
  sortChildren(root);
  return root;
}

export type CopyWithChannel = FileCopy & { channel?: Channel | null };

export interface SerializeOptions {
  tags?: string[];
  /**
   * 可选：为某个渠道副本解析「该渠道内的真实直链」（S3 对象地址 / WebDAV 地址 …）。
   * 由控制器注入（需要适配器），file-view 本身不依赖 adapters 以免循环依赖。
   * 返回 null/空串表示无法构造（前端会回退到本站代理地址）。
   */
  resolveDirectUrl?: (copy: CopyWithChannel) => string | null;
}

/**
 * 构造前端可展示的 metadata。
 * 关键：所有派生字段（渠道名、目录、标签、尺寸）都在序列化时从当前配置实时计算，
 * 不依赖落库的快照值 —— 这样改渠道配置 / 改文件名，列表刷新后立即反映。
 */
export function buildMetadata(
  rec: FileRecord,
  copies: CopyWithChannel[],
  opts: SerializeOptions = {},
): Record<string, unknown> {
  const metas = safeParse(rec.metas);
  const primary = copies.find((c) => c.channel?.isMain) || copies[0];
  const channelLabel = primary?.channel ? CHANNEL_LABEL[primary.channel.type] || primary.channel.type : '';

  // 备份渠道列表：除主渠道外、处于 active 状态的其余副本所在渠道
  const backupChannels = copies
    .filter((c) => c !== primary && c.status === 'active' && c.channel)
    .map((c) => ({
      id: c.channelId,
      code: c.channel!.code || '',
      type: c.channel!.type,
      label: CHANNEL_LABEL[c.channel!.type] || c.channel!.type,
      // 简称（DIY / EI / LS / COS / ALI / IM / MI / R2 / S3 / WD）—— 文件管理卡片角标用
      short: channelShort(c.channel!.type),
      name: c.channel!.name,
      // 该副本在备份渠道内的真实直链（如 WebDAV 上的真实地址）
      url: (opts.resolveDirectUrl ? opts.resolveDirectUrl(c) : '') || '',
    }));

  // 主渠道（存储渠道）副本在渠道内的真实直链
  const storageUrl = (primary && opts.resolveDirectUrl ? opts.resolveDirectUrl(primary) : '') || '';

  // 初始大小（压缩前）：未记录或与当前大小相同时，回退为当前大小
  const size = Number(rec.size) || 0;
  const rawOriginalSize = Number((rec as unknown as { originalSize?: number }).originalSize) || 0;
  const originalSize = rawOriginalSize > 0 ? rawOriginalSize : size;

  const meta: Record<string, unknown> = {
    FileName: rec.originalName,
    // 重命名历史（v2.3.0）：详情页重命名对话框用它们提供「恢复初始名 / 恢复上一次」
    FileFirstName: (rec as unknown as { firstName?: string }).firstName || rec.name,
    FilePrevName: (rec as unknown as { prevName?: string }).prevName || '',
    FileType: fileTypeOf(rec.mime),
    FileExt: fileExtOf(rec.originalName, rec.mime),
    FileSize: formatSize(size),
    FileSizeBytes: size,
    // 初始（压缩前）大小：与当前大小不同时前端展示成 `初始 / 当前`
    FileSizeOriginal: formatSize(originalSize),
    FileSizeOriginalBytes: originalSize,
    MD5: (rec as unknown as { md5?: string }).md5 || '',
    Views: (rec as unknown as { views?: number }).views || 0,
    UploadIP: rec.ip || '',
    UploadAddress: (metas.UploadAddress as string) || '',
    // 上传者账户（用户账户体系：文件详情「上传用户」/ 排序 / 归集）
    UploadUser: (rec as unknown as { uploader?: string }).uploader || '',
    // 上传渠道：Default / WebDAV / API-Web / API-S3（文件详情「上传用户」后面展示）
    UploadSource: normalizeUploadSource((rec as unknown as { uploadSource?: string }).uploadSource),
    // 上传计时：详情页「上传时长 / 上传速度」；历史数据没有这两列 → 0，前端显示「未知」
    ...buildUploadTiming(rec as unknown as { uploadStartedAt?: Date | null; uploadFinishedAt?: Date | null; size?: number }),    // 重定向地址（非空时 /file/:name 会 302 到该地址）
    RedirectUrl: (rec as unknown as { redirectUrl?: string }).redirectUrl || '',
    // 限时访问截止时间（毫秒时间戳；0 = 永久有效）
    LinkExpiresAt: (rec as unknown as { linkExpiresAt?: Date | null }).linkExpiresAt
      ? (rec as unknown as { linkExpiresAt: Date }).linkExpiresAt.getTime()
      : 0,
    ListType: (metas.ListType as string) || 'None',
    TimeStamp: rec.createdAt.getTime(),
    Label: (metas.Label as string) || 'None',
    Directory: rec.folder ? `${rec.folder.replace(/\/+$/, '')}/` : '',
    Tags: opts.tags || (metas.Tags as string[]) || [],
    Channel: channelLabel,
    // 渠道类型简称（前端卡片角标 / 自动标签统一从这里取，前端不再各自维护映射）
    ChannelShort: primary?.channel ? channelShort(primary.channel.type) : '',
    // 主渠道类型（cos/minio/r2/s3/aliyun/easyimages/lsky/webdav/immich/custom/local）
    // 列表视图用它渲染「渠道简称图标」，前端不再按名称反查类型
    ChannelType: primary?.channel?.type || '',
    ChannelId: primary?.channelId || '',
    ChannelCode: primary?.channel?.code || '',
    ChannelName: primary?.channel?.name || '',
    // 该文件在「存储渠道」内的真实直链（S3 地址 / WebDAV 地址 …），无法构造时为空
    StorageUrl: storageUrl,
    BackupChannels: backupChannels,
    FileHash: rec.hash || '',
  };

  if (metas.Width) meta.Width = metas.Width;
  if (metas.Height) meta.Height = metas.Height;
  if (metas.ExternalLink) meta.ExternalLink = metas.ExternalLink;

  // 其余自定义 metas 一并带出（不覆盖上述关键字段）
  for (const [k, v] of Object.entries(metas)) {
    if (!(k in meta)) meta[k] = v;
  }
  return meta;
}

export function serializeFile(
  rec: FileRecord,
  copies: CopyWithChannel[],
  opts: SerializeOptions = {},
): { name: string; metadata: Record<string, unknown> } {
  return { name: rec.name, metadata: buildMetadata(rec, copies, opts) };
}

/** 规范化目录参数：去前导斜杠、统一尾斜杠（与原系统行为一致） */
export function normalizeDir(dir?: string): string {
  let d = (dir || '').replace(/\.\./g, '_').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (d.startsWith('/')) d = d.substring(1);
  if (d && !d.endsWith('/')) d += '/';
  return d;
}
