"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebdavAdapter = void 0;
const adapter_interface_1 = require("./adapter.interface");
const endpoint_1 = require("../common/endpoint");
class WebdavAdapter {
    authHeader(channel) {
        const { username, password } = channel.config;
        return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }
    baseOf(channel) {
        return (0, endpoint_1.ensureProtocol)(channel.config.baseUri || '').replace(/\/+$/, '');
    }
    fullPath(key, channel) {
        const base = this.baseOf(channel);
        const dir = (channel.config.directory || '').replace(/^\/+|\/+$/g, '');
        return `${base}/${dir ? dir + '/' : ''}${key}`;
    }
    async upload(file, key, channel) {
        if (!channel.config.baseUri)
            throw new adapter_interface_1.AdapterError('缺少 baseUri 配置', channel.type);
        const url = this.fullPath(key, channel);
        const base = this.baseOf(channel);
        const dir = (channel.config.directory || '').replace(/^\/+|\/+$/g, '');
        const keyDir = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
        const fullDir = [dir, keyDir].filter(Boolean).join('/');
        if (fullDir) {
            const parts = fullDir.split('/').filter(Boolean);
            for (let i = 1; i <= parts.length; i++) {
                const p = `${base}/${parts.slice(0, i).join('/')}`;
                try {
                    const r = await fetch(p, { method: 'MKCOL', headers: { Authorization: this.authHeader(channel) } });
                    if (!r.ok && r.status !== 405 && r.status !== 301) { }
                }
                catch { }
            }
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60000);
        try {
            const resp = await fetch(url, {
                method: 'PUT',
                headers: { Authorization: this.authHeader(channel), 'Content-Type': file.mime },
                body: new Uint8Array(file.buffer),
                signal: ctrl.signal,
            });
            if (!resp.ok)
                throw new adapter_interface_1.AdapterError(`WebDAV PUT 失败: HTTP ${resp.status}`, channel.type);
            return { remoteKey: key };
        }
        catch (err) {
            if (err instanceof adapter_interface_1.AdapterError)
                throw err;
            throw new adapter_interface_1.AdapterError(`WebDAV 请求失败: ${err.message}`, channel.type);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async delete(copy, channel) {
        const resp = await fetch(this.fullPath(copy.remoteKey, channel), {
            method: 'DELETE',
            headers: { Authorization: this.authHeader(channel) },
        });
        if (!resp.ok && resp.status !== 404) {
            throw new adapter_interface_1.AdapterError(`WebDAV DELETE 失败: HTTP ${resp.status}`, channel.type);
        }
    }
    buildDirectUrl(copy, channel) {
        if (channel.config.publicDomain) {
            const domain = (0, endpoint_1.ensureProtocol)(channel.config.publicDomain).replace(/\/+$/, '');
            const dir = (channel.config.directory || '').replace(/^\/+|\/+$/g, '');
            return `${domain}/${dir ? dir + '/' : ''}${copy.remoteKey}`;
        }
        return this.fullPath(copy.remoteKey, channel);
    }
}
exports.WebdavAdapter = WebdavAdapter;
