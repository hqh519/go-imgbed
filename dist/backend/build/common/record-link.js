"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordDomainCandidates = recordDomainCandidates;
exports.matchRecordSource = matchRecordSource;
exports.recordLoadOrigin = recordLoadOrigin;
exports.joinRecordUrl = joinRecordUrl;
exports.hasRecordDomains = hasRecordDomains;
function clean(value) {
    return String(value ?? '').trim().replace(/\/+$/, '');
}
function originOf(raw) {
    try {
        return new URL(raw).origin;
    }
    catch {
        return '';
    }
}
function recordDomainCandidates(cfg) {
    const c = cfg || {};
    const out = [];
    const internal = clean(c.internalDomain);
    const publicDomain = clean(c.publicDomain);
    const apiRaw = clean(c.apiUrl) || clean(c.endpoint);
    const api = originOf(apiRaw);
    if (internal)
        out.push({ field: 'internalDomain', domain: internal });
    if (publicDomain)
        out.push({ field: 'publicDomain', domain: publicDomain });
    if (api)
        out.push({ field: 'apiUrl', domain: api });
    return out;
}
function matchRecordSource(cfg, sourceUrl) {
    const src = String(sourceUrl || '').trim();
    if (!/^https?:\/\//i.test(src))
        return null;
    for (const cand of recordDomainCandidates(cfg)) {
        if (!src.includes(cand.domain))
            continue;
        const rest = src.split(cand.domain).join('').replace(/^\/+/, '');
        if (!rest)
            return null;
        return { ...cand, rest };
    }
    return null;
}
function recordLoadOrigin(cfg, preferInternal = true) {
    const cands = recordDomainCandidates(cfg);
    if (!cands.length)
        return '';
    if (preferInternal)
        return cands[0].domain;
    return cands.find((c) => c.field === 'publicDomain')?.domain || cands[0].domain;
}
function joinRecordUrl(origin, rest) {
    const o = String(origin || '').replace(/\/+$/, '');
    const p = String(rest || '').replace(/^\/+/, '');
    if (!o || !p)
        return '';
    return `${o}/${p}`;
}
function hasRecordDomains(cfg) {
    return recordDomainCandidates(cfg).length > 0;
}
