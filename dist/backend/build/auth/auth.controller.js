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
const totp_1 = require("../common/totp");
const DEFAULT_SESSION_DAYS = 7;
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
    async isUserConfigured(_auth) {
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
            return {
                user: suUser,
                role: 'super',
                enabled: true,
                canEdit: true,
                canDelete: true,
                totpEnabled: false,
                frontDays: 7,
                backDays: 7,
            };
        }
        const u = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (u) {
            if (!u.enabled)
                return null;
            if (!crypto_service_1.CryptoService.verifyPassword(password, u.passwordHash))
                return null;
            return {
                user: u.username,
                role: (u.role === 'admin' ? 'admin' : 'user'),
                enabled: u.enabled,
                canEdit: u.canEdit,
                canDelete: u.canDelete,
                totpEnabled: u.totpEnabled,
                frontDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
                backDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
            };
        }
        const hasAdmin = (await prisma_1.prisma.user.count({ where: { role: 'admin' } })) > 0;
        if (!hasAdmin) {
            const auth = await this.authConfig();
            const cfgPass = String(auth?.admin?.adminPassword || '');
            if (cfgPass) {
                const cfgUser = String(auth?.admin?.adminUsername || '').trim() || 'admin';
                if ((0, secret_1.safeEqual)(username, cfgUser) && (0, secret_1.matchSecret)(password, cfgPass)) {
                    this.upgradeAdminSecret(cfgPass).catch(() => undefined);
                    return {
                        user: cfgUser,
                        role: 'admin',
                        enabled: true,
                        canEdit: true,
                        canDelete: true,
                        totpEnabled: false,
                        frontDays: DEFAULT_SESSION_DAYS,
                        backDays: DEFAULT_SESSION_DAYS,
                    };
                }
                return null;
            }
            const envUser = process.env.ADMIN_USER || 'admin';
            const envPass = process.env.ADMIN_PASSWORD || 'go-imgbed';
            if ((0, secret_1.safeEqual)(username, envUser) && (0, secret_1.safeEqual)(password, envPass)) {
                return {
                    user: envUser,
                    role: 'admin',
                    enabled: true,
                    canEdit: true,
                    canDelete: true,
                    totpEnabled: false,
                    frontDays: DEFAULT_SESSION_DAYS,
                    backDays: DEFAULT_SESSION_DAYS,
                };
            }
        }
        return null;
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
    sessionDaysOf(days) {
        const n = Number(days);
        if (!Number.isFinite(n))
            return DEFAULT_SESSION_DAYS;
        if (n === 0)
            return 0;
        if (n < 0)
            return DEFAULT_SESSION_DAYS;
        return Math.floor(n);
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
    async setSession(res, account, req, verified = false) {
        const { payload, sig, maxAge } = (0, auth_guard_1.makeSession)(account.user, account.role, {
            frontDays: this.sessionDaysOf(account.frontDays),
            backDays: this.sessionDaysOf(account.backDays),
            totpEnabled: !!account.totpEnabled,
            verified: account.totpEnabled ? verified : true,
        });
        const opts = { httpOnly: true, sameSite: 'lax', path: '/' };
        if (maxAge > 0)
            opts.maxAge = maxAge;
        if ((await this.sessionSecureEnabled()) && this.isHttps(req))
            opts.secure = true;
        res.cookie(auth_guard_1.SESSION_COOKIE, `${payload}.${sig}`, opts);
    }
    async login(body, res, req) {
        const username = (body.username || '').trim();
        const account = await this.verifyAccount(username, body.password || '');
        if (!account)
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
        let verified = false;
        if (account.totpEnabled && body.code) {
            verified = await this.checkTotp(account.user, String(body.code));
        }
        await this.setSession(res, account, req, verified);
        return res.json({
            success: true,
            data: {
                type: account.role === 'user' ? 'user' : 'admin',
                role: account.role,
                username: account.user,
                needTotp: account.totpEnabled && !verified,
            },
        });
    }
    async adminLogin(body, res, req) {
        return this.login(body, res, req);
    }
    async checkTotp(username, code) {
        const u = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (!u || !u.totpEnabled || !u.totpSecret)
            return false;
        let secret = '';
        try {
            secret = crypto_service_1.CryptoService.decrypt(u.totpSecret);
        }
        catch {
            return false;
        }
        const ok = (0, totp_1.verifyTotp)(secret, code);
        if (ok) {
            await prisma_1.prisma.user.update({ where: { id: u.id }, data: { backVerifiedAt: new Date() } });
        }
        return ok;
    }
    async totpVerify(body, req, res) {
        const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
        if (!session)
            return res.status(401).json({ success: false, message: '未登录或会话已过期' });
        const u = await prisma_1.prisma.user.findUnique({ where: { username: session.user } });
        if (!u)
            return res.status(401).json({ success: false, message: '账户不存在' });
        if (!u.totpEnabled) {
            await this.setSession(res, { user: u.username, role: session.role, totpEnabled: false }, req, true);
            return res.json({ success: true, data: { verified: true } });
        }
        const ok = await this.checkTotp(u.username, String(body.code || ''));
        if (!ok)
            return res.status(400).json({ success: false, message: '验证码错误或已过期' });
        await this.setSession(res, {
            user: u.username,
            role: session.role,
            totpEnabled: true,
            frontDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
            backDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
        }, req, true);
        return res.json({ success: true, data: { verified: true } });
    }
    async totpStatus(req) {
        const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
        if (!session)
            return { success: true, data: { loggedIn: false, enabled: false, required: false } };
        const u = await prisma_1.prisma.user.findUnique({ where: { username: session.user } });
        const enabled = !!u?.totpEnabled;
        return {
            success: true,
            data: {
                loggedIn: true,
                enabled,
                required: enabled && !(0, auth_guard_1.totpValid)(session),
            },
        };
    }
    async sessionCheck(req) {
        const auth = await this.authConfig();
        const adminRequired = await this.isAdminConfigured(auth);
        const userRequired = await this.isUserConfigured(auth);
        const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
        const valid = !!session && (0, auth_guard_1.frontValid)(session);
        const role = session ? session.role : null;
        let canEdit = true;
        let canDelete = true;
        let totpEnabled = !!session?.t2;
        let totpRequired = false;
        let profile = {};
        if (session) {
            const u = await prisma_1.prisma.user.findUnique({ where: { username: session.user } });
            if (u) {
                canEdit = u.canEdit ?? true;
                canDelete = u.canDelete ?? true;
                totpEnabled = u.totpEnabled;
                totpRequired = u.totpEnabled && !(0, auth_guard_1.totpValid)(session);
                profile = {
                    username: u.username,
                    nickname: u.nickname || u.username,
                    email: u.email || '',
                    role: u.role,
                    avatar: u.avatar || '',
                    avatarUrl: u.avatar ? `/api/avatar/${encodeURIComponent(u.username)}?v=${encodeURIComponent(u.avatar)}` : '',
                    frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
                    backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
                };
            }
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
            totpEnabled,
            totpRequired,
            profile,
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
                totpEnabled,
                totpRequired,
                profile,
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
    (0, common_1.Post)('totp/verify'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "totpVerify", null);
__decorate([
    (0, common_1.Get)('totp/status'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "totpStatus", null);
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
