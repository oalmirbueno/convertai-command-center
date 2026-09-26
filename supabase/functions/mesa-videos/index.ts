/**
 * mesa-videos: escrita da Mesa Vídeos (Frente V2, 25/09/2026).
 * Contrato: docs/mesa-videos/CONTRATO.md (seção "V2: o que foi construído").
 *
 * POST { acao, ... }, só equipe com acesso ao cliente. A tela LÊ direto das
 * tabelas (RLS: equipe lê); tudo o que ESCREVE passa por aqui (service_role).
 * Nenhuma ação chama IA nem gasta: preparar pedido grava parâmetros e custo
 * estimado; o executor de vídeo e de transcrição fica "em breve" até existir
 * motor no catálogo.
 *
 * Acervo de vídeo (bucket mesa, <cliente>/video/brutos/<id>.<ext>; original imutável):
 * - arquivo_registrar { client_id, arquivos: [{ storage_path, nome_original, mime?, bytes?, duracao_s?, largura?, altura?, sha256?, gravado_em?, tipo? }] }
 *     -> { arquivos, duplicados } (mesmo sha256 do mesmo cliente: não duplica, o envio novo sai do Storage)
 * - arquivo_editar { arquivo_id, campos: { nome?, grupo?, roteiro_id?, cena_ref?, melhor?, nota?, tipo?, estado? } } -> { arquivo, desfazer }
 * Organizador de takes (contrato comum das ações; propostas em video_acoes):
 * - takes_organizar_propor { client_id } -> { mensagem_id, acao | null, roteiros }
 * - executar_acao_agente { mensagem_id, acao_id?, descartar? } -> { anexo, feitos, falhas }
 * - desfazer_acao_agente { mensagem_id, acao_id? } -> { anexo, voltaram, falharam }
 * Pedidos preparados (sem gasto):
 * - pedido_preparar { client_id, tipo: animar_cena|transcrever|legendar, alvo, parametros, modelo_texto? } -> { pedido, ja_existia }
 * - pedido_cancelar { pedido_id } -> { pedido }
 * Roteiro e cenas (roteiro_id da Mesa Roteiros, sem FK):
 * - vinculo_salvar { client_id, roteiro_id, cena_ref, canvas_id, no_id } -> { vinculo }
 * - vinculo_remover { vinculo_id } -> { removido }
 * Pacote para editar:
 * - pacote_montar { client_id, titulo, roteiro_id?, canvas_id?, arquivo_ids?, direcao?, destino?, fps?, formato? } -> { pacote }
 * Memória por vídeo:
 * - versao_registrar { client_id, video_id?, titulo, arquivo_id?, roteiro_id?, custo_usd?, nota?, estado? } -> { versao }
 * - versao_feedback { versao_id, texto, tempo_s? } -> { versao }
 * - versao_decidir { versao_id, decisao: aprovar|rejeitar, motivo? } -> { versao }
 * Computador do agente (desligado por padrão; COMPUTADOR_DO_AGENTE_LIGADO=1):
 * - computador_pedir { client_id?, titulo, app, passos } -> { tarefa } (ou 409 desligado)
 * - computador_decidir { tarefa_id, estado: aprovada|cancelada } -> { tarefa }
 *
 * Sem travessão.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { auditLog } from "../_shared/mcp-audit.ts";
import {
  type AcaoDoAgente,
  acaoGuardadaNaMensagem,
  confirmarAcaoGuardada,
  desfazerAcaoGuardada,
  ErroDaAcao,
  type ItemDaAcaoDoAgente,
  type ResultadoDoItem,
} from "../_shared/acoes-do-agente.ts";
import {
  acaoDaOrganizacao,
  camposDaOperacao,
  camposDoDesfazer,
  type CamposDoTake,
  desfazerDaOperacao,
  limparGrupo,
  limparNome,
  MAX_CENA_REF,
  proporOrganizacao,
  type RoteiroParaOrganizar,
  type TakeParaOrganizar,
  TIPOS_DE_ARQUIVO,
} from "../_shared/organizador-de-takes.ts";
import {
  chaveDoPedido,
  estimarPedido,
  executorDoPedido,
  MODELO_PADRAO_DO_TEXTO,
  normalizarParametros,
  PRECOS_REFERENCIA,
  TIPOS_DE_PEDIDO,
  type TipoDePedido,
} from "../_shared/pedidos-de-video.ts";
import { comFeedback, decidir, motivoParaNaoMudar, normalizarVersao, normalizarVersoes, proximoNumero } from "../_shared/memoria-de-video.ts";
import { montarPacote, type TakeDoPacote } from "../_shared/pacote-de-edicao.ts";
import { conhecimentoEdicao } from "../_shared/conhecimento-edicao.ts";
import { normalizarRoteirosAprovados, type RoteiroAprovado, VIEW_DOS_ROTEIROS, viewAindaNaoExiste } from "../_shared/roteiros-para-video.ts";
import { computadorLigado, motivoParaRecusar, normalizarPedidoDeTarefa, podeMudarEstado, type EstadoDaTarefa } from "../_shared/computador-do-agente.ts";

/** Direção de edição do pacote (motor mesa_videos.direcao_de_edicao em motores.ts). */
const CONHECIMENTO_DA_EDICAO = conhecimentoEdicao("pacote").texto;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "mesa";
const MAX_ARQUIVOS_POR_CHAMADA = 20;
const MAX_BYTES_VIDEO = 4 * 1024 * 1024 * 1024;
const MIMES_ACEITOS = /^(video|audio)\//;
const EXTENSOES_ACEITAS = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mts", "wav", "mp3", "m4a", "aac"];
const URL_DO_PACOTE_S = 24 * 3600;
const TABELA_DAS_ACOES = "video_acoes";

