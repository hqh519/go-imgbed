"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPrivateIp = isPrivateIp;
exports.cachedAddress = cachedAddress;
exports.resolveAddress = resolveAddress;
exports.touchIpUpload = touchIpUpload;
const prisma_1 = require("./prisma");
const memCache = new Map();
const MEM_TTL = 10 * 60 * 1000;
const inflight = new Map();
function isPrivateIp(ip) {
    const s = String(ip || '').trim();
    if (!s)
        return true;
    if (s === '::1' || s === 'localhost')
        return true;
    if (/^127\./.test(s))
        return true;
    if (/^10\./.test(s))
        return true;
    if (/^192\.168\./.test(s))
        return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(s))
        return true;
    if (/^169\.254\./.test(s))
        return true;
    if (/^f[cd][0-9a-f]{2}:/i.test(s))
        return true;
    if (/^fe80:/i.test(s))
        return true;
    return false;
}
async function cachedAddress(ip) {
    if (!ip)
        return '';
    const mem = memCache.get(ip);
    const now = Date.now();
    if (mem && now - mem.at < MEM_TTL)
        return mem.address;
    try {
        const row = await prisma_1.prisma.ipRecord.findUnique({ where: { ip } });
        if (row && (row.country || row.region || row.city)) {
            const address = [row.country, row.region, row.city].filter(Boolean).join(' ');
            memCache.set(ip, { address, at: now });
            return address;
        }
    }
    catch {
    }
    return '';
}
async function saveAddress(ip, country, region, city, address) {
    memCache.set(ip, { address, at: Date.now() });
    await prisma_1.prisma.ipRecord.upsert({
        where: { ip },
        update: { country, region, city },
        create: { ip, country, region, city },
    });
}
async function resolveAddress(ip, sysConfig) {
    const hit = await cachedAddress(ip);
    if (hit)
        return hit;
    if (isPrivateIp(ip))
        return '';
    const pending = inflight.get(ip);
    if (pending)
        return pending;
    const task = (async () => {
        let cfg;
        try {
            const security = await sysConfig.get('security');
            cfg = security?.upload?.ipQuery;
        }
        catch {
            return '';
        }
        if (!cfg?.enabled)
            return '';
        const timeout = AbortSignal.timeout(6000);
        try {
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
                    await saveAddress(ip, '', '', '', address);
                return address;
            }
            const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`, { signal: timeout });
            const json = await resp.json();
            const country = json?.country || '';
            const region = json?.regionName || '';
            const city = json?.city || '';
            const address = [country, region, city].filter(Boolean).join(' ');
            if (address)
                await saveAddress(ip, country, region, city, address);
            return address;
        }
        catch (err) {
            console.warn('[ipQuery] 归属地查询失败:', err.message);
            return '';
        }
    })();
    inflight.set(ip, task);
    try {
        return await task;
    }
    finally {
        inflight.delete(ip);
    }
}
async function touchIpUpload(ip, address) {
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
