<template>
  <!--
    访问记录（v2.3.0）
      · 独立整页，由「系统状态 → 访问记录 / 访问次数」以新标签打开；
      · 数据源：/api/manage/access（服务端分页、关键字、类型、时间范围过滤）；
      · 一条记录包含：IP + 归属地、登录用户、访问页面、跳转链接、来路、设备环境、
        停留时长、上次来访时间（同 IP 的上一次访问）。
  -->
  <div class="access-page">
    <header class="access-topbar">
      <div class="topbar-left">
        <el-button class="back-btn" circle @click="goBack">
          <font-awesome-icon icon="arrow-left" />
        </el-button>
        <h1 class="page-title">{{ $t('accessLog.title') }}</h1>
        <span class="record-count">{{ $t('accessLog.totalCount', { count: total }) }}</span>
      </div>

      <div class="topbar-right">
        <el-input
          v-model="filter.keyword"
          class="filter-search"
          size="small"
          clearable
          :placeholder="$t('accessLog.searchPlaceholder')"
          @keyup.enter="applyFilter"
          @clear="applyFilter"
        >
          <template #prefix><font-awesome-icon icon="search" /></template>
        </el-input>

        <el-select v-model="filter.kind" class="filter-select" size="small" @change="applyFilter">
          <el-option :label="$t('accessLog.kindAll')" value="all" />
          <el-option :label="$t('accessLog.kindPage')" value="page" />
          <el-option :label="$t('accessLog.kindFile')" value="file" />
        </el-select>

        <el-date-picker
          v-model="filter.dateRange"
          class="filter-date"
          size="small"
          type="daterange"
          value-format="YYYY-MM-DD"
          :start-placeholder="$t('accessLog.startDate')"
          :end-placeholder="$t('accessLog.endDate')"
          :range-separator="$t('accessLog.dateSeparator')"
          @change="applyFilter"
        />

        <el-tooltip :content="$t('accessLog.refresh')" placement="bottom" :show-after="800">
          <el-button class="icon-btn" circle size="small" @click="reload">
            <font-awesome-icon icon="sync" />
          </el-button>
        </el-tooltip>

        <el-tooltip :content="$t('accessLog.clearAll')" placement="bottom" :show-after="800">
          <el-button class="icon-btn is-danger" circle size="small" @click="clearAll">
            <font-awesome-icon icon="trash-alt" />
          </el-button>
        </el-tooltip>
      </div>
    </header>

    <div class="access-body" v-loading="loading">
      <!-- 概览：今日访问 / 今日独立 IP / 今日登录用户 / 累计记录 -->
      <div class="summary-row">
        <div class="summary-card">
          <span class="summary-value">{{ summary.today.toLocaleString() }}</span>
          <span class="summary-label">{{ $t('accessLog.todayVisits') }}</span>
        </div>
        <div class="summary-card">
          <span class="summary-value">{{ summary.todayIps.toLocaleString() }}</span>
          <span class="summary-label">{{ $t('accessLog.todayIps') }}</span>
        </div>
        <div class="summary-card">
          <span class="summary-value">{{ summary.todayUsers.toLocaleString() }}</span>
          <span class="summary-label">{{ $t('accessLog.todayUsers') }}</span>
        </div>
        <div class="summary-card">
          <span class="summary-value">{{ summary.total.toLocaleString() }}</span>
          <span class="summary-label">{{ $t('accessLog.totalRecords') }}</span>
        </div>
      </div>

      <!-- 批量操作栏 -->
      <div class="batch-bar">
        <el-checkbox
          :model-value="allChecked"
          :indeterminate="someChecked"
          :disabled="items.length === 0"
          @change="toggleAll"
        >
          {{ $t('accessLog.selectAll') }}
        </el-checkbox>
        <span v-if="selected.length" class="selected-hint">
          {{ $t('accessLog.selectedCount', { count: selected.length }) }}
        </span>
        <el-button
          v-if="selected.length"
          size="small"
          type="danger"
          plain
          @click="removeSelected"
        >
          {{ $t('accessLog.deleteSelected') }}
        </el-button>
      </div>

      <!-- 记录列表 -->
      <div v-if="items.length" class="access-list">
        <div v-for="row in items" :key="row.id" class="access-item" :class="{ 'is-file': row.kind === 'file' }">
          <el-checkbox
            class="item-check"
            :model-value="selected.includes(row.id)"
            @change="(v) => toggleOne(row.id, v)"
          />

          <div class="item-icon" :title="row.kind === 'file' ? $t('accessLog.kindFile') : $t('accessLog.kindPage')">
            <font-awesome-icon :icon="row.kind === 'file' ? 'file-alt' : 'globe'" />
          </div>

          <div class="item-main">
            <!-- 第一行：访问页面 + 时间 -->
            <div class="item-line line-primary">
              <span class="item-path" :title="row.path" @click="copy(row.path)">{{ row.path || '-' }}</span>
              <span class="item-title" :title="row.title">{{ row.title }}</span>
              <span class="item-time">{{ formatDateTime(row.createdAt) }}</span>
            </div>

            <!-- 第二行：IP / 归属地 / 用户 / 设备 -->
            <div class="item-line line-secondary">
              <span class="chip chip-ip" :title="$t('accessLog.colVisitor')">
                <font-awesome-icon icon="globe" />
                {{ row.ip || '-' }}
              </span>
              <span v-if="row.ipLocation" class="chip">{{ row.ipLocation }}</span>
              <span class="chip" :class="{ 'is-guest': !row.username }">
                <font-awesome-icon icon="users" />
                {{ row.username || $t('accessLog.guest') }}
              </span>
              <span class="chip">{{ row.device || $t('accessLog.unknown') }} · {{ row.browser || '-' }} · {{ row.os || '-' }}</span>
              <span class="chip">{{ row.method }} {{ row.status }}</span>
            </div>

            <!-- 第三行：来路 / 跳转链接 / 停留 / 上次来访 -->
            <div class="item-line line-tertiary">
              <span class="field" :title="row.refererUrl || $t('accessLog.directVisit')">
                <em>{{ $t('accessLog.colReferer') }}</em>
                <a v-if="row.refererHost" class="field-link" :href="row.refererUrl" target="_blank" rel="noopener noreferrer">{{ row.refererHost }}</a>
                <span v-else>{{ $t('accessLog.directVisit') }}</span>
              </span>
              <span class="field" :title="row.targetUrl || $t('accessLog.noTarget')">
                <em>{{ $t('accessLog.colTarget') }}</em>
                <span v-if="row.targetUrl">{{ row.targetUrl }}</span>
                <span v-else>{{ $t('accessLog.noTarget') }}</span>
              </span>
              <span class="field" :title="$t('accessLog.colStay')">
                <em>{{ $t('accessLog.colStay') }}</em>
                <span>{{ formatStay(row.stayMs) }}</span>
              </span>
              <span class="field" :title="$t('accessLog.colPrev')">
                <em>{{ $t('accessLog.colPrev') }}</em>
                <span>{{ row.prevVisitAt ? formatDateTime(row.prevVisitAt) : $t('accessLog.firstVisit') }}</span>
              </span>
            </div>
          </div>

          <div class="item-actions">
            <el-tooltip :content="$t('accessLog.deleteOne')" placement="top" :show-after="600">
              <el-button class="icon-btn is-danger" circle size="small" @click="removeOne(row)">
                <font-awesome-icon icon="trash-alt" />
              </el-button>
            </el-tooltip>
          </div>
        </div>
      </div>

      <div v-else-if="!loading" class="empty-state">
        <font-awesome-icon icon="inbox" class="empty-icon" />
        <p>{{ $t('accessLog.empty') }}</p>
      </div>

      <div v-if="total > pageSize" class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          :layout="pagerLayout"
          :pager-count="5"
          background
          @current-change="fetchList"
        />
      </div>
    </div>
  </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth'
