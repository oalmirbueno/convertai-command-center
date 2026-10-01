/**
 * conselho, frente BRF2 (30/09/2026): elencos salvos, pauta com anexos e a
 * ata em PDF.
 *
 * - elencos { client_id } -> { elencos } (os da agência e os do cliente, sem os arquivados)
 * - salvar_elenco { client_id, nome, especialistas[], modelos?, criterios?, rodadas, modo, preset?, da_agencia? } -> { elenco }
 * - arquivar_elenco { elenco_id } -> { elenco } (apagar = arquivar)
 * - ata_pdf { sessao_id } -> { file_id, url, nome_do_arquivo, ja_existia } (Arquivos > Documentos
 *   operacionais, só a equipe vê; gerado pelo pdf-base, sem IA)
 *
 * Tudo por dependência (ctx): o index passa o banco, o acesso e as leituras.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { ESPECIALISTAS, type FalaDoConselho, LIMITES, type SessaoDoConselho } from "./modulos/conselho.ts";
import { ehPreset, MAX_TRECHO_DO_ANEXO, modoDe, type PautaDoConselho, pautaDoPedido } from "./modulos/conselho-presets.ts";
import { gerarPdfDaAta, nomeDoPdfDaAta } from "./modulos/pdf-ata-do-conselho.ts";
import { ehImagemDoPdf, imagemParaPdf } from "../_shared/pdf-base.ts";
import { lerDadosDaAgencia, lerLogoDaAgencia } from "../_shared/dados-da-agencia.ts";

export type CtxDoConselho = {
  userId: string;
  servico: SupabaseClient;
  doChamador: SupabaseClient;
  garantirAcesso(clientId: string): Promise<void>;
  lerSessao(id: unknown): Promise<SessaoDoConselho>;
  lerFalas(id: string): Promise<FalaDoConselho[]>;
  nomeDoCliente(id: string): Promise<string>;
  rotulosDosModelos(s: SessaoDoConselho): Promise<Record<string, string>>;
  json(body: unknown, status?: number): Response;
  erro(status: number, codigo: string, mensagem: string): Error;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS_DO_ELENCO = "id, client_id, nome, preset, especialistas, modelos, criterios, rodadas, modo, criado_por, criado_em, atualizado_em, arquivado_em";
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\u2014|\u2013/g, ",").trim().slice(0, max) : "");

// ------------------------------------------------------------------ pauta com anexos

/**
 * A pauta que vai para a sessão: os itens e, de cada arquivo escolhido (só do
 * próprio cliente, fora de quarentena e sem ser sensível), o trecho de texto
 * que o painel já extraiu (file_content_chunks). Arquivo sem texto entra só
 * com o nome.
 */
export async function pautaComAnexos(db: SupabaseClient, clientId: string, bruto: unknown): Promise<PautaDoConselho> {
  const pedido = pautaDoPedido(bruto);
  if (!pedido.anexos.length) return { itens: pedido.itens, anexos: [] };
  const { data, error } = await db.from("files").select("id, client_id, file_name, description, status, sensitivity, archived_at").in("id", pedido.anexos);
  if (error) {
    registrarFalha("conselho: anexos da pauta não lidos", error, { client_id: clientId });
    return { itens: pedido.itens, anexos: [] };
  }
  const arquivos = ((data as Array<{ id: string; client_id: string; file_name: string; description: string | null; status: string | null; sensitivity: string | null; archived_at: string | null }> | null) ?? [])
    .filter((f) => f.client_id === clientId && f.status !== "quarantined" && (!f.sensitivity || f.sensitivity === "normal") && !f.archived_at);
  const anexos = await Promise.all(arquivos.map(async (f) => {
    const { data: partes, error: e } = await db.from("file_content_chunks").select("text, chunk_index").eq("file_id", f.id).order("chunk_index", { ascending: true }).limit(4);
    if (e) registrarFalha("conselho: texto do anexo não lido", e, { file_id: f.id });
    const corpo = ((partes as Array<{ text: string }> | null) ?? []).map((p) => p.text).join("\n").replace(/\s+/g, " ").trim();
    const trecho = [f.description ? `Descrição: ${f.description}` : "", corpo].filter(Boolean).join("\n").slice(0, MAX_TRECHO_DO_ANEXO);
    return { file_id: f.id, nome: f.file_name.slice(0, 160), trecho };
  }));
  return { itens: pedido.itens, anexos };
}

