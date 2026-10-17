<template>
    <div class="channel-fields">
        <el-form-item
            v-for="field in renderedFields"
            :key="field.key"
            :required="!!field.required"
        >
            <template #label>
                <span>{{ field.label }}</span>
                <el-tooltip v-if="field.tip" :content="field.tip" placement="top">
                    <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                </el-tooltip>
            </template>

            <!-- 开关 -->
            <el-switch v-if="field.type === 'switch'" v-model="model[field.key]"/>

            <!-- 下拉选择 -->
            <el-select
                v-else-if="field.type === 'select'"
                v-model="model[field.key]"
                :placeholder="field.placeholder"
                style="width: 100%; max-width: 320px;"
            >
                <el-option
                    v-for="opt in (field.options || [])"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                />
            </el-select>

            <!-- 数字 -->
            <el-input-number
                v-else-if="field.type === 'number'"
                v-model="model[field.key]"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                :precision="field.precision"
                controls-position="right"
            />

            <!-- 多行文本 -->
            <el-input
                v-else-if="field.type === 'textarea'"
                v-model="model[field.key]"
                type="textarea"
                :autosize="{ minRows: 2 }"
                :placeholder="field.placeholder"
            />

            <!-- 密码 -->
            <el-input
                v-else-if="field.type === 'password'"
                v-model="model[field.key]"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="field.placeholder"
            />

            <!-- 普通文本 -->
            <el-input
                v-else
                v-model="model[field.key]"
                :placeholder="field.placeholder"
            />
        </el-form-item>
    </div>
</template>

<script>
/**
 * 渠道配置动态字段渲染器。
 * 由 channel-schema.js 的字段定义驱动，避免为 9 种渠道手写 9 套表单。
 * 支持字段级 showWhen 联动（例如「启用容量限制」未开启时隐藏容量上限 / 告警阈值）。
 */
import { visibleFields } from './channel-schema';

export default {
    name: 'ChannelFields',
    props: {
        fields: { type: Array, default: () => [] },
        model: { type: Object, required: true }
    },
    computed: {
        renderedFields() {
            return visibleFields(this.fields, this.model);
        }
    }
};
</script>

<style scoped>
.channel-fields :deep(.el-input-number) {
    /* Element Plus 默认 150px，在表单里宽度不统一；统一为「最多 320px、窄屏撑满」 */
    width: 100%;
    max-width: 320px;
}

@media (max-width: 768px) {
    .channel-fields :deep(.el-input-number) {
        max-width: none;
    }
}

.inline-help-icon {
    color: var(--el-text-color-secondary);
    cursor: pointer;
    font-size: 13px;
    margin-left: 6px;
    transition: color 0.2s;
}

.inline-help-icon:hover {
    color: var(--el-color-primary);
}
</style>
