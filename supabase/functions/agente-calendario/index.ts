/**
 * agente-calendario: o estrategista editorial da Mesa do cliente
 * (docs/mesa-do-cliente/SPEC.md, secao 4).
 *
 * Acoes (POST { acao, ... }, so equipe com acesso ao cliente):
 * - propor_temas { client_id, periodo_inicio, periodo_fim, frequencia, objetivo?,
 *   oferta?, regiao?, project_id?, modelo_id?, raciocinio? }: monta o contexto
 *   real do cliente, pesquisa na web, devolve diagnostico e 8 a 15 temas; o Jev
 *   da nota de aderencia ao objetivo e de potencial de salvamento e
 *   compartilhamento de cada tema. Cria calendario_propostas com status temas
 *   e abre a conversa do agente.
 * - escolher_temas { proposta_id, temas: string[] }: marca os temas escolhidos.
 * - detalhar { proposta_id, modelo_id?, raciocinio? }: gera os itens completos
 *   dos temas escolhidos (todos os campos do prompt, roteiro de cada card,
 *   ilustracao, estilo, carrossel infinito). Datas so de segunda a sexta dentro
 *   do periodo, calculadas aqui no codigo. Formato so carrossel ou estatico.
 *   Os lotes rodam em paralelo para caber no tempo da funcao; um lote que falha
 *   deixa a proposta em detalhando e a proxima chamada so refaz o que falta.
 * - conversar { proposta_id, mensagem }: aplica o pedido na proposta (saida em
 *   JSON), grava as mensagens e devolve a proposta atualizada e a resposta.
 * - gravar { proposta_id, project_id }: cria os itens na agenda pelo mesmo
 *   servico do MCP (createEditorialItem), idempotente por proposta mais indice
 *   do item, preserva o que existe, guarda task_ids, status gravada e registra
 *   na memoria do agente o que foi escolhido e descartado.
 *
 * Regras: contexto so com dado real (nunca inventar); toda leitura e escrita
 * presa ao client_id da proposta; nenhuma falha responde 200.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { carregarModelo, chamarTexto, cobrarJev, IaMotorErro, modeloPadrao, type ModeloIa } from "../_shared/ia-motor.ts";
import { jevPerguntar, JevErro, notaScore, type PerguntaJev } from "../_shared/jev.ts";
import {
  createEditorialItem,
  createEditorialItemSchema,
  deterministicEditorialTaskId,
  WriteError,
  type WriteCtx,
} from "../_shared/mcp-write-services.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import { direcaoDoRoteiro } from "../_shared/direcao-arte.ts";
import { lerMarcaParaDirecao } from "../_shared/contexto-cliente.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const AGENTE = "estrategista";
const REF_TIPO = "calendario_proposta";

// Principal fixo do backend para a escrita na agenda. O id da tarefa nasce de
// principal + chave de idempotencia (deterministicEditorialTaskId), entao com
// um principal fixo a mesma proposta e o mesmo item geram sempre a mesma
// tarefa, seja quem for da equipe que clicar em gravar de novo. Quem pediu
// fica no registro de auditoria (mcp_audit_log).
export const PRINCIPAL_MESA = "mesa:agente-calendario";

// Tema por lote no detalhamento e quantos lotes rodam ao mesmo tempo.
const TEMAS_POR_LOTE = 3;
const LOTES_EM_PARALELO = 5;

// Limite da descricao do item editorial (createEditorialItemSchema).
const LIMITE_DESCRICAO = 4000;

export const FORMATOS = ["carrossel", "estatico"] as const;
type Formato = typeof FORMATOS[number];
const FORMATO_PARA_ENTREGA: Record<Formato, "carousel" | "static"> = { carrossel: "carousel", estatico: "static" };

const OBJETIVOS = [
  "viralizacao_descoberta",
  "conscientizacao_educacao",
  "autoridade_confianca",
  "engajamento_relacionamento",
  "conversao_vendas",
] as const;
const ROTULO_OBJETIVO: Record<string, string> = {
  viralizacao_descoberta: "Viralização e descoberta",
  conscientizacao_educacao: "Conscientização e educação",
  autoridade_confianca: "Autoridade e confiança",
  engajamento_relacionamento: "Engajamento e relacionamento",
  conversao_vendas: "Conversão e vendas",
};
const ROTULO_FASE: Record<string, string> = {
  "1": "Fase 1: descoberta, identificação do problema e reconhecimento da marca",
  "2": "Fase 2: educação, diferenciais, funcionamento, localização e quebra de objeções",
  "3": "Fase 3: provas, benefícios, ofertas, conversão, recorrência e indicação",
};

// ------------------------------------------------------------------ tipos

type Tema = {
  id: string;
  tema: string;
  pilar: string;
  fase: string;
  objetivo: string;
  por_que: string;
  formato_sugerido: Formato;
  sazonal: boolean;
  data_sazonal: string | null;
  jev: { aderencia: number | null; potencial: number | null } | null;
  escolhido: boolean;
};

type Card = { ordem: number; funcao: string; texto: string; ilustracao: string; estilo: string };

type Item = {
  tema_id: string;
  data: string;
  formato: Formato;
  pilar: string;
  fase: string;
  publico: string;
  tema: string;
  gancho: string;
  resumo: string;
  copy: string;
  cta: string;
  objetivo: string;
  metrica_principal: string;
  palavra_chave: string;
  termo_regional: string | null;
  status: string;
  tipo_conteudo: "principal" | "extra_sazonal";
  carrossel_infinito: boolean;
  cards: Card[];
  // Preenchido no gravar: a tarefa da agenda deste item (criada ou ja
  // existente). O estudio-arte acha o roteiro dos cards por itens[].task_id.
  task_id?: string | null;
};

type Proposta = {
  id: string;
  client_id: string;
  project_id: string | null;
  periodo_inicio: string;
  periodo_fim: string;
  parametros: Record<string, unknown>;
  status: string;
  diagnostico: string | null;
  temas: Tema[];
  itens: Item[];
  conversa_id: string | null;
  task_ids: string[];
  criado_por: string | null;
  criado_em: string;
  gravada_em: string | null;
};

type Chamador = { userId: string; token: string };

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public extra: Record<string, unknown> = {}) {
    super(mensagem);
  }
}

// ------------------------------------------------------------------ datas

/** Dia da semana de uma data YYYY-MM-DD (0 domingo, 6 sabado), sem fuso. */
function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00.000Z`).getUTCDay();
}

export function ehDiaUtil(data: string): boolean {
  if (!DATA.test(data)) return false;
  const d = diaDaSemana(data);
  return d >= 1 && d <= 5;
}

/** Dias corridos entre duas datas AAAA-MM-DD (fim incluído). */
export function diasEntre(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000) + 1;
}

function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Todos os dias de segunda a sexta do periodo, em ordem. */
export function diasUteisDoPeriodo(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  for (let d = inicio; d <= fim && dias.length < 400; d = somarDias(d, 1)) {
    if (ehDiaUtil(d)) dias.push(d);
  }
  return dias;
}

/**
 * Leva uma data para um dia util dentro do periodo: mantem se ja for; senao o
 * proximo dia util do periodo; sem proximo, o anterior mais perto.
 */
export function normalizarDataUtil(data: string | null | undefined, uteis: string[]): string {
  if (uteis.length === 0) throw new ErroHttp(400, "periodo_sem_dia_util", "O período não tem nenhum dia de segunda a sexta.");
  const d = typeof data === "string" && DATA.test(data) ? data : "";
  if (d && uteis.includes(d)) return d;
  if (!d) return uteis[0];
  const proximo = uteis.find((u) => u >= d);
  return proximo ?? uteis[uteis.length - 1];
}

/**
 * Distribui n publicacoes pelos dias uteis, espalhadas de forma regular.
 * Prefere dias sem item editorial ja existente quando ha dias livres bastantes.
 */
export function distribuirDatas(n: number, uteis: string[], ocupados: Set<string>): string[] {
  if (uteis.length === 0) throw new ErroHttp(400, "periodo_sem_dia_util", "O período não tem nenhum dia de segunda a sexta.");
  const livres = uteis.filter((d) => !ocupados.has(d));
  const base = livres.length >= n ? livres : uteis;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(base[Math.floor((i * base.length) / Math.max(n, 1))]);
  return out;
}

// ------------------------------------------------------------ normalizacao

const texto = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function normalizarFormato(v: unknown, cards: unknown[]): Formato {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("carross") || s.includes("carous")) return "carrossel";
  if (s.includes("estat") || s.includes("static")) return "estatico";
  // Qualquer outro formato (reels, video, story) nunca passa: vira carrossel
  // quando ha mais de um card, senao estatico.
  return cards.length > 1 ? "carrossel" : "estatico";
}

function normalizarObjetivo(v: unknown): string {
  const s = String(v ?? "");
  return (OBJETIVOS as readonly string[]).includes(s) ? s : "conscientizacao_educacao";
}

function normalizarFase(v: unknown): string {
  const s = String(v ?? "").replace(/\D/g, "");
  return s === "1" || s === "2" || s === "3" ? s : "2";
}

function normalizarCards(v: unknown, formato: Formato): Card[] {
  const lista = Array.isArray(v) ? v : [];
  let cards = lista
    .map((c, i) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        ordem: Number.isFinite(Number(o.ordem)) ? Number(o.ordem) : i + 1,
        funcao: texto(o.funcao, 200),
        texto: texto(o.texto, 1200),
        ilustracao: texto(o.ilustracao, 800),
        estilo: texto(o.estilo, 600),
      };
    })
    .filter((c) => c.texto || c.ilustracao)
    .sort((a, b) => a.ordem - b.ordem);
  if (formato === "estatico") cards = cards.slice(0, 1);
  return cards.slice(0, 20).map((c, i) => ({ ...c, ordem: i + 1 }));
}

export function normalizarItem(bruto: unknown, uteis: string[], dataPadrao?: string): Item {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const cardsBrutos = Array.isArray(o.cards) ? o.cards : [];
  const formato = normalizarFormato(o.formato, cardsBrutos);
  const cards = normalizarCards(cardsBrutos, formato);
  const tipo = String(o.tipo_conteudo ?? "") === "extra_sazonal" ? "extra_sazonal" : "principal";
  return {
    tema_id: texto(o.tema_id, 40),
    // Data sempre de segunda a sexta dentro do periodo.
    data: normalizarDataUtil(dataPadrao ?? (o.data as string), uteis),
    formato,
    pilar: texto(o.pilar, 200),
    fase: normalizarFase(o.fase),
    publico: texto(o.publico, 400),
    tema: texto(o.tema, 200),
    gancho: texto(o.gancho, 400),
    resumo: texto(o.resumo, 1200),
    copy: texto(o.copy, 2200),
    cta: texto(o.cta, 300),
    objetivo: normalizarObjetivo(o.objetivo),
    metrica_principal: texto(o.metrica_principal, 200),
    palavra_chave: texto(o.palavra_chave, 120),
    termo_regional: texto(o.termo_regional, 120) || null,
    status: texto(o.status, 60) || "planejado",
    tipo_conteudo: tipo,
    carrossel_infinito: formato === "carrossel" && o.carrossel_infinito === true,
    cards,
  };
}

function normalizarTema(bruto: unknown, id: string, anterior?: Tema): Tema {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const fmt = String(o.formato_sugerido ?? "").toLowerCase().includes("estat") ? "estatico" : "carrossel";
  return {
    id,
    tema: texto(o.tema, 200),
    pilar: texto(o.pilar, 200),
    fase: normalizarFase(o.fase),
    objetivo: normalizarObjetivo(o.objetivo),
    por_que: texto(o.por_que, 1200),
    formato_sugerido: fmt,
    sazonal: o.sazonal === true,
    data_sazonal: typeof o.data_sazonal === "string" && DATA.test(o.data_sazonal) ? o.data_sazonal : null,
    jev: anterior?.jev ?? null,
    escolhido: typeof o.escolhido === "boolean" ? o.escolhido : anterior?.escolhido ?? false,
  };
}

// ------------------------------------------------------------ esquemas JSON
// Saida estrita: todo campo obrigatorio, sem campo extra; opcional vira null.

const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
const obj = (props: Record<string, unknown>) => ({
  type: "object",
  properties: props,
  required: Object.keys(props),
  additionalProperties: false,
});

const ESQUEMA_TEMA = obj({
  id: S("string"),
  tema: S("string"),
  pilar: S("string"),
  fase: S("string", { enum: ["1", "2", "3"] }),
  objetivo: S("string", { enum: [...OBJETIVOS] }),
  por_que: S("string"),
  formato_sugerido: S("string", { enum: [...FORMATOS] }),
  sazonal: S("boolean"),
  data_sazonal: S(["string", "null"]),
});

const ESQUEMA_CARD = obj({
  ordem: S("integer"),
  funcao: S("string"),
  texto: S("string"),
  ilustracao: S("string"),
  estilo: S("string"),
});

const ESQUEMA_ITEM = obj({
  tema_id: S("string"),
  data: S("string"),
  formato: S("string", { enum: [...FORMATOS] }),
  pilar: S("string"),
  fase: S("string", { enum: ["1", "2", "3"] }),
  publico: S("string"),
  tema: S("string"),
  gancho: S("string"),
  resumo: S("string"),
  copy: S("string"),
  cta: S("string"),
  objetivo: S("string", { enum: [...OBJETIVOS] }),
  metrica_principal: S("string"),
  palavra_chave: S("string"),
  termo_regional: S(["string", "null"]),
  status: S("string"),
  tipo_conteudo: S("string", { enum: ["principal", "extra_sazonal"] }),
  carrossel_infinito: S("boolean"),
  cards: { type: "array", items: ESQUEMA_CARD },
});

export const ESQUEMA_TEMAS = {
  nome: "temas_do_periodo",
  schema: obj({
    diagnostico: S("string"),
    publicos_prioritarios: { type: "array", items: S("string") },
    pilares: { type: "array", items: S("string") },
    pesquisa: S("string"),
    hipoteses: { type: "array", items: S("string") },
    temas: { type: "array", items: ESQUEMA_TEMA },
  }),
};

const ESQUEMA_ITENS = {
  nome: "itens_detalhados",
  schema: obj({ itens: { type: "array", items: ESQUEMA_ITEM } }),
};

const ESQUEMA_CONVERSA = {
  nome: "ajuste_da_proposta",
  schema: obj({
    resposta: S("string"),
    diagnostico: S(["string", "null"]),
    temas: { type: ["array", "null"], items: ESQUEMA_TEMA },
    itens: { type: ["array", "null"], items: ESQUEMA_ITEM },
  }),
};

// ------------------------------------------------------------ banco e acesso

function clienteServico(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cliente do banco com o JWT de quem chamou: can_access_client le auth.uid(). */
function clienteDoChamador(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function identificar(req: Request, servico: SupabaseClient): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico.auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico.rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa o estrategista.");
  return { userId, token };
}

/** Equipe com acesso ao cliente, conferido no banco com o JWT de quem chamou. */
async function exigirAcessoAoCliente(chamador: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await clienteDoChamador(chamador.token).rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

async function carregarProposta(servico: SupabaseClient, id: unknown): Promise<Proposta> {
  const pid = String(id ?? "");
  if (!UUID.test(pid)) throw new ErroHttp(400, "proposta_id_invalido", "proposta_id precisa ser um UUID.");
  const { data, error } = await servico.from("calendario_propostas").select("*").eq("id", pid).maybeSingle();
  if (error) throw new ErroHttp(500, "proposta_indisponivel", "Não foi possível ler a proposta.");
  if (!data) throw new ErroHttp(404, "proposta_inexistente", "Proposta não encontrada.");
  const p = data as Proposta;
  p.temas = Array.isArray(p.temas) ? p.temas : [];
  p.itens = Array.isArray(p.itens) ? p.itens : [];
  p.parametros = (p.parametros ?? {}) as Record<string, unknown>;
  p.task_ids = Array.isArray(p.task_ids) ? p.task_ids : [];
  return p;
}

/** Atualiza a proposta sempre presa ao client_id dela. */
async function salvarProposta(servico: SupabaseClient, p: Proposta, campos: Record<string, unknown>): Promise<Proposta> {
  const { data, error } = await servico
    .from("calendario_propostas")
    .update(campos)
    .eq("id", p.id)
    .eq("client_id", p.client_id)
    .select("*")
    .single();
  if (error || !data) throw new ErroHttp(500, "proposta_nao_salva", "Não foi possível salvar a proposta.");
  return data as Proposta;
}

async function garantirConversa(servico: SupabaseClient, p: Proposta, userId: string): Promise<string> {
  if (p.conversa_id) return p.conversa_id;
  const { data, error } = await servico
    .from("agente_conversas")
    .insert({ client_id: p.client_id, agente: AGENTE, referencia_tipo: REF_TIPO, referencia_id: p.id, criado_por: userId })
    .select("id")
    .single();
  if (error || !data) throw new ErroHttp(500, "conversa_nao_criada", "Não foi possível abrir a conversa do agente.");
  await salvarProposta(servico, p, { conversa_id: data.id });
  p.conversa_id = data.id;
  return data.id;
}

async function registrarMensagens(
  servico: SupabaseClient,
  conversaId: string,
  clientId: string,
  msgs: Array<{ papel: "usuario" | "agente" | "sistema"; conteudo: string; uso_id?: string | null; anexos?: unknown[] }>,
) {
  const linhas = msgs
    .filter((m) => m.conteudo.trim())
    .map((m) => ({
      conversa_id: conversaId,
      client_id: clientId,
      papel: m.papel,
      conteudo: m.conteudo.slice(0, 20000),
      anexos: m.anexos ?? [],
      uso_id: m.uso_id ?? null,
    }));
  if (linhas.length === 0) return;
  const { error } = await servico.from("agente_mensagens").insert(linhas);
  if (error) console.error("[agente-calendario] mensagens nao gravadas", { conversa_id: conversaId, code: error.code });
}

// ------------------------------------------------------------ contexto real

type Contexto = {
  cliente: { nome: string; instagram: string | null };
  dossie: string | null;
  movimentos: unknown[];
  metricas: { posts: { melhores_por_alcance: unknown[]; melhores_por_salvamento_e_compartilhamento: unknown[]; piores_por_alcance: unknown[]; total_lidos: number }; semanas: unknown[] };
  agenda_no_periodo: { tarefas: unknown[]; posts: unknown[] };
  titulos_recentes: string[];
  kit_marca: unknown | null;
  memoria: Array<{ tipo: string; texto: string }>;
  datasOcupadas: Set<string>;
  prompt: string;
};

const corta = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : v ?? null);

/**
 * Monta o contexto do estrategista so com dado real do banco. O que nao existe
 * vai como vazio ou null, nunca preenchido.
 */
async function montarContexto(servico: SupabaseClient, clientId: string, inicio: string, fim: string): Promise<Contexto> {
  const hoje = new Date();
  const ha60 = new Date(hoje.getTime() - 60 * 86_400_000).toISOString();
  const ha180 = new Date(hoje.getTime() - 180 * 86_400_000).toISOString();

  const { data: projetos } = await servico
    .from("projects")
    .select("id")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .limit(200);
  const projectIds = (projetos ?? []).map((p: { id: string }) => p.id);

  const [
    perfil,
    conta,
    dossie,
    movimentos,
    posts,
    semanas,
    tarefasPeriodo,
    tarefasRecentes,
    postsEditoriais,
    kit,
    memoria,
    prompts,
  ] = await Promise.all([
    servico.from("profiles").select("full_name, company_name").eq("id", clientId).maybeSingle(),
    servico.from("external_accounts").select("handle, display_name").eq("client_id", clientId).eq("platform", "instagram").eq("status", "active").limit(1),
    // Dossie geral atual: contexto, sem projeto.
    servico.from("client_dossiers").select("content, summary, version, effective_at")
      .eq("client_id", clientId).eq("dossier_type", "contexto").eq("is_current", true).is("project_id", null).maybeSingle(),
    // SECURITY DEFINER com confianca de backend: chamada pelo cliente de servico.
    servico.rpc("movimentos_do_cliente", { _client_id: clientId, _desde: ha60, _ate: hoje.toISOString(), _somente_visiveis: false }),
    servico.from("social_post_metrics")
      .select("media_type, caption, permalink, posted_at, like_count, comments_count, reach, saved, shares, total_interactions")
      .eq("client_id", clientId).gte("posted_at", ha180).order("posted_at", { ascending: false }).limit(300),
    servico.from("social_metrics_weekly")
      .select("week_start, week_end, followers, reach, profile_views, accounts_engaged, total_interactions")
      .eq("client_id", clientId).order("week_start", { ascending: false }).limit(8),
    projectIds.length
      ? servico.from("tasks").select("title, delivery_type, due_date, status")
        .in("project_id", projectIds).not("delivery_type", "is", null).is("deleted_at", null)
        .gte("due_date", inicio).lte("due_date", fim).order("due_date").limit(200)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    projectIds.length
      ? servico.from("tasks").select("title, due_date")
        .in("project_id", projectIds).in("delivery_type", ["carousel", "static", "design"]).is("deleted_at", null)
        .gte("due_date", ha60.slice(0, 10)).lt("due_date", inicio).order("due_date", { ascending: false }).limit(60)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    servico.from("editorial_posts")
      .select("title, content_type, objective, production_status, editorial_publications(scheduled_at, status)")
      .eq("client_id", clientId).is("archived_at", null).order("created_at", { ascending: false }).limit(100),
    servico.from("cliente_kit_marca").select("paleta, estilo, regras, contexto").eq("client_id", clientId).maybeSingle(),
    servico.from("agente_memoria").select("tipo, texto").eq("client_id", clientId).eq("agente", AGENTE).eq("ativa", true)
      .order("criado_em", { ascending: false }).limit(60),
    servico.from("agente_prompts").select("client_id, conteudo, versao").eq("agente", AGENTE).eq("ativo", true)
      .or(`client_id.is.null,client_id.eq.${clientId}`),
  ]);

  // Prompt efetivo: global ativo + complemento ativo do cliente.
  const linhasPrompt = (prompts.data ?? []) as Array<{ client_id: string | null; conteudo: string }>;
  const global = linhasPrompt.find((l) => l.client_id === null)?.conteudo?.trim();
  if (!global) {
    throw new ErroHttp(409, "prompt_global_ausente", "Não há prompt global ativo do estrategista em agente_prompts.");
  }
  const complemento = linhasPrompt.find((l) => l.client_id === clientId)?.conteudo?.trim();
  const prompt = complemento ? `${global}\n\nCOMPLEMENTO DESTE CLIENTE:\n${complemento}` : global;

  // Metricas de post: melhores e piores, so dos posts que tem o numero.
  type Post = { media_type: string | null; caption: string | null; permalink: string | null; posted_at: string | null; like_count: number | null; comments_count: number | null; reach: number | null; saved: number | null; shares: number | null; total_interactions: number | null };
  const lista = ((posts.data ?? []) as Post[]).map((p) => ({ ...p, caption: corta(p.caption, 220) as string | null }));
  const comAlcance = lista.filter((p) => typeof p.reach === "number");
  const porAlcance = [...comAlcance].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
  const comSalvamento = lista.filter((p) => typeof p.saved === "number" || typeof p.shares === "number");
  const porSalvamento = [...comSalvamento].sort((a, b) => ((b.saved ?? 0) + (b.shares ?? 0)) - ((a.saved ?? 0) + (a.shares ?? 0)));

  // Itens editoriais do periodo: tarefas e publicacoes agendadas no periodo.
  type PostEd = { title: string; content_type: string; objective: string | null; production_status: string; editorial_publications: Array<{ scheduled_at: string | null; status: string }> | null };
  const postsNoPeriodo = ((postsEditoriais.data ?? []) as PostEd[])
    .map((p) => ({
      titulo: p.title,
      formato: p.content_type,
      objetivo: p.objective,
      producao: p.production_status,
      publicacoes: (p.editorial_publications ?? []).filter((x) => x.scheduled_at && x.scheduled_at.slice(0, 10) >= inicio && x.scheduled_at.slice(0, 10) <= fim),
    }))
    .filter((p) => p.publicacoes.length > 0);

  const tarefas = (tarefasPeriodo.data ?? []) as Array<{ title: string; delivery_type: string; due_date: string; status: string }>;
  const datasOcupadas = new Set<string>([
    ...tarefas.map((t) => t.due_date).filter(Boolean),
    ...postsNoPeriodo.flatMap((p) => p.publicacoes.map((x) => String(x.scheduled_at).slice(0, 10))),
  ]);

  const perfilDados = perfil.data as { full_name: string | null; company_name: string | null } | null;
  const contaIg = ((conta.data ?? []) as Array<{ handle: string | null; display_name: string }>)[0];
  const dossieDados = dossie.data as { content: string; summary: string | null; version: number; effective_at: string } | null;

  return {
    cliente: {
      nome: perfilDados?.company_name?.trim() || perfilDados?.full_name?.trim() || "Cliente sem nome no cadastro",
      instagram: contaIg?.handle ? `@${contaIg.handle.replace(/^@/, "")}` : null,
    },
    dossie: dossieDados ? `Versão ${dossieDados.version} (${String(dossieDados.effective_at).slice(0, 10)}):\n${dossieDados.content.slice(0, 14000)}` : null,
    movimentos: ((movimentos.data ?? []) as Array<Record<string, unknown>>).slice(0, 150).map((m) => ({
      quando: String(m.quando ?? "").slice(0, 10),
      tipo: m.tipo,
      titulo: corta(m.titulo, 160),
      detalhe: corta(m.detalhe, 200),
    })),
    metricas: {
      posts: {
        melhores_por_alcance: porAlcance.slice(0, 5),
        melhores_por_salvamento_e_compartilhamento: porSalvamento.slice(0, 5),
        piores_por_alcance: porAlcance.slice(-5).reverse(),
        total_lidos: lista.length,
      },
      semanas: semanas.data ?? [],
    },
    agenda_no_periodo: { tarefas, posts: postsNoPeriodo },
    titulos_recentes: ((tarefasRecentes.data ?? []) as Array<{ title: string }>).map((t) => t.title).slice(0, 60),
    kit_marca: kit.data ?? null,
    memoria: (memoria.data ?? []) as Array<{ tipo: string; texto: string }>,
    datasOcupadas,
    prompt,
  };
}

function contextoEmTexto(ctx: Contexto, p: { inicio: string; fim: string; parametros: Record<string, unknown> }): string {
  const dados = {
    cliente: ctx.cliente.nome,
    instagram: ctx.cliente.instagram,
    periodo: { inicio: p.inicio, fim: p.fim },
    frequencia: p.parametros.frequencia ?? null,
    objetivo_principal: p.parametros.objetivo ?? null,
    oferta_principal: p.parametros.oferta ?? null,
    regiao: p.parametros.regiao ?? null,
    dossie_geral_atual: ctx.dossie,
    movimentos_ultimos_60_dias: ctx.movimentos,
    metricas_instagram: ctx.metricas,
    agenda_ja_existente_no_periodo: ctx.agenda_no_periodo,
    titulos_publicados_ou_planejados_nos_ultimos_60_dias: ctx.titulos_recentes,
    kit_de_marca: ctx.kit_marca,
    memoria_do_estrategista: ctx.memoria,
  };
  return `DADOS REAIS DO CLIENTE (JSON, lidos do painel agora; campo vazio ou null significa que o dado não existe no painel):\n${JSON.stringify(dados, null, 1)}`;
}

const REGRAS_DE_SAIDA = `
REGRAS DESTA EXECUÇÃO NO PAINEL:
- Use somente os dados reais recebidos e o que a pesquisa na web trouxer. Nunca invente métrica, resultado, diferencial ou informação local. Dado ausente vira hipótese declarada.
- Formatos permitidos: somente carrossel ou post estático. Nunca reels, vídeo, stories ou live.
- Publicações só de segunda a sexta, dentro do período.
- Evite repetir temas que já estão na agenda do período ou nos títulos recentes.
- Siga a memória do estrategista (preferências, aprendizados e o que evitar).
- Português do Brasil, sem travessões.
- Responda somente com o JSON pedido.`;

// ------------------------------------------------------------ modelo e erros

/**
 * Raciocinio padrao quando o usuario nao escolhe: o mais alto aceito pelo
 * modelo; com pesquisa na web, high (max com pesquisa arrisca estourar os
 * 120 s do motor). A escolha explicita do usuario sempre prevalece.
 */
export function raciocinioPadrao(aceitos: string[], pesquisaWeb: boolean): string | undefined {
  if (pesquisaWeb && aceitos.includes("high")) return "high";
  return aceitos[aceitos.length - 1] || undefined;
}

async function resolverModelo(
  modeloId: unknown,
  raciocinio: unknown,
  opcoes: { pesquisaWeb?: boolean } = {},
): Promise<{ modelo: ModeloIa; raciocinio: string | undefined; raciocinioExplicito: boolean }> {
  let modelo: ModeloIa | null;
  if (typeof modeloId === "string" && modeloId.trim()) modelo = await carregarModelo(modeloId.trim(), "texto");
  else modelo = await modeloPadrao(AGENTE);
  if (!modelo) throw new ErroHttp(409, "sem_modelo_padrao", "Nenhum modelo do catálogo está marcado como padrão do estrategista.");
  const explicito = typeof raciocinio === "string" && raciocinio.trim() ? raciocinio.trim() : null;
  const r = explicito ?? raciocinioPadrao(modelo.raciocinio ?? [], opcoes.pesquisaWeb === true);
  return { modelo, raciocinio: r || undefined, raciocinioExplicito: explicito !== null };
}

// Mensagens claras para os erros de dinheiro e chave. Nunca 200.
const MENSAGEM_ERRO_MOTOR: Record<string, { status: number; mensagem: string }> = {
  saldo_insuficiente: { status: 402, mensagem: "Saldo insuficiente na carteira de IA deste cliente. Peça a recarga a um admin ou manager." },
  cota_da_chave_esgotada: { status: 402, mensagem: "A cota do mês da chave de IA deste cliente acabou. Ajuste a cota ou aguarde o próximo mês." },
  cliente_sem_chave: { status: 403, mensagem: "Este cliente não tem chave de IA própria e o uso da chave da agência está desligado para ele." },
  provedor_sem_chave: { status: 403, mensagem: "O provedor deste modelo está sem chave de API configurada. Escolha outro modelo ou peça a configuração da chave." },
};

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof IaMotorErro) {
    const conhecido = MENSAGEM_ERRO_MOTOR[err.codigo];
    const status = conhecido?.status ?? (err.status >= 400 ? err.status : 500);
    return json({ ...err.paraJson(), mensagem: conhecido?.mensagem ?? err.message }, status);
  }
  if (err instanceof WriteError) {
    const status = err.code === "forbidden" ? 403 : err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 400;
    return json({ error: `agenda_${err.code}`, mensagem: err.message }, status);
  }
  console.error("[agente-calendario] erro inesperado", { nome: err instanceof Error ? err.name : "desconhecido" });
  return json({ error: "erro_interno", mensagem: "Falha inesperada no estrategista." }, 500);
}

// ------------------------------------------------------------ Jev

const NIVEIS_ADERENCIA = [
  "O tema não tem relação com o objetivo principal nem com a oferta do cliente.",
  "O tema toca o nicho do cliente, mas quase não ajuda o objetivo principal.",
  "O tema ajuda o objetivo principal de forma indireta, em algum momento da jornada.",
  "O tema serve claramente ao objetivo principal e conversa com a oferta do cliente.",
  "O tema é um caminho direto e específico para o objetivo principal, feito sob medida para este cliente e esta região.",
];

const NIVEIS_POTENCIAL = [
  "Conteúdo genérico, que ninguém salvaria nem mandaria para alguém.",
  "Pouco útil fora do momento; salvamento e envio só por acaso.",
  "Útil para parte do público; algumas pessoas salvariam ou mandariam para alguém.",
  "Resolve uma dúvida real com informação aplicável; boa chance de ser salvo e enviado.",
  "Referência prática ou identificação forte que o público guarda e manda para outras pessoas de propósito.",
];

/** Normaliza a nota do Score (0 a niveis-1) para 0 a 10 com uma casa. */
const notaDe0a10 = (n: number | null, niveis: number) => (n == null ? null : Math.round((n / (niveis - 1)) * 100) / 10);

/**
 * O Jev pontua cada tema em duas dimensoes, com Score de niveis ordenados.
 * Falha do Jev nao derruba a proposta (os temas ja custaram): nota fica null.
 */
async function pontuarTemasComJev(
  temas: Tema[],
  base: { cliente: string; objetivo: unknown; oferta: unknown; regiao: unknown; diagnostico: string | null },
  cobranca: { clientId: string; propostaId: string; criadoPor: string },
): Promise<{ temas: Tema[]; jev_erro: string | null }> {
  if (temas.length === 0) return { temas, jev_erro: null };
  const state = {
    cliente: base.cliente,
    objetivo_principal: base.objetivo ?? "não informado",
    oferta_principal: base.oferta ?? "não informada",
    regiao: base.regiao ?? "não informada",
    diagnostico: base.diagnostico ?? "",
    temas: temas.map((t) => ({ tema: t.tema, pilar: t.pilar, objetivo_do_post: ROTULO_OBJETIVO[t.objetivo], por_que: t.por_que })),
  };
  const questions: Record<string, PerguntaJev> = {};
  temas.forEach((_, i) => {
    questions[`aderencia_${i}`] = {
      type: "score",
      instructions: `Quanto o tema \`temas[${i}]\` serve ao \`objetivo_principal\` do cliente, considerando a \`oferta_principal\`, a \`regiao\` e o \`diagnostico\`?`,
      criteria: NIVEIS_ADERENCIA,
    };
    questions[`potencial_${i}`] = {
      type: "score",
      instructions: `Como carrossel ou post estático no Instagram, quanto o tema \`temas[${i}]\` tende a ser salvo e compartilhado pelo público deste cliente?`,
      criteria: NIVEIS_POTENCIAL,
    };
  });
  try {
    const r = await jevPerguntar({ state, questions });
    await cobrarJev(r, {
      clientId: cobranca.clientId,
      tarefa: "calendario",
      referencia: { tipo: REF_TIPO, id: cobranca.propostaId },
      criadoPor: cobranca.criadoPor,
    });
    return {
      temas: temas.map((t, i) => ({
        ...t,
        jev: {
          aderencia: notaDe0a10(notaScore(r.answers[`aderencia_${i}`]), NIVEIS_ADERENCIA.length),
          potencial: notaDe0a10(notaScore(r.answers[`potencial_${i}`]), NIVEIS_POTENCIAL.length),
        },
      })),
      jev_erro: null,
    };
  } catch (err) {
    const codigo = err instanceof JevErro ? err.codigo : "jev_falhou";
    console.error("[agente-calendario] jev falhou", { codigo });
    return { temas, jev_erro: codigo };
  }
}

