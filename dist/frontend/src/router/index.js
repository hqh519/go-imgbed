import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import store from '../store'
import axios from '@/utils/axios'
import i18n from '@/locales'
import { OverlayScrollbars } from 'overlayscrollbars'

/**
 * 统一的会话探测（所有守卫共用）：
 * - 短 TTL 缓存：30 秒内的重复导航不再等待网络往返，切换分类瞬时完成；
 * - 8 秒超时：后端瞬时繁忙时不再长时间挂起（表现为「点击切换没反应」）；
 * - 请求失败时回退最近一次缓存，避免偶发网络抖动把已登录用户踢回登录页。
 */
const SESSION_TTL = 30 * 1000
const sessionProbeCache = { at: 0, data: null }

/** 本地已知会话（登录后由 setSession 写入 vuex，并持久化到 localStorage） */
const knownSession = () => {
  const role = store.state.sessionRole
  if (!role) return null
  return { role, username: store.state.sessionUser || '' }
}

const probeSession = async () => {
  if (sessionProbeCache.data && Date.now() - sessionProbeCache.at < SESSION_TTL) {
    return { data: sessionProbeCache.data }
  }
  try {
    const res = await axios.get('/api/auth/sessionCheck', { withCredentials: true, timeout: 8000 })
    sessionProbeCache.at = Date.now()
    sessionProbeCache.data = res.data || {}
    return res
  } catch (e) {
    if (sessionProbeCache.data) return { data: sessionProbeCache.data }
    throw e
  }
}

/**
 * 后台静默刷新会话（不阻塞导航）。
 * 本地已有角色时直接用本地角色放行，同时异步跟服务端核对一次：
 * 只有「服务端明确说未登录且确实要求登录」时才把用户送回登录页。
 * 这样即便后端瞬时繁忙 / 网络抖动，点击分类切换也一定会立刻生效。
 */
let sessionRefreshing = false
const refreshSessionSilently = () => {
  if (sessionRefreshing) return
  sessionRefreshing = true
  axios
    .get('/api/auth/sessionCheck', { withCredentials: true, timeout: 8000 })
    .then((res) => {
      const data = res.data || {}
      sessionProbeCache.at = Date.now()
      sessionProbeCache.data = data
      const info = applySession(data)
      const required = info.adminRequired || info.userRequired
      if (!info.valid && required) {
        store.commit('clearSession')
        ElMessage.error(i18n.global.t('login.authRequired'))
        router.replace({ name: 'login' }).catch(() => {})
      }
    })
    .catch(() => {
      /* 网络异常时保持本地会话，不打扰用户 */
    })
    .finally(() => {
      sessionRefreshing = false
    })
}

/** 把 sessionCheck 的返回写入 vuex，返回归一化后的会话信息 */
function applySession(data) {
  const info = {
    role: data.role || null,
    username: data.username || null,
    isSuper: data.role === 'super',
    isAdmin: data.role === 'admin' || data.role === 'super',
    canEdit: data.canEdit !== false,
    canDelete: data.canDelete !== false,
    valid: !!data.valid,
    adminRequired: !!data.adminRequired,
    userRequired: !!data.userRequired
  }
  store.commit('setSession', info)
  return info
}

/**
 * 普通页面守卫：配置了账户（userRequired）时必须登录；
 * 未配置任何账户时保持免登录（保留「清空密码 = 免登录」的能力）。
 */
const userAuthGuard = (to, from, next) => {
  // 本地已有会话：直接放行，后台再跟服务端核对（不阻塞页面切换）
  if (knownSession()) {
    refreshSessionSilently()
    return next()
  }
  probeSession().then(res => {
    const data = res.data || {}
    const info = applySession(data)

    if (!info.userRequired || info.valid) return next()

    if (to.name !== 'login') {
      if (store.state.userLoggedIn) ElMessage.error(i18n.global.t('login.authRequired'))
      next({ name: 'login' })
    } else {
      next()
    }
  }).catch(() => {
    if (to.name !== 'login') {
      if (store.state.userLoggedIn) ElMessage.error(i18n.global.t('login.authRequired'))
      next({ name: 'login' })
    } else {
      next()
    }
  })
}

/**
 * 文件管理 / 历史记录守卫：管理员与普通用户都可进入，
 * 具体可见范围由后端按账户隔离（普通用户只看自身文件）。
 */
const manageAuthGuard = (to, from, next) => {
  const known = knownSession()
  if (known) {
    refreshSessionSilently()
    return next()
  }
  probeSession().then(res => {
    const data = res.data || {}
    const info = applySession(data)

    if (info.valid) return next()

    if (to.name !== 'login') {
      if (store.state.userLoggedIn) ElMessage.error(i18n.global.t('login.authRequired'))
      next({ name: 'login' })
    } else {
      next()
    }
  }).catch(() => {
    if (to.name !== 'login') next({ name: 'login' })
    else next()
  })
}

