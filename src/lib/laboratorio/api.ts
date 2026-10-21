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
import { normalizarCanvas, normalizarOperacao, type BlocoSemFonte, type CanvasDoLab, type OperacaoDoAgente } from "./nos";

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
  // ---- v2 (ESPEC-LABORATORIO-v2.md)
  /** Pesquisa: as fontes com link. */
  fontes: FonteDaPesquisa[];
  /** Filme: os 3 storyboards para escolher no nó. */
  storyboards: StoryboardDoFilme[];
  /** Filme: o storyboard escolhido (índice em `storyboards`); null = ainda não escolheu. */
  storyboard_escolhido: number | null;
  /** Filme: etapa (escolher, renderizando, montando, pronto, parado), andamento do render (0 a 100) e o vídeo pronto. */
  etapa_filme: string;
  render_progresso: number | null;
  video_url: string;
  video_path: string;
  /** Pôr no ar: estado do pedido (aguardando sua aprovação → com o agente → feito). */
  estado_no_ar: EstadoNoAr | null;
  aprovacao_id: string;
  /** Link do pedido em "Precisa de você" (a função manda; sem ele, monta pelo id). */
  link_aprovacao: string;
  /** Nome de quem põe no ar (Hermes, gestor de tráfego do Paperclip...). */
  operador: string;
  /** Pôr no ar: a prova (texto) e o link do que foi ao ar. */
  prova: string;
  link_no_ar: string;
  // ---- v3 (clickmax-rea.md)
  /** Prova ou número que o nó escreveu sem fonte: trava o Pôr no ar até o dono resolver. */
  rascunho_sem_fonte: BlocoSemFonte[];
  /** Nós criativos (21/10): o que de cada entrada o motor usou ([{ tipo, rotulo, no_id }]). */
  usou?: UsoDaEntrada[];
  /** Motor que gera a peça ("estudio_arte": o motor da casa, acompanhado pelo no_acompanhar). */
  motor?: string;
  /** Revisão localizada: mantém a referência à peça corrigida ao reabrir o projeto. */
  origem?: { execucao_id: string; indice: number; modo: "ajustar" | "variar" };
  revisao_texto?: string;
  /** Etapa reservada que ainda espera uma saída anterior da mesma rodada. */
  aguardando_dependencias?: boolean;
  /** Páginas do mesmo nó, como inscrição, sala e encerramento de um webinar. */
  paginas?: Array<{ nome: string; caminho: string; html_path: string; html_url: string }>;
}

/** Pergunta guiada antes de montar (até 4): os exemplos só preenchem a caixa. */
export interface PerguntaGuiada {
  id: string;
  pergunta: string;
  exemplos: string[];
}

export interface FonteDaPesquisa {
  titulo: string;
  url: string;
}

export interface StoryboardDoFilme {
  indice: number;
  titulo: string;
  resumo: string;
  /** Cenas e duração (os storyboards da Mesa Motion são roteiros: podem vir sem imagem). */
  cenas: number | null;
  duracao_s: number | null;
  imagens: ImagemDoLab[];
}

export type EstadoNoAr = "aguardando_aprovacao" | "com_agente" | "feito" | "recusado";

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
  /** O modo que a função usou (ela também reconhece o pedido de projeto completo sozinha). */
  modo: "projeto_completo" | "simples";
  /** v3: faltou o essencial; a função perguntou em vez de montar (operacoes vem vazia). */
  perguntas: PerguntaGuiada[];
  /** 21/10: nós que ficaram soltos no plano, com o motivo (o quadro avisa no nó). */
  nos_soltos?: NoSolto[];
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

/** Só http(s): link de fonte ou de prova vira <a href>. */
const linkSeguro = (v: unknown) => {
  const t = texto(v).trim();
  return /^https?:\/\//i.test(t) ? t : "";
};

function fontes(v: unknown): FonteDaPesquisa[] {
  return (Array.isArray(v) ? v : [])
    .map((x: any): FonteDaPesquisa | null => {
      if (typeof x === "string") return linkSeguro(x) ? { titulo: "", url: linkSeguro(x) } : null;
      const o = objeto(x);
      const url = linkSeguro(o.url || o.link || o.href);
      return url ? { titulo: texto(o.titulo || o.title || o.nome), url } : null;
    })
    .filter((x): x is FonteDaPesquisa => !!x)
    .slice(0, 30);
}

function storyboards(v: unknown): StoryboardDoFilme[] {
  return (Array.isArray(v) ? v : []).map((x: any, i: number) => {
    const o = objeto(x);
    const lista = Array.isArray(o.imagens) ? o.imagens : Array.isArray(o.quadros) ? o.quadros : o.imagem ? [o.imagem] : o.url || o.path ? [o] : [];
    return { indice: num(o.indice) ?? i, titulo: texto(o.titulo || o.nome), resumo: texto(o.resumo || o.descricao || o.logline), cenas: num(o.cenas), duracao_s: num(o.duracao_s), imagens: imagens(lista) };
  });
}

