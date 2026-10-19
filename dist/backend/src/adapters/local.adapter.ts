import { createWriteStream, existsSync, mkdirSync, promises as fsp } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { AdapterError, ChannelInfo, CopyInfo, StorageAdapter, UploadResult } from './adapter.interface';
import { backendSub } from '../common/project-paths';

/**
 * 本地存储渠道（系统内置，不可删除）。
 *
 * ## 为什么要内置一个本地渠道
 * 图床默认应当「开箱即用」：装好就能传图，不必先去申请对象存储、填一堆密钥。
 * 本地渠道把文件写在系统自身目录下，零外部依赖，也是「我不信任第三方存储」时
 * 唯一可靠的兜底选项。
 *
 * ## 落盘规则（v2.1.0 起：按上传者归档，与「虚拟分类」解耦）
 * 上传服务生成的 key 形如 `202610/ab12cd.jpg`（年+月 拼成一个目录段）。
 * 本适配器在写盘时把它展开成：
 *   `uploads/<上传者>/2026/10/ab12cd.jpg`
 * 没有上传者的（例如 API 直接上传、未指定账户）归入 `uploads/default/2026/10/`。
 * 目录段只做安全清洗（去掉路径分隔符），不改用户名本身，便于人工排查。
 *
 * 这样设计的好处：
 *   1) 在文件管理里改分类，实体文件不会搬家，不会出现「改一次目录就要搬运 GB 级数据」；
 *   2) 磁盘上的目录结构按时间天然分片，单目录文件数可控；
 *   3) 备份 / 迁移时只需整目录拷贝 uploads/。
 *
 * ## 直链
 * 本地文件没有「渠道直链」可言，`buildDirectUrl` 一律返回 null，
 * 由 `/file/:name` 走本站代理读取（这样外链域名、代理缓存、Range 全都复用同一套逻辑）。
 */
export class LocalAdapter implements StorageAdapter {
  /** 本地存储根目录：<后端根>/uploads */
  static root(): string {
    return backendSub('uploads');
  }

  /**
   * key → 磁盘相对路径（**不含上传者目录**）。
   *   `202610/ab12.jpg` → `2026/10/ab12.jpg`
   * 其它形态的 key（例如 S3 客户端直接给的多级路径、已展开的 remoteKey）原样保留，
   * 只做安全性校验（禁止 `..` 穿越）。
   */
  static toRelativePath(key: string): string {
    const clean = String(key || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    if (!clean) throw new AdapterError('key 为空，无法写入本地存储', 'local');
    // 年月段展开：202610 → 2026/10（仅在首段恰为 6 位数字时）
    const parts = clean.split('/');
    const head = parts[0];
    if (/^\d{6}$/.test(head)) {
      parts.splice(0, 1, head.slice(0, 4), head.slice(4));
    }
    return parts.join('/');
  }

  /** 上传者目录名：只清洗路径分隔符等非法字符，保留中文/字母数字，空值归 default */
  static ownerSegment(owner?: string | null): string {
    const s = String(owner || '')
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\.+$/, '')
      .replace(/\/{2,}/g, '/');
    return s || 'default';
  }

  /**
   * 新上传的 key → 带上传者目录的相对路径：
   *   `202610/ab12.jpg` + 用户 alice → `alice/2026/10/ab12.jpg`
   *   `202610/ab12.jpg` + 无用户   → `default/2026/10/ab12.jpg`
   * 已是展开形态（首段不是 6 位数字，如备份时传入的 remoteKey）则原样返回，
   * 避免重复叠加用户名目录。
   */
  static toRelativePathFor(key: string, owner?: string | null): string {
    const rel = LocalAdapter.toRelativePath(key);
    const rawHead = String(key || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')[0];
    // 只有「刚生成的原始 key（202610/xxx）」才需要加上传者目录；
    // 已展开的 remoteKey（备份 / 补备份时传入）原样使用，避免重复叠加。
    if (!/^\d{6}$/.test(rawHead)) return rel;
    return `${LocalAdapter.ownerSegment(owner)}/${rel}`;
  }

  /** 磁盘绝对路径（带越界校验：结果必须仍在上传根目录内） */
  static absolutePath(key: string): string {
    const root = LocalAdapter.root();
    const abs = normalize(join(root, LocalAdapter.toRelativePath(key)));
    const rootWithSep = root.endsWith(sep) ? root : root + sep;
    if (!abs.startsWith(rootWithSep)) {
      throw new AdapterError('非法的本地存储路径', 'local');
    }
    return abs;
  }

  async upload(
    file: { buffer: Buffer; mime: string; originalName: string },
    key: string,
    _channel: ChannelInfo,
    ctx?: { owner?: string },
  ): Promise<UploadResult> {
    // 落盘路径：uploads/<上传者或 default>/年/月/文件
    const relKey = LocalAdapter.toRelativePathFor(key, ctx?.owner);
    const abs = LocalAdapter.absolutePath(relKey);
    try {
      await fsp.mkdir(dirname(abs), { recursive: true });
      await fsp.writeFile(abs, file.buffer);
    } catch (err) {
      throw new AdapterError(`写入本地文件失败：${(err as Error).message}`, 'local');
    }
    // remoteKey 存「展开后」的相对路径（含上传者目录），读取时直接按它定位
    return { remoteKey: relKey, metas: { local: true, owner: LocalAdapter.ownerSegment(ctx?.owner) } };
  }

  async delete(copy: CopyInfo, _channel: ChannelInfo): Promise<void> {
    const rel = String(copy.remoteKey || '');
    if (!rel) return;
    // 兼容历史数据：老记录的 remoteKey 可能是 202610/ 形态
    let abs: string;
    try {
      abs = LocalAdapter.absolutePath(rel);
    } catch {
      return;
    }
    try {
      await fsp.unlink(abs);
    } catch (err) {
      // 文件本来就不存在 → 视为删除成功（幂等）
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw new AdapterError(`删除本地文件失败：${(err as Error).message}`, 'local');
      }
    }
  }

  /** 本地文件不产生渠道直链 —— 由 /file/:name 代理下发 */
  buildDirectUrl(_copy: CopyInfo, _channel: ChannelInfo): string | null {
    return null;
  }
}

/** 本地文件的绝对路径（供 /file 控制器直接读流）；不存在返回空串 */
export function localFileAbs(remoteKey: string): string {
  const rel = String(remoteKey || '').replace(/^\/+/, '');
  if (!rel) return '';
  // 优先按「展开后」的规范路径（2026/10/xxx）定位
  try {
    const abs = LocalAdapter.absolutePath(rel);
    if (existsSync(abs)) return abs;
  } catch {
    /* 越界 → 忽略 */
  }
  /*
   * 兼容历史/手工迁移的 `202610/xxx` 原始目录。
   * 这条回退分支**必须**自己做越界校验：`join` 会把 `..` 归一化掉，
   * 若直接 existsSync 就返回，等于给「库里的 remoteKey 被写脏」留了读任意文件的通道。
   */
  const root = LocalAdapter.root();
  const legacy = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (legacy.startsWith(rootWithSep) && existsSync(legacy)) return legacy;
  return '';
}

/**
 * 流式写入本地文件（后续给「分片落盘」用）。
 * 目前上传仍是整块 Buffer，此函数保留给后续优化，避免再改一次适配器签名。
 */
export async function writeLocalStream(relKey: string, source: Readable): Promise<void> {
  const abs = LocalAdapter.absolutePath(relKey);
  mkdirSync(dirname(abs), { recursive: true });
  await pipeline(source, createWriteStream(abs));
}
