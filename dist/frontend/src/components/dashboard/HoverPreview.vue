<template>
    <!--
        v2.8.5：后台文件管理「悬停预览大图」浮层（仅 PC）。
        - 视频自动播放（静音循环），图片按原始比例展示
        - 智能左右定位：锚点在屏幕左半 → 浮层在锚点右侧，反之在左侧
        - 媒体比例未知（未加载完成）时按 90vh 高度占位，加载后按真实比例收敛
        - 地址与卡片/列表缩略图同源（/file/xxx?from=admin），浏览器缓存复用
    -->
    <teleport to="body">
        <div
            v-if="visible"
            ref="popupRef"
            class="hover-preview-popup"
            :style="popupStyle"
        >
            <video
                v-if="type === 'video'"
                :src="src"
                autoplay
                muted
                loop
                class="hover-preview-media"
                @loadedmetadata="onMediaLoad"
            ></video>
            <img
                v-else
                :src="src"
                class="hover-preview-media"
                decoding="async"
                @load="onMediaLoad"
            />
        </div>
    </teleport>
</template>

<script>
export default {
    name: 'HoverPreview',
    props: {
        visible: { type: Boolean, default: false },
        // 锚点（鼠标位置，视口坐标）
        x: { type: Number, default: 0 },
        y: { type: Number, default: 0 },
        src: { type: String, default: '' },
        type: { type: String, default: 'image' }, // 'image' | 'video'
    },
    data() {
        return {
            ratio: null, // 加载完成后算出的宽高比（w/h），null = 比例未知
        };
    },
    computed: {
        popupStyle() {
            const innerW = window.innerWidth;
            const innerH = window.innerHeight;
            const maxH = innerH * 0.9;
            const maxW = innerW * 0.9;
            let w = null;
            let h = maxH; // 比例未知 → 高 90vh，宽度自适应内容
            if (this.ratio) {
                h = Math.min(maxH, innerH - 16);
                w = h * this.ratio;
                if (w > maxW) {
                    w = maxW;
                    h = w / this.ratio;
                }
            }
            // 智能左右：锚点在左半屏 → 浮层放右侧；否则放左侧
            const onRight = this.x <= innerW / 2;
            const gap = 18;
            let left;
            if (onRight) {
                left = Math.min(this.x + gap, innerW - (w || 320) - 8);
            } else if (w !== null) {
                left = Math.max(this.x - gap - w, 8);
            } else {
                // 宽度未知时用 transform 兜底
                left = Math.max(this.x - gap, 8);
            }
            const top = Math.min(Math.max(this.y - h / 2, 8), innerH - h - 8);
            const style = {
                top: `${top}px`,
                left: `${left}px`,
                height: `${h}px`,
            };
            if (w !== null) style.width = `${w}px`;
            else style.maxWidth = `${maxW}px`;
            if (!onRight && w === null) style.transform = 'translateX(-100%)';
            return style;
        },
    },
    watch: {
        // 切换文件时重置比例，回到「比例未知」的 90vh 占位
        src() {
            this.ratio = null;
        },
        visible(v) {
            if (!v) this.ratio = null;
        },
    },
    methods: {
        onMediaLoad(e) {
            const el = e.target;
            const w = el.videoWidth || el.naturalWidth;
            const h = el.videoHeight || el.naturalHeight;
            if (w && h) this.ratio = w / h;
        },
    },
};
</script>

<style scoped>
.hover-preview-popup {
    position: fixed;
    z-index: 3600;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--el-bg-color, #fff);
    border: 1px solid var(--el-border-color-light, #e4e7ed);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: var(--el-box-shadow-light, 0 4px 16px rgba(0, 0, 0, 0.18));
    pointer-events: none; /* 纯展示浮层：不挡鼠标，避免与锚点 hover 互相打架 */
}
.hover-preview-media {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
}
</style>
