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
 * Frente E2 (26/09): a mesma função atende a Mesa Vídeos (geração) e a Mesa
 * Edição (/mesa-edicao: entrada, organizar e editar).
 * - pedido_preparar aceita tipo gerar_cena { alvo: { roteiro_id, cena_ref } } e o
 *   modelo de vídeo escolhido (parametros.modelo, catálogo em _shared/modelos-de-video.ts);
 *   o modelo escolhido nunca é trocado por outro motor.
 * - arquivo_editar aceita { na_edicao: true|false } (vídeo gerado aprovado entra na
 *   Entrada da Edição; coluna video_arquivos.edicao_desde, SQL E2-01).
 * - resultados_para_edicao_propor { client_id } -> { mensagem_id, acao | null }
 *   (contrato comum; executar_acao_agente e desfazer_acao_agente executam as duas propostas).
 * - agente_entender { client_id, mesa: videos|edicao, texto } -> { intencao, confianca, via }
 *   (Jev Choice; sem o Jev, as palavras do pedido).
 * - agente_agir { client_id, mesa, texto, ordem?, selecionados?, ultima_resposta? } (AG2, 29/09)
 *   -> { intencao, resposta, mensagem_id, acao, pergunta?, anexos }: entende e, para mandar à
 *   Edição, arquivar, ligar à cena ou organizar, monta a proposta com os itens que o pedido
 *   aponta (Jev sobre a lista na ordem da tela); ordem clara sem custo vai na hora com Desfazer.
 * - aprendizado_esquecer / aprendizado_guardar (AG2): regras que a equipe ensinou (cérebro do cliente).
 * - executar_acao_agente / desfazer_acao_agente também acham o cartão do diretor na conversa
 *   (agente_mensagens), além de video_acoes.
 * - Projeto de edição (_shared/projeto-de-edicao.ts; coluna video_versoes.projeto, SQL E2-01):
 *   versao_registrar aceita { projeto }; projeto_salvar { versao_id, projeto, revisao_lida } -> { versao }
 *   (trava otimista pela revisão; versão aprovada não muda). É onde o editor completo grava.
 *
 * Sem travessão.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { auditLog } from "../_shared/mcp-audit.ts";
