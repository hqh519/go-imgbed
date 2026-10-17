<template>
    <el-dialog :title="$t('fileDetail.title')" v-model="visible" :width="dialogWidth">
        <!-- 详情内容统一包一层：任一加载值超过 80 字符时整体字号降一号 -->
        <div class="detail-body" :class="{ 'detail-compact': hasLongValue }">
        <div class="detail-actions">
            <el-button type="primary" @click="$emit('download')" round size="small" class="detail-action" v-if="!isEditing">
                <font-awesome-icon icon="download" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.download') }}
            </el-button>
            <!--
                标签管理 / 黑名单 / 白名单属于「文件管理」页的批量能力：
                其它页面（如历史记录）复用本详情弹窗时可通过 showAdvanced=false 隐藏它们。
                普通用户还须拥有「可编辑」权限，否则不加载这些按钮（后端同样校验）。
            -->
            <el-button v-if="showAdvanced && !isEditing && canEditAction" type="primary" @click="$emit('tagManagement')" round size="small" class="detail-action">
                <font-awesome-icon icon="tags" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.tags') }}
            </el-button>
            <el-button v-if="showAdvanced && !isEditing && canEditAction" type="primary" @click="$emit('block')" round size="small" class="detail-action">
                <font-awesome-icon icon="ban" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.blacklist') }}
            </el-button>
            <el-button v-if="showAdvanced && !isEditing && canEditAction" type="primary" @click="$emit('white')" round size="small" class="detail-action">
                <font-awesome-icon icon="shield-alt" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.whitelist') }}
            </el-button>
            <!-- 删除：须拥有「可删除」权限，否则不加载删除按钮 -->
            <el-button type="danger" @click="$emit('delete')" round size="small" class="detail-action" v-if="!isEditing && canDeleteAction">
                <font-awesome-icon icon="trash-alt" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.deleteBtn') }}
            </el-button>
            <el-button type="warning" @click="startEdit()" round size="small" class="detail-action" v-if="!isEditing && canEditAction">
                <font-awesome-icon icon="edit" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.edit') }}
            </el-button>
            <el-button type="info" @click="openRenameDialog()" round size="small" class="detail-action" v-if="!isEditing && canEditAction">
                <font-awesome-icon icon="i-cursor" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.rename') }}
            </el-button>
            <!-- 重定向：用自定义链接替换真实文件源（清空即恢复渠道直链） -->
            <el-button type="primary" plain @click="openRedirectDialog()" round size="small" class="detail-action" v-if="!isEditing && canEditAction">
                <font-awesome-icon icon="exchange-alt" style="margin-right: 3px;"></font-awesome-icon> {{ $t('dashboard.redirect') }}
            </el-button>
            <el-button type="success" @click="saveMetadata()" round size="small" class="detail-action" v-if="isEditing" :loading="editSaving">
                <font-awesome-icon icon="save" style="margin-right: 3px;" v-if="!editSaving"></font-awesome-icon> {{ $t('fileDetail.save') }}
            </el-button>
            <el-button @click="cancelEdit()" round size="small" class="detail-action" v-if="isEditing">
                {{ $t('fileDetail.cancel') }}
            </el-button>
        </div>
        <el-tabs v-model="activeTab" @tab-click="handleTabClick" style="margin-bottom: 10px;">
            <el-tab-pane :label="$t('fileDetail.originUrl')" name="originUrl">
                <el-input v-model="urls.originUrl" readonly @click="handleUrlClick"></el-input>
            </el-tab-pane>
            <el-tab-pane label="Markdown" name="mdUrl">
                <el-input v-model="urls.mdUrl" readonly @click="handleUrlClick"></el-input>
            </el-tab-pane>
            <el-tab-pane label="HTML" name="htmlUrl">
                <el-input v-model="urls.htmlUrl" readonly @click="handleUrlClick"></el-input>
            </el-tab-pane>
            <el-tab-pane label="BBCode" name="bbUrl">
                <el-input v-model="urls.bbUrl" readonly @click="handleUrlClick"></el-input>
            </el-tab-pane>
            <el-tab-pane label="TG File ID" v-if="file?.metadata?.TgFileId" name="tgId">
                <el-input v-model="urls.tgId" readonly @click="handleUrlClick"></el-input>
            </el-tab-pane>
            <el-tab-pane label="S3 Location" v-if="file?.metadata?.S3Location" name="s3Location">
                <el-input v-model="urls.S3Location" readonly @click="handleUrlClick"></el-input>
            </el-tab-pane>
            <el-tab-pane label="S3 CDN URL" v-if="file?.metadata?.S3CdnFileUrl" name="s3CdnFileUrl">
                <el-input v-model="urls.S3CdnFileUrl" readonly @click="handleUrlClick"></el-input>
            </el-tab-pane>
        </el-tabs>
        <!-- 文件预览区域 -->
        <div class="preview-section">
            <div class="preview-content">
                <video v-if="isVideo" :src="fileLink" autoplay muted loop class="video-preview" @click="openImageLink"></video>
                <audio v-else-if="isAudio" :src="fileLink" controls autoplay class="audio-preview"></audio>
                <el-image
                    v-else-if="isImage"
                    :src="fileLink"
                    fit="contain"
                    lazy
                    class="image-preview"
                    title="在新标签页打开"
                    @click="openImageLink"
                ></el-image>
                <font-awesome-icon v-else icon="file" class="file-icon-detail"></font-awesome-icon>
            </div>
        </div>
        <!-- 详细信息 -->
        <el-descriptions border :column="descColumn">
            <el-descriptions-item :label="$t('fileDetail.fileNameLabel')">
                <el-input v-if="isEditing" v-model="editForm.FileName" size="small" :placeholder="$t('fileDetail.fileNamePlaceholder')"></el-input>
                <span v-else>{{ file?.metadata?.FileName || file?.name }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.fileType')">
                <el-input v-if="isEditing" v-model="editForm.FileType" size="small" :placeholder="$t('fileDetail.fileTypePlaceholder')"></el-input>
                <span v-else>{{ fileTypeDisplay }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.fileSizeLabel')">{{ fileSizeDisplay }}</el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.imageDimensions')">
                <div v-if="imageDimensions" style="display: flex; align-items: center; gap: 6px;">
                    <span>{{ file?.metadata?.Width }} × {{ file?.metadata?.Height }}</span>
                    <el-tag size="small" type="info" style="display: inline-flex; align-items: center; justify-content: center;">{{ orientationIcon }}</el-tag>
                </div>
                <span v-else style="color: var(--el-text-color-secondary);">{{ $t('fileDetail.noDimensions') }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.uploadTimeLabel')">{{ uploadTime }}</el-descriptions-item>
            <!-- MD5 紧随「上传时间」之后 -->
            <el-descriptions-item :label="$t('fileDetail.md5')">
                <span class="md5-value" :title="file?.metadata?.MD5">{{ file?.metadata?.MD5 || $t('fileDetail.unknown') }}</span>
            </el-descriptions-item>
            <!-- 「存储渠道」与「备份渠道」同一行，存储在前；值可点击打开该文件对应渠道的直链，右侧可复制该直链 -->
            <el-descriptions-item :label="$t('fileDetail.storageChannel')">
                <div class="channel-row">
                    <a v-if="storageChannelUrl" class="channel-link" :href="storageChannelUrl" target="_blank" rel="noopener noreferrer" :title="storageChannelUrl">
                        <el-tag size="small" type="info">{{ file?.metadata?.Channel || $t('fileDetail.unknown') }}</el-tag>
                        <span class="channel-name">{{ file?.metadata?.ChannelName || '-' }}</span>
                    </a>
                    <span v-else class="channel-link is-static">
                        <el-tag size="small" type="info">{{ file?.metadata?.Channel || $t('fileDetail.unknown') }}</el-tag>
                        <span class="channel-name">{{ file?.metadata?.ChannelName || '-' }}</span>
                    </span>
                    <el-button
                        v-if="storageChannelUrl"
                        size="small"
                        text
                        class="channel-copy-btn"
                        :title="$t('fileDetail.copyChannelUrl')"
                        @click="copyChannelUrl(storageChannelUrl)"
                    >
                        <font-awesome-icon icon="copy"></font-awesome-icon>
                    </el-button>
                </div>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.backupChannels')">
                <div v-if="backupChannelList.length > 0" style="display: flex; flex-wrap: wrap; gap: 6px;">
                    <div v-for="(b, idx) in backupChannelList" :key="idx" class="channel-row">
                        <a
                            class="channel-link"
                            :href="channelFileUrl(b.id, b.url)"
                            target="_blank"
                            rel="noopener noreferrer"
                            :title="channelFileUrl(b.id, b.url) || ''"
                        >
                            <el-tag size="small" type="warning">{{ b.label }} / {{ b.name }}</el-tag>
                        </a>
                        <el-button
                            v-if="channelFileUrl(b.id, b.url)"
                            size="small"
                            text
                            class="channel-copy-btn"
                            :title="$t('fileDetail.copyChannelUrl')"
                            @click="copyChannelUrl(channelFileUrl(b.id, b.url))"
                        >
                            <font-awesome-icon icon="copy"></font-awesome-icon>
                        </el-button>
                    </div>
                </div>
                <span v-else style="color: var(--el-text-color-secondary);">{{ $t('fileDetail.noBackup') }}</span>
            </el-descriptions-item>
            <!-- 「文件标签」紧随「访问状态/审查」之后 -->
            <el-descriptions-item :label="$t('fileDetail.accessStatusAndReview')">
                <el-tag size="small" :type="accessTagType" style="margin-right: 6px;">{{ accessType }}</el-tag>
                <span>{{ file?.metadata?.Label || $t('fileDetail.noTags') }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.fileTags')">
                <div v-if="file?.metadata?.Tags && file?.metadata?.Tags.length > 0" style="display: flex; flex-wrap: wrap; gap: 5px;">
                    <!-- 点击标签 → 跳到文件管理页并按该标签筛选 -->
                    <el-tag
                        v-for="tag in file?.metadata?.Tags"
                        :key="tag"
                        size="small"
                        class="detail-tag-link"
                        :title="$t('fileDetail.jumpToTag')"
                        @click="jumpToTag(tag)"
                    >{{ tag }}</el-tag>
                </div>
                <span v-else style="color: var(--el-text-color-secondary);">{{ $t('fileDetail.noTags') }}</span>
            </el-descriptions-item>
            <!-- 「上传IP」紧随「上传地址」之后 -->
            <el-descriptions-item :label="$t('fileDetail.uploadAddressLabel')">{{ file?.metadata?.UploadAddress || $t('fileDetail.unknown') }}</el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.uploadIP')">{{ file?.metadata?.UploadIP || $t('fileDetail.unknown') }}</el-descriptions-item>
            <!-- 上传用户：记录该文件由哪个账户上传 -->
            <el-descriptions-item :label="$t('dashboard.uploadUser')">{{ file?.metadata?.UploadUser || $t('fileDetail.unknown') }}</el-descriptions-item>
            <!-- 上传渠道：Default（前端上传页）/ WebDAV / API-Web / API-S3 -->
            <el-descriptions-item :label="$t('fileDetail.uploadChannel')">{{ file?.metadata?.UploadSource || 'Default' }}</el-descriptions-item>
            <!-- 文件分类：编辑态下可重新选择（等价于文件管理的「移动」），非编辑态只读展示 -->
            <el-descriptions-item :label="$t('fileDetail.fileCategory')">
                <el-select
                    v-if="isEditing"
                    v-model="editForm.Directory"
                    size="small"
                    class="detail-folder-select"
                    filterable
                    allow-create
                    default-first-option
                    :loading="folderLoading"
                    :placeholder="$t('fileDetail.fileCategoryPlaceholder')"
                >
                    <el-option :label="$t('fileDetail.rootCategory')" value="" />
                    <el-option v-for="p in folderOptions" :key="p" :label="p" :value="p" />
                </el-select>
                <template v-else>
                    <!-- 点击分类值 → 跳到文件管理页的对应分类目录 -->
                    <a
                        v-if="file?.metadata?.Directory"
                        href="#"
                        class="detail-jump-link"
                        :title="$t('fileDetail.jumpToCategory')"
                        @click.prevent="jumpToFolder"
                    >{{ file.metadata.Directory }}</a>
                    <span v-else style="color: var(--el-text-color-secondary);">{{ $t('fileDetail.noCategory') }}</span>
                </template>
            </el-descriptions-item>
            <!-- 重定向状态：单独占满一整行（放在所有字段最后） -->
            <el-descriptions-item :label="$t('dashboard.redirect')" :span="descColumn">
                <a v-if="file?.metadata?.RedirectUrl" class="channel-link" :href="file.metadata.RedirectUrl" target="_blank" rel="noopener noreferrer" :title="file.metadata.RedirectUrl">
                    <el-tag size="small" type="success">{{ $t('dashboard.redirectSet') }}</el-tag>
                    <span class="channel-name">{{ file.metadata.RedirectUrl }}</span>
                </a>
                <span v-else style="color: var(--el-text-color-secondary);">{{ $t('dashboard.filterRedirectNo') }}</span>
            </el-descriptions-item>
        </el-descriptions>
        <!-- 重命名弹窗 -->
        <el-dialog
            v-model="showRenameDialog"
            :title="$t('fileDetail.renameTitle')"
            :width="dialogWidth"
            append-to-body
        >
            <el-form @submit.prevent="submitRename">
                <el-form-item :label="$t('fileDetail.renameLabel')" :error="renameValidation.error">
                    <el-input
                        v-model="renameForm.newFileId"
                        :placeholder="$t('fileDetail.renamePlaceholder')"
                        @input="validateRenameInput"
                        clearable
                    ></el-input>
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="closeRenameDialog()">{{ $t('fileDetail.renameCancel') }}</el-button>
                <el-button type="primary" @click="submitRename()" :loading="renameSaving" :disabled="!renameValidation.valid">{{ $t('fileDetail.renameConfirm') }}</el-button>
            </template>
        </el-dialog>
        <!-- 重定向弹窗 -->
        <el-dialog
            v-model="showRedirectDialog"
            :title="$t('dashboard.redirect')"
            :width="dialogWidth"
            append-to-body
        >
            <el-form @submit.prevent="submitRedirect">
                <el-form-item :label="$t('fileDetail.redirectTarget')">
                    <el-input v-model="redirectForm.url" :placeholder="$t('dashboard.redirectPlaceholder')" clearable></el-input>
                </el-form-item>
                <div class="redirect-tip">{{ $t('fileDetail.redirectTip') }}</div>
            </el-form>
            <template #footer>
                <el-button @click="showRedirectDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button @click="submitRedirect(true)" :loading="redirectSaving" :disabled="!file?.metadata?.RedirectUrl">{{ $t('dashboard.redirectClear') }}</el-button>
                <el-button type="primary" @click="submitRedirect(false)" :loading="redirectSaving">{{ $t('common.save') }}</el-button>
            </template>
        </el-dialog>
        </div>
    </el-dialog>
</template>

<script>
import { ElMessage } from 'element-plus';
import fetchWithAuth from '@/utils/fetchWithAuth';
import { validateFileId } from '@/utils/fileIdValidator';
import { copyText } from '@/utils/clipboard';
import { fileLink } from '@/utils/fileLink';

export default {
    name: 'FileDetailDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        file: { type: Object, default: null },
        fileLink: { type: String, default: '' },
        urls: { type: Object, default: () => ({ originUrl: '', mdUrl: '', htmlUrl: '', bbUrl: '', tgId: '', S3Location: '', S3CdnFileUrl: '' }) },
        /**
         * 是否显示「标签管理 / 黑名单 / 白名单」这三个文件管理页专属动作。
         * 历史记录等页面复用本弹窗时传 false（这些动作依赖文件管理页的批量能力）。
         */
        showAdvanced: { type: Boolean, default: true },
    },
    emits: ['update:modelValue', 'download', 'tagManagement', 'block', 'white', 'delete', 'metadataUpdated', 'fileRenamed'],
    watch: {
        visible(val) {
            if (!val) {
                // 关闭弹窗时退出编辑状态
                this.isEditing = false;
                this.editSaving = false;
            }
        }
    },
    data() {
        return {
            activeTab: 'originUrl',
            isEditing: false,
            editForm: {
                FileName: '',
                FileType: '',
                Directory: ''
            },
            editSaving: false,
            // 编辑态「文件分类」下拉的可选目录（来自 /api/directoryTree）
            folderOptions: [],
            folderLoading: false,
            showRenameDialog: false,
            renameForm: {
                newFileId: ''
            },
            renameValidation: {
                valid: true,
                error: ''
            },
            renameSaving: false,
            // 重定向
            showRedirectDialog: false,
            redirectForm: { url: '' },
            redirectSaving: false
        }
    },
    computed: {
        visible: {
            get() { return this.modelValue; },
            set(val) { this.$emit('update:modelValue', val); }
        },
        dialogWidth() {
            return window.innerWidth < 768 ? '95%' : '900px';
        },
        /**
         * 详情表列数：窄屏 1 列、宽屏 2 列。
         * 同时作为「重定向」整行占位的 span 值（让它单独占满一行）。
         */
        descColumn() {
            return window.innerWidth < 768 ? 1 : 2;
        },
        /** 是否管理员（管理员不受普通用户的编辑/删除开关约束） */
        isAdminRole() {
            return this.$store?.getters?.isAdminRole === true;
        },
        /** 可编辑：可改文件信息 / 加标签 / 重命名 / 设置重定向 */
        canEditAction() {
            return this.isAdminRole || this.$store?.getters?.canEdit !== false;
        },
        /** 可删除 */
        canDeleteAction() {
            return this.isAdminRole || this.$store?.getters?.canDelete !== false;
        },
        /**
         * 详情里所有「加载值」的文本。
         * 用于「任一值超过 80 字符则整体字号自动降一号」的判断。
         */
        detailTextValues() {
            const m = this.file?.metadata || {};
            const tags = Array.isArray(m.Tags) ? m.Tags : [];
            const values = [
                m.FileName,
                m.FileType,
                m.FileExt,
                m.MD5,
                m.Channel,
                m.ChannelName,
                m.UploadAddress,
                m.UploadIP,
                m.UploadUser,
                m.UploadSource,
                m.Directory,
                m.RedirectUrl,
                this.fileSizeDisplay,
                this.storageChannelUrl,
                ...this.backupChannelList.map((b) => `${b.label || ''}/${b.name || ''}`),
                ...tags,
                this.urls?.originUrl,
                this.urls?.mdUrl,
                this.urls?.htmlUrl,
                this.urls?.bbUrl,
                this.urls?.tgId,
                this.urls?.S3Location,
                this.urls?.S3CdnFileUrl,
                this.fileLink,
            ];
            return values.filter((v) => v !== undefined && v !== null && v !== '').map((v) => String(v));
        },
        /** 是否存在超长值（> 80 字符）—— 是则详情整体字号降一号 */
        hasLongValue() {
            return this.detailTextValues.some((v) => v.length > 80);
        },
        isVideo() {
            // 先通过 content-type 判断
            const fileType = this.file?.metadata?.FileType?.toLowerCase() || '';
            if (fileType.includes('video')) return true;
            // 再通过文件后缀判断
            const name = this.file?.name?.toLowerCase() || '';
            return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov') || name.endsWith('.avi');
        },
        isAudio() {
            // 先通过 content-type 判断
            const fileType = this.file?.metadata?.FileType?.toLowerCase() || '';
            if (fileType.includes('audio')) return true;
            // 再通过文件后缀判断
            const name = this.file?.name?.toLowerCase() || '';
            return name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg') || name.endsWith('.flac');
        },
        /** 备份渠道列表（metadata.BackupChannels：[{id, label, name}]） */
        backupChannelList() {
            const list = this.file?.metadata?.BackupChannels;
            return Array.isArray(list) ? list : [];
        },
        /** 文件类型展示值：MIME / 扩展名，如 image/jpeg / jpeg */
        fileTypeDisplay() {
            const type = this.file?.metadata?.FileType;
            const ext = this.file?.metadata?.FileExt;
            if (type && ext) return `${type} / ${ext}`;
            return type || ext || this.$t('fileDetail.unknown');
        },
        /** 当前文件主渠道（存储渠道）的真实直链 —— 无法构造时回退本站代理地址 */
        storageChannelUrl() {
            const direct = this.file?.metadata?.StorageUrl;
            if (direct) return String(direct);
            return this.channelFileUrl(this.file?.metadata?.ChannelId);
        },
        isImage() {
            // 先通过 content-type 判断
            const fileType = this.file?.metadata?.FileType?.toLowerCase() || '';
            if (fileType.includes('image')) return true;
            // 再通过文件后缀判断
            const name = this.file?.name?.toLowerCase() || '';
            return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || 
                   name.endsWith('.gif') || name.endsWith('.webp') || name.endsWith('.svg') || 
                   name.endsWith('.bmp') || name.endsWith('.avif') || name.endsWith('.heic') || name.endsWith('.heif');
        },
        uploadTime() {
            if (this.file?.metadata?.TimeStamp) {
                return new Date(this.file.metadata.TimeStamp).toLocaleString();
            }
            return this.$t('fileDetail.unknown');
        },
        accessType() {
            const listType = this.file?.metadata?.ListType;
            const label = this.file?.metadata?.Label;
            if (listType === 'White') return this.$t('fileDetail.accessNormalWhitelist');
            if (listType === 'Block') return this.$t('fileDetail.accessBlockedBlacklist');
            if (label === 'adult') return this.$t('fileDetail.accessBlockedReview');
            return this.$t('fileDetail.accessNormal');
        },
        accessTagType() {
            const listType = this.file?.metadata?.ListType;
            const label = this.file?.metadata?.Label;
            if (listType === 'White') return 'success';
            if (listType === 'Block') return 'danger';
            if (label === 'adult') return 'danger';
            return 'success';
        },
        imageDimensions() {
            const width = this.file?.metadata?.Width;
            const height = this.file?.metadata?.Height;
            if (width && height) return true;
            return null;
        },
        orientationIcon() {
            const width = this.file?.metadata?.Width;
            const height = this.file?.metadata?.Height;
            if (!width || !height) return '';
            const ratio = width / height;
            if (ratio > 1.1) return this.$t('fileDetail.orientationLandscape');
            if (ratio < 0.9) return this.$t('fileDetail.orientationPortrait');
            return this.$t('fileDetail.orientationSquare');
        },
        /**
         * 文件大小：`初始大小 / 当前大小`（如 `1016.00 KB / 56.11 KB`）。
         * 未被压缩（两者相同）或没有初始大小时，只展示当前大小。
         */
        fileSizeDisplay() {
            const sizeBytes = Number(this.file?.metadata?.FileSizeBytes) || 0;
            const originalBytes = Number(this.file?.metadata?.FileSizeOriginalBytes) || sizeBytes;
            if (sizeBytes > 0) {
                const current = this.formatBytes(sizeBytes);
                if (originalBytes > 0 && originalBytes !== sizeBytes) {
                    return `${this.formatBytes(originalBytes)} / ${current}`;
                }
                return current;
            }
            const sizeText = this.file?.metadata?.FileSize;
            return sizeText || this.$t('fileDetail.unknown');
        }
    },
    methods: {
        handleVideoClick(e) {
            const video = e.target;
            if (video.paused) video.play();
            else video.pause();
        },
        handleTabClick() {},
        async handleUrlClick(e) {
            const input = e.target;
            input.select();
            const ok = await copyText(input.value);
            ElMessage[ok ? 'success' : 'warning'](this.$t(ok ? 'fileDetail.linkCopied' : 'dashboard.copyFailed'));
        },
        /** 复制某个渠道下该文件的真实直链 */
        async copyChannelUrl(url) {
            if (!url) return;
            const ok = await copyText(String(url));
            ElMessage[ok ? 'success' : 'warning'](this.$t(ok ? 'fileDetail.linkCopied' : 'dashboard.copyFailed'));
        },
        openImageLink() {
            if (this.fileLink) {
                window.open(this.fileLink, '_blank');
            }
        },
        /**
         * 生成「指定渠道下这个文件的真实直链」。
         *   1) 优先用后端算好的渠道内真实地址（S3 对象 URL / WebDAV 真实路径 / 自定义原始外链）
         *   2) 拿不到时回退本站 /file/:name?channel=<渠道ID>（代理或 302，仍是该渠道的资源）
         */
        channelFileUrl(channelId, directUrl) {
            if (directUrl) return String(directUrl);
            const name = this.file?.name;
            if (!name || !channelId) return '';
            // 全站统一出口（自定义访问域名优先）
            return `${fileLink(name)}?channel=${encodeURIComponent(channelId)}`;
        },
        /** 字节 → 可读体积（与后端 formatSize 保持一致） */
        formatBytes(bytes) {
            const n = Number(bytes) || 0;
            if (n <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let v = n;
            let i = 0;
            while (v >= 1024 && i < units.length - 1) {
                v /= 1024;
                i += 1;
            }
            return `${i === 0 ? v : v.toFixed(2)} ${units[i]}`;
        },
        /**
         * 跳到「文件管理」的对应分类目录。
         * 复用 AdminDashBoard 已支持的 sessionStorage 约定（dashboardInitialFolder），
         * 跳转后由该页面在 mounted 时读取并设置当前路径。
         */
        jumpToFolder() {
            const dir = String(this.file?.metadata?.Directory || '').replace(/^\/+|\/+$/g, '');
            sessionStorage.setItem('dashboardInitialFolder', dir ? `${dir}/` : '');
            this.visible = false;
            this.goDashboard();
        },
        /** 跳到「文件管理」并按该标签筛选（含该标签的文件） */
        jumpToTag(tag) {
            const name = String(tag || '').trim();
            if (!name) return;
            sessionStorage.setItem('dashboardInitialTag', name);
            this.visible = false;
            this.goDashboard();
        },
        /** 统一跳转：已在文件管理页时用刷新生效（同路径 push 不会重新挂载） */
        goDashboard() {
            if (this.$route && this.$route.path === '/dashboard') {
                window.location.reload();
                return;
            }
            this.$router.push('/dashboard');
        },
        startEdit() {
            this.editForm.FileName = this.file?.metadata?.FileName || '';
            this.editForm.FileType = this.file?.metadata?.FileType || '';
            // 分类目录：去掉尾部斜杠（与后端 folder 字段一致）
            this.editForm.Directory = String(this.file?.metadata?.Directory || '').replace(/\/+$/, '');
            this.isEditing = true;
            this.loadFolderOptions();
        },
        /** 拉取可选的分类目录（目录树 → 扁平路径列表）
         *  注意接口前缀：目录树挂在 /api 根下（不是 /api/manage），
         *  用错路径会 404，表现为「编辑时分类下拉是空的、选不到已有目录」。 */
        async loadFolderOptions() {
            this.folderLoading = true;
            try {
                const res = await fetchWithAuth('/api/directoryTree');
                const json = await res.json().catch(() => ({}));
                const out = [];
                const walk = (node, prefix) => {
                    for (const child of node?.children || []) {
                        const path = prefix ? `${prefix}/${child.name}` : child.name;
                        out.push(path);
                        walk(child, path);
                    }
                };
                walk(json?.tree || {}, '');
                this.folderOptions = Array.from(new Set(out)).sort();
            } catch {
                this.folderOptions = [];
            } finally {
                this.folderLoading = false;
            }
        },
        cancelEdit() {
            this.isEditing = false;
            this.editForm.FileName = this.file?.metadata?.FileName || '';
            this.editForm.FileType = this.file?.metadata?.FileType || '';
            this.editForm.Directory = String(this.file?.metadata?.Directory || '').replace(/\/+$/, '');
            this.editSaving = false;
        },
        async saveMetadata() {
            this.editSaving = true;
            try {
                const fileId = this.file.name;
                const response = await fetchWithAuth(`/api/manage/metadata/${fileId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        FileName: this.editForm.FileName,
                        FileType: this.editForm.FileType,
                        Directory: this.editForm.Directory
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    ElMessage.success(this.$t('fileDetail.metadataSaved'));
                    this.isEditing = false;
                    /*
                     * 关键：立刻把新值写回本地的 file.metadata。
                     * 之前只 emit 给父组件，父组件若没就地改写同一个对象，
                     * 弹窗下方的「文件标题 / 文件类型」就会停在旧值，必须刷新页面才更新。
                     */
                    if (this.file?.metadata) {
                        if (data?.metadata?.FileName !== undefined) {
                            this.file.metadata.FileName = data.metadata.FileName;
                        } else if (this.editForm.FileName) {
                            this.file.metadata.FileName = this.editForm.FileName;
                        }
                        if (data?.metadata?.FileType !== undefined) {
                            this.file.metadata.FileType = data.metadata.FileType;
                        } else if (this.editForm.FileType !== undefined) {
                            this.file.metadata.FileType = this.editForm.FileType;
                        }
                        if (data?.metadata?.Directory !== undefined) {
                            this.file.metadata.Directory = data.metadata.Directory;
                        }
                    }
                    this.$emit('metadataUpdated', fileId, data.metadata || {});
                } else {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.message || this.$t('fileDetail.metadataSaveFailed'));
                }
            } catch (error) {
                console.error('Error saving metadata:', error);
                ElMessage.error(error.message || this.$t('fileDetail.metadataSaveFailed'));
            } finally {
                this.editSaving = false;
            }
        },
        openRenameDialog() {
            this.renameForm.newFileId = this.file?.name || '';
            this.renameValidation = { valid: true, error: '' };
            this.showRenameDialog = true;
        },
        /** 打开重定向弹窗，回显当前重定向地址 */
        openRedirectDialog() {
            this.redirectForm.url = this.file?.metadata?.RedirectUrl || '';
            this.showRedirectDialog = true;
        },
        /** 保存 / 清除重定向（clear=true 时清空并恢复渠道直链） */
        async submitRedirect(clear = false) {
            this.redirectSaving = true;
            try {
                const url = clear ? '' : String(this.redirectForm.url || '').trim();
                const fileId = this.file.name;
                const response = await fetchWithAuth(`/api/manage/files/redirect/${fileId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });
                const data = await response.json().catch(() => ({}));
                if (response.ok && data.success) {
                    ElMessage.success(url ? this.$t('dashboard.redirectSaved') : this.$t('dashboard.redirectCleared'));
                    this.showRedirectDialog = false;
                    // 同步到当前详情对象，避免需重新打开才生效
                    if (this.file?.metadata) {
                        this.file.metadata.RedirectUrl = url;
                    }
                    this.$emit('metadataUpdated', fileId, { ...(this.file?.metadata || {}), RedirectUrl: url });
                } else {
                    throw new Error(data.message || this.$t('common.failed'));
                }
            } catch (error) {
                ElMessage.error(error.message || this.$t('common.failed'));
            } finally {
                this.redirectSaving = false;
            }
        },
        closeRenameDialog() {
            this.showRenameDialog = false;
            this.renameForm.newFileId = '';
            this.renameValidation = { valid: true, error: '' };
        },
        validateRenameInput() {
            const result = validateFileId(this.renameForm.newFileId, this.file?.name || '');
            this.renameValidation = {
                valid: result.valid,
                error: result.error || ''
            };
        },
        async submitRename() {
            if (this.renameSaving) return;

            // Validate input first
            this.validateRenameInput();
            if (!this.renameValidation.valid) {
                return;
            }

            this.renameSaving = true;
            try {
                const oldFileId = this.file.name;
                const response = await fetchWithAuth(`/api/manage/rename/${oldFileId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ newFileId: this.renameForm.newFileId })
                });

                if (response.ok) {
                    const data = await response.json();
                    ElMessage.success(this.$t('fileDetail.renameSuccess'));
                    this.showRenameDialog = false;
                    this.$emit('fileRenamed', oldFileId, this.renameForm.newFileId, data.metadata);
                } else if (response.status === 409) {
                    // Conflict — target File_ID already exists
                    this.renameValidation = {
                        valid: false,
                        error: this.$t('fileDetail.renameConflict')
                    };
                } else {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.message || this.$t('fileDetail.renameFailed'));
                }
            } catch (error) {
                console.error('Error renaming file:', error);
                ElMessage.error(error.message || this.$t('fileDetail.renameFailed'));
            } finally {
                this.renameSaving = false;
            }
        }
    }
}
</script>

<style scoped>
/* 详情内容容器：值超长时整体字号降一号 */
.detail-body.detail-compact .detail-action,
.detail-body.detail-compact :deep(.el-descriptions__label),
.detail-body.detail-compact :deep(.el-descriptions__content),
.detail-body.detail-compact :deep(.el-input__inner),
.detail-body.detail-compact :deep(.el-tabs__item) {
    font-size: 13px;
}
.detail-body.detail-compact :deep(.el-descriptions__content .el-tag),
.detail-body.detail-compact :deep(.el-descriptions__label.el-tag) {
    font-size: 12px;
}
.detail-actions {
    display: flex;
    justify-content: right;
    margin-bottom: 10px;
    flex-wrap: wrap;
    gap: 8px;
}
.detail-action {
    margin-left: 0 !important;
}
.video-preview {
    width: 100%;
    max-width: 400px;
    max-height: 300px;
    border-radius: 8px;
    cursor: pointer;
    object-fit: contain;
}
.audio-preview {
    width: 100%;
    max-width: 400px;
    border-radius: 8px;
}
.image-preview {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 300px;
    border-radius: 8px;
    cursor: pointer;
}
.image-preview :deep(img) {
    max-width: 100%;
    max-height: 300px;
    object-fit: contain;
}
.file-icon-detail {
    font-size: 64px;
    color: var(--el-text-color-secondary);
}
.preview-section {
    display: flex;
    justify-content: center;
    margin-bottom: 15px;
    padding: 12px;
    background: var(--el-fill-color-light);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    min-height: 60px;
}
.preview-content {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
}
:deep(.el-descriptions__content) {
    word-break: break-all;
    word-wrap: break-word;
}
:deep(.el-descriptions__content .el-tag) {
    vertical-align: middle;
}
:deep(.el-descriptions__content .el-tag + span) {
    vertical-align: middle;
}
:deep(.el-descriptions__label) {
    width: 120px !important;
    min-width: 100px !important;
    max-width: 120px !important;
}
:deep(.el-descriptions__body table) {
    table-layout: fixed;
}
.md5-value {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    word-break: break-all;
}
/* 存储渠道 / 备份渠道：值可点击，直接打开该文件在对应渠道上的直链 */
.channel-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: inherit;
    text-decoration: none;
    vertical-align: middle;
    max-width: 100%;
}
.channel-link:not(.is-static) {
    cursor: pointer;
}
.channel-link:not(.is-static):hover .channel-name {
    text-decoration: underline;
    color: var(--el-color-primary);
}
.channel-link .channel-name {
    word-break: break-all;
}
/* 渠道行：链接 + 复制按钮 */
.channel-row {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
}

/* 详情里可点击的「文件分类」值：跳转到文件管理的对应目录 */
.detail-jump-link {
    color: var(--el-color-primary);
    text-decoration: none;
    word-break: break-all;
    cursor: pointer;
}
.detail-jump-link:hover {
    text-decoration: underline;
}

/* 详情里的标签：点击按该标签筛选文件 */
.detail-tag-link {
    cursor: pointer;
}
.detail-tag-link:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
}
.channel-copy-btn {
    padding: 2px 4px;
    height: auto;
    color: var(--el-text-color-secondary);
}
.channel-copy-btn:hover {
    color: var(--el-color-primary);
}
/* 重定向说明 */
.redirect-tip {
    margin: -6px 0 0 100px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
/* 编辑态的「文件分类」下拉：与其它详情值对齐 */
.detail-folder-select {
    width: 100%;
}
@media (max-width: 768px) {
    .detail-actions {
        justify-content: center;
    }
    /* 链接格式那一行（原始 / Markdown / HTML / BBCode / …）改成可左右滑动 */
    :deep(.el-tabs__header) {
        margin-bottom: 8px;
    }
    :deep(.el-tabs__nav-wrap) {
        overflow: visible;
    }
    :deep(.el-tabs__nav-scroll) {
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
    }
    :deep(.el-tabs__nav-scroll)::-webkit-scrollbar {
        display: none;
    }
    :deep(.el-tabs__nav) {
        flex-wrap: nowrap;
        transform: none !important;
    }
    :deep(.el-tabs__item) {
        flex: 0 0 auto;
        padding: 0 12px;
        white-space: nowrap;
    }
}
</style>
