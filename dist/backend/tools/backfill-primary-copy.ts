/**
 * backfill-primary-copy.ts —— 一次性回填：把每个文件「最早创建的副本」标记为主副本。
 *
 * 背景（v1.8.0 发现）：主渠道副本创建时从未写 isPrimary（一直是默认 false），
 * 系统各处实际按「第一条副本即主副本」的隐式约定兼容（见 upload.service.ts 的
 * `copies.find(c => c.isPrimary) || copies[0]`）。本脚本把历史数据对齐到 schema 语义。
 *
 * 用法（先停服务）：
 *   node --experimental-strip-types backfill-primary-copy.ts          # 实际回填
 *   node --experimental-strip-types backfill-primary-copy.ts --dry-run  # 只看将改哪些行
 *
 * 规则：按 fileId 分组，取 createdAt 最早的一条置 isPrimary=1；
 *       若同文件已存在 isPrimary=1 则跳过该文件。
 * 依据：主副本 = 上传时嵌套创建的那一条，时间上必然早于异步补写的备份副本。
 */
import { createRequire } from 'node:module';
import path from 'node:path';

// 依赖解析基准：backend/package.json（Prisma Client 装在 backend/node_modules）
const require_ = createRequire(path.resolve(process.cwd(), '..', 'backend', 'package.json'));
const { PrismaClient } = require_('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = await prisma.fileRecord.findMany({
    select: { id: true, copies: { orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true, channelId: true } } },
  });

  let hit = 0, skip = 0, noCopy = 0;
  for (const f of files) {
    if (!f.copies.length) { noCopy += 1; continue; }
    if (f.copies.some((c: { isPrimary?: boolean }) => c.isPrimary)) { skip += 1; continue; }
    const primary = f.copies[0];
    hit += 1;
    console.log(`file=${f.id}  primary-copy=${primary.id}  channel=${primary.channelId}  createdAt=${primary.createdAt.toISOString()}`);
    if (!dryRun) {
      await prisma.fileCopy.update({ where: { id: primary.id }, data: { isPrimary: true } });
    }
  }
  console.log(`\n共 ${files.length} 个文件：回填 ${hit}，已有主标记 ${skip}，无副本 ${noCopy}${dryRun ? '（dry-run 未写入）' : ''}`);
}

main().finally(() => prisma.$disconnect());