// ------------------------------------------------------------------ elencos salvos

export async function elencos(ctx: CtxDoConselho, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await ctx.garantirAcesso(clientId);
  const { data, error } = await ctx.servico.from("conselho_elencos").select(CAMPOS_DO_ELENCO).is("arquivado_em", null).or(`client_id.is.null,client_id.eq.${clientId}`).order("criado_em", { ascending: false }).limit(40);
  if (error) {
    registrarFalha("conselho: elencos não lidos", error);
    throw ctx.erro(503, "elencos_indisponiveis", "Não foi possível ler os elencos salvos agora.");
  }
  return ctx.json({ elencos: data ?? [] });
}

export async function salvarElenco(ctx: CtxDoConselho, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await ctx.garantirAcesso(clientId);
  const nome = texto(corpo.nome, 80);
  if (nome.length < 2) throw ctx.erro(400, "nome_vazio", "Dê um nome ao elenco.");
  const conhecidos = ESPECIALISTAS.map((e) => e.id);
  const especialistas: string[] = [];
  (Array.isArray(corpo.especialistas) ? corpo.especialistas : []).forEach((x) => {
    const id = String(x || "");
    if (conhecidos.indexOf(id) >= 0 && especialistas.indexOf(id) < 0) especialistas.push(id);
  });
  if (especialistas.length < LIMITES.MIN_ESPECIALISTAS || especialistas.length > LIMITES.MAX_ESPECIALISTAS) throw ctx.erro(400, "elenco_invalido", `O elenco precisa de ${LIMITES.MIN_ESPECIALISTAS} a ${LIMITES.MAX_ESPECIALISTAS} especialistas.`);
  const modelos: Record<string, string> = {};
  const brutos = corpo.modelos && typeof corpo.modelos === "object" && !Array.isArray(corpo.modelos) ? (corpo.modelos as Record<string, unknown>) : {};
  especialistas.forEach((id) => {
    const m = texto(brutos[id], 120);
    if (m) modelos[id] = m;
  });
  const criterios = (Array.isArray(corpo.criterios) ? corpo.criterios : []).map((c) => texto(c, 60)).filter((c) => c.length >= 3).slice(0, 5);
  const modo = modoDe(corpo.modo);
  const rodadas = modo === "rapido" ? 2 : modo === "profundo" ? 4 : Math.max(LIMITES.MIN_RODADAS, Math.min(LIMITES.MAX_RODADAS, Math.round(Number(corpo.rodadas) || 4)));
  const { data, error } = await ctx.servico.from("conselho_elencos").insert({
    client_id: corpo.da_agencia === true ? null : clientId,
    nome,
    preset: ehPreset(corpo.preset) ? corpo.preset : null,
    especialistas,
    modelos,
    criterios,
    rodadas,
    modo,
    criado_por: ctx.userId,
  }).select(CAMPOS_DO_ELENCO).single();
  if (error || !data) {
    registrarFalha("conselho: elenco não gravado", error);
    throw ctx.erro(503, "elenco_nao_gravado", "Não foi possível salvar o elenco agora.");
  }
  return ctx.json({ elenco: data });
}

