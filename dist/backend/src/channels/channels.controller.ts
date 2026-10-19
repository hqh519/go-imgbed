import { Body, Controller, Delete, Get, Injectable, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { AdminGuard } from '../auth/auth.guard';
import { SettingsService } from '../settings/settings.service';
import { createAdapter } from '../adapters/adapter.factory';
import { ChannelInfo } from '../adapters/adapter.interface';
import { StorageChannelService, StorageChannelInfo } from '../storage/storage-channel.service';

/** 各渠道配置中的敏感字段名 —— 返回时脱敏、保存时加密（须与适配器读取的字段名一致） */
const SECRET_FIELDS: Record<string, string[]> = {
  local: [],
  cos: ['secretId', 'secretKey'],
  minio: ['accessKeyId', 'secretAccessKey'],
  r2: ['accessKeyId', 'secretAccessKey'],
  s3: ['accessKeyId', 'secretAccessKey'],
  easyimages: ['tokenValue'],
  lsky: ['tokenValue'],
  webdav: ['password'],
  immich: ['apiKey'],
  custom: ['tokenValue'],
};

/**
 * 可通过「添加渠道」创建的类型。
 * 注意：**不包含 local** —— 本地存储是系统内置渠道，随安装自动存在，
 * 不允许用户再添加第二个（否则无法区分默认落盘位置）。
 */
export const CHANNEL_TYPES = ['cos', 'minio', 'r2', 's3', 'aliyun', 'easyimages', 'lsky', 'webdav', 'immich', 'custom'] as const;

/** 系统内置、不可新增也不可删除的渠道类型（列表里排在最后） */
export const BUILTIN_CHANNEL_TYPES = ['local'] as const;

/** 内置本地渠道的固定业务 ID（6 位），全站以它识别 */
export const LOCAL_CHANNEL_CODE = '999999';

/** 历史版本（≤1.9.1）内置本地渠道的业务 ID —— 启动时自动迁到 999999 */
export const LEGACY_LOCAL_CHANNEL_CODE = '100000';

/**
 * 渠道类型编号（写进 channels.typeCode，纯排序用，与渠道业务 ID `code` 无关）：
 *   100 easyimages / 110 lsky / 120 immich / 130 minio / 140 r2 / 150 s3
 *   160 cos / 170 aliyun(ali) / 180 webdav / 190 custom / 999 local
 * 全站所有渠道下拉框的排序：typeCode 升序 → code 升序。
 */
export const CHANNEL_TYPE_CODE: Record<string, number> = {
  easyimages: 100,
  lsky: 110,
  immich: 120,
  minio: 130,
  r2: 140,
  s3: 150,
  cos: 160,
  aliyun: 170,
  webdav: 180,
  custom: 190,
  local: 999,
};

/** 取某渠道类型对应的类型编号（未知类型排最后，避免脏数据插到前面） */
export function channelTypeCode(type: string): number {
  return CHANNEL_TYPE_CODE[type] ?? 998;
}

/** 全站统一的渠道排序：typeCode 升序 → code 升序 */
export const CHANNEL_ORDER_BY = [{ typeCode: 'asc' as const }, { name: 'asc' as const }];

/**
 * 生成「测试连接」用的测试图：512×512 的合法 PNG。
 *
 * 为什么不用 1×1：部分图床（如 EasyImages 简单图床）会以
 * 「图片高度太小 / 图片太小」直接拒绝，导致测试连接误报失败。
 * 512×512 同时能覆盖绝大多数图床的最小尺寸校验。
 * 优先用 sharp 生成（项目已依赖）；失败时回落到内置 base64 小图。
 */
async function makeTestPng(): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 84, g: 150, b: 214 } },
    })
      .png()
      .toBuffer();
  } catch {
    // 兜底：内置 1×1 PNG（极小概率走到）
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
  }
}

/** 判定「同一账户」的配置字段：账号/桶/端点一致即视为同账户 */
const IDENTITY_FIELDS: Record<string, string[]> = {
  cos: ['secretId', 'bucket', 'region'],
  minio: ['endpoint', 'bucket', 'accessKeyId'],
  r2: ['endpoint', 'bucket', 'accessKeyId'],
  s3: ['endpoint', 'bucket', 'accessKeyId'],
  easyimages: ['apiUrl', 'tokenValue'],
  lsky: ['apiUrl', 'tokenValue'],
  webdav: ['baseUri', 'username'],
  immich: ['serverUrl', 'apiKey'],
  custom: ['apiUrl', 'tokenValue'],
};

