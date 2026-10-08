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
import { carteiraDaAgencia, type ConversaDoGestor, ErroHttp, lerClientes, responder, usarBanco } from "./modulos/nucleo.ts";
import { type AcaoDoAgente, acaoDoAnexo, type AcaoGuardada, confirmarAcaoGuardada, desfazerAcaoGuardada, ErroDaAcao, textoDoResultado } from "../_shared/acoes-do-agente.ts";
import { entregasDaAcao, executarItem, reverterItem } from "./modulos/executor.ts";
import { ACOES_DO_HERMES, ErroDoHermes, hermesAcao } from "./modulos/hermes.ts";
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
  if (err instanceof ErroDaAcao) return json({ error: err.codigo, mensagem: err.message }, err.status);
  if (err instanceof ErroDoHermes) return json({ error: err.codigo, mensagem: err.message }, err.status);
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Conversa = { id: string; dono_id: string; client_id: string | null; project_id: string | null; titulo: string; resumo: string | null; arquivada_em: string | null; criado_em: string; atualizado_em: string };

/** A conversa do próprio dono (nunca a de outro). */
async function conversaDoDono(userId: string, id: unknown): Promise<Conversa> {
  if (typeof id !== "string" || !UUID.test(id)) throw new ErroHttp(400, "conversa_invalida", "Conversa inválida.");
  const { data, error } = await servico().from("gestor_conversas").select("*").eq("id", id).eq("dono_id", userId).maybeSingle();
  if (error) throw new ErroHttp(503, "conversa_indisponivel", `Não consegui ler a conversa: ${error.message}`);
  if (!data) throw new ErroHttp(404, "conversa_inexistente", "Conversa não encontrada.");
  return data as Conversa;
}

async function mensagensDaConversa(conversaId: string, n: number) {
  const { data, error } = await servico().from("gestor_mensagens").select("id, papel, conteudo, dados, client_id, custo_usd, criado_em").eq("conversa_id", conversaId).order("criado_em", { ascending: false }).limit(n);
  if (error) throw new ErroHttp(503, "conversa_indisponivel", `Não consegui ler a conversa: ${error.message}`);
  return ((data || []) as Array<Record<string, unknown>>).reverse();
}

/** Palavras da pergunta que valem para achar trocas antigas da MESMA conversa (sem mandar o histórico inteiro). */
function palavrasDeBusca(t: string): string[] {
  const pare = new Set(["que", "com", "para", "uma", "dos", "das", "como", "esta", "essa", "isso", "aqui", "tem", "foi", "nos", "nas", "pelo", "pela", "mais", "sobre", "qual", "quais", "quando", "onde"]);
  return [...new Set(String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !pare.has(w)))].slice(0, 5);
}

/** Contexto da conversa para o modelo: resumo + últimas trocas + até 3 trechos antigos que casam com a pergunta. */
async function contextoDaConversa(c: Conversa, pergunta: string): Promise<string> {
  const ultimas = await mensagensDaConversa(c.id, 6);
  const recentes = new Set(ultimas.map((m) => String(m.id)));
  const partes: string[] = [];
  if (c.resumo) partes.push(`Resumo da conversa: ${c.resumo}`);
  const palavras = palavrasDeBusca(pergunta);
  if (palavras.length) {
    const ou = palavras.map((w) => `conteudo.ilike.%${w}%`).join(",");
    const { data } = await servico().from("gestor_mensagens").select("id, papel, conteudo, criado_em").eq("conversa_id", c.id).or(ou).order("criado_em", { ascending: false }).limit(8);
    const antigas = ((data || []) as Array<Record<string, unknown>>).filter((m) => !recentes.has(String(m.id))).slice(0, 3);
    if (antigas.length) partes.push(`Trechos antigos desta conversa que tocam no assunto:\n${antigas.map((m) => `${m.papel === "usuario" ? "Dono" : "Gestor"} (${String(m.criado_em).slice(0, 10)}): ${String(m.conteudo || "").slice(0, 280)}`).join("\n")}`);
  }
  const trocas = ultimas.filter((t) => t.papel !== "sistema").slice(-4).map((t) => `${t.papel === "usuario" ? "Dono" : "Gestor"}: ${String(t.conteudo || "").slice(0, 300)}`).join("\n");
  if (trocas) partes.push(trocas);
  return partes.join("\n\n");
}

