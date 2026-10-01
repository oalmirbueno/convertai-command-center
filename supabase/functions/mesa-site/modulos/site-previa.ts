/**
 * Prévia editável do site (frente SPV, 30/09/2026): as regras puras.
 *
 * O dono pediu uma prévia do site enquanto ele é construído, onde também dá
 * para editar. Cada edição feita na prévia passa por aqui:
 *  - `normalizarEdicao` lê o pedido da tela sem confiar em nada;
 *  - `planejarEdicao` decide se é CONTEÚDO (texto da copy, imagem, cor ou
 *    fonte deste site, esconder ou mover seção: aplicado na hora, sem custo)
 *    ou CÓDIGO (texto que não é da copy, pedido livre: vira trabalho
 *    "ajustar" do motor, com o custo antes e Confirmar);
 *  - toda edição de conteúdo vira uma lista de alvos (coluna, caminho, antes
 *    e depois), e `planejarDesfazer` volta exatamente aquele ponto, só se
 *    ninguém mexeu nele depois (senão avisa, sem apagar o que veio depois).
 * Também ficam aqui o estado das seções na construção (pronta, construindo,
 * na fila) e o estado do motor para a tela (sem worker, na fila, rodando).
 *
 * Puro: sem Deno, sem npm e sem banco. A função mesa-site, a tela e os
 * testes importam o mesmo arquivo. Mora em mesa-site/modulos (só esta função
 * usa no servidor; o compartilhado das funções tem teto de 4 MB). Sem travessão.
 */

import { executorVivo, ROTULO_DO_TIPO, type TrabalhoDoMotor } from "../../_shared/motor-codigo.ts";
import { rotuloDaSecao } from "../../_shared/site-metodo.ts";
import { type AjustesDaMarcaNoSite, mapaDoSite, type MapaDoSite, normalizarAjustes, normalizarMapa, type SecaoOculta } from "../../_shared/site-biblioteca.ts";

// ------------------------------------------------------------------ tipos

export const TIPOS_DE_EDICAO = ["texto", "texto_livre", "imagem", "cor", "fonte", "secao_visivel", "secao_mover", "pedido"] as const;
export type TipoDeEdicao = (typeof TIPOS_DE_EDICAO)[number];

export const ROTULO_DA_EDICAO: Record<TipoDeEdicao, string> = {
  texto: "Texto",
  texto_livre: "Texto do código",
  imagem: "Imagem",
  cor: "Cor",
  fonte: "Fonte",
  secao_visivel: "Seção",
  secao_mover: "Ordem",
  pedido: "Pedido ao motor",
};

export type PapelDaCor = "destaque" | "fundo" | "texto";
export type PapelDaFonte = "titulo" | "texto";
export type SlotDaPrevia = "hero" | "secao" | "fundo" | "detalhe";

export type EdicaoDaPrevia =
  | { tipo: "texto"; campo: string; valor: string }
  | { tipo: "texto_livre"; secao: string; antes: string; valor: string }
  | { tipo: "imagem"; secao: string; slot: SlotDaPrevia; imagem_id: string | null; cliente_imagem_id: string | null; substitui_id: string | null }
  | { tipo: "cor"; papel: PapelDaCor; hex: string | null }
  | { tipo: "fonte"; papel: PapelDaFonte; nome: string | null }
  | { tipo: "secao_visivel"; secao: string; visivel: boolean }
  | { tipo: "secao_mover"; secao: string; direcao: "subir" | "descer" }
  | { tipo: "pedido"; secao: string; instrucao: string };

export type ColunaDaEdicao = "conteudo" | "estilo" | "mapa" | "imagens";
export type AlvoDaEdicao = { coluna: ColunaDaEdicao; caminho: Array<string | number>; antes: unknown; depois: unknown };

export type PlanoDaEdicao =
  | { modo: "direto"; alvos: AlvoDaEdicao[]; campos: Record<string, unknown>; resumo: string; secao: string | null }
  | { modo: "ajuste"; secao: string; instrucao: string; resumo: string }
  | { modo: "nada"; resumo: string; secao: string | null };

/** O mínimo do site que a prévia lê (as colunas da linha `sites`). */
export type SiteDaPrevia = {
  conteudo?: Record<string, unknown> | null;
  estilo?: Record<string, unknown> | null;
  mapa?: Record<string, unknown> | null;
  tipo?: string | null;
  direcao?: Record<string, unknown> | null;
  imagens?: unknown[] | null;
};

/** Imagem da lista `sites.imagens` (mesmo formato do pacote-do-site). */
export type ImagemDaPrevia = { id: string; slot: string; origem: "gerada" | "real"; bucket: string; path: string; alt: string; escolhida?: boolean; secao?: string | null; custo_usd?: number };

export class ErroDaPrevia extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroDaPrevia";
    this.status = status;
    this.codigo = codigo;
  }
}

// ------------------------------------------------------------------ utilidades

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const UID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const FONTE = /^[A-Za-z0-9][A-Za-z0-9 ]{1,39}$/;
/** Regra da casa: sem travessão (vira vírgula), espaço único. */
export const textoLimpo = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
/**
 * Texto longo da copy (texto da seção, resposta, subtítulo): guarda a quebra
 * de linha (Shift+Enter na prévia). Junta só espaços e tabs, limpa a ponta de
 * cada linha e deixa no máximo uma linha em branco entre parágrafos.
 */
export const textoComParagrafos = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*[—–][ \t]*/g, ", ")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
/** Os campos da copy que guardam parágrafos (o resto é uma linha só). */
export const CAMPOS_COM_PARAGRAFOS = ["texto", "resposta", "subtitulo"];
const curto = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Igualdade profunda que ignora a ordem das chaves (o jsonb reordena) e trata ausente como nulo. */
export function igualProfundo(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null) return b === undefined || b === null;
  if (b === undefined || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!igualProfundo(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    const chaves = Object.keys(oa).concat(Object.keys(ob)).filter((k, i, l) => l.indexOf(k) === i);
    for (const k of chaves) if (!igualProfundo(oa[k], ob[k])) return false;
    return true;
  }
  return false;
}

