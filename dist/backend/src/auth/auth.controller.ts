import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { hashSecret, isHashedSecret, matchSecret, safeEqual } from '../common/secret';
import { SESSION_COOKIE, Role, currentSession, makeSession, parseSession } from './auth.guard';
import { SysConfigService } from '../settings/sysconfig.service';

/**
 * 认证接口 —— 统一账户体系。
 *
 *   POST /api/auth/login        { username, password }  统一登录（管理员 / 普通用户 / 超级管理员）
 *   POST /api/auth/adminLogin   { username, password }  兼容旧前端：等价于 login
 *   GET  /api/auth/sessionCheck                         会话与「是否需要认证」探测
 *   POST /api/auth/logout
 *   POST /api/auth/superUpdateAdmin                     超级管理员专用：修改管理员用户名/密码
 *
 * 账户来源优先级：
 *   1. 超级管理员 —— 仅由 docker 环境变量 SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD 定义，
 *      后台不可修改；用于初始管理员密码遗忘后的找回，登录后仅能修改管理员账户。
 *   2. users 表 —— 后台「用户管理」创建的账户（管理员 / 普通用户）。
 *   3. 安全设置 sysConfig:security —— 历史管理员账号（兼容保留，登录成功后自动升级为散列）。
 *   4. 环境变量 ADMIN_USER / ADMIN_PASSWORD —— 首次部署兜底。
 *
 * 说明：旧版「用户认证码(authCode)」已废弃，上传页改为用户名 + 密码登录；
 * 这里仍保留 authCode 登录入口作兼容，登录后角色为 user。
 */
@Controller('api/auth')
export class AuthController {
  constructor(private sysConfig: SysConfigService) {}

  /** 读取「安全设置」中的账号配置（原始值，含散列/历史明文） */
  private async authConfig(): Promise<any> {
    try {
      const raw = await this.sysConfig.readSecurityRaw();
      const auth = raw?.auth;
      return auth && typeof auth === 'object' ? auth : {};
    } catch {
      return {};
    }
  }

  /** 环境变量兜底的用户认证码（兼容两种历史键名） */
  private envAuthCode(): string {
    return process.env.AUTH_CODE || process.env.AUTH_MIKF || '';
  }

  /** 管理端账号是否已配置（安全设置 / 用户表 / 环境变量任一存在） */
  private async isAdminConfigured(auth: any): Promise<boolean> {
    if (String(auth?.admin?.adminPassword || '')) return true;
    if (process.env.ADMIN_USER || process.env.ADMIN_PASSWORD) return true;
    try {
      return (await prisma.user.count({ where: { role: 'admin' } })) > 0;
    } catch {
      return false;
    }
  }

  /** 是否存在可登录账户 → 上传页 / 后台是否需要登录 */
  private async isUserConfigured(auth: any): Promise<boolean> {
    if (String(auth?.admin?.adminPassword || '')) return true;
    if (String(auth?.user?.authCode || '')) return true;
    if (process.env.ADMIN_USER || process.env.ADMIN_PASSWORD) return true;
    try {
      return (await prisma.user.count()) > 0;
    } catch {
      return false;
    }
  }

  /**
   * 统一账户校验：超管 → users 表 → 安全设置管理员 → 环境变量初始账号。
   * 返回账户信息或 null。
   */
  private async verifyAccount(
    username: string,
    password: string,
  ): Promise<{ user: string; role: Role; enabled: boolean; canEdit: boolean; canDelete: boolean } | null> {
    if (!username || !password) return null;

    // 1) 超级管理员（仅 .env 配置）
    const suUser = (process.env.SUPER_ADMIN_USERNAME || '').trim();
    const suPass = process.env.SUPER_ADMIN_PASSWORD || '';
    if (suUser && suPass && safeEqual(username, suUser) && matchSecret(password, suPass)) {
      return { user: suUser, role: 'super', enabled: true, canEdit: true, canDelete: true };
    }

    // 2) users 表
    const u = await prisma.user.findUnique({ where: { username } });
    if (u) {
      if (!u.enabled) return null;
      const info = {
        user: u.username,
        // users 表里 role='admin' 的账户也归为普通用户体系，
        // 系统管理员唯一（见 verifyAccount 第 3 步 / 安全设置「管理端认证」）。
        role: (u.role === 'admin' ? 'admin' : 'user') as Role,
        enabled: u.enabled,
        canEdit: u.canEdit,
        canDelete: u.canDelete,
      };
      if (CryptoService.verifyPassword(password, u.passwordHash)) return info;
      /*
       * 普通用户登入密码的双通道：
       *   ① 用户管理里为该账户设置的自身密码（上面已验）
       *   ② 安全设置「用户端认证」里配置的密码
       * 两者任一匹配即可登入。密码②只对「普通用户账户」开放 ——
       * 管理员账户不认用户端认证，避免普通用户端口令越权登入管理端。
       *
       * 注意：对外 WebDAV 的 Basic 鉴权走 WebDavController.authenticate，
       * 那里**只认账户自身的用户名 + 密码**，不接受用户端认证口令。
       */
      if (info.role === 'user' && (await this.matchUserAuthCode(password))) {
        return info;
      }
      return null;
    }

    // 3) 安全设置里的管理员账号
    const auth = await this.authConfig();
    const cfgPass = String(auth?.admin?.adminPassword || '');
    if (cfgPass) {
      const cfgUser = String(auth?.admin?.adminUsername || '').trim() || 'admin';
      if (safeEqual(username, cfgUser) && matchSecret(password, cfgPass)) {
        this.upgradeAdminSecret(cfgPass).catch(() => undefined);
        return { user: cfgUser, role: 'admin', enabled: true, canEdit: true, canDelete: true };
      }
      return null;
    }

    // 4) 环境变量初始账号
    const envUser = process.env.ADMIN_USER || 'admin';
    const envPass = process.env.ADMIN_PASSWORD || 'go-imgbed';
    if (safeEqual(username, envUser) && safeEqual(password, envPass)) {
      return { user: envUser, role: 'admin', enabled: true, canEdit: true, canDelete: true };
    }
    return null;
  }

