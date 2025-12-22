// src/lib/db.ts
// Prisma Client 싱글톤 패턴 (Next.js 환경 최적화)

import { PrismaClient } from '@prisma/client';

const globalForPrisma = PrismaClient;

export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;