// ------------------------------------------------------------ acoes

async function proporTemas(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const inicio = String(corpo.periodo_inicio ?? "");
  const fim = String(corpo.periodo_fim ?? "");
  if (!DATA.test(inicio) || !DATA.test(fim) || fim < inicio) {
    throw new ErroHttp(400, "periodo_invalido", "Informe periodo_inicio e periodo_fim (AAAA-MM-DD), com o fim depois do início.");
  }
  // Um mês por chamada: período longo com pesquisa na web estoura o tempo do
  // provedor. Para vários meses, a tela chama mês a mês.
  if (diasEntre(inicio, fim) > 31) {
    throw new ErroHttp(400, "periodo_longo", "Planeje até 31 dias por vez. Para vários meses, use Planejar vários meses: o estrategista faz um mês de cada vez.");
  }
  const uteis = diasUteisDoPeriodo(inicio, fim);
  if (uteis.length === 0) throw new ErroHttp(400, "periodo_sem_dia_util", "O período não tem nenhum dia de segunda a sexta.");
  const frequencia = Number(corpo.frequencia);
  if (!Number.isFinite(frequencia) || frequencia < 1 || frequencia > 200) {
    throw new ErroHttp(400, "frequencia_invalida", "Informe a frequência: quantas publicações no período.");
  }
  let projectId: string | null = null;
  if (corpo.project_id != null && corpo.project_id !== "") {
    projectId = String(corpo.project_id);
    await exigirProjetoDoCliente(servico, projectId, clientId);
  }

  // Com pesquisa na web o padrao e high; a escolha explicita prevalece.
  const { modelo, raciocinio, raciocinioExplicito } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, { pesquisaWeb: true });
  const parametros: Record<string, unknown> = {
    frequencia: Math.round(frequencia),
    objetivo: texto(corpo.objetivo, 500) || null,
    oferta: texto(corpo.oferta, 500) || null,
    regiao: texto(corpo.regiao, 500) || null,
    modelo: modelo.id,
    // So a escolha do usuario vira parametro da proposta; o padrao de cada
    // etapa (com ou sem pesquisa) e decidido de novo em cada chamada.
    raciocinio: raciocinioExplicito ? raciocinio : null,
    raciocinio_temas: raciocinio ?? null,
  };

  const ctx = await montarContexto(servico, clientId, inicio, fim);

  // A proposta e a conversa nascem com ids conhecidos antes da chamada, para o
  // uso de IA ja ficar ligado a proposta.
  const propostaId = crypto.randomUUID();
  const { data: conversa, error: erroConversa } = await servico
    .from("agente_conversas")
    .insert({ client_id: clientId, agente: AGENTE, referencia_tipo: REF_TIPO, referencia_id: propostaId, criado_por: chamador.userId })
    .select("id")
    .single();
  if (erroConversa || !conversa) throw new ErroHttp(500, "conversa_nao_criada", "Não foi possível abrir a conversa do agente.");

  const pedido = `Proponha de 8 a 15 temas para o período de ${inicio} a ${fim}, com ${parametros.frequencia} publicações no período.`
    + (parametros.objetivo ? ` Objetivo principal: ${parametros.objetivo}.` : "")
    + (parametros.oferta ? ` Oferta principal: ${parametros.oferta}.` : "")
    + (parametros.regiao ? ` Região: ${parametros.regiao}.` : "");

  const instrucao = `${contextoEmTexto(ctx, { inicio, fim, parametros })}

TAREFA: ${pedido}
Antes, pesquise na web dúvidas, buscas, comportamentos, datas sazonais e oportunidades do nicho e da região deste cliente.
Devolva:
- diagnostico: diagnóstico resumido a partir dos dados reais (melhores e piores conteúdos, o que as métricas mostram, o que falta).
- publicos_prioritarios e pilares.
- pesquisa: o que a pesquisa na web trouxe de útil, com as fontes (links) usadas.
- hipoteses: o que precisou ser suposto por falta de dado.
- temas: de 8 a 15, cada um com id (t1, t2, ...), tema, pilar, fase (1, 2 ou 3), objetivo (um só), por_que (ligado a dado real ou à pesquisa), formato_sugerido (carrossel ou estatico), sazonal e data_sazonal (AAAA-MM-DD ou null).`;

  let saida;
  try {
    saida = await chamarTexto({
      clientId,
      tarefa: "calendario",
      agente: AGENTE,
      modeloId: modelo.id,
      sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
      mensagens: [{ papel: "usuario", conteudo: instrucao }],
      raciocinio,
      pesquisaWeb: true,
      esquemaJson: ESQUEMA_TEMAS,
      referencia: { tipo: REF_TIPO, id: propostaId },
      criadoPor: chamador.userId,
    });
  } catch (err) {
    // Sem proposta, a conversa aberta fica orfa: apaga (so a desta chamada).
    await servico.from("agente_conversas").delete().eq("id", conversa.id).eq("client_id", clientId);
    throw err;
  }

  const r = (saida.json ?? {}) as Record<string, unknown>;
  const temasBrutos = Array.isArray(r.temas) ? r.temas : [];
  let temas = temasBrutos.slice(0, 15).map((t, i) => normalizarTema(t, `t${i + 1}`)).filter((t) => t.tema);
  const diagnostico = [
    texto(r.diagnostico, 6000),
    Array.isArray(r.publicos_prioritarios) && r.publicos_prioritarios.length ? `Públicos prioritários: ${r.publicos_prioritarios.map(String).join("; ")}.` : "",
    Array.isArray(r.pilares) && r.pilares.length ? `Pilares: ${r.pilares.map(String).join("; ")}.` : "",
    texto(r.pesquisa, 4000) ? `Pesquisa: ${texto(r.pesquisa, 4000)}` : "",
    Array.isArray(r.hipoteses) && r.hipoteses.length ? `Hipóteses (dado indisponível): ${r.hipoteses.map(String).join("; ")}.` : "",
  ].filter(Boolean).join("\n\n");

  const jev = await pontuarTemasComJev(temas, {
    cliente: ctx.cliente.nome,
    objetivo: parametros.objetivo,
    oferta: parametros.oferta,
    regiao: parametros.regiao,
    diagnostico,
  }, { clientId, propostaId, criadoPor: chamador.userId });
  temas = jev.temas;
  if (jev.jev_erro) parametros.jev_erro = jev.jev_erro;
  if (temas.length < 8) parametros.aviso = `O modelo devolveu ${temas.length} temas (o pedido era de 8 a 15).`;

  const { data: proposta, error } = await servico
    .from("calendario_propostas")
    .insert({
      id: propostaId,
      client_id: clientId,
      project_id: projectId,
      periodo_inicio: inicio,
      periodo_fim: fim,
      parametros,
      status: "temas",
      diagnostico,
      temas,
      itens: [],
      conversa_id: conversa.id,
      criado_por: chamador.userId,
    })
    .select("*")
    .single();
  if (error || !proposta) throw new ErroHttp(500, "proposta_nao_salva", "Os temas foram gerados, mas a proposta não foi salva.", { uso_id: saida.usoId });

  await registrarMensagens(servico, conversa.id, clientId, [
    { papel: "usuario", conteudo: pedido },
    {
      papel: "agente",
      conteudo: `${diagnostico}\n\nTemas:\n${temas.map((t) => `${t.id}. ${t.tema} (${ROTULO_OBJETIVO[t.objetivo]}, fase ${t.fase})`).join("\n")}`,
      uso_id: saida.usoId,
    },
  ]);

  return json({ proposta, custo_usd: saida.custoUsd, saldo_usd: saida.saldoUsd, jev_erro: jev.jev_erro, reserva_usada: saida.reservaUsada ?? null });
}