export async function arquivarElenco(ctx: CtxDoConselho, corpo: Record<string, unknown>) {
  const id = String(corpo.elenco_id || "");
  if (!UUID.test(id)) throw ctx.erro(400, "elenco_id_invalido", "elenco_id precisa ser um UUID.");
  const { data: linha, error } = await ctx.servico.from("conselho_elencos").select("id, client_id").eq("id", id).maybeSingle();
  if (error) throw ctx.erro(503, "elencos_indisponiveis", "Não foi possível ler o elenco agora.");
  if (!linha) throw ctx.erro(404, "elenco_inexistente", "Elenco não encontrado.");
  const dono = (linha as { client_id: string | null }).client_id;
  if (dono) await ctx.garantirAcesso(dono);
  const { data, error: e2 } = await ctx.servico.from("conselho_elencos").update({ arquivado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq("id", id).select(CAMPOS_DO_ELENCO).single();
  if (e2) throw ctx.erro(503, "elenco_nao_gravado", "Não foi possível arquivar o elenco agora.");
  return ctx.json({ elenco: data });
}

// ------------------------------------------------------------------ ata em PDF

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ataEmPdf(ctx: CtxDoConselho, corpo: Record<string, unknown>) {
  const sessao = await ctx.lerSessao(corpo.sessao_id);
  const falas = await ctx.lerFalas(sessao.id);
  const [cliente, modelos] = await Promise.all([ctx.nomeDoCliente(sessao.client_id), ctx.rotulosDosModelos(sessao)]);
  // A logo da agência (dados da agência) quando abre direto; senão a padrão.
  let logo = null;
  try {
    const dados = await lerDadosDaAgencia(ctx.servico as never);
    const lida = dados ? await lerLogoDaAgencia(ctx.servico as never, dados) : null;
    const img = lida ? imagemParaPdf(lida.bytes) : null;
    logo = ehImagemDoPdf(img) ? img : null;
  } catch (e) {
    registrarFalha("conselho: logo da agência não lida para a ata", e);
  }
  const bytes = gerarPdfDaAta(sessao, falas, { cliente, modelos, logo });
  const sha = await sha256Hex(bytes);
  const nome = nomeDoPdfDaAta(sessao);
  const chave = `conselho-ata:${sessao.id}:${sha.slice(0, 24)}`;
  const assinar = async (caminho: string | null) => {
    if (!caminho) return null;
    const { data } = await ctx.doChamador.storage.from("files").createSignedUrl(caminho, 3600, { download: nome });
    return data?.signedUrl ?? null;
  };
  const { data: existente } = await ctx.servico.from("files").select("id, client_id, storage_path").eq("idempotency_key", chave).maybeSingle();
  const ja = existente as { id: string; client_id: string; storage_path: string | null } | null;
  if (ja && ja.client_id === sessao.client_id) return ctx.json({ file_id: ja.id, url: await assinar(ja.storage_path), nome_do_arquivo: nome, ja_existia: true });
  const fileId = crypto.randomUUID();
  const caminho = `${sessao.client_id}/${fileId}/v1/${nome}`;
  const { error: erroUpload } = await ctx.doChamador.storage.from("files").upload(caminho, new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (erroUpload) throw ctx.erro(503, "envio_de_arquivo_falhou", `Não foi possível salvar o PDF da ata em Arquivos: ${erroUpload.message}`);
  const projectId = typeof sessao.referencia.project_id === "string" && UUID.test(sessao.referencia.project_id) ? sessao.referencia.project_id : null;
  const { data: registro, error: erroRegistro } = await ctx.doChamador.rpc("create_file_record", {
    p_file: {
      id: fileId,
      client_id: sessao.client_id,
      project_id: projectId,
      file_name: nome,
      file_url: `files://${caminho}`,
      file_type: "documento",
      mime_type: "application/pdf",
      extension: "pdf",
      storage_bucket: "files",
      storage_path: caminho,
      size_bytes: bytes.byteLength,
      sha256: sha,
      folder: "operacionais",
      tags: ["conselho", "ata", sessao.origem],
      status: "ready",
      version: 1,
      description: `Ata do conselho: ${sessao.tema}.`.slice(0, 1000),
      idempotency_key: chave,
    },
  });
  if (erroRegistro || !registro) {
    const { error: e } = await ctx.doChamador.storage.from("files").remove([caminho]);
    if (e) registrarFalha("conselho: PDF da ata órfão no Storage", e, { caminho });
    throw ctx.erro(503, "registro_de_arquivo_falhou", `O PDF subiu, mas o registro em Arquivos falhou: ${erroRegistro?.message ?? "sem resposta"}`);
  }
  const id = (registro as { id: string }).id;
  const { error: e2 } = await ctx.servico.from("conselho_sessoes").update({ ata_file_id: id, atualizado_em: new Date().toISOString() }).eq("id", sessao.id);
  if (e2) registrarFalha("conselho: PDF da ata não ligado à sessão", e2, { file_id: id });
  return ctx.json({ file_id: id, url: await assinar(caminho), nome_do_arquivo: nome, ja_existia: false });
}
