/**
 * Pixel, eventos e loja da Mesa Site (25/10/2026, dono: "opção de site para
 * serviço e e-commerce também, e opção de pixel já com o novo plugin de IA da
 * Meta para deixar tudo correto").
 *
 * O que a Meta oferece hoje (pesquisa de 25/10/2026, fontes no relatório):
 * não existe um "plugin de IA" com esse nome. Existem o enriquecimento por IA
 * do Pixel e os "eventos automáticos" (ligados por padrão em pixel novo desde
 * 03/08/2026, controlados no Gerenciador de Eventos), a Conversions API de um
 * clique hospedada pela Meta e a extensão Meta Ads Data Advisor (antigo Pixel
 * Helper). A configuração oficial que fica correta é: Pixel com os eventos
 * padrão por código, só depois do consentimento (LGPD), mais a Conversions
 * API pelo servidor com o MESMO event_id (a Meta deduplica em 48 h) e
 * correspondência avançada com hash. Com eventos por código, os automáticos
 * contam em dobro: aqui eles ficam desligados por padrão (autoConfig) e a
 * equipe liga se quiser a IA da Meta complementando.
 *
 * Aqui mora o contrato com o site gerado (pacote.medicao e pacote.loja, lidos
 * pela casca src/lib/integracoes.tsx e src/lib/loja.tsx do modelo-site), a
 * checagem antes de publicar, o passo a passo do Testar eventos e o evento da
 * Conversions API (o hash entra de fora: o servidor usa o crypto do Deno).
 *
 * Puro: sem Deno, sem npm e sem banco. Sem lookbehind, classe de propriedade
 * Unicode ou grupo nomeado (a tela roda no Safari 11). Sem travessão.
 */

/** A versão da Graph API em uso (v26.0, lançada em 29/07/2026). */
export const VERSAO_DA_GRAPH = "v26.0";

// ------------------------------------------------------------------ eventos padrão da Meta

export const EVENTOS_DA_META = [
  { id: "PageView", rotulo: "Visita", quando: "cada página aberta, depois do Aceitar dos cookies" },
  { id: "ViewContent", rotulo: "Viu o conteúdo", quando: "abriu um serviço ou um produto" },
  { id: "Lead", rotulo: "Lead", quando: "mandou o formulário" },
  { id: "Contact", rotulo: "Contato", quando: "tocou no WhatsApp, no telefone ou no e-mail" },
  { id: "Schedule", rotulo: "Agendamento", quando: "tocou em agendar ou pedir orçamento" },
  { id: "CompleteRegistration", rotulo: "Inscrição", quando: "concluiu a inscrição" },
  { id: "AddToCart", rotulo: "Adicionou ao carrinho", quando: "pôs um produto no carrinho" },
  { id: "InitiateCheckout", rotulo: "Iniciou a compra", quando: "foi para o pagamento ou mandou o pedido no WhatsApp" },
  { id: "AddPaymentInfo", rotulo: "Pagamento informado", quando: "informou o pagamento (no checkout do gateway)" },
  { id: "Purchase", rotulo: "Compra", quando: "voltou do pagamento aprovado para a página de obrigado, com valor e moeda" },
] as const;
export type EventoDaMeta = (typeof EVENTOS_DA_META)[number]["id"];
export const ehEventoDaMeta = (v: unknown): v is EventoDaMeta => typeof v === "string" && EVENTOS_DA_META.some((e) => e.id === v);
export const eventoDaMeta = (id: string) => EVENTOS_DA_META.filter((e) => e.id === id)[0] || null;

/** Os eventos padrão que cada objetivo mede (o PageView sempre). */
const EVENTOS_POR_OBJETIVO: Record<string, EventoDaMeta[]> = {
  servico: ["PageView", "ViewContent", "Lead", "Contact", "Schedule"],
  loja_virtual: ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"],
  captar: ["PageView", "Lead"],
  vender: ["PageView", "ViewContent", "InitiateCheckout", "Lead", "Contact"],
  agendar: ["PageView", "Contact", "Schedule", "Lead"],
  marca: ["PageView", "Contact", "Lead"],
  portfolio: ["PageView", "ViewContent", "Contact", "Lead"],
  evento: ["PageView", "ViewContent", "CompleteRegistration", "Lead"],
  cardapio: ["PageView", "ViewContent", "Contact"],
  bio: ["PageView", "Contact"],
};