class ErroHttp extends Error {
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

type Chamador = { userId: string; token: string; doChamador: SupabaseClient; admin: boolean };

// ------------------------------------------------------------------ banco e acesso

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
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

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa a Mesa Vídeos.");
  const { data: ehAdmin } = await servico().rpc("has_role", { _user_id: userId, _role: "admin" });
  return { userId, token, doChamador: clienteDoChamador(token), admin: ehAdmin === true };
}

async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroHttp(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};

const idOuNulo = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return UUID.test(s) ? s : null;
};

/** Tabela que ainda não existe no banco (SQL V2-01 não aplicado). */
function erroDeTabela(error: { message?: string; code?: string } | null, tabela: string): ErroHttp {
  const m = String((error && error.message) || "");
  if (/does not exist|schema cache|42P01|PGRST205/i.test(m) || (error && error.code === "42P01")) {
    return new ErroHttp(503, "banco_sem_mesa_videos", `A Mesa Vídeos ainda não foi ativada no banco (tabela ${tabela}). Aplique o SQL V2-01.`);
  }
  return new ErroHttp(500, "banco_indisponivel", "Não foi possível gravar agora. Tente de novo.");
}

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof ErroDaAcao) return json({ error: err.codigo, mensagem: err.message }, err.status);
  console.error("[mesa-videos] erro inesperado", { nome: err instanceof Error ? err.name : "desconhecido" });
  return json({ error: "erro_interno", mensagem: "Falha inesperada na Mesa Vídeos." }, 500);
}

async function auditar(ch: Chamador, ferramenta: string, input: Record<string, unknown>, sucesso: boolean, ref?: string) {
  await auditLog({
    correlationId: crypto.randomUUID(),
    toolName: ferramenta,
    origin: "mesa:mesa-videos",
    keyId: `mesa:mesa-videos:${ch.userId}`,
    scopes: ["files:write"],
    input,
    success: sucesso,
    statusCode: sucesso ? 200 : 207,
    durationMs: 0,
    resultRef: ref,
  });
}

// ------------------------------------------------------------------ leituras

const COLUNAS_DO_ARQUIVO =
  "id, client_id, nome, nome_original, storage_bucket, storage_path, tipo, mime, bytes, duracao_s, largura, altura, sha256, gravado_em, roteiro_id, cena_ref, grupo, melhor, nota, estado, criado_por, criado_em, atualizado_em";

type LinhaDoArquivo = TakeParaOrganizar & {
  client_id: string;
  storage_bucket: string;
  storage_path: string;
  mime: string | null;
  bytes: number | null;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
  sha256: string | null;
  nota: string | null;
};

async function lerArquivo(id: string): Promise<LinhaDoArquivo> {
  const { data, error } = await servico().from("video_arquivos").select(COLUNAS_DO_ARQUIVO).eq("id", id).maybeSingle();
  if (error) throw erroDeTabela(error, "video_arquivos");
  if (!data) throw new ErroHttp(404, "arquivo_inexistente", "Arquivo de vídeo não encontrado.");
  return data as LinhaDoArquivo;
}

async function lerArquivosDoCliente(clientId: string, incluirArquivados = false): Promise<LinhaDoArquivo[]> {
  let q = servico().from("video_arquivos").select(COLUNAS_DO_ARQUIVO).eq("client_id", clientId).order("criado_em", { ascending: true }).limit(2000);
  if (!incluirArquivados) q = q.eq("estado", "ativo");
  const { data, error } = await q;
  if (error) throw erroDeTabela(error, "video_arquivos");
  return (data || []) as LinhaDoArquivo[];
}

/** Roteiros aprovados da Mesa Roteiros (view do contrato); sem a view, lista vazia. */
async function lerRoteiros(clientId: string): Promise<{ roteiros: RoteiroAprovado[]; disponivel: boolean }> {
  const { data, error } = await servico().from(VIEW_DOS_ROTEIROS).select("id, client_id, titulo, aprovado_em, cenas").eq("client_id", clientId).limit(200);
  if (error) {
    if (viewAindaNaoExiste(error.message || "")) return { roteiros: [], disponivel: false };
    throw new ErroHttp(502, "roteiros_indisponiveis", "Não foi possível ler os roteiros aprovados agora.");
  }
  return { roteiros: normalizarRoteirosAprovados(data), disponivel: true };
}

const paraOrganizar = (r: RoteiroAprovado): RoteiroParaOrganizar => ({
  id: r.id,
  titulo: r.titulo,
  cenas: r.cenas.map((c) => ({ ref: c.ref, ordem: c.ordem, titulo: c.titulo })),
});

async function arquivosEmVersaoAprovada(clientId: string): Promise<string[]> {
  const { data } = await servico().from("video_versoes").select("arquivo_id").eq("client_id", clientId).eq("estado", "aprovada").limit(1000);
  return ((data || []) as { arquivo_id: string | null }[]).map((x) => x.arquivo_id).filter((x): x is string => !!x);
}

// ------------------------------------------------------------------ acervo de vídeo

const extensao = (nome: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(nome || "");
  return m ? m[1].toLowerCase() : "";
};

const numero = (v: unknown, min = 0): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) && n >= min ? n : null;
};

