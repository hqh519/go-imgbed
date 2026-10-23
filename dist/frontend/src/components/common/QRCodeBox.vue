<template>
  <div class="qr-code-box">
    <canvas ref="canvas" class="qr-canvas"></canvas>
    <div v-if="!value" class="qr-empty">{{ emptyText }}</div>
  </div>
</template>

<script>
import qrcode from 'qrcode-generator';

/**
 * 通用二维码组件（纯浏览器渲染，不落任何文件）。
 *
 * 用途：文件详情页的「二维码」标签、两步验证绑定页的 otpauth 二维码，
 * 以及以后任何需要出码的地方 —— 统一走这一个组件，避免各处各写一套。
 *
 * 实现：qrcode-generator（零依赖，约 10KB）只负责算出点阵，
 * 绘制交给 canvas，因此颜色 / 尺寸 / 留白都能按主题调整。
 */
export default {
    name: 'QRCodeBox',
    props: {
        /** 二维码内容（URL / otpauth:// 链接 / 任意文本） */
        value: { type: String, default: '' },
        /** 渲染尺寸（CSS px） */
        size: { type: Number, default: 220 },
        /** 纠错级别：L / M / Q / H */
        level: { type: String, default: 'M' },
        emptyText: { type: String, default: '暂无内容' },
    },
    watch: {
        value() { this.render(); },
        size() { this.render(); },
        level() { this.render(); },
    },
    mounted() {
        this.render();
    },
    methods: {
        render() {
            const canvas = this.$refs.canvas;
            if (!canvas) return;
            const px = Math.max(64, Number(this.size) || 220);
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.round(px * dpr);
            canvas.height = Math.round(px * dpr);
            canvas.style.width = `${px}px`;
            canvas.style.height = `${px}px`;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, px, px);

            const text = String(this.value || '').trim();
            if (!text) return;
            try {
                const qr = qrcode(0, this.level);
                qr.addData(text);
                qr.make();
                const count = qr.getModuleCount();
                const cell = px / count;
                ctx.fillStyle = '#000000';
                for (let row = 0; row < count; row += 1) {
                    for (let col = 0; col < count; col += 1) {
                        if (!qr.isDark(row, col)) continue;
                        // 用 ceil 让相邻模块之间不留缝（浮点取整会产生白线）
                        ctx.fillRect(
                            Math.floor(col * cell),
                            Math.floor(row * cell),
                            Math.ceil(cell),
                            Math.ceil(cell),
                        );
                    }
                }
                this.$emit('rendered');
            } catch (e) {
                // 内容过长等异常不阻塞页面：留白即可
                console.warn('二维码生成失败:', e);
            }
        },
        /** 导出 dataURL（下载 / 复制图片时用） */
        toDataURL() {
            return this.$refs.canvas?.toDataURL('image/png') || '';
        },
    },
};
</script>

<style scoped>
.qr-code-box {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    background: #fff;
    border-radius: 8px;
    line-height: 0;
}
.qr-canvas { display: block; border-radius: 4px; }
.qr-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: #909399;
    line-height: 1.4;
}
</style>
