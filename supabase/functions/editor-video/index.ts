/**
 * editor-video: o que o editor de vídeo da Mesa Edição precisa do servidor
 * (frente V-B, 26/09/2026). Só equipe, com acesso ao cliente (JWT do chamador
 * + can_access_client). Toda chamada paga passa pelo motor (_shared/ia-motor.ts)
 * e cai na carteira do cliente, com custo mostrado ANTES pela tela e conferido
 * aqui (`custo_maximo_usd`: passou do mostrado, recusa com custo_mudou).
 *
 * POST { acao, ... }
 * - timestamp_estimar { client_id, modo: transcrever|alinhar, duracao_s } -> { custo_usd, provedor, fonte }
 * - timestamp_parte { client_id, audio_path, inicio_s, duracao_s, texto?, idioma?, referencia_id, custo_maximo_usd }
 *     -> { palavras: [{t,i,f}] no tempo da fonte, texto, custo_usd, saldo_usd }
 *     Whisper (whisper-1, palavra por palavra). O áudio é uma PARTE (mono, 16 kHz)
 *     que a tela subiu em <cliente>/video/editor/audio/; o início da parte é
 *     somado aqui a cada palavra (deslocamento determinístico).
 * - alinhar_iniciar { client_id, audio_path, texto, duracao_s, referencia_id, custo_maximo_usd } -> { pedido }
 * - alinhar_andamento { client_id, pedido, referencia_id, duracao_s } -> { situacao, palavras?, letras?, custo_usd? }
 *     Alinhamento forçado (texto dado + áudio inteiro -> tempo por palavra e por
 *     letra): ElevenLabs Forced Alignment pela fila da fal.ai. Cobra uma vez, na
 *     volta pronta (idempotente pela referência).
 * - agente_passo { client_id, modelo_id, raciocinio?, referencia_id, passo, ferramentas_usadas, teto_usd,
 *     pedido, contexto, historico } -> { passo: { plano, chamadas, resposta, terminou, recusadas }, custo_usd, gasto_usd, saldo_usd }
 *     Um passo do laço de ferramentas (a tela executa as ferramentas).
 *     AG2 (29/09): também recebe conversa (últimas trocas), itens_referencia (clipes da trilha de vídeo
 *     com apelido, na ordem da tela), selecionados (apelidos) e referencia (a do passo 1, devolvida);
 *     as regras ensinadas (regrasDaMesa "edicao") e "essa/o segundo/todos" (Jev) vão no sistema;
 *     devolve uso_id, referencia (passo 1), aprendido e regras_seguidas.
 * - agente_ordem_clara { client_id, pedido, resumo } -> { clara, fonte } (Jev; decide o "faz na hora com Desfazer")
 * - conversa_ler { client_id, versao_id } -> { conversa_id, mensagens } (a conversa do editor por versão do vídeo)
 * - conversa_gravar { client_id, versao_id, usuario, agente: { conteudo, anexos }, uso_id? } -> { mensagem_id, aviso_registro }
 * - conversa_marcar { client_id, mensagem_id, cartao } -> { ok } (o cartão feito/desfeito/cancelado fica assim ao reabrir)
 * - aprendizado_esquecer / aprendizado_guardar (_shared/aprendizado-das-mesas.ts, mesa "edicao")
 * - visao_descrever { client_id, fonte, modelo_id, quadros: [{ tempo_s, jpeg_base64 }], referencia_id, custo_maximo_usd }
 *     -> { trechos, custo_usd, saldo_usd } (só nos tempos dos quadros enviados).
 *
 * - receita_ler { client_id, modelo_id, quadros, medida, referencia_id, custo_maximo_usd } -> { visao, custo_usd }
 *     Lê o ESTILO da edição de um vídeo de referência (legenda, textos, B-roll,
 *     cor, gancho e CTA) por quadros; os tempos de corte vêm medidos pela tela.
 * - receita_salvar { client_id | null, nome, receita, origem } -> { receita } (template; SQL V-B-01)
 * - receita_arquivar { id } -> { ok }
 *   Link de rede social nunca é baixado aqui (a tela manda só quadros de arquivo do painel).
 *
 * Frente EDT (30/09):
 * - render_pedir / render_status / render_cancelar (render.ts): fila render_pedidos para o
 *   worker da máquina da agência (vídeo inteiro, amostra de 8 a 15 s, onda do áudio). Sem custo.
 * - animacoes_sugerir (animacoes.ts): o Jev escolhe em quais frases ditas entra animação e qual peça.
 * - elemento_estimar / elemento_gerar (elemento.ts): ícone ou objeto com fundo transparente, pago, custo antes.
 *
 * Nada aqui grava o projeto: a tela junta o resultado e salva pela mesa-videos
 * (projeto_salvar). Sem travessão.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { auditLog } from "../_shared/mcp-audit.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import {
  carregarModelo,
  chamarTexto,
  deBase64,
  estimarComModelo,
  garantirCota,
  garantirSaldo,
  IaMotorErro,
  type ImagemEntrada,
  type MensagemMotor,
  type ModeloIa,
  registrarUso,
  resolverChave,
} from "../_shared/ia-motor.ts";
import {
  anexosDoEditor,
  APELIDO_DE_CLIPE,
  custoDoTimestamp,
  deslocarPalavras,
  itensDoCorpo,
  MAX_CONVERSA_CHARS,
  referenciaDoCorpo,
  ESQUEMA_DA_VISAO,
  ESQUEMA_DO_PASSO,
  lerPasso,
  MAX_BYTES_DO_QUADRO,
  MAX_CONTEXTO_CHARS,
  MAX_FERRAMENTAS,
  MAX_QUADROS_POR_CHAMADA,
  MAX_TEXTO_DO_PEDIDO,
  motivoParaParar,
  PROVEDORES_DE_TIMESTAMP,
  sistemaDaVisao,
  sistemaDoAgente,
  sistemaDoPasso,
  tetoValido,
  trechosConferidos,
} from "./ferramentas.ts";
import { ESQUEMA_DA_RECEITA, normalizarReceita, sistemaDaReceita } from "./receita.ts";
import { blocoDoMapaDoPainel } from "../_shared/mapa-do-painel.ts";
import { AVISO_SEM_REGISTRO, blocoDaReferencia, gravarTroca, pedidoAponta, referenciaDoPedido } from "../_shared/conversa-das-mesas.ts";
import { anexoDasRegrasSeguidas, aprenderDoPedido, CAMPOS_DO_APRENDIZADO, regrasDaMesa, rotasDoAprendizado } from "../_shared/aprendizado-das-mesas.ts";
// Frente SYNC: o editor também lê o contexto completo da marca aberta (antes só o projeto que a tela mandava).
import { blocoDoContextoDoCliente, criarContextoDoAgente, PARTES_COM_O_CONTEXTO } from "../_shared/contexto-do-agente.ts";
import { ehOrdemClara } from "../_shared/ordem-clara.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { rotasDoRender } from "./render.ts";
import { rotasDoElemento } from "./elemento.ts";
import { frasesDoCorpo, sugerirAnimacoes } from "./animacoes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "mesa";
const MAX_BYTES_DA_PARTE = 24 * 1024 * 1024;
const MAX_DURACAO_DA_PARTE_S = 600;
const FILA_FAL = /^https:\/\/queue\.fal\.run\//;
const REF_TIMESTAMP = "editor_timestamp";
const REF_ALINHAMENTO = "editor_alinhamento";
const REF_AGENTE = "editor_agente";
const REF_VISAO = "editor_visao";
const REF_RECEITA = "editor_receita";
/** Frente SYNC: contexto completo da marca com cache curto (cada passo do agente não relê o banco). */
const CONTEXTO_DO_AGENTE = criarContextoDoAgente();

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

