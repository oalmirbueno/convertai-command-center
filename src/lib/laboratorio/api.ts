/**
 * Laboratório: a ponte da tela com a função de borda `laboratorio`. A função é
 * a fonte da verdade (supabase/functions/laboratorio/acoes.ts, cabeçalho de
 * index.ts); cada leitor abaixo casa com o que a ação devolve de fato. Toda
 * chamada passa pelo `chamarFuncao` das mesas (erro vira ErroDaMesa com a
 * frase e o corpo em `detalhes`, venha ele num 4xx ou num 200 com `error`
 * das ações com fôlego: planejar, pedido_inicio, logo_gerar e no_executar).
 *
 * Custo antes de gerar: no_executar, rodar_tudo e logo_gerar sem
 * `confirmado: true` devolvem 'confirmacao_necessaria' com { total_usd,
 * por_no }. A tela lê isso com `custoAConfirmar` e mostra o custo; só o
 * clique em "Rodar" reenvia com `confirmado: true`.
 */
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, ErroDaMesa } from "@/lib/mesa/api";
import { normalizarCanvas, normalizarOperacao, type CanvasDoLab, type OperacaoDoAgente } from "./nos";

export type StatusDaExecucao = "na_fila" | "rodando" | "pronto" | "erro" | "aguardando";

export interface ImagemDoLab {
  path: string;
  url: string;
  bucket?: string;
}

/** Escolha do Jev na logo: `indice` aponta para `imagens` (só as que saíram). */
export interface EscolhaDoJev {
  indice: number;
  motivo: string;
  confianca: number | null;
}

/** `saida` de lab_execucoes (SaidaDoNo em executar.ts). */
export interface SaidaDaExecucao {
  texto: string;
  imagens: ImagemDoLab[];
  html_path: string;
  html_url: string;
  tarefa_id: string;
  /** Agente externo: `link` (/kanban?tarefa=…). */
  tarefa_url: string;
  escolha: EscolhaDoJev | null;
  aviso_jev: string;
  avisos: string[];
  json: Record<string, unknown> | null;
}

/** Linha de lab_execucoes. */
export interface ExecucaoDoLab {
  id: string;
  no_id: string;
  tipo: string;
  status: StatusDaExecucao;
  saida: SaidaDaExecucao;
  custo_usd: number | null;
  erro: string;
  rodada_id: string | null;
  created_at: string;
}

export interface ProjetoDoLab {
  id: string;
  nome: string;
  client_id: string | null;
  cliente_nome: string;
  contexto: string;
  canvas: CanvasDoLab;
  /** Nós no canvas (projetos_listar manda só a contagem, sem o canvas). */
  total_nos: number;
  versao: number;
  status: "ativo" | "arquivado";
  updated_at: string;
  previa_url: string;
}

export interface TemplateDoLab {
  id: string;
  nome: string;
  descricao: string;
  icone: string;
  oficial: boolean;
  canvas: CanvasDoLab;
}

export interface CustoDoNo {
  no_id: string;
  tipo: string;
  custo_usd: number;
}

/** estimar → { por_no, total_usd, ordem, carteira_client_id, livre }. */
export interface EstimativaDoLab {
  nos: CustoDoNo[];
  total_usd: number;
  ordem: string[];
  livre: boolean;
}

export interface RespostaDoPlanejar {
  resposta: string;
  /** Só as aceitas, já com os ids reais. */
  operacoes: OperacaoDoAgente[];
  /** Recibo das recusadas (o motivo vem da função). */
  recusadas: string[];
  canvas_previsto: CanvasDoLab | null;
  versao: number | null;
  custo_usd: number | null;
}

export interface VariacaoDeLogo extends ImagemDoLab {
  indice: number;
  titulo: string;
}

export interface ResultadoDaLogo {
  variacoes: VariacaoDeLogo[];
  escolhida: EscolhaDoJev | null;
  aviso_jev: string;
  custo_usd: number | null;
  /** Só quando a função pediu confirmação (sem `confirmado`): o custo estimado. */
  estimativa_usd: number | null;
  execucao_id: string | null;
  projeto_id: string | null;
}

