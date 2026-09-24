import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, type ParteDaEstimativa, type Qualidade } from "@/lib/mesa/api";
import { normalizarFoto, type FotoDoAcervo } from "./fotoApi";
import { normalizarConferenciaDaPersona, type ConferenciaDaPersona, type Persona, type Resolucao } from "./modelosApi";

/**
 * Canvas da Mesa Foto: o grafo (cartões e ligações) que o dono monta para
 * gerar "este produto, com esta pessoa, neste ambiente, nesta pegada"
 * (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 6.4 a 6.6, 8.3 e 9.2).
 *
 * Tudo aqui é regra fixa em código, sem IA e sem React Flow (este arquivo
 * não importa o @xyflow/react: a lista do celular e os testes usam o mesmo
 * grafo sem carregar o quadro). A ordem das referências que valem é a da
 * função (canvas_montar); a da tela é a prévia com a mesma regra: produto,
 * pessoa, ambiente, estilo e o texto por último.
 */

// ------------------------------------------------------------------ tipos

export type TipoDeNo = "produto" | "modelo" | "ambiente" | "estilo" | "texto" | "gerar";
export type Entrada = "produto" | "pessoa" | "ambiente" | "estilo" | "texto";

export interface ResultadoDoCanvas {
  geracao_id: string;
  imagem_id: string | null;
  storage_bucket: string;
  storage_path: string;
  url: string;
  motor_id: string;
  status: "gerando" | "gerada" | "falhou";
  erro: string;
  custo_usd: number;
  conferencia: ConferenciaDaPersona | null;
  criado_em: string;
}

export interface DadosDoNo {
  kit_id?: string | null;
  modelo_id?: string | null;
  versao?: number | null;
  imagem_id?: string | null;
  biblioteca_id?: string | null;
  texto?: string;
  papel?: "pedido" | "restricao";
  motores?: string[];
  formato?: string;
  qualidade?: Qualidade;
  resolucao?: Resolucao | null;
  resultados?: ResultadoDoCanvas[];
}

export interface NoDoCanvas {
  id: string;
  tipo: TipoDeNo;
  x: number;
  y: number;
  dados: DadosDoNo;
}

