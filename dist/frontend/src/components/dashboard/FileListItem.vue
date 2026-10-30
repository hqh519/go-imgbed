<template>
    <!--
        v2.5.0（v20261023-2）：列表项改为「历史记录列表」样式（圆角卡片行，无表头）。
        列依次：选择按钮 / 缩略图 / 文件名（上行）+ 存储·备份渠道简称（下行）/
        文件大小（上）+ 上传用户（中）+ 上传时间（下）/ 复制·打开·移动。
        行为不变：点击封面 / 文件名 = 打开文件详情（文件夹进入）；批量选择仍走页面下方操作栏。
    -->
    <div
        class="list-item"
        :class="{ 'is-selected': localSelected }"
        @contextmenu.prevent
        @touchstart="$emit('touchstart', $event)"
        @touchend="$emit('touchend', $event)"
        @touchmove="$emit('touchmove', $event)"
    >
        <!-- 1. 选择按钮 -->
        <div class="list-col list-col-checkbox">
            <el-checkbox
                v-model="localSelected"
                @click.stop
                @change="handleSelectChange"
            />
        </div>
        <!-- 2. 缩略图（v2.8.6b：点击打开文件详情页；预览改由渠道行小眼睛触发） -->
        <div
            class="list-col list-col-preview"
            @click="handlePreviewClick"
        >
            <template v-if="isFolder">
                <font-awesome-icon icon="folder-open" class="list-folder-icon"/>
            </template>
            <template v-else-if="isVideo">
                <video :src="fileLink" class="list-preview-img" muted preload="metadata"></video>
            </template>
            <template v-else-if="isImage">
                <img :src="fileLink" class="list-preview-img" loading="lazy" decoding="async" />
            </template>
            <template v-else>
                <font-awesome-icon icon="file" class="list-file-icon"/>
            </template>
        </div>
        <!-- 3. 文件名（上行）+ 渠道简称 / 文件夹统计（下行） -->
        <div class="list-col list-col-name" @click="handlePreviewClick">
            <div class="name-line" :title="displayName">
                <span class="filename-start">{{ fileNameStart }}</span><span class="filename-end">{{ fileNameEnd }}</span>
            </div>
            <!-- v2.6.0：文件夹名称下加「子文件夹 / 文件数」统计行
                 v2.7.0：恒渲染该行（无统计时用占位空格），保证文件夹行与文件行高度一致 -->
            <div v-if="isFolder" class="channel-line">
                <span class="folder-stat-line">{{ folderStatsText || '\u00A0' }}</span>
            </div>
            <div v-if="!isFolder" class="channel-line">
                <!--
                    v2.8.6b：预览小眼睛回到渠道行起始位置（存储渠道简称图标前面）——
                    PC 悬停即预览、移动端长按 350ms 预览；锚定眼睛矩形弹出（不覆盖眼睛）。
                    缩略图恢复「点击打开详情页」。
                -->
                <button
                    v-if="isImage || isVideo"
                    type="button"
                    class="list-eye-btn"
                    data-role="preview-eye"
                    :aria-label="$t('dashboard.hoverPreview')"
                    @click.stop
                    @mouseenter="handleEyeEnter"
                    @mouseleave="$emit('previewEnd')"
                    @touchstart.stop.prevent="handleEyeTouchStart"
                    @touchmove.stop="handleEyeTouchMove"
                    @touchend.stop="handleEyeTouchEnd"
                    @touchcancel.stop="handleEyeTouchEnd"
                >
                    <font-awesome-icon icon="eye"/>
                </button>
                <span class="channel-short" :title="storageChannelText">{{ storageChannelShort || '-' }}</span>
                <template v-if="backupTags.length">
                    <span
                        v-for="(bk, i) in backupTags"
                        :key="'bk-' + i"
                        class="channel-short is-backup"
                        :title="bk.full"
                    >{{ bk.short }}</span>
                </template>
                <!-- v2.8.7：移动端在渠道简称后面补文件大小（PC 端第三列已有大小，隐藏避免重复） -->
                <span class="channel-size">{{ fileSizeDisplay }}</span>
            </div>
        </div>
        <!-- 4. 大小（上）/ 上传用户（中）/ 上传时间（下）
             v2.6.0：文件夹也显示三行 —— 第一行"-"、第二行所属用户、第三行创建时间 -->
        <div class="list-col list-col-meta">
            <template v-if="!isFolder">
                <span class="meta-size">{{ fileSizeDisplay }}</span>
                <span v-if="uploadUser" class="meta-user" :title="uploadUser">
                    <font-awesome-icon icon="user" />
                    {{ uploadUser }}
                </span>
                <span class="meta-time">{{ uploadDate }}</span>
            </template>
            <template v-else>
                <span class="meta-size">-</span>
                <span class="meta-user">
                    <font-awesome-icon icon="user" />
                    {{ folderCreator || '-' }}
                </span>
                <span class="meta-time">{{ folderCreatedAtDisplay }}</span>
            </template>
        </div>
        <!-- 5. 操作：复制 / 打开 / 移动 -->
        <div class="list-col list-col-actions">
            <template v-if="!isFolder">
                <el-tooltip :content="$t('dashboard.copyLink')" placement="top" :show-after="1000">
                    <button class="list-action-btn" @click.stop="$emit('copy')">
                        <font-awesome-icon icon="copy"/>
                    </button>
                </el-tooltip>
                <el-tooltip :content="$t('dashboard.openLink')" placement="top" :show-after="1000">
                    <button class="list-action-btn" @click.stop="$emit('openLink')">
                        <font-awesome-icon icon="external-link-alt"/>
                    </button>
                </el-tooltip>
                <!-- v2.6.0：移动端列表模式隐藏「移动」按钮（is-move + CSS） -->
                <el-tooltip :content="$t('dashboard.moveFile')" placement="top" :show-after="1000">
                    <button class="list-action-btn is-move" @click.stop="$emit('move')">
                        <font-awesome-icon icon="file-export"/>
                    </button>
                </el-tooltip>
            </template>
            <template v-else>
                <el-tooltip :content="$t('dashboard.copyLink')" placement="top" :show-after="1000">
                    <button class="list-action-btn" @click.stop="$emit('folderCopy')">
                        <font-awesome-icon icon="copy"/>
                    </button>
                </el-tooltip>
                <el-tooltip :content="$t('dashboard.moveFile')" placement="top" :show-after="1000">
                    <button class="list-action-btn is-move" @click.stop="$emit('move')">
                        <font-awesome-icon icon="file-export"/>
                    </button>
                </el-tooltip>
            </template>
        </div>
    </div>
