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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const file_view_1 = require("../common/file-view");
const crypto_service_1 = require("../common/crypto.service");
const auth_guard_1 = require("../auth/auth.guard");
const sysconfig_service_1 = require("../settings/sysconfig.service");
let UsersController = class UsersController {
    sysConfig;
    constructor(sysConfig) {
        this.sysConfig = sysConfig;
    }
    isAdmin(req) {
        return (0, auth_guard_1.isAdminRole)((0, auth_guard_1.currentSession)(req)?.role);
    }
    me(req) {
        return (0, auth_guard_1.currentSession)(req)?.user || '';
    }
    async adminUsername() {
        try {
            const security = (await this.sysConfig.get('security'));
            const u = String(security?.auth?.admin?.adminUsername || security?.admin?.adminUsername || '').trim();
            if (u)
                return u;
        }
        catch {
        }
        return ((process.env.ADMIN_USER || '').trim() ||
            (process.env.SUPER_ADMIN_USERNAME || '').trim() ||
            'admin');
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
    async list(req) {
        const users = await prisma_1.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
        const cName = await this.channelLabelMap();
        const rows = users.map((u) => ({
            id: u.id,
            username: u.username,
            nickname: u.nickname,
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
            createdAt: u.createdAt,
        }));
        if (!this.isAdmin(req)) {
            const me = this.me(req);
            return rows.filter((r) => r.username === me);
        }
        const adminUser = await this.adminUsername();
        if (!rows.some((r) => r.username === adminUser)) {
            const prof = await this.readAdminProfile();
            const mainId = String(prof.mainChannelId || '');
            const backupId = String(prof.backupChannelId || '');
            rows.unshift({
                id: `__admin__${adminUser}`,
                username: adminUser,
                nickname: String(prof.nickname || '管理员'),
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
        return users.map((u) => ({ username: u.username, nickname: u.nickname || u.username }));
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
    async create(req, body) {
        if (!this.isAdmin(req))
            return { success: false, message: '没有权限创建用户' };
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        if (!username)
            return { success: false, message: '用户名不能为空' };
        if (!/^[A-Za-z0-9_.@-]{2,32}$/.test(username)) {
            return { success: false, message: '用户名仅支持字母/数字/_ . @ - ，长度 2-32' };
        }
        if (!password)
            return { success: false, message: '密码不能为空' };
        if (password.length < 4)
            return { success: false, message: '密码至少 4 位' };
        const dup = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (dup)
            return { success: false, message: `用户名「${username}」已存在` };
        const u = await prisma_1.prisma.user.create({
            data: {
                username,
                passwordHash: crypto_service_1.CryptoService.hashPassword(password),
                uploadPassword: '',
                nickname: String(body.nickname || '').trim(),
                role: 'user',
                enabled: body.enabled !== false,
                canEdit: body.canEdit !== false,
                canDelete: body.canDelete !== false,
                linkEnabled: body.linkEnabled !== false,
                enforceLimits: body.enforceLimits !== false,
                mainChannelId: String(body.mainChannelId || ''),
                backupChannelId: String(body.backupChannelId || ''),
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
            if (body.mainChannelId !== undefined)
                patch.mainChannelId = String(body.mainChannelId);
            if (body.backupChannelId !== undefined)
                patch.backupChannelId = String(body.backupChannelId);
            if (body.enforceLimits !== undefined)
                patch.enforceLimits = !!body.enforceLimits;
            await this.sysConfig.save('adminProfile', patch);
            return { success: true };
        }
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        if (!this.isAdmin(req)) {
            if (u.username !== this.me(req))
                return { success: false, message: '只能修改自己的账户' };
            const pwd = String(body.password || '');
            const nick = body.nickname === undefined ? undefined : String(body.nickname);
            if (!pwd && nick === undefined)
                return { success: false, message: '没有可修改的内容' };
            if (pwd && pwd.length < 4)
                return { success: false, message: '密码至少 4 位' };
            await prisma_1.prisma.user.update({
                where: { id },
                data: {
                    ...(pwd ? { passwordHash: crypto_service_1.CryptoService.hashPassword(pwd) } : {}),
                    ...(nick !== undefined ? { nickname: nick } : {}),
                },
            });
            return { success: true };
        }
        if (body.password !== undefined && body.password !== '') {
            if (String(body.password).length < 4)
                return { success: false, message: '密码至少 4 位' };
        }
        await prisma_1.prisma.user.update({
            where: { id },
            data: {
                ...(body.password ? { passwordHash: crypto_service_1.CryptoService.hashPassword(String(body.password)) } : {}),
                ...(body.nickname !== undefined ? { nickname: String(body.nickname) } : {}),
                ...(body.enabled !== undefined ? { enabled: !!body.enabled } : {}),
                ...(body.canEdit !== undefined ? { canEdit: !!body.canEdit } : {}),
                ...(body.canDelete !== undefined ? { canDelete: !!body.canDelete } : {}),
                ...(body.linkEnabled !== undefined ? { linkEnabled: !!body.linkEnabled } : {}),
                ...(body.enforceLimits !== undefined ? { enforceLimits: !!body.enforceLimits } : {}),
                ...(body.mainChannelId !== undefined ? { mainChannelId: String(body.mainChannelId) } : {}),
                ...(body.backupChannelId !== undefined ? { backupChannelId: String(body.backupChannelId) } : {}),
            },
        });
        return { success: true };
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
    (0, common_1.Get)('collect'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('mode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "collect", null);
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
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('api/manage/users'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService])
], UsersController);
