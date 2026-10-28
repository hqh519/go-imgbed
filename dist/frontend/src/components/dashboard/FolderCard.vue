<template>
    <!--
        v2.5.0（v20261023-2）：文件夹卡片同样改为「上下两部分」：
          上 = 文件夹图标（悬浮时右上角选择圆圈 + 操作按钮）
          下 = 文件夹名称 + 子文件夹 / 文件数量统计
        行为不变：点击进入文件夹；批量选择仍走页面下方操作栏。
    -->
    <div
        class="folder-card"
        :class="{ 'is-selected': localSelected }"
        @contextmenu.prevent
        @touchstart="$emit('touchstart', $event)"
        @touchend="$emit('touchend', $event)"
        @touchmove="$emit('touchmove', $event)"
    >
        <!-- 上半部分：文件夹图标 -->
        <div class="folder-preview" @click="$emit('enter')">
            <font-awesome-icon icon="folder-open" class="folder-icon-svg"/>
            <!-- 悬浮层：选择 / 操作 -->
            <div class="folder-overlay">
                <div class="overlay-top">
                    <span></span>
                    <el-checkbox
                        v-model="localSelected"
                        class="card-select"
                        @click.stop
                        @change="$emit('update:selected', localSelected)"
                    ></el-checkbox>
                </div>
                <div v-if="showActions" class="overlay-actions" @click.stop>
                    <el-tooltip :disabled="disableTooltip" :content="$t('dashboard.copyLink')" placement="top" :show-after="600">
                        <button class="overlay-btn" @click.stop="$emit('copy')">
                            <font-awesome-icon icon="copy"></font-awesome-icon>
                        </button>
                    </el-tooltip>
                    <el-tooltip :disabled="disableTooltip" :content="$t('dashboard.moveFile')" placement="top" :show-after="600">
                        <button class="overlay-btn" @click.stop="$emit('move')">
                            <font-awesome-icon icon="file-export"></font-awesome-icon>
                        </button>
                    </el-tooltip>
                    <el-tooltip :disabled="disableTooltip" :content="$t('dashboard.delete')" placement="top" :show-after="600">
                        <button class="overlay-btn is-danger" @click.stop="$emit('delete')">
                            <font-awesome-icon icon="trash-alt"></font-awesome-icon>
                        </button>
                    </el-tooltip>
                </div>
            </div>
        </div>

        <!-- 下半部分：名称 + 数量统计 + 创建用户（v2.6.0 第三行） -->
        <div class="card-info" @click="$emit('enter')">
            <div class="file-name" :title="folderName"><span class="name-start">{{ folderNameParts.start }}</span><span class="name-end">{{ folderNameParts.end }}</span></div>
            <div class="folder-stats">
                <template v-if="statsText">{{ statsText }}</template>
                <template v-else>-</template>
            </div>
            <div class="folder-creator" :title="$t('dashboard.folderCreator')">
                <font-awesome-icon icon="user" />
                {{ creatorName || '-' }}
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: 'FolderCard',
    props: {
        name: { type: String, required: true },
        selected: { type: Boolean, default: false },
        showActions: { type: Boolean, default: true },
        disableTooltip: { type: Boolean, default: false },
        /** v2.5.0：该文件夹的统计 { folders, files }（后端 /list 的 directoryStats 下发） */
        folderStats: { type: Object, default: null }
    },
    emits: ['update:selected', 'enter', 'copy', 'move', 'delete', 'touchstart', 'touchend', 'touchmove'],
    data() {
        return {
            localSelected: this.selected
        }
    },
    computed: {
        folderName() {
            const parts = this.name.split('/').filter(Boolean);
            return parts[parts.length - 1] || this.name;
        },
        /**
         * v2.8.0：文件夹名中间省略（与 FileCard 文件名同规则）：
         * ≤24 全显，否则保留头部与尾部各 12 字符，中段由 CSS 按宽度自动省略。
         */
        folderNameParts() {
            const name = this.folderName || '';
            if (name.length <= 24) return { start: name, end: '' };
            return { start: name.slice(0, -12), end: name.slice(-12) };
        },
        /** 「X 个子文件夹 · Y 个文件」；统计缺失时显示占位 */
        statsText() {
            const s = this.folderStats;
            if (!s || (s.folders === undefined && s.files === undefined)) return '';
            return this.$t('dashboard.folderStat', {
                folders: Number(s.folders || 0),
                files: Number(s.files || 0)
            });
        },
        /** v2.6.0：创建用户名（后端 directoryStats.creator = 文件夹内最早文件的上传者） */
        creatorName() {
            return this.folderStats?.creator || '';
        }
    },
    watch: {
        selected(val) {
            this.localSelected = val;
        }
    }
}
</script>

