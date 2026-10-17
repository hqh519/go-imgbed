"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_SHORT = exports.CHANNEL_LABEL = exports.UPLOAD_SOURCES = void 0;
exports.normalizeUploadSource = normalizeUploadSource;
exports.channelShort = channelShort;
exports.fileTypeOf = fileTypeOf;
exports.fileExtOf = fileExtOf;
exports.hasFileExt = hasFileExt;
exports.extSuffixFor = extSuffixFor;
exports.formatSize = formatSize;
exports.safeParse = safeParse;
exports.buildDirectoryTree = buildDirectoryTree;
exports.buildMetadata = buildMetadata;
exports.serializeFile = serializeFile;
exports.normalizeDir = normalizeDir;
exports.UPLOAD_SOURCES = ['Default', 'WebDAV', 'API-Web', 'API-S3'];
function normalizeUploadSource(raw) {
    const v = String(raw || '').trim();
    return exports.UPLOAD_SOURCES.includes(v) ? v : 'Default';
}
exports.CHANNEL_LABEL = {
    cos: 'Tencent',
    minio: 'MinIO',
    r2: 'R2',
    s3: 'S3',
    aliyun: 'Aliyun',
    easyimages: 'Easy',
    lsky: 'Lsky',
    webdav: 'WebDAV',
    immich: 'Immich',
    custom: 'External',
};
exports.CHANNEL_SHORT = {
    easyimages: 'EI',
    lsky: 'LS',
    cos: 'COS',
    aliyun: 'ALI',
    immich: 'IM',
    minio: 'MI',
    r2: 'R2',
    s3: 'S3',
    webdav: 'WD',
    custom: 'DIY',
};
function channelShort(typeOrLabel) {
    const raw = String(typeOrLabel || '').trim();
    if (!raw)
        return '';
    const key = raw.toLowerCase();
    if (exports.CHANNEL_SHORT[key])
        return exports.CHANNEL_SHORT[key];
    const byLabel = Object.keys(exports.CHANNEL_LABEL).find((t) => exports.CHANNEL_LABEL[t].toLowerCase() === key);
    if (byLabel && exports.CHANNEL_SHORT[byLabel])
        return exports.CHANNEL_SHORT[byLabel];
    return raw.slice(0, 4).toUpperCase();
}
function fileTypeOf(mime) {
    if (!mime)
        return 'other';
    if (mime.startsWith('image/'))
        return 'image';
    if (mime.startsWith('video/'))
        return 'video';
    if (mime.startsWith('audio/'))
        return 'audio';
    return 'other';
}
function fileExtOf(originalName, mime) {
    const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(originalName || ''));
    if (m)
        return m[1].toLowerCase();
    const sub = String(mime || '').split('/')[1] || '';
    const cleaned = sub.split(';')[0].replace(/^x-/, '').trim().toLowerCase();
    if (!cleaned)
        return '';
    return cleaned === 'jpeg' ? 'jpg' : cleaned;
}
function hasFileExt(id) {
    return /\.[A-Za-z0-9]{1,12}$/.test(String(id || ''));
}
function extSuffixFor(id, originalName) {
    if (hasFileExt(id))
        return '';
    const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(originalName || ''));
    return m ? `.${m[1].toLowerCase()}` : '';
}
function formatSize(bytes) {
    if (!bytes || bytes <= 0)
        return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i += 1;
    }
    return `${i === 0 ? n : n.toFixed(2)} ${units[i]}`;
}
function safeParse(raw) {
    if (!raw)
        return {};
    try {
        const v = JSON.parse(raw);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }
    catch {
        return {};
    }
}
function buildDirectoryTree(directories) {
    const root = { name: '/', path: '', children: [] };
    const nodeMap = new Map([['', root]]);
    for (const dirPath of [...directories].sort()) {
        if (!dirPath)
            continue;
        const normalized = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
        const parts = normalized.split('/').filter(Boolean);
        let currentPath = '';
        let parent = root;
        for (const part of parts) {
            currentPath += `${part}/`;
            const existing = nodeMap.get(currentPath);
            if (existing) {
                parent = existing;
                continue;
            }
            const node = { name: part, path: currentPath, children: [] };
            parent.children.push(node);
            nodeMap.set(currentPath, node);
            parent = node;
        }
    }
    const sortChildren = (node) => {
        node.children.sort((a, b) => a.name.localeCompare(b.name));
        node.children.forEach(sortChildren);
    };
    sortChildren(root);
    return root;
}
function buildMetadata(rec, copies, opts = {}) {
    const metas = safeParse(rec.metas);
    const primary = copies.find((c) => c.channel?.isMain) || copies[0];
    const channelLabel = primary?.channel ? exports.CHANNEL_LABEL[primary.channel.type] || primary.channel.type : '';
    const backupChannels = copies
        .filter((c) => c !== primary && c.status === 'active' && c.channel)
        .map((c) => ({
        id: c.channelId,
        code: c.channel.code || '',
        type: c.channel.type,
        label: exports.CHANNEL_LABEL[c.channel.type] || c.channel.type,
        short: channelShort(c.channel.type),
        name: c.channel.name,
        url: (opts.resolveDirectUrl ? opts.resolveDirectUrl(c) : '') || '',
    }));
    const storageUrl = (primary && opts.resolveDirectUrl ? opts.resolveDirectUrl(primary) : '') || '';
    const size = Number(rec.size) || 0;
    const rawOriginalSize = Number(rec.originalSize) || 0;
    const originalSize = rawOriginalSize > 0 ? rawOriginalSize : size;
    const meta = {
        FileName: rec.originalName,
        FileType: fileTypeOf(rec.mime),
        FileExt: fileExtOf(rec.originalName, rec.mime),
        FileSize: formatSize(size),
        FileSizeBytes: size,
        FileSizeOriginal: formatSize(originalSize),
        FileSizeOriginalBytes: originalSize,
        MD5: rec.md5 || '',
        Views: rec.views || 0,
        UploadIP: rec.ip || '',
        UploadAddress: metas.UploadAddress || '',
        UploadUser: rec.uploader || '',
        UploadSource: normalizeUploadSource(rec.uploadSource),
        RedirectUrl: rec.redirectUrl || '',
        ListType: metas.ListType || 'None',
        TimeStamp: rec.createdAt.getTime(),
        Label: metas.Label || 'None',
        Directory: rec.folder ? `${rec.folder.replace(/\/+$/, '')}/` : '',
        Tags: opts.tags || metas.Tags || [],
        Channel: channelLabel,
        ChannelShort: primary?.channel ? channelShort(primary.channel.type) : '',
        ChannelId: primary?.channelId || '',
        ChannelCode: primary?.channel?.code || '',
        ChannelName: primary?.channel?.name || '',
        StorageUrl: storageUrl,
        BackupChannels: backupChannels,
        FileHash: rec.hash || '',
    };
    if (metas.Width)
        meta.Width = metas.Width;
    if (metas.Height)
        meta.Height = metas.Height;
    if (metas.ExternalLink)
        meta.ExternalLink = metas.ExternalLink;
    for (const [k, v] of Object.entries(metas)) {
        if (!(k in meta))
            meta[k] = v;
    }
    return meta;
}
function serializeFile(rec, copies, opts = {}) {
    return { name: rec.name, metadata: buildMetadata(rec, copies, opts) };
}
function normalizeDir(dir) {
    let d = (dir || '').replace(/\.\./g, '_').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (d.startsWith('/'))
        d = d.substring(1);
    if (d && !d.endsWith('/'))
        d += '/';
    return d;
}
