/**
 * 渠道可见性 / 用户授权（v202610221824）。
 *
 * 规则（需求约定）：
 *   - 管理员：全部渠道可见可用；
 *   - 普通用户：内置「本地存储」在授权名单为空时恒可用（零配置兜底），
 *     名单非空后与其它渠道一致 —— 只有勾选过的账户才可见、可上传（v2.6.0）；
 *     其余渠道必须在渠道编辑页的「用户授权」里被勾选才可见、可上传；
 *   - 未登录：只给未设授权的本地存储，避免匿名者枚举出全部渠道。
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
  const list = parseAuthorizedUsers(raw);
  // v2.6.0：本地存储渠道也支持「用户授权」——名单为空时保持零配置兜底
  // （对所有账户可见，兼容历史行为），名单非空后与其它渠道规则一致。
  if (type === 'local' && list.length === 0) return true;
  if (!username) return false;
  return list.includes(username);
}