  /**
   * 「安全设置 → 用户端认证」口令校验（不含用户名）。
   *
   * 用途：普通用户登入的第二种密码通道 —— 普通用户既可用「用户管理」里
   * 自己账户的密码登入，也可以用这里配置的用户端认证口令登入。
   * 取值优先级：安全设置 auth.user.authCode > 环境变量 AUTH_CODE / AUTH_MIKF。
   */
  private async matchUserAuthCode(input: string): Promise<boolean> {
    if (!input) return false;
    const auth = await this.authConfig();
    const cfg = String(auth?.user?.authCode || '');
    if (cfg) {
      if (!matchSecret(input, cfg)) return false;
      this.upgradeUserSecret(cfg).catch(() => undefined);
      return true;
    }
    const env = this.envAuthCode();
    return !!env && safeEqual(input, env);
  }

  /** 用户认证码校验（兼容旧上传页 authCode 登录） */
  private async verifyAuthCode(authCode: string): Promise<boolean> {
    return this.matchUserAuthCode(authCode);
  }

  /** 把历史明文管理端口令原地升级为散列 */
  private async upgradeAdminSecret(stored: string): Promise<void> {
    if (isHashedSecret(stored)) return;
    const raw = await this.sysConfig.readSecurityRaw();
    const cur = String(raw?.auth?.admin?.adminPassword || '');
    if (!cur || isHashedSecret(cur)) return;
    raw.auth.admin.adminPassword = hashSecret(cur);
    await this.sysConfig.writeSecurityRaw(raw);
  }

  /** 把历史明文用户认证码原地升级为散列 */
  private async upgradeUserSecret(stored: string): Promise<void> {
    if (isHashedSecret(stored)) return;
    const raw = await this.sysConfig.readSecurityRaw();
    const cur = String(raw?.auth?.user?.authCode || '');
    if (!cur || isHashedSecret(cur)) return;
    raw.auth.user.authCode = hashSecret(cur);
    await this.sysConfig.writeSecurityRaw(raw);
  }

  /** 会话有效期（天）：读取「安全设置 → 会话有效期（天）」，0 表示永久 */
  private async sessionDays(role: Role): Promise<number> {
    try {
      const security: any = await this.sysConfig.get('security');
      const days = Number(
        role === 'user'
          ? security?.access?.userSessionMaxAge ?? 14
          : security?.access?.adminSessionMaxAge ?? 14,
      );
      if (!Number.isFinite(days) || days < 0) return 14;
      return Math.floor(days);
    } catch {
      return 14;
    }
  }

  /**
   * 会话有效期：读取「安全设置 → 会话有效期（天）」。
   * 配置 N 天 → Cookie maxAge 与服务端 exp 均按 N 天签发，
   * 保证「设置 365 天就 365 天不掉线」（除非清 Cookie / 手动退出）。
   * 0（永久）→ 下发 10 年长度的持久 Cookie，服务端不做过期校验。
   */
  private async sessionMaxAge(role: Role): Promise<number | undefined> {
    const days = await this.sessionDays(role);
    if (days <= 0) return 10 * 365 * 24 * 3600 * 1000;
    return Math.round(days * 24 * 3600 * 1000);
  }

  /**
   * 「Secure 模式」（安全设置 → 会话安全策略）：开启后会话 Cookie 只随 HTTPS 传输。
   *
   * 注意：仅在请求确实走 HTTPS 时才打 Secure 标记 —— http 部署（内网 IP 直连、
   * 未上证书的测试环境）一旦带上 Secure，浏览器会直接丢弃 Cookie，
   * 表现为「登录成功却立刻掉线」。此开关此前只存不用，等于失效，这里补上。
   */
  private async sessionSecureEnabled(): Promise<boolean> {
    try {
      const security: any = await this.sysConfig.get('security');
      return security?.access?.sessionSecure === true;
    } catch {
      return false;
    }
  }