<style scoped>
/* ── 卡片整体：与 FileCard 同构 ───────────────────────────────── */
.folder-card {
    box-sizing: border-box;
    width: 100%;
    background: var(--toolbar-button-bg-color);
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--glass-border);
    box-shadow: var(--toolbar-button-shadow);
    transition: box-shadow 0.3s ease;
    content-visibility: auto;
    contain: layout paint style;
    contain-intrinsic-size: 220px;
    cursor: pointer;
}
.folder-card:hover {
    box-shadow: var(--toolbar-button-shadow-hover);
}
.folder-card.is-selected {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 1px var(--el-color-primary);
}

/* ── 上半部分：文件夹图标 ─────────────────────────────────────── */
.folder-preview {
    height: 150px;
    position: relative;
    background: var(--el-fill-color-light);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: var(--el-color-primary);
}
.folder-icon-svg {
    font-size: clamp(40px, 4vw, 64px);
    transition: transform 0.4s ease;
    opacity: 0.85;
}
.folder-card:hover .folder-icon-svg {
    transform: scale(1.06);
}

/* 悬浮层 */
.folder-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
}
.folder-card:hover .folder-overlay,
.folder-card:focus-within .folder-overlay {
    opacity: 1;
    pointer-events: auto;
}
.overlay-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 6px 8px;
}
.card-select {
    flex-shrink: 0;
}
/* v2.8.0：手机端/平板端下选择圆圈整体上移 4px（PC 端保持不动） */
@media (max-width: 1199px) {
    .card-select {
        margin-top: -4px;
    }
}
.card-select :deep(.el-checkbox__inner) {
    width: 16px !important;
    min-width: 16px;
    height: 16px !important;
    min-height: 16px;
    border-radius: 50% !important;
    /* v2.8.0：未选中时圆圈内部透明（不填充白色） */
    background: transparent;
}
/* v2.8.5：选中时恢复主题色填充（transparent 规则会按级联顺序盖掉 EP 选中态默认背景） */
.card-select :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
    background-color: var(--el-color-primary);
    border-color: var(--el-color-primary);
}
/* v2.8.5：选中态对勾保持白色可见 */
.card-select :deep(.el-checkbox__input.is-checked .el-checkbox__inner::after) {
    border-color: #fff;
}
.overlay-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding-bottom: 12px;
}
.overlay-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 50%;
    background: var(--el-color-primary);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    transition: transform 0.2s ease, background 0.2s ease;
}
.overlay-btn.is-danger {
    background: var(--el-color-danger);
}
.overlay-btn:hover {
    transform: scale(1.1);
    filter: brightness(1.1);
}
.overlay-btn:active {
    transform: scale(0.95);
}

/* ── 下半部分：名称 + 统计 ────────────────────────────────────── */
.card-info {
    padding: 10px 12px;
    background: var(--toolbar-button-bg-color);
}
.file-name {
    font-size: 13px;
    font-weight: 500;
    display: flex;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    margin-bottom: 6px;
    color: var(--upload-text-color);
}
/* v2.8.0：中间省略 —— start 可收缩省略，end 固定保留（含尾部） */
.file-name .name-start {
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.file-name .name-end {
    flex-shrink: 0;
    white-space: nowrap;
}
.folder-stats {
    font-size: 12px;
    opacity: 0.65;
    color: var(--upload-text-color);
}
/* v2.6.0：第三行 —— 创建用户名（与 FileCard 的 upload-user 同款样式，保证卡片等高） */
.folder-creator {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    opacity: 0.7;
    margin-top: 4px;
    max-width: 100%;
    overflow: hidden;
    color: var(--upload-text-color);
}

/* ── 移动端：无 hover —— 选择常显，操作隐藏 ───────────────────── */
@media (max-width: 768px) {
    .folder-preview {
        height: 130px;
    }
    .folder-card {
        contain-intrinsic-size: 190px;
    }
    .folder-overlay {
        opacity: 1;
        pointer-events: none;
        justify-content: flex-start;
    }
    .overlay-actions {
        display: none;
    }
    .card-info {
        padding: 8px 10px;
    }
}
</style>