async function arquivoRegistrar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const lista = Array.isArray(corpo.arquivos) ? (corpo.arquivos as Record<string, unknown>[]).slice(0, MAX_ARQUIVOS_POR_CHAMADA) : [];
  if (!lista.length) throw new ErroHttp(400, "sem_arquivos", "Nenhum arquivo para registrar.");
  const prefixo = `${clientId}/video/brutos/`;
  const registrados: unknown[] = [];
  const duplicados: { nome: string; igual_a: string }[] = [];
  const recusados: { nome: string; motivo: string }[] = [];

  for (const a of lista) {
    const caminho = String(a.storage_path || "");
    const nomeOriginal = String(a.nome_original || caminho.split("/").pop() || "video").slice(0, 255);
    const ext = extensao(caminho);
    if (caminho.indexOf(prefixo) !== 0 || caminho.indexOf("..") >= 0 || caminho.split("/").length !== 4) {
      recusados.push({ nome: nomeOriginal, motivo: "caminho fora da pasta de vídeos do cliente" });
      continue;
    }
    if (EXTENSOES_ACEITAS.indexOf(ext) < 0 || (a.mime && !MIMES_ACEITOS.test(String(a.mime)))) {
      recusados.push({ nome: nomeOriginal, motivo: "formato não aceito (vídeo ou áudio)" });
      continue;
    }
    const bytes = numero(a.bytes);
    if (bytes !== null && bytes > MAX_BYTES_VIDEO) {
      recusados.push({ nome: nomeOriginal, motivo: "acima de 4 GB" });
      continue;
    }
    // O arquivo precisa existir no Storage (a tela sobe antes de registrar).
    const pasta = caminho.slice(0, caminho.lastIndexOf("/"));
    const arquivo = caminho.slice(caminho.lastIndexOf("/") + 1);
    const { data: achados, error: eLista } = await servico().storage.from(BUCKET).list(pasta, { search: arquivo, limit: 5 });
    if (eLista || !(achados || []).some((x: { name: string }) => x.name === arquivo)) {
      recusados.push({ nome: nomeOriginal, motivo: "arquivo não encontrado no armazenamento" });
      continue;
    }
    const sha = typeof a.sha256 === "string" && /^[0-9a-f]{64}$/.test(a.sha256) ? a.sha256 : null;
    if (sha) {
      const { data: igual, error: eIgual } = await servico()
        .from("video_arquivos")
        .select("id, nome")
        .eq("client_id", clientId)
        .eq("sha256", sha)
        .eq("estado", "ativo")
        .limit(1)
        .maybeSingle();
      if (eIgual) throw erroDeTabela(eIgual, "video_arquivos");
      if (igual) {
        // Reenvio do mesmo conteúdo: não duplica o arquivo nem mexe nas ligações do que já existe.
        await servico().storage.from(BUCKET).remove([caminho]).then(() => undefined, () => undefined);
        duplicados.push({ nome: nomeOriginal, igual_a: String((igual as { nome: string }).nome) });
        continue;
      }
    }
    const tipo = (TIPOS_DE_ARQUIVO as readonly string[]).indexOf(String(a.tipo)) >= 0 ? String(a.tipo) : ext === "wav" || ext === "mp3" || ext === "m4a" || ext === "aac" ? "audio" : "bruto";
    const gravado = a.gravado_em && !isNaN(Date.parse(String(a.gravado_em))) ? new Date(String(a.gravado_em)).toISOString() : null;
    const linha = {
      client_id: clientId,
      nome: limparNome(nomeOriginal) || "video",
      nome_original: nomeOriginal,
      storage_bucket: BUCKET,
      storage_path: caminho,
      tipo,
      mime: a.mime ? String(a.mime).slice(0, 80) : null,
      bytes,
      duracao_s: numero(a.duracao_s),
      largura: numero(a.largura, 1),
      altura: numero(a.altura, 1),
      sha256: sha,
      gravado_em: gravado,
      criado_por: ch.userId,
    };
    const { data, error } = await servico().from("video_arquivos").insert(linha).select(COLUNAS_DO_ARQUIVO).single();
    if (error) {
      if (/duplicate key/i.test(error.message || "")) {
        recusados.push({ nome: nomeOriginal, motivo: "já registrado" });
        continue;
      }
      throw erroDeTabela(error, "video_arquivos");
    }
    registrados.push(data);
  }
  await auditar(ch, "video_arquivo_registrar", { client_id: clientId, registrados: registrados.length, duplicados: duplicados.length, recusados: recusados.length }, true);
  return json({ arquivos: registrados, duplicados, recusados });
}

/** Campos que a equipe pode mudar num arquivo (o original e o caminho nunca). */
function camposPermitidos(bruto: unknown): CamposDoTake & { nota?: string | null; tipo?: string } {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const c: CamposDoTake & { nota?: string | null; tipo?: string } = {};
  if ("nome" in o) {
    const n = limparNome(o.nome);
    if (!n) throw new ErroHttp(400, "nome_vazio", "Dê um nome ao take.");
    c.nome = n;
  }
  if ("grupo" in o) c.grupo = o.grupo === null ? null : limparGrupo(o.grupo) || null;
  if ("roteiro_id" in o) {
    if (o.roteiro_id !== null && !UUID.test(String(o.roteiro_id))) throw new ErroHttp(400, "roteiro_id_invalido", "roteiro_id precisa ser um UUID.");
    c.roteiro_id = o.roteiro_id ? String(o.roteiro_id) : null;
  }
  if ("cena_ref" in o) c.cena_ref = o.cena_ref ? String(o.cena_ref).trim().slice(0, MAX_CENA_REF) || null : null;
  if ("melhor" in o) c.melhor = o.melhor === true;
  if ("estado" in o) c.estado = o.estado === "arquivado" ? "arquivado" : "ativo";
  if ("nota" in o) c.nota = o.nota ? String(o.nota).replace(/\s+/g, " ").trim().slice(0, 600) || null : null;
  if ("tipo" in o) {
    if ((TIPOS_DE_ARQUIVO as readonly string[]).indexOf(String(o.tipo)) < 0) throw new ErroHttp(400, "tipo_invalido", "Tipo de arquivo desconhecido.");
    c.tipo = String(o.tipo);
  }
  if (!Object.keys(c).length) throw new ErroHttp(400, "sem_mudanca", "Nada para mudar.");
  return c;
}

