/**
 * gestor-aceleriq (Central de Autonomia, 08/10/2026): o chat do dono sobre a
 * operação real, dentro de /execucao.
 *
 * Só admin. Cada pergunta:
 * 1. confere a sessão e o papel ANTES de ler qualquer dado (chave de serviço
 *    só depois disso);
 * 2. tira da pergunta o cliente (nome exato; marca secundária restringe ao
 *    projeto dela; nome com erro: Jev escolhe na lista real, ou pergunta de
 *    volta) e o período (fuso de São Paulo, com o período anterior);
 * 3. lê os fatos do recorte: tarefas, execuções dos agentes, diário com prova,
 *    publicações, entregas e aprovações, e monta a FICHA (modulos/ficha.ts),
 *    com o estado de cada fonte decidido em código (revisão nunca vira feito);
 * 4. o modelo configurado (ia_modelos, papel "estrategista", carteira da
 *    agência) só redige itens que citam apelidos da ficha; o código recusa
 *    item sem fonte, com fonte inventada ou em seção que o estado não
 *    permite; o Jev confere cada afirmação contra a fonte citada;
 * 5. sem IA (sem crédito, fora do ar, teto do dia, "sem_ia"), a resposta sai
 *    da própria ficha. Nada é inventado nos dois caminhos.
 *
 * O Gestor NÃO executa nada: não move tarefa, não aprova, não publica. Levar
 * um pedido ao Hermes é feito na tela, pelo diário do vínculo (o canal que o
 * consumidor do Hermes já lê), com o dono enviando.
 *
 * Ações: perguntar { pergunta, cliente_id?, periodo?, sem_ia? } · conversa {}
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { IaMotorErro } from "../_shared/ia-motor.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { carteiraDaAgencia, ErroHttp, responder, usarBanco } from "./modulos/nucleo.ts";
import { type ArquivoDoDono, MAX_IMAGENS } from "./modulos/ficha.ts";
import { ErroDaTranscricao, MAX_BYTES_DO_AUDIO_DO_GESTOR, transcreverAudio } from "./modulos/transcricao.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gestor-acao, x-gestor-duracao",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Teto de perguntas com IA por dono por dia (São Paulo). Passou: responde sem IA, avisando. */
export const PERGUNTAS_COM_IA_POR_DIA = 60;

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
  if (err instanceof ErroDaTranscricao) return json({ error: err.codigo, mensagem: err.message }, err.status);
  if (err instanceof IaMotorErro) return json(err.paraJson(), err.status);
  registrarFalha("gestor-aceleriq: falha", err);
  return json({ error: "falha_interna", mensagem: "O Gestor falhou ao montar a resposta. Tente de novo." }, 500);
}

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  return servicoCache;
}

async function identificar(req: Request): Promise<{ userId: string }> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const admin = await servico().rpc("has_role", { _user_id: userId, _role: "admin" });
  if (admin.error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (admin.data !== true) throw new ErroHttp(403, "somente_admin", "O Gestor Aceleriq é do admin.");
  return { userId };
}

// ------------------------------------------------------------------ ações

async function perguntasDeHoje(userId: string): Promise<number> {
  const agora = new Date();
  const local = new Date(agora.getTime() - 3 * 3_600_000);
  const meia = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 3 * 3_600_000).toISOString();
  const { count } = await servico().from("gestor_mensagens").select("id", { count: "exact", head: true }).eq("dono_id", userId).eq("papel", "gestor").gte("criado_em", meia).contains("dados", { origem: "ia_conferida" });
  return count || 0;
}

async function ultimas(userId: string, n: number) {
  const { data, error } = await servico().from("gestor_mensagens").select("id, papel, conteudo, dados, client_id, custo_usd, criado_em").eq("dono_id", userId).order("criado_em", { ascending: false }).limit(n);
  if (error) throw new ErroHttp(503, "conversa_indisponivel", `Não consegui ler a conversa: ${error.message}`);
  return ((data || []) as Array<Record<string, unknown>>).reverse();
}

