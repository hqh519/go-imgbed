<template>
    <div class="container">
        <el-container direction="vertical">
            <!-- 「链接格式」是面向管理员的默认外链格式设置，普通用户隐藏该入口 -->
            <AdminHeader active-tab="dashboard" :show-link-format="isAdminRole" @link-format="showUrlDialog = true">
                <template #search>
                    <div class="search-area">
                        <div class="search-card" :class="{ 'is-settings-open': searchSettingsOpen }">
                            <el-input ref="searchInput" v-model="tempSearch" size="small" :placeholder="$t('dashboard.searchPlaceholder')" @keyup.enter="handleSearch">
                                <template #prefix>
                                    <!-- 搜索范围：直接嵌在搜索框起始位置，与输入框合成一个整体 -->
                                    <el-select
                                        v-model="searchType"
                                        size="small"
                                        class="search-type-select"
                                        popper-class="compact-select-popper"
                                        @change="handleSearchTypeChange"
                                    >
                                        <el-option
                                            v-for="opt in searchTypeOptions"
                                            :key="opt.value"
                                            :label="opt.label"
                                            :value="opt.value"
                                        />
                                    </el-select>
                                    <span class="search-scope-sep" aria-hidden="true"></span>
                                </template>
                                <template #suffix>
                                    <!-- 一键清空：仅当搜索框有内容时显示，位于搜索按钮左侧 -->
                                    <button
                                        v-if="tempSearch.length > 0"
                                        type="button"
                                        class="search-clear-trigger"
                                        :aria-label="$t('dashboard.clearSearch')"
                                        :title="$t('dashboard.clearSearch')"
                                        @mousedown.prevent
                                        @click.stop="handleClearSearch"
                                    >
                                        <font-awesome-icon icon="times" class="search-clear-icon" />
                                    </button>
                                    <el-tooltip
                                        ref="searchSettingsPopup"
                                        :trigger="isMobileViewport() ? [] : 'hover'"
                                        placement="bottom-start"
                                        effect="light"
                                        popper-class="el-dropdown__popper search-settings-popper"
                                        :popper-style="{ padding: '0' }"
                                        :focus-on-target="false"
                                        :focus-on-show="false"
                                        persistent
                                        :show-after="150"
                                        :hide-after="150"
                                        @before-show="searchSettingsOpen = true"
                                        @hide="searchSettingsOpen = false"
                                    >
                                        <template #default>
                                            <button
                                                type="button"
                                                class="search-icon-trigger"
                                                :aria-label="$t('dashboard.searchPlaceholder')"
                                                @mousedown.prevent
                                                @pointerdown="handleSearchIconPointerDown"
                                                @pointermove="handleSearchIconPointerMove"
                                                @pointerup="cancelSearchIconPress"
                                                @pointercancel="cancelSearchIconPress"
                                                @pointerleave="cancelSearchIconPress"
                                                @contextmenu.prevent
                                                @click="handleSearchIconClick"
                                            >
                                                <font-awesome-icon icon="search" class="search-icon" />
                                            </button>
                                        </template>
                                        <template #content>
                                            <div class="el-dropdown-menu modern-dropdown-menu search-result-menu" role="group" :aria-label="$t('dashboard.searchResultDisplay')" @mousedown.prevent>
                                                <div class="search-result-settings-title">{{ $t('dashboard.searchResultDisplay') }}</div>
                                                <button type="button" class="el-dropdown-menu__item search-result-option" :aria-pressed="searchResultDisplay === 'folders'" @click="selectSearchResultDisplay('folders')">
                                                    <font-awesome-icon icon="folder-open" class="search-result-option-icon" />
                                                    <span>{{ $t('dashboard.searchResultFolders') }}</span>
                                                    <font-awesome-icon v-if="searchResultDisplay === 'folders'" icon="check" class="search-result-option-check" />
                                                </button>
                                                <button type="button" class="el-dropdown-menu__item search-result-option" :aria-pressed="searchResultDisplay === 'expanded'" @click="selectSearchResultDisplay('expanded')">
                                                    <font-awesome-icon icon="list" class="search-result-option-icon" />
                                                    <span>{{ $t('dashboard.searchResultExpanded') }}</span>
                                                    <font-awesome-icon v-if="searchResultDisplay === 'expanded'" icon="check" class="search-result-option-check" />
                                                </button>
                                            </div>
                                        </template>
                                    </el-tooltip>
                                </template>
                            </el-input>
                        </div>
                        <FilterDropdown
                            v-model:filters="filters"
                            :channelNameOptions="channelNameOptions"
                            @change="handleFilterChange"
                        />
                        <!-- 标签筛选：弹窗里多选标签，支持「或 / 且」 -->
                        <el-badge :value="filters.tagNames.length" :hidden="filters.tagNames.length === 0" class="tag-filter-badge">
                            <el-button
                                class="tag-filter-btn"
                                :class="{ 'is-active': filters.tagNames.length > 0 }"
                                size="small"
                                :title="$t('dashboard.tagFilter')"
                                :aria-label="$t('dashboard.tagFilter')"
                                @click="openTagFilterDialog"
                            >
                                <font-awesome-icon icon="tags" class="tag-filter-icon"/>
                            </el-button>
                        </el-badge>
                        <!-- 刷新：不刷新页面，重新拉取当前分类下的文件列表 -->
                        <el-button
                            class="refresh-files-btn"
                            size="small"
                            :title="$t('dashboard.refreshFiles')"
                            :aria-label="$t('dashboard.refreshFiles')"
                            @click="handleRefreshFiles"
                        >
                            <font-awesome-icon icon="sync" :class="{ 'fa-spin': refreshLoading }" class="refresh-files-icon"/>
                        </el-button>
                        <!-- 回收站：切换查看已删除（软删除）的文件，可恢复或彻底删除 -->
                        <el-button
                            class="refresh-files-btn trash-btn"
                            :class="{ 'is-active': trashMode }"
                            size="small"
                            :title="trashMode ? $t('dashboard.trashExit') : $t('dashboard.trashEnter')"
                            :aria-label="trashMode ? $t('dashboard.trashExit') : $t('dashboard.trashEnter')"
                            @click="toggleTrashMode"
                        >
                            <font-awesome-icon icon="trash-alt" :class="{ 'fa-spin': trashLoading }" class="refresh-files-icon"/>
                        </el-button>
                    </div>
                </template>
            </AdminHeader>
            <el-main class="main-container" :class="{ 'has-batch-toolbar': selectedFiles.length > 0 }">
            <!-- 回收站模式提示条：明确当前列表是已删除文件（外链已 404，可恢复或彻底删除） -->
            <div v-if="trashMode" class="trash-banner" role="status">
                <font-awesome-icon icon="trash-alt" class="trash-banner-icon"/>
                <span class="trash-banner-text">{{ $t('dashboard.trashBanner') }}</span>
            </div>
            <!-- 目录导航 -->
            <div class="breadcrumb-container">
                <DashboardCheckbox
                    :checked="selectPage"
                    :indeterminate="selectedPageFiles && !selectPage"
                    variant="breadcrumb"
                    @click="handleSelectPage"
                />
                <div
                    class="breadcrumb-view-toggle"
                    :class="{ 'is-list': viewMode === 'list' }"
                    role="group"
                >
                    <button
                        class="breadcrumb-view-button"
                        :class="{ 'is-active': viewMode === 'card' }"
                        type="button"
                        :title="$t('dashboard.cardView')"
                        :aria-pressed="viewMode === 'card'"
                        @click="setViewMode('card')"
                    >
                        <font-awesome-icon icon="th-large" class="breadcrumb-view-icon"></font-awesome-icon>
                    </button>
                    <button
                        class="breadcrumb-view-button"
                        :class="{ 'is-active': viewMode === 'list' }"
                        type="button"
                        :title="$t('dashboard.listView')"
                        :aria-pressed="viewMode === 'list'"
                        @click="setViewMode('list')"
                    >
                        <font-awesome-icon icon="list" class="breadcrumb-view-icon"></font-awesome-icon>
                    </button>
                </div>
                <el-dropdown
                    trigger="click"
                    class="breadcrumb-sort-dropdown"
                    @command="setSortField"
                >
                    <button
                        class="breadcrumb-sort-button"
                        type="button"
                        :title="sortLabel"
                    >
                        <svg class="breadcrumb-sort-icon" viewBox="0 0 30 18" aria-hidden="true">
                            <g v-if="sortField === 'time'" class="sort-field-glyph">
                                <circle cx="7.5" cy="9" r="5.5" />
                                <path d="M7.5 5.5V9L10 10.5" />
                            </g>
                            <g v-else-if="sortField === 'size'" class="sort-field-glyph">
                                <path d="M2 4H13M2 9H10M2 14H7" />
                            </g>
                            <g v-else-if="sortField === 'rawName'" class="sort-field-glyph">
                                <path d="M5.5 3L4 15M11 3L9.5 15M2.5 7H13M2 11H12.5" />
                            </g>
                            <g v-else-if="sortField === 'views'" class="sort-field-glyph">
                                <path d="M2 9S4.5 4.5 7.5 4.5 13 9 13 9 10.5 13.5 7.5 13.5 2 9 2 9Z" />
                                <circle cx="7.5" cy="9" r="1.8" />
                            </g>
                            <g v-else class="sort-field-glyph">
                                <path d="M2.5 14L7.5 3L12.5 14M4.3 10H10.7" />
                            </g>
                            <path
                                v-if="sortOrder === 'asc'"
                                class="sort-order-glyph"
                                d="M23 13.5V4.5M19 8.5L23 4.5L27 8.5"
                            />
                            <path
                                v-else
                                class="sort-order-glyph"
                                d="M23 4.5V13.5M19 9.5L23 13.5L27 9.5"
                            />
                        </svg>
                    </button>
                    <template #dropdown>
                        <el-dropdown-menu class="sort-dropdown-menu">
                            <div class="sort-order-wrapper">
                                <el-radio-group v-model="sortOrder" size="small" @change="setSortOrder">
                                    <el-radio-button label="asc">{{ $t('dashboard.sortAsc') }}</el-radio-button>
                                    <el-radio-button label="desc">{{ $t('dashboard.sortDesc') }}</el-radio-button>
                                </el-radio-group>
                            </div>

                            <el-divider class="sort-divider" />

                            <el-dropdown-item command="time" :class="{ 'is-selected': sortField === 'time' }">
                                <span>{{ $t('dashboard.sortByTime') }}</span>
                                <font-awesome-icon v-if="sortField === 'time'" icon="check" class="sort-field-check" />
                            </el-dropdown-item>
                            <el-dropdown-item command="size" :class="{ 'is-selected': sortField === 'size' }">
                                <span>{{ $t('dashboard.sortBySize') }}</span>
                                <font-awesome-icon v-if="sortField === 'size'" icon="check" class="sort-field-check" />
                            </el-dropdown-item>
                            <!-- 「文件名」排在「文件 ID」之前 -->
                            <el-dropdown-item command="fileName" :class="{ 'is-selected': sortField === 'fileName' }">
                                <span>{{ $t('dashboard.sortByFileName') }}</span>
                                <font-awesome-icon v-if="sortField === 'fileName'" icon="check" class="sort-field-check" />
                            </el-dropdown-item>
                            <el-dropdown-item command="rawName" :class="{ 'is-selected': sortField === 'rawName' }">
                                <span>{{ $t('dashboard.sortByRawName') }}</span>
                                <font-awesome-icon v-if="sortField === 'rawName'" icon="check" class="sort-field-check" />
                            </el-dropdown-item>
                            <el-dropdown-item command="fileType" :class="{ 'is-selected': sortField === 'fileType' }">
                                <span>{{ $t('dashboard.sortByFileType') }}</span>
                                <font-awesome-icon v-if="sortField === 'fileType'" icon="check" class="sort-field-check" />
                            </el-dropdown-item>
                            <el-dropdown-item command="views" :class="{ 'is-selected': sortField === 'views' }">
                                <span>{{ $t('dashboard.sortByViews') }}</span>
                                <font-awesome-icon v-if="sortField === 'views'" icon="check" class="sort-field-check" />
                            </el-dropdown-item>
                            <!-- 「上传用户」放在排序项目最后 -->
                            <el-dropdown-item command="uploader" :class="{ 'is-selected': sortField === 'uploader' }">
                                <span>{{ $t('dashboard.sortByUploader') }}</span>
                                <font-awesome-icon v-if="sortField === 'uploader'" icon="check" class="sort-field-check" />
                            </el-dropdown-item>
                        </el-dropdown-menu>
                    </template>
                </el-dropdown>
                <!-- 移动端目录按钮 -->
                <div class="mobile-directory-trigger" @click="showMobileDirectoryDrawer = true">
                    <font-awesome-icon icon="folder-open" class="mobile-directory-icon"/>
                    <span class="mobile-directory-path">{{ currentPath && currentPath.split('/').filter(Boolean).length > 0 ? currentPath.split('/').filter(Boolean).pop() : $t('dashboard.rootDirectory') }}</span>
                    <font-awesome-icon icon="chevron-down" class="mobile-directory-arrow"/>
                </div>
                <!-- 桌面端面包屑 -->
                <div class="breadcrumb desktop-only">
                    <el-breadcrumb separator="/">
                        <el-breadcrumb-item @click="navigateToFolder('')">
                            <font-awesome-icon icon="home" class="breadcrumb-home-icon"/>
                        </el-breadcrumb-item>
                        <el-breadcrumb-item 
                            v-for="(folder, index) in currentPath.split('/').filter(Boolean)" 
                            :key="index"
                            @click="navigateToFolder(currentPath.split('/').filter(Boolean).slice(0, index + 1).join('/'))">
                            {{ folder }}
                        </el-breadcrumb-item>
                    </el-breadcrumb>
                </div>
                <div class="breadcrumb-right-group">
                    <!-- 上传用户筛选：仅管理员可见，默认「全部」 -->
                    <el-select
                        v-if="isAdminRole"
                        v-model="userFilter"
                        size="small"
                        class="user-filter-select"
                        popper-class="compact-select-popper"
                        :placeholder="$t('dashboard.allUsers')"
                        @change="handleUserFilterChange"
                    >
                        <el-option :label="$t('dashboard.allUsers')" value="all" />
                        <el-option
                            v-for="u in userOptions"
                            :key="u.username"
                            :label="u.nickname || u.username"
                            :value="u.username"
                        />
                    </el-select>
                    <!-- 新建目录：位于历史记录左侧 -->
                    <el-button class="new-folder-btn" size="small" :title="$t('dashboard.newFolder')" :aria-label="$t('dashboard.newFolder')" @click="handleCreateFolder">
                        <font-awesome-icon icon="plus" class="new-folder-icon"/>
                        <span class="new-folder-text">{{ $t('dashboard.newFolder') }}</span>
                    </el-button>
                    <!-- 历史记录：位于数量统计徽章左侧 -->
                    <el-button class="history-btn" size="small" type="primary" plain :title="$t('dashboard.history')" @click="goHistoryPage">
                        <font-awesome-icon icon="history" class="history-btn-icon"/>
                        <span class="history-btn-text">{{ $t('dashboard.history') }}</span>
                    </el-button>
                    <span class="stats-badge" :title="$t('dashboard.totalFiles', { count: $data.Number })">
                        <font-awesome-icon icon="database" class="stats-badge-icon"/>
                        {{ Number }}
                    </span>
                </div>
            </div>
            
            <!-- 卡片视图 -->
            <div
                v-if="viewMode === 'card'"
                class="content"
                :class="{ 'is-drag-selecting': isDragging }"
                ref="cardContainerRef"
                @touchstart.passive="handlePageSwipeStart"
                @touchend.passive="handlePageSwipeEnd"
                @touchcancel.passive="resetPageSwipe"
            >
                <!-- 加载骨架屏 -->
                <SkeletonLoader v-if="loading" type="card" :count="pageSize" />
                <!-- 空状态 -->
                <div v-else-if="paginatedTableData.length === 0" class="empty-state">
                    <font-awesome-icon icon="folder-open" class="empty-icon" />
                    <p class="empty-text">{{ hasSearchOrFilter ? $t('dashboard.noMatchingFiles') : $t('dashboard.currentDirEmpty') }}</p>
                    <p class="empty-hint">{{ hasSearchOrFilter ? $t('dashboard.adjustSearchHint') : $t('dashboard.uploadHint') }}</p>
                </div>
                <!-- 文件夹和文件列表 -->
                <template v-else v-for="(item, index) in paginatedTableData" :key="`${item.isFolder ? 'folder' : 'file'}:${item.name}`">
                    <!-- 文件夹卡片 -->
                    <FolderCard
                        v-if="isFolder(item)"
                        :name="item.name"
                        v-model:selected="item.selected"
                        :folderStats="item.metadata?.folderStats || null"
                        :showActions="!isSearchMode"
                        :disableTooltip="disableTooltip"
                        @enter="enterFolder(item.name)"
                        @copy="handleFolderCopy(item.name)"
                        @move="handleMove(index, item.name)"
                        @delete="handleDelete(index, item.name)"
                        @touchstart="handleFolderTouchStart(item, index)"
                        @touchend="handleTouchEnd"
                        @touchmove="handleTouchEnd"
                    />
                    <!-- 文件卡片 -->
                    <FileCard 
                        v-else
                        :item="item"
                        v-model:selected="item.selected"
                        :fileLink="getFileLink(item.name)"
                        :previewSrcList="item.previewSrcList"
                        :disableTooltip="disableTooltip"
                        @detail="openDetailDialog(index, item.name)"
                        @openLink="handleOpenLink(item.name)"
                        @copy="handleCopy(index, item.name)"
                        @move="handleMove(index, item.name)"
                        @delete="handleDelete(index, item.name)"
                        @download="handleDownload(item.name)"
                        @touchstart="handleTouchStart(item, index)"
                        @touchend="handleTouchEnd"
                        @touchmove="handleTouchEnd"
                    />
                </template>
            </div>
            <!-- 列表视图 -->
            <div
                v-else
                class="list-view"
                :class="{ 'is-drag-selecting': isDragging }"
                ref="listContainerRef"
                @touchstart.passive="handlePageSwipeStart"
                @touchend.passive="handlePageSwipeEnd"
                @touchcancel.passive="resetPageSwipe"
            >
                <!--
                    v2.5.0：列表视图改为「历史记录列表」样式（圆角卡片行、无表头）——
                    表头整行移除，全选入口保留在面包屑左侧的「本页全选」复选框。
                -->
                <!-- 列表骨架屏 -->
                <SkeletonLoader v-if="loading" type="list" :count="pageSize" />
                <!-- 空状态 -->
                <div v-else-if="paginatedTableData.length === 0" class="empty-state list-empty">
                    <font-awesome-icon icon="folder-open" class="empty-icon" />
                    <p class="empty-text">{{ hasSearchOrFilter ? $t('dashboard.noMatchingFiles') : $t('dashboard.currentDirEmpty') }}</p>
                    <p class="empty-hint">{{ hasSearchOrFilter ? $t('dashboard.adjustSearchHint') : $t('dashboard.uploadHint') }}</p>
                </div>
                <!-- 实际数据 -->
                <template v-else>
                    <FileListItem
                        v-for="(item, index) in paginatedTableData"
                        :key="`${item.isFolder ? 'folder' : 'file'}:${item.name}`"
                        :item="item"
                        v-model:selected="item.selected"
                        :fileLink="getFileLink(item.name)"
                        @enter="enterFolder(item.name)"
                        @detail="openDetailDialog(index, item.name)"
                        @copy="handleCopy(index, item.name)"
                        @folderCopy="handleFolderCopy(item.name)"
                        @move="handleMove(index, item.name)"
                        @delete="handleDelete(index, item.name)"
                        @download="handleDownload(item.name)"
                        @openLink="handleOpenLink(item.name)"
                        @touchstart="isFolder(item) ? handleFolderTouchStart(item, index) : handleTouchStart(item, index)"
                        @touchend="handleTouchEnd"
                        @touchmove="handleTouchEnd"
                    />
                </template>
            </div>
            
            <!-- 选区矩形覆盖层 -->
            <div
              v-if="isDragging"
              class="drag-select-overlay"
              :style="{
                position: 'fixed',
                left: selectionRect.left + 'px',
                top: selectionRect.top + 'px',
                width: selectionRect.width + 'px',
                height: selectionRect.height + 'px'
              }"
            ></div>

            <div class="pagination-container">
                <div class="pagination-center">
                    <el-pagination
                        background
                        layout="prev, pager, next"
                        :total="filteredTableData.length"
                        :page-size="pageSize"
                        :current-page="currentPage"
                        :pager-count="pagerCount"
                        @current-change="handlePageChange">
                    </el-pagination>
                    <el-button 
                        type="primary" 
                        @click="refreshFileList" 
                        class="refresh-btn">
                        <font-awesome-icon icon="sync" :class="{ 'fa-spin': refreshLoading }"/>
                    </el-button>
                    <el-button
                        v-if="currentPage === Math.ceil(filteredTableData.length / pageSize)" 
                        type="primary" 
                        @click="loadMoreData" 
                        :loading="loading" 
                        class="load-more">
                        {{ $t('dashboard.loadMore') }}
                    </el-button>
                </div>
                <div class="pagination-right">
                    <span class="page-total">{{ $t('dashboard.totalPages', { count: realTotalPages }) }}</span>
                    <div class="page-jump">
                        <span>{{ $t('dashboard.jumpTo') }}</span>
                        <el-input 
                            v-model="jumpPage" 
                            size="small" 
                            class="jump-input"
                            @keyup.enter="handleJumpPage"
                        />
                        <el-button size="small" type="primary" @click="handleJumpPage" class="jump-btn">GO</el-button>
                    </div>
                </div>
            </div>
            </el-main>
        </el-container>
        <BatchActionBar
            :selected-count="selectedFiles.length"
            :mode="trashMode ? 'trash' : 'normal'"
            @action="handleBatchAction"
            @clear="clearSelection"
        />
        <!-- 文件详情弹窗 -->
        <FileDetailDialog
            v-model="showdetailDialog"
            :file="detailFile"
            :fileLink="getFileLink(detailFile?.name)"
            :urls="allUrl"
            :trashMode="trashMode"
            @download="handleDownload(detailFile?.name)"
            @tagManagement="handleTagManagement(detailFile?.name)"
            @block="handleBlock(detailFile?.name)"
            @white="handleWhite(detailFile?.name)"
            @delete="handleDetailDelete(detailFile?.name)"
            @restore="handleDetailTrash('restore', detailFile)"
            @purge="handleDetailTrash('purge', detailFile)"
            @metadataUpdated="handleMetadataUpdated"
            @fileRenamed="handleFileRenamed"
        />
        <el-dialog :title="$t('dashboard.linkFormat')" v-model="showUrlDialog" :width="dialogWidth" :show-close="false" class="settings-dialog settings-dialog-scope">
            <div class="dialog-section">
                <div class="section-header">
                    <span class="section-title">{{ $t('settings.defaultCopyLink') }}</span>
                </div>
                <div class="section-content">
                    <el-radio-group v-model="defaultUrlFormat" class="radio-card-group grid-2x2">
                        <el-radio label="originUrl" class="radio-card">
                            <font-awesome-icon icon="link" class="radio-icon"/>
                            <span>{{ $t('settings.rawLink') }}</span>
                        </el-radio>
                        <el-radio label="mdUrl" class="radio-card">
                            <font-awesome-icon icon="code" class="radio-icon"/>
                            <span>Markdown</span>
                        </el-radio>
                        <el-radio label="htmlUrl" class="radio-card">
                            <font-awesome-icon icon="code-branch" class="radio-icon"/>
                            <span>HTML</span>
                        </el-radio>
                        <el-radio label="bbUrl" class="radio-card">
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

        <!-- Tag Management Dialog -->
        <TagManagementDialog
            v-model="showTagDialog"
            :fileId="currentTagFile"
            :fileMetadata="tagFileMetadata"
            @tagsUpdated="handleTagsUpdated"
        />

        <!-- Batch Tag Management Dialog -->
        <BatchTagDialog
            v-model="showBatchTagDialog"
            :selectedFiles="selectedFiles"
            @tagsUpdated="handleBatchTagsUpdated"
        />
        <!-- 移动端操作菜单 -->
        <MobileActionSheet
            v-model="showMobileActionModal"
            :title="mobileActionIsFolder ? getFolderName(mobileActionFile?.name || '') : (mobileActionFile?.metadata?.FileName || getFileName(mobileActionFile?.name || ''))"
            :isFolder="mobileActionIsFolder"
            @action="handleMobileAction"
        />
        <!-- 移动端目录抽屉 -->
        <MobileDirectoryDrawer
            v-model="showMobileDirectoryDrawer"
            :currentPath="currentPath"
            @navigate="navigateToFolder"
            @goBack="handleGoBack"
        />
        <!-- 标签筛选弹窗：多选已有标签，「或 / 且」切换 -->
        <el-dialog
            v-model="showTagFilterDialog"
            :title="$t('dashboard.tagFilter')"
            :width="dialogWidth"
            class="tag-filter-dialog"
            append-to-body
        >
            <div class="tag-filter-toolbar">
                <el-radio-group v-model="tagModeDraft" size="small">
                    <el-radio-button label="or">{{ $t('dashboard.tagModeOr') }}</el-radio-button>
                    <el-radio-button label="and">{{ $t('dashboard.tagModeAnd') }}</el-radio-button>
                </el-radio-group>
                <span class="tag-filter-hint">
                    {{ tagModeDraft === 'or' ? $t('dashboard.tagModeOrHint') : $t('dashboard.tagModeAndHint') }}
                </span>
            </div>
            <div class="tag-filter-list" v-loading="tagFilterLoading">
                <button
                    v-for="t in allTags"
                    :key="t.name"
                    type="button"
                    class="tag-filter-chip"
                    :class="{ 'is-selected': tagDraft.includes(t.name) }"
                    :aria-pressed="tagDraft.includes(t.name)"
                    @click="toggleTagDraft(t.name)"
                >
                    <span class="tag-filter-name">{{ t.name }}</span>
                    <span class="tag-filter-count">{{ t.count }}</span>
                </button>
                <div v-if="!tagFilterLoading && allTags.length === 0" class="tag-filter-empty">
                    {{ $t('dashboard.tagFilterEmpty') }}
                </div>
            </div>
            <template #footer>
                <el-button @click="showTagFilterDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button @click="clearTagFilter" :disabled="tagDraft.length === 0">{{ $t('dashboard.tagFilterClear') }}</el-button>
                <el-button type="primary" @click="applyTagFilter">{{ $t('common.confirm') }}</el-button>
            </template>
        </el-dialog>

        <!-- 移动文件对话框 -->
        <MoveFileDialog
            v-model="showMoveDialog"
            :current-directory="currentPath"
            :is-batch-move="isBatchMove"
            :initial-path="moveTargetPath"
            @confirm="confirmMove"
        />
    </div>
