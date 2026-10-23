<template>
    <div class="upload-form" :class="{'upload-form-busy': fileList.length}">
        <textarea
            ref="clipboardPasteReceiver"
            class="clipboard-paste-receiver"
            tabindex="-1"
            aria-hidden="true"
        ></textarea>
        <div 
            class="upload-card-wrapper"
            @mousemove="handleUploadCardMouseMove"
            @mouseleave="handleUploadCardMouseLeave"
            @drop.capture.stop.prevent="handleDrop"
        >
            <div class="upload-card-glow" ref="uploadCardGlow"></div>
            <!-- 默认上传模式：结构与「链接」模式一一对应
                 .upload-card（外层大框）= 链接模式 .upload-card
                 .default-card（虚线卡片）= 链接模式 .paste-card
                 .el-upload-dragger（拖拽区）= 链接模式 .upload-card-textarea
                 .default-upload-actions（自动上传开关）= 链接模式 .paste-card-actions -->
            <div
                v-if="uploadMethod === 'default'"
                class="upload-card"
            >
                <div
                    class="default-card"
                    :class="{'is-uploading': uploading, 'upload-card-busy': fileList.length}"
                >
                    <el-upload
                        class="default-upload-dragger"
                        drag
                        multiple
                        :accept="acceptAttr"
                        :http-request="uploadFile"
                        :onSuccess="handleSuccess"
                        :on-error="handleError"
                        :before-upload="beforeUpload"
                        :on-progress="handleProgress"
                        :file-list="fileList"
                        :show-file-list="false"
                        >
                        <el-icon class="el-icon--upload" :class="{'upload-list-busy': fileList.length}">
                            <svg class="upload-plus-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true">
                                <path d="M12 7v10"/>
                                <path d="M7 12h10"/>
                            </svg>
                        </el-icon>
                        <div class="upload-prompt-row">
                            <div class="el-upload__text" :class="{'upload-list-busy': fileList.length}" v-html="$t('upload.dragUploadText', { pasteShortcut })"></div>
                            <el-tooltip :disabled="disableTooltip" :content="$t('upload.selectFolderUpload')" placement="top" :show-after="1000">
                                <button
                                    type="button"
                                    class="folder-upload-icon-button"
                                    :class="{'upload-list-busy': fileList.length}"
                                    :aria-label="$t('upload.selectFolderUpload')"
                                    @click.stop.prevent="openFolderPicker"
                                >
                                    <font-awesome-icon icon="folder-open" />
                                </button>
                            </el-tooltip>
                        </div>
                    </el-upload>
                    <!-- 底部操作行：与「链接」模式的 转存/外链 同一方位（虚线卡片内右下角）。
                         @click.stop 阻止冒泡到 el-upload 的拖拽区，避免点开关时弹出文件选择框 -->
                    <div class="default-upload-actions" @click.stop>
                        <el-button
                            v-if="!autoUpload"
                            type="primary"
                            size="small"
                            class="paste-card-upload-button manual-upload-button"
                            :disabled="!fileList.some(item => item.status === 'waiting')"
                            @click.stop="startManualUpload"
                        >
                            <font-awesome-icon icon="upload" class="manual-upload-icon"/>
                            {{ $t('uploadForm.uploadNow') }}
                        </el-button>
                        <!-- 开关文案固定为「自动」（不再随状态变成「手动」）；
                             点文字也能切换，扩大触控热区 -->
                        <div class="default-upload-switch">
                            <span class="auto-upload-switch-control" @click.stop>
                                <el-switch
                                    :model-value="autoUpload"
                                    @update:model-value="$emit('update:autoUpload', $event)"
                                    class="auto-upload-switch"
                                />
                            </span>
                            <span
                                class="auto-upload-switch-label"
                                role="switch"
                                :aria-checked="autoUpload ? 'true' : 'false'"
                                @click.stop="toggleAutoUpload"
                            >{{ $t('uploadForm.autoUpload') }}</span>
                        </div>
                    </div>
                </div>
            </div>
            <input
                ref="folderInput"
                class="folder-upload-input"
                type="file"
                webkitdirectory
                directory
                multiple
                @change="handleFolderSelection"
            />
        </div>
        <div v-if="uploadMethod === 'paste'" class="upload-card">
            <el-card 
                class="paste-card"
                :class="{'is-uploading': uploading, 'upload-card-busy': fileList.length}"
            >
                <el-input
                    v-model="pastedUrls"
                    class="upload-card-textarea"
                    :placeholder="$t('upload.pasteUrlPlaceholder')"
                    type="textarea"
                    :rows="fileList.length ? 4 : 14"
                />
                <div class="paste-card-actions">
                    <el-button
                        class="paste-card-upload-button"
                        type="primary"
                        :size="pasteCardMethodButtonSize"
                        @click="handleUploadPasteUrls"
                    >
                        {{ $t('upload.pasteUploadBtn') }}
                    </el-button>
                    <div
                        class="paste-card-method-group"
                        :class="{ 'is-external': pasteUploadMethod === 'external' }"
                        role="group"
                        :aria-label="$t('upload.switchUploadMethod')"
                    >
                        <button
                            class="paste-card-method-button"
                            :class="{ 'is-active': pasteUploadMethod === 'save' }"
                            type="button"
                            :aria-pressed="pasteUploadMethod === 'save'"
                            @click="pasteUploadMethod = 'save'"
                        >
                            {{ $t('upload.pasteSave') }}
                        </button>
                        <button
                            class="paste-card-method-button"
                            :class="{ 'is-active': pasteUploadMethod === 'external' }"
                            type="button"
                            :aria-pressed="pasteUploadMethod === 'external'"
                            @click="pasteUploadMethod = 'external'"
                        >
                            {{ $t('upload.pasteExternal') }}
                        </button>
                    </div>
                </div>
            </el-card>
        </div>
        <el-card class="upload-list-card" :class="{'upload-list-busy': fileList.length}">
            <div class="upload-list-container">
                <el-scrollbar @scroll="handleScroll" ref="scrollContainer">
                    <div class="upload-list-dashboard" :class="{ 'list-scrolled': listScrolled }">
                        <el-text class="upload-list-dashboard-title">
                            <el-icon><List /></el-icon>{{ uploadingCount + waitingCount }}
                            <el-icon><Checked /></el-icon>{{ uploadSuccessCount }}
                            <el-icon><Failed /></el-icon>{{ uploadErrorCount }}
                        </el-text>
                        <div class="upload-list-dashboard-action">
                            <div class="modern-action-group">
                                <el-tooltip :disabled="disableTooltip" :content="$t('upload.copyAll')" placement="top" :show-after="1000">
                                    <el-dropdown trigger="hover" @command="copyAll">
                                        <button
                                            type="button"
                                            class="modern-action-btn modern-action-btn-copy"
                                            :aria-label="`${$t('upload.copyAll')} (${defaultCopyFormat.label})`"
                                            @click="copyAll()"
                                        >
                                            <font-awesome-icon icon="copy" />
                                            <span class="copy-format-badge" aria-hidden="true">{{ defaultCopyFormat.initial }}</span>
                                        </button>
                                        <template #dropdown>
                                            <el-dropdown-menu class="modern-dropdown-menu">
                                                <el-dropdown-item
                                                    v-for="format in alternativeCopyFormats"
                                                    :key="format.value"
                                                    :command="format.value"
                                                    :class="{ 'copy-format-active': format.value === selectedUrlForm }"
                                                >
                                                    <font-awesome-icon :icon="format.icon" class="copy-format-icon" aria-hidden="true" />
                                                    {{ format.label }}
                                                    <font-awesome-icon
                                                        v-if="format.value === selectedUrlForm"
                                                        icon="check"
                                                        class="copy-format-check"
                                                        aria-hidden="true"
                                                    />
                                                </el-dropdown-item>
                                            </el-dropdown-menu>
                                        </template>
                                    </el-dropdown>
                                </el-tooltip>
                                <el-tooltip :disabled="disableTooltip" :content="$t('upload.retryFailed')" placement="top" :show-after="1000">
                                    <el-dropdown>
                                        <button class="modern-action-btn modern-action-btn-retry" @click="retryError">
                                            <font-awesome-icon icon="redo" />
                                        </button>
                                        <template #dropdown>
                                            <el-dropdown-menu class="modern-dropdown-menu">
                                                <el-dropdown-item>
                                                    <div class="modern-dropdown-item-content">
                                                        <span>{{ $t('uploadForm.autoRetry') }}</span>
                                                        <el-switch v-model="autoReUpload" @change="handleAutoRetryChange" size="small" />
                                                    </div>
                                                </el-dropdown-item>
                                            </el-dropdown-menu>
                                        </template>
                                    </el-dropdown>
                                </el-tooltip>
                                <el-tooltip :disabled="disableTooltip" :content="$t('upload.clearList')" placement="top" :show-after="1000">
                                    <el-dropdown>
                                        <button class="modern-action-btn modern-action-btn-danger">
                                            <font-awesome-icon icon="trash-alt" />
                                        </button>
                                        <template #dropdown>
                                            <el-dropdown-menu class="modern-dropdown-menu">
                                                <el-dropdown-item @click="clearFileList">{{ $t('upload.clearAll') }}</el-dropdown-item>
                                                <el-dropdown-item @click="clearSuccessList">{{ $t('upload.clearUploaded') }}</el-dropdown-item>
                                            </el-dropdown-menu>
                                        </template>
                                    </el-dropdown>
                                </el-tooltip>
                            </div>
                        </div>
                    </div>
                    <UploadFileItem
                        v-for="file in fileList.slice().reverse()"
                        :key="file.uid"
                        :file="file"
                        @copy="handleCopy"
                        @remove="handleRemove"
                        @detail="handleDetail"
                        @preview-error="handlePreviewError"
                    />
                </el-scrollbar>
            </div>
        </el-card>

        <!--
          上传完成 → 点击列表里的文件名 → 调出「文件详情」。
          全站统一入口：components/dashboard/FileDetailUnified.vue（内部 = FileDetailDialog 模板
          + buildFileDetail 数据构造 + 标签/黑白名单/删除/重命名/重定向等同一套按钮与权限）。
          数据加载统一走 utils/fileDetailLoader.loadFileDetail()。
        -->
        <FileDetailUnified
            v-model="showDetail"
            :file="detailFile"
            @deleted="handleDetailDeleted"
            @fileRenamed="handleDetailFileRenamed"
        />
    </div>
</template>

<script>
import axios from '@/utils/axios'
import * as imageConversion from 'image-conversion'
import { mapGetters } from 'vuex'
import { buildFileUrls, updateFileListUrls, getUrlByFormat } from '@/utils/upload/urlBuilder'
import {
    collectFilesFromDataTransferItems,
    filesToUploadEntries,
    getRelativeDirectory,
    joinUploadFolder
} from '@/utils/upload/directoryTraversal'
import UploadFileItem from '@/components/upload/UploadFileItem.vue'
import FileDetailUnified from '@/components/dashboard/FileDetailUnified.vue'
import { loadFileDetail } from '@/utils/fileDetailLoader'
import { copyText } from '@/utils/clipboard'
import { fileLink, getLinkPrefix } from '@/utils/fileLink'

const COPY_FORMATS = [
    { value: 'url', label: 'URL', initial: 'Url', icon: 'link' },
    { value: 'md', label: 'Markdown', initial: 'M', icon: 'code' },
    { value: 'html', label: 'HTML', initial: 'H', icon: 'code-branch' },
    { value: 'ubb', label: 'BBCode', initial: 'B', icon: 'quote-right' }
]

