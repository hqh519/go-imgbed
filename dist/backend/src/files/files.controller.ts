import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FileRecord } from '@prisma/client';
import sharp from 'sharp'; // 图片尺寸处理（?width=&height=&fit= 缩放）
import { prisma } from '../common/prisma';
import { createAdapter, toCopyInfo } from '../adapters/adapter.factory';
import type { ChannelInfo } from '../adapters/adapter.interface';
import { localFileAbs } from '../adapters/local.adapter';
import { ChannelsService } from '../channels/channels.controller';
import { StorageChannelService, StorageChannelInfo } from '../storage/storage-channel.service';
import { UploadService } from '../upload/upload.service';
import { SettingsService } from '../settings/settings.service';
import { SysConfigService } from '../settings/sysconfig.service';
import { AdminGuard, ManageAuthGuard, SESSION_COOKIE, currentSession, isAdminRole, parseSession } from '../auth/auth.guard';
import { buildDirectoryTree, CHANNEL_LABEL, CopyWithChannel, fileExtOf, fileTypeOf, formatSize, normalizeDir, safeParse, serializeFile } from '../common/file-view';
import { appLog } from '../common/app-log';
import { frontendAppDir } from '../common/project-paths';

/** 逗号分隔参数 → 数组 */
function splitCsv(v?: string): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** 重命名请求体：新前端用 newFileId，旧调用方用 newName */
interface RenameBody {
  newFileId?: string;
  newName?: string;
}

/**
 * 读取通配路由（`xxx/*`）捕获到的完整路径。
 * File_ID 允许含目录层级（如 `风景/2026/abc`），普通 `:param` 不匹配斜杠，故统一用通配。
 * Express 已对捕获值做过一次 decode，这里仅在仍带转义时再解一次。
 */
