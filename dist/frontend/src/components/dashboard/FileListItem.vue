<template>
    <div 
        class="list-item"
        @touchstart="$emit('touchstart', $event)"
        @touchend="$emit('touchend', $event)"
        @touchmove="$emit('touchmove', $event)"
    >
        <!-- 复选框 -->
        <div class="list-col list-col-checkbox">
            <el-checkbox
                v-model="localSelected"
                @click.stop
                @change="handleSelectChange"
            />
        </div>
        <!-- 预览 -->
        <div class="list-col list-col-preview" @click="handlePreviewClick">
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
        <!-- 文件名 -->
        <div class="list-col list-col-name" @click="handlePreviewClick">
            <span class="filename-ellipsis" :title="displayName">
                <span class="filename-start">{{ fileNameStart }}</span>
                <span class="filename-end">{{ fileNameEnd }}</span>
            </span>
        </div>
        <!-- 访问次数（紧随文件名之后） -->
        <div class="list-col list-col-views">
            <span v-if="!isFolder" class="views-count" :title="String(viewsCount)">{{ viewsCount }}</span>
            <span v-else class="list-empty">-</span>
        </div>
        <!-- 标签 / 上传地址 / 删除按钮：按需求不在列表视图展示（卡片视图与详情页仍保留） -->
        <!-- 存储渠道：只显示「渠道简称图标」（品牌色徽标，如 COS / ALI / EI），完整值放 title -->
        <div class="list-col list-col-channel">
            <span v-if="!isFolder && storageChannelType" class="channel-badge-wrap" :title="storageChannelText">
                <ChannelIcon :type="storageChannelType" class="channel-badge-icon"/>
            </span>
            <span v-else-if="!isFolder" class="channel-combined" :title="storageChannelText">{{ storageChannelShort || '-' }}</span>
            <span v-else class="list-empty">-</span>
        </div>
        <!-- 备份渠道：同样只显示简称图标（可多个，橙色调区分） -->
        <div class="list-col list-col-backup">
            <template v-if="!isFolder && backupTags.length">
                <span
                    v-for="(bk, i) in backupTags"
                    :key="'bk-' + i"
                    class="channel-badge-wrap is-backup"
                    :title="bk.full"
                >
                    <ChannelIcon :type="bk.type" class="channel-badge-icon"/>
                </span>
            </template>
            <span v-else class="list-empty">-</span>
        </div>
        <!-- 大小 -->
        <div class="list-col list-col-size">
            {{ isFolder ? '-' : fileSizeDisplay }}
        </div>
        <!-- 上传用户（紧随大小之后） -->
        <div class="list-col list-col-user">
            <span v-if="!isFolder && uploadUser" class="upload-user-text" :title="uploadUser">{{ uploadUser }}</span>
            <span v-else class="list-empty">-</span>
        </div>
        <!-- 上传时间 -->
        <div class="list-col list-col-date">
            {{ uploadDate }}
        </div>
        <!-- 操作 -->
        <div class="list-col list-col-actions">
            <template v-if="!isFolder">
                <el-tooltip :content="$t('dashboard.copyLink')" placement="top" :show-after="1000">
                    <button class="list-action-btn" @click.stop="$emit('copy')">
                        <font-awesome-icon icon="copy"/>
                    </button>
                </el-tooltip>
                <el-tooltip :content="$t('dashboard.downloadFile')" placement="top" :show-after="1000">
                    <button class="list-action-btn" @click.stop="$emit('download')">
                        <font-awesome-icon icon="download"/>
                    </button>
                </el-tooltip>
                <el-tooltip :content="$t('dashboard.moveFile')" placement="top" :show-after="1000">
                    <button class="list-action-btn" @click.stop="$emit('move')">
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
                    <button class="list-action-btn" @click.stop="$emit('move')">
                        <font-awesome-icon icon="file-export"/>
                    </button>
                </el-tooltip>
            </template>
        </div>
    </div>
</template>

<script>
import ChannelIcon from '@/components/icons/ChannelIcon.vue';

