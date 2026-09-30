/**
 * briefing-publico: o que o link público do briefing (/briefing/:token)
 * precisa e o banco sozinho não faz (frente BRF, 30/09/2026). Sem login
 * (verify_jwt = false): o token do link é a chave, e tudo aqui confere o
 * token, o estado (enviado, expirado, arquivado) e os tetos antes de agir.
 *
 * POST com os cabeçalhos x-briefing-token e x-briefing-acao:
 * - capa -> { logo_cliente_url, agencia_nome } (logo do cliente ou da marca, link assinado de 1 hora;
 *   sem logo: null; o nome da agência vem de Dados da agência, frente BASE)
 * - anexar (corpo = bytes do arquivo; x-briefing-campo, x-briefing-categoria,
 *   x-briefing-nome, x-briefing-pedido) -> { anexo } (vai para Arquivos do cliente)
 * - remover_anexo { anexo_id } -> { ok } (arquiva a ligação; o arquivo fica em Arquivos para a equipe)
 * - decupar -> { status } (depois do envio; idempotente por envio)
 * - transcrever (corpo = bytes do áudio; x-briefing-campo, x-briefing-duracao) -> { texto, segundos }
 *   (frente BRF2: resposta por áudio; ver transcrever.ts)
 *
 * Ler, salvar parcial, enviar e pedir reabertura são RPCs do banco
 * (briefing_public_get/save/submit/pedir_reabertura), que não passam aqui.
 * O mesmo desenho de envio do /inbox/:token (workspace-inbox): reserva no
 * banco com a linha travada, bytes contados no caminho até o Storage.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createCountingInboxStream, sanitizeInboxText } from "../_shared/workspace-inbox-policy.ts";
import { ANEXO_MAX_BYTES, EXTENSOES_DE_ANEXO, PASTA_DO_ANEXO, estadoDoLink } from "../_shared/briefing-modelos.ts";
import { decuparBriefing, ErroDaDecupagem } from "../_shared/briefing-decupar.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { lerDadosDaAgencia, nomeDaAgencia } from "../_shared/dados-da-agencia.ts";
import { transcrever } from "./transcrever.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-briefing-token, x-briefing-acao, x-briefing-campo, x-briefing-categoria, x-briefing-nome, x-briefing-pedido, x-briefing-duracao",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" },
  });
}
const erro = (codigo: string, mensagem: string, status: number) => json({ error: codigo, mensagem }, status);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

type BriefingDoToken = {
  id: string;
  client_id: string | null;
  project_id: string | null;
  marca_id: string | null;
  modelo: string | null;
  submitted: boolean | null;
  expira_em: string | null;
};

async function briefingDoToken(token: string): Promise<BriefingDoToken | null> {
  if (!token || token.length < 20 || token.length > 80) return null;
  const { data, error } = await servico()
    .from("briefings")
    .select("id, client_id, project_id, marca_id, modelo, submitted, expira_em")
    .eq("token", token)
    .is("arquivado_em", null)
    .maybeSingle();
  if (error) throw new Error(`briefing indisponível: ${error.message}`);
  return (data as BriefingDoToken | null) ?? null;
}

function decodificar(v: string | null): string {
  if (!v || v.length > 2048) return "";
  try {
    return decodeURIComponent(v);
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------ capa

async function capa(b: BriefingDoToken) {
  const agencia = await lerDadosDaAgencia(servico() as never).then(
    (d) => nomeDaAgencia(d),
    (e) => (registrarFalha("briefing-publico: dados da agência não lidos", e), null),
  );
  const r = await logoDaCapa(b);
  return json({ logo_cliente_url: r, agencia_nome: agencia });
}

async function logoDaCapa(b: BriefingDoToken): Promise<string | null> {
  if (!b.client_id) return null;
  let caminho: string | null = null;
  if (b.marca_id) {
    const { data } = await servico().from("cliente_marcas").select("logo_path, principal").eq("id", b.marca_id).eq("client_id", b.client_id).maybeSingle();
    const m = data as { logo_path: string | null; principal: boolean } | null;
    // Outra marca nunca herda a logo do cliente (heranca-da-marca.ts): sem logo própria, fica sem.
    if (m && !m.principal) return await logoAssinada(b, m.logo_path);
    if (m?.logo_path) caminho = m.logo_path;
  }
  if (!caminho) {
    const { data } = await servico().from("cliente_kit_marca").select("logo_path").eq("client_id", b.client_id).maybeSingle();
    caminho = (data as { logo_path: string | null } | null)?.logo_path ?? null;
  }
  return await logoAssinada(b, caminho);
}

async function logoAssinada(b: BriefingDoToken, caminho: string | null): Promise<string | null> {
  if (!caminho) return null;
  const { data: assinado, error } = await servico().storage.from("mesa").createSignedUrl(caminho, 3600);
  if (error) {
    registrarFalha("briefing-publico: logo do cliente sem link", error, { briefing_id: b.id });
    return null;
  }
  return assinado?.signedUrl ?? null;
}

// ------------------------------------------------------------------ anexar

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic",
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv",
  ai: "application/postscript", eps: "application/postscript", psd: "image/vnd.adobe.photoshop", cdr: "application/octet-stream", zip: "application/zip",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg",
};

const TIPO_DO_ARQUIVO: Record<string, string> = { logo: "logo", manual: "documento", fotos: "foto", videos: "video", textos: "documento", referencias: "foto", outros: "documento" };

const MOTIVO_DA_RESERVA: Record<string, [number, string]> = {
  inexistente: [404, "Link inválido ou arquivado."],
  enviado: [409, "Este briefing já foi enviado."],
  expirado: [410, "Este link expirou. Peça um novo à equipe."],
  sem_cliente: [409, "Este link não está ligado a um cliente e não aceita arquivos."],
  grande: [413, "O arquivo passa de 25 MB."],
  muitos_anexos: [409, "Este briefing já tem 40 arquivos. Envie o resto pela equipe."],
  cota: [413, "Os arquivos deste briefing passam de 300 MB no total."],
  devagar: [429, "Muitos arquivos em um minuto. Espere um pouco e tente de novo."],
  campo_invalido: [400, "Pergunta inválida para anexo."],
};

function storageUrl(caminho: string) {
  const base = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "");
  return `${base}/storage/v1/object/files/${caminho.split("/").map(encodeURIComponent).join("/")}`;
}

async function tamanhoGuardado(caminho: string): Promise<number | null> {
  const i = caminho.lastIndexOf("/");
  const { data, error } = await servico().storage.from("files").list(caminho.slice(0, i), { limit: 2, search: caminho.slice(i + 1) });
  if (error) return null;
  const m = data?.find((e) => e.name === caminho.slice(i + 1));
  const n = Number(m?.metadata?.size);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

async function anexar(req: Request, token: string, b: BriefingDoToken) {
  if (estadoDoLink(b) !== "aberto") return erro(b.submitted ? "enviado" : "expirado", b.submitted ? "Este briefing já foi enviado." : "Este link expirou. Peça um novo à equipe.", b.submitted ? 409 : 410);
  const tamanho = Number(req.headers.get("content-length"));
  if (!Number.isSafeInteger(tamanho) || tamanho <= 0) return erro("tamanho_obrigatorio", "O tamanho do envio é obrigatório.", 411);
  if (tamanho > ANEXO_MAX_BYTES) return erro("grande", "O arquivo passa de 25 MB.", 413);
  if (!req.body) return erro("sem_arquivo", "Escolha um arquivo.", 400);

  const nomeBruto = decodificar(req.headers.get("x-briefing-nome"));
  const nome = sanitizeInboxText(nomeBruto, 200);
  const ext = (nome.indexOf(".") >= 0 ? nome.split(".").pop() || "" : "").toLowerCase();
  if (!nome || EXTENSOES_DE_ANEXO.indexOf(ext) < 0) return erro("tipo_nao_aceito", "Este tipo de arquivo não é aceito. Envie imagem, PDF, documento, planilha, vetor, zip ou vídeo.", 415);
  const campo = (req.headers.get("x-briefing-campo") || "").trim() || null;
  const categoria = (req.headers.get("x-briefing-categoria") || "outros").trim();
  const mime = MIME[ext] ?? "application/octet-stream";

  const { data: reserva, error: erroReserva } = await servico().rpc("briefing_anexo_reservar", {
    _token: token,
    _campo: campo,
    _categoria: categoria,
    _nome: nome,
    _mime: mime,
    _tamanho: tamanho,
  });
  if (erroReserva) {
    registrarFalha("briefing-publico: reserva do anexo falhou", erroReserva, { briefing_id: b.id });
    return erro("reserva_falhou", "Não foi possível começar o envio. Tente de novo.", 503);
  }
  const r = reserva as { ok: boolean; motivo?: string; anexo_id?: string; client_id?: string; project_id?: string | null } | null;
  if (!r?.ok || !r.anexo_id || !r.client_id) {
    const [st, msg] = MOTIVO_DA_RESERVA[r?.motivo || ""] ?? [400, "Não foi possível aceitar o arquivo."];
    return erro(r?.motivo || "recusado", msg, st);
  }

  const anexoId = r.anexo_id;
  const fileId = crypto.randomUUID();
  const seguro = nome.replace(/[^\w.\-]+/g, "_").slice(0, 180) || `arquivo.${ext}`;
  const caminho = `${r.client_id}/${fileId}/v1/${seguro}`;
  const falhar = async (codigo: string, mensagem: string, status: number, limparStorage: boolean) => {
    if (limparStorage) {
      const { error } = await servico().storage.from("files").remove([caminho]);
      if (error) registrarFalha("briefing-publico: arquivo órfão no Storage", error, { caminho });
    }
    await servico().from("briefing_anexos").update({ status: "falhou", erro: codigo }).eq("id", anexoId).then(
      () => undefined,
      (e: unknown) => registrarFalha("briefing-publico: estado do anexo não gravado", e, { anexo_id: anexoId }),
    );
    return erro(codigo, mensagem, status);
  };

  const contado = createCountingInboxStream(req.body, tamanho, ANEXO_MAX_BYTES);
  let resposta: Response;
  try {
    resposta = await fetch(storageUrl(caminho), {
      method: "POST",
      headers: {
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        "content-type": mime,
        "cache-control": "no-store",
        "x-upsert": "false",
      },
      body: contado.stream,
    });
  } catch (e) {
    registrarFalha("briefing-publico: envio ao Storage caiu", e, { anexo_id: anexoId });
    const v = contado.violation();
    if (v === "max_size") return await falhar("grande", "O arquivo passa de 25 MB.", 413, true);
    if (v === "declared_length") return await falhar("tamanho_divergente", "O tamanho recebido não confere com o envio.", 400, true);
    return await falhar("envio_falhou", "O envio caiu no meio. Tente de novo.", 502, true);
  }
  await resposta.body?.cancel().catch(() => undefined);
  const guardado = await tamanhoGuardado(caminho);
  if (!resposta.ok && guardado === null) return await falhar("envio_falhou", "O armazenamento recusou o arquivo. Tente de novo.", 502, false);
  if (contado.bytesRead() !== tamanho || guardado !== tamanho) return await falhar("tamanho_divergente", "O tamanho recebido não confere com o envio.", 400, true);

  const { error: erroArquivo } = await servico().from("files").insert({
    id: fileId,
    client_id: r.client_id,
    project_id: r.project_id ?? null,
    uploaded_by: r.client_id,
    file_name: nome,
    file_url: `files://${caminho}`,
    file_type: TIPO_DO_ARQUIVO[categoria] ?? "documento",
    folder: PASTA_DO_ANEXO[categoria] ?? "base",
    mime_type: mime,
    extension: ext,
    storage_bucket: "files",
    storage_path: caminho,
    size_bytes: tamanho,
    tags: ["briefing", categoria],
    visibility: "internal",
    sensitivity: "normal",
    source: "briefing",
    status: "ready",
    approval_status: "none",
    agency_approval_status: "not_requested",
    requires_approval: false,
    version: 1,
    description: "Enviado pelo cliente no link do briefing.",
    idempotency_key: `briefing-anexo:${anexoId}`,
  });
  if (erroArquivo) {
    registrarFalha("briefing-publico: registro em Arquivos falhou", erroArquivo, { anexo_id: anexoId });
    return await falhar("registro_falhou", "O arquivo subiu, mas não foi registrado. Tente de novo.", 503, true);
  }
  const { error: erroFim } = await servico()
    .from("briefing_anexos")
    .update({ status: "pronto", file_id: fileId, storage_path: caminho, concluido_em: new Date().toISOString() })
    .eq("id", anexoId);
  if (erroFim) {
    registrarFalha("briefing-publico: anexo não concluído", erroFim, { anexo_id: anexoId, file_id: fileId });
    return erro("conclusao_falhou", "O arquivo foi para Arquivos, mas não ficou ligado ao briefing. Avise a equipe.", 503);
  }
  return json({ anexo: { id: anexoId, campo, categoria, nome, tamanho, mime } });
}

async function removerAnexo(req: Request, b: BriefingDoToken) {
  if (estadoDoLink(b) !== "aberto") return erro("fechado", "Depois de enviado ou expirado, os arquivos ficam como estão.", 409);
  let corpo: Record<string, unknown> = {};
  try {
    corpo = await req.json();
  } catch { /* corpo vazio */ }
  const id = String(corpo.anexo_id ?? "");
  if (!UUID.test(id)) return erro("anexo_invalido", "Arquivo inválido.", 400);
  const { data, error } = await servico()
    .from("briefing_anexos")
    .update({ arquivado_em: new Date().toISOString(), arquivado_por: "cliente" })
    .eq("id", id)
    .eq("briefing_id", b.id)
    .is("arquivado_em", null)
    .select("id");
  if (error) {
    registrarFalha("briefing-publico: remover anexo falhou", error, { anexo_id: id });
    return erro("remover_falhou", "Não foi possível tirar o arquivo agora.", 503);
  }
  if (!data || !(data as unknown[]).length) return erro("anexo_inexistente", "Arquivo não encontrado neste briefing.", 404);
  return json({ ok: true });
}

