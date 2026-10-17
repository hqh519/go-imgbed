"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalAdapter = void 0;
exports.localFileAbs = localFileAbs;
exports.writeLocalStream = writeLocalStream;
const fs_1 = require("fs");
const path_1 = require("path");
const promises_1 = require("stream/promises");
const adapter_interface_1 = require("./adapter.interface");
const project_paths_1 = require("../common/project-paths");
class LocalAdapter {
    static root() {
        return (0, project_paths_1.backendSub)('uploads');
    }
    static toRelativePath(key) {
        const clean = String(key || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .split('/')
            .filter((seg) => seg && seg !== '.' && seg !== '..')
            .join('/');
        if (!clean)
            throw new adapter_interface_1.AdapterError('key 为空，无法写入本地存储', 'local');
        const parts = clean.split('/');
        const head = parts[0];
        if (/^\d{6}$/.test(head)) {
            parts.splice(0, 1, head.slice(0, 4), head.slice(4));
        }
        return parts.join('/');
    }
    static absolutePath(key) {
        const root = LocalAdapter.root();
        const abs = (0, path_1.normalize)((0, path_1.join)(root, LocalAdapter.toRelativePath(key)));
        const rootWithSep = root.endsWith(path_1.sep) ? root : root + path_1.sep;
        if (!abs.startsWith(rootWithSep)) {
            throw new adapter_interface_1.AdapterError('非法的本地存储路径', 'local');
        }
        return abs;
    }
    async upload(file, key, _channel) {
        const abs = LocalAdapter.absolutePath(key);
        try {
            await fs_1.promises.mkdir((0, path_1.dirname)(abs), { recursive: true });
            await fs_1.promises.writeFile(abs, file.buffer);
        }
        catch (err) {
            throw new adapter_interface_1.AdapterError(`写入本地文件失败：${err.message}`, 'local');
        }
        return { remoteKey: LocalAdapter.toRelativePath(key), metas: { local: true } };
    }
    async delete(copy, _channel) {
        const rel = String(copy.remoteKey || '');
        if (!rel)
            return;
        let abs;
        try {
            abs = LocalAdapter.absolutePath(rel);
        }
        catch {
            return;
        }
        try {
            await fs_1.promises.unlink(abs);
        }
        catch (err) {
            if (err?.code !== 'ENOENT') {
                throw new adapter_interface_1.AdapterError(`删除本地文件失败：${err.message}`, 'local');
            }
        }
    }
    buildDirectUrl(_copy, _channel) {
        return null;
    }
}
exports.LocalAdapter = LocalAdapter;
function localFileAbs(remoteKey) {
    const rel = String(remoteKey || '').replace(/^\/+/, '');
    if (!rel)
        return '';
    try {
        const abs = LocalAdapter.absolutePath(rel);
        if ((0, fs_1.existsSync)(abs))
            return abs;
    }
    catch {
    }
    const root = LocalAdapter.root();
    const legacy = (0, path_1.normalize)((0, path_1.join)(root, rel));
    const rootWithSep = root.endsWith(path_1.sep) ? root : root + path_1.sep;
    if (legacy.startsWith(rootWithSep) && (0, fs_1.existsSync)(legacy))
        return legacy;
    return '';
}
async function writeLocalStream(relKey, source) {
    const abs = LocalAdapter.absolutePath(relKey);
    (0, fs_1.mkdirSync)((0, path_1.dirname)(abs), { recursive: true });
    await (0, promises_1.pipeline)(source, (0, fs_1.createWriteStream)(abs));
}
