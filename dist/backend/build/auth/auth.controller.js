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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const crypto_service_1 = require("../common/crypto.service");
const secret_1 = require("../common/secret");
const auth_guard_1 = require("./auth.guard");
const sysconfig_service_1 = require("../settings/sysconfig.service");
let AuthController = class AuthController {
    sysConfig;
    constructor(sysConfig) {
        this.sysConfig = sysConfig;
    }
    async authConfig() {
        try {
            const raw = await this.sysConfig.readSecurityRaw();
            const auth = raw?.auth;
            return auth && typeof auth === 'object' ? auth : {};
        }
        catch {
            return {};
        }
    }
    envAuthCode() {
        return process.env.AUTH_CODE || process.env.AUTH_MIKF || '';
    }
    async isAdminConfigured(auth) {
        if (String(auth?.admin?.adminPassword || ''))
            return true;
        if (process.env.ADMIN_USER || process.env.ADMIN_PASSWORD)
            return true;
        try {
            return (await prisma_1.prisma.user.count({ where: { role: 'admin' } })) > 0;
        }
        catch {
            return false;
        }
    }
    async isUserConfigured(auth) {
        if (String(auth?.admin?.adminPassword || ''))
            return true;
        if (String(auth?.user?.authCode || ''))
            return true;
        if (process.env.ADMIN_USER || process.env.ADMIN_PASSWORD)
            return true;
        try {
            return (await prisma_1.prisma.user.count()) > 0;
        }
        catch {
            return false;
        }
    }
    async verifyAccount(username, password) {
        if (!username || !password)
            return null;
        const suUser = (process.env.SUPER_ADMIN_USERNAME || '').trim();
        const suPass = process.env.SUPER_ADMIN_PASSWORD || '';
        if (suUser && suPass && (0, secret_1.safeEqual)(username, suUser) && (0, secret_1.matchSecret)(password, suPass)) {
            return { user: suUser, role: 'super', enabled: true, canEdit: true, canDelete: true };
        }
        const u = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (u) {
            if (!u.enabled)
                return null;
            const info = {
                user: u.username,
                role: (u.role === 'admin' ? 'admin' : 'user'),
                enabled: u.enabled,
                canEdit: u.canEdit,
                canDelete: u.canDelete,
            };
            if (crypto_service_1.CryptoService.verifyPassword(password, u.passwordHash))
                return info;
            if (info.role === 'user' && (await this.matchUserAuthCode(password))) {
                return info;
            }
            return null;
        }
        const auth = await this.authConfig();
        const cfgPass = String(auth?.admin?.adminPassword || '');
        if (cfgPass) {
            const cfgUser = String(auth?.admin?.adminUsername || '').trim() || 'admin';
            if ((0, secret_1.safeEqual)(username, cfgUser) && (0, secret_1.matchSecret)(password, cfgPass)) {
                this.upgradeAdminSecret(cfgPass).catch(() => undefined);
                return { user: cfgUser, role: 'admin', enabled: true, canEdit: true, canDelete: true };
            }
            return null;
        }
        const envUser = process.env.ADMIN_USER || 'admin';
        const envPass = process.env.ADMIN_PASSWORD || 'go-imgbed';
        if ((0, secret_1.safeEqual)(username, envUser) && (0, secret_1.safeEqual)(password, envPass)) {
            return { user: envUser, role: 'admin', enabled: true, canEdit: true, canDelete: true };
        }
        return null;
    }
    async matchUserAuthCode(input) {
        if (!input)
            return false;
        const auth = await this.authConfig();
        const cfg = String(auth?.user?.authCode || '');
        if (cfg) {
            if (!(0, secret_1.matchSecret)(input, cfg))
                return false;
            this.upgradeUserSecret(cfg).catch(() => undefined);
            return true;
        }
        const env = this.envAuthCode();
        return !!env && (0, secret_1.safeEqual)(input, env);
    }
    async verifyAuthCode(authCode) {
        return this.matchUserAuthCode(authCode);
    }
    async upgradeAdminSecret(stored) {
        if ((0, secret_1.isHashedSecret)(stored))
            return;
        const raw = await this.sysConfig.readSecurityRaw();
        const cur = String(raw?.auth?.admin?.adminPassword || '');
        if (!cur || (0, secret_1.isHashedSecret)(cur))
            return;
        raw.auth.admin.adminPassword = (0, secret_1.hashSecret)(cur);
        await this.sysConfig.writeSecurityRaw(raw);
    }
    async upgradeUserSecret(stored) {
        if ((0, secret_1.isHashedSecret)(stored))
            return;
        const raw = await this.sysConfig.readSecurityRaw();
        const cur = String(raw?.auth?.user?.authCode || '');
        if (!cur || (0, secret_1.isHashedSecret)(cur))
            return;
        raw.auth.user.authCode = (0, secret_1.hashSecret)(cur);
        await this.sysConfig.writeSecurityRaw(raw);
    }
    async sessionDays(role) {
        try {
            const security = await this.sysConfig.get('security');
            const days = Number(role === 'user'
                ? security?.access?.userSessionMaxAge ?? 14
                : security?.access?.adminSessionMaxAge ?? 14);
            if (!Number.isFinite(days) || days < 0)
                return 14;
            return Math.floor(days);
        }
        catch {
            return 14;
        }
    }
    async sessionMaxAge(role) {
        const days = await this.sessionDays(role);
        if (days <= 0)
            return 10 * 365 * 24 * 3600 * 1000;
        return Math.round(days * 24 * 3600 * 1000);
    }
    async sessionSecureEnabled() {
        try {
            const security = await this.sysConfig.get('security');
            return security?.access?.sessionSecure === true;
        }
        catch {
            return false;
        }
    }
    isHttps(req) {
        if (!req)
            return false;
        if (req.secure)
            return true;
        const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
        return proto === 'https';
    }
    async setSession(res, user, role, req) {
        const days = await this.sessionDays(role);
        const { payload, sig } = (0, auth_guard_1.makeSession)(user, role, days);
        const maxAge = await this.sessionMaxAge(role);
        const opts = { httpOnly: true, sameSite: 'lax', path: '/' };
        if (maxAge !== undefined)
            opts.maxAge = maxAge;
        if ((await this.sessionSecureEnabled()) && this.isHttps(req))
            opts.secure = true;
        res.cookie(auth_guard_1.SESSION_COOKIE, `${payload}.${sig}`, opts);
    }
    async login(body, res, req) {
        if (!body.username && body.authCode) {
            if (!(await this.verifyAuthCode(body.authCode))) {
                return res.status(401).json({ success: false, message: '认证码错误' });
            }
            await this.setSession(res, 'user', 'user', req);
            return res.json({ success: true, data: { type: 'user', role: 'user', username: 'user' } });
        }
        const username = (body.username || '').trim();
        const account = await this.verifyAccount(username, body.password || '');
        if (!account)
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
        await this.setSession(res, account.user, account.role, req);
        return res.json({
            success: true,
            data: {
                type: account.role === 'user' ? 'user' : 'admin',
                role: account.role,
                username: account.user,
            },
        });
    }
    async adminLogin(body, res, req) {
        return this.login(body, res, req);
    }
    async sessionCheck(req) {
        const auth = await this.authConfig();
        const adminRequired = await this.isAdminConfigured(auth);
        const userRequired = await this.isUserConfigured(auth);
        const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
        const valid = !!session;
        const role = session ? session.role : null;
        let canEdit = true;
        let canDelete = true;
        if (session && session.role === 'user') {
            const u = await prisma_1.prisma.user.findUnique({ where: { username: session.user } });
            canEdit = u?.canEdit ?? true;
            canDelete = u?.canDelete ?? true;
        }
        return {
            success: true,
            adminRequired,
            userRequired,
            valid,
            authType: role,
            role,
            username: session?.user ?? null,
            canEdit,
            canDelete,
            data: {
                isLoggedIn: valid,
                isAdmin: role === 'admin' || role === 'super',
                isSuper: role === 'super',
                username: session?.user ?? null,
                role,
                canEdit,
                canDelete,
                adminRequired,
                userRequired,
                valid,
                authType: role,
            },
        };
    }
    async superUpdateAdmin(body, req, res) {
        const s = (0, auth_guard_1.currentSession)(req);
        if (!s || s.role !== 'super') {
            return res.status(403).json({ success: false, message: '需要超级管理员权限' });
        }
        const raw = await this.sysConfig.readSecurityRaw();
        raw.auth = raw.auth || {};
        raw.auth.admin = raw.auth.admin || {};
        const newUser = String(body.username || '').trim();
        const newPass = String(body.password || '');
        if (newUser)
            raw.auth.admin.adminUsername = newUser;
        if (newPass)
            raw.auth.admin.adminPassword = (0, secret_1.hashSecret)(newPass);
        await this.sysConfig.writeSecurityRaw(raw);
        if (newUser || newPass) {
            const admin = await prisma_1.prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
            if (admin) {
                await prisma_1.prisma.user.update({
                    where: { id: admin.id },
                    data: {
                        username: newUser || admin.username,
                        passwordHash: newPass ? crypto_service_1.CryptoService.hashPassword(newPass) : admin.passwordHash,
                    },
                });
            }
        }
        return res.json({ success: true, message: '管理员账户已更新' });
    }
    logout(res) {
        res.clearCookie(auth_guard_1.SESSION_COOKIE, { path: '/' });
        return res.json({ success: true });
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('adminLogin'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "adminLogin", null);
__decorate([
    (0, common_1.Get)('sessionCheck'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "sessionCheck", null);
__decorate([
    (0, common_1.Post)('superUpdateAdmin'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "superUpdateAdmin", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "logout", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('api/auth'),
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService])
], AuthController);
