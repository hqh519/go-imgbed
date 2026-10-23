import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { prisma } from '../common/prisma';
import { normalizeUploadSource } from '../common/file-view';
import { CryptoService } from '../common/crypto.service';
import { backendSub } from '../common/project-paths';
import { generateTotpSecret, totpUri, verifyTotp } from '../common/totp';
import { ManageAuthGuard, currentSession, isAdminRole } from '../auth/auth.guard';
import { SysConfigService } from '../settings/sysconfig.service';
import { SettingsService } from '../settings/settings.service';

/** 会话有效期默认值（天）：账户留空时生效 */
const DEFAULT_SESSION_DAYS = 7;
/** 头像尺寸（正方形，px）—— 后台缩略图与前端 logo 都够用，单张约 10~20KB */
const AVATAR_SIZE = 256;
/** 用户公告在 settings 表里的键 */
const NOTICE_KEY = 'userNotice';

/**
 * 用户管理。
 *
 * 账户体系约定（v202610221824 重构）：
 *   - 管理员与普通用户**都在 users 表里**（管理员 = role 'admin' 的那条记录）；
 *     「安全设置 → 管理端认证」不再承担账号管理职责，用户名/密码统一在本页修改；
 *   - 用户名可自行修改，但全表唯一（改名前先查重）；
 *   - 普通用户只能看到并修改自己这一条（用户名/密码/昵称/邮箱/头像/2FA/会话有效期），
 *     其余管理字段（启用状态、权限、渠道、管理备注）只有管理员能改；
 *   - 渠道绑定只能从「该用户获授权」的渠道里选，越权值直接忽略。
 */
@Controller('api/manage/users')
@UseGuards(ManageAuthGuard)
export class UsersController {
  constructor(
    private sysConfig: SysConfigService,
    private settings: SettingsService,
  ) {}

  /** 当前会话是否管理员（admin / super） */
  private isAdmin(req: Request): boolean {
    return isAdminRole(currentSession(req)?.role);
  }

  /** 当前登录账户名 */
  private me(req: Request): string {
    return currentSession(req)?.user || '';
  }

  /** 管理员账户名：users 表里最早的 admin → 环境变量 → admin */
  private async adminUsername(): Promise<string> {
    try {
      const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
      if (admin?.username) return admin.username;
    } catch {
      /* 忽略 */
    }
    return (process.env.ADMIN_USER || '').trim() || (process.env.SUPER_ADMIN_USERNAME || '').trim() || 'admin';
  }

