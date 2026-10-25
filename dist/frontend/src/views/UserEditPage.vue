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
              <div class="email-row">
                <el-input
                  v-model="form.email"
                  maxlength="120"
                  :disabled="emailVerified"
                  :placeholder="$t('userEdit.emailPlaceholder')"
                  class="email-input"
                />
                <el-tag v-if="emailVerified" size="small" type="success" effect="plain" class="email-tag">
                  <font-awesome-icon icon="check" class="email-tag-icon" />{{ $t('userEdit.emailVerified') }}
                </el-tag>
                <!-- 未验证 → 发码验证；已验证 → 只允许先「更换邮箱」再重新验证 -->
                <el-tooltip v-if="!emailVerified" :disabled="mailReady" :content="$t('userEdit.mailNotReady')" placement="top">
                  <span>
                    <el-button
                      size="small"
                      type="primary"
                      plain
                      :loading="emailBusy"
                      :disabled="!mailReady"
                      @click="openEmailVerify"
                    >{{ $t('userEdit.verifyEmail') }}</el-button>
                  </span>
                </el-tooltip>
                <el-button v-else size="small" text type="warning" @click="resetEmailVerified">
                  {{ $t('userEdit.changeEmail') }}
                </el-button>
              </div>
              <p class="hint">{{ emailVerified ? $t('userEdit.emailVerifiedHint') : $t('userEdit.emailVerifyHint') }}</p>
            </el-form-item>
            <el-form-item :label="$t('userEdit.password')">
              <el-input v-model="form.password" type="password" show-password :placeholder="$t('userEdit.passwordPlaceholder')" />
            </el-form-item>
            <!--
              v2.6.0：修改密码必须验证身份
              · 本人 → 原密码 / 邮箱验证码 / 2FA 动态码 三选一
              · 管理员改他人 → 输入管理员自己的密码
            -->
            <el-form-item v-if="form.password" :label="$t('userEdit.pwdVerifyLabel')">
              <template v-if="isAdminRole && !isSelf">
                <el-input
                  v-model="adminPassword"
                  type="password"
                  show-password
                  :placeholder="$t('userEdit.adminPasswordPlaceholder')"
                  class="pwd-verify-input"
                />
                <p class="hint">{{ $t('userEdit.adminPasswordHint') }}</p>
              </template>
              <template v-else>
                <el-radio-group v-model="pwdVerifyMethod" class="pwd-verify-methods">
                  <el-radio-button label="old">{{ $t('userEdit.pwdVerifyOld') }}</el-radio-button>
                  <el-radio-button label="email">{{ $t('userEdit.pwdVerifyEmail') }}</el-radio-button>
                  <el-radio-button label="totp">{{ $t('userEdit.pwdVerifyTotp') }}</el-radio-button>
                </el-radio-group>
                <el-input
                  v-if="pwdVerifyMethod === 'old'"
                  v-model="pwdOldPassword"
                  type="password"
                  show-password
                  :placeholder="$t('userEdit.pwdVerifyOldPlaceholder')"
                  class="pwd-verify-input"
                />
                <div v-else-if="pwdVerifyMethod === 'email'" class="code-row">
                  <el-button size="small" :loading="pwdEmailBusy" :disabled="!mailReady" @click="sendPwdChangeCode">
                    {{ $t('userEdit.pwdSendCode') }}
                  </el-button>
                  <el-input
                    v-model="pwdEmailCode"
                    maxlength="6"
                    :placeholder="$t('userEdit.emailCodePlaceholder')"
                    class="code-input"
                  />
                </div>
                <el-input
                  v-else
                  v-model="pwdTotpCode"
                  :placeholder="$t('userEdit.pwdVerifyTotpPlaceholder')"
                  class="pwd-verify-input"
                />
                <p class="hint">{{ $t('userEdit.pwdVerifyHint') }}</p>
              </template>
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
            <el-tag
              v-if="detail.totpEnabled && recoveryCount"
              size="small"
              type="warning"
              effect="plain"
              class="card-tag"
            >{{ $t('userEdit.recoveryLeft', { count: recoveryCount }) }}</el-tag>
          </template>

          <div v-if="!detail.totpEnabled">
            <p class="hint block">{{ $t('userEdit.totpHint') }}</p>
            <!-- 未验证邮箱不允许启用：邮箱是「验证器丢失」时唯一的自助找回通道 -->
            <el-alert
              v-if="!emailVerified"
              :title="$t('userEdit.totpNeedEmail')"
              type="warning"
              :closable="false"
              show-icon
              class="totp-alert"
            />
            <el-button
              v-if="!totpSetupData"
              type="primary"
              plain
              size="small"
              :loading="totpBusy"
              :disabled="!emailVerified"
              @click="startTotpSetup"
            >{{ $t('userEdit.totpEnable') }}</el-button>
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
              <el-button link type="primary" size="small" @click="regenerateRecovery">
                {{ $t('userEdit.regenRecovery') }}
              </el-button>
            </div>

            <!-- 恢复码：库里只存摘要，明文只在启用 / 重新生成时显示一次 -->
            <div class="forgot-box">
              <div class="forgot-head">
                <span class="forgot-title">{{ $t('userEdit.forgotTotp') }}</span>
                <span class="hint">{{ $t('userEdit.forgotTotpHint') }}</span>
              </div>
              <div class="code-row">
                <el-button size="small" :loading="disableBusy" @click="sendDisableCode">
                  {{ $t('userEdit.sendDisableCode') }}
                </el-button>
                <!-- v2.6.0：验证码为 6 位字母数字（不区分大小写），验证码/恢复码二选一 -->
                <el-input v-model="disableEmailCode" maxlength="6" :placeholder="$t('userEdit.emailCodePlaceholder')" class="code-input" />
                <el-input v-model="disableRecoveryCode" :placeholder="$t('userEdit.recoveryPlaceholder')" class="recovery-input" />
                <el-button type="danger" plain size="small" :loading="disableBusy" @click="disableTotpByFallback">
                  {{ $t('userEdit.totpDisable') }}
                </el-button>
              </div>
            </div>
          </div>
        </el-card>

        <!-- ================= 存储渠道（本人也能改，仅限已授权渠道）================= -->
        <el-card shadow="never" class="edit-card">
          <template #header><span class="card-title">{{ $t('userEdit.channels') }}</span></template>
          <el-form label-position="top" class="edit-form channel-form">
            <el-form-item :label="$t('userManage.mainChannel')">
              <el-select v-model="mainChannelModel" class="full-width">
                <!-- 首位「默认(跟随全局)」：清空该账户的个人设置，回到系统主渠道 -->
                <el-option :label="$t('userEdit.channelFollowGlobal')" value="__default__" />
                <el-option v-for="c in channelOptions" :key="c.id" :label="`${c.code} · ${c.name}`" :value="c.id" />
              </el-select>
              <p class="hint">{{ $t('userEdit.channelHint') }}</p>
            </el-form-item>
            <el-form-item :label="$t('userManage.backupChannel')">
              <el-select v-model="backupChannelModel" class="full-width">
                <el-option :label="$t('userEdit.channelFollowGlobal')" value="__default__" />
                <!-- 第二位「none(不备份)」：明确表示该账户上传的文件不做备份写 -->
                <el-option :label="$t('userEdit.channelNone')" value="none" />
                <el-option v-for="c in channelOptions" :key="c.id" :label="`${c.code} · ${c.name}`" :value="c.id" />
              </el-select>
              <p class="hint">{{ $t('userEdit.backupChannelHint') }}</p>
            </el-form-item>
          </el-form>
        </el-card>

        <!-- ================= 管理员操作（仅管理员；v2.4.0 移到存储渠道之后）================= -->
        <el-card v-if="isAdminRole" shadow="never" class="edit-card">
          <template #header><span class="card-title">{{ $t('userEdit.adminActions') }}</span></template>
          <div class="switch-grid">
            <span class="switch-item">{{ $t('userManage.enabled') }}<el-switch v-model="form.enabled" /></span>
            <span class="switch-item">{{ $t('userManage.canEdit') }}<el-switch v-model="form.canEdit" /></span>
            <span class="switch-item">{{ $t('userManage.canDelete') }}<el-switch v-model="form.canDelete" /></span>
            <span class="switch-item">{{ $t('userManage.linkPermission') }}<el-switch v-model="form.linkEnabled" /></span>
            <span class="switch-item">{{ $t('userManage.enforceLimits') }}<el-switch v-model="form.enforceLimits" /></span>
          </div>
          <!-- v2.4.0：管理备注输入框换到名称下一行（不再与标签同行） -->
          <div class="admin-note-block">
            <span class="admin-note-label">{{ $t('userManage.adminNote') }}</span>
            <el-input v-model="form.adminNote" type="textarea" :rows="3" maxlength="4000" show-word-limit :placeholder="$t('userManage.adminNotePlaceholder')" />
            <p class="hint">{{ $t('userManage.adminNoteHint') }}</p>
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

    <!-- 邮箱验证：发送验证码 → 回填校验 → 通过后锁定邮箱 -->
    <el-dialog v-model="showEmailDialog" :title="$t('userEdit.verifyEmail')" :width="dialogWidth" append-to-body>
      <p class="hint block">{{ $t('userEdit.emailCodeSentTo', { email: pendingEmail }) }}</p>
      <div class="code-row">
        <el-input v-model="emailCode" maxlength="6" placeholder="000000" class="code-input" @keyup.enter="verifyEmail" />
        <el-button type="primary" :loading="emailBusy" @click="verifyEmail">{{ $t('userEdit.verifyEmailOk') }}</el-button>
      </div>
      <div class="resend-row">
        <el-button link size="small" :disabled="resendLeft > 0 || emailBusy" @click="sendEmailCode">
          {{ resendLeft > 0 ? $t('userEdit.resendIn', { count: resendLeft }) : $t('userEdit.resendCode') }}
        </el-button>
      </div>
      <template #footer>
        <el-button @click="showEmailDialog = false">{{ $t('common.cancel') }}</el-button>
      </template>
    </el-dialog>

    <!-- 恢复码：只在启用 / 重新生成后显示这一次，库里只留摘要 -->
    <el-dialog v-model="showRecoveryDialog" :title="$t('userEdit.recoveryTitle')" :width="dialogWidth" append-to-body>
      <el-alert :title="$t('userEdit.recoveryOnce')" type="warning" :closable="false" show-icon class="recovery-alert" />
      <div class="recovery-grid">
        <code v-for="code in recoveryCodes" :key="code">{{ code }}</code>
      </div>
      <template #footer>
        <!-- v2.6.0：「我已保存」改为「复制全部」—— 一键复制所有恢复码并关闭窗口 -->
        <el-button type="primary" @click="copyRecoveryCodes">{{ $t('userEdit.recoveryCopyAll') }}</el-button>
      </template>
    </el-dialog>
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
            disableBusy: false,
            disableEmailCode: '',
            disableRecoveryCode: '',
            // 恢复码（一次性展示）
            recoveryCodes: [],
            showRecoveryDialog: false,
            // 邮箱验证
            emailVerified: false,
            // 发信邮箱是否已配置（未配置时「验证邮箱」不可用）
            mailReady: false,
            emailBusy: false,
            showEmailDialog: false,
            pendingEmail: '',
            emailCode: '',
            resendLeft: 0,
            resendTimer: null,
            // v2.6.0：修改密码身份验证（本人三选一 / 管理员改他人需管理员密码）
            pwdVerifyMethod: 'old',
            pwdOldPassword: '',
            pwdEmailCode: '',
            pwdTotpCode: '',
            pwdEmailBusy: false,
            adminPassword: '',
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
        /** 剩余可用恢复码数量（由后端 detail 下发，启用 2FA 后 > 0） */
        recoveryCount() {
            return Number(this.detail?.recoveryCount || 0);
        },
        dialogWidth() {
            return window.innerWidth <= 768 ? '92%' : '520px';
        },
        /*
         * 渠道下拉的两个「特殊值」。
         * el-select 把空字符串当成「未选择」而显示 placeholder，所以这里用 __default__ 作为
         * 「默认(跟随全局)」的哨兵值，写回表单时再还原成空串（后端语义：空 = 跟随全局）。
         */
        mainChannelModel: {
            get() { return this.form.mainChannelId || '__default__'; },
            set(v) { this.form.mainChannelId = v === '__default__' ? '' : v; },
        },
        backupChannelModel: {
            get() { return this.form.backupChannelId || '__default__'; },
            set(v) { this.form.backupChannelId = v === '__default__' ? '' : v; },
        },
    },
    beforeUnmount() {
        if (this.resendTimer) window.clearInterval(this.resendTimer);
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
                // 邮箱验证状态（已验证 → 输入框锁定，显示「已验证」）
                this.emailVerified = d.emailVerified === true;
                this.detail = { ...d, emailVerified: this.emailVerified };
                // 渠道下拉：管理员可看任意账户，普通用户只能看自己已授权的渠道
                await Promise.all([this.loadChannels(), this.loadMailReady()]);
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.loading = false;
            }
        },
        /** 发信邮箱是否已配置（决定「验证邮箱」按钮是否可用） */
        async loadMailReady() {
            try {
                const res = await axios.get('/api/manage/mail', { withCredentials: true });
                this.mailReady = !!(res.data?.success ? res.data.data?.ready : false);
            } catch {
                this.mailReady = false;
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
        /* ---------------- 邮箱验证（v2.3.0） ---------------- */

        /** 打开验证弹窗：先发码（发到当前填写的地址） */
        async openEmailVerify() {
            const email = String(this.form.email || '').trim();
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                this.$message.warning(this.$t('userEdit.emailPlaceholder'));
                return;
            }
            this.pendingEmail = email;
            this.emailCode = '';
            this.showEmailDialog = true;
            await this.sendEmailCode();
        },

        /** 发送 / 重新发送验证码（60 秒倒计时与后端限流保持一致） */
        async sendEmailCode() {
            if (this.emailBusy) return;
            this.emailBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/email/send-code`,
                    { email: this.pendingEmail || String(this.form.email || '').trim() },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(res.data.message || this.$t('userEdit.emailCodeSent'));
                    this.startResendCountdown();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.emailBusy = false;
            }
        },

        startResendCountdown() {
            this.resendLeft = 60;
            if (this.resendTimer) window.clearInterval(this.resendTimer);
            this.resendTimer = window.setInterval(() => {
                this.resendLeft = Math.max(0, this.resendLeft - 1);
                if (this.resendLeft === 0 && this.resendTimer) {
                    window.clearInterval(this.resendTimer);
                    this.resendTimer = null;
                }
            }, 1000);
        },

        /** 提交验证码：通过后后端会写入邮箱并置 emailVerified */
        async verifyEmail() {
            if (!/^\d{6}$/.test(String(this.emailCode || ''))) {
                this.$message.warning(this.$t('userEdit.emailCodeInvalid'));
                return;
            }
            this.emailBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/email/verify`,
                    { email: this.pendingEmail, code: this.emailCode },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(this.$t('userEdit.emailVerifiedOk'));
                    this.emailVerified = true;
                    this.detail.emailVerified = true;
                    this.form.email = res.data.data?.email || this.pendingEmail;
                    this.showEmailDialog = false;
                    this.emailCode = '';
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.emailBusy = false;
            }
        },

        /** 更换邮箱：先取消已验证状态（2FA 开启时后端会拒绝，需先关 2FA） */
        async resetEmailVerified() {
            try {
                await this.$confirm(this.$t('userEdit.changeEmailConfirm'), this.$t('common.warning'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'warning',
                });
            } catch {
                return;
            }
            try {
                const res = await axios.delete(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/email/verified`,
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.emailVerified = false;
                    this.detail.emailVerified = false;
                    this.$message.success(res.data.message || this.$t('common.success'));
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            }
        },

        /** v2.6.0：修改密码 —— 发送「修改密码验证码」到账户邮箱（本人或管理员） */
        async sendPwdChangeCode() {
            this.pwdEmailBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/password/send-code`,
                    {},
                    { withCredentials: true },
                );
                if (res.data?.success) this.$message.success(res.data.message || this.$t('userEdit.emailCodeSent'));
                else this.$message.error(res.data?.message || this.$t('common.failed'));
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.pwdEmailBusy = false;
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
            // v2.6.0：改密必须带身份验证凭据
            if (this.form.password) {
                if (this.isAdminRole && !this.isSelf) {
                    if (!String(this.adminPassword || '')) {
                        this.$message.warning(this.$t('userEdit.adminPasswordPlaceholder'));
                        return;
                    }
                } else {
                    const v =
                        this.pwdVerifyMethod === 'old'
                            ? this.pwdOldPassword
                            : this.pwdVerifyMethod === 'email'
                                ? this.pwdEmailCode
                                : this.pwdTotpCode;
                    if (!String(v || '').trim()) {
                        this.$message.warning(this.$t('userEdit.pwdVerifyRequired'));
                        return;
                    }
                }
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
                if (this.form.password) {
                    payload.password = this.form.password;
                    if (this.isAdminRole && !this.isSelf) {
                        payload.adminPassword = this.adminPassword;
                    } else if (this.pwdVerifyMethod === 'old') {
                        payload.oldPassword = this.pwdOldPassword;
                    } else if (this.pwdVerifyMethod === 'email') {
                        payload.emailCode = this.pwdEmailCode;
                    } else {
                        payload.totpCode = this.pwdTotpCode;
                    }
                }
                /*
                 * 主/备渠道：本人也能改（v2.3.0），后端会校验「只能选该账户已授权的渠道」，
                 * 'none'（不备份）是唯一不需要授权的例外值。
                 */
                payload.mainChannelId = this.form.mainChannelId;
                payload.backupChannelId = this.form.backupChannelId;
                if (this.isAdminRole) {
                    Object.assign(payload, {
                        enabled: this.form.enabled,
                        canEdit: this.form.canEdit,
                        canDelete: this.form.canDelete,
                        linkEnabled: this.form.linkEnabled,
                        enforceLimits: this.form.enforceLimits,
                        adminNote: this.form.adminNote,
                    });
                }
                const res = await axios.put(`/api/manage/users/${encodeURIComponent(this.userId)}`, payload, { withCredentials: true });
                if (res.data?.success) {
                    this.$message.success(this.$t('common.success'));
                    this.detail = { ...this.detail, ...this.form };
                    this.form.password = '';
                    // v2.6.0：清掉本次的身份验证凭据
                    this.pwdOldPassword = '';
                    this.pwdEmailCode = '';
                    this.pwdTotpCode = '';
                    this.adminPassword = '';
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
                    // 恢复码只返回这一次 —— 立刻弹窗让用户抄下来
                    const codes = res.data.data?.recoveryCodes || [];
                    if (codes.length) {
                        this.recoveryCodes = codes;
                        this.showRecoveryDialog = true;
                    }
                    await this.load();
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
                    this.disableEmailCode = '';
                    this.disableRecoveryCode = '';
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.totpBusy = false;
            }
        },

        /**
         * v2.6.0：恢复码弹窗「复制全部」—— 一键复制所有恢复码（每行一枚）
         * 并自动关闭窗口；复制失败时给出降级提示（弹窗不关闭，用户可手动选择）。
         */
        async copyRecoveryCodes() {
            const text = (this.recoveryCodes || []).join('\n');
            if (!text) return;
            let ok = false;
            try {
                await navigator.clipboard.writeText(text);
                ok = true;
            } catch {
                // 非安全上下文（http）下 clipboard API 不可用 → execCommand 降级
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    ok = document.execCommand('copy');
                    document.body.removeChild(ta);
                } catch {
                    ok = false;
                }
            }
            if (ok) {
                this.$message.success(this.$t('userEdit.recoveryCopied'));
                this.showRecoveryDialog = false;
            } else {
                this.$message.error(this.$t('userEdit.recoveryCopyFailed'));
            }
        },

        /** 重新生成恢复码（需当前动态码；旧码全部作废） */
        async regenerateRecovery() {
            if (!/^\d{6}$/.test(String(this.totpCode || ''))) {
                this.$message.warning(this.$t('userEdit.totpCodeInvalid'));
                return;
            }
            this.totpBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/totp/recovery`,
                    { code: this.totpCode },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.recoveryCodes = res.data.data?.recoveryCodes || [];
                    this.showRecoveryDialog = true;
                    await this.load();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.totpBusy = false;
            }
        },

        /** 忘记验证器：发送「关闭两步验证」邮箱验证码 */
        async sendDisableCode() {
            this.disableBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/totp/disable-code`,
                    {},
                    { withCredentials: true },
                );
                if (res.data?.success) this.$message.success(res.data.message || this.$t('userEdit.emailCodeSent'));
                else this.$message.error(res.data?.message || this.$t('common.failed'));
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.disableBusy = false;
            }
        },

        /**
         * 忘记验证器：邮箱验证码 或 一枚恢复码（v2.6.0 起任一即可）→ 关闭两步验证
         */
        async disableTotpByFallback() {
            const emailCode = String(this.disableEmailCode || '').trim();
            const recoveryCode = String(this.disableRecoveryCode || '').trim();
            if (!emailCode && !recoveryCode) {
                this.$message.warning(this.$t('userEdit.disableEitherHint'));
                return;
            }
            this.disableBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/totp/disable-fallback`,
                    { emailCode, recoveryCode },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(res.data.message || this.$t('common.success'));
                    this.disableEmailCode = '';
                    this.disableRecoveryCode = '';
                    await this.load();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.disableBusy = false;
            }
        },
    },
};
</script>

<style scoped>
/*
 * 宽度对齐「用户管理」列表（v2.3.0）：
 * 列表页的 .main-table / .module-switch 都是 width:95% + max-width:1400px 居中，
 * 编辑页此前没有任何宽度约束（铺满整屏），两者并排切换时观感不一致。
 */
.edit-page {
    width: 95%;
    max-width: 1400px;
    margin: 32px auto 0;
    padding-bottom: 90px;
    box-sizing: border-box;
}
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
/* v2.4.0：管理备注 —— 名称在上、输入框另起一行 */
.admin-note-block { margin-top: 4px; display: flex; flex-direction: column; gap: 8px; }
.admin-note-label { font-size: 14px; color: var(--el-text-color-primary); }
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
.email-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%; }
.email-input { flex: 1; min-width: 200px; }
.email-tag { display: inline-flex; align-items: center; gap: 4px; }
.email-tag-icon { font-size: 11px; }
.totp-alert { margin-bottom: 10px; max-width: 620px; }
.forgot-box {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px dashed var(--el-border-color-lighter, #ebeef5);
}
.forgot-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.forgot-title { font-size: 13px; font-weight: 600; }
.recovery-input { width: 170px; }
/* v2.6.0：修改密码身份验证 */
.pwd-verify-methods { margin-bottom: 8px; display: flex; flex-wrap: wrap; }
.pwd-verify-input { max-width: 360px; }
.recovery-alert { margin-bottom: 14px; }
.recovery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-top: 6px;
}
.recovery-grid code {
    display: block;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--el-fill-color-light, #f5f7fa);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 14px;
    letter-spacing: 1px;
    text-align: center;
}
.resend-row { margin-top: 10px; }
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