function wildcardParam(req: Request): string {
  const raw = String((req.params as Record<string, string>)['0'] ?? '');
  if (!raw) return '';
  if (!/%[0-9a-fA-F]{2}/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 目录白名单匹配（参考原系统 isAllowedDirectory）：
 * 命中任一白名单目录即放行；白名单为空表示不限制。
 * 目录与白名单都按「去首尾斜杠、压缩重复斜杠」的规范形式比较。
 */
function dirAllowed(dir: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const norm = (s: string) => s.trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
  const target = norm(dir || '');
  return allowed.some((a) => {
    const base = norm(a);
    if (!base) return true; // 白名单里写了空项 → 视为根目录，等于不限制
    return target === base || target.startsWith(`${base}/`);
  });
}

/** 定位前端构建产物中的静态文件（与 main.ts 共用 project-paths，保证规则唯一） */
function frontendAsset(...segments: string[]): string | null {
  const base = frontendAppDir();
  if (!base) return null;
  const p = join(base, ...segments);
  if (existsSync(p)) return p;
  return null;
}

const DAY_MS = 86400000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 该日 UTC 零点毫秒（作为「纯日期」坐标使用） */
function parseDayMs(s?: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 毫秒 → 'YYYY-MM-DD'（按 UTC 读数，配合时区偏移做本地日归组） */
function isoDayMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 链接分发层 —— go-imgbed 外链签发的落点。
 *
 * GET /file/:name：
 *   1. 查文件记录 + 各渠道副本
 *   2. 按全局设置「当前访问渠道」(main|backup) 对副本排序
 *   3. 按渠道【当前配置】动态构造直链（key 不落库，改配置全站生效）
 *   4. 按 linkMode 分发：
 *        proxy    —— 服务端代理（默认）：转发 Range 与响应头，外链地址恒定
 *        redirect —— 302 临时重定向（禁用 301，避免被永久缓存）
 *   5. 所选渠道 404 / 5xx / 超时 → 自动降级到下一候选（另一渠道）
 *
 * 缓存策略：302 必须 no-cache；代理转发图片字节可长缓存 ——
 * 文件名是内容哈希，切渠道/改域名不影响同一 URL 的内容语义。
 */
/*
 * 说明：早期这里有一个独立的 globalMainChannel()（自己查 channel.findFirst({ isMain: true })），
 * 与 StorageChannelService 的兜底顺序各写一套，主渠道被禁用 / 存在多条 isMain 时会给出不同结果。
 * 现已删除，全站统一走 this.storageChannel.getStorageChannel(user, type)。
 */

@Controller()
export class LinkController {
  constructor(
    private settings: SettingsService,
    private channels: ChannelsService,
    private sysConfig: SysConfigService,
  ) {}

  /**
   * Referer 域名是否在允许清单内（参考原系统 isDomainAllowed）：
   *   - 无 Referer（直链访问、curl、第三方 <img>）→ 放行
   *   - 空清单 → 不启用域名限制
   *   - 自身域名始终视为允许（后台预览、同站引用）
   *
   * 清单格式：**一行一个域名**（兼容历史数据里的逗号 / 分号分隔）。
   * 匹配方式：**包含式** —— Referer 主机名里含清单条目即放行
   *   （填 `hhh555.top` 时 `www.hhh555.top`、`a.hhh555.top` 都放行；
   *     填 `555` 时 `hhh555.top` 也放行，便于一条覆盖多个子域 / 相似域）。
   */
  private domainAllowed(req: Request, allowedDomains?: string): boolean {
    const referer = req.headers.referer;
    if (!referer) return true;
    let host = '';
    try {
      host = new URL(String(referer)).hostname.toLowerCase();
    } catch {
      return false;
    }
    const domains = String(allowedDomains || '')
      .split(/[\n,;]+/)
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/[/:].*$/, ''))
      .filter(Boolean);
    // 空清单 = 不限制
    if (domains.length === 0) return true;
    const self = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (self) domains.push(self);
    // 包含式匹配 + 兼容完全相等（两者等价，保留 includes 即可）
    return domains.some((d) => host.includes(d));
  }

  /**
   * 被拦截时的响应（参考原系统 returnBlockImg / returnWhiteListImg）：
   *   优先返回静态占位图（403 + image/png，<img> 标签仍能渲染出提示图），
   *   找不到静态图时回退为 302 跳到 /blockimg 或 /whiteliston 页面。
   */
  private renderBlocked(res: Response, kind: 'block' | 'white') {
    const asset = kind === 'block' ? 'BlockImg.png' : 'WhiteListOn.png';
    const page = kind === 'block' ? '/blockimg' : '/whiteliston';
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const local = frontendAsset('static', 'media', asset);
    if (local) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', 'inline');
      res.status(403);
      return res.sendFile(local);
    }
    return res.redirect(302, page);
  }

  /**
   * 访问控制（黑白名单 / 白名单模式 / 域名白名单）—— 与原系统 returnWithCheck 对齐：
   *   ListType=White  → 始终放行（本轮不做域名校验）
   *   ListType=Block  → 返回屏蔽图
   *   Label=adult     → 返回屏蔽图
   *   whiteListMode   → 非 White 文件要求 Referer 域名在 allowedDomains 内，否则返回白名单提示图
   *   ?from=admin     → 管理端预览：持管理员会话，或「登录账户就是该文件的上传者」时放行；
   *                     通过后不受上述限制（否则普通用户在自己后台预览自己的图会被 401 挡掉）
   */
  private async checkAccess(
    req: Request,
    res: Response,
    record: { metas: string; uploader?: string },
  ): Promise<boolean> {
    const metas = safeParse(record.metas);
    const listType = (metas.ListType as string) || 'None';

    if (req.query.from === 'admin') {
      const session = parseSession(req.cookies?.[SESSION_COOKIE]);
      const mine = !!session?.user && session.user === (record.uploader || '');
      if (!isAdminRole(session?.role) && !mine) {
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.status(401).send('Admin authentication required');
        return false;
      }
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return true;
    }

    if (listType === 'Block' || metas.Label === 'adult') {
      this.renderBlocked(res, 'block');
      return false;
    }

    // 「链接权限」：用户管理里被关闭链接权限的账户，其文件外链一律不可访问
    // （后台预览带 from=admin，已在上面放行；这里只拦真正的对外访问）
    if (!(await this.linkAllowed(record.uploader))) {
      this.renderBlocked(res, 'block');
      return false;
    }

    if (listType === 'White') return true;

    const security = (await this.sysConfig.get('security')) as { access?: Record<string, unknown> } | undefined;
    const access = security?.access || {};
    if (access.whiteListMode && !this.domainAllowed(req, access.allowedDomains as string)) {
      this.renderBlocked(res, 'white');
      return false;
    }
    return true;
  }

  /**
   * 「链接权限」判定：该上传者账户是否允许对外访问其文件链接。
   *   - 管理员账户不在 users 表中 → 视为允许；
   *   - 匿名上传（uploader 为空）→ 允许（历史数据不受影响）；
   *   - 普通用户 → 读 users.linkEnabled。
   * 结果做 10 秒内存缓存，避免每张图片都查一次库（开关变更 10 秒内生效）。
   */
  private linkCache = new Map<string, { allowed: boolean; at: number }>();
  private async linkAllowed(uploader?: string): Promise<boolean> {
    const u = String(uploader || '').trim();
    if (!u) return true;
    const hit = this.linkCache.get(u);
    const now = Date.now();
    if (hit && now - hit.at < 10_000) return hit.allowed;
    let allowed = true;
    try {
      const row = await prisma.user.findUnique({ where: { username: u }, select: { linkEnabled: true } });
      // 查不到该账户（管理员 / 已删除账户）时放行，避免误伤
      if (row) allowed = row.linkEnabled !== false;
    } catch {
      allowed = true;
    }
    this.linkCache.set(u, { allowed, at: now });
    return allowed;
  }

  /** 把可能是相对路径的重定向目标补成绝对地址（用于服务端内部转发） */  private absolutize(req: Request, target: string): string {
    const t = String(target || '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    const origin = `${req.protocol}://${req.get('host')}`;
    return t.startsWith('/') ? `${origin}${t}` : `${origin}/${t}`;
  }

  /**
   * 本地存储渠道：直接读磁盘下发文件。
   *
   * 与 proxyStream 保持同样的对外行为：
   *   - 支持 Range（206），视频拖动进度条、音频 seek 都依赖它；
   *   - 带 Accept-Ranges 与长缓存（key 唯一，内容不会变）。
   * 差异：本地文件是「自己的磁盘」，不走 HTTP 拉取，所以没有任何超时/带宽中转损耗。
   */
  private sendLocalFile(req: Request, res: Response, abs: string, record: FileRecord) {
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      return res.status(404).send('Not Found');
    }
    const total = stat.size;
    const mime = record.mime || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    // 文件名由 key 决定且永不复用 → 可以长缓存
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const range = String(req.headers['range'] || '');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        let start = m[1] ? Number(m[1]) : NaN;
        let end = m[2] ? Number(m[2]) : NaN;
        if (Number.isNaN(start)) {
          // 后缀范围：bytes=-500 表示最后 500 字节
          if (Number.isNaN(end) || end <= 0) {
            res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
            return;
          }
          start = Math.max(0, total - end);
          end = total - 1;
        } else {
          if (Number.isNaN(end)) end = total - 1;
          end = Math.min(end, total - 1);
        }
        if (start > end || start >= total) {
          res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
          return;
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(end - start + 1));
        createReadStream(abs, { start, end }).on('error', () => res.end()).pipe(res);
        return;
      }
    }
    res.setHeader('Content-Length', String(total));
    createReadStream(abs).on('error', () => res.end()).pipe(res);
  }

  /** 代理模式：拉取上游并流式转发，支持 Range（206）与关键响应头透传 */
  private async proxyStream(
    req: Request,
    res: Response,
    candidates: { url: string; label: string }[],
    extraHeaders?: Record<string, string>,
  ) {
    const timeoutMs = Number(await this.settings.get('proxyTimeoutMs', '15000')) || 15000;
    const cacheSeconds = Number(await this.settings.get('proxyCacheSeconds', '86400')) || 86400;
    const range = req.headers['range'];
    let lastErr = '';

    for (const cand of candidates) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      // 客户端断开时同步中断上游请求
      const onClose = () => ctrl.abort();
      req.on('close', onClose);
      try {
        const headers: Record<string, string> = { 'User-Agent': 'go-imgbed-proxy', ...(extraHeaders || {}) };
        if (range) headers['Range'] = String(range);
        const upstream = await fetch(cand.url, { headers, signal: ctrl.signal, redirect: 'follow' });

        if (!upstream.ok && upstream.status !== 206) {
          lastErr = `${cand.label} → HTTP ${upstream.status}`;
          clearTimeout(timer);
          req.off('close', onClose);
          continue; // 404 / 5xx：降级到下一候选渠道
        }

        // 透传关键响应头（Range 场景必须带 Content-Range，否则视频拖动会崩）
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
          const v = upstream.headers.get(h);
          if (v) res.setHeader(h, v);
        }
        // 图片字节可长缓存；上游若自带 cache-control 则尊重它
        const upstreamCC = upstream.headers.get('cache-control');
        res.setHeader('Cache-Control', upstreamCC || `public, max-age=${cacheSeconds}, immutable`);
        res.setHeader('X-Imgbed-Source', encodeURIComponent(cand.label));
        res.status(upstream.status);

        if (!upstream.body) {
          clearTimeout(timer);
          req.off('close', onClose);
          return res.end();
        }
        const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
        nodeStream.on('error', () => { try { res.end(); } catch { /* ignore */ } });
        res.on('close', () => { try { nodeStream.destroy(); } catch { /* ignore */ } });
        nodeStream.pipe(res);
        return;
      } catch (err) {
        clearTimeout(timer);
        req.off('close', onClose);
        lastErr = `${cand.label} → ${(err as Error).message}`;
        continue;
      }
    }
    return res.status(502).send(`上游图床不可用：${lastErr}`);
  }

  /**
   * 解析外链请求上的图片尺寸参数（?width=&height=&fit=）。
   * 返回 {}  表示未携带参数或开关关闭（忽略，按原图返回）；
   * 返回 { error } 表示参数不合法（调用方回 400）；
   * 否则返回合法的 { width, height, fit }（均为可选）。
   * 参数约定：1-4096 的整数或 `auto`（auto = 由另一维度等比决定）；
   * fit 取值 cover / contain / fill / inside / outside（与 sharp resize 一致）。
   * 若配置了允许尺寸列表（imageTransformAllowedSizes，如 "320xauto,640xauto,1280x720"），
   * 则请求的组合必须在列表内，否则按不合法处理（防止被恶意拉大图刷流量）。
   */
  private async resolveImageTransform(
    req: Request,
  ): Promise<{ error?: string; width?: number | 'auto'; height?: number | 'auto'; fit?: string }> {
    const widthRaw = String(req.query.width ?? '').trim();
    const heightRaw = String(req.query.height ?? '').trim();
    const fitRaw = String(req.query.fit ?? '').trim().toLowerCase();
    if (!widthRaw && !heightRaw && !fitRaw) return {}; // 未携带尺寸参数

    const access = (await this.sysConfig.get('security'))?.access || {};
    if (access.imageTransformEnabled !== true) return {}; // 开关关闭：忽略参数

    // fit 校验
    let fit = '';
    if (fitRaw) {
      if (!['cover', 'contain', 'fill', 'inside', 'outside'].includes(fitRaw)) {
        return { error: 'fit 参数不合法（cover / contain / fill / inside / outside）' };
      }
      fit = fitRaw;
    }
    // width / height 校验（整数 1-4096 或 auto）
    const parseDim = (raw: string): number | 'auto' | undefined => {
      if (!raw) return undefined;
      if (/^auto$/i.test(raw)) return 'auto';
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 4096) return undefined;
      return n;
    };
    const width = parseDim(widthRaw);
    const height = parseDim(heightRaw);
    if (widthRaw && width === undefined) return { error: 'width 参数不合法（1-4096 的整数或 auto）' };
    if (heightRaw && height === undefined) return { error: 'height 参数不合法（1-4096 的整数或 auto）' };

    // 允许尺寸列表（白名单）：仅当请求组合命中列表才放行；列表为空表示不限制
    const allowed = String(access.imageTransformAllowedSizes || '').trim();
    if (allowed) {
      const list = allowed.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const key = `${width ?? 'auto'}x${height ?? 'auto'}`;
      if (!list.includes(key)) return { error: `该尺寸不在允许列表内（${list.join('、')}）` };
    }
    return { width, height, fit };
  }

  /**
   * 图片尺寸处理下发：拉取原图 → sharp 缩放 → 按实际输出格式下发。
   * 多候选渠道逐个尝试，单个失败（网络/解码）自动降级下一个，全部失败回 502。
   * 注意：动态缩放结果随参数变化，缓存时间给短（1 小时），避免 CDN 缓存键冲突。
   */
  private async serveTransformedImage(
    res: Response,
    candidates: { url: string; label: string }[],
    t: { width?: number | 'auto'; height?: number | 'auto'; fit?: string },
  ) {
    const timeoutMs = Number(await this.settings.get('proxyTimeoutMs', '15000')) || 15000;
    let lastErr = '';
    for (const cand of candidates) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const upstream = await fetch(cand.url, {
          headers: { 'User-Agent': 'go-imgbed-proxy' },
          signal: ctrl.signal,
          redirect: 'follow',
        });
        if (!upstream.ok) {
          lastErr = `${cand.label} → HTTP ${upstream.status}`;
          continue;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        // 组装 sharp resize 选项：width/height 为 auto（或不传）时不设置该维度，由另一维度等比决定
        const option: sharp.ResizeOptions = { fit: (t.fit as sharp.ResizeOptions['fit']) || 'cover' };
        if (typeof t.width === 'number') option.width = t.width;
        if (typeof t.height === 'number') option.height = t.height;
        const out = await sharp(buf).resize(option).toBuffer({ resolveWithObject: true });
        const types: Record<string, string> = {
          jpeg: 'image/jpeg',
          png: 'image/png',
          webp: 'image/webp',
          avif: 'image/avif',
        };
        res.setHeader('Content-Type', types[out.info.format] || 'application/octet-stream');
        res.setHeader('Content-Length', String(out.data.length));
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-Imgbed-Transformed', '1');
        return res.end(out.data);
      } catch (err) {
        lastErr = `${cand.label} → ${(err as Error).message}`;
      } finally {
        clearTimeout(timer);
      }
    }
    return res.status(502).send(`图片处理失败：${lastErr}`);
  }

  /**
   * 外链分发入口。
   * 用 `file/*` 而非 `file/:name`：File_ID 允许包含目录层级（如 `风景/2026/abc`），
   * `:name` 不匹配斜杠，会导致这类外链 404。
   */
  @Get('file/*')
  async serve(@Req() req: Request, @Res() res: Response) {
    const name = wildcardParam(req);
    // 兼容前端契约：src 可能带扩展名（/file/abc123.jpg）
    // 后端一律按「去掉最后一段扩展名」查库，因此带不带扩展名都能访问，
    // 扩展名只起「直观展示文件类型」的作用，不影响代理 / 302 / 访问源切换。
    //
    // 额外兼容 S3 / WebDAV 客户端「自拼链接」的场景：
    //   客户端常把 bucket / 渠道 ID 也拼进路径（如 /file/805232/web/ab.png），
    //   这里对路径逐段剥离前缀再查库，保证「客户端拼出来的地址」同样可访问。
    const nameCandidates: string[] = [];
    const pushName = (v: string) => {
      const s = String(v || '').replace(/^\/+/, '');
      if (!s) return;
      if (!nameCandidates.includes(s)) nameCandidates.push(s);
      const b = s.replace(/\.[^.]*$/, '');
      if (b && b !== s && !nameCandidates.includes(b)) nameCandidates.push(b);
    };
    pushName(name);
    let rest = name;
    while (rest.includes('/')) {
      rest = rest.slice(rest.indexOf('/') + 1);
      pushName(rest);
    }
    /**
     * 回收站里的文件对外一律 404（恢复后自动恢复访问）；
     * 但 `?from=admin` 是管理端预览（下面 checkAccess 会校验管理员会话或上传者本人），
     * 回收站列表要能显示缩略图，所以这条通道放行 deleted 记录 —— 否则进回收站后
     * 卡片/列表全是「加载失败」。
     */
    const adminPreview = req.query.from === 'admin';
    const record = await prisma.fileRecord.findFirst({
      where: { ...(adminPreview ? {} : { status: 'active' }), OR: nameCandidates.map((n) => ({ name: n })) },
      include: { copies: true },
    });
    if (!record) return res.status(404).send('Not Found');

    /*
     * 限时访问（v2.1.0）：设置了截止时间且已过期 → 410 Gone。
     *   · 管理端预览（?from=admin）不受限，否则回收站 / 详情缩略图会失效；
     *   · 用 no-store 避免 CDN / 浏览器缓存住 410 或过期前的 200。
     */
    if (record.linkExpiresAt && !adminPreview && !isAdminRole(currentSession(req)?.role) && Date.now() > record.linkExpiresAt.getTime()) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(410).send('链接已过期');
    }

    // 访问控制：黑白名单 / 白名单模式 / 域名白名单（放行返回 true）
    if (!(await this.checkAccess(req, res, record))) return;

    /**
     * 访问计数（「访问次数」功能）：
     *   - 只在真实下发文件（未命中黑白名单拦截、未 404）时计数
     *   - 管理端预览（?from=admin）不计入，否则后台列表一刷新就把计数刷爆
     *   - 异步写库且不 await，避免拖慢外链响应
     */
    if (req.query.from !== 'admin') {
      void prisma.fileRecord
        .update({ where: { id: record.id }, data: { views: { increment: 1 } } })
        .catch(() => undefined);
    }

    /**
     * 重定向：**在服务端内部完成转发**，浏览器地址栏始终是原来的外链。
     *   访问 /file/A（A 已设置重定向到 B）→ 内容取自 B，但 URL 仍是 /file/A。
     * 实现要点：
     *   1) 目标可能是相对路径（/file/xxx），先补成绝对地址；
     *   2) 用 X-Imgbed-Redirect-Depth 传递跳数，最多 3 跳，避免 A→B→A 死循环；
     *   3) 目标就是自己时直接 404，避免自引用把请求打爆。
     */
    if (record.redirectUrl) {
      const target = String(record.redirectUrl).trim();
      const abs = this.absolutize(req, target);
      // 自引用保护：目标解析回本文件本身
      const selfKey = decodeURIComponent(abs.split('?')[0].replace(/^.*\/file\//, '').replace(/\.[^.]*$/, ''));
      if (selfKey && (selfKey === record.name || selfKey === record.id)) {
        return res.status(404).send('Not Found');
      }
      const depth = Number(req.headers['x-imgbed-redirect-depth'] || 0) || 0;
      if (depth >= 3) return res.status(508).send('重定向链路过长');
      res.setHeader('Cache-Control', 'no-cache, max-age=0');
      return this.proxyStream(req, res, [{ url: abs, label: 'redirect' }], {
        'X-Imgbed-Redirect-Depth': String(depth + 1),
      });
    }

    const prefer = await this.settings.getAccessChannel();
    let active = record.copies.filter((c) => c.status === 'active' && (c.remoteKey || c.remoteUrl));
    if (active.length === 0) return res.status(404).send('Not Found');

    // ?channel=<渠道ID>：强制走指定渠道的直链（文件详情里点「存储渠道 / 备份渠道」用）
    const forceChannel = String(req.query.channel || '').trim();
    if (forceChannel) {
      active = active.filter((c) => c.channelId === forceChannel);
      if (active.length === 0) return res.status(404).send('Not Found');
    }

    // 按「当前访问渠道」排序候选：首选渠道在前，另一渠道作为降级候选
    const channelIds = active.map((c) => c.channelId);
    const channels = await prisma.channel.findMany({ where: { id: { in: channelIds } } });
    const preferList = prefer === 'backup' ? ['backup', 'main'] : ['main', 'backup'];
    const enabledIds = new Set(channels.filter((c) => c.enabled).map((c) => c.id));
    const ordered: typeof active = [];
    const byRole = (role: string, enabledOnly = false) => {
      const ids = channels.filter((c) => (role === 'backup' ? c.isBackup : c.isMain)).map((c) => c.id);
      for (const c of active) {
        if (ordered.includes(c)) continue;
        if (!ids.includes(c.channelId)) continue;
        if (enabledOnly && !enabledIds.has(c.channelId)) continue;
        ordered.push(c);
      }
    };
    // 一级：启用中的渠道按访问源优先级
    for (const role of preferList) byRole(role, true);
    // 二级：未打主/备标记的存量副本（启用中）
    for (const c of active) {
      if (!ordered.includes(c) && enabledIds.has(c.channelId)) ordered.push(c);
    }
    // 三级：兜底 —— 已禁用的渠道（全部不可用时至少尝试一次）
    for (const role of preferList) byRole(role);
    for (const c of active) if (!ordered.includes(c)) ordered.push(c);

    const candidates: { url: string; label: string }[] = [];
    /**
     * 本地存储渠道没有「渠道直链」，必须由服务端直接读盘下发。
     * 只有在它之前没有任何可用的 URL 候选时才走本地 —— 保持「主渠道优先」的既有语义：
     *   主渠道是 COS → 走 COS；主渠道是本地存储 → 直接读盘。
     */
    for (const copy of ordered) {
      const ch = channels.find((c) => c.id === copy.channelId);
      if (!ch) continue;
      if (ch.type === 'local') {
        if (candidates.length > 0) continue;
        const abs = localFileAbs(copy.remoteKey);
        if (!abs) continue;
        return this.sendLocalFile(req, res, abs, record);
      }
      const info = {
        id: ch.id,
        name: ch.name,
        type: ch.type,
        config: this.channels.decryptConfig(ch.type, ch.config),
        metas: {},
      };
      const url = createAdapter(info).buildDirectUrl(toCopyInfo(copy), info);
      if (url) candidates.push({ url, label: ch.name });
    }
    if (candidates.length === 0) return res.status(404).send('Not Found');

    const mode = await this.settings.getLinkMode();
    if (mode === 'redirect') {
      // 302（临时）+ no-cache：后台一键切换渠道、改配置域名，下一次访问立即生效。
      // 302 模式由源站直接下发原文件，图片尺寸参数不参与（忽略）。
      res.setHeader('Cache-Control', 'no-cache, max-age=0');
      return res.redirect(302, candidates[0].url);
    }
    // 图片尺寸处理（?width=&height=&fit=）：仅代理模式生效，且只对可缩放的位图类型生效
    // （gif 含多帧动画、svg 为矢量，sharp 处理会丢帧/转码，均跳过按原图返回）
    const t = await this.resolveImageTransform(req);
    if (t.error) return res.status(400).send(t.error);
    const imgExt = fileExtOf(record.name).toLowerCase().replace(/^\./, '');
    const scalable = ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(imgExt);
    if ((t.width || t.height) && scalable) {
      return this.serveTransformedImage(res, candidates, t);
    }
    return this.proxyStream(req, res, candidates);
  }
}

