<template>
    <div class="others-settings" v-loading="loading">
        <!-- 一级设置：其他设置 -->
        <div class="first-settings">
            <h3 class="first-title">{{ $t('sysOthers.remoteTelemetry') }}
                <el-tooltip :content="$t('sysOthers.remoteTelemetryTooltip')" placement="right">
                    <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                </el-tooltip>
            </h3>
            <el-form :model="settings.telemetry" label-width="120px">
                <el-form-item :label="$t('sysOthers.enable')">
                    <el-switch v-model="settings.telemetry.enabled" :disabled="settings.telemetry.fixed"></el-switch>
                </el-form-item>
            </el-form>
            <h3 class="first-title">{{ $t('sysOthers.randomImageApi') }}
                <el-tooltip :content="$t('sysOthers.randomImageApiTooltip')" placement="right">
                    <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                </el-tooltip>
            </h3>
            <el-form :model="settings.randomImageAPI" label-width="120px">
                <el-form-item :label="$t('sysOthers.enable')">
                    <el-switch v-model="settings.randomImageAPI.enabled" :disabled="settings.randomImageAPI.fixed"></el-switch>
                </el-form-item>
                <el-form-item prop="randomImageAPI.allowedDir">
                    <template #label>
                        <span>{{ $t('sysOthers.directory') }}</span>
                        <el-tooltip :content="$t('sysOthers.directoryTooltip')" placement="right" raw-content>
                            <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                        </el-tooltip>
                    </template>
                    <el-input v-model="settings.randomImageAPI.allowedDir" :disabled="settings.randomImageAPI.fixed"></el-input>
                </el-form-item>
            </el-form>
            <h3 class="first-title">{{ $t('sysOthers.publicBrowse') }}
                <el-tooltip :content="$t('sysOthers.publicBrowseTooltip')" placement="right" raw-content>
                    <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                </el-tooltip>
            </h3>
            <el-form :model="settings.publicBrowse" label-width="120px">
                <el-form-item :label="$t('sysOthers.enable')">
                    <el-switch v-model="settings.publicBrowse.enabled" :disabled="settings.publicBrowse.fixed"></el-switch>
                </el-form-item>
                <el-form-item prop="publicBrowse.allowedDir">
                    <template #label>
                        <span>{{ $t('sysOthers.openDirectory') }}</span>
                        <el-tooltip placement="right" raw-content>
                            <template #content>
                                <div style="max-width: 320px; line-height: 1.6;" v-html="$t('sysOthers.openDirectoryTooltip')">
                                </div>
                            </template>
                            <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                        </el-tooltip>
                    </template>
                    <!-- v2.6.0：改多行文本框，一行一个目录 -->
                    <el-input
                        v-model="settings.publicBrowse.allowedDir"
                        type="textarea"
                        :rows="10"
                        :disabled="settings.publicBrowse.fixed"
                        placeholder="wallpaper&#10;photos&#10;album"
                    ></el-input>
                </el-form-item>
            </el-form>

            <!-- 图片尺寸处理（原「安全设置 → 访问管理」迁移至此，置于本页尾部） -->
            <h3 class="first-title">{{ $t('sysSecurity.imageTransform') }}</h3>
            <el-form
                :model="imageTransform"
                :rules="imageTransformRules"
                ref="imageTransformForm"
                label-width="120px"
                :disabled="saving"
            >
                <el-form-item>
                    <template #label>
                        {{ $t('sysSecurity.enableImageTransform') }}
                        <el-tooltip :content="$t('sysSecurity.enableImageTransformTooltip')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                        </el-tooltip>
                    </template>
                    <el-switch v-model="imageTransform.enabled"/>
                </el-form-item>
                <el-form-item v-if="imageTransform.enabled" prop="allowedSizes">
                    <template #label>
                        {{ $t('sysSecurity.imageTransformAllowedSizes') }}
                        <el-tooltip :content="$t('sysSecurity.imageTransformAllowedSizesHint')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                        </el-tooltip>
                    </template>
                    <el-input
                        v-model="imageTransform.allowedSizes"
                        :placeholder="$t('sysSecurity.imageTransformAllowedSizesPlaceholder')"
                    />
                </el-form-item>
            </el-form>

            <!-- 上传相关配置（原「网页设置 → 客户端设置」迁移至此，统一归到这一块） -->
            <h3 class="first-title">{{ $t('sysOthers.uploadRelatedConfig') }}
                <el-tooltip :content="$t('sysOthers.uploadRelatedConfigTooltip')" placement="right" raw-content>
                    <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                </el-tooltip>
            </h3>
            <el-form :model="pageSettings" label-width="150px" :disabled="saving">
                <el-form-item v-for="setting in uploadDefaultItems" :key="setting.id">
                    <template #label>
                        {{ localized(setting, 'label') }}
                        <el-tooltip v-if="setting.tooltip" :content="localized(setting, 'tooltip')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                        </el-tooltip>
                    </template>
                    <el-select
                        v-if="setting.type === 'select'"
                        v-model="setting.value"
                        :disabled="setting.fixed"
                        :placeholder="localized(setting, 'placeholder')"
                        style="width: 100%"
                    >
                        <el-option
                            v-for="option in setting.options"
                            :key="option.value"
                            :label="localizedOption(option)"
                            :value="option.value">
                        </el-option>
                    </el-select>
                    <el-switch
                        v-else-if="setting.type === 'boolean'"
                        v-model="setting.value"
                        :disabled="setting.fixed"
                    ></el-switch>
                    <el-input
                        v-else
                        v-model="setting.value"
                        :disabled="setting.fixed"
                        :placeholder="localized(setting, 'placeholder')"
                    ></el-input>
                </el-form-item>
            </el-form>
        </div>

        <!-- 悬浮保存按钮 -->
        <FloatingSaveButton :show="!loading" :loading="saving" :dirty="hasUnsavedChanges" @click="saveSettings" />
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import FloatingSaveButton from '@/components/FloatingSaveButton.vue';
import unsavedSettings from '@/mixins/unsavedSettings';
import { UPLOAD_DEFAULT_CONFIG_IDS } from '@/utils/uploadDefaults';

