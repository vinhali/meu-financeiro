import { monthOfLabel } from '../openfinance/budget';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ENTRADAS, SAIDAS, DEFAULT_TEXTS, ScenarioTexts } from '../seedData';

const router = Router();

const TEXT_KEYS = ['header', 'rules', 'allocation', 'mudanca'] as const;
type TextKey = (typeof TEXT_KEYS)[number];

function paymentPeriod(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isMonthlyInstallment(value: string): boolean {
  return /^\s*\d+\s*x\s*(?:R\$\s*)?[\d.,]+/i.test(String(value ?? ''));
}

function installmentTotal(value: string): number | null {
  const match = String(value ?? '').match(/^\s*(\d+)\s*x\s*(?:R\$\s*)?[\d.,]+/i);
  return match ? Number(match[1]) : null;
}

async function advanceMonthlyDebtPayments(scenario: any): Promise<any> {
  const now = new Date();
  const period = paymentPeriod(now);
  if (now.getDate() < 5 || scenario.lastAutoPaymentMonth === period) return scenario;

  await prisma.$transaction(async (tx) => {
    for (const debt of scenario.debts) {
      if (debt.status === 'quitada' || !isMonthlyInstallment(debt.installment)) continue;
      const total = installmentTotal(debt.installment);
      if (total !== null && debt.paidInstallments >= total) continue;
      await tx.debt.update({ where: { id: debt.id }, data: { paidInstallments: { increment: 1 } } });
    }
    await tx.scenario.update({ where: { id: scenario.id }, data: { lastAutoPaymentMonth: period } });
  });

  return prisma.scenario.findUnique({
    where: { id: scenario.id },
    include: { items: { orderBy: itemsOrder }, debts: { orderBy: debtsOrder }, bridge: true },
  });
}

async function getTexts(scenarioId: string): Promise<ScenarioTexts> {
  const rows = await prisma.scenarioText.findMany({ where: { scenarioId } });
  const result = { ...DEFAULT_TEXTS };
  for (const row of rows) {
    if ((TEXT_KEYS as readonly string[]).includes(row.key)) {
      (result as any)[row.key] = JSON.parse(row.content);
    }
  }
  return result;
}

function serializeItem(item: {
  id: string;
  section: string;
  order: number;
  name: string;
  obs: string;
  applyDissidio: boolean;
  excludeFromBridge: boolean;
  controllable: boolean;
  values: string;
  actualValues: string;
}) {
  return {
    id: item.id,
    section: item.section,
    order: item.order,
    name: item.name,
    obs: item.obs,
    applyDissidio: item.applyDissidio,
    excludeFromBridge: item.excludeFromBridge,
    controllable: item.controllable,
    values: JSON.parse(item.values) as number[],
    actualValues: JSON.parse(item.actualValues || '[]') as number[],
  };
}

function serializeDebt(debt: {
  id: string;
  order: number;
  severity: string;
  severityLabel: string;
  name: string;
  balance: string;
  paidInstallments: number;
  balanceNote: string;
  installment: string;
  rate: string;
  note: string;
  action: string;
  status: string;
  dueDay: number | null;
  payments?: any[];
}) {
  return {
    id: debt.id,
    order: debt.order,
    severity: debt.severity,
    severityLabel: debt.severityLabel,
    name: debt.name,
    balance: debt.balance,
    paidInstallments: debt.paidInstallments,
    balanceNote: debt.balanceNote,
    installment: debt.installment,
    rate: debt.rate,
    note: debt.note,
    action: debt.action,
    status: debt.status,
    dueDay: debt.dueDay,
    payments: (debt.payments || []).map((p: any) => ({ id: p.id, debtId: p.debtId, paidAt: p.paidAt, amount: p.amount, installment: p.installment, note: p.note })),
  };
}

const itemsOrder: Prisma.LineItemOrderByWithRelationInput[] = [{ section: 'asc' }, { order: 'asc' }];
const debtsOrder: Prisma.DebtOrderByWithRelationInput = { order: 'asc' };

async function duplicateScenario(sourceId: string, name: string, isBase: boolean) {
  const source = await prisma.scenario.findUnique({
    where: { id: sourceId },
    include: { items: true, debts: { include: { payments: true } }, bridge: true, texts: true },
  });
  if (!source) throw new Error('NOT_FOUND');

  return prisma.$transaction(async (tx) => {
    const scenario = await tx.scenario.create({
      data: { name, isBase, months: source.months, bridgeMonths: source.bridgeMonths, emergencyReserve: source.emergencyReserve, lastAutoPaymentMonth: source.lastAutoPaymentMonth },
    });
    for (const item of source.items) {
      await tx.lineItem.create({
        data: {
          scenarioId: scenario.id,
          section: item.section,
          order: item.order,
          name: item.name,
          obs: item.obs,
          applyDissidio: item.applyDissidio,
          excludeFromBridge: item.excludeFromBridge,
          controllable: item.controllable,
          values: item.values,
          actualValues: item.actualValues,
        },
      });
    }
    for (const debt of source.debts) {
      await tx.debt.create({
        data: {
          scenarioId: scenario.id,
          order: debt.order,
          severity: debt.severity,
          severityLabel: debt.severityLabel,
          name: debt.name,
          balance: debt.balance,
          paidInstallments: debt.paidInstallments,
          balanceNote: debt.balanceNote,
          installment: debt.installment,
          rate: debt.rate,
          note: debt.note,
          action: debt.action,
          status: debt.status,
          dueDay: debt.dueDay,
        },
      });
    }
    await tx.bridge.create({
      data: { scenarioId: scenario.id, plr: source.bridge?.plr ?? 0, dissidioPercent: source.bridge?.dissidioPercent ?? 0 },
    });
    for (const text of source.texts) {
      await tx.scenarioText.create({
        data: { scenarioId: scenario.id, key: text.key, content: text.content },
      });
    }
    return scenario;
  });
}

// GET /api/scenarios - lista todos os cenários
router.get('/', async (_req, res) => {
  const scenarios = await prisma.scenario.findMany({ orderBy: [{ isBase: 'desc' }, { createdAt: 'asc' }] });
  res.json(scenarios);
});

// POST /api/scenarios - cria um novo cenário (a partir do cenário base, ou de duplicateFromId)
router.post('/', async (req, res) => {
  const { name, duplicateFromId } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Nome é obrigatório' });
    return;
  }
  const sourceId = duplicateFromId || (await prisma.scenario.findFirst({ where: { isBase: true } }))?.id;
  if (!sourceId) {
    res.status(500).json({ error: 'Cenário base não encontrado' });
    return;
  }
  try {
    const created = await duplicateScenario(sourceId, name.trim(), false);
    res.status(201).json(created);
  } catch {
    res.status(404).json({ error: 'Cenário de origem não encontrado' });
  }
});

