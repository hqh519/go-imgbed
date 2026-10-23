import { AdapterError, ChannelInfo, CopyInfo, StorageAdapter, UploadResult } from './adapter.interface';
import { ensureProtocol } from '../common/endpoint';

/**
 * WebDAV 适配器 —— 接入他人的 WebDAV 网盘当存储（PUT/DELETE/MKCOL）。
 * 注意：这是「WebDAV 作为存储渠道」，与"对外提供 WebDAV 服务"（已砍掉）无关。
 *
 * 配置字段：baseUri / username / password / publicDomain(可选) / directory(可选)
 *
 * baseUri 支持内网 IP / Docker 容器名（如 nas.local:5005/dav、webdav:80/dav）：
 * 缺协议时内网自动按 http、公网按 https；请求由服务端发起，
 * 因此图床自身对外是 https 也能正常用内网地址上传。
 */
export class WebdavAdapter implements StorageAdapter {
  private authHeader(channel: ChannelInfo): string {
    const { username, password } = channel.config;
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  /** 规范化后的 baseUri（已补协议、已去尾斜杠） */
  private baseOf(channel: ChannelInfo): string {
    return ensureProtocol(channel.config.baseUri || '').replace(/\/+$/, '');
  }

  private fullPath(key: string, channel: ChannelInfo): string {
    const base = this.baseOf(channel);
    const dir = (channel.config.directory || '').replace(/^\/+|\/+$/g, '');
    return `${base}/${dir ? dir + '/' : ''}${key}`;
  }

  async upload(file: { buffer: Buffer; mime: string; originalName: string }, key: string, channel: ChannelInfo): Promise<UploadResult> {
    if (!channel.config.baseUri) throw new AdapterError('缺少 baseUri 配置', channel.type);
    const url = this.fullPath(key, channel);
    // 逐级建目录（PUT 对不存在的父目录会 409）
    // 目录来源有两段：固定「存储目录」+ key 自带的对象前缀（{y}/{m}/ 渲染后的 2026/10/），
    // 两段都要建，否则按日期分目录后第一次上传必然 409。
    const base = this.baseOf(channel);
    const dir = (channel.config.directory || '').replace(/^\/+|\/+$/g, '');
    const keyDir = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
    const fullDir = [dir, keyDir].filter(Boolean).join('/');
    if (fullDir) {
      const parts = fullDir.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        const p = `${base}/${parts.slice(0, i).join('/')}`;
        try {
          const r = await fetch(p, { method: 'MKCOL', headers: { Authorization: this.authHeader(channel) } });
          if (!r.ok && r.status !== 405 && r.status !== 301) { /* 已存在等情况忽略 */ }
        } catch { /* 忽略 */ }
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const resp = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: this.authHeader(channel), 'Content-Type': file.mime },
        body: new Uint8Array(file.buffer),
        signal: ctrl.signal,
      });
      if (!resp.ok) throw new AdapterError(`WebDAV PUT 失败: HTTP ${resp.status}`, channel.type);
      return { remoteKey: key };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw new AdapterError(`WebDAV 请求失败: ${(err as Error).message}`, channel.type);
    } finally {
      clearTimeout(timer);
    }
  }

  async delete(copy: CopyInfo, channel: ChannelInfo): Promise<void> {
    const resp = await fetch(this.fullPath(copy.remoteKey, channel), {
      method: 'DELETE',
      headers: { Authorization: this.authHeader(channel) },
    });
    if (!resp.ok && resp.status !== 404) {
      throw new AdapterError(`WebDAV DELETE 失败: HTTP ${resp.status}`, channel.type);
    }
  }

  buildDirectUrl(copy: CopyInfo, channel: ChannelInfo): string | null {
    // 优先自定义公开域名（跟随配置），否则就是 WebDAV 自身地址
    if (channel.config.publicDomain) {
      // 同样支持不写协议的内网地址（如 nas.local:5005）
      const domain = ensureProtocol(channel.config.publicDomain).replace(/\/+$/, '');
      const dir = (channel.config.directory || '').replace(/^\/+|\/+$/g, '');
      return `${domain}/${dir ? dir + '/' : ''}${copy.remoteKey}`;
    }
    return this.fullPath(copy.remoteKey, channel);
  }
}