const texto = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};
const objeto = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
/** Lista ou mapa { chave: valor } (projeto_ler manda as execuções por nó). */
const valores = (v: unknown): unknown[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.keys(v as object).map((k) => (v as Record<string, unknown>)[k]) : []);

const STATUS: StatusDaExecucao[] = ["na_fila", "rodando", "pronto", "erro", "aguardando"];

function imagens(v: unknown): ImagemDoLab[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any): ImagemDoLab | null => (x && typeof x === "object" ? { path: texto(x.path), url: texto(x.url), bucket: texto(x.bucket) || "workspace" } : null))
    .filter((x): x is ImagemDoLab => !!x && (!!x.path || !!x.url));
}

function escolha(v: unknown): EscolhaDoJev | null {
  const o = objeto(v);
  const i = num(o.indice);
  return i === null ? null : { indice: i, motivo: texto(o.motivo), confianca: num(o.confianca) };
}

export function normalizarSaida(s: unknown): SaidaDaExecucao {
  const o = objeto(s);
  return {
    texto: texto(o.texto),
    imagens: imagens(o.imagens),
    html_path: texto(o.html_path),
    html_url: texto(o.html_url),
    tarefa_id: texto(o.tarefa_id),
    tarefa_url: texto(o.link),
    escolha: escolha(o.escolha),
    aviso_jev: texto(o.aviso_jev),
    avisos: Array.isArray(o.avisos) ? o.avisos.map(texto).filter(Boolean) : [],
    json: o.json && typeof o.json === "object" ? o.json : null,
  };
}

export function normalizarExecucao(e: unknown): ExecucaoDoLab | null {
  const o = objeto(e);
  if (!o.no_id) return null;
  return {
    id: texto(o.id),
    no_id: texto(o.no_id),
    tipo: texto(o.tipo),
    status: STATUS.indexOf(o.status) >= 0 ? o.status : "na_fila",
    saida: normalizarSaida(o.saida),
    custo_usd: num(o.custo_usd),
    erro: texto(o.erro),
    rodada_id: o.rodada_id ? texto(o.rodada_id) : null,
    created_at: texto(o.created_at),
  };
}

/** Execução que acabou de nascer (a linha completa chega pelo execucoes_ler). */
export function execucaoNova(noId: string, id: string, status: StatusDaExecucao = "na_fila", rodadaId: string | null = null): ExecucaoDoLab {
  return { id, no_id: noId, tipo: "", status, saida: normalizarSaida(null), custo_usd: null, erro: "", rodada_id: rodadaId, created_at: new Date().toISOString() };
}

export function normalizarProjeto(p: unknown, clienteNome?: unknown): ProjetoDoLab | null {
  const o = objeto(p);
  if (!o.id) return null;
  const canvas = normalizarCanvas(o.canvas);
  return {
    id: texto(o.id),
    nome: texto(o.nome) || "Projeto sem nome",
    client_id: o.client_id ? texto(o.client_id) : null,
    cliente_nome: texto(o.cliente_nome || clienteNome),
    contexto: texto(o.contexto),
    canvas,
    total_nos: canvas.nos.length || num(o.nos) || 0,
    versao: num(o.versao) ?? 1,
    status: o.status === "arquivado" ? "arquivado" : "ativo",
    updated_at: texto(o.updated_at || o.created_at),
    previa_url: texto(o.previa_url),
  };
}

function normalizarTemplate(t: unknown): TemplateDoLab | null {
  const o = objeto(t);
  if (!o.id) return null;
  return { id: texto(o.id), nome: texto(o.nome), descricao: texto(o.descricao), icone: texto(o.icone), oficial: !!o.oficial, canvas: normalizarCanvas(o.canvas) };
}

/** Chave do React Query da lista de projetos (Início e Projetos). */
export const chaveDosProjetos = ["laboratorio", "projetos"] as const;

