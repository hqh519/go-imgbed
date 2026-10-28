<template>
    <el-dialog :title="$t('uploadSettings.title')" v-model="visible" :width="dialogWidth" class="settings-dialog settings-dialog-scope upload-settings-dialog">
        <!-- 上传渠道 -->
        <div class="dialog-section">
            <div class="section-header">
                <span class="section-title">{{ $t('uploadSettings.uploadChannel') }}</span>
                <el-tooltip :content="$t('uploadSettings.channelSelectTooltip')" placement="top" raw-content>
                    <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                </el-tooltip>
            </div>
            <div class="section-content">
                <!--
                    渠道选择不再二级联动（原先「选类型 → 再选渠道」）：
                    直接用一个渠道下拉列出全部渠道，与 Token 编辑 / 用户管理编辑用户
                    共用同一个 ChannelSelect 组件。选项顶部为「默认」——
                    值为空 = 跟随全局设置（由后端 getStorageChannel 解析）。
                -->
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('uploadSettings.channelName') }}
                        <span
                            v-if="defaultChannelLabel"
                            class="default-channel-badge"
                            :title="defaultChannelLabel"
                        >{{ $t('uploadSettings.currentDefaultChannel') }}：{{ defaultChannelLabel }}</span>
                    </span>
                    <ChannelSelect
                        :key="'main-' + channelRefreshKey"
                        :model-value="channelName"
                        @update:model-value="$emit('update:channelName', $event)"
                        kind="main"
                        class="setting-input"
                    />
                </div>
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('uploadSettings.backupChannel') }}
                        <span
                            v-if="defaultBackupChannelLabel"
                            class="default-channel-badge"
                            :title="defaultBackupChannelLabel"
                        >{{ $t('uploadSettings.currentDefaultChannel') }}：{{ defaultBackupChannelLabel }}</span>
                    </span>
                    <!-- 备份渠道：默认为空 = 跟随全局；none = 明确不备份。
                         不再用「是否备份」开关控制 —— 由这个下拉本身表达。 -->
                    <ChannelSelect
                        :key="'backup-' + channelRefreshKey"
                        :model-value="backupChannel"
                        @update:model-value="$emit('update:backupChannel', $event)"
                        kind="backup"
                        class="setting-input"
                    />
                </div>
                <div class="setting-item">
                    <span class="setting-label">{{ $t('uploadSettings.uploadDirectory') }}</span>
                    <el-input :model-value="uploadFolder" @update:model-value="handleUploadFolderInput" :placeholder="$t('uploadSettings.uploadDirectoryPlaceholder')" class="setting-input"></el-input>
                </div>
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('uploadSettings.autoSwitch') }}
                        <el-tooltip :content="$t('uploadSettings.autoSwitchTooltip')" placement="top">
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <el-switch :model-value="autoRetry" @update:model-value="$emit('update:autoRetry', $event)" />
                </div>
            </div>
        </div>

        <!-- 客户端预处理 -->
        <div class="dialog-section">
            <div class="section-header">
                <span class="section-title">{{ $t('uploadSettings.filePreprocess') }}</span>
                <el-tooltip :content="$t('uploadSettings.filePreprocessTooltip')" placement="top">
                    <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                </el-tooltip>
            </div>
            <div class="section-content">
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('uploadSettings.convertToWebp') }}
                        <el-tooltip :content="$t('uploadSettings.convertToWebpTooltip')" placement="top">
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <el-switch :model-value="convertToWebp" @update:model-value="$emit('update:convertToWebp', $event)" />
                </div>
                <div class="setting-item">
                    <span class="setting-label">{{ $t('uploadSettings.fileCompress') }}</span>
                    <el-switch :model-value="customerCompress" @update:model-value="$emit('update:customerCompress', $event)" />
                </div>
                <div class="setting-item slider-item" v-if="customerCompress">
                    <span class="setting-label">
                        {{ $t('uploadSettings.compressThreshold') }}
                        <el-tooltip :content="$t('uploadSettings.compressThresholdTooltip')" placement="top">
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <div class="slider-wrapper">
                        <el-slider :model-value="compressBar" @update:model-value="$emit('update:compressBar', $event)" :min="1" :max="20" :format-tooltip="(value) => `${value} MB`"/>
                        <div class="slider-input-wrapper">
                            <el-input-number :model-value="compressBar" @update:model-value="$emit('update:compressBar', $event)" :min="1" :max="20" :step="1" :value-on-clear="1" class="slider-input" controls-position="right"/>
                            <span class="slider-unit">MB</span>
                        </div>
                    </div>
                </div>
                <!-- 压缩期望值：改为「压到原体积的百分比」 -->
                <div class="setting-item slider-item" v-if="customerCompress">
                    <span class="setting-label">
                        {{ $t('uploadSettings.compressPercent') }}
                        <el-tooltip :content="$t('uploadSettings.compressPercentTooltip')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <div class="slider-wrapper">
                        <el-slider :model-value="compressPercent" @update:model-value="$emit('update:compressPercent', $event)" :min="10" :max="100" :step="5" :format-tooltip="(value) => `${value}%`"/>
                        <div class="slider-input-wrapper">
                            <el-input-number :model-value="compressPercent" @update:model-value="$emit('update:compressPercent', $event)" :min="10" :max="100" :step="5" :value-on-clear="80" class="slider-input" controls-position="right"/>
                            <span class="slider-unit">%</span>
                        </div>
                    </div>
                </div>
                <!--
                    v2.8.5：原「允许压缩格式」改为「禁止压缩格式」，并挪到「压缩百分比」之后。
                    语义反转：清单内的格式跳过压缩、原样上传；不在清单内的按现有规则压缩。
                -->
                <div class="setting-item" v-if="customerCompress">
                    <span class="setting-label">
                        {{ $t('uploadSettings.compressExcludeExtensions') }}
                        <el-tooltip :content="compressExcludeTooltip" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <el-input
                        :model-value="limitCompressExts"
                        @update:model-value="$emit('update:limitCompressExts', $event)"
                        :placeholder="$t('uploadSettings.compressExcludeExtensionsPlaceholder')"
                        clearable
                        class="setting-input"
                    />
                </div>
            </div>
        </div>

        <!-- 上传限制（仅本次生效）：填了就用这里的值，留空跟随后台「上传相关配置」 -->
        <div class="dialog-section">
            <div class="section-header">
                <span class="section-title">{{ $t('uploadSettings.uploadLimits') }}</span>
                <el-tooltip :content="$t('uploadSettings.uploadLimitsTooltip')" placement="top" raw-content>
                    <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                </el-tooltip>
            </div>
            <div class="section-content">
                <div class="setting-item">
                    <span class="setting-label">{{ $t('uploadSettings.allowedExtensions') }}</span>
                    <el-input
                        :model-value="limitExtensions"
                        @update:model-value="$emit('update:limitExtensions', $event)"
                        :placeholder="$t('uploadSettings.allowedExtensionsPlaceholder')"
                        clearable
                        class="setting-input"
                    />
                </div>
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('uploadSettings.maxFileSize') }}
                        <el-tooltip :content="$t('uploadSettings.maxFileSizeTooltip')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <!-- v2.8.5：MB 单位放进输入框（suffix），宽度与「允许的上传格式」完全一致 -->
                    <el-input
                        :model-value="limitMaxSizeMB ? String(limitMaxSizeMB) : ''"
                        @update:model-value="handleMaxSizeInput"
                        :placeholder="maxSizePlaceholder"
                        clearable
                        class="setting-input limit-size-input"
                    >
                        <template #suffix>
                            <span class="limit-size-unit">MB</span>
                        </template>
                    </el-input>
                </div>
            </div>
        </div>

        <!-- v2.8.0：文件命名方式移到弹窗最后（原在「客户端预处理」之前） -->
        <div class="dialog-section">
            <div class="section-header">
                <span class="section-title">{{ $t('uploadSettings.fileNaming') }}</span>
                <el-tooltip :content="$t('uploadSettings.fileNamingTooltip')" placement="top">
                    <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                </el-tooltip>
            </div>
            <div class="section-content">
                <el-radio-group :model-value="uploadNameType" @update:model-value="$emit('update:uploadNameType', $event)" class="radio-card-group grid-2x2">
                    <el-radio label="default" class="radio-card">
                        <font-awesome-icon icon="cog" class="radio-icon"/>
                        <span>{{ $t('uploadSettings.namingDefault') }}</span>
                    </el-radio>
                    <el-radio label="index" class="radio-card">
                        <font-awesome-icon icon="hashtag" class="radio-icon"/>
                        <span>{{ $t('uploadSettings.namingIndex') }}</span>
                    </el-radio>
                    <el-radio label="origin" class="radio-card">
                        <font-awesome-icon icon="file-signature" class="radio-icon"/>
                        <span>{{ $t('uploadSettings.namingOrigin') }}</span>
                    </el-radio>
                    <el-radio label="short" class="radio-card">
                        <font-awesome-icon icon="compress-alt" class="radio-icon"/>
                        <span>{{ $t('uploadSettings.namingShort') }}</span>
                    </el-radio>
                </el-radio-group>
            </div>
        </div>

        <!--
            v2.5.0：移除底部「所有设置修改后立即生效，无需保存」提示与「完成」按钮
            —— 自动保存早已生效，右上角关闭按钮（show-close 已恢复）即可关窗。
        -->
    </el-dialog>