type Chamador = { userId: string; doChamador: SupabaseClient };

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa o editor de vídeo.");
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, doChamador };
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

const numero = (v: unknown, padrao = 0) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !isFinite(n) ? padrao : n;
};

/** Áudio da parte: só na pasta do editor do próprio cliente. */
function caminhoDoAudio(clientId: string, v: unknown): string {
  const c = String(v || "");
  if (c.indexOf(`${clientId}/video/editor/audio/`) !== 0 || c.indexOf("..") >= 0 || !/\.(wav|mp3|m4a|webm|ogg)$/i.test(c)) {
    throw new ErroHttp(400, "audio_invalido", "O áudio precisa estar na pasta do editor deste cliente.");
  }
  return c;
}

function conferirCusto(estimativa: number, mostrado: unknown) {
  const m = Number(mostrado);
  if (!isFinite(m) || m < 0) throw new ErroHttp(400, "custo_nao_confirmado", "Mostre o custo e confirme antes.");
  if (estimativa > m + 0.0001) {
    throw new ErroHttp(409, "custo_mudou", `O custo passou do mostrado: US$ ${estimativa.toFixed(4)}. Confirme de novo.`, { custo_estimado: estimativa });
  }
}

async function gastoDaReferencia(clientId: string, tipo: string, id: string): Promise<number> {
  const { data, error } = await servico().from("ia_usos").select("custo_usd").eq("client_id", clientId).eq("referencia_tipo", tipo).eq("referencia_id", id).limit(500);
  if (error) throw new ErroHttp(503, "carteira_indisponivel", "Não foi possível conferir a carteira agora.");
  return Math.round(((data || []) as { custo_usd: number | string }[]).reduce((s, x) => s + (Number(x.custo_usd) || 0), 0) * 10000) / 10000;
}

async function auditar(ch: Chamador, ferramenta: string, input: Record<string, unknown>, sucesso: boolean) {
  await auditLog({
    correlationId: crypto.randomUUID(),
    toolName: ferramenta,
    origin: "mesa:editor-video",
    keyId: `mesa:editor-video:${ch.userId}`,
    scopes: ["files:write"],
    input,
    success: sucesso,
    statusCode: sucesso ? 200 : 207,
    durationMs: 0,
  });
}

/** Modelo "de mentira" só para o registro do uso de áudio (não está no catálogo de texto). */
function modeloDeAudio(id: string, provedor: string, api: string): ModeloIa {
  return {
    id,
    provedor: provedor as ModeloIa["provedor"],
    modelo_api: api,
    tipo: "texto",
    rotulo: api,
    preco_entrada_1m: null,
    preco_saida_1m: null,
    preco_cache_1m: null,
    preco_imagem: null,
    raciocinio: null,
    padrao_para: null,
    ativo: true,
    fonte_preco: null,
    conferido_em: null,
  };
}

// ------------------------------------------------------------------ timestamp: whisper por parte

async function timestampEstimar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const modo = corpo.modo === "alinhar" ? "alinhar" : "transcrever";
  const d = Math.max(0, numero(corpo.duracao_s));
  const p = modo === "alinhar" ? PROVEDORES_DE_TIMESTAMP.alinhamento : PROVEDORES_DE_TIMESTAMP.whisper;
  return json({ custo_usd: custoDoTimestamp(modo, d), provedor: p.rotulo, fonte: p.fonte });
}

async function baixarAudio(caminho: string): Promise<Blob> {
  const { data, error } = await servico().storage.from(BUCKET).download(caminho);
  if (error || !data) throw new ErroHttp(404, "audio_inexistente", "A parte do áudio não chegou ao armazenamento. Mande de novo.");
  if (data.size > MAX_BYTES_DA_PARTE) throw new ErroHttp(413, "audio_grande", "Parte do áudio grande demais.");
  return data;
}

