/**
 * Laboratório (20/10/2026, pedido do dono: "ao gerar arte e criativos, ter o motor que já é treinado por trás"):
 * regras puras do caminho dos nós criativos até o motor da casa, sem rede.
 *
 * - Rota: Resultado (imagem) e Carrossel vão para a Arte rápida do Estúdio (função estudio-arte, origem
 *   'laboratorio': conhecimento de design, tipografia do cliente, fiel ao pedido, uso da foto e foto real
 *   alinhada, referências do pedido, mundo real e autocorreção). Logo vai pelo logo_gerar (o da Mesa
 *   Identidade). O resto (template com camadas, personagem, quadros do UGC) segue no motor de imagem direto.
 * - Complemento: o que cada entrada vira no pedido do motor, e o registro `usou` do que entrou de fato.
 * - Andamento: o trabalho do Estúdio (versões das lâminas) e a fila dele viram o estado do nó.
 * - Cadeia: o planejar não deixa nó criativo solto (sem saída até o Pôr no ar).
 */
import { type Canvas, imagensComPrincipal, type NoDoCanvas, ROTULO_DO_TIPO, type TipoDeNo } from "./regras.ts";

const txt = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ------------------------------------------------------------------ rota

export type RotaDoMotor = "estudio_arte" | "identidade" | "direto";

/** Por onde cada nó criativo gera. */
export function rotaDoMotor(tipo: TipoDeNo): RotaDoMotor {
  if (tipo === "imagem" || tipo === "carrossel") return "estudio_arte";
  if (tipo === "logo") return "identidade";
  return "direto";
}

/** Formato do post do Estúdio pela proporção do nó (ou da Configuração ligada). */
export function formatoDoEstudio(proporcao: string | null | undefined): string {
  if (proporcao === "1:1") return "quadrado_1x1";
  if (proporcao === "9:16") return "stories_9x16";
  if (proporcao === "2:3") return "retrato_3x4";
  return "feed_4x5";
}

// ------------------------------------------------------------------ complemento entre os nós

export type UsoDaEntrada = { tipo: string; rotulo: string; no_id: string; como: string };
export type EntradaDoMotor = { no: NoDoCanvas; saida: Record<string, unknown> | null };
export type FotoDoPedido = { path: string; bucket: string; nome: string; papel: "foto" | "referencia" | "logo" | "arte_para_melhorar"; no_id: string };
export type MateriaisDoMotor = {
  pedido: string;
  documentos: Array<{ nome: string; texto: string }>;
  fotos: FotoDoPedido[];
  laminas: number | null;
  peca: "unica" | "carrossel";
  formato: string;
  usou: UsoDaEntrada[];
};

const TEXTOS_DE_CONTEUDO: TipoDeNo[] = ["contexto", "cliente", "arquivo", "produto", "oferta", "pesquisa", "avatar", "funil", "sequencia_ofertas", "secoes_pagina", "order_bump", "upsell", "downsell"];
const TEXTOS_DA_PECA: TipoDeNo[] = ["copy", "refino_tom", "agente"];
export const MAX_FOTOS_DO_MOTOR = 6;

const rotulo = (n: NoDoCanvas) => (typeof n.dados.titulo === "string" && n.dados.titulo.trim() ? n.dados.titulo.trim() : ROTULO_DO_TIPO[n.tipo]);

function imagensDaSaida(s: Record<string, unknown> | null, no?: NoDoCanvas): Array<{ path: string; bucket: string; nome: string }> {
  const brutas = arr(s && s.imagens);
  return (no ? imagensComPrincipal(no, brutas, s && s.escolha) : brutas)
    .map(obj)
    .filter((i) => typeof i.path === "string" && i.path)
    .map((i) => ({ path: String(i.path), bucket: typeof i.bucket === "string" && i.bucket ? i.bucket : "workspace", nome: String(i.path).split("/").pop() || "imagem" }));
}

/**
 * O pedido do motor a partir do nó e do que entra nele. Cada entrada vira uma coisa útil:
 * - Copy (e Refino de tom, Agente) → o título e o texto da arte, fiéis (documento "texto exato"), sem inventar;
 * - Marca → paleta, fontes e o que a marca nunca faz (a logo vem do kit do cliente pelo próprio motor);
 * - Mídia → foto real do produto, alinhada e intacta (papel "foto");
 * - Contexto, Cliente, Documento, Produto, Oferta... → conteúdo (documento de apoio);
 * - Referências → estilo (texto e prints como referência);
 * - Configuração e Base comum → formato, quantidade e o pedido base;
 * - Resultado/Logo antes → referência visual.
 */