const chamar = <T = any>(acao: string, corpo: Record<string, unknown> = {}) => chamarFuncao<T>("laboratorio", { acao, ...corpo });

const projetoDa = (data: any): ProjetoDoLab => {
  const p = normalizarProjeto(data && data.projeto, data && data.cliente_nome);
  if (!p) throw new ErroDaMesa("falha_interna", "A função não devolveu o projeto. Tente de novo.");
  return p;
};

/** Trava otimista: outra aba salvou antes (projeto_salvar → 409 versao_mudou { projeto_atual }). */
export const ehConflitoDeVersao = (e: unknown) => e instanceof ErroDaMesa && e.codigo === "versao_mudou";

/**
 * A função pediu confirmação ('confirmacao_necessaria', 409, ou 200 com
 * status_http 409 nas ações com fôlego): devolve o custo para a tela mostrar.
 */
export function custoAConfirmar(e: unknown): { total_usd: number; por_no: CustoDoNo[] } | null {
  if (!(e instanceof ErroDaMesa) || e.codigo !== "confirmacao_necessaria") return null;
  const d = objeto(e.detalhes);
  return { total_usd: num(d.total_usd) ?? 0, por_no: porNo(d.por_no) };
}

function porNo(v: unknown): CustoDoNo[] {
  return (Array.isArray(v) ? v : [])
    .map((x: any) => (x && typeof x === "object" ? { no_id: texto(x.no_id), tipo: texto(x.tipo), custo_usd: num(x.custo_usd) ?? 0 } : null))
    .filter(Boolean) as CustoDoNo[];
}

export async function listarProjetos(): Promise<ProjetoDoLab[]> {
  const data = await chamar("projetos_listar");
  return valores(data && data.projetos).map((p) => normalizarProjeto(p)).filter(Boolean) as ProjetoDoLab[];
}

export async function criarProjeto(a: { nome: string; client_id: string | null; contexto?: string; canvas?: CanvasDoLab }): Promise<ProjetoDoLab> {
  return projetoDa(await chamar("projeto_criar", a));
}

/** projeto_ler → { projeto, cliente_nome, execucoes: { [no_id]: última execução } }. */
export async function lerProjeto(projetoId: string): Promise<{ projeto: ProjetoDoLab; execucoes: ExecucaoDoLab[] }> {
  const data = await chamar("projeto_ler", { projeto_id: projetoId });
  const execucoes = valores(data && data.execucoes).map(normalizarExecucao).filter(Boolean) as ExecucaoDoLab[];
  return { projeto: projetoDa(data), execucoes };
}

export async function salvarProjeto(p: { id: string; nome: string; canvas: CanvasDoLab; versao: number }): Promise<ProjetoDoLab> {
  try {
    return projetoDa(await chamar("projeto_salvar", { projeto_id: p.id, nome: p.nome, canvas: p.canvas, versao_esperada: p.versao }));
  } catch (e) {
    // canvas_invalido traz a lista do que não vale (ErroDoCanvas.erros): vai junto na frase.
    if (e instanceof ErroDaMesa && e.codigo === "canvas_invalido") {
      const erros = valores(objeto(e.detalhes).erros).map(texto).filter(Boolean);
      if (erros.length) throw new ErroDaMesa(e.codigo, `${e.message} ${erros.slice(0, 3).join(" ")}`, e.detalhes);
    }
    throw e;
  }
}

export async function arquivarProjeto(projetoId: string): Promise<void> {
  await chamar("projeto_arquivar", { projeto_id: projetoId });
}

export async function listarTemplates(): Promise<TemplateDoLab[]> {
  const data = await chamar("templates_listar");
  return valores(data && data.templates).map(normalizarTemplate).filter(Boolean) as TemplateDoLab[];
}

export async function usarTemplate(templateId: string, clientId: string | null): Promise<ProjetoDoLab> {
  return projetoDa(await chamar("template_usar", { template_id: templateId, client_id: clientId }));
}