// POST /api/scenarios/import - importa um cenário a partir de um JSON de backup
router.post('/import', async (req, res) => {
  const body = req.body || {};
  const { name, items, debts, bridge, texts, months, bridgeMonths, emergencyReserve } = body;
  if (typeof name !== 'string' || !name.trim() || !Array.isArray(items) || !Array.isArray(debts)) {
    res.status(400).json({ error: 'Arquivo de backup inválido' });
    return;
  }

  const finalMonths: string[] =
    Array.isArray(months) && months.length > 0 && months.every((m: any) => typeof m === 'string' && m.trim())
      ? months
      : ['JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const finalBridgeMonths: string[] =
    Array.isArray(bridgeMonths) && bridgeMonths.length > 0 && bridgeMonths.every((m: any) => typeof m === 'string' && m.trim())
      ? bridgeMonths
      : ['Janeiro/2027', 'Fevereiro/2027', 'Março/2027'];

  let finalName = name.trim();
  let suffix = 1;
  while (await prisma.scenario.findFirst({ where: { name: finalName } })) {
    finalName = `${name.trim()} (importado ${suffix++})`;
  }

  const scenario = await prisma.$transaction(async (tx) => {
    const s = await tx.scenario.create({
      data: {
        name: finalName,
        isBase: false,
        months: JSON.stringify(finalMonths),
        bridgeMonths: JSON.stringify(finalBridgeMonths),
        emergencyReserve: typeof emergencyReserve === 'number' && isFinite(emergencyReserve) ? emergencyReserve : 0,
        lastAutoPaymentMonth: paymentPeriod(),
      },
    });
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const values =
        Array.isArray(item.values) && item.values.length === finalMonths.length
          ? item.values.map((v: any) => (typeof v === 'number' && isFinite(v) ? v : 0))
          : new Array(finalMonths.length).fill(0);
      await tx.lineItem.create({
        data: {
          scenarioId: s.id,
          section: item.section === 'entrada' ? 'entrada' : 'saida',
          order: typeof item.order === 'number' ? item.order : idx,
          name: String(item.name ?? ''),
          obs: String(item.obs ?? ''),
          applyDissidio: !!item.applyDissidio,
          excludeFromBridge: !!item.excludeFromBridge,
          controllable: !!item.controllable,
          values: JSON.stringify(values),
          actualValues: Array.isArray(item.actualValues) && item.actualValues.length === finalMonths.length
            ? JSON.stringify(item.actualValues.map((v: any) => (typeof v === 'number' && isFinite(v) ? v : 0)))
            : JSON.stringify(new Array(finalMonths.length).fill(0)),
        },
      });
    }
    for (let idx = 0; idx < debts.length; idx++) {
      const debt = debts[idx];
      await tx.debt.create({
        data: {
          scenarioId: s.id,
          order: typeof debt.order === 'number' ? debt.order : idx,
          severity: String(debt.severity ?? 'sev4'),
          severityLabel: String(debt.severityLabel ?? ''),
          name: String(debt.name ?? ''),
          balance: String(debt.balance ?? ''),
          paidInstallments: Number.isInteger(debt.paidInstallments) ? Math.max(0, debt.paidInstallments) : 0,
          balanceNote: String(debt.balanceNote ?? ''),
          installment: String(debt.installment ?? ''),
          rate: String(debt.rate ?? ''),
          note: String(debt.note ?? ''),
          action: String(debt.action ?? ''),
          status: String(debt.status ?? 'ativa'),
          dueDay: Number.isInteger(debt.dueDay) && debt.dueDay >= 1 && debt.dueDay <= 31 ? debt.dueDay : null,
        },
      });
    }
    await tx.bridge.create({
      data: {
        scenarioId: s.id,
        plr: typeof bridge?.plr === 'number' && isFinite(bridge.plr) ? bridge.plr : 0,
        dissidioPercent: typeof bridge?.dissidioPercent === 'number' && isFinite(bridge.dissidioPercent) ? bridge.dissidioPercent : 0,
      },
    });
    if (texts && typeof texts === 'object') {
      for (const key of TEXT_KEYS) {
        const content = (texts as any)[key];
        if (content && typeof content === 'object') {
          await tx.scenarioText.create({ data: { scenarioId: s.id, key, content: JSON.stringify(content) } });
        }
      }
    }
    return s;
  });

  res.status(201).json(scenario);
});