async function gravarCampos(clientId: string, id: string, campos: Record<string, unknown>) {
  const { data, error } = await servico()
    .from("video_arquivos")
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .eq("client_id", clientId)
    .select(COLUNAS_DO_ARQUIVO)
    .single();
  if (error) throw erroDeTabela(error, "video_arquivos");
  return data as LinhaDoArquivo;
}

async function arquivoEditar(ch: Chamador, corpo: Record<string, unknown>) {
  const atual = await lerArquivo(idDe(corpo.arquivo_id, "arquivo_id"));
  await garantirAcesso(ch, atual.client_id);
  const campos = camposPermitidos(corpo.campos);
  if (campos.estado === "arquivado") {
    const aprovados = await arquivosEmVersaoAprovada(atual.client_id);
    if (aprovados.indexOf(atual.id) >= 0) throw new ErroHttp(409, "em_versao_aprovada", "Este arquivo está numa versão aprovada: fica no acervo.");
  }
  const desfazer: Record<string, unknown> = {};
  Object.keys(campos).forEach((k) => {
    const v = (atual as unknown as Record<string, unknown>)[k];
    desfazer[k] = v === undefined ? null : v;
  });
  const arquivo = await gravarCampos(atual.client_id, atual.id, campos as Record<string, unknown>);
  await auditar(ch, "video_arquivo_editar", { client_id: atual.client_id, arquivo_id: atual.id, campos: Object.keys(campos) }, true, atual.id);
  return json({ arquivo, desfazer });
}

// ------------------------------------------------------------------ organizador de takes

async function takesOrganizarPropor(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const [arquivos, rot, aprovados] = await Promise.all([lerArquivosDoCliente(clientId), lerRoteiros(clientId), arquivosEmVersaoAprovada(clientId)]);
  const takes: TakeParaOrganizar[] = arquivos.map((a) => ({ ...a, em_versao_aprovada: aprovados.indexOf(a.id) >= 0 }));
  const roteiros = rot.roteiros.map(paraOrganizar);
  const itens = proporOrganizacao(takes, roteiros);
  const acao = acaoDaOrganizacao(takes, itens, roteiros, {
    id: `organizador-${Date.now().toString(36)}`,
    resumo: itens.length
      ? `Organizar ${new Set(itens.map((i) => i.arquivo_id)).size} takes por roteiro e cena, com nomes no padrão roteiro_c01_t01. O arquivo original não muda.`
      : "",
  });
  if (!acao) return json({ mensagem_id: null, acao: null, roteiros_disponiveis: rot.disponivel });
  const { data, error } = await servico().from(TABELA_DAS_ACOES).insert({ client_id: clientId, anexos: [acao], criado_por: ch.userId }).select("id").single();
  if (error) throw erroDeTabela(error, TABELA_DAS_ACOES);
  return json({ mensagem_id: (data as { id: string }).id, acao, roteiros_disponiveis: rot.disponivel });
}

async function propostaGuardada(ch: Chamador, corpo: Record<string, unknown>) {
  try {
    return await acaoGuardadaNaMensagem(servico(), corpo.mensagem_id, (clientId) => garantirAcesso(ch, clientId), {
      tabela: TABELA_DAS_ACOES,
      acaoId: corpo.acao_id,
      agente: "organizador_de_takes",
    });
  } catch (e) {
    if (e instanceof ErroDaAcao && e.codigo === "mensagem_indisponivel") throw new ErroHttp(503, "banco_sem_mesa_videos", "A Mesa Vídeos ainda não foi ativada no banco. Aplique o SQL V2-01.");
    throw e;
  }
}

async function executarNoTake(clientId: string, item: ItemDaAcaoDoAgente): Promise<{ desfazer: Record<string, unknown> }> {
  const atual = await lerArquivo(item.alvo_id);
  if (atual.client_id !== clientId) throw new Error("Arquivo de outro cliente.");
  if (item.operacao === "arquivar") {
    const aprovados = await arquivosEmVersaoAprovada(clientId);
    if (aprovados.indexOf(atual.id) >= 0) throw new Error("Está numa versão aprovada: fica no acervo.");
  }
  const desfazer = desfazerDaOperacao(atual, item.operacao);
  await gravarCampos(clientId, atual.id, camposDaOperacao(item.operacao, item.para) as Record<string, unknown>);
  return { desfazer };
}