export default {
name: 'UploadForm',
components: {
    UploadFileItem,
    FileDetailUnified
},
props: {
    selectedUrlForm: {
        type: String,
        default: 'url',
        required: false
    },
    customerCompress: {
        type: Boolean,
        default: true,
        required: false
    },
    compressBar: {
        type: Number,
        default: 5,
        required: false
    },
    serverCompress: {
        type: Boolean,
        default: true,
        required: false
    },
    uploadChannel: {
        type: String,
        default: 'cos',
        required: false
    },
    channelName: {
        type: String,
        default: '',
        required: false
    },
    uploadNameType: {
        type: String,
        default: 'default',
        required: false
    },
    useCustomUrl: {
        type: String,
        default: 'false',
        required: false
    },
    customUrlPrefix: {
        type: String,
        default: '',
        required: false
    },
    autoRetry: {
        type: Boolean,
        default: true,
        required: false
    },
    urlPrefix: {
        type: String,
        default: '',
        required: false
    },
    uploadMethod: {
        type: String,
        default: 'default',
        required: false
    },
    uploadFolder: {
        type: String,
        default: '',
        required: false
    },
    convertToWebp: {
        type: Boolean,
        default: false,
        required: false
    },
    /** 自动上传：关闭后文件仅入列，需点击「上传」手动触发（可先改文件名） */
    autoUpload: {
        type: Boolean,
        default: true,
        required: false
    },
    /**
     * 备份渠道（由「上传设置」里的备份渠道下拉决定）：
     *   ''      → 跟随全局默认备份渠道（后端 getStorageChannel 解析）
     *   'none'  → 本次不备份
     *   渠道 ID → 写入该备份渠道
     * 已不再使用「是否备份」开关。
     */
    backupChannel: {
        type: String,
        default: '',
        required: false
    },
    /** 压缩期望：压到原体积的百分比（10-100） */
    compressPercent: {
        type: Number,
        default: 80,
        required: false
    },
    /**
     * 上传限制的「本次覆盖」值（来自上传设置弹窗）：
     *   limitExtensions —— 逗号分隔的扩展名，如 'jpg,png,mp4'；空 = 跟随后台
     *   limitMaxSizeMB  —— 单文件大小上限（MB）；0 / 空 = 跟随后台
     * 只存在内存里，刷新页面即恢复后台全局设置。
     */
    limitExtensions: {
        type: String,
        default: '',
        required: false
    },
    limitMaxSizeMB: {
        type: Number,
        default: 0,
        required: false
    }
},
emits: ['update:autoUpload'],
data() {
    return {
        fileList: [],
        uploading: false,
        maxUploading: 6,
        exceptionList: [],
        listScrolled: false,
        fileListLength: 0,
        localUidCounter: 0,
        pastedUrls: '',
        pasteUploadMethod: 'save',
        // 失败文件自动重试相关（对齐 CloudFlare-ImgBed 的机制）：
        //   单个文件失败 → 不阻塞，继续上传后面排队的文件；
        //   一波（轮）上传结束后 → 回到失败队列，整队再循环一轮；
        //   一直循环到全部成功（开关关闭则停在手动重试）。
        autoReUpload: true,
        retryTimer: null, // 兼容保留：旧的自动重试定时器引用（现已不用）
        retryDelay: 12000, // 两轮重试之间的等待时间（毫秒）
        retryRound: 0, // 已进行的失败重试轮次（用于提示文案）
        roundTimer: null, // 下一轮重试的调度定时器
        retryLoopActive: false, // 失败重试循环是否正在进行
        // 每轮重试开始前重新解析出的「生效上传参数」，null = 直接用 props/默认值
        liveParams: null,
        // 批量上传并发控制
        uploadQueue: [], // 等待上传的文件队列
        activeUploads: 0, // 当前正在上传的文件数
        maxConcurrentUploads: 6, // 最大并发上传数
        // 取消上传控制
        abortControllers: new Map(), // 存储每个文件的 AbortController
        pasteFocusTarget: null,
        // 手动上传模式（autoUpload=false）时，点击「上传」按钮临时置位，绕过入列拦截
        forcedUpload: false,
        // 文件详情弹窗（点击上传列表里的文件名打开）
        showDetail: false,
        detailFile: null,
    }
},
watch: {
    fileList: {
        handler() {
            if (this.fileList.length > this.fileListLength) {
                this.$nextTick(() => {
                    setTimeout(() => {
                        if (this.$refs.scrollContainer) {
                            // this.$refs.scrollContainer.setScrollTop(this.$refs.scrollContainer.wrapRef.scrollHeight) // 滚动到底部
                            this.$refs.scrollContainer.setScrollTop(0) // 滚动到顶部
                        }
                    }, 100)
                })
            }
            this.fileListLength = this.fileList.length
        },
        deep: true
    },
    useCustomUrl: {
        handler() {
            updateFileListUrls(this.fileList, this.rootUrl)
        },
        immediate: true
    },
    customUrlPrefix: {
        handler() {
            if (this.useCustomUrl === 'true') {
                updateFileListUrls(this.fileList, this.rootUrl)
            }
        },
        immediate: true
    },
    autoReUpload(val) {
        this.$store.commit('setStoreAutoReUpload', val)
    },
    /**
     * 用户在上传页当场改了上传参数（渠道 / 目录 / 命名 / 备份…）时，
     * 丢掉重试轮次缓存下来的参数快照，立刻回落到最新的 props。
     */
    uploadChannel() { this.liveParams = null },
    channelName() { this.liveParams = null },
    backupChannel() { this.liveParams = null },
    uploadFolder() { this.liveParams = null },
    uploadNameType() { this.liveParams = null },
    compressPercent() { this.liveParams = null },
    urlPrefix() { this.liveParams = null },
    /** 文件数或状态变化 → 重新观察 + 重新量一次列表区高度（最多显示 3 个） */
    listSignature() {
        this.$nextTick(() => {
            this.observeUploadList()
            this.updateUploadListHeight()
        })
    }
},
computed: {
    ...mapGetters([
        'storeAutoReUpload',
        'userConfig'
    ]),
    /**
     * 上传设置弹窗里「本次生效」的允许格式（解析后的数组）。
     * 支持 `jpg,png` / `.jpg, .png` / 空格分隔；非法/空 → 返回空数组（跟随后台）。
     */
    localExtensions() {
        if (!this.limitExtensions) return []
        const list = String(this.limitExtensions)
            .split(/[,，\s]+/)
            .map((e) => e.trim().replace(/^\./, '').toLowerCase())
            .filter((e) => /^[a-z0-9]{1,10}$/.test(e))
        return Array.from(new Set(list))
    },
    /** 允许的上传扩展名（上传设置里的本次覆盖优先，其次系统设置，最后兜底） */
    allowedExtensions() {
        if (this.localExtensions.length) return this.localExtensions
        const v = this.userConfig?.allowedExtensions
        return Array.isArray(v) && v.length
            ? v
            : ['jpg', 'png', 'gif', 'jpeg', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'm4v', 'mp3', 'm4a', 'aac', 'ogg']
    },
    /** 单文件大小上限（MB）：上传设置覆盖优先，其次系统设置，默认 150 */
    maxUploadSizeMB() {
        const local = Number(this.limitMaxSizeMB)
        if (Number.isFinite(local) && local > 0) return local
        const v = Number(this.userConfig?.maxUploadSizeMB)
        return Number.isFinite(v) && v > 0 ? v : 150
    },
    /** 文件选择器 accept 属性（与服务端白名单保持一致） */
    acceptAttr() {
        return this.allowedExtensions.map((e) => '.' + e).join(',')
    },
    /**
     * 列表区高度自适应用的「签名」：文件数 + 每个文件的状态。
     * 状态变化（上传中 → 完成）会改变条目高度（多了外链行），需要重新量一次。
     */
    listSignature() {
        return this.fileList.length + '|' + this.fileList.map((i) => i.status).join(',')
    },
    defaultCopyFormat() {
        return COPY_FORMATS.find(format => format.value === this.selectedUrlForm) || COPY_FORMATS[0]
    },
    alternativeCopyFormats() {
        /*
         * v202610221824：下拉里列出「全部」格式（含当前默认格式）。
         * 原先把当前格式从下拉里过滤掉，导致用户在下拉里看不到 URL 这一项，
         * 只能靠按钮右下角那个小小的 "u" 猜当前是什么格式。
         */
        return COPY_FORMATS
    },
    uploadSuccessCount() {
        return this.fileList.filter(item => item.status === 'done' || item.status === 'success').length
    },
    uploadErrorCount() {
        return this.fileList.filter(item => item.status === 'exception').length
    },
    uploadingCount() {
        return this.fileList.filter(item => item.status === 'uploading').length
    },
    waitingCount() {
        return this.uploadQueue.length
    },
    /**
     * 当前「生效的」上传参数。
     * 默认直接用 props（用户在页面上选的）；每轮失败重试开始前会用
     * refreshUploadParams() 重新解析一次并写进 liveParams，使后台的改动
     * （默认存储渠道 / 备份渠道 / 上传目录 / 命名方式 / 外链前缀…）
     * 能在下一轮循环时生效 —— 对齐 CloudFlare-ImgBed 的机制。
     */
    effParams() {
        const p = this.liveParams || {}
        const pick = (key, fallback) => (p[key] === undefined || p[key] === null ? fallback : p[key])
        return {
            uploadChannel: pick('uploadChannel', this.uploadChannel),
            channelName: pick('channelName', this.channelName),
            uploadNameType: pick('uploadNameType', this.uploadNameType),
            uploadFolder: pick('uploadFolder', this.uploadFolder),
            backupChannel: pick('backupChannel', this.backupChannel),
            compressPercent: pick('compressPercent', this.compressPercent),
            autoRetry: pick('autoRetry', this.autoRetry),
            linkPrefix: p.linkPrefix || this.urlPrefix || getLinkPrefix()
        }
    },
    urlSize() {
        // 移动端为small
        return window.innerWidth < 768 ? 'small' : 'default'
    },
    disableTooltip() {
        return window.innerWidth < 768
    },
    pasteShortcut() {
        const platform = navigator.userAgentData?.platform || navigator.platform || ''
        return /mac|iphone|ipad|ipod/i.test(platform) ? 'Cmd + V' : 'Ctrl + V'
    },
    rootUrl() {
        // 启用「自定义链接格式」时用其自定义前缀；否则走全站统一出口（自定义访问域名优先）
        if (this.useCustomUrl === 'true') {
            const p = String(this.customUrlPrefix || '')
            return p && !p.endsWith('/') ? `${p}/` : p
        }
        return this.effParams.linkPrefix || this.urlPrefix || getLinkPrefix()
    },
    pasteCardMethodButtonSize() {
        if (this.fileList.length) {
            return 'small'
        } else {
            return window.innerWidth < 768 ? 'small' : 'medium'
        }
    }
},
created() {
    // 非响应式的内部句柄（放 data 里会被 Proxy 包一层，没必要）
    this._heightRaf = null
    this._listRO = null
},
mounted() {
    document.addEventListener('paste', this.handlePaste)
    document.addEventListener('keydown', this.handlePasteShortcut)
    this.autoReUpload = this.storeAutoReUpload
    window.addEventListener('resize', this.updateUploadListHeight)
    // 高度自适应：先挂观察器，再量一次（列表可能是带着历史文件重新挂载的）
    this.$nextTick(() => {
        this.observeUploadList()
        this.updateUploadListHeight()
    })
},
beforeUnmount() {
    document.removeEventListener('paste', this.handlePaste)
    document.removeEventListener('keydown', this.handlePasteShortcut)
    window.removeEventListener('resize', this.updateUploadListHeight)
    this.disconnectUploadListObserver()
    if (this._heightRaf) {
        cancelAnimationFrame(this._heightRaf)
        this._heightRaf = null
    }
    // 清理状态
    if (this.roundTimer) {
        clearTimeout(this.roundTimer)
        this.roundTimer = null
    }
    if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
    }
    this.retryLoopActive = false
    this.exceptionList = []
    this.uploadQueue = []
    this.fileList = []
    this.activeUploads = 0
},
methods: {
    /**
     * 统一的附加上传参数：
     *   compressPercent —— 压缩期望百分比（前端上传设置优先，0 表示交给后端默认）
     *   backupChannel   —— 备份渠道（'' 跟随全局 / 'none' 不备份 / 渠道 ID）
     *   originalSize    —— 压缩/转码前的初始字节数，供详情页展示「初始大小 / 当前大小」
     * 统一取 effParams（每轮重试前会重新解析），保证下一轮用的是最新参数。
     */
    extraUploadParams(file) {
        const uid = file?.file?.uid ?? file?.uid
        const item = this.fileList.find(i => i.uid === uid)
        const originalSize = (item && item.originalSize) || file?.file?.size || 0
        const p = this.effParams
        // 上传限制覆盖：只在用户真的在「上传设置」里填过时才带，避免无谓传参
        const limitExts = this.localExtensions.join(',')
        const limitMB = Number(this.limitMaxSizeMB) > 0 ? Number(this.limitMaxSizeMB) : 0
        return '&compressPercent=' + (p.compressPercent || 0) +
            '&backupChannel=' + encodeURIComponent(p.backupChannel || '') +
            '&originalSize=' + originalSize +
            (limitExts ? '&allowedExtensions=' + encodeURIComponent(limitExts) : '') +
            (limitMB ? '&maxFileSizeMB=' + limitMB : '')
    },
    /**
     * 列表区高度自适应（v2.0.0 重新设计）：
     * 基础方案改为纯 CSS —— 卡片 height:auto 由内容撑开，内容可见性不再依赖 JS；
     * JS 只负责一件事：把滚动封顶值 --upload-list-max-h 实测成「头部 + 3 个条目」，
     * 让「超过 3 个出滚动条」的阈值贴合真实条目高度（条目高度可变：上传中只有进度条、
     * 完成后多外链行、视频缩略图最高 110px）。
     * JS 失效（老浏览器）时封顶回落 58vh，内容依旧完整可见/可滚 —— 任何环境都不会裁掉内容。
     */
    updateUploadListHeight() {
        if (this._heightRaf) cancelAnimationFrame(this._heightRaf)
        this._heightRaf = requestAnimationFrame(() => {
            this._heightRaf = null
            this.measureUploadListHeight()
        })
    },
    /** 实测「头部 + 最多 3 个条目」写入 --upload-list-max-h；量不到则恢复 CSS 兜底 */
    measureUploadListHeight() {
        const root = this.$el
        if (!root) return
        const view = this.$refs.scrollContainer?.$el?.querySelector('.el-scrollbar__view')
        if (!view) {
            root.style.removeProperty('--upload-list-max-h')
            return
        }
        const header = view.querySelector('.upload-list-dashboard')
        // 列表是倒序渲染的（最新在最上），从上往下取前 3 个即可
        const items = Array.from(view.querySelectorAll('.upload-list-item')).slice(0, 3)
        if (!items.length) {
            root.style.removeProperty('--upload-list-max-h')
            return
        }
        let h = header ? header.offsetHeight : 0
        items.forEach((el) => {
            const style = window.getComputedStyle(el)
            h += el.offsetHeight +
                (parseFloat(style.marginTop) || 0) +
                (parseFloat(style.marginBottom) || 0)
        })
        // 少量余量：避免第 3 条底部边距被 max-height 精确裁掉、或恰好压出一像素滚动条
        h += 6
        root.style.setProperty('--upload-list-max-h', h + 'px')
    },
    /** 重新挂 ResizeObserver（条目增删后要重新 observe 新元素） */
    observeUploadList() {
        this.disconnectUploadListObserver()
        if (typeof ResizeObserver === 'undefined') return
        const view = this.$refs.scrollContainer?.$el?.querySelector('.el-scrollbar__view')
        if (!view) return
        this._listRO = new ResizeObserver(() => this.updateUploadListHeight())
        // 容器 + 头部 + 每个条目：任一尺寸变化（缩略图加载、状态行出现）都重量一次
        this._listRO.observe(view)
        const header = view.querySelector('.upload-list-dashboard')
        if (header) this._listRO.observe(header)
        view.querySelectorAll('.upload-list-item').forEach((el) => this._listRO.observe(el))
    },
    disconnectUploadListObserver() {
        if (this._listRO) {
            this._listRO.disconnect()
            this._listRO = null
        }
    },
    /**
     * 点「自动」文字也能切换开关（扩大触控热区）。
     * 文案固定显示「自动」，不再随状态变成「手动」，避免用户误以为是两个不同功能。
     */
    toggleAutoUpload() {
        this.$emit('update:autoUpload', !this.autoUpload)
    },
    /** 手动上传：把列表里所有等待中的文件一次性发出（可先改过文件名） */
    startManualUpload() {
        const pending = this.fileList.filter(item => item.status === 'waiting')
        if (!pending.length) {
            this.$message({ type: 'info', message: this.$t('uploadForm.noPendingFiles') })
            return
        }
        pending.forEach(item => {
            item.editableName = false
            item.status = 'uploading'
            const raw = item.rawFile
            if (!raw) return
            // 用户可能改过文件名：按新名字重新构造 File，实现「按新名上传」
            let fileToUpload = raw
            const desiredName = item.name
            if (desiredName && desiredName !== raw.name) {
                try {
                    fileToUpload = new File([raw], desiredName, { type: raw.type })
                } catch (e) {
                    fileToUpload = raw
                }
                fileToUpload.uid = raw.uid
                fileToUpload.uploadFolder = raw.uploadFolder
                fileToUpload.uploadRelativePath = desiredName
            }
            this.forcedUpload = true
            this.uploadFile({
                file: fileToUpload,
                onProgress: (evt) => this.handleProgress(evt),
                onSuccess: (response, file) => this.handleSuccess(response, file),
                onError: (error, file) => this.handleError(error, file)
            })
            this.forcedUpload = false
        })
    },
    createLocalUid() {
        this.localUidCounter += 1
        return `local-${Date.now()}-${this.localUidCounter}`
    },
    applyUploadPath(file, relativePath = file.name) {
        const normalizedRelativePath = String(relativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '')
        file.uploadRelativePath = normalizedRelativePath
        file.uploadFolder = joinUploadFolder(this.uploadFolder, getRelativeDirectory(normalizedRelativePath))
        return file
    },
    copyUploadPath(sourceFile, targetFile) {
        targetFile.uploadRelativePath = sourceFile.uploadRelativePath || sourceFile.name
        targetFile.uploadFolder = sourceFile.uploadFolder ?? this.uploadFolder
        return targetFile
    },
    getFileUploadFolder(file) {
        const fileItem = this.fileList.find(item => item.uid === file.file.uid)
        return fileItem?.uploadFolder ?? file.file.uploadFolder ?? this.effParams.uploadFolder
    },
    createUploadRequest(file) {
        return {
            file,
            onProgress: (evt) => this.handleProgress(evt),
            onSuccess: (response, uploadedFile) => this.handleSuccess(response, uploadedFile),
            onError: (error, uploadedFile) => this.handleError(error, uploadedFile)
        }
    },
    async uploadLocalEntries(entries) {
        // 逐个文件独立处理：某个文件在预处理阶段失败（压缩异常、超限、类型不合法…）
        // 只跳过它自己并给出提示，不影响同一批里的其它文件继续上传。
        await Promise.allSettled(entries.map(async ({ file, relativePath }) => {
            try {
                file.uid = this.createLocalUid()
                this.applyUploadPath(file, relativePath)
                const processedFile = await this.beforeUpload(file)
                if (processedFile instanceof File) {
                    this.uploadFile(this.createUploadRequest(processedFile))
                }
            } catch (err) {
                this.$message.error(
                    this.$t('uploadForm.batchEntryFailed', { name: this.truncateFilename(file.name) })
                )
            }
        }))
    },
    openFolderPicker() {
        this.$refs.folderInput?.click()
    },
    async handleFolderSelection(event) {
        const entries = filesToUploadEntries(event.target.files)
        event.target.value = ''
        await this.uploadLocalEntries(entries)
    },
    async handleDrop(event) {
        const dataTransfer = event.dataTransfer
        if (!dataTransfer) return

        const entries = dataTransfer.items?.length
            ? await collectFilesFromDataTransferItems(dataTransfer.items)
            : filesToUploadEntries(dataTransfer.files)

        if (entries.length) await this.uploadLocalEntries(entries)
    },
    // 文件名中间截断，保留前缀和扩展名
    truncateFilename(filename, maxLength = 20) {
        if (!filename || filename.length <= maxLength) {
            return filename
        }
        const lastDotIndex = filename.lastIndexOf('.')
        let name, ext
        if (lastDotIndex > 0) {
            name = filename.substring(0, lastDotIndex)
            ext = filename.substring(lastDotIndex)
        } else {
            name = filename
            ext = ''
        }
        // 保留扩展名和部分前后缀
        const keepEnd = ext.length + 4 // 扩展名 + 4个字符
        const keepStart = maxLength - keepEnd - 3 // 3个字符留给...
        if (keepStart <= 0) {
            return filename.substring(0, maxLength - 3) + '...'
        }
        return name.substring(0, keepStart) + '...' + name.slice(-4) + ext
    },
    uploadFile(file) {
        // 如果fileList中不存在该文件，说明已被删除，直接返回
        if (!this.fileList.find(item => item.uid === file.file.uid)) {
            return
        }

        // 手动上传模式：关闭「自动上传」后文件仅入列等待，用户点「上传」才真正发送
        if (!this.autoUpload && !this.forcedUpload) {
            const pendingItem = this.fileList.find(item => item.uid === file.file.uid)
            if (pendingItem) {
                pendingItem.status = 'waiting'
                pendingItem.editableName = true
            }
            return
        }

        // 并发控制：如果当前上传数已达上限，加入队列等待
        if (this.activeUploads >= this.maxConcurrentUploads) {
            this.uploadQueue.push(file)
            const waitingItem = this.fileList.find(item => item.uid === file.file.uid)
            if (waitingItem) waitingItem.status = 'waiting'
            return
        }
        
        // 开始上传，增加计数
        this.activeUploads++
        const uploadingItem = this.fileList.find(item => item.uid === file.file.uid)
        if (uploadingItem) uploadingItem.status = 'uploading'

        const fileItem = this.fileList.find(item => item.uid === file.file.uid)
        const uploadChannel = fileItem?.uploadChannel || this.effParams.uploadChannel

        // 如果上传渠道为外链，走服务端拉取
        if (uploadChannel === 'external') {
            this.uploadSingleFile(file)
            return
        }

        // 所有存储渠道统一走 /upload：小文件单次上传，大文件自动分块
        const CHUNK_THRESHOLD = 20 * 1024 * 1024 // 20MB
        if (file.file.size > CHUNK_THRESHOLD) {
            this.uploadFileInChunks(file)
        } else {
            this.uploadSingleFile(file)
        }
    },
    // 处理上传队列中的下一个文件
    processUploadQueue() {
        // 如果队列为空或已达并发上限，不处理
        if (this.uploadQueue.length === 0 || this.activeUploads >= this.maxConcurrentUploads) {
            return
        }
        
        // 从队列中取出下一个文件并上传
        const nextFile = this.uploadQueue.shift()
        if (nextFile && this.fileList.find(item => item.uid === nextFile.file.uid)) {
            this.uploadFile(nextFile)
        } else {
            // 如果文件已被删除，继续处理下一个
            this.processUploadQueue()
        }
    },
    // 上传完成后的清理工作（成功或失败都调用）
    onUploadComplete() {
        this.activeUploads = Math.max(0, this.activeUploads - 1)

        // 处理队列中的下一个文件 —— 某个文件失败/成功都不会阻塞后面排队的文件
        this.processUploadQueue()

        // 一波（轮）结束：既没有在传的、也没有排队的 →
        //   · 还有失败文件 → 回到失败队列，整队再循环一轮（重试前会重新拉取上传参数）
        //   · 全部成功     → 收尾
        if (this.activeUploads === 0 && this.uploadQueue.length === 0) {
            this.uploading = false
            this.maybeStartRetryRound()
        }
    },

    /* ────────────────── 失败文件「循环回炉」重试 ──────────────────
     * 机制（对齐 CloudFlare-ImgBed）：
     *   1) 批量上传时某个文件失败 → 只把它记进 exceptionList，然后立刻继续上传
     *      后面排队的文件，不阻塞整条队列；
     *   2) 一波全部结束（activeUploads === 0 且 uploadQueue 为空）后，如果
     *      exceptionList 里还有失败文件，就整队再循环一轮；
     *   3) 每轮开始前都会 refreshUploadParams() 重新获取一遍上传参数
     *      （默认存储渠道 / 备份渠道 / 上传目录 / 命名方式 / 外链前缀…），
     *      所以重试期间在后台改了配置，下一轮就会按新参数上传；
     *   4) 一直循环到全部成功；关闭「自动重试」开关则停在失败状态等手动重试。
     */
    /** 一波结束后判断是否要开启下一轮重试 */
    maybeStartRetryRound() {
        if (this.roundTimer) return // 已排定下一轮，避免重复触发
        if (!this.exceptionList.length) {
            this.retryRound = 0
            this.retryLoopActive = false
            return
        }
        if (!this.autoReUpload) {
            // 关闭自动重试：失败文件保留在列表里，等用户点「重试」或打开开关
            this.retryLoopActive = false
            return
        }

        this.retryLoopActive = true
        this.retryRound += 1
        const round = this.retryRound
        const count = this.exceptionList.length
        const waitSec = Math.max(1, Math.round(this.retryDelay / 1000))

        this.$message({
            type: 'warning',
            message: this.$t('uploadForm.retryRoundScheduled', { round, count, sec: waitSec })
        })

        this.roundTimer = setTimeout(async () => {
            this.roundTimer = null
            if (!this.autoReUpload || !this.exceptionList.length) {
                this.retryLoopActive = false
                return
            }
            // 关键：每轮开始前重新获取一遍上传参数，让后台的改动在下一轮生效
            await this.refreshUploadParams()
            this.startRetryRound()
        }, this.retryDelay)
    },
    /** 取出失败队列，按最新参数重新入队上传 */
    startRetryRound() {
        const files = [...this.exceptionList]
        this.exceptionList = []
        if (!files.length) {
            this.retryLoopActive = false
            return
        }
        this.uploading = true
        files.forEach(req => {
            const item = this.fileList.find(i => i.uid === req.file.uid)
            if (!item) return // 已被用户删除，跳过
            item.progreess = 0
            item.status = 'uploading'
            // 重试属于「本轮用户已发起的上传」，不受手动上传模式的入列拦截
            this.enqueueUploadRequest(req)
        })
    },
    /** 重新入队 / 直接上传一个上传请求（绕过「手动上传」模式的等待拦截） */
    enqueueUploadRequest(req) {
        const saved = this.forcedUpload
        this.forcedUpload = true
        try {
            this.uploadFile(req)
        } finally {
            this.forcedUpload = saved
        }
    },
    /**
     * 重新获取一遍上传相关的全部参数。
     *   · /api/userConfig —— 主渠道 / 备份渠道 / 自定义访问域名（外链前缀）/
     *     允许的扩展名 / 单文件大小上限 / 默认命名方式（后端按最新配置实时解析）
     *   · 本地设置（Vuex 持久化的用户偏好）—— 命名方式、压缩、上传方式…
     * 结果写进 liveParams，effParams 随即生效。
     */
    async refreshUploadParams() {
        let cfg = this.userConfig
        try {
            await this.$store.dispatch('fetchUserConfig')
            cfg = this.$store.getters.userConfig || cfg
        } catch (e) {
            // 拉取失败（断网等）沿用旧值，不影响继续重试
            console.warn('[upload] 重新获取上传参数失败，沿用上一轮参数:', e)
        }

        this.liveParams = {
            // 渠道相关一律传空串/具体值：空串 = 由后端按「最新」配置实时解析
            // （全局主渠道、账户指定渠道、全局备份渠道），所以后台改渠道下一轮立即生效
            uploadChannel: this.uploadChannel,
            channelName: this.channelName,
            backupChannel: this.backupChannel,
            uploadFolder: this.uploadFolder,
            uploadNameType:
                this.$store.getters.storeUploadNameType ||
                cfg?.defaultUploadNameType ||
                'default',
            compressPercent: this.compressPercent,
            autoRetry: this.autoRetry,
            linkPrefix: getLinkPrefix()
        }

        // 失败文件的上传目录按最新基础目录重算（保留其所在子目录）
        this.retargetPendingUploads(this.exceptionList)
    },
    /** 按最新基础上传目录重算待重试文件的目标目录 */
    retargetPendingUploads(list) {
        const base = this.uploadFolder
        ;(list || []).forEach(req => {
            const item = this.fileList.find(i => i.uid === req.file.uid)
            if (!item) return
            const rel = item.uploadRelativePath || item.name
            item.uploadFolder = joinUploadFolder(base, getRelativeDirectory(rel))
            if (req.file && item.uploadFolder !== undefined) {
                req.file.uploadFolder = item.uploadFolder
            }
        })
    },
    // 单文件上传
    async uploadSingleFile(file) {
        const fileItem = this.fileList.find(item => item.uid === file.file.uid)
        if (!fileItem) return // 文件已被删除
        
        const needServerCompress = fileItem.serverCompress
        const uploadChannel = fileItem.uploadChannel || this.effParams.uploadChannel
        const autoRetry = this.effParams.autoRetry && uploadChannel !== 'external'
        const uploadNameType = uploadChannel === 'external' ? 'default' : this.effParams.uploadNameType
        const targetUploadFolder = this.getFileUploadFolder(file)
        
        // 外链模式：仅记录链接，不实际上传文件
        if (uploadChannel === 'external') {
            file.onSuccess({ data: [{ src: file.file.url }] }, file.file)
            this.onUploadComplete()
            return
        }

        // 创建 AbortController 用于取消上传
        const abortController = new AbortController()
        this.abortControllers.set(file.file.uid, abortController)
        
        const formData = new FormData()
        formData.append('file', file.file)

        axios({
            url: '/upload' + 
                '?serverCompress=' + needServerCompress + 
                '&uploadChannel=' + uploadChannel +
                (this.channelName ? '&channelName=' + encodeURIComponent(this.channelName) : '') +
                '&uploadNameType=' + uploadNameType + 
                '&autoRetry=' + autoRetry + 
                '&uploadFolder=' + encodeURIComponent(targetUploadFolder) + this.extraUploadParams(file),
            method: 'post',
            data: formData,
            withAuthCode: true,
            signal: abortController.signal, // 添加取消信号
            onUploadProgress: (progressEvent) => {
                const percentCompleted = Math.round((progressEvent.loaded / progressEvent.total) * 100)
                file.onProgress({ percent: percentCompleted, file: file.file })
            }
        }).then(res => {
            file.onSuccess(res, file.file)
        }).catch(err => {
            // 如果是取消操作，不加入异常列表
            if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                console.log('上传已取消:', file.file.name)
                return
            }
            if (err.response && err.response.status !== 401) {
                this.exceptionList.push(file)
                file.onError(err, file.file)
            } else if (!err.response) {
                // 网络错误（如 ERR_HTTP2_PROTOCOL_ERROR），也加入异常列表
                this.exceptionList.push(file)
                file.onError(err, file.file)
            }
        }).finally(() => {
            // 清理 AbortController
            this.abortControllers.delete(file.file.uid)
            // 调用并发控制的完成回调
            this.onUploadComplete()
        })
    },
    // 分块上传
    async uploadFileInChunks(file) {
        const fileItem = this.fileList.find(item => item.uid === file.file.uid)
        if (!fileItem) return // 文件已被删除
        
        const uploadChannel = fileItem.uploadChannel || this.effParams.uploadChannel
        
        // 创建 AbortController 用于取消上传
        const abortController = new AbortController()
        this.abortControllers.set(file.file.uid, abortController)
        
        // 统一使用 16MB 分块
        const CHUNK_SIZE = 16 * 1024 * 1024
        
        const fileSize = file.file.size
        const fileType = file.file.type || 'application/octet-stream'
        const totalChunks = Math.ceil(fileSize / CHUNK_SIZE)
        
        const needServerCompress = fileItem.serverCompress
        const autoRetry = this.effParams.autoRetry && uploadChannel !== 'external'
        const uploadNameType = uploadChannel === 'external' ? 'default' : this.effParams.uploadNameType
        const targetUploadFolder = this.getFileUploadFolder(file)

        try {
            // 第一步：初始化分块上传，获取uploadId
            const initFormData = new FormData()
            initFormData.append('originalFileName', file.file.name)
            initFormData.append('originalFileType', fileType)
            initFormData.append('totalChunks', totalChunks.toString())

            const initResponse = await axios({
                url: '/upload' + 
                    '?serverCompress=' + needServerCompress + 
                    '&uploadChannel=' + uploadChannel + 
                    (this.channelName ? '&channelName=' + encodeURIComponent(this.channelName) : '') +
                    '&uploadNameType=' + uploadNameType + 
                    '&autoRetry=' + autoRetry + 
                    '&uploadFolder=' + encodeURIComponent(targetUploadFolder) + this.extraUploadParams(file) +
                    '&initChunked=true',
                method: 'post',
                data: initFormData,
                withAuthCode: true
            })

            if (!initResponse.data.success) {
                throw new Error(this.$t('uploadForm.chunkInitFailed') + ': ' + initResponse.data.message)
            }

            const uploadId = initResponse.data.uploadId
            console.log('分块上传初始化成功，uploadId:', uploadId)

            // 记录 totalChunks 和 uploadId 到文件项，用于后续清理
            const fileItem = this.fileList.find(item => item.uid === file.file.uid)
            if (fileItem) {
                fileItem.totalChunks = totalChunks
                fileItem.uploadId = uploadId
            }

            // 第二步：并发上传所有分块
            const maxConcurrency = 3 // 最大并发数
            const chunkProgress = new Array(totalChunks).fill(0)
            let nextChunkIndex = 0
            let hasError = false
            let errorMsg = ''
            let isCancelled = false // 标记是否被取消

            const uploadChunk = async (chunkIndex) => {
                if (hasError || isCancelled) return

                const start = chunkIndex * CHUNK_SIZE
                const end = Math.min(start + CHUNK_SIZE, fileSize)
                const chunk = file.file.slice(start, end)
                
                const formData = new FormData()
                formData.append('file', chunk, `${file.file.name}.part${chunkIndex.toString().padStart(3, '0')}`)
                formData.append('chunkIndex', chunkIndex.toString())
                formData.append('totalChunks', totalChunks.toString())
                formData.append('uploadId', uploadId)
                formData.append('originalFileName', file.file.name)
                formData.append('originalFileType', fileType)

                let retryCount = 0
                const maxRetries = 3

                while (retryCount < maxRetries) {
                    if (hasError || isCancelled) return
                    try {
                        await axios({
                            url: '/upload' + 
                                '?serverCompress=' + needServerCompress + 
                                '&uploadChannel=' + uploadChannel + 
                                (this.channelName ? '&channelName=' + encodeURIComponent(this.channelName) : '') +
                                '&uploadNameType=' + uploadNameType + 
                                '&autoRetry=' + autoRetry + 
                                '&uploadFolder=' + encodeURIComponent(targetUploadFolder) + this.extraUploadParams(file) +
                                '&chunked=true',
                            method: 'post',
                            data: formData,
                            withAuthCode: true,
                            signal: abortController.signal, // 添加取消信号
                            onUploadProgress: (progressEvent) => {
                                if (hasError || isCancelled) return
                                const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100)
                                chunkProgress[chunkIndex] = percent
                                const totalPercent = Math.round(chunkProgress.reduce((a, b) => a + b, 0) / totalChunks)
                                file.onProgress({ percent: totalPercent, file: file.file })
                            }
                        })
                        return // Success
                    } catch (err) {
                        // 如果是取消操作，直接返回
                        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                            isCancelled = true
                            console.log('分块上传已取消:', file.file.name)
                            return
                        }
                        retryCount++
                        console.warn(`分块 ${chunkIndex + 1}/${totalChunks} 上传失败 (重试 ${retryCount}/${maxRetries}):`, err)
                        if (retryCount >= maxRetries) {
                            hasError = true
                            errorMsg = `分块 ${chunkIndex + 1}/${totalChunks} 上传失败: ${err.message}`
                            throw new Error(errorMsg)
                        }
                        // 等待后重试
                        await new Promise(resolve => setTimeout(resolve, 2000 * retryCount))
                    }
                }
            }

            // 创建并发池
            const pool = []
            for (let i = 0; i < maxConcurrency; i++) {
                pool.push((async () => {
                    while (nextChunkIndex < totalChunks && !hasError && !isCancelled) {
                        const currentIndex = nextChunkIndex++
                        try {
                            await uploadChunk(currentIndex)
                        } catch (e) {
                            if (!isCancelled) {
                                hasError = true
                                errorMsg = e.message
                            }
                            break
                        }
                    }
                })())
            }

            await Promise.all(pool)

            // 如果被取消，直接返回
            if (isCancelled) {
                console.log('分块上传已取消，跳过合并步骤')
                return
            }

            if (hasError) {
                throw new Error(errorMsg || this.$t('uploadForm.uploadError'))
            }

            // 第三步：所有分块上传完成，发送合并请求
            this.$message({
                type: 'info',
                message: this.$t('uploadForm.chunkMerging'),
                duration: 0 // 不自动关闭
            })

            const mergeFormData = new FormData()
            mergeFormData.append('uploadId', uploadId)
            mergeFormData.append('totalChunks', totalChunks.toString())
            mergeFormData.append('originalFileName', file.file.name)
            mergeFormData.append('originalFileType', fileType)

            const response = await axios({
                url: '/upload' + 
                    '?serverCompress=' + needServerCompress + 
                    '&uploadChannel=' + uploadChannel + 
                    (this.channelName ? '&channelName=' + encodeURIComponent(this.channelName) : '') +
                    '&uploadNameType=' + uploadNameType + 
                    '&autoRetry=' + autoRetry + 
                    '&uploadFolder=' + encodeURIComponent(targetUploadFolder) + this.extraUploadParams(file) +
                    '&chunked=true&merge=true',
                method: 'post',
                data: mergeFormData,
                withAuthCode: true
            })
            
            // 关闭提示
            this.$message.closeAll()

            // 同步处理完成
            file.onSuccess(response, file.file)
        } catch (err) {
            // 如果是取消操作，不加入异常列表
            if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                console.log('分块上传已取消:', file.file.name)
                return
            }
            
            console.error('分块上传失败:', err)
            
            // 如果有uploadId，清理相关资源
            const fileItem = this.fileList.find(item => item.uid === file.file.uid)
            if (fileItem && fileItem.uploadId) {
                this.cleanupUploadResources(fileItem.uploadId, fileItem.totalChunks)
                    .then(() => {
                        console.log(`已清理分块上传失败的资源: ${fileItem.uploadId}`)
                    })
                    .catch(cleanupError => {
                        console.warn('清理分块上传失败资源时出错:', cleanupError)
                    })
            }
            
            if (err.response && err.response.status !== 401) {
                this.exceptionList.push(file)
                file.onError(err, file.file)
            } else if (!err.response) {
                // 网络错误，也加入异常列表
                this.exceptionList.push(file)
                file.onError(err, file.file)
            }
        } finally {
            // 清理 AbortController
            this.abortControllers.delete(file.file.uid)
            // 调用并发控制的完成回调
            this.onUploadComplete()
        }
    },
    // 缩略图最终加载失败：只记录日志。
    // 早期实现会把 file.url 直接替换成 404 占位图，导致列表里 `<a :href="file.url">`
    // 的分享链接也被一起改写（用户看到「缩略图和真实链接对不上」）。
    // 现在占位逻辑收在 UploadFileItem 内部，真实链接始终保留。
    handlePreviewError(file) {
        console.warn('[upload] 缩略图加载失败（已保留真实链接）:', file?.url)
    },

    /* ────────────── 上传完成 → 点击文件名 → 文件详情 ──────────────
     * 与后台「文件管理」「历史记录」共用同一弹窗（FileDetailDialog）+ 同一套
     * 数据构造器（utils/fileDetail.buildFileDetail），字段/预览/复制行为完全一致。
     * 上传列表只有 File_ID，缺少 MD5 / 尺寸 / 渠道等元信息，所以打开时用
     * /api/manage/metadata/<File_ID> 取一次完整 metadata 再渲染。
     */
    async handleDetail(file) {
        if (!file) return
        const fileId = file.srcID || file.name
        if (!fileId) return

        // 先用本地已知信息把弹窗秒开，随后走统一加载器补齐全量详情
        this.detailFile = { name: fileId, metadata: file.metadata || {} }
        this.showDetail = true

        try {
            const detail = await loadFileDetail(fileId, { record: this.detailFile, refresh: true })
            if (!detail) {
                this.$message({ type: 'warning', message: this.$t('uploadForm.detailNotFound') })
                // 查不到记录就关掉，避免弹出一个空详情
                if (this.detailFile && this.detailFile.name === fileId) this.showDetail = false
                return
            }
            // 用户可能已关掉弹窗、或又点了别的文件 —— 避免串数据
            if (!this.showDetail || !this.detailFile || this.detailFile.name !== fileId) return
            this.detailFile = detail.file
        } catch (e) {
            console.warn('[upload] 获取文件详情失败:', e)
            this.$message({ type: 'error', message: this.$t('uploadForm.detailLoadFailed') })
        }
    },
    /** 统一详情组件里删除了文件：同步把这条从上传列表移除 */
    handleDetailDeleted(fileId) {
        if (!fileId) return
        const item = this.fileList.find(i => i.srcID === fileId || i.name === fileId)
        if (item) this.handleRemove(item)
    },
    /** 统一详情组件里重命名了 File_ID：同步上传列表项的 srcID */
    handleDetailFileRenamed(oldFileId, newFileId) {
        const item = this.fileList.find(i => i.srcID === oldFileId)
        if (item) item.srcID = newFileId
    },

    handleRemove(file) {
        // 如果文件正在上传，取消上传
        if (this.abortControllers.has(file.uid)) {
            this.abortControllers.get(file.uid).abort()
            this.abortControllers.delete(file.uid)
        }
        // 从上传队列中移除（如果在等待中）
        this.uploadQueue = this.uploadQueue.filter(item => item.file.uid !== file.uid)
        // 从文件列表中移除
        this.fileList = this.fileList.filter(item => item.uid !== file.uid)
        this.$message({
            type: 'info',
            message: this.$t('uploadForm.deleted', { name: this.truncateFilename(file.name) })
        })
    },

    // 清理上传资源
    async cleanupUploadResources(uploadId, totalChunks = 0) {
        try {
            await axios({
                url: `/upload?cleanup=true&uploadId=${uploadId}&totalChunks=${totalChunks}`,
                method: 'get',
                withAuthCode: true,
                timeout: 5000
            })
            console.log(`清理上传资源成功: ${uploadId}`)
        } catch (error) {
            console.warn('清理上传资源失败:', error)
        }
    },
    handleSuccess(response, file) {
        const fileItem = this.fileList.find(item => item.uid === file.uid)
        if (!fileItem) return // 文件已被删除
        
        try {     
            // 对上传渠道为外链的，不修改链接
            const uploadChannel = fileItem.uploadChannel || this.effParams.uploadChannel
            if (uploadChannel !== 'external') {
                // 从response.data[0].src中去除/file/前缀
                // 后端 src 现在是「全站统一出口」的完整外链（可能带自定义域名），
                // 这里统一取出 File_ID；同时兼容旧的相对形态 /file/xxx
                const rawSrc = String(response.data[0].src || '')
                const srcID = (rawSrc.includes('/file/') ? rawSrc.split('/file/')[1] : rawSrc).replace(/^\/+/, '')
                // 全站统一出口（自定义访问域名优先）
                fileItem.url = fileLink(srcID)
                // 后端上传响应只回 { src, name }，用 name 推断扩展名补到外链末尾
                const metaForUrl = { FileName: (response.data[0] && response.data[0].name) || file.name }
                const urls = buildFileUrls(srcID, file.name, this.rootUrl, metaForUrl)
                Object.assign(fileItem, urls)
                fileItem.srcID = srcID
            }
            fileItem.progreess = 100
            fileItem.status = 'success'
            
            // Save to history
            this.saveToHistory(fileItem)

            this.$message({
                type: 'success',
                message: this.$t('uploadForm.uploadSuccess', { name: this.truncateFilename(file.name) })
            })
            setTimeout(() => {
                const item = this.fileList.find(item => item.uid === file.uid)
                if (item) item.status = 'done'
            }, 1000)
        } catch (error) {
            this.$message.error(this.$t('uploadForm.uploadFailed', { name: this.truncateFilename(file.name) }))
            fileItem.status = 'exception'
        }
        // 注意：并发控制的 onUploadComplete 已在各上传方法的 finally 中调用
    },
    saveToHistory(fileItem) {
        try {
            const history = JSON.parse(localStorage.getItem('uploadHistory') || '[]')
            const newRecord = {
                name: fileItem.name,
                url: fileItem.finalURL,
                time: Date.now(),
                type: fileItem.name.split('.').pop().toLowerCase()
            }
            history.push(newRecord)
            localStorage.setItem('uploadHistory', JSON.stringify(history))
        } catch (e) {
            console.error('Failed to save history', e)
        }
    },
    handleError(err, file) {
        const fileItem = this.fileList.find(item => item.uid === file.uid)
        if (!fileItem) return // 文件已被删除
        
        this.$message.error(this.$t('uploadForm.uploadFailed', { name: this.truncateFilename(file.name) }))
        fileItem.status = 'exception'

        // 不做逐文件定时重试：失败文件已经记进 exceptionList，
        // 等「这一波」上传全部结束后由 onUploadComplete → maybeStartRetryRound
        // 统一回到失败队列循环重试（这样才不会被某个文件的定时器打断后续文件）。
        // 注意：并发控制的 onUploadComplete 已在各上传方法的 finally 中调用
    },
    async handleCopy(file) {
        const status = this.fileList.find(item => item.uid === file.uid).status
        if (status !== 'done' && status !== 'success') {
            this.$message({ type: 'warning', message: this.$t('uploadForm.fileNotUploaded') })
            return
        }
        const ok = await copyText(getUrlByFormat(file, this.selectedUrlForm))
        this.$message({
            type: ok ? 'success' : 'warning',
            message: this.$t(ok ? 'uploadForm.copySuccess' : 'uploadForm.copyFailed')
        })
    },
    /**
     * 上传文件校验：后缀白名单 + 内容签名（magic bytes）双重校验。
     * 目的：拦住「改后缀绕过白名单」的文件（如 exe 改名成 .png）。
     * 返回 { ok, message }；签名无法判定时按「放行」处理，避免误伤新格式。
     */
    async checkFileAcceptable(file) {
        const name = file.name || ''
        const ext = (name.split('.').pop() || '').toLowerCase()
        if (!ext) {
            return { ok: false, message: `无法识别文件类型：${name}（缺少扩展名）` }
        }
        if (!this.allowedExtensions.includes(ext)) {
            return {
                ok: false,
                message: `不支持的格式 .${ext}，允许的格式：${this.allowedExtensions.join(' / ')}`
            }
        }
        const expected = await this.signatureMatches(file, ext)
        if (expected === false) {
            return { ok: false, message: `文件内容与扩展名不符（.${ext}），已拒绝上传：${name}` }
        }
        return { ok: true, message: '' }
    },

    /** 读取文件头并比对已知魔数；返回 true=匹配 / false=不匹配 / null=未知格式不判定 */
    async signatureMatches(file, ext) {
        let head
        try {
            head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
        } catch {
            return null
        }
        if (head.length < 4) return null
        const hex = Array.from(head).map((b) => b.toString(16).padStart(2, '0')).join('')
        const ascii = (s, e) => String.fromCharCode(...head.slice(s, e))
        const a4 = ascii(0, 4)
        const b4 = ascii(4, 8)

        switch (ext) {
            case 'jpg':
            case 'jpeg':
                return hex.startsWith('ffd8ff')
            case 'png':
                return hex.startsWith('89504e47')
            case 'gif':
                return a4 === 'GIF8'
            case 'webp':
                return a4 === 'RIFF' && ascii(8, 12) === 'WEBP'
            case 'bmp':
                return a4 === 'BM\x00\x00' || hex.startsWith('424d')
            case 'webm':
                return hex.startsWith('1a45dfa3')
            case 'ogg':
                return a4 === 'OggS'
            case 'mp4':
            case 'm4v':
            case 'm4a':
                return b4 === 'ftyp'
            case 'mov':
                return b4 === 'ftyp' || ['moov', 'mdat', 'free', 'wide'].includes(b4)
            case 'aac':
                return /^fff[019]/.test(hex)
            case 'mp3':
                return hex.startsWith('494433') || /^ff[ef][0-9a-f]/.test(hex)
            default:
                return null
        }
    },

    beforeUpload(file) {
        return new Promise(async (resolve, reject) => {
            let processedFile = file
            // 真正的「初始大小」：用户选中的原始文件字节数。
            // WebP 转换与本地压缩都会把体积改小，必须在最开始就记下来，
            // 否则文件详情里的「初始大小 / 当前大小」会显示成同一个值。
            const trueOriginalSize = file.size
            
            // WebP 转换：在压缩之前进行
            // 条件：1.开启WebP转换 2.文件类型为图片 3.不是WebP/GIF/SVG格式
            const canConvertToWebp = this.convertToWebp && 
                file.type.includes('image') && 
                !file.type.includes('webp') && 
                !file.type.includes('gif') && 
                !file.type.includes('svg')
            
            if (canConvertToWebp) {
                try {
                    const convertedFile = await this.convertImageToWebp(file)
                    if (convertedFile) {
                        processedFile = convertedFile
                        console.log(`WebP转换成功: ${file.name} -> ${convertedFile.name}, 大小: ${(file.size/1024).toFixed(1)}KB -> ${(convertedFile.size/1024).toFixed(1)}KB`)
                    }
                } catch (err) {
                    console.warn('WebP转换失败，使用原文件:', err)
                    // 转换失败，继续使用原文件
                }
            }
            
            // 客户端压缩条件：1.文件类型为图片 2.开启客户端压缩，且文件大小大于压缩阈值
            // 注意：GIF 动图不压缩（压缩会丢失动画）
            const isGif = processedFile.type === 'image/gif'
            const needCustomCompress = processedFile.type.includes('image') && !isGif && this.customerCompress && processedFile.size / 1024 / 1024 > this.compressBar

            // 扩展名白名单 + magic bytes 双重校验（先按最终文件校验）
            const extCheck = await this.checkFileAcceptable(processedFile)
            if (!extCheck.ok) {
                this.$message.error(extCheck.message)
                return reject(extCheck.message)
            }

            // 单文件上限（可在「系统设置 → 页面设置」调整）
            const MAX_UPLOAD_MB = this.maxUploadSizeMB
            const isLtLim = processedFile.size / 1024 / 1024 <= MAX_UPLOAD_MB

            const pushFileToQueue = (file, serverCompress, overrideOriginalSize) => {
                const fileUrl = URL.createObjectURL(file)
                const manual = !this.autoUpload
                this.fileList.push({
                    uid: file.uid,
                    name: file.uploadRelativePath || file.name,
                    // 保留原始 File 引用：手动上传模式改名/重传时需要
                    rawFile: file,
                    // 初始（压缩/转码前）字节数，供文件详情展示「初始大小 / 当前大小」
                    originalSize: overrideOriginalSize || trueOriginalSize || file.size,
                    url: fileUrl,
                    finalURL: '',
                    mdURL: '',
                    htmlURL: '',
                    ubbURL: '',
                    srcID: '',
                    status: manual ? 'waiting' : 'uploading',
                    editableName: manual,
                    progreess: 0,
                    serverCompress: serverCompress,
                    uploadFolder: file.uploadFolder ?? this.uploadFolder,
                    retryCount: 0,
                })
                resolve(file)
            }

            if (needCustomCompress) {
                // 压缩期望值 = 原体积 × 压缩百分比（例如原图 1MB、80% → 目标 800KB）
                const pct = Math.min(100, Math.max(10, Number(this.compressPercent) || 80))
                const targetKB = Math.max(1, Math.round((processedFile.size / 1024) * (pct / 100)))
                // 尝试压缩图片
                imageConversion.compressAccurately(processedFile, targetKB).then((res) => {
                    if (res.size / 1024 / 1024 > MAX_UPLOAD_MB) {
                        this.$message.error(this.$t('uploadForm.compressedFileTooLarge', { name: processedFile.name }))
                        reject(this.$t('uploadForm.fileSizeTooLarge'))
                        return
                    }
                    this.uploading = true
                    // 压缩后仍比原图大时保留原图（避免「压不动」反而变大）
                    const compressed = res.size < processedFile.size
                    const source = compressed ? res : processedFile

                    /* ── 「开启图片压缩后上传失败」的根因就在这里 ─────────────────────
                     * image-conversion 的 compressAccurately() 内部固定用
                     * canvas.toDataURL('image/jpeg') 输出，**产出的字节永远是 JPEG**；
                     * 但它返回的 Blob 的 type 却仍标成原图 MIME，文件名也还是原名
                     * （如 photo.png）。
                     * 结果：上传时 multipart 文件名=photo.png、内容却是 ffd8ff...，
                     * 后端魔数校验 signatureOk() 判定「内容与扩展名不符」直接拒收 →
                     * 表现为「开了压缩就传不上去，关了压缩就正常」。
                     * 修复：按产物的真实内容把扩展名改成 .jpg（type 同步纠正）。
                     * ──────────────────────────────────────────────────────────── */
                    let finalFile = processedFile
                    if (compressed) {
                        const base = String(processedFile.name).replace(/\.[^.]+$/, '') || 'image'
                        const jpegName = `${base}.jpg`
                        const asJpeg = new File([source], jpegName, { type: 'image/jpeg' })
                        // .jpg 不在允许列表时（极少见）放弃压缩，直接传原图，避免被拒
                        if (this.allowedExtensions.includes('jpg')) {
                            finalFile = asJpeg
                        }
                    }
                    finalFile.uid = file.uid
                    this.copyUploadPath(processedFile, finalFile)
                    // 扩展名可能被改成 .jpg，同步修正相对路径，保证落库文件名与内容一致
                    if (finalFile !== processedFile) {
                        finalFile.uploadRelativePath = String(finalFile.name).replace(/\\/g, '/').replace(/^\/+/, '')
                        finalFile.uploadFolder = joinUploadFolder(
                            this.uploadFolder,
                            getRelativeDirectory(finalFile.uploadRelativePath)
                        )
                    }

                    // 服务端压缩已按方案裁剪，统一不做服务端转码
                    pushFileToQueue(finalFile, false, trueOriginalSize)
                }).catch((err) => {
                    // 压缩失败不应阻断上传：直接上传原图（修复「图片压缩导致上传失败」）
                    console.warn('本地压缩失败，改为上传原图:', err)
                    this.uploading = true
                    pushFileToQueue(processedFile, false, trueOriginalSize)
                })
            } else if (isLtLim) {
                this.uploading = true
                pushFileToQueue(processedFile, false, trueOriginalSize)
            } else {
                // 超出上限：引导使用对象存储渠道
                this.$message.error(`${processedFile.name} 超过 ${MAX_UPLOAD_MB}MB 上限，请改用「腾讯云 COS / MinIO / S3 兼容存储 / R2」等对象存储渠道上传`)
                reject(this.$t('uploadForm.fileSizeTooLarge'))
            }
        })
    },
    handleProgress(event) {
        const fileItem = this.fileList.find(item => item.uid === event.file.uid)
        if (fileItem) {
            fileItem.progreess = event.percent
        }
    },
    async copyAll(format = this.selectedUrlForm) {
        const urls = this.fileList
            .filter(item => item.status === 'done' || item.status === 'success')
            .map(item => getUrlByFormat(item, format))
            .join('\n')
        const ok = await copyText(urls)
        this.$message({
            type: ok ? 'success' : 'warning',
            message: this.$t(ok ? 'uploadForm.copyAllSuccess' : 'uploadForm.copyFailed')
        })
    },
    clearFileList() {
        if (this.fileList.length > 0) {
            // 取消所有正在上传的文件
            this.abortControllers.forEach((controller, uid) => {
                controller.abort()
            })
            this.abortControllers.clear()
            // 停止失败重试循环（定时器 + 失败队列）
            if (this.roundTimer) {
                clearTimeout(this.roundTimer)
                this.roundTimer = null
            }
            this.retryLoopActive = false
            this.retryRound = 0
            this.exceptionList = []
            // 清空上传队列
            this.uploadQueue = []
            // 清空文件列表
            this.fileList = []
            this.$message({
                type: 'success',
                message: this.$t('uploadForm.fileListCleared')
            })
        } else {
            this.$message({
                type: 'info',
                message: this.$t('uploadForm.fileListEmpty')
            })
        }
    },
    clearSuccessList() {
        if (this.uploadSuccessCount > 0) {
            this.fileList = this.fileList.filter(item => item.status !== 'done' && item.status !== 'success')
            this.$message({
                type: 'success',
                message: this.$t('uploadForm.successFilesCleared')
            })
        } else {
            this.$message({
                type: 'info',
                message: this.$t('uploadForm.successFilesEmpty')
            })
        }
    },
    isEditablePasteTarget(target) {
        const element = target?.nodeType === Node.TEXT_NODE ? target.parentElement : target
        if (!element) return false

        const tagName = element.tagName
        return tagName === 'INPUT'
            || tagName === 'TEXTAREA'
            || element.isContentEditable
            || Boolean(element.closest?.('[contenteditable="true"]'))
    },
    handlePasteShortcut(event) {
        const isPasteShortcut = (event.ctrlKey || event.metaKey)
            && !event.altKey
            && String(event.key).toLowerCase() === 'v'
        if (!isPasteShortcut || this.isEditablePasteTarget(event.target)) return

        const receiver = this.$refs.clipboardPasteReceiver
        if (!receiver) return

        this.pasteFocusTarget = document.activeElement
        receiver.value = ''
        try {
            receiver.focus({ preventScroll: true })
        } catch {
            receiver.focus()
        }
    },
    releasePasteReceiver(target) {
        const receiver = this.$refs.clipboardPasteReceiver
        if (!receiver || target !== receiver) return

        receiver.value = ''
        const focusTarget = this.pasteFocusTarget
        this.pasteFocusTarget = null
        setTimeout(() => {
            if (focusTarget?.isConnected && typeof focusTarget.focus === 'function') {
                try {
                    focusTarget.focus({ preventScroll: true })
                } catch {
                    focusTarget.focus()
                }
            } else {
                receiver.blur()
            }
            if (document.activeElement === receiver) receiver.blur()
        }, 0)
    },
    async handlePaste(event) {
        // 当粘贴位置是文本框时，不执行该操作
        const isPasteReceiver = event.target === this.$refs.clipboardPasteReceiver
        if (!isPasteReceiver && this.isEditablePasteTarget(event.target)) {
            return
        }
        const clipboardData = event.clipboardData
        if (!clipboardData) {
            this.releasePasteReceiver(event.target)
            return
        }

        const items = Array.from(clipboardData.items || [])
        const fileItems = items.filter(item => item.kind === 'file')
        const stringItems = items.filter(item => item.kind === 'string')
        const fileEntries = filesToUploadEntries(clipboardData.files || [])

        if (isPasteReceiver) event.preventDefault()
        this.releasePasteReceiver(event.target)

        if (fileEntries.length > 0 || fileItems.length > 0) {
            event.preventDefault()
            let entries = []
            if (fileItems.length) {
                try {
                    entries = await collectFilesFromDataTransferItems(fileItems)
                } catch (error) {
                    console.warn('Failed to parse clipboard items, falling back to clipboard files:', error)
                }
            }
            // Safari may expose file items without supporting their entry APIs.
            if (!entries.length) entries = fileEntries
            if (entries.length) await this.uploadLocalEntries(entries)
        }

        if (stringItems.length > 0) this.uploadFromUrl(stringItems)
    },
    handleUploadPasteUrls() {
        // 用于上传在上传文本框中粘贴的外链
        const urls = this.pastedUrls.split('\n');
        // 处理空行和首尾空字符，链接须符合URL规范
        const validUrls = urls.map(url => url.trim()).
            filter(url => url !== '').
            filter(url => /^(https?:\/\/[^\s$.?#].[^\s]*)$/.test(url));

        // 根据粘贴上传方式进行上传
        if (this.pasteUploadMethod === 'save') {
            // 正常上传
            this.uploadFromUrl(validUrls.map(url => {
                return {
                    kind: 'string',
                    getAsString: (callback) => {
                        callback(url);
                    }
                }
            }));
        } else if (this.pasteUploadMethod === 'external') {
            // 仅保存外链，使用 external 渠道上传
            for (let i = 0; i < validUrls.length; i++) {
                const url = validUrls[i];
                const fileName = url.split('/').pop();
                const mdUrl = `![${fileName}](${url})`;
                const htmlUrl = `<img src="${url}" alt="${fileName}" />`;
                const ubbUrl = `[img]${url}[/img]`;
                // 将 url 作为文件内容，文件名为 URL 的最后一部分
                const file = new File([], url.split('/').pop(), { type: 'text/plain' });
                file.uid = Date.now() + i;
                file.url = url;
                this.fileList.push({
                    uid: file.uid,
                    name: file.name,
                    url: url,
                    finalURL: url,
                    mdURL: mdUrl,
                    htmlURL: htmlUrl,
                    ubbURL: ubbUrl,
                    srcID: url,
                    status: 'uploading',
                    progreess: 0,
                    serverCompress: false,
                    uploadChannel: 'external',
                    retryCount: 0,
                });
                // 上传
                this.uploadFile({ file: file, 
                    onProgress: (evt) => this.handleProgress(evt), 
                    onSuccess: (response, file) => this.handleSuccess(response, file), 
                    onError: (error, file) => this.handleError(error, file) });
            }
        }
    },
    uploadFromUrl(items) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'string') {
                items[i].getAsString((text) => {
                    const urlPattern = /^(https?:\/\/[^\s$.?#].[^\s]*)$/;
                    let fileName = '';
                    if (urlPattern.test(text)) {
                        axios.post('/api/fetchRes', { url: text }, {
                            responseType: 'blob',
                            withAuthCode: true
                        }).then(response => {
                            const contentType = response.headers['content-type'];
                            // 兼容 200/201：NestJS 的 POST 默认返回 201，判定过窄会误报「URL地址请求失败」
                            if (response.status === 200 || response.status === 201) {
                                // 提取文件名
                                const disposition = response.headers['content-disposition'];
                                if (disposition) {
                                    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                                    const filenameStarRegex = /filename\*\s*=\s*UTF-8''([^;\n]*)/; // 处理 filename*

                                    let matches = filenameRegex.exec(disposition);
                                    if (matches != null && matches[1]) {
                                        fileName = matches[1].replace(/['"]/g, '');
                                        // 尝试解码
                                        try {
                                            fileName = decodeURIComponent(fileName);
                                        } catch (e) {
                                            fileName = '';
                                        }
                                    } 
                                    if (fileName === '') {
                                        matches = filenameStarRegex.exec(disposition); // 尝试匹配 filename*
                                        if (matches != null && matches[1]) {
                                            fileName = decodeURIComponent(matches[1]);
                                        }
                                    }
                                }
                                // 尝试从URL中提取文件名
                                if (fileName === '') {
                                    const url = new URL(text);
                                    fileName = url.pathname.split('/').pop();
                                }
                                // 未提取到文件名，使用默认文件名
                                if (fileName === '') {
                                    // 获取文件后缀
                                    const url = new URL(text);
                                    let extension = url.pathname.split('.').pop();
                                    // 未能从URL提取有效后缀，使用bin作为默认后缀
                                    if (!extension || extension === '' || extension.length > 10) {
                                        extension = 'bin';
                                    }
                                    fileName = 'PastedFile' + Date.now() + i + '.' + extension;
                                }
                                
                                // 读取文件内容
                                const blob = response.data;
                                const file = new File([blob], fileName, { type: blob.type });
                                file.uid = Date.now() + i;
                                // 接收beforeUpload的Promise对象
                                const checkResult = this.beforeUpload(file);
                                if (checkResult instanceof Promise) {
                                    checkResult.then((newFile) => {
                                        if (newFile instanceof File) {
                                            this.uploadFile({ file: newFile, 
                                                onProgress: (evt) => this.handleProgress(evt), 
                                                onSuccess: (response, file) => this.handleSuccess(response, file), 
                                                onError: (error, file) => this.handleError(error, file) });
                                        }
                                    }).catch((err) => {
                                        console.log(err);
                                    });
                                }
                            } else {
                                throw new Error(`HTTP ${response.status}`);
                            }
                        })
                        .catch(async (error) => {
                            // 失败时后端返回的是 JSON 错误体；响应类型为 blob，需先解出文本再提示
                            let detail = error?.response?.status ? `HTTP ${error.response.status}` : (error?.message || '');
                            const data = error?.response?.data;
                            if (data instanceof Blob) {
                                try {
                                    const j = JSON.parse(await data.text());
                                    if (j && j.message) detail = j.message;
                                } catch (e) {
                                    /* 非 JSON 响应体，保持原提示 */
                                }
                            }
                            this.$message({
                                type: 'warning',
                                message: detail
                                    ? `${this.$t('uploadForm.urlRequestFailed')}：${detail}`
                                    : this.$t('uploadForm.urlRequestFailed')
                            });
                        });
                    }
                });
            }
        }
    },
    handleScroll(event) {
        this.listScrolled = event.scrollTop > 0 && this.fileList.length > 0
    },
    retryError() {
        if (!this.exceptionList.length) {
            this.$message({
                type: 'info',
                message: this.$t('uploadForm.noFailedFiles')
            })
            return
        }
        // 手动重试：取消已排定的自动轮次，立刻用最新上传参数重来一轮
        if (this.roundTimer) {
            clearTimeout(this.roundTimer)
            this.roundTimer = null
        }
        this.retryRound = 0
        this.refreshUploadParams().finally(() => this.startRetryRound())
    },
    handleAutoRetryChange(val) {
        this.$message({
            type: val ? 'success' : 'info',
            message: val ? this.$t('uploadForm.autoRetryOn') : this.$t('uploadForm.autoRetryOff')
        });
        
        if (val) {
            // 打开开关时，如果已经有失败文件就立刻开始循环重试
            if (this.exceptionList.length > 0) this.maybeStartRetryRound()
        } else {
            // 关闭开关：停掉已排定的下一轮
            if (this.roundTimer) {
                clearTimeout(this.roundTimer)
                this.roundTimer = null
            }
            this.retryLoopActive = false
        }
    },
    // 将图片转换为 WebP 格式
    async convertImageToWebp(file) {
        return new Promise((resolve, reject) => {
            // 不支持转换的格式直接返回 null
            if (file.type.includes('gif') || file.type.includes('svg') || file.type.includes('webp')) {
                resolve(null)
                return
            }
            
            const img = new Image()
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            
            img.onload = () => {
                canvas.width = img.width
                canvas.height = img.height
                ctx.drawImage(img, 0, 0)
                
                canvas.toBlob((blob) => {
                    if (blob) {
                        // 修改文件名：将原扩展名替换为 .webp
                        const originalName = file.name
                        const lastDotIndex = originalName.lastIndexOf('.')
                        const newName = lastDotIndex > 0 
                            ? originalName.substring(0, lastDotIndex) + '.webp'
                            : originalName + '.webp'
                        
                        const webpFile = new File([blob], newName, { type: 'image/webp' })
                        webpFile.uid = file.uid
                        this.copyUploadPath(file, webpFile)
                        resolve(webpFile)
                    } else {
                        reject(new Error('WebP 转换失败'))
                    }
                    
                    // 清理
                    URL.revokeObjectURL(img.src)
                }, 'image/webp', 0.92) // 0.92 质量参数，平衡质量和大小
            }
            
            img.onerror = () => {
                URL.revokeObjectURL(img.src)
                reject(new Error(this.$t('uploadForm.imageLoadFailed')))
            }
            
            img.src = URL.createObjectURL(file)
        })
    },
    // 拖拽上传卡片鼠标移动事件 - 悬浮光斑效果
    handleUploadCardMouseMove(e) {
        const glow = this.$refs.uploadCardGlow;
        if (!glow) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        glow.style.opacity = '1';
        glow.style.left = x + 'px';
        glow.style.top = y + 'px';
    },
    // 拖拽上传卡片鼠标离开事件
    handleUploadCardMouseLeave() {
        const glow = this.$refs.uploadCardGlow;
        if (!glow) return;
        glow.style.opacity = '0';
    },
},
beforeDestroy() {
    // 清理定时器
    if (this.retryTimer) {
        clearTimeout(this.retryTimer);
    }
    if (this.roundTimer) {
        clearTimeout(this.roundTimer);
    }
}
}
</script>

<style scoped> 
@property --border-angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
}

@keyframes borderRotate {
    0% {
        --border-angle: 0deg;
    }
    100% {
        --border-angle: 360deg;
    }
}
.upload-form {
    --upload-card-height: 45vh;
    --upload-card-busy-height: 17vh;
    --upload-list-height: 7vh;
    --upload-list-inner-height: var(--upload-list-height);
    /* 列表区封顶高度（滚动阈值）：默认 58vh 兜底；
       JS 会按「头部 + 3 个条目」实测后覆盖（--upload-list-max-h），
       JS 完全失效时也只影响封顶精确度，不影响内容可见（height:auto 由内容撑开）。 */
    --upload-list-max-h: 58vh;
    /* 收缩态铺满视口时，顶部（Logo / 标题 / 默认·链接标签页）与底部页脚的预留高度。
       调大 = 列表区整体变矮、离页脚更远；调小 = 列表区更高、更贴近页脚。 */
    --upload-home-reserved: 200px;
    --upload-list-gap: 10px;
    --upload-list-radius: 15px;
    --upload-card-vertical-padding: 40px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    height: calc(var(--upload-card-height) + var(--upload-list-height) + var(--upload-list-gap) + var(--upload-card-vertical-padding));
}
/* 有文件（列表展开）：外层不再用视口高度硬撑，改由内容自然撑开。
   （v2.0.0：不再用 :has() —— 部分浏览器不支持导致 PC 端列表区被裁；
   改为组件根 class 绑定，所有浏览器行为一致。） */
.upload-form.upload-form-busy {
    height: auto;
}
/* 列表卡片：高度 = 内容自适应；滚动条由内部 el-scrollbar 的 max-height 触发 */
.upload-list-card.upload-list-busy {
    flex: 0 0 auto;
    height: auto;
    min-height: var(--upload-list-height);
}
.upload-list-card {
    width: 55vw;
    height: var(--upload-list-height);
    margin-top: var(--upload-list-gap);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: var(--upload-list-radius);
    background-color: var(--glass-bg) !important;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow) !important;
    transition: height 0.3s ease;
    overflow: hidden;
}