async function timestampParte(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const caminho = caminhoDoAudio(clientId, corpo.audio_path);
  const inicio = Math.max(0, numero(corpo.inicio_s));
  const duracao = numero(corpo.duracao_s);
  if (!(duracao > 0 && duracao <= MAX_DURACAO_DA_PARTE_S)) throw new ErroHttp(400, "duracao_invalida", "Parte do áudio sem duração ou longa demais.");
  const referencia = idDe(corpo.referencia_id, "referencia_id");
  const estimativa = custoDoTimestamp("transcrever", duracao);
  conferirCusto(estimativa, corpo.custo_maximo_usd);
  const chave = await resolverChave(clientId, "openai");
  garantirCota(chave, estimativa);
  await garantirSaldo(clientId, estimativa);
  const audio = await baixarAudio(caminho);

  const form = new FormData();
  form.append("file", new File([audio], caminho.split("/").pop() || "parte.wav", { type: audio.type || "audio/wav" }));
  form.append("model", PROVEDORES_DE_TIMESTAMP.whisper.modelo);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("language", String(corpo.idioma || "pt").slice(0, 5));
  // A legenda ou o roteiro entram como dica de vocabulário (nomes, marcas), não mudam o tempo.
  const texto = String(corpo.texto || "").replace(/\s+/g, " ").trim().slice(0, 800);
  if (texto) form.append("prompt", texto);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${chave.segredo}` }, body: form, signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new ErroHttp(504, "provedor_timeout", "A transcrição não respondeu a tempo. Tente de novo.");
  }
  if (!res.ok) {
    const st = res.status;
    throw new ErroHttp(st === 401 ? 503 : st === 429 ? 503 : 502, st === 429 ? "provedor_ocupado" : "provedor_erro", "O provedor de transcrição falhou nesta parte.", { status_provedor: st });
  }
  const j = (await res.json().catch(() => null)) as { text?: string; words?: { word: string; start: number; end: number }[] } | null;
  const palavras = deslocarPalavras(j && Array.isArray(j.words) ? j.words : [], inicio);
  const u = await registrarUso({
    clientId,
    tarefa: "leitura_referencia",
    agente: "leitor",
    modelo: modeloDeAudio("openai:whisper-1", "openai", "whisper-1"),
    tokensEntrada: 0,
    tokensSaida: 0,
    tokensCache: 0,
    imagens: 0,
    qualidade: null,
    custoUsd: estimativa,
    custoFonte: "tabela",
    referencia: { tipo: REF_TIMESTAMP, id: referencia },
    criadoPor: ch.userId,
    chave,
  });
  await auditar(ch, "editor_timestamp_parte", { client_id: clientId, duracao_s: duracao, palavras: palavras.length }, true);
  return json({ palavras, texto: j && j.text ? String(j.text).slice(0, 20000) : "", custo_usd: estimativa, saldo_usd: u.saldoUsd });
}

// ------------------------------------------------------------------ alinhamento forçado (fal)

function chaveFal(): string {
  const k = (Deno.env.get("FAL_KEY") || "").trim();
  if (!k) throw new ErroHttp(503, "provedor_sem_chave", "O alinhamento ainda não tem chave (FAL_KEY).");
  return k;
}

async function alinharIniciar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const caminho = caminhoDoAudio(clientId, corpo.audio_path);
  const texto = String(corpo.texto || "").replace(/\s+/g, " ").trim();
  if (texto.length < 2) throw new ErroHttp(400, "texto_vazio", "Mande a legenda ou o roteiro para alinhar.");
  if (texto.length > 100_000) throw new ErroHttp(413, "texto_grande", "Texto grande demais para alinhar.");
  idDe(corpo.referencia_id, "referencia_id");
  const estimativa = custoDoTimestamp("alinhar", numero(corpo.duracao_s));
  conferirCusto(estimativa, corpo.custo_maximo_usd);
  await garantirSaldo(clientId, estimativa);
  const { data: assinada, error } = await servico().storage.from(BUCKET).createSignedUrl(caminho, 3600);
  if (error || !assinada?.signedUrl) throw new ErroHttp(404, "audio_inexistente", "O áudio não chegou ao armazenamento. Mande de novo.");
  let res: Response;
  try {
    res = await fetch(`https://queue.fal.run/${PROVEDORES_DE_TIMESTAMP.alinhamento.modelo}`, {
      method: "POST",
      headers: { Authorization: `Key ${chaveFal()}`, "Content-Type": "application/json", "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: 86400 }) },
      body: JSON.stringify({ audio_url: assinada.signedUrl, text: texto }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ErroHttp(502, "provedor_inalcancavel", "Não foi possível falar com o alinhamento.");
  }
  if (!res.ok) throw new ErroHttp(res.status === 402 ? 402 : 502, res.status === 402 ? "provedor_sem_credito" : "provedor_erro", "O alinhamento recusou o pedido.", { status_provedor: res.status });
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const pedido = { request_id: String(j?.request_id || ""), status_url: String(j?.status_url || ""), response_url: String(j?.response_url || "") };
  if (!pedido.request_id || !FILA_FAL.test(pedido.status_url) || !FILA_FAL.test(pedido.response_url)) throw new ErroHttp(502, "provedor_resposta_invalida", "O alinhamento não devolveu o pedido.");
  await auditar(ch, "editor_alinhar_iniciar", { client_id: clientId, caracteres: texto.length }, true);
  return json({ pedido, custo_usd: estimativa });
}

async function alinharAndamento(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const referencia = idDe(corpo.referencia_id, "referencia_id");
  const p = corpo.pedido && typeof corpo.pedido === "object" ? (corpo.pedido as Record<string, unknown>) : {};
  const statusUrl = String(p.status_url || "");
  const respostaUrl = String(p.response_url || "");
  if (!FILA_FAL.test(statusUrl) || !FILA_FAL.test(respostaUrl)) throw new ErroHttp(400, "pedido_invalido", "Pedido de alinhamento inválido.");
  const cab = { Authorization: `Key ${chaveFal()}` };
  const st = await fetch(statusUrl, { headers: cab, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!st) return json({ situacao: "processando" });
  const s = (await st.json().catch(() => null)) as Record<string, unknown> | null;
  if (String(s?.status || "") !== "COMPLETED") return json({ situacao: String(s?.status || "") === "IN_PROGRESS" ? "processando" : "na_fila" });
  const r = await fetch(respostaUrl, { headers: cab, signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!r || !r.ok) throw new ErroHttp(502, "provedor_erro", "Não foi possível ler o alinhamento.");
  const j = (await r.json().catch(() => null)) as { words?: { text: string; start: number; end: number }[]; characters?: { text: string; start: number; end: number }[] } | null;
  const palavras = deslocarPalavras(j && Array.isArray(j.words) ? j.words : [], 0);
  const letras = deslocarPalavras(j && Array.isArray(j.characters) ? j.characters.filter((c) => String(c.text).trim()) : [], 0).slice(0, 60000);
  const estimativa = custoDoTimestamp("alinhar", numero(corpo.duracao_s));
  // Cobra uma vez só por referência (a tela pode perguntar de novo).
  let custo = 0;
  let saldo: number | null = null;
  if ((await gastoDaReferencia(clientId, REF_ALINHAMENTO, referencia)) <= 0) {
    const u = await registrarUso({
      clientId,
      tarefa: "leitura_referencia",
      agente: "leitor",
      modelo: modeloDeAudio("fal:elevenlabs/forced-alignment", "fal", PROVEDORES_DE_TIMESTAMP.alinhamento.modelo),
      tokensEntrada: 0,
      tokensSaida: 0,
      tokensCache: 0,
      imagens: 0,
      qualidade: null,
      custoUsd: estimativa,
      custoFonte: "tabela",
      referencia: { tipo: REF_ALINHAMENTO, id: referencia },
      criadoPor: ch.userId,
      chave: { segredo: "", origem: "agencia", chaveId: null, cotaMensalUsd: null, gastoMesUsd: 0 },
    });
    custo = estimativa;
    saldo = u.saldoUsd;
    await auditar(ch, "editor_alinhar_pronto", { client_id: clientId, palavras: palavras.length }, true);
  }
  return json({ situacao: "pronto", palavras, letras, custo_usd: custo, saldo_usd: saldo });
}

// ------------------------------------------------------------------ agente editor (um passo)

function historicoValido(v: unknown): MensagemMotor[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(-20)
    .map((m) => {
      const o = m && typeof m === "object" ? (m as Record<string, unknown>) : {};
      const papel = o.papel === "agente" ? "agente" : "usuario";
      const conteudo = String(o.conteudo || "").slice(0, 8000);
      return conteudo ? ({ papel, conteudo } as MensagemMotor) : null;
    })
    .filter((m): m is MensagemMotor => !!m);
}

/** Esquema do passo com o aprendizado (AG2): regra_aprendida e regras_seguidas, estrito (todos em required). */
const ESQUEMA_DO_PASSO_COM_APRENDIZADO = {
  nome: ESQUEMA_DO_PASSO.nome,
  schema: {
    ...ESQUEMA_DO_PASSO.schema,
    required: [...ESQUEMA_DO_PASSO.schema.required, "regra_aprendida", "regras_seguidas"],
    properties: { ...ESQUEMA_DO_PASSO.schema.properties, ...CAMPOS_DO_APRENDIZADO },
  },
};

/** Última fala do agente na conversa curta que a tela mandou ("Agente: ..."). */
function ultimaFalaDoAgente(conversa: string): string | null {
  const linhas = conversa.split("\n").filter((l) => l.indexOf("Agente: ") === 0);
  return linhas.length ? linhas[linhas.length - 1].slice(8) : null;
}

async function agentePasso(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const referencia = idDe(corpo.referencia_id, "referencia_id");
  const modeloId = String(corpo.modelo_id || "");
  const raciocinio = corpo.raciocinio ? String(corpo.raciocinio) : undefined;
  const passo = Math.max(1, Math.floor(numero(corpo.passo, 1)));
  const usadas = Math.max(0, Math.floor(numero(corpo.ferramentas_usadas, 0)));
  const teto = tetoValido(corpo.teto_usd);
  const pedido = String(corpo.pedido || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO_DO_PEDIDO);
  if (!pedido) throw new ErroHttp(400, "pedido_vazio", "Escreva o que o agente deve fazer.");
  const contexto = String(corpo.contexto || "").slice(0, MAX_CONTEXTO_CHARS);
  const conversa = String(corpo.conversa || "").slice(-MAX_CONVERSA_CHARS);
  const itens = itensDoCorpo(corpo.itens_referencia);
  const selecionados = (Array.isArray(corpo.selecionados) ? corpo.selecionados : []).map((x) => String(x || "")).filter((r) => APELIDO_DE_CLIPE.test(r)).slice(0, 12);
  // Frente SYNC: a marca aberta (marca_id vem pela tela) vale no contexto, nas regras e no que aprende.
  const marcaId = typeof corpo.marca_id === "string" && UUID.test(corpo.marca_id) ? corpo.marca_id : null;
  const contextoDaMarcaP = CONTEXTO_DO_AGENTE.ler(servico(), clientId, ["arte", "copy", "geral"], { marca: marcaId, partes: PARTES_COM_O_CONTEXTO.concat(["kit"]), area: "video" })
    .catch((e) => (registrarFalha("editor-video: contexto da marca não lido", e), ""));
  // AG2: o que já é lido vai em paralelo (gasto da sessão, regras ensinadas e, no passo 1, "essa/o segundo/todos" pelo Jev).
  const [gasto, regras, refDoPasso1] = await Promise.all([
    gastoDaReferencia(clientId, REF_AGENTE, referencia),
    regrasDaMesa(servico(), { clientId, mesa: "edicao", marcaId }),
    passo === 1 && itens.length && pedidoAponta(pedido) ? referenciaDoPedido(pedido, itens, { agente: "editor_video", ultimaResposta: ultimaFalaDoAgente(conversa), selecionados }) : Promise.resolve(null),
  ]);
  const ref = passo === 1 ? refDoPasso1 : referenciaDoCorpo(corpo.referencia, itens);
  const parar = motivoParaParar({ passo, ferramentasUsadas: usadas, gastoUsd: gasto, tetoUsd: teto });
  if (parar) return json({ passo: { plano: "", chamadas: [], resposta: parar, terminou: true, recusadas: [], opcoes: [] }, custo_usd: 0, gasto_usd: gasto, parou: true });
  const m = await carregarModelo(modeloId, "texto");
  // Frente SYNC: o contexto completo da marca vai junto do projeto (a tela manda o projeto; o painel, a marca).
  const contextoDaMarca = await contextoDaMarcaP;
  const mensagens: MensagemMotor[] = [
    { papel: "usuario", conteudo: `Pedido do dono: ${pedido}\n\n${conversa ? `Conversa até aqui (mais antiga primeiro):\n${conversa}\n\n` : ""}Projeto agora:\n${contexto}${contextoDaMarca ? `\n\n${blocoDoContextoDoCliente(contextoDaMarca)}` : ""}` },
    ...historicoValido(corpo.historico),
  ];
  // AB2 (F): o agente de edição sabe onde cada coisa fica no painel (só na conversa, nunca na visão nem na receita).
  const sistema = `${sistemaDoAgente()}\n\n${blocoDoMapaDoPainel("edicao")}`;
  // AG2: as regras que a equipe ensinou (EVITAR primeiro) e a referência do pedido vão no sistema, em todo passo.
  const sistemaCompleto = sistemaDoPasso(sistema, regras.bloco, blocoDaReferencia(ref, itens));
  const estimativa = estimarComModelo(m, { tokensEntrada: Math.ceil((sistemaCompleto.length + mensagens.reduce((s, x) => s + x.conteudo.length, 0)) / 3.5), tokensSaida: 4000 });
  if (gasto + estimativa > teto) {
    return json({ passo: { plano: "", chamadas: [], resposta: `O próximo passo passaria do teto de US$ ${teto.toFixed(2)}. Aumente o teto ou simplifique o pedido.`, terminou: true, recusadas: [], opcoes: [] }, custo_usd: 0, gasto_usd: gasto, parou: true });
  }
  return respostaComFolego(async () => {
    try {
      const r = await chamarTexto({
        clientId,
        tarefa: "conversa",
        agente: "diretor_arte",
        modeloId,
        sistema: sistemaCompleto,
        mensagens,
        raciocinio,
        esquemaJson: ESQUEMA_DO_PASSO_COM_APRENDIZADO,
        referencia: { tipo: REF_AGENTE, id: referencia },
        criadoPor: ch.userId,
      });
      const lido = lerPasso(r.json, Math.max(0, MAX_FERRAMENTAS - usadas));
      const j = r.json && typeof r.json === "object" ? (r.json as Record<string, unknown>) : {};
      const seguidas = anexoDasRegrasSeguidas(j.regras_seguidas, regras.regras);
      // Aprender: depois do principal e sem nunca travar o passo (aprenderDoPedido não lança).
      const regraSugerida = typeof j.regra_aprendida === "string" && j.regra_aprendida.trim() ? j.regra_aprendida : null;
      const aprendido = passo === 1 || (regraSugerida && corpo.ja_aprendeu !== true)
        ? await aprenderDoPedido(servico(), { clientId, mesa: "edicao", pedido, regraSugerida, marcaId, userId: ch.userId, ultimaResposta: ultimaFalaDoAgente(conversa) })
        : null;
      await auditar(ch, "editor_agente_passo", { client_id: clientId, passo, chamadas: lido.chamadas.length, modelo_id: r.modeloId }, true);
      return json({
        passo: lido,
        custo_usd: r.custoUsd,
        gasto_usd: Math.round((gasto + r.custoUsd) * 10000) / 10000,
        saldo_usd: r.saldoUsd,
        modelo_id: r.modeloId,
        reserva_usada: r.reservaUsada || null,
        uso_id: r.usoId || null,
        referencia: passo === 1 ? ref : undefined,
        aprendido,
        regras_seguidas: seguidas,
      });
    } catch (e) {
      return respostaDeErro(e);
    }
  }, corsHeaders);
}

/** "É uma ordem clara?" (Jev Noul, sem custo para o cliente): decide se a mudança sem custo vai direto, com Desfazer. */
async function agenteOrdemClara(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const pedido = String(corpo.pedido || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO_DO_PEDIDO);
  if (!pedido) return json({ clara: false, fonte: "regra", probabilidade: null });
  const r = await ehOrdemClara(pedido, { agente: "editor_video", resumo: String(corpo.resumo || "").slice(0, 400) });
  return json({ clara: r.clara, fonte: r.fonte, probabilidade: r.probabilidade });
}

// ------------------------------------------------------------------ conversa do agente editor (AG2)

const REF_CONVERSA = "editor_agente";
const AGENTE_DA_CONVERSA = "diretor_arte";
const MAX_MENSAGENS_LIDAS = 80;
/** Campos de estado que o cartão muda depois (Confirmar, Cancelar, Desfazer, Parar). */
const ESTADO_DA_ACAO = ["executada_em", "executada_direto", "descartada_em", "desfeita_em", "parada_em", "resultados", "andamento"];

/** A versão do vídeo existe e é deste cliente (o id vem da tela: confere no banco antes de gravar). */
async function garantirVersao(clientId: string, versaoId: string) {
  const { data, error } = await servico().from("video_versoes").select("id").eq("id", versaoId).eq("client_id", clientId).maybeSingle();
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não foi possível conferir a versão agora.");
  if (!data) throw new ErroHttp(404, "versao_inexistente", "Esta versão do vídeo não existe mais. Abra o editor de novo.");
}

async function conversaDaVersao(clientId: string, versaoId: string, userId: string | null): Promise<string | null> {
  const { data, error } = await servico()
    .from("agente_conversas")
    .select("id")
    .eq("client_id", clientId)
    .eq("agente", AGENTE_DA_CONVERSA)
    .eq("referencia_tipo", REF_CONVERSA)
    .eq("referencia_id", versaoId)
    .order("criado_em", { ascending: false })
    .limit(1);
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não foi possível ler a conversa agora.");
  const existente = ((data as { id: string }[] | null) ?? [])[0];
  if (existente) return existente.id;
  if (!userId) return null;
  const { data: nova, error: e2 } = await servico()
    .from("agente_conversas")
    .insert({ client_id: clientId, agente: AGENTE_DA_CONVERSA, referencia_tipo: REF_CONVERSA, referencia_id: versaoId, criado_por: userId })
    .select("id")
    .single();
  if (e2 || !nova) throw new ErroHttp(500, "conversa_nao_criada", "Não foi possível abrir a conversa do agente editor.");
  return (nova as { id: string }).id;
}

async function conversaLer(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const versaoId = idDe(corpo.versao_id, "versao_id");
  const conversaId = await conversaDaVersao(clientId, versaoId, null);
  if (!conversaId) return json({ conversa_id: null, mensagens: [] });
  const { data, error } = await servico()
    .from("agente_mensagens")
    .select("id, papel, conteudo, anexos, criado_em")
    .eq("conversa_id", conversaId)
    .eq("client_id", clientId)
    .order("criado_em", { ascending: false })
    .limit(MAX_MENSAGENS_LIDAS);
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não foi possível ler a conversa agora.");
  return json({ conversa_id: conversaId, mensagens: ((data as unknown[] | null) ?? []).slice().reverse() });
}

async function conversaGravar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const versaoId = idDe(corpo.versao_id, "versao_id");
  const u = corpo.usuario && typeof corpo.usuario === "object" ? (corpo.usuario as Record<string, unknown>) : {};
  const a = corpo.agente && typeof corpo.agente === "object" ? (corpo.agente as Record<string, unknown>) : {};
  const doUsuario = String(u.conteudo || "").trim().slice(0, 4000);
  const doAgente = String(a.conteudo || "").trim().slice(0, 8000);
  if (!doUsuario) throw new ErroHttp(400, "pedido_vazio", "Sem o pedido para guardar.");
  await garantirVersao(clientId, versaoId);
  const conversaId = (await conversaDaVersao(clientId, versaoId, ch.userId)) as string;
  // uso_id só se o uso é deste cliente (o id vem da tela).
  let usoId: string | null = null;
  if (UUID.test(String(corpo.uso_id || ""))) {
    const { data } = await servico().from("ia_usos").select("id").eq("id", String(corpo.uso_id)).eq("client_id", clientId).maybeSingle();
    usoId = data ? String((data as { id: string }).id) : null;
  }
  const t = await gravarTroca(servico(), {
    conversaId,
    clientId,
    usuario: { conteudo: doUsuario, anexos: [] },
    agente: { conteudo: doAgente || "(sem texto)", anexos: anexosDoEditor(a.anexos), uso_id: usoId },
    onde: "editor-video",
  });
  return json({ conversa_id: conversaId, usuario_id: t.usuarioId, mensagem_id: t.agenteId, aviso_registro: t.erro ? AVISO_SEM_REGISTRO : null });
}

/** O cartão mudou de estado (Confirmar, Cancelar, Desfazer): a mensagem guardada acompanha, e reabrir não volta a "Confirmar". */
async function conversaMarcar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const mensagemId = idDe(corpo.mensagem_id, "mensagem_id");
  const nova = corpo.cartao && typeof corpo.cartao === "object" ? (corpo.cartao as Record<string, unknown>) : null;
  const acaoId = nova ? String(nova.id || "") : "";
  if (!nova || !acaoId) throw new ErroHttp(400, "acao_invalida", "Sem a ação para marcar.");
  const { data, error } = await servico().from("agente_mensagens").select("id, conversa_id, anexos").eq("id", mensagemId).eq("client_id", clientId).maybeSingle();
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não foi possível ler a mensagem agora.");
  if (!data) throw new ErroHttp(404, "mensagem_inexistente", "A mensagem desta ação não existe.");
  const linha = data as { conversa_id: string; anexos: unknown };
  const { data: conv } = await servico().from("agente_conversas").select("id").eq("id", linha.conversa_id).eq("client_id", clientId).eq("referencia_tipo", REF_CONVERSA).maybeSingle();
  if (!conv) throw new ErroHttp(404, "mensagem_inexistente", "A mensagem não é do agente editor.");
  let achou = false;
  const anexos = (Array.isArray(linha.anexos) ? linha.anexos : []).map((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    if (!o || o.tipo !== "acao_agente" || String(o.id) !== acaoId) return x;
    achou = true;
    const junto: Record<string, unknown> = { ...o };
    ESTADO_DA_ACAO.forEach((k) => {
      if (nova[k] !== undefined) junto[k] = nova[k];
    });
    // Resolvida: as operações guardadas para confirmar depois não servem mais.
    if ((junto.executada_em || junto.descartada_em) && junto.contexto && typeof junto.contexto === "object") {
      const { operacoes: _fora, ...resto } = junto.contexto as Record<string, unknown>;
      junto.contexto = resto;
    }
    return junto;
  });
  if (!achou) throw new ErroHttp(404, "acao_inexistente", "Esta ação não está na mensagem.");
  const { error: e2 } = await servico().from("agente_mensagens").update({ anexos }).eq("id", mensagemId).eq("client_id", clientId);
  if (e2) {
    registrarFalha("editor-video: estado do cartão não gravado", e2, { mensagem_id: mensagemId });
    throw new ErroHttp(503, "banco_indisponivel", "A mudança foi feita, mas o estado do cartão não ficou guardado.");
  }
  return json({ ok: true });
}

const ROTAS_DO_APRENDIZADO = rotasDoAprendizado({
  mesa: "edicao",
  servico,
  garantirAcesso: (ch, clientId) => garantirAcesso(ch as Chamador, clientId),
  json,
});

// ------------------------------------------------------------------ visão

async function visaoDescrever(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const referencia = idDe(corpo.referencia_id, "referencia_id");
  const modeloId = String(corpo.modelo_id || "");
  const fonte = String(corpo.fonte || "").slice(0, 60);
  const quadros = Array.isArray(corpo.quadros) ? (corpo.quadros as Record<string, unknown>[]) : [];
  if (!quadros.length) throw new ErroHttp(400, "sem_quadros", "Nenhum quadro para ver.");
  if (quadros.length > MAX_QUADROS_POR_CHAMADA) throw new ErroHttp(413, "quadros_demais", `Até ${MAX_QUADROS_POR_CHAMADA} quadros por vez.`);
  const imagens: ImagemEntrada[] = [];
  const tempos: number[] = [];
  quadros.forEach((q, k) => {
    const t = numero(q.tempo_s, -1);
    const b64 = String(q.jpeg_base64 || "").replace(/^data:image\/[a-z]+;base64,/i, "");
    if (t < 0 || !b64) throw new ErroHttp(400, "quadro_invalido", `Quadro ${k + 1} sem tempo ou sem imagem.`);
    const bytes = deBase64(b64);
    if (bytes.length > MAX_BYTES_DO_QUADRO) throw new ErroHttp(413, "quadro_grande", `Quadro ${k + 1} grande demais.`);
    imagens.push({ bytes, mime: "image/jpeg", nome: `quadro-${k + 1}.jpg` });
    tempos.push(Math.round(t * 1000) / 1000);
  });
  const m = await carregarModelo(modeloId, "texto");
  const entrada = (m.modalidades && m.modalidades.entrada) || null;
  if (entrada && entrada.indexOf("image") < 0) throw new ErroHttp(400, "modelo_sem_imagem", "Esse modelo não vê imagem. Escolha outro.");
  const sistema = sistemaDaVisao();
  const legenda = `Fonte ${fonte}. Quadros, na ordem: ${tempos.map((t, k) => `${k + 1}) ${t.toFixed(2)} s`).join("; ")}.`;
  const estimativa = estimarComModelo(m, { tokensEntrada: Math.ceil((sistema.length + legenda.length) / 3.5) + imagens.length * 1600, tokensSaida: 2500 });
  conferirCusto(estimativa, corpo.custo_maximo_usd);
  return respostaComFolego(async () => {
    try {
      const r = await chamarTexto({
        clientId,
        tarefa: "leitura_referencia",
        agente: "leitor",
        modeloId,
        sistema,
        mensagens: [{ papel: "usuario", conteudo: legenda, imagens }],
        esquemaJson: ESQUEMA_DA_VISAO,
        referencia: { tipo: REF_VISAO, id: referencia },
        criadoPor: ch.userId,
      });
      const trechos = trechosConferidos(r.json, tempos);
      await auditar(ch, "editor_visao", { client_id: clientId, quadros: tempos.length, trechos: trechos.length }, true);
      return json({ trechos, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, modelo_id: r.modeloId });
    } catch (e) {
      return respostaDeErro(e);
    }
  }, corsHeaders);
}

