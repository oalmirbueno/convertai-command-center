/**
 * mesa-identidade: o que toda ação usa (acesso, banco, erros, projeto,
 * eventos). Mesmo padrão da mesa-roteiros: só equipe com acesso ao cliente;
 * erro sai como { error, mensagem } e nunca é engolido (registrarFalha no log
 * e a frase na tela).
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { IaMotorErro, modeloDoPapel as modeloDoPapelDaBase, type ModeloIa } from "../_shared/ia-motor.ts";
import { ErroDaAcao } from "../_shared/acoes-do-agente.ts";
import { lerMarcaCompleta, type MarcaDoCliente } from "../_shared/marca.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { ehEtapaDaIdentidade, type EtapaDaIdentidade, type ModoDoProjeto } from "../_shared/identidade-etapas.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Papéis da frente BASE (20260930000000 e 000200): valem em ia_usos (tarefa e
 * agente), em agente_conversas.agente e em ia_modelos.padrao_para. O diretor de
 * marca é "identidade"; o criador de nomes, "naming".
 */
export const TAREFA = "identidade" as const;
export const AGENTE = "identidade" as const;
export const TAREFA_DO_NAMING = "naming" as const;
export const REF_CONVERSA = "mesa_identidade";
export const NOME_DA_MESA = "Mesa Identidade";

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

const MENSAGEM_MOTOR: Record<string, { status: number; mensagem: string }> = {
  saldo_insuficiente: { status: 402, mensagem: "Saldo insuficiente na carteira de IA deste cliente. Peça a recarga a um admin ou gestor." },
  cota_da_chave_esgotada: { status: 402, mensagem: "A cota do mês da chave de IA deste cliente acabou." },
  cliente_sem_chave: { status: 403, mensagem: "Este cliente não tem chave de IA própria e o uso da chave da agência está desligado para ele." },
  provedor_sem_chave: { status: 503, mensagem: "O provedor deste modelo está sem chave de API configurada." },
};

export function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof ErroDaAcao) return json({ error: err.codigo, mensagem: err.message }, err.status);
  if (err instanceof IaMotorErro) {
    const conhecido = MENSAGEM_MOTOR[err.codigo];
    const status = conhecido?.status ?? (err.status >= 400 ? err.status : 500);
    return json({ ...err.paraJson(), mensagem: conhecido?.mensagem ?? err.message }, status);
  }
  registrarFalha("mesa-identidade: erro inesperado", err);
  return json({ error: "erro_interno", mensagem: "Falha inesperada na Mesa Identidade." }, 500);
}

// ------------------------------------------------------------------ banco e acesso

export type Chamador = { userId: string; token: string; doChamador: SupabaseClient };

let servicoCache: SupabaseClient | null = null;
export function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

function clienteDoChamador(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa a Mesa Identidade.");
  return { userId, token, doChamador: clienteDoChamador(token) };
}

export async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

export const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroHttp(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};
export const idOuNulo = (v: unknown, nome: string): string | null => (v == null || v === "" ? null : idDe(v, nome));
export const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Tabela nova ainda não criada (migration 20260930060000 pendente)? */
export function semTabela(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const m = String(error.message || "");
  return error.code === "42P01" || error.code === "PGRST205" || /idv_[a-z_]+.*(does not exist|schema cache)|relation .*idv_/i.test(m);
}

export const AVISO_BANCO = "O banco ainda não tem as tabelas da Mesa Identidade (migration 20260930060000_mesa_identidade.sql pendente).";

export function erroDoBanco(error: { code?: string; message?: string } | null, codigo: string, frase: string): ErroHttp {
  if (semTabela(error)) return new ErroHttp(503, "banco_sem_identidade", AVISO_BANCO);
  registrarFalha(`mesa-identidade: ${codigo}`, error);
  return new ErroHttp(503, codigo, frase);
}

export async function nomeDoCliente(clientId: string): Promise<string> {
  const { data } = await servico().from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle();
  const p = data as { company_name?: string | null; full_name?: string | null } | null;
  return (p && (p.company_name || p.full_name)) || "Cliente";
}

/** A marca do pedido, conferida contra o cliente (marca de outro cliente vira erro, nunca é usada). */
export async function marcaDoPedido(clientId: string, marcaId: unknown): Promise<MarcaDoCliente | null> {
  const id = idOuNulo(marcaId, "marca_id");
  if (!id) return null;
  const m = await lerMarcaCompleta(servico(), clientId, id).catch((e) => (registrarFalha("mesa-identidade: marca não lida", e), null));
  if (!m) throw new ErroHttp(404, "marca_inexistente", "Esta marca não é deste cliente.");
  return m;
}

/** O nome que o projeto mostra: a marca aberta (se não é a principal) ou o cliente. */
export async function nomeDaMarca(clientId: string, marcaId: string | null): Promise<string> {
  if (marcaId) {
    const m = await lerMarcaCompleta(servico(), clientId, marcaId).catch((e) => (registrarFalha("mesa-identidade: nome da marca", e), null));
    if (m && !m.principal) return m.nome;
  }
  return await nomeDoCliente(clientId);
}

