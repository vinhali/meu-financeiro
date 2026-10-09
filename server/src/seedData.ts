// Dados de exemplo para o primeiro uso: um plano fictício de seis meses, só para as telas
// nascerem preenchidas. Nenhum valor aqui é real — edite tudo pelo app.
// Os meses são sempre [JUL, AGO, SET, OUT, NOV, DEZ].

export type LineItemSeed = {
  name: string;
  obs: string;
  values: [number, number, number, number, number, number];
  applyDissidio?: boolean;
  excludeFromBridge?: boolean;
};

export const ENTRADAS: LineItemSeed[] = [
  { name: 'Salário', obs: 'líquido', values: [8000, 8000, 8000, 8000, 8000, 8000], applyDissidio: true },
  { name: 'Aux. Home Office', obs: '', values: [300, 300, 300, 300, 300, 300] },
  { name: 'Férias + abono', obs: 'cai no início de julho', values: [6000, 0, 0, 0, 0, 0] },
  { name: '13º salário', obs: '', values: [0, 0, 0, 0, 0, 7000] },
  { name: 'Renda extra', obs: 'meta: ~1.000 por mês', values: [0, 0, 0, 0, 0, 0] },
];

export const SAIDAS: LineItemSeed[] = [
  { name: 'Aluguel', obs: '', values: [2000, 2000, 2000, 2000, 2000, 2000] },
  { name: 'Condomínio', obs: '', values: [300, 300, 300, 300, 300, 300] },
  { name: 'IPTU', obs: '', values: [80, 80, 80, 80, 80, 80] },
  { name: 'Gás', obs: '', values: [40, 40, 40, 40, 40, 40] },
  { name: 'Energia Elétrica', obs: '', values: [200, 200, 200, 200, 200, 200] },
  { name: 'Água', obs: '', values: [60, 60, 60, 60, 60, 60] },
  { name: 'Internet', obs: '', values: [120, 120, 120, 120, 120, 120] },
  { name: 'Alimentação', obs: '', values: [1500, 1500, 1500, 1500, 1500, 1500] },
  { name: 'Empréstimo pessoal', obs: 'débito automático no dia 07', values: [900, 900, 900, 900, 900, 900] },
  { name: 'Financiamento Veicular', obs: '', values: [1100, 1100, 1100, 1100, 1100, 1100] },
  { name: 'Financiamento Estudantil', obs: '', values: [300, 300, 300, 300, 300, 300] },
  { name: 'Nu Bank (fatura)', obs: 'parcelado sem juros — termina em novembro', values: [1200, 800, 800, 800, 800, 0] },
  { name: 'C6 Bank (fatura)', obs: '', values: [600, 0, 0, 0, 0, 0] },
  { name: 'Reserva de emergência 🔒', obs: 'transferir no dia do pagamento', values: [3000, 0, 0, 0, 0, 0] },
  { name: 'Mudança', obs: 'frete + imprevistos', values: [0, 0, 0, 0, 0, 2500], excludeFromBridge: true },
  { name: 'Seguro Veicular', obs: '', values: [250, 250, 250, 250, 250, 250] },
  { name: 'Despesas Sociais', obs: '', values: [500, 500, 500, 500, 500, 500] },
  { name: 'Streaming', obs: '', values: [40, 40, 40, 40, 40, 40] },
  { name: 'Combustível', obs: '', values: [350, 350, 350, 350, 350, 350] },
];

export type DebtSeed = {
  severity: 'sev1' | 'sev2' | 'sev3' | 'sev4';
  severityLabel: string;
  name: string;
  balance: string;
  balanceNote: string;
  installment: string;
  rate: string;
  note: string;
  action: string;
  status: 'ativa' | 'quitada' | 'monitorar';
};

export const DEBTS: DebtSeed[] = [
  {
    severity: 'sev1',
    severityLabel: 'SEV1 · A MAIS CARA · QUITAR PRIMEIRO',
    name: '1 · Rotativo do cartão',
    balance: 'R$ 4.000',
    balanceNote: 'saldo hoje',
    installment: 'mínimo ~R$ 600/mês',
    rate: '12% a.m.',
    note: 'A dívida mais cara do mapa: cada mês parado custa mais do que qualquer outra linha.',
    action: 'Quitar com as férias de julho · conferir a fatura seguinte zerada.',
    status: 'ativa',
  },
  {
    severity: 'sev2',
    severityLabel: 'SEV2 · MONITORAR',
    name: '2 · Financiamento do carro',
    balance: 'R$ 38.000',
    balanceNote: 'saldo · 20/60 pagas',
    installment: '60x R$ 1.100',
    rate: '1,9% a.m.',
    note: 'Parcela pesada, mas com juros abaixo do cartão. Portável para outro banco.',
    action: 'Cotar portabilidade no segundo semestre · comparar o valor de mercado do carro com o saldo.',
    status: 'monitorar',
  },
  {
    severity: 'sev3',
    severityLabel: 'SEV3 · ESTÁVEL',
    name: '3 · Empréstimo pessoal',
    balance: 'R$ 18.000',
    balanceNote: 'quitação',
    installment: '36x R$ 900',
    rate: '2,5% a.m.',
    note: 'Em dia, com débito automático. Candidato a amortização depois que o cartão zerar.',
    action: 'Manter saldo na conta no dia 07 · simular amortização em dezembro com o 13º.',
    status: 'ativa',
  },
  {
    severity: 'sev4',
    severityLabel: 'SEV4 · JURO BAIXO',
    name: '4 · Financiamento estudantil',
    balance: 'R$ 300/mês',
    balanceNote: '',
    installment: 'R$ 300/mês',
    rate: 'juro baixo típico da modalidade',
    note: 'Pequeno, em dia, fora de qualquer reestruturação.',
    action: 'Manter em dia.',
    status: 'ativa',
  },
];