  /**
   * 内建管理员账户的「用户管理」字段。
   * 仅当 users 表里一条 admin 都没有（老库升级）时才会用到 —— 其配置存 adminProfile。
   */
  private async readAdminProfile(): Promise<Record<string, unknown>> {
    try {
      const raw = await this.sysConfig.get('adminProfile');
      return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** 渠道 ID → 展示名 回显（「code · name」） */
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

  /** 用户公告（所有登录用户可读；管理员可写） */
  private async readNotice(): Promise<string> {
    return (await this.settings.get(NOTICE_KEY, '')) || '';
  }

  /** 用户列表（管理员看全部 + 内建管理员行；普通用户只看自己） */
  @Get()
  async list(@Req() req: Request) {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    const cName = await this.channelLabelMap();
    const rows: Array<Record<string, unknown>> = users.map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      email: u.email || '',
      avatar: u.avatar || '',
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
      totpEnabled: u.totpEnabled,
      frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
      backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
      // 管理备注：仅管理员可见，下面非管理员分支会剔除该字段
      adminNote: u.adminNote || '',
      createdAt: u.createdAt,
    }));
    if (!this.isAdmin(req)) {
      const me = this.me(req);
      return rows
        .filter((r) => r.username === me)
        .map(({ adminNote: _omit, ...rest }) => rest);
    }
    // 老库（users 表无 admin）才补一行虚拟管理员
    const adminUser = await this.adminUsername();
    if (!rows.some((r) => r.role === 'admin')) {
      const prof = await this.readAdminProfile();
      const mainId = String(prof.mainChannelId || '');
      const backupId = String(prof.backupChannelId || '');
      rows.unshift({
        id: `__admin__${adminUser}`,
        username: adminUser,
        nickname: String(prof.nickname || '管理员'),
        email: String(prof.email || ''),
        avatar: '',
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
        totpEnabled: false,
        frontSessionDays: DEFAULT_SESSION_DAYS,
        backSessionDays: DEFAULT_SESSION_DAYS,
        adminNote: String(prof.adminNote || ''),
        createdAt: null,
        builtin: true,
      });
    }
    return rows;
  }

  /** 精简列表 —— 供「文件管理 → 用户筛选下拉」「历史记录 → 用户筛选」使用 */
  @Get('options')
  async options(@Req() req: Request) {
    if (!this.isAdmin(req)) {
      const me = this.me(req);
      return me ? [{ username: me, nickname: me }] : [];
    }
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map((u) => ({
      username: u.username,
      nickname: u.nickname || u.username,
      avatar: u.avatar || '',
      role: u.role,
    }));
  }

  /** 用户公告：读取（登录即可） */
  @Get('notice')
  async getNotice(@Req() req: Request) {
    if (!currentSession(req)) return { success: false, message: '未登录' };
    return { success: true, data: { content: await this.readNotice() } };
  }

  /** 用户公告：保存（仅管理员）。内容支持 HTML，前端按富文本渲染 */
  @Post('notice')
  async saveNotice(@Req() req: Request, @Body() body: { content?: string }) {
    if (!this.isAdmin(req)) return { success: false, message: '没有权限发布公告' };
    const content = String(body.content ?? '').slice(0, 20000);
    await this.settings.set(NOTICE_KEY, content);
    return { success: true, data: { content } };
  }

  /**
   * 归集统计：把文件按「用户账户」或「IP 地址」归集。
   *   mode=user（默认）→ key 为用户名
   *   mode=ip          → key 为 IP，附带归属地
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
        uploadSource: true,
      },
    });

    const buckets = new Map<string, { key: string; count: number; size: number; lastAt: number; address?: string; sources: Set<string> }>();
    for (const f of files) {
      const key = (byIp ? f.ip : f.uploader) || (byIp ? '(未知IP)' : '(匿名)');
      const b = buckets.get(key) || { key, count: 0, size: 0, lastAt: 0, sources: new Set<string>() };
      b.count += 1;
      b.size += f.size || 0;
      b.lastAt = Math.max(b.lastAt, f.createdAt.getTime());
      b.sources.add(normalizeUploadSource(f.uploadSource));
      if (byIp && !b.address) {
        try {
          b.address = (JSON.parse(f.metas || '{}').UploadAddress as string) || '';
        } catch {
          /* 忽略 */
        }
      }
      buckets.set(key, b);
    }

    if (byIp) {
      const ips = Array.from(buckets.keys());
      const records = await prisma.ipRecord.findMany({ where: { ip: { in: ips } } });
      for (const r of records) {
        const b = buckets.get(r.ip);
        if (b) b.address = [r.country, r.region, r.city].filter(Boolean).join(' ') || b.address;
      }
    }

    const items = Array.from(buckets.values())
      .map(({ sources, ...b }) => ({
        ...b,
        uploadSources: Array.from(sources).sort(),
      }))
      .sort((a, b) => b.count - a.count);
    return { mode: byIp ? 'ip' : 'user', items };
  }

  /** 用户名合法性 + 唯一性校验（改名与新建共用） */
  private async checkUsername(username: string, selfId?: string): Promise<string | null> {
    if (!username) return '用户名不能为空';
    if (!/^[A-Za-z0-9_.@-]{2,32}$/.test(username)) {
      return '用户名仅支持字母/数字/_ . @ - ，长度 2-32';
    }
    const dup = await prisma.user.findFirst({
      where: { username, ...(selfId ? { NOT: { id: selfId } } : {}) },
    });
    if (dup) return `用户名「${username}」已存在`;
    return null;
  }

  /**
   * 单个账户详情（用户编辑独立页用）。
   * 权限与列表一致：管理员可查任意账户；普通用户只能查自己。
   */
  @Get(':id')
  async detail(@Req() req: Request, @Param('id') id: string) {
    const admin = this.isAdmin(req);
    // 老库虚拟管理员行
    if (id.startsWith('__admin__')) {
      if (!admin) return { success: false, message: '没有权限查看该账户' };
      const name = id.replace('__admin__', '');
      const prof = await this.readAdminProfile();
      return {
        success: true,
        data: {
          id,
          username: name,
          nickname: String(prof.nickname || '管理员'),
          email: String(prof.email || ''),
          avatar: '',
          role: 'admin',
          enabled: true,
          canEdit: true,
          canDelete: true,
          linkEnabled: true,
          enforceLimits: prof.enforceLimits !== false,
          mainChannelId: String(prof.mainChannelId || ''),
          backupChannelId: String(prof.backupChannelId || ''),
          totpEnabled: false,
          frontSessionDays: DEFAULT_SESSION_DAYS,
          backSessionDays: DEFAULT_SESSION_DAYS,
          adminNote: String(prof.adminNote || ''),
          builtin: true,
        },
      };
    }
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    if (!admin && u.username !== this.me(req)) return { success: false, message: '没有权限查看该账户' };
    return {
      success: true,
      data: {
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        email: u.email || '',
        avatar: u.avatar || '',
        avatarUrl: u.avatar ? `/api/avatar/${encodeURIComponent(u.username)}?v=${encodeURIComponent(u.avatar)}` : '',
        role: u.role,
        enabled: u.enabled,
        canEdit: u.canEdit,
        canDelete: u.canDelete,
        linkEnabled: u.linkEnabled,
        enforceLimits: u.enforceLimits,
        mainChannelId: u.mainChannelId,
        backupChannelId: u.backupChannelId,
        totpEnabled: u.totpEnabled,
        frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
        backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
        // 管理备注只回给管理员
        adminNote: admin ? u.adminNote || '' : '',
        createdAt: u.createdAt,
        // 是否本人（前端据此决定哪些字段可改用）
        self: u.username === this.me(req),
      },
    };
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
      email?: string;
      enabled?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      linkEnabled?: boolean;
      enforceLimits?: boolean;
      mainChannelId?: string;
      backupChannelId?: string;
      adminNote?: string;
    },
  ) {
    if (!this.isAdmin(req)) return { success: false, message: '没有权限创建用户' };
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const nameErr = await this.checkUsername(username);
    if (nameErr) return { success: false, message: nameErr };
    if (!password) return { success: false, message: '密码不能为空' };
    if (password.length < 4) return { success: false, message: '密码至少 4 位' };

    const u = await prisma.user.create({
      data: {
        username,
        passwordHash: CryptoService.hashPassword(password),
        uploadPassword: '',
        nickname: String(body.nickname || '').trim(),
        email: String(body.email || '').trim().slice(0, 120),
        role: 'user', // 后台创建一律普通用户
        enabled: body.enabled !== false,
        canEdit: body.canEdit !== false,
        canDelete: body.canDelete !== false,
        linkEnabled: body.linkEnabled !== false,
        enforceLimits: body.enforceLimits !== false,
        mainChannelId: String(body.mainChannelId || ''),
        backupChannelId: String(body.backupChannelId || ''),
        adminNote: String(body.adminNote || '').slice(0, 4000),
      },
    });
    return { success: true, data: { id: u.id } };
  }

  /**
   * 修改用户。
   *   本人可改：用户名 / 密码 / 昵称 / 邮箱 / 会话有效期（前后端）
   *   管理员另可改：启用状态 / 编辑权 / 删除权 / 链接权限 / 类型大小限制 / 主备渠道 / 管理备注
   */
  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      username?: string;
      password?: string;
      nickname?: string;
      email?: string;
      enabled?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      linkEnabled?: boolean;
      enforceLimits?: boolean;
      mainChannelId?: string;
      backupChannelId?: string;
      adminNote?: string;
      frontSessionDays?: number | null;
      backSessionDays?: number | null;
    },
  ) {
    // ---- 老库的虚拟管理员行（users 表无 admin 时）----
    if (id.startsWith('__admin__')) {
      if (!this.isAdmin(req)) return { success: false, message: '只能修改自己的账户' };
      const patch: Record<string, unknown> = {};
      if (body.nickname !== undefined) patch.nickname = String(body.nickname);
      if (body.email !== undefined) patch.email = String(body.email);
      if (body.mainChannelId !== undefined) patch.mainChannelId = String(body.mainChannelId);
      if (body.backupChannelId !== undefined) patch.backupChannelId = String(body.backupChannelId);
      if (body.enforceLimits !== undefined) patch.enforceLimits = !!body.enforceLimits;
      if (body.adminNote !== undefined) patch.adminNote = String(body.adminNote).slice(0, 4000);
      await this.sysConfig.save('adminProfile', patch);
      return { success: true };
    }

    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    const admin = this.isAdmin(req);
    const self = u.username === this.me(req);
    if (!admin && !self) return { success: false, message: '只能修改自己的账户' };

    const data: Record<string, unknown> = {};

    // ---- 用户名（可改，全表唯一）----
    if (body.username !== undefined) {
      const next = String(body.username).trim();
      if (next !== u.username) {
        const err = await this.checkUsername(next, u.id);
        if (err) return { success: false, message: err };
        data.username = next;
      }
    }
    // ---- 密码 ----
    if (body.password !== undefined && body.password !== '') {
      if (String(body.password).length < 4) return { success: false, message: '密码至少 4 位' };
      data.passwordHash = CryptoService.hashPassword(String(body.password));
    }
    // ---- 基础资料（本人可改）----
    if (body.nickname !== undefined) data.nickname = String(body.nickname).slice(0, 60);
    if (body.email !== undefined) {
      const email = String(body.email).trim().slice(0, 120);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: '邮箱格式不正确' };
      data.email = email;
    }
    // ---- 会话有效期（本人可改；null/留空 = 默认 7 天）----
    for (const key of ['frontSessionDays', 'backSessionDays'] as const) {
      const raw = body[key];
      if (raw === undefined) continue;
      if (raw === null || String(raw).trim() === '') {
        data[key] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 3650) {
        return { success: false, message: '会话有效期需在 0~3650 天之间（0 = 永久）' };
      }
      data[key] = Math.floor(n);
    }

    // ---- 以下字段仅管理员可改 ----
    if (admin) {
      if (body.enabled !== undefined) data.enabled = !!body.enabled;
      if (body.canEdit !== undefined) data.canEdit = !!body.canEdit;
      if (body.canDelete !== undefined) data.canDelete = !!body.canDelete;
      if (body.linkEnabled !== undefined) data.linkEnabled = !!body.linkEnabled;
      if (body.enforceLimits !== undefined) data.enforceLimits = !!body.enforceLimits;
      if (body.mainChannelId !== undefined) data.mainChannelId = String(body.mainChannelId);
      if (body.backupChannelId !== undefined) data.backupChannelId = String(body.backupChannelId);
      if (body.adminNote !== undefined) data.adminNote = String(body.adminNote).slice(0, 4000);
    }

    if (Object.keys(data).length === 0) return { success: false, message: '没有可修改的内容' };
    const updated = await prisma.user.update({ where: { id }, data });

    // 改名后：该账户名下文件的 uploader 字段同步，避免归集统计与「只能看自己的文件」失配
    if (data.username && updated.username !== u.username) {
      await prisma.fileRecord.updateMany({ where: { uploader: u.username }, data: { uploader: updated.username } });
    }
    return { success: true, data: { username: updated.username } };
  }

  /** 删除用户（其已上传文件保留，归属信息不清空）（仅管理员） */
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    if (!this.isAdmin(req)) return { success: false, message: '没有权限删除用户' };
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    if (u.role === 'admin') return { success: false, message: '不能删除管理员账户' };
    await prisma.user.delete({ where: { id } });
    // 顺手删掉头像文件（固定命名，不删会残留）
    await fsp.unlink(join(avatarDir(), `${id}.webp`)).catch(() => undefined);
    return { success: true };
  }

  /* ================= 头像 ================= */

  /**
   * 上传头像（本人或管理员）。
   *
   * 落盘规则（需求约定）：
   *   - 固定路径 uploads/avatars/<userId>.webp —— 每次覆盖同一个文件，
   *     所以每个用户在磁盘上永远只有一张头像，不会随修改次数堆积；
   *   - 统一裁剪成 256×256 正方形（居中裁切 + webp 质量 88），
   *     前端已做在线裁剪的话这里相当于二次兜底；
   *   - 数据库只存版本戳（毫秒时间戳），前端用它做 URL 参数破缓存。
   */
  @Post(':id/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async uploadAvatar(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype?: string; originalname?: string; size?: number },
  ) {
    if (!file?.buffer?.length) return { success: false, message: '没有收到图片文件' };
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    if (!this.isAdmin(req) && u.username !== this.me(req)) return { success: false, message: '只能修改自己的头像' };

    let out: Buffer;
    try {
      const sharp = (await import('sharp')).default;
      out = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
        .webp({ quality: 88 })
        .toBuffer();
    } catch (err) {
      return { success: false, message: `图片处理失败：${(err as Error).message}` };
    }

    const dir = avatarDir();
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(join(dir, `${u.id}.webp`), out);

    const version = String(Date.now());
    await prisma.user.update({ where: { id: u.id }, data: { avatar: version } });
    return {
      success: true,
      data: {
        avatar: version,
        avatarUrl: `/api/avatar/${encodeURIComponent(u.username)}?v=${version}`,
      },
    };
  }

  /** 删除头像（恢复默认 logo） */
  @Delete(':id/avatar')
  async removeAvatar(@Req() req: Request, @Param('id') id: string) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    if (!this.isAdmin(req) && u.username !== this.me(req)) return { success: false, message: '只能修改自己的头像' };
    await fsp.unlink(join(avatarDir(), `${u.id}.webp`)).catch(() => undefined);
    await prisma.user.update({ where: { id: u.id }, data: { avatar: '' } });
    return { success: true };
  }

  /* ================= 两步验证（TOTP） ================= */

  /** 权限校验：本人或管理员 */
  private async totpTarget(req: Request, id: string) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { u: null, err: '用户不存在' };
    if (!this.isAdmin(req) && u.username !== this.me(req)) return { u: null, err: '只能操作自己的账户' };
    return { u, err: '' };
  }

  /** 生成密钥（暂不启用），返回二维码内容 */
  @Post(':id/totp/setup')
  async totpSetup(@Req() req: Request, @Param('id') id: string) {
    const { u, err } = await this.totpTarget(req, id);
    if (!u) return { success: false, message: err };
    if (u.totpEnabled) return { success: false, message: '该账户已启用两步验证，请先关闭再重新绑定' };
    const secret = generateTotpSecret();
    // 先加密存库：用户扫码后提交验证码时从这里取（避免中途刷新页面丢失）
    await prisma.user.update({
      where: { id: u.id },
      data: { totpSecret: CryptoService.encrypt(secret), totpEnabled: false },
    });
    return {
      success: true,
      data: {
        secret,
        uri: totpUri(secret, u.username),
        digits: 6,
        period: 30,
      },
    };
  }

  /** 提交动态码，启用两步验证 */
  @Post(':id/totp/enable')
  async totpEnable(@Req() req: Request, @Param('id') id: string, @Body() body: { code?: string }) {
    const { u, err } = await this.totpTarget(req, id);
    if (!u) return { success: false, message: err };
    if (u.totpEnabled) return { success: false, message: '该账户已启用两步验证' };
    if (!u.totpSecret) return { success: false, message: '请先生成密钥' };
    let secret = '';
    try {
      secret = CryptoService.decrypt(u.totpSecret);
    } catch {
      return { success: false, message: '密钥读取失败，请重新生成' };
    }
    if (!verifyTotp(secret, String(body.code || ''))) {
      return { success: false, message: '验证码错误或已过期' };
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { totpEnabled: true, backVerifiedAt: new Date() },
    });
    return { success: true };
  }

  /** 关闭两步验证（需当前动态码；本机也会顺带清掉密钥） */
  @Post(':id/totp/disable')
  async totpDisable(@Req() req: Request, @Param('id') id: string, @Body() body: { code?: string }) {
    const { u, err } = await this.totpTarget(req, id);
    if (!u) return { success: false, message: err };
    if (!u.totpEnabled) return { success: true };
    let secret = '';
    try {
      secret = CryptoService.decrypt(u.totpSecret || '');
    } catch {
      secret = '';
    }
    if (secret && !verifyTotp(secret, String(body.code || ''))) {
      return { success: false, message: '验证码错误或已过期' };
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { totpEnabled: false, totpSecret: '', backVerifiedAt: null },
    });
    return { success: true };
  }
}

/** 头像目录：<后端根>/uploads/avatars */
function avatarDir(): string {
  return backendSub('uploads', 'avatars');
}

/**
 * 头像访问（公开）—— 前端 logo / 用户列表都直接用它。
 * 路径固定为 uploads/avatars/<userId>.webp，按用户名反查 id；
 * 找不到文件时返回 404，前端自动回落到系统 logo。
 */
@Controller('api/avatar')
export class AvatarController {
  @Get(':username')
  async get(@Param('username') username: string, @Res() res: Response) {
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u || !u.avatar) return res.status(404).end();
    try {
      const buf = await fsp.readFile(join(avatarDir(), `${u.id}.webp`));
      res.setHeader('Content-Type', 'image/webp');
      // 版本戳在 URL 上（?v=），文件本身可以长缓存
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(buf);
    } catch {
      return res.status(404).end();
    }
  }
}
