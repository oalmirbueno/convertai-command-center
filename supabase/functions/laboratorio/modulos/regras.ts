/**
 * Laboratório (19/10/2026): regras puras do canvas de nós.
 * Contrato: Aceleriq-Laboratorio/ESPEC-LABORATORIO.md (tipos de nó, limites e operações do planejar).
 *
 * Sem Deno e sem Supabase: roda no deno test e pode ser importado pelo vitest.
 *
 * Forma do canvas guardado em lab_projetos.canvas (a mesma convenção da Mesa Foto):
 *   { nos: [{ id, tipo, x, y, dados }], ligacoes: [{ id, de, para }], viewport: { x, y, zoom } }
 * A leitura aceita também a forma do React Flow (type, data, position, source, target) e devolve
 * sempre a forma acima.
 */

export const TIPOS_DE_NO = [
  "contexto",
  "midia",
  "config",
  "gravity",
  "agente",
  "copy",
  "imagem",
  "carrossel",
  "logo",
  "landing",
  "anuncio",
  "agente_externo",
  // v2 (ESPEC-LABORATORIO-v2.md): projeto completo, filme da marca e "pôr no ar".
  "pesquisa",
  "oferta",
  "funil",
  "filme",
  "por_no_ar",
  // v3 (clickmax-rea.md): nós especialistas de criação.
  "avatar",
  "order_bump",
  "upsell",
  "downsell",
  "sequencia_ofertas",
  "secoes_pagina",
  "sequencia_mensagens",
  "refino_tom",
  // v4 (ESPEC-LABORATORIO-v4.md): entradas, funil de verdade, mensagens e criativos.
  "marca",
  "cliente",
  "referencias",
  "video",
  "arquivo",
  "produto",
  "pagina",
  "checkout",
  "quiz",
  "webinar",
  "dominio",
  "teste_ab",
  "automacao",
  "email",
  "whatsapp",
  "area_membros",
  "ugc",
  "influenciador",
  "template_designer",
  "crm",
  "recuperacao",
  "fontes_trafego",
] as const;
export type TipoDeNo = typeof TIPOS_DE_NO[number];

export const ehTipoDeNo = (v: unknown): v is TipoDeNo => (TIPOS_DE_NO as readonly string[]).indexOf(String(v)) >= 0;

/** Nós que só guardam dado (sem custo): a saída sai dos próprios dados. */
export const NOS_ESTATICOS: readonly TipoDeNo[] = ["contexto", "midia", "config", "gravity", "marca", "cliente", "video", "arquivo", "produto"];
/** Nós da v4 que rodam (alguns sem custo: domínio, teste A/B, CRM e fontes de tráfego montam por regra fixa). */
export const NOS_DA_V4: readonly TipoDeNo[] = ["referencias", "pagina", "checkout", "quiz", "webinar", "dominio", "teste_ab", "automacao", "email", "whatsapp", "area_membros", "ugc", "influenciador", "template_designer", "crm", "recuperacao", "fontes_trafego"];
/** Nós que rodam (custo, execução em lab_execucoes). */
export const NOS_EXECUTAVEIS: readonly TipoDeNo[] = ["agente", "copy", "imagem", "carrossel", "logo", "landing", "anuncio", "agente_externo", "pesquisa", "oferta", "funil", "filme", "por_no_ar", "avatar", "order_bump", "upsell", "downsell", "sequencia_ofertas", "secoes_pagina", "sequencia_mensagens", "refino_tom", ...NOS_DA_V4];
/** Os especialistas de criação (v3): avatar, ofertas do carrinho, seções da página, mensagens e refino de tom. */
export const NOS_ESPECIALISTAS: readonly TipoDeNo[] = ["avatar", "order_bump", "upsell", "downsell", "sequencia_ofertas", "secoes_pagina", "sequencia_mensagens", "refino_tom"];
export const ehExecutavel = (t: TipoDeNo) => NOS_EXECUTAVEIS.indexOf(t) >= 0;
/** Nós que podem passar de 150 s: respondem na hora e seguem com EdgeRuntime.waitUntil. */
export const NOS_LONGOS: readonly TipoDeNo[] = ["carrossel", "landing", "pesquisa", "filme", "referencias", "pagina", "checkout", "quiz", "webinar", "email", "area_membros", "ugc", "influenciador", "template_designer"];

export const MAX_NOS = 80;
export const MAX_LIGACOES = 160;
export const MAX_TEXTO = 8000;

/** O que cada nó entrega para quem está ligado depois dele. */
export type TipoDeSaida = "texto" | "imagens" | "config" | "gravity" | "html" | "json" | "tarefa" | "video" | "estado";
export const SAIDA_DO_TIPO: Record<TipoDeNo, TipoDeSaida> = {
  contexto: "texto",
  midia: "imagens",
  config: "config",
  gravity: "gravity",
  agente: "texto",
  copy: "texto",
  imagem: "imagens",
  carrossel: "imagens",
  logo: "imagens",
  landing: "html",
  anuncio: "json",
  agente_externo: "tarefa",
  pesquisa: "texto",
  oferta: "json",
  funil: "json",
  filme: "video",
  por_no_ar: "estado",
  avatar: "json",
  order_bump: "json",
  upsell: "json",
  downsell: "json",
  sequencia_ofertas: "json",
  secoes_pagina: "json",
  sequencia_mensagens: "json",
  refino_tom: "texto",
  marca: "texto",
  cliente: "texto",
  referencias: "texto",
  video: "video",
  arquivo: "texto",
  produto: "json",
  pagina: "html",
  checkout: "html",
  quiz: "html",
  webinar: "html",
  dominio: "estado",
  teste_ab: "estado",
  automacao: "json",
  email: "json",
  whatsapp: "json",
  area_membros: "json",
  ugc: "imagens",
  influenciador: "imagens",
  template_designer: "imagens",
  crm: "estado",
  recuperacao: "json",
  fontes_trafego: "json",
};

const TEXTOS: TipoDeNo[] = ["contexto", "agente", "copy"];
/** Textos e os guias do projeto completo (pesquisa com fontes, oferta e funil). */
const GUIAS: TipoDeNo[] = [...TEXTOS, "pesquisa", "oferta", "funil"];
/** Ofertas do carrinho (v3). */
const CARRINHO: TipoDeNo[] = ["order_bump", "upsell", "downsell", "sequencia_ofertas"];
/** O que os especialistas entregam (entra nas peças finais: copy, página, anúncio, agente, pôr no ar). */
const CRIACAO: TipoDeNo[] = ["avatar", ...CARRINHO, "secoes_pagina", "sequencia_mensagens", "refino_tom"];
/** Base dos especialistas: textos, pesquisa, avatar, oferta e funil. */
const BASE_ESPECIALISTA: TipoDeNo[] = [...TEXTOS, "pesquisa", "avatar", "oferta", "funil"];
/** v4: entradas de dado (marca, cliente, referências, documento e produto); viram texto para quem recebe. */
const FONTES_V4: TipoDeNo[] = ["marca", "cliente", "referencias", "arquivo", "produto"];
/** v4: as peças novas que o Pôr no ar (e o agente externo) recebem. */
const PECAS_V4: TipoDeNo[] = ["pagina", "checkout", "quiz", "webinar", "dominio", "teste_ab", "automacao", "email", "whatsapp", "area_membros", "crm", "recuperacao", "ugc", "influenciador", "template_designer", "fontes_trafego"];

/**
 * Quem pode entrar em quem (origem → destino). O que não está aqui é recusado com motivo.
 * Logo só aceita texto, config, gravity e mídia (especificação). Contexto, mídia e config não recebem nada.
 * A tela tem a cópia (src/lib/laboratorio/nos.ts); o teste laboratorio-contrato confere par a par.
 * Ninguém recebe "Pôr no ar" (a saída dele é só o estado do pedido).
 */
export const ENTRADAS_ACEITAS: Record<TipoDeNo, readonly TipoDeNo[]> = {
  contexto: [],
  midia: [],
  config: [],
  gravity: [...TEXTOS, "midia", "imagem", "logo"],
  agente: [...GUIAS, ...CRIACAO, "midia", "imagem", "carrossel", "logo", "landing", "anuncio"],
  copy: [...GUIAS, ...CRIACAO, "midia", "imagem", "carrossel", "logo", "anuncio"],
  imagem: [...GUIAS, "avatar", "refino_tom", "midia", "config", "gravity", "imagem", "logo"],
  carrossel: [...GUIAS, "avatar", "refino_tom", "midia", "config", "gravity", "imagem", "logo"],
  logo: [...TEXTOS, "midia", "config", "gravity"],
  landing: [...GUIAS, ...CRIACAO, "midia", "gravity", "imagem", "carrossel", "logo"],
  anuncio: [...GUIAS, ...CRIACAO, "midia", "imagem", "carrossel", "logo"],
  agente_externo: [...GUIAS, ...CRIACAO, "midia", "imagem", "carrossel", "logo", "landing", "anuncio", "filme"],
  pesquisa: [...TEXTOS, "midia", "pesquisa"],
  oferta: [...TEXTOS, "pesquisa", "avatar", "midia", "imagem"],
  funil: [...TEXTOS, "pesquisa", "oferta", "avatar", ...CARRINHO],
  filme: [...TEXTOS, "pesquisa", "oferta", "avatar", "midia", "imagem", "logo"],
  por_no_ar: [...TEXTOS, ...CRIACAO, "oferta", "funil", "midia", "imagem", "carrossel", "logo", "landing", "anuncio", "filme"],
  // v3: especialistas de criação (clickmax-rea.md).
  avatar: [...TEXTOS, "pesquisa", "midia"],
  order_bump: [...BASE_ESPECIALISTA],
  upsell: [...BASE_ESPECIALISTA, "order_bump"],
  downsell: [...BASE_ESPECIALISTA, "upsell"],
  sequencia_ofertas: [...BASE_ESPECIALISTA, "order_bump", "upsell", "downsell"],
  secoes_pagina: [...BASE_ESPECIALISTA, ...CARRINHO],
  sequencia_mensagens: [...BASE_ESPECIALISTA, ...CARRINHO, "secoes_pagina", "landing"],
  refino_tom: [...BASE_ESPECIALISTA, ...CARRINHO, "secoes_pagina", "sequencia_mensagens", "anuncio"],
  // v4 (ESPEC-LABORATORIO-v4.md). Entradas: ponto de partida (não recebem nada).
  marca: [],
  cliente: [],
  referencias: [],
  video: [],
  arquivo: [],
  produto: [],
  fontes_trafego: [],
  // Funil: páginas ligadas entre si; a ligação pode levar o gatilho (GATILHOS_DA_ORIGEM).
  pagina: [...GUIAS, ...CRIACAO, ...FONTES_V4, "midia", "gravity", "imagem", "carrossel", "logo", "video", "fontes_trafego", "pagina", "checkout", "quiz", "webinar"],
  checkout: [...GUIAS, ...CARRINHO, "avatar", "refino_tom", "secoes_pagina", ...FONTES_V4, "midia", "imagem", "logo", "landing", "pagina", "quiz", "webinar", "fontes_trafego"],
  quiz: [...GUIAS, "avatar", "refino_tom", "secoes_pagina", ...FONTES_V4, "midia", "imagem", "logo", "pagina", "fontes_trafego"],
  webinar: [...GUIAS, ...CARRINHO, "avatar", "refino_tom", "secoes_pagina", ...FONTES_V4, "midia", "imagem", "logo", "video", "pagina", "fontes_trafego"],
  teste_ab: ["pagina", "quiz", "fontes_trafego"],
  crm: ["pagina", "checkout", "quiz", "webinar", "automacao", "area_membros"],
  area_membros: [...GUIAS, "avatar", ...FONTES_V4, "checkout", "video"],
  // Mensagens: tudo sai como rascunho; o envio só depois da aprovação do dono (Pôr no ar).
  automacao: [...TEXTOS, "oferta", "produto", "pagina", "checkout", "quiz", "webinar", "crm", "sequencia_mensagens", "recuperacao", "area_membros"],
  email: [...GUIAS, ...CARRINHO, "avatar", "refino_tom", "sequencia_mensagens", ...FONTES_V4, "automacao", "recuperacao", "pagina", "checkout", "quiz", "webinar", "area_membros"],
  whatsapp: [...GUIAS, ...CARRINHO, "avatar", "refino_tom", "sequencia_mensagens", ...FONTES_V4, "automacao", "recuperacao", "pagina", "checkout", "quiz", "webinar", "area_membros"],
  recuperacao: [...TEXTOS, "oferta", "produto", "marca", "avatar", ...CARRINHO, "checkout", "webinar"],
  // Criação.
  ugc: [...GUIAS, "avatar", "refino_tom", ...FONTES_V4, "influenciador", "midia", "imagem", "video", "config", "gravity", "logo"],
  influenciador: [...TEXTOS, "pesquisa", "avatar", ...FONTES_V4, "midia", "config", "gravity"],
  template_designer: [...TEXTOS, ...FONTES_V4, "midia", "imagem", "logo", "config", "gravity", "influenciador"],
  // Publicação.
  dominio: ["pagina", "checkout", "quiz", "webinar", "teste_ab", "area_membros", "landing", "fontes_trafego"],
};