// GET /api/scenarios/:id - cenário completo (itens, dívidas, ponte)
router.get('/:id', async (req, res) => {
  let scenario = await prisma.scenario.findUnique({
    where: { id: req.params.id },
    include: { items: { orderBy: itemsOrder }, debts: { orderBy: debtsOrder, include: { payments: { orderBy: { paidAt: 'desc' } } } }, bridge: true },
  });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  scenario = await advanceMonthlyDebtPayments(scenario);
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  res.json({
    scenario: { id: scenario.id, name: scenario.name, isBase: scenario.isBase, createdAt: scenario.createdAt, updatedAt: scenario.updatedAt },
    items: scenario.items.map(serializeItem),
    debts: scenario.debts.map(serializeDebt),
    bridge: scenario.bridge
      ? { plr: scenario.bridge.plr, dissidioPercent: scenario.bridge.dissidioPercent }
      : { plr: 0, dissidioPercent: 0 },
    emergencyReserve: scenario.emergencyReserve,
    texts: await getTexts(scenario.id),
    months: JSON.parse(scenario.months) as string[],
    bridgeMonths: JSON.parse(scenario.bridgeMonths) as string[],
  });
});

// PATCH /api/scenarios/:id - renomear
router.patch('/:id', async (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Nome é obrigatório' });
    return;
  }
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  const updated = await prisma.scenario.update({ where: { id: req.params.id }, data: { name: name.trim() } });
  res.json(updated);
});