// ------------------------------------------------------------------ receita de edição (referência)

function quadrosDoCorpo(corpo: Record<string, unknown>): { imagens: ImagemEntrada[]; tempos: number[] } {
  const quadros = Array.isArray(corpo.quadros) ? (corpo.quadros as Record<string, unknown>[]) : [];
  if (!quadros.length) throw new ErroHttp(400, "sem_quadros", "Nenhum quadro para ver.");
  if (quadros.length > MAX_QUADROS_POR_CHAMADA) throw new ErroHttp(413, "quadros_demais", `Até ${MAX_QUADROS_POR_CHAMADA} quadros por vez.`);
  const imagens: ImagemEntrada[] = [];
  const tempos: number[] = [];
  quadros.forEach((q, k) => {
    const t = numero(q.tempo_s, -1);
    const b64 = String(q.jpeg_base64 || "").replace(/^data:image\/[a-z]+;base64,/i, "");
    if (t < 0 || !b64) throw new ErroHttp(400, "quadro_invalido", `Quadro ${k + 1} sem tempo ou sem imagem.`);
    const bytes = deBase64(b64);
    if (bytes.length > MAX_BYTES_DO_QUADRO) throw new ErroHttp(413, "quadro_grande", `Quadro ${k + 1} grande demais.`);
    imagens.push({ bytes, mime: "image/jpeg", nome: `quadro-${k + 1}.jpg` });
    tempos.push(Math.round(t * 1000) / 1000);
  });
  return { imagens, tempos };
}

