/**
 * 渠道可见性 / 用户授权（v202610221824）。
 *
 * 规则（需求约定）：
 *   - 管理员：全部渠道可见可用；
 *   - 普通用户：内置「本地存储」恒可用（零配置兜底），其余渠道必须在
 *     渠道编辑页的「用户授权」里被勾选才可见、可上传；
 *   - 未登录：只给本地存储，避免匿名者枚举出全部渠道。
 *
 * 放在 common 层是为了让 channels.controller 与 storage-channel.service 共用，
 * 避免两者互相 import 造成循环依赖。
 */

/** 解析渠道的授权用户列表（容错：脏数据按空数组处理） */
export function parseAuthorizedUsers(raw: string | undefined | null): string[] {
  try {
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** 该渠道对某账户是否可见 / 可用 */
export function channelVisibleTo(
  raw: string | undefined | null,
  type: string,
  username: string,
  admin: boolean,
): boolean {
  if (admin) return true;
  if (type === 'local') return true;
  if (!username) return false;
  return parseAuthorizedUsers(raw).includes(username);
}