import { copyText } from '@/utils/clipboard'

export default {
  name: 'AccessLogPage',
  data() {
    return {
      loading: false,
      items: [],
      total: 0,
      page: 1,
      pageSize: 30,
      filter: { keyword: '', kind: 'all', dateRange: [] },
      summary: { today: 0, todayIps: 0, todayUsers: 0, total: 0 },
      selected: [],
    }
  },
  computed: {
    allChecked() {
      return this.items.length > 0 && this.selected.length === this.items.length
    },
    someChecked() {
      return this.selected.length > 0 && this.selected.length < this.items.length
    },
    pagerLayout() {
      return window.innerWidth <= 768 ? 'prev, pager, next' : 'total, prev, pager, next'
    },
  },
  mounted() {
    // 从「系统状态 → 访问记录」点击某条进入时带查询参数（ip / path / kind）
    const q = this.$route.query || {}
    if (q.ip) this.filter.keyword = String(q.ip)
    else if (q.path) this.filter.keyword = String(q.path)
    if (q.kind === 'page' || q.kind === 'file') this.filter.kind = q.kind
    this.reload()
  },
  methods: {
    goBack() {
      if (window.history.length > 1) this.$router.back()
      else this.$router.push({ name: 'systemConfig' })
    },
    applyFilter() {
      this.page = 1
      this.selected = []
      this.fetchList()
    },
    reload() {
      this.selected = []
      this.fetchSummary()
      this.fetchList()
    },
    async fetchSummary() {
      try {
        const res = await fetchWithAuth('/api/manage/access/summary')
        if (!res.ok) return
        const body = await res.json()
        const d = body?.data || {}
        this.summary = {
          today: Number(d.today || 0),
          todayIps: Number(d.todayIps || 0),
          todayUsers: Number(d.todayUsers || 0),
          total: Number(d.total || 0),
        }
      } catch {
        /* 概览失败不影响列表 */
      }
    },
    async fetchList() {
      this.loading = true
      try {
        const params = new URLSearchParams()
        if (this.filter.keyword) params.set('keyword', this.filter.keyword.trim())
        if (this.filter.kind !== 'all') params.set('kind', this.filter.kind)
        if (Array.isArray(this.filter.dateRange) && this.filter.dateRange.length === 2) {
          params.set('start', this.filter.dateRange[0])
          params.set('end', this.filter.dateRange[1])
        }
        params.set('page', String(this.page))
        params.set('pageSize', String(this.pageSize))

        const res = await fetchWithAuth(`/api/manage/access?${params.toString()}`)
        const body = await res.json().catch(() => ({}))
        if (!res.ok || body?.success === false) throw new Error(body?.message || `HTTP ${res.status}`)
        const d = body?.data || {}
        this.items = Array.isArray(d.items) ? d.items : []
        this.total = Number(d.total || 0)
      } catch (err) {
        this.items = []
        this.total = 0
        this.$message?.error(`${this.$t('accessLog.loadFailed')} ${err.message}`)
      } finally {
        this.loading = false
      }
    },
    toggleAll(checked) {
      this.selected = checked ? this.items.map((r) => r.id) : []
    },
    toggleOne(id, checked) {
      const set = new Set(this.selected)
      if (checked) set.add(id)
      else set.delete(id)
      this.selected = Array.from(set)
    },
    async removeOne(row) {
      try {
        await this.$confirm(this.$t('accessLog.deleteConfirm'), this.$t('accessLog.deleteConfirmTitle'), {
          confirmButtonText: this.$t('common.confirm'),
          cancelButtonText: this.$t('common.cancel'),
          type: 'warning',
        })
      } catch {
        return
      }
      await this.doDelete([row.id])
    },
    async removeSelected() {
      if (!this.selected.length) return
      try {
        await this.$confirm(
          this.$t('accessLog.deleteSelectedConfirm', { count: this.selected.length }),
          this.$t('accessLog.deleteConfirmTitle'),
          {
            confirmButtonText: this.$t('common.confirm'),
            cancelButtonText: this.$t('common.cancel'),
            type: 'warning',
          },
        )
      } catch {
        return
      }
      await this.doDelete(this.selected)
    },
    async doDelete(ids) {
      try {
        const res = await fetchWithAuth('/api/manage/access', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok || body?.success === false) throw new Error(body?.message || `HTTP ${res.status}`)
        this.$message.success(this.$t('accessLog.deleted', { count: Number(body?.data?.deleted || ids.length) }))
        this.selected = []
        this.reload()
      } catch (err) {
        this.$message.error(`${this.$t('accessLog.deleteFailed')} ${err.message}`)
      }
    },
    async clearAll() {
      try {
        await this.$confirm(this.$t('accessLog.clearConfirm'), this.$t('accessLog.clearConfirmTitle'), {
          confirmButtonText: this.$t('accessLog.clearConfirmOk'),
          cancelButtonText: this.$t('common.cancel'),
          type: 'warning',
        })
      } catch {
        return
      }
      try {
        const res = await fetchWithAuth('/api/manage/access/all', { method: 'DELETE' })
        const body = await res.json().catch(() => ({}))
        if (!res.ok || body?.success === false) throw new Error(body?.message || `HTTP ${res.status}`)
        this.$message.success(this.$t('accessLog.cleared', { count: Number(body?.data?.deleted || 0) }))
        this.page = 1
        this.selected = []
        this.reload()
      } catch (err) {
        this.$message.error(`${this.$t('accessLog.deleteFailed')} ${err.message}`)
      }
    },
    formatDateTime(ts) {
      const d = new Date(Number(ts) || 0)
      if (!Number.isFinite(d.getTime()) || !ts) return '-'
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    },
    /** 停留时长：<1 分钟按秒，其余按「分 + 秒」 */
    formatStay(ms) {
      const n = Number(ms || 0)
      if (!n) return '-'
      if (n < 1000) return `${n} ms`
      const sec = Math.round(n / 1000)
      if (sec < 60) return this.$t('accessLog.staySeconds', { count: sec })
      const min = Math.floor(sec / 60)
      const rest = sec % 60
      return rest ? this.$t('accessLog.stayMinutes', { min, sec: rest }) : this.$t('accessLog.stayMinuteOnly', { min })
    },
    async copy(text) {
      if (!text) return
      const ok = await copyText(text)
      if (ok) this.$message.success(this.$t('accessLog.copied'))
    },
  },
}
</script>

