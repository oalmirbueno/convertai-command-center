/**
 * computador-do-agente: a porta do navegador do agente (frente MOD, 30/09/2026).
 *
 * Computer use pela API, só leitura e coleta, num Chromium isolado do worker
 * da agência (workers/computador). A função não abre navegador nem chama
 * modelo: ela só guarda o pedido, colhe o Confirmar do dono, deixa Parar e
 * mostra as provas. Desenho: docs/motores/COMPUTADOR-DO-AGENTE.md, seção 8.
 *
 * Ações (POST { acao, ... }, equipe logada):
 * - estado -> { casos (ligado, motivo, tetos), executores (último visto), com_modelo }
 * - pedir { caso, url, dominios?, objetivo?, origem?, client_id? } -> { tarefa }
 *   recusa: caso desligado, URL que não é pública, login/conta/pagamento,
 *   domínio fora da lista, objetivo com senha, login ou ação que não é leitura.
 *   Nasce "aguardando_dono".
 * - decidir { tarefa_id, estado: "aprovada" | "cancelada" } -> { tarefa }
 *   só o dono (admin) aprova, e as travas são conferidas de novo na aprovação.
 * - parar { tarefa_id } -> { tarefa }   o dono ou quem pediu, a qualquer momento.
 * - provas { tarefa_id } -> { provas: [{ passo, url, legenda, em }] } (link de 10 min)
 *
 * Escrita só com a chave de serviço, depois de conferir papel e acesso ao
 * cliente (can_access_client). Toda mudança vai para o auditLog.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { auditLog } from "../_shared/mcp-audit.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import {
  CASOS_DO_NAVEGADOR,
  casoLigado,
  type CasoDoNavegador,
  DEFINICOES_DOS_CASOS,
  type EstadoDaTarefa,
  motivoDoCasoDesligado,
  motivoParaRecusarNoNavegador,
  normalizarPedidoDoNavegador,
  podeMudarEstado,
  podeParar,
} from "./modulos/navegador.ts";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "mesa";
const TABELA = "agente_computador_tarefas";
const LINK_DA_PROVA_S = 600;

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

type Chamador = { userId: string; doChamador: SupabaseClient; admin: boolean };

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

/** Caso com modelo (computer use de verdade) só com a variável no servidor. */
const comModelo = () => String(Deno.env.get("COMPUTADOR_COM_MODELO_LIGADO") || "").trim() === "1";

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa o navegador do agente.");
  const { data: ehAdmin } = await servico().rpc("has_role", { _user_id: userId, _role: "admin" });
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, doChamador, admin: ehAdmin === true };
}

