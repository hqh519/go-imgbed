<template>
  <div class="changelog-page">
    <div class="changelog-container">
      <header class="changelog-header">
        <div class="changelog-header-main">
          <h1 class="changelog-title">
            <font-awesome-icon icon="code-branch" />
            <span>{{ zh ? '版本修改日志' : 'Version Changelog' }}</span>
          </h1>
          <p class="changelog-subtitle">
            {{ zh ? '每次功能变更都会递增版本号，并在这里按时间倒序留档。' : 'Every change bumps the version number and is recorded here, newest first.' }}
          </p>
        </div>
        <div class="changelog-header-actions">
          <el-tag type="info" effect="plain" class="current-version">
            {{ zh ? '当前版本' : 'Current' }} v{{ version }}
          </el-tag>
          <el-button size="small" @click="toggleLocale">
            <font-awesome-icon icon="globe" style="margin-right: 6px;" />
            {{ zh ? 'English' : '简体中文' }}
          </el-button>
          <el-button size="small" type="primary" @click="goBack">
            <font-awesome-icon icon="arrow-left" style="margin-right: 6px;" />
            {{ zh ? '返回' : 'Back' }}
          </el-button>
        </div>
      </header>

      <div class="changelog-list">
        <section v-for="entry in entries" :key="entry.version" class="release" :class="{ 'is-latest': entry.version === version }">
          <div class="release-side">
            <div class="release-version">v{{ entry.version }}</div>
            <div class="release-date">{{ entry.date }}</div>
            <el-tag v-if="entry.version === version" size="small" type="success" effect="plain">
              {{ zh ? '最新' : 'Latest' }}
            </el-tag>
          </div>
          <div class="release-body">
            <h2 class="release-title">{{ entry.title }}</h2>
            <ul class="release-items">
              <li v-for="(item, i) in entry.items" :key="i">{{ item }}</li>
            </ul>
          </div>
        </section>
      </div>

      <footer class="changelog-footer">
        {{ zh ? '日志随系统内置，与当前版本行为保持一致。' : 'This changelog ships with the system and matches the current release.' }}
      </footer>
    </div>
  </div>
</template>

<script>
import { CHANGELOG, CURRENT_VERSION } from '@/data/changelog';
import { setLocale } from '@/locales';
import packageInfo from '../../package.json';

export default {
  name: 'ChangelogPage',
  computed: {
    isZh() {
      return String(this.$i18n.locale || 'zh-CN').startsWith('zh');
    },
    zh() {
      return this.isZh;
    },
    /** 版本号优先取 package.json（构建产物就是它），日志缺失时回退日志首条 */
    version() {
      return packageInfo.version || CURRENT_VERSION;
    },
    /** 按当前语言展开日志 */
    entries() {
      return CHANGELOG.map((entry) => ({
        version: entry.version,
        date: entry.date,
        title: this.isZh ? entry.zh?.title : entry.en?.title,
        items: (this.isZh ? entry.zh?.items : entry.en?.items) || [],
      }));
    },
  },
  methods: {
    toggleLocale() {
      setLocale(this.isZh ? 'en' : 'zh-CN');
    },
    goBack() {
      if (window.history.length > 1) {
        this.$router.back();
      } else {
        this.$router.push('/');
      }
    },
  },
};
</script>

<style scoped>
.changelog-page {
  min-height: 100vh;
  background: var(--bg-color);
  color: var(--el-text-color-primary);
  padding: 28px 16px 60px;
  box-sizing: border-box;
}

.changelog-container {
  max-width: 900px;
  margin: 0 auto;
}

.changelog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.changelog-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 600;
}

.changelog-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.changelog-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.current-version {
  font-weight: 600;
}

.changelog-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.release {
  display: flex;
  gap: 18px;
  padding: 18px 20px;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background: var(--el-fill-color-light);
}

.release.is-latest {
  border-color: color-mix(in srgb, var(--el-color-success) 45%, transparent);
}

.release-side {
  flex: 0 0 108px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.release-version {
  font-size: 18px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.release-date {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.release-body {
  flex: 1 1 auto;
  min-width: 0;
}

.release-title {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 600;
}

.release-items {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.release-items li {
  font-size: 13px;
  line-height: 1.65;
  word-break: break-word;
}

.changelog-footer {
  margin-top: 26px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

@media (max-width: 640px) {
  .release {
    flex-direction: column;
    gap: 10px;
  }

  .release-side {
    flex-direction: row;
    align-items: center;
    gap: 10px;
  }
}
</style>