/** Texto que o navegador leu dos arquivos (o mesmo leitor do agente do Mês). Teto bruto; o corte fino é no núcleo. */
function arquivosDoCorpo(bruto: unknown): ArquivoDoDono[] {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const lidos = Array.isArray(o.lidos) ? o.lidos.slice(0, 30) : [];
  let total = 0;
  const saida: ArquivoDoDono[] = [];
  for (const a of lidos) {
    const x = (a ?? {}) as Record<string, unknown>;
    const texto = typeof x.texto === "string" ? x.texto.slice(0, 200_000) : "";
    if (!texto.trim() || total > 300_000) continue;
    total += texto.length;
    saida.push({ nome: String(x.nome || "arquivo").slice(0, 200), tipo: String(x.tipo || "texto").slice(0, 30), texto, origem: x.origem ? String(x.origem).slice(0, 200) : null });
  }
  return saida;
}

const TIPOS_DE_IMAGEM = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Imagens em base64 (a tela já reduz para até 1600 px). Até 4, 5 MB cada. */
function imagensDoCorpo(bruto: unknown): Array<{ bytes: Uint8Array; mime: string; nome?: string }> {
  const lista = Array.isArray(bruto) ? bruto.slice(0, MAX_IMAGENS) : [];
  const saida: Array<{ bytes: Uint8Array; mime: string; nome?: string }> = [];
  for (const a of lista) {
    const x = (a ?? {}) as Record<string, unknown>;
    const mime = String(x.mime || "").toLowerCase();
    const b64 = typeof x.base64 === "string" ? x.base64.replace(/^data:[^,]*,/, "") : "";
    if (!TIPOS_DE_IMAGEM.has(mime) || !b64 || b64.length > 7_000_000) continue;
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      saida.push({ bytes, mime, nome: x.nome ? String(x.nome).slice(0, 120) : undefined });
    } catch { /* base64 inválido: a imagem fica de fora */ }
  }
  return saida;
}

async function perguntar(ch: { userId: string }, corpo: Record<string, unknown>): Promise<Response> {
  const arquivos = arquivosDoCorpo(corpo.arquivos);
  const imagens = imagensDoCorpo(corpo.imagens);
  const naoLidos = Array.isArray((corpo.arquivos as { nao_lidos?: unknown } | undefined)?.nao_lidos) ? ((corpo.arquivos as { nao_lidos: Array<Record<string, unknown>> }).nao_lidos).slice(0, 30).map((a) => ({ nome: String(a.nome || "arquivo").slice(0, 200), motivo: String(a.motivo || "").slice(0, 200) })) : [];
  const audio = corpo.audio && typeof corpo.audio === "object" ? { segundos: Math.round(Number((corpo.audio as { segundos?: unknown }).segundos) || 0) } : null;
  let pergunta = String(corpo.pergunta ?? "").trim().slice(0, audio ? 12_000 : 4000);
  if (!pergunta && (arquivos.length || imagens.length)) pergunta = "Leia o que eu mandei e me diga o que importa para a operação.";
  if (!pergunta) throw new ErroHttp(400, "pergunta_vazia", "Escreva a pergunta para o Gestor.");
  const dadosDoPedido = {
    anexos: arquivos.map((a) => ({ nome: a.nome, tipo: a.tipo, caracteres: a.texto.length })),
    nao_lidos: naoLidos,
    imagens: imagens.map((i) => ({ nome: i.nome || "imagem", mime: i.mime, bytes: i.bytes.byteLength })),
    audio,
  };
  const [trocas, usadasHoje] = await Promise.all([
    ultimas(ch.userId, 6).catch(() => []),
    perguntasDeHoje(ch.userId).catch(() => 0),
  ]);
  const historico = trocas.filter((t) => t.papel !== "sistema").slice(-4).map((t) => `${t.papel === "usuario" ? "Dono" : "Gestor"}: ${String(t.conteudo || "").slice(0, 300)}`).join("\n");
  usarBanco(servico());
  const r = await responder({
    pergunta,
    clienteId: typeof corpo.cliente_id === "string" && corpo.cliente_id ? corpo.cliente_id : null,
    periodo: typeof corpo.periodo === "string" ? corpo.periodo : null,
    userId: ch.userId,
    semIa: corpo.sem_ia === true,
    tetoAtingido: usadasHoje >= PERGUNTAS_COM_IA_POR_DIA,
    tetoPorDia: PERGUNTAS_COM_IA_POR_DIA,
    historico,
    arquivos,
    imagens,
  });
  if (r.tipo === "esclarecer") {
    await gravar(ch.userId, pergunta, r.texto, { tipo: "esclarecer", texto: r.texto, opcoes: r.opcoes }, null, 0, null, dadosDoPedido);
    return json(r);
  }
  const mensagemId = await gravar(ch.userId, pergunta, r.texto, r.dados, r.clienteId, r.custo, r.usoId, dadosDoPedido);
  return json({ ...r.dados, texto: r.texto, mensagem_id: mensagemId, custo_usd: r.custo, pedido: dadosDoPedido });
}