/**
 * Os eventos do objetivo. Na loja com pedido pelo WhatsApp a compra acontece
 * na conversa: o site não confirma pagamento, então o Purchase sai da lista
 * (contar compra que não houve estraga a otimização da campanha).
 */
export function eventosDoObjetivo(objetivo: string | null | undefined, loja?: Pick<LojaDoSite, "checkout"> | null): EventoDaMeta[] {
  const base = (objetivo && EVENTOS_POR_OBJETIVO[objetivo]) || ["PageView", "Contact", "Lead"];
  if (objetivo === "loja_virtual" && loja && loja.checkout === "whatsapp") return base.filter((e) => e !== "Purchase");
  return base.slice();
}

/** O evento que mais importa para o objetivo (a checagem e o Testar eventos falam dele). */
export function eventoPrincipal(objetivo: string | null | undefined, loja?: Pick<LojaDoSite, "checkout"> | null): EventoDaMeta {
  const l = eventosDoObjetivo(objetivo, loja);
  const ordem: EventoDaMeta[] = ["Purchase", "InitiateCheckout", "Schedule", "CompleteRegistration", "Lead", "Contact"];
  return ordem.filter((e) => l.indexOf(e) >= 0)[0] || "PageView";
}

/** Objetivos em que o site sem pixel deixa o anúncio cego (bio fica de fora: link na bio não roda campanha). */
export const objetivoPedePixel = (objetivo: string | null | undefined) => !!objetivo && objetivo !== "bio";

// ------------------------------------------------------------------ configuração da medição

export type MedicaoDoSite = {
  /** Eventos automáticos e enriquecimento por IA da Meta (autoConfig). Desligado: só os eventos por código (sem contar em dobro). */
  eventos_automaticos: boolean;
  /** Conversions API pelo servidor (o lead do formulário vai também pela Meta do lado do servidor, com o mesmo event_id). */
  capi: boolean;
  /** Código do Testar eventos (TEST12345): só o servidor usa, no envio de teste. */
  codigo_de_teste: string | null;
};

export const medicaoPadrao = (): MedicaoDoSite => ({ eventos_automaticos: false, capi: false, codigo_de_teste: null });

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const linha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").replace(/\s*[—–]\s*/g, ", ").trim().slice(0, max);

/** Código do Testar eventos: letras e números (a Meta gera TEST seguido de dígitos). */
export const normalizarCodigoDeTeste = (v: unknown): string | null => {
  const s = String(v == null ? "" : v).trim().toUpperCase();
  return /^[A-Z0-9]{4,24}$/.test(s) ? s : null;
};

export function normalizarMedicao(bruto: unknown): MedicaoDoSite {
  const o = obj(bruto);
  return { eventos_automaticos: o.eventos_automaticos === true, capi: o.capi === true, codigo_de_teste: normalizarCodigoDeTeste(o.codigo_de_teste) };
}

// ------------------------------------------------------------------ loja virtual

export const CHECKOUTS_DA_LOJA = [
  { id: "whatsapp", rotulo: "Pedido pelo WhatsApp", descricao: "o carrinho vira uma mensagem com os itens e o total" },
  { id: "link", rotulo: "Link de pagamento", descricao: "cada produto leva ao link do gateway que o cliente já usa" },
] as const;
export type CheckoutDaLoja = (typeof CHECKOUTS_DA_LOJA)[number]["id"];

export type ProdutoDaLoja = {
  id: string;
  nome: string;
  /** Em reais; null = sob consulta (sem preço o Purchase não tem valor). */
  preco: number | null;
  categoria: string;
  descricao: string;
  /** https do checkout do gateway (Kiwify, Hotmart, Mercado Pago, Stripe, Asaas...). */
  link_pagamento: string | null;
  disponivel: boolean;
};

export type LojaDoSite = { checkout: CheckoutDaLoja; moeda: "BRL"; produtos: ProdutoDaLoja[] };

export const MAX_PRODUTOS = 60;

/** Gateways que o painel já conhece (vendas-webhook): o link de um deles é o caminho mais simples. */
export const GATEWAYS_CONHECIDOS: Array<{ id: string; rotulo: string; hosts: string[] }> = [
  { id: "kiwify", rotulo: "Kiwify", hosts: ["kiwify.com.br", "kiwify.app"] },
  { id: "hotmart", rotulo: "Hotmart", hosts: ["hotmart.com"] },
  { id: "mercado_pago", rotulo: "Mercado Pago", hosts: ["mercadopago.com.br", "mercadopago.com", "mpago.la", "mpago.li"] },
  { id: "stripe", rotulo: "Stripe", hosts: ["stripe.com"] },
  { id: "asaas", rotulo: "Asaas", hosts: ["asaas.com"] },
];

