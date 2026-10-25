/**
 * 移动端返回键优先关弹窗（v2.3.0）
 *
 * 需求：移动端任何页面打开弹窗时，返回键先关弹窗；没有弹窗才执行真正的返回。
 *
 * 实现思路（不侵入任何业务组件）：
 *   1) 用 MutationObserver 盯 body 的直接子节点 —— Element Plus 的弹窗 / 抽屉 /
 *      消息框都会把自己的 `.el-overlay` 挂在 body 上；
 *   2) 第一个弹窗出现时，往历史里 push 一个「哨兵」条目（URL 不变）；
 *      这样用户按返回键只会退掉哨兵、触发 popstate，不会真的离开页面；
 *   3) popstate 时若还有可见弹窗 → 关掉最上面那个，并补回哨兵（支持多层叠加）；
 *   4) 弹窗被页面自己关掉时，把哨兵 pop 掉（history.back()），
 *      否则用户下次要按两下返回才有反应。
 *
 * 只在窄屏（<=768px，即移动端布局）启用，桌面端返回键行为完全不变。
 *
 * v2.6.0 完善：关闭浮层前在 window 上打 `__goimgbedBackGuardAt` 时间戳标记；
 * 路由守卫（如 2FA 弹窗 settleTotp）凭「标记时间 < 500ms」识别返回键关闭，
 * 只终止本次导航（next(false)），不再同时执行回首页/页面回退。
 */

const MOBILE_MAX_WIDTH = 768

function isMobile() {
    try {
        return window.innerWidth <= MOBILE_MAX_WIDTH
    } catch (e) {
        return false
    }
}

/** body 下所有还显示着的 Element Plus 浮层（弹窗 / 抽屉 / MessageBox） */
function visibleOverlays() {
    const list = Array.from(document.querySelectorAll('.el-overlay'))
    return list.filter((el) => {
        if (!el || !el.isConnected) return false
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        // 关闭动画期间仍留在 DOM 里，用是否有渲染盒子兜底
        return el.getClientRects().length > 0
    })
}

/** 关掉最上面的浮层：优先点它自己的关闭按钮，其次发一次 ESC */
function closeTopOverlay() {
    const list = visibleOverlays()
    const top = list[list.length - 1]
    if (!top) return false
    // v2.6.0：给业务侧留一个「本次关闭来自返回键」的标记，
    // 供路由守卫等逻辑区分「用户主动取消」与「返回键关闭」——
    // 返回键只关弹窗，不允许同时再触发页面回退/重定向。
    try {
        window.__goimgbedBackGuardAt = Date.now()
    } catch (e) { /* 忽略 */ }
    const btn = top.querySelector(
        '.el-dialog__headerbtn, .el-message-box__headerbtn, .el-drawer__close-btn, .el-dialog__close'
    )
    if (btn) {
        btn.click()
        return true
    }
    // 没有关闭按钮（如 :show-close="false"）：请 Element Plus 按 ESC 逻辑处理，
    // 组件显式关掉了 ESC（close-on-press-escape=false）时它不会响应，
    // 这种弹窗本身就是"必须处理完才能走"，返回键不生效是预期行为。
    const evt = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true
    })
    document.dispatchEvent(evt)
    return true
}

let installed = false

export function setupBackGuard() {
    if (installed || typeof window === 'undefined') return
    if (!isMobile()) return
    installed = true

    /** 历史里是否已经放了哨兵条目 */
    let sentinel = false
    /** 正在自己退哨兵，忽略随之而来的 popstate */
    let selfPopping = false

    const pushSentinel = () => {
        if (sentinel) return
        try {
            window.history.pushState({ __goimgbedModal: 1 }, '', window.location.href)
            sentinel = true
        } catch (e) {
            /* 隐私模式 / 异常环境：退化为不做处理 */
        }
    }

    const popSentinel = () => {
        if (!sentinel) return
        sentinel = false
        selfPopping = true
        try {
            window.history.back()
        } catch (e) {
            selfPopping = false
        }
    }

    const sync = () => {
        if (!isMobile()) return
        const open = visibleOverlays().length > 0
        if (open) {
            pushSentinel()
        } else if (sentinel && !selfPopping) {
            popSentinel()
        }
    }

    window.addEventListener('popstate', () => {
        if (selfPopping) {
            selfPopping = false
            return
        }
        if (!sentinel) return
        // 返回键被按下了：先关弹窗，并把哨兵补回去（多层弹窗逐层关）
        sentinel = false
        if (closeTopOverlay()) {
            // 等关闭动画/组件状态落定后再决定是否补哨兵
            window.setTimeout(() => {
                if (visibleOverlays().length > 0) pushSentinel()
            }, 80)
        }
    })

    // 只在 body 直接子节点增删时同步（浮层都是 append 到 body）
    const observer = new MutationObserver(() => {
        // 让出本次 DOM 变更，避免读到动画中间态
        window.setTimeout(sync, 0)
    })
    observer.observe(document.body, { childList: true })

    // 首屏可能已经有弹窗（例如强制公告），补一次
    window.setTimeout(sync, 200)
}
