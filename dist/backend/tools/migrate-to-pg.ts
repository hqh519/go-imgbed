/**
 * SQLite → PostgreSQL 数据迁移脚本（铺路工具，平时不参与运行）
 *
 * 背景：docs/数据库选型建议.md —— 当前继续用 SQLite，本脚本保证「将来要换 PG 时」
 * 迁移是一小时级的、已验证过的机械操作，而不是一次未知的冒险。
 *
 * 原理：两端各起一个 Prisma Client，按外键依赖顺序逐表 findMany → createMany。
 * 不用 SQL dump：SQLite 的 DateTime 底层是毫秒整数，交给 Prisma 读成 Date 再写入 PG 最稳。
 *
 * 使用步骤（全部手动执行）：
 *   1) 生成 PG 专用 client（输出到 backend/node_modules/.prisma-pg-client，不覆盖默认 client）：
 *        cd debug/backend
 *        node node_modules/prisma/build/index.js generate --schema prisma/schema.postgres.prisma
 *   2) 起一个空 PG（可选 profile，不影响日常部署）：
 *        cd dist/docker
 *        docker compose -f docker-compose.yml -f docker-compose.pg.yml up -d postgres
 *   3) 建表：
 *        DATABASE_URL_PG="postgresql://用户:密码@127.0.0.1:5432/go-imgbed" \
 *          node node_modules/prisma/build/index.js db push --schema prisma/schema.postgres.prisma --skip-generate
 *   4) 迁移（先演练再真跑）：
 *        DATABASE_URL_PG="postgresql://..." node --experimental-strip-types migrate-to-pg.ts --dry-run
 *        DATABASE_URL_PG="postgresql://..." node --experimental-strip-types migrate-to-pg.ts
 *   5) 校验通过后，把后端 DATABASE_URL 换成 PG 连接串 + schema 切 provider（见文档 §6.1）
 *
 * 安全性：默认往 PG 写；加 --dry-run 只做两端行数比对。重复执行安全（skipDuplicates）。
 */

const { createRequire } = require('module');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..', 'backend');
const backendRequire = createRequire(path.join(BACKEND, 'package.json'));

const DRY_RUN = process.argv.includes('--dry-run');
const PG_URL = process.env.DATABASE_URL_PG || '';

// SQLite 端的连接串：优先取环境变量，否则从 backend/.env 解析（Prisma Client 不会自动加载任意 cwd 的 .env）
if (!process.env.DATABASE_URL) {
  try {
    const envText = require('fs').readFileSync(path.join(BACKEND, '.env'), 'utf8');
    const m = envText.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) process.env.DATABASE_URL = m[1].trim();
  } catch {
    /* 没有 .env 就完全依赖环境变量 */
  }
}

function die(msg) {
  console.error(`[migrate-to-pg] ${msg}`);
  process.exit(1);
}

if (!PG_URL) {
  die('缺少环境变量 DATABASE_URL_PG（例如 postgresql://user:pass@127.0.0.1:5432/go-imgbed）');
}

// ---------- 两端 Client ----------

const { PrismaClient: SqliteClient } = backendRequire('@prisma/client');

let PgClient;
const PG_CLIENT_DIR = path.join(BACKEND, 'node_modules', '.prisma-pg-client');
try {
  ({ PrismaClient: PgClient } = require(PG_CLIENT_DIR));
} catch {
  die(`未找到 PG client（${PG_CLIENT_DIR}）。先执行：
  cd ${BACKEND} && node node_modules/prisma/build/index.js generate --schema prisma/schema.postgres.prisma`);
}

const sqlite = new SqliteClient(); // 读 .env 的 DATABASE_URL（backend/.env 由 load-env 逻辑无关，Prisma 自己读 env）
const pg = new PgClient({ datasources: { db: { url: PG_URL } } });

// ---------- 迁移顺序（外键依赖：被引用的表先走） ----------

const TABLES = [
  { table: 'settings',    delegate: (c) => c.setting,    note: '键值配置' },
  { table: 'users',       delegate: (c) => c.user,       note: '账户' },
  { table: 'channels',    delegate: (c) => c.channel,    note: '存储渠道（file_copies 的外键）' },
  { table: 'tags',        delegate: (c) => c.tag,        note: '标签（file_tags 的外键）' },
  { table: 'ip_records',  delegate: (c) => c.ipRecord,   note: 'IP 记录' },
  { table: 'api_tokens',  delegate: (c) => c.apiToken,   note: 'API Token' },
  { table: 'files',       delegate: (c) => c.fileRecord, note: '文件记录（file_copies/file_tags 的外键）' },
  { table: 'file_copies', delegate: (c) => c.fileCopy,   note: '渠道副本' },
  { table: 'file_tags',   delegate: (c) => c.fileTag,    note: '文件-标签关联' },
];

const BATCH = 200; // PG 绑定参数上限 65535，files 约 20 列 → 每批 200 行非常安全

async function countAll(client) {
  const out = {};
  for (const t of TABLES) out[t.table] = await t.delegate(client).count();
  return out;
}

async function migrateTable(t) {
  const rows = await t.delegate(sqlite).findMany();
  for (let i = 0; i < rows.length; i += BATCH) {
    await t.delegate(pg).createMany({ data: rows.slice(i, i + BATCH), skipDuplicates: true });
  }
  return rows.length;
}

(async () => {
  console.log(`[migrate-to-pg] dry-run=${DRY_RUN}`);
  const src = await countAll(sqlite);
  const dst = await countAll(pg);
  const total = Object.values(src).reduce((a, b) => a + b, 0);

  console.log('\n  表                SQLite → PostgreSQL');
  for (const t of TABLES) {
    const flag = dst[t.table] > 0 ? `（PG 已有 ${dst[t.table]} 行，skipDuplicates 会跳过重复）` : '';
    console.log(`  ${t.table.padEnd(18)} ${String(src[t.table]).padStart(6)} → ${String(dst[t.table]).padStart(6)}  ${t.note}${flag}`);
  }
  console.log(`  ${'合计'.padEnd(16)} ${String(total).padStart(6)}`);

  if (DRY_RUN) {
    console.log('\n[migrate-to-pg] --dry-run 结束，未写入任何数据。去掉 --dry-run 执行真实迁移。');
    return;
  }

  console.log('\n[migrate-to-pg] 开始迁移…');
  let ok = 0;
  for (const t of TABLES) {
    const n = await migrateTable(t);
    ok += n;
    console.log(`  ✓ ${t.table.padEnd(18)} 写入 ${n} 行`);
  }

  // ---------- 校验 ----------
  const after = await countAll(pg);
  let pass = true;
  console.log('\n  校验（逐表行数比对）');
  for (const t of TABLES) {
    const good = after[t.table] >= src[t.table];
    if (!good) pass = false;
    console.log(`  ${good ? '✓' : '✗'} ${t.table.padEnd(18)} 源 ${src[t.table]} / 目标 ${after[t.table]}`);
  }
  console.log(pass
    ? `\n[migrate-to-pg] 完成：共写入 ${ok} 行，全部通过。接下来按文档 §6.2 切换 DATABASE_URL 与 provider。`
    : '\n[migrate-to-pg] 存在行数不一致，请检查后再切换！');
  process.exit(pass ? 0 : 1);
})().catch((err) => {
  die(err && err.stack ? err.stack : String(err));
});