/* 默认模式底部操作行（自动上传开关 / 手动上传按钮）：
   与「链接」模式的 paste-card-actions 同构 —— 位于虚线卡片内部底部，
   开关在右下角（转存/外链 的方位），手动上传按钮在左下角（上传 的方位）。
   position+z-index：保证操作行永远压在拖拽区之上 —— 列表区有文件、卡片收缩时
   拖拽区的内容可能外溢，不能让它盖住按钮把点击吞掉（点了变成弹文件选择框）。 */
.default-upload-actions {
    position: relative;
    z-index: 5;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    width: 50vw;
    max-width: 100%;
    box-sizing: border-box;
    margin-top: 16px;
}
/* 手动上传按钮：对齐链接模式左下角的「上传」按钮（右侧留给自动上传开关） */
.default-upload-actions .manual-upload-button {
    margin-right: auto;
    height: 38px;
    min-width: 92px;
    padding: 0 18px;
    border-radius: 10px !important;
    font-size: 14px;
    font-weight: 600;
}
.default-upload-actions .manual-upload-icon {
    margin-right: 6px;
}
/* 自动上传开关：套一层与 转存/外链 分段控件同款的玻璃胶囊，视觉方位一致 */
.default-upload-switch {
    height: 38px;
    box-sizing: border-box;
    padding: 3px 12px 3px 14px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
}
/* 开关只保留右侧单一文案（开启/关闭都显示「自动」） */
.auto-upload-switch-label {
    font-size: 13px;
    line-height: 1;
    color: var(--text-color-secondary, #666);
    white-space: nowrap;
    /* 文案本身也是开关热区（点击可切换），必须给出手型光标 */
    cursor: pointer;
    user-select: none;
}
/* 有文件（列表展开）时整体收缩，操作行间距同步压缩（与 paste-card-actions 的 busy 态一致） */
.upload-card-busy .default-upload-actions {
    margin-top: 10px;
    gap: 10px;
}
.upload-card-busy .default-upload-actions .manual-upload-button,
.upload-card-busy .default-upload-switch {
    height: 32px;
}
@media (max-width: 768px) {
    .default-upload-actions {
        margin-top: 6px;
        gap: 8px;
    }
    .default-upload-actions .manual-upload-button {
        height: 30px;
        min-width: 60px;
        padding: 0 12px;
        font-size: 12px;
        border-radius: 8px !important;
    }
    .default-upload-switch {
        height: 30px;
        padding: 2px 10px 2px 12px;
    }
    .default-upload-switch :deep(.el-switch__label) {
        font-size: 12px;
    }
}
.upload-list-card :deep(.el-card__body) {
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
}
.upload-list-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
}
@media (max-width: 768px) {
    .upload-list-card {
        width: 70vw;
    }
}
.upload-list-card.upload-list-busy {
    height: auto;
}

