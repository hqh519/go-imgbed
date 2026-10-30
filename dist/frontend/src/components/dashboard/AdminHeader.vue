<template>
    <header class="admin-header-spacer" :class="{ 'has-search': !!$slots.search }" :style="{ '--admin-header-reserved-space': reservedSpace }">
        <div ref="headerContent" class="admin-header-content" :class="{ 'is-scroll-hidden': scrollHidden, 'is-scrolled': headerScrolled }" :style="{ '--admin-header-scroll-progress': headerScrollProgress }">
            <DashboardTabs :active-tab="activeTab" />
            <div class="admin-header-tools">
                <div v-if="$slots.search" class="admin-header-search">
                    <slot name="search" />
                </div>
                <AdminHeaderActions
                    :show-link-format="showLinkFormat"
                    :disable-tooltip="isMobile"
                    :is-mobile="isMobile"
                    @link-format="$emit('link-format')"
                    @logout="handleLogout"
                />
            </div>
        </div>
    </header>
</template>

<script>
import DashboardTabs from '@/components/DashboardTabs.vue';
import AdminHeaderActions from './AdminHeaderActions.vue';
import { OverlayScrollbars } from 'overlayscrollbars';

export default {
    name: 'AdminHeader',
    components: { DashboardTabs, AdminHeaderActions },
    props: {
        activeTab: { type: String, default: 'dashboard' },
        showLinkFormat: Boolean
    },
    emits: ['link-format'],
    data() {
        return {
            // v20261027：移动端判定阈值 768 → 1024 —— 平板（含竖屏）同样使用
            // 「第一行右侧按钮组 + 更多菜单 / 第二行搜索框 + 筛选」的紧凑顶栏
            isMobile: window.innerWidth <= 1024,
            reservedSpace: null,
            headerScrollProgress: 0,
            // v2.8.5：移动端顶栏背景「有/无」两态标记 —— 只做整档切换，不做透明度渐变
            headerScrolled: false,
            // 滚动方向：向下滚 → 顶栏上滑隐藏；向上滚 → 立刻显示（与移动端侧边菜单一致）
            scrollHidden: false,
            lastScrollY: 0
        };
    },
    methods: {
        getHeaderScrollElements() {
            return OverlayScrollbars(document.body)?.elements();
        },
        getHeaderScrollPosition() {
            const scroller = this.getHeaderScrollElements()?.scrollOffsetElement || document.scrollingElement;
            return Math.max(0, scroller?.scrollTop || 0);
        },
        updateHeaderScrollProgress() {
            const scroller = this.getHeaderScrollElements()?.scrollOffsetElement || document.scrollingElement;
            const y = Math.max(0, scroller?.scrollTop || 0);
            this.headerScrollProgress = Math.min(y / 80, 1);
            this.headerScrolled = y > 0;
            this.updateScrollHidden(y, scroller);
        },
        /**
         * 顶栏滚动显隐（纯方向驱动，不再有「到页面底部就强制显示」的行为）：
         *   页面向上滚动 → 显示
         *   页面向下滚动（且已离开顶部 40px）→ 隐藏
         * 页面本身不可滚动（内容不足一屏）时永远显示。
         */
        updateScrollHidden(y, _scroller) {
            const delta = y - this.lastScrollY;
            // 小于 2px 的抖动不改变状态，避免触控板惯性滚动时顶栏闪烁
            if (Math.abs(delta) < 2) return;
            this.lastScrollY = y;
            this.scrollHidden = !(y <= 40 || delta < 0);
        },
        handleHeaderScroll(event) {
            const elements = this.getHeaderScrollElements();
            // 弹窗、表格等内部滚动不改变页面顶栏。
            if (![document, window, document.scrollingElement, elements?.scrollEventElement, elements?.scrollOffsetElement].includes(event.target)) return;
            if (this.headerScrollFrame !== null) return;
            this.headerScrollFrame = requestAnimationFrame(() => {
                this.headerScrollFrame = null;
                this.updateHeaderScrollProgress();
            });
        },
        updateViewport() {
            // v20261027：与 isMobile 初始值同步，阈值 768 → 1024（平板也走紧凑顶栏）
            this.isMobile = window.innerWidth <= 1024;
            this.updateHeaderScrollProgress();
            this.measureReservedSpace();
        },
        measureReservedSpace() {
            const header = this.$refs.headerContent;
            this.reservedSpace = `${header.offsetTop + header.offsetHeight + 12}px`;
        },
        handleLogout() {
            const url = '/api/auth/logout';
            fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authType: 'admin' })
            }).finally(() => {
                this.$store.commit('setAdminLoggedIn', false);
                this.$router.push('/adminLogin');
            });
        }
    },
    mounted() {
        this.headerScrollFrame = null;
        this.updateHeaderScrollProgress();
        document.addEventListener('scroll', this.handleHeaderScroll, { capture: true, passive: true });
        this.measureReservedSpace();
        this.headerResizeObserver = new ResizeObserver(this.measureReservedSpace);
        this.headerResizeObserver.observe(this.$refs.headerContent);
        window.addEventListener('resize', this.updateViewport, { passive: true });
    },
    beforeUnmount() {
        document.removeEventListener('scroll', this.handleHeaderScroll, true);
        if (this.headerScrollFrame !== null) cancelAnimationFrame(this.headerScrollFrame);
        this.headerResizeObserver.disconnect();
        window.removeEventListener('resize', this.updateViewport);
    }
};
</script>

