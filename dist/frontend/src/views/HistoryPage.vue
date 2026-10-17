<template>
  <!--
    历史记录（= 原「上传记录」与后台「历史记录」合并后的唯一页面）
      · 独立整页，由各处入口以 target="_blank" 新标签打开
      · 数据源：/api/manage/list（服务端文件记录，按上传时间倒序）
      · 权限：普通用户仅能看到自身文件；管理员可用「上传用户」下拉切换（默认全部）
      · 时间线：按日期分组，滚动到底部懒加载（先补渲染，再向服务端续页）
  -->
  <div class="history-page">
    <header class="history-topbar">
      <div class="topbar-left">
        <el-button class="back-btn" circle @click="goBack">
          <font-awesome-icon icon="arrow-left" />
        </el-button>
        <h1 class="page-title">{{ $t('uploadHistory.title') }}</h1>
        <span class="record-count">{{ $t('uploadHistory.totalRecords', { count: filteredItems.length }) }}</span>
      </div>

      <div class="topbar-right">
        <!-- 上传用户：仅管理员可见，默认全部 -->
        <el-select
          v-if="isAdminRole"
          v-model="filter.user"
          class="filter-select is-user"
          size="small"
          @change="applyFilter"
        >
          <el-option :label="$t('dashboard.allUsers')" value="all" />
          <el-option v-for="u in userOptions" :key="u" :label="u" :value="u" />
        </el-select>

        <!-- 时间范围（系统状态统计点击跳转时自动带入） -->
        <el-select v-model="filter.range" class="filter-select" size="small" @change="applyFilter">
          <el-option :label="$t('uploadHistory.rangeAll')" value="all" />
          <el-option :label="$t('uploadHistory.rangeToday')" value="today" />
          <el-option :label="$t('uploadHistory.rangeYesterday')" value="yesterday" />
          <el-option :label="$t('uploadHistory.rangeWeek')" value="week" />
          <el-option :label="$t('uploadHistory.rangeMonth')" value="month" />
          <el-option :label="$t('uploadHistory.rangeYear')" value="year" />
        </el-select>

        <!-- 文件类型 -->
        <el-select v-model="filter.fileType" class="filter-select" size="small" @change="applyFilter">
          <el-option :label="$t('uploadHistory.allTypes')" value="all" />
          <el-option :label="$t('uploadHistory.typeImage')" value="image" />
          <el-option :label="$t('uploadHistory.typeVideo')" value="video" />
          <el-option :label="$t('uploadHistory.typeAudio')" value="audio" />
          <el-option :label="$t('uploadHistory.typeOther')" value="other" />
        </el-select>

        <el-input
          v-model="filter.search"
          class="filter-search"
          size="small"
          clearable
          :placeholder="$t('uploadHistory.searchPlaceholder')"
          @keyup.enter="applyFilter"
          @clear="applyFilter"
        >
          <template #prefix><font-awesome-icon icon="search" /></template>
        </el-input>

        <el-tooltip :content="$t('uploadHistory.refresh')" placement="bottom" :show-after="800">
          <el-button class="icon-btn" circle size="small" @click="applyFilter">
            <font-awesome-icon icon="sync" />
          </el-button>
        </el-tooltip>
        <el-tooltip :content="$t('uploadHistory.switchView')" placement="bottom" :show-after="800">
          <el-button class="icon-btn" circle size="small" @click="toggleViewMode">
            <font-awesome-icon :icon="viewMode === 'grid' ? 'list' : 'th-large'" />
          </el-button>
        </el-tooltip>
      </div>
    </header>

    <div ref="scrollBody" class="history-body" @scroll="handleScroll">
      <div v-if="loading" class="loading-state">
        <font-awesome-icon icon="spinner" spin />
        <span>{{ $t('uploadHistory.loading') }}</span>
      </div>

      <template v-else-if="groups.length">
        <div v-for="group in groups" :key="group.date" class="history-group">
          <div class="timeline-header">
            <span class="timeline-dot"></span>
            <span class="date-label">{{ group.date }}</span>
            <span class="date-count">{{ group.items.length }}</span>
          </div>

          <!-- 网格视图 -->
          <div v-if="viewMode === 'grid'" class="grid-view">
            <div v-for="item in group.items" :key="item.name" class="grid-item is-clickable" @click="openDetail(item)">
              <div class="grid-preview">
                <img v-if="isImage(item)" :src="urlOf(item)" loading="lazy" @error="onImgError" />
                <video v-else-if="isVideo(item)" :src="urlOf(item)" muted preload="metadata"></video>
                <div v-else class="file-icon-wrapper">
                  <font-awesome-icon icon="file" />
                  <span class="file-ext">{{ item.metadata?.FileExt || 'file' }}</span>
                </div>
                <div class="grid-overlay">
                  <el-button circle size="small" type="primary" @click.stop="copyLink(urlOf(item))">
                    <font-awesome-icon icon="copy" />
                  </el-button>
                  <el-button circle size="small" @click.stop="openLink(urlOf(item))">
                    <font-awesome-icon icon="external-link-alt" />
                  </el-button>
                </div>
              </div>
              <div class="grid-info">
                <div class="file-name" :title="item.metadata?.FileName">{{ item.metadata?.FileName || item.name }}</div>
                <div class="grid-meta">
                  <span class="upload-time">{{ formatTime(item.metadata?.TimeStamp) }}</span>
                  <span class="upload-size">{{ item.metadata?.FileSize }}</span>
                </div>
                <div v-if="isAdminRole" class="upload-user" :title="$t('dashboard.uploadUser')">
                  <font-awesome-icon icon="user" />
                  {{ item.metadata?.UploadUser || $t('fileDetail.unknown') }}
                </div>
              </div>
            </div>
          </div>

          <!-- 列表视图 -->
          <div v-else class="list-view">
            <div v-for="item in group.items" :key="item.name" class="list-item is-clickable" @click="openDetail(item)">
              <div class="list-preview">
                <img v-if="isImage(item)" :src="urlOf(item)" loading="lazy" @error="onImgError" />
                <video v-else-if="isVideo(item)" :src="urlOf(item)" muted preload="metadata"></video>
                <div v-else class="file-icon-wrapper-small">
                  <font-awesome-icon icon="file" />
                </div>
              </div>
              <div class="list-info">
                <div class="file-name" :title="item.metadata?.FileName">{{ item.metadata?.FileName || item.name }}</div>
                <div class="file-url" :title="urlOf(item)">{{ urlOf(item) }}</div>
              </div>
              <div class="list-meta">
                <span class="upload-size">{{ item.metadata?.FileSize }}</span>
                <span v-if="isAdminRole" class="upload-user">
                  <font-awesome-icon icon="user" />
                  {{ item.metadata?.UploadUser || $t('fileDetail.unknown') }}
                </span>
                <span class="upload-time">{{ formatTime(item.metadata?.TimeStamp) }}</span>
              </div>
              <div class="list-actions">
                <el-button circle size="small" type="primary" @click.stop="copyLink(urlOf(item))">
                  <font-awesome-icon icon="copy" />
                </el-button>
                <el-button circle size="small" @click.stop="openLink(urlOf(item))">
                  <font-awesome-icon icon="external-link-alt" />
                </el-button>
                <!-- 列表模式不再提供删除按钮（需要删除请进文件详情） -->
              </div>
            </div>
          </div>
        </div>

        <!-- 滚动懒加载哨兵 -->
        <div class="load-more-container">
          <div v-if="loadingMore" class="loading-indicator">
            <font-awesome-icon icon="spinner" spin />
            <span>{{ $t('uploadHistory.loading') }}</span>
          </div>
          <div v-else-if="hasMore" class="load-more-hint">{{ $t('uploadHistory.pullToLoadMore') }}</div>
          <div v-else class="no-more-hint">{{ $t('uploadHistory.noMoreRecords') }}</div>
        </div>
      </template>

      <div v-else class="empty-state">
        <font-awesome-icon icon="history" class="empty-icon" />
        <p>{{ $t('uploadHistory.emptyHistory') }}</p>
      </div>
    </div>

    <!--
      文件详情 —— 与后台「文件管理」共用同一个模板（components/dashboard/FileDetailDialog.vue），
      数据由 utils/fileDetail 的 buildFileDetail() 统一构造，两处行为完全一致。
      「标签 / 黑名单 / 白名单」三个动作在历史记录里同样可用（showAdvanced=true）：
      它们本就只依赖单文件的接口，与列表页的批量能力无关。
    -->
    <FileDetailDialog
      v-model="showDetail"
      :file="detailFile"
      :fileLink="detailPreviewLink"
      :urls="detailUrls"
      :showAdvanced="true"
      @download="downloadItem"
      @tagManagement="handleTagManagement(detailFile?.name)"
      @block="handleBlock(detailFile?.name)"
      @white="handleWhite(detailFile?.name)"
      @delete="deleteItemFromDetail"
      @metadataUpdated="handleMetadataUpdated"
      @fileRenamed="handleFileRenamed"
    />

    <!-- 标签管理：与「文件管理」页共用同一弹窗 -->
    <TagManagementDialog
      v-model="showTagDialog"
      :fileId="currentTagFile"
      :fileMetadata="detailFile?.metadata || {}"
      @tagsUpdated="handleTagsUpdated"
    />
  </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import { copyText } from '@/utils/clipboard';