/** Link de pagamento: só https público, sem usuário e senha. */
export function linkDePagamento(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim();
  if (!s || s.length > 500 || !/^https:\/\//i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !/\.[a-z]{2,}$/i.test(u.hostname)) return null;
  return u.toString();
}

/** O gateway do link (pelo domínio), ou null quando é outro. */
export function gatewayDoLink(url: string | null): { id: string; rotulo: string } | null {
  if (!url) return null;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const g = GATEWAYS_CONHECIDOS.filter((x) => x.hosts.some((h) => host === h || host.slice(-(h.length + 1)) === `.${h}`))[0];
  return g ? { id: g.id, rotulo: g.rotulo } : null;
}

/** "R$ 1.234,56", "49,90", "49.9" ou número: o preço em reais (null quando não dá para ler). */
export function precoDe(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) && v >= 0 && v < 1e7 ? Math.round(v * 100) / 100 : null;
  let s = String(v == null ? "" : v).replace(/R\$|\s/gi, "");
  if (!s || !/^[0-9.,]+$/.test(s)) return null;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n * 100) / 100 : null;
}

/** R$ 1.234,56 (sem Intl: o mesmo texto no servidor, na tela e no site). */
export function emReais(n: number): string {
  const centavos = Math.round(n * 100);
  const inteiro = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const resto = String(centavos % 100);
  return `R$ ${inteiro},${resto.length < 2 ? `0${resto}` : resto}`;
}

const idDoProduto = (nome: string, usados: Record<string, true>): string => {
  const base =
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "produto";
  let id = base;
  for (let i = 2; usados[id]; i++) id = `${base}-${i}`;
  usados[id] = true;
  return id;
};

const ID_DO_PRODUTO = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function normalizarLoja(bruto: unknown): LojaDoSite {
  const o = obj(bruto);
  const usados: Record<string, true> = {};
  const produtos: ProdutoDaLoja[] = [];
  (Array.isArray(o.produtos) ? o.produtos : []).forEach((p) => {
    const x = obj(p);
    const nome = linha(x.nome, 120);
    if (!nome || produtos.length >= MAX_PRODUTOS) return;
    const pedido = typeof x.id === "string" && ID_DO_PRODUTO.test(x.id) && !usados[x.id] ? x.id : "";
    if (pedido) usados[pedido] = true;
    produtos.push({
      id: pedido || idDoProduto(nome, usados),
      nome,
      preco: precoDe(x.preco),
      categoria: linha(x.categoria, 60),
      descricao: linha(x.descricao, 400),
      link_pagamento: linkDePagamento(x.link_pagamento),
      disponivel: x.disponivel !== false,
    });
  });
  return { checkout: o.checkout === "link" ? "link" : "whatsapp", moeda: "BRL", produtos };
}

/**
 * Produtos de partida a partir do contexto do cliente ("Café 250 g - R$ 39,90"
 * vira nome e preço). A equipe confere: nada de preço inventado.
 */
export function produtosDoContexto(lista: string[]): ProdutoDaLoja[] {
  const brutos = (Array.isArray(lista) ? lista : []).map((t) => {
    const s = String(t || "");
    const m = s.match(/^(.*?)(?:\s*[:|,-]\s*|\s+)(R\$\s*[0-9.,]+)\s*$/i);
    return m ? { nome: m[1], preco: m[2] } : { nome: s, preco: null };
  });
  return normalizarLoja({ produtos: brutos }).produtos;
}

/** As categorias da loja, na ordem em que aparecem (sem categoria: "Produtos"). */
export const categoriasDaLoja = (l: LojaDoSite): string[] =>
  l.produtos.map((p) => p.categoria || "Produtos").filter((c, i, a) => a.indexOf(c) === i);

export type ItemDoPedido = { nome: string; quantidade: number; preco: number | null };

