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
exports.AvatarController = exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const fs_1 = require("fs");
const path_1 = require("path");
const prisma_1 = require("../common/prisma");
const file_view_1 = require("../common/file-view");
const crypto_service_1 = require("../common/crypto.service");
const project_paths_1 = require("../common/project-paths");
const totp_1 = require("../common/totp");
const auth_guard_1 = require("../auth/auth.guard");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const settings_service_1 = require("../settings/settings.service");
const DEFAULT_SESSION_DAYS = 7;
const AVATAR_SIZE = 256;
const NOTICE_KEY = 'userNotice';
let UsersController = class UsersController {
    sysConfig;
    settings;
    constructor(sysConfig, settings) {
        this.sysConfig = sysConfig;
        this.settings = settings;
    }
    isAdmin(req) {
        return (0, auth_guard_1.isAdminRole)((0, auth_guard_1.currentSession)(req)?.role);
    }
    me(req) {
        return (0, auth_guard_1.currentSession)(req)?.user || '';
    }
    async adminUsername() {
        try {
            const admin = await prisma_1.prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
            if (admin?.username)
                return admin.username;
        }
        catch {
        }
        return (process.env.ADMIN_USER || '').trim() || (process.env.SUPER_ADMIN_USERNAME || '').trim() || 'admin';
    }
    async readAdminProfile() {
        try {
            const raw = await this.sysConfig.get('adminProfile');
            return raw && typeof raw === 'object' ? raw : {};
        }
        catch {
            return {};
        }
    }
    async channelLabelMap() {
        const channels = await prisma_1.prisma.channel.findMany({ select: { id: true, name: true, code: true } });
        const m = new Map();
        for (const c of channels) {
            const label = c.code ? `${c.code} · ${c.name}` : c.name;
            m.set(c.id, label);
            if (c.code)
                m.set(c.code, label);
        }
        return m;
    }
    async readNotice() {
        return (await this.settings.get(NOTICE_KEY, '')) || '';
    }
    async list(req) {
        const users = await prisma_1.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
        const cName = await this.channelLabelMap();
        const rows = users.map((u) => ({
            id: u.id,
            username: u.username,
            nickname: u.nickname,
            email: u.email || '',
            avatar: u.avatar || '',
            role: u.role,
            enabled: u.enabled,
            canEdit: u.canEdit,
            canDelete: u.canDelete,
            linkEnabled: u.linkEnabled,
            enforceLimits: u.enforceLimits,
            mainChannelId: u.mainChannelId,
            backupChannelId: u.backupChannelId,
            mainChannelName: cName.get(u.mainChannelId) || '',
            backupChannelName: cName.get(u.backupChannelId) || '',
            totpEnabled: u.totpEnabled,
            frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
            backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
            adminNote: u.adminNote || '',
            createdAt: u.createdAt,
        }));
        if (!this.isAdmin(req)) {
            const me = this.me(req);
            return rows
                .filter((r) => r.username === me)
                .map(({ adminNote: _omit, ...rest }) => rest);
        }
        const adminUser = await this.adminUsername();
        if (!rows.some((r) => r.role === 'admin')) {
            const prof = await this.readAdminProfile();
            const mainId = String(prof.mainChannelId || '');
            const backupId = String(prof.backupChannelId || '');
            rows.unshift({
                id: `__admin__${adminUser}`,
                username: adminUser,
                nickname: String(prof.nickname || '管理员'),
                email: String(prof.email || ''),
                avatar: '',
                role: 'admin',
                enabled: true,
                canEdit: true,
                canDelete: true,
                linkEnabled: true,
                enforceLimits: prof.enforceLimits !== false,
                mainChannelId: mainId,
                backupChannelId: backupId,
                mainChannelName: cName.get(mainId) || '',
                backupChannelName: cName.get(backupId) || '',
                totpEnabled: false,
                frontSessionDays: DEFAULT_SESSION_DAYS,
                backSessionDays: DEFAULT_SESSION_DAYS,
                adminNote: String(prof.adminNote || ''),
                createdAt: null,
                builtin: true,
            });
        }
        return rows;
    }
    async options(req) {
        if (!this.isAdmin(req)) {
            const me = this.me(req);
            return me ? [{ username: me, nickname: me }] : [];
        }
        const users = await prisma_1.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
        return users.map((u) => ({
            username: u.username,
            nickname: u.nickname || u.username,
            avatar: u.avatar || '',
            role: u.role,
        }));
    }
    async getNotice(req) {
        if (!(0, auth_guard_1.currentSession)(req))
            return { success: false, message: '未登录' };
        return { success: true, data: { content: await this.readNotice() } };
    }
    async saveNotice(req, body) {
        if (!this.isAdmin(req))
            return { success: false, message: '没有权限发布公告' };
        const content = String(body.content ?? '').slice(0, 20000);
        await this.settings.set(NOTICE_KEY, content);
        return { success: true, data: { content } };
    }
    async collect(req, mode) {
        const admin = this.isAdmin(req);
        const me = this.me(req);
        const byIp = admin && mode === 'ip';
        const files = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active', ...(admin ? {} : { uploader: me || '' }) },
            select: {
                uploader: true, ip: true, size: true, createdAt: true, metas: true,
                uploadSource: true,
            },
        });
        const buckets = new Map();
        for (const f of files) {
            const key = (byIp ? f.ip : f.uploader) || (byIp ? '(未知IP)' : '(匿名)');
            const b = buckets.get(key) || { key, count: 0, size: 0, lastAt: 0, sources: new Set() };
            b.count += 1;
            b.size += f.size || 0;
            b.lastAt = Math.max(b.lastAt, f.createdAt.getTime());
            b.sources.add((0, file_view_1.normalizeUploadSource)(f.uploadSource));
            if (byIp && !b.address) {
                try {
                    b.address = JSON.parse(f.metas || '{}').UploadAddress || '';
                }
                catch {
                }
            }
            buckets.set(key, b);
        }
        if (byIp) {
            const ips = Array.from(buckets.keys());
            const records = await prisma_1.prisma.ipRecord.findMany({ where: { ip: { in: ips } } });
            for (const r of records) {
                const b = buckets.get(r.ip);
                if (b)
                    b.address = [r.country, r.region, r.city].filter(Boolean).join(' ') || b.address;
            }
        }
        const items = Array.from(buckets.values())
            .map(({ sources, ...b }) => ({
            ...b,
            uploadSources: Array.from(sources).sort(),
        }))
            .sort((a, b) => b.count - a.count);
        return { mode: byIp ? 'ip' : 'user', items };
    }
    async checkUsername(username, selfId) {
        if (!username)
            return '用户名不能为空';
        if (!/^[A-Za-z0-9_.@-]{2,32}$/.test(username)) {
            return '用户名仅支持字母/数字/_ . @ - ，长度 2-32';
        }
        const dup = await prisma_1.prisma.user.findFirst({
            where: { username, ...(selfId ? { NOT: { id: selfId } } : {}) },
        });
        if (dup)
            return `用户名「${username}」已存在`;
        return null;
    }
    async detail(req, id) {
        const admin = this.isAdmin(req);
        if (id.startsWith('__admin__')) {
            if (!admin)
                return { success: false, message: '没有权限查看该账户' };
            const name = id.replace('__admin__', '');
            const prof = await this.readAdminProfile();
            return {
                success: true,
                data: {
                    id,
                    username: name,
                    nickname: String(prof.nickname || '管理员'),
                    email: String(prof.email || ''),
                    avatar: '',
                    role: 'admin',
                    enabled: true,
                    canEdit: true,
                    canDelete: true,
                    linkEnabled: true,
                    enforceLimits: prof.enforceLimits !== false,
                    mainChannelId: String(prof.mainChannelId || ''),
                    backupChannelId: String(prof.backupChannelId || ''),
                    totpEnabled: false,
                    frontSessionDays: DEFAULT_SESSION_DAYS,
                    backSessionDays: DEFAULT_SESSION_DAYS,
                    adminNote: String(prof.adminNote || ''),
                    builtin: true,
                },
            };
        }
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        if (!admin && u.username !== this.me(req))
            return { success: false, message: '没有权限查看该账户' };
        return {
            success: true,
            data: {
                id: u.id,
                username: u.username,
                nickname: u.nickname,
                email: u.email || '',
                avatar: u.avatar || '',
                avatarUrl: u.avatar ? `/api/avatar/${encodeURIComponent(u.username)}?v=${encodeURIComponent(u.avatar)}` : '',
                role: u.role,
                enabled: u.enabled,
                canEdit: u.canEdit,
                canDelete: u.canDelete,
                linkEnabled: u.linkEnabled,
                enforceLimits: u.enforceLimits,
                mainChannelId: u.mainChannelId,
                backupChannelId: u.backupChannelId,
                totpEnabled: u.totpEnabled,
                frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
                backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
                adminNote: admin ? u.adminNote || '' : '',
                createdAt: u.createdAt,
                self: u.username === this.me(req),
            },
        };
    }
    async create(req, body) {
        if (!this.isAdmin(req))
            return { success: false, message: '没有权限创建用户' };
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const nameErr = await this.checkUsername(username);
        if (nameErr)
            return { success: false, message: nameErr };
        if (!password)
            return { success: false, message: '密码不能为空' };
        if (password.length < 4)
            return { success: false, message: '密码至少 4 位' };
        const u = await prisma_1.prisma.user.create({
            data: {
                username,
                passwordHash: crypto_service_1.CryptoService.hashPassword(password),
                uploadPassword: '',
                nickname: String(body.nickname || '').trim(),
                email: String(body.email || '').trim().slice(0, 120),
                role: 'user',
                enabled: body.enabled !== false,
                canEdit: body.canEdit !== false,
                canDelete: body.canDelete !== false,
                linkEnabled: body.linkEnabled !== false,
                enforceLimits: body.enforceLimits !== false,
                mainChannelId: String(body.mainChannelId || ''),
                backupChannelId: String(body.backupChannelId || ''),
                adminNote: String(body.adminNote || '').slice(0, 4000),
            },
        });
        return { success: true, data: { id: u.id } };
    }
    async update(req, id, body) {
        if (id.startsWith('__admin__')) {
            if (!this.isAdmin(req))
                return { success: false, message: '只能修改自己的账户' };
            const patch = {};
            if (body.nickname !== undefined)
                patch.nickname = String(body.nickname);
            if (body.email !== undefined)
                patch.email = String(body.email);
            if (body.mainChannelId !== undefined)
                patch.mainChannelId = String(body.mainChannelId);
            if (body.backupChannelId !== undefined)
                patch.backupChannelId = String(body.backupChannelId);
            if (body.enforceLimits !== undefined)
                patch.enforceLimits = !!body.enforceLimits;
            if (body.adminNote !== undefined)
                patch.adminNote = String(body.adminNote).slice(0, 4000);
            await this.sysConfig.save('adminProfile', patch);
            return { success: true };
        }
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        const admin = this.isAdmin(req);
        const self = u.username === this.me(req);
        if (!admin && !self)
            return { success: false, message: '只能修改自己的账户' };
        const data = {};
        if (body.username !== undefined) {
            const next = String(body.username).trim();
            if (next !== u.username) {
                const err = await this.checkUsername(next, u.id);
                if (err)
                    return { success: false, message: err };
                data.username = next;
            }
        }
        if (body.password !== undefined && body.password !== '') {
            if (String(body.password).length < 4)
                return { success: false, message: '密码至少 4 位' };
            data.passwordHash = crypto_service_1.CryptoService.hashPassword(String(body.password));
        }
        if (body.nickname !== undefined)
            data.nickname = String(body.nickname).slice(0, 60);
        if (body.email !== undefined) {
            const email = String(body.email).trim().slice(0, 120);
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                return { success: false, message: '邮箱格式不正确' };
            data.email = email;
        }
        for (const key of ['frontSessionDays', 'backSessionDays']) {
            const raw = body[key];
            if (raw === undefined)
                continue;
            if (raw === null || String(raw).trim() === '') {
                data[key] = null;
                continue;
            }
            const n = Number(raw);
            if (!Number.isFinite(n) || n < 0 || n > 3650) {
                return { success: false, message: '会话有效期需在 0~3650 天之间（0 = 永久）' };
            }
            data[key] = Math.floor(n);
        }
        if (admin) {
            if (body.enabled !== undefined)
                data.enabled = !!body.enabled;
            if (body.canEdit !== undefined)
                data.canEdit = !!body.canEdit;
            if (body.canDelete !== undefined)
                data.canDelete = !!body.canDelete;
            if (body.linkEnabled !== undefined)
                data.linkEnabled = !!body.linkEnabled;
            if (body.enforceLimits !== undefined)
                data.enforceLimits = !!body.enforceLimits;
            if (body.mainChannelId !== undefined)
                data.mainChannelId = String(body.mainChannelId);
            if (body.backupChannelId !== undefined)
                data.backupChannelId = String(body.backupChannelId);
            if (body.adminNote !== undefined)
                data.adminNote = String(body.adminNote).slice(0, 4000);
        }
        if (Object.keys(data).length === 0)
            return { success: false, message: '没有可修改的内容' };
        const updated = await prisma_1.prisma.user.update({ where: { id }, data });
        if (data.username && updated.username !== u.username) {
            await prisma_1.prisma.fileRecord.updateMany({ where: { uploader: u.username }, data: { uploader: updated.username } });
        }
        return { success: true, data: { username: updated.username } };
    }
    async remove(req, id) {
        if (!this.isAdmin(req))
            return { success: false, message: '没有权限删除用户' };
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        if (u.role === 'admin')
            return { success: false, message: '不能删除管理员账户' };
        await prisma_1.prisma.user.delete({ where: { id } });
        await fs_1.promises.unlink((0, path_1.join)(avatarDir(), `${id}.webp`)).catch(() => undefined);
        return { success: true };
    }
    async uploadAvatar(req, id, file) {
        if (!file?.buffer?.length)
            return { success: false, message: '没有收到图片文件' };
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        if (!this.isAdmin(req) && u.username !== this.me(req))
            return { success: false, message: '只能修改自己的头像' };
        let out;
        try {
            const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
            out = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
                .rotate()
                .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
                .webp({ quality: 88 })
                .toBuffer();
        }
        catch (err) {
            return { success: false, message: `图片处理失败：${err.message}` };
        }
        const dir = avatarDir();
        await fs_1.promises.mkdir(dir, { recursive: true });
        await fs_1.promises.writeFile((0, path_1.join)(dir, `${u.id}.webp`), out);
        const version = String(Date.now());
        await prisma_1.prisma.user.update({ where: { id: u.id }, data: { avatar: version } });
        return {
            success: true,
            data: {
                avatar: version,
                avatarUrl: `/api/avatar/${encodeURIComponent(u.username)}?v=${version}`,
            },
        };
    }
    async removeAvatar(req, id) {
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        if (!this.isAdmin(req) && u.username !== this.me(req))
            return { success: false, message: '只能修改自己的头像' };
        await fs_1.promises.unlink((0, path_1.join)(avatarDir(), `${u.id}.webp`)).catch(() => undefined);
        await prisma_1.prisma.user.update({ where: { id: u.id }, data: { avatar: '' } });
        return { success: true };
    }
    async totpTarget(req, id) {
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { u: null, err: '用户不存在' };
        if (!this.isAdmin(req) && u.username !== this.me(req))
            return { u: null, err: '只能操作自己的账户' };
        return { u, err: '' };
    }
    async totpSetup(req, id) {
        const { u, err } = await this.totpTarget(req, id);
        if (!u)
            return { success: false, message: err };
        if (u.totpEnabled)
            return { success: false, message: '该账户已启用两步验证，请先关闭再重新绑定' };
        const secret = (0, totp_1.generateTotpSecret)();
        await prisma_1.prisma.user.update({
            where: { id: u.id },
            data: { totpSecret: crypto_service_1.CryptoService.encrypt(secret), totpEnabled: false },
        });
        return {
            success: true,
            data: {
                secret,
                uri: (0, totp_1.totpUri)(secret, u.username),
                digits: 6,
                period: 30,
            },
        };
    }
    async totpEnable(req, id, body) {
        const { u, err } = await this.totpTarget(req, id);
        if (!u)
            return { success: false, message: err };
        if (u.totpEnabled)
            return { success: false, message: '该账户已启用两步验证' };
        if (!u.totpSecret)
            return { success: false, message: '请先生成密钥' };
        let secret = '';
        try {
            secret = crypto_service_1.CryptoService.decrypt(u.totpSecret);
        }
        catch {
            return { success: false, message: '密钥读取失败，请重新生成' };
        }
        if (!(0, totp_1.verifyTotp)(secret, String(body.code || ''))) {
            return { success: false, message: '验证码错误或已过期' };
        }
        await prisma_1.prisma.user.update({
            where: { id: u.id },
            data: { totpEnabled: true, backVerifiedAt: new Date() },
        });
        return { success: true };
    }
    async totpDisable(req, id, body) {
        const { u, err } = await this.totpTarget(req, id);
        if (!u)
            return { success: false, message: err };
        if (!u.totpEnabled)
            return { success: true };
        let secret = '';
        try {
            secret = crypto_service_1.CryptoService.decrypt(u.totpSecret || '');
        }
        catch {
            secret = '';
        }
        if (secret && !(0, totp_1.verifyTotp)(secret, String(body.code || ''))) {
            return { success: false, message: '验证码错误或已过期' };
        }
        await prisma_1.prisma.user.update({
            where: { id: u.id },
            data: { totpEnabled: false, totpSecret: '', backVerifiedAt: null },
        });
        return { success: true };
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('options'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "options", null);
__decorate([
    (0, common_1.Get)('notice'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getNotice", null);
__decorate([
    (0, common_1.Post)('notice'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "saveNotice", null);
__decorate([
    (0, common_1.Get)('collect'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('mode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "collect", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/avatar'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: 8 * 1024 * 1024 } })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "uploadAvatar", null);
__decorate([
    (0, common_1.Delete)(':id/avatar'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "removeAvatar", null);
__decorate([
    (0, common_1.Post)(':id/totp/setup'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "totpSetup", null);
__decorate([
    (0, common_1.Post)(':id/totp/enable'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "totpEnable", null);
__decorate([
    (0, common_1.Post)(':id/totp/disable'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "totpDisable", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('api/manage/users'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService,
        settings_service_1.SettingsService])
], UsersController);
function avatarDir() {
    return (0, project_paths_1.backendSub)('uploads', 'avatars');
}
let AvatarController = class AvatarController {
    async get(username, res) {
        const u = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (!u || !u.avatar)
            return res.status(404).end();
        try {
            const buf = await fs_1.promises.readFile((0, path_1.join)(avatarDir(), `${u.id}.webp`));
            res.setHeader('Content-Type', 'image/webp');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.end(buf);
        }
        catch {
            return res.status(404).end();
        }
    }
};
exports.AvatarController = AvatarController;
__decorate([
    (0, common_1.Get)(':username'),
    __param(0, (0, common_1.Param)('username')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AvatarController.prototype, "get", null);
exports.AvatarController = AvatarController = __decorate([
    (0, common_1.Controller)('api/avatar')
], AvatarController);
