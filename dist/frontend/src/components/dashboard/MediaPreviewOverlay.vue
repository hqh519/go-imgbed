<template>
    <!--
      文件管理 · 媒体预览浮层（v2.9.0）

      触发点（卡片 / 列表视图都一样）：
        · 点缩略图 / 封面 → 本浮层（图片灯箱 / 视频播放器 / 音频播放器 / 其它通用弹窗）
        · 点文件名       → 文件详情页（行为不变）

      四套形态：
        1. 图片灯箱：全屏、左右切换、底部缩略图条、左上角文件名、
           顶部「幻灯片播放 + 速度」「实际大小 / 适应窗口」「关闭」
        2. 视频播放器：全屏播放 + 左上角名称 + 右上角关闭 +
           右下角「更多设置」（播放速度、单片循环 / 随机 / 顺序）
        3. 音频播放器：汇集当前页全部音频，成列表点播
        4. 其它类型：通用信息弹窗（复制链接 / 打开 / 查看详情）

      所有操作按钮 2 秒无操作自动隐藏，鼠标移动 / 触摸即重新出现；
      键盘：← → 切换，Esc 关闭，空格 播放/暂停幻灯片。
    -->
    <div
        v-if="modelValue"
        class="media-viewer"
        :class="{ 'is-idle': !controlsVisible }"
        @mousemove="bumpControls"
        @touchstart.passive="bumpControls"
    >
        <!-- 背景遮罩：灰系偏暗、带透明度 + 轻微模糊 -->
        <div class="mv-backdrop" @click="close"></div>

        <!-- ── 顶栏 ───────────────────────────────────────────── -->
        <div class="mv-top">
            <div class="mv-title" :title="current.name">
                <span class="mv-title-name">{{ current.name }}</span>
                <span v-if="current.sizeText" class="mv-title-meta">{{ current.sizeText }}</span>
            </div>
            <div class="mv-tools">
                <template v-if="current.kind === 'image'">
                    <!-- 幻灯片播放 + 速度 -->
                    <button
                        type="button"
                        class="mv-btn"
                        :class="{ 'is-on': slideshowOn }"
                        :title="$t('mediaViewer.slideshow')"
                        :aria-label="$t('mediaViewer.slideshow')"
                        @click.stop="toggleSlideshow"
                    >
                        <font-awesome-icon :icon="slideshowOn ? 'pause' : 'play'"/>
                    </button>
                    <!-- 幻灯片速度：用内联面板而不是 el-dropdown ——
                         浮层 z-index 高于 EP 弹层，teleport 出去的 popper 会被盖住 -->
                    <div class="mv-inline-menu">
                        <button
                            type="button"
                            class="mv-btn mv-btn-text"
                            :class="{ 'is-on': slideMenuOpen }"
                            :title="$t('mediaViewer.slideshowSpeed')"
                            @click.stop="toggleSlideMenu"
                        >{{ slideSpeed }}s</button>
                        <div v-if="slideMenuOpen" class="mv-menu-panel mv-slide-menu" @click.stop>
                            <div class="mv-menu-label">{{ $t('mediaViewer.slideshowSpeed') }}</div>
                            <div class="mv-menu-chips">
                                <button
                                    v-for="s in slideSpeedOptions"
                                    :key="'sp' + s"
                                    type="button"
                                    class="mv-chip"
                                    :class="{ 'is-active': s === slideSpeed }"
                                    @click="setSlideSpeed(s)"
                                >{{ $t('mediaViewer.speedPerFrame', { s }) }}</button>
                            </div>
                        </div>
                    </div>
                    <!-- 实际大小 / 适应窗口 -->
                    <button
                        type="button"
                        class="mv-btn"
                        :title="fitMode === 'actual' ? $t('mediaViewer.fitWindow') : $t('mediaViewer.actualSize')"
                        :aria-label="fitMode === 'actual' ? $t('mediaViewer.fitWindow') : $t('mediaViewer.actualSize')"
                        @click.stop="toggleFit"
                    >
                        <font-awesome-icon :icon="fitMode === 'actual' ? 'compress-alt' : 'expand-alt'"/>
                    </button>
                    <span class="mv-tools-sep"></span>
                </template>
                <button
                    type="button"
                    class="mv-btn mv-close"
                    :title="$t('common.close')"
                    :aria-label="$t('common.close')"
                    @click.stop="close"
                >
                    <font-awesome-icon icon="times"/>
                </button>
            </div>
        </div>

        <!-- ── 主舞台 ─────────────────────────────────────────── -->
        <div class="mv-stage" @click.self="close">
            <!-- 图片 -->
            <div v-if="current.kind === 'image'" class="mv-image-wrap" :class="{ 'is-actual': fitMode === 'actual' }">
                <img :src="current.url" :alt="current.name" class="mv-image" @click.stop="toggleFit"/>
            </div>

            <!-- 视频 -->
            <div v-else-if="current.kind === 'video'" class="mv-video-wrap" @click.stop>
                <video
                    ref="videoEl"
                    :src="current.url"
                    class="mv-video"
                    controls
                    autoplay
                    playsinline
                    @ended="handleVideoEnded"
                ></video>

                <!-- 右下角：更多设置（播放速度 + 播放模式） -->
                <div class="mv-video-settings">
                    <button
                        type="button"
                        class="mv-btn"
                        :class="{ 'is-on': videoMenuOpen }"
                        :title="$t('mediaViewer.videoSettings')"
                        :aria-label="$t('mediaViewer.videoSettings')"
                        @click.stop="toggleVideoMenu"
                    >
                        <font-awesome-icon icon="cog"/>
                    </button>
                    <div v-if="videoMenuOpen" class="mv-menu-panel mv-video-menu" @click.stop>
                        <div class="mv-menu-label">{{ $t('mediaViewer.playbackSpeed') }}</div>
                        <div class="mv-menu-chips">
                            <button
                                v-for="r in videoRateOptions"
                                :key="'rate' + r"
                                type="button"
                                class="mv-chip"
                                :class="{ 'is-active': videoRate === r }"
                                @click="setVideoRate(r)"
                            >{{ r }}×</button>
                        </div>
                        <div class="mv-menu-label">{{ $t('mediaViewer.playMode') }}</div>
                        <div class="mv-menu-chips">
                            <button
                                v-for="m in videoModes"
                                :key="m.value"
                                type="button"
                                class="mv-chip"
                                :class="{ 'is-active': videoMode === m.value }"
                                @click="setVideoMode(m.value)"
                            >{{ m.label }}</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 音频：当前页音频合集成播放列表 -->
            <div v-else-if="current.kind === 'audio'" class="mv-audio" @click.stop>
                <div class="mv-audio-head">
                    <font-awesome-icon icon="music" class="mv-audio-icon"/>
                    <div class="mv-audio-title">
                        <div class="mv-audio-name">{{ current.name }}</div>
                        <div class="mv-audio-sub">{{ $t('mediaViewer.audioCount', { count: audioItems.length }) }}</div>
                    </div>
                </div>
                <audio ref="audioEl" :src="current.url" controls autoplay class="mv-audio-player" @ended="handleAudioEnded"></audio>
                <div class="mv-audio-list">
                    <button
                        v-for="(a, i) in audioItems"
                        :key="'audio' + i"
                        type="button"
                        class="mv-audio-item"
                        :class="{ 'is-active': i === audioIndex }"
                        @click="playAudioAt(i)"
                    >
                        <span class="mv-audio-item-no">{{ i + 1 }}</span>
                        <span class="mv-audio-item-name" :title="a.name">{{ a.name }}</span>
                        <span class="mv-audio-item-size">{{ a.sizeText }}</span>
                        <font-awesome-icon :icon="i === audioIndex ? 'volume-up' : 'play'" class="mv-audio-item-icon"/>
                    </button>
                </div>
            </div>

            <!-- 其它类型：通用弹窗 -->
            <div v-else class="mv-other" @click.stop>
                <div class="mv-other-icon">
                    <font-awesome-icon icon="file" class="mv-other-glyph"/>
                    <span class="mv-other-ext">{{ (current.ext || 'file').toUpperCase() }}</span>
                </div>
                <div class="mv-other-name" :title="current.name">{{ current.name }}</div>
                <div class="mv-other-meta">
                    <span v-if="current.sizeText">{{ current.sizeText }}</span>
                    <span v-if="current.user">{{ current.user }}</span>
                </div>
                <div class="mv-other-actions">
                    <el-button size="small" @click="copyLink">
                        <font-awesome-icon icon="copy" class="mv-other-btn-icon"/>{{ $t('mediaViewer.copyLink') }}
                    </el-button>
                    <el-button size="small" @click="openLink">
                        <font-awesome-icon icon="external-link-alt" class="mv-other-btn-icon"/>{{ $t('mediaViewer.openLink') }}
                    </el-button>
                    <el-button size="small" type="primary" @click="goDetail">
                        {{ $t('mediaViewer.viewDetail') }}
                    </el-button>
                </div>
            </div>

            <!-- 左右切换（图片 / 视频 / 其它；音频用列表点播） -->
            <button
                v-if="canSwitch && current.kind !== 'audio'"
                type="button"
                class="mv-nav mv-nav-prev"
                :title="$t('mediaViewer.prev')"
                :aria-label="$t('mediaViewer.prev')"
                @click.stop="step(-1)"
            >
                <font-awesome-icon icon="chevron-left"/>
            </button>
            <button
                v-if="canSwitch && current.kind !== 'audio'"
                type="button"
                class="mv-nav mv-nav-next"
                :title="$t('mediaViewer.next')"
                :aria-label="$t('mediaViewer.next')"
                @click.stop="step(1)"
            >
                <font-awesome-icon icon="chevron-right"/>
            </button>
        </div>

        <!-- ── 底部缩略图条（仅图片灯箱） ─────────────────────── -->
        <div v-if="current.kind === 'image' && imageThumbs.length > 1" class="mv-thumbs" @click.stop>
            <div class="mv-thumbs-track" ref="thumbsTrack">
                <button
                    v-for="t in imageThumbs"
                    :key="'thumb-' + t.index"
                    type="button"
                    class="mv-thumb"
                    :class="{ 'is-active': t.index === index }"
                    :title="t.name"
                    :data-thumb-index="t.index"
                    @click="index = t.index"
                >
                    <img :src="t.url" :alt="t.name" loading="lazy"/>
                </button>
            </div>
        </div>
    </div>