/** O valor num caminho (undefined quando não existe). */
export function valorEm(raiz: unknown, caminho: Array<string | number>): unknown {
  let atual: unknown = raiz;
  for (const passo of caminho) {
    if (atual === null || atual === undefined || typeof atual !== "object") return undefined;
    atual = (atual as Record<string | number, unknown>)[passo];
  }
  return atual;
}

/** Cópia com o valor trocado no caminho (cria o que falta; undefined apaga a chave). */
export function comValor(raiz: unknown, caminho: Array<string | number>, valor: unknown): unknown {
  if (!caminho.length) return valor;
  const [passo, ...resto] = caminho;
  if (typeof passo === "number") {
    const lista = Array.isArray(raiz) ? raiz.slice() : [];
    lista[passo] = comValor(lista[passo], resto, valor);
    return lista;
  }
  const o = raiz && typeof raiz === "object" && !Array.isArray(raiz) ? { ...(raiz as Record<string, unknown>) } : {};
  const novo = comValor(o[passo], resto, valor);
  if (novo === undefined) delete o[passo];
  else o[passo] = novo;
  return o;
}

const colunaInicial = (site: SiteDaPrevia, coluna: ColunaDaEdicao): unknown => {
  const v = (site as Record<string, unknown>)[coluna];
  if (coluna === "imagens") return Array.isArray(v) ? v : [];
  return v && typeof v === "object" ? v : {};
};

/** As colunas novas do site depois de aplicar os alvos (na ordem). */
export function aplicarAlvos(site: SiteDaPrevia, alvos: AlvoDaEdicao[], lado: "antes" | "depois" = "depois"): Record<string, unknown> {
  const campos: Record<string, unknown> = {};
  const lista = lado === "antes" ? alvos.slice().reverse() : alvos;
  for (const a of lista) {
    const base = a.coluna in campos ? campos[a.coluna] : colunaInicial(site, a.coluna);
    let valor = lado === "antes" ? a.antes : a.depois;
    // Coluna inteira que volta a "nada": objeto vazio (a coluna é NOT NULL), lista vazia nas imagens.
    if (!a.caminho.length && (valor === undefined || valor === null)) valor = a.coluna === "imagens" ? [] : {};
    campos[a.coluna] = comValor(base, a.caminho, valor);
  }
  return campos;
}

// ------------------------------------------------------------------ copy

export type OpcaoDaCopy = {
  headline?: string;
  subtitulo?: string;
  cta?: string;
  secoes?: Array<{ id: string; titulo?: string; texto?: string; itens?: string[]; cta?: string }>;
  faq?: Array<{ pergunta: string; resposta: string }>;
};

/** A copy escolhida (conteudo.opcoes[conteudo.escolhida]) e o índice dela. */
export function copyDoSite(conteudo: unknown): { copy: OpcaoDaCopy | null; indice: number } {
  const c = obj(conteudo);
  const opcoes = Array.isArray(c.opcoes) ? (c.opcoes as unknown[]) : [];
  const i = Number(c.escolhida);
  if (!Number.isInteger(i) || i < 0 || i >= opcoes.length || !opcoes[i] || typeof opcoes[i] !== "object") return { copy: null, indice: -1 };
  return { copy: opcoes[i] as OpcaoDaCopy, indice: i };
}

export type CampoDaCopy = { campo: string; valor: string; secao: string | null; rotulo: string };

/**
 * O endereço de um texto da copy, igual na prévia rápida e na ponte do site
 * do motor: "headline", "subtitulo", "cta", "secao:<uid>:titulo|texto|cta",
 * "secao:<uid>:item:<n>" e "faq:<n>:pergunta|resposta".
 */
export type CampoLido =
  | { onde: "abertura"; chave: "headline" | "subtitulo" | "cta" }
  | { onde: "secao"; uid: string; chave: "titulo" | "texto" | "cta" }
  | { onde: "item"; uid: string; n: number }
  | { onde: "faq"; n: number; chave: "pergunta" | "resposta" };

export function lerCampo(campo: unknown): CampoLido | null {
  const s = String(campo ?? "").trim();
  if (s === "headline" || s === "subtitulo" || s === "cta") return { onde: "abertura", chave: s };
  const p = s.split(":");
  if (p[0] === "secao" && p.length === 3 && UID.test(p[1]) && (p[2] === "titulo" || p[2] === "texto" || p[2] === "cta")) return { onde: "secao", uid: p[1], chave: p[2] };
  if (p[0] === "secao" && p.length === 4 && UID.test(p[1]) && p[2] === "item" && /^\d{1,2}$/.test(p[3])) return { onde: "item", uid: p[1], n: Number(p[3]) };
  if (p[0] === "faq" && p.length === 3 && /^\d{1,2}$/.test(p[1]) && (p[2] === "pergunta" || p[2] === "resposta")) return { onde: "faq", n: Number(p[1]), chave: p[2] };
  return null;
}

/** Tamanho máximo de cada texto (o mesmo teto da edição por seção). */
export const LIMITES_DO_TEXTO = { headline: 160, subtitulo: 300, cta: 40, titulo: 160, texto: 1200, item: 300, pergunta: 200, resposta: 800 } as const;

const ROTULO_DO_CAMPO: Record<string, string> = { headline: "Título principal", subtitulo: "Subtítulo", cta: "Botão", titulo: "Título", texto: "Texto", pergunta: "Pergunta", resposta: "Resposta" };

export function rotuloDoCampo(campo: string): string {
  const c = lerCampo(campo);
  if (!c) return "Texto";
  if (c.onde === "abertura") return ROTULO_DO_CAMPO[c.chave];
  if (c.onde === "secao") return `${ROTULO_DO_CAMPO[c.chave]} de ${rotuloDaSecao(c.uid)}`;
  if (c.onde === "item") return `Item ${c.n + 1} de ${rotuloDaSecao(c.uid)}`;
  return `${ROTULO_DO_CAMPO[c.chave]} ${c.n + 1} das dúvidas`;
}

