// 实测 allowed/list：分别用 admin 与 webdav 会话调用
const { createHmac, scryptSync } = require('crypto');
const SECRET = 'dev-secret-change-me-in-production';
function key() { return scryptSync(SECRET, 'go-imgbed-kdf', 32); }
function mk(user, role) {
  const payload = Buffer.from(JSON.stringify({
    user, role, exp: 0, fexp: 0, bexp: 0, t2: false, tv: true, tva: Math.floor(Date.now() / 1000),
  })).toString('base64url');
  return `goimgbed_session=${payload}.${createHmac('sha256', key()).update(payload).digest('base64url')}`;
}
const BASE = 'http://127.0.0.1:3618';
(async () => {
  for (const [who, cookie, qs] of [
    ['admin(带username)', mk('admin', 'admin'), '?username=webdav'],
    ['admin(不带username)', mk('admin', 'admin'), ''],
    ['webdav(self)', mk('webdav', 'user'), '?username=webdav'],
  ]) {
    const res = await fetch(`${BASE}/api/manage/channels/allowed/list${qs}`, { headers: { cookie } });
    const j = await res.json().catch(() => ({}));
    const list = Array.isArray(j?.data) ? j.data : [];
    console.log(`[${who}] status=${res.status} success=${j.success} n=${list.length}`);
    console.log('   ', list.map(c => `${c.code}:${c.name}`).join(' | '));
  }
})().catch((e) => console.error('ERR', e.message));
