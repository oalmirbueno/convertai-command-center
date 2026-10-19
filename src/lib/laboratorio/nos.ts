/**
 * Laboratório (19/10/2026): o grafo do canvas de projetos, em funções puras.
 * Contrato com a função `laboratorio` em
 * Aceleriq-Laboratorio/ESPEC-LABORATORIO.md (tipos de nó, máx. 80 nós e 160
 * ligações, operações do agente do projeto).
 *
 * Nada aqui fala com o servidor: a tela monta e valida o grafo, e a função
 * confere de novo antes de rodar. Regex só simples (sem lookbehind, sem
 * classe Unicode, sem grupo com nome): piso Safari 11 / Chrome 64.
 */

export type TipoDeNo =
  | "contexto"
  | "midia"
  | "config"
  | "gravity"
  | "agente"
  | "copy"
  | "imagem"
  | "carrossel"
  | "logo"
  | "landing"
  | "anuncio"
  | "agente_externo";

/** O que sai de um nó (o que o nó seguinte recebe). */
export type Saida = "texto" | "imagens" | "config" | "gravity" | "html" | "json" | "tarefa";

/**
 * Tipos de campo do inspetor. "modelo" é modelo de texto e "motor" é motor de
 * imagem (os dois vêm do catálogo ia_modelos); "operador" vem de
 * internal_operators (os ativos, como a Execução lê).
 */
export type TipoDeCampo = "texto" | "textoLongo" | "numero" | "escolha" | "modelo" | "motor" | "operador" | "imagens";

export interface CampoDoNo {
  chave: string;
  rotulo: string;
  tipo: TipoDeCampo;
  opcoes?: ReadonlyArray<{ valor: string; rotulo: string }>;
  min?: number;
  max?: number;
  dica?: string;
}

export interface DefinicaoDoNo {
  tipo: TipoDeNo;
  rotulo: string;
  /** Uma linha para o title da paleta. */
  dica: string;
  saida: Saida;
  /**
   * Os tipos de nó que podem entrar neste (origem). Cópia de ENTRADAS_ACEITAS
   * da função (supabase/functions/laboratorio/modulos/regras.ts): o teste
   * laboratorio-contrato confere par a par.
   */
  entradas: TipoDeNo[];
  /** Gera algo (gasta): tem "Rodar". */
  roda: boolean;
  /** Campos de `dados`, com os nomes que a função lê (CAMPOS_DO_TIPO). */
  campos: CampoDoNo[];
  padrao: Record<string, unknown>;
  /** Cor da borda e da linha que sai dele. */
  cor: string;
}

export const LIMITE_DE_NOS = 80;
export const LIMITE_DE_LIGACOES = 160;
/** Máximo de imagens por Resultado/Configuração (MAX_IMAGENS_POR_NO da função). */
export const MAX_IMAGENS_POR_NO = 4;

/** Proporções que a função aceita (PROPORCOES de regras.ts). Vazio: a da Configuração ligada. */
export const PROPORCOES = [
  { valor: "1:1", rotulo: "1:1 quadrado" },
  { valor: "4:5", rotulo: "4:5 feed" },
  { valor: "9:16", rotulo: "9:16 story" },
  { valor: "16:9", rotulo: "16:9 paisagem" },
  { valor: "3:2", rotulo: "3:2 paisagem" },
  { valor: "2:3", rotulo: "2:3 retrato" },
] as const;

export const QUALIDADES = [
  { valor: "baixa", rotulo: "Baixa" },
  { valor: "media", rotulo: "Média" },
  { valor: "alta", rotulo: "Alta" },
] as const;

export const FORMATOS_DE_COPY = [
  { valor: "anuncio", rotulo: "Anúncio" },
  { valor: "legenda", rotulo: "Legenda" },
  { valor: "landing", rotulo: "Landing" },
  { valor: "email", rotulo: "E-mail" },
  { valor: "roteiro_curto", rotulo: "Roteiro curto" },
] as const;

/** Slug do Hermes em internal_operators (OPERADOR_HERMES da função). */
export const OPERADOR_PADRAO = "default";