/* busy 态滚动控制：内容 ≤ 封顶值时卡片由内容撑开（自适应）；
   超过封顶值（≈3 个条目）时 el-scrollbar 内部出滚动条。
   max-height 挂在 wrap 上 —— el-scrollbar 的 height:100% 在 height:auto 父级里
   无法建立滚动约束，必须直接约束 wrap。 */
.upload-form .upload-list-card.upload-list-busy :deep(.el-scrollbar) {
    height: auto;
}
.upload-form .upload-list-card.upload-list-busy :deep(.el-scrollbar__wrap) {
    max-height: var(--upload-list-max-h);
}

.upload-list-card:not(.upload-list-busy) :deep(.el-scrollbar__view) {
    height: 100%;
}

/* 拖拽上传卡片包装器 - 用于悬浮光斑效果 */
.upload-card-wrapper {
    position: relative;
    overflow: visible;
}

.folder-upload-input {
    display: none;
}

.clipboard-paste-receiver {
    position: fixed;
    top: 0;
    left: -9999px;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
}

.upload-prompt-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    max-width: calc(100% - 24px);
    min-width: 0;
}

.folder-upload-icon-button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    box-sizing: border-box;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-secondary);
    line-height: 1;
    cursor: pointer;
    transition: color 0.2s ease, background-color 0.2s ease;
}