/** A mensagem do pedido no WhatsApp (o mesmo texto que a casca do site monta). */
export function mensagemDoPedido(itens: ItemDoPedido[]): string {
  const validos = itens.filter((i) => i.nome && i.quantidade > 0);
  const linhas = validos.map((i) => `- ${i.quantidade}x ${i.nome}${i.preco != null ? ` (${emReais(i.preco)})` : ""}`);
  const comPreco = validos.every((i) => i.preco != null);
  const total = validos.reduce((t, i) => t + (i.preco || 0) * i.quantidade, 0);
  return ["Olá! Quero fazer este pedido:", ...linhas, comPreco && validos.length ? `Total: ${emReais(total)}` : "Total: a combinar"].join("\n");
}

// ------------------------------------------------------------------ o que vai no pacote do site

export type MedicaoNoPacote = {
  /** Os eventos padrão que o site dispara (a casca só dispara os da lista). */
  eventos: EventoDaMeta[];
  eventos_automaticos: boolean;
  /** O formulário manda event_id, _fbp e _fbc para o servidor repetir o Lead na Conversions API. */
  capi: boolean;
  moeda: "BRL";
};

export type LojaNoPacote = { checkout: CheckoutDaLoja; moeda: "BRL"; produtos: ProdutoDaLoja[]; categorias: string[] };

const jornadaDe = (direcao: unknown) => obj(obj(direcao).jornada);

/** A medição do site para o pacote (objetivo, loja e escolhas da equipe gravadas em direcao.jornada). */
export function medicaoDoPacote(direcao: unknown, pixel: string | null): MedicaoNoPacote {
  const j = jornadaDe(direcao);
  const m = normalizarMedicao(j.medicao);
  const objetivo = typeof j.objetivo === "string" ? j.objetivo : null;
  const loja = objetivo === "loja_virtual" ? normalizarLoja(j.loja) : null;
  return { eventos: eventosDoObjetivo(objetivo, loja), eventos_automaticos: m.eventos_automaticos, capi: !!pixel && m.capi, moeda: "BRL" };
}

/** A loja do pacote: só no objetivo Loja virtual (os outros sites não têm carrinho). */
export function lojaDoPacote(direcao: unknown): LojaNoPacote | null {
  const j = jornadaDe(direcao);
  if (j.objetivo !== "loja_virtual") return null;
  const l = normalizarLoja(j.loja);
  return { checkout: l.checkout, moeda: l.moeda, produtos: l.produtos, categorias: categoriasDaLoja(l) };
}

// ------------------------------------------------------------------ checagem antes de publicar

export type ItemDaMedicao = { id: string; rotulo: string; ok: boolean; etapa: string; detalhe?: string; obrigatorio: boolean };

export type EstadoDaMedicao = {
  objetivo: string | null;
  pixel: string | null;
  cookiesLigado: boolean;
  whatsappLigado: boolean;
  formularioLigado: boolean;
  medicao: MedicaoDoSite;
  loja: LojaDoSite | null;
  /** O mapa tem a página /obrigado/ (o Purchase do link de pagamento sai dela). */
  temPaginaDeObrigado: boolean;
};

/**
 * O que falta na medição e na loja para o objetivo. Entra no checklist de
 * lançamento: pixel e eventos são aviso (o site vai ao ar sem eles, mas o
 * anúncio fica cego); a loja sem jeito de comprar é obrigatória.
 */
