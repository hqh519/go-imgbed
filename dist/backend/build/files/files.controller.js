"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserConfigController = exports.ManageController = exports.LinkController = void 0;
const common_1 = require("@nestjs/common");
const node_stream_1 = require("node:stream");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const sharp_1 = __importDefault(require("sharp"));
const prisma_1 = require("../common/prisma");
const adapter_factory_1 = require("../adapters/adapter.factory");
const local_adapter_1 = require("../adapters/local.adapter");
const channels_controller_1 = require("../channels/channels.controller");
const storage_channel_service_1 = require("../storage/storage-channel.service");
const upload_service_1 = require("../upload/upload.service");
const settings_service_1 = require("../settings/settings.service");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const auth_guard_1 = require("../auth/auth.guard");
const file_view_1 = require("../common/file-view");
const app_log_1 = require("../common/app-log");
const project_paths_1 = require("../common/project-paths");
function splitCsv(v) {
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
function wildcardParam(req) {
    const raw = String(req.params['0'] ?? '');
    if (!raw)
        return '';
    if (!/%[0-9a-fA-F]{2}/.test(raw))
        return raw;
    try {
        return decodeURIComponent(raw);
    }
    catch {
        return raw;
    }
}
function dirAllowed(dir, allowed) {
    if (!allowed.length)
        return true;
    const norm = (s) => s.trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
    const target = norm(dir || '');
    return allowed.some((a) => {
        const base = norm(a);
        if (!base)
            return true;
        return target === base || target.startsWith(`${base}/`);
    });
}
function frontendAsset(...segments) {
    const base = (0, project_paths_1.frontendAppDir)();
    if (!base)
        return null;
    const p = (0, node_path_1.join)(base, ...segments);
    if ((0, node_fs_1.existsSync)(p))
        return p;
    return null;
}
const DAY_MS = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');
function parseDayMs(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m)
        return NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function isoDayMs(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
let LinkController = class LinkController {
    settings;
    channels;
    sysConfig;
    constructor(settings, channels, sysConfig) {
        this.settings = settings;
        this.channels = channels;
        this.sysConfig = sysConfig;
    }
    domainAllowed(req, allowedDomains) {
        const referer = req.headers.referer;
        if (!referer)
            return true;
        let host = '';
        try {
            host = new URL(String(referer)).hostname.toLowerCase();
        }
        catch {
            return false;
        }
        const domains = String(allowedDomains || '')
            .split(/[\n,;]+/)
            .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/[/:].*$/, ''))
            .filter(Boolean);
        if (domains.length === 0)
            return true;
        const self = String(req.headers.host || '').split(':')[0].toLowerCase();
        if (self)
            domains.push(self);
        return domains.some((d) => host.includes(d));
    }
    renderBlocked(res, kind) {
        const asset = kind === 'block' ? 'BlockImg.png' : 'WhiteListOn.png';
        const page = kind === 'block' ? '/blockimg' : '/whiteliston';
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const local = frontendAsset('static', 'media', asset);
        if (local) {
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Disposition', 'inline');
            res.status(403);
            return res.sendFile(local);
        }
        return res.redirect(302, page);
    }
    async checkAccess(req, res, record) {
        const metas = (0, file_view_1.safeParse)(record.metas);
        const listType = metas.ListType || 'None';
        if (req.query.from === 'admin') {
            const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
            const mine = !!session?.user && session.user === (record.uploader || '');
            if (!(0, auth_guard_1.isAdminRole)(session?.role) && !mine) {
                res.setHeader('Cache-Control', 'private, no-store, max-age=0');
                res.status(401).send('Admin authentication required');
                return false;
            }
            res.setHeader('Cache-Control', 'private, max-age=86400');
            return true;
        }
        if (listType === 'Block' || metas.Label === 'adult') {
            this.renderBlocked(res, 'block');
            return false;
        }
        if (!(await this.linkAllowed(record.uploader))) {
            this.renderBlocked(res, 'block');
            return false;
        }
        if (listType === 'White')
            return true;
        const security = (await this.sysConfig.get('security'));
        const access = security?.access || {};
        if (access.whiteListMode && !this.domainAllowed(req, access.allowedDomains)) {
            this.renderBlocked(res, 'white');
            return false;
        }
        return true;
    }
    linkCache = new Map();
    async linkAllowed(uploader) {
        const u = String(uploader || '').trim();
        if (!u)
            return true;
        const hit = this.linkCache.get(u);
        const now = Date.now();
        if (hit && now - hit.at < 10_000)
            return hit.allowed;
        let allowed = true;
        try {
            const row = await prisma_1.prisma.user.findUnique({ where: { username: u }, select: { linkEnabled: true } });
            if (row)
                allowed = row.linkEnabled !== false;
        }
        catch {
            allowed = true;
        }
        this.linkCache.set(u, { allowed, at: now });
        return allowed;
    }
    absolutize(req, target) {
        const t = String(target || '').trim();
        if (!t)
            return '';
        if (/^https?:\/\//i.test(t))
            return t;
        const origin = `${req.protocol}://${req.get('host')}`;
        return t.startsWith('/') ? `${origin}${t}` : `${origin}/${t}`;
    }
    sendLocalFile(req, res, abs, record) {
        let stat;
        try {
            stat = (0, node_fs_1.statSync)(abs);
        }
        catch {
            return res.status(404).send('Not Found');
        }
        const total = stat.size;
        const mime = record.mime || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const range = String(req.headers['range'] || '');
        if (range) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
            if (m) {
                let start = m[1] ? Number(m[1]) : NaN;
                let end = m[2] ? Number(m[2]) : NaN;
                if (Number.isNaN(start)) {
                    if (Number.isNaN(end) || end <= 0) {
                        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
                        return;
                    }
                    start = Math.max(0, total - end);
                    end = total - 1;
                }
                else {
                    if (Number.isNaN(end))
                        end = total - 1;
                    end = Math.min(end, total - 1);
                }
                if (start > end || start >= total) {
                    res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
                    return;
                }
                res.status(206);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
                res.setHeader('Content-Length', String(end - start + 1));
                (0, node_fs_1.createReadStream)(abs, { start, end }).on('error', () => res.end()).pipe(res);
                return;
            }
        }
        res.setHeader('Content-Length', String(total));
        (0, node_fs_1.createReadStream)(abs).on('error', () => res.end()).pipe(res);
    }
    async proxyStream(req, res, candidates, extraHeaders) {
        const timeoutMs = Number(await this.settings.get('proxyTimeoutMs', '15000')) || 15000;
        const cacheSeconds = Number(await this.settings.get('proxyCacheSeconds', '86400')) || 86400;
        const range = req.headers['range'];
        let lastErr = '';
        for (const cand of candidates) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            const onClose = () => ctrl.abort();
            req.on('close', onClose);
            try {
                const headers = { 'User-Agent': 'go-imgbed-proxy', ...(extraHeaders || {}) };
                if (range)
                    headers['Range'] = String(range);
                const upstream = await fetch(cand.url, { headers, signal: ctrl.signal, redirect: 'follow' });
                if (!upstream.ok && upstream.status !== 206) {
                    lastErr = `${cand.label} → HTTP ${upstream.status}`;
                    clearTimeout(timer);
                    req.off('close', onClose);
                    continue;
                }
                for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
                    const v = upstream.headers.get(h);
                    if (v)
                        res.setHeader(h, v);
                }
                const upstreamCC = upstream.headers.get('cache-control');
                res.setHeader('Cache-Control', upstreamCC || `public, max-age=${cacheSeconds}, immutable`);
                res.setHeader('X-Imgbed-Source', encodeURIComponent(cand.label));
                res.status(upstream.status);
                if (!upstream.body) {
                    clearTimeout(timer);
                    req.off('close', onClose);
                    return res.end();
                }
                const nodeStream = node_stream_1.Readable.fromWeb(upstream.body);
                nodeStream.on('error', () => { try {
                    res.end();
                }
                catch { } });
                res.on('close', () => { try {
                    nodeStream.destroy();
                }
                catch { } });
                nodeStream.pipe(res);
                return;
            }
            catch (err) {
                clearTimeout(timer);
                req.off('close', onClose);
                lastErr = `${cand.label} → ${err.message}`;
                continue;
            }
        }
        return res.status(502).send(`上游图床不可用：${lastErr}`);
    }
    async resolveImageTransform(req) {
        const widthRaw = String(req.query.width ?? '').trim();
        const heightRaw = String(req.query.height ?? '').trim();
        const fitRaw = String(req.query.fit ?? '').trim().toLowerCase();
        if (!widthRaw && !heightRaw && !fitRaw)
            return {};
        const access = (await this.sysConfig.get('security'))?.access || {};
        if (access.imageTransformEnabled !== true)
            return {};
        let fit = '';
        if (fitRaw) {
            if (!['cover', 'contain', 'fill', 'inside', 'outside'].includes(fitRaw)) {
                return { error: 'fit 参数不合法（cover / contain / fill / inside / outside）' };
            }
            fit = fitRaw;
        }
        const parseDim = (raw) => {
            if (!raw)
                return undefined;
            if (/^auto$/i.test(raw))
                return 'auto';
            const n = Number(raw);
            if (!Number.isInteger(n) || n < 1 || n > 4096)
                return undefined;
            return n;
        };
        const width = parseDim(widthRaw);
        const height = parseDim(heightRaw);
        if (widthRaw && width === undefined)
            return { error: 'width 参数不合法（1-4096 的整数或 auto）' };
        if (heightRaw && height === undefined)
            return { error: 'height 参数不合法（1-4096 的整数或 auto）' };
        const allowed = String(access.imageTransformAllowedSizes || '').trim();
        if (allowed) {
            const list = allowed.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
            const key = `${width ?? 'auto'}x${height ?? 'auto'}`;
            if (!list.includes(key))
                return { error: `该尺寸不在允许列表内（${list.join('、')}）` };
        }
        return { width, height, fit };
    }
    async serveTransformedImage(res, candidates, t) {
        const timeoutMs = Number(await this.settings.get('proxyTimeoutMs', '15000')) || 15000;
        let lastErr = '';
        for (const cand of candidates) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                const upstream = await fetch(cand.url, {
                    headers: { 'User-Agent': 'go-imgbed-proxy' },
                    signal: ctrl.signal,
                    redirect: 'follow',
                });
                if (!upstream.ok) {
                    lastErr = `${cand.label} → HTTP ${upstream.status}`;
                    continue;
                }
                const buf = Buffer.from(await upstream.arrayBuffer());
                const option = { fit: t.fit || 'cover' };
                if (typeof t.width === 'number')
                    option.width = t.width;
                if (typeof t.height === 'number')
                    option.height = t.height;
                const out = await (0, sharp_1.default)(buf).resize(option).toBuffer({ resolveWithObject: true });
                const types = {
                    jpeg: 'image/jpeg',
                    png: 'image/png',
                    webp: 'image/webp',
                    avif: 'image/avif',
                };
                res.setHeader('Content-Type', types[out.info.format] || 'application/octet-stream');
                res.setHeader('Content-Length', String(out.data.length));
                res.setHeader('Cache-Control', 'public, max-age=3600');
                res.setHeader('X-Imgbed-Transformed', '1');
                return res.end(out.data);
            }
            catch (err) {
                lastErr = `${cand.label} → ${err.message}`;
            }
            finally {
                clearTimeout(timer);
            }
        }
        return res.status(502).send(`图片处理失败：${lastErr}`);
    }
    async serve(req, res) {
        const name = wildcardParam(req);
        const nameCandidates = [];
        const pushName = (v) => {
            const s = String(v || '').replace(/^\/+/, '');
            if (!s)
                return;
            if (!nameCandidates.includes(s))
                nameCandidates.push(s);
            const b = s.replace(/\.[^.]*$/, '');
            if (b && b !== s && !nameCandidates.includes(b))
                nameCandidates.push(b);
        };
        pushName(name);
        let rest = name;
        while (rest.includes('/')) {
            rest = rest.slice(rest.indexOf('/') + 1);
            pushName(rest);
        }
        const record = await prisma_1.prisma.fileRecord.findFirst({
            where: { OR: nameCandidates.map((n) => ({ name: n })) },
            include: { copies: true },
        });
        if (!record)
            return res.status(404).send('Not Found');
        if (!(await this.checkAccess(req, res, record)))
            return;
        if (req.query.from !== 'admin') {
            void prisma_1.prisma.fileRecord
                .update({ where: { id: record.id }, data: { views: { increment: 1 } } })
                .catch(() => undefined);
        }
        if (record.redirectUrl) {
            const target = String(record.redirectUrl).trim();
            const abs = this.absolutize(req, target);
            const selfKey = decodeURIComponent(abs.split('?')[0].replace(/^.*\/file\//, '').replace(/\.[^.]*$/, ''));
            if (selfKey && (selfKey === record.name || selfKey === record.id)) {
                return res.status(404).send('Not Found');
            }
            const depth = Number(req.headers['x-imgbed-redirect-depth'] || 0) || 0;
            if (depth >= 3)
                return res.status(508).send('重定向链路过长');
            res.setHeader('Cache-Control', 'no-cache, max-age=0');
            return this.proxyStream(req, res, [{ url: abs, label: 'redirect' }], {
                'X-Imgbed-Redirect-Depth': String(depth + 1),
            });
        }
        const prefer = await this.settings.getAccessChannel();
        let active = record.copies.filter((c) => c.status === 'active' && (c.remoteKey || c.remoteUrl));
        if (active.length === 0)
            return res.status(404).send('Not Found');
        const forceChannel = String(req.query.channel || '').trim();
        if (forceChannel) {
            active = active.filter((c) => c.channelId === forceChannel);
            if (active.length === 0)
                return res.status(404).send('Not Found');
        }
        const channelIds = active.map((c) => c.channelId);
        const channels = await prisma_1.prisma.channel.findMany({ where: { id: { in: channelIds } } });
        const preferList = prefer === 'backup' ? ['backup', 'main'] : ['main', 'backup'];
        const enabledIds = new Set(channels.filter((c) => c.enabled).map((c) => c.id));
        const ordered = [];
        const byRole = (role, enabledOnly = false) => {
            const ids = channels.filter((c) => (role === 'backup' ? c.isBackup : c.isMain)).map((c) => c.id);
            for (const c of active) {
                if (ordered.includes(c))
                    continue;
                if (!ids.includes(c.channelId))
                    continue;
                if (enabledOnly && !enabledIds.has(c.channelId))
                    continue;
                ordered.push(c);
            }
        };
        for (const role of preferList)
            byRole(role, true);
        for (const c of active) {
            if (!ordered.includes(c) && enabledIds.has(c.channelId))
                ordered.push(c);
        }
        for (const role of preferList)
            byRole(role);
        for (const c of active)
            if (!ordered.includes(c))
                ordered.push(c);
        const candidates = [];
        for (const copy of ordered) {
            const ch = channels.find((c) => c.id === copy.channelId);
            if (!ch)
                continue;
            if (ch.type === 'local') {
                if (candidates.length > 0)
                    continue;
                const abs = (0, local_adapter_1.localFileAbs)(copy.remoteKey);
                if (!abs)
                    continue;
                return this.sendLocalFile(req, res, abs, record);
            }
            const info = {
                id: ch.id,
                name: ch.name,
                type: ch.type,
                config: this.channels.decryptConfig(ch.type, ch.config),
                metas: {},
            };
            const url = (0, adapter_factory_1.createAdapter)(info).buildDirectUrl((0, adapter_factory_1.toCopyInfo)(copy), info);
            if (url)
                candidates.push({ url, label: ch.name });
        }
        if (candidates.length === 0)
            return res.status(404).send('Not Found');
        const mode = await this.settings.getLinkMode();
        if (mode === 'redirect') {
            res.setHeader('Cache-Control', 'no-cache, max-age=0');
            return res.redirect(302, candidates[0].url);
        }
        const t = await this.resolveImageTransform(req);
        if (t.error)
            return res.status(400).send(t.error);
        const imgExt = (0, file_view_1.fileExtOf)(record.name).toLowerCase().replace(/^\./, '');
        const scalable = ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(imgExt);
        if ((t.width || t.height) && scalable) {
            return this.serveTransformedImage(res, candidates, t);
        }
        return this.proxyStream(req, res, candidates);
    }
};
exports.LinkController = LinkController;
__decorate([
    (0, common_1.Get)('file/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "serve", null);
exports.LinkController = LinkController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        channels_controller_1.ChannelsService,
        sysconfig_service_1.SysConfigService])
], LinkController);
let ManageController = class ManageController {
    settings;
    sysConfig;
    channelsSvc;
    uploadSvc;
    storageChannel;
    constructor(settings, sysConfig, channelsSvc, uploadSvc, storageChannel) {
        this.settings = settings;
        this.sysConfig = sysConfig;
        this.channelsSvc = channelsSvc;
        this.uploadSvc = uploadSvc;
        this.storageChannel = storageChannel;
    }
    admin(req) {
        return (0, auth_guard_1.isAdminRole)((0, auth_guard_1.currentSession)(req)?.role);
    }
    async filterOwned(fileIds, req) {
        if (this.admin(req))
            return fileIds;
        const user = (0, auth_guard_1.currentSession)(req)?.user || '';
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { uploader: user, OR: [{ id: { in: fileIds } }, { name: { in: fileIds } }] },
            select: { id: true, name: true },
        });
        const ok = new Set();
        for (const r of rows) {
            ok.add(r.id);
            ok.add(r.name);
        }
        return fileIds.filter((f) => ok.has(f));
    }
    async userPerm(req, kind) {
        if (this.admin(req))
            return true;
        const s = (0, auth_guard_1.currentSession)(req);
        if (!s)
            return false;
        const u = await prisma_1.prisma.user.findUnique({ where: { username: s.user } });
        if (!u || !u.enabled)
            return false;
        return kind === 'edit' ? u.canEdit : u.canDelete;
    }
    async list(req, q) {
        if (q.action === 'info') {
            if (!this.admin(req))
                return { forbidden: true, totalFiles: 0, channelStats: {}, typeStats: {}, uploadTrend: { labels: [], total: [] } };
            return this.indexInfo(q);
        }
        const session = (0, auth_guard_1.currentSession)(req);
        const ownerFilter = this.admin(req) ? (q.user && q.user !== 'all' ? q.user : '') : session?.user || '';
        const recursive = q.recursive === 'true';
        const dir = (0, file_view_1.normalizeDir)(q.dir);
        const search = (q.search || '').trim().toLowerCase();
        const searchType = (q.searchType || 'all').toLowerCase();
        let count = q.count === undefined ? 50 : Number(q.count);
        if (Number.isNaN(count))
            count = 50;
        const start = Math.max(0, Number(q.start || 0) || 0);
        const sumOnly = count === -1 && q.sum === 'true';
        const includeTags = splitCsv(q.includeTags);
        const excludeTags = splitCsv(q.excludeTags);
        const filterTags = splitCsv(q.filterTags);
        const tagMode = String(q.tagMode || 'and').toLowerCase() === 'or' ? 'or' : 'and';
        const hasTags = String(q.hasTags || '').toLowerCase();
        const fListType = splitCsv(q.listType);
        const fAccess = splitCsv(q.accessStatus);
        const fLabel = splitCsv(q.label);
        const fFileType = splitCsv(q.fileType);
        const fChannel = splitCsv(q.channel);
        const fChannelName = splitCsv(q.channelName);
        const fBackup = splitCsv(q.backup);
        const fRedirect = splitCsv(q.redirect);
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active', ...(ownerFilter ? { uploader: ownerFilter } : {}) },
            include: {
                copies: { include: { channel: true } },
                tags: { include: { tag: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        const allFolders = new Set(rows.map((r) => r.folder).filter(Boolean));
        for (const d of await this.extraFolders(req))
            allFolders.add(d);
        const matched = rows.filter((r) => {
            if (search) {
                const tagNames = r.tags.map((t) => t.tag.name).join(',').toLowerCase();
                const mime = (r.mime || '').toLowerCase();
                const dirName = (r.folder || '').toLowerCase();
                const hit = searchType === 'title'
                    ? r.originalName.toLowerCase().includes(search) || r.name.toLowerCase().includes(search)
                    : searchType === 'tag'
                        ? tagNames.includes(search)
                        : searchType === 'category'
                            ? dirName.includes(search)
                            : searchType === 'user'
                                ? (r.uploader || '').toLowerCase().includes(search)
                                : searchType === 'other'
                                    ? (r.md5 || '').toLowerCase().includes(search) ||
                                        mime.includes(search) ||
                                        (r.ip || '').includes(search)
                                    :
                                        r.originalName.toLowerCase().includes(search) ||
                                            r.name.toLowerCase().includes(search) ||
                                            (r.md5 || '').toLowerCase().includes(search) ||
                                            dirName.includes(search) ||
                                            tagNames.includes(search) ||
                                            mime.includes(search) ||
                                            (r.uploader || '').toLowerCase().includes(search);
                if (!hit)
                    return false;
            }
            const tagNames = r.tags.map((t) => t.tag.name);
            if (hasTags === 'yes' && tagNames.length === 0)
                return false;
            if (hasTags === 'no' && tagNames.length > 0)
                return false;
            if (includeTags.length && !includeTags.every((t) => tagNames.includes(t)))
                return false;
            if (filterTags.length) {
                const hit = tagMode === 'or'
                    ? filterTags.some((t) => tagNames.includes(t))
                    : filterTags.every((t) => tagNames.includes(t));
                if (!hit)
                    return false;
            }
            if (excludeTags.length && excludeTags.some((t) => tagNames.includes(t)))
                return false;
            if (fRedirect.length) {
                const has = !!r.redirectUrl;
                const ok = (fRedirect.includes('yes') && has) || (fRedirect.includes('no') && !has);
                if (!ok)
                    return false;
            }
            const metas = (0, file_view_1.safeParse)(r.metas);
            const listType = metas.ListType || 'None';
            if (fListType.length && !fListType.includes(listType))
                return false;
            if (fLabel.length && !fLabel.includes(metas.Label || 'None'))
                return false;
            if (fFileType.length && !fFileType.includes((0, file_view_1.fileTypeOf)(r.mime)))
                return false;
            const primary = r.copies.find((c) => c.channel?.isMain) || r.copies[0];
            const chLabel = primary?.channel
                ? file_view_1.CHANNEL_LABEL[primary.channel.type] || primary.channel.type
                : '';
            if (fChannel.length && !fChannel.includes(chLabel))
                return false;
            if (fChannelName.length && !fChannelName.includes(primary?.channel?.name || ''))
                return false;
            if (fBackup.length) {
                const hasBackup = r.copies.some((c) => c !== primary && c.status === 'active' && (c.remoteKey || c.remoteUrl));
                const ok = (fBackup.includes('backedup') && hasBackup) ||
                    (fBackup.includes('unbackedup') && !hasBackup);
                if (!ok)
                    return false;
            }
            if (fAccess.length) {
                const ok = (fAccess.includes('normal') && listType === 'None') ||
                    (fAccess.includes('block') && listType === 'Block') ||
                    (fAccess.includes('white') && listType === 'White');
                if (!ok)
                    return false;
            }
            return true;
        });
        const dirBare = dir.replace(/\/+$/, '');
        let files;
        let directories = [];
        if (recursive) {
            files = matched.filter((r) => (!dirBare ? true : r.folder === dirBare || r.folder.startsWith(`${dirBare}/`)));
        }
        else {
            files = matched.filter((r) => (r.folder || '') === dirBare);
            const set = new Set();
            for (const f of allFolders) {
                const full = `${f}/`;
                if (!full.startsWith(dir))
                    continue;
                const rest = full.slice(dir.length);
                const idx = rest.indexOf('/');
                if (idx !== -1)
                    set.add(dir + rest.slice(0, idx));
            }
            directories = Array.from(set).sort();
        }
        const totalCount = files.length;
        if (sumOnly)
            return { sum: totalCount, indexLastUpdated: Date.now() };
        const paged = count === -1 ? files.slice(start) : files.slice(start, start + count);
        const resolveDirectUrl = this.directUrlResolver();
        return {
            files: paged.map((r) => (0, file_view_1.serializeFile)(r, r.copies, { tags: r.tags.map((t) => t.tag.name), resolveDirectUrl })),
            directories,
            totalCount,
            directFileCount: files.length,
            directFolderCount: directories.length,
            returnedCount: paged.length,
            indexLastUpdated: Date.now(),
            isIndexedResponse: true,
        };
    }
    async indexInfo(q) {
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active' },
            include: { copies: { include: { channel: true } } },
            orderBy: { createdAt: 'asc' },
        });
        const primaryOf = (r) => r.copies.find((c) => c.channel?.isMain) || r.copies[0];
        const totalFiles = rows.length;
        const lastUpdated = totalFiles ? rows[totalFiles - 1].createdAt.getTime() : Date.now();
        const offMinStat = Number(q.timezoneOffset || 0) || 0;
        const localMs = (d) => d.getTime() - offMinStat * 60000;
        const dayStartMs = (ms) => {
            const d = new Date(ms);
            return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        };
        const nowLocal = localMs(new Date());
        const todayStart = dayStartMs(nowLocal);
        const yesterdayStart = todayStart - DAY_MS;
        const dow = new Date(todayStart).getUTCDay();
        const weekStart = todayStart - ((dow + 6) % 7) * DAY_MS;
        const monthStart = Date.UTC(new Date(nowLocal).getUTCFullYear(), new Date(nowLocal).getUTCMonth(), 1);
        const yearStart = Date.UTC(new Date(nowLocal).getUTCFullYear(), 0, 1);
        let todayCount = 0;
        let yesterdayCount = 0;
        let weekCount = 0;
        let monthCount = 0;
        let yearCount = 0;
        let totalSize = 0;
        let totalViews = 0;
        const folderSet = new Set();
        for (const r of rows) {
            const t = localMs(r.createdAt);
            totalSize += r.size || 0;
            totalViews += r.views || 0;
            if (r.folder)
                folderSet.add(r.folder.replace(/\/+$/, ''));
            if (t >= todayStart)
                todayCount += 1;
            if (t >= yesterdayStart && t < todayStart)
                yesterdayCount += 1;
            if (t >= weekStart)
                weekCount += 1;
            if (t >= monthStart)
                monthCount += 1;
            if (t >= yearStart)
                yearCount += 1;
        }
        const recentLimit = Math.min(100, Math.max(1, Number(q.recentLimit || 20) || 20));
        const recentFiles = [...rows]
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, recentLimit)
            .map((r) => ({
            id: r.name,
            name: r.name,
            metadata: {
                FileName: r.originalName,
                FileType: (0, file_view_1.fileTypeOf)(r.mime),
                FileExt: (0, file_view_1.fileExtOf)(r.originalName, r.mime),
                FileSize: (0, file_view_1.formatSize)(r.size),
                FileSizeBytes: r.size,
                TimeStamp: r.createdAt.getTime(),
                Views: r.views || 0,
                User: r.uploader || '',
                Directory: r.folder ? `${r.folder.replace(/\/+$/, '')}/` : '',
            },
        }));
        const channelStats = {};
        const userStats = {};
        const typeStats = {};
        for (const r of rows) {
            const p = primaryOf(r);
            const chLabel = p?.channel
                ? p.channel.name || file_view_1.CHANNEL_LABEL[p.channel.type] || p.channel.type
                : 'Unknown';
            channelStats[chLabel] = (channelStats[chLabel] || 0) + 1;
            const userLabel = r.uploader || '(匿名)';
            userStats[userLabel] = (userStats[userLabel] || 0) + 1;
            const metas = (0, file_view_1.safeParse)(r.metas);
            const listType = metas.ListType || 'None';
            typeStats[listType] = (typeStats[listType] || 0) + 1;
        }
        const brief = (r) => r
            ? {
                id: r.name,
                name: r.name,
                metadata: {
                    FileName: r.originalName,
                    FileType: (0, file_view_1.fileTypeOf)(r.mime),
                    FileSizeBytes: r.size,
                    TimeStamp: r.createdAt.getTime(),
                },
            }
            : null;
        const offMin = Number(q.timezoneOffset || 0) || 0;
        const maxPoints = Math.min(365, Math.max(2, Number(q.trendMaxPoints || 90) || 90));
        const seriesLimit = Math.max(1, Number(q.trendSeriesLimit || 8) || 8);
        const nowMs = Date.now();
        let endMs = parseDayMs(q.trendEndDate);
        if (!Number.isFinite(endMs))
            endMs = parseDayMs(isoDayMs(nowMs - offMin * 60000));
        let startMs = parseDayMs(q.trendStartDate);
        if (!Number.isFinite(startMs))
            startMs = endMs - 6 * DAY_MS;
        if (endMs < startMs)
            [startMs, endMs] = [endMs, startMs];
        if (Math.floor((endMs - startMs) / DAY_MS) + 1 > maxPoints) {
            startMs = endMs - (maxPoints - 1) * DAY_MS;
        }
        const labels = [];
        for (let t = startMs; t <= endMs; t += DAY_MS)
            labels.push(isoDayMs(t));
        const labelIndex = new Map(labels.map((l, i) => [l, i]));
        const total = new Array(labels.length).fill(0);
        const byType = {};
        const byName = {};
        const byUser = {};
        for (const r of rows) {
            const key = isoDayMs(r.createdAt.getTime() - offMin * 60000);
            const i = labelIndex.get(key);
            if (i === undefined)
                continue;
            total[i] += 1;
            const p = primaryOf(r);
            const typeLabel = p?.channel ? file_view_1.CHANNEL_LABEL[p.channel.type] || p.channel.type : 'Unknown';
            const nameLabel = p?.channel?.name || typeLabel;
            const userLabel = r.uploader || '(匿名)';
            if (!byType[typeLabel])
                byType[typeLabel] = new Array(labels.length).fill(0);
            if (!byName[nameLabel])
                byName[nameLabel] = new Array(labels.length).fill(0);
            if (!byUser[userLabel])
                byUser[userLabel] = new Array(labels.length).fill(0);
            byType[typeLabel][i] += 1;
            byName[nameLabel][i] += 1;
            byUser[userLabel][i] += 1;
        }
        const buildSeries = (map) => {
            const arr = Object.entries(map)
                .map(([name, data]) => ({ name, data, sum: data.reduce((a, b) => a + b, 0) }))
                .sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name));
            const head = arr.slice(0, seriesLimit).map(({ name, data }) => ({ name, data }));
            const tail = arr.slice(seriesLimit);
            if (tail.length) {
                const other = new Array(labels.length).fill(0);
                for (const s of tail)
                    s.data.forEach((v, i) => (other[i] += v));
                head.push({ name: '__other__', isOther: true, data: other });
            }
            return head;
        };
        return {
            totalFiles,
            lastUpdated,
            channelStats,
            userStats,
            typeStats,
            newestFile: brief(rows[totalFiles - 1]),
            oldestFile: brief(rows[0]),
            recentFiles,
            stats: {
                today: todayCount,
                yesterday: yesterdayCount,
                week: weekCount,
                month: monthCount,
                year: yearCount,
                totalSize,
                totalViews,
                folderCount: folderSet.size,
            },
            uploadTrend: {
                labels,
                total,
                groupBy: {
                    channel: { series: buildSeries(byType) },
                    channelName: { series: buildSeries(byName) },
                    user: { series: buildSeries(byUser) },
                },
                range: { startDate: isoDayMs(startMs), endDate: isoDayMs(endMs) },
            },
            indexLastUpdated: Date.now(),
            isIndexedResponse: true,
        };
    }
    deleteByGet(req, q) {
        return this.remove(req, q);
    }
    deleteByDelete(req, q) {
        return this.remove(req, q);
    }
    async remove(req, q) {
        if (!(await this.userPerm(req, 'delete')))
            return { success: false, message: '没有删除权限' };
        const key = wildcardParam(req);
        if (!key)
            return { success: false, message: '缺少文件名' };
        const owner = this.admin(req) ? '' : (0, auth_guard_1.currentSession)(req)?.user || '';
        const own = owner ? { uploader: owner } : {};
        if (q.folder === 'true') {
            const prefix = key.replace(/\/+$/, '');
            const rows = await prisma_1.prisma.fileRecord.findMany({
                where: { ...own, OR: [{ folder: prefix }, { folder: { startsWith: `${prefix}/` } }] },
            });
            for (const r of rows)
                await this.purgeRecord(r.id, r.name);
            return { success: true, deleted: rows.length };
        }
        const record = await prisma_1.prisma.fileRecord.findFirst({
            where: { ...own, OR: [{ name: key }, { name: key.replace(/\.[^.]*$/, '') }] },
        });
        if (!record)
            return { success: false, message: '文件不存在' };
        await this.purgeRecord(record.id, record.name);
        return { success: true, deleted: 1 };
    }
    async purgeRecord(id, name) {
        await this.uploadSvc.removeFile(id, name);
    }
    directUrlResolver() {
        const infoCache = new Map();
        return (copy) => {
            const ch = copy.channel;
            if (!ch)
                return null;
            try {
                let info = infoCache.get(ch.id);
                if (!info) {
                    info = {
                        id: ch.id,
                        name: ch.name,
                        type: ch.type,
                        config: this.channelsSvc.decryptConfig(ch.type, ch.config),
                        metas: {},
                    };
                    infoCache.set(ch.id, info);
                }
                return (0, adapter_factory_1.createAdapter)(info).buildDirectUrl((0, adapter_factory_1.toCopyInfo)(copy), info);
            }
            catch {
                return null;
            }
        };
    }
    renamePost(req, body) {
        return this.doRename(wildcardParam(req), body, req);
    }
    rename(req, body) {
        return this.doRename(wildcardParam(req), body, req);
    }
    async doRename(oldId, body, req) {
        if (!(await this.userPerm(req, 'edit')))
            throw new common_1.ForbiddenException('没有编辑权限');
        const target = String(body.newFileId ?? body.newName ?? '').trim();
        if (!target)
            throw new common_1.BadRequestException('缺少 newFileId');
        const owner = this.admin(req) ? '' : (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await this.resolveFile(oldId, owner);
        if (!rec)
            throw new common_1.NotFoundException('文件不存在');
        if (target === rec.name)
            throw new common_1.BadRequestException('文件名未发生变化');
        const newId = target
            .replace(/\\/g, '/')
            .replace(/\/{2,}/g, '/')
            .replace(/^\/+/, '')
            .replace(/\.\./g, '_');
        if (!newId)
            throw new common_1.BadRequestException('文件名不能为空');
        const conflict = await prisma_1.prisma.fileRecord.findFirst({ where: { name: newId, NOT: { id: rec.id } } });
        if (conflict)
            throw new common_1.ConflictException('目标文件名已存在');
        const dir = newId.includes('/') ? newId.split('/').slice(0, -1).join('/') : '';
        const updated = await prisma_1.prisma.fileRecord.update({
            where: { id: rec.id },
            data: { name: newId, folder: dir },
            include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
        });
        return {
            success: true,
            newFileId: newId,
            metadata: (0, file_view_1.serializeFile)(updated, updated.copies, { tags: updated.tags.map((t) => t.tag.name), resolveDirectUrl: this.directUrlResolver() }).metadata,
        };
    }
    async resolveFile(fileId, owner = '') {
        const key = String(fileId || '');
        const bare = key.replace(/\.[^.]*$/, '');
        return prisma_1.prisma.fileRecord.findFirst({
            where: { ...(owner ? { uploader: owner } : {}), OR: [{ id: key }, { name: key }, { name: bare }] },
            include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
        });
    }
    async getMeta(req) {
        const owner = this.admin(req) ? '' : (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await this.resolveFile(wildcardParam(req), owner);
        if (!rec)
            return { success: false, message: '文件不存在' };
        return {
            success: true,
            data: { metas: rec.metas, name: rec.name, metadata: (0, file_view_1.serializeFile)(rec, rec.copies, { tags: rec.tags.map((t) => t.tag.name), resolveDirectUrl: this.directUrlResolver() }).metadata },
        };
    }
    async putMeta(req, body) {
        return this.saveMeta(req, body);
    }
    async patchMeta(req, body) {
        return this.saveMeta(req, body);
    }
    async saveMeta(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const owner = this.admin(req) ? '' : (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await this.resolveFile(wildcardParam(req), owner);
        if (!rec)
            return { success: false, message: '文件不存在' };
        let metasRaw;
        const patch = {};
        if (body && body.metas !== undefined) {
            metasRaw = typeof body.metas === 'string' ? body.metas : JSON.stringify(body.metas || {});
        }
        else {
            const cur = (0, file_view_1.safeParse)(rec.metas);
            const b = (body || {});
            if (b.FileName !== undefined) {
                const next = String(b.FileName || '').trim();
                if (next)
                    patch.originalName = next;
            }
            if (b.FileType !== undefined)
                cur.FileType = String(b.FileType || '');
            if (b.ListType !== undefined) {
                const lt = String(b.ListType || '').trim();
                cur.ListType = lt === 'White' || lt === 'Block' ? lt : 'None';
            }
            if (b.Directory !== undefined) {
                patch.folder = (0, file_view_1.normalizeDir)(String(b.Directory || '')).replace(/\/+$/, '');
            }
            metasRaw = JSON.stringify(cur);
        }
        try {
            JSON.parse(metasRaw);
        }
        catch {
            return { success: false, message: 'metas 不是合法 JSON' };
        }
        await prisma_1.prisma.fileRecord.update({ where: { id: rec.id }, data: { metas: metasRaw, ...patch } });
        const updated = await this.resolveFile(rec.name, owner);
        return {
            success: true,
            data: {
                metas: metasRaw,
                name: rec.name,
                metadata: updated
                    ? (0, file_view_1.serializeFile)(updated, updated.copies, { tags: updated.tags.map((t) => t.tag.name), resolveDirectUrl: this.directUrlResolver() }).metadata
                    : undefined,
            },
        };
    }
    async rebackup(req, body) {
        const ids = await this.filterOwned(body.fileIds || [], req);
        const r = await this.uploadSvc.rebackup(ids);
        return { success: true, data: r };
    }
    async backupSelected(req, body) {
        return this.rebackup(req, body);
    }
    async backupSelectedFiles(req, body) {
        return this.rebackup(req, body);
    }
    async backupOne(req) {
        const key = wildcardParam(req);
        if (!key)
            return { success: false, message: '缺少文件名' };
        const ids = await this.filterOwned([key], req);
        if (!ids.length)
            return { success: false, message: '文件不存在' };
        const r = await this.uploadSvc.rebackup(ids);
        return { success: r.ok > 0 || r.skipped > 0, data: r, message: r.ok > 0 ? '备份成功' : r.skipped > 0 ? '该文件已有备份' : '备份失败，请检查备份渠道配置' };
    }
    async setRedirect(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const owner = this.admin(req) ? '' : (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await this.resolveFile(wildcardParam(req), owner);
        if (!rec)
            return { success: false, message: '文件不存在' };
        const url = String(body.url || '').trim();
        if (url) {
            try {
                const u = new URL(url);
                if (!['http:', 'https:'].includes(u.protocol))
                    return { success: false, message: '仅支持 http/https 地址' };
            }
            catch {
                return { success: false, message: 'URL 格式不正确' };
            }
        }
        await prisma_1.prisma.fileRecord.update({ where: { id: rec.id }, data: { redirectUrl: url } });
        return { success: true, data: { redirectUrl: url } };
    }
    async createFolder(req, body) {
        let base = String(body.dir || '').replace(/^\/+|\/+$/g, '');
        let rawName = body.name;
        if (!rawName && body.path) {
            const parts = String(body.path).replace(/^\/+|\/+$/g, '').split('/');
            rawName = parts.pop() || '';
            base = parts.join('/');
        }
        const name = String(rawName || '').trim().replace(/^\/+|\/+$/g, '').replace(/\.\./g, '_');
        if (!name)
            return { success: false, message: '目录名不能为空' };
        const full = base ? `${base}/${name}` : name;
        await this.registerFolder(req, full);
        return { success: true, data: { path: full } };
    }
    async registerFolder(req, full) {
        const owner = this.admin(req) ? '' : (0, auth_guard_1.currentSession)(req)?.user || '';
        const raw = await this.settings.get('extraFolders', '{}');
        let map = {};
        try {
            map = raw ? JSON.parse(raw) : {};
        }
        catch {
            map = {};
        }
        const list = new Set(map[owner] || []);
        list.add(full.replace(/^\/+|\/+$/g, ''));
        map[owner] = Array.from(list).sort();
        await this.settings.set('extraFolders', JSON.stringify(map));
    }
    async extraFolders(req) {
        const owner = this.admin(req) ? '' : (0, auth_guard_1.currentSession)(req)?.user || '';
        try {
            const map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
            return Array.isArray(map[owner]) ? map[owner] : [];
        }
        catch {
            return [];
        }
    }
    async stats() {
        const [fileCount, sizeAgg, channels] = await Promise.all([
            prisma_1.prisma.fileRecord.count({ where: { status: 'active' } }),
            prisma_1.prisma.fileRecord.aggregate({ where: { status: 'active' }, _sum: { size: true } }),
            prisma_1.prisma.channel.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
        ]);
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        since.setDate(since.getDate() - 6);
        const recent = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active', createdAt: { gte: since } },
            select: { createdAt: true },
        });
        const byDay = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date(since);
            d.setDate(d.getDate() + i);
            byDay[d.toISOString().slice(0, 10)] = 0;
        }
        for (const r of recent) {
            const k = r.createdAt.toISOString().slice(0, 10);
            if (k in byDay)
                byDay[k] += 1;
        }
        const copies = await prisma_1.prisma.fileCopy.groupBy({
            by: ['channelId', 'status'],
            _count: { _all: true },
        });
        const briefOf = (c) => c ? { id: c.id, code: c.code, name: c.name, type: c.type, enabled: true } : null;
        return {
            success: true,
            data: {
                fileCount,
                totalSize: sizeAgg._sum.size || 0,
                channelCount: channels.length,
                mainChannel: briefOf(await this.storageChannel.getStorageChannel('', 'main')),
                backupChannel: briefOf(await this.storageChannel.getStorageChannel('', 'backup')),
                accessChannel: await this.settings.getAccessChannel(),
                backupEnabled: (await this.settings.get('backupEnabled', 'true')) === 'true',
                allowUpload: (await this.settings.get('allowUpload', 'true')) === 'true',
                serverDomain: (await this.settings.getServerDomain()) || '',
                byDay: Object.entries(byDay).map(([date, count]) => ({ date, count })),
                channels: channels.map((c) => {
                    const mine = copies.filter((x) => x.channelId === c.id);
                    const sum = (st) => mine.filter((x) => x.status === st).reduce((a, b) => a + b._count._all, 0);
                    return {
                        id: c.id,
                        name: c.name,
                        type: c.type,
                        enabled: c.enabled,
                        isMain: c.isMain,
                        isBackup: c.isBackup,
                        active: sum('active'),
                        failed: sum('failed'),
                        pending: sum('pending'),
                    };
                }),
            },
        };
    }
    async lists() {
        return { success: true, data: await this.readLists() };
    }
    async addWhite(ip) {
        return this.mutateList('whiteIpList', ip, 'add');
    }
    async delWhite(ip) {
        return this.mutateList('whiteIpList', ip, 'del');
    }
    async addBlock(ip) {
        return this.mutateList('blockIpList', ip, 'add');
    }
    async delBlock(ip) {
        return this.mutateList('blockIpList', ip, 'del');
    }
    async setListsEnabled(body) {
        const v = body.enabled === true || body.enabled === 'true';
        await this.settings.set('securityEnabled', v ? 'true' : 'false');
        return { success: true };
    }
    async readLists() {
        const parse = (raw) => {
            if (!raw)
                return [];
            try {
                const v = JSON.parse(raw);
                return Array.isArray(v) ? v.map(String) : [];
            }
            catch {
                return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
            }
        };
        return {
            white: parse(await this.settings.get('whiteIpList', '[]')),
            block: parse(await this.settings.get('blockIpList', '[]')),
            enabled: (await this.settings.get('securityEnabled', 'false')) === 'true',
        };
    }
    async mutateList(key, ip, mode) {
        const cur = await this.readLists();
        const list = key === 'whiteIpList' ? cur.white : cur.block;
        const next = mode === 'add'
            ? Array.from(new Set([...list, ip]))
            : list.filter((x) => x !== ip);
        await this.settings.set(key, JSON.stringify(next));
        return { success: true, data: await this.readLists() };
    }
    async getWebdav() {
        const raw = await this.settings.get('webdav', '');
        try {
            return { success: true, data: raw ? JSON.parse(raw) : {} };
        }
        catch {
            return { success: true, data: {} };
        }
    }
    async saveWebdav(body) {
        await this.settings.set('webdav', JSON.stringify(body || {}));
        return { success: true };
    }
    async getSysConfig(section) {
        return this.sysConfig.get(section);
    }
    getLogs(q) {
        const data = app_log_1.appLog.list({
            level: q.level,
            scope: q.scope,
            keyword: q.keyword,
            limit: Number(q.limit) || 200,
            since: Number(q.since) || 0,
            date: q.date,
        });
        return { success: true, ...data, scopes: app_log_1.appLog.scopes(), stats: app_log_1.appLog.stats(), files: app_log_1.appLog.logFiles() };
    }
    clearLogs() {
        return { success: true, cleared: app_log_1.appLog.clear() };
    }
    testLog() {
        app_log_1.appLog.info('debug', '这是一条来自后台的测试日志', `时间：${new Date().toLocaleString('zh-CN')}`);
        return { success: true };
    }
    logFiles() {
        return { success: true, data: app_log_1.appLog.logFiles() };
    }
    exportLogs(q, res) {
        const data = app_log_1.appLog.list({
            level: q.level,
            scope: q.scope,
            keyword: q.keyword,
            limit: Number(q.limit) || 5000,
            since: Number(q.since) || 0,
        });
        const text = (data.entries || [])
            .map((e) => `${new Date(e.at).toISOString()} [${e.level.toUpperCase()}] [${e.scope}] ${e.message}${e.detail ? ` ｜ ${e.detail}` : ''}${e.ip ? ` ｜ ip=${e.ip}` : ''}`)
            .join('\n');
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="go-imgbed-logs-${stamp}.log"`);
        return res.send(text || '(无日志)');
    }
    startBackupAll() {
        return { success: true, data: this.uploadSvc.startBackupAll() };
    }
    backupAllStatus() {
        return { success: true, data: this.uploadSvc.backupAllStatus() };
    }
    async postSysConfig(section, body, res) {
        return this.persistSysConfig(section, body, res);
    }
    async putSysConfig(section, body, res) {
        return this.persistSysConfig(section, body, res);
    }
    async persistSysConfig(section, body, res) {
        const out = await this.sysConfig.save(section, body);
        if (section === 'security' && out?.adminPasswordChanged) {
            res.clearCookie(auth_guard_1.SESSION_COOKIE, { path: '/' });
        }
        return out;
    }
};
exports.ManageController = ManageController;
__decorate([
    (0, common_1.Get)('list'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('delete/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "deleteByGet", null);
__decorate([
    (0, common_1.Delete)('delete/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "deleteByDelete", null);
__decorate([
    (0, common_1.Post)('rename/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "renamePost", null);
__decorate([
    (0, common_1.Patch)('rename/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "rename", null);
__decorate([
    (0, common_1.Get)('metadata/*'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "getMeta", null);
__decorate([
    (0, common_1.Put)('metadata/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "putMeta", null);
__decorate([
    (0, common_1.Patch)('metadata/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "patchMeta", null);
__decorate([
    (0, common_1.Put)('batch/rebackup'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "rebackup", null);
__decorate([
    (0, common_1.Post)('batch/backupSelected'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "backupSelected", null);
__decorate([
    (0, common_1.Post)('files/batch/backupSelected'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "backupSelectedFiles", null);
__decorate([
    (0, common_1.Post)('files/backup/*'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "backupOne", null);
__decorate([
    (0, common_1.Post)('files/redirect/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "setRedirect", null);
__decorate([
    (0, common_1.Post)('folder'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "createFolder", null);
__decorate([
    (0, common_1.Get)('stats'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "stats", null);
__decorate([
    (0, common_1.Get)('lists'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "lists", null);
__decorate([
    (0, common_1.Post)('white/:ip'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "addWhite", null);
__decorate([
    (0, common_1.Delete)('white/:ip'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "delWhite", null);
__decorate([
    (0, common_1.Post)('block/:ip'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "addBlock", null);
__decorate([
    (0, common_1.Delete)('block/:ip'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "delBlock", null);
__decorate([
    (0, common_1.Put)('lists/enabled'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "setListsEnabled", null);
__decorate([
    (0, common_1.Get)('webdav'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "getWebdav", null);
__decorate([
    (0, common_1.Post)('webdav'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "saveWebdav", null);
__decorate([
    (0, common_1.Get)('sysConfig/:section'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('section')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "getSysConfig", null);
__decorate([
    (0, common_1.Get)('logs'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "getLogs", null);
__decorate([
    (0, common_1.Delete)('logs'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "clearLogs", null);
__decorate([
    (0, common_1.Post)('logs/test'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "testLog", null);
__decorate([
    (0, common_1.Get)('logs/files'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "logFiles", null);
__decorate([
    (0, common_1.Get)('logs/export'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "exportLogs", null);
__decorate([
    (0, common_1.Post)('backupAll/start'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "startBackupAll", null);
__decorate([
    (0, common_1.Get)('backupAll/status'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "backupAllStatus", null);
__decorate([
    (0, common_1.Post)('sysConfig/:section'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('section')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "postSysConfig", null);
__decorate([
    (0, common_1.Put)('sysConfig/:section'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('section')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "putSysConfig", null);
exports.ManageController = ManageController = __decorate([
    (0, common_1.Controller)('api/manage'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        sysconfig_service_1.SysConfigService,
        channels_controller_1.ChannelsService,
        upload_service_1.UploadService,
        storage_channel_service_1.StorageChannelService])
], ManageController);
let UserConfigController = class UserConfigController {
    settings;
    sysConfig;
    uploadSvc;
    storageChannel;
    constructor(settings, sysConfig, uploadSvc, storageChannel) {
        this.settings = settings;
        this.sysConfig = sysConfig;
        this.uploadSvc = uploadSvc;
        this.storageChannel = storageChannel;
    }
    channelBrief(c) {
        return c ? { id: c.id, code: c.code, name: c.name, type: c.type } : null;
    }
    async userConfig(req) {
        const s = this.settings;
        const uploader = (0, auth_guard_1.currentSession)(req)?.user || '';
        const domain = (await s.getServerDomain()) || `${req.protocol}://${req.get('host')}`;
        const bool = async (k, d = false) => (await s.get(k, d ? 'true' : 'false')) === 'true';
        let page = { config: [] };
        try {
            page = await this.sysConfig.get('page');
        }
        catch {
        }
        const pv = (id, d = '') => {
            const item = (page?.config || []).find((x) => x.id === id);
            return item && item.value !== undefined && item.value !== null && item.value !== '' ? item.value : d;
        };
        const asBk = (v) => {
            if (Array.isArray(v))
                return v;
            if (typeof v === 'string') {
                const s = v.trim();
                if (!s)
                    return [];
                if (s.toLowerCase() === 'bing')
                    return 'bing';
                if (s.startsWith('[')) {
                    try {
                        const a = JSON.parse(s);
                        return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()) : [];
                    }
                    catch {
                        return [];
                    }
                }
                return [s];
            }
            return [];
        };
        return {
            siteTitle: pv('siteTitle', 'go-imgbed') || 'go-imgbed',
            siteIcon: pv('siteIcon', ''),
            ownerName: pv('ownerName', ''),
            logoUrl: pv('logoUrl', ''),
            logoLink: pv('logoLink', ''),
            announcement: pv('announcement', ''),
            announcementRefreshAt: page?.announcementRefreshAt || 0,
            footerLink: pv('footerLink', ''),
            disableFooter: pv('disableFooter', false) === true,
            defaultLanguage: 'zh-CN',
            serverDomain: domain,
            urlPrefix: await s.getLinkPrefix(domain),
            customDomain: await s.getCustomDomain(),
            defaultChannel: this.channelBrief(await this.storageChannel.getStorageChannel('', 'main')),
            mainChannel: this.channelBrief(await this.storageChannel.getStorageChannel(uploader, 'main')),
            backupChannel: this.channelBrief(await this.storageChannel.getStorageChannel(uploader, 'backup')),
            allowUpload: await bool('allowUpload', true),
            defaultUploadNameType: pv('defaultUploadNameType', 'default'),
            defaultUploadFolder: pv('defaultUploadFolder', ''),
            defaultConvertToWebp: pv('defaultConvertToWebp', false) === true,
            defaultCustomerCompress: pv('defaultCustomerCompress', false) === true,
            defaultCompressBar: pv('defaultCompressBar', '0.8'),
            defaultCompressQuality: pv('defaultCompressQuality', '80'),
            defaultUrlForm: pv('defaultUrlForm', 'url'),
            allowedExtensions: String(pv('allowedExtensions', 'jpg,png,gif,jpeg,webp,bmp,mp4,webm,mov,m4v,mp3,m4a,aac,ogg'))
                .split(',')
                .map((x) => x.trim().replace(/^\./, '').toLowerCase())
                .filter(Boolean),
            maxUploadSizeMB: Number(pv('maxUploadSizeMB', 150)) || 150,
            wallpaperEnabled: pv('wallpaperEnabled', false) === true,
            autoDarkMode: pv('autoDarkMode', true) !== false,
            bkInterval: Number(pv('bkInterval', 3000)) || 3000,
            bkOpacity: Number(pv('bkOpacity', 1)) || 1,
            uploadBkImg: asBk(pv('uploadBkImg', [])),
            adminBkImg: asBk(pv('adminBkImg', [])),
            adminLoginBkImg: asBk(pv('adminLoginBkImg', [])),
            showDirectorySuggestions: pv('showDirectorySuggestions', true) !== false,
        };
    }
    async directoryTree(req) {
        const session = (0, auth_guard_1.currentSession)(req);
        const admin = (0, auth_guard_1.isAdminRole)(session?.role);
        const owner = admin ? '' : session?.user || '';
        const rows = await prisma_1.prisma.fileRecord.groupBy({
            by: ['folder'],
            where: { status: 'active', ...(owner ? { uploader: owner } : {}) },
        });
        const dirs = rows.map((r) => r.folder).filter(Boolean);
        try {
            const map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
            const extra = Array.isArray(map[owner]) ? map[owner] : [];
            dirs.push(...extra);
        }
        catch {
        }
        return { success: true, tree: (0, file_view_1.buildDirectoryTree)(Array.from(new Set(dirs)).sort()) };
    }
    async publicList(q, res) {
        const others = (await this.sysConfig.get('others'));
        const cfg = others?.publicBrowse || {};
        if (cfg.enabled !== true) {
            return res.status(403).json({ error: 'Public browse is disabled' });
        }
        const allowedDirs = String(cfg.allowedDir || '')
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean);
        const recursive = q.recursive === 'true';
        const dir = (0, file_view_1.normalizeDir)(q.dir);
        const bare = dir.replace(/\/+$/, '');
        if (!dirAllowed(bare, allowedDirs)) {
            return res.status(403).json({ error: 'Directory not allowed' });
        }
        const start = Math.max(0, Number(q.start || 0) || 0);
        const count = q.count === undefined ? 50 : Math.max(0, Number(q.count) || 0);
        const search = (q.search || '').trim().toLowerCase();
        const type = (q.type || '').trim().toLowerCase();
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active' },
            include: { copies: { include: { channel: true } } },
            orderBy: { createdAt: 'desc' },
        });
        const visible = rows.filter((r) => {
            const metas = (0, file_view_1.safeParse)(r.metas);
            return (metas.ListType || 'None') !== 'Block' && metas.Label !== 'adult';
        });
        const matched = visible.filter((r) => {
            const folder = (r.folder || '').replace(/\/+$/, '');
            if (recursive) {
                if (bare && folder !== bare && !folder.startsWith(`${bare}/`))
                    return false;
            }
            else if (folder !== bare) {
                return false;
            }
            if (search && !r.originalName.toLowerCase().includes(search) && !r.name.toLowerCase().includes(search))
                return false;
            if (type && (0, file_view_1.fileTypeOf)(r.mime) !== type)
                return false;
            return true;
        });
        const dirSet = new Set();
        for (const r of visible) {
            const full = `${(r.folder || '').replace(/\/+$/, '')}/`;
            if (!full.startsWith(dir))
                continue;
            const rest = full.slice(dir.length);
            const idx = rest.indexOf('/');
            if (idx !== -1)
                dirSet.add(dir + rest.slice(0, idx));
        }
        const directories = Array.from(dirSet)
            .map((d) => d.replace(/\/+$/, ''))
            .filter((d) => d !== '' && dirAllowed(d, allowedDirs))
            .sort();
        const totalCount = matched.length;
        const paged = count > 0 ? matched.slice(start, start + count) : matched.slice(start);
        return res.json({
            files: paged.map((r) => (0, file_view_1.serializeFile)(r, r.copies)),
            directories,
            totalCount,
            returnedCount: paged.length,
            allowedDirs,
            fromCache: false,
        });
    }
    async random(q, req, res) {
        const asJson = q.type === 'json' || q.json === '1' || q.format === 'json';
        const others = (await this.sysConfig.get('others'));
        const randomCfg = others?.randomImageAPI || {};
        if (randomCfg.enabled !== true) {
            return asJson
                ? res.status(403).json({ success: false, error: 'Random is disabled', message: '随机图 API 已关闭' })
                : res.status(403).send('Random is disabled');
        }
        const allowedRandomDirs = String(randomCfg.allowedDir || '')
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean);
        const count = Math.min(10, Math.max(1, Number(q.count || 1) || 1));
        const recursive = q.recursive === 'true';
        const where = { status: 'active' };
        const dir = (0, file_view_1.normalizeDir)(q.dir);
        if (dir) {
            if (!dirAllowed(dir.replace(/\/+$/, ''), allowedRandomDirs)) {
                return asJson
                    ? res.status(403).json({ success: false, error: 'Directory not allowed', message: '目录不在允许范围内' })
                    : res.status(403).send('Directory not allowed');
            }
            const bare = dir.replace(/\/+$/, '');
            where.folder = recursive ? { startsWith: bare } : bare;
        }
        else if (allowedRandomDirs.length) {
            where.AND = allowedRandomDirs.map((d) => ({
                OR: [{ folder: d.replace(/\/+$/, '') }, { folder: { startsWith: `${d.replace(/\/+$/, '')}/` } }],
            }));
        }
        const cat = (q.category || q.fileType || '').toLowerCase();
        const prefix = cat.startsWith('img') || cat === 'image' ? 'image/' : cat === 'video' ? 'video/' : cat === 'audio' ? 'audio/' : '';
        if (prefix)
            where.mime = { startsWith: prefix };
        const exts = splitCsv(q.ext).map((e) => e.replace(/^\./, '').toLowerCase());
        if (exts.length) {
            where.OR = exts.flatMap((e) => [
                { originalName: { endsWith: `.${e}` } },
                { name: { endsWith: `.${e}` } },
            ]);
        }
        const needMemory = Boolean(q.channel || q.channelName || q.label || q.access);
        const isPubliclyVisible = (metasRaw) => {
            const m = (0, file_view_1.safeParse)(metasRaw);
            return (m.ListType || 'None') !== 'Block' && m.Label !== 'adult';
        };
        const pick = async () => {
            if (!needMemory) {
                const candidates = await prisma_1.prisma.fileRecord.findMany({ where, select: { name: true, metas: true } });
                const names = candidates.filter((c) => isPubliclyVisible(c.metas)).map((c) => c.name);
                if (!names.length)
                    return [];
                for (let i = names.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [names[i], names[j]] = [names[j], names[i]];
                }
                const chosen = names.slice(0, count);
                const recs = await prisma_1.prisma.fileRecord.findMany({ where: { name: { in: chosen } } });
                return chosen.map((n) => recs.find((r) => r.name === n)).filter(Boolean);
            }
            const rows = await prisma_1.prisma.fileRecord.findMany({
                where,
                orderBy: { id: 'asc' },
                include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
            });
            const filtered = rows.filter((r) => {
                const metas = (0, file_view_1.safeParse)(r.metas);
                if (!isPubliclyVisible(r.metas))
                    return false;
                if (q.label && (metas.Label || 'None') !== q.label)
                    return false;
                if (q.access) {
                    const lt = metas.ListType || 'None';
                    const ok = (q.access === 'normal' && lt === 'None') ||
                        (q.access === 'block' && lt === 'Block') ||
                        (q.access === 'white' && lt === 'White');
                    if (!ok)
                        return false;
                }
                if (q.channel || q.channelName) {
                    const primary = r.copies.find((c) => c.channel?.isMain) || r.copies[0];
                    const typeLabel = primary?.channel ? file_view_1.CHANNEL_LABEL[primary.channel.type] || primary.channel.type : '';
                    if (q.channel && typeLabel !== q.channel)
                        return false;
                    if (q.channelName && (primary?.channel?.name || '') !== q.channelName)
                        return false;
                }
                return true;
            });
            if (!filtered.length)
                return [];
            const shuffled = filtered.slice();
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled.slice(0, count);
        };
        const picked = await pick();
        if (!picked.length) {
            if (asJson)
                return res.json({ success: false, message: '没有符合条件的图片', data: [] });
            return res.status(404).send('没有符合条件的图片');
        }
        res.setHeader('Cache-Control', 'no-store');
        if (asJson) {
            const origin = `${req.protocol}://${req.get('host')}`;
            const prefix = await this.settings.getLinkPrefix(origin);
            const items = picked.map((r) => ({
                src: `${prefix}${encodeURIComponent(r.name)}`,
                url: `${prefix}${encodeURIComponent(r.name)}`,
                name: r.originalName,
                size: r.size,
                mime: r.mime,
                dir: r.folder || '',
            }));
            return res.json({ success: true, data: count === 1 ? items[0] : items, list: items });
        }
        return res.redirect(302, `/file/${picked[0].name}`);
    }
};
exports.UserConfigController = UserConfigController;
__decorate([
    (0, common_1.Get)('userConfig'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserConfigController.prototype, "userConfig", null);
__decorate([
    (0, common_1.Get)('directoryTree'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserConfigController.prototype, "directoryTree", null);
__decorate([
    (0, common_1.Get)('public/list'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserConfigController.prototype, "publicList", null);
__decorate([
    (0, common_1.Get)('random'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UserConfigController.prototype, "random", null);
exports.UserConfigController = UserConfigController = __decorate([
    (0, common_1.Controller)('api'),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        sysconfig_service_1.SysConfigService,
        upload_service_1.UploadService,
        storage_channel_service_1.StorageChannelService])
], UserConfigController);