export default {
mixins: [unsavedSettings],
components: {
    FloatingSaveButton
},
data() {
    return {
        settings: {
            telemetry: {},
            randomImageAPI: {},
            publicBrowse: {},
            // 对外 WebDAV 已迁到「安全设置 → API Token 管理」下方；
            // 这里保留原值随 others 分区一起回写，避免保存其它项时把它抹掉
            webdav: { enabled: false, rootPath: '', readonly: false }
        },
        // 图片尺寸处理：数据仍在 sysConfig 的 security 分区（access.*）
        imageTransform: { enabled: false, allowedSizes: '' },
        // 上传相关配置：数据仍在 sysConfig 的 page 分区（config 数组）
        pageSettings: { config: [] },
        // 加载状态
        loading: true,
        saving: false
    };
},
computed: {
    /** 脏值追踪：三类设置都算在内 */
    editableSettings() {
        return {
            others: this.settings,
            imageTransform: this.imageTransform,
            page: this.pageSettings.config.map(({ id, value }) => ({ id, value }))
        };
    },
    isEn() {
        return this.$i18n.locale === 'en';
    },
    /** 「上传相关配置」分类块：从网页设置配置里筛出迁移过来的那一批 */
    uploadDefaultItems() {
        const list = Array.isArray(this.pageSettings.config) ? this.pageSettings.config : [];
        let items = list.filter(item => UPLOAD_DEFAULT_CONFIG_IDS.includes(item.id));
        /*
         * v2.8.8 级联：两个开关从「默认值」升级为「功能总开关」。
         *   · 「文件压缩」关闭 → 压缩阈值 / 压缩期望没有意义，一并隐藏；
         *   · 「WebP转换」关闭 → 没有下游子项，仅前台按钮不加载。
         * 注意只影响展示，不改值：重新打开开关后原来的阈值 / 期望还在。
         */
        const compressOn = this.configBool(items, 'defaultCustomerCompress', true);
        if (!compressOn) {
            items = items.filter(item => item.id !== 'defaultCompressBar' && item.id !== 'defaultCompressQuality');
        }
        return items;
    },
    /** 图片尺寸处理：格式校验（与原「安全设置」保持一致） */
    imageTransformRules() {
        const validateAllowedSizes = (rule, value, callback) => {
            if (!this.imageTransform.enabled || !value || !value.trim()) {
                callback();
                return;
            }
            const sizes = value.split(',').map(size => size.trim().toLowerCase()).filter(Boolean);
            const valid = sizes.every(size => {
                const match = size.match(/^(auto|[1-9]\d*)x(auto|[1-9]\d*)$/);
                if (!match || (match[1] === 'auto' && match[2] === 'auto')) return false;
                return match.slice(1).every(dimension => dimension === 'auto' || Number(dimension) <= 4096);
            });
            if (!valid) callback(new Error(this.$t('sysSecurity.imageTransformAllowedSizesInvalid')));
            else callback();
        };
        return {
            allowedSizes: [{ validator: validateAllowedSizes, trigger: ['blur', 'change'] }]
        };
    }
},
methods: {
    /**
     * 从配置数组里读一个布尔项（同时兼容真布尔与 'true'/'false' 字符串 ——
     * 配置项存库后可能被序列化成字符串）。
     */
    configBool(items, id, fallback) {
        const hit = (items || []).find(item => item.id === id);
        if (!hit || hit.value === undefined || hit.value === null || hit.value === '') return fallback;
        if (typeof hit.value === 'boolean') return hit.value;
        return String(hit.value) === 'true';
    },
    localized(item, field) {
        if (this.isEn && item[field + '_en']) return item[field + '_en'];
        return item[field] || '';
    },
    localizedOption(option) {
        if (this.isEn && option.label_en) return option.label_en;
        return option.label;
    },
    /** 统一的 JSON 请求助手 */
    async requestJson(url, options = {}) {
        const response = await fetchWithAuth(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        if (!response.ok) throw new Error(this.$t('floatingSave.failed'));
        return response.json().catch(() => ({}));
    },
    async saveSettings() {
        if (this.saving) return;
        this.saving = true;
        try {
            // 1) 其他设置分区（遥测 / 随机图 / 公开画廊）
            const othersPayload = JSON.parse(JSON.stringify(this.settings));

            // 2) 安全设置分区：只提交图片尺寸处理这一段，后端深合并，不影响认证等其它字段
            const securityPayload = {
                access: {
                    imageTransformEnabled: this.imageTransform.enabled === true,
                    imageTransformAllowedSizes: String(this.imageTransform.allowedSizes || '')
                }
            };

            // 3) 网页设置分区：整份 config 回写（含未在本页展示的项），值不丢
            const pagePayload = { config: JSON.parse(JSON.stringify(this.pageSettings.config || [])) };

            // 先校验图片尺寸处理再提交
            let valid = true;
            await new Promise((resolve) => {
                this.$refs.imageTransformForm?.validate((ok) => {
                    valid = ok;
                    resolve();
                });
            });
            if (!valid) {
                return;
            }

            await this.requestJson('/api/manage/sysConfig/others', {
                method: 'POST',
                body: JSON.stringify(othersPayload)
            });
            await this.requestJson('/api/manage/sysConfig/security', {
                method: 'POST',
                body: JSON.stringify(securityPayload)
            });
            await this.requestJson('/api/manage/sysConfig/page', {
                method: 'POST',
                body: JSON.stringify(pagePayload)
            });

            this.settings = { ...this.settings, ...othersPayload };
            this.markSettingsSaved();
            this.$message.success(this.$t('sysOthers.settingsSaved'));
        } catch {
            this.$message.error(this.$t('floatingSave.failed'));
        } finally {
            this.saving = false;
        }
    }
},
mounted() {
    this.loading = true;
    Promise.all([
        // 其他设置
        fetchWithAuth('/api/manage/sysConfig/others').then(r => r.json()),
        // 安全设置（图片尺寸处理）
        fetchWithAuth('/api/manage/sysConfig/security').then(r => r.json()),
        // 网页设置（上传相关配置）
        fetchWithAuth('/api/manage/sysConfig/page').then(r => r.json())
    ])
    .then(async ([others, security, page]) => {
        this.settings = others && typeof others === 'object' ? others : this.settings;
        if (!this.settings.telemetry) this.settings.telemetry = { enabled: false, fixed: false };
        if (!this.settings.randomImageAPI) this.settings.randomImageAPI = { enabled: true, allowedDir: '', fixed: false };
        if (!this.settings.publicBrowse) this.settings.publicBrowse = { enabled: true, allowedDir: '', fixed: false };
        // 历史存档里可能带有已迁移的 webdav 段：本页不再处理，但保留原值以免保存时被覆盖丢失
        if (!this.settings.webdav) this.settings.webdav = { enabled: false, rootPath: '', readonly: false };

        const access = security?.access || {};
        this.imageTransform = {
            enabled: access.imageTransformEnabled === true,
            allowedSizes: String(access.imageTransformAllowedSizes || '')
        };

        // 未保存过配置时 value 为空：用 default 兜底，避免开关/下拉显示与实际生效值不一致
        this.pageSettings = {
            config: (Array.isArray(page?.config) ? page.config : []).map(item => (
                item.value === undefined ? { ...item, value: item.default } : item
            ))
        };

        await this.$nextTick();
        this.markSettingsSaved();
    })
    .finally(() => {
        this.loading = false;
    });
}
};
</script>

<style scoped>
.others-settings {
    min-height: 500px;
}

.first-settings {
    margin-bottom: 40px;
}

.first-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--el-color-primary-light-7);
}

