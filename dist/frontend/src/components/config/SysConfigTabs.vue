<template>
<div class="sidebar-container" ref="sidebar" :class="{ 'is-collapsed': isCollapse, 'is-scroll-hidden': scrollHidden }" :style="sidebarStyle">
    <div class="menu-list">
        <div 
            v-for="item in menuItems" 
            :key="item.index"
            class="menu-item"
            :class="{ 'is-active': activeIndex === item.index }"
            @click="handleSelect(item.index)"
        >
            <span class="menu-icon">
                <font-awesome-icon :icon="item.icon" class="menu-glyph" />
            </span>
            <span class="menu-text">{{ $t(item.titleKey) }}</span>
        </div>
    </div>

    <div class="toggle-button" @click="toggleCollapse">
        <font-awesome-icon :icon="isCollapse ? 'angle-double-right' : 'angle-double-left'"></font-awesome-icon>
    </div>
</div>
</template>

<script>
export default {
name: 'SysConfigTabs',
props: {
    activeIndex: {
        type: String,
        default: 'status'
    },
    isCollapse: {
        type: Boolean,
        default: false
    }
},
data() {
    return {
        expandedWidth: null,
        scrollHidden: false, // 移动端：页面下滑时隐藏悬浮菜单，上滑时显示
        lastScrollY: 0,
        menuItems: [
            { index: 'status', icon: 'chart-bar', titleKey: 'sysConfigTabs.systemStatus' },
            { index: 'upload', icon: 'cloud-upload', titleKey: 'sysConfigTabs.uploadSettings' },
            { index: 'security', icon: 'shield', titleKey: 'sysConfigTabs.securitySettings' },
            { index: 'page', icon: 'pager', titleKey: 'sysConfigTabs.pageSettings' },
            { index: 'others', icon: 'cog', titleKey: 'sysConfigTabs.otherSettings' },
            { index: 'logs', icon: 'list', titleKey: 'sysConfigTabs.systemLogs' }
        ]
    };
},
computed: {
    collapsedWidth() {
        return window.innerWidth <= 768 ? 50 : 56;
    },
    sidebarStyle() {
        if (this.isCollapse) {
            return { width: this.collapsedWidth + 'px' };
        }
        return this.expandedWidth ? { width: this.expandedWidth + 'px' } : {};
    }
},
watch: {
    '$i18n.locale'() {
        this.$nextTick(() => this.measureWidth());
    }
},
methods: {
    toggleCollapse() {
        this.$emit('update:isCollapse', !this.isCollapse);
    },
    checkMobile() {
        // ≤768（手机/手机横屏）：折叠侧边栏，只留图标
        // 769–1023（平板竖屏/小平板）：内容区过窄，同样默认折叠以让出约 100px
        const isNarrow = window.innerWidth <= 1023;
        this.$emit('update:isCollapse', isNarrow);
    },
    handleSelect(index) {
        this.$emit('update:activeIndex', index);
    },
    handlePageScroll() {
        // 仅移动端启用滚动显隐：纯按方向 —— 向下滚隐藏、向上滚显示（不再「到底部强制显示」）
        if (window.innerWidth > 768) {
            this.scrollHidden = false;
            this.lastScrollY = window.scrollY;
            return;
        }
        const y = window.scrollY;
        const delta = y - this.lastScrollY;
        if (Math.abs(delta) < 2) return;
        this.scrollHidden = !(y <= 40 || delta < 0);
        this.lastScrollY = y;
    },
    measureWidth() {
        const el = this.$refs.sidebar;
        if (!el) return;
        // Temporarily expand to measure natural content width
        const prevWidth = el.style.width;
        const prevTransition = el.style.transition;
        const wasCollapsed = el.classList.contains('is-collapsed');
        el.style.transition = 'none';
        if (wasCollapsed) {
            el.classList.remove('is-collapsed');
        }
        el.style.width = 'auto';
        // Force reflow to apply changes
        void el.offsetWidth;
        const natural = el.scrollWidth;
        // Restore original state
        el.style.width = prevWidth;
        if (wasCollapsed) {
            el.classList.add('is-collapsed');
        }
        void el.offsetWidth;
        el.style.transition = prevTransition;
        this.expandedWidth = natural;
    },
},
mounted() {
    this.checkMobile();
    this.$nextTick(() => this.measureWidth());
    window.addEventListener('resize', this.checkMobile);
    window.addEventListener('scroll', this.handlePageScroll, { passive: true });
},
beforeUnmount() {
    window.removeEventListener('resize', this.checkMobile);
    window.removeEventListener('scroll', this.handlePageScroll);
}
};
</script>