export function itensDaMedicao(e: EstadoDaMedicao): ItemDaMedicao[] {
  const itens: ItemDaMedicao[] = [];
  const principal = eventoPrincipal(e.objetivo, e.loja);
  if (objetivoPedePixel(e.objetivo)) {
    itens.push({
      id: "pixel",
      rotulo: "Pixel da Meta para medir os anúncios",
      ok: !!e.pixel,
      etapa: "ajustar",
      detalhe: e.pixel ? undefined : `sem pixel, o ${principal} do objetivo não chega à Meta`,
      obrigatorio: false,
    });
  }
  if (e.pixel) {
    itens.push({ id: "pixel_lgpd", rotulo: "Pixel só depois do Aceitar (LGPD)", ok: e.cookiesLigado, etapa: "ajustar", detalhe: e.cookiesLigado ? undefined : "ligue o aviso de cookies", obrigatorio: true });
    const lista = eventosDoObjetivo(e.objetivo, e.loja);
    const semCaminho: string[] = [];
    if ((lista.indexOf("Lead") >= 0) && !e.formularioLigado) semCaminho.push("Lead (formulário desligado)");
    if ((lista.indexOf("Contact") >= 0 || lista.indexOf("Schedule") >= 0) && !e.whatsappLigado && !e.formularioLigado) semCaminho.push("Contact (sem WhatsApp)");
    itens.push({ id: "eventos", rotulo: `Eventos do objetivo (${lista.join(", ")})`, ok: semCaminho.length === 0, etapa: "ajustar", detalhe: semCaminho.length ? `sem como disparar: ${semCaminho.join(", ")}` : undefined, obrigatorio: false });
    itens.push({
      id: "eventos_automaticos",
      rotulo: "Sem evento contado em dobro",
      ok: !e.medicao.eventos_automaticos,
      etapa: "ajustar",
      detalhe: e.medicao.eventos_automaticos ? "eventos automáticos da Meta ligados junto dos eventos por código: confira a duplicidade no Gerenciador de Eventos" : undefined,
      obrigatorio: false,
    });
  }
  if (e.objetivo === "loja_virtual") {
    const l = e.loja || { checkout: "whatsapp" as const, moeda: "BRL" as const, produtos: [] };
    const ativos = l.produtos.filter((p) => p.disponivel);
    itens.push({ id: "loja_produtos", rotulo: "Produtos na loja", ok: ativos.length > 0, etapa: "conferir", detalhe: ativos.length ? `${ativos.length} produto(s)` : "cadastre os produtos em Conferir o cliente", obrigatorio: true });
    if (l.checkout === "link") {
      const semLink = ativos.filter((p) => !p.link_pagamento);
      itens.push({ id: "loja_checkout", rotulo: "Link de pagamento em cada produto", ok: ativos.length > 0 && semLink.length === 0, etapa: "conferir", detalhe: semLink.length ? `sem link: ${semLink.slice(0, 3).map((p) => p.nome).join(", ")}${semLink.length > 3 ? "..." : ""}` : undefined, obrigatorio: true });
      itens.push({ id: "loja_obrigado", rotulo: "Página de obrigado para a compra", ok: e.temPaginaDeObrigado, etapa: "conferir", detalhe: e.temPaginaDeObrigado ? "aponte o retorno do gateway para /obrigado/" : "o Purchase sai da página /obrigado/", obrigatorio: false });
    } else {
      itens.push({ id: "loja_checkout", rotulo: "WhatsApp ligado para receber o pedido", ok: e.whatsappLigado, etapa: "integracoes", obrigatorio: true });
    }
    const semPreco = ativos.filter((p) => p.preco == null);
    itens.push({ id: "loja_precos", rotulo: "Preço em todos os produtos", ok: semPreco.length === 0, etapa: "conferir", detalhe: semPreco.length ? `${semPreco.length} sob consulta: o evento vai sem valor` : undefined, obrigatorio: false });
  }
  return itens;
}

// ------------------------------------------------------------------ Testar eventos

/** Link do Testar eventos do pixel no Gerenciador de Eventos. */
export const linkDoTestarEventos = (pixel: string) => `https://business.facebook.com/events_manager2/list/pixel/${encodeURIComponent(pixel)}/test_events`;

const COMO_DISPARAR: Record<EventoDaMeta, string> = {
  PageView: "abra qualquer página",
  ViewContent: "abra um serviço ou um produto",
  Lead: "mande o formulário com um contato de teste",
  Contact: "toque no botão do WhatsApp",
  Schedule: "toque no botão de agendar ou pedir orçamento",
  CompleteRegistration: "conclua a inscrição",
  AddToCart: "ponha um produto no carrinho",
  InitiateCheckout: "toque em finalizar o pedido",
  AddPaymentInfo: "informe o pagamento no checkout do gateway",
  Purchase: "volte do pagamento para /obrigado/ (no teste, sem pagar: abra /obrigado/ logo depois de tocar em comprar)",
};

/** O passo a passo do Testar eventos (a tela mostra numerado; nada roda sozinho). */
export function passosDoTeste(p: { pixel: string; url: string | null; eventos: EventoDaMeta[]; capi: boolean }): string[] {
  const passos = [
    `Abra o Gerenciador de Eventos no pixel ${p.pixel} e entre em Testar eventos.`,
    `Em Eventos do navegador, cole ${p.url || "o endereço do site (prévia ou publicado)"} e clique em Abrir site.`,
    "No site, clique em Aceitar no aviso de cookies. Sem o Aceitar nada dispara: é o certo pela LGPD.",
    ...p.eventos.map((e) => `${e}: ${COMO_DISPARAR[e]}.`),
    "Confira na aba: cada evento aparece com Navegador e os parâmetros (valor e moeda na compra).",
  ];
  if (p.capi) passos.push("Conversions API: copie o código de teste da aba (TEST...) para o campo ao lado e envie o evento de teste do servidor. Ele aparece como Servidor; o Lead real aparece nos dois e marcado como Deduplicado.");
  passos.push("Na página, a extensão Meta Ads Data Advisor (antigo Pixel Helper) do Chrome mostra o pixel e os eventos sem abrir o Gerenciador.");
  return passos;
}

