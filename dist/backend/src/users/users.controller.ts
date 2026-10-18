import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { AdminGuard, ManageAuthGuard, currentSession, isAdminRole } from '../auth/auth.guard';
import { SysConfigService } from '../settings/sysconfig.service';

/**
 * 用户管理。
 *
 * 账户体系约定：
 *   - 管理员在后台创建的用户一律为普通用户（role 固定 user，不可提升为管理员）；
 *   - 普通用户仅能上传文件、进入「文件管理」查看自身账户的文件与文件夹；
 *   - 管理员可控制每个账户的 编辑/删除 权限、禁用状态、密码，以及账户级主/备存储渠道。
 *
 * 权限（本页对普通用户开放，但只开放「看自己 + 改自己的密码 / 昵称」）：
 *   管理员  —— 全部功能（列表 / 创建 / 编辑 / 禁用 / 删除 / 归集统计 / 渠道绑定）
 *   普通用户 —— 只能看到自己这一条账户记录，且只能修改自己的密码与昵称；
 *               看不到别的账户、看不到归集统计、不能创建/删除账户。
 *               启用状态 / 可编辑 / 可删除 / 主备渠道等字段一律不可改（后端直接忽略）。
 *   因此类级用 ManageAuthGuard（登录即可进入），
 *   需要管理员权限的接口再用方法级 @UseGuards(AdminGuard) 或内部角色判断兜住。
 */
@Controller('api/manage/users')
@UseGuards(ManageAuthGuard)
export class UsersController {
  constructor(private sysConfig: SysConfigService) {}

  /** 当前会话是否管理员（admin / super） */
  private isAdmin(req: Request): boolean {
    return isAdminRole(currentSession(req)?.role);
  }

  /** 当前登录账户名 */
  private me(req: Request): string {
    return currentSession(req)?.user || '';
  }

  /** 管理员账户名：安全设置里的管理员账号 > 环境变量 > 超级管理员 > admin */
  private async adminUsername(): Promise<string> {
    try {
      const security = (await this.sysConfig.get('security')) as
        | { auth?: { admin?: { adminUsername?: string } }; admin?: { adminUsername?: string } }
        | undefined;
      // 真实结构是 security.auth.admin.adminUsername（历史实现读成 security.admin，永远取不到）
      const u = String(security?.auth?.admin?.adminUsername || security?.admin?.adminUsername || '').trim();
      if (u) return u;
    } catch {
      /* 忽略 */
    }
    return (
      (process.env.ADMIN_USER || '').trim() ||
      (process.env.SUPER_ADMIN_USERNAME || '').trim() ||
      'admin'
    );
  }

