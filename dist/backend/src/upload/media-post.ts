/**
 * 视频/音频「后置处理」模块（v2.8.8）。
 *
 * 背景：v2.8.7 及以前，视频压缩 / 视频兼容转码挂在分块合并请求里同步执行。
 * 低配服务器（J1900 之类）上传几百 MB 的 HEVC 视频时，ffmpeg 要跑几十分钟：
 *   · 合并请求必然被反向代理（NPM / nginx）超时切断；
 *   · 前端判失败后重试，又撞上「合并中」并发锁（400），表现成「合并后一直失败」；
 *   · 同时 3 路 ffmpeg 把整机打满，连 /api/userConfig 都要 20 秒。
 *
 * 本模块把重活挪到「文件已上传成功之后」，并遵守三条硬规则：
 *   1) 全局单通道 —— 同一时刻只允许 1 路 ffmpeg（进程级串行队列）；
 *   2) 先压缩、后转码 —— 压缩产物已是 H.264，压完不必再转；
 *   3) 随时可以放弃 —— 预计耗时超过上限 / 整机资源不足 / 执行超时，
 *      立刻放弃当前步骤并保留上一步的产物，原文件永远可用。
 */
import { cpus, freemem, loadavg } from 'os';
import { promises as fsp } from 'fs';
import {
  MEDIA_POST_MAX_SECONDS,
  compressAudioFile,
  compressVideoFile,
  ffmpegAvailable,
  probeMediaDurationFile,
  probeVideoCodecFile,
  transcodeVideoFile,
  VIDEO_CODEC_INCOMPATIBLE,
  type FileCompressResult,
} from '../common/compress';

/** 单个 ffmpeg 步骤的时间上限（秒），可用 MEDIA_POST_MAX_SECONDS 覆盖 */
export const MEDIA_MAX_SECONDS = MEDIA_POST_MAX_SECONDS;

