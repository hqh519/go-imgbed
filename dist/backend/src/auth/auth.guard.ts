import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { SysConfigService } from '../settings/sysconfig.service';

export const SESSION_COOKIE = 'goimgbed_session';

/** 角色：admin=管理员 / user=普通用户 / super=超级管理员（仅 docker .env 配置，后台不可改） */
export type Role = 'admin' | 'user' | 'super';

export interface SessionPayload {
  user: string;
  role: Role;
  exp: number; // 过期时间戳（秒）
}

/**
 * 签发会话。
 * @param days 会话有效期（天）：与「安全设置 → 会话有效期」保持一致，
 *             0 / 未传表示永久会话（exp 记为 0，parseSession 不做服务端过期校验，
 *             由浏览器 Cookie 生命周期决定 —— 与 Cookie maxAge 不下发的语义对齐）。
 */
export function makeSession(user: string, role: Role, days?: number): { payload: string; sig: string } {
  const d = Number(days);
  const exp = Number.isFinite(d) && d > 0
    ? Math.floor(Date.now() / 1000) + Math.round(d * 24 * 3600)
    : 0; // 0 = 永久（不清浏览器 Cookie 就一直有效）
  const payload: SessionPayload = {
    user,
    role,
    exp,
  };
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { payload: raw, sig: CryptoService.sign(raw) };
}

export function parseSession(cookieValue: string | undefined): SessionPayload | null {
  if (!cookieValue) return null;
  const idx = cookieValue.indexOf('.');
  if (idx <= 0) return null;
  const payload = cookieValue.slice(0, idx);
  const sig = cookieValue.slice(idx + 1);
  if (!CryptoService.verifySigned(payload, sig)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionPayload;
    // exp = 0 表示永久会话（「会话有效期」设为 0 天），只由 Cookie 本身控制生命周期
    if (session.exp > 0 && session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

/** 登录守卫：校验 HttpOnly 会话 Cookie */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) {
      res.status(401).json({ success: false, message: '未登录或会话已过期' });
      return false;
    }
    (req as Request & { session?: SessionPayload }).session = session;
    return true;
  }
}

/** 管理员守卫（管理员 / 超级管理员） */
@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) {
      res.status(401).json({ success: false, message: '未登录或会话已过期' });
      return false;
    }
    if (session.role !== 'admin' && session.role !== 'super') {
      res.status(403).json({ success: false, message: '需要管理员权限' });
      return false;
    }
    (req as Request & { session?: SessionPayload }).session = session;
    return true;
  }
}

/**
 * 后台登录守卫 —— 管理员与普通用户都可进入；具体能做什么由各接口内按
 * `session.role` 二次判定（普通用户只能访问自身账户的文件与文件夹）。
 */
@Injectable()
export class ManageAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) {
      res.status(401).json({ success: false, message: '未登录或会话已过期' });
      return false;
    }
    (req as Request & { session?: SessionPayload }).session = session;
    return true;
  }
}

/**
 * 取出当前会话（无会话返回 null）。
 *
 * 先取守卫注入的 `req.session`；守卫缺省时（例如 `/api/userConfig`、
 * `/api/directoryTree` 这类「登录与否都要能访问」的接口没有挂守卫）
 * 直接解析签名 Cookie —— 否则这些接口永远拿不到当前账户，
 * 会把「按账户隔离」的目录、渠道一律退化成全局视图（越权展示他人目录）。
 * 解析走 parseSession，签名无效/过期即视为未登录。
 */
export function currentSession(req: Request): SessionPayload | null {
  const injected = (req as Request & { session?: SessionPayload }).session;
  if (injected) return injected;
  return parseSession(req.cookies?.[SESSION_COOKIE]);
}

/** 是否管理员（admin / super） */
export function isAdminRole(role?: string): boolean {
  return role === 'admin' || role === 'super';
}

/**
 * 上传接口守卫 —— 与前端 `userRequired` 语义严格对齐：
 *   未配置用户认证码 → 允许匿名上传（页面本来就无需登录）
 *   已配置用户认证码 → 必须携带有效会话（admin / user 均可）
 *
 * 这样「安全设置里清空用户认证码 = 上传页免登录」才真正生效，
 * 不会出现「前端放行、后端 401」的割裂。
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private sysConfig: SysConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const codeRequired = await this.userCodeRequired();
    if (!codeRequired) return true;

    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) {
      res.status(401).json({ success: false, message: '未登录或会话已过期' });
      return false;
    }
    (req as Request & { session?: SessionPayload }).session = session;
    return true;
  }

  private async userCodeRequired(): Promise<boolean> {
    try {
      // 用户账户体系统一登录后：只要系统中存在任何可登录账户（用户表有记录、
      // 或安全设置里配置过管理员/用户密码、或环境变量提供了初始账号），
      // 上传页即要求登录 —— 前端 sessionCheck 的 userRequired 与此同源。
      if ((await prisma.user.count()) > 0) return true;
      const raw = await this.sysConfig.readSecurityRaw();
      if (String(raw?.auth?.admin?.adminPassword || '')) return true;
      if (String(raw?.auth?.user?.authCode || '')) return true;
      return !!(process.env.ADMIN_USER || process.env.ADMIN_PASSWORD);
    } catch {
      return true; // 配置读取异常时按「需要认证」处理，宁严勿松
    }
  }
}

export { NextFunction };
