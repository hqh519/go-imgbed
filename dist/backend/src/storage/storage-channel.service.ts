import { Injectable } from '@nestjs/common';
import { prisma } from '../common/prisma';
import { SysConfigService } from '../settings/sysconfig.service';

/**
 * 默认存储渠道 / 备份渠道的【统一获取入口】。
 *
 * 全站任何需要「当前该用哪个存储渠道」的地方都必须从这里取，禁止各自写一套
 * 兜底顺序 —— 历史上散落各处的取渠道逻辑互相不一致，导致「明明设置的是 A 渠道，
 * 却传到了 B 渠道」「对外只拿到渠道直链而不是本站签发链接」这类问题反复出现。
 *
 * ## 对外主入口（用户维度，全站统一）
 *
 * ```ts
 * getStorageChannel(user, type)
 * ```
 *   - `user` —— 账户名（可选）。传空表示「无账户上下文」，直接走全局设置。
 *   - `type` —— `''` / `'main'` 取【默认存储渠道】；`'backup'` 取【备份渠道】。
 *
 * 语义：
 *   - `getStorageChannel('abc1', 'backup')` —— abc1 账户配置的备份渠道；
 *     该账户没配 → 回退【全局默认备份渠道】（后台「上传设置」里 isBackup 的渠道）。
 *   - `getStorageChannel('abc2', '')`       —— abc2 账户配置的默认存储渠道；
 *     该账户没配 → 回退【全局默认存储渠道】（后台「上传设置」里 isMain 的渠道）。
 *
 * 获取优先级（从高到低）：
 *   1) explicitId —— 本次请求显式指定的渠道 ID（前端上传设置里选的渠道、
 *                    API 的 bucket/backup 参数、S3 的 bucket 段）
 *   2) tokenId    —— API Token 上配置的默认存储/备份渠道（仅 API 场景）
 *   3) uploader   —— 「用户管理」里为该账户指定的主/备渠道
 *   4) 全局        —— 后台「上传设置」里指定的主渠道（isMain）/ 备份渠道（isBackup）
 *
 * 说明：渠道一律按【渠道 ID】匹配 —— 6 位 `code`（后台渠道列表展示的渠道 ID）
 * 或数据库主键 `id`。渠道名（name）只是给人看的标识，改名后按名匹配会静默失配。
 * 本服务只返回【启用中】的渠道；已禁用的渠道不会出现在候选里。
 */
export type StorageChannelKind = 'main' | 'backup';

/** `getStorageChannel` 的第二个参数：'' / 'main' = 默认存储渠道，'backup' = 备份渠道 */
export type StorageChannelType = '' | 'main' | 'backup';

export interface StorageChannelQuery {
  /** 本次请求显式指定的渠道（渠道 ID：6 位 code 或主键 id）—— 优先级最高 */
  explicitId?: string;
  /** 渠道类型过滤（前端上传设置里选择的「渠道类型」，如 minio / cos / r2） */
  channelType?: string;
  /** 账户名 —— 用于读取「用户管理」里为该账户指定的主/备渠道 */
  uploader?: string;
  /** API Token 主键 id —— 用于读取 Token 上配置的默认主/备渠道 */
  tokenId?: string;
}

export interface StorageChannelInfo {
  id: string;
  code: string;
  name: string;
  type: string;
  config: string;
}

/** 关闭备份的哨兵值（API 的 backup 参数传 none / __none__ 表示本次不备份） */
export const NO_BACKUP_VALUES = ['none', '__none__', 'false', '0'];

@Injectable()
export class StorageChannelService {
  constructor(private sysConfig: SysConfigService) {}

  /**
   * 内建管理员的账户级渠道。
   *
   * 管理员不在 users 表中（登录走「安全设置 → 管理端认证」），后台「用户管理」里
   * 为他配置的主/备渠道存在 adminProfile。仅当 uploader 确实就是该管理员时才取用，
   * 避免把匿名 / 已删除账户的上传也套到管理员的绑定上。
   */
  private async adminProfileChannel(uploader: string, kind: StorageChannelType): Promise<string> {
    try {
      const security: any = await this.sysConfig.get('security');
      const adminName =
        String(security?.auth?.admin?.adminUsername || '').trim() ||
        (process.env.ADMIN_USER || '').trim() ||
        'admin';
      if (!uploader || uploader !== adminName) return '';
      const prof: any = await this.sysConfig.get('adminProfile');
      return String((kind === 'backup' ? prof?.backupChannelId : prof?.mainChannelId) || '').trim();
    } catch {
      return '';
    }
  }

  /** 按渠道 ID 查启用中的渠道（兼容 6 位 code 与主键 id） */
  async findById(key?: string): Promise<StorageChannelInfo | null> {
    const k = String(key || '').trim();
    if (!k) return null;
    const c =
      (await prisma.channel.findUnique({ where: { code: k } })) ||
      (await prisma.channel.findUnique({ where: { id: k } })) ||
      null;
    if (!c || !c.enabled) return null;
    return { id: c.id, code: c.code, name: c.name, type: c.type, config: c.config };
  }

