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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelManageController = exports.StorageSettingsController = exports.ChannelsController = exports.ChannelsService = exports.LOCAL_CHANNEL_CODE = exports.BUILTIN_CHANNEL_TYPES = exports.CHANNEL_TYPES = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const crypto_service_1 = require("../common/crypto.service");
const auth_guard_1 = require("../auth/auth.guard");
const settings_service_1 = require("../settings/settings.service");
const adapter_factory_1 = require("../adapters/adapter.factory");
const storage_channel_service_1 = require("../storage/storage-channel.service");
const SECRET_FIELDS = {
    local: [],
    cos: ['secretId', 'secretKey'],
    minio: ['accessKeyId', 'secretAccessKey'],
    r2: ['accessKeyId', 'secretAccessKey'],
    s3: ['accessKeyId', 'secretAccessKey'],
    easyimages: ['tokenValue'],
    lsky: ['tokenValue'],
    webdav: ['password'],
    immich: ['apiKey'],
    custom: ['tokenValue'],
};
exports.CHANNEL_TYPES = ['cos', 'minio', 'r2', 's3', 'aliyun', 'easyimages', 'lsky', 'webdav', 'immich', 'custom'];
exports.BUILTIN_CHANNEL_TYPES = ['local'];
exports.LOCAL_CHANNEL_CODE = '100000';
async function makeTestPng() {
    try {
        const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
        return await sharp({
            create: { width: 512, height: 512, channels: 3, background: { r: 84, g: 150, b: 214 } },
        })
            .png()
            .toBuffer();
    }
    catch {
        return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    }
}
const IDENTITY_FIELDS = {
    cos: ['secretId', 'bucket', 'region'],
    minio: ['endpoint', 'bucket', 'accessKeyId'],
    r2: ['endpoint', 'bucket', 'accessKeyId'],
    s3: ['endpoint', 'bucket', 'accessKeyId'],
    easyimages: ['apiUrl', 'tokenValue'],
    lsky: ['apiUrl', 'tokenValue'],
    webdav: ['baseUri', 'username'],
    immich: ['serverUrl', 'apiKey'],
    custom: ['apiUrl', 'tokenValue'],
};
function channelIdentity(type, cfg) {
    const fields = IDENTITY_FIELDS[type] || [];
    return `${type}::${fields.map((f) => cfg[f] || '').join('|')}`;
}
let ChannelsService = class ChannelsService {
    settings;
    constructor(settings) {
        this.settings = settings;
    }
    decryptConfig(type, configJson) {
        const cfg = JSON.parse(configJson || '{}');
        const out = {};
        for (const [k, v] of Object.entries(cfg)) {
            out[k] = SECRET_FIELDS[type]?.includes(k) ? crypto_service_1.CryptoService.decrypt(String(v)) : String(v);
        }
        return out;
    }
    maskConfig(type, configJson) {
        const cfg = JSON.parse(configJson || '{}');
        const out = {};
        for (const [k, v] of Object.entries(cfg)) {
            out[k] = SECRET_FIELDS[type]?.includes(k) ? crypto_service_1.CryptoService.mask(crypto_service_1.CryptoService.decrypt(String(v))) : String(v);
        }
        return out;
    }
    identityOf(type, configJson) {
        return channelIdentity(type, this.decryptConfig(type, configJson));
    }
    async ensureBuiltinLocalChannel() {
        const existing = await prisma_1.prisma.channel.findUnique({ where: { code: exports.LOCAL_CHANNEL_CODE } });
        if (existing) {
            const patch = {};
            if (existing.type !== 'local')
                patch.type = 'local';
            if (!existing.enabled)
                patch.enabled = true;
            if (!existing.isMain && !existing.isBackup) {
                const hasMain = await prisma_1.prisma.channel.count({
                    where: { isMain: true, enabled: true, NOT: { id: existing.id } },
                });
                if (hasMain === 0)
                    patch.isMain = true;
            }
            if (Object.keys(patch).length) {
                await prisma_1.prisma.channel.update({ where: { id: existing.id }, data: patch });
            }
            return;
        }
        let name = '本地存储';
        if (await prisma_1.prisma.channel.findUnique({ where: { name } }))
            name = '本地存储（系统）';
        const hasMain = await prisma_1.prisma.channel.count({ where: { isMain: true } });
        await prisma_1.prisma.channel.create({
            data: {
                code: exports.LOCAL_CHANNEL_CODE,
                name,
                type: 'local',
                enabled: true,
                isMain: hasMain === 0,
                isBackup: false,
                sortOrder: 9999,
                config: JSON.stringify({ quotaEnabled: 'false', quotaLimitGB: '10', quotaThreshold: '95' }),
            },
        });
    }
};
exports.ChannelsService = ChannelsService;
exports.ChannelsService = ChannelsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService])
], ChannelsService);
let ChannelsController = class ChannelsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    async list(includeDisabled) {
        const channels = await prisma_1.prisma.channel.findMany({
            where: includeDisabled === 'true' ? {} : { enabled: true },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        const grouped = {};
        for (const c of channels) {
            if (!grouped[c.type])
                grouped[c.type] = [];
            grouped[c.type].push({
                id: c.id,
                code: c.code,
                name: c.name,
                type: c.type,
                enabled: c.enabled,
                isMain: c.isMain,
                isBackup: c.isBackup,
                config: this.svc.maskConfig(c.type, c.config),
            });
        }
        return grouped;
    }
};
exports.ChannelsController = ChannelsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('includeDisabled')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChannelsController.prototype, "list", null);
exports.ChannelsController = ChannelsController = __decorate([
    (0, common_1.Controller)('api/channels'),
    __metadata("design:paramtypes", [ChannelsService])
], ChannelsController);
let StorageSettingsController = class StorageSettingsController {
    settings;
    svc;
    storageChannel;
    constructor(settings, svc, storageChannel) {
        this.settings = settings;
        this.svc = svc;
        this.storageChannel = storageChannel;
    }
    async get() {
        const [linkMode, accessChannel, proxyTimeoutMs, proxyCacheSeconds, dedupEnabled, dedupScope, customDomain] = await Promise.all([
            this.settings.getLinkMode(),
            this.settings.getAccessChannel(),
            this.settings.get('proxyTimeoutMs', '15000'),
            this.settings.get('proxyCacheSeconds', '86400'),
            this.settings.get('dedupEnabled', 'false'),
            this.settings.get('dedupScope', 'all'),
            this.settings.getCustomDomain(),
        ]);
        const pickBrief = (c) => c ? { id: c.id, code: c.code, name: c.name, type: c.type, enabled: true } : null;
        return {
            linkMode,
            accessChannel,
            proxyTimeoutMs: Number(proxyTimeoutMs) || 15000,
            proxyCacheSeconds: Number(proxyCacheSeconds) || 86400,
            dedupEnabled: dedupEnabled === 'true',
            dedupScope: dedupScope === 'channel' ? 'channel' : 'all',
            customDomain,
            mainChannel: pickBrief(await this.storageChannel.getStorageChannel('', 'main')),
            backupChannel: pickBrief(await this.storageChannel.getStorageChannel('', 'backup')),
        };
    }
    async save(body) {
        if (body.linkMode !== undefined) {
            const v = body.linkMode === 'redirect' ? 'redirect' : 'proxy';
            await this.settings.set('linkMode', v);
        }
        if (body.accessChannel !== undefined) {
            await this.settings.set('accessChannel', body.accessChannel === 'backup' ? 'backup' : 'main');
        }
        if (body.proxyTimeoutMs !== undefined) {
            const n = Math.min(120000, Math.max(1000, Number(body.proxyTimeoutMs) || 15000));
            await this.settings.set('proxyTimeoutMs', String(n));
        }
        if (body.proxyCacheSeconds !== undefined) {
            const n = Math.max(0, Number(body.proxyCacheSeconds) || 0);
            await this.settings.set('proxyCacheSeconds', String(n));
        }
        if (body.dedupEnabled !== undefined) {
            await this.settings.set('dedupEnabled', body.dedupEnabled ? 'true' : 'false');
        }
        if (body.dedupScope !== undefined) {
            await this.settings.set('dedupScope', body.dedupScope === 'channel' ? 'channel' : 'all');
        }
        if (body.customDomain !== undefined) {
            const dom = String(body.customDomain || '').trim().replace(/\/+$/, '');
            await this.settings.set('customDomain', dom);
        }
        return { success: true };
    }
};
exports.StorageSettingsController = StorageSettingsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], StorageSettingsController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], StorageSettingsController.prototype, "save", null);
exports.StorageSettingsController = StorageSettingsController = __decorate([
    (0, common_1.Controller)('api/manage/storage'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        ChannelsService,
        storage_channel_service_1.StorageChannelService])
], StorageSettingsController);
let ChannelManageController = class ChannelManageController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    async list() {
        const channels = await prisma_1.prisma.channel.findMany({
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        const copies = await prisma_1.prisma.fileCopy.findMany({
            where: { status: 'active' },
            include: { file: { select: { size: true } } },
        });
        const usageMB = new Map();
        for (const c of copies) {
            usageMB.set(c.channelId, (usageMB.get(c.channelId) || 0) + (c.file?.size || 0) / 1024 / 1024);
        }
        const grouped = {};
        for (const type of exports.CHANNEL_TYPES)
            grouped[type] = [];
        for (const type of exports.BUILTIN_CHANNEL_TYPES)
            grouped[type] = [];
        for (const c of channels) {
            const config = this.svc.maskConfig(c.type, c.config);
            (grouped[c.type] ||= []).push({
                id: c.id,
                code: c.code,
                name: c.name,
                type: c.type,
                enabled: c.enabled,
                isMain: c.isMain,
                isBackup: c.isBackup,
                sortOrder: c.sortOrder,
                config,
                quota: {
                    enabled: config.quotaEnabled === 'true',
                    limitGB: Number(config.quotaLimitGB) || 10,
                    threshold: Number(config.quotaThreshold) || 95,
                    usedMB: Math.round((usageMB.get(c.id) || 0) * 100) / 100,
                },
            });
        }
        return grouped;
    }
    async plain(id) {
        const c = await prisma_1.prisma.channel.findUnique({ where: { id } });
        if (!c)
            return { success: false, message: '渠道不存在' };
        return { success: true, type: c.type, config: this.svc.decryptConfig(c.type, c.config) };
    }
    async enforceUniqueFlags(id, isMain, isBackup) {
        if (isMain) {
            await prisma_1.prisma.channel.updateMany({
                where: id ? { isMain: true, NOT: { id } } : { isMain: true },
                data: { isMain: false },
            });
        }
        if (isBackup) {
            await prisma_1.prisma.channel.updateMany({
                where: id ? { isBackup: true, NOT: { id } } : { isBackup: true },
                data: { isBackup: false },
            });
        }
    }
    async sameAccountAsMain(type, selfId, identity) {
        const main = await prisma_1.prisma.channel.findFirst({ where: { isMain: true, NOT: selfId ? { id: selfId } : undefined } });
        if (!main)
            return null;
        if (this.svc.identityOf(main.type, main.config) === identity) {
            return `备份渠道不能与主渠道「${main.name}」使用同一账户`;
        }
        return null;
    }
    async nextCode() {
        for (let i = 0; i < 60; i++) {
            const code = String(100000 + Math.floor(Math.random() * 900000));
            if (code === exports.LOCAL_CHANNEL_CODE)
                continue;
            if (!(await prisma_1.prisma.channel.findUnique({ where: { code } })))
                return code;
        }
        const fallback = String(Date.now()).slice(-6);
        return fallback === exports.LOCAL_CHANNEL_CODE ? '100001' : fallback;
    }
    async create(body) {
        if (!exports.CHANNEL_TYPES.includes(body.type)) {
            return { success: false, message: `不支持的渠道类型: ${body.type}` };
        }
        if (!body.name || !String(body.name).trim()) {
            return { success: false, message: '渠道名称不能为空' };
        }
        if (body.isBackup && body.isMain) {
            return { success: false, message: '同一条渠道不能同时作为主渠道和备份渠道' };
        }
        const dup = await prisma_1.prisma.channel.findFirst({ where: { name: body.name } });
        if (dup)
            return { success: false, message: `渠道名称「${body.name}」已存在` };
        const raw = body.config || {};
        if (body.isBackup) {
            const err = await this.sameAccountAsMain(body.type, null, channelIdentity(body.type, raw));
            if (err)
                return { success: false, message: err };
        }
        const encrypted = {};
        for (const [k, v] of Object.entries(raw)) {
            encrypted[k] = SECRET_FIELDS[body.type]?.includes(k) ? crypto_service_1.CryptoService.encrypt(String(v)) : String(v);
        }
        const ch = await prisma_1.prisma.channel.create({
            data: {
                name: body.name,
                type: body.type,
                config: JSON.stringify(encrypted),
                isMain: !!body.isMain,
                isBackup: !!body.isBackup,
                code: await this.nextCode(),
            },
        });
        await this.enforceUniqueFlags(ch.id, body.isMain, body.isBackup);
        return { success: true, data: { id: ch.id, code: ch.code } };
    }
    async update(id, body) {
        const ch = await prisma_1.prisma.channel.findUnique({ where: { id } });
        if (!ch)
            return { success: false, message: '渠道不存在' };
        if (body.isMain && body.isBackup) {
            return { success: false, message: '同一条渠道不能同时作为主渠道和备份渠道' };
        }
        if (body.name !== undefined && String(body.name).trim() !== ch.name) {
            const name = String(body.name).trim();
            if (!name)
                return { success: false, message: '渠道名称不能为空' };
            const dup = await prisma_1.prisma.channel.findFirst({ where: { name, NOT: { id } } });
            if (dup)
                return { success: false, message: `渠道名称「${name}」已存在` };
        }
        const old = this.svc.decryptConfig(ch.type, ch.config);
        const merged = { ...old };
        for (const [k, v] of Object.entries(body.config || {})) {
            if (String(v).includes('****'))
                continue;
            merged[k] = v;
        }
        if (body.isBackup) {
            const err = await this.sameAccountAsMain(ch.type, id, channelIdentity(ch.type, merged));
            if (err)
                return { success: false, message: err };
        }
        const encrypted = {};
        for (const [k, v] of Object.entries(merged)) {
            encrypted[k] = SECRET_FIELDS[ch.type]?.includes(k) ? crypto_service_1.CryptoService.encrypt(v) : v;
        }
        await prisma_1.prisma.channel.update({
            where: { id },
            data: {
                name: body.name !== undefined ? String(body.name).trim() : ch.name,
                enabled: body.enabled ?? ch.enabled,
                isMain: body.isMain ?? ch.isMain,
                isBackup: body.isBackup ?? ch.isBackup,
                config: JSON.stringify(encrypted),
            },
        });
        await this.enforceUniqueFlags(id, body.isMain, body.isBackup);
        return { success: true };
    }
    async test(body) {
        let type = body.type || '';
        let cfg = {};
        if (body.id) {
            const ch = await prisma_1.prisma.channel.findUnique({ where: { id: body.id } });
            if (!ch)
                return { success: false, message: '渠道不存在' };
            type = ch.type;
            cfg = this.svc.decryptConfig(ch.type, ch.config);
            for (const [k, v] of Object.entries(body.config || {})) {
                if (String(v).includes('****'))
                    continue;
                cfg[k] = v;
            }
        }
        else {
            cfg = body.config || {};
        }
        if (!exports.CHANNEL_TYPES.includes(type)) {
            return { success: false, message: `不支持的渠道类型: ${type || '(空)'}` };
        }
        const info = { id: body.id || 'channel-test', name: '连接测试', type, config: cfg, metas: {} };
        const key = `go-imgbed-test-${Date.now()}.png`;
        const png = await makeTestPng();
        const started = Date.now();
        try {
            const adapter = (0, adapter_factory_1.createAdapter)(info);
            const res = await adapter.upload({ buffer: png, mime: 'image/png', originalName: 'test.png' }, key, info);
            const url = adapter.buildDirectUrl({ remoteKey: res.remoteKey, remoteUrl: res.remoteUrl || '', metas: {} }, info);
            let cleaned = true;
            try {
                await adapter.delete({ remoteKey: res.remoteKey, remoteUrl: res.remoteUrl || '', metas: {} }, info);
            }
            catch {
                cleaned = false;
            }
            return {
                success: true,
                data: { url, key: res.remoteKey, cleaned, elapsedMs: Date.now() - started },
                message: cleaned ? '上传成功，测试文件已清理' : '上传成功（该渠道未配置删除接口，测试文件可能残留）',
            };
        }
        catch (err) {
            return { success: false, message: err.message, data: { elapsedMs: Date.now() - started } };
        }
    }
    async remove(id) {
        const target = await prisma_1.prisma.channel.findUnique({ where: { id } });
        if (target && exports.BUILTIN_CHANNEL_TYPES.includes(target.type)) {
            return { success: false, message: '本地存储是系统内置渠道，不能删除（可以禁用以停用）' };
        }
        const copies = await prisma_1.prisma.fileCopy.count({ where: { channelId: id } });
        if (copies > 0) {
            return { success: false, message: `该渠道仍有 ${copies} 个文件副本，请先迁移或清理` };
        }
        await prisma_1.prisma.channel.delete({ where: { id } });
        return { success: true };
    }
};
exports.ChannelManageController = ChannelManageController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id/plain'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "plain", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "test", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "remove", null);
exports.ChannelManageController = ChannelManageController = __decorate([
    (0, common_1.Controller)('api/manage/channels'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:paramtypes", [ChannelsService])
], ChannelManageController);
