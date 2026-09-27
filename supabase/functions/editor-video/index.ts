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
  custoDoTimestamp,
  deslocarPalavras,
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
  tetoValido,
  trechosConferidos,
} from "./ferramentas.ts";
import { ESQUEMA_DA_RECEITA, normalizarReceita, sistemaDaReceita } from "./receita.ts";
import { blocoDoMapaDoPainel } from "../_shared/mapa-do-painel.ts";

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
  const gasto = await gastoDaReferencia(clientId, REF_AGENTE, referencia);
  const parar = motivoParaParar({ passo, ferramentasUsadas: usadas, gastoUsd: gasto, tetoUsd: teto });
  if (parar) return json({ passo: { plano: "", chamadas: [], resposta: parar, terminou: true, recusadas: [] }, custo_usd: 0, gasto_usd: gasto, parou: true });
  const m = await carregarModelo(modeloId, "texto");
  const mensagens: MensagemMotor[] = [
    { papel: "usuario", conteudo: `Pedido do dono: ${pedido}\n\nProjeto agora:\n${contexto}` },
    ...historicoValido(corpo.historico),
  ];
  // AB2 (F): o agente de edição sabe onde cada coisa fica no painel (só na conversa, nunca na visão nem na receita).
  const sistema = `${sistemaDoAgente()}\n\n${blocoDoMapaDoPainel("edicao")}`;
  const estimativa = estimarComModelo(m, { tokensEntrada: Math.ceil((sistema.length + mensagens.reduce((s, x) => s + x.conteudo.length, 0)) / 3.5), tokensSaida: 4000 });
  if (gasto + estimativa > teto) {
    return json({ passo: { plano: "", chamadas: [], resposta: `O próximo passo passaria do teto de US$ ${teto.toFixed(2)}. Aumente o teto ou simplifique o pedido.`, terminou: true, recusadas: [] }, custo_usd: 0, gasto_usd: gasto, parou: true });
  }
  return respostaComFolego(async () => {
    try {
      const r = await chamarTexto({
        clientId,
        tarefa: "conversa",
        agente: "diretor_arte",
        modeloId,
        sistema,
        mensagens,
        raciocinio,
        esquemaJson: ESQUEMA_DO_PASSO,
        referencia: { tipo: REF_AGENTE, id: referencia },
        criadoPor: ch.userId,
      });
      const lido = lerPasso(r.json, Math.max(0, MAX_FERRAMENTAS - usadas));
      await auditar(ch, "editor_agente_passo", { client_id: clientId, passo, chamadas: lido.chamadas.length, modelo_id: r.modeloId }, true);
      return json({ passo: lido, custo_usd: r.custoUsd, gasto_usd: Math.round((gasto + r.custoUsd) * 10000) / 10000, saldo_usd: r.saldoUsd, modelo_id: r.modeloId, reserva_usada: r.reservaUsada || null });
    } catch (e) {
      return respostaDeErro(e);
    }
  }, corsHeaders);
}

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
  visao_descrever: visaoDescrever,
  receita_ler: receitaLer,
  receita_salvar: receitaSalvar,
  receita_arquivar: receitaArquivar,
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
