<template>
    <!--
      登记文件（v2.8.8）

      场景：文件早就通过别的方式放到了对象存储 / 图床（CDN、NAS、别的图床），
      只想让 go-imgbed 里有一条可管理、可签发的记录，不想再传一遍。
      这里只填「文件源地址」等少量信息，类型 / 大小 / MD5 / IP 归属地 / 上传时间
      全部由服务端探测与自动写入。

      入口：
        · 前台上传页右下角（「上传设置」按钮上方）
        · 后台文件管理页「新建目录」按钮右侧
      两处共用本组件，样式沿用 settings-dialog 系列，跟其它设置弹窗完全一致。
    -->
    <el-dialog
        :title="$t('recordFile.title')"
        v-model="visible"
        :width="dialogWidth"
        class="settings-dialog settings-dialog-scope record-file-dialog"
        append-to-body
    >
        <div class="dialog-section">
            <div class="section-header">
                <span class="section-title">{{ $t('recordFile.basicSection') }}</span>
                <el-tooltip :content="$t('recordFile.basicTooltip')" placement="top" raw-content>
                    <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                </el-tooltip>
            </div>
            <div class="section-content">
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('recordFile.sourceUrl') }}
                        <span class="required-mark">*</span>
                    </span>
                    <el-input
                        v-model.trim="form.sourceUrl"
                        :placeholder="$t('recordFile.sourceUrlPlaceholder')"
                        clearable
                        class="setting-input"
                    />
                </div>
                <div class="setting-item">
                    <span class="setting-label">{{ $t('recordFile.fileName') }}</span>
                    <el-input
                        v-model.trim="form.originalName"
                        :placeholder="$t('recordFile.fileNamePlaceholder')"
                        clearable
                        class="setting-input"
                    />
                </div>
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('recordFile.channel') }}
                        <span class="required-mark">*</span>
                    </span>
                    <el-select
                        v-model="form.channelId"
                        :placeholder="$t('recordFile.channelPlaceholder')"
                        :loading="channelsLoading"
                        class="setting-input"
                    >
                        <el-option
                            v-for="c in channelOptions"
                            :key="c.id"
                            :label="`${c.name}（${c.code}）`"
                            :value="c.id"
                        />
                    </el-select>
                </div>
                <div class="setting-item">
                    <span class="setting-label">{{ $t('recordFile.folder') }}</span>
                    <DirectorySuggestionInput
                        v-model="form.folder"
                        :placeholder="$t('recordFile.folderPlaceholder')"
                    />
                </div>
                <div class="setting-item record-note-item">
                    <span class="setting-label">{{ $t('recordFile.note') }}</span>
                    <el-input
                        v-model="form.note"
                        type="textarea"
                        :rows="3"
                        maxlength="2000"
                        show-word-limit
                        :placeholder="$t('recordFile.notePlaceholder')"
                    />
                </div>
            </div>
        </div>

        <div class="dialog-section">
            <div class="section-header">
                <span class="section-title">{{ $t('recordFile.autoSection') }}</span>
            </div>
            <div class="section-content">
                <ul class="record-auto-list">
                    <li v-for="(item, i) in autoItems" :key="i">
                        <font-awesome-icon icon="check" class="record-auto-icon"/>
                        <span>{{ item }}</span>
                    </li>
                </ul>
                <el-alert
                    v-if="!isAdmin"
                    type="info"
                    :closable="false"
                    show-icon
                    :title="$t('recordFile.userHint')"
                    class="record-alert"
                />
            </div>
        </div>

        <div class="dialog-action">
            <el-button @click="visible = false">{{ $t('common.cancel') }}</el-button>
            <el-button type="primary" class="confirm-btn" :loading="submitting" @click="submit">
                {{ $t('recordFile.submit') }}
            </el-button>
        </div>
    </el-dialog>
</template>

<script>
import DirectorySuggestionInput from '@/components/DirectorySuggestionInput.vue'
import fetchWithAuth from '@/utils/fetchWithAuth'
import { fetchStorageChannels } from '@/utils/storageChannels'

export default {
    name: 'RecordFileDialog',
    components: { DirectorySuggestionInput },
    props: {
        modelValue: { type: Boolean, default: false },
        isAdmin: { type: Boolean, default: true }
    },
    emits: ['update:modelValue', 'registered'],
    data() {
        return {
            form: { sourceUrl: '', originalName: '', channelId: '', folder: '', note: '' },
            channels: [],
            channelsLoading: false,
            submitting: false
        }
    },
    computed: {
        visible: {
            get() { return this.modelValue },
            set(val) { this.$emit('update:modelValue', val) }
        },
        dialogWidth() {
            return window.innerWidth > 768 ? '50%' : '90%'
        },
        channelOptions() {
            // 只列「启用中」的渠道：已停用的渠道不该再接收新记录
            return this.channels.filter(c => c.enabled !== false)
        },
        autoItems() {
            return [
                this.$t('recordFile.autoType'),
                this.$t('recordFile.autoSize'),
                this.$t('recordFile.autoMd5'),
                this.$t('recordFile.autoTime'),
                this.$t('recordFile.autoUser'),
                this.$t('recordFile.autoSource'),
                this.$t('recordFile.autoTags')
            ]
        }
    },
    watch: {
        async modelValue(val) {
            if (!val) return
            await this.loadChannels()
        }
    },
    methods: {
        async loadChannels() {
            this.channelsLoading = true
            try {
                this.channels = await fetchStorageChannels(true)
            } catch (e) {
                this.channels = []
            } finally {
                this.channelsLoading = false
            }
        },
        async submit() {
            if (this.submitting) return
            if (!this.form.sourceUrl) {
                this.$message.warning(this.$t('recordFile.sourceUrlRequired'))
                return
            }
            if (!/^https?:\/\//i.test(this.form.sourceUrl)) {
                this.$message.warning(this.$t('recordFile.sourceUrlInvalid'))
                return
            }
            if (!this.form.channelId) {
                this.$message.warning(this.$t('recordFile.channelRequired'))
                return
            }
            this.submitting = true
            try {
                const res = await fetchWithAuth('/api/record', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...this.form })
                })
                const data = await res.json().catch(() => ({}))
                if (!res.ok || !data.success) {
                    this.$message.error(data.message || this.$t('recordFile.failed'))
                    return
                }
                const size = Number(data.data?.size) || 0
                this.$message.success(
                    this.$t('recordFile.success', {
                        name: data.data?.name || this.form.originalName,
                        size: this.formatSize(size)
                    })
                )
                this.$emit('registered', data.data || {})
                this.form = { sourceUrl: '', originalName: '', channelId: this.form.channelId, folder: '', note: '' }
                this.visible = false
            } catch (e) {
                this.$message.error(this.$t('recordFile.failed'))
            } finally {
                this.submitting = false
            }
        },
        formatSize(bytes) {
            const n = Number(bytes) || 0
            if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
            if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
            if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
            return `${n} B`
        }
    }
}
</script>

<style scoped>
.required-mark {
    color: var(--el-color-danger);
    margin-left: 2px;
}

.record-note-item {
    align-items: flex-start;
}

.record-note-item .setting-label {
    padding-top: 6px;
}

.record-auto-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 8px;
    color: var(--el-text-color-regular);
    font-size: 13px;
    line-height: 1.6;
}

.record-auto-list li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}

.record-auto-icon {
    color: var(--primary-color, #409eff);
    margin-top: 4px;
    flex-shrink: 0;
}

.record-alert {
    margin-top: 12px;
}
</style>