/**
 * 管理接口 —— 兼容前端 /api/manage/* 契约的核心子集。
 *
 * 权限模型（用户账户体系）：
 *   - 类级用 ManageAuthGuard：管理员与普通用户都可进入；
 *   - 普通用户只能看到/操作 `uploader === 自身用户名` 的文件与文件夹；
 *   - 系统级接口（统计/日志/设置/黑白名单/渠道/用户）用方法级 @UseGuards(AdminGuard) 兜住。
 */
@Controller('api/manage')
@UseGuards(ManageAuthGuard)
export class ManageController {
  constructor(
    private settings: SettingsService,
    private sysConfig: SysConfigService,
    private channelsSvc: ChannelsService,
    private uploadSvc: UploadService,
    private storageChannel: StorageChannelService,
  ) {}

  /** 当前会话是否管理员 */
  private admin(req: Request): boolean {
    return isAdminRole(currentSession(req)?.role);
  }

  /** 把入参 fileIds 收敛为「当前用户有权操作」的子集（管理员不限制） */
  private async filterOwned(fileIds: string[], req: Request): Promise<string[]> {
    if (this.admin(req)) return fileIds;
    const user = currentSession(req)?.user || '';
    const rows = await prisma.fileRecord.findMany({
      where: { uploader: user, OR: [{ id: { in: fileIds } }, { name: { in: fileIds } }] },
      select: { id: true, name: true },
    });
    const ok = new Set<string>();
    for (const r of rows) {
      ok.add(r.id);
      ok.add(r.name);
    }
    return fileIds.filter((f) => ok.has(f));
  }

  /** 普通用户是否有权编辑 / 删除文件（管理员恒为 true） */
  private async userPerm(req: Request, kind: 'edit' | 'delete'): Promise<boolean> {
    if (this.admin(req)) return true;
    const s = currentSession(req);
    if (!s) return false;
    const u = await prisma.user.findUnique({ where: { username: s.user } });
    if (!u || !u.enabled) return false;
    return kind === 'edit' ? u.canEdit : u.canDelete;
  }