  /**
   * 候选渠道列表（按优先级排序，去重，全部为启用中渠道）。
   * UploadService 会在候选里挑「第一个未达容量阈值」的渠道，因此这里返回列表而不是单值。
   */
  async getStorageChannelCandidates(
    kind: StorageChannelKind,
    q: StorageChannelQuery = {},
  ): Promise<StorageChannelInfo[]> {
    const out: StorageChannelInfo[] = [];
    const seen = new Set<string>();
    const push = (c: StorageChannelInfo | null) => {
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    };

    // 1) 本次请求显式指定的渠道
    if (q.explicitId) push(await this.findById(q.explicitId));

    // 2) API Token 上配置的默认主/备渠道
    if (q.tokenId) {
      try {
        const t = await prisma.apiToken.findUnique({ where: { id: q.tokenId } });
        const metas = JSON.parse(t?.metas || '{}') as { defaultBucket?: string; defaultBackup?: string };
        const raw = String((kind === 'backup' ? metas.defaultBackup : metas.defaultBucket) || '').trim();
        if (raw && !NO_BACKUP_VALUES.includes(raw.toLowerCase())) push(await this.findById(raw));
      } catch {
        /* 忽略 Token 读取异常，继续走后面的兜底 */
      }
    }

    // 3) 「用户管理」里为该账户指定的主/备渠道
    if (q.uploader) {
      try {
        const u = await prisma.user.findUnique({ where: { username: q.uploader } });
        let pid = String((kind === 'backup' ? u?.backupChannelId : u?.mainChannelId) || '').trim();
        // 内建管理员不在 users 表中：其账户级绑定存在 adminProfile
        if (!u) pid = await this.adminProfileChannel(q.uploader, kind);
        if (pid) push(await this.findById(pid));
      } catch {
        /* 忽略账户读取异常 */
      }
    }

    // 4) 全局：后台「上传设置」里指定的主渠道 / 备份渠道
    const globals = await prisma.channel.findMany({
      where: kind === 'backup' ? { isBackup: true, enabled: true } : { isMain: true, enabled: true },
      orderBy: { sortOrder: 'asc' },
    });
    for (const g of globals) push({ id: g.id, code: g.code, name: g.name, type: g.type, config: g.config });

    // 5) 兜底：上面都没取到时，按「渠道类型」在本类型内选（主渠道优先、再按排序）
    if (out.length === 0 && q.channelType) {
      const byType = await prisma.channel.findMany({
        where: { type: q.channelType, enabled: true },
        orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }],
      });
      for (const c of byType) push({ id: c.id, code: c.code, name: c.name, type: c.type, config: c.config });
    }

    return out;
  }

  /**
   * 【全站统一入口】按「账户 + 类型」取当前生效的渠道。
   *
   *   getStorageChannel('abc1', 'backup') → abc1 的备份渠道，未配置则回退全局备份渠道
   *   getStorageChannel('abc2', '')       → abc2 的默认存储渠道，未配置则回退全局主渠道
   *   getStorageChannel('', 'main')       → 全局主渠道
   *
   * 第三个参数 `extra` 供内部场景补充更细的上下文（本次请求显式指定的渠道 ID、
   * API Token 默认渠道、渠道类型过滤）—— 显式传入的优先级高于账户配置。
   * 返回优先级最高的一条；取不到返回 null。
   */
  async getStorageChannel(
    user?: string,
    type?: StorageChannelType | string,
    extra?: StorageChannelQuery,
  ): Promise<StorageChannelInfo | null> {
    const kind = this.normalizeKind(type);
    const list = await this.getStorageChannelCandidates(kind, {
      ...(extra || {}),
      // 账户参数优先用第一个形参；未传时保留 extra 里的 uploader
      uploader: String(user || '').trim() || extra?.uploader || undefined,
    });
    return list[0] || null;
  }

  /** 类型参数归一化：只有显式传 'backup' 才走备份渠道，其余（'' / 'main' / 未传）一律主渠道 */
  private normalizeKind(type?: string): StorageChannelKind {
    return String(type || '').trim().toLowerCase() === 'backup' ? 'backup' : 'main';
  }

  /**
   * 当前默认渠道的展示名（「渠道ID · 渠道名」），取不到时返回空串。
   * 签名与 getStorageChannel 一致：getStorageChannelName('abc1', 'backup')。
   */
  async getStorageChannelName(
    user?: string,
    type?: StorageChannelType | string,
    extra?: StorageChannelQuery,
  ): Promise<string> {
    const c = await this.getStorageChannel(user, type, extra);
    return c ? `${c.code} · ${c.name}` : '';
  }
}
