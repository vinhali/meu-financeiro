// Identificação de estabelecimentos: transforma a descrição crua da fatura
// ("IYZICO *VPSDIME.C", "MICROSOFT DO BRASIL IMPORTACAO E COMERCIO DE ...") em um nome
// legível, diz o que aquilo é e, quando a categoria do Open Finance é vaga, corrige-a.
//
// Ordem de precedência: rótulo definido pelo usuário > marcas conhecidas > palavras do nome > nome arrumado.

export interface MerchantLabel {
  name: string;
  kind: string | null; // o que é, em poucas palavras ("academia", "seguro do carro")
}

export interface UserLabel {
  name: string | null;
  kind: string | null;
  // Categoria escolhida pelo usuário (id de CATEGORY_CHOICES).
  category?: string | null;
}

// Categorias que o usuário pode dar a um estabelecimento: [id da família, subcategoria].
export const CATEGORY_CHOICES: Record<string, { label: string; category: [string, string] }> = {
  mercado: { label: 'Mercado', category: ['10', 'Mercado'] },
  delivery: { label: 'Delivery', category: ['11', 'Delivery'] },
  restaurante: { label: 'Restaurantes e bares', category: ['11', 'Restaurantes'] },
  lazer: { label: 'Lazer', category: ['21', 'Lazer'] },
  combustivel: { label: 'Combustível', category: ['19', 'Combustível'] },
  pedagio: { label: 'Pedágio', category: ['19', 'Pedágio'] },
  estacionamento: { label: 'Estacionamento', category: ['19', 'Estacionamento'] },
  transporte: { label: 'Táxi e apps', category: ['19', 'Táxi e apps'] },
  farmacia: { label: 'Farmácia', category: ['18', 'Farmácia'] },
  saude: { label: 'Saúde', category: ['18', 'Saúde'] },
  pet: { label: 'Pet', category: ['08', 'Pet'] },
  compras: { label: 'Compras em geral', category: ['08', 'Compras em geral'] },
  assinaturas: { label: 'Apps e assinaturas', category: ['09', 'Apps e assinaturas'] },
  viagem: { label: 'Viagem', category: ['12', 'Viagem'] },
  moradia: { label: 'Casa', category: ['17', 'Moradia'] },
  outros: { label: 'Outros serviços', category: ['07', 'Serviços'] },
};

interface Brand {
  match: RegExp; // testado contra a chave do estabelecimento (maiúsculas, sem sufixo de parcela)
  name: string;
  kind: string;
  // Categoria corrigida: [id da família, subcategoria]. Sem isto, vale a do Open Finance.
  category?: [string, string];
}