/** Todos os textos da copy com o endereço (a ponte usa para achar o texto no site do motor). */
export function camposDaCopy(copy: OpcaoDaCopy | null): CampoDaCopy[] {
  if (!copy) return [];
  const saida: CampoDaCopy[] = [];
  const por = (campo: string, valor: unknown, secao: string | null) => {
    const v = typeof valor === "string" ? valor.trim() : "";
    if (v) saida.push({ campo, valor: v, secao, rotulo: rotuloDoCampo(campo) });
  };
  por("headline", copy.headline, null);
  por("subtitulo", copy.subtitulo, null);
  por("cta", copy.cta, null);
  for (const s of Array.isArray(copy.secoes) ? copy.secoes : []) {
    if (!s || typeof s.id !== "string" || !UID.test(s.id)) continue;
    por(`secao:${s.id}:titulo`, s.titulo, s.id);
    por(`secao:${s.id}:texto`, s.texto, s.id);
    por(`secao:${s.id}:cta`, s.cta, s.id);
    (Array.isArray(s.itens) ? s.itens : []).slice(0, 24).forEach((it, n) => por(`secao:${s.id}:item:${n}`, it, s.id));
  }
  (Array.isArray(copy.faq) ? copy.faq : []).slice(0, 24).forEach((f, n) => {
    por(`faq:${n}:pergunta`, f && f.pergunta, null);
    por(`faq:${n}:resposta`, f && f.resposta, null);
  });
  return saida;
}

// ------------------------------------------------------------------ leitura do pedido

const ehSlot = (v: unknown): v is SlotDaPrevia => v === "hero" || v === "secao" || v === "fundo" || v === "detalhe";

/** Lê a edição vinda da tela (ou da ponte) sem confiar em nada. */
export function normalizarEdicao(bruto: unknown): EdicaoDaPrevia {
  const o = obj(bruto);
  const tipo = String(o.tipo || "");
  const secao = typeof o.secao === "string" ? o.secao.trim().toLowerCase() : "";
  const precisaSecao = () => {
    if (!UID.test(secao)) throw new ErroDaPrevia(400, "secao_invalida", "Diga em qual seção é a mudança.");
    return secao;
  };
  if (tipo === "texto") {
    const campo = String(o.campo || "");
    if (!lerCampo(campo)) throw new ErroDaPrevia(400, "campo_invalido", "Esse texto não é da copy do site.");
    return { tipo, campo, valor: String(o.valor ?? "") };
  }
  if (tipo === "texto_livre") {
    const antes = textoLimpo(o.antes, 600);
    const valor = textoLimpo(o.valor, 600);
    if (!antes && !valor) throw new ErroDaPrevia(400, "texto_vazio", "Nada mudou no texto.");
    return { tipo, secao: precisaSecao(), antes, valor };
  }
  if (tipo === "imagem") {
    const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
    const imagem_id = id(o.imagem_id);
    const cliente_imagem_id = id(o.cliente_imagem_id);
    if (!imagem_id && !cliente_imagem_id) throw new ErroDaPrevia(400, "imagem_vazia", "Escolha a imagem nova.");
    return { tipo, secao: precisaSecao(), slot: ehSlot(o.slot) ? o.slot : "secao", imagem_id, cliente_imagem_id, substitui_id: id(o.substitui_id) };
  }
  if (tipo === "cor") {
    const papel = o.papel === "destaque" || o.papel === "fundo" || o.papel === "texto" ? o.papel : null;
    if (!papel) throw new ErroDaPrevia(400, "papel_invalido", "Diga qual cor muda (destaque, fundo ou texto).");
    if (o.hex === null || o.hex === "") return { tipo, papel, hex: null };
    const hex = String(o.hex || "").trim();
    if (!HEX.test(hex)) throw new ErroDaPrevia(400, "cor_invalida", "A cor precisa estar no formato #RRGGBB.");
    return { tipo, papel, hex: hex.toLowerCase() };
  }
  if (tipo === "fonte") {
    const papel = o.papel === "titulo" || o.papel === "texto" ? o.papel : null;
    if (!papel) throw new ErroDaPrevia(400, "papel_invalido", "Diga qual fonte muda (título ou texto).");
    if (o.nome === null || o.nome === "") return { tipo, papel, nome: null };
    const nome = String(o.nome || "").replace(/\s+/g, " ").trim();
    if (!FONTE.test(nome)) throw new ErroDaPrevia(400, "fonte_invalida", "Esse nome de fonte não vale.");
    return { tipo, papel, nome };
  }
  if (tipo === "secao_visivel") return { tipo, secao: precisaSecao(), visivel: o.visivel !== false };
  if (tipo === "secao_mover") {
    if (o.direcao !== "subir" && o.direcao !== "descer") throw new ErroDaPrevia(400, "direcao_invalida", "Diga se a seção sobe ou desce.");
    return { tipo, secao: precisaSecao(), direcao: o.direcao };
  }
  if (tipo === "pedido") {
    const instrucao = textoLimpo(o.instrucao, 1200);
    if (instrucao.length < 3) throw new ErroDaPrevia(400, "pedido_vazio", "Diga o que mudar na seção.");
    return { tipo, secao: precisaSecao(), instrucao };
  }
  throw new ErroDaPrevia(400, "edicao_desconhecida", "Tipo de edição desconhecido.");
}

/** Conteúdo (aplica na hora, sem custo) ou código (vira ajuste do motor, com custo antes). */
export const classificarEdicao = (e: Pick<EdicaoDaPrevia, "tipo">): "conteudo" | "codigo" => (e.tipo === "texto_livre" || e.tipo === "pedido" ? "codigo" : "conteudo");

