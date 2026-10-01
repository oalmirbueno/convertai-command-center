/**
 * computador-do-agente: a porta do navegador do agente (frente MOD, 30/09/2026).
 *
 * Computer use pela API, só leitura e coleta, num Chromium isolado do worker
 * da agência (workers/computador). A função não abre navegador nem chama
 * modelo: ela só guarda o pedido, colhe o Confirmar do dono, deixa Parar e
 * mostra as provas. Desenho: docs/motores/COMPUTADOR-DO-AGENTE.md, seção 8.
 *
 * Ações (POST { acao, ... }, equipe logada):
 * - estado -> { casos (ligado, motivo, tetos, onde, custo médio), modelos (os do catálogo com computer use),
 *   modelo_padrao, executores (último visto, provedores com chave, último erro), com_modelo }
 * - pedir { caso, url, urls?, dominios?, objetivo?, origem?, client_id?, modelo_id? } -> { tarefa, custo_estimado_usd }
 *   recusa: caso desligado, URL que não é pública, login/conta/pagamento,
 *   domínio fora da lista, objetivo com senha, login ou ação que não é leitura,
 *   modelo que não faz computer use (frente CUS: qualquer modelo marcado no catálogo, Anthropic ou OpenAI).
 *   Nasce "aguardando_dono".
 * - decidir { tarefa_id, estado: "aprovada" | "cancelada" } -> { tarefa }
 *   só o dono (admin) aprova, e as travas são conferidas de novo na aprovação.
 * - parar { tarefa_id } -> { tarefa }   o dono ou quem pediu, a qualquer momento.
 * - provas { tarefa_id } -> { provas: [{ passo, url, legenda, em }] } (link de 10 min)
 * - cartao { tarefa_id } -> { tarefa, resultado, imagens: [{ rotulo, url, storage_path }] } (o cartão da coleta,
 *   com fonte e print; a mesa de origem transforma em insumo com um clique)
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
  custoEstimadoDoCaso,
  DEFINICOES_DOS_CASOS,
  type EstadoDaTarefa,
  fazComputerUse,
  MODELO_PADRAO_DO_COMPUTADOR,
  type ModeloDoCatalogoParaComputador,
  modelosDoComputador,
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
  modelo_id?: string | null;
  urls?: string[] | null;
  resultado?: Record<string, unknown> | null;
};

const COLUNAS_DO_MODELO = "id, provedor, modelo_api, rotulo, tipo, preco_entrada_1m, preco_saida_1m, preco_cache_1m, disponivel, ativo, recursos";

/** Os modelos do catálogo que fazem computer use (recursos.computer_use), o padrão primeiro. */
async function modelosComComputador(): Promise<ModeloDoCatalogoParaComputador[]> {
  const { data, error } = await servico().from("ia_modelos").select(COLUNAS_DO_MODELO).in("provedor", ["anthropic", "openai"]).eq("tipo", "texto");
  if (error) {
    registrarFalha("computador-do-agente:modelos_ler", error);
    return [];
  }
  return modelosDoComputador((data || []) as ModeloDoCatalogoParaComputador[]);
}