async function receitaLer(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const referencia = idDe(corpo.referencia_id, "referencia_id");
  const modeloId = String(corpo.modelo_id || "");
  const { imagens, tempos } = quadrosDoCorpo(corpo);
  const medida = normalizarReceita(corpo.medida);
  const m = await carregarModelo(modeloId, "texto");
  const entrada = (m.modalidades && m.modalidades.entrada) || null;
  if (entrada && entrada.indexOf("image") < 0) throw new ErroHttp(400, "modelo_sem_imagem", "Esse modelo não vê imagem. Escolha outro.");
  const sistema = sistemaDaReceita();
  const legenda = [
    `Quadros, na ordem: ${tempos.map((t, k) => `${k + 1}) ${t.toFixed(2)} s`).join("; ")}.`,
    medida ? `Medido: duração ${medida.duracao_s} s, ${medida.cortes.length} cortes em ${medida.cortes.slice(0, 80).join(", ")}; plano mediano ${medida.plano_mediano_s} s.` : "",
  ].join("\n");
  const estimativa = estimarComModelo(m, { tokensEntrada: Math.ceil((sistema.length + legenda.length) / 3.5) + imagens.length * 1600, tokensSaida: 1500 });
  conferirCusto(estimativa, corpo.custo_maximo_usd);
  return respostaComFolego(async () => {
    try {
      const r = await chamarTexto({
        clientId,
        tarefa: "leitura_referencia",
        agente: "leitor",
        modeloId,
        sistema,
        mensagens: [{ papel: "usuario", conteudo: legenda, imagens }],
        esquemaJson: ESQUEMA_DA_RECEITA,
        referencia: { tipo: REF_RECEITA, id: referencia },
        criadoPor: ch.userId,
      });
      await auditar(ch, "editor_receita_ler", { client_id: clientId, quadros: tempos.length }, true);
      return json({ visao: r.json && typeof r.json === "object" ? r.json : null, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, modelo_id: r.modeloId });
    } catch (e) {
      return respostaDeErro(e);
    }
  }, corsHeaders);
}