/**
 * v4: o que os tipos antigos passam a receber dos nós novos (marca, cliente, referências, documento,
 * produto e as peças novas). A tela tem a mesma lista (ENTRADAS_EXTRAS_V4 em nos.ts).
 */
export const ENTRADAS_EXTRAS_V4: Partial<Record<TipoDeNo, readonly TipoDeNo[]>> = {
  gravity: ["marca", "referencias", "influenciador"],
  agente: [...FONTES_V4, "video"],
  copy: [...FONTES_V4, "video", "influenciador"],
  imagem: [...FONTES_V4, "influenciador"],
  carrossel: [...FONTES_V4, "influenciador"],
  logo: ["marca", "cliente", "referencias"],
  landing: [...FONTES_V4],
  anuncio: [...FONTES_V4, "ugc", "template_designer", "pagina", "checkout", "quiz", "webinar"],
  agente_externo: [...FONTES_V4, ...PECAS_V4],
  pesquisa: ["cliente", "referencias", "arquivo", "produto"],
  oferta: [...FONTES_V4],
  funil: [...FONTES_V4],
  filme: ["marca", "cliente", "produto", "video", "arquivo"],
  por_no_ar: [...PECAS_V4],
  avatar: ["cliente", "referencias", "arquivo", "produto"],
  order_bump: [...FONTES_V4],
  upsell: [...FONTES_V4],
  downsell: [...FONTES_V4],
  sequencia_ofertas: [...FONTES_V4],
  secoes_pagina: [...FONTES_V4],
  sequencia_mensagens: [...FONTES_V4, "pagina", "checkout", "quiz", "webinar"],
  refino_tom: [...FONTES_V4, "email", "whatsapp"],
};
for (const t of ["agente", "copy", "oferta", "funil", "landing", "pagina", "avatar", "sequencia_mensagens", "recuperacao", "email", "whatsapp"] as TipoDeNo[]) {
  ENTRADAS_EXTRAS_V4[t] = [...(ENTRADAS_EXTRAS_V4[t] || []), "crm"];
}
for (const t of Object.keys(ENTRADAS_EXTRAS_V4) as TipoDeNo[]) {
  const extras = ENTRADAS_EXTRAS_V4[t] || [];
  ENTRADAS_ACEITAS[t] = ENTRADAS_ACEITAS[t].concat(extras.filter((x, i) => extras.indexOf(x) === i && ENTRADAS_ACEITAS[t].indexOf(x) < 0));
}

// ------------------------------------------------------------------ v4: gatilho na ligação do funil

/**
 * O gatilho que a ligação carrega (ligacoes[].gatilho), como no ClickMax: "a conexão é o gatilho".
 * Só as ligações que saem de um nó do funil (ORIGENS_COM_GATILHO) levam gatilho; é opcional.
 */
export const GATILHOS = [
  "visitou",
  "clicou_botao",
  "enviou_formulario",
  "quiz_concluido",
  "faixa_alta",
  "faixa_media",
  "faixa_baixa",
  "compra_aprovada",
  "compra_recusada",
  "carrinho_abandonado",
  "pix_gerado",
  "upsell_aceito",
  "upsell_recusado",
] as const;
export type Gatilho = typeof GATILHOS[number];
export const ROTULO_DO_GATILHO: Record<Gatilho, string> = {
  visitou: "Visitou",
  clicou_botao: "Clicou no botão",
  enviou_formulario: "Enviou o formulário",
  quiz_concluido: "Concluiu o quiz",
  faixa_alta: "Resultado alto",
  faixa_media: "Resultado médio",
  faixa_baixa: "Resultado baixo",
  compra_aprovada: "Compra aprovada",
  compra_recusada: "Compra recusada",
  carrinho_abandonado: "Carrinho abandonado",
  pix_gerado: "Pix gerado",
  upsell_aceito: "Aceitou o upsell",
  upsell_recusado: "Recusou o upsell",
};
/** Os gatilhos que cada origem tem (checkout tem os de venda; captura tem formulário; quiz tem as faixas). */
export const GATILHOS_DA_ORIGEM: Partial<Record<TipoDeNo, readonly Gatilho[]>> = {
  pagina: ["visitou", "clicou_botao", "enviou_formulario", "upsell_aceito", "upsell_recusado"],
  checkout: ["visitou", "clicou_botao", "compra_aprovada", "compra_recusada", "carrinho_abandonado", "pix_gerado"],
  quiz: ["visitou", "enviou_formulario", "quiz_concluido", "faixa_alta", "faixa_media", "faixa_baixa"],
  webinar: ["visitou", "enviou_formulario", "clicou_botao"],
  teste_ab: ["visitou"],
};
export const ORIGENS_COM_GATILHO = Object.keys(GATILHOS_DA_ORIGEM) as TipoDeNo[];
export const gatilhosDe = (tipo: TipoDeNo): readonly Gatilho[] => GATILHOS_DA_ORIGEM[tipo] || [];
/** O gatilho vale para esta origem? (vazio também vale: o gatilho é opcional). */
export const gatilhoValido = (tipoDaOrigem: TipoDeNo, g: unknown): g is Gatilho => typeof g === "string" && gatilhosDe(tipoDaOrigem).indexOf(g as Gatilho) >= 0;

/** Só um por destino: duas configurações ou duas bases comuns se contradiriam. */
const UM_POR_DESTINO: TipoDeNo[] = ["config", "gravity"];

export const ROTULO_DO_TIPO: Record<TipoDeNo, string> = {
  contexto: "Contexto",
  midia: "Mídia",
  config: "Configurações",
  gravity: "Base comum",
  agente: "Agente",
  copy: "Copy",
  imagem: "Resultado",
  carrossel: "Carrossel",
  logo: "Logo",
  landing: "Landing page",
  anuncio: "Anúncio",
  agente_externo: "Agente externo",
  pesquisa: "Pesquisa",
  oferta: "Oferta",
  funil: "Funil",
  filme: "Filme",
  por_no_ar: "Pôr no ar",
  avatar: "Avatar",
  order_bump: "Order bump",
  upsell: "Upsell",
  downsell: "Downsell",
  sequencia_ofertas: "Sequência de ofertas",
  secoes_pagina: "Seções da página",
  sequencia_mensagens: "Sequência de mensagens",
  refino_tom: "Refino de tom",
  marca: "Marca",
  cliente: "Cliente",
  referencias: "Referências",
  video: "Vídeo",
  arquivo: "Documento",
  produto: "Produto",
  pagina: "Página do funil",
  checkout: "Checkout",
  quiz: "Quiz",
  webinar: "Webinar",
  dominio: "Domínio e endereços",
  teste_ab: "Teste A/B",
  automacao: "Automação",
  email: "E-mail",
  whatsapp: "WhatsApp",
  area_membros: "Área de membros",
  ugc: "Criativo UGC",
  influenciador: "Influenciador digital",
  template_designer: "Template editável",
  crm: "Etapa do CRM",
  recuperacao: "Recuperação",
  fontes_trafego: "Fontes de tráfego",
};

export type NoDoCanvas = { id: string; tipo: TipoDeNo; x: number; y: number; dados: Record<string, unknown>; [extra: string]: unknown };
export type Ligacao = { id: string; de: string; para: string; /** v4: gatilho do funil (GATILHOS), opcional. */ gatilho?: string; [extra: string]: unknown };
export type Canvas = { nos: NoDoCanvas[]; ligacoes: Ligacao[]; viewport: { x: number; y: number; zoom: number } };

export class ErroDoCanvas extends Error {
  codigo: string;
  erros: string[];
  constructor(codigo: string, mensagem: string, erros: string[] = []) {
    super(mensagem);
    this.name = "ErroDoCanvas";
    this.codigo = codigo;
    this.erros = erros;
  }
}

export const canvasVazio = (): Canvas => ({ nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } });

const numero = (v: unknown, reserva = 0) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : reserva);
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const texto = (v: unknown, max = MAX_TEXTO) => (typeof v === "string" ? v.slice(0, max) : "");

/** Lê o canvas (forma do painel ou do React Flow) e devolve a forma do painel. Sem validar ligações. */
export function normalizarCanvas(v: unknown): Canvas {
  const o = objeto(v);
  const nosBrutos = Array.isArray(o.nos) ? o.nos : Array.isArray(o.nodes) ? o.nodes : [];
  const ligBrutas = Array.isArray(o.ligacoes) ? o.ligacoes : Array.isArray(o.edges) ? o.edges : [];
  const nos: NoDoCanvas[] = [];
  for (const bruto of nosBrutos) {
    const n = objeto(bruto);
    const pos = objeto(n.position);
    const tipo = n.tipo ?? n.type;
    const resto: Record<string, unknown> = { ...n };
    for (const k of ["type", "data", "position", "tipo", "x", "y", "dados", "selected", "dragging"]) delete resto[k];
    nos.push({
      ...resto,
      id: String(n.id ?? ""),
      tipo: tipo as TipoDeNo,
      x: numero(n.x ?? pos.x),
      y: numero(n.y ?? pos.y),
      dados: objeto(n.dados ?? n.data),
    });
  }
  const ligacoes: Ligacao[] = [];
  for (const bruta of ligBrutas) {
    const l = objeto(bruta);
    const resto: Record<string, unknown> = { ...l };
    for (const k of ["source", "target", "de", "para", "selected"]) delete resto[k];
    const de = String(l.de ?? l.source ?? "");
    const para = String(l.para ?? l.target ?? "");
    ligacoes.push({ ...resto, id: String(l.id || `lig_${de}_${para}`), de, para });
  }
  const vp = objeto(o.viewport);
  return { nos, ligacoes, viewport: { x: numero(vp.x), y: numero(vp.y), zoom: numero(vp.zoom, 1) || 1 } };
}

/**
 * Pode ligar `de` → `para` neste canvas? null = pode; texto = o motivo da recusa (português simples).
 * `ignorar` tira uma ligação da conta (para revalidar o canvas inteiro).
 */
export function motivoParaNaoLigar(c: Pick<Canvas, "nos" | "ligacoes">, de: string, para: string, ignorar?: string): string | null {
  if (!de || !para) return "Ligação sem origem ou sem destino.";
  if (de === para) return "Um nó não pode ligar nele mesmo.";
  const origem = c.nos.find((n) => n.id === de);
  const destino = c.nos.find((n) => n.id === para);
  if (!origem) return `O nó de origem ${de} não existe.`;
  if (!destino) return `O nó de destino ${para} não existe.`;
  const outras = c.ligacoes.filter((l) => l.id !== ignorar);
  if (outras.some((l) => l.de === de && l.para === para)) return "Esses dois nós já estão ligados.";
  const aceitas = ENTRADAS_ACEITAS[destino.tipo] || [];
  if (aceitas.indexOf(origem.tipo) < 0) {
    if (!aceitas.length) return `${ROTULO_DO_TIPO[destino.tipo]} não recebe entrada.`;
    return `${ROTULO_DO_TIPO[origem.tipo]} não entra em ${ROTULO_DO_TIPO[destino.tipo]}.`;
  }
  if (UM_POR_DESTINO.indexOf(origem.tipo) >= 0) {
    const ja = outras.some((l) => l.para === para && c.nos.find((n) => n.id === l.de)?.tipo === origem.tipo);
    if (ja) return `${ROTULO_DO_TIPO[destino.tipo]} já tem ${ROTULO_DO_TIPO[origem.tipo]} ligado; tire o outro antes.`;
  }
  if (alcanca(outras, para, de)) return "Essa ligação faria um laço (o fluxo voltaria para trás).";
  return null;
}

export const podeLigar = (c: Pick<Canvas, "nos" | "ligacoes">, de: string, para: string) => motivoParaNaoLigar(c, de, para) === null;

/** Existe caminho de `de` até `ate` pelas ligações? */
function alcanca(ligacoes: Ligacao[], de: string, ate: string): boolean {
  const vistos = new Set<string>();
  const fila = [de];
  while (fila.length) {
    const atual = fila.shift()!;
    if (atual === ate) return true;
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    for (const l of ligacoes) if (l.de === atual) fila.push(l.para);
  }
  return false;
}