export interface Ligacao {
  id: string;
  de: string;
  para: string;
  entrada: Entrada;
  ordem: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Canvas {
  id: string | null;
  client_id: string;
  nome: string;
  nos: NoDoCanvas[];
  ligacoes: Ligacao[];
  viewport: Viewport;
  versao: number;
  atualizado_em: string;
}

export interface ReferenciaMontada {
  ordem: number;
  papel: string;
  origem_tipo: string;
  origem_id: string;
  imagem_id: string | null;
  storage_path: string;
  storage_bucket: string;
  url: string;
  legenda: string;
}

export interface Montagem {
  referencias: ReferenciaMontada[];
  prompt: string;
  estimativa_usd: number | null;
  avisos: string[];
  /** Referências que ficaram de fora pelo limite do motor. */
  cortadas: number;
}

// ------------------------------------------------------------------ constantes

/** Tamanho fixo dos cartões no quadro (px). Sem medir depois de montar: o polyfill mínimo de ResizeObserver não percebe. */
export const TAMANHO_DO_CARTAO = { largura: 208, altura: 132 };
export const TAMANHO_DA_SAIDA = { largura: 256, altura: 248 };

export const ORDEM_DAS_ENTRADAS: Entrada[] = ["produto", "pessoa", "ambiente", "estilo", "texto"];

export const TIPOS_DE_NO: Record<TipoDeNo, { rotulo: string; dica: string; entrada: Entrada | null; cor: string; borda: string; fundo: string; texto: string }> = {
  produto: { rotulo: "Produto", dica: "Um produto do kit: identidade, nunca muda.", entrada: "produto", cor: "hsl(var(--primary))", borda: "border-primary/60", fundo: "bg-primary/10", texto: "text-primary" },
  modelo: { rotulo: "Modelo", dica: "Uma persona sintética pronta (âncora e folha).", entrada: "pessoa", cor: "hsl(var(--info))", borda: "border-info/60", fundo: "bg-info/10", texto: "text-info" },
  ambiente: { rotulo: "Ambiente", dica: "Foto de lugar ou uma descrição: lugar, luz e clima.", entrada: "ambiente", cor: "hsl(var(--warning))", borda: "border-warning/60", fundo: "bg-warning/10", texto: "text-warning" },
  estilo: { rotulo: "Estilo", dica: "Referência da biblioteca: só paleta, luz e enquadramento.", entrada: "estilo", cor: "hsl(280 70% 62%)", borda: "border-fuchsia-400/60", fundo: "bg-fuchsia-400/10", texto: "text-fuchsia-500" },
  texto: { rotulo: "Prompt", dica: "O pedido em palavras, ou uma restrição.", entrada: "texto", cor: "hsl(var(--muted-foreground))", borda: "border-border", fundo: "bg-muted", texto: "text-muted-foreground" },
  gerar: { rotulo: "Saída", dica: "Junta tudo, mostra o pedido e gera.", entrada: null, cor: "hsl(var(--foreground))", borda: "border-foreground/40", fundo: "bg-card", texto: "text-foreground" },
};

export const ROTULOS_DAS_ENTRADAS: Record<Entrada, string> = {
  produto: "Produto",
  pessoa: "Pessoa",
  ambiente: "Ambiente",
  estilo: "Estilo",
  texto: "Prompt",
};

export const TIPOS_DA_PALETA: TipoDeNo[] = ["produto", "modelo", "ambiente", "estilo", "texto", "gerar"];

export const entradaDoTipo = (t: TipoDeNo): Entrada | null => TIPOS_DE_NO[t].entrada;

// ------------------------------------------------------------------ normalizadores

const texto = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const textoOuNulo = (v: unknown): string | null => {
  const t = texto(v).trim();
  return t ? t : null;
};
const numero = (v: unknown, padrao = 0): number => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !isFinite(n) ? padrao : n;
};

const TIPOS_VALIDOS = Object.keys(TIPOS_DE_NO) as TipoDeNo[];

export function normalizarResultado(v: any): ResultadoDoCanvas | null {
  if (!v || typeof v !== "object") return null;
  const id = texto(v.geracao_id || v.id);
  if (!id) return null;
  const status = texto(v.status);
  return {
    geracao_id: id,
    imagem_id: textoOuNulo(v.imagem_id),
    storage_bucket: texto(v.storage_bucket) || "mesa",
    storage_path: texto(v.storage_path),
    url: texto(v.url),
    motor_id: texto(v.motor_id || v.modelo_imagem_id),
    status: status === "gerando" || status === "falhou" ? status : "gerada",
    erro: texto(v.erro || v.ultimo_erro),
    custo_usd: numero(v.custo_usd),
    conferencia: normalizarConferenciaDaPersona(v.conferencia),
    criado_em: texto(v.criado_em),
  };
}