/** Título curto a partir da primeira pergunta (sem IA). */
function tituloDaPergunta(p: string): string {
  const t = String(p).replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57).replace(/\s+\S*$/, "")}…` : t || "Nova conversa";
}

async function listarConversas(ch: { userId: string }, corpo: Record<string, unknown>): Promise<Response> {
  const busca = String(corpo.busca ?? "").trim().slice(0, 80);
  const cliente = typeof corpo.cliente_id === "string" && UUID.test(corpo.cliente_id) ? corpo.cliente_id : null;
  let q = servico().from("gestor_conversas").select("id, client_id, project_id, titulo, resumo, arquivada_em, criado_em, atualizado_em, client:profiles!gestor_conversas_client_id_fkey(company_name, full_name)").eq("dono_id", ch.userId).order("atualizado_em", { ascending: false }).limit(100);
  if (corpo.arquivadas !== true) q = q.is("arquivada_em", null);
  if (cliente) q = q.eq("client_id", cliente);
  if (corpo.geral === true) q = q.is("client_id", null);
  const { data, error } = await q;
  if (error) throw new ErroHttp(503, "conversas_indisponiveis", `Não consegui listar as conversas: ${error.message}`);
  let lista = (data || []) as Array<Record<string, unknown>>;
  if (busca) {
    // Busca no título e no conteúdo das mensagens do dono.
    const termo = busca.replace(/[%,()]/g, " ");
    const { data: achadas } = await servico().from("gestor_mensagens").select("conversa_id").eq("dono_id", ch.userId).ilike("conteudo", `%${termo}%`).limit(200);
    const ids = new Set(((achadas || []) as Array<{ conversa_id: string }>).map((m) => m.conversa_id));
    const t = termo.toLowerCase();
    lista = lista.filter((c) => ids.has(String(c.id)) || String(c.titulo || "").toLowerCase().includes(t));
  }
  return json({ conversas: lista.map((c) => ({ ...c, cliente_nome: (c.client as { company_name?: string; full_name?: string } | null)?.company_name || (c.client as { full_name?: string } | null)?.full_name || null, client: undefined })) });
}

async function criarConversa(ch: { userId: string }, corpo: Record<string, unknown>): Promise<Response> {
  const cliente = typeof corpo.cliente_id === "string" && UUID.test(corpo.cliente_id) ? corpo.cliente_id : null;
  const projeto = typeof corpo.projeto_id === "string" && UUID.test(corpo.projeto_id) ? corpo.projeto_id : null;
  if (cliente) {
    usarBanco(servico());
    const clientes = await lerClientes();
    if (!clientes.some((c) => c.id === cliente && !c.projetoId)) throw new ErroHttp(400, "cliente_invalido", "Esse cliente não existe no cadastro.");
  }
  if (projeto) {
    const { data } = await servico().from("projects").select("id, client_id").eq("id", projeto).maybeSingle();
    const pj = data as { client_id: string | null } | null;
    if (!pj || (cliente && pj.client_id !== cliente)) throw new ErroHttp(400, "projeto_invalido", "Esse projeto não é deste cliente.");
  }
  const { data, error } = await servico().from("gestor_conversas").insert({ dono_id: ch.userId, client_id: cliente, project_id: projeto, titulo: String(corpo.titulo || "").trim().slice(0, 120) || "Nova conversa" }).select("*").single();
  if (error || !data) throw new ErroHttp(503, "conversa_nao_criada", `Não consegui criar a conversa: ${error?.message || ""}`);
  return json({ conversa: data });
}

async function atualizarConversa(ch: { userId: string }, corpo: Record<string, unknown>): Promise<Response> {
  const c = await conversaDoDono(ch.userId, corpo.conversa_id);
  const mudanca: Record<string, unknown> = {};
  if (typeof corpo.titulo === "string" && corpo.titulo.trim()) mudanca.titulo = corpo.titulo.trim().slice(0, 120);
  if (corpo.arquivar === true) mudanca.arquivada_em = new Date().toISOString();
  if (corpo.arquivar === false) mudanca.arquivada_em = null;
  if (!Object.keys(mudanca).length) return json({ conversa: c });
  const { data, error } = await servico().from("gestor_conversas").update(mudanca).eq("id", c.id).eq("dono_id", ch.userId).select("*").single();
  if (error) throw new ErroHttp(503, "conversa_nao_atualizada", error.message);
  return json({ conversa: data });
}

async function abrirConversa(ch: { userId: string }, corpo: Record<string, unknown>): Promise<Response> {
  const c = await conversaDoDono(ch.userId, corpo.conversa_id);
  return json({ conversa: c, mensagens: await mensagensDaConversa(c.id, 200) });
}

/** Opções do seletor de contexto: clientes e, com cliente, os projetos dele. */
async function opcoesDeContexto(_ch: { userId: string }, corpo: Record<string, unknown>): Promise<Response> {
  usarBanco(servico());
  const clientes = (await lerClientes()).filter((c) => !c.projetoId).map((c) => ({ id: c.id, nome: c.nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  let projetos: Array<{ id: string; nome: string; status: string | null }> = [];
  if (typeof corpo.cliente_id === "string" && UUID.test(corpo.cliente_id)) {
    const { data } = await servico().from("projects").select("id, name, status").eq("client_id", corpo.cliente_id).order("updated_at", { ascending: false }).limit(40);
    projetos = ((data || []) as Array<{ id: string; name: string; status: string | null }>).map((p) => ({ id: p.id, nome: p.name, status: p.status }));
  }
  return json({ clientes, projetos });
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
  // Toda pergunta mora numa conversa (sem conversa: nasce uma, no recorte pedido).
  let conversa: Conversa;
  if (corpo.conversa_id) conversa = await conversaDoDono(ch.userId, corpo.conversa_id);
  else {
    const cliente = typeof corpo.cliente_id === "string" && UUID.test(corpo.cliente_id) ? corpo.cliente_id : null;
    const { data, error } = await servico().from("gestor_conversas").insert({ dono_id: ch.userId, client_id: cliente, titulo: tituloDaPergunta(pergunta) }).select("*").single();
    if (error || !data) throw new ErroHttp(503, "conversa_nao_criada", "Não consegui abrir a conversa.");
    conversa = data as Conversa;
  }
  const [historico, usadasHoje] = await Promise.all([
    contextoDaConversa(conversa, pergunta).catch(() => ""),
    perguntasDeHoje(ch.userId).catch(() => 0),
  ]);
  usarBanco(servico());
  const r = await responder({
    conversa: { id: conversa.id, client_id: conversa.client_id, project_id: conversa.project_id } as ConversaDoGestor,
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
    await gravar(ch.userId, conversa, pergunta, r.texto, { tipo: "esclarecer", texto: r.texto, opcoes: r.opcoes }, null, 0, null, dadosDoPedido);
    return json({ ...r, conversa_id: conversa.id });
  }
  const mensagemId = await gravar(ch.userId, conversa, pergunta, r.texto, r.dados, r.clienteId, r.custo, r.usoId, dadosDoPedido);
  return json({ ...r.dados, texto: r.texto, mensagem_id: mensagemId, conversa_id: conversa.id, custo_usd: r.custo, pedido: dadosDoPedido });
}

async function gravar(userId: string, conversa: Conversa, pergunta: string, resposta: string, dados: Record<string, unknown>, clientId: string | null, custo: number, usoId: string | null, dadosDoPedido: Record<string, unknown> = {}): Promise<string | null> {
  const agora = Date.now();
  const { data, error } = await servico().from("gestor_mensagens").insert([
    // A pergunta guarda só o resumo dos anexos (nome, tipo, tamanho); conteúdo e imagens não ficam no banco.
    // Insert de várias linhas: TODAS as colunas nas duas linhas. Coluna que falta numa delas vira NULL (não o
    // padrão da tabela) e custo_usd NOT NULL derrubava o insert inteiro (a conversa não era gravada; achado no aceite de 08/10).
    { dono_id: userId, conversa_id: conversa.id, papel: "usuario", conteudo: pergunta, dados: dadosDoPedido, client_id: clientId, custo_usd: 0, uso_id: null, criado_em: new Date(agora).toISOString() },
    { dono_id: userId, conversa_id: conversa.id, papel: "gestor", conteudo: resposta.slice(0, 12000), dados: dados, client_id: clientId, custo_usd: custo, uso_id: usoId, criado_em: new Date(agora + 1).toISOString() },
  ]).select("id, papel");
  if (error) { registrarFalha("gestor-aceleriq: conversa não gravada", error); return null; }
  // Resumo curto e determinístico (as últimas perguntas): é o que vai ao modelo no lugar do histórico inteiro.
  const anteriores = String(conversa.resumo || "").split(" | ").filter((x) => x && !x.startsWith("Mensagens de antes"));
  const resumo = [...anteriores, tituloDaPergunta(pergunta)].slice(-6).join(" | ").slice(0, 900);
  const titulo = conversa.titulo === "Nova conversa" ? tituloDaPergunta(pergunta) : conversa.titulo;
  await servico().from("gestor_conversas").update({ resumo, titulo, atualizado_em: new Date(agora + 2).toISOString() }).eq("id", conversa.id).then(() => undefined, (e: unknown) => registrarFalha("gestor-aceleriq: conversa sem resumo", e));
  return (((data || []) as { id: string; papel: string }[]).find((m) => m.papel === "gestor") || { id: null }).id;
}

// ------------------------------------------------------------------ ações propostas: Confirmar e Desfazer

/** A proposta guardada na mensagem do Gestor (dados.acoes), só do próprio dono. */
async function acaoGuardada(userId: string, mensagemId: unknown, acaoId: unknown): Promise<AcaoGuardada> {
  if (typeof mensagemId !== "string" || !UUID.test(mensagemId)) throw new ErroDaAcao(400, "mensagem_invalida", "mensagem_id precisa ser um UUID.");
  const { data, error } = await servico().from("gestor_mensagens").select("id, dono_id, client_id, conversa_id, dados").eq("id", mensagemId).eq("dono_id", userId).maybeSingle();
  if (error) throw new ErroDaAcao(500, "mensagem_indisponivel", "Não foi possível ler a mensagem do Gestor.");
  if (!data) throw new ErroDaAcao(404, "mensagem_inexistente", "Mensagem não encontrada.");
  const m = data as { id: string; client_id: string | null; conversa_id: string | null; dados: Record<string, unknown> };
  const dados = { ...(m.dados || {}) };
  const lista = Array.isArray(dados.acoes) ? (dados.acoes as unknown[]).slice() : [];
  const i = lista.findIndex((a) => !!a && (a as { id?: string }).id === String(acaoId || (lista[0] as { id?: string })?.id || ""));
  const acao = i >= 0 ? acaoDoAnexo(lista[i]) : null;
  if (!acao) throw new ErroDaAcao(404, "acao_inexistente", "Esta mensagem não tem ação do Gestor.");
  const gravarNova = async (novo: AcaoDoAgente) => {
    lista[i] = novo;
    dados.acoes = lista;
    const { error: e } = await servico().from("gestor_mensagens").update({ dados }).eq("id", m.id).eq("dono_id", userId);
    if (e) throw new ErroDaAcao(500, "acao_nao_registrada", "A ação foi feita, mas o registro na conversa falhou. Atualize a tela.");
    return novo;
  };
  return { mensagem: { id: m.id, client_id: m.client_id || "", conversa_id: m.conversa_id }, acao, gravar: gravarNova };
}

async function executarAcao(ch: { userId: string }, corpo: Record<string, unknown>): Promise<Response> {
  const guardada = await acaoGuardada(ch.userId, corpo.mensagem_id, corpo.acao_id);
  const r = await confirmarAcaoGuardada(guardada, (item, acao) => executarItem(servico(), item, acao, ch.userId), { descartar: corpo.descartar === true, parar: corpo.parar === true, userId: ch.userId, lote: 1 });
  let anexo = r.anexo;
  if (r.terminou && anexo.executada_em && !anexo.descartada_em) {
    // A entrega sai da releitura do banco (estado real, id gravado e atalho), nunca da proposta.
    anexo = await guardada.gravar({ ...anexo, entregas: await entregasDaAcao(servico(), anexo) } as AcaoDoAgente);
    await registrarNaConversa(ch.userId, guardada, `Gestor: ${textoDoResultado(anexo.resultados || [])}.`);
  }
  const feitos = (r.resultados || []).filter((x) => x.ok).length;
  return json({ anexo, feitos, falhas: (r.resultados || []).length - feitos });
}

async function desfazerAcao(ch: { userId: string }, corpo: Record<string, unknown>): Promise<Response> {
  const guardada = await acaoGuardada(ch.userId, corpo.mensagem_id, corpo.acao_id);
  const r = await desfazerAcaoGuardada(guardada, (x) => reverterItem(servico(), x), { userId: ch.userId });
  const anexo = await guardada.gravar({ ...r.anexo, entregas: await entregasDaAcao(servico(), r.anexo) } as AcaoDoAgente);
  await registrarNaConversa(ch.userId, guardada, `Gestor: desfeito (${r.voltaram} ${r.voltaram === 1 ? "item voltou" : "itens voltaram"}).`);
  return json({ anexo, voltaram: r.voltaram, falharam: r.falharam });
}

/** Linha de sistema na conversa (trilha de quem fez o quê e quando). */
async function registrarNaConversa(userId: string, g: AcaoGuardada, texto: string) {
  if (!g.mensagem.conversa_id) return;
  const { error } = await servico().from("gestor_mensagens").insert({ dono_id: userId, conversa_id: g.mensagem.conversa_id, papel: "sistema", conteudo: texto, client_id: g.mensagem.client_id || null, dados: { acao_id: g.acao.id, mensagem_id: g.mensagem.id } });
  if (error) registrarFalha("gestor-aceleriq: trilha não gravada", error);
}

const ACOES: Record<string, (ch: { userId: string }, corpo: Record<string, unknown>) => Promise<Response>> = {
  perguntar,
  conversas: listarConversas,
  criar_conversa: criarConversa,
  atualizar_conversa: atualizarConversa,
  abrir_conversa: abrirConversa,
  opcoes_de_contexto: opcoesDeContexto,
  executar_acao: executarAcao,
  desfazer_acao: desfazerAcao,
  // Hermes real (pela ponte do painel no servidor do Hermes; sem ela, configurada: false).
  ...Object.fromEntries(ACOES_DO_HERMES.map((a) => [a, async (_ch: { userId: string }, corpo: Record<string, unknown>) => json(await hermesAcao(a, corpo))])),
  // Compatível com a tela anterior: a conversa mais recente do dono.
  conversa: async (ch) => {
    const { data } = await servico().from("gestor_conversas").select("id").eq("dono_id", ch.userId).is("arquivada_em", null).order("atualizado_em", { ascending: false }).limit(1).maybeSingle();
    return json({ mensagens: data ? await mensagensDaConversa((data as { id: string }).id, 60) : [], conversa_id: (data as { id: string } | null)?.id || null });
  },
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