// ------------------------------------------------------------------ plano

function planoDoTexto(site: SiteDaPrevia, e: Extract<EdicaoDaPrevia, { tipo: "texto" }>): PlanoDaEdicao {
  const { copy, indice } = copyDoSite(site.conteudo);
  if (!copy) throw new ErroDaPrevia(409, "sem_copy_escolhida", "Escolha uma das opções de conteúdo (etapa Conteúdo) antes de editar o texto.");
  const c = lerCampo(e.campo)!;
  const base: Array<string | number> = ["opcoes", indice];
  const limite = c.onde === "abertura" ? LIMITES_DO_TEXTO[c.chave] : c.onde === "secao" ? LIMITES_DO_TEXTO[c.chave] : c.onde === "item" ? LIMITES_DO_TEXTO.item : LIMITES_DO_TEXTO[c.chave];
  const longo = c.onde !== "item" && CAMPOS_COM_PARAGRAFOS.indexOf(c.chave) >= 0;
  const valor = longo ? textoComParagrafos(e.valor, limite) : textoLimpo(e.valor, limite);
  const podeVazio = (c.onde === "abertura" && c.chave === "subtitulo") || (c.onde === "secao" && (c.chave === "texto" || c.chave === "cta"));
  if (!valor && !podeVazio) throw new ErroDaPrevia(400, "texto_vazio", "Este texto não pode ficar vazio. Para tirar o bloco, esconda a seção ou peça ao motor.");
  const secaoDoCampo = c.onde === "secao" || c.onde === "item" ? c.uid : null;
  const resumo = `${rotuloDoCampo(e.campo)}: "${curto(textoLimpo(valor, 300) || "(vazio)")}"`;
  let alvo: AlvoDaEdicao;
  if (c.onde === "abertura") {
    alvo = { coluna: "conteudo", caminho: base.concat([c.chave]), antes: copy[c.chave], depois: valor };
  } else if (c.onde === "faq") {
    const faq = Array.isArray(copy.faq) ? copy.faq : [];
    if (c.n >= faq.length) throw new ErroDaPrevia(404, "texto_inexistente", "Essa pergunta não existe mais na copy.");
    alvo = { coluna: "conteudo", caminho: base.concat(["faq", c.n, c.chave]), antes: faq[c.n][c.chave], depois: valor };
  } else {
    const secoes = Array.isArray(copy.secoes) ? copy.secoes : [];
    const j = secoes.findIndex((s) => s && s.id === c.uid);
    if (c.onde === "item") {
      const itens = j >= 0 && Array.isArray(secoes[j].itens) ? (secoes[j].itens as string[]) : [];
      if (j < 0 || c.n >= itens.length) throw new ErroDaPrevia(404, "texto_inexistente", "Esse item não existe mais na copy.");
      alvo = { coluna: "conteudo", caminho: base.concat(["secoes", j, "itens", c.n]), antes: itens[c.n], depois: valor };
    } else if (j >= 0) {
      alvo = { coluna: "conteudo", caminho: base.concat(["secoes", j, c.chave]), antes: secoes[j][c.chave], depois: valor };
    } else {
      // A copy não tinha a seção: entra uma nova, com o texto (desfazer tira a lista inteira de volta).
      const nova = { id: c.uid, titulo: "", texto: "", itens: [] as string[], [c.chave]: valor };
      alvo = { coluna: "conteudo", caminho: base.concat(["secoes"]), antes: copy.secoes, depois: secoes.concat([nova]) };
    }
  }
  if (igualProfundo(alvo.antes, alvo.depois) || (alvo.antes === undefined && alvo.depois === "")) return { modo: "nada", resumo: "Nada mudou no texto", secao: secaoDoCampo };
  return { modo: "direto", alvos: [alvo], campos: aplicarAlvos(site, [alvo]), resumo, secao: secaoDoCampo };
}

/** Imagens do site, lidas sem confiar (mesmo formato do pacote-do-site). */
export function imagensDaPrevia(lista: unknown): ImagemDaPrevia[] {
  return (Array.isArray(lista) ? lista : [])
    .map((b) => obj(b))
    .filter((b) => typeof b.path === "string" && typeof b.id === "string")
    .map((b) => ({
      id: String(b.id),
      slot: String(b.slot || "secao"),
      origem: b.origem === "real" ? ("real" as const) : ("gerada" as const),
      bucket: String(b.bucket || "mesa"),
      path: String(b.path),
      alt: String(b.alt || "").slice(0, 200),
      escolhida: b.escolhida !== false,
      secao: typeof b.secao === "string" && b.secao ? String(b.secao).slice(0, 48) : null,
    }));
}

function planoDaImagem(site: SiteDaPrevia, e: Extract<EdicaoDaPrevia, { tipo: "imagem" }>, fotoReal: ImagemDaPrevia | null): PlanoDaEdicao {
  const brutas = Array.isArray(site.imagens) ? (site.imagens as unknown[]) : [];
  let achou = false;
  let lista = brutas.map((b) => {
    const i = obj(b);
    if (e.imagem_id && i.id === e.imagem_id) {
      achou = true;
      return { ...i, escolhida: true, secao: e.secao, slot: e.slot };
    }
    if (e.substitui_id && i.id === e.substitui_id && i.id !== e.imagem_id) return { ...i, escolhida: false };
    return b;
  });
  if (e.imagem_id && !achou) throw new ErroDaPrevia(404, "imagem_inexistente", "Essa imagem não está mais no site.");
  if (!e.imagem_id) {
    if (!fotoReal) throw new ErroDaPrevia(404, "foto_inexistente", "Essa foto não está no acervo desta marca.");
    // A mesma foto já está no site: só volta a valer nesta seção (sem entrada duplicada).
    const j = lista.findIndex((b) => {
      const i = obj(b);
      return i.origem === "real" && i.bucket === fotoReal.bucket && i.path === fotoReal.path;
    });
    if (j >= 0) lista[j] = { ...obj(lista[j]), escolhida: true, secao: e.secao, slot: e.slot };
    else lista = lista.concat([{ ...fotoReal, origem: "real", escolhida: true, secao: e.secao, slot: e.slot }]);
  }
  const alvo: AlvoDaEdicao = { coluna: "imagens", caminho: [], antes: brutas, depois: lista };
  if (igualProfundo(alvo.antes, alvo.depois)) return { modo: "nada", resumo: "A imagem já é essa", secao: e.secao };
  return { modo: "direto", alvos: [alvo], campos: { imagens: lista }, resumo: `Imagem de ${rotuloDaSecao(e.secao)} trocada${fotoReal && !e.imagem_id ? " por foto real" : ""}`, secao: e.secao };
}