const ESTADOS_NO_AR: EstadoNoAr[] = ["aguardando_aprovacao", "com_agente", "feito", "recusado"];

/** rascunho_sem_fonte da saída (BlocoSemFonte da função). */
export function blocosSemFonte(v: unknown): BlocoSemFonte[] {
  return (Array.isArray(v) ? v : [])
    .map((x: any): BlocoSemFonte | null => {
      const o = objeto(x);
      if (!texto(o.id) || !texto(o.texto)) return null;
      return { id: texto(o.id), tipo: texto(o.tipo) || "outro", texto: texto(o.texto), onde: texto(o.onde), confirmado: o.confirmado === true, como: texto(o.como), fonte: texto(o.fonte) };
    })
    .filter((x): x is BlocoSemFonte => !!x)
    .slice(0, 40);
}

/** perguntas: [{ id, pergunta, exemplos }] (até 4). */
export function normalizarPerguntas(v: unknown): PerguntaGuiada[] {
  return (Array.isArray(v) ? v : [])
    .map((x: any): PerguntaGuiada | null => {
      const o = objeto(x);
      const pergunta = texto(o.pergunta).trim();
      if (!pergunta) return null;
      return { id: texto(o.id) || pergunta.slice(0, 20), pergunta, exemplos: (Array.isArray(o.exemplos) ? o.exemplos : []).map(texto).filter(Boolean).slice(0, 4) };
    })
    .filter((x): x is PerguntaGuiada => !!x)
    .slice(0, 4);
}

