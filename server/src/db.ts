import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// WAL deixa leituras e escritas concorrentes sem "database is locked"/timeouts,
// e busy_timeout faz o SQLite esperar em vez de falhar na hora.
export async function initDatabase() {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
}