/** Modelos de texto da caixa da Início e do agente do projeto (padrão: o MODELO_TEXTO_PADRAO da função). */
export const MODELO_PADRAO_DO_LAB = "openrouter:anthropic/claude-opus-5.5";
export const MODELOS_DO_LAB = [
  { valor: MODELO_PADRAO_DO_LAB, rotulo: "Claude Opus 5.5" },
  { valor: "openrouter:anthropic/claude-sonnet-5.5", rotulo: "Claude Sonnet 5.5" },
  { valor: "openrouter:openai/gpt-6.1-sol", rotulo: "GPT-6.1 Sol" },
  { valor: "openrouter:openai/gpt-6-luna", rotulo: "GPT-6 Luna" },
] as const;

const PROMPT: CampoDoNo = { chave: "prompt", rotulo: "Pedido", tipo: "textoLongo" };
const MOTOR: CampoDoNo = { chave: "motor", rotulo: "Motor de imagem", tipo: "motor" };
const MODELO: CampoDoNo = { chave: "modelo_id", rotulo: "Modelo", tipo: "modelo" };
const PROPORCAO: CampoDoNo = { chave: "proporcao", rotulo: "Proporção", tipo: "escolha", opcoes: PROPORCOES };
const QUALIDADE: CampoDoNo = { chave: "qualidade", rotulo: "Qualidade", tipo: "escolha", opcoes: QUALIDADES };
const QUANTIDADE: CampoDoNo = { chave: "quantidade", rotulo: "Quantidade", tipo: "numero", min: 1, max: MAX_IMAGENS_POR_NO };

const TEXTOS: TipoDeNo[] = ["contexto", "agente", "copy"];

