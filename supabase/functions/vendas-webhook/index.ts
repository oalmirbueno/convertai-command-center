/**
 * vendas-webhook (Laboratório v4, 19/10/2026): o checkout funcionando de fato
 * pelo gateway do cliente (ESPEC-LABORATORIO-v4, seção 5, opção (a)).
 *
 * verify_jwt = false (o gateway não tem login). Duas portas na mesma função:
 *
 * 1) Aviso do gateway, sem login:
 *    POST /functions/v1/vendas-webhook/<gateway>/<chave>
 *    gateway: hotmart | kiwify | stripe | mercado_pago | asaas
 *    A assinatura de cada gateway é conferida antes de ler o corpo (detalhes em
 *    modulos/gateways.ts). O evento vai para vendas_eventos (único por
 *    integração e id externo) e liga ao lead do CRM pelo e-mail ou WhatsApp;
 *    sem lead, o banco cria um com origin 'checkout'.
 *
 * 2) Ações da equipe (admin ou gestor), com o JWT do painel:
 *    POST /functions/v1/vendas-webhook { acao, ... }
 *    - integracao_criar   { client_id|null, gateway } → { integracao, segredo? }
 *        Asaas: o painel gera o token e ele volta UMA vez em `segredo`.
 *    - integracao_segredo { id, segredo?, token_api? } → { integracao }
 *        Hotmart (hottok, guardado só em hash), Stripe/Kiwify/Mercado Pago
 *        (segredo de assinatura, no Vault), token_api do Mercado Pago/Asaas (Vault).
 *    - integracao_listar  { client_id|null, gateway? } → { integracoes }
 *    - integracao_desligar { id } → { ok }
 *    - eventos_listar     { client_id|null, gateway?, integracao_id?, limite? } → { eventos }
 *    Erro: { error, mensagem } com o status HTTP.
 *
 * Segredo nunca vai para log nem volta na listagem.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { ehGateway, type EventoDeVenda, type Gateway, SEGREDO_GERADO_PELO_PAINEL, TOKEN_API_DO_GATEWAY, VALIDACAO_DO_GATEWAY } from "./modulos/gateways.ts";
import { type IntegracaoParaWebhook, LIMITE_DO_CORPO, type PortaDeVendas, receberWebhook, rotaDoWebhook } from "./nucleo.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAPEIS = ["admin", "manager"];

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  return servicoCache;
}

const enderecoDo = (gateway: string, chave: string) => `${(Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "")}/functions/v1/vendas-webhook/${gateway}/${chave}`;

// ------------------------------------------------------------------ aviso do gateway

const porta: PortaDeVendas = {
  async integracao(gateway, chave) {
    const { data, error } = await servico().rpc("vendas_integracao_para_webhook", { _gateway: gateway, _chave: chave });
    if (error) throw error;
    return (data as IntegracaoParaWebhook | null) || null;
  },
  async registrar(integracaoId: string, e: EventoDeVenda) {
    const { data, error } = await servico().rpc("vendas_registrar_evento", {
      _integracao_id: integracaoId,
      _id_externo: e.idExterno,
      _tipo: e.tipo,
      _valor: e.valor,
      _moeda: e.moeda,
      _produto: e.produto,
      _email: e.email,
      _nome: e.nome,
      _whatsapp: e.whatsapp,
      _resumo: e.resumo,
    });
    if (error) throw error;
    return (data || { ok: false, codigo: "sem_resposta" }) as { ok: boolean; duplicado?: boolean; codigo?: string };
  },
  buscar: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }),
  falha: (onde, erro) => registrarFalha(onde, erro),
};

async function aviso(req: Request, rota: { gateway: Gateway; chave: string }): Promise<Response> {
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > LIMITE_DO_CORPO) return json({ ok: false, codigo: "grande_demais" }, 413);
  let corpoJson: unknown = null;
  try {
    corpoJson = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    corpoJson = null;
  }
  const url = new URL(req.url);
  const resp = await receberWebhook(porta, rota, { cabecalhos: req.headers, busca: url.searchParams, corpo: bytes, json: corpoJson });
  return json(resp.corpo, resp.status);
}

// ------------------------------------------------------------------ ações da equipe

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

type Chamador = { userId: string; token: string };

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data, error } = await servico().from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  const papeis = ((data || []) as Array<{ role: string }>).map((r) => String(r.role));
  if (!papeis.some((p) => PAPEIS.indexOf(p) >= 0)) throw new ErroHttp(403, "somente_admin_ou_gestor", "Só admin ou gestor liga o checkout.");
  return { userId, token };
}

async function garantirCliente(ch: Chamador, clientId: string | null) {
  if (clientId === null) return;
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${ch.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

const clienteDe = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!UUID.test(s)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  return s;
};
const idDe = (v: unknown): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroHttp(400, "id_invalido", "id precisa ser um UUID.");
  return s;
};
const gatewayDe = (v: unknown, obrigatorio: boolean): Gateway | null => {
  if (!obrigatorio && (v == null || v === "")) return null;
  if (!ehGateway(v)) throw new ErroHttp(400, "gateway_invalido", "Gateway desconhecido. Use Hotmart, Kiwify, Stripe, Mercado Pago ou Asaas.");
  return v;
};
const segredoDe = (v: unknown, nome: string): string | null => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (s.length < 8 || s.length > 512 || /\s/.test(s)) throw new ErroHttp(400, `${nome}_invalido`, "O valor colado não parece um segredo (8 a 512 caracteres, sem espaço).");
  return s;
};

const COLUNAS_DA_INTEGRACAO = "id, client_id, gateway, chave, validacao, ativo, criado_por, criado_em, segredo_em, segredo_final, token_api_em, desligado_em, ultimo_evento_em";

type LinhaDaIntegracao = {
  id: string;
  client_id: string | null;
  gateway: Gateway;
  chave: string;
  validacao: string;
  ativo: boolean;
  criado_em: string;
  segredo_em: string | null;
  segredo_final: string | null;
  token_api_em: string | null;
  desligado_em: string | null;
  ultimo_evento_em: string | null;
};

/** O que a tela recebe: nada de hash nem ponteiro de cofre. */
function paraTela(l: LinhaDaIntegracao) {
  return {
    id: l.id,
    client_id: l.client_id,
    gateway: l.gateway,
    ativo: l.ativo,
    endereco: enderecoDo(l.gateway, l.chave),
    criado_em: l.criado_em,
    tem_segredo: !!l.segredo_em,
    segredo_final: l.segredo_final,
    segredo_gerado_pelo_painel: SEGREDO_GERADO_PELO_PAINEL[l.gateway],
    token_api: TOKEN_API_DO_GATEWAY[l.gateway],
    tem_token_api: !!l.token_api_em,
    validacao: VALIDACAO_DO_GATEWAY[l.gateway],
    desligado_em: l.desligado_em,
    ultimo_evento_em: l.ultimo_evento_em,
  };
}