.second-title {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: start;
    margin-left: 0;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}

/* 表单样式 - 上下排列左对齐(对齐系统状态卡片风格,无 hover 动效) */
.first-settings :deep(.el-form) {
    padding: 20px 24px;
    background-color: var(--glass-bg) !important;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border-radius: 16px;
    border: 1px solid var(--glass-border);
    margin-bottom: 20px;
    box-shadow: var(--glass-shadow);
}

.first-settings :deep(.el-form-item) {
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
}

.first-settings :deep(.el-form-item:last-child) {
    margin-bottom: 0;
}

.first-settings :deep(.el-form-item__label) {
    text-align: left;
    padding-bottom: 8px;
    font-weight: 500;
    color: var(--el-text-color-primary);
    width: auto !important;
    display: flex;
    align-items: center;
    gap: 5px;
}

.first-settings :deep(.el-form-item__content) {
    width: 100%;
    max-width: 400px;
    margin-left: 0 !important;
}

.first-settings :deep(.el-input) {
    width: 100%;
}

.first-settings :deep(.el-switch) {
    --el-switch-on-color: var(--el-color-primary);
}

/* 移动端适配 */
@media (max-width: 768px) {
    .first-settings :deep(.el-form) {
        padding: 12px 15px;
    }

    .first-settings :deep(.el-form-item__content) {
        max-width: 100%;
    }
}
</style>