async function gravar(userId: string, pergunta: string, resposta: string, dados: Record<string, unknown>, clientId: string | null, custo: number, usoId: string | null, dadosDoPedido: Record<string, unknown> = {}): Promise<string | null> {
  const agora = Date.now();
  const { data, error } = await servico().from("gestor_mensagens").insert([
    // A pergunta guarda só o resumo dos anexos (nome, tipo, tamanho); conteúdo e imagens não ficam no banco.
    { dono_id: userId, papel: "usuario", conteudo: pergunta, dados: dadosDoPedido, client_id: clientId, criado_em: new Date(agora).toISOString() },
    { dono_id: userId, papel: "gestor", conteudo: resposta.slice(0, 12000), dados, client_id: clientId, custo_usd: custo, uso_id: usoId, criado_em: new Date(agora + 1).toISOString() },
  ]).select("id, papel");
  if (error) { registrarFalha("gestor-aceleriq: conversa não gravada", error); return null; }
  return (((data || []) as { id: string; papel: string }[]).find((m) => m.papel === "gestor") || { id: null }).id;
}

const ACOES: Record<string, (ch: { userId: string }, corpo: Record<string, unknown>) => Promise<Response>> = {
  perguntar,
  conversa: async (ch) => json({ mensagens: await ultimas(ch.userId, 40) }),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const chamador = await identificar(req);
    // Áudio: o corpo são os bytes (não JSON). Vira texto e volta para a tela, que manda a pergunta.
    if (req.headers.get("x-gestor-acao") === "transcrever") {
      try {
        const tamanho = Number(req.headers.get("content-length"));
        if (Number.isSafeInteger(tamanho) && tamanho > MAX_BYTES_DO_AUDIO_DO_GESTOR) throw new ErroDaTranscricao(413, "audio_grande", "O áudio passou de 24 MB. Mande em partes menores.");
        usarBanco(servico());
        const agencia = await carteiraDaAgencia();
        if (!agencia) throw new ErroDaTranscricao(503, "sem_carteira", "Sem carteira de IA da agência para transcrever. Escreva a mensagem.");
        const bytes = new Uint8Array(await req.arrayBuffer());
        const r = await transcreverAudio({ bytes, contentType: req.headers.get("content-type"), segundos: Number(req.headers.get("x-gestor-duracao")) || 0, agencia, userId: chamador.userId });
        return json({ texto: r.texto, segundos: r.segundos, custo_usd: r.custoUsd });
      } catch (err) {
        return respostaDeErro(err);
      }
    }
    let corpo: Record<string, unknown> = {};
    try { corpo = await req.json(); } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    const rodar = async () => { try { return await fn(chamador, corpo); } catch (err) { return respostaDeErro(err); } };
    return acao === "perguntar" ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
