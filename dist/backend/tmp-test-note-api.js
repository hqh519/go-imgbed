// 临时排查脚本：伪造 admin 会话，实测 metadata 接口的 Note 下发与写入
const { createHmac, scryptSync } = require('crypto');
const SECRET = 'dev-secret-change-me-in-production'; // debug/backend/.env CONFIG_SECRET
function key() { return scryptSync(SECRET, 'go-imgbed-kdf', 32); }
function sign(v) { return createHmac('sha256', key()).update(v).digest('base64url'); }
const payload = Buffer.from(JSON.stringify({
  user: 'admin', role: 'admin', exp: 0, fexp: 0, bexp: 0, t2: false, tv: true, tva: Math.floor(Date.now() / 1000),
})).toString('base64url');
const cookie = `goimgbed_session=${payload}.${sign(payload)}`;

const BASE = 'http://127.0.0.1:3618';
const NAME = process.argv[2];
(async () => {
  // 1) GET metadata
  let res = await fetch(`${BASE}/api/manage/metadata/${encodeURIComponent(NAME)}`, { headers: { cookie } });
  let j = await res.json().catch(() => ({}));
  console.log('GET status:', res.status);
  console.log('GET success:', j.success, '| data.note:', JSON.stringify(j?.data?.note), '| data.Note:', JSON.stringify(j?.data?.Note));
  console.log('data keys:', Object.keys(j?.data || {}).join(','));
  // 2) PATCH note
  res = await fetch(`${BASE}/api/manage/metadata/${encodeURIComponent(NAME)}`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Note: 'tmp-test-note-1023' }),
  });
  j = await res.json().catch(() => ({}));
  console.log('PATCH status:', res.status, '| body:', JSON.stringify(j).slice(0, 300));
  // 3) re-GET
  res = await fetch(`${BASE}/api/manage/metadata/${encodeURIComponent(NAME)}`, { headers: { cookie } });
  j = await res.json().catch(() => ({}));
  console.log('re-GET note:', JSON.stringify(j?.data?.note), '| Note:', JSON.stringify(j?.data?.Note));
})().catch((e) => console.error('ERR', e.message));