async function escolherTemas(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarProposta(servico, corpo.proposta_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  exigirEditavel(p);
  const ids = Array.isArray(corpo.temas) ? corpo.temas.map(String) : [];
  const validos = new Set(p.temas.map((t) => t.id));
  const escolhidos = new Set(ids.filter((id) => validos.has(id)));
  if (escolhidos.size === 0) throw new ErroHttp(400, "nenhum_tema_valido", "Escolha ao menos um tema da proposta.");

  const temas = p.temas.map((t) => ({ ...t, escolhido: escolhidos.has(t.id) }));
  // Itens de temas que deixaram de ser escolhidos saem; os outros ficam.
  const itens = p.itens.filter((i) => escolhidos.has(i.tema_id));
  const faltam = [...escolhidos].filter((id) => !itens.some((i) => i.tema_id === id));
  const status = itens.length > 0 && faltam.length === 0 ? "pronta" : itens.length > 0 ? "detalhando" : "temas";
  const atualizada = await salvarProposta(servico, p, { temas, itens, status });

  const conversaId = await garantirConversa(servico, atualizada, chamador.userId);
  await registrarMensagens(servico, conversaId, p.client_id, [
    { papel: "usuario", conteudo: `Temas escolhidos: ${temas.filter((t) => t.escolhido).map((t) => t.tema).join("; ")}.` },
  ]);
  return json({ proposta: atualizada });
}

async function detalhar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarProposta(servico, corpo.proposta_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  exigirEditavel(p);
  const escolhidos = p.temas.filter((t) => t.escolhido);
  if (escolhidos.length === 0) throw new ErroHttp(409, "sem_tema_escolhido", "Escolha os temas antes de detalhar.");

  const uteis = diasUteisDoPeriodo(p.periodo_inicio, p.periodo_fim);
  const ctx = await montarContexto(servico, p.client_id, p.periodo_inicio, p.periodo_fim);
  const { modelo, raciocinio } = await resolverModelo(
    corpo.modelo_id ?? p.parametros.modelo,
    corpo.raciocinio ?? p.parametros.raciocinio,
  );

  // Datas calculadas no codigo, em ordem de fase: so segunda a sexta.
  const ordenados = [...escolhidos].sort((a, b) => a.fase.localeCompare(b.fase));
  const datas = distribuirDatas(ordenados.length, uteis, ctx.datasOcupadas);
  const dataDoTema = new Map<string, string>();
  ordenados.forEach((t, i) => {
    // Tema sazonal com data util dentro do periodo fica na propria data.
    const d = t.sazonal && t.data_sazonal && uteis.includes(t.data_sazonal) ? t.data_sazonal : datas[i];
    dataDoTema.set(t.id, d);
  });

  const jaFeitos = new Map(p.itens.filter((i) => escolhidos.some((t) => t.id === i.tema_id)).map((i) => [i.tema_id, i]));
  const pendentes = ordenados.filter((t) => !jaFeitos.has(t.id));

  await salvarProposta(servico, p, { status: "detalhando" });

  const lotes: Tema[][] = [];
  for (let i = 0; i < pendentes.length; i += TEMAS_POR_LOTE) lotes.push(pendentes.slice(i, i + TEMAS_POR_LOTE));

  const base = `${contextoEmTexto(ctx, { inicio: p.periodo_inicio, fim: p.periodo_fim, parametros: p.parametros })}

DIAGNÓSTICO JÁ FEITO:
${p.diagnostico ?? ""}

TODOS OS TEMAS ESCOLHIDOS (para não repetir estrutura nem gancho entre eles):
${ordenados.map((t) => `${t.id}. ${t.tema} (fase ${t.fase}, ${ROTULO_OBJETIVO[t.objetivo]})`).join("\n")}

TEMAS DESCARTADOS PELA EQUIPE (não usar):
${p.temas.filter((t) => !t.escolhido).map((t) => `- ${t.tema}`).join("\n") || "- nenhum"}`;

  const usos: string[] = [];
  let custo = 0;
  let saldo: number | null = null;

  const rodarLote = async (lote: Tema[]) => {
    const pedido = `${base}

TAREFA: detalhe uma publicação para cada tema abaixo, com todos os campos do calendário.
${lote.map((t) => `- tema_id ${t.id}: "${t.tema}" | pilar ${t.pilar} | fase ${t.fase} | objetivo ${t.objetivo} | formato sugerido ${t.formato_sugerido} | data ${dataDoTema.get(t.id)} | por que: ${t.por_que}`).join("\n")}
Regras dos itens:
- formato: carrossel ou estatico. Estático tem exatamente 1 card.
- cards: roteiro de cada card em ordem (ordem, funcao como capa, desenvolvimento ou CTA final, texto exato do card, ilustracao que acompanha, estilo visual respeitando o kit de marca). A história é uma só: a capa abre uma tensão (gancho escuro e forte), cada card avança um passo e prepara o próximo com texto corrido e conectivos, nunca frases soltas; o CTA fecha a história. As ilustracoes formam UMA série: a mesma protagonista, o mesmo cenário e a mesma luz do começo ao fim (descreva a protagonista igual em todos os cards), variando só a pose, o gesto e o enquadramento (nunca a mesma pose em dois cards seguidos); prefira foto real do cliente quando o contexto tiver. Quantidade de cards pelo conteúdo: o mínimo que conta a história, em geral 4 a 6; 7 ou mais só quando o conteúdo pede. Nunca escreva o nome da marca no texto dos cards. Não repita tema, gancho nem imagem de posts recentes.
- carrossel_infinito: true quando o carrossel for uma cena panorâmica contínua (o fundo atravessa os cards e o último se liga ao primeiro) e isso fizer sentido para o tema.
- copy: a legenda completa do post.
- data: use exatamente a data indicada para o tema.
- tipo_conteudo: extra_sazonal só para conteúdo de data sazonal marcado como extra; senão principal.
- status: planejado.`;
    const s = await chamarTexto({
      clientId: p.client_id,
      tarefa: "calendario",
      agente: AGENTE,
      modeloId: modelo.id,
      sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
      mensagens: [{ papel: "usuario", conteudo: pedido }],
      raciocinio,
      esquemaJson: ESQUEMA_ITENS,
      referencia: { tipo: REF_TIPO, id: p.id },
      criadoPor: chamador.userId,
    });
    usos.push(s.usoId);
    custo += s.custoUsd;
    saldo = s.saldoUsd;
    const brutos = Array.isArray((s.json as Record<string, unknown>)?.itens) ? (s.json as { itens: unknown[] }).itens : [];
    const novos: Item[] = [];
    for (const t of lote) {
      const bruto = brutos.find((b) => String((b as Record<string, unknown>)?.tema_id ?? "") === t.id) ?? brutos[lote.indexOf(t)];
      if (!bruto) continue;
      const item = normalizarItem(bruto, uteis, dataDoTema.get(t.id));
      item.tema_id = t.id;
      if (!item.tema) item.tema = t.tema;
      novos.push(item);
    }
    return novos;
  };

  // Pool simples: ate LOTES_EM_PARALELO chamadas ao mesmo tempo.
  const resultados: PromiseSettledResult<Item[]>[] = new Array(lotes.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < lotes.length) {
      const i = proximo++;
      try {
        resultados[i] = { status: "fulfilled", value: await rodarLote(lotes[i]) };
      } catch (reason) {
        resultados[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOTES_EM_PARALELO, lotes.length) }, trabalhador));

  const novos = resultados.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const falha = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;

  const itens = [...jaFeitos.values(), ...novos]
    .map((i) => ({ ...i, data: normalizarDataUtil(i.data, uteis) }))
    .sort((a, b) => a.data.localeCompare(b.data));
  const faltam = ordenados.filter((t) => !itens.some((i) => i.tema_id === t.id)).map((t) => t.id);
  const status = faltam.length === 0 ? "pronta" : "detalhando";
  const atualizada = await salvarProposta(servico, p, { itens, status });

  const conversaId = await garantirConversa(servico, atualizada, chamador.userId);
  await registrarMensagens(servico, conversaId, p.client_id, [
    {
      papel: "agente",
      conteudo: `Detalhei ${novos.length} publicação(ões).${faltam.length ? ` Faltam: ${faltam.join(", ")}.` : " Proposta pronta para revisar e gravar."}`,
      uso_id: usos[0] ?? null,
      anexos: usos.slice(1).map((id) => ({ uso_id: id })),
    },
  ]);

  if (falha) {
    // Parte ficou salva; a proxima chamada so refaz o que falta. Nunca 200.
    const resposta = respostaDeErro(falha.reason);
    const corpoErro = await resposta.json();
    return json({ ...corpoErro, proposta: atualizada, faltam, custo_usd: custo, saldo_usd: saldo }, resposta.status);
  }
  return json({ proposta: atualizada, faltam, custo_usd: custo, saldo_usd: saldo });
}

