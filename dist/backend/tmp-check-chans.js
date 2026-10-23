const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const chans = await prisma.channel.findMany({
    select: { id: true, code: true, name: true, type: true, enabled: true, isMain: true, isBackup: true, authorizedUsers: true },
    orderBy: [{ typeCode: 'asc' }, { code: 'asc' }],
  });
  console.log(JSON.stringify(chans, null, 1));
  const users = await prisma.user.findMany();
  console.log('users:', JSON.stringify(users.map(u => ({ username: u.username, role: u.role, enabled: u.enabled }))));
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