async function garantirAcesso(ch: Chamador, clientId: string | null) {
  if (!clientId) return;
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

async function auditar(ch: Chamador, ferramenta: string, input: Record<string, unknown>, ref?: string) {
  await auditLog({
    correlationId: crypto.randomUUID(),
    toolName: ferramenta,
    origin: "painel:computador-do-agente",
    keyId: `painel:computador-do-agente:${ch.userId}`,
    scopes: ["computador:write"],
    input,
    success: true,
    statusCode: 200,
    durationMs: 0,
    resultRef: ref,
  });
}

function erroDaTabela(error: { message?: string; code?: string }): ErroHttp {
  const msg = String(error.message || "");
  if (/does not exist|schema cache|column/i.test(msg)) {
    return new ErroHttp(503, "falta_ativar_no_banco", "O navegador do agente ainda não foi ativado no banco (migration 20260930320200).");
  }
  return new ErroHttp(500, "banco_indisponivel", "Não foi possível gravar a tarefa agora.");
}

type Tarefa = {
  id: string;
  client_id: string | null;
  caso: string | null;
  estado: EstadoDaTarefa;
  url_inicial: string | null;
  dominios: string[] | null;
  objetivo: string | null;
  origem: string | null;
  criado_por: string | null;
  provas: Array<{ passo?: number; storage_path?: string; legenda?: string; em?: string }> | null;
  passos_feitos?: number;
};

async function lerTarefa(ch: Chamador, corpo: Record<string, unknown>): Promise<Tarefa> {
  const id = String(corpo.tarefa_id ?? "").trim();
  if (!UUID.test(id)) throw new ErroHttp(400, "tarefa_invalida", "tarefa_id precisa ser um UUID.");
  const { data, error } = await servico().from(TABELA).select("*").eq("id", id).maybeSingle();
  if (error) throw erroDaTabela(error);
  if (!data) throw new ErroHttp(404, "tarefa_inexistente", "Tarefa não encontrada.");
  const t = data as Tarefa;
  await garantirAcesso(ch, t.client_id);
  return t;
}

// ------------------------------------------------------------------ ações

async function estado(): Promise<Response> {
  const modelo = comModelo();
  const casos = CASOS_DO_NAVEGADOR.map((c) => {
    const d = DEFINICOES_DOS_CASOS[c];
    return { valor: c, rotulo: d.rotulo, usa_modelo: d.usaModelo, ligado: casoLigado(c, modelo), motivo: motivoDoCasoDesligado(c, modelo), teto_passos: d.tetoPassos, teto_custo_usd: d.tetoCustoUsd };
  });
  const { data, error } = await servico().from("computador_executores").select("nome, visto_em, versao, casos").order("visto_em", { ascending: false }).limit(5);
  if (error) registrarFalha("computador-do-agente:executores_ler", error);
  return json({ casos, com_modelo: modelo, executores: data || [] });
}

async function pedir(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const p = normalizarPedidoDoNavegador(corpo);
  await garantirAcesso(ch, p.client_id);
  const motivo = motivoParaRecusarNoNavegador(p, comModelo());
  if (motivo) throw new ErroHttp(409, "tarefa_recusada", motivo);
  const d = DEFINICOES_DOS_CASOS[p.caso as CasoDoNavegador];
  const passos = d.usaModelo
    ? [`Abrir ${p.url}`, `Ler e coletar: ${p.objetivo}`, "Uma captura de tela por passo", "Parar no teto ou antes de qualquer login, formulário ou pagamento"]
    : p.caso === "captura_site"
    ? [`Abrir ${p.url}`, "Rolar até o fim para carregar a página", "Capturar a tela inteira (computador e celular)"]
    : [`Abrir ${p.url}`, "Conferir se a página responde e mostra o post", "Capturar a tela como prova"];
  const { data, error } = await servico()
    .from(TABELA)
    .insert({
      client_id: p.client_id,
      titulo: p.titulo,
      app: "navegador",
      passos,
      irreversivel: false,
      estado: "aguardando_dono",
      caso: p.caso,
      url_inicial: p.url,
      dominios: p.dominios,
      objetivo: p.objetivo || null,
      origem: p.origem,
      teto_passos: d.tetoPassos,
      teto_custo_usd: d.tetoCustoUsd,
      criado_por: ch.userId,
    })
    .select("*")
    .single();
  if (error) throw erroDaTabela(error);
  const t = data as Tarefa;
  await auditar(ch, "computador_navegador_pedir", { caso: p.caso, dominios: p.dominios, origem: p.origem, client_id: p.client_id }, t.id);
  return json({ tarefa: t });
}

async function decidir(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const t = await lerTarefa(ch, corpo);
  const novo = String(corpo.estado ?? "") as EstadoDaTarefa;
  if (novo !== "aprovada" && novo !== "cancelada") throw new ErroHttp(400, "estado_invalido", "Use aprovada ou cancelada.");
  const papel = ch.admin ? "admin" : "equipe";
  if (!podeMudarEstado(t.estado, novo, papel, t.criado_por === ch.userId)) {
    throw new ErroHttp(403, "sem_permissao", novo === "aprovada" ? "Só o dono confirma tarefa do navegador do agente." : "Esta tarefa não pode ser cancelada agora.");
  }
  if (novo === "aprovada") {
    // As travas valem de novo no Confirmar (o caso pode ter sido desligado depois do pedido).
    if (!t.caso) throw new ErroHttp(409, "tarefa_recusada", "Tarefa de aplicativo de desktop: continua desligada (Mesa Edição).");
    const motivo = motivoParaRecusarNoNavegador(
      normalizarPedidoDoNavegador({ caso: t.caso, url: t.url_inicial, dominios: t.dominios, objetivo: t.objetivo, origem: t.origem, client_id: t.client_id }),
      comModelo(),
    );
    if (motivo) throw new ErroHttp(409, "tarefa_recusada", motivo);
  }
  const mudanca: Record<string, unknown> = { estado: novo, atualizado_em: new Date().toISOString() };
  if (novo === "aprovada") {
    mudanca.aprovado_por = ch.userId;
    mudanca.aprovado_em = new Date().toISOString();
  } else {
    mudanca.motivo = "Cancelada antes de rodar.";
    mudanca.parado_por = ch.userId;
  }
  const { data, error } = await servico().from(TABELA).update(mudanca).eq("id", t.id).eq("estado", t.estado).select("*").maybeSingle();
  if (error) throw erroDaTabela(error);
  if (!data) throw new ErroHttp(409, "tarefa_mudou", "A tarefa mudou enquanto você decidia. Abra de novo.");
  await auditar(ch, "computador_navegador_decidir", { tarefa_id: t.id, estado: novo }, t.id);
  return json({ tarefa: data });
}

async function parar(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const t = await lerTarefa(ch, corpo);
  if (!podeParar(t.estado, ch.admin ? "admin" : "equipe", t.criado_por === ch.userId)) {
    throw new ErroHttp(409, "nao_da_para_parar", t.estado === "feita" || t.estado === "falhou" || t.estado === "cancelada" ? "Esta tarefa já terminou." : "Só o dono ou quem pediu pode parar.");
  }
  const passo = Number(t.passos_feitos) || 0;
  const { data, error } = await servico()
    .from(TABELA)
    .update({
      estado: "cancelada",
      motivo: t.estado === "executando" ? `Parada no passo ${passo}.` : "Parada antes de rodar.",
      parado_por: ch.userId,
      trava_token: null,
      terminado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", t.id)
    .in("estado", ["aguardando_dono", "aprovada", "executando"])
    .select("*")
    .maybeSingle();
  if (error) throw erroDaTabela(error);
  if (!data) throw new ErroHttp(409, "tarefa_mudou", "A tarefa terminou antes de parar.");
  await auditar(ch, "computador_navegador_parar", { tarefa_id: t.id, estado_anterior: t.estado, passo }, t.id);
  return json({ tarefa: data });
}

async function provas(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const t = await lerTarefa(ch, corpo);
  const lista = Array.isArray(t.provas) ? t.provas : [];
  const saida: Array<{ passo: number; url: string | null; legenda: string; em: string | null }> = [];
  for (const p of lista.slice(0, 80)) {
    const caminho = String(p.storage_path || "");
    let url: string | null = null;
    if (caminho) {
      const { data, error } = await servico().storage.from(BUCKET).createSignedUrl(caminho, LINK_DA_PROVA_S);
      if (error) registrarFalha("computador-do-agente:prova_link", error, { tarefa_id: t.id });
      url = data?.signedUrl ?? null;
    }
    saida.push({ passo: Number(p.passo) || saida.length + 1, url, legenda: String(p.legenda || ""), em: p.em ? String(p.em) : null });
  }
  return json({ provas: saida });
}

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  estado: () => estado(),
  pedir,
  decidir,
  parar,
  provas,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  let acao = "";
  try {
    const ch = await identificar(req);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = await req.json();
    } catch { /* corpo vazio */ }
    acao = String(corpo.acao ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: `Ação desconhecida: ${acao || "(vazia)"}`, aceitas: Object.keys(ACOES) }, 400);
    return await fn(ch, corpo);
  } catch (err) {
    if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
    const motivo = registrarFalha("computador-do-agente", err, { acao: acao || "entrada" });
    return json({ error: "falha_interna", mensagem: `O navegador do agente não respondeu agora (${motivo}). Tente de novo.` }, 500);
  }
});