async function conversar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarProposta(servico, corpo.proposta_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  exigirEditavel(p);
  const mensagem = texto(corpo.mensagem, 4000);
  if (!mensagem) throw new ErroHttp(400, "mensagem_vazia", "Escreva o ajuste que você quer na proposta.");

  const uteis = diasUteisDoPeriodo(p.periodo_inicio, p.periodo_fim);
  const ctx = await montarContexto(servico, p.client_id, p.periodo_inicio, p.periodo_fim);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id ?? p.parametros.modelo, corpo.raciocinio ?? p.parametros.raciocinio);
  const conversaId = await garantirConversa(servico, p, chamador.userId);

  const { data: historico } = await servico
    .from("agente_mensagens")
    .select("papel, conteudo")
    .eq("conversa_id", conversaId)
    .eq("client_id", p.client_id)
    .order("criado_em", { ascending: false })
    .limit(20);
  const anteriores = ((historico ?? []) as Array<{ papel: string; conteudo: string }>)
    .reverse()
    .filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => ({ papel: m.papel as "usuario" | "agente", conteudo: m.conteudo.slice(0, 4000) }));

  const pedido = `${contextoEmTexto(ctx, { inicio: p.periodo_inicio, fim: p.periodo_fim, parametros: p.parametros })}

PROPOSTA ATUAL (JSON):
${JSON.stringify({ status: p.status, diagnostico: p.diagnostico, temas: p.temas, itens: p.itens })}

PEDIDO DA EQUIPE: ${mensagem}

Aplique o pedido na proposta. Devolva:
- resposta: o que você mudou, em poucas linhas.
- diagnostico: o novo texto só se ele mudou; senão null.
- temas: a lista COMPLETA de temas atualizada só se algum tema mudou (mantenha os ids; tema novo recebe id novo); senão null.
- itens: a lista COMPLETA de itens atualizada só se algum item mudou; senão null.
Datas só de segunda a sexta entre ${p.periodo_inicio} e ${p.periodo_fim}. Formato só carrossel ou estatico.`;

  const saida = await chamarTexto({
    clientId: p.client_id,
    tarefa: "conversa",
    agente: AGENTE,
    modeloId: modelo.id,
    sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
    mensagens: [...anteriores, { papel: "usuario", conteudo: pedido }],
    raciocinio,
    esquemaJson: ESQUEMA_CONVERSA,
    referencia: { tipo: REF_TIPO, id: p.id },
    criadoPor: chamador.userId,
  });

  const r = (saida.json ?? {}) as Record<string, unknown>;
  const campos: Record<string, unknown> = {};
  const ajustes: string[] = [];

  if (typeof r.diagnostico === "string" && r.diagnostico.trim()) campos.diagnostico = r.diagnostico.trim().slice(0, 12000);

  if (Array.isArray(r.temas)) {
    const porId = new Map(p.temas.map((t) => [t.id, t]));
    const usados = new Set<string>();
    let seq = p.temas.length;
    let temas = r.temas.slice(0, 30).map((bruto) => {
      let id = texto((bruto as Record<string, unknown>)?.id, 40);
      if (!id || usados.has(id)) id = `t${++seq}`;
      usados.add(id);
      return normalizarTema(bruto, id, porId.get(id));
    }).filter((t) => t.tema);
    // Tema novo ou com texto mudado ganha nota nova do Jev.
    const mudados = temas.filter((t) => porId.get(t.id)?.tema !== t.tema);
    if (mudados.length) {
      const j = await pontuarTemasComJev(mudados, {
        cliente: ctx.cliente.nome,
        objetivo: p.parametros.objetivo,
        oferta: p.parametros.oferta,
        regiao: p.parametros.regiao,
        diagnostico: (campos.diagnostico as string) ?? p.diagnostico,
      }, { clientId: p.client_id, propostaId: p.id, criadoPor: chamador.userId });
      const notas = new Map(j.temas.map((t) => [t.id, t.jev]));
      temas = temas.map((t) => (notas.has(t.id) ? { ...t, jev: notas.get(t.id) ?? null } : t));
    }
    campos.temas = temas;
  }

  if (Array.isArray(r.itens)) {
    // Item ja gravado em tentativa parcial mantem o task_id pelo tema.
    const tarefaDoTema = new Map(p.itens.filter((i) => i.task_id).map((i) => [i.tema_id, i.task_id]));
    const itens = r.itens.slice(0, 200).map((bruto) => {
      const original = String((bruto as Record<string, unknown>)?.data ?? "");
      const item = normalizarItem(bruto, uteis);
      if (tarefaDoTema.has(item.tema_id)) item.task_id = tarefaDoTema.get(item.tema_id) ?? null;
      if (original && original !== item.data) ajustes.push(`"${item.tema}" foi de ${original} para ${item.data} (só segunda a sexta dentro do período).`);
      return item;
    }).filter((i) => i.tema);
    campos.itens = itens.sort((a, b) => a.data.localeCompare(b.data));
  }

  const atualizada = Object.keys(campos).length ? await salvarProposta(servico, p, campos) : p;
  const resposta = [texto(r.resposta, 4000) || "Ajuste aplicado.", ...ajustes].join("\n");
  await registrarMensagens(servico, conversaId, p.client_id, [
    { papel: "usuario", conteudo: mensagem },
    { papel: "agente", conteudo: resposta, uso_id: saida.usoId },
  ]);
  return json({ proposta: atualizada, resposta, custo_usd: saida.custoUsd, saldo_usd: saida.saldoUsd, reserva_usada: saida.reservaUsada ?? null });
}

