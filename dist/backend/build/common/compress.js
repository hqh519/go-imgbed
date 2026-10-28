"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ffmpegAvailable = ffmpegAvailable;
exports.compressMedia = compressMedia;
exports.readDimensions = readDimensions;
exports.compressFile = compressFile;
exports.readDimensionsFile = readDimensionsFile;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const crypto_1 = require("crypto");
const util_1 = require("util");
const run = (0, util_1.promisify)(child_process_1.execFile);
const IMAGE_OK = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);
const VIDEO_OK = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']);
const AUDIO_OK = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']);
const SKIP = new Set(['gif', 'svg', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'ico', 'apng', 'psd']);
let ffmpegChecked = false;
let ffmpegPath = '';
function ffmpegAvailable() {
    if (ffmpegChecked)
        return !!ffmpegPath;
    ffmpegChecked = true;
    const envPath = String(process.env.FFMPEG_PATH || '').trim();
    for (const bin of [envPath, 'ffmpeg'].filter(Boolean)) {
        try {
            (0, child_process_1.execFileSync)(bin, ['-version'], { stdio: 'ignore', timeout: 5000 });
            ffmpegPath = bin;
            console.log(`[compress] ffmpeg 可用：${bin}（视频 / 音频压缩已启用）`);
            return true;
        }
        catch {
        }
    }
    ffmpegPath = '';
    console.log('[compress] 未检测到 ffmpeg：视频 / 音频将跳过压缩（图片压缩不受影响）');
    return false;
}
function clampQuality(percent) {
    const p = Number.isFinite(percent) && percent > 0 ? percent : 80;
    return Math.min(100, Math.max(10, p));
}
async function compressImage(buffer, ext, percent) {
    const keep = (reason) => ({ buffer, mime: '', ext: '', compressed: false, reason });
    if (SKIP.has(ext))
        return keep(`${ext} 格式不支持压缩`);
    if (!IMAGE_OK.has(ext))
        return keep(`${ext} 不是可压缩的图片格式`);
    const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
    sharp.cache({ memory: 32 });
    sharp.concurrency(2);
    const quality = clampQuality(percent);
    const ratio = Math.max(0.1, quality / 100);
    const target = Math.max(1024, Math.round(buffer.length * ratio));
    if (ext === 'png') {
        const out = await sharp(buffer, { limitInputPixels: 40_000_000 })
            .rotate()
            .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
            .toBuffer();
        if (out.length < buffer.length * 0.98) {
            return { buffer: out, mime: 'image/png', ext: '.png', compressed: true };
        }
        return keep('png 重编码后没有变小（保持透明优先）');
    }
    let q = quality;
    let out = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toBuffer();
    for (let i = 0; i < 4 && out.length > target && q > 20; i++) {
        q = Math.max(20, Math.round(q * Math.sqrt(target / out.length)));
        out = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toBuffer();
    }
    if (out.length >= buffer.length)
        return keep('压缩后体积未减小');
    return { buffer: out, mime: 'image/webp', ext: '.webp', compressed: true };
}
async function withTempFiles(exts, fn) {
    const dir = await fs_1.promises.mkdtemp((0, path_1.join)((0, os_1.tmpdir)(), 'goimgbed-cmp-'));
    const paths = exts.map((e) => (0, path_1.join)(dir, `${(0, crypto_1.randomBytes)(6).toString('hex')}${e}`));
    try {
        return await fn(paths);
    }
    finally {
        for (const p of paths)
            await fs_1.promises.unlink(p).catch(() => undefined);
        await fs_1.promises.rmdir(dir).catch(() => undefined);
    }
}
async function compressVideo(buffer, ext, percent) {
    const keep = (reason) => ({ buffer, mime: '', ext: '', compressed: false, reason });
    if (!ffmpegAvailable())
        return keep('未安装 ffmpeg，视频跳过压缩');
    if (!VIDEO_OK.has(ext))
        return keep(`${ext} 不是可压缩的视频格式`);
    const p = clampQuality(percent);
    const crf = Math.min(40, Math.max(20, Math.round(38 - p * 0.14)));
    const outExt = ext === 'webm' ? '.webm' : '.mp4';
    try {
        return await withTempFiles([`.${ext}`, outExt], async ([src, dst]) => {
            await fs_1.promises.writeFile(src, buffer);
            const args = outExt === '.webm'
                ? ['-y', '-i', src, '-c:v', 'libvpx-vp9', '-crf', String(Math.min(50, crf + 8)), '-b:v', '0', '-c:a', 'libopus', dst]
                : [
                    '-y', '-i', src,
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                    '-c:a', 'aac', '-b:a', '96k',
                    dst,
                ];
            await run(ffmpegPath, args, { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
            const outBuf = await fs_1.promises.readFile(dst);
            if (!outBuf.length)
                return keep('ffmpeg 输出为空');
            if (outBuf.length >= buffer.length * 0.95)
                return keep('转码后体积未明显减小');
            return {
                buffer: outBuf,
                mime: outExt === '.webm' ? 'video/webm' : 'video/mp4',
                ext: outExt,
                compressed: true,
            };
        });
    }
    catch (err) {
        return keep(`ffmpeg 转码失败：${err.message}`);
    }
}
async function compressAudio(buffer, ext, percent) {
    const keep = (reason) => ({ buffer, mime: '', ext: '', compressed: false, reason });
    if (!ffmpegAvailable())
        return keep('未安装 ffmpeg，音频跳过压缩');
    if (!AUDIO_OK.has(ext))
        return keep(`${ext} 不是可压缩的音频格式`);
    const p = clampQuality(percent);
    const bitrate = Math.round(Math.min(320, Math.max(48, p * 2)));
    const outExt = ext === 'mp3' ? '.mp3' : '.m4a';
    try {
        return await withTempFiles([`.${ext}`, outExt], async ([src, dst]) => {
            await fs_1.promises.writeFile(src, buffer);
            const args = outExt === '.mp3'
                ? ['-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, dst]
                : ['-y', '-i', src, '-vn', '-c:a', 'aac', '-b:a', `${bitrate}k`, '-movflags', '+faststart', dst];
            await run(ffmpegPath, args, { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
            const outBuf = await fs_1.promises.readFile(dst);
            if (!outBuf.length)
                return keep('ffmpeg 输出为空');
            if (outBuf.length >= buffer.length * 0.95)
                return keep('转码后体积未明显减小');
            return {
                buffer: outBuf,
                mime: outExt === '.mp3' ? 'audio/mpeg' : 'audio/mp4',
                ext: outExt,
                compressed: true,
            };
        });
    }
    catch (err) {
        return keep(`ffmpeg 转码失败：${err.message}`);
    }
}
async function compressMedia(buffer, mime, ext, percent) {
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    try {
        if ((mime || '').startsWith('image/'))
            return await compressImage(buffer, e, percent);
        if ((mime || '').startsWith('video/'))
            return await compressVideo(buffer, e, percent);
        if ((mime || '').startsWith('audio/'))
            return await compressAudio(buffer, e, percent);
        return { buffer, mime: '', ext: '', compressed: false, reason: `${mime || e} 不支持压缩` };
    }
    catch (err) {
        return { buffer, mime: '', ext: '', compressed: false, reason: `压缩异常：${err.message}` };
    }
}
async function readDimensions(buffer, mime, ext) {
    try {
        if ((mime || '').startsWith('image/') && !SKIP.has(ext)) {
            const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
            const meta = await sharp(buffer, { limitInputPixels: 100_000_000 }).metadata();
            if (meta.width && meta.height)
                return { width: meta.width, height: meta.height };
        }
    }
    catch {
    }
    return {};
}
async function compressFile(srcPath, mime, ext, percent) {
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    let original = 0;
    try {
        original = (await fs_1.promises.stat(srcPath)).size;
    }
    catch {
        original = 0;
    }
    const keep = (reason) => ({
        path: srcPath,
        size: original,
        mime: '',
        ext: '',
        compressed: false,
        reason,
    });
    if (!original)
        return keep('无法读取文件大小');
    if (SKIP.has(e))
        return keep(`${e} 格式按规则不压缩`);
    try {
        if ((mime || '').startsWith('image/'))
            return await compressImageFile(srcPath, e, percent, original);
        if ((mime || '').startsWith('video/'))
            return await compressVideoFile(srcPath, e, percent, original);
        if ((mime || '').startsWith('audio/'))
            return await compressAudioFile(srcPath, e, percent, original);
        return keep(`${mime || e} 不支持压缩`);
    }
    catch (err) {
        return keep(`压缩异常：${err.message}`);
    }
}
async function compressImageFile(srcPath, e, percent, original) {
    const keep = (reason) => ({
        path: srcPath,
        size: original,
        mime: '',
        ext: '',
        compressed: false,
        reason,
    });
    if (!IMAGE_OK.has(e))
        return keep(`${e} 不是可压缩的图片格式`);
    const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
    sharp.cache({ memory: 32 });
    sharp.concurrency(2);
    const quality = clampQuality(percent);
    const target = Math.max(1024, Math.round(original * Math.max(0.1, quality / 100)));
    if (e === 'png') {
        const out = `${srcPath}.cmp.png`;
        await sharp(srcPath, { limitInputPixels: 40_000_000 })
            .rotate()
            .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
            .toFile(out);
        const st = await fs_1.promises.stat(out);
        if (st.size < original * 0.98) {
            return { path: out, size: st.size, mime: 'image/png', ext: '.png', compressed: true };
        }
        await fs_1.promises.rm(out, { force: true }).catch(() => undefined);
        return keep('png 重编码后没有变小（保持透明优先）');
    }
    const out = `${srcPath}.cmp.webp`;
    let q = quality;
    let lastSize = 0;
    for (let i = 0; i < 4; i++) {
        await sharp(srcPath, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toFile(out);
        lastSize = (await fs_1.promises.stat(out)).size;
        if (lastSize <= target || q <= 20)
            break;
        q = Math.max(20, Math.round(q * Math.sqrt(target / Math.max(1, lastSize))));
    }
    if (lastSize && lastSize < original * 0.98) {
        return { path: out, size: lastSize, mime: 'image/webp', ext: '.webp', compressed: true };
    }
    await fs_1.promises.rm(out, { force: true }).catch(() => undefined);
    return keep('压缩后体积未减小');
}
async function compressVideoFile(srcPath, e, percent, original) {
    const keep = (reason) => ({
        path: srcPath,
        size: original,
        mime: '',
        ext: '',
        compressed: false,
        reason,
    });
    if (!ffmpegAvailable())
        return keep('未安装 ffmpeg，视频跳过压缩');
    if (!VIDEO_OK.has(e))
        return keep(`${e} 不是可压缩的视频格式`);
    const p = clampQuality(percent);
    const crf = Math.min(40, Math.max(20, Math.round(38 - p * 0.14)));
    const outExt = e === 'webm' ? '.webm' : '.mp4';
    const out = `${srcPath}.cmp${outExt}`;
    const args = outExt === '.webm'
        ? ['-y', '-i', srcPath, '-c:v', 'libvpx-vp9', '-crf', String(Math.min(50, crf + 8)), '-b:v', '0', '-c:a', 'libopus', out]
        : [
            '-y', '-i', srcPath,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
            '-c:a', 'aac', '-b:a', '96k',
            out,
        ];
    await run(ffmpegPath, args, { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
    const st = await fs_1.promises.stat(out);
    if (st.size >= original * 0.95) {
        await fs_1.promises.rm(out, { force: true }).catch(() => undefined);
        return keep('转码后体积未明显减小');
    }
    return {
        path: out,
        size: st.size,
        mime: outExt === '.webm' ? 'video/webm' : 'video/mp4',
        ext: outExt,
        compressed: true,
    };
}
async function compressAudioFile(srcPath, e, percent, original) {
    const keep = (reason) => ({
        path: srcPath,
        size: original,
        mime: '',
        ext: '',
        compressed: false,
        reason,
    });
    if (!ffmpegAvailable())
        return keep('未安装 ffmpeg，音频跳过压缩');
    if (!AUDIO_OK.has(e))
        return keep(`${e} 不是可压缩的音频格式`);
    const p = clampQuality(percent);
    const bitrate = Math.round(Math.min(320, Math.max(48, p * 2)));
    const outExt = e === 'mp3' ? '.mp3' : '.m4a';
    const out = `${srcPath}.cmp${outExt}`;
    const args = outExt === '.mp3'
        ? ['-y', '-i', srcPath, '-vn', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, out]
        : ['-y', '-i', srcPath, '-vn', '-c:a', 'aac', '-b:a', `${bitrate}k`, '-movflags', '+faststart', out];
    await run(ffmpegPath, args, { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
    const st = await fs_1.promises.stat(out);
    if (st.size >= original * 0.95) {
        await fs_1.promises.rm(out, { force: true }).catch(() => undefined);
        return keep('转码后体积未明显减小');
    }
    return {
        path: out,
        size: st.size,
        mime: outExt === '.mp3' ? 'audio/mpeg' : 'audio/mp4',
        ext: outExt,
        compressed: true,
    };
}
async function readDimensionsFile(path, mime, ext) {
    try {
        if ((mime || '').startsWith('image/') && !SKIP.has(ext)) {
            const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
            const meta = await sharp(path, { limitInputPixels: 100_000_000 }).metadata();
            if (meta.width && meta.height)
                return { width: meta.width, height: meta.height };
        }
    }
    catch {
    }
    return {};
}
