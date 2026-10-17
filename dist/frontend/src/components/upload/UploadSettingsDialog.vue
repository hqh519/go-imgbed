<template>
    <el-dialog :title="$t('uploadSettings.title')" v-model="visible" :width="dialogWidth" :show-close="false" class="settings-dialog settings-dialog-scope upload-settings-dialog">
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

        <!-- 文件命名方式 -->
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
            </div>
        </div>

        <div class="dialog-action">
            <el-button type="primary" @click="visible = false" class="confirm-btn">{{ $t('uploadSettings.confirm') }}</el-button>
        </div>
    </el-dialog>
</template>

<script>
import ChannelSelect from '@/components/config/ChannelSelect.vue';
import { resolveChannelLabel } from '@/utils/storageChannels';

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
        serverCompress: { type: Boolean, default: true }
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
        'update:serverCompress'
    ],
    methods: {
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
}

.slider-wrapper {
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

@media (max-width: 768px) {
    .slider-wrapper {
        gap: 8px;
    }
}
</style>
