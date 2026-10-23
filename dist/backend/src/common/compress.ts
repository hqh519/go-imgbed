/**
 * 媒体压缩（v2.3.0 统一入口）。
 *
 * 和 v1.x 的「只压图片」相比，这里明确了几条规则：
 *   1) **图片**：jpg/png/webp/avif 走 sharp。
 *        · png 必须保持透明 —— 用 `png({compressionLevel:9})` 重编码（不转调色板、不转 webp），
 *          压完不比原图小就放弃，改用原图（需求：无法保透明就不压）。
 *        · gif 直接跳过（sharp 会丢帧，动图压完就废了）。
 *        · svg / heic / tiff 等不支持的一律跳过。
 *   2) **视频 / 音频**：走 ffmpeg（H.264 / AAC / MP3）。ffmpeg 是可选依赖 ——
 *      没装就自动跳过并记一行日志，绝不因为「压不了」把上传搞失败。
 *   3) **任何一步失败 → 返回原文件**（compressed=false + reason），调用方直接上传原图。
 */
import { execFile, execFileSync } from 'child_process';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { promisify } from 'util';

const run = promisify(execFile);

export interface CompressResult {
  buffer: Buffer;
  mime: string;
  ext: string;
  /** 是否真的压小了并替换了内容 */
  compressed: boolean;
  /** 未压缩时的原因（写日志用） */
  reason?: string;
}

/** 图片类可压缩的格式 */
const IMAGE_OK = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);
/** 视频类可压缩的格式 */
const VIDEO_OK = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']);
/** 音频类可压缩的格式 */
const AUDIO_OK = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']);
/** 明确跳过的（会丢帧 / 丢透明 / 矢量 / 需要专业编码器） */
const SKIP = new Set(['gif', 'svg', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'ico', 'apng', 'psd']);

/* ---------------- ffmpeg 探测 ---------------- */

let ffmpegChecked = false;
let ffmpegPath = '';

/** ffmpeg 是否可用（结果进程内缓存；可用 FFMPEG_PATH 指定绝对路径） */
export function ffmpegAvailable(): boolean {
  if (ffmpegChecked) return !!ffmpegPath;
  ffmpegChecked = true;
  const envPath = String(process.env.FFMPEG_PATH || '').trim();
  for (const bin of [envPath, 'ffmpeg'].filter(Boolean)) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 5000 });
      ffmpegPath = bin;
      console.log(`[compress] ffmpeg 可用：${bin}（视频 / 音频压缩已启用）`);
      return true;
    } catch {
      /* 试下一个 */
    }
  }
  ffmpegPath = '';
  console.log('[compress] 未检测到 ffmpeg：视频 / 音频将跳过压缩（图片压缩不受影响）');
  return false;
}

/* ---------------- 图片 ---------------- */

function clampQuality(percent: number): number {
  const p = Number.isFinite(percent) && percent > 0 ? percent : 80;
  return Math.min(100, Math.max(10, p));
}

async function compressImage(buffer: Buffer, ext: string, percent: number): Promise<CompressResult> {
  const keep = (reason: string): CompressResult => ({ buffer, mime: '', ext: '', compressed: false, reason });
  if (SKIP.has(ext)) return keep(`${ext} 格式不支持压缩`);
  if (!IMAGE_OK.has(ext)) return keep(`${ext} 不是可压缩的图片格式`);

  const sharp = (await import('sharp')).default;
  sharp.cache({ memory: 32 });
  sharp.concurrency(2);

  const quality = clampQuality(percent);
  const ratio = Math.max(0.1, quality / 100);
  const target = Math.max(1024, Math.round(buffer.length * ratio));

  // —— PNG：保透明重编码，压不下去就放弃 ——
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

  // —— jpg / webp / avif：转 webp，迭代压到目标体积 ——
  let q = quality;
  let out = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toBuffer();
  for (let i = 0; i < 4 && out.length > target && q > 20; i++) {
    q = Math.max(20, Math.round(q * Math.sqrt(target / out.length)));
    out = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toBuffer();
  }
  if (out.length >= buffer.length) return keep('压缩后体积未减小');
  return { buffer: out, mime: 'image/webp', ext: '.webp', compressed: true };
}

/* ---------------- 视频 / 音频 ---------------- */

async function withTempFiles<T>(exts: string[], fn: (paths: string[]) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'goimgbed-cmp-'));
  const paths = exts.map((e) => join(dir, `${randomBytes(6).toString('hex')}${e}`));
  try {
    return await fn(paths);
  } finally {
    // 自底向上删：目录删除在部分环境会被安全策略拦住，忽略失败即可（temp 目录由系统清理）
    for (const p of paths) await fsp.unlink(p).catch(() => undefined);
    await fsp.rmdir(dir).catch(() => undefined);
  }
}

