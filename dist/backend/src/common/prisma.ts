import { PrismaClient } from '@prisma/client';

/** 全局单例 PrismaClient（dev 热重载防连接泄漏） */
const globalForPrisma = globalThis as unknown as { __goimgbedPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__goimgbedPrisma ?? (globalForPrisma.__goimgbedPrisma = new PrismaClient());