</template>

<script>
import { mapGetters } from 'vuex';
import JSZip from 'jszip';
import AdminHeader from '@/components/dashboard/AdminHeader.vue';
import TagManagementDialog from '@/components/dashboard/TagManagementDialog.vue';
import BatchTagDialog from '@/components/dashboard/BatchTagDialog.vue';
import SkeletonLoader from '@/components/dashboard/SkeletonLoader.vue';
import FileCard from '@/components/dashboard/FileCard.vue';
import FolderCard from '@/components/dashboard/FolderCard.vue';
import MoveFileDialog from '@/components/dashboard/MoveFileDialog.vue';
import FileListItem from '@/components/dashboard/FileListItem.vue';
import FileDetailDialog from '@/components/dashboard/FileDetailDialog.vue';
import BatchActionBar from '@/components/dashboard/BatchActionBar.vue';
import MobileActionSheet from '@/components/dashboard/MobileActionSheet.vue';
import MobileDirectoryDrawer from '@/components/dashboard/MobileDirectoryDrawer.vue';
import DashboardCheckbox from '@/components/dashboard/DashboardCheckbox.vue';
import FilterDropdown from '@/components/dashboard/FilterDropdown.vue';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { fileManager } from '@/utils/fileManager';
// 文件详情通用数据构造器（与「历史记录」页共用同一套模板 + 同一套链接拼装逻辑）
import {
    buildFileDetailUrls as buildFileDetailUrlsUtil,
    fileExtOf as fileExtOfUtil,
    withExt as withExtUtil,
    filePublicUrl as filePublicUrlUtil,
} from '@/utils/fileDetail';
import { CHANNEL_TYPES } from '@/components/config/channel-schema';
import { channelTypeCode } from '@/utils/storageChannels';
import fetchWithAuth from '@/utils/fetchWithAuth';
import axios from '@/utils/axios';
import { validateFolderPath } from '@/utils/pathValidator';
import { copyText } from '@/utils/clipboard';
import { getLinkPrefix } from '@/utils/fileLink';
import backgroundManager from '@/mixins/backgroundManager';
import pageActivation from '@/mixins/pageActivation';
import { ref } from 'vue';
import { useDragSelect } from '@/utils/dashboard/useDragSelect.js';

const SORT_FIELDS = ['time', 'size', 'fileName', 'rawName', 'fileType', 'views', 'uploader'];
const SORT_ORDERS = ['asc', 'desc'];
const SEARCH_RESULT_DISPLAYS = ['folders', 'expanded'];

function getStoredOption(key, validValues, fallback) {
    try {
        const value = localStorage.getItem(key);
        return validValues.includes(value) ? value : fallback;
    } catch {
        return fallback;
    }
}