export function materiaisDoMotor(no: NoDoCanvas, entradas: EntradaDoMotor[], o: { proporcao: string | null; prompt_base?: string | null; laminas?: number | null }): MateriaisDoMotor {
  const usou: UsoDaEntrada[] = [];
  const linhas: string[] = [];
  const documentos: Array<{ nome: string; texto: string }> = [];
  const fotos: FotoDoPedido[] = [];
  const usar = (n: NoDoCanvas, como: string) => usou.push({ tipo: n.tipo, rotulo: rotulo(n), no_id: n.id, como });
  const pedidoDoNo = txt(no.dados.prompt, 2000) || txt(no.dados.tema, 2000);
  if (pedidoDoNo) linhas.push(pedidoDoNo);
  for (const { no: e, saida } of entradas) {
    const s = saida || {};
    const texto = txt(s.texto, 8000);
    if (TEXTOS_DA_PECA.indexOf(e.tipo) >= 0 && texto) {
      documentos.push({ nome: `Texto exato (${rotulo(e)})`, texto });
      usar(e, "título e texto da arte, fiéis ao texto");
      continue;
    }
    if (e.tipo === "marca") {
      if (texto) documentos.push({ nome: "Marca", texto });
      usar(e, "paleta, fontes e regras da marca (a logo vem do kit, sem redesenhar)");
      for (const l of imagensDaSaida(s, e).slice(0, 1)) fotos.push({ ...l, papel: "logo", no_id: e.id });
      continue;
    }
    if (e.tipo === "midia") {
      const imgs = imagensDaSaida(s, e);
      for (const f of imgs) if (fotos.length < MAX_FOTOS_DO_MOTOR) fotos.push({ ...f, papel: "foto", no_id: e.id });
      if (imgs.length) usar(e, "foto real do produto, alinhada e intacta");
      continue;
    }
    if (e.tipo === "referencias") {
      if (texto) linhas.push(`Estilo das referências: ${texto.slice(0, 1500)}`);
      for (const f of imagensDaSaida(s, e)) if (fotos.length < MAX_FOTOS_DO_MOTOR) fotos.push({ ...f, papel: "referencia", no_id: e.id });
      usar(e, "estilo");
      continue;
    }
    if (e.tipo === "config") {
      usar(e, "proporção e quantidade");
      continue;
    }
    if (e.tipo === "gravity") {
      const base = txt(e.dados.prompt_base, 2000);
      if (base) linhas.push(`Base comum: ${base}`);
      usar(e, "pedido base e referências em comum");
      continue;
    }
    if (e.tipo === "imagem" || e.tipo === "logo" || e.tipo === "carrossel") {
      // A principal (dados.principal) primeiro; a logo vai sozinha (a primeira).
      const imgs = imagensDaSaida(s, e);
      for (const f of imgs.slice(0, e.tipo === "logo" ? 1 : 2)) if (fotos.length < MAX_FOTOS_DO_MOTOR) fotos.push({ ...f, papel: e.tipo === "logo" ? "logo" : "referencia", no_id: e.id });
      if (imgs.length) usar(e, e.tipo === "logo" ? "logo (imagem pronta, sem redesenhar)" : "referência visual");
      continue;
    }
    if (TEXTOS_DE_CONTEUDO.indexOf(e.tipo) >= 0 && texto) {
      documentos.push({ nome: rotulo(e), texto });
      usar(e, "conteúdo");
      continue;
    }
    if (texto) {
      documentos.push({ nome: rotulo(e), texto });
      usar(e, "conteúdo");
    }
  }
  if (o.prompt_base && !linhas.some((l) => l.indexOf("Base comum:") === 0)) linhas.push(`Base comum: ${o.prompt_base}`);
  if (documentos.some((d) => d.nome.indexOf("Texto exato") === 0)) linhas.push("Use como título e texto da arte o que está no documento \"Texto exato\", sem mudar fato, preço nem número e sem inventar outro texto.");
  if (fotos.some((f) => f.papel === "foto")) linhas.push("A foto enviada é o produto real: mantenha o produto intacto e alinhado, sem redesenhar.");
  const carrossel = no.tipo === "carrossel";
  const pedido = linhas.join("\n\n").slice(0, 3800) || (carrossel ? "Carrossel a partir dos textos ligados." : "Arte a partir dos textos ligados.");
  return {
    pedido,
    documentos: documentos.slice(0, 6),
    fotos,
    laminas: carrossel ? Math.min(10, Math.max(2, Number(o.laminas) || 5)) : null,
    peca: carrossel ? "carrossel" : "unica",
    formato: formatoDoEstudio(o.proporcao),
    usou,
  };
}

/** A marca escolhida (dados.marca_id do nó Marca): a do Marca ligado ao nó, senão a do primeiro Marca do quadro. */
export function marcaIdDoCanvas(c: Pick<Canvas, "nos" | "ligacoes">, noId?: string): string | null {
  const valido = (n: NoDoCanvas | undefined) => (n && n.tipo === "marca" && typeof n.dados.marca_id === "string" && /^[0-9a-f-]{36}$/i.test(n.dados.marca_id) ? n.dados.marca_id.toLowerCase() : null);
  if (noId) {
    for (const l of c.ligacoes) if (l.para === noId) {
      const m = valido(c.nos.find((n) => n.id === l.de));
      if (m) return m;
    }
  }
  for (const n of c.nos) {
    const m = valido(n);
    if (m) return m;
  }
  return null;
}