export const TIPOS_DE_NO: Record<TipoDeNo, DefinicaoDoNo> = {
  contexto: {
    tipo: "contexto",
    rotulo: "Contexto",
    dica: "O texto do pedido ou do projeto",
    saida: "texto",
    entradas: [],
    roda: false,
    campos: [{ chave: "texto", rotulo: "Texto", tipo: "textoLongo" }],
    padrao: { texto: "" },
    cor: "#64748b",
  },
  midia: {
    tipo: "midia",
    rotulo: "Mídia",
    dica: "Imagem ou arquivo de entrada",
    saida: "imagens",
    entradas: [],
    roda: false,
    campos: [{ chave: "imagens", rotulo: "Imagens", tipo: "imagens" }],
    padrao: { imagens: [] },
    cor: "#0ea5e9",
  },
  config: {
    tipo: "config",
    rotulo: "Configuração",
    dica: "Proporção, quantidade, qualidade e motor para os Resultados ligados",
    saida: "config",
    entradas: [],
    roda: false,
    campos: [PROPORCAO, QUANTIDADE, QUALIDADE, MOTOR],
    padrao: { proporcao: "1:1", quantidade: 1, qualidade: "media" },
    cor: "#a1a1aa",
  },
  gravity: {
    tipo: "gravity",
    rotulo: "Base comum",
    dica: "Prompt base e referências aplicados a todos os Resultados ligados",
    saida: "gravity",
    entradas: [...TEXTOS, "midia", "imagem", "logo"],
    roda: false,
    campos: [
      { chave: "prompt_base", rotulo: "Prompt base", tipo: "textoLongo" },
      { chave: "referencias", rotulo: "Referências", tipo: "imagens" },
    ],
    padrao: { prompt_base: "" },
    cor: "#8b5cf6",
  },
  agente: {
    tipo: "agente",
    rotulo: "Agente",
    dica: "Um modelo de texto com instrução própria",
    saida: "texto",
    entradas: [...TEXTOS, "midia", "imagem", "carrossel", "logo", "landing", "anuncio"],
    roda: true,
    campos: [MODELO, { chave: "instrucao", rotulo: "Instrução", tipo: "textoLongo" }],
    padrao: { modelo_id: MODELO_PADRAO_DO_LAB, instrucao: "" },
    cor: "#10b981",
  },
  copy: {
    tipo: "copy",
    rotulo: "Copy",
    dica: "Especialista em texto: anúncio, legenda, landing, e-mail, roteiro curto",
    saida: "texto",
    entradas: [...TEXTOS, "midia", "imagem", "carrossel", "logo", "anuncio"],
    roda: true,
    campos: [
      { chave: "formato", rotulo: "Formato", tipo: "escolha", opcoes: FORMATOS_DE_COPY },
      { chave: "instrucao", rotulo: "Instrução", tipo: "textoLongo" },
    ],
    padrao: { formato: "anuncio", instrucao: "" },
    cor: "#f59e0b",
  },
  imagem: {
    tipo: "imagem",
    rotulo: "Resultado",
    dica: "Gera imagens com os textos, a base comum e a configuração ligados",
    saida: "imagens",
    entradas: [...TEXTOS, "midia", "config", "gravity", "imagem", "logo"],
    roda: true,
    // Proporção, quantidade, qualidade e motor vazios: valem os da Configuração ligada (o do nó vence).
    campos: [PROMPT, PROPORCAO, QUANTIDADE, QUALIDADE, MOTOR],
    padrao: { prompt: "" },
    cor: "#ec4899",
  },
  carrossel: {
    tipo: "carrossel",
    rotulo: "Carrossel",
    dica: "Planeja as lâminas e gera as artes em ordem",
    saida: "imagens",
    entradas: [...TEXTOS, "midia", "config", "gravity", "imagem", "logo"],
    roda: true,
    campos: [{ chave: "tema", rotulo: "Tema", tipo: "textoLongo" }, { chave: "laminas", rotulo: "Lâminas", tipo: "numero", min: 2, max: 10 }, PROPORCAO],
    padrao: { tema: "", laminas: 5 },
    cor: "#f43f5e",
  },
  logo: {
    tipo: "logo",
    rotulo: "Logo",
    dica: "Variações de logo; o Jev escolhe a melhor e explica",
    saida: "imagens",
    entradas: [...TEXTOS, "midia", "config", "gravity"],
    roda: true,
    campos: [
      { chave: "nome", rotulo: "Nome", tipo: "texto" },
      { chave: "conceito", rotulo: "Conceito", tipo: "textoLongo" },
      { chave: "paleta", rotulo: "Paleta", tipo: "texto" },
      { chave: "estilo", rotulo: "Estilo", tipo: "texto" },
      { chave: "n", rotulo: "Variações", tipo: "numero", min: 1, max: 8 },
    ],
    padrao: { nome: "", conceito: "", paleta: "", estilo: "", n: 4 },
    cor: "#eab308",
  },
  landing: {
    tipo: "landing",
    rotulo: "Landing page",
    dica: "Uma página única em HTML, com prévia",
    saida: "html",
    entradas: [...TEXTOS, "midia", "gravity", "imagem", "carrossel", "logo"],
    roda: true,
    campos: [
      { chave: "objetivo", rotulo: "Objetivo da página", tipo: "textoLongo" },
      { chave: "secoes", rotulo: "Seções", tipo: "textoLongo" },
    ],
    padrao: { objetivo: "", secoes: "" },
    cor: "#06b6d4",
  },
  anuncio: {
    tipo: "anuncio",
    rotulo: "Anúncio",
    dica: "Títulos, texto, CTA e público; nasce pausado",
    saida: "json",
    entradas: [...TEXTOS, "midia", "imagem", "carrossel", "logo"],
    roda: true,
    campos: [
      { chave: "objetivo", rotulo: "Objetivo", tipo: "texto" },
      { chave: "publico", rotulo: "Público", tipo: "texto" },
      { chave: "oferta", rotulo: "Oferta", tipo: "texto" },
    ],
    padrao: { objetivo: "", publico: "", oferta: "" },
    cor: "#3b82f6",
  },
  agente_externo: {
    tipo: "agente_externo",
    rotulo: "Agente externo",
    dica: "Manda a etapa para o Hermes ou um agente do Paperclip",
    saida: "tarefa",
    entradas: [...TEXTOS, "midia", "imagem", "carrossel", "logo", "landing", "anuncio"],
    roda: true,
    campos: [
      { chave: "operador", rotulo: "Operador", tipo: "operador" },
      { chave: "instrucao", rotulo: "Instrução", tipo: "textoLongo" },
    ],
    padrao: { operador: OPERADOR_PADRAO, instrucao: "" },
    cor: "#71717a",
  },
};