function erroDoBanco(error: { code?: string; message?: string } | null, onde: string): ErroHttp {
  if (error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202")) {
    return new ErroHttp(503, "banco_sem_vendas", "O banco ainda não tem as tabelas de vendas (migration 20261020070000_vendas_quiz_ab.sql pendente).");
  }
  registrarFalha(`vendas-webhook: ${onde}`, error);
  return new ErroHttp(503, "banco_indisponivel", "Não foi possível falar com o banco agora. Tente de novo.");
}

async function lerIntegracao(id: string): Promise<LinhaDaIntegracao> {
  const { data, error } = await servico().from("vendas_integracoes").select(COLUNAS_DA_INTEGRACAO).eq("id", id).maybeSingle();
  if (error) throw erroDoBanco(error, "integração não lida");
  if (!data) throw new ErroHttp(404, "integracao_nao_encontrada", "Integração não encontrada.");
  return data as unknown as LinhaDaIntegracao;
}

const MENSAGEM_DO_BANCO: Record<string, string> = {
  ja_existe: "Já existe uma integração ligada para este cliente e gateway.",
  cliente_invalido: "Cliente não encontrado.",
  nao_encontrada: "Integração não encontrada ou desligada.",
  segredo_gerado_pelo_painel: "O token do Asaas é gerado pelo painel. Para trocar, desligue e crie de novo.",
  token_api_nao_usado: "Este gateway não usa chave de API.",
  segredo_invalido: "O valor colado não parece um segredo (8 a 512 caracteres, sem espaço).",
};