// ------------------------------------------------------------ gravar

async function exigirProjetoDoCliente(servico: SupabaseClient, projectId: string, clientId: string) {
  if (!UUID.test(projectId)) throw new ErroHttp(400, "project_id_invalido", "project_id precisa ser um UUID.");
  const { data, error } = await servico.from("projects").select("id, client_id, deleted_at").eq("id", projectId).maybeSingle();
  if (error) throw new ErroHttp(500, "projeto_indisponivel", "Não foi possível ler o projeto.");
  if (!data || data.deleted_at || data.client_id !== clientId) {
    throw new ErroHttp(404, "projeto_de_outro_cliente", "O projeto não existe ou não é deste cliente.");
  }
}

function exigirEditavel(p: Proposta) {
  if (p.status === "gravada") throw new ErroHttp(409, "proposta_gravada", "Esta proposta já foi gravada na agenda. Crie uma nova proposta para mudar o período.");
  if (p.status === "descartada") throw new ErroHttp(409, "proposta_descartada", "Esta proposta foi descartada.");
}

/** Descricao legivel do item, com todo o conteudo estruturado, cabendo no limite. */
export function descricaoDoItem(item: Item, propostaId: string, indice: number): string {
  const linhas: string[] = [
    `Tema: ${item.tema}`,
    `Formato: ${item.formato === "carrossel" ? `Carrossel${item.carrossel_infinito ? " (carrossel infinito)" : ""}` : "Post estático"}`,
    `Tipo: ${item.tipo_conteudo === "extra_sazonal" ? "extra sazonal" : "conteúdo principal"}`,
    `${ROTULO_FASE[item.fase] ?? `Fase ${item.fase}`}`,
    `Pilar: ${item.pilar}`,
    `Público: ${item.publico}`,
    `Objetivo: ${ROTULO_OBJETIVO[item.objetivo] ?? item.objetivo}`,
    `Métrica principal: ${item.metrica_principal}`,
    `Palavra-chave: ${item.palavra_chave}`,
  ];
  if (item.termo_regional) linhas.push(`Termo regional: ${item.termo_regional}`);
  linhas.push("", `Gancho: ${item.gancho}`, "", `Resumo: ${item.resumo}`, "", "Roteiro dos cards:");
  for (const c of item.cards) {
    linhas.push(`Card ${c.ordem}${c.funcao ? ` (${c.funcao})` : ""}: ${c.texto}`);
    if (c.ilustracao) linhas.push(`  Ilustração: ${c.ilustracao}`);
    if (c.estilo) linhas.push(`  Estilo: ${c.estilo}`);
  }
  linhas.push("", `CTA: ${item.cta}`, "", `Legenda (copy):\n${item.copy}`, "", `Origem: Mesa do cliente, proposta ${propostaId}, item ${indice + 1}.`);
  const completo = linhas.join("\n").trim();
  if (completo.length <= LIMITE_DESCRICAO) return completo;
  // Sem espaco: a origem fica no fim e o meio e cortado com aviso.
  const origem = `\n\n[Texto cortado para caber na agenda. Completo na proposta ${propostaId}, item ${indice + 1}.]`;
  return completo.slice(0, LIMITE_DESCRICAO - origem.length).trimEnd() + origem;
}