/** Erros do canvas inteiro (vazio = válido). */
export function errosDoCanvas(c: Canvas): string[] {
  const erros: string[] = [];
  if (c.nos.length > MAX_NOS) erros.push(`O canvas passa de ${MAX_NOS} nós.`);
  if (c.ligacoes.length > MAX_LIGACOES) erros.push(`O canvas passa de ${MAX_LIGACOES} ligações.`);
  const ids = new Set<string>();
  for (const n of c.nos) {
    if (!n.id || n.id.length > 80) erros.push("Nó sem id (ou id longo demais).");
    else if (ids.has(n.id)) erros.push(`Id repetido: ${n.id}.`);
    ids.add(n.id);
    if (!ehTipoDeNo(n.tipo)) erros.push(`Tipo de nó desconhecido: ${String(n.tipo)}.`);
  }
  if (erros.length) return erros;
  const aceitas: Ligacao[] = [];
  for (const l of c.ligacoes) {
    const motivo = motivoParaNaoLigar({ nos: c.nos, ligacoes: aceitas }, l.de, l.para);
    if (motivo) erros.push(`Ligação ${l.de} → ${l.para}: ${motivo}`);
    else aceitas.push(l);
    // v4: o gatilho, quando existe, tem de ser um dos que a origem tem.
    const origem = c.nos.find((n) => n.id === l.de);
    if (!motivo && origem && l.gatilho !== undefined && l.gatilho !== null && l.gatilho !== "" && !gatilhoValido(origem.tipo, l.gatilho)) {
      erros.push(`Ligação ${l.de} → ${l.para}: o gatilho "${String(l.gatilho)}" não vale para ${ROTULO_DO_TIPO[origem.tipo]}.`);
    }
  }
  return erros;
}

/** Normaliza e valida; inválido lança ErroDoCanvas com a lista. */
export function canvasValido(v: unknown): Canvas {
  const c = normalizarCanvas(v);
  const erros = errosDoCanvas(c);
  if (erros.length) throw new ErroDoCanvas("canvas_invalido", "O canvas tem ligações ou nós que não valem.", erros);
  return c;
}

/**
 * Ordem topológica dos nós (Kahn). Com `alvos`, só esses nós e tudo o que vem antes deles.
 * Laço lança ErroDoCanvas("ciclo") com os nós presos.
 */
export function ordemTopologica(c: Pick<Canvas, "nos" | "ligacoes">, alvos?: string[] | null): string[] {
  let incluidos = new Set(c.nos.map((n) => n.id));
  if (alvos && alvos.length) {
    incluidos = new Set<string>();
    const fila = alvos.filter((id) => c.nos.some((n) => n.id === id));
    while (fila.length) {
      const id = fila.shift()!;
      if (incluidos.has(id)) continue;
      incluidos.add(id);
      for (const l of c.ligacoes) if (l.para === id) fila.push(l.de);
    }
  }
  const grau = new Map<string, number>();
  for (const id of incluidos) grau.set(id, 0);
  const ligs = c.ligacoes.filter((l) => incluidos.has(l.de) && incluidos.has(l.para));
  for (const l of ligs) grau.set(l.para, (grau.get(l.para) || 0) + 1);
  // Na ordem em que os nós aparecem no canvas (estável para teste e para a tela).
  const fila = c.nos.map((n) => n.id).filter((id) => incluidos.has(id) && grau.get(id) === 0);
  const ordem: string[] = [];
  while (fila.length) {
    const id = fila.shift()!;
    ordem.push(id);
    for (const l of ligs) {
      if (l.de !== id) continue;
      const g = (grau.get(l.para) || 0) - 1;
      grau.set(l.para, g);
      if (g === 0) fila.push(l.para);
    }
  }
  if (ordem.length < incluidos.size) {
    const presos = [...incluidos].filter((id) => ordem.indexOf(id) < 0);
    throw new ErroDoCanvas("ciclo", "O fluxo tem um laço: um nó depende dele mesmo.", presos);
  }
  return ordem;
}

/** Os nós ligados antes de `noId` (na ordem das ligações). */
export function entradasDo(c: Pick<Canvas, "nos" | "ligacoes">, noId: string): NoDoCanvas[] {
  const saida: NoDoCanvas[] = [];
  for (const l of c.ligacoes) {
    if (l.para !== noId) continue;
    const n = c.nos.find((x) => x.id === l.de);
    if (n) saida.push(n);
  }
  return saida;
}

// ------------------------------------------------------------------ dados e prompt

export const PROPORCOES = ["1:1", "4:5", "9:16", "16:9", "3:2", "2:3"] as const;
export type Proporcao = typeof PROPORCOES[number];
/** Mesmos tamanhos da Mesa Foto (receitas.ts): o motor manda a proporção mais perto ao provedor. */
export const TAMANHO_DA_PROPORCAO: Record<Proporcao, string> = {
  "1:1": "1024x1024",
  "4:5": "1088x1360",
  "9:16": "1088x1920",
  "16:9": "1920x1088",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};
export const QUALIDADES = ["baixa", "media", "alta"] as const;
export type QualidadeLab = typeof QUALIDADES[number];

export type ConfigDoNo = { proporcao: Proporcao; quantidade: number; qualidade: QualidadeLab; motor: string | null };
export type GravityDoNo = { prompt_base: string; referencias: Array<{ path: string; bucket?: string }> };

export const MAX_IMAGENS_POR_NO = 4;
export const MAX_LAMINAS = 10;
export const MAX_LOGOS = 8;

export const proporcaoValida = (v: unknown): Proporcao | null => ((PROPORCOES as readonly string[]).indexOf(String(v)) >= 0 ? v as Proporcao : null);
export const qualidadeValida = (v: unknown): QualidadeLab | null => ((QUALIDADES as readonly string[]).indexOf(String(v)) >= 0 ? v as QualidadeLab : null);
export const limitar = (v: unknown, min: number, max: number, reserva: number) => {
  const n = Math.floor(numero(v, reserva));
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : reserva));
};

/** Configuração efetiva de um nó: a do próprio nó vence a do nó Configurações ligado. */
export function configDe(c: Pick<Canvas, "nos" | "ligacoes">, no: NoDoCanvas): ConfigDoNo {
  const ligada = entradasDo(c, no.id).find((n) => n.tipo === "config");
  const base = ligada ? ligada.dados : {};
  const d = no.dados;
  return {
    proporcao: proporcaoValida(d.proporcao) ?? proporcaoValida(base.proporcao) ?? (no.tipo === "logo" ? "1:1" : "4:5"),
    quantidade: limitar(d.quantidade ?? base.quantidade, 1, MAX_IMAGENS_POR_NO, 1),
    qualidade: qualidadeValida(d.qualidade) ?? qualidadeValida(base.qualidade) ?? "media",
    motor: texto(d.motor, 200) || texto(base.motor, 200) || null,
  };
}

export function gravityDe(c: Pick<Canvas, "nos" | "ligacoes">, no: NoDoCanvas): GravityDoNo | null {
  const g = entradasDo(c, no.id).find((n) => n.tipo === "gravity");
  if (!g) return null;
  const refs = Array.isArray(g.dados.referencias) ? g.dados.referencias : [];
  return {
    prompt_base: texto(g.dados.prompt_base),
    referencias: refs
      .map((r) => objeto(r))
      .filter((r) => typeof r.path === "string" && r.path)
      .map((r) => ({ path: String(r.path), ...(typeof r.bucket === "string" ? { bucket: r.bucket } : {}) })),
  };
}

/**
 * Prompt do Resultado (imagem): base comum (gravity) primeiro, depois o pedido do nó, os textos a montante,
 * a marca e o quadro. A base comum vale para todos os Resultados ligados a ela.
 */
export function montarPromptDaImagem(o: {
  pedido?: string | null;
  textos?: string[];
  gravity?: GravityDoNo | null;
  config?: Pick<ConfigDoNo, "proporcao"> | null;
  marca?: string | null;
  variacao?: string | null;
}): string {
  const partes: string[] = [];
  const base = (o.gravity?.prompt_base || "").trim();
  if (base) partes.push(`BASE COMUM (vale para todas as peças deste fluxo):\n${base}`);
  const pedido = (o.pedido || "").trim();
  if (pedido) partes.push(`PEDIDO DESTA PEÇA:\n${pedido}`);
  const textos = (o.textos || []).map((t) => t.trim()).filter(Boolean);
  if (textos.length) partes.push(`CONTEXTO E TEXTOS LIGADOS:\n${textos.map((t) => `- ${t.slice(0, 2500)}`).join("\n")}`);
  if (o.marca && o.marca.trim()) partes.push(`MARCA:\n${o.marca.trim()}`);
  if (o.variacao && o.variacao.trim()) partes.push(`VARIAÇÃO:\n${o.variacao.trim()}`);
  if (o.config?.proporcao) partes.push(`QUADRO: composição pensada para ${o.config.proporcao}.`);
  if (o.gravity?.referencias?.length) partes.push("As imagens enviadas junto são referência visual (estilo, cor, luz); não copie texto delas.");
  partes.push("Texto que aparecer na arte: em português do Brasil, com ortografia correta.");
  return partes.join("\n\n").slice(0, 12000);
}

// ------------------------------------------------------------------ custo (plano puro)

export const MODELO_TEXTO_PADRAO = "openrouter:anthropic/claude-opus-5.5";
export const MODELO_IMAGEM_PADRAO = "openrouter:openai/gpt-image-2.5-sunburst";

export type Chamada = { tipo: "texto" | "imagem"; modelo_id: string; tokens_entrada: number; tokens_saida: number; imagens: number; qualidade: QualidadeLab | null; imagens_entrada?: number; buscas_web?: number };

/** Saída esperada por tipo de nó (tokens), do lado seguro. */
export const SAIDA_ESPERADA: Record<string, number> = {
  agente: 2500,
  copy: 2000,
  carrossel: 3000,
  landing: 14000,
  anuncio: 2000,
  planejar: 3000,
  /** Projeto completo: até 40 nós já ligados, com os campos (bem mais operações). */
  planejar_completo: 14000,
  pesquisa: 4000,
  oferta: 2500,
  funil: 2500,
  avatar: 2500,
  order_bump: 1500,
  upsell: 1500,
  downsell: 1500,
  sequencia_ofertas: 2500,
  secoes_pagina: 3500,
  sequencia_mensagens: 4500,
  refino_tom: 4000,
  // v4
  referencias: 3000,
  pagina: 14000,
  checkout: 3000,
  quiz: 4500,
  webinar: 7000,
  automacao: 3500,
  email: 6000,
  whatsapp: 4000,
  area_membros: 7000,
  recuperacao: 3000,
  ugc: 4000,
  influenciador: 2000,
  template_designer: 2500,
};

/**
 * 20/10: o motor da casa por arte e por lâmina (a direção da Arte rápida e a conferência da estudio-arte), do
 * lado seguro. Estimativa: a estudio-arte cobra o uso real dela na carteira de IA do cliente.
 */
export const TOKENS_DO_ESTUDIO = { direcao_entrada: 9_000, direcao_saida: 3_000, por_lamina_entrada: 1_200, por_lamina_saida: 600, conferencia_entrada: 2_500, conferencia_saida: 400 } as const;

/** Referências: texto lido das páginas públicas (até 8 links, ~2.500 tokens cada). */
export const TOKENS_POR_REFERENCIA = 2_500;
export const MAX_REFERENCIAS = 8;

/** Os links do nó Referências (um por linha ou separados por espaço), só http(s), sem repetir, até 8. */
export function linksDasReferencias(v: unknown): string[] {
  const saida: string[] = [];
  for (const m of String(typeof v === "string" ? v : "").match(/https?:\/\/[^\s<>"']+/gi) || []) {
    const url = m.replace(/[.,;:)\]]+$/, "");
    if (saida.indexOf(url) < 0 && saida.length < MAX_REFERENCIAS) saida.push(url);
  }
  return saida;
}

/** Busca na web do nó Pesquisa: as buscas e o texto das páginas que o motor estima (ia-motor.ts). */
export const BUSCAS_DA_PESQUISA = 3;
export const TOKENS_DAS_PAGINAS = 10_000;
/**
 * Filme: a Mesa Motion gera os 3 storyboards numa chamada de texto (TAMANHOS_DO_MOTION.storyboards
 * em mesa-motion/modulos/motion-metodo.ts). Escolher e renderizar não usam IA (fila do worker).
 */
export const TOKENS_DOS_STORYBOARDS = { entrada: 7_500, saida: 7_000 } as const;

const tokensDe = (t: string) => Math.ceil(t.length / 3.5);

/** Textos a montante (só o que já está no canvas; saídas de execução entram na hora de rodar). */
function textosDosDados(c: Pick<Canvas, "nos" | "ligacoes">, no: NoDoCanvas): string {
  return entradasDo(c, no.id)
    .map((n) => [n.dados.texto, n.dados.instrucao, n.dados.prompt_base, n.dados.prompt].filter((x) => typeof x === "string").join(" "))
    .join(" ");
}

