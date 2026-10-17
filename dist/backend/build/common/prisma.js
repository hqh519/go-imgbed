"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.__goimgbedPrisma ?? (globalForPrisma.__goimgbedPrisma = new client_1.PrismaClient());