function planoDoAjusteDaMarca(site: SiteDaPrevia, chave: keyof AjustesDaMarcaNoSite, valor: string | null, resumo: string): PlanoDaEdicao {
  const estilo = obj(site.estilo);
  const atual = normalizarAjustes(estilo.ajustes) || {};
  const antes = (atual as Record<string, unknown>)[chave];
  const depois = valor || undefined;
  if (igualProfundo(antes, depois)) return { modo: "nada", resumo: "Já está assim", secao: null };
  // A lista de ajustes salva é sempre a normalizada (só o que vale).
  const alvos: AlvoDaEdicao[] = [];
  if (!igualProfundo(estilo.ajustes, Object.keys(atual).length ? atual : undefined)) alvos.push({ coluna: "estilo", caminho: ["ajustes"], antes: estilo.ajustes, depois: Object.keys(atual).length ? atual : undefined });
  alvos.push({ coluna: "estilo", caminho: ["ajustes", chave], antes, depois });
  return { modo: "direto", alvos, campos: aplicarAlvos(site, alvos), resumo, secao: null };
}

/** O lugar de uma seção visível no mapa (página e posição), ou a global. */
function acharVisivel(m: MapaDoSite, uid: string): { pagina: number; posicao: number } | { global: true } | null {
  if (m.globais.indexOf(uid) >= 0) return { global: true };
  for (let p = 0; p < m.paginas.length; p++) {
    const k = m.paginas[p].secoes.findIndex((s) => s.uid === uid);
    if (k >= 0) return { pagina: p, posicao: k };
  }
  return null;
}

/** O mapa salvo no formato do banco (sem campo indefinido). */
const mapaParaSalvar = (m: MapaDoSite): Record<string, unknown> => JSON.parse(JSON.stringify(m)) as Record<string, unknown>;

function planoDaSecao(site: SiteDaPrevia, e: Extract<EdicaoDaPrevia, { tipo: "secao_visivel" | "secao_mover" }>): PlanoDaEdicao {
  const atual = mapaDoSite({ mapa: site.mapa, tipo: site.tipo, direcao: site.direcao || {} });
  const m: MapaDoSite = JSON.parse(JSON.stringify(atual));
  const ocultas: SecaoOculta[] = m.ocultas ? m.ocultas.slice() : [];
  const nome = rotuloDaSecao(e.secao);
  const onde = acharVisivel(m, e.secao);
  let resumo = "";
  if (e.tipo === "secao_visivel" && !e.visivel) {
    if (!onde) return { modo: "nada", resumo: `${nome} já está escondida`, secao: e.secao };
    if ("global" in onde) {
      m.globais = m.globais.filter((g) => g !== e.secao);
      ocultas.push({ uid: e.secao, tipo: e.secao, pagina: null, posicao: 0 });
    } else {
      const pagina = m.paginas[onde.pagina];
      if (pagina.secoes.length <= 1) throw new ErroDaPrevia(409, "ultima_secao", "A página precisa de ao menos uma seção à vista.");
      const s = pagina.secoes[onde.posicao];
      pagina.secoes = pagina.secoes.filter((_, i) => i !== onde.posicao);
      const oculta: SecaoOculta = { uid: s.uid, tipo: s.tipo, pagina: pagina.id, posicao: onde.posicao };
      if (s.nota) oculta.nota = s.nota;
      if (s.variante) oculta.variante = s.variante;
      ocultas.push(oculta);
    }
    resumo = `${nome} escondida`;
  } else if (e.tipo === "secao_visivel") {
    const k = ocultas.findIndex((o) => o.uid === e.secao);
    if (k < 0) return { modo: "nada", resumo: onde ? `${nome} já está à vista` : `${nome} não está no site`, secao: e.secao };
    const o = ocultas[k];
    ocultas.splice(k, 1);
    if (o.pagina === null) {
      if (m.globais.indexOf(o.uid) < 0) m.globais = o.uid === "topo" ? ["topo"].concat(m.globais) : m.globais.concat([o.uid]);
    } else {
      const pagina = m.paginas.find((p) => p.id === o.pagina);
      if (!pagina) throw new ErroDaPrevia(409, "pagina_inexistente", "A página desta seção não existe mais.");
      const volta: { uid: string; tipo: string; nota?: string; variante?: string } = { uid: o.uid, tipo: o.tipo };
      if (o.nota) volta.nota = o.nota;
      if (o.variante) volta.variante = o.variante;
      pagina.secoes.splice(Math.min(o.posicao, pagina.secoes.length), 0, volta);
    }
    resumo = `${nome} de volta`;
  } else {
    if (!onde) throw new ErroDaPrevia(404, "secao_inexistente", "Essa seção não está à vista no site.");
    if ("global" in onde) throw new ErroDaPrevia(409, "secao_global", "O topo e o rodapé ficam sempre no mesmo lugar.");
    const lista = m.paginas[onde.pagina].secoes;
    const para = e.direcao === "subir" ? onde.posicao - 1 : onde.posicao + 1;
    if (para < 0 || para >= lista.length) return { modo: "nada", resumo: e.direcao === "subir" ? `${nome} já é a primeira` : `${nome} já é a última`, secao: e.secao };
    const troca = lista[para];
    lista[para] = lista[onde.posicao];
    lista[onde.posicao] = troca;
    resumo = `${nome} ${e.direcao === "subir" ? "subiu" : "desceu"}`;
  }
  if (ocultas.length) m.ocultas = ocultas;
  else delete m.ocultas;
  // Passa pela mesma leitura do banco (o que não valer cai aqui, não no site).
  const depois = mapaParaSalvar(normalizarMapa(m, m.tipo));
  if (igualProfundo(depois, mapaParaSalvar(atual))) return { modo: "nada", resumo: "Nada mudou", secao: e.secao };
  const alvo: AlvoDaEdicao = { coluna: "mapa", caminho: [], antes: site.mapa && typeof site.mapa === "object" ? site.mapa : {}, depois };
  return { modo: "direto", alvos: [alvo], campos: { mapa: depois }, resumo, secao: e.secao };
}