/** As chamadas pagas que um nó fará (para estimar sem chamar provedor). Nó estático ou externo: nenhuma. */
export function chamadasDoNo(c: Pick<Canvas, "nos" | "ligacoes">, no: NoDoCanvas): Chamada[] {
  const d = no.dados;
  const base = 3000 + tokensDe(textosDosDados(c, no)) + tokensDe(JSON.stringify(d).slice(0, 8000));
  const modeloTexto = texto(d.modelo_id, 200) || MODELO_TEXTO_PADRAO;
  const cfg = configDe(c, no);
  const motor = cfg.motor || MODELO_IMAGEM_PADRAO;
  const refs = entradasDo(c, no.id).filter((n) => SAIDA_DO_TIPO[n.tipo] === "imagens").length + (gravityDe(c, no)?.referencias.length || 0);
  const img = (n: number): Chamada => ({ tipo: "imagem", modelo_id: motor, tokens_entrada: 800, tokens_saida: 0, imagens: n, qualidade: cfg.qualidade, imagens_entrada: Math.min(refs, 4) });
  switch (no.tipo) {
    case "agente":
    case "copy":
    case "anuncio":
    case "landing":
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base, tokens_saida: SAIDA_ESPERADA[no.tipo], imagens: 0, qualidade: null }];
    // 20/10: o motor da casa (Arte rápida do Estúdio): a direção do diretor de arte, a imagem de cada lâmina e
    // a conferência (leitura do texto e identidade) de cada uma. Resultado com quantidade N = N artes.
    case "imagem":
    case "carrossel": {
      const n = no.tipo === "carrossel" ? limitar(d.laminas, 2, MAX_LAMINAS, 5) : Math.min(4, cfg.quantidade);
      if (no.tipo === "carrossel" && texto(d.modelo_id, 200).trim()) {
        return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base, tokens_saida: SAIDA_ESPERADA.carrossel, imagens: 0, qualidade: null }, img(n)];
      }
      const artes = no.tipo === "carrossel" ? 1 : n;
      return [
        { tipo: "texto", modelo_id: modeloTexto, tokens_entrada: artes * (TOKENS_DO_ESTUDIO.direcao_entrada + base) + n * TOKENS_DO_ESTUDIO.por_lamina_entrada, tokens_saida: artes * TOKENS_DO_ESTUDIO.direcao_saida + n * TOKENS_DO_ESTUDIO.por_lamina_saida, imagens: 0, qualidade: null },
        img(n),
        { tipo: "texto", modelo_id: modeloTexto, tokens_entrada: n * TOKENS_DO_ESTUDIO.conferencia_entrada, tokens_saida: n * TOKENS_DO_ESTUDIO.conferencia_saida, imagens: 0, qualidade: null, imagens_entrada: n } as Chamada,
      ];
    }
    case "logo":
      return [img(limitar(d.n, 1, MAX_LOGOS, 4))];
    case "oferta":
    case "funil":
    case "avatar":
    case "order_bump":
    case "upsell":
    case "downsell":
    case "sequencia_ofertas":
    case "secoes_pagina":
    case "sequencia_mensagens":
    case "refino_tom":
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base, tokens_saida: SAIDA_ESPERADA[no.tipo], imagens: 0, qualidade: null }];
    case "pesquisa":
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base + TOKENS_DAS_PAGINAS, tokens_saida: SAIDA_ESPERADA.pesquisa, imagens: 0, qualidade: null, buscas_web: BUSCAS_DA_PESQUISA }];
    case "filme":
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: TOKENS_DOS_STORYBOARDS.entrada + tokensDe(textosDosDados(c, no)), tokens_saida: TOKENS_DOS_STORYBOARDS.saida, imagens: 0, qualidade: null }];
    // v4: uma chamada de texto (a página sai de modelo fixo com o texto dela).
    case "pagina":
    case "checkout":
    case "quiz":
    case "webinar":
    case "automacao":
    case "email":
    case "whatsapp":
    case "area_membros":
    case "recuperacao":
      if (no.tipo === "area_membros" && (!d.plataforma || d.plataforma === "painel")) return [];
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base, tokens_saida: SAIDA_ESPERADA[no.tipo], imagens: 0, qualidade: null }];
    case "referencias": {
      const links = linksDasReferencias(d.links).length;
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base + links * TOKENS_POR_REFERENCIA, tokens_saida: SAIDA_ESPERADA.referencias, imagens: 0, qualidade: null }];
    }
    case "ugc":
      // Roteiro de cada variação + um quadro-chave (o gancho) por variação.
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base, tokens_saida: SAIDA_ESPERADA.ugc, imagens: 0, qualidade: null }, img(limitar(d.variacoes, 1, 5, 3))];
    case "influenciador":
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base, tokens_saida: SAIDA_ESPERADA.influenciador, imagens: 0, qualidade: null }, img(limitar(d.poses, 1, 8, 4))];
    case "template_designer":
      // As camadas saem do texto; a imagem é só o fundo (o texto da arte fica editável, sem gastar).
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base, tokens_saida: SAIDA_ESPERADA.template_designer, imagens: 0, qualidade: null }, img(1)];
    default:
      // contexto, mídia, config, gravity, agente externo e Pôr no ar: sem chamada paga.
      return [];
  }
}

export type PrecoDaChamada = (ch: Chamada) => number;
export type CustoDoNo = { no_id: string; tipo: TipoDeNo; custo_usd: number; chamadas: Chamada[] };

/** Soma o custo por nó e o total (preço de cada chamada vem de fora: o catálogo pelo motor). */
export function somarEstimativa(c: Pick<Canvas, "nos" | "ligacoes">, ids: string[], preco: PrecoDaChamada): { por_no: CustoDoNo[]; total_usd: number } {
  const por_no: CustoDoNo[] = [];
  let total = 0;
  for (const id of ids) {
    const no = c.nos.find((n) => n.id === id);
    if (!no || !ehExecutavel(no.tipo)) continue;
    const chamadas = chamadasDoNo(c, no);
    const custo = arred(chamadas.reduce((s, ch) => s + preco(ch), 0));
    total += custo;
    por_no.push({ no_id: id, tipo: no.tipo, custo_usd: custo, chamadas });
  }
  return { por_no, total_usd: arred(total) };
}

export const arred = (v: number) => Math.round((Number(v) || 0) * 1e6) / 1e6;

// ------------------------------------------------------------------ workspace (caminhos)

export const RAIZ_DO_LABORATORIO = "Laboratório";
export const PASTA_DOS_LIVRES = "Livres";

export function nomeLimpo(t: unknown, reserva = "Sem nome"): string {
  const s = String(t ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  return s || reserva;
}

/** Laboratório / <Livres | Nome do cliente> / <projeto>. */
export function pastasDoLaboratorio(nomeDoCliente: string | null, nomeDoProjeto: string): string[] {
  return [RAIZ_DO_LABORATORIO, nomeDoCliente ? nomeLimpo(nomeDoCliente, "Cliente") : PASTA_DOS_LIVRES, nomeLimpo(nomeDoProjeto, "Projeto")];
}

const EXTENSAO_DO_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "text/html": "html", "application/json": "json" };
export const extensaoDe = (mime: string) => EXTENSAO_DO_MIME[String(mime || "").toLowerCase()] || "bin";

/** Caminho no bucket workspace (escopo global; a política deixa a equipe ler global/...). */
export function caminhoNoBucket(projetoId: string, execucaoId: string, indice: number, mime: string): string {
  return `global/laboratorio/${projetoId}/${execucaoId}-${String(indice + 1).padStart(2, "0")}.${extensaoDe(mime)}`;
}

/** "Resultado 01.png", "Logo v2 03.png", "Landing.html". */
export function nomeDoArquivo(rotulo: string, indice: number, total: number, mime: string): string {
  const base = nomeLimpo(rotulo, "Arquivo").slice(0, 80);
  return total > 1 ? `${base} ${String(indice + 1).padStart(2, "0")}.${extensaoDe(mime)}` : `${base}.${extensaoDe(mime)}`;
}

/** Duas pastas são a mesma: nome sem acento e sem caixa. */
export const nomeNormal = (t: string) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ------------------------------------------------------------------ operações do planejar

export const OPERACOES = ["criar", "ligar", "desligar", "definir", "remover", "organizar"] as const;
export type NomeDaOperacao = typeof OPERACOES[number];
export type Operacao = {
  op: string;
  /** criar: apelido do nó novo (o agente usa nas ligações seguintes). */
  ref?: string;
  tipo?: string;
  dados?: Record<string, unknown>;
  x?: number;
  y?: number;
  /** definir, remover: o nó (id ou apelido). */
  no?: string;
  /** ligar, desligar. */
  de?: string;
  para?: string;
  /** ligar (v4): o gatilho do funil no fio (GATILHOS_DA_ORIGEM da origem). */
  gatilho?: string;
};
/** Recibo de cada operação; `operacao` é a operação já com os ids reais (aceita) ou como veio (recusada). */
export type Recibo = { indice: number; op: string; aceita: boolean; recibo: string; no_id?: string; ligacao_id?: string; operacao?: unknown };

/** Campos que cada tipo aceita em `dados` (o resto é ignorado com aviso). */
export const CAMPOS_DO_TIPO: Record<TipoDeNo, readonly string[]> = {
  contexto: ["titulo", "texto", "arquivos"],
  midia: ["titulo", "imagens", "midias"],
  config: ["titulo", "proporcao", "quantidade", "qualidade", "motor"],
  gravity: ["titulo", "prompt_base", "referencias"],
  agente: ["titulo", "instrucao", "modelo_id", "arquivos", "papel"],
  copy: ["titulo", "formato", "instrucao", "modelo_id"],
  imagem: ["titulo", "prompt", "quantidade", "qualidade", "proporcao", "motor"],
  carrossel: ["titulo", "tema", "laminas", "modelo_id", "motor", "qualidade", "proporcao"],
  logo: ["titulo", "nome", "conceito", "paleta", "estilo", "n", "motor", "qualidade"],
  landing: ["titulo", "objetivo", "secoes", "modelo_id"],
  anuncio: ["titulo", "objetivo", "publico", "oferta", "modelo_id"],
  agente_externo: ["titulo", "operador", "instrucao"],
  pesquisa: ["titulo", "tema", "modelo_id"],
  oferta: ["titulo", "produto", "preco", "instrucao", "modelo_id"],
  funil: ["titulo", "objetivo", "modelo_id"],
  filme: ["titulo", "ideia", "formato", "modelo_id"],
  por_no_ar: ["titulo", "alvo", "operador", "instrucao"],
  avatar: ["titulo", "publico", "instrucao", "modelo_id"],
  order_bump: ["titulo", "produto", "preco", "instrucao", "modelo_id"],
  upsell: ["titulo", "produto", "preco", "instrucao", "modelo_id"],
  downsell: ["titulo", "produto", "preco", "instrucao", "modelo_id"],
  sequencia_ofertas: ["titulo", "instrucao", "modelo_id"],
  secoes_pagina: ["titulo", "tipo_pagina", "objetivo", "instrucao", "modelo_id"],
  sequencia_mensagens: ["titulo", "canal", "mensagens", "objetivo", "instrucao", "modelo_id"],
  refino_tom: ["titulo", "tom", "instrucao", "modelo_id"],
  // v4 (ESPEC-LABORATORIO-v4.md, seção 2).
  marca: ["titulo", "paleta", "tom", "fontes", "logo", "regras", "marca_id"],
  cliente: ["titulo", "foco", "client_id"],
  referencias: ["titulo", "links", "imagens", "o_que_aproveitar", "modelo_id"],
  video: ["titulo", "arquivos", "link", "transcricao"],
  arquivo: ["titulo", "arquivos", "uso"],
  produto: ["titulo", "nome", "entregavel", "formato_produto", "preco", "link_externo"],
  pagina: ["titulo", "tipo_pagina", "caminho", "objetivo", "instrucao", "modelo_id"],
  checkout: ["titulo", "gateway", "link_pagamento", "produto_externo_id", "order_bump", "upsell", "caminho", "garantia", "modelo_id"],
  quiz: ["titulo", "objetivo", "perguntas", "faixas", "captura", "caminho", "modelo_id"],
  webinar: ["titulo", "tema", "modo", "data", "link_video", "minuto_oferta", "encerramento", "caminho", "modelo_id"],
  dominio: ["titulo", "dominio", "subdominio", "estrutura", "registrador", "redirecionamentos"],
  teste_ab: ["titulo", "pesos", "variavel", "metrica", "limite", "caminho"],
  automacao: ["titulo", "quando", "condicoes", "espera", "objetivo_saida", "horario", "modelo_id"],
  email: ["titulo", "tipo_email", "mensagens", "remetente", "objetivo", "modelo_id"],
  whatsapp: ["titulo", "via", "tipo_mensagem", "mensagens", "categoria", "objetivo", "modelo_id"],
  area_membros: ["titulo", "plataforma", "modulos", "aulas_por_modulo", "liberacao", "modelo_id", "produto_membros_id"],
  ugc: ["titulo", "estilo_ugc", "duracao", "variacoes", "instrucao", "modelo_id", "motor", "qualidade", "proporcao"],
  influenciador: ["titulo", "nome", "aparencia", "estilo", "poses", "motor", "qualidade", "modelo_id"],
  template_designer: ["titulo", "formato_arte", "estilo", "campos_variaveis", "lote", "motor", "qualidade", "modelo_id"],
  crm: ["titulo", "pipeline", "etapa", "temperatura", "responsavel", "crm_origem", "produto_crm_id"],
  recuperacao: ["titulo", "situacao", "via", "toques", "modelo_id"],
  fontes_trafego: ["titulo", "canais", "url_base", "campanha"],
};