const tituloNormal = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Copia o task_id do resultado do gravar para cada item, pelo indice. Mantem
 * o task_id que o item ja tinha quando esta tentativa nao achou nada.
 */
export function itensComTaskId(itens: Item[], resultado: Array<{ indice: number; task_id: string | null }>): Item[] {
  const porIndice = new Map(resultado.map((r) => [r.indice, r.task_id]));
  return itens.map((item, i) => ({ ...item, task_id: porIndice.get(i) ?? item.task_id ?? null }));
}

async function gravar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarProposta(servico, corpo.proposta_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  if (p.status === "descartada") throw new ErroHttp(409, "proposta_descartada", "Esta proposta foi descartada.");
  if (p.status !== "pronta" && p.status !== "gravada") {
    throw new ErroHttp(409, "proposta_nao_pronta", "Detalhe todos os temas escolhidos antes de gravar na agenda.");
  }
  const projectId = String(corpo.project_id ?? p.project_id ?? "");
  await exigirProjetoDoCliente(servico, projectId, p.client_id);
  if (p.itens.length === 0) throw new ErroHttp(409, "proposta_sem_itens", "A proposta não tem itens para gravar.");

  const uteis = diasUteisDoPeriodo(p.periodo_inicio, p.periodo_fim);

  // Itens que ja existem na agenda do cliente (mesmo titulo na mesma data) nao
  // sao recriados: preserva o que existe.
  const { data: projetos } = await servico.from("projects").select("id").eq("client_id", p.client_id).is("deleted_at", null).limit(200);
  const projectIds = (projetos ?? []).map((x: { id: string }) => x.id);
  const { data: existentes } = projectIds.length
    ? await servico.from("tasks").select("id, title, due_date")
      .in("project_id", projectIds).is("deleted_at", null)
      .gte("due_date", p.periodo_inicio).lte("due_date", p.periodo_fim).limit(1000)
    : { data: [] as Array<{ id: string; title: string; due_date: string }> };
  const jaNaAgenda = (existentes ?? []) as Array<{ id: string; title: string; due_date: string }>;

  // Contexto de escrita do MCP (WriteCtx): principal fixo do backend, escopo
  // so deste cliente (o acesso de quem chamou ja foi conferido no banco).
  const dataScope = {
    unrestricted: false,
    clientIds: [p.client_id],
    principalUserId: chamador.userId,
    // Sessao Supabase Auth, o mesmo tipo de identidade do caminho OAuth do MCP.
    source: "oauth" as const,
  };

  const taskIds: string[] = [];
  const resultado: Array<{ indice: number; tema: string; data: string; task_id: string | null; situacao: string; erro?: string }> = [];

  for (let i = 0; i < p.itens.length; i++) {
    const item = p.itens[i];
    const data = normalizarDataUtil(item.data, uteis);
    const titulo = (item.tema || `Publicação ${i + 1}`).slice(0, 200);
    const idempotencyKey = `mesa-cal:${p.id}:${i}`;
    const idPrevisto = await deterministicEditorialTaskId(PRINCIPAL_MESA, idempotencyKey);

    const duplicado = jaNaAgenda.find((t) => t.id !== idPrevisto && t.due_date === data && tituloNormal(t.title) === tituloNormal(titulo));
    if (duplicado) {
      resultado.push({ indice: i, tema: titulo, data, task_id: duplicado.id, situacao: "ja_existia" });
      continue;
    }

    const correlationId = crypto.randomUUID();
    const resultRefHolder: { value?: string } = {};
    const ctx: WriteCtx = { keyId: PRINCIPAL_MESA, origin: "mesa:agente-calendario", correlationId, dataScope, resultRefHolder };
    const entrada = {
      client_id: p.client_id,
      project_id: projectId,
      title: titulo,
      description: descricaoDoItem({ ...item, data }, p.id, i),
      format: FORMATO_PARA_ENTREGA[item.formato === "estatico" ? "estatico" : "carrossel"],
      due_date: data,
      priority: "medium" as const,
      idempotency_key: idempotencyKey,
    };
    const inicio = Date.now();
    try {
      const parsed = createEditorialItemSchema.parse(entrada);
      const r = await createEditorialItem(parsed, ctx);
      const id = String((r.record as Record<string, unknown>).id);
      taskIds.push(id);
      resultado.push({ indice: i, tema: titulo, data, task_id: id, situacao: r.replayed ? "ja_gravado" : "criado" });
      await auditLog({
        correlationId, toolName: "aceleriq_create_editorial_item", origin: "mesa:agente-calendario",
        keyId: `${PRINCIPAL_MESA}:${chamador.userId}`, scopes: ["editorial:write"],
        input: { ...entrada, description: "[item da proposta]", proposta_id: p.id, pedido_por: chamador.userId },
        success: true, statusCode: 200, durationMs: Date.now() - inicio, resultRef: id,
      });
    } catch (err) {
      const conflito = err instanceof WriteError && err.code === "conflict";
      const msg = err instanceof Error ? err.message : String(err);
      if (conflito) {
        // O item ja foi gravado antes e mudou depois na conversa: preserva o
        // que esta na agenda e aponta a tarefa existente.
        taskIds.push(idPrevisto);
        resultado.push({ indice: i, tema: titulo, data, task_id: idPrevisto, situacao: "ja_gravado_com_outro_conteudo" });
      } else {
        resultado.push({ indice: i, tema: titulo, data, task_id: null, situacao: "erro", erro: msg.slice(0, 300) });
      }
      await auditLog({
        correlationId, toolName: "aceleriq_create_editorial_item", origin: "mesa:agente-calendario",
        keyId: `${PRINCIPAL_MESA}:${chamador.userId}`, scopes: ["editorial:write"],
        input: { ...entrada, description: "[item da proposta]", proposta_id: p.id, pedido_por: chamador.userId },
        success: false, statusCode: conflito ? 409 : 500, durationMs: Date.now() - inicio,
        errorCode: conflito ? "conflict" : "handler_error", errorMessage: msg,
      });
    }
  }

  const erros = resultado.filter((r) => r.situacao === "erro");
  // Pulados por ja existirem tambem entram: o estudio usa a tarefa existente.
  const todos = [...new Set([...p.task_ids, ...taskIds, ...resultado.map((r) => r.task_id).filter((id): id is string => !!id)])];
  // task_id dentro de cada item: criado, ja gravado ou ja existente; null so
  // quando nada foi criado nem encontrado. O estudio acha o roteiro por aqui.
  const itensComTarefa = itensComTaskId(p.itens, resultado);

  if (erros.length > 0) {
    // Parcial: guarda o que entrou e continua pronta para nova tentativa
    // (idempotente). Nunca 200.
    const atualizada = await salvarProposta(servico, p, { task_ids: todos, itens: itensComTarefa, project_id: projectId });
    return json({
      error: "gravacao_parcial",
      mensagem: `${erros.length} de ${p.itens.length} itens não entraram na agenda. Tente gravar de novo; o que já entrou não duplica.`,
      proposta: atualizada,
      itens: resultado,
    }, erros.length === p.itens.length ? 500 : 409);
  }

  const atualizada = await salvarProposta(servico, p, {
    task_ids: todos,
    itens: itensComTarefa,
    project_id: projectId,
    status: "gravada",
    gravada_em: p.gravada_em ?? new Date().toISOString(),
  });

  await registrarMemoriaDaEscolha(servico, p);
  // Cada item com roteiro já chega dirigido no Estúdio (sem custo de IA).
  const direcoes = await criarDirecoesDoRoteiro(servico, p.client_id, itensComTarefa, chamador.userId);

  const conversaId = await garantirConversa(servico, atualizada, chamador.userId);
  const criados = resultado.filter((r) => r.situacao === "criado").length;
  await registrarMensagens(servico, conversaId, p.client_id, [
    { papel: "sistema", conteudo: `Gravado na agenda: ${criados} criado(s), ${resultado.length - criados} já existia(m). ${direcoes} com direção de arte pronta no Estúdio.` },
  ]);

  return json({ proposta: atualizada, itens: resultado, direcoes_prontas: direcoes });
}