function normalizarDados(tipo: TipoDeNo, v: any): DadosDoNo {
  const d = v && typeof v === "object" ? v : {};
  const saida: DadosDoNo = {};
  if (tipo === "produto") saida.kit_id = textoOuNulo(d.kit_id);
  if (tipo === "modelo") {
    saida.modelo_id = textoOuNulo(d.modelo_id);
    saida.versao = d.versao === undefined || d.versao === null ? null : numero(d.versao, 1);
  }
  if (tipo === "ambiente" || tipo === "estilo") {
    // A função grava o estilo com listas (imagem_ids, biblioteca_ids) e o texto em "guia".
    saida.imagem_id = textoOuNulo(d.imagem_id || (Array.isArray(d.imagem_ids) ? d.imagem_ids[0] : null));
    saida.biblioteca_id = textoOuNulo(d.biblioteca_id || (Array.isArray(d.biblioteca_ids) ? d.biblioteca_ids[0] : null));
    saida.texto = texto(d.texto || d.guia);
  }
  if (tipo === "texto") {
    saida.texto = texto(d.texto);
    saida.papel = texto(d.papel) === "restricao" ? "restricao" : "pedido";
  }
  if (tipo === "gerar") {
    saida.motores = Array.isArray(d.motores) ? d.motores.map(String).filter(Boolean) : [];
    saida.formato = texto(d.formato) || "4:5";
    const q = texto(d.qualidade);
    saida.qualidade = q === "baixa" || q === "media" || q === "alta" ? q : "alta";
    const r = texto(d.resolucao);
    saida.resolucao = r === "1K" || r === "2K" || r === "4K" ? r : null;
    const resultados: ResultadoDoCanvas[] = [];
    if (Array.isArray(d.resultados)) {
      d.resultados.forEach((x: any) => {
        const n = normalizarResultado(x);
        if (n) resultados.push(n);
      });
    }
    saida.resultados = resultados;
  }
  return saida;
}

export function normalizarNo(v: any): NoDoCanvas | null {
  if (!v || typeof v !== "object" || !v.id) return null;
  const bruto = texto(v.tipo);
  const tipo = (bruto === "saida" ? "gerar" : bruto === "prompt" ? "texto" : bruto) as TipoDeNo;
  if (TIPOS_VALIDOS.indexOf(tipo) < 0) return null;
  const pos = v.position && typeof v.position === "object" ? v.position : v;
  return { id: String(v.id), tipo, x: numero(pos.x), y: numero(pos.y), dados: normalizarDados(tipo, v.dados || v.data) };
}

export function normalizarLigacao(v: any, nos: NoDoCanvas[]): Ligacao | null {
  if (!v || typeof v !== "object") return null;
  const de = texto(v.de || v.source);
  const para = texto(v.para || v.target);
  const origem = nos.find((n) => n.id === de);
  const destino = nos.find((n) => n.id === para);
  if (!origem || !destino || destino.tipo !== "gerar" || origem.tipo === "gerar") return null;
  const entrada = entradaDoTipo(origem.tipo) as Entrada;
  return { id: texto(v.id) || `lig-${de}-${para}`, de, para, entrada, ordem: numero(v.ordem) };
}

export function normalizarCanvas(v: any, clientId = ""): Canvas | null {
  if (!v || typeof v !== "object") return null;
  const nos: NoDoCanvas[] = [];
  (Array.isArray(v.nos) ? v.nos : Array.isArray(v.nodes) ? v.nodes : []).forEach((b: any) => {
    const n = normalizarNo(b);
    if (n && !nos.some((x) => x.id === n.id)) nos.push(n);
  });
  const ligacoes: Ligacao[] = [];
  (Array.isArray(v.ligacoes) ? v.ligacoes : Array.isArray(v.edges) ? v.edges : []).forEach((b: any) => {
    const l = normalizarLigacao(b, nos);
    if (l && !ligacoes.some((x) => x.de === l.de && x.para === l.para)) ligacoes.push(l);
  });
  const vp = v.viewport && typeof v.viewport === "object" ? v.viewport : {};
  return {
    id: textoOuNulo(v.id),
    client_id: texto(v.client_id) || clientId,
    nome: texto(v.nome) || "Canvas sem nome",
    nos,
    ligacoes,
    viewport: { x: numero(vp.x), y: numero(vp.y), zoom: numero(vp.zoom, 1) || 1 },
    versao: numero(v.versao, 0),
    atualizado_em: texto(v.atualizado_em || v.criado_em),
  };
}

// ------------------------------------------------------------------ grafo