const BRANDS: Brand[] = [
  // Saúde e bem-estar
  { match: /TOTAL\s*PASS/, name: 'TotalPass', kind: 'academia', category: ['18', 'Academia'] },
  { match: /GYMPASS|WELLHUB/, name: 'Wellhub (Gympass)', kind: 'academia', category: ['18', 'Academia'] },
  { match: /SMART\s*FIT|BLUEFIT|BODYTECH|SELFIT/, name: '', kind: 'academia', category: ['18', 'Academia'] },
  { match: /DROGASIL|DROGA\s*RAIA|RAIA\s*DROGASIL|PAGUE\s*MENOS|DROGARIA|FARMACIA|PANVEL|ULTRAFARMA/, name: '', kind: 'farmácia', category: ['18', 'Farmácia'] },
  // Inteligência artificial e software
  { match: /ANTHROPIC|CLAUDE/, name: 'Claude (Anthropic)', kind: 'assistente de IA', category: ['09', 'Inteligência artificial'] },
  { match: /OPENAI|CHATGPT/, name: 'ChatGPT (OpenAI)', kind: 'assistente de IA', category: ['09', 'Inteligência artificial'] },
  { match: /CURSOR|GITHUB|JETBRAINS|VECTORIZER|MIDJOURNEY|ELEVENLABS/, name: '', kind: 'software', category: ['09', 'Software'] },
  { match: /VPSDIME/, name: 'VPSDime', kind: 'servidor e hospedagem', category: ['09', 'Servidores e hospedagem'] },
  { match: /HETZNER|DIGITALOCEAN|CONTABO|HOSTINGER|LOCAWEB|GODADDY|NAMECHEAP|CLOUDFLARE|AWS|AMAZON WEB/, name: '', kind: 'servidor e hospedagem', category: ['09', 'Servidores e hospedagem'] },
  { match: /MICROSOFT/, name: 'Microsoft', kind: 'software e assinaturas', category: ['09', 'Software'] },
  // Streaming e assinaturas digitais
  { match: /YOUTUBE/, name: 'YouTube Premium', kind: 'streaming', category: ['09', 'Streaming'] },
  { match: /NETFLIX/, name: 'Netflix', kind: 'streaming', category: ['09', 'Streaming'] },
  { match: /SPOTIFY/, name: 'Spotify', kind: 'streaming', category: ['09', 'Streaming'] },
  { match: /DISNEY/, name: 'Disney+', kind: 'streaming', category: ['09', 'Streaming'] },
  { match: /HBO|\bMAX\b/, name: 'Max', kind: 'streaming', category: ['09', 'Streaming'] },
  { match: /PRIME\s*VIDEO|AMAZON\s*PRIME|AMAZONPRIME/, name: 'Amazon Prime', kind: 'streaming', category: ['09', 'Streaming'] },
  { match: /GLOBOPLAY|PARAMOUNT|DEEZER|CRUNCHYROLL|APPLE\s*TV/, name: '', kind: 'streaming', category: ['09', 'Streaming'] },
  { match: /APPLE\.COM|APPLE\s*BILL/, name: 'Apple', kind: 'apps e assinaturas', category: ['09', 'Apps e assinaturas'] },
  { match: /GOOGLE\s*(ONE|G1)/, name: 'Google One', kind: 'armazenamento', category: ['09', 'Apps e assinaturas'] },
  { match: /^GOOGLE/, name: 'Google', kind: 'apps e assinaturas', category: ['09', 'Apps e assinaturas'] },
  // Alimentação
  { match: /IFOOD.*CLUB|IFD\*IFOOD CLUB|IFOOD\.COM AGENCIA/, name: 'iFood Clube', kind: 'assinatura de delivery', category: ['11', 'Delivery'] },
  { match: /IFOOD|^IFD\*|RAPPI|ZE DELIVERY|AIQFOME/, name: '', kind: 'delivery', category: ['11', 'Delivery'] },
  // Transporte
  { match: /UBER\s*EATS/, name: 'Uber Eats', kind: 'delivery', category: ['11', 'Delivery'] },
  { match: /UBER|UBR\*|99\s*APP|99\s*POP|^99\s?\*|CABIFY/, name: '', kind: 'táxi e apps', category: ['19', 'Táxi e apps'] },
  { match: /NUTAG/, name: 'NuTag', kind: 'pedágio e tag', category: ['19', 'Pedágio'] },
  { match: /SEM\s*PARAR|CONECTCAR|VELOE|TAGGY/, name: '', kind: 'pedágio e tag', category: ['19', 'Pedágio'] },
  { match: /\bPOSTO\b|AUTO\s*POSTO|SHELL|IPIRANGA|PETROBRAS|\bBR\s*MANIA/, name: '', kind: 'combustível', category: ['19', 'Combustível'] },
  { match: /WEBMOTORS/, name: 'Webmotors', kind: 'automotivo', category: ['19', 'Automotivo'] },
  // Compras
  { match: /MERCADO\s*LIVRE|MERCADOLIVRE|MERCADO\*|MERCADOLI|\bMELI\b/, name: 'Mercado Livre', kind: 'compras online', category: ['08', 'Compras online'] },
  { match: /AMAZON|AMZN/, name: 'Amazon', kind: 'compras online', category: ['08', 'Compras online'] },
  { match: /SHOPEE|ALIEXPRESS|SHEIN|MAGALU|MAGAZINE\s*LUIZA|AMERICANAS|KABUM/, name: '', kind: 'compras online', category: ['08', 'Compras online'] },
  { match: /PETZ|COBASI|PETLOVE/, name: '', kind: 'pet', category: ['08', 'Pet'] },
  // Viagem
  { match: /BOOKING|AIRBNB|HOTEIS\.COM|EXPEDIA|DECOLAR/, name: '', kind: 'hospedagem', category: ['12', 'Hospedagem'] },
  { match: /LATAM|\bGOL\b|\bAZUL\b|AIR\s*EUROPA|\bTAP\b|IBERIA|AMERICAN\s*AIR/, name: '', kind: 'passagem aérea', category: ['12', 'Passagens aéreas'] },
  { match: /GETYOURGUIDE|CIVITATIS|VIATOR/, name: '', kind: 'passeios', category: ['12', 'Passeios'] },
  // Financeiro
  { match: /PAGAMENTO DE PIX|PIX NO CR[EÉ]DITO/, name: 'Pix no crédito', kind: 'transferência paga com o cartão', category: ['05', 'Pix no crédito'] },
  { match: /^PICPAY\*/, name: '', kind: 'transferência paga com o cartão', category: ['05', 'Pix no crédito'] },
  { match: /SEGURO|SEGUROS|PORTO\s*SEG|\bAZUL SEG/, name: '', kind: 'seguro', category: ['20', 'Seguros'] },
  { match: /PAYPAL/, name: 'PayPal', kind: 'pagamento intermediado', category: undefined },
  // Palavras do próprio nome, quando nenhuma marca acima casou. O banco costuma jogar mercado,
  // padaria e restaurante no mesmo saco ("alimentação"); o nome separa melhor. Ficam por último
  // de propósito: "MERCADO LIVRE" e "MERCADO PAGO" já foram resolvidos antes.
  {
    match: /SUPERMERC|HIPERMERC|MERCADO|MERCEARIA|MERCADINHO|ATACAD|HORTIFRUT|SACOLAO|QUITANDA|ACOUGUE|CASA DE CARNES|PADARIA|PANIFICADORA|EMPORIO|CARREFOUR|ASSAI|PAO DE ACUCAR|SAVEGNAGO|\bTENDA\b|\bOXXO\b|\bSAMS CLUB/,
    name: '',
    kind: 'mercado',
    category: ['10', 'Mercado'],
  },
  {
    match: /RESTAUR|PIZZ|SUSHI|TEMAKI|BURGER|HAMBURG|LANCH|CHURRASC|ESPETINHO|\bBAR\b|BOTECO|CERVEJ|CHOPP|\bPUB\b|\bCAFE\b|CAFETERIA|SORVET|GELAT|\bACAI\b|MC\s*DONALD|ARCOS DOURADOS|SUBWAY|OUTBACK|HABIB|SPOLETO|PASTEL/,
    name: '',
    kind: 'restaurante',
    category: ['11', 'Restaurantes'],
  },
];

