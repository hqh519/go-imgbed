/**
 * IP 归属地查询（全站唯一实现）。
 *
 * v2.3.0 起从 upload.service 里抽出来，上传记录与「访问记录」共用同一套
 * 配置（安全设置 → 上传 → IP 归属地查询）、同一张缓存表（ip_records）、
 * 同一个 6 秒超时与失败降级策略。
 *
 * 缓存策略：
 *   · 先查 ip_records（命中且至少有 country/region/city 之一即视为有效）
 *   · 未命中且开关打开 → 请求外部 API → 写回 ip_records
 *   · 结果在进程内再做一层短 TTL 内存缓存，避免同一 IP 高并发时打爆外部 API
 */
import { prisma } from './prisma';
import { SysConfigService } from '../settings/sysconfig.service';

/** 内存缓存：ip → { address, at }；TTL 10 分钟（库里已有更持久的缓存） */
const memCache = new Map<string, { address: string; at: number }>();
const MEM_TTL = 10 * 60 * 1000;
/** 正在查询中的 IP（避免并发重复请求同一个 IP） */
const inflight = new Map<string, Promise<string>>();

/** 内网 / 回环地址不做归属地查询（查了也是空的，白费一次外部请求） */
export function isPrivateIp(ip: string): boolean {
  const s = String(ip || '').trim();
  if (!s) return true;
  if (s === '::1' || s === 'localhost') return true;
  if (/^127\./.test(s)) return true;
  if (/^10\./.test(s)) return true;
  if (/^192\.168\./.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  if (/^169\.254\./.test(s)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(s)) return true; // IPv6 ULA
  if (/^fe80:/i.test(s)) return true; // IPv6 link-local
  return false;
}

/** 读缓存（只读库，不发外部请求）—— 上传主链路 / 访问记录落库都用这个 */
export async function cachedAddress(ip: string): Promise<string> {
  if (!ip) return '';
  const mem = memCache.get(ip);
  const now = Date.now();
  if (mem && now - mem.at < MEM_TTL) return mem.address;
  try {
    const row = await prisma.ipRecord.findUnique({ where: { ip } });
    if (row && (row.country || row.region || row.city)) {
      const address = [row.country, row.region, row.city].filter(Boolean).join(' ');
      memCache.set(ip, { address, at: now });
      return address;
    }
  } catch {
    /* 缓存查询失败不影响主流程 */
  }
  return '';
}

/** 归属地写库（同时刷新内存缓存） */
async function saveAddress(ip: string, country: string, region: string, city: string, address: string) {
  memCache.set(ip, { address, at: Date.now() });
  await prisma.ipRecord.upsert({
    where: { ip },
    update: { country, region, city },
    create: { ip, country, region, city },
  });
}

/**
 * 主动查询归属地（含外部请求）。
 * 开关关闭 / 内网 IP / 请求失败 → 返回空串（调用方按「未知」展示）。
 */
export async function resolveAddress(ip: string, sysConfig: SysConfigService): Promise<string> {
  const hit = await cachedAddress(ip);
  if (hit) return hit;
  if (isPrivateIp(ip)) return '';
  const pending = inflight.get(ip);
  if (pending) return pending;

  const task = (async () => {
    let cfg: any;
    try {
      const security: any = await sysConfig.get('security');
      cfg = security?.upload?.ipQuery;
    } catch {
      return '';
    }
    if (!cfg?.enabled) return '';

    const timeout = AbortSignal.timeout(6000);
    try {
      if (cfg.channel === 'customApi' && cfg.customApi?.url) {
        let url = String(cfg.customApi.url);
        for (const p of cfg.customApi.params || []) {
          if (!p?.key) continue;
          url = url.replace(new RegExp(`\\{${p.key}\\}`, 'g'), encodeURIComponent(p.value === '{ip}' ? ip : p.value));
        }
        const resp = await fetch(url, { signal: timeout });
        const json: any = await resp.json();
        const pick = (path: string) =>
          String(path)
            .split('.')
            .reduce((o: any, k: string) => (o == null ? '' : o[k]), json) || '';
        const fields: string[] = cfg.customApi.responseFields || [];
        const parts = fields.map(pick).filter(Boolean);
        const address = parts.join(' ');
        if (address) await saveAddress(ip, '', '', '', address);
        return address;
      }
      // 默认：ip-api.com（免费、无需 key）
      const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`, { signal: timeout });
      const json: any = await resp.json();
      const country = json?.country || '';
      const region = json?.regionName || '';
      const city = json?.city || '';
      const address = [country, region, city].filter(Boolean).join(' ');
      if (address) await saveAddress(ip, country, region, city, address);
      return address;
    } catch (err) {
      console.warn('[ipQuery] 归属地查询失败:', (err as Error).message);
      return '';
    }
  })();

  inflight.set(ip, task);
  try {
    return await task;
  } finally {
    inflight.delete(ip);
  }
}

/** 归属地上传计数（用户管理 → 按 IP 归集） */
export async function touchIpUpload(ip: string, address: string): Promise<void> {
  if (!ip) return;
  try {
    const parts = (address || '').split(' ');
    await prisma.ipRecord.upsert({
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
  } catch (err) {
    console.warn('[ipRecord] 计数失败:', (err as Error).message);
  }
}
