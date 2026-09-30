/**
 * Base da função contratos (frente CON2, 30/09/2026): o que a função e os
 * módulos novos (ficha fiscal, ciclo do contrato, editor de modelos)
 * dividem. Saiu do index.ts sem mudar o comportamento: erros, acesso, leitura
 * do contrato e a trilha.
 *
 * O núcleo (montar, criar rascunho, payload) continua no index.ts e chega aos
 * módulos pelo objeto Nucleo, sem import circular. Sem travessão.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { EMAIL_APP_URL } from "../_shared/email-config.ts";
import type { ClausulaAlterada, ContratoMontado, DadosDaAgencia, ModeloDeContrato, ServicoDoContrato, Valores } from "../_shared/contrato-modelo.ts";
import type { SignatarioDoBanco } from "../_shared/contrato-assinaturas.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RASCUNHO_URL = "modelo://rascunho";

export const CAMPOS =
  "id, client_id, project_id, title, description, status, origem, numero, versao, versao_de, substituido_por, substituido_em, proposta_id, servicos, variaveis, modelo_versoes, clausulas_alteradas, documento_texto, documento_hash, documento_pdf_url, documento_pdf_hash, congelado_em, pdf_final_hash, admin_signature_name, admin_signed_at, admin_signature_email, client_signature_name, client_signed_at, client_signature_email, client_signature_ip, sign_token, sent_at, file_id, original_file_url, original_file_name, arquivado_em, motivo_arquivo, created_by, created_at, updated_at";
/** Colunas da frente CON2 (20260930195100). Sem elas, a leitura cai para CAMPOS. */
export const CAMPOS_CON2 = `${CAMPOS}, tipo_documento, contrato_mae_id, renovacao_de, vigencia_inicio, vigencia_fim, lembrete_em, aviso_vencimento_em`;

export const linkDeAssinatura = (token: string) => `${EMAIL_APP_URL}/contrato/${token}`;

export const AVISO_BANCO = "O banco ainda não tem as tabelas de contratos por modelo (migrations 20260930030000 a 20260930030200 pendentes).";
export const AVISO_BANCO_CON2 = "O banco ainda não tem o ciclo dos contratos (migrations 20260930195000 a 20260930195300 pendentes).";

// ------------------------------------------------------------------ erros

export class ErroHttp extends Error {
  status: number;
  codigo: string;
  extra: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, extra: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

export function semTabela(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const m = String(error.message || "");
  return error.code === "42P01" || error.code === "42703" || error.code === "PGRST205" || error.code === "PGRST204" || /(contrato_|origem|documento_texto|tipo_documento|vigencia_|cliente_dados_fiscais|cnpj_consultas).*(does not exist|schema cache)/i.test(m);
}

// ------------------------------------------------------------------ banco e acesso

export type Chamador = { userId: string; email: string; nome: string; ip: string; doChamador: SupabaseClient; sistema?: boolean };

let servicoCache: SupabaseClient | null = null;
export function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

export async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const u = user?.user;
  if (!u?.id) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: u.id });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa os contratos.");
  const { data: perfil } = await servico().from("profiles").select("full_name, email").eq("id", u.id).maybeSingle();
  const p = perfil as { full_name?: string | null; email?: string | null } | null;
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "painel";
  return { userId: u.id, email: String((p && p.email) || u.email || ""), nome: String((p && p.full_name) || ""), ip, doChamador };
}

export async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  if (ch.sistema) return;
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

export async function garantirGestao(ch: Chamador, clientId: string) {
  await garantirAcesso(ch, clientId);
  if (ch.sistema) return;
  const { data, error } = await ch.doChamador.rpc("can_manage_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (data !== true) throw new ErroHttp(403, "sem_permissao", "Só admin ou gestor do cliente mexe em contratos.");
}

/** Só o admin mexe no que vale para todos os contratos (modelos e preferências). */
export async function garantirAdmin(ch: Chamador) {
  const { data, error } = await servico().from("user_roles").select("role").eq("user_id", ch.userId).eq("role", "admin").limit(1);
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (!((data as unknown[] | null) ?? []).length) throw new ErroHttp(403, "somente_admin", "Só o admin muda os modelos e as preferências dos contratos.");
}

export const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroHttp(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};
export const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ------------------------------------------------------------------ o contrato como linha

export type Linha = {
  id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: string;
  origem: string;
  numero: string | null;
  versao: number;
  versao_de: string | null;
  substituido_por: string | null;
  proposta_id: string | null;
  servicos: string[];
  variaveis: Valores;
  modelo_versoes: Record<string, number>;
  clausulas_alteradas: ClausulaAlterada[];
  documento_texto: string | null;
  documento_hash: string | null;
  documento_pdf_url: string | null;
  congelado_em: string | null;
  admin_signed_at: string | null;
  client_signed_at: string | null;
  sign_token: string;
  sent_at: string | null;
  original_file_url: string;
  arquivado_em: string | null;
  updated_at: string;
  tipo_documento: "contrato" | "aditivo" | "renovacao";
  contrato_mae_id: string | null;
  renovacao_de: string | null;
  vigencia_fim: string | null;
  [k: string]: unknown;
};

export function normalizarLinha(d: unknown): Linha | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const valores: Valores = {};
  if (o.variaveis && typeof o.variaveis === "object" && !Array.isArray(o.variaveis)) {
    Object.keys(o.variaveis as Record<string, unknown>).forEach((k) => {
      const v = (o.variaveis as Record<string, unknown>)[k];
      if (v !== null && v !== undefined && String(v).trim()) valores[k] = String(v);
    });
  }
  const tipo = o.tipo_documento === "aditivo" || o.tipo_documento === "renovacao" ? o.tipo_documento : "contrato";
  return {
    ...(o as Linha),
    versao: Number(o.versao) || 1,
    servicos: Array.isArray(o.servicos) ? (o.servicos as unknown[]).map(String) : [],
    variaveis: valores,
    modelo_versoes: o.modelo_versoes && typeof o.modelo_versoes === "object" ? (o.modelo_versoes as Record<string, number>) : {},
    clausulas_alteradas: Array.isArray(o.clausulas_alteradas) ? (o.clausulas_alteradas as ClausulaAlterada[]) : [],
    tipo_documento: tipo,
    contrato_mae_id: typeof o.contrato_mae_id === "string" ? o.contrato_mae_id : null,
    renovacao_de: typeof o.renovacao_de === "string" ? o.renovacao_de : null,
    vigencia_fim: typeof o.vigencia_fim === "string" ? o.vigencia_fim : null,
  };
}

