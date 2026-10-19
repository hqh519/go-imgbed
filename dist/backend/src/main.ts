// 必须最先导入（副作用模块）：在 PrismaClient 构造之前把 backend/.env 注入 process.env
import './common/load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { AppModule } from './app.module';
import { ChannelsService } from './channels/channels.controller';
import { prisma } from './common/prisma';
import { SESSION_COOKIE, parseSession } from './auth/auth.guard';
import { rateLimiter } from './common/rate-limit';
import { appLog } from './common/app-log';
import { CryptoService } from './common/crypto.service';
import { backendSub, frontendAppDir } from './common/project-paths';

// 接管 console —— 此后所有 console.log/warn/error 都会进入后台「系统日志」
appLog.patchConsole();

/** 黑白名单缓存（避免每请求查库） */
let listCache = { at: 0, white: [] as string[], block: [] as string[], enabled: false };

async function loadLists() {
  if (Date.now() - listCache.at < 5000) return listCache;
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['whiteIpList', 'blockIpList', 'securityEnabled'] } },
  });
  const raw = (k: string) => rows.find((r) => r.key === k)?.value || '';
  const parse = (v: string): string[] => {
    if (!v) return [];
    try {
      const j = JSON.parse(v);
      return Array.isArray(j) ? j.map(String) : [];
    } catch {
      return v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    }
  };
  listCache = {
    at: Date.now(),
    white: parse(raw('whiteIpList')),
    block: parse(raw('blockIpList')),
    enabled: raw('securityEnabled') === 'true',
  };
  return listCache;
}

/**
 * 进程级兜底：单个请求的未捕获异常/未处理 Promise 不应导致整个图床服务退出。
 * 仅记录日志，保持服务可用（图床是长驻服务，漂掉一次就意味着所有外链 502）。
 */
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

function clientIp(req: express.Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ip = fwd || req.socket.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

function isLoopback(req: express.Request): boolean {
  const ip = clientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

/**
 * 首次安装写入初始管理员账户（幂等）。
 *
 * 取值：ADMIN_USER / ADMIN_PASSWORD，未配置时用 admin / go-imgbed。
 * 只有在「users 表里没有任何管理员」时才写；已有管理员 → 直接返回，
 * 保证后台改过的账号密码不会被下次启动覆盖。
 */
async function ensureInitialAdmin(): Promise<void> {
  const adminCount = await prisma.user.count({ where: { role: 'admin' } });
  if (adminCount > 0) return;

  const username = (process.env.ADMIN_USER || 'admin').trim() || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'go-imgbed';
  const hash = CryptoService.hashPassword(password);

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    // 同名账户存在但不是管理员（历史数据）→ 提升为管理员并同步密码
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: 'admin', passwordHash: hash, uploadPassword: hash, enabled: true, canEdit: true, canDelete: true },
    });
    console.log(`[seed] 已把账户「${username}」提升为管理员（来自 ADMIN_USER / ADMIN_PASSWORD）`);
    return;
  }

  await prisma.user.create({
    data: {
      username,
      passwordHash: hash,
      uploadPassword: hash,
      nickname: '管理员',
      role: 'admin',
      enabled: true,
      canEdit: true,
      canDelete: true,
    },
  });
  const fromEnv = !!(process.env.ADMIN_USER || process.env.ADMIN_PASSWORD);
  console.log(
    `[seed] 已创建初始管理员账户：${username}` +
      `（密码取自 ${fromEnv ? 'ADMIN_PASSWORD' : '默认值 go-imgbed'}，请登录后台后立即修改）`,
  );
}

