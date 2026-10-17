<template>
    <div class="page-footer" v-if="!disableFooter">
        <p class="footer-line">
            <span>© 2024-{{ thisYear }} Powered by </span>
            <!-- 图床名称：纯文本署名，不再是链接（点击跳转由 logoLink / 页脚自定义代码承担） -->
            <span class="footer-name">{{ siteName }}</span>
            <a href="/" target="_blank" class="footer-link-icon-wrap" aria-hidden="true">
                <font-awesome-icon icon="paper-plane" class="footer-link-icon"/>
            </a>
            <!-- 页脚自定义代码：后台「页脚设置 → 页脚传送门链接」，支持 HTML / JS（如统计代码） -->
            <span v-if="footerCode" ref="footerCodeHost" class="footer-custom-code"></span>
        </p>
    </div>
</template>

<script>
import { mapGetters } from 'vuex'

export default {
    name: 'Footer',
    computed: {
        ...mapGetters(['userConfig']),
        /** 页脚自定义代码（HTML / JS），由后台「页脚设置」配置 */
        footerCode() {
            return String(this.userConfig?.footerLink || '').trim()
        },
        /** 站点署名：优先取后台「站长名称」，缺省回落到产品名 */
        siteName() {
            return this.userConfig?.ownerName || 'go-imgbed'
        },
        thisYear() {
            return new Date().getFullYear()
        },
        disableFooter() {
            return this.userConfig?.disableFooter || false
        }
    },
    watch: {
        footerCode() {
            this.$nextTick(() => this.mountFooterCode())
        }
    },
    mounted() {
        this.mountFooterCode()
    },
    methods: {
        /**
         * 挂载页脚自定义代码：
         * 直接 innerHTML 插入即可渲染 HTML；但 v-html / innerHTML 都不会执行 <script>，
         * 这里手动重建 script 节点，让统计代码等 JS 片段正常生效。
         */
        mountFooterCode() {
            const host = this.$refs.footerCodeHost
            if (!host) return
            host.innerHTML = this.footerCode
            const scripts = Array.from(host.querySelectorAll('script'))
            for (const old of scripts) {
                const s = document.createElement('script')
                for (const attr of Array.from(old.attributes)) s.setAttribute(attr.name, attr.value)
                s.text = old.textContent
                old.parentNode.replaceChild(s, old)
            }
        }
    }
}
</script>

<style scoped>
.page-footer {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100vw;
    color: var(--page-footer-text-color);
    font-size: large;
    user-select: none;
}
.footer-line {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0 2px;
    margin: 0;
    line-height: 1.6;
}
@media (max-width: 768px) {
    .page-footer {
        font-size: small;
    }
}
/* 图床名称：纯文本，颜色/字号与 Powered by 保持一致，仅保留加粗以突出署名 */
.footer-name {
    color: var(--page-footer-name-color);
    font-weight: bold;
}

.footer-link-icon-wrap {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
}

.footer-link-icon {
    color: var(--page-footer-name-color);
    margin-left: 5px;
    transition: transform 0.3s ease-in-out;
}

.footer-link-icon:hover {
    transform: scale(1.2) rotate(-12deg);
}

/*
 * 页脚自定义代码（传送门链接 / 统计代码）容器：
 * 颜色与字号严格继承「Powered by」所在行的样式，只给超链接加下划线，
 * 鼠标悬浮时变为蓝色，避免默认浏览器蓝色链接把页脚视觉打散。
 */
.footer-custom-code {
    display: inline;
    color: inherit;
    font-size: inherit;
    margin-left: 6px;
}

.footer-custom-code :deep(a) {
    color: inherit;
    font-size: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 0.2s ease;
}

.footer-custom-code :deep(a:hover) {
    color: #409eff;
}
</style>
