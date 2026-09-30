/**
 * briefing-agente: o que todas as ações da equipe usam (frente BRF, 30/09/2026;
 * separado em módulo na frente BRF2 para as ações novas ficarem em arquivos
 * próprios, sem inchar o index). Login, acesso ao cliente, leitura do link e o
 * registro de cada ação (gancho do documento de entrega).
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { auditLog } from "../_shared/mcp-audit.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { type DadosSabidos, type LinhaDeModelo } from "../_shared/briefing-modelos.ts";
import { contasDaMarcaDoCliente, marcasDoCliente } from "../_shared/marca.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CAMPOS_DO_BRIEFING =
  "id, token, client_id, project_id, marca_id, modelo, modelo_versao, modelo_conteudo, prefill, titulo, responses, submitted, expira_em, enviado_em, envios, reabertura_pedida_em, reabertura_motivo, reaberto_em, arquivado_em, arquivo_pdf_id, created_at";

export class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public extra: Record<string, unknown> = {}) {
    super(mensagem);
  }
}

// ------------------------------------------------------------------ banco e acesso

export type Chamador = { userId: string; doChamador: SupabaseClient };

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
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe gera e lê briefings.");
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, doChamador };
}

export async function garantirAcesso(ch: Chamador, clientId: string | null) {
  if (!clientId || !UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "Escolha o cliente.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

/** Só admin (editar modelos: mesma régua do RLS de briefing_modelos). */
export async function garantirAdmin(ch: Chamador) {
  const { data, error } = await servico().rpc("has_role", { _user_id: ch.userId, _role: "admin" });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (data !== true) throw new ErroHttp(403, "somente_admin", "Só um admin muda os modelos de briefing.");
}

export const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroHttp(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};
export const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export type LinhaDoBriefing = {
  id: string;
  token: string;
  client_id: string | null;
  project_id: string | null;
  marca_id: string | null;
  modelo: string | null;
  modelo_versao: number | null;
  modelo_conteudo: unknown;
  prefill: Record<string, unknown> | null;
  titulo: string | null;
  responses: Record<string, unknown> | null;
  submitted: boolean | null;
  expira_em: string | null;
  enviado_em: string | null;
  envios: number | null;
  reabertura_pedida_em: string | null;
  arquivado_em: string | null;
  arquivo_pdf_id: string | null;
  created_at: string;
};

export async function lerBriefing(ch: Chamador, briefingId: unknown, campos = CAMPOS_DO_BRIEFING): Promise<LinhaDoBriefing & Record<string, unknown>> {
  const id = idDe(briefingId, "briefing_id");
  const { data, error } = await servico().from("briefings").select(campos).eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(503, "briefing_indisponivel", "Não foi possível ler o briefing.");
  if (!data) throw new ErroHttp(404, "briefing_inexistente", "Briefing não encontrado.");
  const b = data as unknown as LinhaDoBriefing & Record<string, unknown>;
  // Briefing antigo sem cliente: só admin mexe (is_staff já conferido; can_access_client pede cliente).
  if (b.client_id) await garantirAcesso(ch, b.client_id);
  else {
    const { data: admin } = await servico().rpc("has_role", { _user_id: ch.userId, _role: "admin" });
    if (admin !== true) throw new ErroHttp(403, "somente_admin", "Briefing sem cliente: só um admin mexe nele.");
  }
  return b;
}

export async function nomeDoCliente(clientId: string | null): Promise<{ nome: string; telefone: string | null }> {
  if (!clientId) return { nome: "Cliente", telefone: null };
  const { data } = await servico().from("profiles").select("company_name, full_name, phone").eq("id", clientId).maybeSingle();
  const p = data as { company_name?: string | null; full_name?: string | null; phone?: string | null } | null;
  return { nome: (p && (p.company_name || p.full_name)) || "Cliente", telefone: p?.phone ?? null };
}

export async function registrar(ch: Chamador, toolName: string, input: Record<string, unknown>, resultRef: string | null) {
  await auditLog({
    correlationId: crypto.randomUUID(),
    toolName,
    origin: "mesa:briefing-agente",
    keyId: `mesa:briefing-agente:${ch.userId}`,
    scopes: ["briefings:write"],
    input,
    success: true,
    statusCode: 200,
    durationMs: 0,
    resultRef: resultRef ?? undefined,
  });
}