export default {
name: 'AdminDashBoard',
mixins: [backgroundManager, pageActivation],
data() {
    return {
        Number: 0,
        directFileCount: 0, // 当前目录直接子文件数量
        directFolderCount: 0, // 当前目录直接子文件夹数量
        showLogoutButton: false,
        tableData: [],
        tempSearch: '',
        search: '',
        searchKeywords: '', // Keywords only (without tag filters) for backend search
        searchIncludeTags: '', // 包含的标签，逗号分隔
        searchExcludeTags: '', // 排除的标签，逗号分隔
        // 搜索类型：搜索前先选（全部 / 标题 / 标签 / 分类 / 用户 / 其他）
        searchType: 'all',
        // 上传用户筛选（仅管理员，默认全部）
        userFilter: 'all',
        userOptions: [],
        isSearchMode: false,
        searchResultDisplay: getStoredOption('searchResultDisplay', SEARCH_RESULT_DISPLAYS, 'expanded'),
        searchSettingsOpen: false,
        searchIconPressTimer: null,
        searchIconPressStart: null,
        searchIconLongPressed: false,
        currentPage: 1,
        pageSize: 24, // v2.5.0：卡片视图每行 8 个 × 3 行 = 24（与历史记录封面样式对齐）
        selectedFiles: [],
        sortField: getStoredOption('sortField', SORT_FIELDS, 'time'),
        sortOrder: getStoredOption('sortOrder', SORT_ORDERS, 'desc'),
        isUploading: false,
        showdetailDialog: false,
        detailFile: null,
        activeUrlTab: 'originUrl',
        defaultUrlFormat: 'originUrl',
        showUrlDialog: false,
        useCustomUrl: 'false', // 是否启用自定义链接
        customUrlPrefix: '', // 自定义链接前缀
        loading: false, // 加载状态
        currentPath: '', // 当前文件夹路径
        refreshLoading: false,
        // 回收站模式：查看软删除文件，可恢复 / 彻底删除
        trashMode: false,
        trashLoading: false,
        normalTableData: [], // 退出回收站时还原普通文件列表
        showTagDialog: false, // 标签管理对话框
        showBatchTagDialog: false, // 批量标签管理对话框
        currentTagFile: '', // 当前标签管理的文件
        viewMode: 'card', // 视图模式：card 或 list
        showMobileActionModal: false, // 移动端操作模态框
        mobileActionFile: null, // 当前移动端操作的文件
        mobileActionIndex: -1, // 当前移动端操作的文件索引
        mobileActionIsFolder: false, // 是否为文件夹操作
        longPressTimer: null, // 长按计时器
        showMobileDirectoryDrawer: false, // 移动端目录抽屉
        jumpPage: '', // 跳转页码输入
        // 筛选相关状态（数组形式支持多选）
        filters: {
            accessStatus: [], // 访问状态: 'normal'(正常), 'blocked'(已屏蔽)
            listType: [],     // 黑白名单: 'White', 'Block', 'None'
            label: [],         // 审查结果: 'normal', 'teen', 'adult'
            fileType: [],      // 文件类型: 'image', 'video', 'audio', 'other'
            channel: [],       // 渠道类型: 后端 CHANNEL_LABEL（COS/MinIO/R2/S3/EasyImages/Lsky/WebDAV/Immich/External）
            channelName: [],   // 渠道名称: 动态获取
            backup: []         // 备份状态: 'backedup' | 'unbackedup'
            ,redirect: []      // 重定向: 'yes'（已设置） | 'no'（未设置）
            ,tags: []          // 标签有无: 'has'（含标签） | 'none'（未含标签）
            ,tagNames: []      // 标签筛选弹窗选中的标签名
            ,tagMode: 'or'     // 标签筛选模式: 'or'（任一） | 'and'（全部）
        },
        channelNameOptions: [], // 动态从文件列表中提取
        // 标签筛选弹窗
        showTagFilterDialog: false,
        allTags: [], // [{ name, count }]
        tagFilterLoading: false,
        tagDraft: [], // 弹窗内待应用的标签（点确定才生效）
        tagModeDraft: 'or',
        // 移动文件对话框相关状态
        showMoveDialog: false, // 移动文件对话框
        moveTargetPath: '/', // 移动目标路径
        moveFileKey: '', // 当前移动的文件key
        moveFileIndex: -1, // 当前移动的文件索引
        isBatchMove: false, // 是否为批量移动
        pageSwipeStartX: null,
        pageSwipeStartY: null,
        pageSwipeStartTime: 0
    }
},
components: {
    AdminHeader,
    TagManagementDialog,
    BatchTagDialog,
    SkeletonLoader,
    FileCard,
    FolderCard,
    FileListItem,
    FileDetailDialog,
    BatchActionBar,
    MobileActionSheet,
    MobileDirectoryDrawer,
    DashboardCheckbox,
    FilterDropdown,
    MoveFileDialog,
    LanguageSwitcher
},
setup() {
    const cardContainerRef = ref(null);
    const listContainerRef = ref(null);
    const viewModeRef = ref('card');
    const itemsRef = ref([]);

    const { isDragging, selectionRect } = useDragSelect({
        modes: {
            card: { containerRef: cardContainerRef, itemSelector: '.file-card, .folder-card' },
            list: { containerRef: listContainerRef, itemSelector: '.list-item' },
        },
        viewMode: viewModeRef,
        items: itemsRef,
    });

    return {
        cardContainerRef,
        listContainerRef,
        viewModeRef,
        itemsRef,
        isDragging,
        selectionRect,
    };
},
computed: {
    tagFileMetadata() { return this.tableData.find(file => file.name === this.currentTagFile)?.metadata || {}; },
    ...mapGetters(['adminUrlSettings', 'userConfig']),
    filteredTableData() {
        return this.tableData;
    },
    totalPages() {
        return Math.ceil(this.filteredTableData.length / this.pageSize) || 1;
    },
    // 展开结果按递归文件总数分页，目录模式按直接子项分页。
    realTotalPages() {
        const total = this.recursiveSearchResults ? this.Number : this.directFolderCount + this.directFileCount;
        return Math.ceil(total / this.pageSize) || 1;
    },
    // 计算当前激活的筛选条件数量（数组形式）
    activeFilterCount() {
        return Object.values(this.filters).reduce((count, arr) => count + (Array.isArray(arr) ? arr.length : 0), 0);
    },
    // 判断是否处于搜索或筛选模式
    hasSearchOrFilter() {
        return this.isSearchMode || this.activeFilterCount > 0;
    },
    /** 是否管理员（普通用户看不到用户筛选等管理项） */
    isAdminRole() {
        return this.$store.getters.isAdminRole === true;
    },
    /** 搜索类型下拉选项 */
    searchTypeOptions() {
        return [
            { value: 'all', label: this.$t('dashboard.searchTypeAll') },
            { value: 'title', label: this.$t('dashboard.searchTypeTitle') },
            { value: 'tag', label: this.$t('dashboard.searchTypeTag') },
            { value: 'category', label: this.$t('dashboard.searchTypeCategory') },
            { value: 'user', label: this.$t('dashboard.searchTypeUser') },
            { value: 'other', label: this.$t('dashboard.searchTypeOther') },
        ];
    },
    recursiveSearchResults() {
        return this.hasSearchOrFilter && this.searchResultDisplay === 'expanded';
    },
    paginatedTableData() {
        const sortedData = this.sortData(this.filteredTableData);
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        let data = sortedData.slice(start, end);
        // 增加previewSrcList属性，用于预览图片
        const fullList = data.filter(file => this.isImage(file)).map(file => this.getFileLink(file.name));
        data.forEach(file => {
            if (this.isImage(file)) {
                // 重新排序，索引大于等于当前索引的元素在前，否则在后
                file.previewSrcList = fullList.slice(fullList.indexOf(this.getFileLink(file.name))).concat(fullList.slice(0, fullList.indexOf(this.getFileLink(file.name))));
            }
        });
        // 增加channelTag属性，用于显示渠道信息（统一走后端下发的简称）
        data.forEach(file => {
            const short = file.metadata?.ChannelShort;
            const channel = file.metadata?.Channel;
            if (short) {
                file.channelTag = short;
            } else if (!channel) {
                file.channelTag = this.$t('dashboard.unknownTag');
            } else if (channel === 'External') {
                file.channelTag = 'DIY';
            } else {
                file.channelTag = channel;
            }
            // 备份渠道角标：有备份才展示
            const backups = file.metadata?.BackupChannels;
            file.backupTags = Array.isArray(backups)
                ? backups.map((b) => (b.label && b.name ? `${b.label} / ${b.name}` : b.name || b.label || '')).filter(Boolean)
                : [];
            file.viewsCount = Number(file.metadata?.Views || 0);
        });
        return data;
    },
    sortLabel() {
        const labelKeys = {
            time: 'dashboard.sortByTime',
            size: 'dashboard.sortBySize',
            rawName: 'dashboard.sortByRawName',
            fileName: 'dashboard.sortByFileName',
            views: 'dashboard.sortByViews',
            uploader: 'dashboard.sortByUploader',
            fileType: 'dashboard.sortByFileType'
        };
        const fieldLabel = this.$t(labelKeys[this.sortField] || labelKeys.time);
        const orderLabel = this.$t(this.sortOrder === 'desc' ? 'dashboard.sortDesc' : 'dashboard.sortAsc');
        return `${fieldLabel} · ${orderLabel}`;
    },
    dialogWidth() {
        return window.innerWidth > 768 ? '50%' : '90%';
    },
    detailDialogWidth() {
        return window.innerWidth > 768 ? '70%' : '90%';
    },
    accessType() {
        if (this.detailFile?.metadata?.ListType === 'White') {
            return this.$t('filter.normal');
        } else if (this.detailFile?.metadata?.ListType === 'Block' || this.detailFile?.metadata?.Label === 'adult') {
            return this.$t('filter.blocked');
        } else {
            return this.$t('filter.normal');
        }
    },
    allUrl() {
        // 统一走 utils/fileDetail —— 与「历史记录」页共用同一套链接拼装逻辑
        return buildFileDetailUrlsUtil(this.detailFile || {});
    },
    tableColumnNum() {
        return window.innerWidth > 768 ? 3 : 1;
    },
    tablePreviewSpan() {
        return window.innerWidth > 768 ? 2 : 1;
    },
    disableTooltip() {
        return window.innerWidth < 768;
    },
    selectPage() {
        // 如果当前页所有文件都被选中，则返回 true，否则返回 false
        return this.paginatedTableData.every(file => file.selected);
    },
    selectedPageFiles() {
        // 如果当前页有文件被选中，则返回 true，否则返回 false
        return this.paginatedTableData.some(file => file.selected);
    },
    /** 本站访问域名（仅用于非文件链接） */
    linkOrigin() {
        return document.location.origin;
    },
    /** 文件外链前缀：全站统一出口（自定义访问域名优先）；启用「自定义链接格式」时用其自定义前缀 */
    rootUrl() {
        if (this.useCustomUrl === 'true') {
            const p = String(this.customUrlPrefix || '');
            return p && !p.endsWith('/') ? `${p}/` : p;
        }
        return getLinkPrefix();
    },
    isSelectAll: {
        get() {
            return this.paginatedTableData.length > 0 && this.paginatedTableData.every(file => file.selected);
        },
        set(val) {
            this.paginatedTableData.forEach(file => file.selected = val);
        }
    },
    isIndeterminate() {
        const selectedCount = this.paginatedTableData.filter(file => file.selected).length;
        return selectedCount > 0 && selectedCount < this.paginatedTableData.length;
    },
    pagerCount() {
        return window.innerWidth < 768 ? 5 : 7;
    }
},
watch: {
    // Sync viewMode data property to the ref used by useDragSelect
    viewMode: {
        handler(newVal) {
            this.viewModeRef = newVal;
        },
        immediate: true
    },
    // Sync paginatedTableData computed property to the ref used by useDragSelect
    paginatedTableData: {
        handler(newVal) {
            this.itemsRef = newVal;
        },
        immediate: true
    },
    tableData: {
        handler(newData) {
            // selectedFiles 增加 newData中新选中，不包含在 selectedFiles 中的文件
            this.selectedFiles = this.selectedFiles.concat(newData.filter(file => file.selected && !this.selectedFiles.includes(file)));
            // selectedFiles 删掉 newData 中已取消选中的文件
            this.selectedFiles = this.selectedFiles.filter(file => file.selected);
            // selectedFiles 删掉 tableData 中已删除的文件
            this.selectedFiles = this.selectedFiles.filter(file => newData.includes(file));
        },
        deep: true
    },
    defaultUrlFormat(newFormat) {
        localStorage.setItem('defaultUrlFormat', newFormat);
    },
    showdetailDialog(newVal) {
        if (newVal) {
            this.activeUrlTab = this.defaultUrlFormat || 'originUrl';
        }
    },
    customUrlPrefix(val) {
        this.$store.commit('setAdminUrlSettings', { key: 'customUrlPrefix', value: val })
    },
    useCustomUrl(val) {
        this.$store.commit('setAdminUrlSettings', { key: 'useCustomUrl', value: val })
    },
    currentPath(val) {
        // 页面切换时，取消选择的内容
        this.tableData.forEach(file => file.selected = false);
    }
},
methods: {
    // 页面重新激活（长时间未操作 / 从浏览器后台切回）时刷新数据，避免白屏或数据过期
    onPageActivate() {
        this.fetchFileList({ preserveSelection: true });
    },
    // 切换视图模式
    setViewMode(mode) {
        if (this.viewMode === mode) {
            return;
        }
        this.viewMode = mode;
        localStorage.setItem('viewMode', this.viewMode);
    },
    // 列表视图全选当前页
    handleSelectAllPage(val) {
        this.paginatedTableData.forEach(file => file.selected = val);
    },
    // 移动端长按开始
    handleTouchStart(item, index) {
        this.longPressTimer = setTimeout(() => {
            this.mobileActionFile = item;
            this.mobileActionIndex = index;
            this.mobileActionIsFolder = false;
            this.showMobileActionModal = true;
        }, 500); // 500ms 长按触发
    },
    // 移动端长按结束/取消
    handleTouchEnd() {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    },
    // 文件夹长按开始
    handleFolderTouchStart(item, index) {
        this.longPressTimer = setTimeout(() => {
            this.mobileActionFile = item;
            this.mobileActionIndex = index;
            this.mobileActionIsFolder = true;
            this.showMobileActionModal = true;
        }, 500);
    },
    // 处理移动端操作
    handleMobileAction(action) {
        const file = this.mobileActionFile;
        const index = this.mobileActionIndex;
        this.showMobileActionModal = false;
        
        if (!file) return;
        
        switch (action) {
            case 'detail':
                this.openDetailDialog(index, file.name);
                break;
            case 'copy':
                this.handleCopy(index, file.name);
                break;
            case 'folderCopy':
                this.handleFolderCopy(file.name);
                break;
            case 'download':
                this.handleDownload(file.name);
                break;
            case 'move':
                this.handleMove(index, file.name);
                break;
            case 'delete':
                this.handleDelete(index, file.name);
                break;
            case 'tag':
                this.handleTagManagement(file.name);
                break;
        }
    },
    // 返回上一级目录
    handleGoBack() {
        const pathParts = this.currentPath.split('/').filter(Boolean);
        if (pathParts.length > 0) {
            pathParts.pop();
            const parentPath = pathParts.join('/');
            this.navigateToFolder(parentPath);
        }
        this.showMobileDirectoryDrawer = false;
    },
    // 获取标签颜色
    getTagColor(index) {
        const colors = [
            'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
            'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
            'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)'
        ];
        return colors[index % colors.length];
    },
    // 视频hover播放控制
    handleVideoHover(event, isEnter) {
        const video = event.target;
        if (isEnter) {
            video.play().catch(() => {});
        } else {
            video.pause();
            video.currentTime = 0;
        }
    },
    // 格式化文件大小
    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '-';
        bytes = Number(bytes);
        if (isNaN(bytes)) return '-';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024;
            i++;
        }
        return bytes.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    },
    handleSearchIconPointerDown(event) {
        this.cancelSearchIconPress();
        this.searchIconLongPressed = false;
        if (!['touch', 'pen'].includes(event.pointerType) || event.isPrimary === false) return;
        this.searchIconPressStart = { x: event.clientX, y: event.clientY };
        this.searchIconPressTimer = setTimeout(() => {
            this.searchIconPressTimer = null;
            this.searchIconLongPressed = true;
            this.$refs.searchSettingsPopup.onOpen(event, 0);
        }, 500);
    },
    handleSearchIconPointerMove(event) {
        const start = this.searchIconPressStart;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
            this.searchIconLongPressed = true;
            this.cancelSearchIconPress();
        }
    },
    cancelSearchIconPress() {
        clearTimeout(this.searchIconPressTimer);
        this.searchIconPressTimer = null;
        this.searchIconPressStart = null;
    },
    handleSearchIconClick(event) {
        if (this.searchIconLongPressed) {
            event.preventDefault();
            return;
        }
        return this.handleSearch();
    },
    selectSearchResultDisplay(mode) {
        this.$refs.searchInput.focus();
        this.$refs.searchSettingsPopup.hide();
        return this.setSearchResultDisplay(mode);
    },
    setSearchResultDisplay(mode) {
        if (!SEARCH_RESULT_DISPLAYS.includes(mode) || mode === this.searchResultDisplay) return;
        this.searchResultDisplay = mode;
        try {
            localStorage.setItem('searchResultDisplay', mode);
        } catch (error) {
            console.warn('Could not save search result display preference:', error);
        }
        if (this.hasSearchOrFilter) {
            this.currentPage = 1;
            return this.refreshFileList();
        }
    },
    /** 一键清空搜索框（按钮仅在搜索框有内容时显示） */
    handleClearSearch() {
        const hadAppliedSearch = Boolean(this.search);
        this.tempSearch = '';
        this.$nextTick(() => this.$refs.searchInput?.focus());
        if (hadAppliedSearch) {
            this.handleSearch();
        }
    },
    /** 跳转到「历史记录」页（新标签打开，不打断当前的文件管理操作） */
    goHistoryPage() {
        const url = this.$router.resolve({ name: 'history' }).href;
        window.open(url, '_blank', 'noopener');
    },
    /** 卡片左下角「打开链接」：新标签打开该文件的外链 */
    handleOpenLink(name) {
        const url = this.getFileLink(name);
        if (url) window.open(url, '_blank', 'noopener');
    },
    /** 搜索类型变化：立即按新类型重新检索 */
    handleSearchTypeChange() {
        this.handleSearch();
    },
    /** 上传用户筛选变化（仅管理员） */
    handleUserFilterChange() {
        this.currentPage = 1;
        this.refreshFileList();
    },
    /** 拉取用户下拉选项（仅管理员） */
    async fetchUserOptions() {
        if (!this.isAdminRole) return;
        try {
            const res = await fetchWithAuth('/api/manage/users/options', { method: 'GET' });
            if (!res.ok) return;
            const list = await res.json();
            this.userOptions = Array.isArray(list) ? list : [];
        } catch {
            this.userOptions = [];
        }
    },
    /** 新建逻辑目录（记录在当前账户下） */
    async handleCreateFolder() {
        let name;
        try {
            const r = await this.$prompt(this.$t('dashboard.newFolderPrompt'), this.$t('dashboard.newFolder'), {
                confirmButtonText: this.$t('common.confirm'),
                cancelButtonText: this.$t('common.cancel'),
                inputPlaceholder: this.$t('dashboard.newFolderPlaceholder'),
                inputValidator: (v) => {
                    const t = String(v || '').trim();
                    if (!t) return this.$t('dashboard.newFolderRequired');
                    if (/[\\/:*?"<>|]/.test(t)) return this.$t('dashboard.newFolderInvalid');
                    return true;
                },
            });
            name = r.value.trim();
        } catch {
            return;
        }
        const path = [this.currentPath, name].filter(Boolean).join('/');
        try {
            // 后端契约为 { dir, name }（dir = 当前所在目录，name = 新目录名）
            const res = await axios.post('/api/manage/folder', { dir: this.currentPath, name, path }, { withCredentials: true });
            if (res.data?.success) {
                this.$message.success(this.$t('common.success'));
                await this.refreshFileList();
            } else {
                this.$message.error(res.data?.message || this.$t('common.failed'));
            }
        } catch (e) {
            this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
        }
    },
    handleSearch() {
        this.search = this.tempSearch;
        this.isSearchMode = this.search.trim() !== '';
        this.currentPage = 1; // 重置到第一页

        // 解析搜索字符串，提取标签和关键字
        // 支持 #tag 表示包含标签，-#tag 表示排除标签
        if (this.search && this.search.trim()) {
            const includeTags = [];
            const excludeTags = [];
            
            // 匹配 -#tag 和 #tag
            let searchText = this.search;
            
            // 先匹配排除标签 -#tag
            const excludeTagRegex = /-#([\w\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\.\+\-]+)/g;
            searchText = searchText.replace(excludeTagRegex, (match, tag) => {
                excludeTags.push(tag.toLowerCase());
                return ' ';
            });
            
            // 再匹配包含标签 #tag
            const includeTagRegex = /#([\w\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\.\+\-]+)/g;
            searchText = searchText.replace(includeTagRegex, (match, tag) => {
                includeTags.push(tag.toLowerCase());
                return ' ';
            });
            
            // 清理剩余的关键字（去除多余空格）
            this.searchKeywords = searchText.replace(/\s+/g, ' ').trim();
            
            // 构建标签查询字符串
            this.searchIncludeTags = includeTags.join(',');
            this.searchExcludeTags = excludeTags.join(',');
            
            console.log('Search keywords:', this.searchKeywords);
            console.log('Include tags:', this.searchIncludeTags);
            console.log('Exclude tags:', this.searchExcludeTags);
        } else {
            this.searchKeywords = '';
            this.searchIncludeTags = '';
            this.searchExcludeTags = '';
        }

        this.refreshFileList();
    },
    // 处理筛选变化（来自 FilterDropdown 组件）
    handleFilterChange({ type, filters }) {
        this.filters = filters;
        this.currentPage = 1; // 重置到第一页
        this.refreshFileList();
    },
    // 清除所有筛选条件
    clearFilters() {
        this.filters = {
            accessStatus: [],
            listType: [],
            label: [],
            fileType: [],
            channel: [],
            channelName: [],
            backup: [],
            redirect: [],
            tags: [],
            tagNames: [],
            tagMode: 'or'
        };
        this.currentPage = 1;
        this.refreshFileList();
    },
    /* ---------------- 标签筛选弹窗 ---------------- */
    openTagFilterDialog() {
        this.tagDraft = [...(this.filters.tagNames || [])];
        this.tagModeDraft = this.filters.tagMode === 'and' ? 'and' : 'or';
        this.showTagFilterDialog = true;
        this.loadAllTags();
    },
    async loadAllTags() {
        this.tagFilterLoading = true;
        try {
            const res = await fetchWithAuth('/api/manage/tags/all');
            const json = await res.json().catch(() => ({}));
            const list = Array.isArray(json?.tags) ? json.tags : [];
            // 只保留至少被 1 个文件使用的标签，按使用次数降序
            this.allTags = list
                .filter((t) => Number(t.count) > 0)
                .sort((a, b) => Number(b.count) - Number(a.count) || String(a.name).localeCompare(String(b.name)));
        } catch (e) {
            this.allTags = [];
        } finally {
            this.tagFilterLoading = false;
        }
    },
    toggleTagDraft(name) {
        const i = this.tagDraft.indexOf(name);
        if (i === -1) this.tagDraft.push(name);
        else this.tagDraft.splice(i, 1);
    },
    clearTagFilter() {
        this.tagDraft = [];
    },
    applyTagFilter() {
        this.filters = {
            ...this.filters,
            tagNames: [...this.tagDraft],
            tagMode: this.tagModeDraft
        };
        this.showTagFilterDialog = false;
        this.currentPage = 1;
        this.refreshFileList();
    },
    // 从 API 获取所有渠道名称
    async extractChannelNames() {        try {
            const response = await fetchWithAuth('/api/channels?includeDisabled=true', {
                method: 'GET'
            });

            if (response.ok) {
                const channels = await response.json();
                const channelOptions = [];

                // 类型映射（显示名称）—— 与 channel-schema 的 CHANNEL_TYPES 保持一致
                const typeLabels = {};
                for (const t of CHANNEL_TYPES) typeLabels[t.value] = t.label;

                // 按类型提取渠道名称，channel.type是类型内部存储名称，value 为类型标识
                Object.entries(channels).forEach(([type, channelList]) => {
                    if (Array.isArray(channelList) && channelList.length > 0) {
                        channelList.forEach(channel => {
                            if (channel.name) {
                                channelOptions.push({
                                    name: channel.name,
                                    type: channel.type,
                                    // 排序依据：渠道类型编号 + 渠道 ID（与后端 / 其他下拉完全一致）
                                    typeCode: Number(channel.typeCode) || channelTypeCode(channel.type),
                                    code: channel.code || '',
                                    typeLabel: typeLabels[type] || type,
                                    // 使用 channel.type:channel.name 作为唯一标识
                                    value: `${channel.type}:${channel.name}`,
                                });
                            }
                        });
                    }
                });

                // 统一排序：类型编号升序 → name a→z
                channelOptions.sort((a, b) => {
                    if (a.typeCode !== b.typeCode) return a.typeCode - b.typeCode;
                    return String(a.name).localeCompare(String(b.name));
                });

                this.channelNameOptions = channelOptions;
            }
        } catch (error) {
            console.error('Failed to fetch channel names:', error);
        }
    },
    handleDownload(key, metadata) {
        const meta = metadata || this.tableData.find(file => file.name === key)?.metadata;
        const link = document.createElement('a');
        link.href = this.getFileLink(key, meta);
        link.download = key;
        link.click();
    },
    /** 取文件扩展名（优先 metadata.FileExt，其次从显示文件名推断）—— 统一走 utils/fileDetail */
    fileExt(fileOrMetadata) {
        return fileExtOfUtil(fileOrMetadata);
    },
    /**
     * 在链接末尾补上扩展名 —— 仅用于直观展示文件类型（已有扩展名则原样返回）。
     * 统一走 utils/fileDetail。
     */
    withExt(url, ext) {
        return withExtUtil(url, ext);
    },
    openDetailDialog(index, key) {
        this.detailFile = this.paginatedTableData[index];
        this.showdetailDialog = true;
    },
    handleTabClick(tab) {
        this.activeUrlTab = tab.props.name;
    },
    async handleUrlClick(event) {
        // 复制到剪贴板（兼容 http / 老旧浏览器）
        const ok = await copyText(event.target.value);
        this.$message({
            type: ok ? 'success' : 'error',
            message: this.$t(ok ? 'dashboard.copySuccess' : 'dashboard.copyFailed')
        });
    },
    handleDetailDelete(key) {
        // 回收站模式：详情页「删除」按钮已切换为「恢复」，这里兜底走恢复
        if (this.trashMode) {
            const item = this.tableData.find(file => file.name === key);
            if (item) this.trashRestoreItems([item]);
            return;
        }
        this.confirmDeleteByWord('dashboard.deleteConfirm').then(() => {
        fetchWithAuth(`/api/manage/delete/${key}`, { method: 'GET' })
            .then(response => {
            if (response.ok) {
                const fileIndex = this.tableData.findIndex(file => file.name === key);
                if (fileIndex !== -1) {
                this.tableData.splice(fileIndex, 1);
                }
            } else {
                return Promise.reject('Request failed');
            }
            })
            .then(() => {
            this.updateStats(-1, false);
            this.$message.success(this.$t('dashboard.deleteSuccess'));
            this.showdetailDialog = false;
            })
            .catch(() => this.$message.error(this.$t('dashboard.deleteFailed')));
        }).catch(() => console.log('Delete cancelled'));
    },
    /** 详情弹窗里的回收站操作（恢复 / 彻底删除） */
    handleDetailTrash(action, file) {
        if (!file) return;
        if (action === 'restore') {
            this.trashRestoreItems([file]);
        } else {
            this.trashPurgeItems([file]);
        }
    },
    handleBlock(key) {
        this.$confirm(this.$t('dashboard.blockConfirm'), this.$t('dashboard.deleteConfirmTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            type: 'warning'
        }).then(() => {
        fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ListType: 'Block' })
        })
            .then(response => {
                if (response.ok) {
                    const fileIndex = this.tableData.findIndex(file => file.name === key);
                    if (fileIndex !== -1) {
                        this.tableData[fileIndex].metadata.ListType = 'Block';
                    }
                } else {
                    return Promise.reject('Request failed');
                }
            })
            .then(() => {
                this.$message.success(this.$t('dashboard.blockSuccess'));
            })
            .catch(() => this.$message.error(this.$t('dashboard.blockFailed')));
        }).catch(
            () => console.log('Block cancelled')
        );
    },
    handleWhite(key) {
        this.$confirm(this.$t('dashboard.whiteConfirm'), this.$t('dashboard.deleteConfirmTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            type: 'warning'
        }).then(() => {
        fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ListType: 'White' })
        })
            .then(response => {
                if (response.ok) {
                    const fileIndex = this.tableData.findIndex(file => file.name === key);
                    if (fileIndex !== -1) {
                        this.tableData[fileIndex].metadata.ListType = 'White';
                    }
                } else {
                    return Promise.reject('Request failed');
                }
            })
            .then(() => {
                this.$message.success(this.$t('dashboard.whiteSuccess'));
            })
            .catch(() => this.$message.error(this.$t('dashboard.whiteFailed')));
        }).catch(
            () => console.log('White cancelled')
        );
    },
    // ==================== 回收站 ====================
    /** 进入 / 退出回收站模式 */
    async toggleTrashMode() {
        if (this.trashLoading) return;
        if (this.trashMode) {
            // 退出：还原普通文件列表
            this.clearSelection();
            this.tableData = this.normalTableData;
            this.showdetailDialog = false;
            this.trashMode = false;
            return;
        }
        await this.enterTrashMode();
    },
    async enterTrashMode() {
        this.trashLoading = true;
        try {
            const resp = await fetchWithAuth('/api/manage/trash');
            if (!resp.ok) throw new Error('Request failed');
            const data = await resp.json();
            // 备份普通列表，切换渲染数据
            this.normalTableData = this.tableData;
            this.clearSelection();
            const items = Array.isArray(data.items) ? data.items : [];
            this.tableData = items.map(it => this.convertTrashItem(it));
            this.updateStats(items.length, true);
            this.currentPage = 1;
            this.trashMode = true;
            if (items.length === 0) {
                this.$message.info(this.$t('dashboard.trashEmpty'));
            }
        } catch (e) {
            this.$message.error(this.$t('dashboard.trashLoadFailed'));
        } finally {
            this.trashLoading = false;
        }
    },
    /** 把回收站接口的条目转成卡片/列表渲染需要的结构 */
    convertTrashItem(it) {
        const primary = (it.channels || []).find(c => c.isPrimary) || (it.channels || [])[0] || {};
        const deletedAtText = it.deletedAt ? new Date(it.deletedAt).toLocaleString() : '';
        return {
            name: it.name,
            isFolder: false,
            selected: false,
            trashId: it.id,
            // 详情页「文件状态」据此显示「已删除」
            status: it.status || 'deleted',
            metadata: {
                FileName: it.originalName || it.name,
                RawName: it.name,
                // 卡片/列表视图判断视频/图片靠 FileType（回收站条目没有扩展名后缀）
                FileType: it.mime || '',
                FileExt: (String(it.originalName || '').split('.').pop() || '').toLowerCase(),
                FileSizeBytes: Number(it.size) || 0,
                TimeStamp: it.deletedAt || '',
                UploadUser: it.uploader || '',
                UploadSource: it.uploadSource || 'Default',
                Channel: primary.name || '',
                ChannelShort: primary.name || '',
                MimeType: it.mime || '',
                Status: it.status || 'deleted',
                Tags: [],
                TrashDeletedAt: deletedAtText,
                TrashChannels: (it.channels || []).map(c => c.name).filter(Boolean)
            }
        };
    },
    /** 批量恢复 / 批量彻底删除（回收站模式） */
    async trashBatchRequest(items, action) {
        const ids = items.map(it => it.trashId).filter(Boolean);
        if (ids.length === 0) return [];
        const resp = await fetchWithAuth('/api/manage/trash/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, action })
        });
        if (!resp.ok) throw new Error('Request failed');
        const data = await resp.json();
        return Array.isArray(data.results) ? data.results : [];
    },
    /** 恢复（撤销软删除标记，文件回到普通列表） */
    trashRestoreItems(items) {
        if (!items.length) return;
        this.$confirm(
            this.$t('dashboard.trashRestoreConfirm', { count: items.length }),
            this.$t('dashboard.trashTitle'),
            { confirmButtonText: this.$t('dashboard.trashRestore'), cancelButtonText: this.$t('dashboard.deleteConfirmCancel'), type: 'info' }
        ).then(async () => {
            try {
                await this.trashBatchRequest(items, 'restore');
                this.removeTrashItems(items);
                this.$message.success(this.$t('dashboard.trashRestoreSuccess'));
            } catch (e) {
                this.$message.error(this.$t('dashboard.trashRestoreFailed'));
            }
        }).catch(() => {});
    },
    /** 彻底删除（连远端副本一起清理，不可恢复；需输入「确认删除」） */
    trashPurgeItems(items) {
        if (!items.length) return;
        this.confirmDeleteByWord('dashboard.trashPurgeConfirm').then(async () => {
            try {
                await this.trashBatchRequest(items, 'purge');
                this.removeTrashItems(items);
                this.$message.success(this.$t('dashboard.trashPurgeSuccess'));
            } catch (e) {
                this.$message.error(this.$t('dashboard.trashPurgeFailed'));
            }
        }).catch(() => {});
    },
    /** 从回收站视图移除已处理的条目 */
    removeTrashItems(items) {
        const names = new Set(items.map(it => it.name));
        this.tableData = this.tableData.filter(f => !names.has(f.name));
        this.selectedFiles = [];
        this.updateStats(-items.length, false);
        if (this.detailFile && names.has(this.detailFile.name)) {
            this.showdetailDialog = false;
            this.detailFile = null;
        }
    },
    /**
     * 危险操作确认框：必须手动输入「确认删除」才能继续（防误删）。
     * 返回 Promise，输入匹配时 resolve。
     */
    confirmDeleteByWord(messageKey = 'dashboard.deleteConfirmPrompt') {
        const word = this.$t('dashboard.deleteConfirmWord');
        const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return this.$prompt(this.$t(messageKey), this.$t('dashboard.deleteConfirmTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            inputPattern: new RegExp(`^\\s*${escaped}\\s*$`),
            inputErrorMessage: this.$t('dashboard.deleteConfirmInputError'),
            inputPlaceholder: this.$t('dashboard.deleteConfirmPlaceholder'),
            type: 'warning'
        });
    },
    handleDelete(index, key) {
        // 回收站模式下卡片上的「删除」= 恢复该文件
        if (this.trashMode) {
            const item = this.tableData.find(file => file.name === key);
            if (item) this.trashRestoreItems([item]);
            return;
        }
        // 判断是否为文件夹
        const isFolder = this.tableData.find(file => file.name === key).isFolder;

        this.confirmDeleteByWord(isFolder ? 'dashboard.deleteFolderConfirm' : 'dashboard.deleteFileConfirm').then(() => {
        fetchWithAuth(`/api/manage/delete/${key}?folder=${isFolder}`, { method: 'GET' })
            .then(response => {
                if (response.ok) {
                    const fileIndex = this.tableData.findIndex(file => file.name === key);
                    if (fileIndex !== -1) {
                        this.tableData.splice(fileIndex, 1);
                    }
                } else {
                    return Promise.reject('Request failed');
                }
            })
            .then(() => {
                this.updateStats(-1, false);
                fileManager.removeFile(key);
                this.$message.success(this.$t('dashboard.deleteSuccess'));
            })
            .catch(() => this.$message.error(this.$t('dashboard.deleteFailed')));
        }).catch(() => console.log('Delete cancelled'));
    },
    handleBatchDelete() {
        // 回收站模式：批量操作走「彻底删除」（需输入确认删除）
        if (this.trashMode) {
            this.trashPurgeItems(this.selectedFiles);
            return;
        }
        this.confirmDeleteByWord('dashboard.batchDeleteConfirm').then(() => {
        const promises = this.selectedFiles.map(file => {
            const isFolder = file.isFolder;
            return fetchWithAuth(`/api/manage/delete/${file.name}?folder=${isFolder}`, { method: 'GET' });
        });

        Promise.all(promises)
            .then(results => {
                let successNum = 0;
                results.forEach((response, index) => {
                    if (response.ok) {
                        successNum++;
                        const fileIndex = this.tableData.findIndex(file => file.name === this.selectedFiles[index].name);
                        if (fileIndex !== -1) {
                            this.tableData.splice(fileIndex, 1);
                        }
                        fileManager.removeFile(this.selectedFiles[index].name);
                    }
                });
                this.selectedFiles = [];
                this.updateStats(-successNum, false);
                this.$message.success(this.$t('dashboard.batchDeleteSuccess'));
            })
            .catch(() => this.$message.error(this.$t('dashboard.batchDeleteFailed')));
        }).catch(() => console.log('Batch delete cancelled'));
    },
    async handleBatchCopy() {
        // 分离文件和文件夹
        const files = this.selectedFiles.filter(item => !item.isFolder);
        const folders = this.selectedFiles.filter(item => item.isFolder);
        
        // 如果有文件夹，显示加载状态
        let loading = null;
        if (folders.length > 0) {
            loading = this.$loading({
                lock: true,
                text: this.$t('dashboard.fetchingFileList')
            });
        }
        
        try {
            // 收集所有文件（包括文件夹内的文件）
            let allFiles = [...files];
            
            // 递归获取所有文件夹内的文件
            for (const folder of folders) {
                try {
                    const response = await fetchWithAuth(
                        `/api/manage/list?dir=${encodeURIComponent(folder.name)}&recursive=true&count=-1`,
                        { method: 'GET' }
                    );
                    const data = await response.json();
                    if (data.files && data.files.length > 0) {
                        allFiles = allFiles.concat(data.files);
                    }
                } catch (error) {
                    console.error(`获取文件夹 ${folder.name} 内容失败:`, error);
                }
            }
            
            if (loading) loading.close();
            
            if (allFiles.length === 0) {
                this.$message.warning(this.$t('dashboard.noLinksAvailable'));
                return;
            }
            
            // 生成所有链接
            const links = allFiles.map(file => {
                return this.generateFileLink(file.name, file.metadata);
            }).filter(link => link);
            
            if (links.length === 0) {
                this.$message.warning(this.$t('dashboard.noLinksAvailable'));
                return;
            }
            
            // 复制到剪贴板
            const text = links.join('\n');
            const ok = await copyText(text);
            if (ok) {
                this.$message.success(this.$t('dashboard.batchCopySuccess', { count: links.length }));
            } else {
                this.$message.error(this.$t('dashboard.batchCopyFailed'));
            }
        } catch (error) {
            if (loading) loading.close();
            console.error('Batch copy failed:', error);
            this.$message.error(this.$t('dashboard.batchCopyFailed'));
        }
    },
    async handleCopy(index, key) {
        const item = this.paginatedTableData[index];
        const ext = this.fileExt(item);
        let text = '';
        if (item.metadata?.Channel === 'External') {
            const external = this.withExt(item.metadata?.ExternalLink, ext);
            switch (this.defaultUrlFormat) {
                case 'originUrl':
                    text = external;
                    break;
                case 'mdUrl':
                    text = `![${item.metadata?.FileName || key}](${external})`;
                    break;
                case 'htmlUrl':
                    text = `<img src="${external}" alt="${item.metadata?.FileName || key}">`;
                    break;
                case 'bbUrl':
                    text = `[img]${external}[/img]`;
                    break;
                case 'tgId':
                    text = item.metadata?.TgFileId || 'none';
                    break;
                case 's3Location':
                    text = item.metadata?.S3Location || 'none';
                    break;
            }
        } else {
            const url = this.withExt(`${this.rootUrl}${key}`, ext);
            switch (this.defaultUrlFormat) {
                case 'originUrl':
                    text = url;
                    break;
                case 'mdUrl':
                    text = `![${item.metadata?.FileName || key}](${url})`;
                    break;
                case 'htmlUrl':
                    text = `<img src="${url}" alt="${item.metadata?.FileName || key}">`;
                    break;
                case 'bbUrl':
                    text = `[img]${url}[/img]`;
                    break;
                case 'tgId':
                    text = item.metadata?.TgFileId || 'none';
                    break;
                case 's3Location':
                    text = item.metadata?.S3Location || 'none';
                    break;
            }
        }
        const ok = await copyText(text);
        this.$message({
            type: ok ? 'success' : 'error',
            message: this.$t(ok ? 'dashboard.copyFileLinkSuccess' : 'dashboard.copyFailed')
        });
    },
    async loadMoreData() {
        this.loading = true;

        try {
            // 传递标签参数和筛选参数到后端
            await fileManager.loadMoreFiles(
                this.currentPath, 
                this.searchKeywords,
                this.searchIncludeTags,
                this.searchExcludeTags,
                60,
                this.filters,
                this.recursiveSearchResults,
                this.searchType,
                this.isAdminRole ? this.userFilter : ''
            );
            // 获取新的文件列表后
            await this.fetchFileList({ preserveSelection: true });
        } catch (error) {
            this.$message.error(this.$t('dashboard.loadMoreFailed'));
        } finally {
            this.loading = false;
        }
    },
    updateStats(num, init = false) {
        if (init) {
            this.Number = num;
        } else {
            this.Number += num;
        }
    },
    setSortField(field) {
        if (!SORT_FIELDS.includes(field)) return;
        this.sortField = field;
        this.currentPage = 1;
        localStorage.setItem('sortField', field);
    },
    setSortOrder(order) {
        if (!SORT_ORDERS.includes(order)) return;
        this.sortOrder = order;
        this.currentPage = 1;
        localStorage.setItem('sortOrder', order);
    },
    sortData(data) {
        if (!Array.isArray(data)) return [];

        const folders = data.filter(file => file.isFolder);
        const files = data.filter(file => !file.isFolder);

        const getSizeInBytes = (item) => {
            const parseSize = (value) => {
                if (value === null || value === undefined || value === '') return null;
                const parsedValue = Number(value);
                return Number.isFinite(parsedValue) ? parsedValue : null;
            };
            const sizeInBytes = parseSize(item.metadata?.FileSizeBytes);
            if (sizeInBytes !== null) return sizeInBytes;

            const sizeInMegabytes = parseSize(item.metadata?.FileSize);
            if (sizeInMegabytes !== null) return sizeInMegabytes * 1024 * 1024;

            return parseSize(item.size) ?? 0;
        };

        const getValue = (item) => {
            switch (this.sortField) {
                case 'size':
                    return getSizeInBytes(item);
                case 'rawName':
                    return item.metadata?.RawName || item.name || '';
                case 'fileName':
                    return item.metadata?.FileName || item.name || '';
                case 'views':
                    return Number(item.metadata?.Views || 0);
                // 上传用户：按 UploadUser 排序（未记录时用 uploader 兜底）
                case 'uploader':
                    return item.metadata?.UploadUser || item.uploader || '';
                // 文件类型：按扩展名排序
                case 'fileType': {
                    const n = item.metadata?.FileName || item.name || '';
                    const dot = n.lastIndexOf('.');
                    return dot > -1 ? n.slice(dot + 1).toLowerCase() : '';
                }
                case 'time':
                default:
                    return item.metadata?.TimeStamp ? new Date(item.metadata.TimeStamp).getTime() : 0;
            }
        };

        const compare = (a, b) => {
            const valA = getValue(a);
            const valB = getValue(b);

            let result = 0;
            if (typeof valA === 'string' || typeof valB === 'string') {
                result = String(valA || '').localeCompare(String(valB || ''));
            } else {
                result = valA - valB;
            }

            return this.sortOrder === 'desc' ? -result : result;
        };

        folders.sort(compare);
        files.sort(compare);

        return folders.concat(files);
    },
    handleVideoClick(event) {
        const videoElement = event.target;
        if (videoElement.requestFullscreen) {
            videoElement.requestFullscreen();
        } else if (videoElement.webkitRequestFullscreen) {
            // Safari/Old Chrome
            videoElement.webkitRequestFullscreen();
        } else if (videoElement.mozRequestFullScreen) {
            // Firefox
            videoElement.mozRequestFullScreen();
        } else if (videoElement.msRequestFullscreen) {
            // IE/Edge
            videoElement.msRequestFullscreen();
        }
    },

    handleSelectPage() {
        if (this.selectPage) {
            this.paginatedTableData.forEach(file => file.selected = false);
        } else {
            this.paginatedTableData.forEach(file => file.selected = true);
        }
    },
    clearSelection() {
        this.tableData.forEach(file => file.selected = false);
        this.selectedFiles = [];
    },
    handleBatchAction(command) {
        // 回收站模式：批量工具栏只有「恢复 / 彻底删除」
        if (this.trashMode) {
            if (command === 'restore') {
                this.trashRestoreItems([...this.selectedFiles]);
            } else if (command === 'purge') {
                this.trashPurgeItems([...this.selectedFiles]);
            }
            return;
        }
        if (command === 'copy') {
            this.handleBatchCopy();
        } else if (command === 'delete') {
            this.handleBatchDelete();
        } else if (command === 'download') {
            this.handleBatchDownload();
        } else if (command === 'move') {
            this.handleBatchMove();
        } else if (command === 'tagManagement') {
            this.handleBatchTagManagement();
        } else if (command === 'ban') {
            this.handleBatchBlock();
        } else if (command === 'white') {
            this.handleBatchWhite();
        } else if (command === 'backupSelected') {
            this.handleBatchBackupSelected();
        }
    },
    /**
     * 一键备份所选文件（从「上传设置」迁移过来）：
     * 交由后端检测哪些选中文件还没有备份，仅对未备份的执行备份。
     */
    async handleBatchBackupSelected() {
        const files = this.selectedFiles.filter((f) => !f.isFolder);
        if (files.length === 0) {
            this.$message.warning(this.$t('dashboard.selectFilesFirst'));
            return;
        }
        try {
            await this.$confirm(
                this.$t('dashboard.backupSelectedConfirm', { count: files.length }),
                this.$t('dashboard.backupSelected'),
                {
                    confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
                    cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
                    type: 'warning'
                }
            );
        } catch {
            return;
        }
        const loading = this.$loading({ lock: true, text: this.$t('dashboard.backupSelected') });
        try {
            const resp = await fetchWithAuth('/api/manage/files/batch/backupSelected', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileIds: files.map((f) => f.name) })
            });
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok || body?.success === false) {
                throw new Error(body?.message || `HTTP ${resp.status}`);
            }
            const r = body?.data || body || {};
            const ok = Number(r.ok || 0);
            const fail = Number(r.fail || 0);
            const skipped = Number(r.skipped || 0);
            if (ok === 0 && fail === 0 && skipped > 0) {
                this.$message.info(this.$t('dashboard.backupSelectedNone'));
            } else if (ok === 0 && fail === 0 && skipped === 0) {
                this.$message.warning(this.$t('dashboard.backupSelectedFailed'));
            } else {
                this.$message.success(this.$t('dashboard.backupSelectedSuccess', { ok, fail, skipped }));
            }
        } catch (error) {
            console.error('Batch backup failed:', error);
            this.$message.error(this.$t('dashboard.backupSelectedFailed'));
        } finally {
            loading.close();
        }
    },
    handleMove(index, key) {
        // 打开自定义移动对话框
        this.moveFileKey = key;
        this.moveFileIndex = index;
        this.isBatchMove = false;
        this.moveTargetPath = '/';
        this.showMoveDialog = true;
    },
    handleBatchMove() {
        // 打开自定义移动对话框（批量模式）
        this.isBatchMove = true;
        this.moveTargetPath = '/';
        this.showMoveDialog = true;
    },
    // 确认移动操作
    confirmMove(targetPath) {
        const value = targetPath;
        // 使用共享验证器验证路径
        const validation = validateFolderPath(value);
        if (!validation.valid) {
            this.$message.error(validation.error);
            return;
        }
        // 去掉开头的 /，结尾若没有 /，则加上
        const newPath = value.replace(/^\/+/, '') + (value.endsWith('/') ? '' : value === '' ? '' : '/');
        // 判断目标文件夹是否是当前文件夹
        if (newPath === this.currentPath) {
            this.$message.warning(this.$t('dashboard.moveTargetSameAsCurrent'));
            return;
        }
        
        // 关闭对话框
        this.showMoveDialog = false;
        
        if (this.isBatchMove) {
            // 批量移动
            this.executeBatchMove(newPath);
        } else {
            // 单个文件移动
            this.executeSingleMove(newPath);
        }
    },
    // 执行单个文件移动
    executeSingleMove(newPath) {
        const key = this.moveFileKey;
        const isFolder = this.tableData.find(file => file.name === key)?.isFolder;
        
        fetchWithAuth(`/api/manage/move/${key}?folder=${isFolder}&dist=${encodeURIComponent(newPath)}`, { method: 'GET' })
            .then(response => {
                if (response.ok) {
                    const fileIndex = this.tableData.findIndex(file => file.name === key);
                    if (fileIndex !== -1) {
                        // 更新本地文件管理器
                        const newKey = newPath + key.split('/').pop();
                        fileManager.moveFile(key, newKey, isFolder, this.currentPath);
                        // 移除文件
                        this.tableData.splice(fileIndex, 1);
                        // 强制重新渲染内容
                        this.$nextTick(() => {
                            const tempData = [...this.tableData];
                            this.tableData = [];
                            this.$nextTick(() => {
                                this.tableData = tempData;
                            });
                        });
                    }
                    this.updateStats(-1, false);
                    this.$message.success(this.$t('dashboard.moveSuccess'));
                } else {
                    return Promise.reject('Request failed');
                }
            })
            .then(() => {
                this.refreshLocalFileList();
            })
            .catch(() => this.$message.error(this.$t('dashboard.moveFailed')));
    },
    // 执行批量移动
    executeBatchMove(newPath) {
        const promises = this.selectedFiles.map(file => {
            const isFolder = file.isFolder;
            return fetchWithAuth(`/api/manage/move/${file.name}?folder=${isFolder}&dist=${encodeURIComponent(newPath)}`, { method: 'GET' });
        });

        Promise.all(promises)
            .then(results => {
                let successNum = 0;
                results.forEach((response, index) => {
                    if (response.ok) {
                        successNum++;
                        const file = this.selectedFiles[index];
                        file.selected = false;
                        const fileIndex = this.tableData.findIndex(f => f.name === file.name);
                        if (fileIndex !== -1) {
                            // 更新本地文件管理器
                            const newKey = newPath + file.name.split('/').pop();
                            fileManager.moveFile(file.name, newKey, file.isFolder, this.currentPath);
                            // 移除文件
                            this.tableData.splice(fileIndex, 1);
                        }
                    }
                });
                // 强制重新渲染内容
                this.$nextTick(() => {
                    const tempData = [...this.tableData];
                    this.tableData = [];
                    this.$nextTick(() => {
                        this.tableData = tempData;
                    });
                });
                this.updateStats(-successNum, false);
                this.$message.success(this.$t('dashboard.moveSuccess'));
            })
            .then(() => {
                this.refreshLocalFileList();
            })
            .catch(() => this.$message.error(this.$t('dashboard.moveFailed')));
    },
    handleBatchBlock(){
        this.$confirm(this.$t('dashboard.batchBlockConfirm'), this.$t('dashboard.deleteConfirmTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            type: 'warning'
        }).then(() => {
            // 跳过文件夹
            const promises = this.selectedFiles.map(file => {
                if (file.isFolder) {
                    return Promise.resolve({ ok: false });
                }
                return fetchWithAuth(`/api/manage/block/${file.name}`, { method: 'GET' });
            });

            Promise.all(promises)
                .then(results => {
                    results.forEach((response, index) => {
                        if (response.ok) {
                            const fileIndex = this.tableData.findIndex(file => file.name === this.selectedFiles[index].name);
                            if (fileIndex !== -1) {
                                this.tableData[fileIndex].metadata.ListType = 'Block';
                            }
                        }
                    });
                    this.$message.success(this.$t('dashboard.batchBlockSuccess'));
                })
                .catch(() => this.$message.error(this.$t('dashboard.batchBlockFailed')));
        }).catch(() => console.log('Batch block cancelled'));
    },
    handleBatchWhite(){
        this.$confirm(this.$t('dashboard.batchWhiteConfirm'), this.$t('dashboard.deleteConfirmTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            type: 'warning'
        }).then(() => {
            // 跳过文件夹
            const promises = this.selectedFiles.map(file => {
                if (file.isFolder) {
                    return Promise.resolve({ ok: false });
                }
                return fetchWithAuth(`/api/manage/white/${file.name}`, { method: 'GET' });
            });

            Promise.all(promises)
                .then(results => {
                    results.forEach((response, index) => {
                        if (response.ok) {
                            const fileIndex = this.tableData.findIndex(file => file.name === this.selectedFiles[index].name);
                            if (fileIndex !== -1) {
                                this.tableData[fileIndex].metadata.ListType = 'White';
                            }
                        }
                    });
                    this.$message.success(this.$t('dashboard.batchWhiteSuccess'));
                })
                .catch(() => this.$message.error(this.$t('dashboard.batchWhiteFailed')));
        }).catch(() => console.log('Batch white cancelled'));
    },
    handleBatchDownload() {
        // 将选中文件打包成 zip 文件下载
        const zip = new JSZip();
        const folder = zip.folder('files');
        // 构造Promise数组，等待所有文件下载完成后再打包
        const fileNameCount = {}; // 用于跟踪文件名出现的次数

        const downloadPromises = this.selectedFiles.map(async file => {
            // 跳过文件夹
            if (file.isFolder) {
                return;
            }
            const response = await fetch(this.getFileLink(file.name));
            const blob = await response.blob();
            // 检查文件名是否已经存在
            let fileName = file.metadata?.FileName || file.name;
            if (fileNameCount[fileName]) {
                // 如果已经存在，则在文件名后加上编号
                const extension = fileName.substring(fileName.lastIndexOf('.'));
                const baseName = fileName.substring(0, fileName.lastIndexOf('.'));
                fileName = `${baseName}(${fileNameCount[fileName]})${extension}`;
                fileNameCount[file.name]++;
            } else {
                // 如果不存在，则初始化为1
                fileNameCount[fileName] = 1;
            }
            // 将文件添加到 zip 文件夹中
            folder.file(fileName, blob);
        });

        Promise.all(downloadPromises)
            .then(() => zip.generateAsync({ type: 'blob' }))
            .then(blob => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'files.zip';
                link.click();
            });
    },
    isVideo(file) {
        // 排除音频文件
        if (this.isAudio(file)) return false;
        let flag = file.metadata?.FileType?.includes('video');
        // 用文件名后缀判断是否为视频文件
        if (!flag) {
            const videoExtensions = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'flv', 'wmv', 'mkv', 'rmvb', '3gp', 'mpg', 'mpeg', 'm4v', 'f4v', 'rm', 'asf', 'dat', 'ts', 'vob', 'swf', 'divx', 'xvid', 'm2ts', 'mts', 'm2v', '3g2', '3gp2', '3gpp', '3gpp2', 'mpe', 'm1v', 'mpv', 'mpv2', 'mp2v', 'm2t', 'm2ts', 'm2v', 'm4v'];
            const extension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
            flag = videoExtensions.includes(extension);
        }
        return flag;
    },
    isAudio(file) {
        let flag = file.metadata?.FileType?.includes('audio');
        // 用文件名后缀判断是否为音频文件
        if (!flag) {
            const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'ape', 'aiff', 'alac', 'opus', 'mid', 'midi', 'm4b', 'm4p', 'm4r', 'amr', 'au', 'ra', 'ram'];
            const extension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
            flag = audioExtensions.includes(extension);
        }
        return flag;
    },
    isImage(file) {
        let flag = file.metadata?.FileType?.includes('image');
        // 用文件名后缀判断是否为图片文件
        if (!flag) {
            const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'psd', 'ai', 'eps', 'raw', 'cr2', 'nef', 'orf', 'sr2', 'dng', 'arw', 'rw2', 'raf', 'pef', 'x3f', 'srf', 'erf', 'mrw', 'nrw', 'kdc', 'dcr', 'mef', 'mos', 'crw', 'raf', 'rwl', 'srw', '3fr', 'fff', 'iiq', 'qtk', 'bay', 'k25', 'kdc', 'dcs', 'drf', 'dng', 'erf', 'kdc', 'mdc', 'mef', 'mos', 'mrw', 'nef', 'nrw', 'orf', 'pef', 'ptx', 'pxn', 'r3d', 'raf', 'raw', 'rwl', 'rw2', 'rwz', 'sr2', 'srf', 'x3f'];
            const extension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
            flag = imageExtensions.includes(extension);
        }
        return flag;
    },
    /**
     * 对外可复制的完整外链：含访问域名，**不带** ?from=admin。
     * 用于「文件详情 → 原始链接 / Markdown / HTML / BBCode」以及各类复制入口。
     */
    filePublicUrl(filename, metadata) {
        const meta = metadata || this.tableData.find(file => file.name === filename)?.metadata;
        // 全站统一出口：后台设置了「自定义访问域名」时自动跟随（utils/fileDetail）
        return filePublicUrlUtil(filename, meta || filename);
    },
    /**
     * 后台内部预览 / 取流地址：带 ?from=admin 走管理员会话，不受黑白名单与域名白名单限制。
     * 只用于 <img>/<video> 预览、批量下载 fetch —— 不要拿它当对外链接展示。
     */
    getFileLink(filename, metadata) {
        const meta = metadata || this.tableData.find(file => file.name === filename)?.metadata;
        const path = this.withExt(`/file/${filename}`, this.fileExt(meta || filename));
        return `${path}?from=admin`;
    },
    handlePageChange(page) {
        this.currentPage = page;
        // 到最后一页时，加载更多数据
        if (this.currentPage === Math.ceil(this.tableData.length / this.pageSize)) {
            this.loadMoreData();
        }
    },
    isMobileViewport() {
        return window.innerWidth < 768;
    },
    updateResponsivePageSize() {
        const nextPageSize = this.isMobileViewport() ? 16 : 18;
        if (this.pageSize === nextPageSize) return;
        const firstVisibleIndex = (this.currentPage - 1) * this.pageSize;
        this.pageSize = nextPageSize;
        this.currentPage = Math.min(
            Math.floor(firstVisibleIndex / nextPageSize) + 1,
            this.realTotalPages
        );
    },
    isSwipeIgnoredTarget(target) {
        return Boolean(target?.closest?.('button, a, input, textarea, select, .el-checkbox, .action-btn, .list-action-btn'));
    },
    handlePageSwipeStart(event) {
        if (!this.isMobileViewport() || this.isDragging || this.loading || this.showMobileActionModal || this.showMobileDirectoryDrawer || this.isSwipeIgnoredTarget(event.target)) {
            this.resetPageSwipe();
            return;
        }
        const touch = event.touches?.[0];
        if (!touch) return;
        this.pageSwipeStartX = touch.clientX;
        this.pageSwipeStartY = touch.clientY;
        this.pageSwipeStartTime = Date.now();
    },
    async handlePageSwipeEnd(event) {
        if (this.pageSwipeStartX === null || this.pageSwipeStartY === null) return;
        const touch = event.changedTouches?.[0];
        if (!touch) {
            this.resetPageSwipe();
            return;
        }
        const deltaX = touch.clientX - this.pageSwipeStartX;
        const deltaY = touch.clientY - this.pageSwipeStartY;
        const elapsed = Date.now() - this.pageSwipeStartTime;
        this.resetPageSwipe();

        if (elapsed > 700 || Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) {
            return;
        }

        const targetPage = deltaX < 0 ? this.currentPage + 1 : this.currentPage - 1;
        await this.goToSwipePage(targetPage);
    },
    resetPageSwipe() {
        this.pageSwipeStartX = null;
        this.pageSwipeStartY = null;
        this.pageSwipeStartTime = 0;
    },
    async goToSwipePage(page) {
        if (page < 1 || page > this.realTotalPages || page === this.currentPage) return;
        if (page > this.totalPages) {
            await this.loadMoreDataUntilPage(page);
            return;
        }
        this.handlePageChange(page);
    },
    // 跳转到指定页码
    handleJumpPage() {
        const page = parseInt(this.jumpPage);
        if (isNaN(page) || page < 1) {
            this.$message.warning(this.$t('dashboard.invalidPageNumber'));
            return;
        }
        if (page > this.realTotalPages) {
            this.$message.warning(this.$t('dashboard.pageExceedsMax', { max: this.realTotalPages }));
            return;
        }
        // 如果目标页超过当前已加载的页数，需要先加载更多数据
        if (page > this.totalPages) {
            this.$message.info(this.$t('dashboard.loadingData'));
            this.loadMoreDataUntilPage(page);
        } else {
            this.currentPage = page;
        }
        this.jumpPage = '';
    },
    // 加载数据直到指定页
    async loadMoreDataUntilPage(targetPage) {
        this.loading = true;
        try {
            // 计算目标页需要的文件数量（不包含文件夹）
            // 目标页最后一个项目的索引 = targetPage * pageSize
            // 需要的文件数 = 目标索引 - 已有文件夹数量
            const targetIndex = targetPage * this.pageSize;
            const currentFolderCount = this.filteredTableData.filter(item => item.isFolder).length;
            const currentFileCount = this.filteredTableData.filter(item => !item.isFolder).length;
            
            // 需要加载的文件数量 = 目标位置需要的文件数 - 当前已加载的文件数
            const neededFileCount = Math.max(0, targetIndex - currentFolderCount - currentFileCount);
            
            if (neededFileCount > 0) {
                await fileManager.loadMoreFiles(
                    this.currentPath,
                    this.searchKeywords,
                    this.searchIncludeTags,
                    this.searchExcludeTags,
                    neededFileCount,
                    this.filters,
                    this.recursiveSearchResults,
                    this.searchType,
                    this.isAdminRole ? this.userFilter : ''
                );
                await this.fetchFileList({ preserveSelection: true });
            }

            this.currentPage = Math.min(targetPage, this.totalPages);
        } catch (error) {
            this.$message.error(this.$t('dashboard.loadDataFailed'));
        } finally {
            this.loading = false;
        }
    },
    // 判断是否为文件夹
    isFolder(item) {
        // 尊重文件列表的类型，避免把递归结果中的文件误判为文件夹。
        if (typeof item.isFolder === 'boolean') {
            return item.isFolder;
        }
        
        // 获取真实的文件路径（去除URL前缀）
        let path = item.name;
        if (path.startsWith('http')) {
            path = path.split('/file/')[1];
        }
        
        // 如果文件名包含'/'，需要判断是否是当前路径下的文件
        if (path && path.includes('/')) {
            // 获取相对于当前路径的部分
            const relativePath = this.currentPath ? 
                path.substring(this.currentPath.length) : 
                path;
            
            // 如果在根目录，第一个斜杠前的部分就是文件夹
            if (this.currentPath === '') {
                return !path.split('/')[0].includes('.');
            }
            
            // 如果在子文件夹中，检查相对路径是否还包含其他文件夹
            return relativePath.includes('/');
        }
        
        return false;
    },
    
    // 获取文件夹名称
    getFolderName(path) {
        let folderName = '';
        // 如果是文件夹路径，只返回最后一级文件夹名
        if (path && path.includes('/')) {
            const parts = path.split('/');
            // 如果是根目录下的文件夹
            if (this.currentPath === '') {
                folderName = parts[0];
            } else {
                // 如果是子文件夹
                const relativePath = path.substring(this.currentPath.length);
                folderName = relativePath.split('/')[0];
            }
        } else {
            folderName = path;
        }

        const maxLength = 20; // Adjust max length as needed
        if (folderName.length > maxLength) {
            const startLength = Math.floor((maxLength - 3) / 2);
            const endLength = Math.ceil((maxLength - 3) / 2);
            return `${folderName.substring(0, startLength)}...${folderName.substring(folderName.length - endLength)}`;
        }
        return folderName;
    },
    
    // 获取文件名称（去除路径和URL前缀）
    getFileName(path) {
        let fileName = path.split('/').pop();
        const maxLength = 20; // Adjust max length as needed, ensure it fits in one line
        if (fileName.length > maxLength) {
            const startLength = Math.floor((maxLength - 3) / 2);
            const endLength = Math.ceil((maxLength - 3) / 2);
            return `${fileName.substring(0, startLength)}...${fileName.substring(fileName.length - endLength)}`;
        }
        return fileName;
    },
    
    // 获取文件名前半部分（用于中间省略效果）
    getFileNameStart(name) {
        if (!name) return '';
        // 如果文件名较短，返回全部
        if (name.length <= 30) return name;
        // 保留开头部分（约60%的长度用于显示前半部分）
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0) {
            // 有扩展名的情况：返回文件名主体部分
            const baseName = name.substring(0, dotIndex);
            const keepLength = Math.min(baseName.length, Math.floor(name.length * 0.6));
            return baseName.substring(0, keepLength);
        }
        // 无扩展名的情况
        return name.substring(0, Math.floor(name.length * 0.6));
    },
    
    // 获取文件名后半部分（用于中间省略效果）
    getFileNameEnd(name) {
        if (!name) return '';
        // 如果文件名较短，返回空
        if (name.length <= 30) return '';
        // 保留末尾部分（包含扩展名）
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0) {
            // 有扩展名的情况：返回最后几个字符 + 扩展名
            const ext = name.substring(dotIndex);
            const baseName = name.substring(0, dotIndex);
            const keepLength = Math.min(8, Math.floor(baseName.length * 0.2));
            return '…' + baseName.substring(baseName.length - keepLength) + ext;
        }
        // 无扩展名的情况
        const keepLength = Math.min(10, Math.floor(name.length * 0.3));
        return '…' + name.substring(name.length - keepLength);
    },
    
    // 进入文件夹
    enterFolder(folderPath) {
        this.currentPage = 1;
        // 确保路径末尾有 '/'
        this.currentPath = folderPath + (folderPath.endsWith('/') ? '' : '/');
        // 刷新文件列表，到指定currentPath下
        this.refreshFileList();
    },
    
    // 导航到指定文件夹
    navigateToFolder(path) {
        this.currentPage = 1;
        // 确保空路径时不添加 '/'
        this.currentPath = path ? (path + (path.endsWith('/') ? '' : '/')) : '';
        // 刷新文件列表，到指定currentPath下
        this.refreshFileList();
    },

    // 顶部工具栏「刷新」：不刷新页面，重新加载当前分类下的文件
    async handleRefreshFiles() {
        if (this.refreshLoading) return;
        try {
            await this.refreshFileList();
            this.$message.success(this.$t('dashboard.refreshed'));
        } catch (e) {
            if (e && e.message !== 'Unauthorized') {
                this.$message.error(this.$t('dashboard.syncDataError'));
            }
        }
    },

    // 获取文件列表
    async fetchFileList({ preserveSelection = false } = {}) {
        this.loading = true;
        try {
            // 从本地存储获取数据
            const data = fileManager.getLocalFileList();

            // 追加分页数据时保留当前选择，用类型和路径区分文件与文件夹。
            const selectedKeys = new Set(preserveSelection
                ? this.tableData.filter(item => item.selected)
                    .map(item => `${item.isFolder ? 'folder' : 'file'}:${item.name}`)
                : []);
            
            // 解析返回的数据
            const folders = new Set(this.recursiveSearchResults ? [] : data.directories || []);
            const files = data.files || [];

            // 处理文件夹数据（v2.5.0：附带后端 directoryStats 的子文件夹/文件数量统计）
            const folderStatsMap = data.directoryStats || {};
            const folderItems = Array.from(folders).map(folder => ({
                name: folder,
                isFolder: true,
                selected: selectedKeys.has(`folder:${folder}`),
                metadata: { FileName: folder.split('/').pop(), folderStats: folderStatsMap[folder] || null }
            }));

            // 处理文件数据
            const fileItems = files.map(file => ({
                name: file.name,
                isFolder: false,
                selected: selectedKeys.has(`file:${file.name}`),
                metadata: file.metadata
            }));

            // 更新表格数据
            this.tableData = [...folderItems, ...fileItems];

            // 更新统计信息
            this.updateStats(data.totalCount, true);
            
            // 更新直接文件和文件夹数量
            this.directFileCount = data.directFileCount || 0;
            this.directFolderCount = data.directFolderCount || 0;

        } catch (error) {
            console.error('Error fetching file list:', error);
            this.$message.error(this.$t('dashboard.fetchFileListFailed'));
        } finally {
            this.loading = false;
        }
    },
    // 刷新文件列表
    async refreshFileList() {
        this.refreshLoading = true;
        this.loading = true;
        try {
            // 传递标签参数和筛选参数到后端
            const success = await fileManager.refreshFileList(
                this.currentPath, 
                this.searchKeywords,
                this.searchIncludeTags,
                this.searchExcludeTags,
                this.filters,
                this.recursiveSearchResults,
                this.searchType,
                this.isAdminRole ? this.userFilter : ''
            );
            if (success) {
                await this.fetchFileList();
            } else {
                throw new Error('Refresh failed');
            }
        } catch (error) {
            // 认证失败由 fetchWithAuth 统一处理跳转，不重复提示
            if (!error.message?.includes('Unauthorized') && this.$store.state.adminLoggedIn) {
                console.error('Error refreshing file list:', error);
                this.$message.error(this.$t('dashboard.refreshFailed'));
            }
        } finally {
            this.refreshLoading = false;
            this.loading = false;
        }
    },
    // 刷新本地文件列表
    async refreshLocalFileList() {
        this.refreshLoading = true;
        this.loading = true;
        try {
            await this.fetchFileList();
        } catch (error) {
            console.error('Error refreshing local file list:', error);
            this.$message.error(this.$t('dashboard.refreshFailed'));
        } finally {
            this.refreshLoading = false;
            this.loading = false;
        }
    },
    // Tag management methods
    handleTagManagement(fileId) {
        this.currentTagFile = fileId;
        this.showTagDialog = true;
    },
    handleBatchTagManagement() {
        if (this.selectedFiles.length === 0) {
            this.$message.warning(this.$t('dashboard.selectFilesFirst'));
            return;
        }
        this.showBatchTagDialog = true;
    },
    handleTagsUpdated(tags) {
        this.handleBatchTagsUpdated([{ fileId: this.currentTagFile, tags, saved: true }]);
    },
    handleBatchTagsUpdated(results) {
        const updates = new Map(results.filter(result => result.saved).map(result => [result.fileId, result.tags]));
        for (const file of this.tableData) {
            if (updates.has(file.name)) file.metadata = { ...file.metadata, Tags: updates.get(file.name) };
        }
        if (this.detailFile && updates.has(this.detailFile.name)) {
            this.detailFile.metadata = { ...this.detailFile.metadata, Tags: updates.get(this.detailFile.name) };
        }
        const cached = fileManager.getLocalFileList();
        for (const file of cached.files || []) {
            if (updates.has(file.name)) file.metadata = { ...file.metadata, Tags: updates.get(file.name) };
        }
        fileManager.updateFileListCache(cached);
    },
    handleMetadataUpdated(fileId, updatedMetadata) {
        // 更新 tableData 中对应文件的 metadata
        const fileIndex = this.tableData.findIndex(f => f.name === fileId);
        if (fileIndex !== -1) {
            this.tableData[fileIndex].metadata = { ...this.tableData[fileIndex].metadata, ...updatedMetadata };
        }
        // 如果 detailFile 正在显示该文件，同步更新 detailFile
        if (this.detailFile && this.detailFile.name === fileId) {
            this.detailFile.metadata = { ...this.detailFile.metadata, ...updatedMetadata };
        }
    },
    handleFileRenamed(oldFileId, newFileId, updatedMetadata) {
        // 更新 tableData 中对应文件的 name（File_ID）和 metadata
        const fileIndex = this.tableData.findIndex(f => f.name === oldFileId);
        if (fileIndex !== -1) {
            this.tableData[fileIndex].name = newFileId;
            this.tableData[fileIndex].metadata = { ...this.tableData[fileIndex].metadata, ...updatedMetadata };
        }
        // 更新 detailFile 引用并关闭/重新打开详情弹窗以刷新链接
        if (this.detailFile && this.detailFile.name === oldFileId) {
            this.detailFile.name = newFileId;
            this.detailFile.metadata = { ...this.detailFile.metadata, ...updatedMetadata };
            // 关闭详情弹窗，然后在下一个 tick 重新打开以刷新所有链接
            this.showdetailDialog = false;
            this.$nextTick(() => {
                this.showdetailDialog = true;
            });
        }
    },
    // 生成单个文件链接
    generateFileLink(key, metadata) {
        const isExternal = metadata?.Channel === 'External';
        const ext = this.fileExt(metadata || key);
        const baseUrl = this.withExt(isExternal ? metadata?.ExternalLink : `${this.rootUrl}${key}`, ext);
        const fileName = metadata?.FileName || key;
        
        switch (this.defaultUrlFormat) {
            case 'originUrl':
                return baseUrl;
            case 'mdUrl':
                return `![${fileName}](${baseUrl})`;
            case 'htmlUrl':
                return `<img src="${baseUrl}" alt="${fileName}">`;
            case 'bbUrl':
                return `[img]${baseUrl}[/img]`;
            default:
                return baseUrl;
        }
    },
    // 复制文件夹中所有文件的链接
    async handleFolderCopy(folderName) {
        // 显示加载状态
        const loading = this.$loading({
            lock: true,
            text: this.$t('dashboard.fetchingFileList')
        });
        
        try {
            // 调用 list API 递归获取文件夹内所有文件
            const response = await fetchWithAuth(
                `/api/manage/list?dir=${encodeURIComponent(folderName)}&recursive=true&count=-1`,
                { method: 'GET' }
            );
            
            const data = await response.json();
            loading.close();
            
            if (!data.files || data.files.length === 0) {
                this.$message.warning(this.$t('dashboard.folderEmptyNoLinks'));
                return;
            }
            
            // 根据当前链接格式生成所有文件链接
            const links = data.files.map(file => {
                return this.generateFileLink(file.name, file.metadata);
            }).filter(link => link);
            
            if (links.length === 0) {
                this.$message.warning(this.$t('dashboard.noLinksAvailable'));
                return;
            }
            
            // 复制到剪贴板
            const text = links.join('\n');
            const ok = await copyText(text);
            if (ok) {
                this.$message.success(this.$t('dashboard.copiedFileLinks', { count: links.length }));
            } else {
                this.$message.error(this.$t('dashboard.copyFolderLinksFailed'));
            }
        } catch (error) {
            loading.close();
            console.error('Copy folder links failed:', error);
            this.$message.error(this.$t('dashboard.copyFolderLinksFailed'));
        }
    },
},
mounted() {
    // 文件列表缓存按账户隔离：切换账户（例如同一浏览器先管理员后普通用户）时
    // 先丢弃上一个账户的缓存，避免刷新瞬间闪现非本人文件。
    fileManager.setCacheOwner(this.$store.getters.sessionUser || '');
    // 初始化背景图
    this.initializeBackground('adminBkImg', '.container', false, true);
    this.updateResponsivePageSize();
    window.addEventListener('resize', this.updateResponsivePageSize);

    /*
     * 其他页面通过 URL query / sessionStorage 指定进入本页时的初始视图：
     *   ?tag=… / dashboardInitialTag    —— 文件详情里的「文件标签」（新标签页打开走 query）
     *   ?folder=… / dashboardInitialFolder —— 系统状态「最近上传」的分类列、文件详情里的「文件分类」
     * 标签优先：带标签进来时回到根目录，避免当前分类里恰好没有该标签的文件导致空列表。
     */
    const queryTag = this.$route?.query?.tag;
    const queryFolder = this.$route?.query?.folder;
    const initialTag = queryTag ? String(queryTag) : sessionStorage.getItem('dashboardInitialTag');
    if (initialTag) {
        if (queryTag) {
            // 用过即清（replace，避免刷新时重复带上 query）
            this.$router.replace({ path: '/dashboard' }).catch(() => {});
        } else {
            sessionStorage.removeItem('dashboardInitialTag');
            sessionStorage.removeItem('dashboardInitialFolder');
        }
        this.currentPath = '';
        this.filters.tagNames = [initialTag];
        this.filters.tagMode = 'or';
        this.tagDraft = [initialTag];
        this.tagModeDraft = 'or';
    } else if (queryFolder !== undefined && queryFolder !== null) {
        // 文件详情「文件分类」新标签页跳转（?folder=…）
        const folder = String(queryFolder);
        if (queryFolder !== '') this.$router.replace({ path: '/dashboard' }).catch(() => {});
        this.currentPath = folder.replace(/\/+$/, '') ? folder.replace(/\/+$/, '') + '/' : '';
    } else {
        const initialFolder = sessionStorage.getItem('dashboardInitialFolder');
        if (initialFolder) {
            sessionStorage.removeItem('dashboardInitialFolder');
            this.currentPath = initialFolder.replace(/\/+$/, '') ? initialFolder.replace(/\/+$/, '') + '/' : '';
        }
    }

    this.loading = true;
    // 路由守卫已通过 /api/auth/sessionCheck 验证认证状态
    this.showLogoutButton = this.$store.state.adminLoggedIn;
    // 首次加载时刷新文件列表
    this.refreshFileList()
        .then(() => {
            // 获取所有渠道名称
            return this.extractChannelNames();
        })
        .catch((err) => {
            if (err.message !== 'Unauthorized') {
                this.$message.error(this.$t('dashboard.syncDataError'));
            }
        })
        .finally(() => {
            this.loading = false;
        });
    
    // 读取自定义链接设置项
    this.customUrlPrefix = this.adminUrlSettings.customUrlPrefix;
    this.useCustomUrl = this.adminUrlSettings.useCustomUrl;

    // 恢复视图模式偏好
    const savedViewMode = localStorage.getItem('viewMode');
    if (savedViewMode === 'card' || savedViewMode === 'list') {
        this.viewMode = savedViewMode;
    }

    // 上传用户筛选下拉（仅管理员）
    this.fetchUserOptions();
},
beforeUnmount() {
    this.cancelSearchIconPress();
    window.removeEventListener('resize', this.updateResponsivePageSize);
}

};
</script>