<style scoped>
.sidebar-container {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 50%;
    left: 8px;
    transform: translateY(-50%);
    z-index: 2001;
    max-width: 200px;
    /* macOS 风格毛玻璃效果 */
    background: var(--glass-bg);
    backdrop-filter: blur(12px) saturate(1.4);
    -webkit-backdrop-filter: blur(12px) saturate(1.4);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    box-shadow: none;
    transition: width 0.3s ease, box-shadow 0.3s ease, transform 0.28s ease;
    overflow: hidden;
}

/* 移动端滚动显隐：页面下滑时整体滑出屏幕左侧 */
.sidebar-container.is-scroll-hidden {
    transform: translateY(-50%) translateX(-130%);
    pointer-events: none;
}

.sidebar-container.is-collapsed {
    width: 56px;
}

.menu-list {
    padding: 8px;
}

.menu-item {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0 12px 0 0;
    height: 42px;
    box-sizing: border-box;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
    color: var(--admin-container-color, #333);
    gap: 0;
    overflow: hidden;
}

.menu-item:hover {
    background: color-mix(in srgb, var(--el-text-color-primary) 6%, transparent);
}

html.dark .menu-item:hover {
    background: color-mix(in srgb, var(--el-text-color-primary) 10%, transparent);
}

.menu-item.is-active {
    background: color-mix(in srgb, var(--primary-color) 20%, transparent);
    color: var(--primary-color);
}

html.dark .menu-item.is-active {
    background: color-mix(in srgb, var(--primary-color) 30%, transparent);
    color: var(--el-text-color-primary);
}

.menu-icon {
    display: grid;
    place-items: center;
    width: 40px;
    min-width: 40px;
    height: 20px;
    font-size: 16px;
    flex-shrink: 0;
    line-height: 1;
}

.menu-icon > .menu-glyph {
    display: block;
    width: 16px;
    height: 16px;
}

.menu-text {
    display: flex;
    align-items: center;
    height: 20px;
    line-height: 20px;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    opacity: 1;
    transition: opacity 0.2s ease 0.05s, max-width 0.25s ease;
}

.sidebar-container.is-collapsed .menu-text {
    opacity: 0;
    max-width: 0;
    transition: opacity 0.1s ease, max-width 0.2s ease;
}

/* 收起态：图标在剩余空间内严格居中，保证图标左右间距一致 */
.sidebar-container.is-collapsed .menu-item {
    justify-content: center;
    padding: 0;
}

.sidebar-container.is-collapsed .menu-icon {
    width: 32px;
    min-width: 32px;
}

.toggle-button {
    padding: 12px;
    text-align: center;
    cursor: pointer;
    border-top: 1px solid color-mix(in srgb, var(--el-text-color-primary) 8%, transparent);
    transition: all 0.2s ease;
    color: var(--admin-container-color, #333);
}

html.dark .toggle-button {
    border-top: 1px solid color-mix(in srgb, var(--el-text-color-primary) 8%, transparent);
}

.toggle-button:hover {
    background: color-mix(in srgb, var(--el-text-color-primary) 10%, transparent);
}

html.dark .toggle-button:hover {
    background: color-mix(in srgb, var(--el-text-color-primary) 6%, transparent);
}

/* 移动端：整体缩小并悬浮在内容之上（内容区不再为它让出宽度） */
@media (max-width: 768px) {
    .sidebar-container {
        left: 2px;
        max-width: 150px;
        border-radius: 12px;
    }
    
    .sidebar-container.is-collapsed {
        width: 42px;
    }

    .menu-list {
        padding: 5px;
    }

    .menu-item {
        height: 36px;
        padding: 0 6px 0 0;
        border-radius: 8px;
    }
    
    .menu-icon {
        width: 30px;
        min-width: 30px;
    }

    .toggle-button {
        padding: 8px;
        font-size: 13px;
    }
    }
</style>