/** 账户指纹：类型 + 身份字段（用于「备份渠道不能与主渠道同账户」校验） */
function channelIdentity(type: string, cfg: Record<string, string>): string {
  const fields = IDENTITY_FIELDS[type] || [];
  return `${type}::${fields.map((f) => cfg[f] || '').join('|')}`;
}

@Injectable()
export class ChannelsService {
  constructor(private settings: SettingsService) {}

  /** 解密后的完整配置（仅服务端内部使用） */
  decryptConfig(type: string, configJson: string): Record<string, string> {
    const cfg = JSON.parse(configJson || '{}');
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      out[k] = SECRET_FIELDS[type]?.includes(k) ? CryptoService.decrypt(String(v)) : String(v);
    }
    return out;
  }

  /** 脱敏后的配置（返回给前端） */
  maskConfig(type: string, configJson: string): Record<string, string> {
    const cfg = JSON.parse(configJson || '{}');
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      out[k] = SECRET_FIELDS[type]?.includes(k) ? CryptoService.mask(CryptoService.decrypt(String(v))) : String(v);
    }
    return out;
  }

  /** 账户指纹（用于主/备渠道去重） */
  identityOf(type: string, configJson: string): string {
    return channelIdentity(type, this.decryptConfig(type, configJson));
  }

  /**
   * 确保「本地存储」内置渠道存在（幂等，每次启动都跑）。
   *
   * 规则：
   *   1) 按固定 code（999999）查找；不存在则创建（排序值 9999，永远排在列表最后）；
   *      1.9.2 之前用的是 100000，发现旧记录时原地改 code（连同 file_copies 的 channelId 引用不变，
   *      因为改的是同一条记录的 code 字段，id 不变）；
   *   2) 已存在时只修复四件事：type 被改坏、被意外禁用、typeCode 不是 999、以及
   *      「库里一条主渠道都没有」时兜底为主渠道 —— 不去覆盖用户改过的名字与容量设置；
   *   3) 库里已有主渠道时一律尊重用户设置，绝不抢占。
   */
  async ensureBuiltinLocalChannel(): Promise<void> {
    // 0) 存量迁移：旧的内置本地渠道 code 100000 → 999999
    const legacy = await prisma.channel.findUnique({ where: { code: LEGACY_LOCAL_CHANNEL_CODE } });
    if (legacy) {
      const taken = await prisma.channel.findUnique({ where: { code: LOCAL_CHANNEL_CODE } });
      if (!taken) {
        await prisma.channel.update({ where: { id: legacy.id }, data: { code: LOCAL_CHANNEL_CODE } });
      } else if (taken.id !== legacy.id) {
        // 极少数情况：999999 已被普通渠道占用（随机 code 撞上）→ 把占用者挪走，保证内置 ID 唯一
        let alt = '';
        for (let i = 0; i < 60 && !alt; i++) {
          const c = String(100000 + Math.floor(Math.random() * 899000));
          if (c !== LOCAL_CHANNEL_CODE && !(await prisma.channel.findUnique({ where: { code: c } }))) alt = c;
        }
        await prisma.channel.update({ where: { id: taken.id }, data: { code: alt || '100001' } });
        await prisma.channel.update({ where: { id: legacy.id }, data: { code: LOCAL_CHANNEL_CODE } });
      }
    }

    // 1) 回填所有渠道的类型编号（含历史数据）；类型被改坏的也顺手纠正
    const all = await prisma.channel.findMany({ select: { id: true, type: true, typeCode: true } });
    for (const c of all) {
      const want = channelTypeCode(c.type);
      if (c.typeCode !== want) {
        await prisma.channel.update({ where: { id: c.id }, data: { typeCode: want } });
      }
    }

    const existing = await prisma.channel.findUnique({ where: { code: LOCAL_CHANNEL_CODE } });
    if (existing) {
      const patch: { type?: string; enabled?: boolean; isMain?: boolean; typeCode?: number } = {};
      if (existing.type !== 'local') patch.type = 'local';
      if (!existing.enabled) patch.enabled = true;
      if (existing.typeCode !== channelTypeCode('local')) patch.typeCode = channelTypeCode('local');
      // 没有任何主渠道 → 用本地存储兜底，避免上传时报「未配置可用的主渠道」
      if (!existing.isMain && !existing.isBackup) {
        const hasMain = await prisma.channel.count({
          where: { isMain: true, enabled: true, NOT: { id: existing.id } },
        });
        if (hasMain === 0) patch.isMain = true;
      }
      if (Object.keys(patch).length) {
        await prisma.channel.update({ where: { id: existing.id }, data: patch });
      }
      return;
    }
    // 名字冲突时加后缀，避免唯一约束报错导致启动失败
    let name = '本地存储';
    if (await prisma.channel.findUnique({ where: { name } })) name = '本地存储（系统）';
    const hasMain = await prisma.channel.count({ where: { isMain: true } });
    await prisma.channel.create({
      data: {
        code: LOCAL_CHANNEL_CODE,
        name,
        type: 'local',
        typeCode: channelTypeCode('local'),
        enabled: true,
        isMain: hasMain === 0,
        isBackup: false,
        sortOrder: 9999,
        config: JSON.stringify({ quotaEnabled: 'false', quotaLimitGB: '10', quotaThreshold: '95' }),
      },
    });
  }
}