// Prefixos de adquirentes/intermediadores que não dizem nada sobre a compra.
const PROCESSOR_PREFIX = /^(PAG|MP|PG|EC|IFD|SUM|PPRO|IYZICO|CLV|DL|APMX|EBN|HTM|ZP|PAYU|EBANX|DLOCAL|STRIPE|SUMUP|INFINITEPAY|TON|CIELO|STONE)\s*\*\s*/;
// Razão social não ajuda a reconhecer o estabelecimento.
const LEGAL_SUFFIX =
  /\s+(DO BRASIL\b.*|BRASIL (LTDA|S\.?A\.?).*|INSTITUI[CÇ][AÃ]O DE PAGAMENTO.*|AG[EÊ]NCIA DE .*|IMPORTA[CÇ][AÃ]O E .*|COM[EÉ]RCIO (E|DE) .*|SERVI[CÇ]OS (ONLINE|DIGITAIS).*|LTDA\.?|S\.?\/?A\.?|EIRELI|\bME\b|EPP)\s*$/;
const KEEP_UPPER = new Set(['IOF', 'BR', 'SP', 'RJ', 'TV', 'IA', 'VPN', 'SA']);
const KEEP_LOWER = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

export function prettyName(key: string): string {
  let s = key.replace(PROCESSOR_PREFIX, '').replace(/\s*\*\s*/g, ' ').trim();
  // Código do lojista na frente do nome ("12345678 JOAO SILV") não ajuda a reconhecer.
  s = s.replace(/^\d{5,}\s+(?=\S)/, '');
  s = s.replace(LEGAL_SUFFIX, '').replace(/\.(COM|C|CO)$/, '').trim();
  if (s === '') s = key;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      if (KEEP_UPPER.has(w.toUpperCase())) return w.toUpperCase();
      if (i > 0 && KEEP_LOWER.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export function findBrand(key: string): Brand | null {
  return BRANDS.find((b) => b.match.test(key)) ?? null;
}

// `fallbackKind`: subcategoria do Open Finance, usada quando nada melhor é conhecido.
export function labelMerchant(key: string, userLabels: Record<string, UserLabel>, fallbackKind: string | null): MerchantLabel {
  const user = userLabels[key];
  const brand = findBrand(key);
  // Categoria escolhida pelo usuário também descreve o que é, se ele não escreveu outra coisa.
  const chosen = user?.category ? CATEGORY_CHOICES[user.category] : undefined;
  return {
    name: user?.name || brand?.name || prettyName(key),
    kind: user?.kind || (chosen ? chosen.label.toLowerCase() : null) || brand?.kind || fallbackKind?.toLowerCase() || null,
  };
}