async function bootstrap() {
  const server = express();
  // 反代场景：信任 X-Forwarded-Host / X-Forwarded-Proto
  server.set('trust proxy', true);
  /**
   * 请求到达时刻（毫秒）—— 必须挂在**所有**中间件之前：
   * 上传接口的 body 由 multer 先收完才进 handler，等 handler 再取时间会漏掉
   * 「客户端 → 服务端」的传输耗时，导致详情页「上传时长 / 上传速度」偏小。
   */
  server.use((req, _res, next) => {
    (req as unknown as { _arrivedAt?: number })._arrivedAt = Date.now();
    next();
  });
  server.use(cookieParser());
  // S3 协议接入（/s3/*）：请求体是对象的原始字节流，必须先于 JSON 解析器注册
  server.use('/s3', express.raw({ type: '*/*', limit: '200mb' }));

  /**
   * 对外 WebDAV（/dav/*）—— 必须在 CORS 预检与 body 解析器之前接管：
   *
   *  1) 挂载前必发 OPTIONS 探测能力头。Nest 的 enableCors() 会把 OPTIONS 当成
   *     CORS 预检直接以 204 短路（响应里完全没有 `DAV:` / `MS-Author-Via`），
   *     Windows 资源管理器 / RaiDrive / Cyberduck 据此判定「对方不是 WebDAV 服务」
   *     → 外部配置测试失败。这里显式应答 OPTIONS（不带鉴权，客户端探测时还没有凭据）。
   *
   *  2) PROPFIND 的 XML body 与 PUT 的二进制 body 不能被 JSON / text 解析器提前吃掉
   *     （PUT 一个 .json / .txt 文件时会命中 express.json / express.text，
   *      流被消费后 readBody() 会永久等不到数据 → 请求挂死）。
   *     统一在 /dav 上用 raw 收进 Buffer，body-parser 的 _body 标记会让后续解析器跳过。
   */
  server.use('/dav', (req, res, next) => {
    const method = String(req.method || '').toUpperCase();
    if (method === 'OPTIONS') {
      res.setHeader('DAV', '1,2');
      res.setHeader('MS-Author-Via', 'DAV');
      res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL');
      res.setHeader('Content-Length', '0');
      return res.status(200).end();
    }
    next();
  });
  server.use('/dav', express.raw({ type: '*/*', limit: '200mb' }));

  // 限制请求体大小（上传走 multer 例外）
  server.use(express.json({ limit: '2mb' }));
  // 黑白名单等接口以纯文本 body 提交（fetch 未设置 Content-Type 时默认为 text/plain）
  server.use(express.text({ type: ['text/plain'], limit: '1mb' }));

  /**
   * 黑白名单拦截（必须先于 Nest 路由注册才会生效）。
   * 三道保险避免自锁：默认关闭、本地回环豁免、已登录会话豁免。
   */
  server.use((req, res, next) => {
    loadLists()
      .then((lists) => {
        if (!lists.enabled) return next();
        if (isLoopback(req)) return next();
        if (parseSession(req.cookies?.[SESSION_COOKIE])) return next();
        const ip = clientIp(req);
        if (lists.block.includes(ip)) return res.status(403).send('Forbidden: IP blocked');
        if (lists.white.length > 0 && !lists.white.includes(ip)) {
          return res.status(403).send('Forbidden: IP not in whitelist');
        }
        next();
      })
      .catch(() => next());
  });

  // 静态资源必须先于 Nest 路由注册（Nest 的 404 会终止链路）
  // 顺序关键：前端应用目录在前，public 目录在后 —— 否则 public/index.html 会劫持首页
  //
  // 目录布局（v1.6.0 起固定为「源码 / 产物分离，产物与后端并列」）：
  //   <parent>/frontend/app   前端产物（vite 输出，含 index.html）
  //   <parent>/backend/...    后端（build/ 产物 + src/ 源码）
  // 其中 <parent> = debug/（开发）或 dist/（生产）或 /app（容器）。
  // 定位逻辑统一在 common/project-paths.ts，不再按 cwd 硬拼路径。
  const frontendDir = frontendAppDir();
  if (frontendDir) server.use(express.static(frontendDir));

  // SPA 历史路由回退：/dashboard、/systemConfig、/browse/xx 等深链接刷新时回落到 index.html。
  // 顺序关键：必须在静态资源之后（静态文件优先命中）、Nest 路由之前（Nest 的 404 会终止链路）；
  // 接口与文件分发路径一律放行给后端；带扩展名的请求直接 404，避免掩盖真实的资源缺失。
  const SPA_SKIP = /^\/(api|upload|file|random|dav|dev|s3)(\/|$)/;
  if (frontendDir) {
    server.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (SPA_SKIP.test(req.path)) return next();
      if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next();
      // 显式声明「只接受非 HTML」的请求不回落（例如脚本抓取 JSON 资源）
      const accept = req.headers.accept || '';
      if (accept && !accept.includes('*/*') && !accept.includes('text/html')) return next();
      return res.sendFile(join(frontendDir, 'index.html'));
    });
  }

  /**
   * 接口限流：防登录爆破、防上传灌图、防随机图/直链被刷。
   * 顺序关键 —— 放在静态资源与 SPA 回退之后：
   *   静态产物与页面导航已被前面的中间件响应，不会再进入限流器，
   *   这里只覆盖 /api/*、/upload、/file/* 等真正需要保护的动态请求。
   */
  server.use(rateLimiter());

  /**
   * HTTP 访问日志（后台「系统日志」页可见）。
   * 记录策略：所有写操作（上传/保存/删除）+ 任何 4xx/5xx + 慢请求；
   * 成功的 GET 跳过 —— 后台页面会轮询系统状态，否则日志会被轮询刷爆。
   */
  server.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      try {
        const ms = Date.now() - started;
        const status = res.statusCode;
        const isFile = req.path.startsWith('/file/');
        const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
        if (isFile && status < 400) return; // 直链访问量极大，正常请求不记
        if (!isWrite && status < 400 && ms < 3000) return; // 正常 GET 不记（防轮询刷屏）
        const line = `${req.method} ${req.originalUrl} → ${status} (${ms}ms)`;
        const ip = clientIp(req);
        if (status >= 500) appLog.error('http', line, undefined, ip);
        else if (status >= 400) appLog.warn('http', line, undefined, ip);
        else if (ms >= 3000) appLog.warn('http', `${line} [慢请求]`, undefined, ip);
        else appLog.info('http', line, undefined, ip);
      } catch {
        /* 日志失败不影响响应 */
      }
    });
    next();
  });

  // public/ 只放开发用测试页（upload-test.html），不占用 index.html
  const publicDir = backendSub('public');
  if (existsSync(publicDir)) server.use('/dev', express.static(publicDir));

  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: true, credentials: true });

  await app.init();

  // v2.0.0：数据库只支持 PostgreSQL，SQLite 时代的 PRAGMA 稳定性垫片（WAL /
  // busy_timeout / synchronous）已随 SQLite 双轨一并移除；PG 的并发控制由服务端自己管理。

  /*
   * 内置「本地存储」渠道：随启动幂等创建。
   * 必须放在 app.init() 之后（此时 Prisma 已连接、db push 已完成建表），
   * 且要在开始接请求之前 —— 否则首次安装的头几个请求会因找不到任何渠道而失败。
   */
  try {
    await app.get(ChannelsService).ensureBuiltinLocalChannel();
  } catch (err) {
    console.warn(`[local-channel] 内置本地存储渠道初始化失败：${(err as Error).message}`);
  }

  /*
   * 初始管理员账户（v2.0.0）：首次安装把 yaml/.env 里的管理员配置落成 users 表里的
   * 真实记录 —— 此后「用户管理」里能看到它，也能正常改密码/改权限。
   *
   *   · ADMIN_USER / ADMIN_PASSWORD 有配置 → 用配置值；
   *   · 都没配置 → 用默认 admin / go-imgbed；
   *   · 库里已存在管理员 → 完全不动（尊重后台改过的账号密码，重启不会回滚）。
   *
   * 说明：登录校验本身还有「环境变量兜底」通道（见 AuthController.verifyAccount），
   * 所以即使这一步失败，首次登录也不会被卡住；但落库后才是完整的初始数据。
   */
  try {
    await ensureInitialAdmin();
  } catch (err) {
    console.warn(`[seed] 初始管理员账户写入失败：${(err as Error).message}`);
  }

  // CONFIG_SECRET 缺失时 CryptoService 会退化成内置开发密钥 —— 渠道密钥虽能加密，
  // 但任何人拿到代码就能解开。首次部署必须显式配置，这里给出醒目告警。
  const secret = process.env.CONFIG_SECRET || '';
  if (!secret || /^(please-change|change-me)/.test(secret)) {
    console.warn(
      '[security] ⚠️ CONFIG_SECRET 未配置或仍是模板默认值：渠道密钥将使用内置开发密钥加密，' +
        '请尽快在 .env / compose 里设置随机长串（修改后已保存的渠道密钥需重新填写）。',
    );
  }

  const port = Number(process.env.PORT || 3618);
  await app.listen(port, '0.0.0.0');
  console.log(`go-imgbed 已启动: http://localhost:${port}`);
}

bootstrap();