@Controller('api/channels')
export class ChannelsController {
  constructor(private svc: ChannelsService) {}

  /**
   * 上传页 / 管理页共用：按渠道类型分组返回（兼容原系统契约）
   *   { cos: [{id,name,enabled,isMain,isBackup,config}], minio: [...], ... }
   */
  @Get()
  async list(@Query('includeDisabled') includeDisabled?: string) {
    const channels = await prisma.channel.findMany({
      where: includeDisabled === 'true' ? {} : { enabled: true },
      // 统一下拉排序：渠道类型编号升序 → 渠道 ID 升序
      orderBy: CHANNEL_ORDER_BY,
    });
    const grouped: Record<string, unknown[]> = {};
    for (const c of channels) {
      if (!grouped[c.type]) grouped[c.type] = [];
      grouped[c.type].push({
        id: c.id,
        code: c.code,
        name: c.name,
        type: c.type,
        typeCode: c.typeCode,
        enabled: c.enabled,
        isMain: c.isMain,
        isBackup: c.isBackup,
        config: this.svc.maskConfig(c.type, c.config),
      });
    }
    return grouped;
  }
}

@Controller('api/manage/storage')
@UseGuards(AdminGuard)
export class StorageSettingsController {
  constructor(
    private settings: SettingsService,
    private svc: ChannelsService,
    private storageChannel: StorageChannelService,
  ) {}

  /** 读取分发设置：外链模式、当前访问渠道、代理参数、上传去重开关与范围、自定义访问域名、主/备渠道概览 */
  @Get()
  async get() {
    const [linkMode, accessChannel, proxyTimeoutMs, proxyCacheSeconds, dedupEnabled, dedupScope, customDomain] = await Promise.all([
      this.settings.getLinkMode(),
      this.settings.getAccessChannel(),
      this.settings.get('proxyTimeoutMs', '15000'),
      this.settings.get('proxyCacheSeconds', '86400'),
      this.settings.get('dedupEnabled', 'false'),
      this.settings.get('dedupScope', 'all'),
      this.settings.getCustomDomain(),
    ]);
    /*
     * 全局主/备渠道概览 —— 统一走 StorageChannelService.getStorageChannel('', type)，
     * 不再各自 find(c => c.isMain)。统一入口会跳过已禁用渠道并保持同一兜底顺序。
     */
    const pickBrief = (c: StorageChannelInfo | null) =>
      c ? { id: c.id, code: c.code, name: c.name, type: c.type, enabled: true } : null;
    return {
      linkMode,
      accessChannel,
      proxyTimeoutMs: Number(proxyTimeoutMs) || 15000,
      proxyCacheSeconds: Number(proxyCacheSeconds) || 86400,
      dedupEnabled: dedupEnabled === 'true',
      dedupScope: dedupScope === 'channel' ? 'channel' : 'all',
      customDomain,
      mainChannel: pickBrief(await this.storageChannel.getStorageChannel('', 'main')),
      backupChannel: pickBrief(await this.storageChannel.getStorageChannel('', 'backup')),
    };
  }