</template>

<script>
import { splitFileName } from '../../utils/fileName';
export default {
    name: 'FileListItem',
    props: {
        item: { type: Object, required: true },
        selected: { type: Boolean, default: false },
        fileLink: { type: String, default: '' }
    },
    emits: ['update:selected', 'enter', 'detail', 'copy', 'folderCopy', 'move', 'delete', 'download', 'openLink', 'touchstart', 'touchend', 'touchmove', 'preview', 'previewMove', 'previewEnd'],
    data() {
        return {
            localSelected: this.selected,
            // v2.8.6b：渠道行小眼睛长按预览（移动端）
            eyePressTimer: null,
            eyePreviewing: false
        }
    },
    computed: {
        isFolder() {
            // 检查 isFolder 属性或名称以 / 结尾
            return this.item.isFolder || this.item.name?.endsWith('/');
        },
        /** v2.6.0：文件夹统计（后端 directoryStats 经 metadata.folderStats 下发） */
        folderStats() {
            return this.isFolder ? this.item.metadata?.folderStats || null : null;
        },
        /** v2.6.0：「X 个子文件夹 · Y 个文件」 */
        folderStatsText() {
            const s = this.folderStats;
            if (!s || (s.folders === undefined && s.files === undefined)) return '';
            return this.$t('dashboard.folderStat', {
                folders: Number(s.folders || 0),
                files: Number(s.files || 0)
            });
        },
        /** v2.6.0：文件夹创建用户（= 文件夹内最早文件的上传者） */
        folderCreator() {
            return this.folderStats?.creator || '';
        },
        /** v2.6.0：文件夹创建时间（年-月-日） */
        folderCreatedAtDisplay() {
            const ts = Number(this.folderStats?.createdAt || 0);
            if (!ts) return '-';
            const d = new Date(ts);
            if (!Number.isFinite(d.getTime())) return '-';
            const p = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        },
        /**
         * 判断文件类型：**优先 metadata.FileType**（后端按 mime 下发 image / video / audio / other），
         * 再退回按显示文件名（metadata.FileName）的后缀判断。
         * 不能用 item.name —— 它是 File_ID（`M40QqttK...`），本身不带扩展名，
         * 只按它判断会导致列表视图永远不出缩略图（历史 bug）。
         */
        fileTypeName() {
            return String(this.item.metadata?.FileType || '').toLowerCase();
        },
        /** 供后缀判断用的真实文件名 */
        realName() {
            const n = this.item.metadata?.FileName || this.item.name || '';
            return String(n).toLowerCase();
        },
        isVideo() {
            if (this.fileTypeName.includes('video')) return true;
            const name = this.realName;
            return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov') || name.endsWith('.avi');
        },
        isImage() {
            if (this.fileTypeName.includes('image')) return true;
            const name = this.realName;
            return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') ||
                   name.endsWith('.gif') || name.endsWith('.webp') || name.endsWith('.svg') || name.endsWith('.bmp');
        },
        displayName() {
            if (this.isFolder) {
                const parts = this.item.name.split('/').filter(Boolean);
                return parts[parts.length - 1] || this.item.name;
            }
            return this.item.metadata?.FileName || this.getFileName(this.item.name);
        },
        /**
         * 文件名中间省略：CSS 双 span（start 可收缩省略，end 固定），
         * 保证「头部 + 尾部(含扩展名)」始终可见，中间段按宽度自动省略。
         */
        /* v2.8.6：文件名中间省略统一口径（start 可收缩 + end 固定） */
        fileNameStart() {
            return splitFileName(this.displayName).start;
        },
        fileNameEnd() {
            return splitFileName(this.displayName).end;
        },
        /** 上传日期（年-月-日，与历史记录一致） */
        uploadDate() {
            const ts = this.item.uploaded || this.item.metadata?.TimeStamp;
            if (!ts) return '-';
            const d = new Date(ts);
            if (!Number.isFinite(d.getTime())) return '-';
            const p = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        },
        /** 被访问次数（外链真实访问累计；管理端预览不计） */
        viewsCount() {
            return Number(this.item.metadata?.Views || 0);
        },
        /** 存储渠道：渠道类型 / 渠道名称（title 悬浮用） */
        storageChannelText() {
            const type = this.item.metadata?.Channel;
            const name = this.item.metadata?.ChannelName;
            if (type && name) return `${type} / ${name}`;
            return type || name || '';
        },
        /** 存储渠道简称（COS / ALI / EI …） */
        storageChannelShort() {
            return this.item.metadata?.ChannelShort || '';
        },
        /** 备份渠道（有备份才显示）：{ type, short, full } */
        backupTags() {
            const list = this.item.metadata?.BackupChannels;
            if (!Array.isArray(list)) return [];
            return list
                .map((b) => {
                    const label = b.label || '';
                    const name = b.name || '';
                    return {
                        type: b.type || '',
                        short: b.short || label || name,
                        full: label && name ? `${label} / ${name}` : name || label,
                    };
                })
                .filter((b) => b.type || b.short);
        },
        /** 上传用户（账户名；未登录上传为空） */
        uploadUser() {
            return this.item.metadata?.UploadUser || '';
        },
        fileSizeDisplay() {
            const sizeBytes = this.item.metadata?.FileSizeBytes;
            const sizeMB = this.item.metadata?.FileSize;
            if (sizeBytes) {
                if (sizeBytes < 1024) {
                    return `${sizeBytes} B`;
                } else if (sizeBytes < 1024 * 1024) {
                    return `${(sizeBytes / 1024).toFixed(1)} KB`;
                } else {
                    return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`;
                }
            } else if (sizeMB) {
                return `${sizeMB} MB`;
            }
            return '-';
        }
    },
    watch: {
        selected(val) {
            this.localSelected = val;
        }
    },
    beforeUnmount() {
        this.clearEyePressTimer();
    },
    methods: {
        /* v2.8.6b：PC 悬停小眼睛 → 预览锚定在眼睛矩形上 */
        handleEyeEnter(e) {
            this.$emit('preview', e, { rect: e.currentTarget.getBoundingClientRect() });
        },
        /* v2.8.6b：移动端长按小眼睛预览（触屏无 hover）——
           按住 350ms 弹出预览，松手/明显滑动（>10px）收起；
           微抖不取消（真机手指按下必然有 touchmove，此前一刀切导致长按弹不出来）。
           锚点用眼睛矩形，浮层贴着眼睛弹出且不覆盖眼睛。 */
        handleEyeTouchStart(e) {
            if (this.isFolder || (!this.isImage && !this.isVideo)) return;
            this.clearEyePressTimer();
            const point = e.touches && e.touches[0] ? e.touches[0] : e;
            this._eyeStartX = point.clientX || 0;
            this._eyeStartY = point.clientY || 0;
            // currentTarget 在事件派发结束后会被置空，必须在定时器外先取好
            const btnRect = e.currentTarget ? e.currentTarget.getBoundingClientRect() : null;
            this.eyePressTimer = setTimeout(() => {
                this.eyePressTimer = null;
                this.eyePreviewing = true;
                const rect = btnRect || { left: this._eyeStartX, top: this._eyeStartY, right: this._eyeStartX, bottom: this._eyeStartY };
                this.$emit('preview', { clientX: this._eyeStartX, clientY: this._eyeStartY }, { touch: true, rect });
            }, 350);
        },
        handleEyeTouchMove(e) {
            const point = e.touches && e.touches[0];
            if (point && typeof this._eyeStartX === 'number') {
                const dx = point.clientX - this._eyeStartX;
                const dy = point.clientY - this._eyeStartY;
                if (dx * dx + dy * dy > 100) {
                    this.clearEyePressTimer();
                    if (this.eyePreviewing) this.handleEyeTouchEnd();
                }
            }
        },
        handleEyeTouchEnd() {
            this.clearEyePressTimer();
            if (this.eyePreviewing) {
                this.eyePreviewing = false;
                this.$emit('previewEnd');
            }
        },
        clearEyePressTimer() {
            if (this.eyePressTimer) {
                clearTimeout(this.eyePressTimer);
                this.eyePressTimer = null;
            }
        },
        handleSelectChange(value) {
            this.localSelected = value;
            this.$emit('update:selected', value);
        },
        handlePreviewClick() {
            if (this.isFolder) {
                this.$emit('enter');
            } else {
                this.$emit('detail');
            }
        },
        getFileName(name) {
            const parts = (name || '').split('/');
            return parts[parts.length - 1];
        }
    }
}
</script>

<style scoped>
/* ── 历史记录风格的圆角卡片行（无表头、纵向留缝）────────────────── */
.list-item {
    display: grid;
    /* 选择 / 缩略图 / 文件名+渠道 / 大小+用户+时间 / 操作 */
    grid-template-columns: 40px 48px minmax(200px, 1fr) 180px auto;
    gap: 14px;
    align-items: center;
    padding: 10px 14px;
    background: var(--toolbar-button-bg-color);
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    box-shadow: var(--toolbar-button-shadow);
    transition: box-shadow 0.2s ease;
    content-visibility: auto;
    contain: layout paint style;
    contain-intrinsic-size: 70px;
    min-width: fit-content;
}
.list-item.is-selected {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 1px var(--el-color-primary);
}
.list-item:hover {
    box-shadow: var(--toolbar-button-shadow-hover);
}
.list-col {
    display: flex;
    align-items: center;
}
.list-col-checkbox {
    justify-content: center;
}
.list-col-checkbox :deep(.el-checkbox) {
    --el-checkbox-input-width: 16px;
    --el-checkbox-input-height: 16px;
}
.list-col-preview {
    justify-content: center;
    cursor: pointer;
}
.list-preview-img {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: 8px;
}
.list-folder-icon {
    font-size: 28px;
    color: var(--el-color-primary);
}
.list-file-icon {
    font-size: 24px;
    color: var(--el-text-color-secondary);
}

/* 3. 文件名 + 渠道简称（上下两行） */
.list-col-name {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    cursor: pointer;
    min-width: 0;
    color: var(--upload-text-color);
}
.list-col-name:hover {
    color: var(--primary-color-accent);
}
.name-line {
    display: flex;
    max-width: 100%;
    overflow: hidden;
    font-size: 13px;
    font-weight: 500;
}
.filename-start {
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.filename-end {
    flex-shrink: 0;
    white-space: nowrap;
}
.channel-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}
/* v2.8.6b：预览小眼睛（渠道行起始位置）—— 颜色与文件名文本一致，悬停轻微提亮 */
.list-eye-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--upload-text-color);
    opacity: 0.7;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 0.2s ease, color 0.2s ease, background-color 0.2s ease;
}
.list-eye-btn:hover {
    opacity: 1;
    color: var(--primary-color-accent);
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}
.list-eye-btn svg {
    display: block;
}
/* 渠道简称徽标（沿用列表视图原来的品牌配色语义：备份渠道橙色调） */
/* v2.8.9：渠道简称（存储 / 备份）改为与「预览小眼睛」同一套配色 ——
   文字用 --upload-text-color + 0.7 透明度，去掉绿/橙底色，只留同色系细边框 */
.channel-short {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 7px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    background: transparent;
    color: var(--upload-text-color);
    border: 1px solid color-mix(in srgb, var(--upload-text-color) 32%, transparent);
    opacity: 0.7;
}
.channel-short.is-backup {
    background: transparent;
    color: var(--upload-text-color);
    border-color: color-mix(in srgb, var(--upload-text-color) 32%, transparent);
    opacity: 0.7;
}

/* v2.8.7：渠道行内文件大小 —— 只在移动端显示（PC 端右侧第三列已有大小列） */
.channel-size {
    display: none;
    font-size: 11px;
    opacity: 0.65;
    white-space: nowrap;
    flex-shrink: 0;
}
@media (hover: none) and (pointer: coarse) {
    .channel-size {
        display: inline;
    }
}

/* v2.6.0：文件夹统计行（名称下方） */
.folder-stat-line {
    font-size: 11px;
    opacity: 0.65;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* 4. 大小 / 用户 / 时间（三行，右对齐同历史记录 list-meta） */
.list-col-meta {
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    font-size: 12px;
    opacity: 0.7;
    color: var(--upload-text-color);
    min-width: 150px;
}
.meta-user {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 5. 操作按钮 */
.list-col-actions {
    gap: 8px;
    justify-content: flex-end;
}
.list-action-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: var(--el-fill-color);
    color: var(--el-text-color-regular);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
}
.list-action-btn:hover {
    background: var(--primary-color);
    color: white;
}
.list-empty {
    color: var(--el-text-color-placeholder);
}

/* 平板端：列宽收窄 */
@media (min-width: 769px) and (max-width: 1199px) {
    .list-item {
        grid-template-columns: 36px 44px minmax(150px, 1fr) 150px auto;
        gap: 10px;
        padding: 8px 12px;
    }
    .list-col-meta {
        min-width: 120px;
    }
}

/* 移动端：仅保留 选择 / 缩略图 / 文件名+渠道 / 操作 */
@media (max-width: 768px) {
    .list-item {
        grid-template-columns: 22px 38px 1fr auto;
        gap: 8px;
        padding: 8px 8px;
        font-size: 12px;
    }
    .list-col-meta {
        display: none;
    }
    .list-preview-img {
        width: 38px;
        height: 38px;
        border-radius: 6px;
    }
    .list-folder-icon { font-size: 24px; }
    .list-file-icon { font-size: 21px; }
    .list-col-actions { gap: 3px; }
    /* v2.6.0：移动端列表模式隐藏「移动」按钮 */
    .list-action-btn.is-move { display: none; }
    .list-action-btn {
        width: 26px;
        height: 26px;
        border-radius: 7px;
        font-size: 12px;
    }
}
</style>