<style scoped>
.access-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--admin-container-bg-color);
  color: var(--upload-text-color);
}

.access-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--admin-container-bg-color);
  position: sticky;
  top: 0;
  z-index: 10;
}

.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  background: var(--upload-main-title-color);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}

.record-count {
  font-size: 13px;
  opacity: 0.75;
}

.filter-search {
  width: 220px;
}

.filter-select {
  width: 120px;
}

.filter-date {
  width: 240px;
  box-sizing: border-box;
}

.icon-btn,
.back-btn {
  background-color: var(--toolbar-button-bg-color);
  box-shadow: var(--toolbar-button-shadow);
  border: none;
  color: var(--theme-toggle-color);
}

.icon-btn.is-danger:hover,
.back-btn:hover {
  color: var(--el-color-danger);
}

.access-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 24px 60px;
}

/* 概览卡片 */
.summary-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--toolbar-button-bg-color);
  border: 1px solid var(--glass-border);
  box-shadow: var(--toolbar-button-shadow);
}

.summary-value {
  font-size: 22px;
  font-weight: 700;
}

.summary-label {
  font-size: 12px;
  opacity: 0.65;
}

/* 批量操作栏 */
.batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 4px 12px;
  flex-wrap: wrap;
}

.selected-hint {
  font-size: 12px;
  opacity: 0.7;
}

