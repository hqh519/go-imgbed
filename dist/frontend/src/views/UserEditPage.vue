<template>
  <div class="container">
    <AdminHeader active-tab="customerConfig" />
    <div class="main-container edit-page">
      <div class="page-head">
        <el-button link class="back-btn" @click="goBack">
          <font-awesome-icon icon="arrow-left" class="back-icon" />{{ $t('userEdit.back') }}
        </el-button>
        <span class="page-title">{{ $t('userEdit.title') }}</span>
        <el-tag v-if="!isSelf" size="small" type="warning">{{ $t('userEdit.adminEditing') }}</el-tag>
      </div>

      <div v-loading="loading">
        <!-- ================= 基本信息 ================= -->
        <el-card shadow="never" class="edit-card">
          <template #header><span class="card-title">{{ $t('userEdit.basic') }}</span></template>

          <div class="avatar-row">
            <div class="avatar-preview">
              <img v-if="avatarSrc" :src="avatarSrc" :alt="form.username" />
              <span v-else class="avatar-fallback">{{ avatarInitial }}</span>
            </div>
            <div class="avatar-actions">
              <el-button size="small" :loading="avatarUploading" @click="pickAvatar">
                {{ avatarSrc ? $t('userEdit.changeAvatar') : $t('userEdit.uploadAvatar') }}
              </el-button>
              <el-button v-if="avatarSrc" size="small" text type="danger" @click="removeAvatar">
                {{ $t('userEdit.removeAvatar') }}
              </el-button>
              <p class="hint">{{ $t('userEdit.avatarHint') }}</p>
            </div>
            <input ref="avatarInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden-input" @change="onAvatarPicked" />
          </div>

          <el-form :model="form" label-position="top" class="edit-form">
            <el-form-item :label="$t('userManage.username')">
              <el-input v-model="form.username" maxlength="32" :placeholder="$t('userManage.usernamePlaceholder')" />
              <p class="hint">{{ $t('userEdit.usernameHint') }}</p>
            </el-form-item>
            <el-form-item :label="$t('userManage.nickname')">
              <el-input v-model="form.nickname" maxlength="60" :placeholder="$t('userManage.nicknamePlaceholder')" />
            </el-form-item>
            <el-form-item :label="$t('userEdit.email')">
              <el-input v-model="form.email" maxlength="120" :placeholder="$t('userEdit.emailPlaceholder')" />
            </el-form-item>
            <el-form-item :label="$t('userEdit.password')">
              <el-input v-model="form.password" type="password" show-password :placeholder="$t('userEdit.passwordPlaceholder')" />
            </el-form-item>
          </el-form>
        </el-card>

        <!-- ================= 会话有效期 ================= -->
        <el-card shadow="never" class="edit-card">
          <template #header><span class="card-title">{{ $t('userEdit.session') }}</span></template>
          <el-form label-position="top" class="edit-form">
            <el-form-item :label="$t('userEdit.frontSession')">
              <el-input-number v-model="form.frontSessionDays" :min="0" :max="3650" :step="1" controls-position="right" class="num-input" />
              <span class="unit">{{ $t('userEdit.days') }}</span>
              <p class="hint">{{ $t('userEdit.frontSessionHint') }}</p>
            </el-form-item>
            <el-form-item :label="$t('userEdit.backSession')">
              <el-input-number v-model="form.backSessionDays" :min="0" :max="3650" :step="1" controls-position="right" class="num-input" />
              <span class="unit">{{ $t('userEdit.days') }}</span>
              <p class="hint">{{ $t('userEdit.backSessionHint') }}</p>
            </el-form-item>
          </el-form>
        </el-card>

        <!-- ================= 两步验证 ================= -->
        <el-card shadow="never" class="edit-card">
          <template #header>
            <span class="card-title">{{ $t('userEdit.totp') }}</span>
            <el-tag size="small" :type="detail.totpEnabled ? 'success' : 'info'" class="card-tag">
              {{ detail.totpEnabled ? $t('userEdit.totpOn') : $t('userEdit.totpOff') }}
            </el-tag>
          </template>

          <div v-if="!detail.totpEnabled">
            <p class="hint block">{{ $t('userEdit.totpHint') }}</p>
            <el-button v-if="!totpSetupData" type="primary" plain size="small" :loading="totpBusy" @click="startTotpSetup">
              {{ $t('userEdit.totpEnable') }}
            </el-button>
            <div v-else class="totp-setup">
              <div class="totp-qr">
                <QRCodeBox :value="totpSetupData.uri" :size="190" />
              </div>
              <div class="totp-steps">
                <p>{{ $t('userEdit.totpStep1') }}</p>
                <p class="secret-line">
                  <span class="secret-label">{{ $t('userEdit.totpSecret') }}</span>
                  <code>{{ totpSetupData.secret }}</code>
                </p>
                <p>{{ $t('userEdit.totpStep2') }}</p>
                <div class="code-row">
                  <el-input v-model="totpCode" maxlength="6" placeholder="000000" class="code-input" @keyup.enter="enableTotp" />
                  <el-button type="primary" :loading="totpBusy" @click="enableTotp">{{ $t('userEdit.totpConfirm') }}</el-button>
                  <el-button text @click="cancelTotpSetup">{{ $t('common.cancel') }}</el-button>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="totp-on-box">
            <p class="hint block">{{ $t('userEdit.totpEnabledHint') }}</p>
            <div class="code-row">
              <el-input v-model="totpCode" maxlength="6" placeholder="000000" class="code-input" />
              <el-button type="danger" plain :loading="totpBusy" @click="disableTotp">{{ $t('userEdit.totpDisable') }}</el-button>
            </div>
          </div>
        </el-card>

        <!-- ================= 权限 / 渠道（仅管理员）================= -->
        <el-card v-if="isAdminRole" shadow="never" class="edit-card">
          <template #header><span class="card-title">{{ $t('userEdit.permissions') }}</span></template>
          <div class="switch-grid">
            <span class="switch-item">{{ $t('userManage.enabled') }}<el-switch v-model="form.enabled" /></span>
            <span class="switch-item">{{ $t('userManage.canEdit') }}<el-switch v-model="form.canEdit" /></span>
            <span class="switch-item">{{ $t('userManage.canDelete') }}<el-switch v-model="form.canDelete" /></span>
            <span class="switch-item">{{ $t('userManage.linkPermission') }}<el-switch v-model="form.linkEnabled" /></span>
            <span class="switch-item">{{ $t('userManage.enforceLimits') }}<el-switch v-model="form.enforceLimits" /></span>
          </div>
          <el-form label-position="top" class="edit-form channel-form">
            <el-form-item :label="$t('userManage.mainChannel')">
              <el-select v-model="form.mainChannelId" clearable :placeholder="$t('userManage.followGlobal')" class="full-width">
                <el-option v-for="c in channelOptions" :key="c.id" :label="`${c.code} · ${c.name}`" :value="c.id" />
              </el-select>
              <p class="hint">{{ $t('userEdit.channelHint') }}</p>
            </el-form-item>
            <el-form-item :label="$t('userManage.backupChannel')">
              <el-select v-model="form.backupChannelId" clearable :placeholder="$t('userManage.followGlobal')" class="full-width">
                <el-option v-for="c in channelOptions" :key="c.id" :label="`${c.code} · ${c.name}`" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-form>
          <el-form-item :label="$t('userManage.adminNote')" class="admin-note-item">
            <el-input v-model="form.adminNote" type="textarea" :rows="3" maxlength="4000" show-word-limit :placeholder="$t('userManage.adminNotePlaceholder')" />
            <p class="hint">{{ $t('userManage.adminNoteHint') }}</p>
          </el-form-item>
        </el-card>

        <!-- ================= 用户公告（仅管理员）================= -->
        <el-card v-if="isAdminRole" shadow="never" class="edit-card">
          <template #header><span class="card-title">{{ $t('userEdit.notice') }}</span></template>
          <p class="hint block">{{ $t('userEdit.noticeHint') }}</p>
          <el-input
            v-model="noticeText"
            type="textarea"
            :rows="10"
            :placeholder="$t('userEdit.noticePlaceholder')"
            class="notice-input"
          />
          <div class="notice-actions">
            <el-button type="primary" plain size="small" :loading="noticeSaving" @click="saveNotice">{{ $t('userEdit.noticeSave') }}</el-button>
            <span class="hint">{{ $t('userEdit.noticeSupportHtml') }}</span>
          </div>
        </el-card>

        <div class="save-bar">
          <el-button @click="goBack">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" :loading="saving" @click="save">{{ $t('common.save') }}</el-button>
        </div>
      </div>
    </div>

    <AvatarCropper
      v-model="showCropper"
      :file="cropFile"
      :size="256"
      :title="$t('userEdit.cropTitle')"
      :hint="$t('userEdit.cropHint')"
      @done="uploadCroppedAvatar"
    />
  </div>