async function executarAcao(ch: Chamador, corpo: Record<string, unknown>) {
  const guardada = await propostaGuardada(ch, corpo);
  const clientId = guardada.mensagem.client_id;
  const r: { anexo: AcaoDoAgente; resultados: ResultadoDoItem[] } = await confirmarAcaoGuardada(guardada, (item) => executarNoTake(clientId, item), {
    descartar: corpo.descartar === true,
    userId: ch.userId,
    lote: 3,
  });
  if (corpo.descartar === true) return json({ anexo: r.anexo });
  const feitos = r.resultados.filter((x) => x.ok).length;
  const falhas = r.resultados.length - feitos;
  await auditar(ch, "video_organizar_takes", { client_id: clientId, mensagem_id: guardada.mensagem.id, operacoes: r.anexo.itens.map((i) => i.operacao) }, falhas === 0, guardada.mensagem.id);
  return json({ anexo: r.anexo, feitos, falhas });
}

async function desfazerAcao(ch: Chamador, corpo: Record<string, unknown>) {
  const guardada = await propostaGuardada(ch, corpo);
  const clientId = guardada.mensagem.client_id;
  const r = await desfazerAcaoGuardada(
    guardada,
    async (x) => {
      const campos = camposDoDesfazer(x.desfazer);
      if (!Object.keys(campos).length) return;
      await gravarCampos(clientId, x.alvo_id, campos as Record<string, unknown>);
    },
    { userId: ch.userId },
  );
  await auditar(ch, "video_desfazer_organizacao", { client_id: clientId, mensagem_id: guardada.mensagem.id }, r.falharam.length === 0, guardada.mensagem.id);
  return json({ anexo: r.anexo, voltaram: r.voltaram, falharam: r.falharam });
}

// ------------------------------------------------------------------ pedidos preparados

async function pedidoPreparar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const tipo = String(corpo.tipo || "") as TipoDePedido;
  if ((TIPOS_DE_PEDIDO as readonly string[]).indexOf(tipo) < 0) throw new ErroHttp(400, "tipo_invalido", "Tipo de pedido desconhecido.");
  const alvoBruto = corpo.alvo && typeof corpo.alvo === "object" ? (corpo.alvo as Record<string, unknown>) : {};
  const alvo: Record<string, unknown> = {};
  if (tipo === "animar_cena") {
    alvo.canvas_id = idDe(alvoBruto.canvas_id, "canvas_id");
    alvo.no_id = String(alvoBruto.no_id || "").slice(0, 80);
    if (!alvo.no_id) throw new ErroHttp(400, "no_id_invalido", "Diga qual cena animar.");
    const { data: cena, error: eCena } = await servico()
      .from("foto_cenas_da_historia")
      .select("canvas_id, client_id, no_id, numero, titulo, imagem_id, resultados")
      .eq("canvas_id", alvo.canvas_id)
      .eq("no_id", alvo.no_id)
      .maybeSingle();
    if (eCena) throw new ErroHttp(503, "historia_indisponivel", "A História do Canvas ainda não está no banco (SQL V-01).");
    if (!cena || (cena as { client_id: string }).client_id !== clientId) throw new ErroHttp(404, "cena_inexistente", "Cena não encontrada na História deste cliente.");
    const c = cena as { numero: number; titulo: string | null; imagem_id: string | null; resultados: unknown };
    const temFoto = !!c.imagem_id || (Array.isArray(c.resultados) && (c.resultados as { status?: string }[]).some((r) => r && r.status === "gerada"));
    if (!temFoto) throw new ErroHttp(409, "cena_sem_foto", "A cena ainda não tem foto: a foto da cena é o primeiro quadro do vídeo.");
    alvo.numero = c.numero;
    alvo.titulo = c.titulo || null;
  } else {
    const arquivo = await lerArquivo(idDe(alvoBruto.arquivo_id, "arquivo_id"));
    if (arquivo.client_id !== clientId) throw new ErroHttp(404, "arquivo_inexistente", "Arquivo de vídeo não encontrado.");
    alvo.arquivo_id = arquivo.id;
    alvo.nome = arquivo.nome;
    if (!(corpo.parametros && typeof corpo.parametros === "object" && "duracao_s" in (corpo.parametros as object))) {
      corpo.parametros = { ...((corpo.parametros as object) || {}), duracao_s: arquivo.duracao_s };
    }
  }
  const { data: catalogo } = await servico().from("ia_modelos").select("id, tipo, ativo, rotulo").eq("ativo", true).limit(500);
  const params = normalizarParametros(tipo, corpo.parametros);
  const escolhido = tipo === "animar_cena" ? (params as { motor_video: string | null }).motor_video : null;
  const executor = executorDoPedido(tipo, (catalogo || []) as { id: string; tipo: string; ativo: boolean; rotulo: string | null }[], escolhido);
  if (tipo === "animar_cena") (params as { motor_video: string | null }).motor_video = executor.executor === "em_breve" ? null : executor.executor;
  const modeloTexto = PRECOS_REFERENCIA.modelos.some((m) => m.modelo === corpo.modelo_texto) ? String(corpo.modelo_texto) : MODELO_PADRAO_DO_TEXTO;
  const estimativa = estimarPedido(tipo, params, modeloTexto);
  const chave = chaveDoPedido(tipo, alvo, params);

  const { data: existente, error: eExistente } = await servico()
    .from("video_pedidos")
    .select("*")
    .eq("client_id", clientId)
    .eq("chave", chave)
    .neq("estado", "cancelado")
    .limit(1)
    .maybeSingle();
  if (eExistente) throw erroDeTabela(eExistente, "video_pedidos");
  if (existente) return json({ pedido: existente, ja_existia: true });

  const { data, error } = await servico()
    .from("video_pedidos")
    .insert({
      client_id: clientId,
      tipo,
      alvo,
      parametros: params,
      custo_estimado: { ...estimativa, modelo_texto: modeloTexto },
      executor: executor.executor,
      estado: executor.estado,
      chave,
      criado_por: ch.userId,
    })
    .select("*")
    .single();
  if (error) throw erroDeTabela(error, "video_pedidos");
  await auditar(ch, "video_pedido_preparar", { client_id: clientId, tipo, executor: executor.executor }, true, (data as { id: string }).id);
  return json({ pedido: data, ja_existia: false });
}