/** Só um por destino: duas configurações ou duas bases comuns se contradiriam (UM_POR_DESTINO da função). */
const UM_POR_DESTINO: TipoDeNo[] = ["config", "gravity"];

export const ORDEM_DA_PALETA: TipoDeNo[] = ["contexto", "midia", "config", "gravity", "agente", "copy", "imagem", "carrossel", "logo", "landing", "anuncio", "agente_externo"];

const NOMES_DAS_SAIDAS: Record<Saida, string> = {
  texto: "texto",
  imagens: "imagens",
  config: "configuração",
  gravity: "base comum",
  html: "página",
  json: "pacote",
  tarefa: "tarefa",
};

export interface NoDoLab {
  id: string;
  tipo: TipoDeNo;
  x: number;
  y: number;
  dados: Record<string, unknown>;
}

export interface LigacaoDoLab {
  id: string;
  de: string;
  para: string;
}

export interface CanvasDoLab {
  nos: NoDoLab[];
  ligacoes: LigacaoDoLab[];
  viewport: { x: number; y: number; zoom: number };
}

export const canvasVazio = (): CanvasDoLab => ({ nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } });

export const ehTipoDeNo = (v: unknown): v is TipoDeNo => typeof v === "string" && Object.prototype.hasOwnProperty.call(TIPOS_DE_NO, v);

let contador = 0;
export function novoId(prefixo = "n"): string {
  contador = (contador + 1) % 1000;
  return `${prefixo}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}${contador}`;
}

const numero = (v: unknown, padrao: number) => {
  const n = Number(v);
  return isFinite(n) ? n : padrao;
};

/** Lê o canvas como vier do banco (jsonb), descartando o que não serve. */
export function normalizarCanvas(bruto: unknown): CanvasDoLab {
  const c = bruto && typeof bruto === "object" ? (bruto as Record<string, any>) : {};
  const nos: NoDoLab[] = [];
  (Array.isArray(c.nos) ? c.nos : []).forEach((n: any, i: number) => {
    if (!n || typeof n !== "object" || !ehTipoDeNo(n.tipo) || nos.length >= LIMITE_DE_NOS) return;
    const id = typeof n.id === "string" && n.id ? n.id : `n_${i}`;
    if (nos.some((x) => x.id === id)) return;
    nos.push({
      id,
      tipo: n.tipo,
      x: Math.round(numero(n.x, 80 + i * 40)),
      y: Math.round(numero(n.y, 80 + i * 40)),
      dados: { ...TIPOS_DE_NO[n.tipo as TipoDeNo].padrao, ...(n.dados && typeof n.dados === "object" ? n.dados : {}) },
    });
  });
  const ligacoes: LigacaoDoLab[] = [];
  (Array.isArray(c.ligacoes) ? c.ligacoes : []).forEach((l: any, i: number) => {
    if (!l || typeof l !== "object" || ligacoes.length >= LIMITE_DE_LIGACOES) return;
    const de = String(l.de || l.source || "");
    const para = String(l.para || l.target || "");
    if (!nos.some((n) => n.id === de) || !nos.some((n) => n.id === para) || de === para) return;
    if (ligacoes.some((x) => x.de === de && x.para === para)) return;
    ligacoes.push({ id: typeof l.id === "string" && l.id ? l.id : `l_${i}`, de, para });
  });
  const v = c.viewport && typeof c.viewport === "object" ? c.viewport : {};
  return { nos, ligacoes, viewport: { x: numero(v.x, 0), y: numero(v.y, 0), zoom: numero(v.zoom, 1) || 1 } };
}

export function criarNo(canvas: CanvasDoLab, tipo: TipoDeNo, pos?: { x: number; y: number }, dados?: Record<string, unknown>, id?: string): { canvas: CanvasDoLab; no: NoDoLab | null; erro?: string } {
  if (canvas.nos.length >= LIMITE_DE_NOS) return { canvas, no: null, erro: `O projeto já tem ${LIMITE_DE_NOS} nós, o máximo.` };
  const i = canvas.nos.length;
  const no: NoDoLab = {
    id: id && !canvas.nos.some((n) => n.id === id) ? id : novoId(),
    tipo,
    x: pos ? Math.round(pos.x) : 80 + (i % 4) * 300,
    y: pos ? Math.round(pos.y) : 80 + Math.floor(i / 4) * 220,
    dados: { ...TIPOS_DE_NO[tipo].padrao, ...(dados || {}) },
  };
  return { canvas: { ...canvas, nos: canvas.nos.concat(no) }, no };
}

