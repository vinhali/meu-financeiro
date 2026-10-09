// Linha de comando do Open Finance. Na VM:
//   docker exec meu-financeiro node dist/src/openfinance/cli.js add <itemId>
//   docker exec meu-financeiro node dist/src/openfinance/cli.js sync
//   docker exec meu-financeiro node dist/src/openfinance/cli.js status
import { prisma } from '../db';
import { PluggyClient, pluggyConfigFromEnv } from './pluggy';
import { connectionIds, syncConnection, SyncResult } from './sync';

function print(r: SyncResult) {
  const s = r.stats;
  console.log(
    `${r.connectionId}: ${r.status} — contas=${s.accounts} transações=${s.transactions} faturas=${s.bills} ` +
      `investimentos=${s.investments} empréstimos=${s.loans}`,
  );
  for (const w of s.warnings) console.log(`  aviso: ${w}`);
  if (r.error) console.log(`  erro: ${r.error}`);
}

async function main(): Promise<number> {
  const [command, arg] = process.argv.slice(2);

  if (command === 'status') {
    const connections = await prisma.ofConnection.findMany({ include: { _count: { select: { accounts: true } } } });
    for (const c of connections) {
      console.log(`${c.id} ${c.connectorName} status=${c.status} contas=${c._count.accounts} últimaSync=${c.lastSyncedAt?.toISOString() ?? '-'}`);
    }
    console.log(`transações=${await prisma.ofTransaction.count()} investimentos=${await prisma.ofInvestment.count()} empréstimos=${await prisma.ofLoan.count()}`);
    return 0;
  }

  const config = pluggyConfigFromEnv();
  if (!config) {
    console.error('Defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.');
    return 1;
  }
  const client = new PluggyClient(config);

  if (command === 'add' && arg) {
    const result = await syncConnection(prisma, client, arg, 'cli');
    print(result);
    return result.status === 'error' ? 1 : 0;
  }

  if (command === 'sync') {
    const ids = await connectionIds(prisma);
    if (ids.length === 0) {
      console.error('Nenhuma conexão registrada. Use: add <itemId>');
      return 1;
    }
    let failed = false;
    for (const id of ids) {
      const result = await syncConnection(prisma, client, id, 'cli');
      print(result);
      failed = failed || result.status === 'error';
    }
    return failed ? 1 : 0;
  }

  console.error('Uso: cli.js add <itemId> | sync | status');
  return 1;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
