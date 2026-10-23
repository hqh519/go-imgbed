const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.fileRecord.groupBy({ by: ['uploader'], _count: { _all: true } });
  console.log('uploader 分布:', JSON.stringify(rows.map(r => ({ uploader: r.uploader, n: r._count._all }))));
  const users = await prisma.user.findMany({ select: { username: true, role: true }, take: 20 });
  console.log('users 表:', JSON.stringify(users));
  // 每个 uploader 的 note 情况
  const notes = await prisma.fileRecord.findMany({ where: { note: { not: '' } }, select: { name: true, note: true, uploader: true } });
  console.log('非空 note:', JSON.stringify(notes));
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
