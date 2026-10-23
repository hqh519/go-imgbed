import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { hashSecret, isHashedSecret, matchSecret, safeEqual } from '../common/secret';
import { SESSION_COOKIE, Role, currentSession, frontValid, makeSession, parseSession, totpValid } from './auth.guard';
import { SysConfigService } from '../settings/sysconfig.service';
import { verifyTotp } from '../common/totp';

/** 会话有效期默认值（天）—— 账户未设置时生效（v202610221824） */
const DEFAULT_SESSION_DAYS = 7;

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

  /** 是否存在可登录账户 → 上传页 / 后台是否需要登录（v202610221824 起只看 users 表） */
  private async isUserConfigured(_auth?: any): Promise<boolean> {
    try {
      return (await prisma.user.count()) > 0;
    } catch {
      return false;
    }
  }

  /**
   * 统一账户校验：超管 → users 表 → 历史环境变量兜底。
   * 返回账户信息或 null。
   *
   * v202610221824 起账户体系收敛：
   *   - 「上传密码」通道彻底下线，登录只认账户自身的用户名 + 密码；
   *   - 安全设置里的「管理端认证」不再参与登录（管理员就是 users 表里 role='admin' 的那条记录），
   *     仅当 users 表里一条管理员都没有时才作为历史兜底，避免老部署升级后直接锁死；
   *   - 用户名 / 密码的管理统一收到「用户管理」里。
   */
  private async verifyAccount(
    username: string,
    password: string,
  ): Promise<{
    user: string;
    role: Role;
    enabled: boolean;
    canEdit: boolean;
    canDelete: boolean;
    totpEnabled: boolean;
    frontDays: number;
    backDays: number;
  } | null> {
    if (!username || !password) return null;

    // 1) 超级管理员（仅 .env 配置）
    const suUser = (process.env.SUPER_ADMIN_USERNAME || '').trim();
    const suPass = process.env.SUPER_ADMIN_PASSWORD || '';
    if (suUser && suPass && safeEqual(username, suUser) && matchSecret(password, suPass)) {
      return {
        user: suUser,
        role: 'super',
        enabled: true,
        canEdit: true,
        canDelete: true,
        totpEnabled: false,
        frontDays: 7,
        backDays: 7,
      };
    }

    // 2) users 表（管理员与普通用户都在这里）
    const u = await prisma.user.findUnique({ where: { username } });
    if (u) {
      if (!u.enabled) return null;
      if (!CryptoService.verifyPassword(password, u.passwordHash)) return null;
      return {
        user: u.username,
        role: (u.role === 'admin' ? 'admin' : 'user') as Role,
        enabled: u.enabled,
        canEdit: u.canEdit,
        canDelete: u.canDelete,
        totpEnabled: u.totpEnabled,
        frontDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
        backDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
      };
    }

    // 3) 历史兜底：users 表里没有任何管理员时，才认安全设置里的管理端账号
    const hasAdmin = (await prisma.user.count({ where: { role: 'admin' } })) > 0;
    if (!hasAdmin) {
      const auth = await this.authConfig();
      const cfgPass = String(auth?.admin?.adminPassword || '');
      if (cfgPass) {
        const cfgUser = String(auth?.admin?.adminUsername || '').trim() || 'admin';
        if (safeEqual(username, cfgUser) && matchSecret(password, cfgPass)) {
          this.upgradeAdminSecret(cfgPass).catch(() => undefined);
          return {
            user: cfgUser,
            role: 'admin',
            enabled: true,
            canEdit: true,
            canDelete: true,
            totpEnabled: false,
            frontDays: DEFAULT_SESSION_DAYS,
            backDays: DEFAULT_SESSION_DAYS,
          };
        }
        return null;
      }
      // 4) 环境变量初始账号（同上，仅全新空库时生效）
      const envUser = process.env.ADMIN_USER || 'admin';
      const envPass = process.env.ADMIN_PASSWORD || 'go-imgbed';
      if (safeEqual(username, envUser) && safeEqual(password, envPass)) {
        return {
          user: envUser,
          role: 'admin',
          enabled: true,
          canEdit: true,
          canDelete: true,
          totpEnabled: false,
          frontDays: DEFAULT_SESSION_DAYS,
          backDays: DEFAULT_SESSION_DAYS,
        };
      }
    }
    return null;
  }

  /*
   * 「用户端认证 / 上传密码」通道已于 v202610221824 下线：
   * 用户登录只认自身账户的用户名 + 密码，不再接受安全设置里配置的公共上传口令。
   * 相关的 matchUserAuthCode / verifyAuthCode / upgradeUserSecret 一并删除。
   */

  /** 把历史明文管理端口令原地升级为散列 */
  private async upgradeAdminSecret(stored: string): Promise<void> {
    if (isHashedSecret(stored)) return;
    const raw = await this.sysConfig.readSecurityRaw();
    const cur = String(raw?.auth?.admin?.adminPassword || '');
    if (!cur || isHashedSecret(cur)) return;
    raw.auth.admin.adminPassword = hashSecret(cur);
    await this.sysConfig.writeSecurityRaw(raw);
  }

  /**
   * 会话有效期（天）——
   * v202610221824 起从「安全设置 → 会话安全策略」迁移到「用户管理 → 每个账户」：
   *   frontSessionDays 管前端页（上传页/画廊/历史记录），到期需重新登录；
   *   backSessionDays  管后台页（系统管理/用户管理/文件管理），到期只需重新做两步验证。
   * 账户未设置（null）时按 DEFAULT_SESSION_DAYS（7 天）处理，0 表示永久。
   */
  private sessionDaysOf(days: number | null | undefined): number {
    const n = Number(days);
    if (!Number.isFinite(n)) return DEFAULT_SESSION_DAYS;
    if (n === 0) return 0;
    if (n < 0) return DEFAULT_SESSION_DAYS;
    return Math.floor(n);
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

  /**
   * 下发会话 Cookie。
   * @param verified 本次是否已通过两步验证（未启用 2FA 的账户恒 true）
   */
  private async setSession(
    res: Response,
    account: { user: string; role: Role; totpEnabled?: boolean; frontDays?: number; backDays?: number },
    req?: Request,
    verified = false,
  ) {
    const { payload, sig, maxAge } = makeSession(account.user, account.role, {
      frontDays: this.sessionDaysOf(account.frontDays),
      backDays: this.sessionDaysOf(account.backDays),
      totpEnabled: !!account.totpEnabled,
      verified: account.totpEnabled ? verified : true,
    });
    const opts: Record<string, unknown> = { httpOnly: true, sameSite: 'lax', path: '/' };
    if (maxAge > 0) opts.maxAge = maxAge;
    if ((await this.sessionSecureEnabled()) && this.isHttps(req)) opts.secure = true;
    res.cookie(SESSION_COOKIE, `${payload}.${sig}`, opts);
  }

  /**
   * 统一登录：用户名 + 密码。
   *
   * 启用两步验证的账户登录成功后 `needTotp: true` —— 此时会话已建立但 `tv=false`，
   * 只能访问前端页面；进后台会被 guard 拦下要求输入动态码（POST /api/auth/totp/verify）。
   */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { username?: string; password?: string; code?: string },
    @Res() res: Response,
    @Req() req?: Request,
  ) {
    const username = (body.username || '').trim();
    const account = await this.verifyAccount(username, body.password || '');
    if (!account) return res.status(401).json({ success: false, message: '用户名或密码错误' });

    // 登录时一并提交了动态码 → 直接完成两步验证（减少一次交互）
    let verified = false;
    if (account.totpEnabled && body.code) {
      verified = await this.checkTotp(account.user, String(body.code));
    }
    await this.setSession(res, account, req, verified);
    return res.json({
      success: true,
      data: {
        type: account.role === 'user' ? 'user' : 'admin',
        role: account.role,
        username: account.user,
        // 启用了 2FA 且本次未带/未通过动态码 → 前端弹输入框
        needTotp: account.totpEnabled && !verified,
      },
    });
  }

  /** 兼容旧接口名：行为与 login 完全一致 */
  @Post('adminLogin')
  @HttpCode(200)
  async adminLogin(
    @Body() body: { username?: string; password?: string; code?: string },
    @Res() res: Response,
    @Req() req?: Request,
  ) {
    return this.login(body, res, req);
  }

  /** 校验某账户的动态码（内部：读取加密存储的 TOTP 密钥） */
  private async checkTotp(username: string, code: string): Promise<boolean> {
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u || !u.totpEnabled || !u.totpSecret) return false;
    let secret = '';
    try {
      secret = CryptoService.decrypt(u.totpSecret);
    } catch {
      return false;
    }
    const ok = verifyTotp(secret, code);
    if (ok) {
      await prisma.user.update({ where: { id: u.id }, data: { backVerifiedAt: new Date() } });
    }
    return ok;
  }

  /**
   * 两步验证（后台门禁）：当前会话已登录但未通过 2FA / 2FA 状态过期时调用。
   * 校验通过后重新签发会话（tva 刷新），不需要重新输入密码。
   */
  @Post('totp/verify')
  @HttpCode(200)
  async totpVerify(@Body() body: { code?: string }, @Req() req: Request, @Res() res: Response) {
    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) return res.status(401).json({ success: false, message: '未登录或会话已过期' });
    const u = await prisma.user.findUnique({ where: { username: session.user } });
    if (!u) return res.status(401).json({ success: false, message: '账户不存在' });
    if (!u.totpEnabled) {
      // 没启用 2FA：直接刷新会话即可（避免前端卡在验证框）
      await this.setSession(res, { user: u.username, role: session.role, totpEnabled: false }, req, true);
      return res.json({ success: true, data: { verified: true } });
    }
    const ok = await this.checkTotp(u.username, String(body.code || ''));
    if (!ok) return res.status(400).json({ success: false, message: '验证码错误或已过期' });
    await this.setSession(
      res,
      {
        user: u.username,
        role: session.role,
        totpEnabled: true,
        frontDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
        backDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
      },
      req,
      true,
    );
    return res.json({ success: true, data: { verified: true } });
  }

  /** 当前会话的两步验证状态（前端弹框前先问一次，避免无谓弹窗） */
  @Get('totp/status')
  async totpStatus(@Req() req: Request) {
    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) return { success: true, data: { loggedIn: false, enabled: false, required: false } };
    const u = await prisma.user.findUnique({ where: { username: session.user } });
    const enabled = !!u?.totpEnabled;
    return {
      success: true,
      data: {
        loggedIn: true,
        enabled,
        // required = 已启用 2FA 但本次会话没通过验证 / 验证状态已过后端会话窗
        required: enabled && !totpValid(session),
      },
    };
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
    // 前端会话到期（fexp）即视为未登录 —— 需要重新输入用户名密码
    const valid = !!session && frontValid(session);
    const role: Role | null = session ? session.role : null;

    // 权限 / 资料：普通用户取账户配置；管理员/超管默认全权
    let canEdit = true;
    let canDelete = true;
    let totpEnabled = !!session?.t2;
    let totpRequired = false;
    let profile: Record<string, unknown> = {};
    if (session) {
      const u = await prisma.user.findUnique({ where: { username: session.user } });
      if (u) {
        canEdit = u.canEdit ?? true;
        canDelete = u.canDelete ?? true;
        totpEnabled = u.totpEnabled;
        totpRequired = u.totpEnabled && !totpValid(session);
        profile = {
          username: u.username,
          nickname: u.nickname || u.username,
          email: u.email || '',
          role: u.role,
          avatar: u.avatar || '',
          avatarUrl: u.avatar ? `/api/avatar/${encodeURIComponent(u.username)}?v=${encodeURIComponent(u.avatar)}` : '',
          frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
          backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
        };
      }
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
      // 已启用 2FA 且当前会话未通过验证 → 前端进后台前弹动态码输入框
      totpEnabled,
      totpRequired,
      profile,
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
        totpEnabled,
        totpRequired,
        profile,
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