export function removerNo(canvas: CanvasDoLab, id: string): CanvasDoLab {
  return { ...canvas, nos: canvas.nos.filter((n) => n.id !== id), ligacoes: canvas.ligacoes.filter((l) => l.de !== id && l.para !== id) };
}

export function mudarDados(canvas: CanvasDoLab, id: string, dados: Record<string, unknown>): CanvasDoLab {
  return { ...canvas, nos: canvas.nos.map((n) => (n.id === id ? { ...n, dados: { ...n.dados, ...dados } } : n)) };
}

function alcanca(canvas: CanvasDoLab, de: string, alvo: string): boolean {
  const vistos: Record<string, true> = {};
  const fila = [de];
  while (fila.length) {
    const atual = fila.shift() as string;
    if (atual === alvo) return true;
    if (vistos[atual]) continue;
    vistos[atual] = true;
    canvas.ligacoes.filter((l) => l.de === atual).forEach((l) => fila.push(l.para));
  }
  return false;
}

/** Pode ligar `de` em `para`? Devolve o motivo em português quando não pode. */
export function podeLigar(canvas: CanvasDoLab, de: string, para: string): { ok: boolean; motivo: string } {
  const origem = canvas.nos.find((n) => n.id === de);
  const destino = canvas.nos.find((n) => n.id === para);
  if (!origem || !destino) return { ok: false, motivo: "Um dos nós não está mais no quadro." };
  if (de === para) return { ok: false, motivo: "Um nó não liga nele mesmo." };
  if (canvas.ligacoes.some((l) => l.de === de && l.para === para)) return { ok: false, motivo: "Esses nós já estão ligados." };
  if (canvas.ligacoes.length >= LIMITE_DE_LIGACOES) return { ok: false, motivo: `O projeto já tem ${LIMITE_DE_LIGACOES} ligações, o máximo.` };
  const d = TIPOS_DE_NO[destino.tipo];
  const o = TIPOS_DE_NO[origem.tipo];
  if (d.entradas.indexOf(origem.tipo) < 0) {
    if (!d.entradas.length) return { ok: false, motivo: `${d.rotulo} é ponto de partida: não recebe ligação. Ligue a partir dele.` };
    const aceitos = d.entradas.map((t) => TIPOS_DE_NO[t].rotulo);
    return { ok: false, motivo: `${d.rotulo} não recebe ${NOMES_DAS_SAIDAS[o.saida]} de ${o.rotulo}. Aceita: ${aceitos.join(", ")}.` };
  }
  if (UM_POR_DESTINO.indexOf(origem.tipo) >= 0) {
    const ja = canvas.ligacoes.some((l) => l.para === para && (canvas.nos.find((n) => n.id === l.de) || { tipo: "" }).tipo === origem.tipo);
    if (ja) return { ok: false, motivo: `${d.rotulo} já tem ${o.rotulo} ligada; tire a outra antes.` };
  }
  if (alcanca(canvas, para, de)) return { ok: false, motivo: "Essa ligação fecha um círculo: o fluxo precisa ir sempre para a frente." };
  return { ok: true, motivo: "" };
}

export function ligar(canvas: CanvasDoLab, de: string, para: string): CanvasDoLab {
  if (!podeLigar(canvas, de, para).ok) return canvas;
  return { ...canvas, ligacoes: canvas.ligacoes.concat({ id: novoId("l"), de, para }) };
}

export function desligar(canvas: CanvasDoLab, de: string, para?: string): CanvasDoLab {
  // `de` sozinho é o id da ligação.
  if (para === undefined) return { ...canvas, ligacoes: canvas.ligacoes.filter((l) => l.id !== de) };
  return { ...canvas, ligacoes: canvas.ligacoes.filter((l) => !(l.de === de && l.para === para)) };
}