/* 记录列表 */
.access-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.access-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--toolbar-button-bg-color);
  border: 1px solid var(--glass-border);
  box-shadow: var(--toolbar-button-shadow);
  transition: box-shadow 0.25s ease;
}

.access-item:hover {
  box-shadow: var(--toolbar-button-shadow-hover);
}

.access-item.is-file {
  border-left: 3px solid var(--el-color-primary);
}

.item-check {
  margin-top: 2px;
}

.item-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  color: var(--theme-toggle-color);
}

.item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.item-path {
  font-size: 14px;
  font-weight: 600;
  word-break: break-all;
  cursor: copy;
}

.item-path:hover {
  color: var(--el-color-primary);
}

.item-title {
  font-size: 12px;
  opacity: 0.6;
  max-width: 40%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.item-time {
  margin-left: auto;
  font-size: 12px;
  opacity: 0.7;
  white-space: nowrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 12px;
  background: var(--el-fill-color-light);
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.chip.is-guest {
  opacity: 0.6;
}

.chip-ip {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.line-tertiary {
  gap: 16px;
}

.field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0.85;
}

.field em {
  font-style: normal;
  opacity: 0.55;
}

.field-link {
  color: var(--el-color-primary);
  text-decoration: none;
}

.item-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 80px 0;
  opacity: 0.6;
}

.empty-icon {
  font-size: 56px;
  color: var(--theme-toggle-color);
}

.pager {
  display: flex;
  justify-content: center;
  padding: 22px 0 6px;
}

.access-body::-webkit-scrollbar {
  width: 8px;
}

.access-body::-webkit-scrollbar-thumb {
  background: var(--el-border-color);
  border-radius: 4px;
}

/* 移动端：概览两列、记录纵向排布、辅助信息换行 */
@media (max-width: 768px) {
  /* v2.4.0：移动端顶部栏取消粘滞，跟随页面滚动 */
  .access-topbar {
    position: static;
    padding: 10px 12px;
  }

  .access-body {
    padding: 14px 12px 60px;
  }

  .summary-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .summary-card {
    padding: 10px 12px;
  }

  .summary-value {
    font-size: 18px;
  }

  .filter-search,
  .filter-select,
  .filter-date {
    width: 100%;
  }

  /* v2.4.0：Element Plus 的 daterange 默认固定 350px（特异性更高），
     会把筛选行撑出屏幕右侧 —— 这里提高特异性强制收窄 */
  .topbar-right .filter-search,
  .topbar-right .filter-select,
  .topbar-right .filter-date,
  .topbar-right .filter-date.el-date-editor--daterange {
    width: 100% !important;
    max-width: 100%;
    box-sizing: border-box;
  }

  .access-item {
    padding: 10px;
    gap: 8px;
  }

  .item-icon {
    display: none;
  }

  .item-title {
    max-width: 100%;
  }

  .item-time {
    margin-left: 0;
  }

  .line-tertiary {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .field {
    white-space: normal;
    word-break: break-all;
  }
}
</style>
