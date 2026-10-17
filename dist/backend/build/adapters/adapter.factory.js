"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADAPTER_META = void 0;
exports.createAdapter = createAdapter;
exports.toCopyInfo = toCopyInfo;
const s3_adapter_1 = require("./s3.adapter");
const aliyun_adapter_1 = require("./aliyun.adapter");
const http_post_adapter_1 = require("./http-post.adapter");
const webdav_adapter_1 = require("./webdav.adapter");
const immich_adapter_1 = require("./immich.adapter");
function createAdapter(channel) {
    switch (channel.type) {
        case 'cos':
        case 'minio':
        case 'r2':
        case 's3':
            return new s3_adapter_1.S3Adapter(channel);
        case 'aliyun':
            return new aliyun_adapter_1.AliyunOssAdapter(channel);
        case 'easyimages':
        case 'lsky':
        case 'custom':
            return new http_post_adapter_1.HttpPostAdapter(channel);
        case 'webdav':
            return new webdav_adapter_1.WebdavAdapter();
        case 'immich':
            return new immich_adapter_1.ImmichAdapter();
        default:
            throw new Error(`未知渠道类型: ${channel.type}`);
    }
}
function toCopyInfo(c) {
    return { remoteKey: c.remoteKey, remoteUrl: c.remoteUrl, metas: {} };
}
exports.ADAPTER_META = {
    cos: { label: '腾讯云 COS', secretFields: ['secretId', 'secretKey'] },
    minio: { label: 'MinIO', secretFields: ['accessKeyId', 'secretAccessKey'] },
    r2: { label: 'Cloudflare R2', secretFields: ['accessKeyId', 'secretAccessKey'] },
    s3: { label: 'S3 兼容存储', secretFields: ['accessKeyId', 'secretAccessKey'] },
    aliyun: { label: '阿里云 OSS', secretFields: ['accessKeyId', 'accessKeySecret'] },
    easyimages: { label: 'EasyImages 简单图床', secretFields: ['token'] },
    lsky: { label: 'Lsky Pro 兰空图床', secretFields: ['token'] },
    webdav: { label: 'WebDAV 协议', secretFields: ['password'] },
    immich: { label: 'Immich', secretFields: ['apiKey'] },
    custom: { label: '自定义 Web 存储', secretFields: ['tokenValue'] },
};