function erroDaTabelaDeReceitas(error: { message?: string; code?: string } | null): ErroHttp {
  const m = String((error && error.message) || "");
  if (/does not exist|schema cache|42P01|PGRST205/i.test(m) || (error && error.code === "42P01")) {
    return new ErroHttp(503, "banco_sem_receitas", "Os templates de edição ainda não foram ativados no banco (SQL V-B-01). A receita segue guardada no projeto.");
  }
  return new ErroHttp(500, "banco_indisponivel", "Não foi possível gravar agora. Tente de novo.");
}

async function receitaSalvar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = corpo.client_id ? String(corpo.client_id) : null;
  if (clientId) await garantirAcesso(ch, clientId);
  const nome = String(corpo.nome || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!nome) throw new ErroHttp(400, "nome_vazio", "Dê um nome ao template.");
  const receita = normalizarReceita(corpo.receita);
  if (!receita) throw new ErroHttp(400, "receita_invalida", "Receita em formato desconhecido.");
  const o = corpo.origem && typeof corpo.origem === "object" ? (corpo.origem as Record<string, unknown>) : {};
  // Só o endereço da referência (sem conteúdo): link ou caminho no painel.
  const origem = { url: o.url ? String(o.url).slice(0, 600) : null, storage_path: o.storage_path ? String(o.storage_path).slice(0, 400) : null, rede: o.rede ? String(o.rede).slice(0, 20) : null };
  const { data, error } = await servico().from("video_receitas").insert({ client_id: clientId, nome, origem, receita, criado_por: ch.userId }).select("*").single();
  if (error) throw erroDaTabelaDeReceitas(error);
  await auditar(ch, "editor_receita_salvar", { client_id: clientId, nome }, true);
  return json({ receita: data });
}