<style src="@/styles/settings-dialog.css"></style>
<style scoped src="@/styles/admin-common.css"></style>

<style scoped>
.container {
    background: var(--admin-container-bg-color);
    min-height: 100vh;
    font-family: 'Arial', sans-serif;
    color: var(--admin-container-color);
    margin: 0;
    padding: 0;
}

/* 顶部工具栏「刷新」按钮 */
.refresh-files-btn {
    margin-left: 4px;
    padding: 6px 10px;
}
/* 回收站模式提示条 */
.trash-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    padding: 8px 14px;
    border-radius: 10px;
    font-size: 13px;
    color: var(--el-color-danger);
    background: color-mix(in srgb, var(--el-color-danger) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--el-color-danger) 30%, transparent);
}
.trash-banner-icon {
    font-size: 13px;
}
.trash-banner-text {
    line-height: 1.4;
}
.refresh-files-icon {
    font-size: 13px;
}
/* 回收站按钮：激活态高亮（与标签筛选按钮同风格） */
.trash-btn.is-active {
    color: #fff;
    background: var(--el-color-danger);
    border-color: var(--el-color-danger);
}

/* 标签筛选按钮：选中态高亮为蓝色 */
.tag-filter-badge {
    /* 间距交给 .search-area 的 gap，多个 margin 叠起来会显得太散 */
    margin-left: 0;
    flex: 0 0 auto;
}
.tag-filter-btn {
    padding: 6px 10px;
}
.tag-filter-btn.is-active {
    color: #fff;
    background: var(--el-color-primary);
    border-color: var(--el-color-primary);
}
.tag-filter-icon {
    font-size: 13px;
}

