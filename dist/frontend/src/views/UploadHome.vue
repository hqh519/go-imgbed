<template>
    <div class="container">
    <div class="upload-home">
        <!-- 桌面端按钮 -->
        <ToggleDark class="toggle-dark-button desktop-only"/>
        <!--
            注意：这里直接把 el-button 作为 el-dropdown 的触发元素。
            早前在 el-button 外面又套了一层 el-tooltip，导致 dropdown 的点击事件
            被内层 tooltip 吞掉、菜单无法展开 —— 提示改用原生 title 属性。
        -->
        <el-dropdown class="more-dropdown desktop-only" trigger="click" @command="handleDesktopMenuCommand">
            <el-button class="more-button" :title="$t('upload.moreMenu')" :aria-label="$t('upload.moreMenu')">
                <font-awesome-icon icon="ellipsis-v" size="lg"/>
            </el-button>
            <template #dropdown>
                <el-dropdown-menu>
                    <el-dropdown-item command="showHistory">
                        <font-awesome-icon icon="history" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.history') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="showAnnouncement" :disabled="!announcementAvailable">
                        <font-awesome-icon icon="bullhorn" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.announcement') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="toggleLanguage">
                        <font-awesome-icon icon="globe" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $i18n.locale === 'zh-CN' ? 'English' : '简体中文' }}
                    </el-dropdown-item>
                    <el-dropdown-item v-if="isAdminRole" command="systemManage">
                        <font-awesome-icon icon="cogs" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.systemManage') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="viewDocs">
                        <font-awesome-icon icon="book" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.viewDocs') }}
                    </el-dropdown-item>
                </el-dropdown-menu>
            </template>
        </el-dropdown>
        <div
            class="upload-folder-container"
            :class="{ 'no-announcement': !announcementAvailable, 'is-active': isFolderInputActive }"
        >
            <div class="upload-folder" :class="{ 'active': isFolderInputActive }">
                <DirectorySuggestionInput
                    v-if="showDirectorySuggestions"
                    v-model="uploadFolder"
                    class="inner-folder-input"
                    :placeholder="$t('upload.folderPlaceholder')"
                    @focus="handleFolderInputFocus"
                    @blur="handleFolderInputBlur"
                    @select="handleDirectorySelect"
                />
                <el-input
                    v-else
                    class="inner-folder-input"
                    v-model="uploadFolder"
                    :placeholder="$t('upload.folderPlaceholder')"
                    @focus="handleFolderInputFocus"
                    @blur="handleFolderInputBlur"
                />
            </div>
            <DirectoryTreePicker
                v-if="showDirectorySuggestions"
                :current-directory="uploadFolder"
                source="upload"
                @select="handleDirectorySelect"
            >
                <template #trigger>
                    <el-tooltip :content="$t('upload.selectFromDirectoryTree')" placement="top" :disabled="disableTooltip" :show-after="1000">
                        <el-button class="directory-tree-trigger">
                            <font-awesome-icon icon="folder-tree" />
                        </el-button>
                    </el-tooltip>
                </template>
            </DirectoryTreePicker>
        </div>
        <!-- 上传方式切换：由上「上传框上方」的标签页承担（原右上角按钮已迁移） -->

        <!-- 移动端更多按钮 -->
        <el-dropdown class="mobile-more-dropdown mobile-only" trigger="click" @command="handleMobileMenuCommand">
            <!-- 图标按钮：无障碍名称交给 aria-label（原 .visually-hidden 文本类未定义样式，
                 移动端会把它当普通文字渲染，直接把图标挤出行外，故移除） -->
            <el-button class="mobile-more-button" :aria-label="$t('upload.moreMenu')">
                <font-awesome-icon icon="ellipsis-v" size="lg"/>
            </el-button>
            <template #dropdown>
                <el-dropdown-menu>
                    <el-dropdown-item command="toggleTheme">
                        <font-awesome-icon :icon="getThemeIcon()" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ getThemeText() }}
                    </el-dropdown-item>
                    <el-dropdown-item command="showHistory">
                        <font-awesome-icon icon="history" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.history') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="showAnnouncement" :disabled="!announcementAvailable">
                        <font-awesome-icon icon="bullhorn" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.announcement') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="toggleLanguage">
                        <font-awesome-icon icon="globe" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $i18n.locale === 'zh-CN' ? 'English' : '简体中文' }}
                    </el-dropdown-item>
                    <el-dropdown-item v-if="isAdminRole" command="systemManage">
                        <font-awesome-icon icon="cogs" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.systemManage') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="viewDocs">
                        <font-awesome-icon icon="book" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.viewDocs') }}
                    </el-dropdown-item>
                </el-dropdown-menu>
            </template>
        </el-dropdown>
        <div
            class="quick-toolbar"
            :class="{ 'is-expanded': isQuickToolbarOpen }"
            @mouseleave="handleQuickToolbarLeave"
        >
            <div class="quick-toolbar-actions">
                <div class="quick-toolbar-actions-inner">
                    <el-tooltip :disabled="disableTooltip || !isQuickToolbarOpen" :content="$t('upload.logout')" placement="left" :hide-after="0" :show-after="1000">
                        <el-button class="quick-toolbar-button" @click="handleQuickToolbarCommand('logout')">
                            <font-awesome-icon icon="sign-out-alt" class="quick-toolbar-icon"/>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip :disabled="disableTooltip || !isQuickToolbarOpen" :content="$t('upload.manageFiles')" placement="left" :hide-after="0" :show-after="1000">
                        <el-button class="quick-toolbar-button" @click="handleQuickToolbarCommand('manage')">
                            <font-awesome-icon icon="folder" class="quick-toolbar-icon"/>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip :disabled="disableTooltip || !isQuickToolbarOpen" :content="$t('upload.linkFormat')" placement="left" :hide-after="0" :show-after="1000">
                        <el-button class="quick-toolbar-button" @click="handleQuickToolbarCommand('linkFormat')">
                            <font-awesome-icon icon="link" class="quick-toolbar-icon"/>
                        </el-button>
                    </el-tooltip>
                </div>
            </div>
            <el-tooltip :disabled="disableTooltip" :content="$t('upload.settings')" placement="left" :hide-after="0" :show-after="1000">
                <el-button class="quick-toolbar-button" @click="openCompressDialog">
                    <font-awesome-icon icon="cloud-upload" class="quick-toolbar-icon"/>
                </el-button>
            </el-tooltip>
            <el-tooltip :disabled="disableTooltip" :content="$t('upload.moreActions')" placement="left" :hide-after="0" :show-after="1000">
                <el-button
                    class="quick-toolbar-button quick-toolbar-more"
                    :class="{ 'is-active': isQuickToolbarOpen }"
                    :aria-expanded="isQuickToolbarOpen"
                    @mouseenter="handleQuickToolbarMoreEnter"
                    @click="toggleQuickToolbar"
                >
                    <font-awesome-icon icon="chevron-down" class="quick-toolbar-icon quick-toolbar-toggle-icon"/>
                </el-button>
            </el-tooltip>
        </div>
        <Logo :useConfigLink="true" />
        <div class="header">
            <h1 class="title">
                <span class="title-crayon-text" aria-hidden="true">{{ ownerName }}</span>
                <span class="title-base-text">
                    <a class="main-title" :href="siteLink" target="_blank" rel="noreferrer">{{ ownerName }}</a>
                </span>
            </h1>
        </div>
        <!-- 上传方式标签页（原右上角切换按钮迁移至此，位于上传框上方） -->
        <div class="upload-stack">
        <div class="upload-method-tabs" role="tablist" :aria-label="$t('upload.switchUploadMethod')">
            <button
                type="button"
                role="tab"
                class="upload-method-tab"
                :class="{ 'is-active': uploadMethod === 'default' }"
                :aria-selected="uploadMethod === 'default'"
                @click="setUploadMethod('default')"
            >
                <font-awesome-icon icon="folder-open" class="upload-method-tab-icon"/>
                <span>{{ $t('upload.defaultTab') }}</span>
            </button>
            <button
                type="button"
                role="tab"
                class="upload-method-tab"
                :class="{ 'is-active': uploadMethod === 'paste' }"
                :aria-selected="uploadMethod === 'paste'"
                @click="setUploadMethod('paste')"
            >
                <font-awesome-icon icon="link" class="upload-method-tab-icon"/>
                <span>{{ $t('upload.linkTab') }}</span>
            </button>
        </div>
        <UploadForm 
            :selectedUrlForm="selectedUrlForm" 
            :customerCompress="customerCompress" 
            :compressBar="compressBar"
            :serverCompress="serverCompress"
            :uploadChannel="uploadChannel"
            :channelName="channelName"
            :uploadNameType="uploadNameType"
            :useCustomUrl="useCustomUrl"
            :customUrlPrefix="customUrlPrefix"
            :autoRetry="autoRetry"
            :urlPrefix="urlPrefix"
            :uploadMethod="uploadMethod"
            :uploadFolder="uploadFolder"
            :convertToWebp="convertToWebp"
            :autoUpload="autoUpload"
            @update:autoUpload="autoUpload = $event"
            :backupChannel="backupChannel"
            :compressPercent="compressPercent"
            :limitExtensions="limitExtensions"
            :limitMaxSizeMB="limitMaxSizeMB"
            class="upload"
        />
        </div>
        <el-dialog :title="$t('settings.linkFormatTitle')" v-model="showUrlDialog" :width="dialogWidth" :show-close="false" class="settings-dialog settings-dialog-scope">
            <div class="dialog-section">
                <div class="section-header">
                    <span class="section-title">{{ $t('settings.defaultCopyLink') }}</span>
                </div>
                <div class="section-content">
                    <el-radio-group v-model="selectedUrlForm" @change="changeUrlForm" class="radio-card-group grid-2x2">
                        <el-radio value="url" class="radio-card">
                            <font-awesome-icon icon="link" class="radio-icon"/>
                            <span>{{ $t('settings.rawLink') }}</span>
                        </el-radio>
                        <el-radio value="md" class="radio-card">
                            <font-awesome-icon icon="code" class="radio-icon"/>
                            <span>MarkDown</span>
                        </el-radio>
                        <el-radio value="html" class="radio-card">
                            <font-awesome-icon icon="code-branch" class="radio-icon"/>
                            <span>HTML</span>
                        </el-radio>
                        <el-radio value="ubb" class="radio-card">
                            <font-awesome-icon icon="quote-right" class="radio-icon"/>
                            <span>BBCode</span>
                        </el-radio>
                    </el-radio-group>
                </div>
            </div>
            
            <div class="dialog-section">
                <div class="section-header">
                    <span class="section-title">{{ $t('settings.customLink') }}</span>
                    <el-tooltip :content="$t('settings.customLinkTooltip')" placement="top" raw-content>
                        <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                    </el-tooltip>
                </div>
                <div class="section-content">
                    <div class="setting-item">
                        <span class="setting-label">{{ $t('settings.enableCustom') }}</span>
                        <el-switch v-model="useCustomUrl" active-value="true" inactive-value="false" />
                    </div>
                    <div class="setting-item" v-if="useCustomUrl === 'true'">
                        <span class="setting-label">{{ $t('settings.customPrefix') }}</span>
                        <el-input v-model="customUrlPrefix" :placeholder="$t('settings.customPrefixPlaceholder')" class="setting-input"/>
                    </div>
                </div>
            </div>
            
            <div class="dialog-action">
                <el-button type="primary" @click="showUrlDialog = false" class="confirm-btn">{{ $t('settings.confirm') }}</el-button>
            </div>
        </el-dialog>
        <UploadSettingsDialog
            v-model="showCompressDialog"
            v-model:channelName="channelName"
            v-model:backupChannel="backupChannel"
            :defaultChannel="defaultChannelInfo"
            :defaultBackupChannel="defaultBackupChannelInfo"
            v-model:uploadFolder="uploadFolder"
            v-model:autoRetry="autoRetry"
            v-model:uploadNameType="uploadNameType"
            v-model:convertToWebp="convertToWebp"
            v-model:customerCompress="customerCompress"
            v-model:compressBar="compressBar"
            v-model:compressPercent="compressPercent"
            v-model:serverCompress="serverCompress"
            v-model:limitExtensions="limitExtensions"
            v-model:limitMaxSizeMB="limitMaxSizeMB"
        />
    </div>
    <Footer class="footer"/>
    <el-dialog :title="$t('upload.announcementTitle')" v-model="showAnnouncementDialog" :width="dialogWidth" :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false" center>
        <div v-html="announcementContent"></div>
        <template #footer>
            <span class="dialog-footer">
                <el-button type="primary" @click="acknowledgeAnnouncement">{{ $t('upload.announcementAck') }}</el-button>
            </span>
        </template>
    </el-dialog>
    </div>