.folder-upload-icon-button :deep(svg) {
    display: block;
    width: 15px;
    height: 15px;
    transform: translateY(1px);
}

.folder-upload-icon-button:hover {
    color: var(--primary-color-accent);
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}

.folder-upload-icon-button:focus-visible {
    outline: none;
    color: var(--primary-color-accent);
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}

.folder-upload-icon-button.upload-list-busy {
    width: 24px;
    height: 24px;
    border-radius: 7px;
}

.folder-upload-icon-button.upload-list-busy :deep(svg) {
    width: 13px;
    height: 13px;
}

@media (max-width: 768px) {
    .upload-prompt-row {
        gap: 2px;
        max-width: calc(100% - 12px);
    }

    .folder-upload-icon-button {
        width: 22px;
        height: 22px;
        border-radius: 6px;
    }

    .folder-upload-icon-button.upload-list-busy {
        width: 20px;
        height: 20px;
    }

    .folder-upload-icon-button :deep(svg) {
        width: 12px;
        height: 12px;
        transform: none;
    }

    .folder-upload-icon-button.upload-list-busy :deep(svg) {
        width: 11px;
        height: 11px;
    }
}

/* 悬浮光斑效果 */
.upload-card-glow {
    position: absolute;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    background: var(--upload-card-hover-glow-bg);
    pointer-events: none;
    transform: translate(-50%, -50%);
    opacity: 0;
    transition: opacity 0.3s ease;
    z-index: 10;
}