/* 标签筛选弹窗 */
.tag-filter-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
}
.tag-filter-hint {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
}
.tag-filter-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    max-height: 46vh;
    overflow-y: auto;
    padding: 4px 2px;
    min-height: 80px;
}
.tag-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--el-border-color);
    /* 圆角按钮（原来是 999px 的胶囊/圆圈，PC 端显得过大） */
    border-radius: 8px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
    transition: all 0.18s ease;
}
/* PC 端点击后不要出现聚焦边框 */
.tag-filter-chip:focus,
.tag-filter-chip:focus-visible {
    outline: none;
    box-shadow: none;
}
.tag-filter-chip:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}
/* 被选中的标签：蓝色背景 */
.tag-filter-chip.is-selected {
    background: var(--el-color-primary);
    border-color: var(--el-color-primary);
    color: #fff;
}
.tag-filter-count {
    font-size: 11px;
    opacity: 0.65;
}
.tag-filter-chip.is-selected .tag-filter-count {
    opacity: 0.9;
}
.tag-filter-empty {
    width: 100%;
    padding: 24px 0;
    text-align: center;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

/* 确保el-container和el-main不裁剪内容 */
:deep(.el-container) {
    overflow: visible;
}

:deep(.el-main) {
    overflow: visible;
}

:deep(.el-dialog) {
    border-radius: 12px;
    background-color: var(--dialog-bg-color);
    box-shadow: var(--dialog-box-shadow);
}

@media (max-width: 768px) {
    .pagination-container :deep(.btn-prev),
    .pagination-container :deep(.btn-next) {
        display: none !important;
    }
}


/* 面包屑容器，包含路径和文件数量 */
.breadcrumb-container {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    padding: 0 10px; /* 与 .content 的 padding 对齐 */
    margin-top: 12px;
    margin-bottom: 4px; /* 与下方内容的间距 */
}

.breadcrumb-view-toggle {
    position: relative;
    height: 32px;
    box-sizing: border-box;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    background: var(--glass-bg);
    box-shadow: none;
    overflow: hidden;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}

.breadcrumb-view-toggle:hover {
    border-color: var(--glass-border-hover);
}

/* 视图切换按钮不出现聚焦边框（outline / focus-ring） */
.breadcrumb-view-toggle:focus,
.breadcrumb-view-toggle:focus-visible,
.breadcrumb-view-toggle:active {
    outline: none;
    outline-offset: 0;
    box-shadow: none;
}
.breadcrumb-view-toggle:focus-visible {
    border-color: var(--glass-border);
}
.breadcrumb-view-toggle:where(:focus, :focus-visible)::after {
    content: none;
}

.breadcrumb-view-toggle::before {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 28px;
    height: 26px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
    transform: translateX(0);
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
}

.breadcrumb-view-toggle.is-list::before {
    transform: translateX(30px);
}

.breadcrumb-view-button {
    position: relative;
    z-index: 1;
    width: 28px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 5px;
    color: var(--el-text-color-secondary);
    background: transparent;
    cursor: pointer;
    transition: color 0.16s ease;
}

.breadcrumb-view-button:hover {
    color: var(--primary-color-accent);
}

.breadcrumb-view-button.is-active {
    color: var(--primary-color-accent);
    background: transparent;
    box-shadow: none;
}

.breadcrumb-view-icon {
    width: 14px;
    height: 14px;
}

.breadcrumb-sort-dropdown {
    flex: 0 0 auto;
}

.breadcrumb-sort-button {
    width: 44px;
    height: 32px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    color: var(--el-text-color-secondary);
    background: var(--glass-bg);
    box-shadow: none;
    cursor: pointer;
    transition: color 0.16s ease, background-color 0.2s ease, border-color 0.2s ease;
}

.breadcrumb-sort-button:hover,
.breadcrumb-sort-button:focus-visible {
    border-color: var(--glass-border-hover);
    color: var(--primary-color-accent);
}

.breadcrumb-sort-button:focus-visible {
    outline: none;
}

.breadcrumb-sort-icon {
    width: 30px;
    height: 18px;
    overflow: visible;
}

.sort-field-glyph,
.sort-order-glyph {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.sort-order-glyph {
    stroke-width: 1.9;
}

@media (max-width: 768px) {
    .breadcrumb-container {
        flex-direction: row;
        align-items: center;
        gap: 8px;
        padding: 0 5px;
        margin-top: 8px;
        margin-bottom: 2px;
    }
    .breadcrumb-view-toggle {
        height: 28px;
        padding: 2px;
        border-radius: 8px;
    }
    .breadcrumb-view-toggle::before {
        width: 24px;
        height: 22px;
        border-radius: 6px;
    }
    .breadcrumb-view-toggle.is-list::before {
        transform: translateX(26px);
    }
    .breadcrumb-view-button {
        width: 24px;
        height: 22px;
        border-radius: 6px;
    }
    .breadcrumb-view-icon {
        width: 12px;
        height: 12px;
    }
    .breadcrumb-sort-button {
        width: 40px;
        height: 28px;
        border-radius: 8px;
    }
    .breadcrumb-sort-icon {
        width: 27px;
        height: 16px;
    }
}

/* 文件数量小徽章 + 历史记录按钮（右侧一组） */
.breadcrumb-right-group {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    flex-shrink: 0;
    min-width: 0;
}

/* Element Plus 默认给相邻 el-button 加 margin-left: 12px，
   会让「新建目录 → 历史记录」的间距（12+8=20）明显大于「用户选择 → 新建目录」（8）。
   组内统一交给 gap 控制，间距处处均匀。 */
.breadcrumb-right-group :deep(.el-button + .el-button),
.breadcrumb-right-group :deep(.el-select + .el-button) {
    margin-left: 0;
}

.breadcrumb-right-group .stats-badge {
    margin-left: 0;
}

.history-btn {
    /* 与左右两侧 size="small" 按钮（24px）等高，避免比旁边按钮高出一截 */
    height: 24px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 12px;
    flex-shrink: 0;
}

.history-btn-icon {
    margin-right: 4px;
    font-size: 11px;
}

@media (max-width: 768px) {
    .history-btn {
        height: 24px;
        font-size: 11px;
        padding: 0 8px;
    }

    .history-btn-text {
        display: none;
    }

    .history-btn-icon {
        margin-right: 0;
    }
}

.stats-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 500;
    color: var(--el-text-color-secondary);
    background: var(--glass-bg);
    padding: 4px 12px;
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    box-shadow: none;
    transition: background-color 0.2s ease, border-color 0.2s ease;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: auto;
}
.stats-badge:hover {
    border-color: var(--glass-border-hover);
}

.stats-badge-icon {
    font-size: 11px;
    opacity: 0.8;
}

@media (max-width: 768px) {
    .stats-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 8px;
    }
    
    .stats-badge-icon {
        font-size: 9px;
    }
}