async function receitaArquivar(ch: Chamador, corpo: Record<string, unknown>) {
  const id = idDe(corpo.id, "id");
  const { data, error } = await servico().from("video_receitas").select("id, client_id").eq("id", id).maybeSingle();
  if (error) throw erroDaTabelaDeReceitas(error);
  if (!data) throw new ErroHttp(404, "receita_inexistente", "Template não encontrado.");
  const clientId = (data as { client_id: string | null }).client_id;
  if (clientId) await garantirAcesso(ch, clientId);
  const { error: e2 } = await servico().from("video_receitas").update({ arquivada_em: new Date().toISOString() }).eq("id", id);
  if (e2) throw erroDaTabelaDeReceitas(e2);
  await auditar(ch, "editor_receita_arquivar", { id }, true);
  return json({ ok: true });
}

// ------------------------------------------------------------------ frente EDT: render, animações, elemento

const ROTAS_DO_RENDER = rotasDoRender({
  servico,
  garantirAcesso: (ch, clientId) => garantirAcesso(ch as Chamador, clientId),
  json,
  erro: (status, codigo, mensagem, extra) => new ErroHttp(status, codigo, mensagem, extra || {}),
  userId: (ch) => (ch as Chamador).userId,
  auditar: (ch, f, input, ok) => auditar(ch as Chamador, f, input, ok),
});