  /** 保存分发设置（仅保存传入字段） */
  @Post()
  async save(
    @Body()
    body: {
      linkMode?: string;
      accessChannel?: string;
      proxyTimeoutMs?: number;
      proxyCacheSeconds?: number;
      dedupEnabled?: boolean;
      dedupScope?: string;
      customDomain?: string;
    },
  ) {
    if (body.linkMode !== undefined) {
      const v = body.linkMode === 'redirect' ? 'redirect' : 'proxy';
      await this.settings.set('linkMode', v);
    }
    if (body.accessChannel !== undefined) {
      await this.settings.set('accessChannel', body.accessChannel === 'backup' ? 'backup' : 'main');
    }
    if (body.proxyTimeoutMs !== undefined) {
      const n = Math.min(120000, Math.max(1000, Number(body.proxyTimeoutMs) || 15000));
      await this.settings.set('proxyTimeoutMs', String(n));
    }
    if (body.proxyCacheSeconds !== undefined) {
      const n = Math.max(0, Number(body.proxyCacheSeconds) || 0);
      await this.settings.set('proxyCacheSeconds', String(n));
    }
    if (body.dedupEnabled !== undefined) {
      await this.settings.set('dedupEnabled', body.dedupEnabled ? 'true' : 'false');
    }
    if (body.dedupScope !== undefined) {
      await this.settings.set('dedupScope', body.dedupScope === 'channel' ? 'channel' : 'all');
    }
    if (body.customDomain !== undefined) {
      // 统一去掉首尾空白与结尾斜杠；允许带协议，未带协议时前端拼接时按 http(s) 处理
      const dom = String(body.customDomain || '').trim().replace(/\/+$/, '');
      await this.settings.set('customDomain', dom);
    }
    return { success: true };
  }
}

@Controller('api/manage/channels')
@UseGuards(AdminGuard)
export class ChannelManageController {
  constructor(private svc: ChannelsService) {}

  /**
   * 管理端渠道列表 —— 按类型分组返回（含已禁用渠道），config 已脱敏。
   * 形状与 /api/channels 一致，便于前端复用同一套渲染逻辑。
   */
  @Get()
  async list() {
    const channels = await prisma.channel.findMany({
      // 统一排序：渠道类型编号升序 → 渠道 ID 升序（前端下拉直接复用此顺序）
      orderBy: CHANNEL_ORDER_BY,
    });
    // 各渠道已用容量（按文件副本 size 累加）—— 供卡片上的容量进度条使用
    const copies = await prisma.fileCopy.findMany({
      where: { status: 'active' },
      include: { file: { select: { size: true } } },
    });
    const usageMB = new Map<string, number>();
    for (const c of copies) {
      usageMB.set(c.channelId, (usageMB.get(c.channelId) || 0) + (c.file?.size || 0) / 1024 / 1024);
    }

    const grouped: Record<string, unknown[]> = {};
    // 分组顺序同样按类型编号排（前端设置页按 key 顺序渲染分组标题）
    const addable = [...CHANNEL_TYPES].sort((a, b) => channelTypeCode(a) - channelTypeCode(b));
    for (const type of addable) grouped[type] = [];
    // 内置类型（本地存储）排在最后
    for (const type of BUILTIN_CHANNEL_TYPES) grouped[type] = [];
    for (const c of channels) {
      const config = this.svc.maskConfig(c.type, c.config);
      (grouped[c.type] ||= []).push({
        id: c.id,
        code: c.code, // 6 位渠道 ID（内部识别用，创建后不变）
        name: c.name,
        type: c.type,
        typeCode: c.typeCode, // 渠道类型编号（排序依据）
        enabled: c.enabled,
        isMain: c.isMain,
        isBackup: c.isBackup,
        sortOrder: c.sortOrder,
        config,
        quota: {
          enabled: config.quotaEnabled === 'true',
          limitGB: Number(config.quotaLimitGB) || 10,
          threshold: Number(config.quotaThreshold) || 95,
          usedMB: Math.round((usageMB.get(c.id) || 0) * 100) / 100,
        },
      });
    }
    return grouped;
  }

  /**
   * 编辑渠道用：返回**解密后的完整配置**（含明文密钥）。
   *
   * 列表接口出于安全只回脱敏值（形如 `AKID****1234`），编辑弹窗点开「小眼睛」
   * 也只能看到这个掩码。管理端本身就有权查看与修改凭据，故编辑时单独拉一次明文回填，
   * 让「小眼睛」真的能看到完整值（保存时后端照旧重新加密写库）。
   */
  @Get(':id/plain')
  async plain(@Param('id') id: string) {
    const c = await prisma.channel.findUnique({ where: { id } });
    if (!c) return { success: false, message: '渠道不存在' };
    return { success: true, type: c.type, config: this.svc.decryptConfig(c.type, c.config) };
  }