  /** 请求是否走 HTTPS（兼容反向代理的 x-forwarded-proto） */
  private isHttps(req?: Request): boolean {
    if (!req) return false;
    if ((req as any).secure) return true;
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return proto === 'https';
  }

  private async setSession(res: Response, user: string, role: Role, req?: Request) {
    // 服务端 exp 与 Cookie maxAge 使用同一份「会话有效期」配置，
    // 避免出现「Cookie 还在、服务端会话已过期」的提前掉线
    const days = await this.sessionDays(role);
    const { payload, sig } = makeSession(user, role, days);
    const maxAge = await this.sessionMaxAge(role);
    const opts: Record<string, unknown> = { httpOnly: true, sameSite: 'lax', path: '/' };
    if (maxAge !== undefined) opts.maxAge = maxAge;
    if ((await this.sessionSecureEnabled()) && this.isHttps(req)) opts.secure = true;
    res.cookie(SESSION_COOKIE, `${payload}.${sig}`, opts);
  }

  /** 统一登录：用户名 + 密码 */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { username?: string; password?: string; authCode?: string },
    @Res() res: Response,
    @Req() req?: Request,
  ) {
    // 兼容旧上传页：只传 authCode
    if (!body.username && body.authCode) {
      if (!(await this.verifyAuthCode(body.authCode))) {
        return res.status(401).json({ success: false, message: '认证码错误' });
      }
      await this.setSession(res, 'user', 'user', req);
      return res.json({ success: true, data: { type: 'user', role: 'user', username: 'user' } });
    }

    const username = (body.username || '').trim();
    const account = await this.verifyAccount(username, body.password || '');
    if (!account) return res.status(401).json({ success: false, message: '用户名或密码错误' });
    await this.setSession(res, account.user, account.role, req);
    return res.json({
      success: true,
      data: {
        type: account.role === 'user' ? 'user' : 'admin',
        role: account.role,
        username: account.user,
      },
    });
  }

  /** 兼容旧接口名：行为与 login 完全一致 */
  @Post('adminLogin')
  @HttpCode(200)
  async adminLogin(
    @Body() body: { username?: string; password?: string },
    @Res() res: Response,
    @Req() req?: Request,
  ) {
    return this.login(body, res, req);
  }

  /**
   * 会话探测：前端路由守卫读取【顶层】字段（adminRequired / userRequired / valid / authType）。
   * 新增 role / canEdit / canDelete，供前端按角色渲染。
   */
  @Get('sessionCheck')
  async sessionCheck(@Req() req: Request) {
    const auth = await this.authConfig();
    const adminRequired = await this.isAdminConfigured(auth);
    const userRequired = await this.isUserConfigured(auth);

    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    const valid = !!session;
    const role: Role | null = session ? session.role : null;

    // 权限：普通用户取账户配置；管理员/超管默认全权
    let canEdit = true;
    let canDelete = true;
    if (session && session.role === 'user') {
      const u = await prisma.user.findUnique({ where: { username: session.user } });
      canEdit = u?.canEdit ?? true;
      canDelete = u?.canDelete ?? true;
    }

    return {
      success: true,
      adminRequired,
      userRequired,
      valid,
      authType: role,
      role,
      username: session?.user ?? null,
      canEdit,
      canDelete,
      data: {
        isLoggedIn: valid,
        isAdmin: role === 'admin' || role === 'super',
        isSuper: role === 'super',
        username: session?.user ?? null,
        role,
        canEdit,
        canDelete,
        adminRequired,
        userRequired,
        valid,
        authType: role,
      },
    };
  }

  /**
   * 超级管理员专用：修改管理员的用户名 / 密码。
   * 用于「初始管理员密码被改后遗忘」的找回场景；超级管理员除此之外无其它权限。
   */
  @Post('superUpdateAdmin')
  @HttpCode(200)
  async superUpdateAdmin(
    @Body() body: { username?: string; password?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const s = currentSession(req);
    if (!s || s.role !== 'super') {
      return res.status(403).json({ success: false, message: '需要超级管理员权限' });
    }
    const raw = await this.sysConfig.readSecurityRaw();
    raw.auth = raw.auth || {};
    raw.auth.admin = raw.auth.admin || {};
    const newUser = String(body.username || '').trim();
    const newPass = String(body.password || '');
    if (newUser) raw.auth.admin.adminUsername = newUser;
    if (newPass) raw.auth.admin.adminPassword = hashSecret(newPass);
    await this.sysConfig.writeSecurityRaw(raw);

    // 同步更新 users 表中首个管理员账户（若存在），保证两条路径都能登录
    if (newUser || newPass) {
      const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
      if (admin) {
        await prisma.user.update({
          where: { id: admin.id },
          data: {
            username: newUser || admin.username,
            passwordHash: newPass ? CryptoService.hashPassword(newPass) : admin.passwordHash,
          },
        });
      }
    }
    return res.json({ success: true, message: '管理员账户已更新' });
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res() res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return res.json({ success: true });
  }
}