// ------------------------------------------------------------------ modelos de IA

export const raciocinioPara = (m: ModeloIa) => ["medium", "low", "high"].find((r) => (m.raciocinio ?? []).includes(r));

/**
 * O modelo do papel (identidade, naming) pelo helper da frente BASE: o
 * escolhido na tela; senão o padrão do papel; senão o da estratégia.
 */
export async function modeloDoPapel(papel: "identidade" | "naming", pedido?: unknown): Promise<ModeloIa> {
  const escolhido = typeof pedido === "string" && pedido.trim() ? pedido.trim() : null;
  const m = await modeloDoPapelDaBase(papel, escolhido);
  if (!m) throw new ErroHttp(409, "sem_modelo", "O catálogo não tem modelo padrão ativo para a Mesa Identidade.");
  return m;
}

// ------------------------------------------------------------------ projeto

export type LinhaDoProjeto = {
  id: string;
  client_id: string;
  marca_id: string | null;
  modo: ModoDoProjeto;
  com_naming: boolean;
  titulo: string;
  etapa: EtapaDaIdentidade;
  concluidas: string[];
  dados: Record<string, unknown>;
  versao: number;
  estado: "ativo" | "entregue" | "arquivado";
  arquivado_em: string | null;
  custo_usd: number;
  criado_em: string;
  atualizado_em: string;
};

export const CAMPOS_DO_PROJETO = "id, client_id, marca_id, modo, com_naming, titulo, etapa, concluidas, dados, versao, estado, arquivado_em, custo_usd, criado_em, atualizado_em";

export function normalizarProjeto(v: unknown): LinhaDoProjeto | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.client_id !== "string") return null;
  return {
    id: o.id,
    client_id: o.client_id,
    marca_id: typeof o.marca_id === "string" ? o.marca_id : null,
    modo: o.modo === "rebranding" ? "rebranding" : "zero",
    com_naming: o.com_naming === true,
    titulo: String(o.titulo || "Identidade"),
    etapa: ehEtapaDaIdentidade(o.etapa) ? o.etapa : "briefing",
    concluidas: Array.isArray(o.concluidas) ? (o.concluidas as unknown[]).map(String) : ["inicio"],
    dados: o.dados && typeof o.dados === "object" && !Array.isArray(o.dados) ? (o.dados as Record<string, unknown>) : {},
    versao: Number(o.versao) || 1,
    estado: o.estado === "entregue" || o.estado === "arquivado" ? o.estado : "ativo",
    arquivado_em: typeof o.arquivado_em === "string" ? o.arquivado_em : null,
    custo_usd: Number(o.custo_usd) || 0,
    criado_em: String(o.criado_em || ""),
    atualizado_em: String(o.atualizado_em || ""),
  };
}

export async function lerProjeto(ch: Chamador, projetoId: unknown): Promise<LinhaDoProjeto> {
  const id = idDe(projetoId, "projeto_id");
  const { data, error } = await servico().from("idv_projetos").select(CAMPOS_DO_PROJETO).eq("id", id).maybeSingle();
  if (error) throw erroDoBanco(error, "projeto_indisponivel", "Não foi possível ler o projeto de identidade.");
  const p = normalizarProjeto(data);
  if (!p) throw new ErroHttp(404, "projeto_inexistente", "Projeto de identidade não encontrado.");
  await garantirAcesso(ch, p.client_id);
  return p;
}

/**
 * Grava o projeto com a trava de versão: outra pessoa salvou antes = 409
 * (a tela relê e mostra). Devolve a linha nova.
 */
export async function gravarProjeto(p: LinhaDoProjeto, campos: Record<string, unknown>, versaoLida?: number): Promise<LinhaDoProjeto> {
  const base = typeof versaoLida === "number" ? versaoLida : p.versao;
  const { data, error } = await servico()
    .from("idv_projetos")
    .update({ ...campos, versao: base + 1, atualizado_em: new Date().toISOString() })
    .eq("id", p.id)
    .eq("client_id", p.client_id)
    .eq("versao", base)
    .select(CAMPOS_DO_PROJETO)
    .maybeSingle();
  if (error) throw erroDoBanco(error, "projeto_nao_gravado", "Não foi possível gravar o projeto.");
  const novo = normalizarProjeto(data);
  if (!novo) throw new ErroHttp(409, "versao_mudou", "Outra pessoa salvou este projeto agora. A tela vai reler; confira e salve de novo.");
  return novo;
}

/** Junta uma parte dos dados (briefing, pesquisa, sistema...) sem apagar as outras. */
export function dadosComParte(dados: Record<string, unknown>, parte: string, valor: Record<string, unknown>, substituir = false): Record<string, unknown> {
  const antes = dados[parte] && typeof dados[parte] === "object" && !Array.isArray(dados[parte]) ? (dados[parte] as Record<string, unknown>) : {};
  return { ...dados, [parte]: substituir ? valor : { ...antes, ...valor } };
}