.upload-card {
    width: 55vw;
    padding: 20px;
    background: none;
}
@media (max-width: 768px) {
    .upload-card {
        width: 70vw;
    }
}
/* ============================================================
   默认模式：尺寸 / 定位 / 距离 完全照抄「链接」模式
   ─ 外层 .upload-card      ↔ 链接模式外层大框（55vw + 20px 内边距）
   ─ 内层 .default-card      ↔ .paste-card（45vh 虚线卡片・glass 底）
   ─ .default-upload-dragger ↔ .upload-card-textarea（50vw × 70%，busy 收缩 50%）
   ─ .default-upload-actions ↔ .paste-card-actions（margin-top 16px，右下角方位）
   两种模式的内容组（70% 输入/拖拽区 + 16px 间距 + 操作行）结构逐项相同，
   均由卡片 justify-content:center 垂直居中，因此高度、比例、间距、方位完全一致。
   ============================================================ */
.default-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: var(--upload-card-height);
    border-radius: 15px;
    border: var(--el-upload-dragger-border);
    box-shadow: none;
    opacity: 0.7;
    background-color: var(--el-upload-dragger-bg-color);
    transition: all 0.3s ease;
    box-sizing: border-box;
    position: relative;
}
.default-card:hover {
    opacity: 0.8;
    box-shadow: var(--el-upload-dragger-hover-box-shadow);
}
/* 有文件（列表展开）时卡片整体收缩，与链接模式的 .upload-card-busy.paste-card 对齐 */
.upload-card-busy.default-card {
    height: var(--upload-card-busy-height);
}