/** 当前机器可用核心数（容器内读到的是限额核数） */
export function cpuCores(): number {
  const n = cpus().length;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * 估算一次 ffmpeg 重编码需要多久（秒）。只用于「该不该开始」的决策，宁可估高：
 *   · 视频：按「每 1 秒视频需要 3 秒 / 核心倍率」，再用「单核 1.2MB/s」兜底；
 *   · 音频：重编码几乎不吃 CPU，按体积估。
 */
export function estimateFfmpegSeconds(input: { sizeBytes: number; durationSec?: number; kind: 'video' | 'audio' }): number {
  const size = Math.max(0, Number(input.sizeBytes) || 0);
  const dur = Math.max(0, Number(input.durationSec) || 0);
  const factor = Math.max(1, cpuCores() / 4);
  if (input.kind === 'audio') {
    return Math.max(dur * 0.05, size / (6 * 1024 * 1024)) / factor;
  }
  return Math.max(dur * (3 / factor), size / (1.2 * 1024 * 1024) / factor);
}

/**
 * 整机资源闸门：负载过高 / 可用内存过低时不做重编码 ——
 * 上传与网页响应优先，压缩转码只是「锦上添花」。
 */
export function mediaResourceGuard(): { ok: boolean; reason?: string } {
  const cores = cpuCores();
  if (cores < 2) return { ok: false, reason: `CPU 核心数过少（${cores} 核），跳过重编码以保证上传与网页响应` };
  const load1 = loadavg()[0] || 0;
  if (load1 > cores * 1.5) {
    return { ok: false, reason: `系统负载过高（load1=${load1.toFixed(2)}，共 ${cores} 核），跳过重编码` };
  }
  const freeMB = Math.round(freemem() / 1024 / 1024);
  if (freeMB < 256) return { ok: false, reason: `可用内存不足（${freeMB}MB），跳过重编码` };
  return { ok: true };
}

export interface PostProcessOptions {
  /** 是否允许「压缩」这一步 */
  compress: boolean;
  /** 压缩期望（体积占原文件百分比，10-100） */
  percent: number;
  /** 是否允许「兼容转码」这一步 */
  transcode: boolean;
  /** 单步时间上限（秒）；缺省用 MEDIA_MAX_SECONDS */
  maxSeconds?: number;
}

export interface PostProcessResult extends FileCompressResult {
  /** 最终产出来自哪一步：none（保持原文件）/ compress / transcode */
  stage: 'none' | 'compress' | 'transcode';
  /** 放弃/跳过原因（写系统日志用） */
  skipReason?: string;
  /** 探测到的视频编码（日志用） */
  codec?: string;
  /** 实际耗时（毫秒） */
  elapsedMs?: number;
  /** 估算耗时（秒，日志用） */
  estimatedSeconds?: number;
}

/**
 * 视频/音频后置处理：先压缩、再转码（v2.8.8 顺序要求）。
 *
 * 关键点：
 *   · 压缩走 libx264，产物本身就是 H.264 —— 压缩成功时不必再跑一遍全量转码；
 *   · 压缩被放弃（估算超时 / 资源不足 / 压不动）时，若编码浏览器不可播，再尝试兼容转码；
 *   · 任何一步失败都退回上一步的产物，最终退回原文件 —— 本函数永不抛异常。
 */
export async function postProcessMediaFile(
  srcPath: string,
  mime: string,
  ext: string,
  opts: PostProcessOptions,
): Promise<PostProcessResult> {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  const startedAt = Date.now();
  let original = 0;
  try {
    original = (await fsp.stat(srcPath)).size;
  } catch {
    original = 0;
  }
  const skip = (reason: string): PostProcessResult => ({
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
  if (!isVideo && !isAudio) return skip('非视频/音频，不进入后置处理');
  if (!original) return skip('无法读取文件大小');
  if (!ffmpegAvailable()) return skip('未安装 ffmpeg，跳过压缩与转码');

  const maxSeconds = Math.max(30, Number(opts.maxSeconds) || MEDIA_MAX_SECONDS);
  const guard = mediaResourceGuard();
  if (!guard.ok) return skip(guard.reason || '系统资源不足，跳过压缩与转码');

  const kind: 'video' | 'audio' = isVideo ? 'video' : 'audio';
  const durationSec = isVideo ? await probeMediaDurationFile(srcPath) : 0;

  // ---- 第一步：压缩 ----
  let cur: FileCompressResult = { path: srcPath, size: original, mime: '', ext: '', compressed: false };
  let stage: 'none' | 'compress' | 'transcode' = 'none';
  let skipReason = '';
  let estimated = 0;
  if (opts.compress) {
    estimated = estimateFfmpegSeconds({ sizeBytes: original, durationSec, kind });
    if (estimated > maxSeconds) {
      skipReason = `预计耗时约 ${Math.round(estimated)} 秒，超过 ${maxSeconds} 秒上限，放弃压缩`;
    } else {
      const r = isVideo
        ? await compressVideoFile(srcPath, e, opts.percent, original, maxSeconds)
        : await compressAudioFile(srcPath, e, opts.percent, original, maxSeconds);
      if (r.compressed) {
        cur = r;
        stage = 'compress';
      } else {
        skipReason = r.reason || '压缩未生效';
      }
    }
  } else {
    skipReason = '压缩开关未开启';
  }

  // ---- 第二步：兼容转码（仅视频；压缩已成功时产物必然是 H.264，无需再转）----
  let codec = '';
  if (isVideo) {
    codec = await probeVideoCodecFile(cur.path);
    const incompatible = VIDEO_CODEC_INCOMPATIBLE.has(codec);
    if (stage === 'compress') {
      // 压缩产物统一是 libx264 → 浏览器可播，直接收工
    } else if (!opts.transcode) {
      // 兼容转码开关关闭，什么也不做
    } else if (!incompatible) {
      if (codec) skipReason = `${skipReason ? skipReason + '；' : ''}视频编码 ${codec} 浏览器可播，无需转码`;
    } else {
      const est = estimateFfmpegSeconds({ sizeBytes: cur.size, durationSec, kind: 'video' });
      if (est > maxSeconds) {
        skipReason = `${skipReason ? skipReason + '；' : ''}兼容转码预计耗时约 ${Math.round(est)} 秒，超过 ${maxSeconds} 秒上限，放弃转码`;
      } else {
        estimated = Math.max(estimated, est);
        const r = await transcodeVideoFile(cur.path, cur.size, maxSeconds);
        if (r.compressed) {
          cur = r;
          stage = 'transcode';
        } else {
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

/* ---------------- 进程级单通道队列 ---------------- */

type Job = { label: string; run: () => Promise<void> };

let queueRunning = false;
let currentLabel = '';
const pendingJobs: Job[] = [];

/** 当前队列状态（系统状态页 / 日志用） */
export function mediaQueueStats(): { running: boolean; current: string; pending: number } {
  return { running: queueRunning, current: currentLabel, pending: pendingJobs.length };
}

async function pump(): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (pendingJobs.length) {
      const job = pendingJobs.shift() as Job;
      currentLabel = job.label;
      try {
        await job.run();
      } catch (err) {
        // 单个任务失败绝不影响队列继续跑
        console.warn('[media-post] 任务异常:', job.label, (err as Error)?.message || err);
      }
    }
  } finally {
    currentLabel = '';
    queueRunning = false;
  }
}

/**
 * 投递一个后置处理任务。
 * 全局串行：同一时刻只有一个任务在跑，即「全局只允许 1 路 ffmpeg」。
 */
export function enqueueMediaJob(label: string, run: () => Promise<void>): void {
  pendingJobs.push({ label, run });
  void pump();
}