/** 视频压缩：H.264 + AAC，CRF 由「压缩期望百分比」换算 */
async function compressVideo(buffer: Buffer, ext: string, percent: number): Promise<CompressResult> {
  const keep = (reason: string): CompressResult => ({ buffer, mime: '', ext: '', compressed: false, reason });
  if (!ffmpegAvailable()) return keep('未安装 ffmpeg，视频跳过压缩');
  if (!VIDEO_OK.has(ext)) return keep(`${ext} 不是可压缩的视频格式`);

  const p = clampQuality(percent);
  // percent 表示「压到原体积的 p%」：p 越小 CRF 越大（画质越低、体积越小）
  const crf = Math.min(40, Math.max(20, Math.round(38 - p * 0.14)));
  const outExt = ext === 'webm' ? '.webm' : '.mp4';

  try {
    return await withTempFiles([`.${ext}`, outExt], async ([src, dst]) => {
      await fsp.writeFile(src, buffer);
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
      const outBuf = await fsp.readFile(dst);
      if (!outBuf.length) return keep('ffmpeg 输出为空');
      if (outBuf.length >= buffer.length * 0.95) return keep('转码后体积未明显减小');
      return {
        buffer: outBuf,
        mime: outExt === '.webm' ? 'video/webm' : 'video/mp4',
        ext: outExt,
        compressed: true,
      };
    });
  } catch (err) {
    return keep(`ffmpeg 转码失败：${(err as Error).message}`);
  }
}

/** 音频压缩：mp3 保持 mp3，其它统一转 m4a(AAC) */
async function compressAudio(buffer: Buffer, ext: string, percent: number): Promise<CompressResult> {
  const keep = (reason: string): CompressResult => ({ buffer, mime: '', ext: '', compressed: false, reason });
  if (!ffmpegAvailable()) return keep('未安装 ffmpeg，音频跳过压缩');
  if (!AUDIO_OK.has(ext)) return keep(`${ext} 不是可压缩的音频格式`);

  const p = clampQuality(percent);
  const bitrate = Math.round(Math.min(320, Math.max(48, p * 2)));
  const outExt = ext === 'mp3' ? '.mp3' : '.m4a';

  try {
    return await withTempFiles([`.${ext}`, outExt], async ([src, dst]) => {
      await fsp.writeFile(src, buffer);
      const args = outExt === '.mp3'
        ? ['-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, dst]
        : ['-y', '-i', src, '-vn', '-c:a', 'aac', '-b:a', `${bitrate}k`, '-movflags', '+faststart', dst];
      await run(ffmpegPath, args, { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
      const outBuf = await fsp.readFile(dst);
      if (!outBuf.length) return keep('ffmpeg 输出为空');
      if (outBuf.length >= buffer.length * 0.95) return keep('转码后体积未明显减小');
      return {
        buffer: outBuf,
        mime: outExt === '.mp3' ? 'audio/mpeg' : 'audio/mp4',
        ext: outExt,
        compressed: true,
      };
    });
  } catch (err) {
    return keep(`ffmpeg 转码失败：${(err as Error).message}`);
  }
}

/* ---------------- 统一入口 ---------------- */

/**
 * 按 MIME / 扩展名分派到对应的压缩器。
 * 永远不抛异常 —— 失败一律返回原 buffer + reason，调用方无需 try/catch。
 */
export async function compressMedia(
  buffer: Buffer,
  mime: string,
  ext: string,
  percent: number,
): Promise<CompressResult> {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  try {
    if ((mime || '').startsWith('image/')) return await compressImage(buffer, e, percent);
    if ((mime || '').startsWith('video/')) return await compressVideo(buffer, e, percent);
    if ((mime || '').startsWith('audio/')) return await compressAudio(buffer, e, percent);
    return { buffer, mime: '', ext: '', compressed: false, reason: `${mime || e} 不支持压缩` };
  } catch (err) {
    return { buffer, mime: '', ext: '', compressed: false, reason: `压缩异常：${(err as Error).message}` };
  }
}

/** 读取图片/视频尺寸（图片走 sharp，视频走 ffprobe；拿不到返回空对象） */
export async function readDimensions(
  buffer: Buffer,
  mime: string,
  ext: string,
): Promise<{ width?: number; height?: number; duration?: number }> {
  try {
    if ((mime || '').startsWith('image/') && !SKIP.has(ext)) {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer, { limitInputPixels: 100_000_000 }).metadata();
      if (meta.width && meta.height) return { width: meta.width, height: meta.height };
    }
  } catch {
    /* 尺寸读不到不影响上传 */
  }
  return {};
}
