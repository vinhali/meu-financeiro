import { PrismaClient } from '@prisma/client';
import { ENTRADAS, SAIDAS, DEBTS } from '../src/seedData';

const prisma = new PrismaClient();

async function createScenario(name: string, isBase: boolean, rendaExtraOverride?: [number, number, number, number, number, number]) {
  const scenario = await prisma.scenario.create({
    data: { name, isBase },
  });

  let order = 0;
  for (const item of ENTRADAS) {
    const values = item.name === 'Renda extra' && rendaExtraOverride ? rendaExtraOverride : item.values;
    await prisma.lineItem.create({
      data: {
        scenarioId: scenario.id,
        section: 'entrada',
        order: order++,
        name: item.name,
        obs: item.obs,
        applyDissidio: !!item.applyDissidio,
        excludeFromBridge: !!item.excludeFromBridge,
        values: JSON.stringify(values),
      },
    });
  }

  order = 0;
  for (const item of SAIDAS) {
    await prisma.lineItem.create({
      data: {
        scenarioId: scenario.id,
        section: 'saida',
        order: order++,
        name: item.name,
        obs: item.obs,
        applyDissidio: !!item.applyDissidio,
        excludeFromBridge: !!item.excludeFromBridge,
        values: JSON.stringify(item.values),
      },
    });
  }

  order = 0;
  for (const debt of DEBTS) {
    await prisma.debt.create({
      data: {
        scenarioId: scenario.id,
        order: order++,
        severity: debt.severity,
        severityLabel: debt.severityLabel,
        name: debt.name,
        balance: debt.balance,
        balanceNote: debt.balanceNote,
        installment: debt.installment,
        rate: debt.rate,
        note: debt.note,
        action: debt.action,
        status: debt.status,
      },
    });
  }

  await prisma.bridge.create({
    data: { scenarioId: scenario.id, plr: 0, dissidioPercent: 0 },
  });

  return scenario;
}

async function main() {
  const existing = await prisma.scenario.count();
  if (existing > 0) {
    console.log(`Já existem ${existing} cenário(s) — seed ignorado.`);
    return;
  }

  // Cenário base, com os dados de exemplo de seedData.ts. Não pode ser excluído
  // e é a fonte usada por "Restaurar projeção original".
  await createScenario('Plano base', true);

  // Cópia do cenário base para explorar uma alocação mais conservadora.
  await createScenario('Conservador', false);

  // Idêntico ao base: a linha "Renda extra" já é zero por padrão.
  await createScenario('Sem renda extra', false);

  // Mesmo cenário base, mas com a linha "Renda extra" preenchida com o valor
  // que o próprio plano aponta como meta (KPI "Renda extra p/ fechar" ~R$1.400/mês)
  // aplicado em SET/OUT/NOV — os meses apontados como críticos no plano original.
  await createScenario('Com renda extra', false, [0, 0, 1400, 1400, 1400, 0]);

  console.log('Seed concluído: 4 cenários criados.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