const ROTAS_DO_ELEMENTO = rotasDoElemento({
  servico,
  garantirAcesso: (ch, clientId) => garantirAcesso(ch as Chamador, clientId),
  json,
  erro: (status, codigo, mensagem, extra) => new ErroHttp(status, codigo, mensagem, extra || {}),
  userId: (ch) => (ch as Chamador).userId,
  folego: (f) => respostaComFolego(f, corsHeaders),
  respostaDeErro: (e) => respostaDeErro(e),
});

/** Em quais frases ditas entra animação e qual peça (Jev; sem custo para o cliente). */
async function animacoesSugerir(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const frases = frasesDoCorpo(corpo.frases);
  if (!frases.length) return json({ sugestoes: [], fonte: "regra" });
  const densidade = corpo.densidade === "poucas" ? "poucas" : "medias";
  try {
    const sugestoes = await sugerirAnimacoes(frases, densidade);
    await auditar(ch, "editor_animacoes_sugerir", { client_id: clientId, frases: frases.length, sugestoes: sugestoes.length }, true);
    return json({ sugestoes, fonte: "jev" });
  } catch (e) {
    registrarFalha("editor-video: Jev não sugeriu animações", e, { client_id: clientId, frases: frases.length });
    throw new ErroHttp(503, "jev_indisponivel", "O julgamento das animações não respondeu agora. Peça as peças pelo nome (ex.: contador no 300).");
  }
}

// ------------------------------------------------------------------ roteador

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof IaMotorErro) return json(err.paraJson(), err.status);
  console.error("[editor-video] erro inesperado", { nome: err instanceof Error ? err.name : "desconhecido" });
  return json({ error: "erro_interno", mensagem: "Falha inesperada no editor de vídeo." }, 500);
}

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  timestamp_estimar: timestampEstimar,
  timestamp_parte: timestampParte,
  alinhar_iniciar: alinharIniciar,
  alinhar_andamento: alinharAndamento,
  agente_passo: agentePasso,
  agente_ordem_clara: agenteOrdemClara,
  conversa_ler: conversaLer,
  conversa_gravar: conversaGravar,
  conversa_marcar: conversaMarcar,
  aprendizado_esquecer: ROTAS_DO_APRENDIZADO.aprendizado_esquecer,
  aprendizado_guardar: ROTAS_DO_APRENDIZADO.aprendizado_guardar,
  visao_descrever: visaoDescrever,
  receita_ler: receitaLer,
  receita_salvar: receitaSalvar,
  receita_arquivar: receitaArquivar,
  render_pedir: ROTAS_DO_RENDER.render_pedir as (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>,
  render_status: ROTAS_DO_RENDER.render_status as (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>,
  render_cancelar: ROTAS_DO_RENDER.render_cancelar as (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>,
  animacoes_sugerir: animacoesSugerir,
  elemento_estimar: ROTAS_DO_ELEMENTO.elemento_estimar as (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>,
  elemento_gerar: ROTAS_DO_ELEMENTO.elemento_gerar as (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>,
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
    const fn = ACOES[String(corpo.acao ?? "")];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    return await fn(chamador, corpo);
  } catch (err) {
    return respostaDeErro(err);
  }
});