<style scoped>
.admin-header-spacer {
    height: 60px;
    flex: 0 0 auto;
}

.admin-header-tools {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
    margin-left: auto;
}

.admin-header-search {
    display: flex;
    align-items: center;
    min-width: 0;
}

.admin-header-search :deep(.filter-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--admin-header-action-size, 32px);
    height: var(--admin-header-action-size, 32px);
    font-size: var(--admin-header-action-font-size, 20px);
}

.admin-header-search :deep(.filter-trigger .header-icon) {
    width: 1em;
    height: 1em;
    font-size: inherit;
}

.admin-header-search :deep(.filter-badge) {
    display: inline-flex;
    align-items: center;
}

/*
 * v2.8.5：两行布局断点 1024 → 1023 —— 平板横屏（宽 1024 起）改回 PC 单行布局，
 *          平板竖屏（768）与手机继续使用两行紧凑布局：
 *   第一行右侧：标签筛选 / 刷新 / 回收站 / 更多菜单（靠右对齐）
 *   第二行：搜索框（宽度 90%）+ 筛选按钮（跟在搜索框后面）
 */
@media (max-width: 1023px) {
    .admin-header-spacer {
        height: var(--admin-header-reserved-space, 76px);
    }

    .admin-header-spacer.has-search {
        height: var(--admin-header-reserved-space, 114px);
    }

    /*
     * v2.6.0 #302：搜索区打平（display: contents），
     * 让 标签/刷新/回收站 上移到第一行（与「更多菜单」同行），
     * 搜索框 + 筛选留在第二行且搜索框加长（flex 占满剩余宽度）。
     * v2.8.0 #C16：标签/刷新/回收站 三个按钮靠拢到右侧「更多菜单」旁边
     * （第一个按钮 margin-left:auto 整组推右，「更多菜单」不再独自推右）。
     */
    .admin-header-search {
        display: contents;
    }

    .admin-header-content :deep(.search-area) {
        display: contents;
    }

    /* 第一行右侧组：标签 / 刷新 / 回收站（margin-left:auto 只加在第一个，整组靠右） */
    .admin-header-content :deep(.tag-filter-badge) {
        order: 1;
        margin-left: auto;
    }

    .admin-header-content :deep(.refresh-files-btn) {
        order: 1;
    }

    /* 第二行：搜索框 + 筛选按钮（跟在「更多菜单」下一行）。
       v20261027：flex-basis 用 calc(90% - 46px) —— 46px = 筛选按钮 32px + 间距 14px。
       平板宽度下一行能装下所有元素，basis:auto 不会换行，用大基数强制搜索框
       独占第二行；手机窄屏下搜索框自动收缩，保证筛选按钮始终与搜索框同行
       （第二行整体 ≈ 90% 宽度：搜索框占满 90%，剩余位置给筛选按钮）。 */
    .admin-header-content :deep(.search-card) {
        order: 3;
        flex: 1 1 calc(90% - 46px);
        min-width: 0;
        max-width: 90%;
    }

    .admin-header-content :deep(.search-card :deep(.el-input)) {
        width: 100%;
    }

    /*
     * v2.8.9：移动端顶行顺序调整为「搜索 筛选 → 刷新 回收站 → 更多」——
     * 搜索 / 筛选按钮 order 提前到刷新组之前，间距收紧（margin 4px），
     * 保证五个按钮一行显示完整；刷新组保持 margin-left:auto 靠右。
     */
    .admin-header-content :deep(.search-area > .mobile-search-trigger),
    .admin-header-content :deep(.search-area > .filter-trigger) {
        order: 1;
        flex: 0 0 auto;
        margin-left: 0;
        margin-right: 4px;
    }

    .admin-header-content :deep(.search-area > *:not(.search-card):not(.tag-filter-badge):not(.refresh-files-btn):not(.dashboard-header-buttons):not(.filter-trigger):not(.mobile-search-trigger)) {
        order: 4;
        flex: 0 0 auto;
        margin-left: 8px;
    }

    /*
     * v2.8.8：后台文件管理顶栏「刷新 / 回收站 / 声音」整组靠右。
     * 之前这三个按钮和「更多菜单」之间没有任何推右元素（本页没有标签筛选按钮），
     * 移动端会挤在顶行中间。这里用 margin-left:auto 把整组连同其后的
     * 「更多菜单」一起顶到右侧，形成「…… 刷新 回收站 声音 更多」的右对齐排列。
     */
    .admin-header-content :deep(.search-area > .dashboard-header-buttons) {
        order: 2;
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    /* 容器内已有 6px 间距，去掉按钮自带的 2px 左边距，避免桌面/移动端间距不一致 */
    .admin-header-content :deep(.dashboard-header-buttons .refresh-files-btn) {
        margin-left: 0;
    }

    .admin-header-tools {
        display: contents;
    }

    .admin-header-content :deep(.admin-header-actions) {
        order: 2;
        /* v2.8.0 #C16：去掉 margin-left:auto —— 由标签筛选按钮负责推右，
           让 标签/刷新/回收站 与「更多菜单」紧靠成组 */
    }

    /*
     * v2.8.0 #C17：移动端顶行滚动抖动移除 ——
     * 顶栏宽度和内边距原本随滚动进度连续变化（gutter / padding 过渡），
     * 移动端改为固定值并关闭过渡，滚动时顶行完全静止、跟随页面。
     */
    .admin-header-content {
        --admin-header-gutter: 4px;
        width: calc(100% - 8px);
        transition: none;
    }
    .admin-header-content::before {
        transition: none;
    }
}

.admin-header-content {
    --admin-header-gutter: calc(8px + (clamp(12px, 2.5vw, 48px) - 8px) * var(--admin-header-scroll-progress, 0));
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    min-height: 45px;
    padding: 10px calc(12px + (clamp(12px, 1.5vw, 24px) - 12px) * var(--admin-header-scroll-progress, 0));
    position: fixed;
    top: 8px;
    left: 50%;
    width: calc(100% - var(--admin-header-gutter) * 2);
    z-index: 2001;
    border: 1px solid transparent;
    border-radius: 16px;
    transform: translateX(-50%);
    transition: width 0.15s ease, padding-inline 0.15s ease, transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

/* 向下滚动时顶栏整体上滑隐藏（保留占位高度，避免内容跳动） */
.admin-header-content.is-scroll-hidden {
    transform: translate(-50%, calc(-100% - 14px));
    pointer-events: none;
}

/* 背景单独渐显，文字、控件和下拉菜单始终保持清晰。 */
.admin-header-content::before {
    content: "";
    position: absolute;
    inset: -1px;
    z-index: -1;
    pointer-events: none;
    border: 1px solid var(--glass-border);
    border-radius: inherit;
    background: var(--glass-bg);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.08);
    backdrop-filter: blur(var(--glass-backdrop-blur)) saturate(1.4);
    -webkit-backdrop-filter: blur(var(--glass-backdrop-blur)) saturate(1.4);
    opacity: var(--admin-header-scroll-progress, 0);
    transition: opacity 0.15s ease;
}

/* v2.8.5：紧凑顶栏的尺寸/换行参数覆盖手机与平板竖屏（≤1023） */
@media (max-width: 1023px) {
    .admin-header-content {
        --admin-header-gutter: calc(4px + 8px * var(--admin-header-scroll-progress, 0));
        --admin-header-action-size: 32px;
        --admin-header-action-font-size: 17px;
        --admin-header-action-gap: 4px;
        flex-wrap: wrap;
        top: 6px;
        padding: 6px 8px;
        gap: 4px 6px;
        border-radius: 14px;
    }

    /*
     * v2.8.5：手机 / 平板竖屏顶栏背景改为「无 / 有」两态硬切换。
     * 原来 ::before 的透明度跟着滚动进度 0→1 连续变化，与尺寸过渡叠在一起
     * 就会出现「滚动时顶栏一边缩一边变色」的闪烁感；这里不再跟随进度，
     * 只在页面离开顶部时整块出现，且不做任何过渡。
     */
    .admin-header-content::before {
        opacity: 0;
        transition: none;
    }
    .admin-header-content.is-scrolled::before {
        opacity: 1;
    }
}

@media (max-width: 768px) {
    /* v2.4.0：移动端顶部栏取消粘滞 —— fixed 改 absolute 随页面滚动，
       且不再「下滑隐藏 / 上滑出现」，上下滚动都跟随内容一起走 */
    .admin-header-content {
        position: absolute;
        transform: translateX(-50%) !important;
        /*
         * v2.8.5：移动端彻底去掉滚动带来的「伸缩」感 ——
         * ① 宽度不再随滚动进度从 4px 涨到 12px（--admin-header-gutter 固定）；
         * ② 所有几何过渡（width / padding / transform）关闭，顶栏滚动时完全静止。
         */
        --admin-header-gutter: 4px;
        transition: none !important;
    }
    .admin-header-content.is-scroll-hidden {
        transform: translateX(-50%) !important;
        pointer-events: auto;
    }
}

@media (max-width: 360px) {
    .admin-header-content {
        --admin-header-action-size: 30px;
        --admin-header-action-gap: 2px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .admin-header-content,
    .admin-header-content::before {
        transition: none;
    }
}
</style>
