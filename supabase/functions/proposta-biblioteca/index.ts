/**
 * proposta-biblioteca: a biblioteca comercial da agência (frente PRO2, 30/09/2026),
 * usada pela Mesa Proposta. Só admin e gestor. A leitura das listas vai direto
 * ao banco pela RLS; toda escrita passa por aqui (service_role).
 *
 * POST { acao, ... }:
 * - servico_salvar { servico: { id?, nome, categoria?, descricao?, unidade, preco, recorrencia?, horas?, entregaveis?, ordem? } } -> { servico }
 * - servico_arquivar { id, arquivar? } -> { servico }   (apagar = arquivar)
 * - prova_salvar { prova: { id?, tipo, titulo?, texto?, nome?, cargo?, empresa?, link?, nicho?, client_id?, autorizado, autorizacao?, autorizado_em? } } -> { prova }
 *   Autorizado exige o registro de como foi autorizado (quem, onde, quando). Só prova autorizada entra na proposta.
 * - prova_arquivar { id, arquivar? } -> { prova }
 * - calculadora_ler {} -> { hora } (parâmetros, custos do Financeiro, custo e preço da hora)
 * - calculadora_salvar { parametros, usar_financeiro } -> { hora }
 *
 * Erro sai como { error, mensagem }. Nada de erro engolido: vai para o log.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { custoDaHora, normalizarParametros, normalizarProva, normalizarServico, precoDaHora } from "../_shared/proposta-comercial.ts";
import { lerHoraTecnica } from "../mesa-proposta/hora-tecnica.ts";
import { hojeEmSaoPaulo, textoLimpo } from "../_shared/proposta-modelo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS_SERVICO = "id, nome, categoria, descricao, unidade, preco, recorrencia, horas, entregaveis, ordem, arquivado_em, atualizado_em";
const CAMPOS_PROVA = "id, tipo, titulo, texto, nome, cargo, empresa, link, nicho, client_id, autorizado, autorizacao, autorizado_em, arquivado_em, atualizado_em";
const AVISO_BANCO = "O banco ainda não tem a biblioteca da proposta (migration 20260930130000_proposta_comercial_evolucao.sql pendente).";

class ErroHttp extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  return servicoCache;
}

async function identificar(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const [admin, gestor] = await Promise.all([servico().rpc("has_role", { _user_id: userId, _role: "admin" }), servico().rpc("has_role", { _user_id: userId, _role: "manager" })]);
  if (admin.error || gestor.error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (admin.data !== true && gestor.data !== true) throw new ErroHttp(403, "somente_gestao", "Só admin e gestor mexem na biblioteca comercial.");
  return userId;
}

function semTabela(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /proposta_(servicos|provas|calculadora).*(does not exist|schema cache)/i.test(String(error.message || "")));
}

function falhaDoBanco(onde: string, error: { code?: string; message?: string }, mensagem: string): never {
  if (semTabela(error)) throw new ErroHttp(503, "banco_sem_biblioteca", AVISO_BANCO);
  registrarFalha(`proposta-biblioteca: ${onde}`, error);
  throw new ErroHttp(503, "biblioteca_indisponivel", mensagem);
}

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// ------------------------------------------------------------------ serviços

async function servicoSalvar(userId: string, corpo: Record<string, unknown>) {
  const bruto = objeto(corpo.servico);
  const s = normalizarServico(bruto);
  if (!s) throw new ErroHttp(400, "servico_invalido", "O serviço precisa de nome e preço (em reais).");
  const ordem = Math.round(Number(bruto.ordem));
  const linha = { nome: s.nome, categoria: s.categoria || null, descricao: s.descricao || null, unidade: s.unidade, preco: s.preco, recorrencia: s.recorrencia, horas: s.horas, entregaveis: s.entregaveis, ordem: Number.isFinite(ordem) ? ordem : 0 };
  const id = typeof bruto.id === "string" && UUID.test(bruto.id) ? bruto.id : null;
  const q = id ? servico().from("proposta_servicos").update(linha).eq("id", id) : servico().from("proposta_servicos").insert({ ...linha, criado_por: userId });
  const { data, error } = await q.select(CAMPOS_SERVICO).maybeSingle();
  if (error) falhaDoBanco("serviço não salvo", error, "Não foi possível salvar o serviço agora.");
  if (!data) throw new ErroHttp(404, "servico_inexistente", "Serviço não encontrado.");
  return json({ servico: data });
}

async function servicoArquivar(_userId: string, corpo: Record<string, unknown>) {
  const id = String(corpo.id || "");
  if (!UUID.test(id)) throw new ErroHttp(400, "id_invalido", "id precisa ser um UUID.");
  const { data, error } = await servico().from("proposta_servicos").update({ arquivado_em: corpo.arquivar === false ? null : new Date().toISOString() }).eq("id", id).select(CAMPOS_SERVICO).maybeSingle();
  if (error) falhaDoBanco("serviço não arquivado", error, "Não foi possível arquivar o serviço agora.");
  if (!data) throw new ErroHttp(404, "servico_inexistente", "Serviço não encontrado.");
  return json({ servico: data });
}

// ------------------------------------------------------------------ provas

async function provaSalvar(userId: string, corpo: Record<string, unknown>) {
  const bruto = objeto(corpo.prova);
  const p = normalizarProva(bruto);
  if (!p) throw new ErroHttp(400, "prova_invalida", "Case precisa de título; depoimento precisa de nome e texto.");
  if (p.autorizado && p.autorizacao.length < 3) throw new ErroHttp(400, "autorizacao_sem_registro", "Diga como a autorização foi dada (ex.: e-mail da Joana em 12/09).");
  const clientId = typeof bruto.client_id === "string" && UUID.test(bruto.client_id) ? bruto.client_id : null;
  const linha = {
    tipo: p.tipo,
    titulo: p.titulo || null,
    texto: p.texto || null,
    nome: p.nome || null,
    cargo: p.cargo || null,
    empresa: p.empresa || null,
    link: p.link || null,
    nicho: p.nicho || null,
    client_id: clientId,
    autorizado: p.autorizado,
    autorizacao: p.autorizado ? p.autorizacao : p.autorizacao || null,
    autorizado_em: p.autorizado ? p.autorizado_em || hojeEmSaoPaulo() : null,
    autorizado_por: p.autorizado ? userId : null,
  };
  const id = typeof bruto.id === "string" && UUID.test(bruto.id) ? bruto.id : null;
  const q = id ? servico().from("proposta_provas").update(linha).eq("id", id) : servico().from("proposta_provas").insert({ ...linha, criado_por: userId });
  const { data, error } = await q.select(CAMPOS_PROVA).maybeSingle();
  if (error) falhaDoBanco("prova não salva", error, "Não foi possível salvar agora.");
  if (!data) throw new ErroHttp(404, "prova_inexistente", "Não encontrado.");
  return json({ prova: data });
}

async function provaArquivar(_userId: string, corpo: Record<string, unknown>) {
  const id = String(corpo.id || "");
  if (!UUID.test(id)) throw new ErroHttp(400, "id_invalido", "id precisa ser um UUID.");
  const { data, error } = await servico().from("proposta_provas").update({ arquivado_em: corpo.arquivar === false ? null : new Date().toISOString() }).eq("id", id).select(CAMPOS_PROVA).maybeSingle();
  if (error) falhaDoBanco("prova não arquivada", error, "Não foi possível arquivar agora.");
  if (!data) throw new ErroHttp(404, "prova_inexistente", "Não encontrado.");
  return json({ prova: data });
}

// ------------------------------------------------------------------ calculadora

async function horaParaTela() {
  const hora = await lerHoraTecnica(servico());
  return { ...hora, custo_hora: custoDaHora(hora.parametros), preco_hora: precoDaHora(hora.parametros) };
}

async function calculadoraLer() {
  return json({ hora: await horaParaTela() });
}

async function calculadoraSalvar(userId: string, corpo: Record<string, unknown>) {
  const p = normalizarParametros(objeto(corpo.parametros));
  const linha = { id: 1, usar_financeiro: corpo.usar_financeiro !== false, ...p, atualizado_por: userId, atualizado_em: new Date().toISOString() };
  const { error } = await servico().from("proposta_calculadora").upsert(linha, { onConflict: "id" });
  if (error) falhaDoBanco("calculadora não salva", error, "Não foi possível salvar a calculadora agora.");
  return json({ hora: await horaParaTela() });
}

const ACOES: Record<string, (userId: string, corpo: Record<string, unknown>) => Promise<Response>> = {
  servico_salvar: servicoSalvar,
  servico_arquivar: servicoArquivar,
  prova_salvar: provaSalvar,
  prova_arquivar: provaArquivar,
  calculadora_ler: () => calculadoraLer(),
  calculadora_salvar: calculadoraSalvar,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const userId = await identificar(req);
    const corpo = objeto(await req.json().catch(() => ({})));
    const acao = textoLimpo(corpo.acao, 40);
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    return await fn(userId, corpo);
  } catch (err) {
    if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
    registrarFalha("proposta-biblioteca: erro inesperado", err);
    return json({ error: "erro_interno", mensagem: "Falha inesperada na biblioteca comercial." }, 500);
  }
});