/** Memoria do estrategista: o que a equipe escolheu e o que descartou. Uma vez por proposta. */
async function registrarMemoriaDaEscolha(servico: SupabaseClient, p: Proposta) {
  const { data: ja } = await servico
    .from("agente_memoria")
    .select("id")
    .eq("client_id", p.client_id)
    .eq("agente", AGENTE)
    .eq("referencia_id", p.id)
    .limit(1);
  if ((ja ?? []).length > 0) return;
  const periodo = `${p.periodo_inicio} a ${p.periodo_fim}`;
  const escolhidos = p.temas.filter((t) => t.escolhido).map((t) => `${t.tema} (${ROTULO_OBJETIVO[t.objetivo] ?? t.objetivo})`);
  const descartados = p.temas.filter((t) => !t.escolhido).map((t) => t.tema);
  const linhas: Array<Record<string, unknown>> = [];
  if (escolhidos.length) {
    linhas.push({
      client_id: p.client_id, agente: AGENTE, tipo: "preferencia", origem: "aprovacao", referencia_id: p.id,
      texto: `Temas escolhidos pela equipe para ${periodo}: ${escolhidos.join("; ")}.`.slice(0, 4000),
    });
  }
  if (descartados.length) {
    linhas.push({
      client_id: p.client_id, agente: AGENTE, tipo: "aprendizado", origem: "aprovacao", referencia_id: p.id,
      texto: `Temas propostos e descartados pela equipe para ${periodo}: ${descartados.join("; ")}.`.slice(0, 4000),
    });
  }
  if (linhas.length === 0) return;
  const { error } = await servico.from("agente_memoria").insert(linhas);
  if (error) console.error("[agente-calendario] memoria nao gravada", { proposta_id: p.id, code: error.code });
}

// ------------------------------------------------------------ porta

// ------------------------------------------------ direção pronta no estúdio

const FORMATOS_COM_ARTE = new Set(["carousel", "static", "design"]);

