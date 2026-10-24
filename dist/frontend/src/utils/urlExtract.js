/**
 * v2.5.0（需求 v20261023-2）：从「脏文本」中自动提取有效 URL。
 *
 * 链接模式输入框里可能粘贴进任意内容：分享文案、表情、HTML 代码、markdown、
 * 带括号/引号/中文标点的混合文本 —— 原实现按「整行必须是 URL」校验，
 * 只要行里混了一个字符就整行作废。这里改为全文扫描提取：
 *
 *  1. 全文按 `http(s)://` 起点扫描，URL 在遇到 空白 / 引号 / 尖括号 / 反引号 /
 *     CJK 字符 处终止（HTML 属性、markdown 链接、中文分享文案都能正确截断）；
 *  2. 去掉尾部被一起带上的成对括号、常见中英文标点与表情；
 *  3. 保留原始顺序并去重。
 */

/** URL 终止字符之外的允许集合，这里列出「截断就够」的排除字符 */
const URL_CORE = /[^\s<>"'`\u2018\u2019\u201c\u201d\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g

/** 尾部需要剥离的标点（含全角）与成对括号/引号 —— 必须锚定 $，只剥尾部 */
const TRAILING_PUNCT = /[)\]}'"»】」』）】，。；：！？、…·,.;:!?>]+$/

/** 尾部表情符号（代理对区间） */
const TRAILING_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]+$/u

function trimTrailing(url) {
  let u = url
  // 循环剥离尾部标点 / 表情
  for (;;) {
    const before = u
    u = u.replace(TRAILING_PUNCT, '')
    u = u.replace(TRAILING_EMOJI, '')
    if (u === before) break
  }
  // 右括号配平：URL 内 '(' 数量少于 ')' 时把多余的右括号剥掉
  while (u.endsWith(')')) {
    const open = (u.match(/\(/g) || []).length
    const close = (u.match(/\)/g) || []).length
    if (close > open) u = u.slice(0, -1)
    else break
  }
  return u
}

/**
 * 从任意文本中提取 http/https 链接（去重、保序）。
 * @param {string} text 任意混合文本（可含 HTML / 表情 / markdown）
 * @returns {string[]} 有效 URL 列表
 */
export function extractUrlsFromText(text) {
  if (!text || typeof text !== 'string') return []
  const found = []
  let m
  URL_CORE.lastIndex = 0
  while ((m = URL_CORE.exec(text)) !== null) {
    let raw = m[0]
    // 匹配片段可能以「(」等前缀字符开头（如 “(https://a.com)”）——
    // 在片段内部定位 http:// 起点后再处理
    const schemeIdx = raw.search(/https?:\/\//i)
    if (schemeIdx === -1) continue
    if (schemeIdx > 0) raw = raw.slice(schemeIdx)
    const url = trimTrailing(raw)
    // 至少要有域名部分：scheme://host
    if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url)) continue
    if (!found.includes(url)) found.push(url)
  }
  return found
}

export default extractUrlsFromText