export const MESES = ['JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'] as const;

// Structured content for the editable text sections (Header, Regras,
// Alocação, Mudança). `key` selects which shape applies — see ScenarioText.
export interface HeaderContent {
  eyebrow: string;
  title: string;
  sub: string;
  noteTitle: string;
  note: string;
}

export interface RuleItem {
  id: string;
  text: string;
  hot: boolean;
}

export interface RulesContent {
  eyebrow: string;
  title: string;
  items: RuleItem[];
}

export interface AllocationSlice {
  id: string;
  label: string;
  value: string;
  description: string;
  locked: boolean;
}

export interface AllocationContent {
  eyebrow: string;
  title: string;
  slices: AllocationSlice[];
  noteTitle: string;
  note: string;
}

export interface MudancaItem {
  id: string;
  title: string;
  description: string;
}

export interface MudancaContent {
  eyebrow: string;
  title: string;
  intro: string;
  items: MudancaItem[];
}

export interface ScenarioTexts {
  header: HeaderContent;
  rules: RulesContent;
  allocation: AllocationContent;
  mudanca: MudancaContent;
}

// Textos padrão das seções editáveis, usados quando o cenário ainda não gravou os seus.
export const DEFAULT_TEXTS: ScenarioTexts = {
  header: {
    eyebrow: 'plano de exemplo · seis meses',
    title: 'Plano financeiro — exemplo',
    sub: 'Um plano fictício para mostrar como as telas funcionam: quitar a dívida mais cara, montar uma reserva e provisionar uma mudança em dezembro. Troque os textos e os valores pelos seus.',
    noteTitle: 'Como usar:',
    note: 'edite as linhas da planilha, o mapa de dívidas e estes textos. Conecte os bancos na aba Open Finance para os valores reais entrarem sozinhos.',
  },
  rules: {
    eyebrow: 'regras do plano',
    title: 'Regras que não se negociam',
    items: [
      { id: 'r1', text: 'Nenhum crédito novo enquanto o rotativo do cartão existir.', hot: true },
      { id: 'r2', text: 'A reserva não é caixa. Só sai por emergência real e volta em 60 dias.', hot: true },
      { id: 'r3', text: 'Parcelado sem juros não se antecipa sem desconto.', hot: false },
      { id: 'r4', text: 'Dezembro tem ordem: mudança → reserva → amortizar a dívida mais cara.', hot: false },
      { id: 'r5', text: 'Atualizar a planilha toda segunda — dez minutos.', hot: false },
    ],
  },
  allocation: {
    eyebrow: 'alocação das férias',
    title: 'Para onde vai o dinheiro extra de julho',
    slices: [
      {
        id: 'a1',
        label: '1 · Quitar o rotativo do cartão',
        value: 'R$ 4.000',
        description: 'No mesmo dia em que o dinheiro cair. É a dívida com o juro mais alto do mapa.',
        locked: false,
      },
      {
        id: 'a2',
        label: '2 · Reserva de emergência 🔒',
        value: 'R$ 3.000',
        description: 'Vai para uma aplicação com liquidez diária, fora da conta corrente, no mesmo dia.',
        locked: true,
      },
    ],
    noteTitle: 'Regras da reserva:',
    note: 'emergência = saúde, carro quebrado, perda de renda. Não é emergência: fatura apertada, presente, promoção. Se usar, repor em até 60 dias.',
  },
  mudanca: {
    eyebrow: 'mudança · dezembro',
    title: 'A mudança não é só um custo',
    intro: 'Provisão na planilha: R$ 2.500 em dezembro (frete + imprevistos). Os números que decidem se a mudança ajuda ou atrapalha o plano não são o frete:',
    items: [
      { id: 'm1', title: 'Multa de rescisão do aluguel atual', description: 'confira no contrato a multa proporcional aos meses restantes e o aviso prévio.' },
      { id: 'm2', title: 'Garantia do imóvel novo', description: 'caução, fiador ou seguro-fiança. Uma caução de três aluguéis é dinheiro parado que o plano precisa prever.' },
      { id: 'm3', title: 'O prêmio: aluguel menor', description: 'cada R$ 500 a menos de aluguel são R$ 6.000 por ano a partir de janeiro.' },
      { id: 'm4', title: 'Operacional', description: 'transferir a internet, atualizar o endereço no banco e no seguro, vistoria de saída com fotos.' },
    ],
  },
};