/**
 * 20/10 (nós inteligentes): todo nó aceita `auto` (roda sozinho no no_executar automatico quando o custo
 * cabe no teto do projeto, config.auto_ate_usd). O valor é booleano; o resto é ignorado.
 */
for (const t of Object.keys(CAMPOS_DO_TIPO) as TipoDeNo[]) {
  if (CAMPOS_DO_TIPO[t].indexOf("auto") < 0) CAMPOS_DO_TIPO[t] = CAMPOS_DO_TIPO[t].concat(["auto"]);
}

/**
 * 20/10: a imagem principal escolhida na tela (dados.principal, índice na saída do nó) nos nós que geram imagem.
 * Nos nós seguintes ela vai à frente (ou sozinha onde o nó usa uma imagem só).
 */
export const TIPOS_COM_PRINCIPAL: readonly TipoDeNo[] = ["imagem", "carrossel", "anuncio", "template_designer", "influenciador", "ugc", "logo"];
export const MAX_PRINCIPAL = 39;
for (const t of TIPOS_COM_PRINCIPAL) {
  if (CAMPOS_DO_TIPO[t].indexOf("principal") < 0) CAMPOS_DO_TIPO[t] = CAMPOS_DO_TIPO[t].concat(["principal"]);
}

/**
 * As imagens de um nó na ordem de uso: a principal (dados.principal) primeiro; sem ela, a escolha do Jev
 * (saida.escolha.indice, na logo); sem nada, como vieram. Índice fora da lista não muda nada.
 */
export function imagensComPrincipal<T>(no: { tipo: string; dados: Record<string, unknown> }, imagens: T[], escolha?: unknown): T[] {
  const lista = Array.isArray(imagens) ? imagens.slice() : [];
  const pedido = (TIPOS_COM_PRINCIPAL as readonly string[]).indexOf(no.tipo) >= 0 ? no.dados.principal : undefined;
  const doJev = escolha && typeof escolha === "object" ? Number((escolha as Record<string, unknown>).indice) : NaN;
  const i = Number.isInteger(pedido) ? Number(pedido) : Number.isInteger(doJev) ? doJev : -1;
  if (i <= 0 || i >= lista.length) return lista;
  return [lista[i]].concat(lista.slice(0, i), lista.slice(i + 1));
}

/** Mídia enviada no nó Mídia (imagem ou vídeo mp4, mov, webm; até 8). */
export const MAX_MIDIAS = 8;
export type MidiaDoNo = { id: string; tipo: "imagem" | "video"; url: string; path: string; nome: string; bucket?: string; capa?: string };

/** Papel do nó Agente (a tela: CorpoEspecial.tsx, PAPEIS). Vai numa linha curta do texto de sistema. */
export const PAPEIS_DO_AGENTE = ["estrategista", "copywriter", "pesquisador", "diretor_arte", "revisor"] as const;
export const ROTULO_DO_PAPEL: Record<typeof PAPEIS_DO_AGENTE[number], string> = {
  estrategista: "estrategista do projeto (posicionamento, público, promessa e próximos passos)",
  copywriter: "copywriter (textos claros, gancho forte e chamada para ação, no tom da marca)",
  pesquisador: "pesquisador (mercado, público e concorrentes; aponta o que falta confirmar)",
  diretor_arte: "diretor de arte (cores, luz, composição e tipografia das peças)",
  revisor: "revisor (corrige e simplifica, marca o que precisa de fonte, sem mudar fatos nem preços)",
};
const UUID_DO_CLIENTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSOES_DE_VIDEO = /\.(mp4|mov|webm)$/i;

/** Lê `dados.midias` (forma do contrato), descartando o que não é imagem nem vídeo mp4/mov/webm. */
export function midiasDe(bruto: unknown): MidiaDoNo[] {
  if (!Array.isArray(bruto)) return [];
  const saida: MidiaDoNo[] = [];
  for (const item of bruto) {
    const o = objeto(item);
    const tipo = o.tipo === "video" ? "video" : o.tipo === "imagem" ? "imagem" : null;
    const path = texto(o.path, 500);
    const nome = texto(o.nome, 200) || path.split("/").pop() || "";
    // Da biblioteca do cliente (fontes_do_cliente) vem só o link https, sem caminho no storage.
    const url = texto(o.url, 2000);
    const urlOk = /^https:\/\//i.test(url);
    if (!tipo || (!path && !urlOk) || path.indexOf("..") >= 0) continue;
    if (tipo === "video" && !EXTENSOES_DE_VIDEO.test(path) && !EXTENSOES_DE_VIDEO.test(nome) && !EXTENSOES_DE_VIDEO.test(url.split("?")[0])) continue;
    const capa = texto(o.capa, 2000);
    saida.push({ id: texto(o.id, 80) || path || url, tipo, url, path, nome, ...(typeof o.bucket === "string" && o.bucket ? { bucket: texto(o.bucket, 60) } : {}), ...(capa ? { capa } : {}) });
    if (saida.length >= MAX_MIDIAS) break;
  }
  return saida;
}

/**
 * v4: valores aceitos nos campos de escolha dos nós novos (a tela tem os rótulos em nos.ts; o teste de
 * contrato confere que os valores batem). Valor fora da lista é ignorado com aviso.
 */
export const OPCOES_V4: Record<string, readonly string[]> = {
  formato_produto: ["curso", "mentoria", "servico", "fisico", "assinatura", "ebook"],
  uso: ["contexto", "dados_produto", "depoimentos", "planilha"],
  gateway: ["hotmart", "kiwify", "stripe", "mercadopago", "asaas", "outro"],
  captura: ["inicio", "antes_resultado", "fim"],
  modo: ["gravado", "ao_vivo", "just_in_time"],
  encerramento: ["classico", "replay", "ultima_chamada", "proximos_passos"],
  estrutura: ["dominio_por_oferta", "subdominio", "caminho"],
  registrador: ["registro_br", "godaddy", "hostinger", "cloudflare", "outro"],
  variavel: ["titulo", "oferta", "imagem", "pagina_inteira"],
  metrica: ["lead", "compra", "clique"],
  limite: ["data", "visitas", "sem_limite"],
  quando: ["formulario", "quiz", "compra_aprovada", "carrinho_abandonado", "pix_gerado", "lead_parado", "inscrito_webinar"],
  objetivo_saida: ["comprou", "respondeu", "atendente"],
  horario: ["sim", "nao"],
  tipo_email: ["unico", "sequencia", "lembrete_webinar", "recuperacao"],
  via: ["email", "whatsapp", "ambos", "cloud_api", "evolution"],
  tipo_mensagem: ["dentro_janela", "modelo"],
  categoria: ["utilidade", "marketing", "autenticacao"],
  plataforma: ["painel", "hotmart_club", "kiwify", "memberkit", "cademi", "outra", "pagina_simples"],
  crm_origem: ["agencia", "cliente"],
  liberacao: ["tudo", "por_dia"],
  estilo_ugc: ["depoimento", "unboxing", "antes_depois", "problema_solucao", "reacao"],
  formato_arte: ["post_1_1", "feed_4_5", "story_9_16", "carrossel", "capa_reel", "banner"],
  lote: ["nao", "planilha"],
  situacao: ["carrinho_abandonado", "pix_pendente", "boleto_vencido", "cartao_recusado"],
};
/** Tipo da Página do funil (v4); o das Seções da página continua em TIPOS_DE_PAGINA. */
export const TIPOS_DA_PAGINA_DO_FUNIL = ["captura", "vendas", "obrigado", "presell", "vsl", "inscricao", "agendar", "upsell", "downsell", "termos", "institucional"] as const;
/** Objetivo da Página do funil (v4). */
export const OBJETIVOS_DA_PAGINA = ["vender", "capturar", "agendar", "inscrever", "whatsapp"] as const;
/** Limites dos números dos nós novos: [mín, máx, padrão]. */
export const NUMEROS_V4: Record<string, [number, number, number]> = {
  perguntas: [3, 12, 6],
  modulos: [1, 12, 4],
  aulas_por_modulo: [1, 15, 4],
  duracao: [8, 45, 20],
  variacoes: [1, 5, 3],
  poses: [1, 8, 4],
  toques: [1, 3, 3],
};

export const FORMATOS_DE_COPY = ["anuncio", "legenda", "landing", "email", "roteiro_curto"] as const;
/** Tipo de página das Seções da página (v3). */
export const TIPOS_DE_PAGINA = ["captura", "vendas", "aplicacao", "inscricao", "webinar", "obrigado", "checkout", "upsell"] as const;
/** Canal da Sequência de mensagens (v3). */
export const CANAIS_DE_MENSAGEM = ["whatsapp", "email", "ambos"] as const;
export const MAX_MENSAGENS = 15;
/** Formatos do filme (FORMATOS_DO_MOTION da Mesa Motion) e "ambos" = 16:9 + 9:16 (o padrão). */
export const FORMATOS_DO_FILME = ["ambos", "16:9", "9:16", "1:1", "4:5"] as const;
export const formatosDoFilme = (v: unknown): string[] => {
  const f = (FORMATOS_DO_FILME as readonly string[]).indexOf(String(v)) >= 0 ? String(v) : "ambos";
  return f === "ambos" ? ["16:9", "9:16"] : [f];
};

/** Para onde o Pôr no ar leva o pacote. O anúncio sempre sobe PAUSADO; verba e ativação são do dono. */
export const ALVOS_NO_AR = ["publicar_site", "subir_anuncio_pausado", "conectar_pagina", "ligar_mensagens", "outro"] as const;
export type AlvoNoAr = typeof ALVOS_NO_AR[number];
export const alvoValido = (v: unknown): AlvoNoAr | null => ((ALVOS_NO_AR as readonly string[]).indexOf(String(v)) >= 0 ? v as AlvoNoAr : null);

/**
 * action_kind do pedido de aprovação (vocabulário fechado de operator_approvals, migration 20260829010000).
 * Não existe "subir anúncio pausado" no catálogo: o mais perto é "publicar" (criar a peça na conta,
 * sem ativar nem gastar). "ativar_campanha" e "alterar_orcamento" ficam para o dono, fora daqui.
 * Ligar página do Facebook/Instagram à BM mexe em acesso de ativo: "alterar_permissoes".
 */
export const ACAO_DO_ALVO: Record<AlvoNoAr, string> = {
  publicar_site: "publicar",
  subir_anuncio_pausado: "publicar",
  conectar_pagina: "alterar_permissoes",
  // v4: ligar a automação e as sequências de e-mail/WhatsApp (o envio a leads só começa depois do sim do dono).
  ligar_mensagens: "enviar_mensagem",
  outro: "publicar",
};