// DELETE /api/scenarios/:id - exclui (exceto o cenário base)
router.delete('/:id', async (req, res) => {
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  if (scenario.isBase) {
    res.status(400).json({ error: 'O cenário base não pode ser excluído' });
    return;
  }
  await prisma.scenario.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// POST /api/scenarios/:id/duplicate - duplica o cenário
router.post('/:id/duplicate', async (req, res) => {
  const { name } = req.body || {};
  const source = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!source) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  const newName = (typeof name === 'string' && name.trim()) || `${source.name} (cópia)`;
  const created = await duplicateScenario(source.id, newName, false);
  res.status(201).json(created);
});

// POST /api/scenarios/:id/reset - restaura a projeção original (itens + ponte) deste cenário
router.post('/:id/reset', async (req, res) => {
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }

  const monthsLen = (JSON.parse(scenario.months) as string[]).length;

  await prisma.$transaction(async (tx) => {
    for (const item of scenario.items) {
      const seedList = item.section === 'entrada' ? ENTRADAS : SAIDAS;
      const seed = seedList.find((s) => s.name === item.name);
      if (seed) {
        let values: number[] = [...seed.values];
        if (values.length > monthsLen) values = values.slice(0, monthsLen);
        else while (values.length < monthsLen) values.push(0);
        await tx.lineItem.update({
          where: { id: item.id },
          data: {
            values: JSON.stringify(values),
            actualValues: JSON.stringify(new Array(monthsLen).fill(0)),
            obs: seed.obs,
            applyDissidio: !!seed.applyDissidio,
            excludeFromBridge: !!seed.excludeFromBridge,
            controllable: false,
          },
        });
      }
    }
    await tx.bridge.upsert({
      where: { scenarioId: scenario.id },
      update: { plr: 0, dissidioPercent: 0 },
      create: { scenarioId: scenario.id, plr: 0, dissidioPercent: 0 },
    });
  });

  res.json({ ok: true });
});

// PUT /api/scenarios/:id/items - atualização em lote das linhas da grade
router.put('/:id/items', async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'items deve ser um array' });
    return;
  }
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  const monthsLen = (JSON.parse(scenario.months) as string[]).length;

  try {
    await prisma.$transaction(
      items.map((it: any) => {
        if (!it.id || !Array.isArray(it.values) || it.values.length !== monthsLen) {
          throw new Error('INVALID_ITEM');
        }
        const values = it.values.map((v: any) => (typeof v === 'number' && isFinite(v) ? v : 0));
        const actualValues = Array.isArray(it.actualValues) && it.actualValues.length === monthsLen
          ? it.actualValues.map((v: any) => (typeof v === 'number' && isFinite(v) ? v : 0))
          : new Array(monthsLen).fill(0);
        return prisma.lineItem.update({
          where: { id: it.id },
          data: {
            section: it.section === 'entrada' ? 'entrada' : 'saida',
            order: typeof it.order === 'number' ? it.order : 0,
            name: String(it.name ?? ''),
            obs: String(it.obs ?? ''),
            applyDissidio: !!it.applyDissidio,
            excludeFromBridge: !!it.excludeFromBridge,
            controllable: !!it.controllable,
            values: JSON.stringify(values),
            actualValues: JSON.stringify(actualValues),
          },
        });
      })
    );
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Itens inválidos' });
  }
});