let contador = 0;
export function novoId(prefixo: string): string {
  contador += 1;
  return `${prefixo}-${Date.now().toString(36)}-${contador.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function novoNo(tipo: TipoDeNo, x: number, y: number, dados: DadosDoNo = {}): NoDoCanvas {
  const base = normalizarDados(tipo, dados);
  return { id: novoId(tipo), tipo, x: Math.round(x), y: Math.round(y), dados: { ...base, ...dados } };
}

export const canvasVazio = (clientId: string, nome = "Canvas novo"): Canvas => ({
  id: null,
  client_id: clientId,
  nome,
  nos: [],
  ligacoes: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  versao: 0,
  atualizado_em: "",
});

/** A entrada da ligação se ela é possível (origem que não é Saída, destino que é Saída, sem repetir); senão null. */
export function podeLigar(c: Pick<Canvas, "nos" | "ligacoes">, de: string, para: string): Entrada | null {
  if (!de || !para || de === para) return null;
  const origem = c.nos.find((n) => n.id === de);
  const destino = c.nos.find((n) => n.id === para);
  if (!origem || !destino || destino.tipo !== "gerar" || origem.tipo === "gerar") return null;
  if (c.ligacoes.some((l) => l.de === de && l.para === para)) return null;
  return entradaDoTipo(origem.tipo);
}

/** Liga (a ordem na mesma entrada é a ordem de chegada: prioridade). A entrada sai do tipo do cartão, nunca da alça tocada. */
export function ligar<T extends Pick<Canvas, "nos" | "ligacoes">>(c: T, de: string, para: string): T {
  const entrada = podeLigar(c, de, para);
  if (!entrada) return c;
  const ordem = c.ligacoes.filter((l) => l.para === para && l.entrada === entrada).length;
  return { ...c, ligacoes: c.ligacoes.concat([{ id: novoId("lig"), de, para, entrada, ordem }]) };
}

/** Reescreve a ordem 0, 1, 2... dentro de cada entrada de cada Saída (depois de tirar uma ligação). */
export function renumerar(ligacoes: Ligacao[]): Ligacao[] {
  const contagem: Record<string, number> = {};
  return ligacoes
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((l) => {
      const k = `${l.para}|${l.entrada}`;
      const ordem = contagem[k] || 0;
      contagem[k] = ordem + 1;
      return { ...l, ordem };
    });
}

export function desligar<T extends Pick<Canvas, "nos" | "ligacoes">>(c: T, ligacaoId: string): T {
  return { ...c, ligacoes: renumerar(c.ligacoes.filter((l) => l.id !== ligacaoId)) };
}

export function removerNo<T extends Pick<Canvas, "nos" | "ligacoes">>(c: T, noId: string): T {
  return { ...c, nos: c.nos.filter((n) => n.id !== noId), ligacoes: renumerar(c.ligacoes.filter((l) => l.de !== noId && l.para !== noId)) };
}

export function mudarDados<T extends Pick<Canvas, "nos">>(c: T, noId: string, dados: Partial<DadosDoNo>): T {
  return { ...c, nos: c.nos.map((n) => (n.id === noId ? { ...n, dados: { ...n.dados, ...dados } } : n)) };
}

export interface EntradaDoGerar {
  /** Número na ordem em que vai ao gerador (1, 2, 3...). */
  numero: number;
  entrada: Entrada;
  ligacao: Ligacao;
  no: NoDoCanvas;
}

/** As entradas de uma Saída na ordem em que vão ao gerador: produto, pessoa, ambiente, estilo, texto; dentro de cada, a ordem da ligação. */
export function entradasDoGerar(c: Pick<Canvas, "nos" | "ligacoes">, gerarId: string): EntradaDoGerar[] {
  const saida: EntradaDoGerar[] = [];
  ORDEM_DAS_ENTRADAS.forEach((entrada) => {
    c.ligacoes
      .filter((l) => l.para === gerarId && l.entrada === entrada)
      .sort((a, b) => a.ordem - b.ordem)
      .forEach((l) => {
        const no = c.nos.find((n) => n.id === l.de);
        if (no) saida.push({ numero: saida.length + 1, entrada, ligacao: l, no });
      });
  });
  return saida;
}

/** O que um cartão ainda precisa para valer (vazio: está pronto). */
export function faltaNoCartao(no: NoDoCanvas): string {
  const d = no.dados;
  if (no.tipo === "produto" && !d.kit_id) return "Escolha o produto";
  if (no.tipo === "modelo" && !d.modelo_id) return "Escolha a persona";
  if ((no.tipo === "ambiente" || no.tipo === "estilo") && !d.imagem_id && !d.biblioteca_id && !(d.texto || "").trim()) return no.tipo === "ambiente" ? "Escolha uma foto ou descreva" : "Escolha uma referência";
  if (no.tipo === "texto" && !(d.texto || "").trim()) return "Escreva o pedido";
  return "";
}

/** Junta resultados novos na Saída (sem repetir a mesma geração; guarda os 24 mais novos). */
export function juntarResultados(c: Canvas, porGerar: Record<string, ResultadoDoCanvas[]>): Canvas {
  let novo = c;
  Object.keys(porGerar).forEach((gerarId) => {
    const no = novo.nos.find((n) => n.id === gerarId);
    if (!no) return;
    const atuais = no.dados.resultados || [];
    const juntos = atuais.filter((a) => !porGerar[gerarId].some((p) => p.geracao_id === a.geracao_id)).concat(porGerar[gerarId]);
    novo = mudarDados(novo, gerarId, { resultados: juntos.slice(-24) });
  });
  return novo;
}

/**
 * Por que a Saída ainda não gera (mesmas recusas da função, ditas antes):
 * sem produto e sem pessoa; persona sem âncora; cartão ligado incompleto;
 * nenhum motor ligado.
 */
export function bloqueiosDoGerar(c: Pick<Canvas, "nos" | "ligacoes">, gerarId: string, personas: Persona[] = []): string[] {
  const gerar = c.nos.find((n) => n.id === gerarId);
  if (!gerar || gerar.tipo !== "gerar") return ["Saída não encontrada."];
  const entradas = entradasDoGerar(c, gerarId);
  const b: string[] = [];
  if (!entradas.some((e) => e.entrada === "produto" || e.entrada === "pessoa")) b.push("Ligue ao menos um produto ou uma persona.");
  entradas.forEach((e) => {
    const falta = faltaNoCartao(e.no);
    if (falta) b.push(`${e.numero}. ${TIPOS_DE_NO[e.no.tipo].rotulo}: ${falta.toLowerCase()}.`);
    if (e.no.tipo === "modelo" && e.no.dados.modelo_id) {
      const p = personas.find((x) => x.id === e.no.dados.modelo_id);
      if (p && (p.status === "rascunho" || p.status === "candidatos")) b.push(`${e.numero}. A persona ${p.nome} ainda não tem âncora escolhida.`);
      if (p && p.status === "arquivada") b.push(`${e.numero}. A persona ${p.nome} está arquivada.`);
    }
  });
  if (!(gerar.dados.motores || []).length) b.push("Ligue ao menos um motor.");
  return b;
}

/** Avisos que não impedem (persona com folha incompleta). */
export function avisosDoGerar(c: Pick<Canvas, "nos" | "ligacoes">, gerarId: string, personas: Persona[] = []): string[] {
  const a: string[] = [];
  entradasDoGerar(c, gerarId).forEach((e) => {
    if (e.no.tipo !== "modelo") return;
    const p = personas.find((x) => x.id === e.no.dados.modelo_id);
    if (p && (p.status === "ancora" || p.status === "folha")) a.push(`A persona ${p.nome} tem só a âncora (folha incompleta): o rosto pode variar mais.`);
  });
  return a;
}

/** Monta o grafo de um modelo pronto ao redor de uma posição. */
export const MODELOS_PRONTOS: { chave: string; rotulo: string; tipos: TipoDeNo[] }[] = [
  { chave: "produto-pessoa-ambiente", rotulo: "Produto + pessoa + ambiente", tipos: ["produto", "modelo", "ambiente"] },
  { chave: "produto-estilo", rotulo: "Produto no estilo da marca", tipos: ["produto", "estilo", "texto"] },
];

export function aplicarModeloPronto(c: Canvas, chave: string, motorPadrao: string | null, origem = { x: 0, y: 0 }): Canvas {
  const m = MODELOS_PRONTOS.find((x) => x.chave === chave);
  if (!m) return c;
  let novo: Canvas = { ...c };
  const gerar = novoNo("gerar", origem.x + 320, origem.y + 40, { motores: motorPadrao ? [motorPadrao] : [] });
  novo = { ...novo, nos: novo.nos.concat([gerar]) };
  m.tipos.forEach((t, i) => {
    const n = novoNo(t, origem.x, origem.y + i * (TAMANHO_DO_CARTAO.altura + 24));
    novo = ligar({ ...novo, nos: novo.nos.concat([n]) }, n.id, gerar.id);
  });
  return novo;
}

// ------------------------------------------------------------------ rascunho local

const chaveDoRascunho = (clientId: string, id: string | null) => `mesa-foto:canvas:${clientId}:${id || "novo"}`;

export function guardarRascunho(c: Canvas) {
  try {
    window.localStorage.setItem(chaveDoRascunho(c.client_id, c.id), JSON.stringify({ canvas: c, em: Date.now() }));
  } catch {
    /* sem armazenamento: o servidor guarda */
  }
}

export function lerRascunho(clientId: string, id: string | null): Canvas | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveDoRascunho(clientId, id)) || "null");
    return v && v.canvas ? normalizarCanvas(v.canvas, clientId) : null;
  } catch {
    return null;
  }
}

export function apagarRascunho(clientId: string, id: string | null) {
  try {
    window.localStorage.removeItem(chaveDoRascunho(clientId, id));
  } catch {
    /* nada a apagar */
  }
}

// ------------------------------------------------------------------ leituras e ações

export const chaveDosCanvases = (clientId: string) => ["mesa-foto", "canvases", clientId];

export function useCanvases(clientId: string) {
  return useQuery({
    queryKey: chaveDosCanvases(clientId),
    enabled: !!clientId,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<Canvas[]> => {
      const { data, error } = await (supabase as any)
        .from("foto_canvas")
        .select("*")
        .eq("client_id", clientId)
        .order("atualizado_em", { ascending: false })
        .limit(100);
      if (error) {
        const msg = String(error.message || "");
        if (String(error.code) === "42P01" || String(error.code) === "PGRST205" || msg.indexOf("does not exist") >= 0 || msg.indexOf("Could not find the table") >= 0) {
          throw new Error("O banco do Canvas ainda não foi publicado (tabela foto_canvas). Dá para montar e ver o quadro; salvar e gerar esperam a publicação.");
        }
        throw error instanceof Error ? error : new Error(msg || "Não foi possível ler os canvases.");
      }
      const saida: Canvas[] = [];
      for (const b of (data || []) as any[]) {
        const c = normalizarCanvas(b, clientId);
        if (c && (b as any).status !== "arquivado") saida.push(c);
      }
      return saida;
    },
  });
}

/**
 * Nome de cada cartão na função (canvas-regras.ts, TIPOS_DE_NO). A tela chama
 * o prompt de "texto" e o resultado de "gerar"; a função aceita os dois, mas
 * grava e devolve estes.
 */
export const TIPO_NA_FUNCAO: Record<TipoDeNo, string> = {
  produto: "produto",
  modelo: "modelo",
  ambiente: "ambiente",
  estilo: "estilo",
  texto: "prompt",
  gerar: "saida",
};

/** Dados de um cartão na forma que a função grava (canvas-regras.ts, dadosDoNo). */
export function dadosParaAFuncao(tipo: TipoDeNo, d: DadosDoNo): Record<string, unknown> {
  if (tipo === "produto") return { kit_id: d.kit_id || null };
  if (tipo === "modelo") return { modelo_id: d.modelo_id || null, versao: d.versao || null };
  if (tipo === "ambiente") return { imagem_id: d.imagem_id || null, biblioteca_id: d.biblioteca_id || null, texto: (d.texto || "").trim() || null };
  if (tipo === "estilo") {
    return { imagem_ids: d.imagem_id ? [d.imagem_id] : [], biblioteca_ids: d.biblioteca_id ? [d.biblioteca_id] : [], guia: (d.texto || "").trim() || null };
  }
  if (tipo === "texto") return { texto: d.texto || "", papel: d.papel === "restricao" ? "restricao" : "pedido" };
  // Saída: os resultados vão junto (a função guarda o atalho, sem a URL assinada, que expira).
  return {
    motores: d.motores || [],
    formato: d.formato || "4:5",
    qualidade: d.qualidade || "alta",
    resolucao: d.resolucao || null,
    resultados: (d.resultados || []).map((r) => ({
      geracao_id: r.geracao_id,
      imagem_id: r.imagem_id,
      storage_bucket: r.storage_bucket,
      storage_path: r.storage_path,
      motor_id: r.motor_id,
      status: r.status,
      erro: r.erro,
      custo_usd: r.custo_usd,
      conferencia: r.conferencia,
      criado_em: r.criado_em,
    })),
  };
}

/** O corpo que vai para canvas_salvar (JSON puro, nomes e forma da função). */
export function corpoDoCanvas(c: Canvas) {
  const corpo: Record<string, unknown> = {
    nome: c.nome.trim() || "Canvas sem nome",
    nos: c.nos.map((n) => ({ id: n.id, tipo: TIPO_NA_FUNCAO[n.tipo], x: Math.round(n.x), y: Math.round(n.y), dados: dadosParaAFuncao(n.tipo, n.dados) })),
    // A entrada (produto, pessoa...) sai do tipo do cartão de origem: a função não guarda.
    ligacoes: c.ligacoes.map((l) => ({ id: l.id, de: l.de, para: l.para, ordem: l.ordem })),
    viewport: { x: Math.round(c.viewport.x), y: Math.round(c.viewport.y), zoom: Math.round(c.viewport.zoom * 1000) / 1000 },
  };
  if (c.id) corpo.id = c.id;
  return corpo;
}

/** Salva; a versão esperada evita pisar no que outra aba gravou (erro canvas_mudou). */
export async function salvarCanvas(c: Canvas): Promise<Canvas> {
  const corpo: Record<string, unknown> = { acao: "canvas_salvar", client_id: c.client_id, canvas: corpoDoCanvas(c) };
  if (c.id) corpo.versao_esperada = c.versao;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const salvo = normalizarCanvas(data && (data.canvas || data), c.client_id);
  if (!salvo || !salvo.id) return { ...c };
  // A função devolve o grafo gravado; os resultados que chegaram enquanto salvava ficam (a tela é quem os tem).
  return { ...salvo, nos: salvo.nos.length || !c.nos.length ? salvo.nos : c.nos };
}

export function normalizarMontagem(data: any): Montagem {
  const d = data && typeof data === "object" ? (data.montagem && typeof data.montagem === "object" ? data.montagem : data.compilado && typeof data.compilado === "object" ? data.compilado : data) : {};
  const referencias: ReferenciaMontada[] = [];
  (Array.isArray(d.referencias) ? d.referencias : []).forEach((r: any, i: number) => {
    if (!r || typeof r !== "object") return;
    const origem = r.origem && typeof r.origem === "object" ? r.origem : {};
    referencias.push({
      ordem: numero(r.ordem, i + 1) || i + 1,
      papel: texto(r.papel),
      origem_tipo: texto(origem.tipo || r.origem_tipo),
      origem_id: texto(origem.id || r.origem_id),
      imagem_id: textoOuNulo(r.imagem_id),
      storage_path: texto(r.storage_path),
      storage_bucket: texto(r.storage_bucket) || "mesa",
      url: texto(r.url),
      legenda: [texto(r.titulo), texto(r.legenda || r.nome)].filter(Boolean).join(", "),
    });
  });
  referencias.sort((a, b) => a.ordem - b.ordem);
  const est = d.estimativa_usd ?? (data && data.estimativa_usd);
  // A função devolve as cortadas como lista (uma por referência que ficou de fora).
  const cortadas = Array.isArray(d.cortadas) ? d.cortadas.length : numero(d.cortadas || d.referencias_cortadas);
  return {
    referencias,
    prompt: texto(d.prompt),
    estimativa_usd: est === null || est === undefined || est === "" || !isFinite(Number(est)) ? null : Number(est),
    avisos: (Array.isArray(d.avisos) ? d.avisos : []).map((x: any) => texto(x)).filter(Boolean),
    cortadas,
  };
}

/**
 * Corpo de canvas_montar e canvas_gerar (canvas.ts, montar): o canvas salvo,
 * o cartão de resultado (no_saida_id) e o gerador (modelo_imagem_id). Formato
 * e qualidade de base vêm da Saída salva; a qualidade daqui vale por cima.
 */
export function corpoDoPedidoDoCanvas(acao: "canvas_montar" | "canvas_gerar", p: { canvasId: string; gerarId: string; motorId: string; qualidade: Qualidade; resolucao?: Resolucao | null }): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao, canvas_id: p.canvasId, no_saida_id: p.gerarId, modelo_imagem_id: p.motorId, qualidade: p.qualidade };
  if (p.resolucao) corpo.resolucao = p.resolucao;
  return corpo;
}

export async function montarCanvas(p: { canvasId: string; gerarId: string; motorId: string; qualidade: Qualidade; resolucao?: Resolucao | null }): Promise<Montagem> {
  return normalizarMontagem(await chamarFuncao<any>("mesa-foto", corpoDoPedidoDoCanvas("canvas_montar", p)));
}

export async function gerarNoCanvas(p: {
  canvasId: string;
  gerarId: string;
  motorId: string;
  qualidade: Qualidade;
  resolucao?: Resolucao | null;
}): Promise<{ resultado: ResultadoDoCanvas; imagem: FotoDoAcervo | null; custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", corpoDoPedidoDoCanvas("canvas_gerar", p));
  const imagem = normalizarFoto(data && data.imagem);
  const g = data && data.geracao && typeof data.geracao === "object" ? data.geracao : {};
  const resultado = normalizarResultado({
    ...g,
    geracao_id: g.id || g.geracao_id || (data && data.geracao_id) || (imagem ? `img-${imagem.id}` : novoId("geracao")),
    imagem_id: g.imagem_id || (imagem ? imagem.id : null),
    storage_bucket: imagem ? imagem.storage_bucket : g.storage_bucket,
    storage_path: imagem ? imagem.storage_path : g.storage_path,
    url: (data && data.url) || g.url,
    motor_id: g.motor_id || p.motorId,
    status: g.status === "falhou" ? "falhou" : "gerada",
    custo_usd: data && data.custo_usd,
  }) as ResultadoDoCanvas;
  return { resultado, imagem, custo_usd: data && data.custo_usd };
}

export async function conferirGeracao(geracaoId: string): Promise<{ conferencia: ConferenciaDaPersona | null; custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "canvas_conferir", geracao_id: geracaoId });
  return { conferencia: normalizarConferenciaDaPersona(data), custo_usd: data && data.custo_usd };
}

// ------------------------------------------------------------------ estimativas

const ENTRADA_POR_REFERENCIA = 1600;

/** Uma imagem por motor ligado na Saída (uma chamada por motor). */
export function partesDoGerar(motores: string[], qualidade: Qualidade, referencias: number): ParteDaEstimativa[] {
  return motores.map((id) => ({ modeloId: id, tipo: "imagem" as const, imagens: 1, qualidade, tokensEntrada: 3000 + referencias * ENTRADA_POR_REFERENCIA }));
}