  /**
   * 文件列表 —— 严格对齐 Sanyue-ImgHub 契约：
   *   入参：dir / search / recursive / start / count / sum / includeTags / excludeTags
   *         以及筛选 listType / fileType / channel / channelName / label / accessStatus
   *   出参：{ files:[{name,metadata}], directories, totalCount, directFileCount,
   *          directFolderCount, returnedCount, indexLastUpdated, isIndexedResponse }
   */
  @Get('list')
  async list(@Req() req: Request, @Query() q: Record<string, string>) {
    // 「系统状态」页以 action=info 复用本路由，返回索引统计而非文件列表（仅管理员）
    if (q.action === 'info') {
      if (!this.admin(req)) return { forbidden: true, totalFiles: 0, channelStats: {}, typeStats: {}, uploadTrend: { labels: [], total: [] } };
      return this.indexInfo(q);
    }

    const session = currentSession(req);
    // 归属过滤：普通用户只能看到自身账户的文件；管理员可用 ?user= 切换（空 / all = 全部用户）
    const ownerFilter = this.admin(req) ? (q.user && q.user !== 'all' ? q.user : '') : session?.user || '';
    const recursive = q.recursive === 'true';
    const dir = normalizeDir(q.dir);
    const search = (q.search || '').trim().toLowerCase();
    // 搜索类型：all(默认) | title 标题 | tag 标签 | category 分类 | user 用户 | other 其他
    const searchType = (q.searchType || 'all').toLowerCase();
    let count = q.count === undefined ? 50 : Number(q.count);
    if (Number.isNaN(count)) count = 50;
    const start = Math.max(0, Number(q.start || 0) || 0);
    const sumOnly = count === -1 && q.sum === 'true';

    const includeTags = splitCsv(q.includeTags);
    const excludeTags = splitCsv(q.excludeTags);
    // 「标签筛选」弹窗选中的标签：tagMode=or 命中任一即算，and（默认）必须全部命中
    // 与搜索里的 #tag（includeTags，恒为 and 语义）分开传参，避免同名参数互相覆盖。
    const filterTags = splitCsv(q.filterTags);
    const tagMode = String(q.tagMode || 'and').toLowerCase() === 'or' ? 'or' : 'and';
    // 是否含标签：yes = 只看有标签的文件，no = 只看没有标签的文件
    const hasTags = String(q.hasTags || '').toLowerCase();
    const fListType = splitCsv(q.listType);
    const fAccess = splitCsv(q.accessStatus);
    const fLabel = splitCsv(q.label);
    const fFileType = splitCsv(q.fileType);
    const fChannel = splitCsv(q.channel);
    const fChannelName = splitCsv(q.channelName);
    const fBackup = splitCsv(q.backup);
    const fRedirect = splitCsv(q.redirect);

    const rows = await prisma.fileRecord.findMany({
      where: { status: 'active', ...(ownerFilter ? { uploader: ownerFilter } : {}) },
      include: {
        copies: { include: { channel: true } },
        tags: { include: { tag: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const allFolders = new Set(rows.map((r) => r.folder).filter(Boolean) as string[]);
    // 合并「已新建但暂无文件」的空目录（文件管理左上角「新建目录」登记的逻辑目录）
    for (const d of await this.extraFolders(req)) allFolders.add(d);

    const matched = rows.filter((r) => {
      if (search) {
        const tagNames = r.tags.map((t) => t.tag.name).join(',').toLowerCase();
        const mime = (r.mime || '').toLowerCase();
        const dirName = (r.folder || '').toLowerCase();
        const hit =
          searchType === 'title'
            ? r.originalName.toLowerCase().includes(search) || r.name.toLowerCase().includes(search)
            : searchType === 'tag'
              ? tagNames.includes(search)
              : searchType === 'category'
                ? dirName.includes(search)
                : searchType === 'user'
                  ? (r.uploader || '').toLowerCase().includes(search)
                  : searchType === 'other'
                    ? (r.md5 || '').toLowerCase().includes(search) ||
                      mime.includes(search) ||
                      (r.ip || '').includes(search)
                    : // all：文件名 / 文件ID / 链接 / 分类 / 标签 / md5 / 类型 / 用户
                      r.originalName.toLowerCase().includes(search) ||
                      r.name.toLowerCase().includes(search) ||
                      (r.md5 || '').toLowerCase().includes(search) ||
                      dirName.includes(search) ||
                      tagNames.includes(search) ||
                      mime.includes(search) ||
                      (r.uploader || '').toLowerCase().includes(search);
        if (!hit) return false;
      }
      const tagNames = r.tags.map((t) => t.tag.name);
      if (hasTags === 'yes' && tagNames.length === 0) return false;
      if (hasTags === 'no' && tagNames.length > 0) return false;
      // 搜索 #tag：必须全部命中
      if (includeTags.length && !includeTags.every((t) => tagNames.includes(t))) return false;
      // 标签筛选弹窗：按「或 / 且」判定
      if (filterTags.length) {
        const hit =
          tagMode === 'or'
            ? filterTags.some((t) => tagNames.includes(t))
            : filterTags.every((t) => tagNames.includes(t));
        if (!hit) return false;
      }
      if (excludeTags.length && excludeTags.some((t) => tagNames.includes(t))) return false;

      // 重定向筛选：redirect=yes 只看设置了重定向地址的文件
      if (fRedirect.length) {
        const has = !!r.redirectUrl;
        const ok = (fRedirect.includes('yes') && has) || (fRedirect.includes('no') && !has);
        if (!ok) return false;
      }

      const metas = safeParse(r.metas);
      const listType = (metas.ListType as string) || 'None';
      if (fListType.length && !fListType.includes(listType)) return false;
      if (fLabel.length && !fLabel.includes((metas.Label as string) || 'None')) return false;
      if (fFileType.length && !fFileType.includes(fileTypeOf(r.mime))) return false;

      const primary = r.copies.find((c) => c.channel?.isMain) || r.copies[0];
      const chLabel = primary?.channel
        ? CHANNEL_LABEL[primary.channel.type] || primary.channel.type
        : '';
      if (fChannel.length && !fChannel.includes(chLabel)) return false;
      if (fChannelName.length && !fChannelName.includes(primary?.channel?.name || '')) return false;

      // 备份状态筛选：已备份 = 除主副本外还有其它 active 副本
      if (fBackup.length) {
        const hasBackup = r.copies.some((c) => c !== primary && c.status === 'active' && (c.remoteKey || c.remoteUrl));
        const ok =
          (fBackup.includes('backedup') && hasBackup) ||
          (fBackup.includes('unbackedup') && !hasBackup);
        if (!ok) return false;
      }

      if (fAccess.length) {
        const ok =
          (fAccess.includes('normal') && listType === 'None') ||
          (fAccess.includes('block') && listType === 'Block') ||
          (fAccess.includes('white') && listType === 'White');
        if (!ok) return false;
      }
      return true;
    });

    // 目录归属：非递归时只保留当前目录的直接文件，并列出其直接子目录
    const dirBare = dir.replace(/\/+$/, '');
    let files;
    let directories: string[] = [];
    if (recursive) {
      files = matched.filter((r) => (!dirBare ? true : r.folder === dirBare || r.folder.startsWith(`${dirBare}/`)));
    } else {
      files = matched.filter((r) => (r.folder || '') === dirBare);
      const set = new Set<string>();
      for (const f of allFolders) {
        const full = `${f}/`;
        if (!full.startsWith(dir)) continue;
        const rest = full.slice(dir.length);
        const idx = rest.indexOf('/');
        if (idx !== -1) set.add(dir + rest.slice(0, idx));
      }
      directories = Array.from(set).sort();
    }

    const totalCount = files.length;
    if (sumOnly) return { sum: totalCount, indexLastUpdated: Date.now() };

    const paged = count === -1 ? files.slice(start) : files.slice(start, start + count);
    // 渠道真实直链解析器（本页所有文件共用一份渠道配置缓存）
    const resolveDirectUrl = this.directUrlResolver();
    return {
      files: paged.map((r) => serializeFile(r, r.copies, { tags: r.tags.map((t) => t.tag.name), resolveDirectUrl })),
      directories,
      totalCount,
      directFileCount: files.length,
      directFolderCount: directories.length,
      returnedCount: paged.length,
      indexLastUpdated: Date.now(),
      isIndexedResponse: true,
    };
  }

  /**
   * 索引统计 —— 供「系统状态」页使用（GET /api/manage/list?action=info）。
   *
   * go-imgbed 底层是 SQLite，列表查询本就是实时的，没有独立倒排索引；
   * 这里按前端契约实时聚合出统计口径，保证状态页/图表可用且始终与库内一致。
   *
   * 入参：timezoneOffset(分钟，同 JS getTimezoneOffset) / trendMaxPoints /
   *       trendSeriesLimit / trendStartDate / trendEndDate
   * 出参：{ totalFiles, lastUpdated, channelStats, typeStats,
   *        newestFile, oldestFile, uploadTrend:{ labels, total, groupBy } }
   */
  private async indexInfo(q: Record<string, string>) {
    const rows = await prisma.fileRecord.findMany({
      where: { status: 'active' },
      include: { copies: { include: { channel: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const primaryOf = (r: (typeof rows)[number]) =>
      r.copies.find((c) => c.channel?.isMain) || r.copies[0];

    const totalFiles = rows.length;
    const lastUpdated = totalFiles ? rows[totalFiles - 1].createdAt.getTime() : Date.now();

    // ---------- 汇总统计（今日/昨日/本周/本月/本年上传、累计占用、文件夹数） ----------
    const offMinStat = Number(q.timezoneOffset || 0) || 0;
    const localMs = (d: Date) => d.getTime() - offMinStat * 60000;
    const dayStartMs = (ms: number) => {
      const d = new Date(ms);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    };
    const nowLocal = localMs(new Date());
    const todayStart = dayStartMs(nowLocal);
    const yesterdayStart = todayStart - DAY_MS;
    // 本周以周一为一周起点
    const dow = new Date(todayStart).getUTCDay(); // 0=周日
    const weekStart = todayStart - ((dow + 6) % 7) * DAY_MS;
    const monthStart = Date.UTC(new Date(nowLocal).getUTCFullYear(), new Date(nowLocal).getUTCMonth(), 1);
    const yearStart = Date.UTC(new Date(nowLocal).getUTCFullYear(), 0, 1);
    let todayCount = 0;
    let yesterdayCount = 0;
    let weekCount = 0;
    let monthCount = 0;
    let yearCount = 0;
    let totalSize = 0;
    let totalViews = 0;
    const folderSet = new Set<string>();
    for (const r of rows) {
      const t = localMs(r.createdAt);
      totalSize += r.size || 0;
      totalViews += r.views || 0;
      if (r.folder) folderSet.add(r.folder.replace(/\/+$/, ''));
      if (t >= todayStart) todayCount += 1;
      if (t >= yesterdayStart && t < todayStart) yesterdayCount += 1;
      if (t >= weekStart) weekCount += 1;
      if (t >= monthStart) monthCount += 1;
      if (t >= yearStart) yearCount += 1;
    }

    // 最近上传（默认 20 条，按时间倒序，供「系统状态」列表展示）
    const recentLimit = Math.min(100, Math.max(1, Number(q.recentLimit || 20) || 20));
    const recentFiles = [...rows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, recentLimit)
      .map((r) => ({
        id: r.name,
        name: r.name,
        metadata: {
          FileName: r.originalName,
          FileType: fileTypeOf(r.mime),
          FileExt: fileExtOf(r.originalName, r.mime),
          FileSize: formatSize(r.size),
          FileSizeBytes: r.size,
          TimeStamp: r.createdAt.getTime(),
          Views: (r as unknown as { views?: number }).views || 0,
          // 上传用户（系统状态「最近上传」的用户列）
          User: r.uploader || '',
          // 分类（逻辑目录）—— 系统状态「最近上传」的分类列
          Directory: r.folder ? `${r.folder.replace(/\/+$/, '')}/` : '',
        },
      }));

    // 渠道分布 + 用户分布 + 状态分布（ListType）
    const channelStats: Record<string, number> = {};
    const userStats: Record<string, number> = {};
    const typeStats: Record<string, number> = {};
    for (const r of rows) {
      const p = primaryOf(r);
      const chLabel = p?.channel
        ? p.channel.name || CHANNEL_LABEL[p.channel.type] || p.channel.type
        : 'Unknown';
      channelStats[chLabel] = (channelStats[chLabel] || 0) + 1;

      const userLabel = r.uploader || '(匿名)';
      userStats[userLabel] = (userStats[userLabel] || 0) + 1;

      const metas = safeParse(r.metas);
      const listType = (metas.ListType as string) || 'None';
      typeStats[listType] = (typeStats[listType] || 0) + 1;
    }

    const brief = (r?: (typeof rows)[number]) =>
      r
        ? {
            id: r.name,
            name: r.name,
            metadata: {
              FileName: r.originalName,
              FileType: fileTypeOf(r.mime),
              FileSizeBytes: r.size,
              TimeStamp: r.createdAt.getTime(),
            },
          }
        : null;

    // ---------- 上传趋势 ----------
    // 前端 getTimezoneOffset()：本地 = UTC - offset，故先平移再取 UTC 日历日
    const offMin = Number(q.timezoneOffset || 0) || 0;
    const maxPoints = Math.min(365, Math.max(2, Number(q.trendMaxPoints || 90) || 90));
    const seriesLimit = Math.max(1, Number(q.trendSeriesLimit || 8) || 8);

    const nowMs = Date.now();
    let endMs = parseDayMs(q.trendEndDate);
    if (!Number.isFinite(endMs)) endMs = parseDayMs(isoDayMs(nowMs - offMin * 60000))!;
    let startMs = parseDayMs(q.trendStartDate);
    if (!Number.isFinite(startMs)) startMs = endMs - 6 * DAY_MS;
    if (endMs < startMs) [startMs, endMs] = [endMs, startMs];
    // 超出上限时保留最近的一段
    if (Math.floor((endMs - startMs) / DAY_MS) + 1 > maxPoints) {
      startMs = endMs - (maxPoints - 1) * DAY_MS;
    }

    const labels: string[] = [];
    for (let t = startMs; t <= endMs; t += DAY_MS) labels.push(isoDayMs(t));
    const labelIndex = new Map(labels.map((l, i) => [l, i]));

    const total = new Array(labels.length).fill(0);
    const byType: Record<string, number[]> = {};
    const byName: Record<string, number[]> = {};
    const byUser: Record<string, number[]> = {};

    for (const r of rows) {
      const key = isoDayMs(r.createdAt.getTime() - offMin * 60000);
      const i = labelIndex.get(key);
      if (i === undefined) continue;
      total[i] += 1;

      const p = primaryOf(r);
      const typeLabel = p?.channel ? CHANNEL_LABEL[p.channel.type] || p.channel.type : 'Unknown';
      const nameLabel = p?.channel?.name || typeLabel;
      const userLabel = r.uploader || '(匿名)';
      if (!byType[typeLabel]) byType[typeLabel] = new Array(labels.length).fill(0);
      if (!byName[nameLabel]) byName[nameLabel] = new Array(labels.length).fill(0);
      if (!byUser[userLabel]) byUser[userLabel] = new Array(labels.length).fill(0);
      byType[typeLabel][i] += 1;
      byName[nameLabel][i] += 1;
      byUser[userLabel][i] += 1;
    }

    /** 取前 N 条，其余合并为「其他」 */
    const buildSeries = (map: Record<string, number[]>) => {
      const arr = Object.entries(map)
        .map(([name, data]) => ({ name, data, sum: data.reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name));
      const head = arr.slice(0, seriesLimit).map(({ name, data }) => ({ name, data }));
      const tail = arr.slice(seriesLimit);
      if (tail.length) {
        const other = new Array(labels.length).fill(0);
        for (const s of tail) s.data.forEach((v, i) => (other[i] += v));
        head.push({ name: '__other__', isOther: true, data: other } as never);
      }
      return head;
    };

    return {
      totalFiles,
      lastUpdated,
      channelStats,
      userStats,
      typeStats,
      newestFile: brief(rows[totalFiles - 1]),
      oldestFile: brief(rows[0]),
      recentFiles,
      stats: {
        today: todayCount,
        yesterday: yesterdayCount,
        week: weekCount,
        month: monthCount,
        year: yearCount,
        totalSize,
        totalViews,
        folderCount: folderSet.size,
      },
      uploadTrend: {
        labels,
        total,
        groupBy: {
          channel: { series: buildSeries(byType) },
          channelName: { series: buildSeries(byName) },
          user: { series: buildSeries(byUser) },
        },
        range: { startDate: isoDayMs(startMs), endDate: isoDayMs(endMs) },
      },
      indexLastUpdated: Date.now(),
      isIndexedResponse: true,
    };
  }

  /**
   * 删除（文件 / 目录）→ **软删除：移入回收站**。
   * 前端约定用 GET + `?folder=true|false`（历史契约），这里 GET 与 DELETE 双注册。
   * 目录删除 = 目录下所有文件一起进回收站（不动远端副本，可整体恢复）。
   * 彻底删除（连远端副本一起清理）只在回收站里做：见 trash/purge 路由。
   * 路由用通配符，兼容 File_ID 中含目录层级（如 `风景/2026/abc`）的情况。
   */
  @Get('delete/*')
  deleteByGet(@Req() req: Request, @Query() q: { folder?: string }) {
    return this.remove(req, q);
  }

  @Delete('delete/*')
  deleteByDelete(@Req() req: Request, @Query() q: { folder?: string }) {
    return this.remove(req, q);
  }

  private async remove(req: Request, q: { folder?: string }) {
    if (!(await this.userPerm(req, 'delete'))) return { success: false, message: '没有删除权限' };
    const key = wildcardParam(req);
    if (!key) return { success: false, message: '缺少文件名' };
    // 普通用户只能删自己的文件
    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    const own = owner ? { uploader: owner } : {};

    // 目录删除：按 folder 前缀批量删（软删除，可整体恢复；已在回收站的不重复处理）
    if (q.folder === 'true') {
      const prefix = key.replace(/\/+$/, '');
      const rows = await prisma.fileRecord.findMany({
        where: { status: 'active', ...own, OR: [{ folder: prefix }, { folder: { startsWith: `${prefix}/` } }] },
      });
      for (const r of rows) await this.trashRecord(r.id, r.name);
      return { success: true, deleted: rows.length };
    }

    const record = await prisma.fileRecord.findFirst({
      where: { status: 'active', ...own, OR: [{ name: key }, { name: key.replace(/\.[^.]*$/, '') }] },
    });
    if (!record) return { success: false, message: '文件不存在' };
    await this.trashRecord(record.id, record.name);
    return { success: true, deleted: 1 };
  }

  /** 移入回收站（软删除，不动远端副本） */
  private async trashRecord(id: string, name: string) {
    await this.uploadSvc.softDeleteFile(id, name);
  }

  // ==================== 回收站 ====================

  /**
   * 回收站列表：status='deleted' 的文件，按删除时间倒序。
   * 普通用户只能看到自己移入的文件；附带渠道概要（恢复/彻底删除时前端可直接展示影响面）。
   */
  @Get('trash')
  async trashList(@Req() req: Request) {
    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    const rows = await prisma.fileRecord.findMany({
      where: { status: 'deleted', ...(owner ? { uploader: owner } : {}) },
      include: { copies: { select: { channelId: true, isPrimary: true, status: true } } },
      orderBy: { deletedAt: 'desc' },
      take: 500,
    });
    const channelIds = Array.from(new Set(rows.flatMap((r) => r.copies.map((c) => c.channelId))));
    const channels = await prisma.channel.findMany({
      where: { id: { in: channelIds } },
      select: { id: true, name: true, type: true },
    });
    const chMap = new Map(channels.map((c) => [c.id, c]));
    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      originalName: r.originalName,
      size: r.size,
      mime: r.mime,
      folder: r.folder,
      uploader: r.uploader,
      uploadSource: r.uploadSource,
      status: r.status,
      deletedAt: r.deletedAt,
      channels: r.copies.map((c) => ({
        name: chMap.get(c.channelId)?.name || '(已删除渠道)',
        type: chMap.get(c.channelId)?.type || '',
        isPrimary: c.isPrimary,
        status: c.status,
      })),
    }));
    return { success: true, items, total: items.length };
  }

  /** 从回收站恢复单个文件（撤销软删除标记） */
  @Get('trash/restore/*')
  async trashRestore(@Req() req: Request) {
    if (!(await this.userPerm(req, 'delete'))) return { success: false, message: '没有恢复权限' };
    const key = wildcardParam(req);
    const record = await prisma.fileRecord.findFirst({ where: { id: key, status: 'deleted' } });
    if (!record) return { success: false, message: '回收站中不存在该文件' };
    await this.uploadSvc.restoreFile(record.id, record.name);
    return { success: true };
  }

  /** 彻底删除单个文件（远端副本一并清理，不可恢复） */
  @Get('trash/purge/*')
  async trashPurge(@Req() req: Request) {
    return this.trashPurgeOne(req);
  }

  @Delete('trash/purge/*')
  async trashPurgeDelete(@Req() req: Request) {
    return this.trashPurgeOne(req);
  }

  private async trashPurgeOne(req: Request) {
    if (!(await this.userPerm(req, 'delete'))) return { success: false, message: '没有删除权限' };
    const key = wildcardParam(req);
    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    const record = await prisma.fileRecord.findFirst({
      where: { id: key, status: 'deleted', ...(owner ? { uploader: owner } : {}) },
    });
    if (!record) return { success: false, message: '回收站中不存在该文件' };
    await this.uploadSvc.removeFile(record.id, record.name);
    return { success: true };
  }

  /**
   * 回收站批量操作：{ ids: string[], action: 'restore' | 'purge' }。
   * 逐条处理并返回逐项结果 —— 单条失败（如权限不符）不影响其余条目。
   */
  @Post('trash/batch')
  async trashBatch(@Req() req: Request, @Body() body: { ids?: string[]; action?: string }) {
    if (!(await this.userPerm(req, 'delete'))) return { success: false, message: '没有权限' };
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    const action = body.action === 'purge' ? 'purge' : 'restore';
    if (!ids.length) return { success: false, message: '缺少 ids' };
    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    const rows = await prisma.fileRecord.findMany({
      where: { id: { in: ids }, status: 'deleted', ...(owner ? { uploader: owner } : {}) },
    });
    const found = new Set(rows.map((r) => r.id));
    const results: { id: string; ok: boolean; message?: string }[] = [];
    for (const id of ids) {
      if (!found.has(id)) {
        results.push({ id, ok: false, message: '不存在或无权限' });
        continue;
      }
      try {
        const rec = rows.find((r) => r.id === id)!;
        if (action === 'purge') await this.uploadSvc.removeFile(rec.id, rec.name);
        else await this.uploadSvc.restoreFile(rec.id, rec.name);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, message: (err as Error).message });
      }
    }
    return {
      success: true,
      action,
      results,
      okCount: results.filter((r) => r.ok).length,
      failCount: results.filter((r) => !r.ok).length,
    };
  }

  /**
   * 渠道直链解析器 —— 交给 buildMetadata 计算「该文件在存储/备份渠道内的真实直链」。
   *
   * 文件详情里点击「存储渠道 / 备份渠道」，需要跳转到文件在该渠道上的真实地址，
   * 例如 S3 桶里的对象 URL、WebDAV 服务器上的真实路径、自定义接口返回的原始外链。
   * 直链不落库，全部按渠道【当前配置】实时构造（改域名/桶后立即生效）。
   *
   * 按渠道 ID 缓存解密后的配置，避免列表页逐条文件重复做 AES 解密。
   */
  private directUrlResolver(): (copy: CopyWithChannel) => string | null {
    const infoCache = new Map<string, ChannelInfo>();
    return (copy: CopyWithChannel): string | null => {
      const ch = copy.channel;
      if (!ch) return null;
      try {
        let info = infoCache.get(ch.id);
        if (!info) {
          info = {
            id: ch.id,
            name: ch.name,
            type: ch.type,
            config: this.channelsSvc.decryptConfig(ch.type, ch.config),
            metas: {},
          };
          infoCache.set(ch.id, info);
        }
        return createAdapter(info).buildDirectUrl(toCopyInfo(copy), info);
      } catch {
        return null;
      }
    };
  }

  /** 重命名 */
  /**
   * 重命名 File_ID（即外链标识 /file/:name）。
   * 前端用 POST + `{newFileId}`，这里同时兼容 PATCH 与 `{newName}`。
   *
   * 与原系统的差异：go-imgbed 的外链由本系统签发、远端只存 key，
   * 因此重命名只改本系统的标识与目录归属，无需搬动远端对象，
   * 旧外链会立即失效、新外链立即可用。
   */
  @Post('rename/*')
  renamePost(@Req() req: Request, @Body() body: RenameBody) {
    return this.doRename(wildcardParam(req), body, req);
  }

  @Patch('rename/*')
  rename(@Req() req: Request, @Body() body: RenameBody) {
    return this.doRename(wildcardParam(req), body, req);
  }

  private async doRename(oldId: string, body: RenameBody, req: Request) {
    if (!(await this.userPerm(req, 'edit'))) throw new ForbiddenException('没有编辑权限');
    const target = String(body.newFileId ?? body.newName ?? '').trim();
    if (!target) throw new BadRequestException('缺少 newFileId');

    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    const rec = await this.resolveFile(oldId, owner);
    if (!rec) throw new NotFoundException('文件不存在');
    if (target === rec.name) throw new BadRequestException('文件名未发生变化');

    // 路径规范化：反斜杠转正、压缩重复斜杠、去掉路径穿越
    const newId = target
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/^\/+/, '')
      .replace(/\.\./g, '_');
    if (!newId) throw new BadRequestException('文件名不能为空');

    const conflict = await prisma.fileRecord.findFirst({ where: { name: newId, NOT: { id: rec.id } } });
    if (conflict) throw new ConflictException('目标文件名已存在');

    // File_ID 里的目录层级同步到 folder（后台列表按目录归类）
    const dir = newId.includes('/') ? newId.split('/').slice(0, -1).join('/') : '';
    const updated = await prisma.fileRecord.update({
      where: { id: rec.id },
      data: { name: newId, folder: dir },
      include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
    });

    return {
      success: true,
      newFileId: newId,
      metadata: serializeFile(updated, updated.copies, { tags: updated.tags.map((t) => t.tag.name), resolveDirectUrl: this.directUrlResolver() }).metadata,
    };
  }

  /** 元数据读写（metas 字段） */
  /**
   * 兼容前端契约：前端把「File_ID」（= /file/:name 的标识）当作 fileId 传参，
   * 因此这里同时接受 name / 去扩展名的 name / 数据库主键 id 三种写法。
   */
  private async resolveFile(fileId: string, owner = '') {
    const key = String(fileId || '');
    const bare = key.replace(/\.[^.]*$/, '');
    return prisma.fileRecord.findFirst({
      where: { ...(owner ? { uploader: owner } : {}), OR: [{ id: key }, { name: key }, { name: bare }] },
      include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
    });
  }

  @Get('metadata/*')
  async getMeta(@Req() req: Request) {
    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    const rec = await this.resolveFile(wildcardParam(req), owner);
    if (!rec) return { success: false, message: '文件不存在' };
    const metadata = serializeFile(rec, rec.copies, {
      tags: rec.tags.map((t) => t.tag.name),
      resolveDirectUrl: this.directUrlResolver(),
    }).metadata as Record<string, unknown>;
    // 限时：把截止时间带给前端（0 = 永久）
    metadata.LinkExpiresAt = rec.linkExpiresAt ? rec.linkExpiresAt.getTime() : 0;
    return {
      success: true,
      data: {
        metas: rec.metas,
        name: rec.name,
        // 文件备注：只有作者本人能拿到（其它人连字段都不下发）
        ...(this.isAuthor(req, rec) ? { note: rec.note, Note: rec.note } : {}),
        metadata,
      },
    };
  }

  /**
   * 是否是文件的「作者」（上传者本人）。
   * 历史数据 uploader 为空时（早期版本 / 管理员直传），仅管理员视为作者。
   */
  private isAuthor(req: Request, rec: { uploader?: string | null }): boolean {
    const me = currentSession(req)?.user || '';
    if (!me) return false;
    const up = String(rec.uploader || '');
    if (up) return up === me;
    return this.admin(req);
  }

  /**
   * 限时访问（v2.1.0）：设置 / 取消文件的访问截止时间。
   *   body: { seconds: 3600 }              —— 从现在起 N 秒后失效
   *         { expiresAt: "2026-10-20T12:00" } —— 指定截止时间（本地/ISO 字符串或毫秒时间戳）
   *         { clear: true }                  —— 取消限时，恢复永久有效
   * 权限：文件作者本人或管理员（普通用户还要有 canEdit 权限）。
   */
  @Post('expiry/*')
  async setExpiry(
    @Req() req: Request,
    @Body() body: { seconds?: number | string; expiresAt?: string | number | null; clear?: boolean },
  ) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    const rec = await this.resolveFile(wildcardParam(req), owner);
    if (!rec) return { success: false, message: '文件不存在' };
    if (!this.isAuthor(req, rec)) return { success: false, message: '只有上传者本人可以设置限时' };

    let at: Date | null = null;
    if (!body?.clear) {
      if (body?.expiresAt !== undefined && body?.expiresAt !== null && body?.expiresAt !== '') {
        const raw = typeof body.expiresAt === 'number' ? body.expiresAt : Date.parse(String(body.expiresAt));
        if (!Number.isFinite(raw)) return { success: false, message: '截止时间格式不正确' };
        at = new Date(raw);
      } else {
        const sec = Number(body?.seconds);
        if (!Number.isFinite(sec) || sec <= 0) return { success: false, message: '请设置有效时长或截止时间' };
        at = new Date(Date.now() + sec * 1000);
      }
      if (at.getTime() <= Date.now()) return { success: false, message: '截止时间必须晚于当前时间' };
    }

    await prisma.fileRecord.update({ where: { id: rec.id }, data: { linkExpiresAt: at } });
    // 外链本身不变，但缓存必须失效：旧 200 不能被 CDN/浏览器继续复用
    return {
      success: true,
      data: { name: rec.name, LinkExpiresAt: at ? at.getTime() : 0, link: `${await this.linkPrefixSafe()}/${rec.name}` },
    };
  }

  /** 外链前缀（用于限时保存后回显完整链接；失败时回退空串） */
  private async linkPrefixSafe(): Promise<string> {
    try {
      const s = this.settings;
      const domain = await s.getServerDomain();
      return (await s.getLinkPrefix(domain)).replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  @Put('metadata/*')
  async putMeta(@Req() req: Request, @Body() body: { metas?: string | Record<string, unknown> }) {
    return this.saveMeta(req, body);
  }

  /**
   * 兼容前端契约：文件详情「编辑 → 保存」用的是 PATCH 方法。
   * 早期只注册了 PUT，导致详情里改名/改类型保存时报 404 —— 这里补一个别名。
   */
  @Patch('metadata/*')
  async patchMeta(@Req() req: Request, @Body() body: { metas?: string | Record<string, unknown> }) {
    return this.saveMeta(req, body);
  }

  private async saveMeta(req: Request, body: { metas?: string | Record<string, unknown> }) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    const rec = await this.resolveFile(wildcardParam(req), owner);
    if (!rec) return { success: false, message: '文件不存在' };

    /*
     * 兼容两种入参形状：
     *   1) { metas: "<json>" } / { metas: {...} } —— 直接替换 metas（批量/脚本调用）
     *   2) { FileName, FileType }               —— 文件详情「编辑」的扁平字段（前端实际用这个）
     * 旧实现只认第 1 种：前端传扁平字段时 `body.metas` 为 undefined，
     * 会被当成空对象覆盖写回，把标签/备注等已有 metas 全部抹掉。这里按形状分开处理。
     */
    let metasRaw: string;
    const patch: { originalName?: string; folder?: string; note?: string } = {};
    if (body && body.metas !== undefined) {
      metasRaw = typeof body.metas === 'string' ? body.metas : JSON.stringify(body.metas || {});
    } else {
      const cur = safeParse(rec.metas);
      const b = (body || {}) as Record<string, unknown>;
      // 文件备注（v2.1.0）：仅作者本人可写；存 note 列，不进 metas，避免被覆盖写回抹掉
      if (b.Note !== undefined || b.note !== undefined) {
        if (!this.isAuthor(req, rec)) return { success: false, message: '只有上传者本人可以编辑备注' };
        patch.note = String(b.Note ?? b.note ?? '').slice(0, 4000);
      }
      if (b.FileName !== undefined) {
        const next = String(b.FileName || '').trim();
        if (next) patch.originalName = next; // 显示文件名实际存在 originalName 上
      }
      if (b.FileType !== undefined) cur.FileType = String(b.FileType || '');
      // 黑白名单：文件详情页「黑名单 / 白名单」按钮（White / Block / None）
      if (b.ListType !== undefined) {
        const lt = String(b.ListType || '').trim();
        cur.ListType = lt === 'White' || lt === 'Block' ? lt : 'None';
      }
      // 分类目录：详情页「编辑」里重新选择目录（等价于文件管理的「移动」）
      if (b.Directory !== undefined) {
        patch.folder = normalizeDir(String(b.Directory || '')).replace(/\/+$/, '');
      }
      metasRaw = JSON.stringify(cur);
    }
    try {
      JSON.parse(metasRaw);
    } catch {
      return { success: false, message: 'metas 不是合法 JSON' };
    }
    await prisma.fileRecord.update({ where: { id: rec.id }, data: { metas: metasRaw, ...patch } });
    const updated = await this.resolveFile(rec.name, owner);
    return {
      success: true,
      data: {
        metas: metasRaw,
        name: rec.name,
        ...(this.isAuthor(req, rec) ? { note: patch.note !== undefined ? patch.note : rec.note } : {}),
        metadata: updated
          ? serializeFile(updated, updated.copies, { tags: updated.tags.map((t) => t.tag.name), resolveDirectUrl: this.directUrlResolver() }).metadata
          : undefined,
      },
    };
  }

  /**
   * 批量补备份（文件管理「一键备份所有文件」批量操作）。
   * 入参 fileIds 既可用数据库主键，也可用文件列表里的 File_ID（name）。
   * 内部会先检测每个文件的备份情况：已有备份的计入 skipped，只对没有备份的执行备份。
   */
  @Put('batch/rebackup')
  async rebackup(@Req() req: Request, @Body() body: { fileIds?: string[] }) {
    const ids = await this.filterOwned(body.fileIds || [], req);
    const r = await this.uploadSvc.rebackup(ids);
    return { success: true, data: r };
  }

  // 兼容两种调用路径：早期前端用 /api/manage/batch/...，管理页批量操作菜单用 /api/manage/files/batch/...
  @Post('batch/backupSelected')
  async backupSelected(@Req() req: Request, @Body() body: { fileIds?: string[] }) {
    return this.rebackup(req, body);
  }

  @Post('files/batch/backupSelected')
  async backupSelectedFiles(@Req() req: Request, @Body() body: { fileIds?: string[] }) {
    return this.rebackup(req, body);
  }

  /**
   * 单文件一键备份（文件详情「备份渠道」为空时的「一键备份」按钮）。
   * 复用批量补备份逻辑，只传一个 ID。
   */
  @Post('files/backup/*')
  async backupOne(@Req() req: Request) {
    const key = wildcardParam(req);
    if (!key) return { success: false, message: '缺少文件名' };
    const ids = await this.filterOwned([key], req);
    if (!ids.length) return { success: false, message: '文件不存在' };
    const r = await this.uploadSvc.rebackup(ids);
    return { success: r.ok > 0 || r.skipped > 0, data: r, message: r.ok > 0 ? '备份成功' : r.skipped > 0 ? '该文件已有备份' : '备份失败，请检查备份渠道配置' };
  }

  /**
   * 重定向：为单个文件设置 / 清除「重定向地址」。
   * 设置后 /file/:name 直接 302 到该地址（外链不变，实际文件源被替换）；
   * 传空字符串即恢复使用渠道真实直链。
   */
  @Post('files/redirect/*')
  async setRedirect(@Req() req: Request, @Body() body: { url?: string }) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    const rec = await this.resolveFile(wildcardParam(req), owner);
    if (!rec) return { success: false, message: '文件不存在' };
    const url = String(body.url || '').trim();
    if (url) {
      try {
        const u = new URL(url);
        if (!['http:', 'https:'].includes(u.protocol)) return { success: false, message: '仅支持 http/https 地址' };
      } catch {
        return { success: false, message: 'URL 格式不正确' };
      }
    }
    await prisma.fileRecord.update({ where: { id: rec.id }, data: { redirectUrl: url } });
    return { success: true, data: { redirectUrl: url } };
  }

  /**
   * 新建逻辑分类目录（文件管理左上角「新建目录」按钮）。
   * 目录在本系统里是「逻辑分类」（不产生真实远端路径），因此新目录登记在
   * settings.extraFolders：{ "<owner>": ["2026/10", ...] }，owner='' 表示管理员/全局。
   * 目录树与列表的目录列会与「有文件的目录」合并展示。
   */
  @Post('folder')
  async createFolder(@Req() req: Request, @Body() body: { dir?: string; name?: string; path?: string }) {
    // 兼容两种入参：{dir, name} 或直接给完整 {path}
    let base = String(body.dir || '').replace(/^\/+|\/+$/g, '');
    let rawName = body.name;
    if (!rawName && body.path) {
      const parts = String(body.path).replace(/^\/+|\/+$/g, '').split('/');
      rawName = parts.pop() || '';
      base = parts.join('/');
    }
    const name = String(rawName || '').trim().replace(/^\/+|\/+$/g, '').replace(/\.\./g, '_');
    if (!name) return { success: false, message: '目录名不能为空' };
    const full = base ? `${base}/${name}` : name;
    await this.registerFolder(req, full);
    return { success: true, data: { path: full } };
  }

  /** 登记逻辑目录（按账户隔离：普通用户只有自己的一套目录） */
  private async registerFolder(req: Request, full: string) {
    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    const raw = await this.settings.get('extraFolders', '{}');
    let map: Record<string, string[]> = {};
    try {
      map = raw ? JSON.parse(raw) : {};
    } catch {
      map = {};
    }
    const list = new Set(map[owner] || []);
    list.add(full.replace(/^\/+|\/+$/g, ''));
    map[owner] = Array.from(list).sort();
    await this.settings.set('extraFolders', JSON.stringify(map));
  }

  /** 读取当前用户可见的额外（空）目录列表 */
  private async extraFolders(req: Request): Promise<string[]> {
    const owner = this.admin(req) ? '' : currentSession(req)?.user || '';
    try {
      const map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
      return Array.isArray(map[owner]) ? map[owner] : [];
    } catch {
      return [];
    }
  }

  /** 数据总览：文件量、容量、渠道状态、近 7 天趋势、副本分布（仅管理员） */
  @Get('stats')
  @UseGuards(AdminGuard)
  async stats() {
    const [fileCount, sizeAgg, channels] = await Promise.all([
      prisma.fileRecord.count({ where: { status: 'active' } }),
      prisma.fileRecord.aggregate({ where: { status: 'active' }, _sum: { size: true } }),
      prisma.channel.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);

    // 近 7 天上传趋势
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 6);
    const recent = await prisma.fileRecord.findMany({
      where: { status: 'active', createdAt: { gte: since } },
      select: { createdAt: true },
    });
    const byDay: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      byDay[d.toISOString().slice(0, 10)] = 0;
    }
    for (const r of recent) {
      const k = r.createdAt.toISOString().slice(0, 10);
      if (k in byDay) byDay[k] += 1;
    }

    // 各渠道副本数量与状态
    const copies = await prisma.fileCopy.groupBy({
      by: ['channelId', 'status'],
      _count: { _all: true },
    });
    // 全局主/备渠道概览 —— 统一走 StorageChannelService.getStorageChannel('', type)
    const briefOf = (c: StorageChannelInfo | null) =>
      c ? { id: c.id, code: c.code, name: c.name, type: c.type, enabled: true } : null;

    return {
      success: true,
      data: {
        fileCount,
        totalSize: sizeAgg._sum.size || 0,
        channelCount: channels.length,
        mainChannel: briefOf(await this.storageChannel.getStorageChannel('', 'main')),
        backupChannel: briefOf(await this.storageChannel.getStorageChannel('', 'backup')),
        accessChannel: await this.settings.getAccessChannel(),
        backupEnabled: (await this.settings.get('backupEnabled', 'true')) === 'true',
        allowUpload: (await this.settings.get('allowUpload', 'true')) === 'true',
        serverDomain: (await this.settings.getServerDomain()) || '',
        byDay: Object.entries(byDay).map(([date, count]) => ({ date, count })),
        channels: channels.map((c) => {
          const mine = copies.filter((x) => x.channelId === c.id);
          const sum = (st: string) => mine.filter((x) => x.status === st).reduce((a, b) => a + b._count._all, 0);
          return {
            id: c.id,
            name: c.name,
            type: c.type,
            enabled: c.enabled,
            isMain: c.isMain,
            isBackup: c.isBackup,
            active: sum('active'),
            failed: sum('failed'),
            pending: sum('pending'),
          };
        }),
      },
    };
  }

  /** 黑白名单 —— 以 JSON 数组存 settings，UI 增删单条 IP（仅管理员） */
  @Get('lists')
  @UseGuards(AdminGuard)
  async lists() {
    return { success: true, data: await this.readLists() };
  }

  @Post('white/:ip')
  @UseGuards(AdminGuard)
  async addWhite(@Param('ip') ip: string) {
    return this.mutateList('whiteIpList', ip, 'add');
  }

  @Delete('white/:ip')
  @UseGuards(AdminGuard)
  async delWhite(@Param('ip') ip: string) {
    return this.mutateList('whiteIpList', ip, 'del');
  }

  @Post('block/:ip')
  @UseGuards(AdminGuard)
  async addBlock(@Param('ip') ip: string) {
    return this.mutateList('blockIpList', ip, 'add');
  }

  @Delete('block/:ip')
  @UseGuards(AdminGuard)
  async delBlock(@Param('ip') ip: string) {
    return this.mutateList('blockIpList', ip, 'del');
  }

  /** 安全总开关（黑白名单是否生效）（仅管理员） */
  @Put('lists/enabled')
  @UseGuards(AdminGuard)
  async setListsEnabled(@Body() body: { enabled?: boolean | string }) {
    const v = body.enabled === true || body.enabled === 'true';
    await this.settings.set('securityEnabled', v ? 'true' : 'false');
    return { success: true };
  }

  private async readLists(): Promise<{ white: string[]; block: string[]; enabled: boolean }> {
    const parse = (raw: string): string[] => {
      if (!raw) return [];
      try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v.map(String) : [];
      } catch {
        return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      }
    };
    return {
      white: parse(await this.settings.get('whiteIpList', '[]')),
      block: parse(await this.settings.get('blockIpList', '[]')),
      enabled: (await this.settings.get('securityEnabled', 'false')) === 'true',
    };
  }

  private async mutateList(key: string, ip: string, mode: 'add' | 'del') {
    const cur = await this.readLists();
    const list = key === 'whiteIpList' ? cur.white : cur.block;
    const next = mode === 'add'
      ? Array.from(new Set([...list, ip]))
      : list.filter((x) => x !== ip);
    await this.settings.set(key, JSON.stringify(next));
    return { success: true, data: await this.readLists() };
  }

  /**
   * 系统配置：/page /security /upload /others /ai
   * 直接返回配置对象本身（对齐原系统契约：前端 `this.settings = data`）。
   * 前端保存用 POST，同时兼容 PUT。
   */
  /** 对外 WebDAV 配置读写（系统管理 → 其他设置 → 对外 WebDAV） */
  @Get('webdav')
  @UseGuards(AdminGuard)
  async getWebdav() {
    const raw = await this.settings.get('webdav', '');
    try {
      return { success: true, data: raw ? JSON.parse(raw) : {} };
    } catch {
      return { success: true, data: {} };
    }
  }

  @Post('webdav')
  @UseGuards(AdminGuard)
  async saveWebdav(@Body() body: Record<string, unknown>) {
    await this.settings.set('webdav', JSON.stringify(body || {}));
    return { success: true };
  }

  @Get('sysConfig/:section')
  @UseGuards(AdminGuard)
  async getSysConfig(@Param('section') section: string) {
    return this.sysConfig.get(section);
  }

  /**
   * 系统日志（后台「系统日志」页）——内存环形缓冲 + 每日落盘文件。
   * 查询参数：level=info|warn|error|all、scope、keyword、limit、since(时间戳)
   */
  @Get('logs')
  @UseGuards(AdminGuard)
  getLogs(
    @Query()
    q: { level?: string; scope?: string; keyword?: string; limit?: string; since?: string; date?: string },
  ) {
    const data = appLog.list({
      level: q.level,
      scope: q.scope,
      keyword: q.keyword,
      limit: Number(q.limit) || 200,
      since: Number(q.since) || 0,
      date: q.date,
    });
    return { success: true, ...data, scopes: appLog.scopes(), stats: appLog.stats(), files: appLog.logFiles() };
  }

  /** 清空内存日志（磁盘文件保留，便于事后追溯）（仅管理员） */
  @Delete('logs')
  @UseGuards(AdminGuard)
  clearLogs() {
    return { success: true, cleared: appLog.clear() };
  }

  /** 打印一条日志（后台「测试日志」按钮用，验证链路是否通）（仅管理员） */
  @Post('logs/test')
  @UseGuards(AdminGuard)
  testLog() {
    appLog.info('debug', '这是一条来自后台的测试日志', `时间：${new Date().toLocaleString('zh-CN')}`);
    return { success: true };
  }

  /** 磁盘日志文件列表（后台「系统日志」页的「选择日志版本」下拉） */
  @Get('logs/files')
  @UseGuards(AdminGuard)
  logFiles() {
    return { success: true, data: appLog.logFiles() };
  }

  /**
   * 导出系统日志为 .log 文件（后台「系统日志」页的导出按钮）。
   * 支持与 /logs 相同的筛选参数；导出当前缓冲内的日志文本。
   */
  @Get('logs/export')
  @UseGuards(AdminGuard)
  exportLogs(
    @Query()
    q: { level?: string; scope?: string; keyword?: string; limit?: string; since?: string },
    @Res() res: Response,
  ) {
    const data = appLog.list({
      level: q.level,
      scope: q.scope,
      keyword: q.keyword,
      limit: Number(q.limit) || 5000,
      since: Number(q.since) || 0,
    });
    const text = (data.entries || [])
      .map((e: { at: number; level: string; scope: string; message: string; detail?: string; ip?: string }) =>
        `${new Date(e.at).toISOString()} [${e.level.toUpperCase()}] [${e.scope}] ${e.message}${e.detail ? ` ｜ ${e.detail}` : ''}${e.ip ? ` ｜ ip=${e.ip}` : ''}`,
      )
      .join('\n');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="go-imgbed-logs-${stamp}.log"`);
    return res.send(text || '(无日志)');
  }

  /** 一键备份所有文件：没有备份的文件进入后台队列补备份，已有备份的跳过（仅管理员） */
  @Post('backupAll/start')
  @UseGuards(AdminGuard)
  startBackupAll() {
    return { success: true, data: this.uploadSvc.startBackupAll() };
  }

  /** 一键备份进度查询（仅管理员） */
  @Get('backupAll/status')
  @UseGuards(AdminGuard)
  backupAllStatus() {
    return { success: true, data: this.uploadSvc.backupAllStatus() };
  }

  @Post('sysConfig/:section')
  @UseGuards(AdminGuard)
  async postSysConfig(
    @Param('section') section: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.persistSysConfig(section, body, res);
  }

  @Put('sysConfig/:section')
  @UseGuards(AdminGuard)
  async putSysConfig(
    @Param('section') section: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.persistSysConfig(section, body, res);
  }

  /**
   * 保存分区配置。管理端账号发生变更时清除当前会话，
   * 让前端提示「请重新登录」并强制用新口令验证（否则旧 Cookie 仍然有效）。
   */
  private async persistSysConfig(section: string, body: Record<string, unknown>, res: Response) {
    const out = await this.sysConfig.save(section, body);
    if (section === 'security' && (out as { adminPasswordChanged?: boolean })?.adminPasswordChanged) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
    }
    return out;
  }
}

/** 用户侧配置（上传页 / 登录页 / 全局背景图使用） */
@Controller('api')
export class UserConfigController {
  constructor(
    private settings: SettingsService,
    private sysConfig: SysConfigService,
    private uploadSvc: UploadService,
    private storageChannel: StorageChannelService,
  ) {}

  /** 渠道信息裁剪为前端需要的字段（id / code / name / type），null 原样返回 */
  private channelBrief(c: StorageChannelInfo | null): { id: string; code: string; name: string; type: string } | null {
    return c ? { id: c.id, code: c.code, name: c.name, type: c.type } : null;
  }

  /**
   * 用户侧配置 —— 直接返回配置对象（前端 `commit('setUserConfig', response.data)`）。
   * 字段名严格对齐原系统，取自页面设置（page）分区的 config 项。
   */
  @Get('userConfig')
  async userConfig(@Req() req: Request) {
    const s = this.settings;
    // 当前登录账户 —— 用于解析「用户管理」里为该账户指定的主/备存储渠道
    const uploader = currentSession(req)?.user || '';
    const domain = (await s.getServerDomain()) || `${req.protocol}://${req.get('host')}`;
    const bool = async (k: string, d = false) => (await s.get(k, d ? 'true' : 'false')) === 'true';

    let page: any = { config: [] };
    try {
      page = await this.sysConfig.get('page');
    } catch {
      /* 首次运行尚无配置 */
    }
    const pv = (id: string, d: any = '') => {
      const item = (page?.config || []).find((x: any) => x.id === id);
      return item && item.value !== undefined && item.value !== null && item.value !== '' ? item.value : d;
    };
    /**
     * 背景图配置解析 —— 页面设置里保存的是原始字符串（如 `["url1","url2"]`、
     * `bing` 或单个 URL），这里统一归一化为 backgroundManager 期望的形状：
     * 数组 / 'bing' / 空数组。此前直接 asArr 字符串会得到 []，导致登录页、
     * 管理页背景图全部失效、上传页错误回退到内置默认背景。
     */
    const asBk = (v: any): string[] | string => {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') {
        const s = v.trim();
        if (!s) return [];
        if (s.toLowerCase() === 'bing') return 'bing';
        if (s.startsWith('[')) {
          try {
            const a = JSON.parse(s);
            return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()) : [];
          } catch {
            return [];
          }
        }
        return [s]; // 视为单个 URL
      }
      return [];
    };

    return {
      // 站点信息
      siteTitle: pv('siteTitle', 'go-imgbed') || 'go-imgbed',
      siteIcon: pv('siteIcon', ''),
      ownerName: pv('ownerName', ''),
      logoUrl: pv('logoUrl', ''),
      logoLink: pv('logoLink', ''),
      announcement: pv('announcement', ''),
      announcementRefreshAt: page?.announcementRefreshAt || 0,
      footerLink: pv('footerLink', ''),
      disableFooter: pv('disableFooter', false) === true,
      defaultLanguage: 'zh-CN',
      // 外链与上传
      serverDomain: domain,
      /*
       * 外链前缀（全站文件链接的唯一出口）。
       * 优先级：上传设置里的「自定义访问域名」> 页面设置「默认URL前缀」> 本站 /file/。
       * 全站（上传页 / 文件管理 / 历史记录 / 文件详情 / 系统状态 …）都用这一个值拼文件链接，
       * 因此改了自定义域名后，所有文件链接一起跟随，不需要逐处修改。
       */
      urlPrefix: await s.getLinkPrefix(domain),
      // 供前端做「仅替换文件链接」判断的原始自定义域名（未设置时为空串）
      customDomain: await s.getCustomDomain(),
      /*
       * 当前全局默认主存储渠道（isMain 且启用）。
       * 上传页「上传设置 → 渠道名称」需要把「跟随主渠道」解析成实际渠道展示出来，
       * 否则用户只知道跟着主渠道走，却看不到主渠道到底是哪一个。
       */
      defaultChannel: this.channelBrief(await this.storageChannel.getStorageChannel('', 'main')),
      /*
       * 当前生效的主 / 备份存储渠道 —— 统一走 StorageChannelService.getStorageChannel。
       * 登录账户在「用户管理」里指定了渠道就用指定的，否则用后台「上传设置」里的全局渠道。
       * 上传页「上传设置」用它展示，并作为「未指定渠道」时的默认上传渠道。
       */
      mainChannel: this.channelBrief(await this.storageChannel.getStorageChannel(uploader, 'main')),
      backupChannel: this.channelBrief(await this.storageChannel.getStorageChannel(uploader, 'backup')),
      allowUpload: await bool('allowUpload', true),
      // 上传默认值
      defaultUploadNameType: pv('defaultUploadNameType', 'default'),
      defaultUploadFolder: pv('defaultUploadFolder', ''),
      defaultConvertToWebp: pv('defaultConvertToWebp', false) === true,
      defaultCustomerCompress: pv('defaultCustomerCompress', false) === true,
      defaultCompressBar: pv('defaultCompressBar', '0.8'),
      // 压缩期望：已改为「压缩百分比」（如 80 = 压到原体积 80%）
      defaultCompressQuality: pv('defaultCompressQuality', '80'),
      // 外链格式与上传限制
      defaultUrlForm: pv('defaultUrlForm', 'url'),
      allowedExtensions: String(
        pv('allowedExtensions', 'jpg,png,gif,jpeg,webp,bmp,mp4,webm,mov,m4v,mp3,m4a,aac,ogg'),
      )
        .split(',')
        .map((x) => x.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean),
      maxUploadSizeMB: Number(pv('maxUploadSizeMB', 150)) || 150,
      // 背景图
      wallpaperEnabled: pv('wallpaperEnabled', false) === true,
      // 夜间/白天自动切换（关闭后固定白天样式）
      autoDarkMode: pv('autoDarkMode', true) !== false,
      bkInterval: Number(pv('bkInterval', 3000)) || 3000,
      bkOpacity: Number(pv('bkOpacity', 1)) || 1,
      uploadBkImg: asBk(pv('uploadBkImg', [])),
      adminBkImg: asBk(pv('adminBkImg', [])),
      adminLoginBkImg: asBk(pv('adminLoginBkImg', [])),
      showDirectorySuggestions: pv('showDirectorySuggestions', true) !== false,
    };
  }