export async function linhasDeModelos(): Promise<LinhaDeModelo[]> {
  const { data, error } = await servico().from("briefing_modelos").select("slug, versao, conteudo, ativo").eq("ativo", true);
  if (error) {
    // Sem a tabela (migração pendente) ou fora do ar: valem os de fábrica, com o motivo no log.
    registrarFalha("briefing-agente: modelos do banco não lidos", error);
    return [];
  }
  return (data as LinhaDeModelo[] | null) ?? [];
}

/**
 * Grava respostas pelo mesmo caminho do link (RPC briefing_public_save): junta
 * por chave com a linha travada, então a equipe e o cliente preenchendo ao
 * mesmo tempo não apagam um ao outro. null apaga a chave.
 */
export async function salvarPeloLink(token: string, mudancas: Record<string, unknown>): Promise<{ salvo_em: string; respostas: Record<string, unknown> }> {
  const { data, error } = await servico().rpc("briefing_public_save", { _token: token, _mudancas: mudancas });
  if (error) {
    registrarFalha("briefing-agente: respostas não gravadas", error);
    throw new ErroHttp(503, "respostas_nao_gravadas", "Não foi possível gravar as respostas agora. Tente de novo.");
  }
  const r = data as { ok?: boolean; motivo?: string; salvo_em?: string; respostas?: Record<string, unknown> } | null;
  if (!r || !r.ok) {
    const motivo = r?.motivo || "recusado";
    const frase: Record<string, string> = {
      enviado: "O cliente já enviou este briefing. Para mudar, reabra o link.",
      expirado: "O link expirou. Estenda a validade antes de preencher.",
      grande: "As respostas passaram do tamanho aceito.",
      inexistente: "Link inválido ou arquivado.",
    };
    throw new ErroHttp(409, `briefing_${motivo}`, frase[motivo] || "O briefing não aceitou as respostas.");
  }
  return { salvo_em: String(r.salvo_em || new Date().toISOString()), respostas: r.respostas || {} };
}

// ------------------------------------------------------------------ o que o painel já sabe do cliente

/** Dado já sabido (empresa, site, Instagram, negócio...), pela regra de herança da marca. */
export async function dadosSabidos(clientId: string, marcaId: string | null): Promise<DadosSabidos> {
  const dados: DadosSabidos = {};
  const [perfil, kit, marcas] = await Promise.all([
    servico().from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle(),
    servico().from("cliente_kit_marca").select("contexto").eq("client_id", clientId).maybeSingle(),
    marcasDoCliente(servico(), clientId).catch((e) => (registrarFalha("briefing-agente: marcas não lidas", e), [])),
  ]);
  const p = perfil.data as { company_name?: string | null; full_name?: string | null } | null;
  const marca = marcaId ? marcas.find((m) => m.id === marcaId) ?? null : null;
  const outraMarca = !!marca && !marca.principal;
  dados.empresa = (outraMarca ? marca!.nome : p?.company_name || p?.full_name) || undefined;

  // Contexto: a outra marca só com o dela (regra de herança); a principal e o cliente com o do kit.
  let contexto: Record<string, unknown> = {};
  if (outraMarca) {
    const { data } = await servico().from("cliente_marcas").select("contexto").eq("id", marca!.id).eq("client_id", clientId).maybeSingle();
    contexto = ((data as { contexto?: Record<string, unknown> } | null)?.contexto) || {};
  } else {
    contexto = ((kit.data as { contexto?: Record<string, unknown> } | null)?.contexto) || {};
  }
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  dados.negocio = texto(contexto.negocio) || undefined;
  dados.publico = texto(contexto.publico) || undefined;
  dados.oferta = texto(contexto.oferta) || undefined;
  if (Array.isArray(contexto.diferenciais)) dados.diferenciais = (contexto.diferenciais as unknown[]).map(String).join("; ") || undefined;
  dados.site = texto(contexto.site) || undefined;

  // Instagram: a conta da marca (ou do cliente, sem marca).
  const { data: contas } = await servico().from("external_accounts").select("id, platform, handle").eq("client_id", clientId).eq("platform", "instagram");
  let lista = ((contas as Array<{ id: string; handle: string | null }> | null) ?? []).filter((c) => c.handle);
  if (marca) {
    const ids = await contasDaMarcaDoCliente(servico(), clientId, marca);
    if (ids) lista = lista.filter((c) => ids.indexOf(c.id) >= 0);
  }
  if (lista[0]?.handle) dados.instagram = lista[0].handle.indexOf("@") === 0 ? lista[0].handle : `@${lista[0].handle}`;
  return dados;
}