import {
  type AcaoDoAgente,
  acaoGuardadaNaMensagem,
  comCaminho,
  confirmarAcaoGuardada,
  desfazerAcaoGuardada,
  ErroDaAcao,
  executarDireto,
  type ItemDaAcaoDoAgente,
  podeExecutarDireto,
  type ResultadoDoItem,
  textoDoResultado,
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
  regrasDoOrganizador,
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
import {
  acaoDeArquivarResultados,
  acaoDeLigarACena,
  acaoDoEnvioParaEdicao,
  AGENTE_DO_ENVIO,
  AGENTE_DOS_RESULTADOS,
  AGENTES_DA_MESA_DE_VIDEO,
  caminhoDaMesaDeVideo,
  camposDoEnvio,
  type CenaParaLigar,
  CONFIANCA_MINIMA,
  intencaoPorPalavras,
  intencaoValida,
  itensReferiveis,
  lerParaDaCena,
  type MesaDoAgente,
  NENHUMA,
  perguntaDaCena,
  perguntaDaIntencao,
  REGRAS_DO_ENVIO,
  REGRAS_DOS_RESULTADOS,
  type ResultadoGerado,
  rotuloDaCena,
} from "../_shared/agente-de-video.ts";
// Frente AG2 (29/09): referência do pedido, ordem clara, aprendizado e falhas no log.
import { pedidoAponta, referenciaDoPedido } from "../_shared/conversa-das-mesas.ts";
import { ehOrdemClara } from "../_shared/ordem-clara.ts";
import { aprenderDoPedido, rotasDoAprendizado } from "../_shared/aprendizado-das-mesas.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { modelosDeVideo } from "../_shared/modelos-de-video.ts";
import { JevErro, jevPerguntar } from "../_shared/jev.ts";
import { cobrarJev } from "../_shared/ia-motor.ts";
import { MAX_BYTES_DO_PROJETO, normalizarProjeto, type ProjetoDeEdicao, proximaRevisao, tamanhoDoProjeto } from "../_shared/projeto-de-edicao.ts";
// Frente V-A (26/09): gerador (motores, ângulo, continuar, transição, antes e depois) e o diretor.
import { AGENTE_DO_DIRETOR } from "../_shared/diretor-de-video.ts";
import {
  anguloGerar,
  antesDepoisImagem,
  avatarGerar,
  type BaseDaFuncao,
  continuarVideo,
  custoEstimar,
  gerarCancelar,
  gerarStatus,
  heygenCatalogo,
  gerarStatusCliente,
  gerarVideo,
  motoresEstado,
  motoresSincronizar,
  quadroRegistrar,
  transicaoGerar,
} from "./geracao.ts";
import {
  antesDepoisParaEditor,
  diretorAvaliar,
  diretorConversar,
  diretorEditorDesfazer,
  diretorParaEditor,
  diretorProporGerar,
  diretorSalvar,
  desfazerItemDoDiretor,
  executarItemDoDiretor,
  templateArquivar,
  templateSalvar,
} from "./diretor.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";

/** Direção de edição do pacote (motor mesa_videos.direcao_de_edicao em motores.ts). */
const CONHECIMENTO_DA_EDICAO = conhecimentoEdicao("pacote").texto;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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
  if (/edicao_desde|video_pedidos_tipo_check|column "projeto"|'projeto' column/i.test(m)) {
    return new ErroHttp(503, "banco_sem_mesa_edicao", "A Mesa Edição ainda não foi ativada no banco. Aplique o SQL E2-01.");
  }
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

// Todas as colunas: edicao_desde (SQL E2-01) entra quando existir, sem quebrar antes dele.
const COLUNAS_DO_ARQUIVO = "*";

type LinhaDoArquivo = TakeParaOrganizar & {
  edicao_desde?: string | null;
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
function camposPermitidos(bruto: unknown): CamposDoTake & { nota?: string | null; tipo?: string; edicao_desde?: string | null } {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const c: CamposDoTake & { nota?: string | null; tipo?: string; edicao_desde?: string | null } = {};
  // Vídeo gerado aprovado na Mesa Vídeos entra na Entrada da Edição (e o desfazer tira).
  if ("na_edicao" in o) c.edicao_desde = o.na_edicao === true ? new Date().toISOString() : null;
  if ("edicao_desde" in o) c.edicao_desde = o.edicao_desde && !isNaN(Date.parse(String(o.edicao_desde))) ? new Date(String(o.edicao_desde)).toISOString() : null;
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
  const itens = proporOrganizacao(takes, roteiros, { melhores: true });
  const melhores = itens.filter((i) => i.operacao === "marcar_melhor").length;
  const acao = acaoDaOrganizacao(takes, itens, roteiros, {
    id: `organizador-${Date.now().toString(36)}`,
    resumo: itens.length
      ? `Organizar ${new Set(itens.map((i) => i.arquivo_id)).size} takes por roteiro e cena, com nomes no padrão roteiro_c01_t01${melhores ? ` e ${melhores} ${melhores === 1 ? "melhor take sugerido" : "melhores takes sugeridos"} (o último de cada cena)` : ""}. O arquivo original não muda.`
      : "",
  });
  if (!acao) return json({ mensagem_id: null, acao: null, roteiros_disponiveis: rot.disponivel });
  const { data, error } = await servico().from(TABELA_DAS_ACOES).insert({ client_id: clientId, anexos: [acao], criado_por: ch.userId }).select("id").single();
  if (error) throw erroDeTabela(error, TABELA_DAS_ACOES);
  return json({ mensagem_id: (data as { id: string }).id, acao, roteiros_disponiveis: rot.disponivel });
}

/**
 * A proposta guardada: em video_acoes (agente da mesa, Roteiro) ou, desde a AG2
 * (29/09), na mensagem da conversa do diretor (agente_mensagens). Só as ações dos
 * agentes da Mesa Vídeos passam; o acesso ao cliente é conferido pela linha.
 */
async function propostaGuardada(ch: Chamador, corpo: Record<string, unknown>) {
  const exigir = (clientId: string) => garantirAcesso(ch, clientId);
  let g;
  try {
    g = await acaoGuardadaNaMensagem(servico(), corpo.mensagem_id, exigir, { tabela: TABELA_DAS_ACOES, acaoId: corpo.acao_id });
  } catch (e) {
    const semTabela = e instanceof ErroDaAcao && e.codigo === "mensagem_indisponivel";
    if (!(e instanceof ErroDaAcao) || (e.codigo !== "mensagem_inexistente" && !semTabela)) throw e;
    try {
      g = await acaoGuardadaNaMensagem(servico(), corpo.mensagem_id, exigir, { acaoId: corpo.acao_id });
    } catch (e2) {
      if (semTabela && e2 instanceof ErroDaAcao && e2.codigo === "mensagem_inexistente") throw new ErroHttp(503, "banco_sem_mesa_videos", "A Mesa Vídeos ainda não foi ativada no banco. Aplique o SQL V2-01.");
      throw e2;
    }
  }
  if ((AGENTES_DA_MESA_DE_VIDEO as readonly string[]).indexOf(g.acao.agente) < 0) throw new ErroHttp(404, "acao_inexistente", "Esta mensagem não tem ação da Mesa Vídeos.");
  return g;
}

async function executarNoTake(clientId: string, item: ItemDaAcaoDoAgente): Promise<{ desfazer: Record<string, unknown> }> {
  const atual = await lerArquivo(item.alvo_id);
  if (atual.client_id !== clientId) throw new Error("Arquivo de outro cliente.");
  if (item.operacao === "enviar_para_edicao") {
    if (atual.tipo !== "gerado") throw new Error("Só vídeo gerado vai por aqui.");
    if (atual.edicao_desde) throw new Error("Já está na Edição.");
    await gravarCampos(clientId, atual.id, camposDoEnvio(item.operacao, new Date().toISOString()));
    return { desfazer: { campos: { edicao_desde: null } } };
  }
  if (item.operacao === "vincular_cena") {
    // AG2 (29/09): o roteiro e a cena são conferidos no banco na hora de gravar (nunca o id que veio de fora).
    const c = lerParaDaCena(item.para);
    if (!c) throw new Error("Cena inválida.");
    const rot = await lerRoteiros(clientId);
    const roteiro = rot.roteiros.find((r) => r.id === c.roteiro_id) || null;
    if (!roteiro || !roteiro.cenas.some((x) => x.ref === c.cena_ref)) throw new Error("A cena não está mais nos roteiros aprovados deste cliente.");
    if (atual.estado === "arquivado") throw new Error("Está arquivado.");
    await gravarCampos(clientId, atual.id, { roteiro_id: c.roteiro_id, cena_ref: c.cena_ref });
    return { desfazer: { campos: { roteiro_id: atual.roteiro_id || null, cena_ref: atual.cena_ref || null } } };
  }
  if (item.operacao === "arquivar") {
    const aprovados = await arquivosEmVersaoAprovada(clientId);
    if (aprovados.indexOf(atual.id) >= 0) throw new Error("Está numa versão aprovada: fica no acervo.");
    if (atual.estado === "arquivado") throw new Error("Já está arquivado.");
  }
  const desfazer = desfazerDaOperacao(atual, item.operacao);
  await gravarCampos(clientId, atual.id, camposDaOperacao(item.operacao, item.para) as Record<string, unknown>);
  return { desfazer };
}

async function executarAcao(ch: Chamador, corpo: Record<string, unknown>) {
  const guardada = await propostaGuardada(ch, corpo);
  const clientId = guardada.mensagem.client_id;
  // Diretor (frente V-A): cada item gera um plano (pago, sem desfazer), com a entrada mostrada na confirmação.
  const doDiretor = guardada.acao.agente === AGENTE_DO_DIRETOR;
  const executor = doDiretor
    ? (item: ItemDaAcaoDoAgente, acao: AcaoDoAgente) => executarItemDoDiretor(baseDa(ch), clientId, item, acao, guardada.mensagem.id)
    : (item: ItemDaAcaoDoAgente) => executarNoTake(clientId, item);
  // Frente AG (27/09): em passos (os planos pagos de 2 em 2, os takes de 9 em 9), com andamento e Parar
  // no cartão, e o "Ir para" com o que foi feito (Entrada da Edição, Organizar, Resultados).
  const r: { anexo: AcaoDoAgente; resultados: ResultadoDoItem[] } = await confirmarAcaoGuardada(guardada, executor, {
    descartar: corpo.descartar === true,
    parar: corpo.parar === true,
    userId: ch.userId,
    lote: 3,
    porVez: doDiretor ? 2 : 9,
    caminho: (feita) => caminhoDaMesaDeVideo(clientId, feita),
  });
  if (corpo.descartar === true && !r.anexo.executada_em) return json({ anexo: r.anexo });
  const feitos = r.resultados.filter((x) => x.ok).length;
  const falhas = r.resultados.length - feitos;
  await auditar(ch, doDiretor ? "video_diretor_gerar_planos" : guardada.acao.agente === AGENTE_DO_ENVIO ? "video_enviar_para_edicao" : guardada.acao.agente === AGENTE_DOS_RESULTADOS ? "video_resultados_agente" : "video_organizar_takes", { client_id: clientId, mensagem_id: guardada.mensagem.id, operacoes: r.anexo.itens.map((i) => i.operacao) }, falhas === 0, guardada.mensagem.id);
  return json({ anexo: r.anexo, feitos, falhas });
}

async function desfazerAcao(ch: Chamador, corpo: Record<string, unknown>) {
  const guardada = await propostaGuardada(ch, corpo);
  const clientId = guardada.mensagem.client_id;
  const doDiretor = guardada.acao.agente === AGENTE_DO_DIRETOR;
  const r = await desfazerAcaoGuardada(
    guardada,
    async (x) => {
      // Diretor: a versão do editor volta como rejeitada (geração não tem desfazer e nem chega aqui).
      if (doDiretor) return desfazerItemDoDiretor(baseDa(ch), x);
      const bruto = x.desfazer && typeof x.desfazer === "object" ? ((x.desfazer as { campos?: Record<string, unknown> }).campos || {}) : {};
      if ("edicao_desde" in bruto) {
        await gravarCampos(clientId, x.alvo_id, { edicao_desde: null });
        return;
      }
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
    // Cena da História ligada a uma cena de roteiro (Mesa Vídeos, Gerar): guarda a ligação.
    if (alvoBruto.roteiro_id && UUID.test(String(alvoBruto.roteiro_id))) {
      alvo.roteiro_id = String(alvoBruto.roteiro_id);
      alvo.cena_ref = String(alvoBruto.cena_ref || "").slice(0, MAX_CENA_REF) || null;
    }
  } else if (tipo === "gerar_cena") {
    // Cena de roteiro aprovado sem foto: o texto da cena é a base (texto para vídeo).
    alvo.roteiro_id = idDe(alvoBruto.roteiro_id, "roteiro_id");
    alvo.cena_ref = String(alvoBruto.cena_ref || "").trim().slice(0, MAX_CENA_REF);
    if (!alvo.cena_ref) throw new ErroHttp(400, "cena_invalida", "Diga qual cena do roteiro gerar.");
    const rot = await lerRoteiros(clientId);
    const roteiro = rot.roteiros.find((r) => r.id === alvo.roteiro_id) || null;
    const cena = roteiro ? roteiro.cenas.find((x) => x.ref === alvo.cena_ref) || null : null;
    if (!roteiro || !cena) throw new ErroHttp(404, "cena_inexistente", "Cena não encontrada nos roteiros aprovados deste cliente.");
    alvo.roteiro = roteiro.titulo;
    alvo.numero = cena.ordem;
    alvo.titulo = cena.titulo || null;
    const p0 = (corpo.parametros && typeof corpo.parametros === "object" ? corpo.parametros : {}) as Record<string, unknown>;
    if (!p0.descricao) corpo.parametros = { ...p0, descricao: [cena.visual, cena.fala].filter(Boolean).join(". ") || cena.titulo || null };
  } else {
    const arquivo = await lerArquivo(idDe(alvoBruto.arquivo_id, "arquivo_id"));
    if (arquivo.client_id !== clientId) throw new ErroHttp(404, "arquivo_inexistente", "Arquivo de vídeo não encontrado.");
    alvo.arquivo_id = arquivo.id;
    alvo.nome = arquivo.nome;
    if (!(corpo.parametros && typeof corpo.parametros === "object" && "duracao_s" in (corpo.parametros as object))) {
      corpo.parametros = { ...((corpo.parametros as object) || {}), duracao_s: arquivo.duracao_s };
    }
  }
  const { data: catalogo } = await servico().from("ia_modelos").select("id, tipo, ativo, rotulo, modelo_api").eq("ativo", true).limit(500);
  const lista = (catalogo || []) as { id: string; tipo: string; ativo: boolean; rotulo: string | null; modelo_api?: string | null }[];
  const params = normalizarParametros(tipo, corpo.parametros);
  const deVideo = tipo === "animar_cena" || tipo === "gerar_cena";
  const pv = params as { motor_video: string | null; modelo?: string | null };
  let escolhido = deVideo ? pv.motor_video : null;
  let executor = executorDoPedido(tipo, lista, escolhido);
  if (deVideo && pv.modelo) {
    // O modelo que a equipe escolheu manda: só executa o motor ligado dele; sem motor, fica "em breve".
    const m = modelosDeVideo(lista).find((x) => x.id === pv.modelo) || null;
    escolhido = m && m.ligado ? m.motor_id || null : null;
    executor = escolhido ? executorDoPedido(tipo, lista, escolhido) : executorDoPedido(tipo, [], null);
    if (escolhido && executor.executor !== escolhido) executor = executorDoPedido(tipo, [], null);
  }
  if (deVideo) pv.motor_video = executor.executor === "em_breve" ? null : executor.executor;
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
  const projeto = corpo.projeto ? projetoValido(corpo.projeto, null, null) : null;
  const { data, error: e2 } = await servico()
    .from("video_versoes")
    .insert({
      ...(projeto ? { projeto } : {}),
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
  // AG2 (29/09): reprovar com motivo ensina a mesa (depois da decisão gravada; nunca a bloqueia).
  const motivo = decisao === "rejeitar" && corpo.motivo ? String(corpo.motivo).replace(/\s+/g, " ").trim().slice(0, 600) : "";
  const aprendido = motivo ? await aprenderDoPedido(servico(), { clientId: v.client_id, mesa: "edicao", pedido: motivo, motivo, userId: ch.userId, forcar: true }) : null;
  return json({ versao: normalizarVersao(data), ...(aprendido ? { aprendido } : {}) });
}

// ------------------------------------------------------------------ projeto de edição

function projetoValido(bruto: unknown, atual: ProjetoDeEdicao | null, revisaoLida: number | null): ProjetoDeEdicao {
  const p = normalizarProjeto(bruto);
  if (!p) throw new ErroHttp(400, "projeto_invalido", "O projeto de edição veio em formato desconhecido.");
  let novo: ProjetoDeEdicao;
  try {
    novo = proximaRevisao(atual, p, revisaoLida, new Date().toISOString());
  } catch (e) {
    throw new ErroHttp(409, "projeto_mudou", e instanceof Error ? e.message : "O projeto mudou. Abra de novo.");
  }
  if (tamanhoDoProjeto(novo) > MAX_BYTES_DO_PROJETO) throw new ErroHttp(413, "projeto_grande", "O projeto passou do tamanho que o banco guarda.");
  return novo;
}

async function projetoSalvar(ch: Chamador, corpo: Record<string, unknown>) {
  const id = idDe(corpo.versao_id, "versao_id");
  const { data: linha, error } = await servico().from("video_versoes").select("*").eq("id", id).maybeSingle();
  if (error) throw erroDeTabela(error, "video_versoes");
  const v = normalizarVersao(linha);
  if (!v) throw new ErroHttp(404, "versao_inexistente", "Versão não encontrada.");
  await garantirAcesso(ch, v.client_id);
  const trava = motivoParaNaoMudar(v, "decidir");
  if (trava) throw new ErroHttp(409, "versao_travada", trava);
  const atual = normalizarProjeto((linha as { projeto?: unknown }).projeto);
  const lida = corpo.revisao_lida === null || corpo.revisao_lida === undefined ? null : Number(corpo.revisao_lida);
  const projeto = projetoValido(corpo.projeto, atual, lida !== null && isFinite(lida) ? lida : null);
  const { data, error: e2 } = await servico().from("video_versoes").update({ projeto }).eq("id", v.id).select("*").single();
  if (e2) throw erroDeTabela(e2, "video_versoes");
  await auditar(ch, "video_projeto_salvar", { client_id: v.client_id, versao_id: v.id, revisao: projeto.revisao }, true, v.id);
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

// ------------------------------------------------------------------ resultados para a Edição (contrato comum)

async function resultadosParaEdicaoPropor(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const arquivos = await lerArquivosDoCliente(clientId);
  const lista: ResultadoGerado[] = arquivos.map((a) => ({ id: a.id, nome: a.nome, tipo: String(a.tipo), estado: a.estado, edicao_desde: a.edicao_desde || null, grupo: a.grupo }));
  const acao = acaoDoEnvioParaEdicao(lista, { id: `envio-${Date.now().toString(36)}` });
  if (!acao) return json({ mensagem_id: null, acao: null });
  const { data, error } = await servico().from(TABELA_DAS_ACOES).insert({ client_id: clientId, anexos: [acao], criado_por: ch.userId }).select("id").single();
  if (error) throw erroDeTabela(error, TABELA_DAS_ACOES);
  return json({ mensagem_id: (data as { id: string }).id, acao });
}

// ------------------------------------------------------------------ agente: entender o pedido

type Entendimento = { intencao: string; confianca: number | null; via: "jev" | "palavras"; jev_erro?: string };

/** Intenção do pedido (Jev Choice; sem ele ou com pouca certeza, as palavras do pedido). Nunca lança. */
async function entenderPedido(ch: Chamador, clientId: string, mesa: MesaDoAgente, texto: string): Promise<Entendimento> {
  const reserva = intencaoPorPalavras(mesa, texto);
  try {
    const r = await jevPerguntar(perguntaDaIntencao(mesa, texto));
    await cobrarJev(r, { clientId, tarefa: "conversa", criadoPor: ch.userId });
    const resposta = r.answers.intencao || {};
    const escolha = intencaoValida(mesa, resposta.choice);
    const confianca = typeof resposta.confidence === "number" ? resposta.confidence : null;
    // Pouca certeza do Jev: vale a palavra do pedido quando ela reconhece algo.
    if (escolha === NENHUMA || (confianca !== null && confianca < CONFIANCA_MINIMA)) {
      if (reserva !== NENHUMA) return { intencao: reserva, confianca, via: "palavras" };
    }
    return { intencao: escolha, confianca, via: "jev" };
  } catch (e) {
    // Frente LR: o Jev fora do ar não some em silêncio (log e jev_erro na resposta).
    console.warn("mesa-videos: jev da intenção falhou; vale a palavra do pedido", { erro: String((e as Error)?.message ?? e) });
    return { intencao: reserva, confianca: null, via: "palavras", jev_erro: e instanceof JevErro ? e.codigo : "jev_indisponivel" };
  }
}

async function agenteEntender(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const mesa: MesaDoAgente = corpo.mesa === "edicao" ? "edicao" : "videos";
  const texto = String(corpo.texto || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (!texto) throw new ErroHttp(400, "texto_vazio", "Escreva o que precisa.");
  return json(await entenderPedido(ch, clientId, mesa, texto));
}

// ------------------------------------------------------------------ agente: entender E agir (AG2, 29/09)

/** Intenções em que o agente da mesa age nos itens (as outras só abrem a etapa na tela). */
const INTENCOES_QUE_AGEM = ["enviar_para_edicao", "arquivar", "vincular", "organizar"];

/** Apelidos escritos no pedido ("r2", "o r3 e o r5"): valem sem Jev. */
function apelidosEscritos(texto: string, itens: { ref: string }[]): string[] {
  const achados: string[] = [];
  String(texto || "").toLowerCase().replace(/\br(\d{1,3})\b/g, (_m, n) => {
    const ref = `r${Number(n)}`;
    if (itens.some((i) => i.ref === ref) && achados.indexOf(ref) < 0) achados.push(ref);
    return "";
  });
  return achados;
}

/** A lista da etapa na ordem da tela: a ordem mandada pela tela, conferida no banco (id de fora nunca passa sem estar lá). */
function naOrdemDaTela<T extends { id: string; criado_em?: string | null }>(lista: T[], ordem: unknown): T[] {
  const ids = Array.isArray(ordem) ? (ordem as unknown[]).map(String).filter((x) => UUID.test(x)) : [];
  const porId = new Map(lista.map((a) => [a.id, a]));
  const saida: T[] = [];
  ids.forEach((id) => {
    const a = porId.get(id);
    if (a && saida.indexOf(a) < 0) saida.push(a);
  });
  // O que a tela não mandou vem depois, do mais novo para o mais velho (como a tela mostra).
  lista
    .filter((a) => saida.indexOf(a) < 0)
    .sort((x, y) => String(y.criado_em || "").localeCompare(String(x.criado_em || "")))
    .forEach((a) => saida.push(a));
  return saida;
}

/** Cena do roteiro pedida: "cena 2" com um roteiro só vale sem Jev; senão o Jev escolhe (ou null). */
async function cenaDoPedido(ch: Chamador, clientId: string, texto: string, cenas: CenaParaLigar[]): Promise<CenaParaLigar | null> {
  if (!cenas.length) return null;
  if (cenas.length === 1) return cenas[0];
  const roteiros = new Set(cenas.map((c) => c.roteiro_id));
  const n = /\bcena\s*(\d{1,3})\b/i.exec(texto);
  if (n && roteiros.size === 1) return cenas.find((c) => c.ordem === Number(n[1])) || null;
  try {
    const r = await jevPerguntar(perguntaDaCena(texto, cenas));
    await cobrarJev(r, { clientId, tarefa: "conversa", criadoPor: ch.userId });
    const e = r.answers.cena || {};
    const m = /^c(\d{1,3})$/.exec(String(e.choice || ""));
    const conf = typeof e.confidence === "number" ? e.confidence : null;
    if (!m || (conf !== null && conf < 0.6)) return null;
    return cenas[Number(m[1]) - 1] || null;
  } catch (e) {
    registrarFalha("mesa-videos: cena do pedido sem Jev (pergunta à equipe)", e, { client_id: clientId });
    return null;
  }
}

/**
 * agente_agir { client_id, mesa, texto, ordem?: ids na ordem da tela, selecionados?: ids, ultima_resposta? }
 * -> { intencao, confianca, via, resposta, mensagem_id, acao, pergunta?, anexos }
 *
 * O agente da mesa entende o pedido e, quando é para agir nos vídeos (mandar
 * para a Edição, arquivar, ligar à cena, organizar), monta a proposta do
 * contrato comum com os itens que o pedido aponta ("essa", "a segunda",
 * "todos": Jev sobre a lista na ordem da tela; "r2" escrito vale direto).
 * Sem custo e com Desfazer: ordem clara (Jev) vai na hora, com a prova por item;
 * senão o cartão pede Confirmar. Dúvida real (qual vídeo? qual cena?): UMA
 * pergunta. Arquivar nunca pega "todos" sem a pessoa dizer.
 */
async function agenteAgir(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const mesa: MesaDoAgente = corpo.mesa === "edicao" ? "edicao" : "videos";
  const texto = String(corpo.texto || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (!texto) throw new ErroHttp(400, "texto_vazio", "Escreva o que precisa.");
  const [ent, aprendido] = await Promise.all([
    entenderPedido(ch, clientId, mesa, texto),
    // Aprendizado: "nunca mande X", "não gostei de Y" viram regra da mesa (nunca bloqueia).
    aprenderDoPedido(servico(), { clientId, mesa: mesa === "edicao" ? "edicao" : "video", pedido: texto, userId: ch.userId, ultimaResposta: corpo.ultima_resposta ? String(corpo.ultima_resposta) : null }),
  ]);
  const anexos = aprendido ? [aprendido] : [];
  const base = { ...ent, anexos };
  if (INTENCOES_QUE_AGEM.indexOf(ent.intencao) < 0) return json({ ...base, resposta: null, mensagem_id: null, acao: null });

  const [arquivos, rot, aprovados] = await Promise.all([lerArquivosDoCliente(clientId), lerRoteiros(clientId), arquivosEmVersaoAprovada(clientId)]);
  // A lista da etapa: Mesa Vídeos = vídeos gerados (Resultados); Mesa Edição = a Entrada.
  const daEtapa = arquivos.filter((a) => (mesa === "videos" ? a.tipo === "gerado" : (a.tipo !== "gerado" || !!a.edicao_desde) && ["angulo", "quadro"].indexOf(String(a.tipo)) < 0));
  const lista = naOrdemDaTela(daEtapa as (LinhaDoArquivo & { criado_em?: string | null })[], corpo.ordem);
  const resultados: ResultadoGerado[] = lista.map((a) => ({ id: a.id, nome: a.nome, tipo: String(a.tipo), estado: a.estado, edicao_desde: a.edicao_desde || null, grupo: a.grupo, melhor: !!a.melhor, em_versao_aprovada: aprovados.indexOf(a.id) >= 0, roteiro_id: a.roteiro_id || null, cena_ref: a.cena_ref || null }));
  const itens = itensReferiveis(resultados);
  const refDoId: Record<string, string> = {};
  resultados.forEach((r, i) => (refDoId[r.id] = itens[i].ref));
  const selecionados = (Array.isArray(corpo.selecionados) ? (corpo.selecionados as unknown[]).map(String) : []).map((id) => refDoId[id]).filter(Boolean);

  // Quais itens: apelido escrito > referência (Jev) > regra de cada intenção.
  const escritos = apelidosEscritos(texto, itens);
  const referencia = escritos.length ? null : await referenciaDoPedido(texto, itens, { agente: mesa === "edicao" ? "agente da Mesa Edição" : "agente da Mesa Vídeos", ultimaResposta: corpo.ultima_resposta ? String(corpo.ultima_resposta) : null, selecionados });
  const pergunta = (t: string) => json({ ...base, resposta: t, pergunta: true, mensagem_id: null, acao: null });
  const opcoes = (refs: string[]) => refs.slice(0, 4).map((ref) => `${ref} (${(itens.find((i) => i.ref === ref) || { titulo: "" }).titulo})`).join(", ");
  let escolhidos: ResultadoGerado[] | null = null;
  if (escritos.length) escolhidos = resultados.filter((_r, i) => escritos.indexOf(itens[i].ref) >= 0);
  else if (referencia && referencia.incerta) return pergunta(`Você quer dizer ${referencia.alcance === "todas" ? "todos os vídeos da lista" : opcoes(referencia.refs)}? Responda com o apelido (ex.: "${referencia.refs[0] || "r1"}") ou "todos".`);
  else if (referencia) escolhidos = referencia.alcance === "todas" ? resultados.slice() : resultados.filter((_r, i) => referencia.refs.indexOf(itens[i].ref) >= 0);
  else if (pedidoAponta(texto) && !/\b(todos|todas|tudo)\b/i.test(texto) && ent.intencao !== "organizar") {
    if (!itens.length) return json({ ...base, resposta: "Não há vídeo nesta etapa para isso.", mensagem_id: null, acao: null });
    return pergunta(`Qual vídeo? ${opcoes(itens.map((i) => i.ref))}${itens.length > 4 ? "..." : ""}. Responda com o apelido (ex.: "r1").`);
  }
  if (!escolhidos && (ent.intencao === "arquivar" || ent.intencao === "vincular")) {
    // Arquivar e ligar nunca pegam a lista inteira sem a pessoa dizer "todos".
    if (/\b(todos|todas|tudo)\b/i.test(texto)) escolhidos = resultados.slice();
    else if (resultados.length === 1) escolhidos = resultados.slice();
    else if (!resultados.length) return json({ ...base, resposta: "Não há vídeo gerado nesta etapa.", mensagem_id: null, acao: null });
    else return pergunta(`Quais vídeos? ${opcoes(itens.map((i) => i.ref))}${itens.length > 4 ? "..." : ""}. Diga o apelido (ex.: "r2") ou "todos".`);
  }

  const id = `agente-${Date.now().toString(36)}`;
  let acao: AcaoDoAgente | null = null;
  let regras: Record<string, { direta?: boolean }> = {};
  let vazio = "";
  if (ent.intencao === "enviar_para_edicao") {
    acao = acaoDoEnvioParaEdicao(escolhidos || resultados, { id });
    regras = REGRAS_DO_ENVIO;
    vazio = "Nenhum vídeo gerado esperando a Edição.";
  } else if (ent.intencao === "arquivar") {
    acao = acaoDeArquivarResultados(escolhidos || [], { id });
    regras = REGRAS_DOS_RESULTADOS;
    vazio = "Nada para arquivar.";
  } else if (ent.intencao === "vincular") {
    const cenas: CenaParaLigar[] = [];
    rot.roteiros.forEach((r) => r.cenas.forEach((c) => cenas.push({ roteiro_id: r.id, roteiro: r.titulo, cena_ref: c.ref, ordem: c.ordem, titulo: c.titulo || "" })));
    if (!cenas.length) return json({ ...base, resposta: "Não há roteiro aprovado com cenas para ligar. Aprove um roteiro na Mesa Roteiros.", mensagem_id: null, acao: null });
    const cena = await cenaDoPedido(ch, clientId, texto, cenas);
    if (!cena) return pergunta(`Qual cena? ${cenas.slice(0, 5).map((c, i) => `c${i + 1} ${rotuloDaCena(c)}`).join("; ")}${cenas.length > 5 ? "..." : ""}.`);
    acao = acaoDeLigarACena(escolhidos || [], cena, { id });
    regras = REGRAS_DOS_RESULTADOS;
    vazio = "Nada para ligar.";
  } else {
    const takes: TakeParaOrganizar[] = arquivos.map((a) => ({ ...a, em_versao_aprovada: aprovados.indexOf(a.id) >= 0 }));
    const roteiros = rot.roteiros.map(paraOrganizar);
    const soEstes = escolhidos ? escolhidos.map((x) => x.id) : null;
    const propostos = proporOrganizacao(takes, roteiros, { melhores: true }).filter((i) => !soEstes || soEstes.indexOf(i.arquivo_id) >= 0);
    acao = acaoDaOrganizacao(takes, propostos, roteiros, { id, resumo: propostos.length ? `Organizar ${new Set(propostos.map((i) => i.arquivo_id)).size} takes por roteiro e cena, com nomes no padrão roteiro_c01_t01. O arquivo original não muda.` : "" });
    regras = regrasDoOrganizador(roteiros);
    vazio = "Já está organizado: nomes e grupos seguem o padrão por roteiro e cena.";
  }
  if (!acao) return json({ ...base, resposta: vazio, mensagem_id: null, acao: null });

  // A proposta nasce guardada ANTES de qualquer execução: o Desfazer sempre tem onde morar.
  const { data: linha, error: eGravar } = await servico().from(TABELA_DAS_ACOES).insert({ client_id: clientId, anexos: [acao], criado_por: ch.userId }).select("id").single();
  if (eGravar) {
    registrarFalha("mesa-videos: proposta do agente não gravada", eGravar, { client_id: clientId });
    throw erroDeTabela(eGravar, TABELA_DAS_ACOES);
  }
  const mensagemId = (linha as { id: string }).id;
  let resposta = acao.itens.length ? `${acao.resumo} Confira a lista e confirme.` : `Não deu para fazer: ${acao.recusados.slice(0, 3).map((x) => `${x.titulo} (${x.motivo})`).join("; ")}`;
  let avisoRegistro: string | null = null;
  if (podeExecutarDireto(acao, regras, { pedidoClaro: true }).direto) {
    const ordem = await ehOrdemClara(texto, { agente: "agente da mesa de vídeo", resumo: acao.resumo });
    if (ordem.clara) {
      const feita = await executarDireto(acao, (item) => executarNoTake(clientId, item), { userId: ch.userId, lote: 1 });
      acao = comCaminho(feita, caminhoDaMesaDeVideo(clientId, feita, { abrirSozinho: ordem.levar }), { abrirSozinho: ordem.levar });
      resposta = `Feito: ${textoDoResultado(feita.resultados || [])}. ${acao.resumo}`;
      const { error: eFeita } = await servico().from(TABELA_DAS_ACOES).update({ anexos: [acao] }).eq("id", mensagemId).eq("client_id", clientId);
      if (eFeita) {
        avisoRegistro = registrarFalha("mesa-videos: ação feita, registro não gravado", eFeita, { mensagem_id: mensagemId }) && "A ação foi feita, mas o registro falhou: o Desfazer deste cartão pode não funcionar. Desfaça pela lista de Resultados.";
      }
      await auditar(ch, "video_agente_direto", { client_id: clientId, intencao: ent.intencao, itens: feita.itens.length }, (feita.resultados || []).every((x) => x.ok), mensagemId);
    }
  }
  return json({ ...base, resposta, mensagem_id: mensagemId, acao, ...(avisoRegistro ? { aviso_registro: avisoRegistro } : {}) });
}

// ------------------------------------------------------------------ gerador e diretor (frente V-A)

function baseDa(ch: Chamador): BaseDaFuncao {
  return {
    servico,
    garantirAcesso: (clientId: string) => garantirAcesso(ch, clientId),
    erro: (status, codigo, mensagem, extra = {}) => new ErroHttp(status, codigo, mensagem, extra),
    json,
    auditar: (ferramenta, input, sucesso, ref) => auditar(ch, ferramenta, input, sucesso, ref),
    userId: ch.userId,
    admin: ch.admin,
  };
}

/** Trabalho longo (diretor com raciocínio max, imagem, baixar vídeo): responde com fôlego. */
const comFolego = (fn: (b: BaseDaFuncao, corpo: Record<string, unknown>) => Promise<Response>) => (ch: Chamador, corpo: Record<string, unknown>) =>
  Promise.resolve(respostaComFolego(() => fn(baseDa(ch), corpo).catch((e) => respostaDeErro(e)), corsHeaders));
const direto = (fn: (b: BaseDaFuncao, corpo: Record<string, unknown>) => Promise<Response>) => (ch: Chamador, corpo: Record<string, unknown>) => fn(baseDa(ch), corpo);

async function motoresSincronizarDaEquipe(ch: Chamador) {
  if (!ch.admin) throw new ErroHttp(403, "somente_admin", "Só o dono sincroniza o catálogo.");
  return await motoresSincronizar(baseDa(ch));
}

// ------------------------------------------------------------------ aprendizado (AG2, 29/09)

// "Esquecer" e "Guardar como regra": o diretor e o agente da Mesa Vídeos gravam na mesa "video";
// o agente da Mesa Edição (mesa: "edicao" no corpo) na mesa "edicao".
const rotaDoAprendizado = (mesa: "video" | "edicao") =>
  rotasDoAprendizado({ mesa, servico, garantirAcesso: (ch, clientId) => garantirAcesso(ch as Chamador, clientId), json });
const APRENDIZADO_DO_VIDEO = rotaDoAprendizado("video");
const APRENDIZADO_DA_EDICAO = rotaDoAprendizado("edicao");
const aprendizadoDaMesa = (corpo: Record<string, unknown>) => (corpo.mesa === "edicao" ? APRENDIZADO_DA_EDICAO : APRENDIZADO_DO_VIDEO);

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
  resultados_para_edicao_propor: resultadosParaEdicaoPropor,
  agente_entender: agenteEntender,
  // AG2 (29/09): o agente da mesa entende E age (arquivar, ligar à cena, mandar para a Edição, organizar).
  agente_agir: agenteAgir,
  aprendizado_esquecer: (ch, corpo) => aprendizadoDaMesa(corpo).aprendizado_esquecer(ch, corpo),
  aprendizado_guardar: (ch, corpo) => aprendizadoDaMesa(corpo).aprendizado_guardar(ch, corpo),
  projeto_salvar: projetoSalvar,
  // Frente V-A: gerador (contrato em docs/video/CONTRATOS.md).
  motores_estado: direto((b) => motoresEstado(b)),
  custo_estimar: direto(custoEstimar),
  gerar_video: direto(gerarVideo),
  // Contrato com a V-B: clipe a partir de um quadro inicial (o mesmo núcleo do gerar_video).
  cena_gerar: direto((b, c) => gerarVideo(b, { ...c, modo: c.modo || "primeiro_quadro", tipo: c.tipo || "gerar_livre" })),
  angulo_gerar: direto(anguloGerar),
  continuar_video: direto(continuarVideo),
  transicao_gerar: direto(transicaoGerar),
  // Frente V-C: HeyGen (avatar falando), lista de avatares e vozes, e cancelar na Runway e na Higgsfield.
  avatar_gerar: direto(avatarGerar),
  heygen_catalogo: direto(heygenCatalogo),
  gerar_cancelar: direto(gerarCancelar),
  antes_depois_imagem: comFolego(antesDepoisImagem),
  gerar_status: comFolego(gerarStatus),
  gerar_status_cliente: comFolego(gerarStatusCliente),
  quadro_registrar: direto(quadroRegistrar),
  motores_sincronizar: (ch) => motoresSincronizarDaEquipe(ch),
  // Frente V-A: agente diretor, bíblia, roteiro e templates.
  diretor_conversar: comFolego(diretorConversar),
  diretor_salvar: direto(diretorSalvar),
  diretor_propor_gerar: direto(diretorProporGerar),
  diretor_avaliar: comFolego(diretorAvaliar),
  diretor_para_editor: direto(diretorParaEditor),
  diretor_editor_desfazer: direto(diretorEditorDesfazer),
  antes_depois_para_editor: direto(antesDepoisParaEditor),
  template_salvar: direto(templateSalvar),
  template_arquivar: direto(templateArquivar),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    // Cron semanal (DESLIGADO no SQL V-01): só a sincronização do catálogo de motores.
    const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
    if (cronSecret && (req.headers.get("x-cron-secret") || "").trim() === cronSecret) {
      let c: Record<string, unknown> = {};
      try {
        c = await req.json();
      } catch { /* corpo vazio */ }
      if (String(c.acao ?? "") !== "motores_sincronizar") return json({ error: "nao_autorizado", mensagem: "O cron só sincroniza o catálogo." }, 403);
      return await motoresSincronizar({ ...baseDa({ userId: "", token: "", doChamador: servico(), admin: true }), garantirAcesso: async () => {} });
    }
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