  /** 主渠道 / 备份渠道各自唯一：置位时清掉其它记录的同一标记 */
  private async enforceUniqueFlags(id: string | null, isMain?: boolean, isBackup?: boolean) {
    if (isMain) {
      await prisma.channel.updateMany({
        where: id ? { isMain: true, NOT: { id } } : { isMain: true },
        data: { isMain: false },
      });
    }
    if (isBackup) {
      await prisma.channel.updateMany({
        where: id ? { isBackup: true, NOT: { id } } : { isBackup: true },
        data: { isBackup: false },
      });
    }
  }

  /** 备份渠道允许与主渠道同类型，但不允许同账户（配置身份字段一致） */
  private async sameAccountAsMain(type: string, selfId: string | null, identity: string): Promise<string | null> {
    const main = await prisma.channel.findFirst({ where: { isMain: true, NOT: selfId ? { id: selfId } : undefined } });
    if (!main) return null;
    if (this.svc.identityOf(main.type, main.config) === identity) {
      return `备份渠道不能与主渠道「${main.name}」使用同一账户`;
    }
    return null;
  }

  /**
   * 生成唯一的 6 位数字渠道 ID（内部识别用；渠道名可改，ID 不变）。
   * 必须避开 LOCAL_CHANNEL_CODE（999999）—— 那是内置本地存储的固定 ID，
   * 一旦被普通渠道占用，启动时的幂等修复会把它的类型改写成 local。
   */
  private async nextCode(): Promise<string> {
    for (let i = 0; i < 60; i++) {
      const code = String(100000 + Math.floor(Math.random() * 899000));
      if (code === LOCAL_CHANNEL_CODE) continue;
      if (!(await prisma.channel.findUnique({ where: { code } }))) return code;
    }
    const fallback = String(Date.now()).slice(-6);
    return fallback === LOCAL_CHANNEL_CODE ? '100001' : fallback;
  }