</template>

<script>
import UploadForm from '@/components/upload/UploadForm.vue'
import Footer from '@/components/Footer.vue'
import ToggleDark from '@/components/ToggleDark.vue'
import Logo from '@/components/Logo.vue'
import { setLocale } from '@/locales'
import UploadSettingsDialog from '@/components/upload/UploadSettingsDialog.vue'
import DirectoryTreePicker from '@/components/DirectoryTreePicker.vue'
import DirectorySuggestionInput from '@/components/DirectorySuggestionInput.vue'
import backgroundManager from '@/mixins/backgroundManager'
import axios from '@/utils/axios'
import { ref } from 'vue'
import { mapGetters } from 'vuex'
import { validateFolderPath } from '@/utils/pathValidator'
import { getLinkPrefix } from '@/utils/fileLink'

export default {
    name: 'UploadHome',
    mixins: [backgroundManager],
    data() {
        return {
            selectedUrlForm: ref(''),
            showUrlDialog: false,
            showCompressDialog: false,
            customerCompress: true, //上传前压缩
            compressBar: 5, //压缩阈值（MB）
            convertToWebp: false, //转换为WebP格式
            serverCompress: true, //服务器端压缩
            uploadChannel: '', //上传渠道（仅保留 'external' 外链上传特殊值）
            channelName: '', //指定的存储渠道 ID（'' = 默认，跟随全局）
            backupChannel: '', //备份渠道 ID（'' = 跟随全局；'none' = 不备份）
            uploadNameType: '', //上传文件命名方式
            customUrlPrefix: '', //自定义链接前缀
            useCustomUrl: 'false', //是否启用自定义链接格式
            autoRetry: true, //失败自动切换
            compressPercent: 80, //压缩期望百分比（压到原体积的 x%）
            limitExtensions: '', // 允许的上传格式覆盖（仅本次页面生效，刷新清空）
            limitMaxSizeMB: 0, // 单文件大小上限覆盖（MB，0 = 跟随后台）
            customDomain: '', //自定义访问域名（所有文件链接统一使用）
            autoUpload: localStorage.getItem('goimgbed_autoUpload') !== '0', //自动上传（记忆模式：记住上次选择，刷新不重置）
            useDefaultWallPaper: false,
            uploadMethod: 'default', //上传方式
            uploadFolder: '', // 上传文件夹
            isFolderInputActive: false,
            isQuickToolbarOpen: false,
            isQuickToolbarPinned: false,
            showAnnouncementDialog: false, // 控制公告弹窗的显示
            announcementContent: '', // 公告内容
            displayedAnnouncementRefreshAt: null, // 当前弹窗所展示的公告版本
            themeMode: 'auto', // 主题模式：light, dark, auto
        }
    },
    watch: {
        // 自动/手动切换记忆：用户选了「手动」后刷新页面仍保持手动
        autoUpload(val) {
            try { localStorage.setItem('goimgbed_autoUpload', val ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
        },
        customerCompress(val) {
            this.updateCompressConfig('customerCompress', val)
        },
        compressBar(val) {
            // 确保值在有效范围内
            if (val === null || val === undefined || val < 1) {
                this.compressBar = 1
                return
            }
            this.updateCompressConfig('compressBar', val)
        },
        compressPercent(val) {
            let v = Number(val)
            if (!Number.isFinite(v)) v = 80
            v = Math.min(100, Math.max(10, Math.round(v)))
            if (v !== val) {
                this.compressPercent = v
                return
            }
            this.updateCompressConfig('compressPercent', v)
        },
        serverCompress(val) {
            this.updateCompressConfig('serverCompress', val)
        },
        convertToWebp(val) {
            this.updateCompressConfig('convertToWebp', val)
        },
        uploadChannel(val) {
            // uploadChannel 仅保留 'external'（链接上传）特殊值；
            // 常规上传一律由 channelName（默认为主渠道）决定
            this.updateStoreUploadChannel(val)
        },
        channelName(val) {
            // 确保清空时保存空字符串而不是null
            this.$store.commit('setStoreChannelName', val || '')
        },
        backupChannel() {
            // 备份渠道只在本次会话内生效（刷新后回到「默认」），无需持久化
        },
        uploadNameType(val) {
            this.updateStoreUploadNameType(val)
        },
        customUrlPrefix(val) {
            this.$store.commit('setCustomUrlSettings', { key: 'customUrlPrefix', value: val })
        },
        useCustomUrl(val) {
            this.$store.commit('setCustomUrlSettings', { key: 'useCustomUrl', value: val })
        },
        autoRetry(val) {
            this.$store.commit('setStoreAutoRetry', val)
        },
        uploadFolder(val) {
            // 实时输入时用非 strict 模式，不检查末尾的单独 . 以允许继续输入如 .123
            if (this.validateUploadFolder(val, false)) {
                // 非 strict 通过后，再用 strict 模式静默检查，只有完全合法才更新 store
                const strictResult = validateFolderPath(val, { strict: true })
                if (strictResult.valid) {
                    this.$store.commit('setStoreUploadFolder', val)
                }
                // strict 不通过时不更新 store，等失焦时提示并回滚
            } else {
                this.$nextTick(() => {
                    this.uploadFolder = this.storeUploadFolder
                })
            }
        }
    },
    computed: {
        ...mapGetters(['userConfig', 'uploadCopyUrlForm', 'compressConfig', 'storeUploadChannel', 'storeChannelName', 'storeUploadNameType', 'customUrlSettings', 'storeAutoRetry', 'storeUploadMethod', 'storeUploadFolder', 'isAdminRole']),
        ownerName() {
            return this.userConfig?.ownerName || 'go-imgbed'
        },
        /**
         * 当前「生效的」主存储渠道 —— 统一取后端 getStorageChannel(账户, 'main') 的结果：
         *   登录账户在「用户管理」里指定了主渠道 → 用指定的；
         *   未指定 → 后台「上传设置」里的全局主渠道。
         * 上传设置里「存储渠道」选「默认」时，用它把实际落点显示出来。
         */
        defaultChannelInfo() {
            return this.userConfig?.mainChannel || this.userConfig?.defaultChannel || null
        },
        /** 当前「生效的」备份渠道 —— 同样来自 getStorageChannel(账户, 'backup') */
        defaultBackupChannelInfo() {
            return this.userConfig?.backupChannel || null
        },
        /** 标题链接：指向本站（页脚的传送门语义已由「页脚设置 → 页脚自定义代码」承担） */
        siteLink() {
            return '/'
        },
        dialogWidth() {
            return window.innerWidth > 768 ? '50%' : '90%'
        },
        disableTooltip() {
            return window.innerWidth < 768
        },
        urlPrefix() {
            // 全站统一出口：后端已按「自定义访问域名 > 默认URL前缀 > 本站 /file/」算好
            return getLinkPrefix()
        },
        announcementAvailable() {
            return !!this.userConfig?.announcement
        },
        // 是否显示目录候选项（从 userConfig 获取）
        showDirectorySuggestions() {
            return this.userConfig?.showDirectorySuggestions ?? false
        }
    },
    mounted() {
        // 初始化背景图，启用自动创建元素
        this.initializeBackground('uploadBkImg', '.container', true, true)

        // 读取用户选择的链接格式（优先用户本地偏好，其次系统默认）
        this.selectedUrlForm = this.uploadCopyUrlForm || this.userConfig?.defaultUrlForm || 'url'
        // 读取用户选择的压缩设置（优先用户设置，其次系统默认配置）
        this.customerCompress = this.compressConfig.customerCompress ?? this.parseBoolean(this.userConfig?.defaultCustomerCompress, true)
        // 压缩期望：百分比（前端设置优先，其次后台默认，兜底 80）
        this.compressPercent = this.compressConfig.compressPercent ?? this.parseNumber(this.userConfig?.defaultCompressQuality, 80)
        if (!(this.compressPercent >= 10 && this.compressPercent <= 100)) this.compressPercent = 80
        this.compressBar = this.compressConfig.compressBar ?? this.parseNumber(this.userConfig?.defaultCompressBar, 5)
        this.serverCompress = this.compressConfig.serverCompress ?? true
        this.convertToWebp = this.compressConfig.convertToWebp ?? this.parseBoolean(this.userConfig?.defaultConvertToWebp, false)
        // 读取用户选择的上传渠道：上传渠道仅保留外链特殊值，常规上传走默认主渠道
        this.uploadChannel = ''
        // 页面刷新后一律复位为「默认」渠道（主图床）；
        // 手动选择的渠道只在本次会话内生效
        this.channelName = ''
        // 备份渠道同样复位为「默认」（跟随全局备份渠道，而不是 none/不备份）
        this.backupChannel = ''
        // 用户定义的失败自动切换
        this.autoRetry = this.storeAutoRetry
        // 读取用户选择的上传文件命名方式
        this.uploadNameType = this.storeUploadNameType || this.userConfig?.defaultUploadNameType || 'default'
        // 读取用户自定义链接格式
        this.customUrlPrefix = this.customUrlSettings.customUrlPrefix
        this.useCustomUrl = this.customUrlSettings.useCustomUrl
        // 自定义访问域名来自后台「上传设置」的全局配置（前端不再单独保存）
        this.customDomain = this.userConfig?.customDomain || ''
        // 读取用户偏好的上传方式
        this.uploadMethod = this.storeUploadMethod
        // 上传目录：页面刷新后一律清空（右上角输入框与右下角「上传设置」里的同名项都不保留上次的值）
        this.uploadFolder = ''
        this.$store.commit('setStoreUploadFolder', '')

        // 从 Vuex store 读取主题模式状态
        const cusDarkMode = this.$store.getters.cusDarkMode
        const useDarkMode = this.$store.getters.useDarkMode
        
        if (!cusDarkMode) {
            this.themeMode = 'auto'
        } else if (useDarkMode) {
            this.themeMode = 'dark'
        } else {
            this.themeMode = 'light'
        }

        this.showAnnouncementIfNeeded()
    },
    components: {
        UploadForm,
        Footer,
        ToggleDark,
        Logo,
        UploadSettingsDialog,
        DirectoryTreePicker,
        DirectorySuggestionInput
    },
    methods: {
        // 验证上传文件夹路径的合法性
        validateUploadFolder(path, strict = true) {
            // 自动补全前导 /
            if (path && !path.startsWith('/')) {
                path = '/' + path
                this.uploadFolder = path
            }
            const result = validateFolderPath(path, { strict })
            if (!result.valid) {
                this.$message.error(result.error)
                return false
            }
            return true
        },
        handleFolderInputFocus() {
            this.isFolderInputActive = true
        },
        handleFolderInputBlur() {
            this.isFolderInputActive = false
            // 失焦时自动补全前导 /
            if (this.uploadFolder && !this.uploadFolder.startsWith('/')) {
                this.uploadFolder = '/' + this.uploadFolder
            }
            // 失焦时做完整校验（包括末尾单独的 .）
            if (!this.validateUploadFolder(this.uploadFolder, true)) {
                this.$nextTick(() => {
                    this.uploadFolder = this.storeUploadFolder
                })
            }
        },
        handleManage() {
            // 右下角「文件管理」：新标签打开后台文件管理页，不打断当前上传
            window.open('/dashboard', '_blank', 'noopener')
        },
        /** 更多菜单 → 系统管理：新标签打开系统状态页 */
        openSystemManage() {
            window.open('/systemConfig#status', '_blank', 'noopener')
        },
        // 解析布尔值
        parseBoolean(value, defaultValue) {
            if (value === undefined || value === null) return defaultValue
            if (typeof value === 'boolean') return value
            if (typeof value === 'string') return value === 'true'
            return defaultValue
        },
        // 解析数字
        parseNumber(value, defaultValue) {
            if (value === undefined || value === null) return defaultValue
            const num = parseFloat(value)
            return isNaN(num) ? defaultValue : num
        },
        openUrlDialog() {
            this.showUrlDialog = true
        },
        handleLogout() {
            axios.post('/api/auth/logout', { authType: 'user' }, { withCredentials: true }).finally(() => {
                this.$store.commit('setUserLoggedIn', false);
                this.$router.push('/login')
                this.$message.success(this.$t('upload.logoutSuccess'))
            })
        },
        changeUrlForm() {
            this.$store.commit('setUploadCopyUrlForm', this.selectedUrlForm)
        },
        openCompressDialog() {
            this.showCompressDialog = true
        },
        updateCompressConfig(key, value) {
            this.$store.commit('setCompressConfig', { key, value })
        },
        updateStoreUploadChannel(value) {
            this.$store.commit('setStoreUploadChannel', value)
        },
        updateStoreUploadNameType(value) {
            this.$store.commit('setStoreUploadNameType', value)
        },
        handleQuickToolbarMoreEnter() {
            this.isQuickToolbarOpen = true
        },
        handleQuickToolbarLeave() {
            if (!this.isQuickToolbarPinned) {
                this.isQuickToolbarOpen = false
            }
        },
        toggleQuickToolbar() {
            this.isQuickToolbarPinned = !this.isQuickToolbarPinned
            this.isQuickToolbarOpen = this.isQuickToolbarPinned
        },
        closeQuickToolbar() {
            this.isQuickToolbarPinned = false
            this.isQuickToolbarOpen = false
        },
        handleQuickToolbarCommand(command) {
            this.closeQuickToolbar()
            if (command === 'linkFormat') {
                this.openUrlDialog()
            } else if (command === 'manage') {
                this.handleManage()
            } else if (command === 'logout') {
                this.handleLogout()
            }
        },
        handleChangeUploadMethod() {
            this.uploadMethod = this.uploadMethod === 'default'? 'paste' : 'default'
            this.$store.commit('setUploadMethod', this.uploadMethod)
        },
        /** 上传方式标签页切换（默认 / 链接） */
        setUploadMethod(method) {
            if (method !== 'default' && method !== 'paste') return
            this.uploadMethod = method
            this.$store.commit('setUploadMethod', method)
        },
        handleMobileMenuCommand(command) {
            if (command === 'toggleTheme') {
                // 循环切换：auto -> light -> dark -> auto
                if (this.themeMode === 'auto') {
                    // 切换到亮色
                    this.themeMode = 'light'
                    this.$store.commit('setCusDarkMode', true)
                    this.$store.commit('setUseDarkMode', false)
                } else if (this.themeMode === 'light') {
                    // 切换到暗色
                    this.themeMode = 'dark'
                    this.$store.commit('setCusDarkMode', true)
                    this.$store.commit('setUseDarkMode', true)
                } else {
                    // 切换到自动
                    this.themeMode = 'auto'
                    this.$store.commit('setCusDarkMode', false)
                }
            } else if (command === 'viewDocs') {
                this.openDocsPage()
            } else if (command === 'showHistory') {
                this.openHistoryPage()
            } else if (command === 'showAnnouncement') {
                this.handleShowAnnouncement()
            } else if (command === 'toggleLanguage') {
                const next = this.$i18n.locale === 'zh-CN' ? 'en' : 'zh-CN'
                setLocale(next)
            } else if (command === 'systemManage') {
                this.openSystemManage()
            }
        },
        handleDesktopMenuCommand(command) {
            if (command === 'viewDocs') {
                this.openDocsPage()
            } else if (command === 'showHistory') {
                this.openHistoryPage()
            } else if (command === 'showAnnouncement') {
                this.handleShowAnnouncement()
            } else if (command === 'toggleLanguage') {
                const next = this.$i18n.locale === 'zh-CN' ? 'en' : 'zh-CN'
                setLocale(next)
            } else if (command === 'systemManage') {
                this.openSystemManage()
            }
        },
        /** 「上传记录 / 历史记录」已合并为同一页：新标签打开 /manage/history */
        openHistoryPage() {
            const url = this.$router.resolve({ name: 'history' }).href
            window.open(url, '_blank', 'noopener')
        },
        /** 「查看文档」→ 内置文档说明页（新标签打开，不打断当前上传） */
        openDocsPage() {
            const url = this.$router.resolve({ name: 'docs' }).href
            window.open(url, '_blank', 'noopener')
        },
        getThemeIcon() {
            // 显示下一个模式的图标
            if (this.themeMode === 'auto') return 'sun'  // auto -> light
            if (this.themeMode === 'light') return 'moon'  // light -> dark
            return 'adjust'  // dark -> auto
        },
        getThemeText() {
            // 显示下一个模式的文字
            if (this.themeMode === 'auto') return this.$t('theme.lightMode')
            if (this.themeMode === 'light') return this.$t('theme.darkMode')
            return this.$t('theme.autoMode')
        },
        handleShowAnnouncement() {
            const announcement = this.userConfig?.announcement
            if (announcement) {
                this.openAnnouncement(announcement)
            } else {
                this.$message.info(this.$t('upload.noAnnouncement'))
            }
        },
        getAnnouncementRefreshAt() {
            const refreshAt = Number(this.userConfig?.announcementRefreshAt)
            return Number.isFinite(refreshAt) && refreshAt > 0 ? refreshAt : null
        },
        openAnnouncement(announcement) {
            this.announcementContent = announcement
            this.displayedAnnouncementRefreshAt = this.getAnnouncementRefreshAt()
            this.showAnnouncementDialog = true
        },
        showAnnouncementIfNeeded() {
            const announcement = this.userConfig?.announcement
            if (!announcement) return

            const refreshAt = this.getAnnouncementRefreshAt()
            if (refreshAt) {
                const acknowledgedRefreshAt = Number(localStorage.getItem('announcementAcknowledgedRefreshAt'))
                if (!Number.isFinite(acknowledgedRefreshAt) || refreshAt > acknowledgedRefreshAt) {
                    this.openAnnouncement(announcement)
                }
                return
            }

            // 尚未产生刷新时间的旧公告在升级后再展示一次，确认后使用新版时间标记。
            if (!localStorage.getItem('announcementAcknowledgedAt')) {
                this.openAnnouncement(announcement)
            }
        },
        acknowledgeAnnouncement() {
            localStorage.setItem('announcementAcknowledgedAt', String(Date.now()))

            if (this.displayedAnnouncementRefreshAt) {
                localStorage.setItem(
                    'announcementAcknowledgedRefreshAt',
                    String(this.displayedAnnouncementRefreshAt)
                )
            }

            this.showAnnouncementDialog = false
        },
        // 处理目录选择
        handleDirectorySelect(path) {
            // 填入选择的目录路径
            this.uploadFolder = path
            // 触发路径验证逻辑
            if (this.validateUploadFolder(path, true)) {
                this.$store.commit('setStoreUploadFolder', path)
            }
        }
    }
}
</script>

<style scoped>
.container {
    background: var(--bg-color);
    min-height: 100vh;
}

/* 定义顺时针和逆时针旋转动画 */
.rotate {
    animation: spin 2s ease-in-out; /* 动画时长为2秒，执行一次 */
}

/* 定义放大缩小动画 */
.scale {
    animation: scale 0.5s ease-in-out; /* 动画时长为0.5秒，执行一次 */
}

/* 关键帧：先顺时针旋转，再逆时针旋转 */
@keyframes spin {
    0% {
        transform: rotate(0deg); /* 初始位置 */
    }
    25% {
        transform: rotate(5deg); /* 顺时针旋转20度 */
    }
    50% {
        transform: rotate(0deg); /* 顺时针旋转回到初始位置 */
    }
    75% {
        transform: rotate(-3deg); /* 逆时针旋转20度 */
    }
    100% {
        transform: rotate(0deg); /* 逆时针旋转回到初始位置 */
    }
}

@keyframes streamer {
    0% {
        background-position: 200% center;
    }
    100% {
        background-position: -200% center;
    }
}


/* 关键帧：旋转抖动 */
@keyframes rotate-shake {
    0% {
        transform: rotate(0deg); /* 初始位置 */
    }
    50% {
        transform: rotate(10deg); /* 旋转10度 */
    }
    100% {
        transform: rotate(0deg); /* 回到初始位置 */
    }
}

/* 关键帧：左右抖动 */
@keyframes shake {
    0% {
        transform: translateX(0); /* 初始位置 */
    }
    50% {
        transform: translateX(-1px); /* 向右移动3像素 */
    }
    100% {
        transform: translateX(0); /* 回到初始位置 */
    }
}

/* 关键帧：放大缩小 */
@keyframes scale {
    0% {
        transform: scale(1); /* 初始大小 */
    }
    50% {
        transform: scale(1.1); /* 放大到1.2倍 */
    }
    100% {
        transform: scale(1); /* 回到初始大小 */
    }
}


/* 桌面端和移动端显示控制 */
.desktop-only {
    display: inline-block;
}
.mobile-only {
    display: none;
}
@media (max-width: 768px) {
    .desktop-only {
        display: none !important;
    }
    .mobile-only {
        display: flex !important;
    }
}

.toggle-dark-button {
    width: 2.5rem;
    height: 2.5rem;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid var(--glass-border);
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
    background-color: var(--glass-bg);
    box-shadow: none;
    border-radius: 12px;
    position: fixed;
    top: 30px;
    right: 80px;
    padding: 0;
}
.more-dropdown {
    position: fixed;
    top: 30px;
    right: 30px;
    z-index: 100;
}
.more-dropdown .more-button {
    width: 2.5rem;
    height: 2.5rem;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid var(--glass-border);
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
    background-color: var(--glass-bg);
    box-shadow: none;
    color: var(--theme-toggle-color);
    border-radius: 12px;
    outline: none;
    padding: 0;
}
.more-dropdown .more-button:hover {
    transform: scale(1.05);
    border-color: var(--glass-border-hover);
}

.upload-method-button {
    width: 2.5rem;
    height: 2.5rem;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid var(--glass-border);
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
    background-color: var(--glass-bg);
    box-shadow: none;
    color: var(--theme-toggle-color);
    border-radius: 12px;
    position: fixed;
    top: 30px;
    right: 130px;
    outline: none;
    padding: 0;
}
@media (max-width: 768px) {
    .upload-method-button {
        width: 2rem;
        height: 2rem;
    }
}
.upload-method-icon {
    outline: none;
}
/* 右上角工具按钮内的图标统一尺寸(与 ToggleDark 的 1.5em 对齐) */
.more-button .svg-inline--fa,
.upload-method-button .svg-inline--fa {
    font-size: 1.5em;
}
.directory-tree-trigger .svg-inline--fa {
    font-size: 1.2em;
}

/* 移动端更多按钮 */
.mobile-more-dropdown {
    position: fixed;
    top: 30px;
    right: 18px;
    z-index: 100;
}
.mobile-more-button {
    width: 2rem;
    height: 2rem;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid var(--glass-border);
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
    background-color: var(--glass-bg);
    box-shadow: none;
    color: var(--theme-toggle-color);
    border-radius: 12px;
    outline: none;
    padding: 0;
}
.mobile-more-button:hover {
    transform: scale(1.05);
    border-color: var(--glass-border-hover);
}

/* 移动端「更多」按钮：与左侧按钮同尺寸同水平线，并补上按下反馈动效 */
@media (max-width: 768px) {
    .mobile-more-dropdown {
        /* 与左侧「上传目录」输入框严格对齐：
           输入框容器 top:30px、高 2rem(32px) → 中心 46px；本按钮高 2rem(32px) → top = 46 - 16 = 30px。 */
        top: 30px;
        right: 14px;
    }
    .mobile-more-button {
        /* 与左侧「目录选择」按钮同为 2rem，避免显得偏大 */
        width: 2rem;
        height: 2rem;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
    }
    .mobile-more-button:active {
        transform: scale(0.94);
        border-color: var(--glass-border-hover);
    }
    .mobile-more-button .svg-inline--fa {
        font-size: 1.15em;
    }
}

/* 上传文件输入框容器样式 */
.upload-folder-container {
    display: flex;
    align-items: center;
    position: fixed;
    top: 30px;
    /* 右侧只留「主题切换（right:80px）+ 更多（right:30px）」两个按钮的宽度，
       原「切换上传方式」按钮已移到上传框上方，这里不再预留它的空位 */
    right: 130px;
    z-index: 100;
}
.upload-folder-container.no-announcement {
    right: 130px;
}
@media (max-width: 768px) {
    .upload-folder-container {
        /* 与右侧「更多」按钮之间的间距收紧一点点（原 58px → 54px，留 8px 呼吸） */
        right: 54px;
    }
    .upload-folder-container.no-announcement {
        right: 54px;
    }

    /* 聚焦时容器保持原位，输入框只向左扩展，
       不再整体居中跳位（避免「目录选择」按钮与「更多菜单」之间跳出空位） */
    .upload-folder.active {
        width: min(64vw, 232px);
    }
}

/* 上传文件输入框样式 */
.upload-folder {
    width: 100px;
    height: 2.5rem;
    border-radius: 12px;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    transition: all 0.3s ease, width 0.4s ease;
}
.upload-folder.active {
    width: 200px;
}
@media (max-width: 768px) {
    .upload-folder {
        width: 80px;
        height: 2rem;
    }
    .upload-folder.active {
        width: 120px;
    }
}

/* 目录树触发按钮 */
.directory-tree-trigger {
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;
    border: 1px solid var(--glass-border);
    margin-left: 10px;
    background-color: var(--glass-bg);
    box-shadow: var(--glass-shadow);
    color: var(--theme-toggle-color);
    border-radius: 12px;
    outline: none;
    cursor: pointer;
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
}
.directory-tree-trigger:hover {
    border-color: var(--glass-border-hover);
    transform: scale(1.05);
}
@media (max-width: 768px) {
    .directory-tree-trigger {
        width: 2rem;
        height: 2rem;
        /* 「上传目录」输入框与「上传分类」按钮之间的间距：10px → 6px */
        margin-left: 6px;
    }
    .directory-tree-trigger .svg-inline--fa {
        font-size: 1.1em;
    }
}

.upload-folder :deep(.inner-folder-input) {
    width: 100%;
    height: 100%;
}

.upload-folder :deep(.el-input) {
    height: 100%;
    box-sizing: border-box;
}

.upload-folder :deep(.el-input__wrapper) {
    border-radius: 12px;
    background-color: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    box-shadow: var(--glass-shadow);
    border: 1px solid var(--glass-border);
    height: 100%;
    padding: 0 10px;
    box-sizing: border-box;
    transition: background-color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease !important;
}
.upload-folder :deep(.el-input__wrapper:hover) {
    background-color: color-mix(in srgb, var(--el-fill-color-blank) 85%, transparent);
    border-color: var(--glass-border-hover);
}
html.dark .upload-folder :deep(.el-input__wrapper:hover) {
    background-color: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
    border-color: var(--glass-border-hover);
}

.upload-folder :deep(.el-input__wrapper.is-focus),
.upload-folder :deep(.el-input__wrapper:focus-within) {
    border-color: var(--glass-border);
    box-shadow: var(--glass-shadow) !important;
}

.quick-toolbar {
    --quick-toolbar-size: 2.5rem;
    --quick-toolbar-button-size: calc(var(--quick-toolbar-size) - 6px);

    position: fixed;
    bottom: 50px;
    right: 30px;
    width: var(--quick-toolbar-size);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    z-index: 200;
    padding: 3px;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    background-color: var(--glass-bg);
    box-shadow: none;
    transition: background-color 0.24s ease, border-color 0.24s ease;
}
.toggle-dark-button,
.more-dropdown .more-button,
.upload-method-button,
.mobile-more-button,
.directory-tree-trigger,
.quick-toolbar {
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}

.quick-toolbar-button {
    width: var(--quick-toolbar-button-size);
    height: var(--quick-toolbar-button-size);
    border: none;
    transition: transform 0.22s ease, background-color 0.22s ease, box-shadow 0.22s ease, color 0.22s ease;
    margin-left: 0;
    padding: 0;
    border-radius: 999px;
    background-color: transparent;
    box-shadow: none;
    color: var(--toolbar-button-color);
    outline: none;
}
.quick-toolbar-actions {
    display: grid;
    grid-template-rows: 0fr;
    width: 100%;
    margin-bottom: 0;
    opacity: 0;
    pointer-events: none;
    transform: translateY(12px);
    transform-origin: bottom center;
    transition:
        grid-template-rows 0.52s cubic-bezier(0.16, 1, 0.3, 1),
        margin-bottom 0.52s cubic-bezier(0.16, 1, 0.3, 1),
        opacity 0.32s ease,
        transform 0.52s cubic-bezier(0.16, 1, 0.3, 1);
}
.quick-toolbar.is-expanded .quick-toolbar-actions {
    grid-template-rows: 1fr;
    margin-bottom: 4px;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
}
.quick-toolbar-actions-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-height: 0;
    overflow: hidden;
}
.quick-toolbar-more.is-active {
    background-color: var(--upload-action-btn-hover-bg);
    box-shadow: var(--upload-action-btn-shadow);
}
.quick-toolbar-more {
    margin-top: 4px;
}
.quick-toolbar-icon {
    font-size: 16px;
}
.quick-toolbar-toggle-icon {
    transform: rotate(180deg);
    transition: transform 0.32s ease;
}
.quick-toolbar-more.is-active .quick-toolbar-toggle-icon {
    transform: rotate(0deg);
}

/* 按钮悬停效果 */
.info-container:hover,
.quick-toolbar-button:hover {
    transform: scale(1.05);
    background-color: var(--upload-action-btn-hover-bg);
    box-shadow: var(--upload-action-btn-hover-shadow);
}
.quick-toolbar:hover {
    border-color: var(--glass-border-hover);
}
.quick-toolbar-button:hover {
    transform: none;
}
.toggle-dark-button:hover,
.upload-method-button:hover {
    transform: scale(1.05);
    border-color: var(--glass-border-hover);
}
.upload-folder:hover :deep(.el-input__wrapper) {
    background-color: color-mix(in srgb, var(--el-fill-color-blank) 85%, transparent);
    border-color: var(--glass-border-hover);
}
html.dark .upload-folder:hover :deep(.el-input__wrapper) {
    background-color: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
    border-color: var(--glass-border-hover);
}

@media (max-width: 768px) {
    .quick-toolbar {
        --quick-toolbar-size: 2rem;
        --quick-toolbar-button-size: calc(var(--quick-toolbar-size) - 4px);

        /* 右侧边距调小一点点（18px → 12px），与顶部「更多」按钮视觉更齐 */
        right: 12px;
        bottom: max(72px, calc(6vh + 20px + env(safe-area-inset-bottom)));
        padding: 2px;
    }
    .quick-toolbar-actions {
        margin-bottom: 0;
    }
    .quick-toolbar.is-expanded .quick-toolbar-actions {
        margin-bottom: 3px;
    }
    .quick-toolbar-actions-inner {
        gap: 2px;
    }
    .quick-toolbar-more {
        margin-top: 3px;
    }
    .quick-toolbar-icon {
        font-size: 14px;
    }
}


:deep(.el-dialog) {
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    background-color: var(--dialog-bg-color);
    box-shadow: var(--dialog-box-shadow);
}
.dialog-action {
    display: flex;
    justify-content: center;
    margin-top: 20px;
}


.header {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 15px;
    margin-top: 5vh;
    color: var(--upload-header-color);
    user-select: none;
    text-decoration: none;
    position: relative;
    top: -3vh;
    transition: all 0.3s ease;
}
.title {
    font-size: 2.25rem;
    font-weight: 400;
    font-family: 'Pacifico', 'Noto Sans SC', sans-serif;
    color: var(--upload-title-text-color);
    text-shadow: var(--upload-title-text-shadow);
    position: relative;
    isolation: isolate;
    padding-bottom: 8px;
    cursor: pointer;
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), filter 0.25s ease;
    animation: float 4s ease-in-out infinite;
    letter-spacing: 3px;
}
.title:hover {
    transform: scale(1.08);
    filter: drop-shadow(0 0 20px var(--upload-title-hover-glow));
}
.title::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: 0;
    width: 0;
    height: 3px;
    background: var(--upload-title-underline-bg);
    border-radius: 3px;
    transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: var(--upload-title-underline-shadow);
}
.title:hover::after {
    width: 80%;
}

