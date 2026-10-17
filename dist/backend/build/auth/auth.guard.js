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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OptionalAuthGuard = exports.ManageAuthGuard = exports.AdminGuard = exports.AuthGuard = exports.SESSION_COOKIE = void 0;
exports.makeSession = makeSession;
exports.parseSession = parseSession;
exports.currentSession = currentSession;
exports.isAdminRole = isAdminRole;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const crypto_service_1 = require("../common/crypto.service");
const sysconfig_service_1 = require("../settings/sysconfig.service");
exports.SESSION_COOKIE = 'goimgbed_session';
function makeSession(user, role, days) {
    const d = Number(days);
    const exp = Number.isFinite(d) && d > 0
        ? Math.floor(Date.now() / 1000) + Math.round(d * 24 * 3600)
        : 0;
    const payload = {
        user,
        role,
        exp,
    };
    const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { payload: raw, sig: crypto_service_1.CryptoService.sign(raw) };
}
function parseSession(cookieValue) {
    if (!cookieValue)
        return null;
    const idx = cookieValue.indexOf('.');
    if (idx <= 0)
        return null;
    const payload = cookieValue.slice(0, idx);
    const sig = cookieValue.slice(idx + 1);
    if (!crypto_service_1.CryptoService.verifySigned(payload, sig))
        return null;
    try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (session.exp > 0 && session.exp < Math.floor(Date.now() / 1000))
            return null;
        return session;
    }
    catch {
        return null;
    }
}
let AuthGuard = class AuthGuard {
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const res = context.switchToHttp().getResponse();
        const session = parseSession(req.cookies?.[exports.SESSION_COOKIE]);
        if (!session) {
            res.status(401).json({ success: false, message: '未登录或会话已过期' });
            return false;
        }
        req.session = session;
        return true;
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = __decorate([
    (0, common_1.Injectable)()
], AuthGuard);
let AdminGuard = class AdminGuard {
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const res = context.switchToHttp().getResponse();
        const session = parseSession(req.cookies?.[exports.SESSION_COOKIE]);
        if (!session) {
            res.status(401).json({ success: false, message: '未登录或会话已过期' });
            return false;
        }
        if (session.role !== 'admin' && session.role !== 'super') {
            res.status(403).json({ success: false, message: '需要管理员权限' });
            return false;
        }
        req.session = session;
        return true;
    }
};
exports.AdminGuard = AdminGuard;
exports.AdminGuard = AdminGuard = __decorate([
    (0, common_1.Injectable)()
], AdminGuard);
let ManageAuthGuard = class ManageAuthGuard {
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const res = context.switchToHttp().getResponse();
        const session = parseSession(req.cookies?.[exports.SESSION_COOKIE]);
        if (!session) {
            res.status(401).json({ success: false, message: '未登录或会话已过期' });
            return false;
        }
        req.session = session;
        return true;
    }
};
exports.ManageAuthGuard = ManageAuthGuard;
exports.ManageAuthGuard = ManageAuthGuard = __decorate([
    (0, common_1.Injectable)()
], ManageAuthGuard);
function currentSession(req) {
    const injected = req.session;
    if (injected)
        return injected;
    return parseSession(req.cookies?.[exports.SESSION_COOKIE]);
}
function isAdminRole(role) {
    return role === 'admin' || role === 'super';
}
let OptionalAuthGuard = class OptionalAuthGuard {
    sysConfig;
    constructor(sysConfig) {
        this.sysConfig = sysConfig;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const res = context.switchToHttp().getResponse();
        const codeRequired = await this.userCodeRequired();
        if (!codeRequired)
            return true;
        const session = parseSession(req.cookies?.[exports.SESSION_COOKIE]);
        if (!session) {
            res.status(401).json({ success: false, message: '未登录或会话已过期' });
            return false;
        }
        req.session = session;
        return true;
    }
    async userCodeRequired() {
        try {
            if ((await prisma_1.prisma.user.count()) > 0)
                return true;
            const raw = await this.sysConfig.readSecurityRaw();
            if (String(raw?.auth?.admin?.adminPassword || ''))
                return true;
            if (String(raw?.auth?.user?.authCode || ''))
                return true;
            return !!(process.env.ADMIN_USER || process.env.ADMIN_PASSWORD);
        }
        catch {
            return true;
        }
    }
};
exports.OptionalAuthGuard = OptionalAuthGuard;
exports.OptionalAuthGuard = OptionalAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService])
], OptionalAuthGuard);