async function pedidoCancelar(ch: Chamador, corpo: Record<string, unknown>) {
  const id = idDe(corpo.pedido_id, "pedido_id");
  const { data: atual, error } = await servico().from("video_pedidos").select("id, client_id, estado").eq("id", id).maybeSingle();
  if (error) throw erroDeTabela(error, "video_pedidos");
  if (!atual) throw new ErroHttp(404, "pedido_inexistente", "Pedido não encontrado.");
  await garantirAcesso(ch, (atual as { client_id: string }).client_id);
  const { data, error: e2 } = await servico().from("video_pedidos").update({ estado: "cancelado", atualizado_em: new Date().toISOString() }).eq("id", id).select("*").single();
  if (e2) throw erroDeTabela(e2, "video_pedidos");
  return json({ pedido: data });
}

// ------------------------------------------------------------------ roteiro e cenas

async function vinculoSalvar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const roteiroId = idDe(corpo.roteiro_id, "roteiro_id");
  const canvasId = idDe(corpo.canvas_id, "canvas_id");
  const cenaRef = String(corpo.cena_ref || "").trim().slice(0, MAX_CENA_REF);
  const noId = String(corpo.no_id || "").trim().slice(0, 80);
  if (!cenaRef || !noId) throw new ErroHttp(400, "vinculo_incompleto", "Escolha a cena do roteiro e a cena da História.");
  const { data: canvas } = await servico().from("foto_canvas").select("id, client_id").eq("id", canvasId).maybeSingle();
  if (!canvas || (canvas as { client_id: string }).client_id !== clientId) throw new ErroHttp(404, "canvas_inexistente", "Canvas não encontrado neste cliente.");
  const { data, error } = await servico()
    .from("video_vinculos")
    .upsert({ client_id: clientId, roteiro_id: roteiroId, cena_ref: cenaRef, canvas_id: canvasId, no_id: noId, estado: "confirmado", criado_por: ch.userId }, { onConflict: "roteiro_id,cena_ref,canvas_id,no_id" })
    .select("*")
    .single();
  if (error) throw erroDeTabela(error, "video_vinculos");
  return json({ vinculo: data });
}

async function vinculoRemover(ch: Chamador, corpo: Record<string, unknown>) {
  const id = idDe(corpo.vinculo_id, "vinculo_id");
  const { data: atual, error } = await servico().from("video_vinculos").select("*").eq("id", id).maybeSingle();
  if (error) throw erroDeTabela(error, "video_vinculos");
  if (!atual) return json({ removido: false });
  await garantirAcesso(ch, (atual as { client_id: string }).client_id);
  const { error: e2 } = await servico().from("video_vinculos").delete().eq("id", id);
  if (e2) throw erroDeTabela(e2, "video_vinculos");
  // O vínculo é uma ligação (não um conteúdo): tirar é seguro e a tela oferece refazer com os mesmos dados.
  return json({ removido: true, vinculo: atual });
}

// ------------------------------------------------------------------ pacote para editar