</template>

<script>
import ChannelSelect from '@/components/config/ChannelSelect.vue';
import { resolveChannelLabel, invalidateStorageChannels } from '@/utils/storageChannels';
import { COMPRESSIBLE_EXTENSIONS } from '@/utils/upload/compressExtensions';

export default {
    name: 'UploadSettingsDialog',
    components: {
        ChannelSelect
    },
    props: {
        modelValue: { type: Boolean, default: false },
        /** 存储渠道 ID（'' = 默认 / 跟随全局设置） */
        channelName: { type: String, default: '' },
        /** 备份渠道 ID（'' = 跟随全局；'none' = 不备份） */
        backupChannel: { type: String, default: '' },
        /** 当前生效的默认主存储渠道（{ id, code, name, type }）—— 仅用于展示落点 */
        defaultChannel: { type: Object, default: null },
        /** 当前生效的默认备份渠道（{ id, code, name, type }）—— 仅用于展示落点 */
        defaultBackupChannel: { type: Object, default: null },
        uploadFolder: { type: String, default: '' },
        autoRetry: { type: Boolean, default: true },
        uploadNameType: { type: String, default: 'default' },
        convertToWebp: { type: Boolean, default: false },
        customerCompress: { type: Boolean, default: true },
        compressBar: { type: Number, default: 5 },
        compressPercent: { type: Number, default: 80 },
        serverCompress: { type: Boolean, default: true },
        /** 允许的上传格式（本次覆盖，逗号分隔；空 = 跟随后台） */
        limitExtensions: { type: String, default: '' },
        /** 允许压缩格式覆盖（本次覆盖，逗号分隔；空 = 用内置可压缩清单） */
        limitCompressExts: { type: String, default: '' },
        /** 单文件大小上限覆盖（MB；0 = 跟随后台） */
        limitMaxSizeMB: { type: Number, default: 0 },
        /** 后台全局单文件大小上限（MB）—— 仅用于输入框 placeholder 提示 */
        globalMaxSizeMB: { type: Number, default: 0 }
    },
    emits: [
        'update:modelValue',
        'update:channelName',
        'update:backupChannel',
        'update:uploadFolder',
        'update:autoRetry',
        'update:uploadNameType',
        'update:convertToWebp',
        'update:customerCompress',
        'update:compressBar',
        'update:compressPercent',
        'update:serverCompress',
        'update:limitExtensions',
        'update:limitCompressExts',
        'update:limitMaxSizeMB'
    ],
    data() {
        return {
            /*
             * 渠道下拉刷新令牌（v2.8.6）：
             * 每次打开弹窗 +1，配合 ChannelSelect 的 :key 让下拉重新挂载、
             * 重新拉一次 /api/channels —— 后台刚停用的渠道不会残留在这个下拉里。
             */
            channelRefreshKey: 0
        };
    },
    watch: {
        /*
         * v2.8.6：弹窗打开时强制刷新渠道列表。
         * 场景：管理员在后台关掉某个渠道的启用开关，然后回到上传页打开「上传设置」，
         * 之前这里会继续显示那个已停用的渠道（模块级缓存没失效）。
         */
        visible(val) {
            if (!val) return;
            invalidateStorageChannels();
            this.channelRefreshKey += 1;
        },
        /*
         * v2.4.0：任何设置项发生变化 → 自动保存（父组件的 store 持久化）+ 弹「保存成功」提示。
         * 滑杆拖动会连续触发，这里 600ms 防抖合并成一条提示。
         */
        channelName() { this.notifySaved() },
        backupChannel() { this.notifySaved() },
        uploadFolder() { this.notifySaved() },
        autoRetry() { this.notifySaved() },
        uploadNameType() { this.notifySaved() },
        convertToWebp() { this.notifySaved() },
        customerCompress() { this.notifySaved() },
        compressBar() { this.notifySaved() },
        compressPercent() { this.notifySaved() },
        limitExtensions() { this.notifySaved() },
        limitCompressExts() { this.notifySaved() },
        limitMaxSizeMB() { this.notifySaved() }
    },
    methods: {
        /** 防抖弹出「保存成功」提示（600ms 内的连续变更只弹一次）；
         *  仅在弹窗打开期间生效，避免页面初始化回填配置时误弹 */
        notifySaved() {
            if (!this.modelValue) return
            if (this._savedToastTimer) clearTimeout(this._savedToastTimer)
            this._savedToastTimer = setTimeout(() => {
                this._savedToastTimer = null
                try {
                    this.$message.success(this.$t('uploadSettings.savedToast'))
                } catch (e) { /* 弹窗关闭瞬间可能拿不到实例，忽略 */ }
            }, 600)
        },
        /** 单文件大小上限：纯输入框，只留数字；清空 = 跟随后台（0） */
        handleMaxSizeInput(val) {
            const digits = String(val == null ? '' : val).replace(/[^\d]/g, '')
            this.$emit('update:limitMaxSizeMB', digits ? Number(digits) : 0)
        },
        handleUploadFolderInput(val) {
            // 自动补全前导 /
            if (val && !val.startsWith('/')) {
                val = '/' + val
            }
            this.$emit('update:uploadFolder', val)
        }
    },
    computed: {
        visible: {
            get() { return this.modelValue },
            set(val) { this.$emit('update:modelValue', val) }
        },
        /** 当前默认主渠道展示串（未配置时为空 → 不显示徽标） */
        defaultChannelLabel() {
            return resolveChannelLabel(this.defaultChannel)
        },
        /** 当前默认备份渠道展示串 */
        defaultBackupChannelLabel() {
            return resolveChannelLabel(this.defaultBackupChannel)
        },
        dialogWidth() {
            return window.innerWidth > 768 ? '50%' : '90%'
        },
        /** 单文件大小上限 placeholder：直接显示后台全局值，让「留空跟随后台」有个可读落点 */
        maxSizePlaceholder() {
            const global = Number(this.globalMaxSizeMB) || 0
            return global > 0
                ? this.$t('uploadSettings.maxFileSizePlaceholder', { mb: global })
                : this.$t('uploadSettings.maxFileSizePlaceholderNoGlobal')
        },
        /** 允许压缩格式 tooltip：带上内置清单，方便对照填写 */
        compressExcludeTooltip() {
            return this.$t('uploadSettings.compressExcludeExtensionsTooltip', {
                list: COMPRESSIBLE_EXTENSIONS.join(',')
            })
        }
    }
}
</script>