// POST /api/scenarios/:id/items - cria uma nova categoria (linha) na grade
router.post('/:id/items', async (req, res) => {
  const { section } = req.body || {};
  if (section !== 'entrada' && section !== 'saida') {
    res.status(400).json({ error: 'section deve ser "entrada" ou "saida"' });
    return;
  }
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }

  const last = await prisma.lineItem.findFirst({
    where: { scenarioId: scenario.id, section },
    orderBy: { order: 'desc' },
  });
  const monthsLen = (JSON.parse(scenario.months) as string[]).length;

  const created = await prisma.lineItem.create({
    data: {
      scenarioId: scenario.id,
      section,
      order: (last?.order ?? -1) + 1,
      name: 'Nova categoria',
      obs: '',
      applyDissidio: false,
      excludeFromBridge: false,
      controllable: false,
      values: JSON.stringify(new Array(monthsLen).fill(0)),
      actualValues: JSON.stringify(new Array(monthsLen).fill(0)),
    },
  });

  res.status(201).json(serializeItem(created));
});

// DELETE /api/scenarios/:id/items/:itemId - remove uma categoria (linha) da grade
router.delete('/:id/items/:itemId', async (req, res) => {
  const item = await prisma.lineItem.findUnique({ where: { id: req.params.itemId } });
  if (!item || item.scenarioId !== req.params.id) {
    res.status(404).json({ error: 'Item não encontrado' });
    return;
  }
  await prisma.lineItem.delete({ where: { id: item.id } });
  res.json({ ok: true });
});

function isNonEmptyStringArray(v: any): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((m) => typeof m === 'string' && m.trim());
}

