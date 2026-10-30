"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEDIA_MAX_SECONDS = void 0;
exports.cpuCores = cpuCores;
exports.estimateFfmpegSeconds = estimateFfmpegSeconds;
exports.mediaResourceGuard = mediaResourceGuard;
exports.postProcessMediaFile = postProcessMediaFile;
exports.mediaQueueStats = mediaQueueStats;
exports.enqueueMediaJob = enqueueMediaJob;
const os_1 = require("os");
const fs_1 = require("fs");
const compress_1 = require("../common/compress");
exports.MEDIA_MAX_SECONDS = compress_1.MEDIA_POST_MAX_SECONDS;
function cpuCores() {
    const n = (0, os_1.cpus)().length;
    return Number.isFinite(n) && n > 0 ? n : 1;
}
function estimateFfmpegSeconds(input) {
    const size = Math.max(0, Number(input.sizeBytes) || 0);
    const dur = Math.max(0, Number(input.durationSec) || 0);
    const factor = Math.max(1, cpuCores() / 4);
    if (input.kind === 'audio') {
        return Math.max(dur * 0.05, size / (6 * 1024 * 1024)) / factor;
    }
    return Math.max(dur * (3 / factor), size / (1.2 * 1024 * 1024) / factor);
}
function mediaResourceGuard() {
    const cores = cpuCores();
    if (cores < 2)
        return { ok: false, reason: `CPU 核心数过少（${cores} 核），跳过重编码以保证上传与网页响应` };
    const load1 = (0, os_1.loadavg)()[0] || 0;
    if (load1 > cores * 1.5) {
        return { ok: false, reason: `系统负载过高（load1=${load1.toFixed(2)}，共 ${cores} 核），跳过重编码` };
    }
    const freeMB = Math.round((0, os_1.freemem)() / 1024 / 1024);
    if (freeMB < 256)
        return { ok: false, reason: `可用内存不足（${freeMB}MB），跳过重编码` };
    return { ok: true };
}
async function postProcessMediaFile(srcPath, mime, ext, opts) {
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    const startedAt = Date.now();
    let original = 0;
    try {
        original = (await fs_1.promises.stat(srcPath)).size;
    }
    catch {
        original = 0;
    }
    const skip = (reason) => ({
        path: srcPath,
        size: original,
        mime: '',
        ext: '',
        compressed: false,
        reason,
        stage: 'none',
        skipReason: reason,
        elapsedMs: Date.now() - startedAt,
    });
    const isVideo = (mime || '').startsWith('video/');
    const isAudio = (mime || '').startsWith('audio/');
    if (!isVideo && !isAudio)
        return skip('非视频/音频，不进入后置处理');
    if (!original)
        return skip('无法读取文件大小');
    if (!(0, compress_1.ffmpegAvailable)())
        return skip('未安装 ffmpeg，跳过压缩与转码');
    const maxSeconds = Math.max(30, Number(opts.maxSeconds) || exports.MEDIA_MAX_SECONDS);
    const guard = mediaResourceGuard();
    if (!guard.ok)
        return skip(guard.reason || '系统资源不足，跳过压缩与转码');
    const kind = isVideo ? 'video' : 'audio';
    const durationSec = isVideo ? await (0, compress_1.probeMediaDurationFile)(srcPath) : 0;
    let cur = { path: srcPath, size: original, mime: '', ext: '', compressed: false };
    let stage = 'none';
    let skipReason = '';
    let estimated = 0;
    if (opts.compress) {
        estimated = estimateFfmpegSeconds({ sizeBytes: original, durationSec, kind });
        if (estimated > maxSeconds) {
            skipReason = `预计耗时约 ${Math.round(estimated)} 秒，超过 ${maxSeconds} 秒上限，放弃压缩`;
        }
        else {
            const r = isVideo
                ? await (0, compress_1.compressVideoFile)(srcPath, e, opts.percent, original, maxSeconds)
                : await (0, compress_1.compressAudioFile)(srcPath, e, opts.percent, original, maxSeconds);
            if (r.compressed) {
                cur = r;
                stage = 'compress';
            }
            else {
                skipReason = r.reason || '压缩未生效';
            }
        }
    }
    else {
        skipReason = '压缩开关未开启';
    }
    let codec = '';
    if (isVideo) {
        codec = await (0, compress_1.probeVideoCodecFile)(cur.path);
        const incompatible = compress_1.VIDEO_CODEC_INCOMPATIBLE.has(codec);
        if (stage === 'compress') {
        }
        else if (!opts.transcode) {
        }
        else if (!incompatible) {
            if (codec)
                skipReason = `${skipReason ? skipReason + '；' : ''}视频编码 ${codec} 浏览器可播，无需转码`;
        }
        else {
            const est = estimateFfmpegSeconds({ sizeBytes: cur.size, durationSec, kind: 'video' });
            if (est > maxSeconds) {
                skipReason = `${skipReason ? skipReason + '；' : ''}兼容转码预计耗时约 ${Math.round(est)} 秒，超过 ${maxSeconds} 秒上限，放弃转码`;
            }
            else {
                estimated = Math.max(estimated, est);
                const r = await (0, compress_1.transcodeVideoFile)(cur.path, cur.size, maxSeconds);
                if (r.compressed) {
                    cur = r;
                    stage = 'transcode';
                }
                else {
                    skipReason = `${skipReason ? skipReason + '；' : ''}${r.reason || '兼容转码未生效'}`;
                }
            }
        }
    }
    return {
        ...cur,
        stage,
        codec: codec || undefined,
        skipReason: skipReason || undefined,
        estimatedSeconds: estimated ? Math.round(estimated) : undefined,
        elapsedMs: Date.now() - startedAt,
    };
}
let queueRunning = false;
let currentLabel = '';
const pendingJobs = [];
function mediaQueueStats() {
    return { running: queueRunning, current: currentLabel, pending: pendingJobs.length };
}
async function pump() {
    if (queueRunning)
        return;
    queueRunning = true;
    try {
        while (pendingJobs.length) {
            const job = pendingJobs.shift();
            currentLabel = job.label;
            try {
                await job.run();
            }
            catch (err) {
                console.warn('[media-post] 任务异常:', job.label, err?.message || err);
            }
        }
    }
    finally {
        currentLabel = '';
        queueRunning = false;
    }
}
function enqueueMediaJob(label, run) {
    pendingJobs.push({ label, run });
    void pump();
}