.main-title {
    color: var(--upload-main-title-color);
    text-decoration: none;
    display: inline-block;
    position: relative;
    filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.3));
}

.title-base-text {
    position: relative;
    z-index: 1;
    display: inline-block;
    transition: opacity 0.16s ease;
}

.title:hover .title-base-text {
    opacity: 0;
}

.title:hover {
    text-shadow: none;
}

.title-crayon-text {
    position: absolute;
    left: 50%;
    top: -1px;
    z-index: 2;
    width: max-content;
    pointer-events: none;
    white-space: nowrap;
    color: var(--upload-title-crayon-deep, #1D2129);
    opacity: 0;
    -webkit-text-stroke: 0.35px var(--upload-title-crayon-edge);
    text-shadow:
        -1.2px 0.4px 0 var(--upload-title-crayon-burr),
        0.9px -0.7px 0 rgba(255, 255, 255, 0.24),
        1.5px 0.5px 0 var(--upload-title-crayon-dust),
        -1.7px -0.6px 0 var(--upload-title-crayon-dust);
    transform: translateX(-50%) rotate(-0.8deg);
    transform-origin: left 68%;
    clip-path: inset(-10px 100% -24px -10px);
    filter: saturate(1.08) contrast(1.06);
}

.title:hover .title-crayon-text {
    animation:
        crayonWrite 0.82s steps(18, end) forwards,
        crayonScratch 0.16s steps(2, end) 0.82s 3;
}



/* 漂浮动画 */
@keyframes float {
    0%, 100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(-5px);
    }
}