/* 上传时的边缘流光旋转效果（与 .paste-card.is-uploading 完全一致） */
.default-card.is-uploading {
    border-color: transparent !important;
    overflow: visible;
}
.default-card.is-uploading::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 15px;
    padding: 2px;
    background: conic-gradient(
        from var(--border-angle),
        transparent 0deg,
        transparent 30deg,
        var(--upload-card-effect-color, #2563EB) 60deg,
        var(--upload-card-effect-highlight-color, color-mix(in srgb, var(--upload-card-effect-color, #2563EB) 70%, white)) 90deg,
        transparent 120deg,
        transparent 180deg,
        var(--upload-card-effect-highlight-color, color-mix(in srgb, var(--upload-card-effect-color, #2563EB) 70%, white)) 210deg,
        var(--upload-card-effect-color, #2563EB) 240deg,
        transparent 270deg,
        transparent 360deg
    );
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: exclude;
    animation: borderRotate 2s linear infinite;
    pointer-events: none;
    z-index: 1;
}

/* el-upload 根节点：与链接模式的 .upload-card-textarea 完全同构 ——
   固定占卡片高度的 70%（busy 收缩态 50%），随内容组一起被 .default-card 的
   justify-content:center 垂直居中。不再用 flex:1 撑满剩余空间：
   之前拖拽区「70% × 剩余空间」导致它比链接模式输入框矮一截，
   且与底部操作行之间多出一段空白、收缩时内容外溢盖住按钮。
   min-height:0 + overflow:hidden 把拖拽区外溢内容裁在自身区域内。 */
.default-upload-dragger {
    flex: 0 0 auto;
    height: 70%;
    min-height: 0;
    width: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
}
/* 有文件（列表展开）时收缩到 50%，与 .upload-card-busy .upload-card-textarea 一致 */
.upload-card-busy .default-upload-dragger {
    height: 50%;
}
/* 收缩态隐去左右边框：卡片压矮后拖拽区两侧只剩两条竖线，视觉上很突兀（上下边框本就不可见）。
   hover 规则会重设 border-color，这里用更具体的选择器一并压住，避免鼠标经过时又冒出来。 */
.upload-card-busy .default-upload-dragger :deep(.el-upload-dragger),
.upload-card-busy .default-upload-dragger :deep(.el-upload-dragger:hover) {
    border-left-color: transparent;
    border-right-color: transparent;
}
/* 拖拽区本体：尺寸 / 圆角 / 底色对齐链接模式的输入框（宽度沿用原写法 50vw） */
:deep(.el-upload-dragger)  {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    width: 50vw;
    height: 100%;
    border-radius: 16px;
    background: color-mix(in srgb, var(--primary-color) 4%, var(--glass-bg));
    border: 1px solid var(--glass-border);
    box-shadow: none;
    box-sizing: border-box;
    overflow: hidden;
    transition: height 0.3s ease, background-color 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}
/* 悬停 / 拖入高亮只调边框与底色，不再改透明度 —— 透明度由外层 .default-card 统一控制 */
:deep(.el-upload-dragger:hover) {
    background: color-mix(in srgb, var(--primary-color) 6%, var(--glass-bg));
    border-color: var(--glass-border-hover);
    box-shadow: none;
}
:deep(.el-upload-dragger.is-dragover) {
    background: color-mix(in srgb, var(--primary-color) 7%, var(--glass-bg));
    border-color: color-mix(in srgb, var(--primary-color) 45%, var(--glass-border));
    box-shadow: none;
}
.is-uploading :deep(.el-upload-dragger) {
    border-color: transparent !important;
}

.el-upload__text {
    font-weight: bold;
    font-size: medium;
    user-select: none;
    transition: all 0.3s ease;
}
.el-upload__text.upload-list-busy {
    font-size: small;
}
@media (max-width: 768px) {
    .el-upload__text,
    .el-upload__text.upload-list-busy {
        font-size: 12px;
    }
}
.el-icon--upload {
    font-size: 100px;
    transition: font-size 0.3s ease;
    color: #60A5FA;
}
html.dark .el-icon--upload {
    color: #6B6B73;
}
.el-upload__text :deep(em) {
    color: #1D4ED8;
}
html.dark .el-upload__text :deep(em) {
    color: #93C5FD;
}
/* 收缩态（列表有文件）隐藏 "+"：卡片只剩一半高，"+" 挤在里面显得溢出；
   展开时正常显示，与链接模式收缩态只有小号输入框的观感一致 */
.el-icon--upload.upload-list-busy {
    display: none;
}
@media (max-width: 768px) {
    .el-icon--upload {
        font-size: 50px;
    }
}

.paste-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: var(--upload-card-height);
    border-radius: 15px;
    border: var(--el-upload-dragger-border);
    box-shadow: none;
    opacity: 0.7;
    background-color: var(--el-upload-dragger-bg-color);
    transition: all 0.3s ease;
    box-sizing: border-box;
}
.paste-card:hover {
    opacity: 0.8;
    box-shadow: var(--el-upload-dragger-hover-box-shadow);
}

/* 粘贴卡片上传时的边缘流光效果 */
.paste-card.is-uploading {
    position: relative;
    border-color: transparent !important;
    overflow: visible;
}

.paste-card.is-uploading::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 15px;
    padding: 2px;
    background: conic-gradient(
        from var(--border-angle),
        transparent 0deg,
        transparent 30deg,
        var(--upload-card-effect-color, #2563EB) 60deg,
        var(--upload-card-effect-highlight-color, color-mix(in srgb, var(--upload-card-effect-color, #2563EB) 70%, white)) 90deg,
        transparent 120deg,
        transparent 180deg,
        var(--upload-card-effect-highlight-color, color-mix(in srgb, var(--upload-card-effect-color, #2563EB) 70%, white)) 210deg,
        var(--upload-card-effect-color, #2563EB) 240deg,
        transparent 270deg,
        transparent 360deg
    );
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: exclude;
    animation: borderRotate 2s linear infinite;
    pointer-events: none;
    z-index: 1;
}

.paste-card :deep(.el-card__body) {
    padding: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}
.upload-card-busy.paste-card {
    height: var(--upload-card-busy-height);
}
.upload-card-textarea {
    width: 50vw;
    height: 70%;
    border-radius: 16px;
    background: color-mix(in srgb, var(--primary-color) 4%, var(--glass-bg));
    border: 1px solid var(--glass-border);
    box-shadow: none;
    transition: background-color 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
    box-sizing: border-box;
    display: flex;
    position: relative;
    overflow: hidden;
}
.upload-card-busy .upload-card-textarea {
    height: 50%;
}

.upload-card-textarea:hover {
    background: color-mix(in srgb, var(--primary-color) 6%, var(--glass-bg));
    border-color: var(--glass-border-hover);
}

.upload-card-textarea:focus-within {
    background: color-mix(in srgb, var(--primary-color) 7%, var(--glass-bg));
    border-color: color-mix(in srgb, var(--primary-color) 45%, var(--glass-border));
    box-shadow: none;
}

.upload-card-textarea :deep(.el-textarea__inner) {
    border-radius: 16px;
    background: transparent;
    transition: color 0.2s ease, background-color 0.2s ease;
    resize: none;
    border: none;
    box-shadow: none !important;
    padding: 16px 20px;
    font-size: 14px;
    line-height: 1.6;
    color: var(--el-text-color-primary);
}

.upload-card-textarea :deep(.el-textarea__inner::placeholder) {
    color: var(--el-text-color-placeholder);
    font-weight: 400;
    opacity: 0.7;
}

.upload-card-textarea :deep(.el-textarea__inner:focus) {
    background: transparent;
    box-shadow: none !important;
}

/* Modern Scrollbar Styles */
.upload-card-textarea ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

.upload-card-textarea ::-webkit-scrollbar-track {
    background: transparent;
    border-radius: 6px;
    margin: 8px;
}

.upload-card-textarea ::-webkit-scrollbar-thumb {
    background: rgba(37, 99, 235, 0.5);
    border-radius: 6px;
    transition: background 0.3s ease;
}

.upload-card-textarea ::-webkit-scrollbar-thumb:hover {
    background: rgba(37, 99, 235, 0.7);
}
.paste-card-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: nowrap;
    width: 50vw;
    max-width: 100%;
    box-sizing: border-box;
    gap: 12px;
    margin-top: 16px;
}

/* 粘贴上传操作区：延续全站克制的主题按钮风格 */
.paste-card-upload-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: 92px;
    height: 38px;
    padding: 0 18px;
    border-radius: 10px !important;
    font-weight: 600;
    font-size: 14px;
    line-height: 1;
    letter-spacing: 0.04em;
    white-space: nowrap;
    cursor: pointer;
    color: var(--primary-color-accent, var(--el-color-primary)) !important;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 10%, transparent) !important;
    border: 1px solid color-mix(in srgb, var(--primary-color, #2563EB) 36%, var(--glass-border, rgba(128, 128, 128, 0.25))) !important;
    box-shadow: none;
    transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease !important;
}

.paste-card-upload-button:hover {
    color: var(--primary-color-accent, var(--el-color-primary)) !important;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 14%, transparent) !important;
    border-color: color-mix(in srgb, var(--primary-color, #2563EB) 52%, var(--glass-border, rgba(128, 128, 128, 0.25))) !important;
    transform: translateY(-1px);
    box-shadow: none;
}

.paste-card-upload-button:focus-visible {
    color: var(--primary-color-accent, var(--el-color-primary)) !important;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 14%, transparent) !important;
    border-color: color-mix(in srgb, var(--primary-color, #2563EB) 52%, var(--glass-border, rgba(128, 128, 128, 0.25))) !important;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color, #2563EB) 14%, transparent) !important;
}

.paste-card-upload-button:active {
    transform: translateY(0);
    background: color-mix(in srgb, var(--primary-color, #2563EB) 18%, transparent) !important;
}

.paste-card-upload-button.is-disabled,
.paste-card-upload-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none !important;
}

/* 上传状态下缩小按钮 */
.upload-card-busy .paste-card-upload-button {
    min-width: 72px;
    height: 32px;
    border-radius: 8px !important;
    font-size: 13px;
    letter-spacing: 0.02em;
}

.upload-card-busy .paste-card-actions {
    margin-top: 10px;
}

/* 转存 / 外链分段选择 */
.paste-card-method-group {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    width: 158px;
    height: 38px;
    box-sizing: border-box;
    gap: 2px;
    padding: 3px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    overflow: hidden;
    user-select: none;
}

.paste-card-method-group::before {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: calc((100% - 8px) / 2);
    height: calc(100% - 6px);
    border-radius: 7px;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 14%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color, #2563EB) 42%, var(--glass-border, rgba(128, 128, 128, 0.25))) inset;
    transform: translateX(0);
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
}

.paste-card-method-group.is-external::before {
    transform: translateX(calc(100% + 2px));
}

.paste-card-method-button {
    position: relative;
    z-index: 1;
    display: inline-flex;
    flex: 1 1 0;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: 30px;
    box-sizing: border-box;
    padding: 0 14px;
    margin: 0;
    border: none;
    border-radius: 7px;
    outline: none;
    background: transparent;
    font-family: inherit;
    font-weight: 500;
    font-size: 13px;
    line-height: 1;
    white-space: nowrap;
    color: var(--el-text-color-secondary, var(--upload-text-color, #6b7280));
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    /* 三按钮（上传 / 转存 / 外链）统一动效：颜色、位移、底色、焦点环都参与过渡 */
    transition:
        color 0.2s ease,
        background-color 0.2s ease,
        transform 0.18s cubic-bezier(0.4, 0, 0.2, 1),
        box-shadow 0.2s ease;
}

.paste-card-method-button:hover {
    color: var(--primary-color-accent, var(--el-color-primary));
    background: color-mix(in srgb, var(--primary-color, #2563EB) 8%, transparent);
    transform: translateY(-1px);
}

.paste-card-method-button:active {
    transform: translateY(1px) scale(0.98);
    background: color-mix(in srgb, var(--primary-color, #2563EB) 16%, transparent);
    transition-duration: 0.08s;
}

/* 选中态：PC 端此前只有 hover / 按下的瞬时反馈，等鼠标移开就看不出「当前选的是哪个」；
   这里把选中底色固定下来并加深一档，PC 与移动端（触摸时）观感一致。 */
.paste-card-method-button.is-active {
    font-weight: 600;
    color: var(--primary-color-accent, var(--el-color-primary));
    background: color-mix(in srgb, var(--primary-color, #2563EB) 16%, transparent);
    box-shadow:
        inset 0 0 0 1px color-mix(in srgb, var(--primary-color, #2563EB) 24%, var(--glass-border, rgba(128, 128, 128, 0.25))),
        0 1px 6px color-mix(in srgb, var(--primary-color, #2563EB) 16%, transparent);
    /* 切换时轻微「弹」一下，滑块位移与文字高亮同步 */
    animation: pasteMethodPop 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 选中的按钮在鼠标悬停时继续加深，避免被 hover 的浅底色冲淡 */
.paste-card-method-button.is-active:hover {
    background: color-mix(in srgb, var(--primary-color, #2563EB) 22%, transparent);
    color: var(--primary-color-accent, var(--el-color-primary));
}

@keyframes pasteMethodPop {
    0% { transform: scale(0.94); }
    60% { transform: scale(1.03); }
    100% { transform: scale(1); }
}

.paste-card-method-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color, #2563EB) 28%, transparent);
    color: var(--primary-color-accent, var(--el-color-primary));
}

/* Mobile responsive for paste card */
@media (max-width: 768px) {
    .paste-card {
        height: var(--upload-card-height);
        min-height: 0;
        max-height: var(--upload-card-height);
        padding: 6px;
        border-radius: 12px;
    }

    .upload-card-busy.paste-card {
        height: var(--upload-card-busy-height);
        min-height: 0;
        max-height: var(--upload-card-busy-height);
        padding: 5px;
    }

    .upload-card-textarea {
        margin-top: 4px;
        width: calc(100% - 4px) !important;
        min-height: 0;
        flex-shrink: 1;
    }

    .upload-card-textarea :deep(.el-textarea__inner) {
        height: 100%;
        min-height: 0 !important;
        box-sizing: border-box;
        border-radius: 10px;
        padding: 8px 10px;
        font-size: 12px;
    }

    .paste-card-actions {
        flex: 0 0 auto;
        width: 100% !important;
        margin-top: 6px;
        gap: 6px;
    }

    .paste-card-upload-button {
        height: 28px;
        min-width: 56px;
        border-radius: 7px !important;
        font-size: 11px;
        letter-spacing: 0.02em;
        padding: 0 10px;
    }

    .upload-card-busy .paste-card-upload-button {
        height: 28px;
        min-width: 56px;
        border-radius: 7px !important;
        font-size: 11px;
    }

    .upload-card-busy .paste-card-actions {
        margin-top: 6px;
    }

    .paste-card-method-group {
        width: 112px;
        height: 28px;
        padding: 2px;
        border-radius: 8px;
    }

    .paste-card-method-group::before {
        top: 2px;
        left: 2px;
        width: calc((100% - 6px) / 2);
        height: calc(100% - 4px);
        border-radius: 6px;
    }

    .paste-card-method-button {
        height: 22px;
        padding: 0 8px;
        font-size: 10px;
        border-radius: 6px;
    }
}

.upload-list-dashboard {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: var(--upload-list-inner-height);
    padding: 0 15px;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--glass-border);
    border-radius: var(--upload-list-radius);
    box-shadow: var(--glass-shadow);
    opacity: 0.7;
}

/* 收缩态直接跟随卡片内容区，避免固定 vh 与边框产生亚像素误差 */
.upload-list-card:not(.upload-list-busy) .upload-list-dashboard {
    height: 100%;
}

/* Enhanced Starry Sky Effect */
:deep(.el-upload-dragger) {
    position: relative;
    overflow: hidden;
}

/* Layer 1: Distant stars (Small, slow, dense) */
:deep(.el-upload-dragger::before) {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
        radial-gradient(2px 2px at 10% 10%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 20% 30%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 30% 10%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 40% 30%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 50% 10%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 60% 30%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 70% 10%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 80% 30%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 90% 10%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 15% 70%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0);
    background-size: 200px 200px;
    opacity: 0;
    z-index: 0;
    transition: opacity 0.6s ease;
}

/* Layer 2: Close stars (Larger, faster, sparse) */
:deep(.el-upload-dragger::after) {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
        radial-gradient(3px 3px at 15% 15%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(3px 3px at 50% 50%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(3px 3px at 85% 85%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2.5px 2.5px at 35% 65%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2.5px 2.5px at 65% 35%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0);
    background-size: 150px 150px;
    opacity: 0;
    z-index: 0;
    transition: opacity 0.6s ease;
}

.upload-card:hover :deep(.el-upload-dragger::before) {
    opacity: 0.3;
    animation: starScroll 60s linear infinite;
}

.upload-card:hover :deep(.el-upload-dragger::after) {
    opacity: 0.6;
    animation: starScroll 40s linear infinite, starPulse 4s ease-in-out infinite;
}

@keyframes starScroll {
    from { background-position: 0 0; }
    to { background-position: 100px 100px; }
}

@keyframes starPulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 0.3; }
}

/* ============================================
   Modern Action Button Group Styles
   ============================================ */
.modern-action-group {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 44px;
    box-sizing: border-box;
    padding: 5px;
    background: var(--glass-bg);
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}

.modern-action-group:hover {
    background: var(--glass-bg);
    border-color: var(--glass-border);
    box-shadow: var(--glass-shadow);
}

.modern-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 13px;
    background: var(--upload-action-btn-bg);
    color: var(--upload-action-btn-color);
    cursor: pointer;
    transition: background-color 0.22s ease, color 0.22s ease, box-shadow 0.22s ease, transform 0.22s ease;
    font-size: 14px;
    box-shadow: var(--upload-action-btn-shadow);
    position: relative;
    overflow: hidden;
    outline: none !important;
}

.modern-action-btn:focus,
.modern-action-btn:focus-visible {
    outline: none !important;
}

.modern-action-btn::before {
    content: '';
    position: absolute;
    inset: 2px;
    border-radius: 11px;
    background: currentColor;
    opacity: 0;
    transition: opacity 0.22s ease;
}

.modern-action-btn:hover {
    background: var(--upload-action-btn-hover-bg);
    box-shadow: var(--upload-action-btn-hover-shadow);
}

.modern-action-btn:hover::before {
    opacity: 0.08;
}

.modern-action-btn:active {
    transform: translateY(0) scale(0.97);
    box-shadow: var(--upload-action-btn-active-shadow);
}

.modern-action-btn-copy {
    color: var(--upload-action-copy-color);
}

.copy-format-badge {
    position: absolute;
    right: 3px;
    bottom: 2px;
    font-size: 8px;
    font-weight: 700;
    line-height: 10px;
    pointer-events: none;
}
/* 下拉里标记「当前默认格式」 */
.copy-format-active {
    font-weight: 600;
}
.copy-format-check {
    margin-left: 6px;
    font-size: 11px;
    color: var(--el-color-primary, #409eff);
}

.modern-action-btn-retry {
    color: var(--upload-action-retry-color);
}

.modern-action-btn-danger {
    color: var(--upload-action-danger-color);
    background: var(--upload-action-danger-bg);
}

.modern-action-btn-danger:hover {
    background: var(--upload-action-danger-hover-bg);
    box-shadow: var(--upload-action-danger-hover-shadow);
}

/* Dropdown Menu Styles */
.copy-format-icon {
    width: 16px;
    margin-right: 8px;
    flex-shrink: 0;
}

.modern-dropdown-item-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 12px;
    padding: 4px 0;
}

.modern-dropdown-item-content span {
    font-weight: 500;
    color: var(--el-text-color-primary);
}

/* ============================================
   Dashboard Title Enhancement
   ============================================ */
.upload-list-dashboard-title {
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    box-sizing: border-box;
    padding: 0 14px;
    background: var(--dashboard-title-bg, rgba(37, 99, 235, 0.06));
    border: none;
    border-radius: 12px;
    color: var(--el-text-color-primary);
}

.upload-list-dashboard-title .el-icon {
    font-size: 16px;
    margin-right: 4px;
    opacity: 0.85;
}

/* ============================================
   Mobile Responsive Styles
   ============================================ */
@media (max-width: 768px) {
    .modern-action-group {
        height: 34px;
        gap: 2px;
        padding: 2px;
        border-radius: 9px;
    }

    .modern-action-btn {
        width: 28px;
        height: 28px;
        border-radius: 7px;
        font-size: 11px;
    }

    .upload-list-dashboard-title {
        height: 34px;
        font-size: 11px;
        padding: 0 7px;
        border-radius: 9px;
    }

    .upload-list-dashboard-title .el-icon {
        font-size: 13px;
        margin-right: 1px;
    }

    /* 移动端:上传列表顶栏缩窄 padding,确保完整展示不溢出 */
    .upload-list-dashboard {
        padding: 0 6px;
        gap: 4px;
    }
    /* 标题块可收缩,避免挤爆操作按钮 */
    .upload-list-dashboard-title {
        gap: 3px;
        min-width: 0;
        flex-shrink: 1;
        overflow: hidden;
    }
    /* 操作组保持完整不被压缩 */
    .upload-list-dashboard-action {
        flex-shrink: 0;
    }
}

/* 可用高度较小的桌面视口：让收缩列表与内部工具栏保持舒适留白。 */
@media (min-width: 769px) and (max-height: 1050px) {
    .upload-list-dashboard {
        padding: 0 12px;
    }

    .modern-action-group,
    .upload-list-dashboard-title {
        height: 34px;
    }

    .modern-action-group {
        gap: 3px;
        padding: 3px;
        border-radius: 10px;
    }

    .modern-action-btn {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        font-size: 12px;
    }

    .upload-list-dashboard-title {
        padding: 0 10px;
        border-radius: 10px;
        font-size: 13px;
    }
}

</style>