// ------------------------------------------------------------------ pixels da conta de anúncios

export type PixelDaConta = { id: string; nome: string; ultimo_disparo: string | null; conta: string };

/** A resposta de GET /act_{id}/adspixels (id, name, last_fired_time, is_unavailable) sem confiar em nada. */
export function pixelsDaResposta(resposta: unknown, conta: string): PixelDaConta[] {
  const dados = obj(resposta).data;
  return (Array.isArray(dados) ? dados : [])
    .map((x) => obj(x))
    .filter((x) => typeof x.id === "string" && /^\d{10,20}$/.test(x.id) && x.is_unavailable !== true)
    .map((x) => ({ id: String(x.id), nome: linha(x.name, 120) || `Pixel ${x.id}`, ultimo_disparo: typeof x.last_fired_time === "string" ? x.last_fired_time : null, conta }));
}

/**
 * O pixel sugerido: o que tem o nome da marca; senão o que disparou mais
 * recente; senão o primeiro. Regra fixa (sem IA): a equipe confirma.
 */
export function pixelSugerido(pixels: PixelDaConta[], nomeDaMarca: string): PixelDaConta | null {
  if (!pixels.length) return null;
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const marca = norm(nomeDaMarca || "");
  const doNome = marca.length >= 3 ? pixels.filter((p) => norm(p.nome).indexOf(marca) >= 0 || (norm(p.nome).length >= 3 && marca.indexOf(norm(p.nome)) >= 0)) : [];
  const ordem = (l: PixelDaConta[]) => l.slice().sort((a, b) => String(b.ultimo_disparo || "").localeCompare(String(a.ultimo_disparo || "")));
  return ordem(doNome.length ? doNome : pixels)[0];
}

// ------------------------------------------------------------------ Conversions API (servidor)

/** event_id que o navegador manda (o mesmo do fbq: a Meta deduplica pelo par evento + id). */
export const ID_DO_EVENTO = /^[A-Za-z0-9_.-]{8,64}$/;
const FBP = /^fb\.[0-9]\.[0-9]{10,16}\.[0-9]{1,24}$/;
const FBC = /^fb\.[0-9]\.[0-9]{10,16}\.[A-Za-z0-9_-]{8,500}$/;

/** E-mail como a Meta pede antes do hash: sem espaço e em minúsculo. */
export function emailParaMeta(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) ? s : null;
}

