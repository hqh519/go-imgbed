"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var UploadService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const prisma_1 = require("../common/prisma");
const crypto_service_1 = require("../common/crypto.service");
const settings_service_1 = require("../settings/settings.service");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const channels_controller_1 = require("../channels/channels.controller");
const storage_channel_service_1 = require("../storage/storage-channel.service");
const adapter_factory_1 = require("../adapters/adapter.factory");
const local_adapter_1 = require("../adapters/local.adapter");
const file_view_1 = require("../common/file-view");
const app_log_1 = require("../common/app-log");
let UploadService = class UploadService {
    static { UploadService_1 = this; }
    settings;
    channels;
    sysConfig;
    storageChannel;
    static DEFAULT_EXT = [
        'jpg', 'png', 'gif', 'jpeg', 'webp', 'bmp',
        'mp4', 'webm', 'mov', 'm4v',
        'mp3', 'm4a', 'aac', 'ogg',
    ];
    constructor(settings, channels, sysConfig, storageChannel) {
        this.settings = settings;
        this.channels = channels;
        this.sysConfig = sysConfig;
        this.storageChannel = storageChannel;
    }
    activeUploads = 0;
    lowPriorityChain = Promise.resolve();
    enqueueLowPriority(task) {
        const run = this.lowPriorityChain.then(async () => {
            await this.waitForUploadIdle();
            return task();
        });
        this.lowPriorityChain = run.catch((err) => {
            console.error('[backup] 低优先级任务异常:', err?.message || err);
            return undefined;
        });
        return run;
    }
    backgroundChain = Promise.resolve();
    enqueueBackground(task) {
        const run = this.backgroundChain.then(task);
        this.backgroundChain = run.catch((err) => {
            console.warn('[bg] 后台任务异常:', err?.message || err);
            return undefined;
        });
        return run;
    }
    async waitForUploadIdle(maxWaitMs = 20000) {
        const started = Date.now();
        while (this.activeUploads > 0 && Date.now() - started < maxWaitMs) {
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
    async userEnforceLimits(username) {
        const name = String(username || '').trim();
        if (!name)
            return true;
        try {
            const row = await prisma_1.prisma.user.findUnique({
                where: { username: name },
                select: { enforceLimits: true },
            });
            if (row)
                return row.enforceLimits !== false;
            const security = await this.sysConfig.get('security');
            const adminName = String(security?.auth?.admin?.adminUsername || '').trim() ||
                (process.env.ADMIN_USER || '').trim() ||
                'admin';
            if (name === adminName) {
                const prof = await this.sysConfig.get('adminProfile');
                return prof?.enforceLimits !== false;
            }
            return true;
        }
        catch {
            return true;
        }
    }
    async limits() {
        try {
            const page = await this.sysConfig.get('page');
            const get = (id) => (page?.config || []).find((x) => x.id === id)?.value;
            const raw = get('allowedExtensions');
            const exts = String(raw || UploadService_1.DEFAULT_EXT.join(','))
                .split(',')
                .map((s) => s.trim().replace(/^\./, '').toLowerCase())
                .filter(Boolean);
            const maxMB = Number(get('maxUploadSizeMB')) || 150;
            return { exts: exts.length ? exts : UploadService_1.DEFAULT_EXT, maxMB };
        }
        catch {
            return { exts: UploadService_1.DEFAULT_EXT, maxMB: 100 };
        }
    }
    signatureOk(buf, ext) {
        if (buf.length < 4)
            return null;
        const hex = buf.subarray(0, 16).toString('hex');
        const a4 = buf.subarray(0, 4).toString('latin1');
        const b4 = buf.subarray(4, 8).toString('latin1');
        switch (ext) {
            case 'jpg':
            case 'jpeg':
                return hex.startsWith('ffd8ff');
            case 'png':
                return hex.startsWith('89504e47');
            case 'gif':
                return a4 === 'GIF8';
            case 'webp':
                return a4 === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
            case 'bmp':
                return hex.startsWith('424d');
            case 'webm':
                return hex.startsWith('1a45dfa3');
            case 'ogg':
                return a4 === 'OggS';
            case 'mp4':
            case 'm4v':
            case 'm4a':
                return b4 === 'ftyp';
            case 'mov':
                return b4 === 'ftyp' || ['moov', 'mdat', 'free', 'wide'].includes(b4);
            case 'aac':
                return /^fff[019]/.test(hex);
            case 'mp3':
                return hex.startsWith('494433') || /^ff[ef][0-9a-f]/.test(hex);
            default:
                return null;
        }
    }
    static EXT_MIME = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        mp4: 'video/mp4',
        m4v: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        ogg: 'audio/ogg',
    };
    normalizeMime(originalName, clientMime) {
        const ext = (originalName.split('.').pop() || '').toLowerCase();
        const mapped = UploadService_1.EXT_MIME[ext];
        if (mapped)
            return mapped;
        const cm = (clientMime || '').split(';')[0].trim().toLowerCase();
        if (cm && cm !== 'application/octet-stream')
            return cm;
        return 'application/octet-stream';
    }
    async validate(input) {
        const { exts, maxMB } = await this.limits();
        const ext = (input.originalName.split('.').pop() || '').toLowerCase();
        if (!ext || ext === input.originalName.toLowerCase()) {
            return '无法识别文件类型（缺少扩展名）';
        }
        if (!exts.includes(ext)) {
            return `不支持的格式 .${ext}，允许：${exts.join('/')}`;
        }
        if (input.buffer.length > maxMB * 1024 * 1024) {
            return `文件超过 ${maxMB}MB 上限，请改用腾讯云 COS / MinIO / S3 / R2 / Immich 等大容量存储渠道上传`;
        }
        if (this.signatureOk(input.buffer, ext) === false) {
            return `文件内容与扩展名不符（.${ext}），已拒绝上传`;
        }
        return null;
    }
    async moderate(buffer, mime) {
        if (!mime.startsWith('image/'))
            return null;
        let cfg;
        try {
            const security = await this.sysConfig.get('security');
            cfg = security?.upload?.moderate;
        }
        catch {
            return null;
        }
        if (!cfg?.enabled)
            return null;
        const timeout = AbortSignal.timeout(8000);
        try {
            if (cfg.channel === 'moderatecontent.com') {
                if (!cfg.moderateContentApiKey)
                    return null;
                const form = new FormData();
                form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), 'image');
                const resp = await fetch(`https://api.moderatecontent.com/moderate/?key=${encodeURIComponent(cfg.moderateContentApiKey)}`, { method: 'POST', body: form, signal: timeout });
                const json = await resp.json();
                const idx = Number(json?.rating_index);
                if (Number.isFinite(idx) && idx >= 3) {
                    return `图片未通过内容审查（评级 ${json?.rating_letter || idx}）`;
                }
            }
            else if (cfg.channel === 'nsfwjs') {
                if (!cfg.nsfwApiPath)
                    return null;
                const form = new FormData();
                form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), 'image');
                const resp = await fetch(cfg.nsfwApiPath, { method: 'POST', body: form, signal: timeout });
                const json = await resp.json();
                let porn = 0;
                if (typeof json?.porn === 'number') {
                    porn = json.porn;
                }
                else if (Array.isArray(json?.predictions)) {
                    porn = Math.max(0, ...json.predictions
                        .filter((p) => ['Porn', 'Hentai', 'Sexy'].includes(p?.className))
                        .map((p) => Number(p?.probability) || 0));
                }
                if (porn >= 0.6) {
                    return `图片未通过内容审查（敏感度 ${porn.toFixed(2)}）`;
                }
            }
        }
        catch (err) {
            console.warn('[moderate] 审查接口异常，放行:', err.message);
        }
        return null;
    }
    async cachedAddress(ip) {
        if (!ip)
            return '';
        try {
            const cached = await prisma_1.prisma.ipRecord.findUnique({ where: { ip } });
            if (cached && (cached.country || cached.region || cached.city)) {
                return [cached.country, cached.region, cached.city].filter(Boolean).join(' ');
            }
        }
        catch {
        }
        return '';
    }
    async resolveAddress(ip) {
        if (!ip)
            return '';
        try {
            const cached = await prisma_1.prisma.ipRecord.findUnique({ where: { ip } });
            if (cached && (cached.country || cached.region || cached.city)) {
                return [cached.country, cached.region, cached.city].filter(Boolean).join(' ');
            }
        }
        catch {
        }
        let cfg;
        try {
            const security = await this.sysConfig.get('security');
            cfg = security?.upload?.ipQuery;
        }
        catch {
            return '';
        }
        if (!cfg?.enabled)
            return '';
        const timeout = AbortSignal.timeout(6000);
        try {
            let country = '';
            let region = '';
            let city = '';
            if (cfg.channel === 'customApi' && cfg.customApi?.url) {
                let url = String(cfg.customApi.url);
                for (const p of cfg.customApi.params || []) {
                    if (!p?.key)
                        continue;
                    url = url.replace(new RegExp(`\\{${p.key}\\}`, 'g'), encodeURIComponent(p.value === '{ip}' ? ip : p.value));
                }
                const resp = await fetch(url, { signal: timeout });
                const json = await resp.json();
                const pick = (path) => String(path)
                    .split('.')
                    .reduce((o, k) => (o == null ? '' : o[k]), json) || '';
                const fields = cfg.customApi.responseFields || [];
                const parts = fields.map(pick).filter(Boolean);
                const address = parts.join(' ');
                if (address)
                    await this.cacheAddress(ip, '', '', address);
                return address;
            }
            const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`, {
                signal: timeout,
            });
            const json = await resp.json();
            country = json?.country || '';
            region = json?.regionName || '';
            city = json?.city || '';
            const address = [country, region, city].filter(Boolean).join(' ');
            if (address)
                await this.cacheAddress(ip, country, region, [city].filter(Boolean).join(' '));
            return address;
        }
        catch (err) {
            console.warn('[ipQuery] 归属地查询失败:', err.message);
            return '';
        }
    }
    async cacheAddress(ip, country, region, city) {
        await prisma_1.prisma.ipRecord.upsert({
            where: { ip },
            update: { country, region, city },
            create: { ip, country, region, city },
        });
    }
    async touchIp(ip, address) {
        if (!ip)
            return;
        try {
            const parts = (address || '').split(' ');
            await prisma_1.prisma.ipRecord.upsert({
                where: { ip },
                update: { uploadCount: { increment: 1 } },
                create: {
                    ip,
                    country: parts[0] || '',
                    region: parts[1] || '',
                    city: parts.slice(2).join(' '),
                    uploadCount: 1,
                },
            });
        }
        catch (err) {
            console.warn('[ipRecord] 计数失败:', err.message);
        }
    }
    async autoTag(fileId, info) {
        try {
            if ((await this.settings.get('autoTagEnabled', 'true')) === 'false')
                return;
            const ext = info.originalName.includes('.') ? String(info.originalName.split('.').pop() || '').toLowerCase() : '';
            const names = Array.from(new Set([
                (0, file_view_1.fileTypeOf)(info.mime),
                ext.replace(/^\./, ''),
                (0, file_view_1.channelShort)(info.channelType),
                (0, file_view_1.normalizeUploadSource)(info.uploadSource),
                String(new Date().getFullYear()),
            ]
                .map((v) => String(v || '').trim())
                .filter(Boolean)));
            for (const name of names) {
                const tag = await prisma_1.prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
                const exists = await prisma_1.prisma.fileTag.findFirst({
                    where: { fileId, tagId: tag.id },
                    select: { id: true },
                });
                if (!exists)
                    await prisma_1.prisma.fileTag.create({ data: { fileId, tagId: tag.id } });
            }
        }
        catch (err) {
            app_log_1.appLog.warn('upload', `自动打标签失败（不影响文件本身）`, err?.message || String(err));
        }
    }
    toChannelInfo(c) {
        return { id: c.id, name: c.name, type: c.type, config: this.channels.decryptConfig(c.type, c.config), metas: {} };
    }
    async channelWritable(c) {
        let cfg = {};
        try {
            cfg = JSON.parse(c.config || '{}');
        }
        catch {
            return true;
        }
        if (cfg.quotaEnabled !== 'true')
            return true;
        const limitGB = Number(cfg.quotaLimitGB) || 10;
        const threshold = Number(cfg.quotaThreshold) || 95;
        const rows = await prisma_1.prisma.fileCopy.findMany({
            where: { channelId: c.id, status: 'active' },
            include: { file: { select: { size: true } } },
        });
        const usedGB = rows.reduce((a, b) => a + (b.file?.size || 0), 0) / 1024 / 1024 / 1024;
        return usedGB / limitGB < threshold / 100;
    }
    async findChannelById(key) {
        return this.storageChannel.findById(key);
    }
    async resolveMainChannel(q = {}) {
        const list = await this.storageChannel.getStorageChannelCandidates('main', {
            explicitId: q.channelId,
            channelType: q.channelType,
            uploader: q.uploader,
            tokenId: q.tokenId,
        });
        if (q.preferredId && !list.some((c) => c.id === q.preferredId)) {
            const extra = await this.storageChannel.findById(q.preferredId);
            if (extra)
                list.push(extra);
        }
        for (const c of list) {
            if (await this.channelWritable(c))
                return c;
        }
        if (q.channelId && list.length) {
            throw new Error(`渠道「${list[0].name}」已达到容量阈值，写入已暂停`);
        }
        return null;
    }
    async resolveBackupChannel(q = {}) {
        const list = await this.storageChannel.getStorageChannelCandidates('backup', {
            explicitId: q.explicitId,
            uploader: q.uploader,
            tokenId: q.tokenId,
        });
        if (q.preferredId && !list.some((c) => c.id === q.preferredId)) {
            const extra = await this.storageChannel.findById(q.preferredId);
            if (extra)
                list.push(extra);
        }
        for (const c of list) {
            if (await this.channelWritable(c))
                return c;
        }
        return null;
    }
    async backupEnabled() {
        const sw = await this.settings.get('backupEnabled', 'true');
        return sw === 'true';
    }
    makeKey(originalName, nameType, _folder) {
        const ext = originalName.includes('.') ? '.' + originalName.split('.').pop() : '';
        const date = new Date();
        const datePath = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
        let name;
        switch (nameType) {
            case 'original':
                name = originalName.replace(/\.[^.]+$/, '');
                break;
            case 'index':
                name = datePath + String(date.getTime());
                break;
            default:
                name = crypto_service_1.CryptoService.shortId();
        }
        return `${datePath}/${name}${ext}`;
    }
    async resolveFolder(input) {
        const clean = (input || '').replace(/^\/+|\/+$/g, '');
        if (clean)
            return clean;
        try {
            const page = await this.sysConfig.get('page');
            const v = String((page?.config || []).find((x) => x.id === 'defaultUploadFolder')?.value || '').trim();
            const dv = v.replace(/^\/+|\/+$/g, '');
            if (dv)
                return dv;
        }
        catch {
        }
        const d = new Date();
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    async defaultCompressPercent() {
        try {
            const page = await this.sysConfig.get('page');
            const v = Number((page?.config || []).find((x) => x.id === 'defaultCompressQuality')?.value);
            if (Number.isFinite(v) && v >= 10 && v <= 100)
                return v;
        }
        catch {
        }
        return 80;
    }
    makeFileId() {
        return crypto_service_1.CryptoService.fileId(48);
    }
    sanitizeFileId(raw) {
        let s = String(raw || '').trim();
        s = s.replace(/^https?:\/\/[^/]+/i, '');
        s = s.split('?')[0].split('#')[0];
        s = s
            .split('/')
            .filter((seg) => seg && seg !== '.' && seg !== '..')
            .join('/');
        s = s.replace(/[\u0000-\u001f<>:"|*\\]/g, '_');
        return s.slice(0, 200);
    }
    async uniqueFileId(base) {
        const fallback = base || this.makeFileId();
        const ext = /\.[A-Za-z0-9]{1,8}$/.test(fallback) ? fallback.slice(fallback.lastIndexOf('.')) : '';
        const stem = ext ? fallback.slice(0, -ext.length) : fallback;
        for (let i = 0; i < 50; i += 1) {
            const candidate = i === 0 ? fallback : `${stem}-${i}${ext}`;
            const exists = await prisma_1.prisma.fileRecord.findFirst({ where: { name: candidate }, select: { id: true } });
            if (!exists)
                return candidate;
        }
        return this.makeFileId();
    }
    async dedupEnabled() {
        try {
            return (await this.settings.get('dedupEnabled', 'false')) === 'true';
        }
        catch {
            return false;
        }
    }
    async dedupScope() {
        try {
            return (await this.settings.get('dedupScope', 'all')) === 'channel' ? 'channel' : 'all';
        }
        catch {
            return 'all';
        }
    }
    async compress(buffer, mime, percent) {
        const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
        sharp.cache({ memory: 32 });
        sharp.concurrency(2);
        const ratio = Math.min(1, Math.max(0.1, (percent || 80) / 100));
        const target = Math.max(1024, Math.round(buffer.length * ratio));
        let quality = 82;
        let out = await sharp(buffer, { limitInputPixels: 25_000_000 }).rotate().webp({ quality }).toBuffer();
        for (let i = 0; i < 4 && out.length > target && quality > 20; i++) {
            quality = Math.max(20, Math.round(quality * Math.sqrt(target / out.length)));
            out = await sharp(buffer, { limitInputPixels: 25_000_000 }).rotate().webp({ quality }).toBuffer();
        }
        return { buffer: out, mime: 'image/webp', ext: '.webp' };
    }
    async upload(input, opts) {
        this.activeUploads += 1;
        try {
            return await this.uploadInner(input, opts);
        }
        finally {
            this.activeUploads -= 1;
        }
    }
    async uploadInner(input, opts) {
        let { buffer, mime, originalName } = input;
        if (!opts.skipFileLimits) {
            const invalid = await this.validate(input);
            if (invalid)
                return { id: '', error: invalid };
        }
        const originalSize = opts.originalSize && opts.originalSize > 0 ? opts.originalSize : buffer.length;
        mime = this.normalizeMime(originalName, mime);
        const rejected = await this.moderate(buffer, mime);
        if (rejected)
            return { id: '', error: rejected };
        const uploadIp = opts.ip || '';
        const uploadAddress = await this.cachedAddress(uploadIp);
        if (opts.serverCompress && mime.startsWith('image/') && mime !== 'image/gif') {
            try {
                const pct = opts.compressPercent && opts.compressPercent > 0 ? opts.compressPercent : await this.defaultCompressPercent();
                const c = await this.compress(buffer, mime, pct);
                buffer = c.buffer;
                mime = c.mime;
                originalName = originalName.replace(/\.[^.]+$/, '') + c.ext;
            }
            catch (err) {
                console.warn('[upload] 压缩失败，使用原图:', err.message);
            }
        }
        let main = null;
        try {
            main = await this.resolveMainChannel({
                channelId: opts.channelId,
                channelType: opts.uploadChannel,
                uploader: opts.uploader,
                tokenId: opts.tokenId,
            });
        }
        catch (err) {
            return { id: '', error: err.message };
        }
        if (!main) {
            const hint = opts.channelId
                ? `渠道 ID「${opts.channelId}」不存在或已禁用`
                : opts.uploadChannel
                    ? `没有可用的「${opts.uploadChannel}」渠道，且未设置全局主渠道`
                    : '未指定渠道，且「用户管理」「上传设置」里都没有可用的主渠道';
            return { id: '', error: `未配置可用的主渠道（${hint}），请先在后台「存储渠道」检查` };
        }
        const md5 = (0, crypto_1.createHash)('md5').update(buffer).digest('hex');
        if (await this.dedupEnabled()) {
            const scope = await this.dedupScope();
            const dup = await prisma_1.prisma.fileRecord.findFirst({
                where: { status: 'active', size: buffer.length, md5 },
                select: {
                    name: true,
                    originalName: true,
                    copies: { select: { channelId: true, status: true, isPrimary: true } },
                },
            });
            let hit = dup;
            if (dup && scope === 'channel') {
                const primaryCopy = dup.copies.find((c) => c.isPrimary) || dup.copies[0];
                if (!primaryCopy || primaryCopy.channelId !== main.id)
                    hit = null;
            }
            if (hit) {
                app_log_1.appLog.info('upload', `命中去重：${originalName} 与已有文件 ${hit.originalName}（${hit.name}）内容相同，复用已有外链`, `md5=${md5} ｜ 大小=${buffer.length}B ｜ 范围=${scope === 'channel' ? `同渠道（${main.name}）` : '全部渠道'}`, uploadIp);
                return { id: hit.name, dedup: true };
            }
        }
        const folder = await this.resolveFolder(opts.uploadFolder);
        const key = this.makeKey(originalName, opts.uploadNameType, folder);
        const chain = [main];
        if (opts.autoRetry) {
            const others = await prisma_1.prisma.channel.findMany({
                where: { enabled: true, NOT: { id: main.id } },
                orderBy: { code: 'asc' },
            });
            chain.push(...others);
        }
        const startedAt = Date.now();
        let result;
        let usedChannel = main;
        let lastErr = '';
        for (const ch of chain) {
            if (ch.id !== main.id && !(await this.channelWritable(ch)))
                continue;
            try {
                const info = this.toChannelInfo(ch);
                result = await (0, adapter_factory_1.createAdapter)(info).upload({ buffer, mime, originalName }, key, info);
                usedChannel = ch;
                break;
            }
            catch (err) {
                lastErr = err.message || String(err);
                app_log_1.appLog.warn('upload', `渠道上传失败：${ch.name}（${ch.type}）${opts.autoRetry ? '，尝试自动切换下一个渠道' : ''}`, `${lastErr} ｜ key=${key} ｜ 大小=${buffer.length}B ｜ 文件=${originalName}`, uploadIp);
            }
        }
        if (!result) {
            return {
                id: '',
                error: opts.autoRetry
                    ? `所有可用渠道均上传失败（最后错误：${lastErr}）`
                    : `存储渠道「${main.name}」上传失败：${lastErr}`,
            };
        }
        if (usedChannel.id !== main.id) {
            app_log_1.appLog.info('upload', `自动切换成功：${main.name} → ${usedChannel.name}（${usedChannel.type}）`, `key=${key}`, uploadIp);
        }
        app_log_1.appLog.info('upload', `上传成功：${usedChannel.name}（${usedChannel.type}）`, `${key} ｜ ${buffer.length}B ｜ 耗时 ${Date.now() - startedAt}ms ｜ 文件=${originalName}`, uploadIp);
        const fileId = opts.presetFileId
            ? await this.uniqueFileId(this.sanitizeFileId(opts.presetFileId))
            : this.makeFileId();
        const record = await prisma_1.prisma.fileRecord.create({
            data: {
                name: fileId,
                originalName,
                size: buffer.length,
                originalSize,
                mime,
                md5,
                folder,
                uploader: opts.uploader || '',
                uploadSource: (0, file_view_1.normalizeUploadSource)(opts.uploadSource),
                ip: uploadIp,
                metas: JSON.stringify({ UploadAddress: uploadAddress }),
                copies: {
                    create: {
                        channelId: usedChannel.id,
                        remoteKey: result.remoteKey,
                        remoteUrl: result.remoteUrl || '',
                        status: 'active',
                    },
                },
            },
        });
        this.enqueueBackground(() => this.touchIp(uploadIp, uploadAddress));
        if (uploadIp && !uploadAddress) {
            this.enqueueBackground(async () => {
                const addr = await this.resolveAddress(uploadIp);
                if (!addr)
                    return;
                const cur = await prisma_1.prisma.fileRecord.findUnique({ where: { id: record.id }, select: { metas: true } });
                if (!cur)
                    return;
                let metas = {};
                try {
                    metas = JSON.parse(cur.metas || '{}');
                }
                catch {
                    metas = {};
                }
                await prisma_1.prisma.fileRecord.update({
                    where: { id: record.id },
                    data: { metas: JSON.stringify({ ...metas, UploadAddress: addr }) },
                });
                await this.touchIp(uploadIp, addr);
            });
        }
        this.enqueueBackground(() => this.autoTag(record.id, {
            originalName,
            mime,
            channelType: usedChannel.type,
            uploadSource: opts.uploadSource,
        }));
        if (opts.backup !== false) {
            const payload = { buffer, mime, originalName };
            this.enqueueBackground(async () => {
                if (!(await this.backupEnabled()))
                    return;
                const backup = await this.resolveBackupChannel({
                    explicitId: opts.backupChannelId,
                    uploader: opts.uploader,
                    tokenId: opts.tokenId,
                });
                if (!backup || backup.id === usedChannel.id)
                    return;
                await this.enqueueLowPriority(async () => {
                    await this.backupUpload(record.id, payload, key, backup);
                });
            });
        }
        return { id: fileId };
    }
    async backupUpload(fileId, file, key, backup) {
        await prisma_1.prisma.fileCopy.upsert({
            where: { fileId_channelId: { fileId, channelId: backup.id } },
            update: { status: 'pending' },
            create: { fileId, channelId: backup.id, remoteKey: '', remoteUrl: '', status: 'pending' },
        });
        try {
            const info = this.toChannelInfo(backup);
            const adapter = (0, adapter_factory_1.createAdapter)(info);
            const t0 = Date.now();
            const result = await adapter.upload(file, key, info);
            await prisma_1.prisma.fileCopy.update({
                where: { fileId_channelId: { fileId, channelId: backup.id } },
                data: { remoteKey: result.remoteKey, remoteUrl: result.remoteUrl || '', status: 'active' },
            });
            app_log_1.appLog.info('backup', `备份完成：${backup.name}（${backup.type}）`, `${key} ｜ ${file.buffer.length}B ｜ 耗时 ${Date.now() - t0}ms（低优先级，主渠道上传期间自动让路）`);
        }
        catch (err) {
            app_log_1.appLog.error('backup', `备份渠道写入失败：${backup.name}（${backup.type}）`, `${err.message} ｜ key=${key}`);
            await prisma_1.prisma.fileCopy.update({
                where: { fileId_channelId: { fileId, channelId: backup.id } },
                data: { status: 'failed', metas: JSON.stringify({ error: err.message }) },
            });
        }
    }
    async rebackup(fileIds) {
        let ok = 0;
        let fail = 0;
        let skipped = 0;
        const keys = (fileIds || []).filter(Boolean);
        const records = await prisma_1.prisma.fileRecord.findMany({
            where: { OR: [{ id: { in: keys } }, { name: { in: keys } }] },
            include: { copies: true },
        });
        const cache = new Map();
        const backupFor = async (uploader) => {
            const k = String(uploader || '');
            if (!cache.has(k))
                cache.set(k, await this.resolveBackupChannel({ uploader: k || undefined }));
            return cache.get(k) ?? null;
        };
        for (const rec of records) {
            const backup = await backupFor(rec.uploader);
            if (!backup) {
                fail += 1;
                continue;
            }
            const outcome = await this.enqueueLowPriority(async () => {
                if (!rec.copies.some((c) => c.status === 'active' && c.remoteKey))
                    return 'fail';
                if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active'))
                    return 'skipped';
                try {
                    await this.backupSingleFromMain(rec, backup);
                    return 'ok';
                }
                catch (err) {
                    console.error('[rebackup] 补备份失败:', rec.name, err.message);
                    return 'fail';
                }
            });
            if (outcome === 'ok')
                ok += 1;
            else if (outcome === 'skipped')
                skipped += 1;
            else
                fail += 1;
        }
        return { ok, fail, skipped, total: records.length };
    }
    async removeFile(id, name = '') {
        const copies = await prisma_1.prisma.fileCopy.findMany({ where: { fileId: id } });
        for (const copy of copies) {
            const ch = await prisma_1.prisma.channel.findUnique({ where: { id: copy.channelId } });
            if (!ch)
                continue;
            try {
                const info = {
                    id: ch.id,
                    name: ch.name,
                    type: ch.type,
                    config: this.channels.decryptConfig(ch.type, ch.config),
                    metas: {},
                };
                await (0, adapter_factory_1.createAdapter)(info).delete((0, adapter_factory_1.toCopyInfo)(copy), info);
            }
            catch (err) {
                app_log_1.appLog.warn('upload', `远端删除失败（继续删库）${name || id}`, err.message);
            }
        }
        await prisma_1.prisma.fileRecord.delete({ where: { id } });
        app_log_1.appLog.info('upload', `删除文件：${name || id}`, `远端副本 ${copies.length} 个`);
    }
    backupAllJob = null;
    startBackupAll() {
        if (this.backupAllJob?.running) {
            return { started: false, message: '已有备份任务在进行中，请稍候' };
        }
        this.backupAllJob = { running: true, total: 0, done: 0, ok: 0, fail: 0, startedAt: Date.now(), finishedAt: 0 };
        void this.runBackupAll().catch((err) => {
            app_log_1.appLog.error('backup', `一键备份任务异常终止：${err.message}`);
            if (this.backupAllJob) {
                this.backupAllJob.running = false;
                this.backupAllJob.finishedAt = Date.now();
            }
        });
        return { started: true };
    }
    backupAllStatus() {
        return this.backupAllJob || { running: false, total: 0, done: 0, ok: 0, fail: 0, startedAt: 0, finishedAt: 0 };
    }
    async runBackupAll() {
        const job = this.backupAllJob;
        const records = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active' },
            include: { copies: true },
            orderBy: { createdAt: 'desc' },
        });
        const cache = new Map();
        const backupFor = async (uploader) => {
            const k = String(uploader || '');
            if (!cache.has(k))
                cache.set(k, await this.resolveBackupChannel({ uploader: k || undefined }));
            return cache.get(k) ?? null;
        };
        const pending = [];
        for (const rec of records) {
            const backup = await backupFor(rec.uploader);
            if (!backup)
                continue;
            if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active'))
                continue;
            pending.push({ rec, backup });
        }
        job.total = pending.length;
        if (!pending.length) {
            app_log_1.appLog.info('backup', '一键备份：所有文件均已有备份，无需处理');
            job.running = false;
            job.finishedAt = Date.now();
            return;
        }
        app_log_1.appLog.info('backup', `一键备份开始：共 ${pending.length} 个文件待备份`);
        for (const { rec, backup } of pending) {
            const okOne = await this.enqueueLowPriority(async () => {
                try {
                    await this.backupSingleFromMain(rec, backup);
                    return true;
                }
                catch (err) {
                    app_log_1.appLog.error('backup', `一键备份失败：${rec.name}（${rec.originalName}）`, err.message);
                    return false;
                }
            });
            if (okOne)
                job.ok += 1;
            else
                job.fail += 1;
            job.done += 1;
        }
        job.running = false;
        job.finishedAt = Date.now();
        app_log_1.appLog.info('backup', `一键备份完成：成功 ${job.ok}，失败 ${job.fail}，共 ${job.total}`);
    }
    async backupSingleFromMain(rec, backup) {
        if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active'))
            return;
        const mainCopy = rec.copies.find((c) => c.status === 'active' && c.remoteKey);
        if (!mainCopy)
            throw new Error('没有可用的主渠道副本');
        const mainCh = await prisma_1.prisma.channel.findUnique({ where: { id: mainCopy.channelId } });
        if (!mainCh)
            throw new Error('主渠道记录不存在');
        const mainInfo = this.toChannelInfo(mainCh);
        const mainAdapter = (0, adapter_factory_1.createAdapter)(mainInfo);
        let buf;
        if (mainCh.type === 'local') {
            const abs = (0, local_adapter_1.localFileAbs)(mainCopy.remoteKey);
            if (!abs)
                throw new Error('本地文件不存在，无法备份');
            buf = await fs_1.promises.readFile(abs);
        }
        else {
            const url = mainAdapter.buildDirectUrl((0, adapter_factory_1.toCopyInfo)(mainCopy), mainInfo);
            if (!url)
                throw new Error('无法构造主渠道直链');
            const resp = await fetch(url);
            if (!resp.ok)
                throw new Error(`源文件拉取失败 HTTP ${resp.status}`);
            buf = Buffer.from(await resp.arrayBuffer());
        }
        const info = this.toChannelInfo(backup);
        const adapter = (0, adapter_factory_1.createAdapter)(info);
        const result = await adapter.upload({ buffer: buf, mime: rec.mime, originalName: rec.originalName }, mainCopy.remoteKey, info);
        await prisma_1.prisma.fileCopy.upsert({
            where: { fileId_channelId: { fileId: rec.id, channelId: backup.id } },
            update: { remoteKey: result.remoteKey, remoteUrl: result.remoteUrl || '', status: 'active' },
            create: { fileId: rec.id, channelId: backup.id, remoteKey: result.remoteKey, remoteUrl: result.remoteUrl || '', status: 'active' },
        });
    }
};
exports.UploadService = UploadService;
exports.UploadService = UploadService = UploadService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        channels_controller_1.ChannelsService,
        sysconfig_service_1.SysConfigService,
        storage_channel_service_1.StorageChannelService])
], UploadService);