/** Ordem topológica (quem vem antes roda antes). Nós em círculo ficam de fora. */
export function ordemTopologica(canvas: CanvasDoLab): string[] {
  const entradas: Record<string, number> = {};
  canvas.nos.forEach((n) => (entradas[n.id] = 0));
  canvas.ligacoes.forEach((l) => (entradas[l.para] = (entradas[l.para] || 0) + 1));
  const fila = canvas.nos.filter((n) => !entradas[n.id]).map((n) => n.id);
  const saida: string[] = [];
  while (fila.length) {
    const id = fila.shift() as string;
    saida.push(id);
    canvas.ligacoes.filter((l) => l.de === id).forEach((l) => {
      entradas[l.para] -= 1;
      if (entradas[l.para] === 0) fila.push(l.para);
    });
  }
  return saida;
}

/** Organiza em colunas pela profundidade (esquerda para a direita). */
export function organizar(canvas: CanvasDoLab): CanvasDoLab {
  const nivel: Record<string, number> = {};
  ordemTopologica(canvas).forEach((id) => {
    const antes = canvas.ligacoes.filter((l) => l.para === id).map((l) => (nivel[l.de] || 0) + 1);
    nivel[id] = antes.length ? Math.max.apply(null, antes) : 0;
  });
  const porColuna: Record<number, number> = {};
  return {
    ...canvas,
    nos: canvas.nos.map((n) => {
      const col = nivel[n.id] || 0;
      const linha = porColuna[col] || 0;
      porColuna[col] = linha + 1;
      return { ...n, x: 60 + col * 320, y: 60 + linha * 220 };
    }),
  };
}

export function entradasDoNo(canvas: CanvasDoLab, id: string): NoDoLab[] {
  return canvas.ligacoes
    .filter((l) => l.para === id)
    .map((l) => canvas.nos.find((n) => n.id === l.de))
    .filter(Boolean) as NoDoLab[];
}

/** Nós que geram e estão ligados a uma Base comum (o "Gerar tudo" dela). */
export function alvosDaBase(canvas: CanvasDoLab, baseId: string): string[] {
  return canvas.ligacoes
    .filter((l) => l.de === baseId)
    .map((l) => canvas.nos.find((n) => n.id === l.para))
    .filter((n) => !!n && TIPOS_DE_NO[(n as NoDoLab).tipo].roda)
    .map((n) => (n as NoDoLab).id);
}

// ------------------------------------------------------------ operações do agente

export type TipoDeOperacao = "criar" | "ligar" | "desligar" | "definir" | "remover" | "organizar";

export interface OperacaoDoAgente {
  op: TipoDeOperacao;
  /** id do nó (criar: id novo proposto; definir/remover: o nó). */
  id?: string;
  tipo?: TipoDeNo;
  de?: string;
  para?: string;
  dados?: Record<string, unknown>;
  x?: number;
  y?: number;
  /** O que a operação faz, em português (vem do agente). */
  recibo: string;
}

/**
 * Uma operação do planejar. A função devolve o recibo de cada uma:
 * { indice, op, aceita, recibo, no_id?, ligacao_id?, operacao }, em que
 * `operacao` já vem com os ids reais (criar: `ref` é o id do nó novo;
 * definir/remover: `no`). Recusada (aceita: false) não entra: null.
 * A forma achatada ({ op, id, de, para, dados, recibo }) também vale.
 */
export function normalizarOperacao(bruta: unknown): OperacaoDoAgente | null {
  if (!bruta || typeof bruta !== "object") return null;
  const r = bruta as Record<string, any>;
  if (r.aceita === false) return null;
  const o: Record<string, any> = r.operacao && typeof r.operacao === "object" ? { ...r.operacao, recibo: r.recibo, no_id: r.no_id } : r;
  const op = String(o.op || "");
  if (["criar", "ligar", "desligar", "definir", "remover", "organizar"].indexOf(op) < 0) return null;
  const id = o.ref || o.id || o.no || o.no_id;
  const dados = o.dados && typeof o.dados === "object" ? { ...o.dados } : {};
  if (op === "definir" && typeof o.campo === "string") dados[o.campo] = o.valor;
  const saida: OperacaoDoAgente = { op: op as TipoDeOperacao, recibo: typeof o.recibo === "string" ? o.recibo : "" };
  if (typeof id === "string" && id) saida.id = id;
  if (ehTipoDeNo(o.tipo)) saida.tipo = o.tipo;
  if (typeof (o.de || o.origem) === "string") saida.de = o.de || o.origem;
  if (typeof (o.para || o.destino) === "string") saida.para = o.para || o.destino;
  if (Object.keys(dados).length) saida.dados = dados;
  if (typeof o.x === "number" && isFinite(o.x)) saida.x = o.x;
  if (typeof o.y === "number" && isFinite(o.y)) saida.y = o.y;
  if (op === "criar" && !saida.tipo) return null;
  return saida;
}