async function decupar(b: BriefingDoToken) {
  if (!b.submitted) return erro("nao_enviado", "A decupagem começa depois do envio.", 409);
  try {
    const r = await decuparBriefing(servico(), b.id, {});
    return json({ status: r.decupagem?.status ?? null, motivo: r.motivo ?? null });
  } catch (e) {
    const codigo = e instanceof ErroDaDecupagem ? e.codigo : "decupagem_falhou";
    registrarFalha("briefing-publico: decupagem depois do envio falhou", e, { briefing_id: b.id });
    // O envio já está gravado e a equipe já foi avisada: o painel refaz a decupagem.
    return json({ status: "falhou", motivo: codigo });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return erro("metodo_nao_permitido", "Use POST.", 405);
  const token = (req.headers.get("x-briefing-token") || "").trim();
  const acao = (req.headers.get("x-briefing-acao") || "").trim();
  try {
    const b = await briefingDoToken(token);
    if (!b) return erro("inexistente", "Link inválido ou arquivado.", 404);
    if (acao === "capa") return await capa(b);
    if (acao === "anexar") return await anexar(req, token, b);
    if (acao === "remover_anexo") return await removerAnexo(req, b);
    if (acao === "decupar") return await decupar(b);
    if (acao === "transcrever") return await transcrever(req, token, b, servico(), json);
    return erro("acao_desconhecida", "Ação desconhecida.", 400);
  } catch (e) {
    registrarFalha("briefing-publico: erro inesperado", e, { acao });
    return erro("erro_interno", "Falha inesperada. Tente de novo.", 500);
  }
});