async function pacoteMontar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const [{ data: perfil }, arquivos, rot] = await Promise.all([
    servico().from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle(),
    lerArquivosDoCliente(clientId),
    lerRoteiros(clientId),
  ]);
  const roteiroId = idOuNulo(corpo.roteiro_id);
  const roteiro = roteiroId ? rot.roteiros.find((r) => r.id === roteiroId) || null : null;
  const ids = Array.isArray(corpo.arquivo_ids) ? (corpo.arquivo_ids as unknown[]).map(String) : null;
  const escolhidos = arquivos.filter((a) => (ids ? ids.indexOf(a.id) >= 0 : roteiroId ? a.roteiro_id === roteiroId : true));
  const caminhos = escolhidos.map((a) => a.storage_path);
  const urls: Record<string, string> = {};
  if (caminhos.length) {
    const { data: assinadas } = await servico().storage.from(BUCKET).createSignedUrls(caminhos, URL_DO_PACOTE_S);
    ((assinadas || []) as { path: string | null; signedUrl: string }[]).forEach((x) => {
      if (x.path && x.signedUrl) urls[x.path] = x.signedUrl;
    });
  }
  let historia = null;
  const canvasId = idOuNulo(corpo.canvas_id);
  if (canvasId) {
    const { data: cenas } = await servico()
      .from("foto_cenas_da_historia")
      .select("canvas_id, client_id, canvas_nome, no_id, numero, titulo, acao, narrativa, enquadramento, imagem_id")
      .eq("canvas_id", canvasId)
      .eq("client_id", clientId)
      .order("numero", { ascending: true });
    const lista = (cenas || []) as { canvas_nome: string; no_id: string; numero: number; titulo: string | null; acao: string | null; narrativa: string | null; enquadramento: string | null; imagem_id: string | null }[];
    if (lista.length) {
      historia = {
        canvas_id: canvasId,
        nome: lista[0].canvas_nome || "História",
        cenas: lista.map((c) => ({ numero: c.numero, no_id: c.no_id, titulo: c.titulo || "", acao: c.acao || "", narrativa: c.narrativa || "", enquadramento: c.enquadramento || "livre", imagem_id: c.imagem_id })),
      };
    }
  }
  const { data: pedidos } = await servico().from("video_pedidos").select("alvo, estado, resultado, tipo").eq("client_id", clientId).in("tipo", ["transcrever", "legendar"]).neq("estado", "cancelado");
  const legendas = ((pedidos || []) as { alvo: { arquivo_id?: string }; estado: string; resultado: { srt?: string } | null }[])
    .filter((p) => p.alvo && p.alvo.arquivo_id)
    .map((p) => ({ arquivo_id: String(p.alvo.arquivo_id), estado: p.estado, srt: p.resultado && typeof p.resultado.srt === "string" ? p.resultado.srt : null }));
  const takes: TakeDoPacote[] = escolhidos.map((a) => ({ ...a, url: urls[a.storage_path] || null }));
  const p = perfil as { company_name?: string | null; full_name?: string | null } | null;
  const fps = numero(corpo.fps, 1);
  const pacote = montarPacote({
    cliente: { id: clientId, nome: String((p && (p.company_name || p.full_name)) || "Cliente") },
    titulo: String(corpo.titulo || "").slice(0, 120),
    formato: corpo.formato ? String(corpo.formato).slice(0, 20) : null,
    fps,
    destino: corpo.destino === "remotion" ? "remotion" : "editor",
    roteiro: roteiro ? { id: roteiro.id, titulo: roteiro.titulo, cenas: roteiro.cenas } : null,
    historia,
    takes,
    legendas,
    referencias: Array.isArray(corpo.referencias) ? (corpo.referencias as { titulo: string; url?: string; nota?: string }[]).slice(0, 30) : [],
    direcao: corpo.direcao ? String(corpo.direcao).slice(0, 2000) : null,
    gerado_em: new Date().toISOString(),
  });
  // A direção do pacote é o conhecimento de edição (motor mesa_videos.direcao_de_edicao).
  if (pacote.arquivos["direcao.md"].indexOf(CONHECIMENTO_DA_EDICAO) < 0) throw new ErroHttp(500, "direcao_incompleta", "A direção de edição não entrou no pacote.");
  await auditar(ch, "video_pacote_montar", { client_id: clientId, takes: takes.length, roteiro_id: roteiroId }, true);
  return json({ pacote });
}

// ------------------------------------------------------------------ memória por vídeo

async function lerVersao(id: string) {
  const { data, error } = await servico().from("video_versoes").select("*").eq("id", id).maybeSingle();
  if (error) throw erroDeTabela(error, "video_versoes");
  const v = normalizarVersao(data);
  if (!v) throw new ErroHttp(404, "versao_inexistente", "Versão não encontrada.");
  return v;
}

async function versaoRegistrar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const titulo = String(corpo.titulo || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!titulo) throw new ErroHttp(400, "titulo_vazio", "Dê um nome ao vídeo.");
  const videoId = idOuNulo(corpo.video_id) || crypto.randomUUID();
  const { data: anteriores, error } = await servico().from("video_versoes").select("*").eq("client_id", clientId).eq("video_id", videoId).order("numero", { ascending: true });
  if (error) throw erroDeTabela(error, "video_versoes");
  const lista = normalizarVersoes(anteriores);
  const pai = lista.length ? lista[lista.length - 1] : null;
  const arquivoId = idOuNulo(corpo.arquivo_id);
  if (arquivoId) {
    const a = await lerArquivo(arquivoId);
    if (a.client_id !== clientId) throw new ErroHttp(404, "arquivo_inexistente", "Arquivo de vídeo não encontrado.");
  }
  const custo = numero(corpo.custo_usd);
  const { data, error: e2 } = await servico()
    .from("video_versoes")
    .insert({
      client_id: clientId,
      video_id: videoId,
      titulo,
      numero: proximoNumero(lista, videoId),
      pai_id: pai ? pai.id : null,
      arquivo_id: arquivoId,
      roteiro_id: idOuNulo(corpo.roteiro_id),
      estado: corpo.estado === "rascunho" ? "rascunho" : "em_revisao",
      custo_usd: custo,
      nota: corpo.nota ? String(corpo.nota).replace(/\s+/g, " ").trim().slice(0, 600) : null,
      criado_por: ch.userId,
    })
    .select("*")
    .single();
  if (e2) throw erroDeTabela(e2, "video_versoes");
  await auditar(ch, "video_versao_registrar", { client_id: clientId, video_id: videoId }, true, (data as { id: string }).id);
  return json({ versao: normalizarVersao(data) });
}

async function versaoFeedback(ch: Chamador, corpo: Record<string, unknown>) {
  const v = await lerVersao(idDe(corpo.versao_id, "versao_id"));
  await garantirAcesso(ch, v.client_id);
  let nova;
  try {
    nova = comFeedback(v, { autor: ch.userId, texto: String(corpo.texto || ""), tempo_s: numero(corpo.tempo_s) }, new Date().toISOString());
  } catch (e) {
    throw new ErroHttp(409, "versao_travada", e instanceof Error ? e.message : "Não foi possível comentar.");
  }
  const { data, error } = await servico().from("video_versoes").update({ feedback: nova.feedback }).eq("id", v.id).select("*").single();
  if (error) throw erroDeTabela(error, "video_versoes");
  return json({ versao: normalizarVersao(data) });
}