export function reciboPadrao(op: OperacaoDoAgente): string {
  if (op.recibo) return op.recibo;
  switch (op.op) {
    case "criar":
      return `Criar ${op.tipo ? TIPOS_DE_NO[op.tipo].rotulo : "nó"}`;
    case "ligar":
      return "Ligar dois nós";
    case "desligar":
      return "Desligar dois nós";
    case "definir":
      return `Ajustar ${Object.keys(op.dados || {}).join(", ") || "o nó"}`;
    case "remover":
      return "Tirar um nó";
    default:
      return "Organizar o quadro";
  }
}

export interface ResultadoDaAplicacao {
  canvas: CanvasDoLab;
  feitas: number;
  falhas: Array<{ recibo: string; motivo: string }>;
}

/**
 * Aplica as operações propostas pelo agente (planejar), na ordem. Ids que o
 * agente deu aos nós novos valem nas operações seguintes. O que não dá para
 * aplicar volta em `falhas`, com o motivo; o resto entra.
 */
export function aplicarOperacoes(canvas: CanvasDoLab, ops: OperacaoDoAgente[]): ResultadoDaAplicacao {
  let atual = canvas;
  const apelidos: Record<string, string> = {};
  const real = (id?: string) => (id ? apelidos[id] || id : "");
  let feitas = 0;
  const falhas: Array<{ recibo: string; motivo: string }> = [];
  ops.forEach((op) => {
    const recibo = reciboPadrao(op);
    if (op.op === "criar" && op.tipo) {
      const pos = op.x !== undefined && op.y !== undefined ? { x: op.x, y: op.y } : undefined;
      const r = criarNo(atual, op.tipo, pos, op.dados, op.id);
      if (!r.no) {
        falhas.push({ recibo, motivo: r.erro || "Não coube no quadro." });
        return;
      }
      if (op.id) apelidos[op.id] = r.no.id;
      atual = r.canvas;
      feitas += 1;
    } else if (op.op === "ligar") {
      const v = podeLigar(atual, real(op.de), real(op.para));
      if (!v.ok) {
        falhas.push({ recibo, motivo: v.motivo });
        return;
      }
      atual = ligar(atual, real(op.de), real(op.para));
      feitas += 1;
    } else if (op.op === "desligar") {
      atual = desligar(atual, real(op.de), real(op.para));
      feitas += 1;
    } else if (op.op === "definir") {
      if (!atual.nos.some((n) => n.id === real(op.id))) {
        falhas.push({ recibo, motivo: "O nó não está no quadro." });
        return;
      }
      atual = mudarDados(atual, real(op.id), op.dados || {});
      feitas += 1;
    } else if (op.op === "remover") {
      atual = removerNo(atual, real(op.id));
      feitas += 1;
    } else if (op.op === "organizar") {
      atual = organizar(atual);
      feitas += 1;
    }
  });
  return { canvas: atual, feitas, falhas };
}

/** Uma linha que resume o nó (cartão, lista, prévia). */
export function resumoDoNo(no: NoDoLab): string {
  const d = no.dados || {};
  const primeiro = ["texto", "prompt", "instrucao", "tema", "conceito", "prompt_base", "objetivo", "nome"]
    .map((k) => (typeof d[k] === "string" ? String(d[k]).trim() : ""))
    .find(Boolean);
  if (primeiro) return primeiro.length > 90 ? `${primeiro.slice(0, 88)}…` : primeiro;
  if (no.tipo === "config") return [d.proporcao || "1:1", d.quantidade || 1, d.qualidade || "media"].join(" · ");
  if (no.tipo === "midia") return `${Array.isArray(d.imagens) ? d.imagens.length : 0} imagem(ns)`;
  return "";
}