// ------------------------------------------------------------------ andamento do trabalho do Estúdio

export type LaminaPronta = { ordem: number; versao: number; storage_path: string };
export type AndamentoDoEstudio = { total: number; prontas: LaminaPronta[]; naFila: number; erros: string[]; terminou: boolean; progresso: number };

/** As últimas versões de cada lâmina da direção e o estado da fila do trabalho. */
export function andamentoDoEstudio(trabalho: { direcao?: unknown; cards?: unknown }, fila: Array<{ ordem?: unknown; status?: unknown; erro_mensagem?: unknown }>): AndamentoDoEstudio {
  const ordens = arr(obj(trabalho.direcao).cards).map((c) => Number(obj(c).ordem)).filter((n) => Number.isInteger(n) && n > 0);
  const ultimas = new Map<number, LaminaPronta>();
  for (const v of arr(trabalho.cards).map(obj)) {
    const ordem = Number(v.ordem);
    const versao = Number(v.versao);
    const caminho = txt(v.storage_path, 500);
    if (!caminho || !Number.isInteger(ordem)) continue;
    const atual = ultimas.get(ordem);
    if (!atual || versao > atual.versao) ultimas.set(ordem, { ordem, versao, storage_path: caminho });
  }
  const naFila = fila.filter((f) => f.status === "fila" || f.status === "rodando").length;
  const erros = fila.filter((f) => f.status === "erro").map((f) => txt(f.erro_mensagem, 300) || `Lâmina ${Number(f.ordem) || "?"} falhou.`);
  const total = ordens.length || ultimas.size;
  const prontas = (ordens.length ? ordens : [...ultimas.keys()]).map((o) => ultimas.get(o)).filter((x): x is LaminaPronta => !!x).sort((a, b) => a.ordem - b.ordem);
  const terminou = naFila === 0 && (prontas.length >= total || erros.length > 0) && total > 0;
  return { total, prontas, naFila, erros, terminou, progresso: total ? Math.round((prontas.length / total) * 100) : 0 };
}

// ------------------------------------------------------------------ cadeia que fecha (planejar)

/** Nós criativos e de peça final que precisam levar a algum lugar no fim do fluxo. */
const PECAS_QUE_FECHAM: TipoDeNo[] = ["copy", "imagem", "carrossel", "landing", "anuncio", "pagina", "checkout", "quiz", "webinar", "email", "whatsapp", "automacao", "ugc", "template_designer", "filme"];

/**
 * Nós soltos depois do planejar: sem ligação nenhuma, ou peça (copy, arte, página, anúncio...) que não
 * leva a lugar nenhum quando o quadro tem Pôr no ar. Vazio = as cadeias fecham.
 */
export function nosSoltos(c: Pick<Canvas, "nos" | "ligacoes">): Array<{ no_id: string; tipo: TipoDeNo; motivo: string }> {
  const temNoAr = c.nos.some((n) => n.tipo === "por_no_ar");
  const saidas = new Set(c.ligacoes.map((l) => l.de));
  const entradas = new Set(c.ligacoes.map((l) => l.para));
  const soltos: Array<{ no_id: string; tipo: TipoDeNo; motivo: string }> = [];
  if (c.nos.length < 2) return soltos;
  for (const n of c.nos) {
    if (!saidas.has(n.id) && !entradas.has(n.id)) {
      soltos.push({ no_id: n.id, tipo: n.tipo, motivo: `${rotulo(n)} está solto: ligue nele o que entra e para onde ele vai.` });
      continue;
    }
    if (temNoAr && PECAS_QUE_FECHAM.indexOf(n.tipo) >= 0 && !saidas.has(n.id)) {
      soltos.push({ no_id: n.id, tipo: n.tipo, motivo: `${rotulo(n)} não leva a lugar nenhum: ligue no próximo passo ou no Pôr no ar.` });
    }
  }
  return soltos;
}

/** A regra que vai no texto do planejar. */
export const REGRA_DA_CADEIA = `CADEIAS QUE FECHAM: cada nó serve ao próximo e o fluxo termina num resultado. Nenhum nó solto. Exemplo: Contexto + Marca + Mídia → Copy → Resultado/Carrossel → Anúncio → Pôr no ar. Copy ligada vira o texto exato da arte; Marca vira paleta, fontes e logo; Mídia vira a foto real do produto; Referências viram estilo; Configuração e Base comum viram formato e quantidade. Com Pôr no ar no quadro, toda peça (copy, arte, página, anúncio, mensagem) leva até ele ou até a peça seguinte.`;