/**
 * Cada item gravado com roteiro de cards vira um trabalho do estúdio já
 * dirigido (status dirigido), montado em código a partir do roteiro, sem
 * custo de IA. Quando a equipe abre o item no Estúdio, é só gerar.
 * Item que já tem trabalho não ganha outro.
 */
async function criarDirecoesDoRoteiro(
  servico: SupabaseClient,
  clientId: string,
  itens: Item[],
  userId: string,
): Promise<number> {
  const comTarefa = itens.filter((i) => i.task_id && Array.isArray(i.cards) && i.cards.length);
  if (!comTarefa.length) return 0;
  const ids = comTarefa.map((i) => i.task_id!) as string[];
  const [{ data: existentes }, { data: tarefas }, marca, modeloImagem] = await Promise.all([
    servico.from("estudio_trabalhos").select("task_id").eq("client_id", clientId).in("task_id", ids),
    servico.from("tasks").select("id, delivery_type, deleted_at").in("id", ids),
    lerMarcaParaDirecao(servico, clientId),
    modeloPadrao("imagem"),
  ]);
  if (!modeloImagem) return 0;
  const jaTem = new Set(((existentes as { task_id: string }[] | null) ?? []).map((e) => e.task_id));
  const formato = new Map(((tarefas as { id: string; delivery_type: string; deleted_at: string | null }[] | null) ?? [])
    .filter((t) => !t.deleted_at)
    .map((t) => [t.id, t.delivery_type]));
  const linhas: Record<string, unknown>[] = [];
  for (const item of comTarefa) {
    const tipo = formato.get(item.task_id!);
    if (!tipo || !FORMATOS_COM_ARTE.has(tipo) || jaTem.has(item.task_id!)) continue;
    const direcao = direcaoDoRoteiro(item.cards, marca, {
      postUnico: tipo !== "carousel",
      carrosselInfinito: !!item.carrossel_infinito,
      conceito: `${item.tema}. ${item.resumo}`.slice(0, 600),
      levaLogo: (ordem, total) => ordem === 1 || ordem === total,
    });
    if (!direcao.cards.length) continue;
    linhas.push({
      client_id: clientId,
      task_id: item.task_id,
      status: "dirigido",
      direcao,
      modelo_imagem_id: modeloImagem.id,
      qualidade: "media",
      cards: [],
      custo_usd: 0,
      criado_por: userId,
    });
  }
  if (!linhas.length) return 0;
  const { error } = await servico.from("estudio_trabalhos").insert(linhas);
  if (error) {
    console.error("agente-calendario: direcoes nao criadas", { client_id: clientId, erro: error.message });
    return 0;
  }
  return linhas.length;
}

// ---------------------------------------------- completar itens da agenda

const MAX_ITENS_COMPLETAR = 12;

/**
 * completar_itens { client_id, task_ids }: itens que já estão na Agenda (vindos
 * de qualquer lugar) ganham o roteiro completo do estrategista (gancho, copy e
 * cada card) e a direção pronta no Estúdio. O roteiro fica numa proposta
 * gravada com esses task_ids, que é onde o estúdio procura.
 */
async function completarItens(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  if (!UUID.test(clientId)) throw new ErroHttp(400, "cliente_invalido", "Cliente inválido.");
  await exigirAcessoAoCliente(chamador, clientId);
  const pedidos = (Array.isArray(corpo.task_ids) ? corpo.task_ids : []).map(String).filter((id) => UUID.test(id));
  if (!pedidos.length) throw new ErroHttp(400, "sem_itens", "Escolha os itens da agenda que o agente deve completar.");
  if (pedidos.length > MAX_ITENS_COMPLETAR) throw new ErroHttp(400, "itens_demais", `Complete até ${MAX_ITENS_COMPLETAR} itens por vez.`);

  const { data: tarefasBrutas } = await servico
    .from("tasks")
    .select("id, title, description, delivery_type, due_date, deleted_at, project_id")
    .in("id", pedidos);
  const tarefas = ((tarefasBrutas as { id: string; title: string; description: string | null; delivery_type: string; due_date: string | null; deleted_at: string | null; project_id: string }[] | null) ?? [])
    .filter((t) => !t.deleted_at && FORMATOS_COM_ARTE.has(t.delivery_type));
  if (!tarefas.length) throw new ErroHttp(409, "sem_itens_de_arte", "Nenhum dos itens escolhidos é carrossel ou post estático.");
  const { data: projetos } = await servico.from("projects").select("id, client_id").in("id", [...new Set(tarefas.map((t) => t.project_id))]);
  const doCliente = new Set(((projetos as { id: string; client_id: string }[] | null) ?? []).filter((p) => p.client_id === clientId).map((p) => p.id));
  const validas = tarefas.filter((t) => doCliente.has(t.project_id));
  if (!validas.length) throw new ErroHttp(403, "itens_de_outro_cliente", "Os itens escolhidos não são deste cliente.");

  const datas = validas.map((t) => t.due_date).filter((d): d is string => !!d && DATA.test(d)).sort();
  const inicio = datas[0] ?? new Date().toISOString().slice(0, 10);
  const fim = datas[datas.length - 1] ?? inicio;
  const uteis = diasUteisDoPeriodo(inicio, fim);
  const ctx = await montarContexto(servico, clientId, inicio, fim);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio ?? "medium");

  const pedido = `${contextoEmTexto(ctx, { inicio, fim, parametros: {} })}

TAREFA: estes itens JÁ ESTÃO na agenda do cliente. Complete cada um com todos os campos do calendário, mantendo o tema, a data e o formato de cada item (não troque o assunto). O roteiro de cada card precisa estar pronto para o diretor de arte: texto exato de cada card (curto, com hierarquia clara), ilustração concreta e estilo visual no sistema da marca.
${validas.map((t, i) => `- tema_id i${i}: "${t.title}" | formato ${t.delivery_type === "carousel" ? "carrossel" : "estatico"} | data ${t.due_date ?? inicio} | o que já existe: ${(t.description ?? "").replace(/\s+/g, " ").slice(0, 900) || "só o título"}`).join("\n")}
Regras dos itens:
- formato: carrossel ou estatico, igual ao do item. Estático tem exatamente 1 card.
- cards: roteiro de cada card em ordem (ordem, funcao como capa, desenvolvimento ou CTA final, texto exato do card, ilustracao, estilo). A história é uma só: a capa abre uma tensão (gancho escuro e forte), cada card avança um passo e prepara o próximo com texto corrido e conectivos, nunca frases soltas; o CTA fecha a história. As ilustracoes formam UMA série: a mesma protagonista, o mesmo cenário e a mesma luz do começo ao fim (descreva a protagonista igual em todos os cards), variando só a pose, o gesto e o enquadramento (nunca a mesma pose em dois cards seguidos); prefira foto real do cliente quando o contexto tiver. Quantidade de cards pelo conteúdo: o mínimo que conta a história, em geral 4 a 6; 7 ou mais só quando o conteúdo pede. Nunca escreva o nome da marca no texto dos cards. Não repita tema, gancho nem imagem de posts recentes.
- carrossel_infinito: true quando o carrossel for uma cena panorâmica contínua (o fundo atravessa os cards e o último se liga ao primeiro) e isso fizer sentido.
- copy: a legenda completa do post.
- data: exatamente a data do item.
- tipo_conteudo: principal.
- status: planejado.`;

  const s = await chamarTexto({
    clientId,
    tarefa: "calendario",
    agente: AGENTE,
    modeloId: modelo.id,
    sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
    mensagens: [{ papel: "usuario", conteudo: pedido }],
    raciocinio,
    esquemaJson: ESQUEMA_ITENS,
    criadoPor: chamador.userId,
  });
  const brutos = Array.isArray((s.json as Record<string, unknown>)?.itens) ? (s.json as { itens: unknown[] }).itens : [];
  const itens: Item[] = [];
  validas.forEach((t, i) => {
    const bruto = brutos.find((b) => String((b as Record<string, unknown>)?.tema_id ?? "") === `i${i}`) ?? brutos[i];
    if (!bruto) return;
    const item = normalizarItem(bruto, uteis.length ? uteis : [inicio], t.due_date ?? inicio);
    item.tema_id = `i${i}`;
    item.task_id = t.id;
    item.data = t.due_date ?? item.data;
    item.formato = t.delivery_type === "carousel" ? "carrossel" : "estatico";
    if (!item.tema) item.tema = t.title;
    itens.push(item);
  });
  if (!itens.length) {
    throw new ErroHttp(502, "itens_vazios", "O estrategista não devolveu os itens. Tente de novo.", { uso_id: s.usoId });
  }

  const { data: proposta, error } = await servico
    .from("calendario_propostas")
    .insert({
      client_id: clientId,
      project_id: validas[0].project_id,
      periodo_inicio: inicio,
      periodo_fim: fim,
      parametros: { origem: "completar_itens" },
      status: "gravada",
      diagnostico: null,
      temas: [],
      itens,
      task_ids: itens.map((i) => i.task_id),
      criado_por: chamador.userId,
      gravada_em: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw new ErroHttp(503, "proposta_nao_gravada", "O roteiro foi escrito, mas não foi gravado. Tente de novo.", { uso_id: s.usoId });

  const direcoes = await criarDirecoesDoRoteiro(servico, clientId, itens, chamador.userId);
  return json({ proposta, itens, direcoes_prontas: direcoes, custo_usd: s.custoUsd, saldo_usd: s.saldoUsd, reserva_usada: s.reservaUsada ?? null });
}

const ACOES: Record<string, (s: SupabaseClient, c: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  propor_temas: proporTemas,
  escolher_temas: escolherTemas,
  detalhar,
  conversar,
  gravar,
  completar_itens: completarItens,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido" }, 405);
  try {
    const servico = clienteServico();
    const chamador = await identificar(req, servico);
    let corpo: Record<string, unknown> = {};
    try { corpo = await req.json(); } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? corpo.action ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", aceitas: Object.keys(ACOES) }, 400);
    return await fn(servico, chamador, corpo);
  } catch (err) {
    return respostaDeErro(err);
  }
});