</template>

<script>
/**
 * 媒体预览浮层（v2.9.0）
 *
 * props.items 由父组件（AdminDashBoard）按「当前页可预览媒体」的顺序构造：
 *   { key, name, url, kind: 'image'|'video'|'audio'|'other', ext, sizeText, user }
 * 父组件只传当前页、且已按视图顺序排列，本组件不做任何请求。
 */
export default {
    name: 'MediaPreviewOverlay',
    props: {
        modelValue: { type: Boolean, default: false },
        items: { type: Array, default: () => [] },
        startIndex: { type: Number, default: 0 }
    },
    emits: ['update:modelValue', 'detail'],
    data() {
        return {
            index: 0,
            // 控件自动隐藏（2 秒无操作）
            controlsVisible: true,
            hideTimer: null,
            // 图片
            fitMode: 'fit',            // fit = 适应窗口，actual = 实际大小
            slideshowOn: false,
            slideMenuOpen: false,
            slideSpeed: 3,
            slideSpeedOptions: [1, 2, 3, 5, 8],
            slideTimer: null,
            // 视频
            videoMenuOpen: false,
            videoRate: 1,
            videoRateOptions: [0.5, 0.75, 1, 1.25, 1.5, 2],
            videoMode: 'sequence',     // single = 单片循环，random = 随机，sequence = 顺序
            pendingAutoplay: false,
            // 音频
            audioIndex: 0
        }
    },
    computed: {
        videoModes() {
            return [
                { value: 'single', label: this.$t('mediaViewer.modeSingle') },
                { value: 'random', label: this.$t('mediaViewer.modeRandom') },
                { value: 'sequence', label: this.$t('mediaViewer.modeSequence') }
            ]
        },
        current() {
            const list = this.items || []
            return list[this.index] || { name: '', url: '', kind: 'other' }
        },
        canSwitch() {
            return (this.items || []).length > 1
        },
        imageThumbs() {
            // 缩略图条只放图片（视频/音频用左右切换，避免误点）
            return (this.items || [])
                .map((it, i) => ({ ...it, index: i }))
                .filter(it => it.kind === 'image')
        },
        audioItems() {
            return (this.items || []).filter(it => it.kind === 'audio')
        }
    },
    watch: {
        modelValue(val) {
            if (val) {
                this.index = Math.min(Math.max(0, this.startIndex), Math.max(0, (this.items || []).length - 1))
                this.videoMenuOpen = false
                this.slideMenuOpen = false
                this.fitMode = 'fit'
                this.controlsVisible = true
                this.audioIndex = Math.max(0, this.audioItems.findIndex(a => a.key === this.current.key))
                this.$nextTick(() => {
                    this.applyVideoSettings()
                    this.scrollThumbIntoView()
                })
                this.bumpControls()
                this.bindKeys(true)
            } else {
                this.stopSlideshow()
                this.clearHideTimer()
                this.bindKeys(false)
                this.pauseAll()
            }
        },
        index() {
            this.videoMenuOpen = false
            this.audioIndex = Math.max(0, this.audioItems.findIndex(a => a.key === this.current.key))
            this.$nextTick(() => {
                this.applyVideoSettings()
                this.scrollThumbIntoView()
            })
        }
    },
    beforeUnmount() {
        this.stopSlideshow()
        this.clearHideTimer()
        this.bindKeys(false)
    },
    methods: {
        close() {
            this.$emit('update:modelValue', false)
        },
        /* ── 控件自动隐藏 ─────────────────────────────────── */
        bumpControls() {
            this.controlsVisible = true
            this.clearHideTimer()
            this.hideTimer = setTimeout(() => {
                // 菜单展开时不隐藏，避免点不到按钮
                if (this.videoMenuOpen || this.slideMenuOpen) return
                this.controlsVisible = false
            }, 2000)
        },
        clearHideTimer() {
            if (this.hideTimer) {
                clearTimeout(this.hideTimer)
                this.hideTimer = null
            }
        },
        /* ── 切换 ─────────────────────────────────────────── */
        step(delta) {
            const total = (this.items || []).length
            if (total < 2) return
            this.index = (this.index + delta + total) % total
            this.bumpControls()
        },
        /* ── 图片：适应窗口 / 实际大小 ────────────────────── */
        toggleFit() {
            this.fitMode = this.fitMode === 'fit' ? 'actual' : 'fit'
            this.bumpControls()
        },
        /* ── 图片：幻灯片 ─────────────────────────────────── */
        toggleSlideshow() {
            if (this.slideshowOn) {
                this.stopSlideshow()
            } else {
                this.slideshowOn = true
                this.scheduleSlide()
            }
            this.bumpControls()
        },
        scheduleSlide() {
            this.clearSlideTimer()
            this.slideTimer = setInterval(() => this.step(1), Math.max(1, this.slideSpeed) * 1000)
        },
        clearSlideTimer() {
            if (this.slideTimer) {
                clearInterval(this.slideTimer)
                this.slideTimer = null
            }
        },
        stopSlideshow() {
            this.slideshowOn = false
            this.clearSlideTimer()
        },
        toggleSlideMenu() {
            this.slideMenuOpen = !this.slideMenuOpen
            this.bumpControls()
        },
        setSlideSpeed(sec) {
            this.slideSpeed = Number(sec) || 3
            this.slideMenuOpen = false
            if (this.slideshowOn) this.scheduleSlide()
            this.bumpControls()
        },
        /* ── 视频设置 ─────────────────────────────────────── */
        toggleVideoMenu() {
            this.videoMenuOpen = !this.videoMenuOpen
            this.bumpControls()
        },
        applyVideoSettings() {
            const v = this.$refs.videoEl
            if (!v) return
            try {
                v.playbackRate = this.videoRate
                // 单片循环用原生 loop；随机/顺序由 ended 事件接管
                v.loop = this.videoMode === 'single'
            } catch (e) { /* 忽略：部分浏览器限制设置时机 */ }
        },
        setVideoRate(rate) {
            this.videoRate = Number(rate) || 1
            this.applyVideoSettings()
            this.bumpControls()
        },
        setVideoMode(mode) {
            this.videoMode = mode
            this.applyVideoSettings()
            this.bumpControls()
        },
        handleVideoEnded() {
            if (this.current.kind !== 'video') return
            if (this.videoMode === 'single') {
                // loop 已生效，这里是兜底
                const v = this.$refs.videoEl
                if (v) { v.currentTime = 0; v.play().catch(() => {}) }
                return
            }
            const videoIndexes = (this.items || [])
                .map((it, i) => (it.kind === 'video' ? i : -1))
                .filter(i => i >= 0)
            if (videoIndexes.length < 2) return
            if (this.videoMode === 'random') {
                const others = videoIndexes.filter(i => i !== this.index)
                this.index = others[Math.floor(Math.random() * others.length)]
            } else {
                const pos = videoIndexes.indexOf(this.index)
                this.index = videoIndexes[(pos + 1) % videoIndexes.length]
            }
            this.$nextTick(() => {
                const v = this.$refs.videoEl
                if (v) v.play().catch(() => {})
            })
        },
        /* ── 音频 ─────────────────────────────────────────── */
        playAudioAt(i) {
            const target = this.audioItems[i]
            if (!target) return
            const at = (this.items || []).findIndex(it => it.key === target.key)
            if (at < 0) return
            this.audioIndex = i
            this.index = at
            this.$nextTick(() => {
                const a = this.$refs.audioEl
                if (a) a.play().catch(() => {})
            })
            this.bumpControls()
        },
        handleAudioEnded() {
            // 顺序播下一条；最后一条停下
            if (this.audioIndex < this.audioItems.length - 1) {
                this.playAudioAt(this.audioIndex + 1)
            }
        },
        /* ── 其它类型 ─────────────────────────────────────── */
        copyLink() {
            // 浮层里的预览地址带 ?from=admin（管理员会话专用），复制出去要换成公开地址
            const url = String(this.current.url || '').replace(/([?&])from=admin(&?)/, (m, p1, p2) => (p2 ? p1 : '')).replace(/[?&]$/, '')
            if (!url) return
            const text = `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`
            const done = () => this.$message && this.$message.success(this.$t('mediaViewer.copied'))
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => this.fallbackCopy(text, done))
            } else {
                this.fallbackCopy(text, done)
            }
        },
        fallbackCopy(text, done) {
            try {
                const el = document.createElement('textarea')
                el.value = text
                el.style.position = 'fixed'
                el.style.opacity = '0'
                document.body.appendChild(el)
                el.select()
                document.execCommand('copy')
                document.body.removeChild(el)
                done()
            } catch (e) { /* 忽略 */ }
        },
        openLink() {
            const url = this.current.url || ''
            if (url) window.open(url, '_blank', 'noopener')
        },
        goDetail() {
            this.$emit('detail', this.current)
            this.close()
        },
        /* ── 其它 ─────────────────────────────────────────── */
        scrollThumbIntoView() {
            const track = this.$refs.thumbsTrack
            if (!track) return
            const el = track.querySelector(`[data-thumb-index="${this.index}"]`)
            if (el && el.scrollIntoView) {
                el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
            }
        },
        pauseAll() {
            const v = this.$refs.videoEl
            if (v) { try { v.pause() } catch (e) { /* 忽略 */ } }
            const a = this.$refs.audioEl
            if (a) { try { a.pause() } catch (e) { /* 忽略 */ } }
        },
        bindKeys(on) {
            if (on) {
                if (this._keyHandler) return
                this._keyHandler = (e) => {
                    if (!this.modelValue) return
                    if (e.key === 'Escape') { this.close(); return }
                    if (e.key === 'ArrowLeft') { this.step(-1); return }
                    if (e.key === 'ArrowRight') { this.step(1); return }
                    if (e.code === 'Space' && this.current.kind === 'image') {
                        e.preventDefault()
                        this.toggleSlideshow()
                    }
                }
                window.addEventListener('keydown', this._keyHandler)
            } else if (this._keyHandler) {
                window.removeEventListener('keydown', this._keyHandler)
                this._keyHandler = null
            }
        }
    }
}
</script>