export async function salvarTemplate(projetoId: string, nome: string, descricao = ""): Promise<void> {
  await chamar("template_salvar", { projeto_id: projetoId, nome, descricao });
}

export async function estimar(projetoId: string, nos?: string[]): Promise<EstimativaDoLab> {
  const data = await chamar("estimar", nos ? { projeto_id: projetoId, nos } : { projeto_id: projetoId });
  const lista = porNo(data && data.por_no);
  const total = num(data && data.total_usd);
  return {
    nos: lista,
    total_usd: total ?? lista.reduce((s, x) => s + x.custo_usd, 0),
    ordem: valores(data && data.ordem).map(texto).filter(Boolean),
    livre: !!(data && data.livre),
  };
}

/**
 * no_executar → { execucao_id, execucao, saida? } (texto e imagem na hora) ou
 * 202 { execucao_id, status: "rodando", estimativa_usd } (carrossel e landing).
 */
export async function executarNo(projetoId: string, noId: string, confirmado = true): Promise<ExecucaoDoLab> {
  const data = await chamar("no_executar", { projeto_id: projetoId, no_id: noId, confirmado });
  const ex = normalizarExecucao(data && data.execucao);
  if (ex) {
    // A saída que veio junto vale mais que a linha lida antes do fim.
    if (data && data.saida && !ex.saida.texto && !ex.saida.imagens.length) ex.saida = normalizarSaida(data.saida);
    return ex;
  }
  const status = data && STATUS.indexOf(data.status) >= 0 ? (data.status as StatusDaExecucao) : "rodando";
  return execucaoNova(noId, texto(data && data.execucao_id), status);
}

/** rodar_tudo → 202 { rodada_id, ordem, execucoes: { [no_id]: execucao_id } }: cada nó nasce na fila. */
export async function rodarTudo(projetoId: string, nos?: string[], confirmado = true): Promise<{ rodada_id: string | null; ordem: string[]; execucoes: ExecucaoDoLab[] }> {
  const data = await chamar("rodar_tudo", nos ? { projeto_id: projetoId, nos, confirmado } : { projeto_id: projetoId, confirmado });
  const rodada = data && data.rodada_id ? texto(data.rodada_id) : null;
  const mapa = objeto(data && data.execucoes);
  const execucoes = Object.keys(mapa).map((noId) => execucaoNova(noId, texto(mapa[noId]), "na_fila", rodada));
  return { rodada_id: rodada, ordem: valores(data && data.ordem).map(texto).filter(Boolean), execucoes };
}

/** execucoes_ler → { execucoes } (mais novas primeiro). */
export async function lerExecucoes(projetoId: string, rodadaId?: string | null): Promise<ExecucaoDoLab[]> {
  const data = await chamar("execucoes_ler", rodadaId ? { projeto_id: projetoId, rodada_id: rodadaId } : { projeto_id: projetoId });
  return valores(data && data.execucoes).map(normalizarExecucao).filter(Boolean) as ExecucaoDoLab[];
}

/** A última execução de cada nó (a lista vem em qualquer ordem). */
export function ultimaPorNo(execucoes: ExecucaoDoLab[]): Record<string, ExecucaoDoLab> {
  const saida: Record<string, ExecucaoDoLab> = {};
  execucoes.forEach((e) => {
    const atual = saida[e.no_id];
    if (!atual || (e.created_at || "") >= (atual.created_at || "")) saida[e.no_id] = e;
  });
  return saida;
}

export interface MensagemDoPlanejar {
  papel: "usuario" | "agente";
  texto: string;
}

/**
 * planejar { projeto_id, mensagem, modelo_id, historico } → { resposta,
 * operacoes: [{ indice, op, aceita, recibo, operacao }], canvas_previsto,
 * versao, custo_usd }. A função lê o canvas SALVO: a tela salva antes.
 */