@keyframes crayonWrite {
    0% {
        opacity: 0;
        clip-path: inset(-10px 100% -24px -10px);
    }
    12% {
        opacity: 0.92;
    }
    32% {
        clip-path: inset(-10px 68% -24px -10px);
    }
    47% {
        clip-path: inset(-10px 52% -24px -10px);
    }
    63% {
        clip-path: inset(-10px 34% -24px -10px);
    }
    78% {
        clip-path: inset(-10px 18% -24px -10px);
    }
    100% {
        opacity: 0.92;
        clip-path: inset(-10px -10px -24px -10px);
    }
}

@keyframes crayonScratch {
    0%, 100% {
        transform: translateX(-50%) rotate(-0.8deg);
    }
    50% {
        transform: translateX(calc(-50% + 1px)) rotate(-0.45deg);
    }
}

@media (max-width: 768px) {
    .title {
        font-size: 1.4rem;
        letter-spacing: 0.75px;
    }
    .title:hover {
        transform: scale(1.05);
    }
}

.upload-home {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 94vh;
    background-color: transparent;
}
/* 上传区整体（标签页 + 上传框）作为一个纵向栈，统一保持原有的视觉上移 */
.upload-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    top: -3vh;
}

/* 上传方式标签页：位于上传框上方，默认 / 链接 */
.upload-method-tabs {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    margin-bottom: 10px;
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}
.upload-method-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 20px;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--text-color-secondary, #666);
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background-color 0.25s ease, color 0.25s ease, transform 0.25s ease;
}
.upload-method-tab:hover {
    color: var(--primary-color);
}
/* 点击/聚焦后不显示浏览器默认聚焦边框 */
.upload-method-tab:focus,
.upload-method-tab:focus-visible,
.upload-method-tab:active {
    outline: none;
    box-shadow: none;
}
.upload-method-tab.is-active {
    color: #fff;
    background: var(--primary-color);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.upload-method-tab.is-active:focus,
.upload-method-tab.is-active:focus-visible {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.upload-method-tab-icon {
    font-size: 14px;
}
@media (max-width: 768px) {
    .upload-stack {
        top: -3.8vh;
    }
    .upload-method-tab {
        padding: 6px 14px;
        font-size: 13px;
    }
}

.upload {
    margin-bottom: 5px;
    position: relative;
    top: 0;
}

@media (max-width: 768px) {
    .header {
        padding: 5px 15px 2px;
        top: -2.5vh;
    }
    .title {
        margin: 0.4em 0;
        padding-bottom: 0.45em;
        line-height: 1.2;
    }
    .upload {
        top: 0;
    }
}

/* 可用高度较小的桌面视口：减少标题占用和上传区上方留白。 */
@media (min-width: 769px) and (max-height: 1050px) {
    .header {
        padding: 8px 15px;
        margin-top: 3vh;
        top: -2vh;
    }

    .title {
        margin: 0.45em 0;
        padding-bottom: 0.45em;
        font-size: 1.875rem;
        line-height: 1.2;
        letter-spacing: 2px;
    }

    .upload {
        top: -2.5vh;
    }
}

.footer {
    height: 6vh;
}
</style>