<style scoped>
/* ── 整体：全屏、灰系偏暗带透明度 ─────────────────────────────── */
.media-viewer {
    position: fixed;
    inset: 0;
    z-index: 3200;
    display: flex;
    flex-direction: column;
    background: rgba(18, 19, 22, 0.86);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    color: #f2f3f5;
    user-select: none;
}
.mv-backdrop {
    position: absolute;
    inset: 0;
}
.media-viewer.is-idle {
    cursor: none;
}

/* ── 顶栏 ──────────────────────────────────────────────────── */
.mv-top {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.45), transparent);
    transition: opacity 0.25s ease;
}
.media-viewer.is-idle .mv-top {
    opacity: 0;
    pointer-events: none;
}
.mv-title {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
    flex: 1 1 auto;
}
.mv-title-name {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    max-width: 60vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-title-meta {
    font-size: 12px;
    opacity: 0.65;
    flex-shrink: 0;
}
.mv-tools {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}
.mv-tools-sep {
    width: 1px;
    height: 18px;
    background: rgba(255, 255, 255, 0.18);
    margin: 0 4px;
}
.mv-btn {
    box-sizing: border-box;
    min-width: 32px;
    height: 32px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: #f2f3f5;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}
.mv-btn:hover {
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
}
.mv-btn.is-on {
    background: color-mix(in srgb, var(--primary-color, #2563EB) 70%, transparent);
    border-color: color-mix(in srgb, var(--primary-color, #2563EB) 80%, transparent);
    color: #fff;
}
.mv-btn-text {
    font-size: 12px;
    font-weight: 600;
    min-width: 40px;
}
.mv-close:hover {
    background: rgba(220, 53, 69, 0.85);
    border-color: rgba(220, 53, 69, 0.9);
}

/* ── 舞台 ──────────────────────────────────────────────────── */
.mv-stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 56px 8px;
}
.mv-image-wrap {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
}
.mv-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    cursor: zoom-in;
}
/* 实际大小：不缩放、超出可滚动 */
.mv-image-wrap.is-actual {
    align-items: flex-start;
    justify-content: flex-start;
}
.mv-image-wrap.is-actual .mv-image {
    max-width: none;
    max-height: none;
    cursor: zoom-out;
}
.mv-video-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}
.mv-video {
    max-width: 100%;
    max-height: 100%;
    background: #000;
    border-radius: 6px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

/* 视频右下角设置 */
.mv-video-settings {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
}
.mv-menu-panel {
    width: 200px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(38, 40, 45, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
/* 顶栏内的幻灯片速度面板：相对按钮定位，避免被浮层盖住 */
.mv-inline-menu {
    position: relative;
}
.mv-slide-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 230px;
    z-index: 3;
}
.mv-menu-label {
    font-size: 11px;
    opacity: 0.6;
    margin: 2px 0 6px;
}
.mv-menu-label + .mv-menu-chips {
    margin-bottom: 10px;
}
.mv-menu-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.mv-chip {
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
    color: #e9eaec;
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 12px;
    line-height: 1.4;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
}
.mv-chip:hover {
    background: rgba(255, 255, 255, 0.16);
}
.mv-chip.is-active {
    background: var(--primary-color, #2563EB);
    border-color: var(--primary-color, #2563EB);
    color: #fff;
}

/* ── 音频 ──────────────────────────────────────────────────── */
.mv-audio {
    width: min(560px, 92vw);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px;
    border-radius: 14px;
    background: rgba(38, 40, 45, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.12);
}
.mv-audio-head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
}
.mv-audio-icon {
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 60%, transparent);
    color: #fff;
    font-size: 16px;
    flex-shrink: 0;
}
.mv-audio-title {
    min-width: 0;
}
.mv-audio-name {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-audio-sub {
    font-size: 11px;
    opacity: 0.6;
    margin-top: 2px;
}
.mv-audio-player {
    width: 100%;
}
.mv-audio-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 2px;
}
.mv-audio-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: #e9eaec;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.2s ease;
}
.mv-audio-item:hover {
    background: rgba(255, 255, 255, 0.13);
}
.mv-audio-item.is-active {
    background: color-mix(in srgb, var(--primary-color, #2563EB) 42%, transparent);
    border-color: color-mix(in srgb, var(--primary-color, #2563EB) 70%, transparent);
    color: #fff;
}
.mv-audio-item-no {
    width: 20px;
    flex-shrink: 0;
    text-align: center;
    opacity: 0.6;
    font-size: 12px;
}
.mv-audio-item-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-audio-item-size {
    flex-shrink: 0;
    font-size: 11px;
    opacity: 0.6;
}
.mv-audio-item-icon {
    flex-shrink: 0;
    font-size: 11px;
    opacity: 0.8;
}

/* ── 其它类型 ──────────────────────────────────────────────── */
.mv-other {
    width: min(460px, 92vw);
    padding: 28px 24px 22px;
    border-radius: 14px;
    background: rgba(38, 40, 45, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.12);
    text-align: center;
}
.mv-other-icon {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-bottom: 14px;
}
.mv-other-glyph {
    font-size: 46px;
    opacity: 0.85;
}
.mv-other-ext {
    font-size: 11px;
    letter-spacing: 0.08em;
    opacity: 0.6;
}
.mv-other-name {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    margin-bottom: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-other-meta {
    display: flex;
    justify-content: center;
    gap: 12px;
    font-size: 12px;
    opacity: 0.6;
    margin-bottom: 18px;
}
.mv-other-actions {
    display: flex;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
}
.mv-other-btn-icon {
    margin-right: 4px;
}

/* ── 左右切换 ──────────────────────────────────────────────── */
.mv-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 42px;
    height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.42);
    color: #fff;
    font-size: 15px;
    cursor: pointer;
    transition: background 0.2s ease, opacity 0.25s ease;
}
.mv-nav:hover {
    background: rgba(255, 255, 255, 0.24);
}
.mv-nav-prev {
    left: 8px;
}
.mv-nav-next {
    right: 8px;
}
.media-viewer.is-idle .mv-nav {
    opacity: 0;
    pointer-events: none;
}

/* ── 底部缩略图条 ──────────────────────────────────────────── */
.mv-thumbs {
    position: relative;
    z-index: 2;
    padding: 8px 14px 12px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.5), transparent);
    transition: opacity 0.25s ease;
}
.media-viewer.is-idle .mv-thumbs {
    opacity: 0;
    pointer-events: none;
}
.mv-thumbs-track {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 4px;
    scrollbar-width: thin;
}
.mv-thumbs-track::-webkit-scrollbar {
    height: 6px;
}
.mv-thumbs-track::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.25);
    border-radius: 3px;
}
.mv-thumb {
    flex: 0 0 auto;
    width: 72px;
    height: 54px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 6px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.08);
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}
.mv-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.mv-thumb:hover {
    opacity: 1;
    transform: translateY(-1px);
}
.mv-thumb.is-active {
    opacity: 1;
    border-color: var(--primary-color, #2563EB);
}

/* ── 移动端 ────────────────────────────────────────────────── */
@media (max-width: 768px) {
    .mv-top {
        padding: 8px 10px;
    }
    .mv-title-name {
        max-width: 42vw;
        font-size: 13px;
    }
    .mv-stage {
        padding: 0 6px 6px;
    }
    .mv-nav {
        width: 34px;
        height: 34px;
    }
    .mv-nav-prev {
        left: 4px;
    }
    .mv-nav-next {
        right: 4px;
    }
    .mv-thumb {
        width: 58px;
        height: 44px;
    }
    .mv-audio,
    .mv-other {
        width: 94vw;
        padding: 14px;
    }
}
</style>