/** A instrução do ajuste que o motor recebe (texto que não é da copy, ou o pedido livre). */
export function instrucaoDoAjuste(e: Extract<EdicaoDaPrevia, { tipo: "texto_livre" | "pedido" }>): string {
  const nome = rotuloDaSecao(e.secao);
  if (e.tipo === "pedido") return textoLimpo(`Na seção ${nome} (${e.secao}): ${e.instrucao}`, 1500);
  if (!e.antes) return textoLimpo(`Na seção ${nome} (${e.secao}), acrescente o texto "${e.valor}". Não mude mais nada.`, 1500);
  if (!e.valor) return textoLimpo(`Na seção ${nome} (${e.secao}), tire o texto "${e.antes}". Não mude mais nada.`, 1500);
  return textoLimpo(`Na seção ${nome} (${e.secao}), troque o texto "${e.antes}" por "${e.valor}". Não mude mais nada.`, 1500);
}

/**
 * O plano de uma edição. `fotoReal` é a foto do acervo já lida pelo servidor
 * (com a regra da marca), quando a edição troca por uma foto real.
 */
export function planejarEdicao(site: SiteDaPrevia, e: EdicaoDaPrevia, extra: { fotoReal?: ImagemDaPrevia | null } = {}): PlanoDaEdicao {
  if (e.tipo === "texto") return planoDoTexto(site, e);
  if (e.tipo === "imagem") return planoDaImagem(site, e, extra.fotoReal || null);
  if (e.tipo === "cor") {
    const nomes: Record<PapelDaCor, string> = { destaque: "Cor de destaque", fundo: "Cor de fundo", texto: "Cor do texto" };
    return planoDoAjusteDaMarca(site, e.papel, e.hex, e.hex ? `${nomes[e.papel]}: ${e.hex}` : `${nomes[e.papel]}: a da marca`);
  }
  if (e.tipo === "fonte") {
    return planoDoAjusteDaMarca(site, e.papel === "titulo" ? "fonte_titulo" : "fonte_texto", e.nome, `Fonte ${e.papel === "titulo" ? "dos títulos" : "do texto"}: ${e.nome || "a da marca"}`);
  }
  if (e.tipo === "secao_visivel" || e.tipo === "secao_mover") return planoDaSecao(site, e);
  return { modo: "ajuste", secao: e.secao, instrucao: instrucaoDoAjuste(e), resumo: e.tipo === "pedido" ? `Pedido em ${rotuloDaSecao(e.secao)}: ${curto(e.instrucao)}` : `Texto de ${rotuloDaSecao(e.secao)}: "${curto(e.valor || "(tirar)")}"` };
}

/**
 * Desfazer uma edição direta: volta o "antes" de cada alvo, só se o ponto
 * ainda está como a edição deixou. Se alguém mexeu depois, devolve o
 * conflito (a tela pede para desfazer primeiro o que veio depois).
 */
export function planejarDesfazer(site: SiteDaPrevia, alvos: AlvoDaEdicao[]): { campos: Record<string, unknown> } | { conflito: string } {
  if (!alvos.length) return { conflito: "Esta edição não guardou o que mudou." };
  // Da última para a primeira: cada alvo confere o valor que ficou depois dele.
  let simulado: SiteDaPrevia = { ...site };
  for (let i = alvos.length - 1; i >= 0; i--) {
    const a = alvos[i];
    const atual = valorEm(colunaInicial(simulado, a.coluna), a.caminho);
    if (!igualProfundo(atual, a.depois)) return { conflito: "Este ponto mudou depois desta edição. Desfaça primeiro as edições mais novas dele." };
    const campos = aplicarAlvos(simulado, [a], "antes");
    simulado = { ...simulado, ...campos };
  }
  const saida: Record<string, unknown> = {};
  alvos.forEach((a) => (saida[a.coluna] = (simulado as Record<string, unknown>)[a.coluna]));
  return { campos: saida };
}

// ------------------------------------------------------------------ seções na construção

export type EstadoDaSecao = "pronta" | "construindo" | "na_fila" | "falhou" | "pendente";

export const ROTULO_DO_ESTADO_DA_SECAO: Record<EstadoDaSecao, string> = {
  pronta: "Pronta",
  construindo: "Construindo agora",
  na_fila: "Na fila do motor",
  falhou: "Não saiu da última vez",
  pendente: "Ainda não construída",
};

const listaDeTexto = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);

/**
 * Em que ponto cada seção está, pelos trabalhos do motor (mais novo primeiro,
 * como a fila devolve). Precedência: construindo agora, pronta, na fila,
 * falhou, pendente. "Pronta" conta o que o motor entregou, inclusive no meio
 * de um trabalho que ainda roda ou que parou (resultado.secoes).
 */