// PUT /api/scenarios/:id/months - renomeia/redimensiona os meses da planilha.
// `removeIndex` permite remover qualquer coluna e o mesmo índice dos valores.
router.put('/:id/months', async (req, res) => {
  const { months, removeIndex, copyFromIndex, shownTotals } = req.body || {};
  if (!isNonEmptyStringArray(months)) {
    res.status(400).json({ error: 'months deve ser um array de strings não vazias' });
    return;
  }
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  const oldLen = (JSON.parse(scenario.months) as string[]).length;
  const newLen = months.length;
  if (removeIndex !== undefined && (!Number.isInteger(removeIndex) || removeIndex < 0 || removeIndex >= oldLen || newLen !== oldLen - 1)) {
    res.status(400).json({ error: 'removeIndex inválido para a quantidade atual de meses' });
    return;
  }
  if (copyFromIndex !== undefined && (removeIndex !== undefined || !Number.isInteger(copyFromIndex) || copyFromIndex < 0 || copyFromIndex >= oldLen || newLen <= oldLen)) {
    res.status(400).json({ error: 'copyFromIndex inválido para a quantidade atual de meses' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Tirar um mês da planilha não apaga nada: a coluna vai para o histórico antes de sair.
    if (removeIndex !== undefined) {
      const label = (JSON.parse(scenario.months) as string[])[removeIndex] ?? '';
      await tx.monthArchive.create({
        data: {
          scenarioId: scenario.id,
          label,
          month: monthOfLabel(label, new Date()),
          position: removeIndex,
          totals: validTotals(shownTotals) ? JSON.stringify(shownTotals) : null,
          rows: JSON.stringify(
            scenario.items.map((item) => ({
              itemId: item.id,
              name: item.name,
              section: item.section,
              order: item.order,
              controllable: item.controllable,
              value: (JSON.parse(item.values) as number[])[removeIndex] ?? 0,
              actualValue: (JSON.parse(item.actualValues || '[]') as number[])[removeIndex] ?? 0,
            })),
          ),
        },
      });
    }
    if (newLen !== oldLen) {
      for (const item of scenario.items) {
        let values = JSON.parse(item.values) as number[];
        let actualValues = JSON.parse(item.actualValues || '[]') as number[];
        while (actualValues.length < oldLen) actualValues.push(0);
        if (removeIndex !== undefined) { values.splice(removeIndex, 1); actualValues.splice(removeIndex, 1); }
        else if (newLen > oldLen) {
          const copyValue = copyFromIndex === undefined ? 0 : values[copyFromIndex];
          values = [...values, ...new Array(newLen - oldLen).fill(copyValue)];
          actualValues = [...actualValues, ...new Array(newLen - oldLen).fill(copyFromIndex === undefined ? 0 : actualValues[copyFromIndex])];
        }
        else { values = values.slice(0, newLen); actualValues = actualValues.slice(0, newLen); }
        await tx.lineItem.update({ where: { id: item.id }, data: { values: JSON.stringify(values), actualValues: JSON.stringify(actualValues) } });
      }
    }
    await tx.scenario.update({ where: { id: scenario.id }, data: { months: JSON.stringify(months) } });
  });

  res.json({ ok: true });
});

type ArchiveTotals = { entradas: number; saidas: number; saldo: number };
const validTotals = (v: unknown): v is ArchiveTotals =>
  typeof v === 'object' && v !== null && ['entradas', 'saidas', 'saldo'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number' && Number.isFinite((v as Record<string, number>)[k]));

type ArchivedRow = { itemId: string; name: string; section: string; order: number; controllable: boolean; value: number; actualValue: number };
const archiveTotals = (rows: ArchivedRow[]) => {
  const sum = (section: string) => Math.round(rows.filter((r) => r.section === section).reduce((total, r) => total + (r.value || 0), 0) * 100) / 100;
  const entradas = sum('entrada');
  const saidas = Math.round((rows.reduce((total, r) => total + (r.value || 0), 0) - entradas) * 100) / 100;
  return { entradas, saidas, saldo: Math.round((entradas - saidas) * 100) / 100 };
};

// GET /api/scenarios/:id/archives - meses retirados da planilha, do mais recente para o mais antigo
router.get('/:id/archives', async (req, res) => {
  const archives = await prisma.monthArchive.findMany({ where: { scenarioId: req.params.id }, orderBy: { archivedAt: 'desc' } });
  res.json(
    archives.map((a) => {
      const rows = JSON.parse(a.rows) as ArchivedRow[];
      // `totals`: o que a planilha mostrava (sem contar duas vezes o que estava nas faturas);
      // `typed`: a soma simples dos valores digitados.
      return {
        id: a.id,
        label: a.label,
        month: a.month,
        archivedAt: a.archivedAt,
        totals: a.totals ? (JSON.parse(a.totals) as ArchiveTotals) : null,
        typed: archiveTotals(rows),
        rows: rows.map((r) => ({ name: r.name, section: r.section, value: r.value })),
      };
    }),
  );
});

// POST /api/scenarios/:id/archives/:archiveId/restore - devolve um mês do histórico para a planilha
router.post('/:id/archives/:archiveId/restore', async (req, res) => {
  const archive = await prisma.monthArchive.findFirst({ where: { id: req.params.archiveId, scenarioId: req.params.id } });
  const scenario = archive ? await prisma.scenario.findUnique({ where: { id: req.params.id }, include: { items: true } }) : null;
  if (!archive || !scenario) {
    res.status(404).json({ error: 'Mês arquivado não encontrado' });
    return;
  }
  const months = JSON.parse(scenario.months) as string[];
  const rows = JSON.parse(archive.rows) as ArchivedRow[];
  const at = Math.min(Math.max(archive.position, 0), months.length);
  await prisma.$transaction(async (tx) => {
    for (const item of scenario.items) {
      // Linha que existia quando o mês foi arquivado recebe o valor de volta; linha criada depois entra com zero.
      const saved = rows.find((r) => r.itemId === item.id);
      const values = JSON.parse(item.values) as number[];
      const actualValues = JSON.parse(item.actualValues || '[]') as number[];
      while (values.length < months.length) values.push(0);
      while (actualValues.length < months.length) actualValues.push(0);
      values.splice(at, 0, saved?.value ?? 0);
      actualValues.splice(at, 0, saved?.actualValue ?? 0);
      await tx.lineItem.update({ where: { id: item.id }, data: { values: JSON.stringify(values), actualValues: JSON.stringify(actualValues) } });
    }
    months.splice(at, 0, archive.label);
    await tx.scenario.update({ where: { id: scenario.id }, data: { months: JSON.stringify(months) } });
    await tx.monthArchive.delete({ where: { id: archive.id } });
  });
  // Linhas que existiam no mês arquivado e foram apagadas depois não têm para onde voltar.
  const missing = rows.filter((r) => (r.value || 0) !== 0 && !scenario.items.some((item) => item.id === r.itemId)).map((r) => ({ name: r.name, value: r.value }));
  res.json({ ok: true, missing });
});

// PUT /api/scenarios/:id/bridge-months - renomeia/redimensiona os meses da
// "Ponte até PLR". Não afeta os valores da planilha.
router.put('/:id/bridge-months', async (req, res) => {
  const { bridgeMonths } = req.body || {};
  if (!isNonEmptyStringArray(bridgeMonths)) {
    res.status(400).json({ error: 'bridgeMonths deve ser um array de strings não vazias' });
    return;
  }
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  await prisma.scenario.update({ where: { id: scenario.id }, data: { bridgeMonths: JSON.stringify(bridgeMonths) } });
  res.json({ ok: true });
});

// PUT /api/scenarios/:id/texts/:key - atualiza o conteúdo de uma seção de texto editável
router.put('/:id/texts/:key', async (req, res) => {
  const key = req.params.key as TextKey;
  if (!(TEXT_KEYS as readonly string[]).includes(key)) {
    res.status(400).json({ error: 'key inválida' });
    return;
  }
  const content = req.body;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    res.status(400).json({ error: 'Conteúdo inválido' });
    return;
  }
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  await prisma.scenarioText.upsert({
    where: { scenarioId_key: { scenarioId: scenario.id, key } },
    update: { content: JSON.stringify(content) },
    create: { scenarioId: scenario.id, key, content: JSON.stringify(content) },
  });
  res.json({ ok: true });
});

// PUT /api/scenarios/:id/debts - atualização em lote dos cards de dívida
router.put('/:id/debts', async (req, res) => {
  const { debts } = req.body || {};
  if (!Array.isArray(debts)) {
    res.status(400).json({ error: 'debts deve ser um array' });
    return;
  }
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }

  try {
    await prisma.$transaction(
      debts.map((d: any) => {
        if (!d.id) throw new Error('INVALID_DEBT');
        return prisma.debt.update({
          where: { id: d.id },
          data: {
            name: String(d.name ?? ''),
            severity: String(d.severity ?? 'sev4'),
            severityLabel: String(d.severityLabel ?? ''),
            balance: String(d.balance ?? ''),
            paidInstallments: Number.isInteger(d.paidInstallments) ? Math.max(0, d.paidInstallments) : 0,
            balanceNote: String(d.balanceNote ?? ''),
            installment: String(d.installment ?? ''),
            rate: String(d.rate ?? ''),
            note: String(d.note ?? ''),
            action: String(d.action ?? ''),
            status: String(d.status ?? 'ativa'),
            dueDay: Number.isInteger(d.dueDay) && d.dueDay >= 1 && d.dueDay <= 31 ? d.dueDay : null,
          },
        });
      })
    );
    if (new Date().getDate() >= 5) {
      await prisma.scenario.update({ where: { id: scenario.id }, data: { lastAutoPaymentMonth: paymentPeriod() } });
    }
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Dívidas inválidas' });
  }
});