</template>

<script>
import axios from '@/utils/axios';
import AdminHeader from '@/components/dashboard/AdminHeader.vue';
import AvatarCropper from '@/components/user/AvatarCropper.vue';
import QRCodeBox from '@/components/common/QRCodeBox.vue';
import backgroundManager from '@/mixins/backgroundManager';

/**
 * 用户编辑独立页（v202610221824）。
 *
 * 为什么从弹窗改成页面：这里要放用户名/邮箱/头像裁剪/两步验证/会话有效期/
 * 渠道授权/管理备注/用户公告等一大批设置项，弹窗已经装不下也看不清层级。
 *
 * 权限：管理员可编辑任意账户；普通用户进来只能编辑自己这一条，
 * 「权限 / 渠道 / 管理备注 / 用户公告」卡片对普通用户整体隐藏（后端同样会拒绝）。
 */
export default {
    name: 'UserEditPage',
    mixins: [backgroundManager],
    components: { AdminHeader, AvatarCropper, QRCodeBox },
    data() {
        return {
            loading: false,
            saving: false,
            userId: '',
            detail: {},
            form: {
                username: '',
                nickname: '',
                email: '',
                password: '',
                frontSessionDays: 7,
                backSessionDays: 7,
                enabled: true,
                canEdit: true,
                canDelete: true,
                linkEnabled: true,
                enforceLimits: true,
                mainChannelId: '',
                backupChannelId: '',
                adminNote: '',
            },
            channelOptions: [],
            // 头像
            avatarSrc: '',
            cropFile: null,
            showCropper: false,
            avatarUploading: false,
            // 2FA
            totpSetupData: null,
            totpCode: '',
            totpBusy: false,
            // 公告
            noticeText: '',
            noticeSaving: false,
        };
    },
    computed: {
        isAdminRole() {
            return this.$store?.getters?.isAdminRole === true;
        },
        currentUser() {
            return this.$store?.state?.sessionUser || '';
        },
        isSelf() {
            return this.form.username && this.form.username === this.currentUser;
        },
        avatarInitial() {
            const n = String(this.form.nickname || this.form.username || '?').trim();
            return n ? n.slice(0, 1).toUpperCase() : '?';
        },
    },
    mounted() {
        this.userId = this.$route.params.id;
        this.load();
    },
    methods: {
        goBack() {
            this.$router.push({ name: 'customerConfig' });
        },
        async load() {
            this.loading = true;
            try {
                const res = await axios.get(`/api/manage/users/${encodeURIComponent(this.userId)}`, { withCredentials: true });
                if (!res.data?.success) {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                    return;
                }
                const d = res.data.data || {};
                this.detail = d;
                this.form = {
                    username: d.username || '',
                    nickname: d.nickname || '',
                    email: d.email || '',
                    password: '',
                    frontSessionDays: d.frontSessionDays ?? 7,
                    backSessionDays: d.backSessionDays ?? 7,
                    enabled: d.enabled !== false,
                    canEdit: d.canEdit !== false,
                    canDelete: d.canDelete !== false,
                    linkEnabled: d.linkEnabled !== false,
                    enforceLimits: d.enforceLimits !== false,
                    mainChannelId: d.mainChannelId || '',
                    backupChannelId: d.backupChannelId || '',
                    adminNote: d.adminNote || '',
                };
                this.avatarSrc = d.avatarUrl || '';
                if (this.isAdminRole) {
                    await Promise.all([this.loadChannels(), this.loadNotice()]);
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.loading = false;
            }
        },
        /** 只加载「该账户获授权」的渠道（管理员可为任意账户查看） */
        async loadChannels() {
            try {
                const res = await axios.get('/api/manage/channels/allowed/list', {
                    params: { username: this.form.username },
                    withCredentials: true,
                });
                this.channelOptions = res.data?.success ? (res.data.data || []) : [];
            } catch {
                this.channelOptions = [];
            }
        },
        /** 用户公告（管理员专属，读一次） */
        async loadNotice() {
            try {
                const res = await axios.get('/api/manage/users/notice', { withCredentials: true });
                this.noticeText = res.data?.success ? (res.data.data?.content || '') : '';
            } catch {
                this.noticeText = '';
            }
        },
        async saveNotice() {
            this.noticeSaving = true;
            try {
                const res = await axios.post('/api/manage/users/notice', { content: this.noticeText }, { withCredentials: true });
                if (res.data?.success) this.$message.success(this.$t('common.success'));
                else this.$message.error(res.data?.message || this.$t('common.failed'));
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.noticeSaving = false;
            }
        },
        async save() {
            if (!String(this.form.username || '').trim()) {
                this.$message.warning(this.$t('userManage.usernameRequired'));
                return;
            }
            if (this.form.password && this.form.password.length < 4) {
                this.$message.warning(this.$t('userManage.passwordTooShort'));
                return;
            }
            this.saving = true;
            try {
                const payload = {
                    username: this.form.username,
                    nickname: this.form.nickname,
                    email: this.form.email,
                    frontSessionDays: this.form.frontSessionDays,
                    backSessionDays: this.form.backSessionDays,
                };
                if (this.form.password) payload.password = this.form.password;
                if (this.isAdminRole) {
                    Object.assign(payload, {
                        enabled: this.form.enabled,
                        canEdit: this.form.canEdit,
                        canDelete: this.form.canDelete,
                        linkEnabled: this.form.linkEnabled,
                        enforceLimits: this.form.enforceLimits,
                        mainChannelId: this.form.mainChannelId,
                        backupChannelId: this.form.backupChannelId,
                        adminNote: this.form.adminNote,
                    });
                }
                const res = await axios.put(`/api/manage/users/${encodeURIComponent(this.userId)}`, payload, { withCredentials: true });
                if (res.data?.success) {
                    this.$message.success(this.$t('common.success'));
                    this.detail = { ...this.detail, ...this.form };
                    this.form.password = '';
                    // 改了自己的用户名 → 会话里的用户名已失效，提示重新登录
                    if (this.isSelf && payload.username !== this.currentUser) {
                        this.$message.info(this.$t('userEdit.reloginHint'));
                    }
                    await this.load();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.saving = false;
            }
        },

        /* ---------------- 头像 ---------------- */
        pickAvatar() {
            this.$refs.avatarInput?.click();
        },
        onAvatarPicked(evt) {
            const file = evt.target.files?.[0];
            evt.target.value = '';
            if (!file) return;
            if (!/^image\//.test(file.type)) {
                this.$message.warning(this.$t('userEdit.avatarTypeError'));
                return;
            }
            this.cropFile = file;
            this.showCropper = true;
        },
        async uploadCroppedAvatar(file) {
            const fd = new FormData();
            fd.append('file', file);
            this.avatarUploading = true;
            try {
                const res = await axios.post(`/api/manage/users/${encodeURIComponent(this.userId)}/avatar`, fd, {
                    withCredentials: true,
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                if (res.data?.success) {
                    this.avatarSrc = res.data.data?.avatarUrl || '';
                    this.detail.avatar = res.data.data?.avatar || '';
                    this.$message.success(this.$t('common.success'));
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.avatarUploading = false;
            }
        },
        async removeAvatar() {
            try {
                const res = await axios.delete(`/api/manage/users/${encodeURIComponent(this.userId)}/avatar`, { withCredentials: true });
                if (res.data?.success) {
                    this.avatarSrc = '';
                    this.detail.avatar = '';
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            }
        },

        /* ---------------- 两步验证 ---------------- */
        async startTotpSetup() {
            this.totpBusy = true;
            try {
                const res = await axios.post(`/api/manage/users/${encodeURIComponent(this.userId)}/totp/setup`, {}, { withCredentials: true });
                if (res.data?.success) {
                    this.totpSetupData = res.data.data;
                    this.totpCode = '';
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.totpBusy = false;
            }
        },
        cancelTotpSetup() {
            this.totpSetupData = null;
            this.totpCode = '';
        },
        async enableTotp() {
            if (!/^\d{6}$/.test(String(this.totpCode || ''))) {
                this.$message.warning(this.$t('userEdit.totpCodeInvalid'));
                return;
            }
            this.totpBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/totp/enable`,
                    { code: this.totpCode },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(this.$t('userEdit.totpEnabledOk'));
                    this.totpSetupData = null;
                    this.totpCode = '';
                    this.detail.totpEnabled = true;
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.totpBusy = false;
            }
        },
        async disableTotp() {
            this.totpBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/totp/disable`,
                    { code: this.totpCode },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(this.$t('common.success'));
                    this.detail.totpEnabled = false;
                    this.totpCode = '';
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.totpBusy = false;
            }
        },
    },
};
</script>

<style scoped>
.edit-page { padding-bottom: 90px; }
.page-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
    flex-wrap: wrap;
}
.back-btn { font-size: 14px; }
.back-icon { margin-right: 6px; }
.page-title { font-size: 17px; font-weight: 600; }
.edit-card { margin-bottom: 14px; }
.card-title { font-weight: 600; font-size: 14px; }
.card-tag { margin-left: 8px; }
.avatar-row { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; }
.avatar-preview {
    width: 84px;
    height: 84px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--el-fill-color-light, #f2f3f5);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
.avatar-fallback { font-size: 30px; color: var(--el-text-color-secondary, #909399); }
.avatar-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.hidden-input { display: none; }
.edit-form { max-width: 520px; }
.num-input { width: 160px; }
.unit { margin-left: 8px; color: var(--el-text-color-secondary, #909399); font-size: 13px; }
.hint { margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary, #909399); line-height: 1.5; }
.hint.block { margin: 0 0 10px; }
.switch-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 26px;
    margin-bottom: 16px;
}
.switch-item { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
.channel-form { display: flex; gap: 16px; flex-wrap: wrap; }
.channel-form .el-form-item { flex: 1; min-width: 220px; }
.full-width { width: 100%; }
.admin-note-item { margin-top: 4px; }
.notice-input { max-width: 720px; }
.notice-actions { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.totp-setup { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; }
.totp-qr { padding: 6px; background: #fff; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; }
.totp-steps { flex: 1; min-width: 240px; font-size: 13px; line-height: 1.7; }
.secret-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.secret-label { color: var(--el-text-color-secondary, #909399); }
.secret-line code {
    background: var(--el-fill-color-light, #f5f7fa);
    padding: 2px 8px;
    border-radius: 4px;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 1px;
    word-break: break-all;
}
.code-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.code-input { width: 130px; }
.totp-on-box { max-width: 520px; }
.save-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 0;
    background: var(--el-bg-color, #fff);
}
@media (max-width: 768px) {
    .avatar-row { flex-direction: column; align-items: flex-start; }
    .channel-form { flex-direction: column; }
}
</style>