  @Post()
  async create(@Body() body: { name: string; type: string; config?: Record<string, string>; isMain?: boolean; isBackup?: boolean }) {
    if (!CHANNEL_TYPES.includes(body.type as (typeof CHANNEL_TYPES)[number])) {
      return { success: false, message: `不支持的渠道类型: ${body.type}` };
    }
    if (!body.name || !String(body.name).trim()) {
      return { success: false, message: '渠道名称不能为空' };
    }
    if (body.isBackup && body.isMain) {
      return { success: false, message: '同一条渠道不能同时作为主渠道和备份渠道' };
    }
    const dup = await prisma.channel.findFirst({ where: { name: body.name } });
    if (dup) return { success: false, message: `渠道名称「${body.name}」已存在` };

    const raw = body.config || {};
    if (body.isBackup) {
      const err = await this.sameAccountAsMain(body.type, null, channelIdentity(body.type, raw));
      if (err) return { success: false, message: err };
    }

    const encrypted: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      encrypted[k] = SECRET_FIELDS[body.type]?.includes(k) ? CryptoService.encrypt(String(v)) : String(v);
    }
    const ch = await prisma.channel.create({
      data: {
        name: body.name,
        type: body.type,
        typeCode: channelTypeCode(body.type), // 渠道类型编号（排序依据，创建时固化）
        config: JSON.stringify(encrypted),
        isMain: !!body.isMain,
        isBackup: !!body.isBackup,
        code: await this.nextCode(),
      },
    });
    await this.enforceUniqueFlags(ch.id, body.isMain, body.isBackup);
    return { success: true, data: { id: ch.id, code: ch.code } };
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; config?: Record<string, string>; enabled?: boolean; isMain?: boolean; isBackup?: boolean },
  ) {
    const ch = await prisma.channel.findUnique({ where: { id } });
    if (!ch) return { success: false, message: '渠道不存在' };
    if (body.isMain && body.isBackup) {
      return { success: false, message: '同一条渠道不能同时作为主渠道和备份渠道' };
    }
    // 渠道名可修改，但不允许与其它渠道重名
    if (body.name !== undefined && String(body.name).trim() !== ch.name) {
      const name = String(body.name).trim();
      if (!name) return { success: false, message: '渠道名称不能为空' };
      const dup = await prisma.channel.findFirst({ where: { name, NOT: { id } } });
      if (dup) return { success: false, message: `渠道名称「${name}」已存在` };
    }
    // 脱敏值（含 ****）不覆盖原密文
    const old = this.svc.decryptConfig(ch.type, ch.config);
    const merged: Record<string, string> = { ...old };
    for (const [k, v] of Object.entries(body.config || {})) {
      if (String(v).includes('****')) continue;
      merged[k] = v;
    }
    if (body.isBackup) {
      const err = await this.sameAccountAsMain(ch.type, id, channelIdentity(ch.type, merged));
      if (err) return { success: false, message: err };
    }
    const encrypted: Record<string, string> = {};
    for (const [k, v] of Object.entries(merged)) {
      encrypted[k] = SECRET_FIELDS[ch.type]?.includes(k) ? CryptoService.encrypt(v) : v;
    }
    await prisma.channel.update({
      where: { id },
      data: {
        name: body.name !== undefined ? String(body.name).trim() : ch.name,
        enabled: body.enabled ?? ch.enabled,
        isMain: body.isMain ?? ch.isMain,
        isBackup: body.isBackup ?? ch.isBackup,
        config: JSON.stringify(encrypted),
      },
    });
    await this.enforceUniqueFlags(id, body.isMain, body.isBackup);
    return { success: true };
  }

  /**
   * 渠道连通性测试 —— 真实上传一张 512x512 测试图并立即删除。
   * （用 512×512 而非 1×1：部分图床如 EasyImages 会以「图片高度太小」拒绝。）
   * 传 id：测已保存的渠道（用户新填的值若不含掩码则覆盖）；
   * 不传 id：测尚未保存的表单配置（新增渠道时的「测试连接」）。
   */
  @Post('test')
  async test(@Body() body: { id?: string; type?: string; config?: Record<string, string> }) {
    let type = body.type || '';
    let cfg: Record<string, string> = {};

    if (body.id) {
      const ch = await prisma.channel.findUnique({ where: { id: body.id } });
      if (!ch) return { success: false, message: '渠道不存在' };
      type = ch.type;
      cfg = this.svc.decryptConfig(ch.type, ch.config);
      for (const [k, v] of Object.entries(body.config || {})) {
        if (String(v).includes('****')) continue; // 掩码值不覆盖已存密文
        cfg[k] = v;
      }
    } else {
      cfg = body.config || {};
    }

    if (!CHANNEL_TYPES.includes(type as (typeof CHANNEL_TYPES)[number])) {
      return { success: false, message: `不支持的渠道类型: ${type || '(空)'}` };
    }

    const info: ChannelInfo = { id: body.id || 'channel-test', name: '连接测试', type, config: cfg, metas: {} };
    const key = `go-imgbed-test-${Date.now()}.png`;
    const png = await makeTestPng();

    const started = Date.now();
    try {
      const adapter = createAdapter(info);
      const res = await adapter.upload({ buffer: png, mime: 'image/png', originalName: 'test.png' }, key, info);
      const url = adapter.buildDirectUrl(
        { remoteKey: res.remoteKey, remoteUrl: res.remoteUrl || '', metas: {} },
        info,
      );
      // 清理测试文件（平台不支持删除时不影响判定）
      let cleaned = true;
      try {
        await adapter.delete({ remoteKey: res.remoteKey, remoteUrl: res.remoteUrl || '', metas: {} }, info);
      } catch {
        cleaned = false;
      }
      return {
        success: true,
        data: { url, key: res.remoteKey, cleaned, elapsedMs: Date.now() - started },
        message: cleaned ? '上传成功，测试文件已清理' : '上传成功（该渠道未配置删除接口，测试文件可能残留）',
      };
    } catch (err) {
      return { success: false, message: (err as Error).message, data: { elapsedMs: Date.now() - started } };
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    // 内置渠道（本地存储）不允许删除：它是「零配置可用」的兜底落盘位置
    const target = await prisma.channel.findUnique({ where: { id } });
    if (target && (BUILTIN_CHANNEL_TYPES as readonly string[]).includes(target.type)) {
      return { success: false, message: '本地存储是系统内置渠道，不能删除（可以禁用以停用）' };
    }
    const copies = await prisma.fileCopy.count({ where: { channelId: id } });
    if (copies > 0) {
      return { success: false, message: `该渠道仍有 ${copies} 个文件副本，请先迁移或清理` };
    }
    await prisma.channel.delete({ where: { id } });
    return { success: true };
  }
}
