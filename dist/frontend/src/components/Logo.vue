<template>
    <!-- v2.4.0：未登录状态不显示左上角 logo（例如登录页 / 匿名上传页） -->
    <a
        v-if="isLoggedIn"
        :href="logoHref"
        :target="target"
        class="logo-link"
        rel="noopener noreferrer"
    >
    <img 
        :class="logoClasses"
        :alt="alt" 
        :src="logoUrl"
    />
  </a>
</template>

<script>
import { mapGetters } from 'vuex'
import defaultLogo from '@/assets/logo.png'

export default {
  name: 'Logo',
  props: {
    // Logo链接地址（可被用户配置覆盖；缺省指向本站首页）
    href: {
      type: String,
      default: '/'
    },
    // 链接打开方式
    target: {
      type: String,
      default: '_blank', // _blank, _self, _parent, _top
      validator: value => ['_blank', '_self', '_parent', '_top'].includes(value)
    },
    // 图片alt文本
    alt: {
      type: String,
      default: 'go-imgbed logo'
    },
    // 自定义logo图片URL（可选）
    customSrc: {
      type: String,
      default: ''
    },
    // Logo位置样式
    position: {
      type: String,
      default: 'fixed', // fixed, relative, absolute
      validator: value => ['fixed', 'relative', 'absolute', 'static'].includes(value)
    },
    // Logo大小
    size: {
      type: String,
      default: 'normal', // small, normal, large
      validator: value => ['small', 'normal', 'large'].includes(value)
    },
    // 是否启用悬停动画
    enableHover: {
      type: Boolean,
      default: true
    },
    // 是否允许使用用户配置的链接（仅上传页面启用）
    useConfigLink: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    ...mapGetters(['userConfig']),
    /** 是否已登录（会话里有账户才算；sessionCheck 探测完成前保持隐藏，避免闪现） */
    isLoggedIn() {
      return !!this.$store?.state?.sessionUser
    },
    logoUrl() {
      /*
       * 优先级（v202610221824）：
       *   customSrc（组件显式传入）> 当前登录用户头像 > 网页设置里的自定义 logo > 内置 logo。
       * 头像优先是需求要求：用户设置过头像后，左上角 logo 直接变成自己的头像，
       * 一眼能看出当前登录的是谁；没设置头像的账户完全不受影响。
       */
      const avatar = this.$store?.state?.sessionAvatar || ''
      return this.customSrc ||
             avatar ||
             this.userConfig?.logoUrl || 
             defaultLogo
    },
    logoHref() {
      // 只有启用 useConfigLink 时才使用用户配置的链接
      if (this.useConfigLink && this.userConfig?.logoLink) {
        return this.userConfig.logoLink
      }
      return this.href
    },
    logoClasses() {
      return {
        'logo': true,
        [`logo--${this.position}`]: true,
        [`logo--${this.size}`]: true,
        'logo--hover-enabled': this.enableHover,
        // 用头像时不显示方图边框，裁成圆形（头像是 1:1 的）
        'logo--avatar': !!this.$store?.state?.sessionAvatar && !this.customSrc
      }
    }
  }
}
</script>

<style scoped>
.logo-link {
  text-decoration: none;
  display: inline-block;
}

.logo {
  --logo-brightness: 1;
  --logo-hover-brightness: 1.08;
  transition: transform 0.3s ease, filter 0.3s ease, opacity 0.3s ease;
  border-radius: 8px;
}

/* 用当前用户头像当 logo 时裁成圆形 */
.logo--avatar {
  border-radius: 50%;
  object-fit: cover;
}

/* 位置样式 */
.logo--fixed {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 100;
}

.logo--relative {
  position: relative;
}

.logo--absolute {
  position: absolute;
  top: 5px;
  left: 5px;
  z-index: 100;
}

.logo--static {
  position: static;
}

/* 大小样式 */
.logo--small {
  height: 50px;
  width: 50px;
}

.logo--normal {
  height: 70px;
  width: 70px;
}

.logo--large {
  height: 90px;
  width: 90px;
}

/* 悬停动画 */
.logo--hover-enabled:hover {
  transform: scale(1.1) rotate(5deg);
  filter: brightness(var(--logo-hover-brightness)) drop-shadow(0 0 10px var(--logo-glow-color));
}

/* 响应式设计 */
@media (max-width: 768px) {
  .logo--small {
    height: 40px;
    width: 40px;
  }
  
  .logo--normal {
    height: 60px;
    width: 60px;
  }
  
  .logo--large {
    height: 75px;
    width: 75px;
  }
}

/* 辅助功能支持 */
.logo-link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

/* 主题适配 */
.logo {
  filter: var(--logo-filter, brightness(var(--logo-brightness)) drop-shadow(0 0 0 var(--logo-glow-color)));
  opacity: var(--logo-opacity, 1);
}

/* 暗色模式下的 Logo 样式 */
:global(html.dark) .logo {
  --logo-brightness: 0.9;
  --logo-hover-brightness: 1;
  filter: var(--logo-dark-filter, brightness(var(--logo-brightness)) drop-shadow(0 0 0 var(--logo-glow-color)));
}
</style>