import { fileLink } from '@/utils/fileLink';
import { buildFileDetail } from '@/utils/fileDetail';
import FileDetailDialog from '@/components/dashboard/FileDetailDialog.vue';
import TagManagementDialog from '@/components/dashboard/TagManagementDialog.vue';
import img404 from '@/assets/404.png';

/** 每页向服务端拉取的条数 / 每次滚动补渲染的条数 */
const PAGE_SIZE = 200;
const RENDER_STEP = 30;

export default {
  name: 'HistoryPage',
  components: { FileDetailDialog, TagManagementDialog },
  data() {
    return {
      loading: true,
      loadingMore: false,
      viewMode: 'grid',
      items: [], // 已从服务端拉取的全部条目（时间倒序）
      renderedCount: RENDER_STEP, // 时间线已渲染条数（懒加载）
      serverStart: 0,
      serverHasMore: true,
      filter: { user: 'all', range: 'all', fileType: 'all', search: '' },
      userOptions: [],
      // 文件详情弹窗（与后台文件管理共用同一模板）
      showDetail: false,
      detailFile: null,
      // 标签管理弹窗（详情页「标签」按钮打开；有「标签」按钮后仍需一个标签编辑入口）
      showTagDialog: false,
      currentTagFile: '',
    };
  },
  computed: {
    sessionRole() {
      return this.$store?.getters?.sessionRole || '';
    },
    isAdminRole() {
      return this.$store?.getters?.isAdminRole === true;
    },
    canDelete() {
      return this.$store?.getters?.canDelete !== false;
    },
    /** 时间范围过滤（服务端按时间倒序返回，越界后即可停止续页） */
    filteredItems() {
      const start = this.rangeStart();
      if (!start) return this.items;
      return this.items.filter((it) => Number(it.metadata?.TimeStamp || 0) >= start);
    },
    displayItems() {
      return this.filteredItems.slice(0, this.renderedCount);
    },
    groups() {
      const map = new Map();
      for (const it of this.displayItems) {
        const key = this.dayKey(it.metadata?.TimeStamp);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(it);
      }
      return Array.from(map.entries())
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([date, items]) => ({ date, items }));
    },
    hasMore() {
      return this.renderedCount < this.filteredItems.length || this.serverHasMore;
    },
    /**
     * 文件详情弹窗的全部 props（file / fileLink / urls）。
     * 统一走 utils/fileDetail.buildFileDetail —— 与后台「文件管理」共用一套构造逻辑。
     */
    detailProps() {
      return buildFileDetail(this.detailFile);
    },
    detailPreviewLink() {
      return this.detailProps.fileLink;
    },
    detailUrls() {
      return this.detailProps.urls;
    },
  },
  watch: {
    /** 切换时间范围后重置渲染窗口，避免一次渲染过多 */
    'filter.range'() {
      this.renderedCount = RENDER_STEP;
    },
  },
  mounted() {
    const savedMode = localStorage.getItem('historyViewMode');
    if (savedMode) this.viewMode = savedMode;

    // 支持从「系统状态」统计徽章带查询参数跳入（?range=today&user=xxx&type=image）
    const q = this.$route.query || {};
    if (q.range) this.filter.range = String(q.range);
    if (q.user) this.filter.user = String(q.user);
    if (q.type) this.filter.fileType = String(q.type);

    if (this.isAdminRole) this.fetchUserOptions();
    this.reload();
  },
  methods: {
    /** 时间范围起点（毫秒时间戳）；0 表示不限 */
    rangeStart() {
      const now = new Date();
      const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      switch (this.filter.range) {
        case 'today':
          return day0;
        case 'yesterday':
          return day0 - 86400000;
        case 'week':
          return day0 - 6 * 86400000;
        case 'month':
          return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        case 'year':
          return new Date(now.getFullYear(), 0, 1).getTime();
        default:
          return 0;
      }
    },
    dayKey(ts) {
      const d = new Date(Number(ts) || Date.now());
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },
    formatTime(ts) {
      const d = new Date(Number(ts) || 0);
      if (!Number.isFinite(d.getTime())) return '-';
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },
    /** 文件外链：全站统一出口（自定义访问域名优先）+ File_ID + 原扩展名 */
    urlOf(item) {
      if (!item?.name) return '';
      const ext = item.metadata?.FileExt ? `.${item.metadata.FileExt}` : '';
      return fileLink(item.name, ext);
    },
    isImage(item) {
      if (item?.metadata?.FileType === 'image') return true;
      const ext = String(item?.metadata?.FileExt || '').toLowerCase();
      return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif', 'ico'].includes(ext);
    },
    isVideo(item) {
      if (item?.metadata?.FileType === 'video') return true;
      const ext = String(item?.metadata?.FileExt || '').toLowerCase();
      return ['mp4', 'webm', 'ogg', 'mkv', 'mov', 'm4v'].includes(ext);
    },
    onImgError(e) {
      e.target.src = img404;
    },
    goBack() {
      if (window.history.length > 1) this.$router.back();
      else this.$router.push({ name: 'dashboard' });
    },
    toggleViewMode() {
      this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
      localStorage.setItem('historyViewMode', this.viewMode);
    },
    /** 应用筛选：清空已加载数据并重新拉第一页 */
    applyFilter() {
      this.renderedCount = RENDER_STEP;
      this.reload();
    },
    reload() {
      this.items = [];
      this.serverStart = 0;
      this.serverHasMore = true;
      this.loading = true;
      this.$nextTick(() => this.fetchPage());
    },
    /** 管理员：拉取上传用户下拉（来自用户管理账户列表） */
    async fetchUserOptions() {
      try {
        const res = await fetchWithAuth('/api/manage/users/options');
        if (!res.ok) return;
        const rows = await res.json();
        const list = Array.isArray(rows) ? rows : [];
        this.userOptions = list.map((r) => r.username).filter(Boolean);
      } catch {
        this.userOptions = [];
      }
    },
    /** 向服务端续一页（时间倒序，超出所选时间范围即可提前停止） */
    async fetchPage() {
      if (this.loadingMore || !this.serverHasMore) return;
      this.loadingMore = true;
      try {
        const params = new URLSearchParams();
        params.set('dir', '');
        params.set('recursive', 'true');
        params.set('start', String(this.serverStart));
        params.set('count', String(PAGE_SIZE));
        if (this.filter.search) params.set('search', this.filter.search.trim());
        if (this.filter.user && this.filter.user !== 'all') params.set('user', this.filter.user);
        // 文件类型走服务端筛选：普通用户/管理员都可用的合法取值
        const typeMap = { image: 'image', video: 'video', audio: 'audio', other: 'other' };
        if (typeMap[this.filter.fileType]) params.set('fileType', typeMap[this.filter.fileType]);

        const res = await fetchWithAuth(`/api/manage/list?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rows = Array.isArray(data?.files) ? data.files : [];
        this.items.push(...rows);

        const total = Number(data?.totalCount || 0);
        this.serverStart = this.items.length;
        this.serverHasMore = rows.length >= PAGE_SIZE && total > this.serverStart;

        // 已越过所选时间范围起点 → 无需再续页（服务端按时间倒序）
        const start = this.rangeStart();
        if (start) {
          const oldest = rows.length ? Number(rows[rows.length - 1]?.metadata?.TimeStamp || 0) : 0;
          if (oldest && oldest < start) this.serverHasMore = false;
        }
      } catch (err) {
        this.$message?.error(`${this.$t('uploadHistory.loading')} ${err.message}`);
        this.serverHasMore = false;
      } finally {
        this.loading = false;
        this.loadingMore = false;
      }
    },
    /** 滚动到底部：先补渲染，渲染完了再向服务端续页 */
    async handleScroll(e) {
      const el = e.target;
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 240) return;
      if (this.renderedCount < this.filteredItems.length) {
        this.renderedCount += RENDER_STEP;
        return;
      }
      await this.fetchPage();
      if (this.renderedCount < this.filteredItems.length) this.renderedCount += RENDER_STEP;
    },
    async copyLink(url) {
      if (!url) return;
      const ok = await copyText(url);
      if (ok) this.$message.success(this.$t('uploadHistory.linkCopied'));
      else this.$message.warning(url);
    },
    openLink(url) {
      if (url) window.open(url, '_blank', 'noopener');
    },
    /** 点击文件（卡片 / 列表模式）默认打开文件详情 —— 与后台文件管理同一个详情模板 */
    openDetail(item) {
      if (!item) return;
      this.detailFile = item;
      this.showDetail = true;
    },
    /** 详情弹窗里的「下载」 */
    downloadItem() {
      const item = this.detailFile;
      if (!item?.name) return;
      const a = document.createElement('a');
      a.href = this.urlOf(item);
      a.download = item.metadata?.FileName || item.name;
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
    },
    /** 详情弹窗里的「删除」：复用列表删除逻辑，成功后一并关闭弹窗 */
    /* ---------- 详情弹窗的「标签 / 黑名单 / 白名单」----------
       与「文件管理」页体验一致：标签打开 TagManagementDialog；
       黑白名单确认后直接调单文件接口，并就地同步该条的 ListType。 */
    handleTagManagement(fileId) {
      if (!fileId) return;
      this.currentTagFile = fileId;
      this.showTagDialog = true;
    },
    /** 标签保存后同步列表项与详情对象（弹窗回调给的是 tags 数组） */
    handleTagsUpdated(tags) {
      this.handleMetadataUpdated(this.currentTagFile, { Tags: Array.isArray(tags) ? tags : [] });
    },
    handleBlock(fileId) {
      this.applyListType('block', fileId, 'Block');
    },
    handleWhite(fileId) {
      this.applyListType('white', fileId, 'White');
    },
    /** 加入黑名单 / 白名单：确认 → 调接口 → 就地更新访问状态 */
    applyListType(action, fileId, listType) {
      if (!fileId) return;
      const successKey = action === 'block' ? 'dashboard.blockSuccess' : 'dashboard.whiteSuccess';
      const failKey = action === 'block' ? 'dashboard.blockFailed' : 'dashboard.whiteFailed';
      this.$confirm(
        this.$t(action === 'block' ? 'dashboard.blockConfirm' : 'dashboard.whiteConfirm'),
        this.$t('dashboard.deleteConfirmTitle'),
        {
          confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
          cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
          type: 'warning',
        },
      )
        .then(() =>
          fetchWithAuth(`/api/manage/${action}/${fileId}`, { method: 'GET' }).then((response) => {
            if (!response.ok) return Promise.reject(new Error('Request failed'));
            this.handleMetadataUpdated(fileId, { ListType: listType });
            this.$message.success(this.$t(successKey));
          }),
        )
        .catch((e) => {
          // 用户点「取消」也会进 catch，这里只对真正的请求失败提示
          if (e !== 'cancel' && e !== 'close') this.$message.error(this.$t(failKey));
        });
    },
    deleteItemFromDetail() {
      if (this.detailFile) this.deleteItem(this.detailFile, true);
    },
    /** 详情里改了元数据（文件名/类型/标签等）：同步回列表项，避免重新加载 */
    handleMetadataUpdated(fileId, metadata) {
      const patch = metadata || {};
      const it = this.items.find((i) => i.name === fileId);
      if (it) it.metadata = { ...it.metadata, ...patch };
      if (this.detailFile && this.detailFile.name === fileId) {
        this.detailFile = { ...this.detailFile, metadata: { ...this.detailFile.metadata, ...patch } };
      }
    },
    /** 详情里重命名了 File_ID：同步列表项与当前详情对象 */
    handleFileRenamed(oldFileId, newFileId, metadata) {
      const patch = metadata || {};
      const it = this.items.find((i) => i.name === oldFileId);
      if (it) {
        it.name = newFileId;
        it.metadata = { ...it.metadata, ...patch };
      }
      if (this.detailFile && this.detailFile.name === oldFileId) {
        this.detailFile = { ...this.detailFile, name: newFileId, metadata: { ...this.detailFile.metadata, ...patch } };
      }
    },
    /** 删除该文件记录（软删除，同时清理各渠道副本） */
    deleteItem(item, closeDetail = false) {
      this.$confirm(this.$t('uploadHistory.deleteConfirmMessage'), this.$t('uploadHistory.clearConfirmTitle'), {
        confirmButtonText: this.$t('uploadHistory.clearConfirmOk'),
        cancelButtonText: this.$t('uploadHistory.clearConfirmCancel'),
        type: 'warning',
      })
        .then(async () => {
          try {
            const res = await fetchWithAuth(`/api/manage/delete/${encodeURIComponent(item.name)}?folder=false`, {
              method: 'GET',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data?.success === false) throw new Error(data?.message || `HTTP ${res.status}`);
            this.items = this.items.filter((i) => i.name !== item.name);
            if (closeDetail) {
              this.showDetail = false;
              this.detailFile = null;
            }
            this.$message.success(this.$t('uploadHistory.recordDeleted'));
          } catch (err) {
            this.$message.error(`${this.$t('uploadHistory.copyFailed')} ${err.message}`);
          }
        })
        .catch(() => {});
    },
  },
};
</script>

<style scoped>
.history-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--admin-container-bg-color);
  color: var(--upload-text-color);
}

.history-topbar {
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

.filter-select {
  width: 130px;
}

.filter-search {
  width: 200px;
}

.icon-btn,
.back-btn {
  background-color: var(--toolbar-button-bg-color);
  box-shadow: var(--toolbar-button-shadow);
  border: none;
  color: var(--theme-toggle-color);
}

.history-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px 60px;
}

.history-group {
  position: relative;
  padding-left: 28px;
  border-left: 2px solid var(--el-border-color-lighter);
  margin-left: 8px;
  padding-bottom: 28px;
}

.history-group:last-child {
  border-left-color: transparent;
}

.timeline-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  position: relative;
}

.timeline-dot {
  position: absolute;
  left: -37px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--el-upload-dragger-uniform-color);
  box-sizing: border-box;
}

.date-label {
  font-size: 18px;
  font-weight: 700;
  background: var(--upload-main-title-color);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}

.date-count {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--toolbar-button-bg-color);
  opacity: 0.8;
}

/* 网格视图 */
.grid-view {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 18px;
}

.grid-item {
  background: var(--toolbar-button-bg-color);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--glass-border);
  box-shadow: var(--toolbar-button-shadow);
  transition: box-shadow 0.3s ease;
}

.grid-item:hover {
  box-shadow: var(--toolbar-button-shadow-hover);
}

/* 卡片 / 列表项整体可点击 —— 点击默认打开「文件详情」 */
.grid-item.is-clickable,
.list-item.is-clickable {
  cursor: pointer;
}

.list-item.is-clickable:hover {
  box-shadow: var(--toolbar-button-shadow-hover);
}

.grid-preview {
  height: 150px;
  position: relative;
  background: var(--el-fill-color-light);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.grid-preview img,
.grid-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-icon-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 42px;
  color: var(--theme-toggle-color);
  opacity: 0.6;
}

.file-ext {
  font-size: 12px;
  text-transform: uppercase;
}

.grid-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  opacity: 0;
  transition: opacity 0.25s ease;
}

.grid-item:hover .grid-overlay {
  opacity: 1;
}

.grid-info {
  padding: 10px 12px;
}

.file-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 6px;
}

.grid-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  opacity: 0.65;
}

.upload-user {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  opacity: 0.7;
  margin-top: 4px;
}

/* 列表视图 */
.list-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  background: var(--toolbar-button-bg-color);
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  box-shadow: var(--toolbar-button-shadow);
}

.list-preview {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--el-fill-color-light);
  display: flex;
  align-items: center;
  justify-content: center;
}

.list-preview img,
.list-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-icon-wrapper-small {
  font-size: 22px;
  color: var(--theme-toggle-color);
  opacity: 0.6;
}

.list-info {
  flex: 1;
  min-width: 0;
}

.file-url {
  font-size: 12px;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 12px;
  opacity: 0.7;
  min-width: 150px;
}

.list-actions {
  display: flex;
  gap: 8px;
}

.loading-state,
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

.load-more-container {
  display: flex;
  justify-content: center;
  padding: 16px;
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0.75;
}

.load-more-hint,
.no-more-hint {
  font-size: 13px;
  opacity: 0.5;
}

.history-body::-webkit-scrollbar {
  width: 8px;
}

.history-body::-webkit-scrollbar-thumb {
  background: var(--el-border-color);
  border-radius: 4px;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .history-topbar {
    padding: 10px 12px;
  }

  .history-body {
    padding: 16px 12px 60px;
  }

  .filter-select,
  .filter-search {
    width: calc(50% - 5px);
  }

  .grid-view {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }

  .grid-preview {
    height: 120px;
  }

  .list-meta {
    display: none;
  }
}
</style>
