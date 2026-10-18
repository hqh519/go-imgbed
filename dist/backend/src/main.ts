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

async function bootstrap() {
  const server = express();
  // 反代场景：信任 X-Forwarded-Host / X-Forwarded-Proto
  server.set('trust proxy', true);
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

  /*
   * SQLite 运行参数（Web 服务标准姿势，多人并发前的稳定性垫片）：
   *   journal_mode = WAL       读写不互斥。持久属性（写进库文件头），一次设置永久生效
   *   busy_timeout = 5000      写锁冲突时等待 5s，而不是立刻抛 SQLITE_BUSY
   *   synchronous  = NORMAL    WAL 模式下安全/性能的平衡点
   * 注意：后两条是「连接级」参数，只对执行它们的连接生效；journal_mode=WAL 是库级持久属性，
   * 设置一次后所有连接（含 Prisma 连接池里的其余连接）都以 WAL 运行。
   * 不要试图在 DATABASE_URL 上加 `?connection_limit=1` 来简化 —— SQLite 的 schema engine
   * 不认 URL 查询参数，会把整串当文件路径（实测 os error 123，db push 直接失败）。
   * 换 PostgreSQL 时这三条对 PG 无意义，可用 DB_SKIP_PRAGMAS=1 跳过。
   *
   * v1.9.0 修正：PRAGMA 分两类返回语义，混用会抛错且**整段失效**。
   *   - `journal_mode=WAL` / `busy_timeout` 会返回一行结果 → 必须用 $queryRawUnsafe，
   *     用 $executeRawUnsafe 会报 "Execute returned results, which is not allowed in SQLite"
   *   - `synchronous=NORMAL` 不返回结果 → 用 $executeRawUnsafe
   * 早期三条挤在一个 try 里，第一条就抛错，导致后面两条（以及日志）从未执行。
   */
  if (process.env.DB_SKIP_PRAGMAS !== '1') {
    const applied: string[] = [];
    // ① WAL：库级持久属性，返回当前模式
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode?: string }>>('PRAGMA journal_mode=WAL;');
      applied.push(`journal_mode=${rows?.[0]?.journal_mode ?? '?'}`);
    } catch (err) {
      console.warn(`[pragmas] journal_mode 设置失败：${(err as Error).message}`);
    }
    // ② busy_timeout：连接级，返回当前值
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ timeout?: number }>>('PRAGMA busy_timeout=5000;');
      applied.push(`busy_timeout=${rows?.[0]?.timeout ?? 5000}`);
    } catch (err) {
      console.warn(`[pragmas] busy_timeout 设置失败：${(err as Error).message}`);
    }
    // ③ synchronous：连接级，不返回结果
    try {
      await prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL;');
      applied.push('synchronous=NORMAL');
    } catch (err) {
      console.warn(`[pragmas] synchronous 设置失败：${(err as Error).message}`);
    }
    if (applied.length) appLog.info('app', `SQLite PRAGMA：${applied.join(' / ')}`);
  }

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

  const port = Number(process.env.PORT || 3618);
  await app.listen(port, '0.0.0.0');
  console.log(`go-imgbed 已启动: http://localhost:${port}`);
}

bootstrap();