  /**
   * 内建管理员账户的「用户管理」字段。
   *
   * 管理员**不在 users 表中**（登录走「安全设置 → 管理端认证」），但后台用户管理
   * 仍会把他列成一行（id 形如 `__admin__<name>`）。他的昵称 / 账户级主备渠道 /
   * 「类型和大小限制」开关存在 adminProfile 这一独立配置里 —— 既能编辑保存，
   * 又完全不影响认证与 users 表本身。
   */
  private async readAdminProfile(): Promise<Record<string, unknown>> {
    try {
      const raw = await this.sysConfig.get('adminProfile');
      return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /**
   * 渠道 ID → 展示名 回显。
   * 统一显示成「code · name」：渠道名只是标识，真正用于匹配的是渠道 ID（6 位 code），
   * 只显示名称会让管理员选完就分不清到底绑的是哪条渠道。
   */
  private async channelLabelMap(): Promise<Map<string, string>> {
    const channels = await prisma.channel.findMany({ select: { id: true, name: true, code: true } });
    const m = new Map<string, string>();
    for (const c of channels) {
      const label = c.code ? `${c.code} · ${c.name}` : c.name;
      m.set(c.id, label);
      if (c.code) m.set(c.code, label);
    }
    return m;
  }

  /** 用户列表（含管理员账户本身 —— 管理员上传的文件也要能归集展示） */
  @Get()
  async list(@Req() req: Request) {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    const cName = await this.channelLabelMap();
    const rows: Array<Record<string, unknown>> = users.map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      role: u.role,
      enabled: u.enabled,
      canEdit: u.canEdit,
      canDelete: u.canDelete,
      linkEnabled: u.linkEnabled,
      enforceLimits: u.enforceLimits,
      mainChannelId: u.mainChannelId,
      backupChannelId: u.backupChannelId,
      mainChannelName: cName.get(u.mainChannelId) || '',
      backupChannelName: cName.get(u.backupChannelId) || '',
      createdAt: u.createdAt,
    }));
    // 普通用户：只返回自己这一条，看不到任何其它账户
    if (!this.isAdmin(req)) {
      const me = this.me(req);
      return rows.filter((r) => r.username === me);
    }
    // 管理员账户（不在 users 表中）也列为一行：可编辑，其配置存在 adminProfile
    const adminUser = await this.adminUsername();
    if (!rows.some((r) => r.username === adminUser)) {
      const prof = await this.readAdminProfile();
      const mainId = String(prof.mainChannelId || '');
      const backupId = String(prof.backupChannelId || '');
      rows.unshift({
        id: `__admin__${adminUser}`,
        username: adminUser,
        nickname: String(prof.nickname || '管理员'),
        role: 'admin',
        enabled: true,
        canEdit: true,
        canDelete: true,
        linkEnabled: true,
        enforceLimits: prof.enforceLimits !== false,
        mainChannelId: mainId,
        backupChannelId: backupId,
        mainChannelName: cName.get(mainId) || '',
        backupChannelName: cName.get(backupId) || '',
        createdAt: null,
        builtin: true,
      });
    }
    return rows;
  }

  /** 精简列表 —— 供「文件管理 → 用户筛选下拉」「历史记录 → 用户筛选」使用 */
  @Get('options')
  async options(@Req() req: Request) {
    // 普通用户没有切换用户的权限：只给回自己，避免暴露其它账户
    if (!this.isAdmin(req)) {
      const me = this.me(req);
      return me ? [{ username: me, nickname: me }] : [];
    }
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map((u) => ({ username: u.username, nickname: u.nickname || u.username }));
  }

  /**
   * 归集统计：把文件按「用户账户」或「IP 地址」归集。
   *   mode=user（默认）→ key 为用户名
   *   mode=ip          → key 为 IP，附带归属地
   * 权限：
   *   管理员 —— 两种口径都可用，数据为全站；
   *   普通用户 —— 只允许「按用户归集」，且数据强制限定在自己账户（mode 传 ip 也按 user 处理）。
   */
  @Get('collect')
  async collect(@Req() req: Request, @Query('mode') mode?: string) {
    const admin = this.isAdmin(req);
    const me = this.me(req);
    const byIp = admin && mode === 'ip';
    const files = await prisma.fileRecord.findMany({
      where: { status: 'active', ...(admin ? {} : { uploader: me || '' }) },
      select: {
        uploader: true, ip: true, size: true, createdAt: true, metas: true,
        // 主渠道副本 → 归出「上传渠道」集合（v1.8.0：统计列表新增「上传渠道」一列）
        copies: { where: { isPrimary: true }, select: { channelId: true } },
      },
    });

    const buckets = new Map<string, { key: string; count: number; size: number; lastAt: number; address?: string; channelIds: Set<string> }>();
    for (const f of files) {
      const key = (byIp ? f.ip : f.uploader) || (byIp ? '(未知IP)' : '(匿名)');
      const b = buckets.get(key) || { key, count: 0, size: 0, lastAt: 0, channelIds: new Set<string>() };
      b.count += 1;
      b.size += f.size || 0;
      b.lastAt = Math.max(b.lastAt, f.createdAt.getTime());
      for (const c of f.copies || []) if (c.channelId) b.channelIds.add(c.channelId);
      if (byIp && !b.address) {
        try {
          b.address = (JSON.parse(f.metas || '{}').UploadAddress as string) || '';
        } catch {
          /* 忽略 */
        }
      }
      buckets.set(key, b);
    }

    // IP 模式附带 ip_records 里的归属地
    if (byIp) {
      const ips = Array.from(buckets.keys());
      const records = await prisma.ipRecord.findMany({ where: { ip: { in: ips } } });
      for (const r of records) {
        const b = buckets.get(r.ip);
        if (b) b.address = [r.country, r.region, r.city].filter(Boolean).join(' ') || b.address;
      }
    }

    // 渠道 ID → 名称（一个 bucket 可能用了多个渠道，全部列出）
    const allChannelIds = Array.from(new Set(Array.from(buckets.values()).flatMap((b) => Array.from(b.channelIds))));
    const channelRows = allChannelIds.length
      ? await prisma.channel.findMany({ where: { id: { in: allChannelIds } }, select: { id: true, name: true } })
      : [];
    const chName = new Map(channelRows.map((c) => [c.id, c.name]));

    const items = Array.from(buckets.values())
      .map(({ channelIds, ...b }) => ({
        ...b,
        channels: Array.from(channelIds).map((id) => chName.get(id)).filter(Boolean),
      }))
      .sort((a, b) => b.count - a.count);
    return { mode: byIp ? 'ip' : 'user', items };
  }

  /** 创建普通用户（仅管理员） */
  @Post()
  async create(
    @Req() req: Request,
    @Body()
    body: {
      username?: string;
      password?: string;
      nickname?: string;
      enabled?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      /** 链接权限：关闭后该账户的文件外链（/file/*）不可访问 */
      linkEnabled?: boolean;
      /** 「类型和大小限制」：默认开启；关闭后该用户上传不受允许格式与单文件大小上限约束 */
      enforceLimits?: boolean;
      mainChannelId?: string;
      backupChannelId?: string;
    },
  ) {
    if (!this.isAdmin(req)) return { success: false, message: '没有权限创建用户' };
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username) return { success: false, message: '用户名不能为空' };
    if (!/^[A-Za-z0-9_.@-]{2,32}$/.test(username)) {
      return { success: false, message: '用户名仅支持字母/数字/_ . @ - ，长度 2-32' };
    }
    if (!password) return { success: false, message: '密码不能为空' };
    if (password.length < 4) return { success: false, message: '密码至少 4 位' };

    const dup = await prisma.user.findUnique({ where: { username } });
    if (dup) return { success: false, message: `用户名「${username}」已存在` };

    const u = await prisma.user.create({
      data: {
        username,
        passwordHash: CryptoService.hashPassword(password),
        uploadPassword: '',
        nickname: String(body.nickname || '').trim(),
        role: 'user', // 后台创建一律普通用户
        enabled: body.enabled !== false,
        canEdit: body.canEdit !== false,
        canDelete: body.canDelete !== false,
        linkEnabled: body.linkEnabled !== false,
        enforceLimits: body.enforceLimits !== false,
        mainChannelId: String(body.mainChannelId || ''),
        backupChannelId: String(body.backupChannelId || ''),
      },
    });
    return { success: true, data: { id: u.id } };
  }

  /** 修改用户（权限 / 禁用 / 渠道 / 密码 / 昵称）。普通用户只能改自己的密码。 */
  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      password?: string;
      nickname?: string;
      enabled?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      /** 链接权限：关闭后该账户的文件外链（/file/*）不可访问 */
      linkEnabled?: boolean;
      /** 「类型和大小限制」：默认开启；关闭后该用户上传不受允许格式与单文件大小上限约束 */
      enforceLimits?: boolean;
      mainChannelId?: string;
      backupChannelId?: string;
    },
  ) {
    /*
     * 内建管理员账户（id 形如 `__admin__<name>`）：不在 users 表中，
     * 其可编辑字段写入 adminProfile。早期这里直接按主键查 users 表 → 必然查不到，
     * 于是「编辑管理员自己的账户」永远报「用户不存在」。
     * 「启用 / 可编辑 / 可删除」对管理员没有意义（管理员恒有全部权限），忽略即可。
     */
    if (id.startsWith('__admin__')) {
      if (!this.isAdmin(req)) return { success: false, message: '只能修改自己的账户' };
      const patch: Record<string, unknown> = {};
      if (body.nickname !== undefined) patch.nickname = String(body.nickname);
      if (body.mainChannelId !== undefined) patch.mainChannelId = String(body.mainChannelId);
      if (body.backupChannelId !== undefined) patch.backupChannelId = String(body.backupChannelId);
      if (body.enforceLimits !== undefined) patch.enforceLimits = !!body.enforceLimits;
      await this.sysConfig.save('adminProfile', patch);
      return { success: true };
    }
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    /*
     * 普通用户（非管理员会话）：
     *   只能修改「自己的账户」的【密码】与【昵称】，其它字段
     *   （启用状态 / 可编辑 / 可删除 / 主备渠道）一律忽略，
     *   也绝不允许改到别的账户头上。
     */
    if (!this.isAdmin(req)) {
      if (u.username !== this.me(req)) return { success: false, message: '只能修改自己的账户' };
      const pwd = String(body.password || '');
      const nick = body.nickname === undefined ? undefined : String(body.nickname);
      if (!pwd && nick === undefined) return { success: false, message: '没有可修改的内容' };
      if (pwd && pwd.length < 4) return { success: false, message: '密码至少 4 位' };
      await prisma.user.update({
        where: { id },
        data: {
          ...(pwd ? { passwordHash: CryptoService.hashPassword(pwd) } : {}),
          ...(nick !== undefined ? { nickname: nick } : {}),
        },
      });
      return { success: true };
    }
    if (body.password !== undefined && body.password !== '') {
      if (String(body.password).length < 4) return { success: false, message: '密码至少 4 位' };
    }
    await prisma.user.update({
      where: { id },
      data: {
        ...(body.password ? { passwordHash: CryptoService.hashPassword(String(body.password)) } : {}),
        ...(body.nickname !== undefined ? { nickname: String(body.nickname) } : {}),
        ...(body.enabled !== undefined ? { enabled: !!body.enabled } : {}),
        ...(body.canEdit !== undefined ? { canEdit: !!body.canEdit } : {}),
        ...(body.canDelete !== undefined ? { canDelete: !!body.canDelete } : {}),
        ...(body.linkEnabled !== undefined ? { linkEnabled: !!body.linkEnabled } : {}),
        ...(body.enforceLimits !== undefined ? { enforceLimits: !!body.enforceLimits } : {}),
        ...(body.mainChannelId !== undefined ? { mainChannelId: String(body.mainChannelId) } : {}),
        ...(body.backupChannelId !== undefined ? { backupChannelId: String(body.backupChannelId) } : {}),
      },
    });
    return { success: true };
  }

  /** 删除用户（其已上传文件保留，归属信息不清空）（仅管理员） */
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    if (!this.isAdmin(req)) return { success: false, message: '没有权限删除用户' };
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    // 不允许删除管理员账户（防止把后台锁死）
    if (u.role === 'admin') return { success: false, message: '不能删除管理员账户' };
    await prisma.user.delete({ where: { id } });
    return { success: true };
  }
}