export function estadoDasSecoes(trabalhos: Array<Pick<TrabalhoDoMotor, "tipo" | "estado" | "resultado" | "instrucao">>, uids: string[]): Record<string, EstadoDaSecao> {
  const prontas = new Set<string>();
  const construindo = new Set<string>();
  const naFila = new Set<string>();
  const falhou = new Set<string>();
  for (const t of trabalhos) {
    if (t.tipo !== "construir" && t.tipo !== "ajustar") continue;
    const r = t.resultado || {};
    const pedidas = listaDeTexto(r.secoes_pedidas).concat(typeof r.secao_pedida === "string" ? [r.secao_pedida] : []);
    const feitas = listaDeTexto(r.secoes);
    if (t.tipo === "construir" && (t.estado === "feito" || t.estado === "parado" || t.estado === "executando" || t.estado === "parando")) feitas.forEach((s) => prontas.add(s));
    if (t.estado === "executando" || t.estado === "parando") {
      if (typeof r.secao_atual === "string" && r.secao_atual) construindo.add(r.secao_atual);
      pedidas.filter((s) => feitas.indexOf(s) < 0 && s !== r.secao_atual).forEach((s) => naFila.add(s));
    } else if (t.estado === "na_fila") pedidas.forEach((s) => naFila.add(s));
    else if (t.estado === "falhou" && t.tipo === "construir") {
      pedidas.filter((s) => feitas.indexOf(s) < 0).forEach((s) => falhou.add(s));
      (Array.isArray(r.secoes_desfeitas) ? (r.secoes_desfeitas as Array<{ secao?: unknown }>) : []).forEach((x) => typeof x.secao === "string" && falhou.add(x.secao));
    } else if (t.estado === "feito" && t.tipo === "construir") (Array.isArray(r.secoes_desfeitas) ? (r.secoes_desfeitas as Array<{ secao?: unknown }>) : []).forEach((x) => typeof x.secao === "string" && falhou.add(x.secao));
  }
  const saida: Record<string, EstadoDaSecao> = {};
  uids.forEach((u) => {
    saida[u] = construindo.has(u) ? "construindo" : prontas.has(u) ? "pronta" : naFila.has(u) ? "na_fila" : falhou.has(u) ? "falhou" : "pendente";
  });
  return saida;
}

// ------------------------------------------------------------------ levar a edição ao site do motor

/**
 * Trabalhos que escrevem o pacote no projeto quando o worker os pega (o
 * worker lê `pedido.pacote` na hora de rodar). Publicar fica de fora da troca:
 * ele sai com o que foi confirmado.
 */
export const TIPOS_QUE_LEVAM_O_PACOTE = ["construir", "ajustar", "revisar", "conteudo"];

export type DestinoDaEdicao = {
  /** Pedidos na fila que ganham o pacote novo (o worker ainda não pegou). */
  atualizar: string[];
  /** Pôr um "conteudo" no fim da fila quando nenhum dos de cima ficou com o pacote novo. */
  criar: boolean;
  /** Um publicar ainda vai rodar: ele escreve o pacote dele, então a edição precisa de um "conteudo" depois. */
  publicarAberto: boolean;
};

/**
 * Para onde vai a edição de conteúdo da prévia, pela fila do site (mais novo
 * primeiro). A fila do motor é serial por projeto e por criado_em: o que
 * importa é que o ÚLTIMO trabalho a escrever o pacote leve o pacote novo.
 *  - pedido que escreve o pacote e ainda está na fila: troca o pacote dele
 *    (vale também para o construir de antes do primeiro commit, o caso do
 *    "enquanto está sendo construído");
 *  - nada na fila para trocar, mas o projeto existe (algum commit) ou um
 *    trabalho com o pacote velho está rodando: um "conteudo" no fim da fila;
 *  - sem projeto e sem nada aberto: nada a fazer (o próximo construir nasce
 *    do site já editado).
 */
export function destinoDaEdicao(lista: Array<{ id: string; tipo: string; estado: string; commit?: string | null }>): DestinoDaEdicao {
  const leva = (t: { tipo: string }) => TIPOS_QUE_LEVAM_O_PACOTE.indexOf(t.tipo) >= 0;
  const atualizar = lista.filter((t) => leva(t) && t.estado === "na_fila").map((t) => t.id);
  const rodandoComPacoteVelho = lista.some((t) => leva(t) && (t.estado === "executando" || t.estado === "parando"));
  const publicarAberto = lista.some((t) => t.tipo === "publicar" && (t.estado === "na_fila" || t.estado === "executando" || t.estado === "parando"));
  const temProjeto = lista.some((t) => !!t.commit);
  return { atualizar, criar: temProjeto || rodandoComPacoteVelho || publicarAberto, publicarAberto };
}

/** O pacote de quando? (carimbo `pedido.pacote_de`; sem carimbo = mais velho que tudo). */
export function pacoteMaisNovo(atual: unknown, novo: string | null | undefined): boolean {
  const a = typeof atual === "string" ? Date.parse(atual) : NaN;
  const n = typeof novo === "string" ? Date.parse(novo) : NaN;
  if (!isFinite(a)) return true;
  if (!isFinite(n)) return false;
  return n >= a;
}

/**
 * O pacote novo para um pedido que já estava na fila: o construir continua
 * com a lista de seções que pediu, e os anexos da conversa (referencias/)
 * do pedido antigo continuam lá.
 */
export function pacoteParaOPedido(antigo: Record<string, unknown>, novo: Record<string, unknown>, tipo: string): Record<string, unknown> {
  const arquivosNovos = Array.isArray(novo.arquivos) ? (novo.arquivos as Array<Record<string, unknown>>) : [];
  const destinos = arquivosNovos.map((a) => String(a && a.destino));
  const anexos = (Array.isArray(antigo.arquivos) ? (antigo.arquivos as Array<Record<string, unknown>>) : []).filter(
    (a) => a && typeof a.destino === "string" && a.destino.indexOf("referencias/") === 0 && destinos.indexOf(a.destino) < 0,
  );
  const saida: Record<string, unknown> = { ...novo, arquivos: arquivosNovos.concat(anexos) };
  if (tipo === "construir" && Array.isArray(antigo.secoes)) saida.secoes = antigo.secoes;
  return saida;
}