/* 搜索区域样式（包含搜索框和筛选按钮） */
.search-area {
    min-width: 0;
    display: flex;
    align-items: center;
    /* 工具栏按钮间距：原 8px + 各按钮 margin-left 会叠成 16px，收紧到 6px */
    gap: 6px;
}
@media (max-width: 768px) {
    .search-area {
        width: 100%;
        gap: 6px;
    }
}

/* 搜索卡片样式 */
.search-icon-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-touch-callout: none;
    outline: none;
    visibility: hidden;
    pointer-events: none;
}

.search-icon-trigger:focus-visible {
    outline: 2px solid var(--primary-color-accent);
    outline-offset: 3px;
    border-radius: 3px;
}

.search-card:focus-within .search-icon-trigger,
.search-card.is-settings-open .search-icon-trigger {
    visibility: visible;
    pointer-events: auto;
}

/* 一键清空按钮：仅在搜索框有内容时显示，位于搜索按钮左侧 */
.search-clear-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    margin-right: 2px;
    border: none;
    background: transparent;
    color: var(--el-text-color-placeholder);
    font: inherit;
    cursor: pointer;
    pointer-events: auto;
    outline: none;
    touch-action: manipulation;
    transition: color 0.2s ease;
}

.search-clear-trigger:hover {
    color: var(--el-text-color-regular);
}