<style src="@/styles/settings-dialog.css"></style>
<style scoped>
.channel-option-row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.channel-option-row .channel-icon {
    width: 18px;
    text-align: center;
    flex-shrink: 0;
}

.channel-option-row.default-option {
    color: var(--el-text-color-secondary);
}

/* 「渠道名称」后面的当前默认主渠道徽标（跟随主渠道时给个可见的落点） */
.default-channel-badge {
    display: inline-block;
    max-width: 230px;
    margin-left: 6px;
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--primary-color, #409eff) 14%, transparent);
    color: var(--primary-color, #409eff);
    font-size: 12px;
    font-weight: 500;
    line-height: 18px;
    vertical-align: middle;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.slider-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
}.slider-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
}

.slider-wrapper .el-slider {
    flex: 1;
    min-width: 0;
}

.slider-input {
    width: 96px !important;
    flex-shrink: 0;
}

.slider-input :deep(.el-input__inner) {
    text-align: center;
}

.slider-input-wrapper {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}

.slider-unit {
    font-size: 13px;
    font-weight: 500;
    color: var(--el-text-color-secondary);
}

/* 「单文件大小上限」输入框 + MB 单位 */
/* v2.8.5：MB 单位挪进输入框 suffix，宽度完全交给 .setting-input（与「允许的上传格式」一致） */
.limit-size-input :deep(.el-input__suffix) {
    color: var(--el-text-color-secondary);
    font-size: 13px;
    font-weight: 500;
}

.limit-size-unit {
    font-size: 13px;
    font-weight: 500;
    color: var(--el-text-color-secondary);
}

/* v2.5.0：底部提示条与「完成」按钮已移除（自动保存），相关样式一并清理 */
</style>