  /**
   * 目录树（上传页「上传目录」建议/分类选择的数据源）。
   * 响应结构与原系统一致：{ tree: { name, path, children } }，
   * 此前错误地返回扁平目录数组，前端取 data.tree 恒为 undefined，导致分类无法加载。
   */
  @Get('directoryTree')
  async directoryTree(@Req() req: Request) {
    // 普通用户只看到自己的目录 —— 每个账户一套文件夹记录体系
    const session = currentSession(req);
    const admin = isAdminRole(session?.role);
    const owner = admin ? '' : session?.user || '';
    const rows = await prisma.fileRecord.groupBy({
      by: ['folder'],
      where: { status: 'active', ...(owner ? { uploader: owner } : {}) },
    });
    const dirs = rows.map((r) => r.folder).filter(Boolean) as string[];
    // 合并「新建目录」登记的空目录
    try {
      const map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
      const extra = Array.isArray(map[owner]) ? map[owner] : [];
      dirs.push(...extra);
    } catch {
      /* 忽略 */
    }
    return { success: true, tree: buildDirectoryTree(Array.from(new Set(dirs)).sort()) };
  }

  /** 公开画廊 */
  @Get('public/list')
  async publicList(@Query() q: Record<string, string>, @Res() res: Response) {
    // 公开画廊开关 + 目录白名单（系统设置 → 其他设置 → 公开游览）
    const others = (await this.sysConfig.get('others')) as { publicBrowse?: Record<string, unknown> } | undefined;
    const cfg = others?.publicBrowse || {};
    if (cfg.enabled !== true) {
      return res.status(403).json({ error: 'Public browse is disabled' });
    }

    const allowedDirs = String(cfg.allowedDir || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    const recursive = q.recursive === 'true';
    const dir = normalizeDir(q.dir);
    const bare = dir.replace(/\/+$/, '');
    if (!dirAllowed(bare, allowedDirs)) {
      return res.status(403).json({ error: 'Directory not allowed' });
    }

    const start = Math.max(0, Number(q.start || 0) || 0);
    const count = q.count === undefined ? 50 : Math.max(0, Number(q.count) || 0);
    const search = (q.search || '').trim().toLowerCase();
    const type = (q.type || '').trim().toLowerCase();

    const rows = await prisma.fileRecord.findMany({
      where: { status: 'active' },
      include: { copies: { include: { channel: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // 公开画廊只展示「正常」文件：黑名单 / 违规内容不外露
    const visible = rows.filter((r) => {
      const metas = safeParse(r.metas);
      return ((metas.ListType as string) || 'None') !== 'Block' && metas.Label !== 'adult';
    });

    const matched = visible.filter((r) => {
      const folder = (r.folder || '').replace(/\/+$/, '');
      if (recursive) {
        if (bare && folder !== bare && !folder.startsWith(`${bare}/`)) return false;
      } else if (folder !== bare) {
        return false;
      }
      if (search && !r.originalName.toLowerCase().includes(search) && !r.name.toLowerCase().includes(search)) return false;
      if (type && fileTypeOf(r.mime) !== type) return false;
      return true;
    });

    // 子目录：当前目录下的直接子目录，且必须落在白名单内
    const dirSet = new Set<string>();
    for (const r of visible) {
      const full = `${(r.folder || '').replace(/\/+$/, '')}/`;
      if (!full.startsWith(dir)) continue;
      const rest = full.slice(dir.length);
      const idx = rest.indexOf('/');
      if (idx !== -1) dirSet.add(dir + rest.slice(0, idx));
    }
    const directories = Array.from(dirSet)
      .map((d) => d.replace(/\/+$/, ''))
      .filter((d) => d !== '' && dirAllowed(d, allowedDirs))
      .sort();

    const totalCount = matched.length;
    const paged = count > 0 ? matched.slice(start, start + count) : matched.slice(start);

    return res.json({
      files: paged.map((r) => serializeFile(r, r.copies)),
      directories,
      totalCount,
      returnedCount: paged.length,
      allowedDirs,
      fromCache: false,
    });
  }

  /**
   * 随机图 API —— GET /api/random
   *
   * 输出形态：
   *   默认        → 302 跳转到随机图（可直接当 <img src=".../api/random"> 用）
   *   ?type=json  → 返回 JSON（也接受 ?json=1 / ?format=json）
   *
   * 筛选参数（可任意组合，缺省为「全库随机」）：
   *   ?dir=风景/2026          限定目录（含子目录请用 ?recursive=true）
   *   ?category=image|video|audio     按大类型（按 MIME 前缀）
   *   ?fileType=Image|Video|Audio     同 category，兼容后台列表口径
   *   ?ext=jpg,png,webp       按扩展名白名单
   *   ?channel=腾讯云COS       按渠道类型（中文名，见 CHANNEL_LABEL）
   *   ?channelName=主渠道A     按渠道名称
   *   ?label=xxx              按标签（metas.Label）
   *   ?access=normal|block|white      按访问状态
   *   ?count=1..10            一次取多张（>1 时 data 为数组）
   *
   * 兼容性：`data` 在 count=1 时为对象、count>1 时为数组；两者都额外带
   *         `list` 数组字段，方便调用方统一按列表消费。
   */
  @Get('random')
  async random(@Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const asJson = q.type === 'json' || q.json === '1' || q.format === 'json';

    // 随机图 API 开关 + 目录白名单（系统设置 → 其他设置 → 随机图 API）
    const others = (await this.sysConfig.get('others')) as { randomImageAPI?: Record<string, unknown> } | undefined;
    const randomCfg = others?.randomImageAPI || {};
    if (randomCfg.enabled !== true) {
      return asJson
        ? res.status(403).json({ success: false, error: 'Random is disabled', message: '随机图 API 已关闭' })
        : res.status(403).send('Random is disabled');
    }
    const allowedRandomDirs = String(randomCfg.allowedDir || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    const count = Math.min(10, Math.max(1, Number(q.count || 1) || 1));
    const recursive = q.recursive === 'true';

    // —— 可在 SQL 层表达的条件 ——
    const where: Record<string, unknown> = { status: 'active' };
    const dir = normalizeDir(q.dir);
    if (dir) {
      if (!dirAllowed(dir.replace(/\/+$/, ''), allowedRandomDirs)) {
        return asJson
          ? res.status(403).json({ success: false, error: 'Directory not allowed', message: '目录不在允许范围内' })
          : res.status(403).send('Directory not allowed');
      }
      const bare = dir.replace(/\/+$/, '');
      where.folder = recursive ? { startsWith: bare } : bare;
    } else if (allowedRandomDirs.length) {
      // 未指定目录时把候选限定在白名单目录内
      where.AND = allowedRandomDirs.map((d) => ({
        OR: [{ folder: d.replace(/\/+$/, '') }, { folder: { startsWith: `${d.replace(/\/+$/, '')}/` } }],
      }));
    }
    const cat = (q.category || q.fileType || '').toLowerCase();
    const prefix = cat.startsWith('img') || cat === 'image' ? 'image/' : cat === 'video' ? 'video/' : cat === 'audio' ? 'audio/' : '';
    if (prefix) where.mime = { startsWith: prefix };

    const exts = splitCsv(q.ext).map((e) => e.replace(/^\./, '').toLowerCase());
    if (exts.length) {
      // 注意：FileRecord.name 是「外链标识」（随机 ID，通常不带扩展名），
      // 用户可见的真实文件名在 originalName（后台重命名改的也是它）。
      // 因此两者都要匹配，否则 ?ext=png 永远查不到东西。
      where.OR = exts.flatMap((e) => [
        { originalName: { endsWith: `.${e}` } },
        { name: { endsWith: `.${e}` } },
      ]);
    }

    // 渠道 / 标签 / 访问状态存在关联表与 metas JSON 里，SQLite 侧不便表达 → 取回后内存过滤
    const needMemory = Boolean(q.channel || q.channelName || q.label || q.access);

    /** 公开可见性：黑名单与违规内容不通过任何公开接口外露 */
    const isPubliclyVisible = (metasRaw: string) => {
      const m = safeParse(metasRaw);
      return ((m.ListType as string) || 'None') !== 'Block' && m.Label !== 'adult';
    };

    const pick = async (): Promise<FileRecord[]> => {
      if (!needMemory) {
        // 先只取「标识 + metas」做公开性过滤，再洗牌抽样，最后回表取完整记录
        const candidates = await prisma.fileRecord.findMany({ where, select: { name: true, metas: true } });
        const names = candidates.filter((c) => isPubliclyVisible(c.metas)).map((c) => c.name);
        if (!names.length) return [];
        for (let i = names.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [names[i], names[j]] = [names[j], names[i]];
        }
        const chosen = names.slice(0, count);
        const recs = await prisma.fileRecord.findMany({ where: { name: { in: chosen } } });
        return chosen.map((n) => recs.find((r) => r.name === n)).filter(Boolean) as FileRecord[];
      }
      const rows = await prisma.fileRecord.findMany({
        where,
        orderBy: { id: 'asc' },
        include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
      });
      const filtered = rows.filter((r) => {
        const metas = safeParse(r.metas);
        if (!isPubliclyVisible(r.metas)) return false;
        if (q.label && ((metas.Label as string) || 'None') !== q.label) return false;
        if (q.access) {
          const lt = (metas.ListType as string) || 'None';
          const ok =
            (q.access === 'normal' && lt === 'None') ||
            (q.access === 'block' && lt === 'Block') ||
            (q.access === 'white' && lt === 'White');
          if (!ok) return false;
        }
        if (q.channel || q.channelName) {
          const primary = r.copies.find((c) => c.channel?.isMain) || r.copies[0];
          const typeLabel = primary?.channel ? CHANNEL_LABEL[primary.channel.type] || primary.channel.type : '';
          if (q.channel && typeLabel !== q.channel) return false;
          if (q.channelName && (primary?.channel?.name || '') !== q.channelName) return false;
        }
        return true;
      });
      if (!filtered.length) return [];
      const shuffled = filtered.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, count);
    };

    const picked = await pick();
    if (!picked.length) {
      if (asJson) return res.json({ success: false, message: '没有符合条件的图片', data: [] });
      return res.status(404).send('没有符合条件的图片');
    }
    res.setHeader('Cache-Control', 'no-store');

    if (asJson) {
      // 随机图 API：对外返回的文件链接走全站统一出口（自定义访问域名优先）
      const origin = `${req.protocol}://${req.get('host')}`;
      const prefix = await this.settings.getLinkPrefix(origin);
      const items = picked.map((r) => ({
        src: `${prefix}${encodeURIComponent(r.name)}`,
        url: `${prefix}${encodeURIComponent(r.name)}`,
        name: r.originalName,
        size: r.size,
        mime: r.mime,
        dir: r.folder || '',
      }));
      return res.json({ success: true, data: count === 1 ? items[0] : items, list: items });
    }
    return res.redirect(302, `/file/${picked[0].name}`);
  }
}