/** Limpa `dados` para o tipo: campos conhecidos, texto curto, número no intervalo. Devolve também o que foi ignorado. */
export function dadosDoTipo(tipo: TipoDeNo, bruto: unknown): { dados: Record<string, unknown>; ignorados: string[] } {
  const o = objeto(bruto);
  const permitidos = CAMPOS_DO_TIPO[tipo];
  const dados: Record<string, unknown> = {};
  const ignorados: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (permitidos.indexOf(k) < 0) {
      ignorados.push(k);
      continue;
    }
    if (k === "quantidade") dados[k] = limitar(v, 1, MAX_IMAGENS_POR_NO, 1);
    else if (k === "laminas") dados[k] = limitar(v, 2, MAX_LAMINAS, 5);
    else if (k === "n") dados[k] = limitar(v, 1, MAX_LOGOS, 4);
    else if (k === "mensagens") dados[k] = tipo === "email" || tipo === "whatsapp" ? limitar(v, 1, 10, 3) : limitar(v, 2, MAX_MENSAGENS, 5);
    else if (k === "tipo_pagina") { if (((tipo === "pagina" ? TIPOS_DA_PAGINA_DO_FUNIL : TIPOS_DE_PAGINA) as readonly string[]).indexOf(String(v)) >= 0) dados[k] = v; else ignorados.push(k); }
    // v4: escolhas, números e listas dos nós novos.
    else if (k === "objetivo" && tipo === "pagina") { if ((OBJETIVOS_DA_PAGINA as readonly string[]).indexOf(String(v)) >= 0) dados[k] = v; else ignorados.push(k); }
    else if (OPCOES_V4[k]) { if (OPCOES_V4[k].indexOf(String(v)) >= 0) dados[k] = v; else ignorados.push(k); }
    else if (NUMEROS_V4[k]) dados[k] = limitar(v, NUMEROS_V4[k][0], NUMEROS_V4[k][1], NUMEROS_V4[k][2]);
    else if (k === "logo") { if (Array.isArray(v)) dados[k] = v.slice(0, 4); else ignorados.push(k); }
    else if (k === "canal") { if ((CANAIS_DE_MENSAGEM as readonly string[]).indexOf(String(v)) >= 0) dados[k] = v; else ignorados.push(k); }
    else if (k === "proporcao") { const p = proporcaoValida(v); if (p) dados[k] = p; else ignorados.push(k); }
    else if (k === "qualidade") { const q = qualidadeValida(v); if (q) dados[k] = q; else ignorados.push(k); }
    else if (k === "formato") {
      const lista: readonly string[] = tipo === "filme" ? FORMATOS_DO_FILME : FORMATOS_DE_COPY;
      if (lista.indexOf(String(v)) >= 0) dados[k] = v;
      else ignorados.push(k);
    }
    else if (k === "alvo") { if (alvoValido(v)) dados[k] = v; else ignorados.push(k); }
    else if (k === "auto") { if (typeof v === "boolean") dados[k] = v; else ignorados.push(k); }
    else if (k === "midias") { if (Array.isArray(v)) dados[k] = midiasDe(v); else ignorados.push(k); }
    else if (k === "client_id") { if (typeof v === "string" && UUID_DO_CLIENTE.test(v.trim())) dados[k] = v.trim().toLowerCase(); else ignorados.push(k); }
    else if (k === "marca_id") { if (typeof v === "string" && UUID_DO_CLIENTE.test(v.trim())) dados[k] = v.trim().toLowerCase(); else ignorados.push(k); }
    else if (k === "principal") { const n = Number(v); if (typeof v === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_PRINCIPAL) dados[k] = n; else ignorados.push(k); }
    else if (k === "papel") { if ((PAPEIS_DO_AGENTE as readonly string[]).indexOf(String(v)) >= 0) dados[k] = v; else ignorados.push(k); }
    else if (k === "imagens" || k === "referencias") { if (Array.isArray(v)) dados[k] = v.slice(0, 12); else ignorados.push(k); }
    // Documentos do nó (Contexto, Agente): a leitura e o teto ficam em laboratorio/documentos.ts.
    else if (k === "arquivos") { if (Array.isArray(v)) dados[k] = v.slice(0, 8); else ignorados.push(k); }
    else if (typeof v === "string") dados[k] = v.slice(0, MAX_TEXTO);
    else if (typeof v === "number" && Number.isFinite(v)) dados[k] = v;
    else ignorados.push(k);
  }
  return { dados, ignorados };
}

/** Colunas pela profundidade (maior caminho até o nó), linhas na ordem do canvas. */
export function organizar(c: Canvas): Canvas {
  let ordem: string[];
  try {
    ordem = ordemTopologica(c);
  } catch {
    return c;
  }
  const profundidade = new Map<string, number>();
  for (const id of ordem) {
    const antes = c.ligacoes.filter((l) => l.para === id).map((l) => (profundidade.get(l.de) ?? 0) + 1);
    profundidade.set(id, antes.length ? Math.max(...antes) : 0);
  }
  const linhas = new Map<number, number>();
  const nos = c.nos.map((n) => {
    const col = profundidade.get(n.id) ?? 0;
    const linha = linhas.get(col) ?? 0;
    linhas.set(col, linha + 1);
    return { ...n, x: 80 + col * 320, y: 80 + linha * 180 };
  });
  return { ...c, nos };
}

// ------------------------------------------------------------------ projeto completo (v2)

/** As colunas do projeto completo, da esquerda para a direita (ESPEC-LABORATORIO-v2.md). */
export const ETAPAS_DO_PROJETO = [
  { id: "pesquisa", titulo: "Pesquisa" },
  { id: "oferta", titulo: "Oferta" },
  { id: "conteudo", titulo: "Conteúdo" },
  { id: "pagina", titulo: "Página" },
  { id: "criativos", titulo: "Criativos" },
  { id: "anuncios", titulo: "Anúncios" },
  { id: "no_ar", titulo: "Pôr no ar" },
] as const;

/**
 * Coluna de cada tipo. Configurações e Base comum não têm coluna própria: ficam na coluna do
 * primeiro nó que elas alimentam (null). Logo de marca nova vai com a oferta (antes do conteúdo).
 */
export const ETAPA_DO_TIPO: Record<TipoDeNo, number | null> = {
  contexto: 0,
  midia: 0,
  pesquisa: 0,
  oferta: 1,
  funil: 1,
  logo: 1,
  agente: 2,
  copy: 2,
  carrossel: 2,
  landing: 3,
  imagem: 4,
  filme: 4,
  config: null,
  gravity: null,
  anuncio: 5,
  por_no_ar: 6,
  agente_externo: 6,
  avatar: 1,
  order_bump: 1,
  upsell: 1,
  downsell: 1,
  sequencia_ofertas: 1,
  sequencia_mensagens: 2,
  refino_tom: 2,
  secoes_pagina: 3,
  // v4: entradas na primeira coluna; páginas do funil na de Página; mensagens e CRM na de Anúncios.
  marca: 0,
  cliente: 0,
  referencias: 0,
  video: 0,
  arquivo: 0,
  produto: 1,
  influenciador: 2,
  fontes_trafego: 2,
  pagina: 3,
  checkout: 3,
  quiz: 3,
  webinar: 3,
  teste_ab: 3,
  area_membros: 3,
  ugc: 4,
  template_designer: 4,
  crm: 5,
  automacao: 5,
  email: 5,
  whatsapp: 5,
  recuperacao: 5,
  dominio: 6,
};

/** Teto de nós que o planejar cria num projeto completo (o canvas inteiro continua em MAX_NOS). */
export const MAX_NOS_DO_PROJETO_COMPLETO = 40;
/** Projeto completo: operações por resposta (40 nós + as ligações + definir + organizar). */
export const MAX_OPERACOES_DO_PROJETO_COMPLETO = 200;
export const LARGURA_DA_COLUNA = 360;
export const ALTURA_DA_LINHA = 190;

export type ColunaDoProjeto = { indice: number; etapa: string; titulo: string; x: number };

/**
 * Organiza em colunas por etapa. Uma ligação nunca volta para a esquerda: o nó fica na coluna da
 * etapa dele ou na do nó mais à direita que entra nele. Linhas na ordem do canvas.
 */
export function organizarPorEtapas(c: Canvas): { canvas: Canvas; colunas: ColunaDoProjeto[] } {
  let ordem: string[];
  try {
    ordem = ordemTopologica(c);
  } catch {
    return { canvas: c, colunas: [] };
  }
  const tipoDe = new Map(c.nos.map((n) => [n.id, n.tipo]));
  const coluna = new Map<string, number>();
  for (const id of ordem) {
    const etapa = ETAPA_DO_TIPO[tipoDe.get(id)!];
    if (etapa === null) continue;
    const antes = c.ligacoes.filter((l) => l.para === id && coluna.has(l.de)).map((l) => coluna.get(l.de)!);
    coluna.set(id, Math.max(etapa, ...antes));
  }
  // Configurações e Base comum: na coluna do primeiro nó que alimentam (sem destino: Criativos).
  for (const id of ordem) {
    if (coluna.has(id)) continue;
    const depois = c.ligacoes.filter((l) => l.de === id && coluna.has(l.para)).map((l) => coluna.get(l.para)!);
    coluna.set(id, depois.length ? Math.min(...depois) : 4);
  }
  // Só as etapas que têm nó viram coluna (sem buraco entre elas), na ordem das etapas.
  const usadas = [...new Set([...coluna.values()])].sort((a, b) => a - b);
  const xDa = (etapa: number) => 80 + usadas.indexOf(etapa) * LARGURA_DA_COLUNA;
  const linhas = new Map<number, number>();
  // Na coluna, quem só guarda dado vem primeiro (fica em cima do nó que alimenta).
  const naOrdem = c.nos.slice().sort((a, b) => Number(ETAPA_DO_TIPO[b.tipo] === null) - Number(ETAPA_DO_TIPO[a.tipo] === null));
  const posicao = new Map<string, { x: number; y: number }>();
  for (const n of naOrdem) {
    const col = coluna.get(n.id) ?? 0;
    const linha = linhas.get(col) ?? 0;
    linhas.set(col, linha + 1);
    posicao.set(n.id, { x: xDa(col), y: 120 + linha * ALTURA_DA_LINHA });
  }
  const nos = c.nos.map((n) => ({ ...n, ...posicao.get(n.id)! }));
  const colunas = usadas.map((i) => ({ indice: i, etapa: ETAPAS_DO_PROJETO[i].id, titulo: ETAPAS_DO_PROJETO[i].titulo, x: xDa(i) }));
  return { canvas: { ...c, nos }, colunas };
}

const semAcento = (t: string) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * O pedido é de montar empresa, marca, produto, funil ou lançamento? (Sem lookbehind: piso Safari 11.)
 * "Criar um post para a marca" não é: o verbo precisa vir colado no que se monta.
 */