.search-clear-trigger:focus-visible {
    outline: 2px solid var(--primary-color-accent);
    outline-offset: 2px;
    border-radius: 3px;
}

.search-clear-icon {
    font-size: 12px;
}

.search-result-menu {
    min-width: 200px;
}

.search-result-option {
    width: 100%;
    font-family: inherit;
    text-align: left;
}

.search-result-settings-title {
    padding: 6px 12px;
    margin-bottom: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
}

.search-result-option-icon {
    width: 16px;
    margin-right: 8px;
    flex-shrink: 0;
}

.search-result-option-check {
    margin-left: auto;
    padding-left: 12px;
    color: var(--primary-color-accent);
}

.search-card {
    display: flex;
    align-items: center;
    min-width: 0;
}
.search-card :deep(.el-input) {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}
.search-card :deep(.el-input__wrapper) {
    min-width: 0;
    padding: 0 14px;
    border-radius: 20px;
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}
/* 搜索范围下拉（已嵌入 el-input 的 #prefix 插槽）：
   - EP 默认给 .el-input__prefix 加了 pointer-events:none，嵌进去的下拉点不动，这里放开；
   - 下拉自身的底色/描边去掉，只留文字与箭头，视觉上与输入框合成一个整体。 */
.search-card :deep(.el-input__prefix),
.search-card :deep(.el-input__prefix-inner) {
    pointer-events: auto;
}
.search-type-select {
    width: 74px;
    flex: 0 0 auto;
    margin-right: 2px;
}
.user-filter-select {
    width: 110px;
    flex: 0 0 auto;
}
.search-type-select :deep(.el-select__wrapper),
.user-filter-select :deep(.el-select__wrapper) {
    min-height: 26px;
    padding: 0 10px;
}
/* 嵌在搜索框内的下拉：透明、无描边，只作为「范围」选择区 */
.search-card :deep(.el-input__prefix .el-select__wrapper) {
    padding: 0 4px 0 0;
    background: transparent;
    box-shadow: none;
    font-size: 14px;
    font-weight: 500;
    color: var(--el-text-color-regular);
}
.search-card :deep(.el-input__prefix .el-select__wrapper.is-hovering),
.search-card :deep(.el-input__prefix .el-select__wrapper.is-focused) {
    background: transparent;
    box-shadow: none;
}
.search-card :deep(.el-input__prefix .el-select__wrapper.is-focused)
    :deep(.el-select__selected-item) {
    color: var(--primary-color-accent);
}
/* 范围与输入内容之间的细分隔线 */
.search-scope-sep {
    display: inline-block;
    width: 1px;
    height: 16px;
    margin-right: 8px;
    background: var(--el-border-color);
    opacity: 0.7;
}
.search-type-select :deep(.el-select__selected-item),
.user-filter-select :deep(.el-select__selected-item) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.search-card :deep(.el-input__inner) {
    width: 240px;
    height: 40px;
    font-size: 1.2em;
    min-width: 0;
    border: none;
    transition: width 0.25s ease;
    background: none;
}

