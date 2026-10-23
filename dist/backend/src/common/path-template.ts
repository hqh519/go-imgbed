/**
 * 存储路径 / 文件命名模板 —— 渠道配置里的「对象前缀」与「自定义文件命名」。
 *
 * 两套占位符：
 *   对象前缀（目录部分）：{y} 年（4 位） / {m} 月（2 位） / {d} 日（2 位）
 *   文件命名（文件名部分）：{filename} 原文件名（不含扩展名） / {uuid} uuid /
 *                          {md5} md5 / {timestamp} 13 位毫秒时间戳 / {ext} 扩展名（不含点）
 *
 * 约定：
 *   - 前缀为空 → 默认 `{y}/{m}`（即 2026/10）；末尾斜杠统一由调用方补齐；
 *   - 命名字段为空 → 默认 `{filename}-{timestamp}`；
 *   - 模板里若没写 {ext}，会自动补上原扩展名 —— 否则存进对象存储的文件没有后缀，
 *     浏览器拿不到正确 Content-Type，下载下来也打不开；
 *   - 未知占位符原样保留（不吞掉用户输入，便于排查拼写错误）。
 */

export interface NameTokens {
  /** 原文件名（含扩展名） */
  originalName: string;
  /** 不带扩展名的文件名 */
  stem: string;
  /** 扩展名（不含点，小写） */
  ext: string;
  /** 文件内容 md5 */
  md5: string;
  /** 13 位毫秒时间戳 */
  timestamp: number;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/** 对象前缀：占位符替换 + 规范化（去首尾斜杠、压缩重复斜杠） */
export function renderObjectPrefix(template: string | undefined, at = new Date()): string {
  const tpl = String(template ?? '').trim();
  if (!tpl) return `${at.getFullYear()}/${pad(at.getMonth() + 1)}`;
  const replaced = tpl
    .replace(/\{y\}/g, String(at.getFullYear()))
    .replace(/\{m\}/g, pad(at.getMonth() + 1))
    .replace(/\{d\}/g, pad(at.getDate()));
  return replaced.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

/** 文件命名：占位符替换；未含 {ext} 时自动补扩展名 */
export function renderFileName(template: string | undefined, tokens: NameTokens): string {
  const tpl = String(template ?? '').trim();
  const ext = tokens.ext || '';
  const use = tpl || '{filename}-{timestamp}';
  const hasExtToken = /\{ext\}/.test(use);
  let name = use
    .replace(/\{filename\}/g, tokens.stem)
    .replace(/\{uuid\}/g, randomUuid())
    .replace(/\{md5\}/g, tokens.md5)
    .replace(/\{timestamp\}/g, String(tokens.timestamp))
    .replace(/\{ext\}/g, ext);
  // 去掉 Windows / 对象存储都不接受的控制字符与路径分隔符
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '');
  if (!name) name = `${tokens.stem}-${tokens.timestamp}`;
  if (ext && !hasExtToken && !name.toLowerCase().endsWith('.' + ext.toLowerCase())) {
    name += '.' + ext;
  }
  return name;
}

/** 拼接目录与文件名（空目录时只返回文件名） */
export function joinObjectKey(prefix: string, fileName: string): string {
  const p = String(prefix || '').replace(/^\/+|\/+$/g, '');
  const f = String(fileName || '').replace(/^\/+/g, '');
  return p ? `${p}/${f}` : f;
}

/** RFC 4122 v4（不引依赖） */
export function randomUuid(): string {
  const b = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 该渠道类型是否支持「对象前缀 / 自定义文件命名」（需求指定的 6 类） */
export const PREFIX_CAPABLE_TYPES = ['minio', 'cos', 'aliyun', 'r2', 's3', 'webdav'] as const;

export function supportsPrefix(type: string): boolean {
  return (PREFIX_CAPABLE_TYPES as readonly string[]).includes(type);
}
