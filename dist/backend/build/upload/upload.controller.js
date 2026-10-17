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
var UploadController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const common_2 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const upload_service_1 = require("./upload.service");
const settings_service_1 = require("../settings/settings.service");
const storage_channel_service_1 = require("../storage/storage-channel.service");
const chunkStore = new Map();
function isBlockedFetchHost(hostname) {
    const h = hostname.toLowerCase();
    if (h === '0.0.0.0')
        return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
        const [a, b] = h.split('.').map(Number);
        if (a === 169 && b === 254)
            return true;
        if (a >= 224)
            return true;
    }
    if (h.startsWith('fe80'))
        return true;
    return false;
}
function fixFilename(name) {
    const raw = String(name || '');
    if (!raw)
        return raw;
    try {
        const restored = Buffer.from(raw, 'latin1').toString('utf8');
        if (!restored.includes('\uFFFD') && /[^\u0000-\u007F]/.test(restored))
            return restored;
    }
    catch {
    }
    return raw;
}
let UploadController = class UploadController {
    static { UploadController_1 = this; }
    svc;
    settings;
    static MIME_EXT = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/bmp': 'bmp',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/aac': 'aac',
        'audio/ogg': 'ogg',
    };
    constructor(svc, settings) {
        this.svc = svc;
        this.settings = settings;
    }
    async signedSrc(id, req) {
        const origin = `${req.protocol}://${req.get('host')}`;
        const prefix = await this.settings.getLinkPrefix(origin);
        return `${prefix}${encodeURIComponent(id)}`;
    }
    clientIp(req) {
        const fwd = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
        return (fwd || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    }
    async upload(file, q, body, req, res) {
        if (q.cleanup === 'true' && q.uploadId) {
            chunkStore.delete(q.uploadId);
            return res.json({ success: true });
        }
        const backupRaw = String(q.backupChannelId ?? q.backupChannel ?? '').trim();
        const backupOff = storage_channel_service_1.NO_BACKUP_VALUES.includes(backupRaw.toLowerCase());
        const backupChannelId = !backupOff && backupRaw ? backupRaw : undefined;
        const uploader = (0, auth_guard_1.currentSession)(req)?.user || req.session?.user || '';
        const enforceLimits = await this.svc.userEnforceLimits(uploader);
        const opts = {
            uploadChannel: q.uploadChannel,
            channelId: q.channelId ?? q.channelName,
            uploadNameType: q.uploadNameType,
            serverCompress: q.serverCompress === 'true' || q.serverCompress === '1',
            uploadFolder: q.uploadFolder || '',
            uploader,
            ip: this.clientIp(req),
            originalSize: Number(q.originalSize || body.originalSize || 0) || 0,
            compressPercent: Number(q.compressPercent || body.compressPercent || 0) || 0,
            backup: backupOff ? false : q.backup !== 'false' && q.backup !== '0',
            backupChannelId,
            autoRetry: q.autoRetry === 'true' || q.autoRetry === '1',
            skipFileLimits: !enforceLimits,
            uploadSource: 'Default',
        };
        if (q.initChunked === 'true') {
            const uploadId = Math.random().toString(36).slice(2) + Date.now().toString(36);
            chunkStore.set(uploadId, {
                chunks: new Map(),
                totalChunks: Number(body.totalChunks || q.totalChunks || 0),
                originalName: fixFilename(body.originalFileName || 'chunked.bin'),
                mime: body.originalFileType || 'application/octet-stream',
            });
            return res.json({ success: true, uploadId });
        }
        if (q.chunked === 'true') {
            const uploadId = body.uploadId || q.uploadId || '';
            const store = chunkStore.get(uploadId);
            if (!store)
                return res.status(400).json({ success: false, message: 'uploadId 无效或已过期' });
            if (q.merge === 'true') {
                const total = Number(store.totalChunks || body.totalChunks || q.totalChunks || 0);
                const merged = Buffer.concat(Array.from({ length: total }, (_, i) => store.chunks.get(i) || Buffer.alloc(0)));
                chunkStore.delete(uploadId);
                const originalName = fixFilename(body.originalFileName || store.originalName);
                const r = await this.svc.upload({ buffer: merged, mime: store.mime, originalName }, opts);
                if (r.error)
                    return res.status(500).json({ success: false, message: r.error });
                return res.json([{ src: await this.signedSrc(r.id, req), name: originalName }]);
            }
            const idx = Number(body.chunkIndex ?? q.chunkIndex ?? 0);
            store.chunks.set(idx, file?.buffer || Buffer.alloc(0));
            return res.json({ success: true });
        }
        if (!file)
            return res.status(400).json({ success: false, message: '缺少文件' });
        const originalName = fixFilename(file.originalname);
        const r = await this.svc.upload({ buffer: file.buffer, mime: file.mimetype, originalName }, opts);
        if (r.error)
            return res.status(500).json({ success: false, message: r.error });
        return res.json([{ src: await this.signedSrc(r.id, req), name: originalName }]);
    }
    async fetchRes(body, res) {
        const url = body.url || '';
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            return res.status(400).json({ success: false, message: 'URL 无效' });
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return res.status(400).json({ success: false, message: '仅支持 http/https' });
        }
        if (isBlockedFetchHost(parsed.hostname)) {
            return res.status(400).json({ success: false, message: '禁止访问该地址（云元数据/组播地址）' });
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
            const resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
            if (!resp.ok)
                return res.status(400).json({ success: false, message: `拉取失败 HTTP ${resp.status}` });
            const buf = Buffer.from(await resp.arrayBuffer());
            if (buf.length > 512 * 1024 * 1024) {
                return res.status(400).json({ success: false, message: '文件超过 512MB 上限' });
            }
            let name = decodeURIComponent(parsed.pathname.split('/').pop() || '');
            const mime = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
            if (!name || !name.includes('.')) {
                const ext = UploadController_1.MIME_EXT[mime] || 'bin';
                name = `${name || 'PastedFile' + Date.now()}.${ext}`;
            }
            res.setHeader('Content-Type', mime);
            res.setHeader('Content-Length', String(buf.length));
            res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
            return res.send(buf);
        }
        catch (err) {
            return res.status(400).json({ success: false, message: `拉取失败: ${err.message}` });
        }
        finally {
            clearTimeout(timer);
        }
    }
};
exports.UploadController = UploadController;
__decorate([
    (0, common_1.Post)('upload'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: 512 * 1024 * 1024 } })),
    __param(0, (0, common_2.UploadedFile)()),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_2.Req)()),
    __param(4, (0, common_2.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "upload", null);
__decorate([
    (0, common_1.Post)('api/fetchRes'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_2.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "fetchRes", null);
exports.UploadController = UploadController = UploadController_1 = __decorate([
    (0, common_1.Controller)(),
    (0, common_1.UseGuards)(auth_guard_1.OptionalAuthGuard),
    __metadata("design:paramtypes", [upload_service_1.UploadService,
        settings_service_1.SettingsService])
], UploadController);