export function ehPedidoDeProjetoCompleto(pedido: unknown): boolean {
  const t = semAcento(String(pedido ?? "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ");
  if (/\b(low ticket|lowticket|high ticket|funil de vendas?|funil completo|infoproduto|produto digital|webinar|webinario|quiz de qualificacao|funil de quiz|checkout com upsell)\b/.test(t)) return true;
  if (/\b(montar|monta|abrir|comecar|construir|criar|cria|lancar|estruturar)( (um|uma|o|a|meu|minha|nosso|nossa|novo|nova))? (empresa|negocio|marca|produto|loja|funil|ecommerce|e commerce)\b/.test(t)) return true;
  if (/\b(montar|fazer|planejar|criar|estruturar)( (um|o|meu|nosso))? lancamento\b/.test(t)) return true;
  return false;
}

const RECUSA_DE_EXECUCAO = "Não gero nem publico pelo planejar: monto o fluxo e você confirma o custo antes de rodar.";

export type OpcoesDoPlanejar = { projetoCompleto?: boolean };

/**
 * Aplica as operações do agente numa cópia do canvas, uma a uma, com recibo de cada.
 * Operação inválida não para as outras: vira recibo com o motivo. Nunca gera nem publica.
 * Projeto completo: até 40 nós novos, mais operações por resposta, e "organizar" em colunas por etapa
 * (as colunas também são aplicadas no fim, mesmo que o agente esqueça o "organizar").
 */
export function aplicarOperacoes(canvas: Canvas, ops: unknown[], opcoes: OpcoesDoPlanejar = {}): { canvas: Canvas; recibos: Recibo[]; aceitas: Operacao[]; colunas: ColunaDoProjeto[] } {
  let c: Canvas = { nos: canvas.nos.map((n) => ({ ...n, dados: { ...n.dados } })), ligacoes: canvas.ligacoes.slice(), viewport: { ...canvas.viewport } };
  const apelidos = new Map<string, string>();
  const recibos: Recibo[] = [];
  const aceitas: Operacao[] = [];
  const completo = opcoes.projetoCompleto === true;
  let colunas: ColunaDoProjeto[] = [];
  let novos = 0;
  const idDe = (ref: unknown) => {
    const s = String(ref ?? "");
    return apelidos.get(s) ?? (c.nos.some((n) => n.id === s) ? s : "");
  };
  let contador = c.nos.length;
  const lista = Array.isArray(ops) ? ops.slice(0, completo ? MAX_OPERACOES_DO_PROJETO_COMPLETO : 120) : [];
  lista.forEach((bruta, indice) => {
    const op = objeto(bruta) as Operacao;
    const nome = String(op.op || "");
    const recusar = (motivo: string) => recibos.push({ indice, op: nome || "?", aceita: false, recibo: motivo, operacao: bruta });
    const aceitar = (operacao: Operacao, r: Omit<Recibo, "indice" | "op" | "aceita" | "operacao">) => {
      aceitas.push(operacao);
      recibos.push({ indice, op: nome, aceita: true, ...r, operacao });
    };
    if ((OPERACOES as readonly string[]).indexOf(nome) < 0) {
      recusar(nome === "gerar" || nome === "publicar" || nome === "escrever" ? RECUSA_DE_EXECUCAO : `Operação desconhecida: ${nome || "(vazia)"}.`);
      return;
    }
    if (nome === "criar") {
      if (!ehTipoDeNo(op.tipo)) return recusar(`Tipo de nó desconhecido: ${String(op.tipo)}.`);
      if (c.nos.length >= MAX_NOS) return recusar(`O canvas já tem ${MAX_NOS} nós.`);
      if (completo && novos >= MAX_NOS_DO_PROJETO_COMPLETO) return recusar(`O projeto completo para em ${MAX_NOS_DO_PROJETO_COMPLETO} nós novos; peça o resto depois.`);
      novos += 1;
      const tipo = op.tipo as TipoDeNo;
      let id = "";
      do {
        contador += 1;
        id = `no_${tipo}_${contador}`;
      } while (c.nos.some((n) => n.id === id));
      const { dados, ignorados } = dadosDoTipo(tipo, op.dados);
      c = { ...c, nos: c.nos.concat([{ id, tipo, x: numero(op.x, 80 + (contador % 5) * 320), y: numero(op.y, 80 + Math.floor(contador / 5) * 180), dados }]) };
      if (op.ref) apelidos.set(String(op.ref), id);
      aceitar({ op: nome, ref: id, tipo, dados, x: c.nos[c.nos.length - 1].x, y: c.nos[c.nos.length - 1].y }, { no_id: id, recibo: `Criei ${ROTULO_DO_TIPO[tipo]}${dados.titulo ? ` "${dados.titulo}"` : ""}.${ignorados.length ? ` Ignorei: ${ignorados.join(", ")}.` : ""}` });
      return;
    }
    if (nome === "ligar") {
      const de = idDe(op.de);
      const para = idDe(op.para);
      const motivo = motivoParaNaoLigar(c, de, para);
      if (motivo) return recusar(`Não liguei: ${motivo}`);
      const ligacao: Ligacao = { id: `lig_${de}_${para}`, de, para };
      // v4: gatilho do funil (opcional); o que não vale para a origem fica de fora, com aviso no recibo.
      const origemDoFio = c.nos.find((n) => n.id === de);
      const pediuGatilho = typeof op.gatilho === "string" && op.gatilho ? op.gatilho : "";
      const gatilhoOk = !!pediuGatilho && !!origemDoFio && gatilhoValido(origemDoFio.tipo, pediuGatilho);
      if (gatilhoOk) ligacao.gatilho = pediuGatilho;
      c = { ...c, ligacoes: c.ligacoes.concat([ligacao]) };
      if (c.ligacoes.length > MAX_LIGACOES) {
        c = { ...c, ligacoes: c.ligacoes.slice(0, -1) };
        return recusar(`O canvas já tem ${MAX_LIGACOES} ligações.`);
      }
      aceitar(gatilhoOk ? { op: nome, de, para, gatilho: pediuGatilho } : { op: nome, de, para }, {
        ligacao_id: ligacao.id,
        recibo: `Liguei ${rotulo(c, de)} → ${rotulo(c, para)}${gatilhoOk ? ` (quando: ${ROTULO_DO_GATILHO[pediuGatilho as Gatilho]})` : ""}.${pediuGatilho && !gatilhoOk ? ` Ignorei o gatilho "${pediuGatilho}": não vale para essa origem.` : ""}`,
      });
      return;
    }
    if (nome === "desligar") {
      const de = idDe(op.de);
      const para = idDe(op.para);
      const l = c.ligacoes.find((x) => x.de === de && x.para === para);
      if (!l) return recusar("Não desliguei: essa ligação não existe.");
      c = { ...c, ligacoes: c.ligacoes.filter((x) => x !== l) };
      aceitar({ op: nome, de, para }, { ligacao_id: l.id, recibo: `Desliguei ${rotulo(c, de)} → ${rotulo(c, para)}.` });
      return;
    }
    if (nome === "definir") {
      const id = idDe(op.no);
      const no = c.nos.find((n) => n.id === id);
      if (!no) return recusar("Não defini: o nó não existe.");
      const { dados, ignorados } = dadosDoTipo(no.tipo, op.dados);
      if (!Object.keys(dados).length) return recusar(`Não defini: nenhum campo vale para ${ROTULO_DO_TIPO[no.tipo]}.`);
      c = { ...c, nos: c.nos.map((n) => (n.id === id ? { ...n, dados: { ...n.dados, ...dados } } : n)) };
      aceitar({ op: nome, no: id, dados }, { no_id: id, recibo: `Ajustei ${rotulo(c, id)}: ${Object.keys(dados).join(", ")}.${ignorados.length ? ` Ignorei: ${ignorados.join(", ")}.` : ""}` });
      return;
    }
    if (nome === "remover") {
      const id = idDe(op.no);
      if (!id) return recusar("Não removi: o nó não existe.");
      const r = rotulo(c, id);
      c = { ...c, nos: c.nos.filter((n) => n.id !== id), ligacoes: c.ligacoes.filter((l) => l.de !== id && l.para !== id) };
      aceitar({ op: nome, no: id }, { no_id: id, recibo: `Removi ${r} e as ligações dele.` });
      return;
    }
    // organizar
    if (completo) {
      const r = organizarPorEtapas(c);
      c = r.canvas;
      colunas = r.colunas;
      aceitar({ op: "organizar" }, { recibo: `Organizei em colunas por etapa: ${r.colunas.map((x) => x.titulo).join(" → ")}.` });
      return;
    }
    c = organizar(c);
    aceitar({ op: "organizar" }, { recibo: "Organizei os nós em colunas, na ordem do fluxo." });
  });
  if (completo) {
    const r = organizarPorEtapas(c);
    c = r.canvas;
    colunas = r.colunas;
    // A tela aplica as operações em ordem (com a animação de construção): cada "criar" já leva a
    // posição final na coluna da etapa, e "organizar" leva as posições e as colunas.
    const posicoes: Record<string, { x: number; y: number }> = {};
    for (const n of c.nos) posicoes[n.id] = { x: n.x, y: n.y };
    for (const r2 of recibos) {
      if (!r2.aceita || !r2.operacao || typeof r2.operacao !== "object") continue;
      const o = r2.operacao as Operacao & { modo?: string; posicoes?: unknown; colunas?: unknown };
      if (r2.op === "criar" && o.ref && posicoes[o.ref]) {
        o.x = posicoes[o.ref].x;
        o.y = posicoes[o.ref].y;
      }
      if (r2.op === "organizar") {
        o.modo = "etapas";
        o.posicoes = posicoes;
        o.colunas = colunas;
      }
    }
  }
  return { canvas: c, recibos, aceitas, colunas };
}

function rotulo(c: Canvas, id: string): string {
  const n = c.nos.find((x) => x.id === id);
  if (!n) return id;
  const t = typeof n.dados.titulo === "string" && n.dados.titulo ? ` "${n.dados.titulo}"` : "";
  return `${ROTULO_DO_TIPO[n.tipo] || n.tipo}${t}`;
}

/** Esquema JSON da resposta do planejar (o motor pede ao modelo). */
export const ESQUEMA_DO_PLANEJAR = {
  nome: "plano_do_laboratorio",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resposta", "operacoes"],
    properties: {
      resposta: { type: "string" },
      operacoes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          // Structured outputs da OpenAI (inclusive pelo OpenRouter) exigem todas
          // as propriedades em required. O vazio mantém os campos sem uso neutros
          // para o parser e também é aceito pela Anthropic, sem uniões com null.
          required: ["op", "ref", "tipo", "no", "de", "para", "gatilho", "dados_json"],
          description: 'Preencha os campos que a operação usa. Nos demais, envie ""; em dados_json sem dados, envie "{}".',
          properties: {
            op: { type: "string", enum: [...OPERACOES] },
            ref: { type: "string" },
            tipo: { type: "string", enum: [...TIPOS_DE_NO, ""] },
            no: { type: "string" },
            de: { type: "string" },
            para: { type: "string" },
            /** ligar (v4): o gatilho do funil no fio. */
            gatilho: { type: "string", enum: [...GATILHOS, ""] },
            /** Os campos do nó em JSON (texto): objeto livre não passa no esquema estrito da Anthropic. */
            dados_json: { type: "string" },
          },
        },
      },
    },
  },
} as const;

/** Lê a resposta do modelo: { resposta, operacoes[] } com tolerância a campos faltando. */
export function lerPlano(json: unknown, textoBruto: string): { resposta: string; operacoes: unknown[] } {
  const o = objeto(json);
  const resposta = typeof o.resposta === "string" && o.resposta.trim() ? o.resposta.trim() : textoBruto.trim();
  const operacoes = (Array.isArray(o.operacoes) ? o.operacoes : []).map((bruta) => {
    const op = { ...objeto(bruta) };
    if (typeof op.dados_json === "string" && op.dados === undefined) {
      try {
        op.dados = objeto(JSON.parse(op.dados_json));
      } catch {
        op.dados = {};
      }
    }
    delete op.dados_json;
    return op;
  });
  return { resposta: resposta.slice(0, 6000), operacoes };
}

/** Resumo do canvas para o agente (ids, tipos, títulos, ligações): é o que ele pode referenciar. */
export function resumoDoCanvas(c: Canvas): string {
  if (!c.nos.length) return "Canvas vazio.";
  const nos = c.nos.map((n) => `- ${n.id} (${n.tipo})${n.dados.titulo ? ` "${String(n.dados.titulo).slice(0, 60)}"` : ""}: ${JSON.stringify(n.dados).slice(0, 300)}`);
  const ligs = c.ligacoes.map((l) => `- ${l.de} → ${l.para}${l.gatilho ? ` [${l.gatilho}]` : ""}`);
  return `NÓS:\n${nos.join("\n")}\nLIGAÇÕES:\n${ligs.join("\n") || "(nenhuma)"}`;
}

/** As regras de ligação em texto, para o prompt do planejar. */
export function regrasEmTexto(): string {
  const gatilhos = ORIGENS_COM_GATILHO.map((t) => `- saindo de ${t}: ${gatilhosDe(t).join(", ")}`);
  return [
    regrasDosTipos(),
    'GATILHOS NO FIO (campo "gatilho" do ligar; opcional; só nas ligações que saem destes nós):',
    ...gatilhos,
  ].join("\n");
}

function regrasDosTipos(): string {
  return TIPOS_DE_NO.map((t) => `- ${t} (${ROTULO_DO_TIPO[t]}): recebe ${ENTRADAS_ACEITAS[t].length ? ENTRADAS_ACEITAS[t].join(", ") : "nada"}; campos: ${CAMPOS_DO_TIPO[t].join(", ")}`).join("\n");
}

// ------------------------------------------------------------------ v3: regra contra invenção

/**
 * Prova social e números (depoimento, resultado, estatística, garantia específica) que o nó escreveu sem
 * fonte nos dados ligados viram blocos `rascunho_sem_fonte` na saída. O nó Pôr no ar fica TRAVADO enquanto
 * algum nó antes dele tiver bloco sem fonte não resolvido (o dono marca "fonte confirmada" ou edita).
 */
export const TIPOS_DE_BLOCO = ["depoimento", "resultado", "estatistica", "garantia", "outro"] as const;
export type TipoDeBloco = typeof TIPOS_DE_BLOCO[number];
export type BlocoSemFonte = {
  id: string;
  tipo: TipoDeBloco;
  /** O trecho como está na peça (ou o texto do marcador, quando veio por ele). */
  texto: string;
  /** Onde está na peça (seção, mensagem 3, título...). */
  onde: string;
  /** O marcador exato no texto, quando veio por ele (a edição troca por aqui). */
  marcador?: string;
  confirmado: boolean;
  /** "fonte" (o dono disse de onde veio) ou "editado" (o dono trocou o texto). */
  como?: "fonte" | "editado";
  fonte?: string;
  texto_novo?: string;
  resolvido_por?: string;
  resolvido_em?: string;
};

/** Nós que podem escrever prova social ou número: os prompts deles dizem para não inventar e marcar. */
export const NOS_COM_PROVA: readonly TipoDeNo[] = ["agente", "copy", "landing", "anuncio", "oferta", "funil", "avatar", "order_bump", "upsell", "downsell", "sequencia_ofertas", "secoes_pagina", "sequencia_mensagens", "refino_tom", "pagina", "checkout", "quiz", "webinar", "automacao", "email", "whatsapp", "area_membros", "recuperacao", "ugc", "template_designer"];

/** O marcador que os prompts pedem para pôr na peça no lugar da prova que falta. */
export const MARCADOR_SEM_FONTE = "RASCUNHO SEM FONTE";
const RE_MARCADOR = /\[RASCUNHO SEM FONTE:?\s*([^\]]{0,400})\]/gi;