export default {
    name: 'FileListItem',
    components: { ChannelIcon },
    props: {
        item: { type: Object, required: true },
        selected: { type: Boolean, default: false },
        fileLink: { type: String, default: '' }
    },
    emits: ['update:selected', 'enter', 'detail', 'copy', 'folderCopy', 'move', 'delete', 'download', 'touchstart', 'touchend', 'touchmove'],
    data() {
        return {
            localSelected: this.selected,
            tagColors: ['#f472b6', '#a78bfa', '#60a5fa', '#34d399']
        }
    },
    computed: {
        isFolder() {
            // 检查 isFolder 属性或名称以 / 结尾
            return this.item.isFolder || this.item.name?.endsWith('/');
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
        fileNameStart() {
            const name = this.displayName;
            if (name.length <= 20) return name;
            return name.slice(0, -8);
        },
        fileNameEnd() {
            const name = this.displayName;
            if (name.length <= 20) return '';
            return name.slice(-8);
        },
        uploadDate() {
            if (this.item.uploaded) {
                return new Date(this.item.uploaded).toLocaleDateString();
            }
            if (this.item.metadata?.TimeStamp) {
                return new Date(this.item.metadata.TimeStamp).toLocaleDateString();
            }
            return '-';
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
        /** 存储渠道的渠道类型（渲染简称图标用；历史数据缺失时退回用简称判断） */
        storageChannelType() {
            return this.item.metadata?.ChannelType || this.guessTypeByShort(this.item.metadata?.ChannelShort);
        },
        /** 存储渠道简称（无类型时兜底显示文字） */
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
        /** 备份渠道纯文本（无类型时兜底） */
        backupChannelText() {
            return this.backupTags
                .filter((b) => !b.type)
                .map((b) => b.short)
                .filter(Boolean)
                .join('，');
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
    methods: {
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
        },
        /** 简称 → 渠道类型（仅历史数据没有 metadata.ChannelType 时兜底） */
        guessTypeByShort(short) {
            const map = {
                COS: 'cos', ALI: 'aliyun', MI: 'minio', R2: 'r2', S3: 's3',
                EI: 'easyimages', LS: 'lsky', WD: 'webdav', IM: 'immich',
                DIY: 'custom', LOCAL: 'local',
            };
            return map[String(short || '').toUpperCase()] || '';
        },
        getTagColor(index) {
            return this.tagColors[index % this.tagColors.length];
        }
    }
}
</script>

<style scoped>
.list-item {
    display: grid;
    /* 复选框 / 预览 / 文件名 / 访问次数 / 存储渠道 / 备份渠道 / 大小 / 上传用户 / 时间 / 操作
       （标签列、上传地址列已按需求移除；渠道列改为简称图标，宽度收窄，给「上传用户」腾位）
       —— 表头（AdminDashBoard.vue 的 .list-header）必须与此处完全一致，否则列会错位 */
    grid-template-columns: 50px 60px minmax(180px, 1fr) 70px 110px 110px 80px 120px 100px 120px;
    content-visibility: auto;
    contain: layout paint style;
    contain-intrinsic-size: 65px;
    padding: 12px 20px;
    align-items: center;
    transition: background 0.2s ease;
    border-bottom: 1px solid var(--el-border-color-lighter);
    min-width: fit-content;
}
.list-item:last-child {
    border-bottom: none;
}
.list-item:hover {
    background: var(--el-fill-color-light);
}
.list-col {
    display: flex;
    align-items: center;
}
.list-col-checkbox {
    justify-content: center;
    min-width: 40px;
}

.list-col-checkbox :deep(.el-checkbox) {
    --el-checkbox-input-width: 16px;
    --el-checkbox-input-height: 16px;
}
.list-col-preview {
    justify-content: center;
    cursor: pointer;
}
.list-col-name {
    cursor: pointer;
    overflow: hidden;
    padding-right: 16px;
    min-width: 0;
}
.list-col-name:hover {
    color: var(--primary-color-accent);
}
.filename-ellipsis {
    display: flex;
    max-width: 100%;
    overflow: hidden;
    align-items: center;
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
.list-col-size, .list-col-date, .list-col-channel, .list-col-backup, .list-col-views, .list-col-user {
    font-size: 13px;
    color: var(--el-text-color-secondary);
}
/* 渠道简称图标（复用 ChannelIcon 的品牌色徽标）：整列居中，鼠标悬浮看完整渠道名 */
.list-col-channel, .list-col-backup {
    gap: 4px;
}
.channel-badge-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
    line-height: 1;
}
/* 备份渠道图标：略小 + 橙色虚线外圈，与主渠道一眼区分（列名已写明是备份渠道） */
.channel-badge-wrap.is-backup {
    font-size: 15px;
    outline: 1px dashed color-mix(in srgb, var(--el-color-warning) 55%, transparent);
    outline-offset: 2px;
    border-radius: 4px;
}
.channel-badge-icon {
    display: inline-flex;
}
/* 上传用户：单行省略，避免长账户名把列撑破 */
.upload-user-text {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.list-col-address {
    font-size: 13px;
}
.address-box, .channel-name-box, .channel-combined {
    background: var(--el-fill-color-light);
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    scrollbar-width: none;
    -ms-overflow-style: none;
}
.address-box { width: 85px; font-family: 'Consolas', 'Monaco', monospace; }
.channel-name-box { width: 70px; }
.channel-combined { width: 100%; box-sizing: border-box; text-overflow: ellipsis; }
.channel-combined.is-backup { color: var(--el-color-warning); border-color: color-mix(in srgb, var(--el-color-warning) 30%, transparent); background: color-mix(in srgb, var(--el-color-warning) 8%, transparent); }
.address-box::-webkit-scrollbar, .channel-name-box::-webkit-scrollbar, .channel-combined::-webkit-scrollbar { display: none; }
.list-col-views {
    justify-content: flex-start;
    font-variant-numeric: tabular-nums;
}
.views-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    padding: 2px 7px;
    border-radius: 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-light);
    border: 1px solid var(--el-border-color-lighter);
}
.list-col-tags {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: nowrap;
    overflow: hidden;
}
.color-tag {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    color: white;
    white-space: nowrap;
    max-width: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.color-tag-more {
    min-width: 30px;
    text-align: center;
}
.list-empty {
    color: var(--el-text-color-placeholder);
}
.list-col-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}
.list-preview-img {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 6px;
}
.list-folder-icon {
    font-size: 28px;
    color: var(--el-color-primary);
}
.list-file-icon {
    font-size: 24px;
    color: var(--el-text-color-secondary);
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
.list-action-danger:hover {
    background: var(--el-color-danger);
}
/* 平板端：列宽收窄，避免整表横向滚动（列数与桌面端保持一致） */
@media (min-width: 769px) and (max-width: 1199px) {
    .list-item {
        grid-template-columns: 40px 52px minmax(150px, 1fr) 56px 92px 92px 72px 96px 92px 104px;
        padding: 10px 16px;
    }
}

@media (max-width: 768px) {
    .list-item {
        grid-template-columns: 20px 34px 1fr auto;
        padding: 8px 6px;
        gap: 6px;
        font-size: 12px;
    }
    .list-col-size, .list-col-date, .list-col-tags, .list-col-views, .list-col-channel, .list-col-backup, .list-col-address, .list-col-user {
        display: none;
    }    .list-col-name {
        padding-right: 8px;
        line-height: 1.25;
    }
    .list-preview-img {
        width: 34px;
        height: 34px;
        border-radius: 5px;
    }
    .list-folder-icon {
        font-size: 24px;
    }
    .list-file-icon {
        font-size: 21px;
    }
    .list-col-actions { gap: 3px; }
    .list-action-btn {
        width: 26px;
        height: 26px;
        border-radius: 7px;
        font-size: 12px;
    }
    .list-col-checkbox { width: 18px; min-width: 18px; }
    .list-col-checkbox :deep(.el-checkbox) {
        --el-checkbox-input-width: 14px;
        --el-checkbox-input-height: 14px;
    }
}
</style>
