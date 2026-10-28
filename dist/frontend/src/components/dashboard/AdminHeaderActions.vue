<template>
    <div class="admin-header-actions">
        <!-- v2.6.0 #302：移动端收纳为单个「更多菜单」（白天黑夜 / 语言 / 链接格式 / 退出登录） -->
        <template v-if="isMobile">
            <el-dropdown trigger="click" popper-class="admin-more-menu-popper" @command="handleMoreCommand">
                <button class="admin-header-control" type="button" :aria-label="$t('login.moreMenu')">
                    <font-awesome-icon icon="ellipsis-v" />
                </button>
                <template #dropdown>
                    <div class="el-dropdown-menu modern-dropdown-menu admin-more-menu" role="group" :aria-label="$t('login.moreMenu')">
                        <button type="button" class="el-dropdown-menu__item" @click="handleMoreCommand('theme')">
                            <font-awesome-icon :icon="themeIcon" class="admin-more-menu-ico" />
                            <span>{{ themeText }}</span>
                        </button>
                        <button type="button" class="el-dropdown-menu__item" @click="handleMoreCommand('lang')">
                            <font-awesome-icon icon="globe" class="admin-more-menu-ico" />
                            <span>{{ langText }}</span>
                        </button>
                        <button v-if="showLinkFormat" type="button" class="el-dropdown-menu__item" @click="handleMoreCommand('link')">
                            <font-awesome-icon icon="link" class="admin-more-menu-ico" />
                            <span>{{ $t('dashboard.linkFormat') }}</span>
                        </button>
                        <div class="admin-more-menu-sep"></div>
                        <button type="button" class="el-dropdown-menu__item is-logout" @click="handleMoreCommand('logout')">
                            <font-awesome-icon icon="sign-out-alt" class="admin-more-menu-ico" />
                            <span>{{ $t('dashboard.logout') }}</span>
                        </button>
                    </div>
                </template>
            </el-dropdown>
        </template>
        <!-- 桌面端：四个独立按钮（保持原样） -->
        <template v-else>
            <AdminToggleDark class="admin-header-control" />
            <LanguageSwitcher class="admin-header-control" />
            <el-tooltip v-if="showLinkFormat" :disabled="disableTooltip" :content="$t('dashboard.linkFormat')" placement="bottom" :show-after="1000">
                <button class="admin-header-control" type="button" :aria-label="$t('dashboard.linkFormat')" @click="$emit('link-format')">
                    <font-awesome-icon icon="link" />
                </button>
            </el-tooltip>
            <el-tooltip :disabled="disableTooltip" :content="$t('dashboard.logout')" placement="bottom" :show-after="1000">
                <button class="admin-header-control" type="button" :aria-label="$t('dashboard.logout')" @click="$emit('logout')">
                    <font-awesome-icon icon="sign-out-alt" />
                </button>
            </el-tooltip>
        </template>
    </div>
</template>

<script>
import AdminToggleDark from './AdminToggleDark.vue';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { setLocale } from '@/locales';
import { writeThemeCookie } from '@/utils/themeCookie';

export default {
    name: 'AdminHeaderActions',
    components: { AdminToggleDark, LanguageSwitcher },
    props: {
        showLinkFormat: Boolean,
        disableTooltip: Boolean,
        // v2.6.0 #302：移动端把四个按钮收进「更多菜单」
        isMobile: Boolean
    },
    emits: ['link-format', 'logout'],
    computed: {
        /** 主题三态：auto（跟随系统）/ light / dark */
        themeMode() {
            if (!this.$store.getters.cusDarkMode) return 'auto';
            return this.$store.getters.useDarkMode ? 'dark' : 'light';
        },
        themeIcon() {
            // 显示下一个模式的图标（与登录页更多菜单一致）
            if (this.themeMode === 'auto') return 'sun';
            if (this.themeMode === 'light') return 'moon';
            return 'adjust';
        },
        themeText() {
            if (this.themeMode === 'auto') return this.$t('theme.lightMode');
            if (this.themeMode === 'light') return this.$t('theme.darkMode');
            return this.$t('theme.autoMode');
        },
        langText() {
            return this.$i18n.locale === 'zh-CN' ? 'English' : '中文';
        }
    },
    methods: {
        handleMoreCommand(cmd) {
            if (cmd === 'theme') {
                // 与 AdminToggleDark 相同的三态循环：亮色 -> 暗色 -> 跟随系统
                if (!this.$store.getters.cusDarkMode) {
                    this.$store.commit('setCusDarkMode', true);
                    this.$store.commit('setUseDarkMode', false);
                    writeThemeCookie('light');
                } else if (!this.$store.getters.useDarkMode) {
                    this.$store.commit('setCusDarkMode', true);
                    this.$store.commit('setUseDarkMode', true);
                    writeThemeCookie('dark');
                } else {
                    this.$store.commit('setCusDarkMode', false);
                    writeThemeCookie('auto');
                }
                return;
            }
            if (cmd === 'lang') {
                setLocale(this.$i18n.locale === 'zh-CN' ? 'en' : 'zh-CN');
                return;
            }
            if (cmd === 'link') {
                this.$emit('link-format');
                return;
            }
            if (cmd === 'logout') {
                this.$emit('logout');
            }
        }
    }
};
</script>

<style scoped>
.admin-header-actions {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: var(--admin-header-action-gap, 8px);
}

.admin-header-control,
.admin-header-actions :deep(#themeToggle) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    box-sizing: border-box;
    width: var(--admin-header-action-size, 32px);
    height: var(--admin-header-action-size, 32px);
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: var(--admin-theme-toggle-color);
    background: transparent !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    font-size: var(--admin-header-action-font-size, 20px);
    cursor: pointer;
    transition: color 0.2s ease;
    --lang-icon-size: 1em;
    --lang-icon-color: currentColor;
}

.admin-header-control:hover {
    color: var(--primary-color-accent);
}

.admin-header-control:focus-visible {
    outline: 2px solid var(--primary-color-accent);
    outline-offset: 2px;
}

.admin-header-actions :deep(.theme_toggle_svg),
.admin-header-actions :deep(.auto-icon) {
    width: 1em;
    height: 1em;
    font-size: inherit !important;
}

/* v2.6.0 #302：更多菜单条目 */
.admin-more-menu {
    min-width: 140px;
}

.admin-more-menu-ico {
    width: 1em;
    text-align: center;
    margin-right: 8px;
}

.admin-more-menu-sep {
    height: 1px;
    margin: 4px 0;
    background: var(--el-border-color-lighter);
}

.admin-more-menu .is-logout {
    color: var(--el-color-danger);
}

@media (prefers-reduced-motion: reduce) {
    .admin-header-control,
    .admin-header-actions :deep(#themeToggle) {
        transition: none;
    }
}
</style>
