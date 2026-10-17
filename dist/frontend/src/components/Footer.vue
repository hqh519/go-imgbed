<template>
    <div class="page-footer" v-if="!disableFooter">
        <p>© 2024-{{ thisYear }} Powered by <a class="footer-name" href="/" target="_blank">{{ siteName }}</a>
            <a href="/" target="_blank">
                <font-awesome-icon icon="paper-plane" class="footer-link-icon"/>
            </a>
        </p>
        <!-- 页脚自定义代码：后台「页脚设置 → 页脚自定义代码」，支持 HTML / JS（如统计代码） -->
        <div v-if="footerCode" ref="footerCodeHost" class="footer-custom-code"></div>
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
@media (max-width: 768px) {
    .page-footer {
        font-size: small;
    }
}
.footer-name {
    color: var(--page-footer-name-color);
    font-weight: bold;
    text-decoration: none;
    position: relative;
    transition: all 0.3s ease;
}

.footer-name::after {
    content: '';
    position: absolute;
    width: 0;
    height: 2px;
    bottom: -2px;
    left: 0;
    background-color: var(--page-footer-name-color);
    transition: width 0.3s ease-in-out;
}

.footer-name:hover::after {
    width: 100%;
}

.footer-link-icon {
    color: var(--page-footer-name-color);
    margin-left: 5px;
    transition: transform 0.3s ease-in-out;
}

.footer-link-icon:hover {
    transform: scale(1.2) rotate(-12deg);
}

/* 页脚自定义代码容器：与默认页脚文字同行区域，样式尽量不干预（交给插入的代码自定） */
.footer-custom-code {
    display: inline-flex;
    align-items: center;
    margin-left: 10px;
}
</style>