/** O modelo escolhido precisa estar no catálogo e fazer computer use (a tela só oferece esses). */
async function modeloDoPedido(id: string): Promise<ModeloDoCatalogoParaComputador> {
  const { data, error } = await servico().from("ia_modelos").select(COLUNAS_DO_MODELO).eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(503, "catalogo_indisponivel", "Não foi possível ler o catálogo de modelos agora.");
  const m = data as ModeloDoCatalogoParaComputador | null;
  if (!m) throw new ErroHttp(409, "modelo_inexistente", "Esse modelo não está no catálogo.");
  if (!fazComputerUse(m)) {
    throw new ErroHttp(409, "modelo_sem_computer_use", `${m.rotulo || m.id} não faz computer use. Escolha um modelo marcado com computer use (o padrão é o Claude Sonnet 5.5).`);
  }
  return m;
}

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
  const [executores, feitas, modelos] = await Promise.all([
    servico().from("computador_executores").select("*").order("visto_em", { ascending: false }).limit(5),
    servico().from(TABELA).select("caso, custo_usd").eq("estado", "feita").not("caso", "is", null).order("terminado_em", { ascending: false }).limit(300),
    modelosComComputador(),
  ]);
  if (executores.error) registrarFalha("computador-do-agente:executores_ler", executores.error);
  if (feitas.error) registrarFalha("computador-do-agente:custos_ler", feitas.error);
  // Custo médio real de cada ação (as últimas 300 feitas); sem histórico, a estimativa pelo padrão.
  const soma: Record<string, { n: number; usd: number }> = {};
  ((feitas.data || []) as Array<{ caso: string; custo_usd: number | string | null }>).forEach((f) => {
    const x = soma[f.caso] || (soma[f.caso] = { n: 0, usd: 0 });
    x.n += 1;
    x.usd += Number(f.custo_usd) || 0;
  });
  const padrao = modelos.find((m) => m.id === MODELO_PADRAO_DO_COMPUTADOR) || modelos[0] || null;
  const casos = CASOS_DO_NAVEGADOR.map((c) => {
    const d = DEFINICOES_DOS_CASOS[c];
    const real = soma[c];
    return {
      valor: c,
      rotulo: d.rotulo,
      descricao: d.descricao,
      onde: d.onde,
      usa_modelo: d.usaModelo,
      ligado: casoLigado(c, modelo),
      motivo: motivoDoCasoDesligado(c, modelo),
      teto_passos: d.tetoPassos,
      teto_custo_usd: d.tetoCustoUsd,
      insumo: d.insumo,
      varios_sites: d.variosSites,
      feitas: real ? real.n : 0,
      custo_medio_usd: real && real.n ? Math.round((real.usd / real.n) * 10000) / 10000 : null,
      custo_estimado_usd: custoEstimadoDoCaso(c, padrao).estimado,
    };
  });
  return json({ casos, com_modelo: modelo, modelos, modelo_padrao: padrao ? padrao.id : MODELO_PADRAO_DO_COMPUTADOR, executores: executores.data || [] });
}

async function pedir(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const p = normalizarPedidoDoNavegador(corpo);
  await garantirAcesso(ch, p.client_id);
  const motivo = motivoParaRecusarNoNavegador(p, comModelo());
  if (motivo) throw new ErroHttp(409, "tarefa_recusada", motivo);
  const d = DEFINICOES_DOS_CASOS[p.caso as CasoDoNavegador];
  const m = d.usaModelo && p.modelo_id ? await modeloDoPedido(p.modelo_id) : null;
  const passos = passosDoPedido(p.caso as CasoDoNavegador, p.url as string, p.urls, p.objetivo, m);
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
      modelo_id: m ? m.id : null,
      urls: d.variosSites ? p.urls : [],
      criado_por: ch.userId,
    })
    .select("*")
    .single();
  if (error) throw erroDaTabela(error);
  const t = data as Tarefa;
  const custo = custoEstimadoDoCaso(p.caso as CasoDoNavegador, m, p.urls.length);
  await auditar(ch, "computador_navegador_pedir", { caso: p.caso, dominios: p.dominios, origem: p.origem, client_id: p.client_id, modelo_id: m ? m.id : null }, t.id);
  return json({ tarefa: t, custo_estimado_usd: custo.estimado, teto_custo_usd: custo.teto });
}

