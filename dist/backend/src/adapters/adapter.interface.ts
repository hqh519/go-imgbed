/**
 * 存储适配器统一接口 —— 策略模式核心。
 * 所有渠道实现同一接口，新增渠道 = 新增一个文件。
 *
 * 关键约定：upload 返回 remoteKey（资源的不可变标识）；
 * 直链 URL 不落库，访问时由 buildDirectUrl 按「渠道当前配置」动态构造
 * —— 渠道配置里的域名/桶变更后，存量外链自动跟随（302 分发层实时调用）。
 */
export interface ChannelInfo {
  id: string;
  name: string;
  type: string;
  /** 已解密的配置（服务端内部使用） */
  config: Record<string, string>;
  metas: Record<string, unknown>;
}

export interface CopyInfo {
  remoteKey: string;
  remoteUrl: string; // 仅 custom 渠道兜底用
  metas: Record<string, unknown>;
}

export interface UploadResult {
  remoteKey: string;
  /** 仅当渠道无法用 key 构造 URL 时填写（custom 渠道兜底） */
  remoteUrl?: string;
  metas?: Record<string, unknown>;
}

export interface StorageAdapter {
  /** 上传文件，返回渠道内资源标识 */
  upload(file: { buffer: Buffer; mime: string; originalName: string }, key: string, channel: ChannelInfo): Promise<UploadResult>;
  /** 删除渠道内资源 */
  delete(copy: CopyInfo, channel: ChannelInfo): Promise<void>;
  /** 按渠道当前配置构造直链（返回 null 表示无法构造） */
  buildDirectUrl(copy: CopyInfo, channel: ChannelInfo): string | null;
}

export class AdapterError extends Error {
  constructor(message: string, public readonly channelType: string) {
    super(`[${channelType}] ${message}`);
  }
}