// ------------------------------------------------------------------ estado do motor

export type ExecutorDaPrevia = { nome: string; visto_em: string; versao: string | null; capacidades: Record<string, unknown>; trabalho_id?: string | null } | null;

export type EstadoDoMotor = {
  codigo: "sem_worker" | "caiu" | "rodando" | "parando" | "na_fila" | "livre";
  rotulo: string;
  detalhe: string | null;
  tom: "ok" | "andando" | "atencao" | "erro";
  fila: number;
  trabalho: Pick<TrabalhoDoMotor, "id" | "tipo" | "estado" | "custo_usd" | "teto_usd"> | null;
  avisos: string[];
};

/** "agora", "há 5 min", "há 3 h", "há 2 dias". */
export function haQuanto(iso: string | null | undefined, agora = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!isFinite(t)) return "";
  const min = Math.max(0, Math.round((agora - t) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

const usdCurto = (v: number) => `US$ ${(Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace(".", ",")}`;

/**
 * O estado do motor para a tela, em uma linha: sem worker (nunca ligou ou
 * parou de bater), caiu no meio de um trabalho, rodando (o quê e quanto já
 * gastou), na fila, ou livre. Os avisos dizem o que falta na máquina da
 * agência (túnel da prévia, chave do provedor): é operação, não código.
 */
export function estadoDoMotor(executor: ExecutorDaPrevia, trabalhos: Array<Pick<TrabalhoDoMotor, "id" | "tipo" | "estado" | "custo_usd" | "teto_usd" | "resultado">>, agora = Date.now()): EstadoDoMotor {
  const vivo = !!executor && executorVivo(executor.visto_em, agora);
  const abertos = trabalhos.filter((t) => t.estado === "na_fila" || t.estado === "executando" || t.estado === "parando");
  const fila = abertos.filter((t) => t.estado === "na_fila").length;
  // SPV: o que espera é só a edição da prévia (o "conteudo"), não um trabalho de código.
  const soEdicao = fila > 0 && abertos.every((t) => t.estado !== "na_fila" || t.tipo === "conteudo");
  const rodando = abertos.find((t) => t.estado === "executando" || t.estado === "parando") || null;
  const avisos: string[] = [];
  const caps = executor ? executor.capacidades || {} : {};
  if (vivo && caps.tunel === false) avisos.push("A prévia do motor abre só na máquina da agência (cloudflared não instalado).");
  if (vivo && caps.openrouter === false && caps.anthropic === false && caps.openai === false) avisos.push("O worker está sem chave de provedor de IA: construir e ajustar vão falhar.");
  const trabalho = rodando ? { id: rodando.id, tipo: rodando.tipo, estado: rodando.estado, custo_usd: rodando.custo_usd, teto_usd: rodando.teto_usd } : null;
  if (!vivo) {
    const visto = executor ? haQuanto(executor.visto_em, agora) : "";
    if (rodando) {
      return { codigo: "caiu", rotulo: "O motor parou no meio de um trabalho", detalhe: visto ? `Última batida ${visto}. Ligue o worker de novo; o trabalho continua de onde parou ou pode ser parado.` : "Ligue o worker de novo.", tom: "erro", fila, trabalho, avisos };
    }
    return {
      codigo: "sem_worker",
      rotulo: executor ? `Motor desligado (visto ${visto})` : "Motor desligado: o worker nunca ligou",
      detalhe: soEdicao
        ? "A edição da prévia chega ao site do motor quando ele ligar. A prévia rápida já mostra."
        : fila
          ? `${fila} ${fila === 1 ? "pedido espera" : "pedidos esperam"} na fila até ele ligar.`
          : "Os pedidos esperam na fila até ele ligar. A prévia rápida funciona sem ele.",
      tom: fila && !soEdicao ? "erro" : "atencao",
      fila,
      trabalho: null,
      avisos,
    };
  }
  if (rodando) {
    const r = rodando.resultado || {};
    const secao = typeof r.secao_atual === "string" && r.secao_atual ? r.secao_atual : null;
    const oQue = rodando.tipo === "construir" && secao ? `Construindo ${rotuloDaSecao(secao)}` : rodando.tipo === "ajustar" && secao ? `Ajustando ${rotuloDaSecao(secao)}` : ROTULO_DO_TIPO[rodando.tipo] || "Trabalhando";
    const pedidas = listaDeTexto(r.secoes_pedidas);
    const feitas = listaDeTexto(r.secoes);
    const partes = [rodando.tipo === "construir" && pedidas.length ? `${feitas.length} de ${pedidas.length} seções` : "", rodando.teto_usd > 0 ? `${usdCurto(rodando.custo_usd)} de ${usdCurto(rodando.teto_usd)}` : "", fila ? `${fila} na fila` : ""].filter(Boolean);
    return { codigo: rodando.estado === "parando" ? "parando" : "rodando", rotulo: rodando.estado === "parando" ? "Parando no próximo passo" : oQue, detalhe: partes.join(" · ") || null, tom: "andando", fila, trabalho, avisos };
  }
  if (fila) {
    const outro = executor && executor.trabalho_id && !abertos.some((t) => t.id === executor.trabalho_id);
    if (soEdicao) return { codigo: "na_fila", rotulo: "Levando a edição da prévia ao site do motor", detalhe: "Sem custo: só o pacote novo e um commit.", tom: "andando", fila, trabalho: null, avisos };
    return { codigo: "na_fila", rotulo: `${fila} ${fila === 1 ? "pedido" : "pedidos"} na fila`, detalhe: outro ? "O motor termina o trabalho de outro site e pega este." : "O motor pega em instantes.", tom: "andando", fila, trabalho: null, avisos };
  }
  return { codigo: "livre", rotulo: "Motor ligado e livre", detalhe: executor ? `Worker ${executor.nome}` : null, tom: "ok", fila: 0, trabalho: null, avisos };
}
