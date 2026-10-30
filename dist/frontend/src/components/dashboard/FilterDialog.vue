<template>
    <!--
        v2.8.7b：文件管理「筛选」弹窗（替代原 FilterDropdown 下拉菜单）。
        四个标签页（v2.8.7b 重排）：
          · 常规 —— 原 FilterDropdown 的全部筛选项（访问状态 / 黑白名单 / 审查 / 类型 / 备份 / 重定向 / 渠道 / 上传方式）
          · 标签 —— 有无标签 + 具体标签多选（或 / 且）
          · 日期 —— 快捷日期（今天 / 昨天 / 前天 / 本周内 / 上周内 / 本月内 / 本年内）+ 日历范围（复用 DateRangeCalendar）
          · 大小 —— 快捷大小（<100K / <1M / <10M / <100M / >100M）+ 自定义最小 / 最大值
        任一标签页有值时：筛选按钮显示角标；对应标签名上显示小圆点提示（v2.8.7b）。
        弹窗高度固定为视口高度的 96% 且水平垂直居中（v2.8.7b），切换标签页不跳动。
        所有条件与搜索框、搜索范围、用户筛选、回收站状态一起提交给后端联合查询。
        弹窗内改动先存草稿，点「确定」才应用；「清除筛选」立即清空并应用。
    -->
    <el-dialog
        :model-value="modelValue"
        :title="$t('filter.dialogTitle')"
        :width="dialogWidth"
        class="filter-dialog"
        align-center
        append-to-body
        @update:model-value="$emit('update:modelValue', $event)"
        @open="syncDraft"
    >
        <el-tabs v-model="activeTab" class="filter-dialog-tabs">
            <!-- ───── 标签页 1：常规（原「筛选」，v2.8.7b 改名） ───── -->
            <el-tab-pane name="filter">
                <template #label>
                    <span class="filter-tab-label">{{ $t('filter.tabFilter') }}<i v-if="tabHasValue.filter" class="filter-tab-dot"></i></span>
                </template>
                <div class="filter-dialog-body">
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.accessStatus') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.accessStatus">
                                <el-checkbox v-for="option in accessStatusOptions" :key="'accessStatus-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.blackWhiteList') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.listType">
                                <el-checkbox v-for="option in listTypeOptions" :key="'listType-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.reviewResult') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.label">
                                <el-checkbox v-for="option in labelOptions" :key="'label-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.fileType') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.fileType">
                                <el-checkbox v-for="option in fileTypeOptions" :key="'fileType-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.backupStatus') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.backup">
                                <el-checkbox v-for="option in backupOptions" :key="'backup-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <!-- v2.8.9：名称状态（依据 prevName / firstName：改过名即「已改名」） -->
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.nameStatus') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.nameChanged">
                                <el-checkbox v-for="option in nameStatusOptions" :key="'nameChanged-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('dashboard.filterRedirect') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.redirect">
                                <el-checkbox v-for="option in redirectOptions" :key="'redirect-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <!-- v2.8.9：有效期（依据 linkExpiresAt：未设=永久、已过=已过期、未过=已限时） -->
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.validity') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.validity">
                                <el-checkbox v-for="option in validityOptions" :key="'validity-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.channelType') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.channel">
                                <el-checkbox v-for="option in channelOptions" :key="'channel-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <div class="filter-section" v-if="channelNameOptions.length > 0">
                        <div class="filter-title">{{ $t('filter.channelName') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.channelName">
                                <template v-for="(group, index) in groupedChannelNames" :key="'group-' + group.type">
                                    <div v-if="index > 0" class="channel-divider"></div>
                                    <div class="channel-group-title">{{ group.typeLabel }}</div>
                                    <!-- v2.8.7b：label 直接用渠道名（不带类型前缀），与后端按名称匹配保持一致，修复按渠道名筛选失败 -->
                                    <el-checkbox
                                        v-for="option in group.channels"
                                        :key="'channelName-' + option.type + '-' + option.name"
                                        :label="option.name"
                                    >{{ option.name }}</el-checkbox>
                                </template>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.uploadSource') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.uploadSource">
                                <el-checkbox v-for="option in uploadSourceOptions" :key="'uploadSource-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                </div>
            </el-tab-pane>

            <!-- ───── 标签页 2：标签（v2.8.7b 自原「筛选」页迁出 + 标签多选合并） ───── -->
            <el-tab-pane name="tags">
                <template #label>
                    <span class="filter-tab-label">{{ $t('filter.tags') }}<i v-if="tabHasValue.tags" class="filter-tab-dot"></i></span>
                </template>
                <div class="filter-dialog-body">
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.tagsPresence') }}</div>
                        <div class="filter-options">
                            <el-checkbox-group v-model="draft.tags">
                                <el-checkbox v-for="option in tagPresenceOptions" :key="'tags-' + option.value" :label="option.value">{{ option.label }}</el-checkbox>
                            </el-checkbox-group>
                        </div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.tagNames') }}</div>
                        <div class="filter-options tag-name-options">
                            <button
                                v-for="t in tagOptions"
                                :key="'tagName-' + t.name"
                                type="button"
                                class="quick-chip"
                                :class="{ 'is-active': draft.tagNames.includes(t.name) }"
                                :title="$t('dashboard.tagCount', { count: t.count })"
                                @click="toggleTagName(t.name)"
                            >{{ t.name }}</button>
                            <span v-if="tagOptions.length === 0" class="filter-hint">{{ $t('dashboard.tagFilterEmpty') }}</span>
                        </div>
                        <div v-if="draft.tagNames.length > 1" class="filter-hint">
                            {{ draft.tagMode === 'or' ? $t('dashboard.tagModeOrHint') : $t('dashboard.tagModeAndHint') }}
                        </div>
                        <el-radio-group v-if="draft.tagNames.length > 1" v-model="draft.tagMode" size="small" class="tag-mode-group">
                            <el-radio-button label="or">{{ $t('dashboard.tagModeOr') }}</el-radio-button>
                            <el-radio-button label="and">{{ $t('dashboard.tagModeAnd') }}</el-radio-button>
                        </el-radio-group>
                    </div>
                </div>
            </el-tab-pane>

            <!-- ───── 标签页 3：日期（按上传日期） ───── -->
            <el-tab-pane name="date">
                <template #label>
                    <span class="filter-tab-label">{{ $t('filter.tabDate') }}<i v-if="tabHasValue.date" class="filter-tab-dot"></i></span>
                </template>
                <div class="filter-dialog-body">
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.dateQuick') }}</div>
                        <div class="quick-chip-row">
                            <button
                                v-for="p in datePresetOptions"
                                :key="'dp-' + p.value"
                                type="button"
                                class="quick-chip"
                                :class="{ 'is-active': draft.datePreset === p.value }"
                                @click="applyDatePreset(p.value)"
                            >{{ p.label }}</button>
                        </div>
                        <div class="filter-hint">{{ $t('filter.dateCustom') }}</div>
                        <DateRangeCalendar v-model="draftDateRange" @change="handleDraftDateRange" />
                    </div>
                </div>
            </el-tab-pane>

            <!-- ───── 标签页 4：大小（可按「实际大小 / 原始大小」两个口径） ───── -->
            <el-tab-pane name="size">
                <template #label>
                    <span class="filter-tab-label">{{ $t('filter.tabSize') }}<i v-if="tabHasValue.size" class="filter-tab-dot"></i></span>
                </template>
                <div class="filter-dialog-body">
                    <!-- v2.8.9：大小口径切换（默认实际大小） -->
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.sizeModeLabel') }}</div>
                        <div class="quick-chip-row">
                            <button
                                type="button"
                                class="quick-chip"
                                :class="{ 'is-active': draft.sizeMode === 'actual' }"
                                @click="draft.sizeMode = 'actual'"
                            >{{ $t('filter.sizeModeActual') }}</button>
                            <button
                                type="button"
                                class="quick-chip"
                                :class="{ 'is-active': draft.sizeMode === 'original' }"
                                @click="draft.sizeMode = 'original'"
                            >{{ $t('filter.sizeModeOriginal') }}</button>
                        </div>
                        <div class="filter-hint">{{ $t('filter.sizeModeHint') }}</div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.sizeQuick') }}</div>
                        <div class="quick-chip-row">
                            <button
                                v-for="p in sizePresetOptions"
                                :key="'sp-' + p.value"
                                type="button"
                                class="quick-chip"
                                :class="{ 'is-active': draft.sizePreset === p.value }"
                                @click="applySizePreset(p.value)"
                            >{{ p.label }}</button>
                        </div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.sizeCustom') }}</div>
                        <div class="size-input-row">
                            <el-input-number
                                v-model="draft.sizeMinValue"
                                :min="0"
                                :controls="false"
                                :placeholder="$t('filter.sizeMin')"
                                class="size-input"
                            />
                            <span class="size-sep">—</span>
                            <el-input-number
                                v-model="draft.sizeMaxValue"
                                :min="0"
                                :controls="false"
                                :placeholder="$t('filter.sizeMax')"
                                class="size-input"
                            />
                            <el-select v-model="draft.sizeUnit" class="size-unit-select" size="default">
                                <el-option label="KB" value="KB" />
                                <el-option label="MB" value="MB" />
                                <el-option label="GB" value="GB" />
                            </el-select>
                        </div>
                        <div class="filter-hint">{{ $t('filter.sizeCustomHint') }}</div>
                    </div>
                </div>
            </el-tab-pane>

            <!-- ───── 标签页 5：尺寸（v2.8.9 新增；快捷尺寸 + 自定义宽高） ───── -->
            <el-tab-pane name="dimension">
                <template #label>
                    <span class="filter-tab-label">{{ $t('filter.tabDimension') }}<i v-if="tabHasValue.dimension" class="filter-tab-dot"></i></span>
                </template>
                <div class="filter-dialog-body">
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.dimQuick') }}</div>
                        <div class="quick-chip-row">
                            <button
                                v-for="p in dimPresetOptions"
                                :key="'dim-' + p.value"
                                type="button"
                                class="quick-chip"
                                :class="{ 'is-active': draft.dimPreset === p.value }"
                                @click="applyDimPreset(p.value)"
                            >{{ p.label }}</button>
                        </div>
                        <div class="filter-hint">{{ $t('filter.dimReverseHint') }}</div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-title">{{ $t('filter.dimCustom') }}</div>
                        <div class="dim-input-row">
                            <span class="dim-row-label">{{ $t('filter.widthRange') }}</span>
                            <el-input-number
                                v-model="draft.widthMin"
                                :min="0"
                                :controls="false"
                                :placeholder="$t('filter.sizeMin')"
                                class="size-input"
                            />
                            <span class="size-sep">—</span>
                            <el-input-number
                                v-model="draft.widthMax"
                                :min="0"
                                :controls="false"
                                :placeholder="$t('filter.sizeMax')"
                                class="size-input"
                            />
                            <span class="dim-unit">px</span>
                        </div>
                        <div class="dim-input-row">
                            <span class="dim-row-label">{{ $t('filter.heightRange') }}</span>
                            <el-input-number
                                v-model="draft.heightMin"
                                :min="0"
                                :controls="false"
                                :placeholder="$t('filter.sizeMin')"
                                class="size-input"
                            />
                            <span class="size-sep">—</span>
                            <el-input-number
                                v-model="draft.heightMax"
                                :min="0"
                                :controls="false"
                                :placeholder="$t('filter.sizeMax')"
                                class="size-input"
                            />
                            <span class="dim-unit">px</span>
                        </div>
                        <div class="filter-hint">{{ $t('filter.dimHint') }}</div>
                    </div>
                </div>
            </el-tab-pane>
        </el-tabs>
        <template #footer>
            <div class="filter-dialog-footer">
                <el-button size="default" @click="clearAll" :disabled="draftCount === 0">{{ $t('filter.clearFilters') }}</el-button>
                <el-button size="default" type="primary" @click="apply">{{ $t('filter.apply') }}</el-button>
            </div>
        </template>
    </el-dialog>
</template>

<script>
import { CHANNEL_TYPES, CHANNEL_SHORT_LABEL } from '@/components/config/channel-schema';
import DateRangeCalendar from '@/components/DateRangeCalendar.vue';

const EMPTY_FILTERS = {
    accessStatus: [],
    listType: [],
    label: [],
    fileType: [],
    channel: [],
    channelName: [],
    uploadSource: [],
    backup: [],
    redirect: [],
    /* v2.8.9：有效期 / 名称状态 */
    validity: [],
    nameChanged: [],
    tags: [],
    tagNames: [],
    tagMode: 'or',
    /* v2.8.7：日期 / 大小筛选（与快捷筛选联动） */
    datePreset: '',
    dateFrom: '',
    dateTo: '',
    sizePreset: '',
    sizeMin: 0,
    sizeMax: 0,
    /* v2.8.9：大小口径（actual = 实际大小 / original = 原始大小） */
    sizeMode: 'actual',
    /* v2.8.9：尺寸筛选 */
    dimPreset: '',
    widthMin: 0,
    widthMax: 0,
    heightMin: 0,
    heightMax: 0
};

export default {
    name: 'FilterDialog',
    components: { DateRangeCalendar },
    props: {
        modelValue: { type: Boolean, default: false },
        filters: { type: Object, default: () => ({ ...EMPTY_FILTERS }) },
        channelNameOptions: { type: Array, default: () => [] },
        /** v2.8.7b：全部标签选项 [{ name, count }]，供「标签」标签页多选 */
        tagOptions: { type: Array, default: () => [] }
    },
    emits: ['update:modelValue', 'update:filters', 'change'],
    data() {
        return {
            activeTab: 'filter',
            draft: this.buildDraft(this.filters),
            draftDateRange: null,
            // v2.8.9：点「大小快捷项」时置位 —— 期间由预设回填输入框，不要被 syncCustomSize 清掉高亮
            presetLock: false
        };
    },
    computed: {
        dialogWidth() {
            return window.innerWidth <= 768 ? '94%' : '560px';
        },
        accessStatusOptions() {
            return [
                { label: this.$t('filter.normal'), value: 'normal' },
                { label: this.$t('filter.blocked'), value: 'blocked' }
            ];
        },
        listTypeOptions() {
            return [
                { label: this.$t('filter.whiteList'), value: 'White' },
                { label: this.$t('filter.blackList'), value: 'Block' },
                { label: this.$t('filter.notSet'), value: 'None' }
            ];
        },
        labelOptions() {
            return [
                { label: this.$t('filter.normal'), value: 'normal' },
                { label: this.$t('filter.teenContent'), value: 'teen' },
                { label: this.$t('filter.adultContent'), value: 'adult' }
            ];
        },
        fileTypeOptions() {
            return [
                { label: this.$t('filter.image'), value: 'image' },
                { label: this.$t('filter.video'), value: 'video' },
                { label: this.$t('filter.audio'), value: 'audio' },
                { label: this.$t('filter.other'), value: 'other' }
            ];
        },
        channelOptions() {
            return CHANNEL_TYPES.map((t) => ({
                label: t.label,
                value: CHANNEL_SHORT_LABEL[t.value] || t.value
            }));
        },
        backupOptions() {
            return [
                { label: this.$t('filter.backedUp'), value: 'backedup' },
                { label: this.$t('filter.unbackedUp'), value: 'unbackedup' }
            ];
        },
        uploadSourceOptions() {
            return [
                { label: this.$t('filter.uploadSourceDefault'), value: 'Default' },
                { label: this.$t('filter.uploadSourceUpload'), value: 'Upload' },
                { label: this.$t('filter.uploadSourceFetch'), value: 'Fetch' },
                { label: this.$t('filter.uploadSourceWebdav'), value: 'WebDAV' },
                { label: this.$t('filter.uploadSourceApiWeb'), value: 'API-Web' },
                { label: this.$t('filter.uploadSourceApiS3'), value: 'API-S3' }
            ];
        },
        redirectOptions() {
            return [
                { label: this.$t('dashboard.filterRedirectYes'), value: 'yes' },
                { label: this.$t('dashboard.filterRedirectNo'), value: 'no' }
            ];
        },
        /** v2.8.9：有效期（limited 已限时未过期 / expired 已过期 / permanent 永久） */
        validityOptions() {
            return [
                { label: this.$t('filter.validityLimited'), value: 'limited' },
                { label: this.$t('filter.validityExpired'), value: 'expired' },
                { label: this.$t('filter.validityPermanent'), value: 'permanent' }
            ];
        },
        /** v2.8.9：名称状态（changed 已改名 / unchanged 未改名） */
        nameStatusOptions() {
            return [
                { label: this.$t('filter.nameChangedYes'), value: 'changed' },
                { label: this.$t('filter.nameChangedNo'), value: 'unchanged' }
            ];
        },
        /** v2.8.9：尺寸快捷项（值与后端 matchDimPreset 一致） */
        dimPresetOptions() {
            return [
                { label: this.$t('filter.dimLandscape'), value: 'landscape' },
                { label: this.$t('filter.dimPortrait'), value: 'portrait' },
                { label: this.$t('filter.dimSquare'), value: 'square' },
                { label: this.$t('filter.dim4x3'), value: 'ratio-4-3' },
                { label: this.$t('filter.dim16x9'), value: 'ratio-16-9' },
                { label: this.$t('filter.dim360p'), value: '360p' },
                { label: this.$t('filter.dim480p'), value: '480p' },
                { label: this.$t('filter.dim720p'), value: '720p' },
                { label: this.$t('filter.dim1080p'), value: '1080p' },
                { label: this.$t('filter.dim2k'), value: '2k' },
                { label: this.$t('filter.dim4k'), value: '4k' },
                { label: this.$t('filter.dim8k'), value: '8k' }
            ];
        },
        tagPresenceOptions() {
            return [
                { label: this.$t('filter.hasTags'), value: 'has' },
                { label: this.$t('filter.noTags'), value: 'none' }
            ];
        },
        /** v2.8.7：日期快捷选项（相对今天计算）；v2.8.7b 新增「本年内」 */
        datePresetOptions() {
            return [
                { label: this.$t('filter.dateToday'), value: 'today' },
                { label: this.$t('filter.dateYesterday'), value: 'yesterday' },
                { label: this.$t('filter.dateBeforeYesterday'), value: 'beforeYesterday' },
                { label: this.$t('filter.dateThisWeek'), value: 'thisWeek' },
                { label: this.$t('filter.dateLastWeek'), value: 'lastWeek' },
                { label: this.$t('filter.dateThisMonth'), value: 'thisMonth' },
                { label: this.$t('filter.dateThisYear'), value: 'thisYear' }
            ];
        },
        /** v2.8.7：大小快捷选项（字节） */
        sizePresetOptions() {
            return [
                { label: this.$t('filter.sizeLess100K'), value: 'lt100k', min: 0, max: 100 * 1024 },
                { label: this.$t('filter.sizeLess1M'), value: 'lt1m', min: 0, max: 1024 * 1024 },
                { label: this.$t('filter.sizeLess10M'), value: 'lt10m', min: 0, max: 10 * 1024 * 1024 },
                { label: this.$t('filter.sizeLess100M'), value: 'lt100m', min: 0, max: 100 * 1024 * 1024 },
                { label: this.$t('filter.sizeGt100M'), value: 'gt100m', min: 100 * 1024 * 1024, max: 0 }
            ];
        },
        groupedChannelNames() {
            const groups = {};
            this.channelNameOptions.forEach(option => {
                if (!groups[option.type]) {
                    groups[option.type] = { type: option.type, typeLabel: option.typeLabel, channels: [] };
                }
                groups[option.type].channels.push(option);
            });
            return Object.values(groups);
        },
        /** v2.8.7b：各标签页是否有已选值（标签名上显示小圆点提示） */
        tabHasValue() {
            const d = this.draft;
            return {
                filter: ['accessStatus', 'listType', 'label', 'fileType', 'channel', 'channelName', 'uploadSource', 'backup', 'redirect', 'validity', 'nameChanged']
                    .some((k) => (d[k] || []).length > 0),
                tags: (d.tags || []).length > 0 || (d.tagNames || []).length > 0,
                date: !!(d.dateFrom || d.dateTo),
                size: (Number(d.sizeMin) || 0) > 0 || (Number(d.sizeMax) || 0) > 0 || d.sizeMode === 'original',
                dimension:
                    !!d.dimPreset ||
                    (Number(d.widthMin) || 0) > 0 || (Number(d.widthMax) || 0) > 0 ||
                    (Number(d.heightMin) || 0) > 0 || (Number(d.heightMax) || 0) > 0
            };
        },
        /** 草稿里的有效条件数（弹窗内实时统计，供「清除筛选」按钮禁用态） */
        draftCount() {
            const d = this.draft;
            let n = 0;
            for (const k of ['accessStatus', 'listType', 'label', 'fileType', 'channel', 'channelName', 'uploadSource', 'backup', 'redirect', 'validity', 'nameChanged', 'tags', 'tagNames']) {
                n += (d[k] || []).length;
            }
            if (d.dateFrom || d.dateTo) n += 1;
            if (d.sizeMin > 0 || d.sizeMax > 0) n += 1;
            if (d.sizeMode === 'original') n += 1;
            if (
                d.dimPreset ||
                d.widthMin > 0 || d.widthMax > 0 || d.heightMin > 0 || d.heightMax > 0
            ) n += 1;
            return n;
        }
    },
    methods: {
        buildDraft(src) {
            const s = src || {};
            return {
                accessStatus: Array.isArray(s.accessStatus) ? [...s.accessStatus] : [],
                listType: Array.isArray(s.listType) ? [...s.listType] : [],
                label: Array.isArray(s.label) ? [...s.label] : [],
                fileType: Array.isArray(s.fileType) ? [...s.fileType] : [],
                channel: Array.isArray(s.channel) ? [...s.channel] : [],
                channelName: Array.isArray(s.channelName) ? [...s.channelName] : [],
                uploadSource: Array.isArray(s.uploadSource) ? [...s.uploadSource] : [],
                backup: Array.isArray(s.backup) ? [...s.backup] : [],
                redirect: Array.isArray(s.redirect) ? [...s.redirect] : [],
                tags: Array.isArray(s.tags) ? [...s.tags] : [],
                tagNames: Array.isArray(s.tagNames) ? [...s.tagNames] : [],
                tagMode: s.tagMode === 'and' ? 'and' : 'or',
                datePreset: s.datePreset || '',
                dateFrom: s.dateFrom || '',
                dateTo: s.dateTo || '',
                sizePreset: s.sizePreset || '',
                sizeMin: Number(s.sizeMin) || 0,
                sizeMax: Number(s.sizeMax) || 0,
                sizeMinValue: s.sizeMin > 0 ? this.bytesToValue(Number(s.sizeMin)) : undefined,
                sizeMaxValue: s.sizeMax > 0 ? this.bytesToValue(Number(s.sizeMax)) : undefined,
                sizeUnit: s.sizeUnit || 'MB',
                // v2.8.9
                validity: Array.isArray(s.validity) ? [...s.validity] : [],
                nameChanged: Array.isArray(s.nameChanged) ? [...s.nameChanged] : [],
                sizeMode: s.sizeMode === 'original' ? 'original' : 'actual',
                dimPreset: s.dimPreset || '',
                widthMin: Number(s.widthMin) || 0,
                widthMax: Number(s.widthMax) || 0,
                heightMin: Number(s.heightMin) || 0,
                heightMax: Number(s.heightMax) || 0
            };
        },
        bytesToValue(bytes) {
            if (bytes >= 1024 * 1024 * 1024) return Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100;
            if (bytes >= 1024 * 1024) return Math.round((bytes / (1024 * 1024)) * 100) / 100;
            return Math.round((bytes / 1024) * 100) / 100;
        },
        unitBytes() {
            return this.draft.sizeUnit === 'GB' ? 1024 ** 3 : this.draft.sizeUnit === 'KB' ? 1024 : 1024 ** 2;
        },
        /** v2.8.7b：标签页内勾选 / 取消具体标签 */
        toggleTagName(name) {
            const i = this.draft.tagNames.indexOf(name);
            if (i === -1) this.draft.tagNames.push(name);
            else this.draft.tagNames.splice(i, 1);
        },
        /** 弹窗打开时：以父组件已应用的 filters 重置草稿 */
        syncDraft() {
            this.activeTab = 'filter';
            this.draft = this.buildDraft(this.filters);
            this.draftDateRange = this.draft.dateFrom && this.draft.dateTo ? [this.draft.dateFrom, this.draft.dateTo] : null;
        },
        /** 日期快捷预设 → 覆盖日历范围 */
        applyDatePreset(value) {
            const preset = this.draft.datePreset === value ? '' : value;
            this.draft.datePreset = preset;
            if (!preset) {
                this.draft.dateFrom = '';
                this.draft.dateTo = '';
                this.draftDateRange = null;
                return;
            }
            const fmt = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            };
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const day = 86400000;
            let from = today;
            let to = today;
            if (preset === 'yesterday') {
                from = new Date(today.getTime() - day);
                to = from;
            } else if (preset === 'beforeYesterday') {
                from = new Date(today.getTime() - 2 * day);
                to = from;
            } else if (preset === 'thisWeek') {
                const dow = (today.getDay() + 6) % 7; // 周一 = 0
                from = new Date(today.getTime() - dow * day);
            } else if (preset === 'lastWeek') {
                const dow = (today.getDay() + 6) % 7;
                const monday = new Date(today.getTime() - (dow + 7) * day);
                from = monday;
                to = new Date(monday.getTime() + 6 * day);
            } else if (preset === 'thisMonth') {
                from = new Date(now.getFullYear(), now.getMonth(), 1);
                to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            } else if (preset === 'thisYear') {
                // v2.8.7b：本年内（1 月 1 日 ~ 12 月 31 日）
                from = new Date(now.getFullYear(), 0, 1);
                to = new Date(now.getFullYear(), 11, 31);
            }
            this.draft.dateFrom = fmt(from);
            this.draft.dateTo = fmt(to);
            this.draftDateRange = [this.draft.dateFrom, this.draft.dateTo];
        },
        /** 日历手动选范围 → 清掉快捷预设 */
        handleDraftDateRange(range) {
            if (Array.isArray(range) && range.length === 2 && range[0] && range[1]) {
                this.draft.dateFrom = range[0];
                this.draft.dateTo = range[1];
            } else {
                this.draft.dateFrom = '';
                this.draft.dateTo = '';
            }
            this.draft.datePreset = '';
        },
        /**
         * 大小快捷预设（v2.8.9）：
         *   点一下 → 把区间换算成本身最合适的单位，直接填进「自定义」的输入框（清掉旧值再填），
         *   这样用户能看清具体数值并在此基础上微调；再点同一个则取消。
         */
        applySizePreset(value) {
            const hit = this.sizePresetOptions.find((p) => p.value === value);
            this.presetLock = true;
            if (this.draft.sizePreset === value) {
                this.draft.sizePreset = '';
                this.$nextTick(() => { this.presetLock = false; });
                return;
            }
            if (!hit) {
                this.$nextTick(() => { this.presetLock = false; });
                return;
            }
            // 以较大的那个边界值决定单位（100KB / 100MB 这类整值会落到整单位上）
            const base = hit.max > 0 ? hit.max : hit.min;
            const unit = base >= 1024 ** 3 && base % 1024 ** 3 === 0
                ? 'GB'
                : base >= 1024 ** 2 && base % 1024 ** 2 === 0
                    ? 'MB'
                    : 'KB';
            const unitBytes = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024;
            this.draft.sizePreset = value;
            this.draft.sizeUnit = unit;
            this.draft.sizeMinValue = hit.min > 0 ? hit.min / unitBytes : undefined;
            this.draft.sizeMaxValue = hit.max > 0 ? hit.max / unitBytes : undefined;
            this.draft.sizeMin = hit.min;
            this.draft.sizeMax = hit.max;
            this.$nextTick(() => { this.presetLock = false; });
        },
        /** v2.8.9：尺寸快捷项（点同一个取消） */
        applyDimPreset(value) {
            this.draft.dimPreset = this.draft.dimPreset === value ? '' : value;
        },
        /** 自定义大小输入变化 → 清掉快捷预设，实时换算字节 */
        syncCustomSize() {
            // 预设回填输入框的过程中不要反向清掉高亮
            if (this.presetLock) return;
            this.draft.sizePreset = '';
            const unit = this.unitBytes();
            this.draft.sizeMin = this.draft.sizeMinValue > 0 ? Math.round(this.draft.sizeMinValue * unit) : 0;
            this.draft.sizeMax = this.draft.sizeMaxValue > 0 ? Math.round(this.draft.sizeMaxValue * unit) : 0;
        },
        /** 确定：把草稿应用到父组件（所有条件一起提交后端联合查询） */
        apply() {
            const out = {
                accessStatus: [...this.draft.accessStatus],
                listType: [...this.draft.listType],
                label: [...this.draft.label],
                fileType: [...this.draft.fileType],
                channel: [...this.draft.channel],
                // v2.8.7b：渠道名按纯名称提交（与后端匹配口径一致）
                channelName: [...this.draft.channelName],
                uploadSource: [...this.draft.uploadSource],
                backup: [...this.draft.backup],
                redirect: [...this.draft.redirect],
                tags: [...this.draft.tags],
                tagNames: [...(this.draft.tagNames || [])],
                tagMode: this.draft.tagMode || 'or',
                datePreset: this.draft.datePreset,
                dateFrom: this.draft.dateFrom,
                dateTo: this.draft.dateTo,
                sizePreset: this.draft.sizePreset,
                sizeMin: this.draft.sizeMin,
                sizeMax: this.draft.sizeMax,
                sizeUnit: this.draft.sizeUnit,
                // v2.8.9
                validity: [...(this.draft.validity || [])],
                nameChanged: [...(this.draft.nameChanged || [])],
                sizeMode: this.draft.sizeMode === 'original' ? 'original' : 'actual',
                dimPreset: this.draft.dimPreset || '',
                widthMin: Number(this.draft.widthMin) || 0,
                widthMax: Number(this.draft.widthMax) || 0,
                heightMin: Number(this.draft.heightMin) || 0,
                heightMax: Number(this.draft.heightMax) || 0
            };
            this.$emit('update:filters', out);
            this.$emit('change', { type: 'dialog', filters: out });
            this.$emit('update:modelValue', false);
        },
        /** 清除筛选：草稿 + 已应用条件全部清空并立即生效 */
        clearAll() {
            this.draft = this.buildDraft(null);
            this.draftDateRange = null;
            this.$emit('update:filters', { ...EMPTY_FILTERS });
            this.$emit('change', { type: 'clear', filters: { ...EMPTY_FILTERS } });
        }
    },
    watch: {
        'draft.sizeMinValue'() { this.syncCustomSize(); },
        'draft.sizeMaxValue'() { this.syncCustomSize(); },
        'draft.sizeUnit'() { this.syncCustomSize(); },
        // v2.8.9：手动改宽/高时取消「快捷尺寸」高亮
        'draft.widthMin'() { this.draft.dimPreset = ''; },
        'draft.widthMax'() { this.draft.dimPreset = ''; },
        'draft.heightMin'() { this.draft.dimPreset = ''; },
        'draft.heightMax'() { this.draft.dimPreset = ''; }
    }
};
</script>

<style scoped>
/* 弹窗主体各分区沿用原 FilterDropdown 的层级样式；弹窗整体高度 / 居中在下方非 scoped 块（append-to-body） */
.filter-dialog-body {
    height: 100%;
    overflow-y: auto;
    padding: 0 4px;
}
.filter-section {
    margin-bottom: 14px;
}
.filter-title {
    font-size: 12px;
    font-weight: 600;
    opacity: 0.75;
    margin-bottom: 6px;
}
.filter-options {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
}
.channel-divider {
    width: 100%;
    height: 1px;
    margin: 6px 0;
    background: var(--glass-border, rgba(128, 128, 128, 0.25));
}
.channel-group-title {
    width: 100%;
    font-size: 11px;
    opacity: 0.6;
    margin: 2px 0;
}
.filter-hint {
    font-size: 11px;
    opacity: 0.55;
    margin: 6px 0;
}
/* v2.8.7b：标签页名 + 有值小圆点 */
.filter-tab-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}
.filter-tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--el-color-primary);
    flex: 0 0 auto;
}
/* v2.8.7b：标签页内的「或 / 且」模式切换 */
.tag-mode-group {
    margin-top: 8px;
}
/* 标签 chips 容器（复用 quick-chip 样式） */
.tag-name-options {
    gap: 8px;
}