// ------------------------------------------------------------------ gancho do documento de entrega

export type TipoDoEvento = "naming_enviado" | "naming_grupo" | "naming_escolhido" | "brandbook_enviado" | "brandbook_publicado" | "brandbook_revogado" | "kit_aplicado" | "projeto_entregue";

/** Registra a entrega com o resumo e as provas (frente DOC lê daqui). Nunca derruba quem chamou. */
export async function registrarEvento(e: { clientId: string; marcaId?: string | null; projetoId?: string | null; tipo: TipoDoEvento; resumo: string; provas?: Record<string, unknown>; userId: string }) {
  const { error } = await servico().from("idv_eventos").insert({
    client_id: e.clientId,
    marca_id: e.marcaId ?? null,
    projeto_id: e.projetoId ?? null,
    tipo: e.tipo,
    resumo: e.resumo.slice(0, 1000),
    provas: e.provas || {},
    criado_por: e.userId,
  });
  if (error) registrarFalha("mesa-identidade: evento de entrega não gravado", error, { tipo: e.tipo });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * PDF para Arquivos > Documentos estratégicos com a revisão interna da
 * agência pedida (mesmo caminho da Mesa Roteiros). Idempotente pela chave.
 */
export async function pdfParaAprovacao(
  ch: Chamador,
  e: { clientId: string; bytes: Uint8Array; nome: string; chave: string; descricao: string; tags: string[] },
): Promise<{ file_id: string; ja_existia: boolean; revisao_solicitada: boolean; aviso: string | null }> {
  const chave = e.chave.slice(0, 480);
  const { data: existente } = await servico().from("files").select("id, client_id, agency_approval_status").eq("idempotency_key", chave).maybeSingle();
  const ja = existente as { id: string; client_id: string; agency_approval_status: string | null } | null;
  let fileId: string;
  if (ja) {
    if (ja.client_id !== e.clientId) throw new ErroHttp(409, "chave_de_arquivo_em_uso", "O registro deste envio pertence a outro cliente.");
    fileId = ja.id;
  } else {
    fileId = crypto.randomUUID();
    const caminho = `${e.clientId}/${fileId}/v1/${e.nome}`;
    const { error: erroUpload } = await ch.doChamador.storage.from("files").upload(caminho, new Blob([new Uint8Array(e.bytes)], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
    if (erroUpload) throw new ErroHttp(503, "envio_de_arquivo_falhou", "Não foi possível enviar o PDF para Arquivos. Tente de novo.", { detalhe: erroUpload.message });
    const { data: registro, error: erroRegistro } = await ch.doChamador.rpc("create_file_record", {
      p_file: {
        id: fileId,
        client_id: e.clientId,
        file_name: e.nome,
        file_url: `files://${caminho}`,
        file_type: "documento",
        mime_type: "application/pdf",
        extension: "pdf",
        storage_bucket: "files",
        storage_path: caminho,
        size_bytes: e.bytes.byteLength,
        sha256: await sha256Hex(e.bytes),
        folder: "estrategicos",
        tags: e.tags,
        status: "ready",
        version: 1,
        description: e.descricao.slice(0, 1000),
        idempotency_key: chave,
      },
    });
    if (erroRegistro || !registro) {
      await ch.doChamador.storage.from("files").remove([caminho]).catch((x) => registrarFalha("mesa-identidade: PDF órfão não removido", x));
      throw new ErroHttp(503, "registro_de_arquivo_falhou", "O PDF subiu, mas o registro em Arquivos falhou. Tente de novo.", { detalhe: erroRegistro?.message ?? null });
    }
    fileId = (registro as { id: string }).id;
  }
  let revisao = true;
  let aviso: string | null = null;
  if (!ja || !ja.agency_approval_status || ja.agency_approval_status === "not_requested") {
    const { error } = await ch.doChamador.rpc("request_file_agency_review", { p_file_id: fileId });
    revisao = !error;
    if (error) {
      aviso = `O PDF foi para Arquivos, mas a revisão não foi pedida: ${error.message}`;
      registrarFalha("mesa-identidade: revisão da agência não pedida", error, { file_id: fileId });
    }
  }
  return { file_id: fileId, ja_existia: !!ja, revisao_solicitada: revisao, aviso };
}

/** Bytes de um arquivo do bucket mesa (só do cliente; nunca lança: null e log). */
export async function baixarDoBucket(clientId: string, caminho: string, maxBytes = 6_000_000): Promise<Uint8Array | null> {
  if (!caminho || caminho.indexOf(`${clientId}/`) !== 0 || caminho.indexOf("..") >= 0) return null;
  const { data, error } = await servico().storage.from("mesa").download(caminho);
  if (error || !data) {
    registrarFalha("mesa-identidade: arquivo do bucket não baixado", error || new Error("vazio"), { caminho: caminho.slice(0, 200) });
    return null;
  }
  if (data.size > maxBytes) return null;
  return new Uint8Array(await data.arrayBuffer());
}