let temCon2: boolean | null = null;
/** Lê contratos com as colunas novas quando o banco já as tem (sem elas, as de sempre). */
export async function selecionarContratos(montar: (campos: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> {
  if (temCon2 !== false) {
    const r = await montar(CAMPOS_CON2);
    if (!r.error || !semTabela(r.error)) {
      if (!r.error) temCon2 = true;
      return r;
    }
    temCon2 = false;
  }
  return await montar(CAMPOS);
}
export const bancoTemCon2 = () => temCon2 !== false;
/** Antes de gravar sem ter lido: descobre se o banco já tem as colunas da frente CON2. */
export async function sondarCon2() {
  if (temCon2 !== null) return;
  await selecionarContratos((campos) => servico().from("contracts").select(campos).limit(1));
}

export async function lerLinha(ch: Chamador, contractId: unknown, gestao = false): Promise<Linha> {
  const id = idDe(contractId, "contract_id");
  const { data, error } = await selecionarContratos((campos) => servico().from("contracts").select(campos).eq("id", id).maybeSingle());
  if (error) throw semTabela(error) ? new ErroHttp(503, "banco_sem_contratos", AVISO_BANCO) : new ErroHttp(503, "contrato_indisponivel", "Não foi possível ler o contrato agora.");
  const linha = normalizarLinha(data);
  if (!linha) throw new ErroHttp(404, "contrato_inexistente", "Contrato não encontrado.");
  if (gestao) await garantirGestao(ch, linha.client_id);
  else await garantirAcesso(ch, linha.client_id);
  return linha;
}

export function exigirRascunhoDeModelo(l: Linha) {
  if (l.origem !== "modelo") throw new ErroHttp(409, "contrato_de_arquivo", "Este contrato é um PDF enviado: ele não é montado por modelo.");
  if (l.status !== "draft" || l.congelado_em) throw new ErroHttp(409, "contrato_congelado", "O contrato já foi congelado. Para mudar, crie uma versão nova.");
}

export async function evento(l: { id: string; client_id: string }, tipo: string, resumo: string, detalhe: Record<string, unknown> = {}, criadoPor: string | null = null, extra: { ip?: string | null } = {}) {
  const { error } = await servico().from("contrato_eventos").insert({ contract_id: l.id, client_id: l.client_id, tipo, resumo: resumo.slice(0, 500), detalhe, criado_por: criadoPor, ip: extra.ip || null });
  if (error) registrarFalha("contratos: evento da trilha não gravado", error, { contract_id: l.id, tipo });
}

// ------------------------------------------------------------------ o núcleo que os módulos usam

export type ModeloComEstado = ModeloDeContrato & { ativo: boolean };

export type Agencia = { dados: DadosDaAgencia; faltando: string[]; aviso: string | null; qualificacao: string | null; nome: string | null; representante: string };

export type PedidoDeRascunho = {
  clientId: string;
  servicos: ServicoDoContrato[];
  titulo?: string;
  extra?: Valores;
  projectId?: string | null;
  propostaId?: string | null;
  origemDoEvento?: "criado" | "gerado_do_aceite" | "gerado_do_cliente" | "renovacao_criada" | "aditivo_criado";
  tipoDocumento?: "contrato" | "aditivo" | "renovacao";
  contratoMaeId?: string | null;
  renovacaoDe?: string | null;
  numero?: string | null;
  resumoDoEvento?: string;
  clausulasAlteradas?: ClausulaAlterada[];
};

export type Nucleo = {
  lerModelos: () => Promise<ModeloComEstado[]>;
  lerAgencia: () => Promise<Agencia>;
  exigirAgencia: () => Promise<void>;
  modelosDoContrato: (todos: ModeloComEstado[], versoes: Record<string, number>) => ModeloDeContrato[];
  montar: (l: Linha, todos: ModeloComEstado[], agencia: Agencia, signatarios?: SignatarioDoBanco[]) => ContratoMontado;
  criarRascunho: (ch: Chamador, p: PedidoDeRascunho) => Promise<Linha>;
  atualizarRascunho: (l: Linha, patch: Record<string, unknown>) => Promise<Linha>;
  payloadDoContrato: (ch: Chamador, l: Linha) => Promise<Record<string, unknown>>;
  nomeDoCliente: (clientId: string) => Promise<string>;
  /** Jev: quais blocos um texto livre pede (a mesma leitura do agente). */
  julgar: (texto: string, clientId: string, userId: string, refId: string) => Promise<{ escolhidos: ServicoDoContrato[]; incertos: ServicoDoContrato[] }>;
};