/* 快捷筛选 chips（与系统状态页单选组观感一致：圆角、选中主题色） */
.quick-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 4px;
}
.quick-chip {
    padding: 5px 14px;
    font-size: 12px;
    border-radius: 14px;
    border: 1px solid var(--glass-border, rgba(128, 128, 128, 0.3));
    background: transparent;
    color: var(--upload-text-color, inherit);
    cursor: pointer;
    transition: all 0.18s ease;
}
.quick-chip:hover {
    border-color: var(--primary-color-accent, var(--el-color-primary));
}
.quick-chip.is-active {
    background: color-mix(in srgb, var(--primary-color, var(--el-color-primary)) 16%, transparent);
    border-color: var(--primary-color-accent, var(--el-color-primary));
    color: var(--primary-color-accent, var(--el-color-primary));
}

/* 自定义大小输入行 */
.size-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.size-input {
    flex: 1 1 0;
    min-width: 0;
}
.size-sep {
    opacity: 0.55;
}
.size-unit-select {
    width: 86px;
    flex-shrink: 0;
}
/* v2.8.9：尺寸筛选的自定义宽高行 */
.dim-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}
.dim-input-row:last-child {
    margin-bottom: 0;
}
.dim-row-label {
    flex: 0 0 40px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.dim-unit {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
/*
 * v2.8.9：筛选标签行在移动端手指左右滑动。
 * 之前只给 .el-tabs__nav-wrap 加 overflow-x:auto 没生效 —— 标签超宽时 el-tabs 会进入
 * scrollable 模式：真正裁剪滚动的是内层 .el-tabs__nav-scroll（overflow:hidden），
 * nav 靠 translateX 内联样式移动，两侧还有 prev/next 箭头按钮。
 * 所以必须四处一起覆盖：wrap 变滚动容器 + nav-scroll 放开裁剪 + nav 强制归位
 * （transform:none，手指滑动交给 wrap 的原生滚动）+ 箭头隐藏。
 */
@media (max-width: 768px) {
    .filter-dialog-tabs :deep(.el-tabs__nav-wrap) {
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
    }
    /* scrollable 模式 wrap 自带左右 20px 箭头预留 padding，重置掉 */
    .filter-dialog-tabs :deep(.el-tabs__nav-wrap.is-scrollable) {
        padding: 0 !important;
    }
    .filter-dialog-tabs :deep(.el-tabs__nav-wrap)::-webkit-scrollbar {
        display: none;
    }
    /* 底部灰线画在 wrap 上，随内容滚动会错位，隐藏（tab 自带激活色足够） */
    .filter-dialog-tabs :deep(.el-tabs__nav-wrap)::after {
        display: none;
    }
    .filter-dialog-tabs :deep(.el-tabs__nav-scroll) {
        overflow: visible !important;
    }
    .filter-dialog-tabs :deep(.el-tabs__nav-prev),
    .filter-dialog-tabs :deep(.el-tabs__nav-next) {
        display: none !important;
    }
    .filter-dialog-tabs :deep(.el-tabs__nav) {
        transform: none !important;
        display: flex;
        flex-wrap: nowrap;
    }
}

/* 底部按钮 */
.filter-dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
}
</style>

<style>
/*
 * v2.8.7b：弹窗整体布局 —— append-to-body 后弹窗 DOM 挂在 body 下，
 * scoped 样式命不中 el-dialog 内部结构，这里用全局作用域（.filter-dialog 为本弹窗专属类）。
 * 高度固定为视口 96%（所有标签页一致，切换不跳动），配合 align-center 水平垂直居中。
 */
.filter-dialog {
    height: 96vh;
    max-height: 96vh;
    display: flex;
    flex-direction: column;
    margin: 0 auto !important;
}
.filter-dialog .el-dialog__header {
    flex: 0 0 auto;
}
.filter-dialog .el-dialog__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    padding-top: 8px;
    padding-bottom: 8px;
}
.filter-dialog .el-dialog__footer {
    flex: 0 0 auto;
}
/* 标签页撑满弹窗主体：tabs → content → pane → body 全链路高度 */
.filter-dialog .filter-dialog-tabs {
    height: 100%;
    display: flex;
    flex-direction: column;
}
.filter-dialog .filter-dialog-tabs > .el-tabs__content {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
}
.filter-dialog .filter-dialog-tabs .el-tab-pane {
    height: 100%;
}
</style>