/** Os passos que o dono lê no Confirmar (o worker segue o roteiro do caso, não este texto). */
function passosDoPedido(caso: CasoDoNavegador, url: string, urls: string[], objetivo: string, m: ModeloDoCatalogoParaComputador | null): string[] {
  const quem = m ? `${m.rotulo || m.id} (computer use)` : "";
  const fim = "Parar no teto ou antes de qualquer login, formulário ou pagamento";
  switch (caso) {
    case "captura_site":
      return [`Abrir ${url}`, "Rolar até o fim para carregar a página", "Capturar a tela inteira (computador e celular)"];
    case "conferir_post":
      return [`Abrir ${url}`, "Conferir se a página responde e mostra o post", "Capturar a tela como prova"];
    case "conferir_site":
      return [`Abrir ${url}`, "Medir o tempo de carregamento", "Capturar a tela no computador e no celular", "Conferir os links do próprio site (só leitura)"];
    case "capturar_referencia":
      return [`Abrir ${url}`, "Capturar a tela inteira (computador e celular)", "Ler cores e fontes do código da página", `${quem}: escrever as notas de estilo`, fim];
    case "perfil_publico":
      return [`Abrir ${url}`, "Ler o que aparece sem login (título, descrição, imagem)", `${quem}: ${objetivo}`, fim];
    case "concorrentes_visuais":
      return [...urls.map((u) => `Abrir ${u}, ler logo, cores e fontes e capturar o topo`), `${quem}: ${objetivo}`, fim];
    default:
      return [`Abrir ${url}`, `${quem}: ${objetivo}`, "Uma captura de tela por passo", fim];
  }
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
    const p = normalizarPedidoDoNavegador({ caso: t.caso, url: t.url_inicial, urls: t.urls, dominios: t.dominios, objetivo: t.objetivo, origem: t.origem, client_id: t.client_id, modelo_id: t.modelo_id });
    const motivo = motivoParaRecusarNoNavegador(p, comModelo());
    if (motivo) throw new ErroHttp(409, "tarefa_recusada", motivo);
    if (p.modelo_id) await modeloDoPedido(p.modelo_id);
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

/** Imagens do cartão: as que o worker marcou no resultado (página inteira, celular, topo de cada site). */
async function cartao(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const t = await lerTarefa(ch, corpo);
  const r = (t.resultado && typeof t.resultado === "object" ? t.resultado : {}) as Record<string, unknown>;
  const marcadas = Array.isArray(r.imagens) ? (r.imagens as Array<{ rotulo?: unknown; storage_path?: unknown }>) : [];
  // Sem imagem marcada (tarefa antiga): o último print da tarefa.
  const lista = marcadas.length
    ? marcadas.slice(0, 12).map((i) => ({ rotulo: String(i.rotulo || ""), storage_path: String(i.storage_path || "") }))
    : (Array.isArray(t.provas) ? t.provas.slice(-1) : []).map((p) => ({ rotulo: String(p.legenda || "Último passo"), storage_path: String(p.storage_path || "") }));
  // Só caminho da pasta da tarefa (nunca um caminho qualquer que veio no resultado).
  const daTarefa = (c: string) => !!c && c.indexOf(`/computador/${t.id}/`) > 0 && c.indexOf("..") < 0;
  const imagens: Array<{ rotulo: string; url: string | null; storage_path: string }> = [];
  for (const i of lista.filter((x) => daTarefa(x.storage_path))) {
    const { data, error } = await servico().storage.from(BUCKET).createSignedUrl(i.storage_path, LINK_DA_PROVA_S);
    if (error) registrarFalha("computador-do-agente:cartao_link", error, { tarefa_id: t.id });
    imagens.push({ rotulo: i.rotulo, url: data?.signedUrl ?? null, storage_path: i.storage_path });
  }
  return json({ tarefa: { id: t.id, caso: t.caso, estado: t.estado, url_inicial: t.url_inicial, dominios: t.dominios, objetivo: t.objetivo, origem: t.origem, modelo_id: t.modelo_id || null, client_id: t.client_id }, resultado: r, imagens });
}

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  estado: () => estado(),
  pedir,
  decidir,
  parar,
  provas,
  cartao,
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