const ehTipoDeBloco = (v: unknown): v is TipoDeBloco => (TIPOS_DE_BLOCO as readonly string[]).indexOf(String(v)) >= 0;

/** Tipo do bloco pelo texto do marcador (palavra-chave simples; o resto é "outro"). */
export function tipoDoMarcador(t: string): TipoDeBloco {
  const s = semAcento(t);
  if (/depoimento|testemunho|avaliacao/.test(s)) return "depoimento";
  if (/garantia/.test(s)) return "garantia";
  if (/estatistica|percent|%/.test(s)) return "estatistica";
  if (/resultado|faturou|vendeu|aument|cresc|numero/.test(s)) return "resultado";
  return "outro";
}

/** Os marcadores [RASCUNHO SEM FONTE: ...] de um texto, na ordem. */
export function marcadoresSemFonte(t: unknown): Array<{ marcador: string; texto: string }> {
  const saida: Array<{ marcador: string; texto: string }> = [];
  const s = typeof t === "string" ? t : "";
  RE_MARCADOR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_MARCADOR.exec(s)) && saida.length < 40) saida.push({ marcador: m[0], texto: (m[1] || "").trim() });
  return saida;
}

/** Todas as strings de um valor (texto, json aninhado), para achar marcador em qualquer campo. */
function stringsDe(v: unknown, saida: string[] = [], profundidade = 0): string[] {
  if (profundidade > 8 || saida.length > 400) return saida;
  if (typeof v === "string") saida.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsDe(x, saida, profundidade + 1);
  else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) stringsDe(x, saida, profundidade + 1);
  return saida;
}

/**
 * Junta os blocos sem fonte de um nó: os marcadores achados no texto, no json e no html, e os que o modelo
 * listou (json.blocos_sem_fonte). Sem repetição; ids b1, b2... na ordem.
 */
export function blocosSemFonte(o: { declarados?: unknown; textos?: unknown[] }): BlocoSemFonte[] {
  const saida: BlocoSemFonte[] = [];
  const visto = new Set<string>();
  const chave = (t: string) => semAcento(t).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
  const por = (b: Omit<BlocoSemFonte, "id" | "confirmado">) => {
    const k = chave(b.marcador || b.texto);
    if (!k || visto.has(k) || saida.length >= 40) return;
    visto.add(k);
    saida.push({ id: `b${saida.length + 1}`, confirmado: false, ...b });
  };
  for (const s of stringsDe(o.textos || [])) {
    for (const m of marcadoresSemFonte(s)) por({ tipo: tipoDoMarcador(m.texto), texto: m.texto || m.marcador, onde: "", marcador: m.marcador });
  }
  for (const bruto of Array.isArray(o.declarados) ? o.declarados : []) {
    const b = objeto(bruto);
    const t = texto(b.texto, 600).trim();
    if (!t) continue;
    // Declarado que também está como marcador: o marcador já entrou.
    if (saida.some((x) => x.marcador && chave(x.texto) === chave(t))) continue;
    por({ tipo: ehTipoDeBloco(b.tipo) ? b.tipo : "outro", texto: t, onde: texto(b.onde, 200).trim() });
  }
  return saida;
}

/** Os blocos de uma saída (o campo rascunho_sem_fonte), sem confiar na forma. */
export function blocosDaSaida(saida: unknown): BlocoSemFonte[] {
  const lista = objeto(saida).rascunho_sem_fonte;
  return (Array.isArray(lista) ? lista : [])
    .map((x) => objeto(x))
    .filter((b) => typeof b.id === "string" && typeof b.texto === "string")
    .map((b) => b as unknown as BlocoSemFonte);
}

export const blocosPendentes = (saida: unknown) => blocosDaSaida(saida).filter((b) => b.confirmado !== true);

/** Todos os nós antes de `noId` (o caminho inteiro até ele), na ordem do canvas. */
export function ancestraisDe(c: Pick<Canvas, "nos" | "ligacoes">, noId: string): string[] {
  const achados = new Set<string>();
  const fila = [noId];
  while (fila.length) {
    const atual = fila.shift()!;
    for (const l of c.ligacoes) {
      if (l.para === atual && !achados.has(l.de)) {
        achados.add(l.de);
        fila.push(l.de);
      }
    }
  }
  achados.delete(noId);
  return c.nos.map((n) => n.id).filter((id) => achados.has(id));
}

export type BlocoDoNo = BlocoSemFonte & { no_id: string; no_rotulo: string };
export type TravaDoNoAr = { travado: boolean; motivo: string; blocos: BlocoDoNo[] };

/**
 * O Pôr no ar está travado? Olha a saída de todos os nós antes dele: bloco sem fonte não resolvido trava,
 * com o motivo e a lista (nó + trecho). `saidas` é a saída atual de cada nó (a última pronta).
 */
export function travaDoNoAr(c: Pick<Canvas, "nos" | "ligacoes">, noId: string, saidas: Record<string, unknown>): TravaDoNoAr {
  const blocos: BlocoDoNo[] = [];
  for (const id of ancestraisDe(c, noId)) {
    const n = c.nos.find((x) => x.id === id)!;
    const r = typeof n.dados.titulo === "string" && n.dados.titulo.trim() ? n.dados.titulo.trim() : ROTULO_DO_TIPO[n.tipo];
    for (const b of blocosPendentes(saidas[id])) blocos.push({ ...b, no_id: id, no_rotulo: r });
  }
  if (!blocos.length) return { travado: false, motivo: "", blocos };
  const nos = [...new Set(blocos.map((b) => b.no_rotulo))];
  return {
    travado: true,
    motivo: `Travado: ${blocos.length} bloco(s) de prova ou número sem fonte em ${nos.join(", ")}. Marque a fonte confirmada ou edite antes de pedir para pôr no ar.`,
    blocos,
  };
}

/** Troca, em todas as strings de um valor, o trecho do bloco pelo texto novo (edição do dono). */
export function trocarNoValor<T>(v: T, de: string, para: string, profundidade = 0): T {
  if (!de || profundidade > 8) return v;
  if (typeof v === "string") return v.split(de).join(para) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => trocarNoValor(x, de, para, profundidade + 1)) as unknown as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = k === "rascunho_sem_fonte" ? x : trocarNoValor(x, de, para, profundidade + 1);
    return o as T;
  }
  return v;
}

/**
 * Resolve um bloco na saída: "fonte" marca confirmado com a fonte; "editar" troca o trecho (o marcador ou
 * o texto) pelo texto novo em toda a saída e marca editado. Devolve a saída nova e o trecho trocado.
 */
export function resolverBloco(
  saida: Record<string, unknown>,
  blocoId: string,
  o: { modo: "fonte" | "editar"; fonte?: string; texto?: string; por: string; quando: string },
): { saida: Record<string, unknown>; bloco: BlocoSemFonte; trocado: string | null } {
  const lista = blocosDaSaida(saida);
  const b = lista.find((x) => x.id === blocoId);
  if (!b) throw new ErroDoCanvas("bloco_inexistente", "Esse bloco não está mais na saída do nó.");
  let nova = saida;
  let trocado: string | null = null;
  let resolvido: BlocoSemFonte;
  if (o.modo === "fonte") {
    const fonte = String(o.fonte || "").trim().slice(0, 400);
    if (fonte.length < 3) throw new ErroDoCanvas("fonte_obrigatoria", "Diga de onde vem (link, print, nome do cliente que autorizou).");
    resolvido = { ...b, confirmado: true, como: "fonte", fonte, resolvido_por: o.por, resolvido_em: o.quando };
  } else {
    const novo = String(o.texto ?? "").slice(0, 2000);
    trocado = b.marcador || b.texto;
    nova = trocarNoValor(saida, trocado, novo);
    resolvido = { ...b, confirmado: true, como: "editado", texto_novo: novo, resolvido_por: o.por, resolvido_em: o.quando };
  }
  return { saida: { ...nova, rascunho_sem_fonte: lista.map((x) => (x.id === blocoId ? resolvido : x)) }, bloco: resolvido, trocado };
}

// ------------------------------------------------------------------ v3: perguntas guiadas antes de montar

export const MAX_PERGUNTAS = 4;
export type PerguntaGuiada = { id: string; pergunta: string; exemplos: string[] };

/**
 * O essencial de um projeto completo. `jev` é a pergunta Noul (o pedido já diz isto?); `pista` é a reserva
 * quando o Jev não responde (regra fixa e simples, sem lookbehind).
 */
export const ESSENCIAIS: Array<PerguntaGuiada & { jev: string; pista: RegExp }> = [
  {
    id: "produto",
    pergunta: "O que você vende (produto ou serviço) e qual é a oferta?",
    exemplos: ["Curso online de confeitaria para iniciantes", "Consultoria de 3 meses para clínicas de estética", "Kit de cafés especiais em cápsula"],
    jev: "O pedido (ou o contexto e as respostas) já diz QUAL produto ou serviço vai ser vendido, de forma concreta (não só o mercado ou o nicho)?",
    pista: /\b(curso|mentoria|consultoria|ebook|kit|servico|produto|assinatura|aula|treinamento|programa|app|software|infoproduto)\b/,
  },
  {
    id: "publico",
    pergunta: "Para quem é? Descreva o público que compra.",
    exemplos: ["Mulheres de 25 a 40 anos que querem renda extra em casa", "Donos de pequenos restaurantes em Curitiba", "Médicos recém-formados"],
    jev: "O pedido (ou o contexto e as respostas) já diz PARA QUEM é a venda, isto é, o público ou cliente-alvo?",
    pista: /\b(para (mulheres|homens|maes|pais|donos|donas|empresas|medicos|dentistas|iniciantes|profissionais|jovens|idosos|estudantes|quem)|publico|persona|faixa etaria)\b/,
  },
  {
    id: "preco",
    pergunta: "Qual o preço ou a faixa de ticket?",
    exemplos: ["R$ 47 (low ticket)", "R$ 497 à vista ou 12x", "High ticket: R$ 5.000 a R$ 15.000, venda por call"],
    jev: "O pedido (ou o contexto e as respostas) já diz o PREÇO ou a faixa de ticket (valor em reais, ou low, mid ou high ticket)?",
    pista: /(r\$ ?\d|\d+ ?reais|\b(low|mid|high) ticket\b|\bticket\b|\bpreco\b|\bgratuito\b|\bgratis\b)/,
  },
  {
    id: "objetivo",
    pergunta: "Qual o objetivo agora (vender direto, captar contatos, agendar calls, lançar)?",
    exemplos: ["Vender direto pelo anúncio", "Captar 500 contatos para o lançamento de março", "Agendar 20 calls de diagnóstico por mês"],
    jev: "O pedido (ou o contexto e as respostas) já diz o OBJETIVO do projeto agora (vender, captar contatos, agendar calls, lançar, inscrever num webinar...)?",
    pista: /\b(vender|venda|vendas|captar|captura|leads?|contatos|agendar|agenda|calls?|lancar|lancamento|inscricao|inscricoes|webinar|webinario|aplicacao)\b/,
  },
];

/** As 4 perguntas Noul do Jev sobre o mesmo estado (independentes: vão juntas). */
export function perguntasDoJevSobreOEssencial() {
  const q: Record<string, { type: "noul"; instructions: string; criteria: { true: string; false: string } }> = {};
  for (const e of ESSENCIAIS) {
    q[e.id] = {
      type: "noul",
      instructions: `${e.jev} Leia \`pedido\`, \`contexto_do_projeto\` e \`respostas\`. Diga sim só se a informação está escrita (pode ser curta); não conte o que dá para adivinhar.`,
      criteria: { true: "A informação está escrita no texto.", false: "Falta: precisa perguntar ao dono antes de montar." },
    };
  }
  return q;
}

/** Abaixo disto o Jev acha que o pedido não diz: vira pergunta. */
export const LIMIAR_DO_ESSENCIAL = 0.5;

/**
 * As perguntas que faltam (até 4, na ordem de ESSENCIAIS). Com `jev` (probabilidade de sim por id), vale o
 * Jev; sem ele (ou id sem resposta), vale a pista no texto.
 */
export function perguntasQueFaltam(textoDoPedido: string, jev: Record<string, number | null> | null): PerguntaGuiada[] {
  const t = semAcento(textoDoPedido || "");
  const faltam = ESSENCIAIS.filter((e) => {
    const p = jev ? jev[e.id] : null;
    if (typeof p === "number" && Number.isFinite(p)) return p < LIMIAR_DO_ESSENCIAL;
    return !e.pista.test(t);
  });
  return faltam.slice(0, MAX_PERGUNTAS).map((e) => ({ id: e.id, pergunta: e.pergunta, exemplos: e.exemplos.slice() }));
}
