"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./common/load-env");
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const platform_express_1 = require("@nestjs/platform-express");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_1 = __importDefault(require("express"));
const path_1 = require("path");
const fs_1 = require("fs");
const app_module_1 = require("./app.module");
const channels_controller_1 = require("./channels/channels.controller");
const prisma_1 = require("./common/prisma");
const auth_guard_1 = require("./auth/auth.guard");
const rate_limit_1 = require("./common/rate-limit");
const app_log_1 = require("./common/app-log");
const crypto_service_1 = require("./common/crypto.service");
const project_paths_1 = require("./common/project-paths");
app_log_1.appLog.patchConsole();
let listCache = { at: 0, white: [], block: [], enabled: false };
async function loadLists() {
    if (Date.now() - listCache.at < 5000)
        return listCache;
    const rows = await prisma_1.prisma.setting.findMany({
        where: { key: { in: ['whiteIpList', 'blockIpList', 'securityEnabled'] } },
    });
    const raw = (k) => rows.find((r) => r.key === k)?.value || '';
    const parse = (v) => {
        if (!v)
            return [];
        try {
            const j = JSON.parse(v);
            return Array.isArray(j) ? j.map(String) : [];
        }
        catch {
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
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
});
function clientIp(req) {
    const fwd = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
    const ip = fwd || req.socket.remoteAddress || '';
    return ip.replace(/^::ffff:/, '');
}
function isLoopback(req) {
    const ip = clientIp(req);
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}
async function ensureInitialAdmin() {
    const adminCount = await prisma_1.prisma.user.count({ where: { role: 'admin' } });
    if (adminCount > 0)
        return;
    const username = (process.env.ADMIN_USER || 'admin').trim() || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'go-imgbed';
    const hash = crypto_service_1.CryptoService.hashPassword(password);
    const existing = await prisma_1.prisma.user.findUnique({ where: { username } });
    if (existing) {
        await prisma_1.prisma.user.update({
            where: { id: existing.id },
            data: { role: 'admin', passwordHash: hash, uploadPassword: hash, enabled: true, canEdit: true, canDelete: true },
        });
        console.log(`[seed] 已把账户「${username}」提升为管理员（来自 ADMIN_USER / ADMIN_PASSWORD）`);
        return;
    }
    await prisma_1.prisma.user.create({
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
    console.log(`[seed] 已创建初始管理员账户：${username}` +
        `（密码取自 ${fromEnv ? 'ADMIN_PASSWORD' : '默认值 go-imgbed'}，请登录后台后立即修改）`);
}
async function bootstrap() {
    const server = (0, express_1.default)();
    server.set('trust proxy', true);
    server.use((req, _res, next) => {
        req._arrivedAt = Date.now();
        next();
    });
    server.use((0, cookie_parser_1.default)());
    server.use('/s3', express_1.default.raw({ type: '*/*', limit: '200mb' }));
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
    server.use('/dav', express_1.default.raw({ type: '*/*', limit: '200mb' }));
    server.use(express_1.default.json({ limit: '2mb' }));
    server.use(express_1.default.text({ type: ['text/plain'], limit: '1mb' }));
    server.use((req, res, next) => {
        loadLists()
            .then((lists) => {
            if (!lists.enabled)
                return next();
            if (isLoopback(req))
                return next();
            if ((0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]))
                return next();
            const ip = clientIp(req);
            if (lists.block.includes(ip))
                return res.status(403).send('Forbidden: IP blocked');
            if (lists.white.length > 0 && !lists.white.includes(ip)) {
                return res.status(403).send('Forbidden: IP not in whitelist');
            }
            next();
        })
            .catch(() => next());
    });
    const frontendDir = (0, project_paths_1.frontendAppDir)();
    if (frontendDir)
        server.use(express_1.default.static(frontendDir));
    const SPA_SKIP = /^\/(api|upload|file|random|dav|dev|s3)(\/|$)/;
    if (frontendDir) {
        server.use((req, res, next) => {
            if (req.method !== 'GET' && req.method !== 'HEAD')
                return next();
            if (SPA_SKIP.test(req.path))
                return next();
            if (/\.[a-zA-Z0-9]+$/.test(req.path))
                return next();
            const accept = req.headers.accept || '';
            if (accept && !accept.includes('*/*') && !accept.includes('text/html'))
                return next();
            return res.sendFile((0, path_1.join)(frontendDir, 'index.html'));
        });
    }
    server.use((0, rate_limit_1.rateLimiter)());
    server.use((req, res, next) => {
        const started = Date.now();
        res.on('finish', () => {
            try {
                const ms = Date.now() - started;
                const status = res.statusCode;
                const isFile = req.path.startsWith('/file/');
                const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
                if (isFile && status < 400)
                    return;
                if (!isWrite && status < 400 && ms < 3000)
                    return;
                const line = `${req.method} ${req.originalUrl} → ${status} (${ms}ms)`;
                const ip = clientIp(req);
                if (status >= 500)
                    app_log_1.appLog.error('http', line, undefined, ip);
                else if (status >= 400)
                    app_log_1.appLog.warn('http', line, undefined, ip);
                else if (ms >= 3000)
                    app_log_1.appLog.warn('http', `${line} [慢请求]`, undefined, ip);
                else
                    app_log_1.appLog.info('http', line, undefined, ip);
            }
            catch {
            }
        });
        next();
    });
    const publicDir = (0, project_paths_1.backendSub)('public');
    if ((0, fs_1.existsSync)(publicDir))
        server.use('/dev', express_1.default.static(publicDir));
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_express_1.ExpressAdapter(server), { logger: ['error', 'warn', 'log'] });
    app.enableCors({ origin: true, credentials: true });
    await app.init();
    try {
        await app.get(channels_controller_1.ChannelsService).ensureBuiltinLocalChannel();
    }
    catch (err) {
        console.warn(`[local-channel] 内置本地存储渠道初始化失败：${err.message}`);
    }
    try {
        await ensureInitialAdmin();
    }
    catch (err) {
        console.warn(`[seed] 初始管理员账户写入失败：${err.message}`);
    }
    const secret = process.env.CONFIG_SECRET || '';
    if (!secret || /^(please-change|change-me)/.test(secret)) {
        console.warn('[security] ⚠️ CONFIG_SECRET 未配置或仍是模板默认值：渠道密钥将使用内置开发密钥加密，' +
            '请尽快在 .env / compose 里设置随机长串（修改后已保存的渠道密钥需重新填写）。');
    }
    const port = Number(process.env.PORT || 3618);
    await app.listen(port, '0.0.0.0');
    console.log(`go-imgbed 已启动: http://localhost:${port}`);
}
bootstrap();