async function versaoDecidir(ch: Chamador, corpo: Record<string, unknown>) {
  const v = await lerVersao(idDe(corpo.versao_id, "versao_id"));
  await garantirAcesso(ch, v.client_id);
  const decisao = corpo.decisao === "aprovar" ? "aprovar" : corpo.decisao === "rejeitar" ? "rejeitar" : null;
  if (!decisao) throw new ErroHttp(400, "decisao_invalida", "Escolha aprovar ou rejeitar.");
  const trava = motivoParaNaoMudar(v, "decidir");
  if (trava) throw new ErroHttp(409, "versao_travada", trava);
  let nova;
  try {
    nova = decidir(v, decisao, ch.userId, new Date().toISOString(), corpo.motivo ? String(corpo.motivo) : null);
  } catch (e) {
    throw new ErroHttp(400, "decisao_incompleta", e instanceof Error ? e.message : "Não foi possível decidir.");
  }
  const { data, error } = await servico()
    .from("video_versoes")
    .update({ estado: nova.estado, decidido_por: nova.decidido_por, decidido_em: nova.decidido_em, motivo: nova.motivo })
    .eq("id", v.id)
    .select("*")
    .single();
  if (error) throw erroDeTabela(error, "video_versoes");
  await auditar(ch, "video_versao_decidir", { client_id: v.client_id, versao_id: v.id, decisao }, true, v.id);
  return json({ versao: normalizarVersao(data) });
}

// ------------------------------------------------------------------ computador do agente (desligado)

async function computadorPedir(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idOuNulo(corpo.client_id);
  if (clientId) await garantirAcesso(ch, clientId);
  const pedido = normalizarPedidoDeTarefa(corpo);
  const motivo = motivoParaRecusar(pedido, computadorLigado(Deno.env.get("COMPUTADOR_DO_AGENTE_LIGADO")));
  if (motivo) throw new ErroHttp(409, computadorLigado(Deno.env.get("COMPUTADOR_DO_AGENTE_LIGADO")) ? "tarefa_recusada" : "computador_desligado", motivo);
  const { data, error } = await servico()
    .from("agente_computador_tarefas")
    .insert({ client_id: clientId, titulo: pedido.titulo, app: pedido.app, passos: pedido.passos, irreversivel: pedido.irreversivel, estado: "aguardando_dono", criado_por: ch.userId })
    .select("*")
    .single();
  if (error) throw erroDeTabela(error, "agente_computador_tarefas");
  await auditar(ch, "computador_tarefa_pedir", { client_id: clientId, app: pedido.app, passos: pedido.passos.length, irreversivel: pedido.irreversivel }, true, (data as { id: string }).id);
  return json({ tarefa: data });
}

async function computadorDecidir(ch: Chamador, corpo: Record<string, unknown>) {
  const id = idDe(corpo.tarefa_id, "tarefa_id");
  const { data: atual, error } = await servico().from("agente_computador_tarefas").select("*").eq("id", id).maybeSingle();
  if (error) throw erroDeTabela(error, "agente_computador_tarefas");
  if (!atual) throw new ErroHttp(404, "tarefa_inexistente", "Tarefa não encontrada.");
  const t = atual as { client_id: string | null; estado: EstadoDaTarefa; criado_por: string | null };
  if (t.client_id) await garantirAcesso(ch, t.client_id);
  const novo = corpo.estado === "aprovada" ? "aprovada" : corpo.estado === "cancelada" ? "cancelada" : null;
  if (!novo) throw new ErroHttp(400, "estado_invalido", "Escolha aprovar ou cancelar.");
  if (!podeMudarEstado(t.estado, novo, ch.admin ? "admin" : "equipe", t.criado_por === ch.userId)) {
    throw new ErroHttp(403, "sem_permissao", novo === "aprovada" ? "Só o dono aprova tarefa do computador do agente." : "Esta tarefa não pode ser cancelada agora.");
  }
  if (novo === "aprovada" && !computadorLigado(Deno.env.get("COMPUTADOR_DO_AGENTE_LIGADO"))) {
    throw new ErroHttp(409, "computador_desligado", "O computador do agente está desligado.");
  }
  const agora = new Date().toISOString();
  const { data, error: e2 } = await servico()
    .from("agente_computador_tarefas")
    .update(novo === "aprovada" ? { estado: novo, aprovado_por: ch.userId, aprovado_em: agora, atualizado_em: agora } : { estado: novo, atualizado_em: agora })
    .eq("id", id)
    .select("*")
    .single();
  if (e2) throw erroDeTabela(e2, "agente_computador_tarefas");
  await auditar(ch, "computador_tarefa_decidir", { tarefa_id: id, estado: novo }, true, id);
  return json({ tarefa: data });
}

// ------------------------------------------------------------------ roteador

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  arquivo_registrar: arquivoRegistrar,
  arquivo_editar: arquivoEditar,
  takes_organizar_propor: takesOrganizarPropor,
  executar_acao_agente: executarAcao,
  desfazer_acao_agente: desfazerAcao,
  pedido_preparar: pedidoPreparar,
  pedido_cancelar: pedidoCancelar,
  vinculo_salvar: vinculoSalvar,
  vinculo_remover: vinculoRemover,
  pacote_montar: pacoteMontar,
  versao_registrar: versaoRegistrar,
  versao_feedback: versaoFeedback,
  versao_decidir: versaoDecidir,
  computador_pedir: computadorPedir,
  computador_decidir: computadorDecidir,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const chamador = await identificar(req);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = await req.json();
    } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    return await fn(chamador, corpo);
  } catch (err) {
    return respostaDeErro(err);
  }
});