.search-card :deep(.el-input__inner::placeholder) {
    color: var(--el-text-color-placeholder);
    font-style: italic;
    font-weight: 400;
    font-size: 14px;
    opacity: 0.6;
    letter-spacing: 0.5px;
    transition: all 0.3s ease;
}

.search-card :deep(.el-input__inner:focus::placeholder) {
    opacity: 0.4;
    transform: translateX(5px);
}
@media (max-width: 768px) {
    .search-card :deep(.el-input__wrapper) {
        padding: 0 12px;
    }

    .search-card {
        flex: 1;
    }

    .search-card :deep(.el-input__inner) {
        width: 100%;
        height: 32px;
        font-size: 1em;
    }
}
.search-card:focus-within :deep(.el-input__inner),
.search-card.is-settings-open :deep(.el-input__inner) {
    width: 350px;
}
@media (max-width: 768px) {
    .search-card:focus-within :deep(.el-input__inner),
    .search-card.is-settings-open :deep(.el-input__inner) {
        width: 100%;
    }
}
@media (prefers-reduced-motion: reduce) {
    .search-card :deep(.el-input__inner),
    .search-card :deep(.el-input__inner::placeholder) {
        transition: none;
    }
}
.search-icon {
    cursor: pointer;
    color: var(--admin-container-color);
    transition: all 0.3s ease;
    font-size: 1.3em;
    opacity: 0;
    transform: scale(0.8);
    pointer-events: none;
}
.search-card:focus-within .search-icon,
.search-card.is-settings-open .search-icon {
    opacity: 1;
    transform: scale(1);
    pointer-events: auto;
}
.search-icon-trigger:hover .search-icon {
    color: var(--primary-color-accent);
    transform: scale(1.2);
}
.search-card :deep(.el-input__suffix) {
    display: flex;
    align-items: center;
    right: 10px;
}

/* 主容器样式 */
.main-container {
    display: flex;
    flex-direction: column;
    padding: 20px 60px;
    min-height: calc(100vh - 80px);
    transition: padding-bottom 0.24s ease;
}

.main-container.has-batch-toolbar {
    padding-bottom: 72px;
}

@media (max-width: 768px) {
    .main-container {
        margin-top: 0;
        padding: 8px 10px 16px;
    }
    .main-container.has-batch-toolbar {
        padding-bottom: 86px;
    }
}

.content {
    display: grid;
    /* v2.5.0：卡片改为历史记录封面样式 —— 每行 8 个 × 每页 3 行（pageSize=24） */
    grid-template-columns: repeat(8, 1fr);
    grid-template-rows: none;
    gap: 16px;
    padding: 10px;
    padding-bottom: 0px;
    flex-grow: 1;
    min-height: 80vh;
    align-content: start;
}

.content.is-drag-selecting,
.list-view.is-drag-selecting {
    cursor: crosshair;
}

.content.is-drag-selecting :deep(.file-card:hover),
.content.is-drag-selecting :deep(.folder-card:hover),
.content.is-drag-selecting :deep(.img-card:hover) {
    transform: none;
}

.content.is-drag-selecting :deep(.file-card:hover .image-preview),
.content.is-drag-selecting :deep(.img-card:hover .image-preview),
.content.is-drag-selecting :deep(.img-card:hover .video-preview),
.content.is-drag-selecting :deep(.img-card:hover .file-icon),
.content.is-drag-selecting :deep(.img-card:hover .folder-icon-svg) {
    transform: none;
}

.content.is-drag-selecting :deep(.image-preview:hover) {
    opacity: 1;
}

.content.is-drag-selecting :deep(.action-btn:hover) {
    transform: none;
    background: rgba(255, 255, 255, 0.15);
}

.list-view.is-drag-selecting :deep(.list-item:hover) {
    background: transparent;
}

.list-view.is-drag-selecting :deep(.list-action-btn:hover) {
    color: var(--el-text-color-regular);
    background: var(--el-fill-color);
}

.list-view.is-drag-selecting :deep(.list-action-danger:hover) {
    background: var(--el-fill-color);
}

/* 空状态样式 */
.empty-state {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    color: var(--admin-container-color);
    opacity: 0.6;
}

.empty-icon {
    font-size: 64px;
    margin-bottom: 20px;
    color: var(--admin-container-color);
    opacity: 0.3;
}

.empty-text {
    font-size: 18px;
    font-weight: 500;
    margin: 0 0 8px 0;
}

.empty-hint {
    font-size: 14px;
    margin: 0;
    opacity: 0.7;
}

.list-empty {
    padding: 80px 20px;
}

/* 移动端卡片视图 */
@media (max-width: 768px) {
    .content {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-template-rows: none;
        gap: 8px;
        margin-top: 15px;
        padding: 0;
        flex-grow: 0;
        min-height: auto;
        align-content: start;
        align-items: start;
    }
}

/* 平板端卡片视图：按可用宽度递减列数（桌面档 8 列 × 3 行 = 24） */
@media (min-width: 1024px) and (max-width: 1199px) {
    .content {
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 14px;
    }
}

@media (min-width: 769px) and (max-width: 1023px) {
    .content {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
    }
}

/* 平板端页面内边距收敛（桌面档保持 20px 60px 不变） */
@media (min-width: 769px) and (max-width: 1199px) {
    .main-container {
        padding: 16px 24px;
    }
}

/* 列表视图样式 —— v2.5.0：改为「历史记录列表」的圆角卡片行（无外框容器、无表头） */
.list-view {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 15px;
    overflow-x: auto;
    overflow-y: visible;
}

.question-icon {
    margin: 0 3px;
}

.breadcrumb {
    height: 32px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    padding: 0 12px;
    background-color: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    font-size: 0.95em;
    box-shadow: none;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}
.breadcrumb:hover {
    border-color: var(--glass-border-hover);
}

.breadcrumb-home-icon {
    font-size: 14px;
    color: var(--el-text-color-secondary);
    cursor: pointer;
    transition: color 0.2s ease;
}

.breadcrumb-home-icon:hover {
    color: var(--primary-color-accent);
}

:deep(.el-breadcrumb__item) {
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    height: 100%;
    line-height: 32px;
}
:deep(.el-breadcrumb),
:deep(.el-breadcrumb__inner),
:deep(.el-breadcrumb__separator) {
    display: inline-flex;
    align-items: center;
    height: 100%;
    line-height: 32px;
}
:deep(.el-breadcrumb__inner) {
    cursor: pointer;
}
:deep(.el-breadcrumb__inner:hover) {
    color: var(--primary-color-accent);
}

/* 移动端目录触发按钮 */
.mobile-directory-trigger {
    display: none;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: 28px;
    box-sizing: border-box;
    gap: 6px;
    padding: 0 10px;
    background: var(--glass-bg);
    border-radius: 8px;
    border: 1px solid var(--glass-border);
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}
.mobile-directory-trigger:active {
    border-color: var(--glass-border-hover);
}

.breadcrumb-view-toggle,
.breadcrumb,
.stats-badge,
.refresh-btn,
.mobile-directory-trigger {
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}

.mobile-directory-icon {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--primary-color-accent);
}

.mobile-directory-path {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    color: var(--el-text-color-primary);
    max-width: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mobile-directory-arrow {
    flex: 0 0 auto;
    font-size: 8px;
    color: var(--el-text-color-secondary);
}

/* 桌面端显示面包屑，隐藏移动端触发器 */
.desktop-only {
    display: block;
}

@media (max-width: 768px) {
    .mobile-directory-trigger {
        display: flex;
        /* 目录按钮不再撑满整行，把宽度让给右侧的操作按钮 */
        flex: 0 1 auto;
        max-width: 38vw;
    }
    
    .desktop-only {
        display: none !important;
    }
    
    .breadcrumb-container {
        padding: 0;
        margin-left: 0;
        width: 100%;
        box-sizing: border-box;
        /* 一行塞不下时整体换行，避免「全选 / 视图切换 / 排序 / 右侧按钮组」互相挤压溢出 */
        flex-wrap: wrap;
        gap: 8px;
    }

    /* 右侧按钮组：换行后右对齐，各按钮按内容收缩 */
    .breadcrumb-right-group {
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
    }

    /* 「新建目录」在窄屏只留图标，省下横向空间 */
    .new-folder-btn {
        height: 28px;
        min-width: 28px;
        width: 28px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
    }

    .new-folder-text {
        display: none;
    }

    /* 移动端只显示一个「＋」图标（folder-plus 未注册字体图标，此前会显示为空白） */
    .new-folder-icon {
        margin-right: 0;
        font-size: 13px;
    }
}

/* 框选选区矩形覆盖层 */
.drag-select-overlay {
    position: fixed;
    background: rgba(24, 144, 255, 0.1);
    border: 1px solid rgba(24, 144, 255, 0.6);
    pointer-events: none;
    z-index: 9999;
    border-radius: 2px;
}


.sort-dropdown-menu {
    min-width: 205px;
}

.sort-order-wrapper {
    padding: 0 12px;
    text-align: center;
}

.sort-divider {
    margin: 8px 0 !important;
}

.sort-dropdown-menu :deep(.el-dropdown-menu__item) {
    justify-content: space-between;
}

.sort-dropdown-menu :deep(.el-dropdown-menu__item.is-selected) {
    color: var(--primary-color-accent);
}

.sort-field-check {
    width: 12px;
    margin-left: 16px;
}

</style>