/** Telefone como a Meta pede: só dígitos com o DDI (55 quando vier só com o DDD). */
export function telefoneParaMeta(v: unknown): string | null {
  let d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** Primeiro e último nome em minúsculo, sem acento e sem pontuação. */
export function nomeParaMeta(v: unknown): { fn: string | null; ln: string | null } {
  const partes = String(v == null ? "" : v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return { fn: partes[0] || null, ln: partes.length > 1 ? partes[partes.length - 1] : null };
}

export type EventoParaOServidor = {
  evento: EventoDaMeta;
  event_id: string;
  url: string;
  ip: string | null;
  user_agent: string | null;
  fbp?: string | null;
  fbc?: string | null;
  email?: string | null;
  telefone?: string | null;
  nome?: string | null;
  valor?: number | null;
  /** segundos (padrão: agora). */
  tempo?: number;
};

/**
 * O evento no formato da Conversions API (POST /{pixel}/events). Dados da
 * pessoa só com hash SHA-256 do valor normalizado; IP, navegador, fbp e fbc
 * vão sem hash (regra da Meta). Sem e-mail, telefone, fbp ou fbc: null (a
 * Meta não casaria o evento com ninguém).
 */
export async function eventoParaCapi(d: EventoParaOServidor, sha256: (s: string) => Promise<string>): Promise<Record<string, unknown> | null> {
  if (!ehEventoDaMeta(d.evento) || !ID_DO_EVENTO.test(String(d.event_id || ""))) return null;
  const ud: Record<string, unknown> = {};
  const em = emailParaMeta(d.email);
  const ph = telefoneParaMeta(d.telefone);
  const nome = nomeParaMeta(d.nome);
  if (em) ud.em = [await sha256(em)];
  if (ph) ud.ph = [await sha256(ph)];
  if (nome.fn) ud.fn = [await sha256(nome.fn)];
  if (nome.ln) ud.ln = [await sha256(nome.ln)];
  ud.country = [await sha256("br")];
  if (d.fbp && FBP.test(d.fbp)) ud.fbp = d.fbp;
  if (d.fbc && FBC.test(d.fbc)) ud.fbc = d.fbc;
  if (!ud.em && !ud.ph && !ud.fbp && !ud.fbc) return null;
  if (d.ip) ud.client_ip_address = String(d.ip).slice(0, 64);
  if (d.user_agent) ud.client_user_agent = String(d.user_agent).slice(0, 500);
  const ev: Record<string, unknown> = {
    event_name: d.evento,
    event_time: Math.floor(typeof d.tempo === "number" ? d.tempo : Date.now() / 1000),
    event_id: d.event_id,
    action_source: "website",
    event_source_url: String(d.url || "").slice(0, 1000),
    user_data: ud,
  };
  if (typeof d.valor === "number" && isFinite(d.valor)) ev.custom_data = { value: d.valor, currency: "BRL" };
  return ev;
}

/** O corpo do POST (o código de teste vai no topo, ao lado de data). */
export function corpoDaCapi(eventos: Array<Record<string, unknown>>, codigoDeTeste?: string | null): Record<string, unknown> {
  const c: Record<string, unknown> = { data: eventos };
  const t = normalizarCodigoDeTeste(codigoDeTeste);
  if (t) c.test_event_code = t;
  return c;
}

/** Mensagem da Graph API sem token (o token nunca vai para a tela nem para o log). */
export const semToken = (s: unknown) => String(s == null ? "" : s).replace(/access_token=[^&\s"]+/gi, "access_token=***").slice(0, 240);

/**
 * POST /{pixel}/events em formulário (data em JSON, test_event_code e o
 * token). O fetch entra de fora (o servidor põe o tempo limite); o token não
 * volta na resposta nem na mensagem.
 */
export async function enviarParaCapi(
  pixel: string,
  token: string,
  corpo: Record<string, unknown>,
  buscar: (url: string, init: { method: string; body: URLSearchParams }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>,
): Promise<{ ok: boolean; recebidos: number; mensagem: string | null }> {
  const form = new URLSearchParams();
  form.set("data", JSON.stringify(corpo.data || []));
  if (typeof corpo.test_event_code === "string") form.set("test_event_code", corpo.test_event_code);
  form.set("access_token", token);
  try {
    const r = await buscar(`https://graph.facebook.com/${VERSAO_DA_GRAPH}/${encodeURIComponent(pixel)}/events`, { method: "POST", body: form });
    const j = obj(await r.json().catch(() => ({})));
    const erro = obj(j.error);
    if (!r.ok || j.error) return { ok: false, recebidos: 0, mensagem: semToken(erro.error_user_msg || erro.message || `HTTP ${r.status}`) };
    return { ok: true, recebidos: typeof j.events_received === "number" ? j.events_received : 0, mensagem: null };
  } catch (e) {
    return { ok: false, recebidos: 0, mensagem: semToken(e instanceof Error ? e.message : e) };
  }
}

/** O que o site manda no formulário para o servidor repetir o Lead (só com o Aceitar dos cookies). */
export type MetaDoEnvio = { event_id: string; fbp: string | null; fbc: string | null; url: string };

export function lerMetaDoEnvio(bruto: unknown): MetaDoEnvio | null {
  const o = obj(bruto);
  if (o.consentiu !== true || typeof o.event_id !== "string" || !ID_DO_EVENTO.test(o.event_id)) return null;
  const fbp = typeof o.fbp === "string" && FBP.test(o.fbp) ? o.fbp : null;
  const fbc = typeof o.fbc === "string" && FBC.test(o.fbc) ? o.fbc : null;
  const url = typeof o.url === "string" && /^https?:\/\//.test(o.url) ? o.url.slice(0, 1000) : "";
  return { event_id: o.event_id, fbp, fbc, url };
}
