<template>
    <header class="admin-header-spacer" :class="{ 'has-search': !!$slots.search }" :style="{ '--admin-header-reserved-space': reservedSpace }">
        <div ref="headerContent" class="admin-header-content" :class="{ 'is-scroll-hidden': scrollHidden }" :style="{ '--admin-header-scroll-progress': headerScrollProgress }">
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
            isMobile: window.innerWidth <= 768,
            reservedSpace: null,
            headerScrollProgress: 0,
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
            this.isMobile = window.innerWidth <= 768;
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

@media (max-width: 768px) {
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

    /* 第二行：搜索框加长占满 + 筛选按钮靠右。
       v2.8.0 #C18：flex-basis 0 + min-width 0 —— 搜索框允许收缩，
       筛选按钮不再被挤到第三行（始终跟随搜索框保持一行）。 */
    .admin-header-content :deep(.search-card) {
        order: 3;
        flex: 1 1 0;
        min-width: 0;
    }

    .admin-header-content :deep(.search-card :deep(.el-input)) {
        width: 100%;
    }

    .admin-header-content :deep(.search-area > .filter-trigger),
    .admin-header-content :deep(.search-area > *:not(.search-card):not(.tag-filter-badge):not(.refresh-files-btn)) {
        order: 4;
        margin-left: auto;
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

@media (max-width: 768px) {
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

    /* v2.4.0：移动端顶部栏取消粘滞 —— fixed 改 absolute 随页面滚动，
       且不再「下滑隐藏 / 上滑出现」，上下滚动都跟随内容一起走 */
    .admin-header-content {
        position: absolute;
        transform: translateX(-50%) !important;
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