// POST /api/scenarios/:id/debts - cria uma nova dívida
router.post('/:id/debts', async (req, res) => {
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }

  const last = await prisma.debt.findFirst({
    where: { scenarioId: scenario.id },
    orderBy: { order: 'desc' },
  });

  const created = await prisma.debt.create({
    data: {
      scenarioId: scenario.id,
      order: (last?.order ?? -1) + 1,
      severity: 'sev4',
      severityLabel: '',
      name: 'Nova dívida',
      balance: '',
      paidInstallments: 0,
      status: 'ativa',
      dueDay: null,
    },
  });

  res.status(201).json(serializeDebt(created));
});

// DELETE /api/scenarios/:id/debts/:debtId - remove uma dívida
router.delete('/:id/debts/:debtId', async (req, res) => {
  const debt = await prisma.debt.findUnique({ where: { id: req.params.debtId } });
  if (!debt || debt.scenarioId !== req.params.id) {
    res.status(404).json({ error: 'Dívida não encontrada' });
    return;
  }
  await prisma.debt.delete({ where: { id: debt.id } });
  res.json({ ok: true });
});

// POST /api/scenarios/:id/debts/:debtId/payments - registra pagamento confirmado
router.post('/:id/debts/:debtId/payments', async (req, res) => {
  const debt = await prisma.debt.findUnique({ where: { id: req.params.debtId } });
  if (!debt || debt.scenarioId !== req.params.id) {
    res.status(404).json({ error: 'Dívida não encontrada' });
    return;
  }
  const { paidAt, amount, installment, note } = req.body || {};
  const date = new Date(String(paidAt || ''));
  if (!Number.isFinite(date.getTime()) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'Data e valor do pagamento são obrigatórios' });
    return;
  }
  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.debtPayment.create({
      data: {
        debtId: debt.id,
        paidAt: date,
        amount,
        installment: Number.isInteger(installment) && installment > 0 ? installment : null,
        note: String(note ?? ''),
      },
    });
    await tx.debt.update({ where: { id: debt.id }, data: { paidInstallments: { increment: 1 } } });
    await tx.scenario.update({ where: { id: debt.scenarioId }, data: { lastAutoPaymentMonth: paymentPeriod(date) } });
    return created;
  });
  res.status(201).json({ id: payment.id, debtId: payment.debtId, paidAt: payment.paidAt, amount: payment.amount, installment: payment.installment, note: payment.note });
});