async function acao(req: Request): Promise<Response> {
  let corpo: Record<string, unknown>;
  try {
    const texto = await req.text();
    if (texto.length > 20_000) return json({ error: "grande_demais", mensagem: "Pedido grande demais." }, 413);
    corpo = JSON.parse(texto || "{}");
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw new Error("corpo");
  } catch {
    return json({ error: "pedido_invalido", mensagem: "Pedido inválido." }, 400);
  }
  try {
    const ch = await identificar(req);
    const nome = String(corpo.acao || "");

    if (nome === "integracao_criar") {
      const clientId = clienteDe(corpo.client_id);
      const gateway = gatewayDe(corpo.gateway, true)!;
      await garantirCliente(ch, clientId);
      const { data, error } = await servico().rpc("vendas_integracao_criar", { _client_id: clientId, _gateway: gateway, _ator: ch.userId });
      if (error) throw erroDoBanco(error, "integração não criada");
      const r = (data || {}) as { ok?: boolean; codigo?: string; id?: string; segredo?: string | null };
      if (!r.ok || !r.id) {
        const codigo = String(r.codigo || "nao_criada");
        throw new ErroHttp(codigo === "ja_existe" ? 409 : 400, codigo, MENSAGEM_DO_BANCO[codigo] || "Não foi possível criar a integração.");
      }
      // O segredo do Asaas volta só nesta resposta: o banco guardou o hash.
      return json({ integracao: paraTela(await lerIntegracao(r.id)), segredo: r.segredo || null });
    }

    if (nome === "integracao_segredo") {
      const id = idDe(corpo.id);
      const atual = await lerIntegracao(id);
      await garantirCliente(ch, atual.client_id);
      const segredo = segredoDe(corpo.segredo, "segredo");
      const tokenApi = segredoDe(corpo.token_api, "token_api");
      if (!segredo && !tokenApi) throw new ErroHttp(400, "sem_valor", "Cole o segredo ou a chave de API.");
      const { data, error } = await servico().rpc("vendas_integracao_segredo", { _id: id, _segredo: segredo, _token_api: tokenApi, _ator: ch.userId });
      if (error) throw erroDoBanco(error, "segredo não salvo");
      const r = (data || {}) as { ok?: boolean; codigo?: string };
      if (!r.ok) {
        const codigo = String(r.codigo || "nao_salvo");
        throw new ErroHttp(400, codigo, MENSAGEM_DO_BANCO[codigo] || "Não foi possível salvar o segredo.");
      }
      return json({ integracao: paraTela(await lerIntegracao(id)) });
    }

    if (nome === "integracao_listar") {
      const clientId = clienteDe(corpo.client_id);
      const gateway = gatewayDe(corpo.gateway, false);
      await garantirCliente(ch, clientId);
      let q = servico().from("vendas_integracoes").select(COLUNAS_DA_INTEGRACAO).order("criado_em", { ascending: false }).limit(50);
      q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
      if (gateway) q = q.eq("gateway", gateway);
      const { data, error } = await q;
      if (error) throw erroDoBanco(error, "integrações não lidas");
      return json({ integracoes: ((data || []) as unknown as LinhaDaIntegracao[]).map(paraTela) });
    }

    if (nome === "integracao_desligar") {
      const id = idDe(corpo.id);
      const atual = await lerIntegracao(id);
      await garantirCliente(ch, atual.client_id);
      const { data, error } = await servico().rpc("vendas_integracao_desligar", { _id: id, _ator: ch.userId });
      if (error) throw erroDoBanco(error, "integração não desligada");
      const r = (data || {}) as { ok?: boolean; codigo?: string };
      if (!r.ok) throw new ErroHttp(400, String(r.codigo || "nao_desligada"), "Não foi possível desligar a integração.");
      return json({ ok: true });
    }

    if (nome === "eventos_listar") {
      const clientId = clienteDe(corpo.client_id);
      const gateway = gatewayDe(corpo.gateway, false);
      await garantirCliente(ch, clientId);
      const limite = Math.max(1, Math.min(50, Math.floor(Number(corpo.limite) || 5)));
      let q = servico()
        .from("vendas_eventos")
        .select("id, integracao_id, gateway, tipo, valor, moeda, produto_externo_id, comprador_email, comprador_nome, lead_id, recebido_em")
        .order("recebido_em", { ascending: false })
        .limit(limite);
      q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
      if (gateway) q = q.eq("gateway", gateway);
      if (corpo.integracao_id) q = q.eq("integracao_id", idDe(corpo.integracao_id));
      const { data, error } = await q;
      if (error) throw erroDoBanco(error, "eventos não lidos");
      return json({ eventos: data || [] });
    }

    throw new ErroHttp(400, "acao_desconhecida", "Ação desconhecida.");
  } catch (e) {
    if (e instanceof ErroHttp) return json({ error: e.codigo, mensagem: e.message }, e.status);
    registrarFalha("vendas-webhook: erro inesperado", e);
    return json({ error: "erro_interno", mensagem: "Falha inesperada nas vendas." }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, codigo: "metodo_nao_permitido" }, 405);
  try {
    const rota = rotaDoWebhook(new URL(req.url).pathname);
    if (rota) return await aviso(req, rota);
    const partes = new URL(req.url).pathname.split("/").filter(Boolean);
    const i = partes.indexOf("vendas-webhook");
    // Caminho com mais partes e formato errado: endereço de webhook inválido.
    if (i >= 0 && partes.length > i + 1) return json({ ok: false, codigo: "endereco_invalido" }, 404);
    return await acao(req);
  } catch (e) {
    registrarFalha("vendas-webhook: erro inesperado", e);
    return json({ ok: false, codigo: "erro_interno" }, 500);
  }
});
