"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREFIX_CAPABLE_TYPES = void 0;
exports.renderObjectPrefix = renderObjectPrefix;
exports.renderFileName = renderFileName;
exports.joinObjectKey = joinObjectKey;
exports.randomUuid = randomUuid;
exports.supportsPrefix = supportsPrefix;
function pad(n, len = 2) {
    return String(n).padStart(len, '0');
}
function renderObjectPrefix(template, at = new Date()) {
    const tpl = String(template ?? '').trim();
    if (!tpl)
        return `${at.getFullYear()}/${pad(at.getMonth() + 1)}`;
    const replaced = tpl
        .replace(/\{y\}/g, String(at.getFullYear()))
        .replace(/\{m\}/g, pad(at.getMonth() + 1))
        .replace(/\{d\}/g, pad(at.getDate()));
    return replaced.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}
function renderFileName(template, tokens) {
    const tpl = String(template ?? '').trim();
    const ext = tokens.ext || '';
    const use = tpl || '{filename}-{timestamp}';
    const hasExtToken = /\{ext\}/.test(use);
    let name = use
        .replace(/\{filename\}/g, tokens.stem)
        .replace(/\{uuid\}/g, randomUuid())
        .replace(/\{md5\}/g, tokens.md5)
        .replace(/\{timestamp\}/g, String(tokens.timestamp))
        .replace(/\{ext\}/g, ext);
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '');
    if (!name)
        name = `${tokens.stem}-${tokens.timestamp}`;
    if (ext && !hasExtToken && !name.toLowerCase().endsWith('.' + ext.toLowerCase())) {
        name += '.' + ext;
    }
    return name;
}
function joinObjectKey(prefix, fileName) {
    const p = String(prefix || '').replace(/^\/+|\/+$/g, '');
    const f = String(fileName || '').replace(/^\/+/g, '');
    return p ? `${p}/${f}` : f;
}
function randomUuid() {
    const b = Buffer.alloc(16);
    for (let i = 0; i < 16; i += 1)
        b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
exports.PREFIX_CAPABLE_TYPES = ['minio', 'cos', 'aliyun', 'r2', 's3', 'webdav'];
function supportsPrefix(type) {
    return exports.PREFIX_CAPABLE_TYPES.includes(type);
}