router.delete('/:id/debts/:debtId/payments/:paymentId', async (req, res) => {
  const payment = await prisma.debtPayment.findUnique({ where: { id: req.params.paymentId }, include: { debt: true } });
  if (!payment || payment.debt.scenarioId !== req.params.id || payment.debtId !== req.params.debtId) {
    res.status(404).json({ error: 'Pagamento não encontrado' });
    return;
  }
  await prisma.debtPayment.delete({ where: { id: payment.id } });
  res.json({ ok: true });
});

// PUT /api/scenarios/:id/bridge - atualiza PLR e dissídio da "Ponte até PLR"
router.put('/:id/bridge', async (req, res) => {
  const { plr, dissidioPercent } = req.body || {};
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  const data = {
    plr: typeof plr === 'number' && isFinite(plr) ? plr : 0,
    dissidioPercent: typeof dissidioPercent === 'number' && isFinite(dissidioPercent) ? dissidioPercent : 0,
  };
  await prisma.bridge.upsert({
    where: { scenarioId: scenario.id },
    update: data,
    create: { scenarioId: scenario.id, ...data },
  });
  res.json({ ok: true });
});

// PUT /api/scenarios/:id/reserve - atualiza o total guardado na reserva de emergência
router.put('/:id/reserve', async (req, res) => {
  const { emergencyReserve } = req.body || {};
  const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  const value = typeof emergencyReserve === 'number' && isFinite(emergencyReserve) ? emergencyReserve : 0;
  await prisma.scenario.update({ where: { id: scenario.id }, data: { emergencyReserve: value } });
  res.json({ ok: true });
});

// GET /api/scenarios/:id/export - baixa o cenário completo em JSON
router.get('/:id/export', async (req, res) => {
  const scenario = await prisma.scenario.findUnique({
    where: { id: req.params.id },
    include: { items: { orderBy: itemsOrder }, debts: { orderBy: debtsOrder, include: { payments: { orderBy: { paidAt: 'desc' } } } }, bridge: true },
  });
  if (!scenario) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    name: scenario.name,
    items: scenario.items.map(serializeItem),
    debts: scenario.debts.map(serializeDebt),
    bridge: scenario.bridge
      ? { plr: scenario.bridge.plr, dissidioPercent: scenario.bridge.dissidioPercent }
      : { plr: 0, dissidioPercent: 0 },
    emergencyReserve: scenario.emergencyReserve,
    texts: await getTexts(scenario.id),
    months: JSON.parse(scenario.months) as string[],
    bridgeMonths: JSON.parse(scenario.bridgeMonths) as string[],
  };
  const safeName = scenario.name.replace(/[^a-z0-9-_]+/gi, '_');
  res.setHeader('Content-Disposition', `attachment; filename="meu-financeiro_${safeName}.json"`);
  res.json(payload);
});

export default router;
