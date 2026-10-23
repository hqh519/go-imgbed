import { createApp } from 'vue'
import { createHead } from '@vueuse/head'; // 导入 createHead
import ElementPlus, { messageConfig } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'

import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import fontAwesomeIcons from './utils/fontawesomeIcons';

import App from './App.vue'
import router from './router'
import store from './store'
import i18n, { initializeLocale } from './locales'

import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/global.css'
import './styles/responsive.css'

// OverlayScrollbars 悬浮滚动条
import 'overlayscrollbars/overlayscrollbars.css'


library.add(...fontAwesomeIcons);

// 保留首条消息的顶部间距，同时允许 Element Plus 动态计算后续消息的位置。
messageConfig.offset = 30;

const app = createApp(App);
const head = createHead(); // 创建 head 对象

app.component('font-awesome-icon', FontAwesomeIcon);
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
}

/**
 * 主题初始化（v202610221824 改写）。
 *
 * 网页设置里的开关语义变了：从「自动切换」改为「强制切换」——
 *   autoDarkMode = true  → 按时间强制：19:00—07:00 夜间、07:00—19:00 白天；
 *                          此时右上角按钮隐藏且失效（不允许用户覆盖）；
 *   autoDarkMode = false → 以右上角按钮为准（亮 / 暗 / 自动三态），
 *                          其中「自动」态也按 19:00—07:00 + 系统深色偏好判断。
 * 默认值为 false（首次安装不强制）。
 */
const NIGHT_START_HOUR = 19;
const NIGHT_END_HOUR = 7;

/** 按 19:00—07:00 判断当前是否属于夜间 */
const isNightNow = () => {
    const hour = new Date().getHours();
    return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
};

const initDarkModeClass = () => {
    const htmlElement = document.documentElement;
    const forced = store.getters.userConfig?.autoDarkMode === true;
    let isDarkMode;

    if (forced) {
        // 强制模式：只按时间，忽略系统偏好与用户手动选择
        isDarkMode = isNightNow();
        store.commit('setUseDarkMode', isDarkMode);
    } else if (store.state.cusDarkMode && store.state.useDarkMode !== null) {
        // 用户手动设置了亮色 / 暗色
        isDarkMode = store.state.useDarkMode;
    } else {
        // 自动态：跟随系统深色偏好，系统为亮色时再按 19:00—07:00 判断
        isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches || isNightNow();
        store.commit('setUseDarkMode', isDarkMode);
    }

    if (isDarkMode) {
        htmlElement.classList.add('dark');
    } else {
        htmlElement.classList.remove('dark');
    }
};

const applyDarkModeClass = (isDarkMode) => {
    const htmlElement = document.documentElement;
    if (isDarkMode) {
        htmlElement.classList.add('dark');
    } else {
        htmlElement.classList.remove('dark');
    }
};

// 预设网站标题的函数
const presetSiteTitle = (userConfig) => {
    document.title = userConfig?.siteTitle || 'go-imgbed';
};

// 预设和更新网站图标的函数
const presetSiteIcon = (isDarkMode, userConfig) => {
    // 同时更改 icon apple-touch-icon 和 mask-icon
    const existingIcons = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]');
    existingIcons.forEach(icon => icon.remove());

    const iconLink = document.createElement('link');
    const appleIconLink = document.createElement('link');
    const maskIconLink = document.createElement('link');
    iconLink.rel = 'icon';
    appleIconLink.rel = 'apple-touch-icon';
    maskIconLink.rel = 'mask-icon';

    if (isDarkMode) {
        iconLink.href = userConfig?.siteIcon || '/static/media/logo-dark.png';
        appleIconLink.href = userConfig?.siteIcon || '/static/media/logo-dark.png';
        maskIconLink.href = userConfig?.siteIcon || '/static/media/logo-dark.png';
    } else {
        iconLink.href = userConfig?.siteIcon || '/static/media/logo.png';
        appleIconLink.href = userConfig?.siteIcon || '/static/media/logo.png';
        maskIconLink.href = userConfig?.siteIcon || '/static/media/logo.png';
    }

    document.head.appendChild(iconLink);
    document.head.appendChild(appleIconLink);
    document.head.appendChild(maskIconLink);
};

store.dispatch('fetchUserConfig').then(() => {
    // 优先恢复用户选择；没有持久化选择时使用网页默认语言
    initializeLocale(store.getters.userConfig?.defaultLanguage);

    // 初始化时应用 dark 模式
    initDarkModeClass();

    // 预设网站标题和图标
    presetSiteTitle(store.getters.userConfig);
    presetSiteIcon(store.state.useDarkMode, store.getters.userConfig);

    // 监听 useDarkMode 和 cusDarkMode 的变化
    store.subscribe((mutation, state) => {
        if (mutation.type === 'setUseDarkMode' && store.state.cusDarkMode) {
            applyDarkModeClass(state.useDarkMode);
            // 同时更新网站图标
            presetSiteIcon(state.useDarkMode, store.getters.userConfig);
        }

        // 监听 cusDarkMode 变化，当设置为 false 时重新初始化
        if (mutation.type === 'setCusDarkMode' && !mutation.payload) {
            // 切换到跟随系统模式，重新初始化
            initDarkModeClass();
            // 同时更新网站图标
            presetSiteIcon(store.state.useDarkMode, store.getters.userConfig);
        }
    });

    /*
     * 跨过 19:00 / 07:00 这个时间点时页面不会自己重载，所以定时（每分钟）
     * 以及「标签页重新可见」时各重算一次主题 —— 长时间挂着的页面也能自动切换。
     */
    const refreshThemeByTime = () => {
        const forced = store.getters.userConfig?.autoDarkMode === true;
        if (forced || !store.state.cusDarkMode) initDarkModeClass();
    };
    setInterval(refreshThemeByTime, 60 * 1000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshThemeByTime();
    });

    app.use(store).use(router).use(ElementPlus).use(i18n).mount('#app');
}).catch(error => {
    console.error('Failed to load user configuration:', error);
    initializeLocale();
    app.use(store).use(router).use(ElementPlus).use(i18n).use(head).mount('#app');
})