export function normalizarSaida(s: unknown): SaidaDaExecucao {
  const o = objeto(s);
  const filme = objeto(o.filme);
  const render = objeto(o.render || filme.render);
  const estado = texto(o.estado || o.estado_no_ar) as EstadoNoAr;
  const escolhido = num(o.storyboard_escolhido ?? o.escolhido ?? filme.escolhido);
  // Filme pronto: video_url, ou o primeiro dos `videos` (um por formato) que já tem link.
  const videos = (Array.isArray(o.videos) ? o.videos : []).map(objeto);
  const primeiroVideo = videos.find((v) => texto(v.url)) || videos.find((v) => texto(v.path)) || {};
  const origem = objeto(o.origem);
  const indice = num(origem.indice);
  const revisao = typeof origem.execucao_id === "string" && origem.execucao_id && indice !== null && Number.isInteger(indice) && indice >= 0 && (origem.modo === "ajustar" || origem.modo === "variar")
    ? { execucao_id: origem.execucao_id, indice, modo: origem.modo as "ajustar" | "variar" }
    : undefined;
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
    fontes: fontes(o.fontes),
    storyboards: storyboards(o.storyboards || filme.storyboards),
    storyboard_escolhido: escolhido,
    etapa_filme: texto(o.etapa),
    render_progresso: num(o.render_progresso ?? render.progresso),
    video_url: texto(o.video_url || filme.video_url || primeiroVideo.url),
    video_path: texto(o.video_path || filme.video_path || primeiroVideo.path),
    estado_no_ar: ESTADOS_NO_AR.indexOf(estado) >= 0 ? estado : null,
    aprovacao_id: texto(o.aprovacao_id),
    link_aprovacao: texto(o.link_aprovacao).indexOf("/") === 0 ? texto(o.link_aprovacao) : "",
    operador: texto(o.operador_nome || o.operador || o.operador_slug),
    prova: texto(o.prova),
    link_no_ar: linkSeguro(o.url_no_ar || o.link_no_ar || o.url_publicada || o.prova_url),
    rascunho_sem_fonte: blocosSemFonte(o.rascunho_sem_fonte),
    usou: usouDe(o.usou),
    motor: texto(o.motor),
    origem: revisao,
    revisao_texto: typeof o.revisao_texto === "string" ? o.revisao_texto : undefined,
    aguardando_dependencias: o.aguardando_dependencias === true,
    paginas: (Array.isArray(o.paginas) ? o.paginas : []).map((p: unknown) => {
      const pagina = objeto(p);
      return { nome: texto(pagina.nome), caminho: texto(pagina.caminho), html_path: texto(pagina.html_path), html_url: texto(pagina.html_url) };
    }).filter((p) => p.caminho && p.html_path),
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

/** `client_id` só vai quando muda (null = Livre); a função confere o acesso ao cliente. */
export async function salvarProjeto(p: { id: string; nome: string; canvas: CanvasDoLab; versao: number; client_id?: string | null }): Promise<ProjetoDoLab> {
  try {
    const corpo: Record<string, unknown> = { projeto_id: p.id, nome: p.nome, canvas: p.canvas, versao_esperada: p.versao };
    if (p.client_id !== undefined) corpo.client_id = p.client_id;
    return projetoDa(await chamar("projeto_salvar", corpo));
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

/**
 * projeto_excluir { projeto_id } -> { excluido, projeto_id }: apaga o projeto e as execuções dele
 * (não volta). Os arquivos gerados continuam em Arquivos (workspace), sem o projeto.
 */
export async function excluirProjeto(projetoId: string): Promise<void> {
  await chamar("projeto_excluir", { projeto_id: projetoId });
}

export async function listarTemplates(): Promise<TemplateDoLab[]> {
  const data = await chamar("templates_listar");
  return valores(data && data.templates).map(normalizarTemplate).filter(Boolean) as TemplateDoLab[];
}

export async function usarTemplate(templateId: string, clientId: string | null): Promise<ProjetoDoLab> {
  return projetoDa(await chamar("template_usar", { template_id: templateId, client_id: clientId }));
}

const nomeNormal = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** O template oficial com esse nome (sem acento e sem caixa); pessoal só se não houver oficial. */
export function templatePorNome(lista: TemplateDoLab[], nome: string): TemplateDoLab | null {
  const alvo = nomeNormal(nome);
  const iguais = lista.filter((t) => nomeNormal(t.nome) === alvo);
  const parecidos = iguais.length ? iguais : lista.filter((t) => nomeNormal(t.nome).indexOf(alvo) >= 0);
  return parecidos.find((t) => t.oficial) || parecidos[0] || null;
}

/** Template oficial "Filme da marca" (ESPEC v2): a Mesa Identidade abre o Laboratório com ele. */
export const TEMPLATE_FILME_DA_MARCA = "Filme da marca";

/** Cria um projeto a partir do template com esse nome (template_usar com client_id). */
export async function usarTemplatePorNome(nome: string, clientId: string | null): Promise<ProjetoDoLab> {
  const t = templatePorNome(await listarTemplates(), nome);
  if (!t) throw new ErroDaMesa("template_inexistente", `O fluxo "${nome}" ainda não está no Laboratório.`);
  return usarTemplate(t.id, clientId);
}

/** Endereço do projeto no canvas do Laboratório (com o cliente, para a casca abrir com ele). */
export function enderecoDoProjeto(projetoId: string, clientId?: string | null): string {
  const p = new URLSearchParams({ aba: "projetos", projeto: projetoId });
  if (clientId) p.set("client", clientId);
  return `/laboratorio?${p.toString()}`;
}

/** "Precisa de você" da Execução, aberto no pedido de aprovação do nó Pôr no ar. */
export function enderecoDaAprovacao(aprovacaoId: string): string {
  return aprovacaoId ? `/execucao?aprovacao=${encodeURIComponent(aprovacaoId)}` : "/execucao?aba=decisoes";
}

/**
 * Filme: escolhe um dos 3 storyboards no próprio nó (filme_escolher
 * { projeto_id, no_id, indice }); a função segue para o render e o
 * progresso chega pelo execucoes_ler. Se a função pedir confirmação do
 * custo do render, volta como ErroDaMesa confirmacao_necessaria (custoAConfirmar).
 */
export async function escolherStoryboard(projetoId: string, noId: string, indice: number, confirmado?: boolean): Promise<ExecucaoDoLab | null> {
  const corpo: Record<string, unknown> = { projeto_id: projetoId, no_id: noId, indice };
  if (confirmado) corpo.confirmado = true;
  const data = await chamar("filme_escolher", corpo);
  return normalizarExecucao(data && data.execucao);
}

/**
 * no_acompanhar { projeto_id, no_id } → { execucao_id, execucao }: um passo do Filme (render,
 * montagem, vídeo pronto) ou do Pôr no ar (aprovação → com o agente → feito). A tela chama de
 * tempo em tempo enquanto o nó espera; nunca executa nada sozinho.
 */
export async function acompanharNo(projetoId: string, noId: string): Promise<ExecucaoDoLab | null> {
  const data = await chamar("no_acompanhar", { projeto_id: projetoId, no_id: noId });
  return normalizarExecucao(data && data.execucao);
}

/**
 * Filme com o storyboard escolhido, renderizando ou montando: a tela chama o no_acompanhar
 * de tempo em tempo (5 s). O Pôr no ar não: o estado dele chega pelo realtime de lab_execucoes.
 */
export function precisaAcompanhar(tipo: string, e: ExecucaoDoLab | undefined): boolean {
  if (!e || e.status === "erro" || e.status === "pronto") return false;
  // 21/10: Resultado e Carrossel no motor da casa (estudio_arte) ficam "aguardando"; só o no_acompanhar avança.
  if (noMotorDaCasa(tipo, e)) return true;
  if (tipo === "agente_externo") return !!e.saida.tarefa_id;
  if (tipo === "por_no_ar") return !!e.saida.aprovacao_id;
  if (tipo !== "filme") return false;
  return e.saida.storyboard_escolhido !== null && (e.saida.etapa_filme === "renderizando" || e.saida.etapa_filme === "montando");
}

/** A leitura da rodada também dá continuidade às dependências, inclusive de arte e vídeo. */
export function precisaLerExecucao(tipo: string, e: ExecucaoDoLab): boolean {
  if (e.status === "pronto" || e.status === "erro") return false;
  if (e.status === "aguardando" && !e.saida.aguardando_dependencias && ["filme", "por_no_ar", "agente_externo", "imagem", "carrossel"].includes(tipo)) return false;
  return true;
}

/** Pôr no ar já tem um pedido aberto para o nó (409 ja_pedido): acompanhe por ele. */
export const ehJaPedido = (e: unknown) => e instanceof ErroDaMesa && e.codigo === "ja_pedido";

export async function salvarTemplate(projetoId: string, nome: string, descricao = ""): Promise<void> {
  await chamar("template_salvar", { projeto_id: projetoId, nome, descricao });
}

export async function estimar(projetoId: string, nos?: string[], opcoes?: { rodada?: boolean }): Promise<EstimativaDoLab> {
  const data = await chamar("estimar", { projeto_id: projetoId, ...(nos ? { nos } : {}), ...(opcoes?.rodada ? { rodada: true } : {}) });
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

/** Cancela somente etapas da rodada que ainda não começaram; o servidor estorna a reserva delas. */
export async function cancelarRodada(projetoId: string, rodadaId: string): Promise<string[]> {
  const data = await chamar("rodada_cancelar", { projeto_id: projetoId, rodada_id: rodadaId });
  return (Array.isArray(data?.canceladas) ? data.canceladas : []).filter((id: unknown): id is string => typeof id === "string");
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
export async function planejar(a: { projetoId: string; mensagem: string; historico: MensagemDoPlanejar[]; modelo: string; modo?: "projeto_completo"; respostas?: string; pularPerguntas?: boolean }): Promise<RespostaDoPlanejar> {
  const corpo: Record<string, unknown> = {
    projeto_id: a.projetoId,
    mensagem: a.mensagem,
    historico: a.historico.slice(-12),
    modelo_id: a.modelo,
  };
  // v2: pedido grande (empresa, low ticket, funil) monta o projeto inteiro em colunas, já ligado.
  if (a.modo) corpo.modo = a.modo;
  // v3: respostas às perguntas guiadas (ou "pular e montar assim mesmo").
  if (a.respostas && a.respostas.trim()) corpo.respostas = a.respostas.trim();
  if (a.pularPerguntas) corpo.pular_perguntas = true;
  const data = await chamar("planejar", corpo);
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
    modo: data && data.modo === "projeto_completo" ? "projeto_completo" : a.modo === "projeto_completo" && !(data && data.modo) ? "projeto_completo" : "simples",
    perguntas: normalizarPerguntas(data && data.perguntas),
    nos_soltos: avisarNosSoltos(a.projetoId, nosSoltosDe(data && data.nos_soltos)),
  };
}

/**
 * pedido_inicio → 201 { projeto, resposta, operacoes }: o projeto já nasce com o canvas montado.
 * v3: pedido de projeto completo sem o essencial → { projeto: null, perguntas } (nada é criado).
 */
export async function pedidoInicio(a: { pedido: string; clientId: string | null; modelo: string; respostas?: string; pularPerguntas?: boolean }): Promise<{ projeto: ProjetoDoLab | null; perguntas: PerguntaGuiada[] }> {
  const corpo: Record<string, unknown> = { pedido: a.pedido, client_id: a.clientId, modelo_id: a.modelo };
  if (a.respostas && a.respostas.trim()) corpo.respostas = a.respostas.trim();
  if (a.pularPerguntas) corpo.pular_perguntas = true;
  const data = await chamar("pedido_inicio", corpo);
  const perguntas = normalizarPerguntas(data && data.perguntas);
  if (perguntas.length && !(data && data.projeto)) return { projeto: null, perguntas };
  return { projeto: projetoDa(data), perguntas: [] };
}

/** perguntas_do_pedido { pedido, client_id } → { perguntas } (a Início pergunta antes de criar o projeto completo). */
export async function perguntasDoPedido(pedido: string, clientId: string | null): Promise<PerguntaGuiada[]> {
  const data = await chamar("perguntas_do_pedido", { pedido, client_id: clientId });
  return normalizarPerguntas(data && data.perguntas);
}

/**
 * bloco_resolver { projeto_id, no_id, bloco_id, modo, fonte | texto } → { execucao }: o dono marca a fonte
 * confirmada (modo "fonte") ou troca o trecho (modo "editar"). Destrava o Pôr no ar quando não sobra bloco.
 */
export async function resolverBloco(a: { projetoId: string; noId: string; blocoId: string; modo: "fonte" | "editar"; valor: string }): Promise<ExecucaoDoLab | null> {
  const corpo: Record<string, unknown> = { projeto_id: a.projetoId, no_id: a.noId, bloco_id: a.blocoId, modo: a.modo };
  if (a.modo === "fonte") corpo.fonte = a.valor;
  else corpo.texto = a.valor;
  const data = await chamar("bloco_resolver", corpo);
  return normalizarExecucao(data && data.execucao);
}

/** Os blocos sem fonte de cada nó, pela última execução de cada um (para a trava do Pôr no ar). */
export function blocosPorNo(execucoes: Record<string, ExecucaoDoLab | undefined>): Record<string, BlocoSemFonte[]> {
  const saida: Record<string, BlocoSemFonte[]> = {};
  Object.keys(execucoes).forEach((id) => {
    const e = execucoes[id];
    if (e && e.status === "pronto" && e.saida.rascunho_sem_fonte.length) saida[id] = e.saida.rascunho_sem_fonte;
  });
  return saida;
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

// ------------------------------------------------------------------ galeria de fluxos (20/10)

/** Template com a categoria da galeria (campo `categoria` quando a função manda; sem ele, "Outros"). */
export interface FluxoDaGaleria extends TemplateDoLab {
  categoria: string;
}

export const CATEGORIA_SEM_NOME = "Outros";

/** templates_listar lido para a galeria: guarda a categoria que vier (categoria, ou grupo). */
export async function listarFluxosDaGaleria(): Promise<FluxoDaGaleria[]> {
  const data = await chamar("templates_listar");
  return (Array.isArray(data && data.templates) ? data.templates : [])
    .map((t: unknown) => {
      const base = normalizarTemplate(t);
      if (!base) return null;
      const o = objeto(t);
      const categoria = texto(o.categoria || o.grupo).trim();
      return { ...base, categoria: categoria || CATEGORIA_SEM_NOME };
    })
    .filter(Boolean) as FluxoDaGaleria[];
}

// ------------------------------------------------------------------ créditos do Laboratório (20/10)

export type TipoDeMovimento = "carga" | "uso" | "estorno" | "ajuste";

export interface MovimentoDeCredito {
  id: string;
  tipo: TipoDeMovimento;
  valor_usd: number;
  saldo_depois: number;
  projeto_id: string | null;
  projeto_nome: string;
  nota: string;
  criado_em: string;
}

/** creditos → saldo, limite ligado, quem pode carregar, extrato (50) e o gasto do mês. */
export interface CreditosDoLab {
  /** false: o banco ainda não tem os créditos (migration pendente); nada trava. */
  disponivel: boolean;
  saldo_usd: number;
  /** Limite ligado: rodar debita e bloqueia sem saldo. Desligado (o começo): só registra o uso. */
  ativa: boolean;
  pode_carregar: boolean;
  movimentos: MovimentoDeCredito[];
  gasto_mes_usd: number;
  por_projeto: Array<{ projeto_id: string | null; projeto_nome: string; gasto_usd: number }>;
}

/** Chave do React Query dos créditos (chip do cabeçalho, janela e janela de custo). */
export const chaveDosCreditos = ["laboratorio", "creditos"] as const;

const TIPOS_DE_MOVIMENTO: TipoDeMovimento[] = ["carga", "uso", "estorno", "ajuste"];

export function normalizarCreditos(data: unknown): CreditosDoLab {
  const o = objeto(data);
  const movimentos = (Array.isArray(o.movimentos) ? o.movimentos : [])
    .map((m: unknown) => {
      const x = objeto(m);
      if (!x.id || TIPOS_DE_MOVIMENTO.indexOf(x.tipo) < 0) return null;
      return {
        id: texto(x.id),
        tipo: x.tipo as TipoDeMovimento,
        valor_usd: num(x.valor_usd) ?? 0,
        saldo_depois: num(x.saldo_depois) ?? 0,
        projeto_id: x.projeto_id ? texto(x.projeto_id) : null,
        projeto_nome: texto(x.projeto_nome),
        nota: texto(x.nota),
        criado_em: texto(x.criado_em),
      };
    })
    .filter(Boolean) as MovimentoDeCredito[];
  const por_projeto = (Array.isArray(o.por_projeto) ? o.por_projeto : []).map((p: unknown) => {
    const x = objeto(p);
    return { projeto_id: x.projeto_id ? texto(x.projeto_id) : null, projeto_nome: texto(x.projeto_nome) || "Sem projeto", gasto_usd: num(x.gasto_usd) ?? 0 };
  });
  return {
    disponivel: o.disponivel !== false,
    saldo_usd: num(o.saldo_usd) ?? 0,
    ativa: o.ativa === true,
    pode_carregar: o.pode_carregar === true,
    movimentos,
    gasto_mes_usd: num(o.gasto_mes_usd) ?? 0,
    por_projeto,
  };
}

export async function lerCreditos(): Promise<CreditosDoLab> {
  return normalizarCreditos(await chamar("creditos"));
}

/** creditos_carregar { valor_usd, nota } (só admin): registro manual, sem pagamento. */
export async function carregarCreditos(valorUsd: number, nota: string): Promise<{ saldo_usd: number; ativa: boolean }> {
  const data = await chamar("creditos_carregar", { valor_usd: valorUsd, nota });
  const o = objeto(data);
  return { saldo_usd: num(o.saldo_usd) ?? 0, ativa: o.ativa === true };
}

/** creditos_limite { ativa } (só admin): desligado, o uso só fica registrado. */
export async function definirLimiteDosCreditos(ativa: boolean): Promise<{ saldo_usd: number; ativa: boolean }> {
  const o = objeto(await chamar("creditos_limite", { ativa }));
  return { saldo_usd: num(o.saldo_usd) ?? 0, ativa: o.ativa === true };
}

/** Rodar com a carteira do Laboratório ativa e sem saldo (402 sem_credito { saldo_usd, custo_usd }). */
export function semCredito(e: unknown): { saldo_usd: number; custo_usd: number } | null {
  if (!(e instanceof ErroDaMesa) || e.codigo !== "sem_credito") return null;
  const d = objeto(e.detalhes);
  return { saldo_usd: num(d.saldo_usd) ?? 0, custo_usd: num(d.custo_usd) ?? 0 };
}

/** O que a janela de custo mostra: saldo depois e se falta (só com o limite ligado). */
export function saldoDepoisDoCusto(c: Pick<CreditosDoLab, "disponivel" | "ativa" | "saldo_usd"> | null | undefined, total: number): { depois: number; falta: number } | null {
  if (!c || !c.disponivel || !c.ativa) return null;
  const depois = Math.round((c.saldo_usd - total) * 1e6) / 1e6;
  return { depois, falta: depois < 0 ? -depois : 0 };
}

// ------------------------------------------------------------ nós completos (21/10): fontes do cliente, preencher com IA, ler documento, automático

/** Mídia da biblioteca do cliente (fontes_do_cliente.midias). */
export interface MidiaDoCliente {
  id: string;
  tipo: "imagem" | "video";
  url: string;
  miniatura_url: string;
  nome: string;
  origem: string;
}

/** fontes_do_cliente → o que o cliente já tem: dossiê, marca, mídias e documentos. */
export interface FontesDoCliente {
  cliente: { id: string; nome: string } | null;
  dossie: { resumo: string; pontos: string[] };
  marca: { cores: string[]; fontes: string[]; tom: string; logo_url: string; nunca: string[] };
  midias: MidiaDoCliente[];
  documentos: Array<{ id: string; nome: string; tipo: string; url: string }>;
}

const textos = (v: unknown): string[] => valores(v).map((x) => (x && typeof x === "object" ? texto((x as any).nome || (x as any).valor || (x as any).hex || "") : texto(x)).trim()).filter(Boolean);

export function normalizarFontes(v: unknown): FontesDoCliente {
  const o = objeto(v);
  const c = objeto(o.cliente);
  const d = objeto(o.dossie);
  const m = objeto(o.marca);
  return {
    cliente: c.id || c.nome ? { id: texto(c.id), nome: texto(c.nome || c.company_name) } : typeof o.cliente === "string" ? { id: "", nome: o.cliente } : null,
    dossie: { resumo: texto(d.resumo).trim(), pontos: textos(d.pontos) },
    marca: { cores: textos(m.cores), fontes: textos(m.fontes), tom: texto(m.tom).trim(), logo_url: texto(m.logo_url), nunca: textos(m.nunca) },
    midias: valores(o.midias)
      .map((x) => objeto(x))
      .filter((x) => !!texto(x.url))
      .map((x) => ({ id: texto(x.id) || texto(x.url), tipo: x.tipo === "video" ? ("video" as const) : ("imagem" as const), url: texto(x.url), miniatura_url: texto(x.miniatura_url), nome: texto(x.nome), origem: texto(x.origem) })),
    documentos: valores(o.documentos)
      .map((x) => objeto(x))
      .filter((x) => !!texto(x.id) || !!texto(x.url))
      .map((x) => ({ id: texto(x.id), nome: texto(x.nome) || "Documento", tipo: texto(x.tipo), url: texto(x.url) })),
  };
}

/** fontes_do_cliente { client_id | null }. */
export async function fontesDoCliente(clientId: string | null): Promise<FontesDoCliente> {
  return normalizarFontes(await chamar("fontes_do_cliente", { client_id: clientId || null }));
}

/** no_preencher → { dados, explicacao, custo_usd }. Sem confirmado, a função responde 409 confirmacao_necessaria com o custo. */
export async function preencherNo(a: { projetoId: string; noId: string; pedido?: string; campos?: string[]; confirmado?: boolean }): Promise<{ dados: Record<string, unknown>; explicacao: string; custo_usd: number }> {
  const corpo: Record<string, unknown> = { projeto_id: a.projetoId, no_id: a.noId };
  if (a.pedido && a.pedido.trim()) corpo.pedido = a.pedido.trim();
  if (a.campos && a.campos.length) corpo.campos = a.campos;
  if (a.confirmado) corpo.confirmado = true;
  const data = objeto(await chamar("no_preencher", corpo));
  return { dados: objeto(data.dados), explicacao: texto(data.explicacao), custo_usd: num(data.custo_usd) ?? 0 };
}

/** O custo que a função pediu para confirmar (409 confirmacao_necessaria de no_preencher). */
export function custoDoPreencher(e: unknown): number | null {
  if (!(e instanceof ErroDaMesa) || e.codigo !== "confirmacao_necessaria") return null;
  const d = objeto(e.detalhes);
  return num(d.custo_usd) ?? num(d.total_usd) ?? 0;
}

/** ler_documento { projeto_id, arquivo: { id, path?, url? }, resumir? } → { texto, resumo, lido }. */
export async function lerDocumento(a: { projetoId: string; arquivo: { id: string; path?: string; url?: string }; resumir?: boolean }): Promise<{ texto: string; resumo: string; lido: boolean }> {
  const arquivo: Record<string, unknown> = { id: a.arquivo.id };
  if (a.arquivo.path) arquivo.path = a.arquivo.path;
  if (a.arquivo.url) arquivo.url = a.arquivo.url;
  const data = objeto(await chamar("ler_documento", { projeto_id: a.projetoId, arquivo, ...(a.resumir ? { resumir: true } : {}) }));
  return { texto: texto(data.texto), resumo: texto(data.resumo), lido: data.lido === true };
}

/** no_executar { automatico: true }: a função decide se cabe no teto do projeto; não cabendo, 409 com o custo. */
export async function executarNoAutomatico(projetoId: string, noId: string): Promise<ExecucaoDoLab> {
  const data = await chamar("no_executar", { projeto_id: projetoId, no_id: noId, automatico: true });
  const ex = normalizarExecucao(data && data.execucao);
  if (ex) return ex;
  const status = data && STATUS.indexOf(data.status) >= 0 ? (data.status as StatusDaExecucao) : "rodando";
  return execucaoNova(noId, texto(data && data.execucao_id), status);
}

/** Teto do automático por nó (config.auto_ate_usd): de 0 a 5; 0 = sempre pergunta. */
export const autoAteUsdValido = (v: unknown): number => {
  const n = num(v);
  return n === null || n < 0 ? 0 : Math.min(5, Math.round(n * 100) / 100);
};

/** config do projeto ({ auto_ate_usd }): lê e grava pela ação projeto_config (contrato a fechar com a função). */
export async function lerConfigDoProjeto(projetoId: string): Promise<{ auto_ate_usd: number }> {
  const data = objeto(await chamar("projeto_config", { projeto_id: projetoId }));
  return { auto_ate_usd: autoAteUsdValido(objeto(data.config).auto_ate_usd) };
}

export async function salvarConfigDoProjeto(projetoId: string, config: { auto_ate_usd: number }): Promise<{ auto_ate_usd: number }> {
  const data = objeto(await chamar("projeto_config", { projeto_id: projetoId, config: { auto_ate_usd: autoAteUsdValido(config.auto_ate_usd) } }));
  return { auto_ate_usd: autoAteUsdValido(objeto(data.config).auto_ate_usd ?? config.auto_ate_usd) };
}

// ------------------------------------------------------------ nós criativos (21/10): motor treinado, salvar, ajustar, variar

/** O que de uma entrada o motor usou (saida.usou). */
export interface UsoDaEntrada {
  tipo: string;
  rotulo: string;
  no_id: string;
  /** Como a entrada foi usada (vai no title do chip). */
  como: string;
}

export function usouDe(v: unknown): UsoDaEntrada[] {
  return valores(v)
    .map((x) => objeto(x))
    .filter((x) => !!texto(x.rotulo) || !!texto(x.tipo))
    .map((x) => ({ tipo: texto(x.tipo), rotulo: texto(x.rotulo) || texto(x.tipo), no_id: texto(x.no_id), como: texto(x.como) }));
}

/** salvar_nos_arquivos { projeto_id, no_id, indices?, destino } → { salvos: [{ nome, path, pasta }] }. */
export async function salvarNosArquivos(a: { projetoId: string; noId: string; indices?: number[]; destino: "cliente" | "laboratorio" }): Promise<Array<{ nome: string; path: string; pasta: string }>> {
  const corpo: Record<string, unknown> = { projeto_id: a.projetoId, no_id: a.noId, destino: a.destino };
  if (a.indices && a.indices.length) corpo.indices = a.indices;
  const data = objeto(await chamar("salvar_nos_arquivos", corpo));
  return valores(data.salvos)
    .map((x) => objeto(x))
    .map((x) => ({ nome: texto(x.nome), path: texto(x.path), pasta: texto(x.pasta) }));
}

const execucaoDa = (data: any, noId: string): ExecucaoDoLab => {
  const ex = normalizarExecucao(data && data.execucao);
  if (ex) return ex;
  const status = data && STATUS.indexOf(data.status) >= 0 ? (data.status as StatusDaExecucao) : "na_fila";
  return execucaoNova(noId, texto(data && data.execucao_id), status);
};

/** no_ajustar { projeto_id, no_id, indice, pedido, confirmado? }: sem confirmado, 409 com o custo; depois, uma execução nova. */
export async function ajustarImagem(a: { projetoId: string; noId: string; indice: number; pedido: string; confirmado?: boolean }): Promise<ExecucaoDoLab> {
  const data = await chamar("no_ajustar", { projeto_id: a.projetoId, no_id: a.noId, indice: a.indice, pedido: a.pedido.trim(), ...(a.confirmado ? { confirmado: true } : {}) });
  return execucaoDa(data, a.noId);
}

/** no_variar { projeto_id, no_id, indice, quantidade 1..4, confirmado? }: sem confirmado, 409 com o custo; depois, uma execução nova. */
export async function variarImagem(a: { projetoId: string; noId: string; indice: number; quantidade: number; confirmado?: boolean }): Promise<ExecucaoDoLab> {
  const quantidade = Math.max(1, Math.min(4, Math.round(a.quantidade) || 1));
  const data = await chamar("no_variar", { projeto_id: a.projetoId, no_id: a.noId, indice: a.indice, quantidade, ...(a.confirmado ? { confirmado: true } : {}) });
  return execucaoDa(data, a.noId);
}

/** Resultado ou Carrossel no motor da casa (estudio_arte), ainda gerando: "No motor" na tela e no_acompanhar de tempo em tempo. */
export function noMotorDaCasa(tipo: string, e: ExecucaoDoLab | undefined): boolean {
  if (!e || e.status === "erro" || e.status === "pronto") return false;
  if (e.saida.motor === "estudio_arte") return true;
  return (tipo === "imagem" || tipo === "carrossel") && e.status === "aguardando" && e.saida.etapa_filme === "gerando";
}

/** O motor recusou porque o cliente tem mais de uma marca (400 escolha_a_marca). */
export const ehEscolhaDaMarca = (e: unknown) => e instanceof ErroDaMesa && e.codigo === "escolha_a_marca";

/** Nó que o planejar deixou solto ({ no_id, tipo, motivo }). */
export interface NoSolto {
  no_id: string;
  tipo: string;
  motivo: string;
}

export function nosSoltosDe(v: unknown): NoSolto[] {
  return valores(v)
    .map((x) => objeto(x))
    .filter((x) => !!texto(x.no_id))
    .map((x) => ({ no_id: texto(x.no_id), tipo: texto(x.tipo), motivo: texto(x.motivo) }));
}

/** Quem mostra os nós soltos (o quadro do projeto) ouve aqui; o planejar avisa sem mudar quem o chama. */
const ouvintesDosSoltos: Array<{ projetoId: string; cb: (l: NoSolto[]) => void }> = [];

export function ouvirNosSoltos(projetoId: string, cb: (l: NoSolto[]) => void): () => void {
  const item = { projetoId, cb };
  ouvintesDosSoltos.push(item);
  return () => {
    const i = ouvintesDosSoltos.indexOf(item);
    if (i >= 0) ouvintesDosSoltos.splice(i, 1);
  };
}

export function avisarNosSoltos(projetoId: string, lista: NoSolto[]): NoSolto[] {
  ouvintesDosSoltos.filter((o) => o.projetoId === projetoId).forEach((o) => o.cb(lista));
  return lista;
}