export async function planejar(a: { projetoId: string; mensagem: string; historico: MensagemDoPlanejar[]; modelo: string }): Promise<RespostaDoPlanejar> {
  const data = await chamar("planejar", {
    projeto_id: a.projetoId,
    mensagem: a.mensagem,
    historico: a.historico.slice(-12),
    modelo_id: a.modelo,
  });
  const brutas = valores(data && data.operacoes);
  const operacoes = brutas.map(normalizarOperacao).filter(Boolean) as OperacaoDoAgente[];
  const recusadas = brutas.filter((r) => objeto(r).aceita === false).map((r) => texto(objeto(r).recibo)).filter(Boolean);
  return {
    resposta: texto(data && data.resposta),
    operacoes,
    recusadas,
    canvas_previsto: data && data.canvas_previsto ? normalizarCanvas(data.canvas_previsto) : null,
    versao: num(data && data.versao),
    custo_usd: num(data && data.custo_usd),
  };
}

/** pedido_inicio → 201 { projeto, resposta, operacoes }: o projeto já nasce com o canvas montado. */
export async function pedidoInicio(a: { pedido: string; clientId: string | null; modelo: string }): Promise<ProjetoDoLab> {
  return projetoDa(await chamar("pedido_inicio", { pedido: a.pedido, client_id: a.clientId, modelo_id: a.modelo }));
}

/** Campos que logo_gerar lê (acoes.ts): todos texto, menos n. */
export interface PedidoDeLogo {
  client_id: string | null;
  nome: string;
  conceito: string;
  paleta: string;
  estilo: string;
  n: number;
  /** Caminhos no bucket workspace (global/laboratorio/…): variar a partir de uma logo já gerada. */
  referencias?: string[];
}

/** logo_gerar → { execucao_id, projeto_id, imagens, escolha: { indice, caminho, motivo, confianca }, aviso_jev, custo_usd }. */
export function normalizarLogo(data: unknown): ResultadoDaLogo {
  const o = objeto(data);
  const lista = Array.isArray(o.imagens) ? o.imagens : [];
  const variacoes = imagens(lista).map((im, i) => ({ ...im, indice: i, titulo: texto(objeto(lista[i]).titulo) }));
  return {
    variacoes,
    escolhida: escolha(o.escolha),
    aviso_jev: texto(o.aviso_jev),
    custo_usd: num(o.custo_usd),
    estimativa_usd: null,
    execucao_id: o.execucao_id ? texto(o.execucao_id) : null,
    projeto_id: o.projeto_id ? texto(o.projeto_id) : null,
  };
}

/**
 * Sem `confirmado`, a função responde 'confirmacao_necessaria' com o custo:
 * volta só `estimativa_usd` (nada gerado). Com `confirmado`, gera.
 */
export async function gerarLogo(p: PedidoDeLogo, confirmado: boolean): Promise<ResultadoDaLogo> {
  try {
    return normalizarLogo(await chamar("logo_gerar", { ...p, confirmado }));
  } catch (e) {
    const custo = custoAConfirmar(e);
    if (!custo || confirmado) throw e;
    return { ...normalizarLogo(null), estimativa_usd: custo.total_usd };
  }
}

/**
 * Onde a mídia de entrada é enviada: bucket workspace, em
 * global/laboratorio/<projeto>/entradas/ (a política do bucket só deixa a
 * equipe gravar em global/… ou client/<id>/…; a função lê do mesmo bucket).
 */
export function caminhoDeEntrada(projetoId: string, id: string, nomeDoArquivo: string): string {
  const limpo = nomeDoArquivo.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80);
  return `global/laboratorio/${projetoId}/entradas/${id}-${limpo}`;
}

/** Operadores ativos para o nó Agente externo (internal_operators, como a Execução lê). */
export async function lerOperadoresExternos(): Promise<Array<{ valor: string; rotulo: string }>> {
  const { data, error } = await (supabase as any).from("internal_operators").select("slug, display_name, status").eq("status", "active").order("display_name");
  if (error) throw error;
  return (Array.isArray(data) ? data : [])
    .filter((o: any) => o && typeof o.slug === "string" && o.slug)
    .map((o: any) => ({ valor: String(o.slug), rotulo: String(o.display_name || o.slug) }));
}