/**
 * 管理员守卫：仅 admin / super 可进（系统管理 / 用户管理 / 网页设置）。
 * 普通用户已登录时会被送回文件管理页并提示无权限；
 * 超级管理员（仅用于找回管理员账户）会被送到专用的超级管理员页。
 */
const adminAuthGuard = (to, from, next) => {
  const known = knownSession()
  if (known) {
    refreshSessionSilently()
    if (known.role === 'super') return next({ name: 'superAdmin' })
    if (known.role === 'admin') return next()
    ElMessage.error(i18n.global.t('login.adminRequired'))
    return next({ name: 'dashboard' })
  }
  probeSession().then(res => {
    const data = res.data || {}
    const info = applySession(data)

    if (info.role === 'super') return next({ name: 'superAdmin' })
    if (info.role === 'admin') return next()

    if (info.valid) {
      ElMessage.error(i18n.global.t('login.adminRequired'))
      return next({ name: 'dashboard' })
    }

    if (store.state.userLoggedIn) ElMessage.error(i18n.global.t('login.authRequired'))
    next({ name: 'login' })
  }).catch(() => {
    next({ name: 'login' })
  })
}

/** 超级管理员守卫：仅 super 可进（管理员账户找回） */
const superAuthGuard = (to, from, next) => {
  const known = knownSession()
  if (known) {
    refreshSessionSilently()
    if (known.role === 'super') return next()
    return next({ name: 'dashboard' })
  }
  probeSession().then(res => {
    const data = res.data || {}
    const info = applySession(data)
    if (info.role === 'super') return next()
    if (info.valid) return next({ name: 'dashboard' })
    next({ name: 'login' })
  }).catch(() => {
    next({ name: 'login' })
  })
}

/**
 * 用户管理守卫：管理员与普通用户都可进入。
 * 普通用户进页后只显示「自己这一条账户」并允许改密码 ——
 * 其余功能（创建用户 / 权限开关 / 主备渠道 / 归集统计 / 删除）由页面按角色隐藏，
 * 后端接口同样按角色做二次校验（页面隐藏只是体验，后端才是真正的权限边界）。
 */
const userManageGuard = (to, from, next) => {
  const known = knownSession()
  if (known) {
    refreshSessionSilently()
    if (known.role === 'super') return next({ name: 'superAdmin' })
    return next()
  }
  probeSession().then(res => {
    const data = res.data || {}
    const info = applySession(data)

    // 超级管理员专用页优先
    if (info.role === 'super') return next({ name: 'superAdmin' })
    if (info.valid) return next()

    if (store.state.userLoggedIn) ElMessage.error(i18n.global.t('login.authRequired'))
    next({ name: 'login' })
  }).catch(() => {
    next({ name: 'login' })
  })
}

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/UploadHome.vue'),
    beforeEnter: userAuthGuard
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('../views/AdminDashBoard.vue'),
    beforeEnter: manageAuthGuard
  },
  {
    path: '/customerConfig',
    name: 'customerConfig',
    component: () => import('../views/CustomerConfig.vue'),
    beforeEnter: userManageGuard
  },
  {
    path: '/systemConfig',
    name: 'systemConfig',
    component: () => import('../views/SystemConfig.vue'),
    beforeEnter: adminAuthGuard
  },
  {
    path: '/manage/history',
    name: 'history',
    component: () => import('../views/HistoryPage.vue'),
    beforeEnter: manageAuthGuard
  },
  {
    path: '/superAdmin',
    name: 'superAdmin',
    component: () => import('../views/SuperAdmin.vue'),
    beforeEnter: superAuthGuard
  },
  {
    path: '/docs',
    name: 'docs',
    component: () => import('../views/DocsPage.vue')
  },
  {
    // 版本修改日志：系统状态页「系统版本」卡片跳转到这里；公开可读，无需登录
    path: '/changelog',
    name: 'changelog',
    component: () => import('../views/ChangelogPage.vue')
  },
  // 旧入口兼容：统一账户体系下只有一个登录页
  {
    path: '/adminLogin',
    name: 'adminLogin',
    redirect: { name: 'login' },
  },
  {
    path: '/blockimg',
    name: 'blockimg',
    component: () => import('../views/BlockImage.vue'),
  },
  {
    path: '/whiteliston',
    name: 'whiteliston',
    component: () => import('../views/WhiteListOn.vue'),
  },
  {
    path: '/browse/:dir*',
    name: 'publicBrowse',
    component: () => import('../views/PublicBrowse.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'notFound',
    component: () => import('../views/NotFound.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (!['dashboard', 'customerConfig', 'systemConfig'].includes(to.name)) return false
    if (to.path === from.path && (to.name !== 'systemConfig' || to.hash === from.hash)) return false

    const position = { ...(savedPosition || { left: 0, top: 0 }), behavior: 'instant' }
    const scroller = OverlayScrollbars(document.body)?.elements().scrollOffsetElement
    if (scroller && scroller !== document.scrollingElement) {
      scroller.scrollTo(position)
      return false
    }
    return position
  }
})

export default router
