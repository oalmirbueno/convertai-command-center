/**
 * Mesa Edição (02/10/2026): organizar a Entrada, espelhar no Workspace e
 * gerar a legenda do vídeo pronto. Regras puras em modulos/organizador-da-entrada.ts,
 * modulos/espelho-no-workspace.ts e modulos/legenda-do-final.ts.
 *
 * Ações (POST na mesa-videos, só equipe com acesso ao cliente):
 * - entrada_organizar_propor { client_id, falas?: { <arquivo_id>: texto }, arquivar_ruido?, melhores? }
 *     -> { mensagem_id, acao | null, leitura, prefixo, cenas, ruido, jev }
 *   Um vídeo ou vários clipes; pastas, nomes, melhor take e (se pedido) o
 *   ruído para arquivar. Os pares de clipes em dúvida vão ao Jev (Choice,
 *   centavos de centavo, cobrado do cliente); sem o Jev, vale a regra.
 *   Confirmar e Desfazer: executar_acao_agente e desfazer_acao_agente (os de sempre).
 * - workspace_espelho_propor { client_id } -> { plano }   (nada muda)
 * - workspace_espelho_confirmar { client_id, grupos } -> { registro, movidos, renomeados, pastas_criadas, falhas }
 * - workspace_espelho_desfazer { client_id, registro } -> { restaurados, pulados, pastas_tiradas, pastas_mantidas }
 *   Com a sessão de quem chamou (as regras do Workspace valem). Nunca copia nem apaga.
 * - final_legenda_gerar { arquivo_id, palavras? } -> { linhas, origem, srt, vtt, urls, precisa_transcrever? }
 *   SRT e VTT ao lado do vídeo pronto (mesma pasta no bucket mesa) e anotados
 *   na origem do arquivo. Sem fala no projeto: a tela transcreve o vídeo pronto
 *   (custo antes) e manda as palavras.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { BaseDaFuncao } from "./geracao.ts";
import { JevErro, jevPerguntar } from "../_shared/jev.ts";
import { cobrarJev } from "../_shared/ia-motor.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { normalizarRoteirosAprovados, VIEW_DOS_ROTEIROS, viewAindaNaoExiste } from "./modulos/roteiros-para-video.ts";
import { acaoDaOrganizacao, type RoteiroParaOrganizar } from "./modulos/organizador-de-takes.ts";
import { type ArquivoDaEntrada, brutosDe, decisoesDoJev, modoDaEntrada, paresEmDuvida, perguntaDosPares, proporOrganizacaoDaEntrada } from "./modulos/organizador-da-entrada.ts";
import { ehVideoDoWorkspace, planoDoEspelho, type NoDoWorkspaceParaEspelho } from "./modulos/espelho-no-workspace.ts";
import { aplicarOrganizacao, type BancoDoWorkspace, desfazerOrganizacao, normalizarRegistro, type NoDoIndice } from "../workspace-organizar/aplicar.ts";
import { normalizarConfirmacao } from "../workspace-organizar/organizador.ts";
import { caminhosDaLegenda, legendaDoFinal, type LinhaDaLegenda, linhasDasPalavras, type PalavraComTempo, recortarLinhas, srtDe, vttDe, type ProjetoParaLegenda } from "./modulos/legenda-do-final.ts";

const BUCKET = "mesa";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABELA_DAS_ACOES = "video_acoes";
const MAX_FALAS = 300;
const MAX_LETRAS_DA_FALA = 4000;
const URL_DA_LEGENDA_S = 3600;
/** Whisper (o mesmo do Timestamp do editor): US$ 0,006 por minuto começado. */
export const USD_POR_MINUTO_DA_TRANSCRICAO = 0.006;

const idDe = (b: BaseDaFuncao, v: unknown, nome: string) => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw b.erro(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};

function semTabela(b: BaseDaFuncao, error: { message?: string } | null, tabela: string): Error {
  const m = String((error && error.message) || "");
  if (/does not exist|schema cache|42P01|PGRST205/i.test(m)) return b.erro(503, "banco_sem_mesa_videos", `A Mesa Vídeos ainda não foi ativada no banco (tabela ${tabela}).`);
  return b.erro(500, "banco_indisponivel", "Não foi possível ler ou gravar agora. Tente de novo.");
}

async function roteirosDoCliente(b: BaseDaFuncao, clientId: string): Promise<RoteiroParaOrganizar[]> {
  const { data, error } = await b.servico().from(VIEW_DOS_ROTEIROS).select("id, client_id, titulo, aprovado_em, cenas").eq("client_id", clientId).limit(200);
  if (error) {
    if (viewAindaNaoExiste(error.message || "")) return [];
    return [];
  }
  return normalizarRoteirosAprovados(data).map((r) => ({ id: r.id, titulo: r.titulo, cenas: r.cenas.map((c) => ({ ref: c.ref, ordem: c.ordem, titulo: c.titulo })) }));
}

/** Falas que a tela mandou (só de arquivos deste cliente; texto limpo e curto). */
function falasDoCorpo(bruto: unknown, ids: Set<string>): Record<string, string> {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const saida: Record<string, string> = {};
  Object.keys(o)
    .slice(0, MAX_FALAS)
    .forEach((id) => {
      if (!ids.has(id)) return;
      const t = String(o[id] ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LETRAS_DA_FALA);
      if (t) saida[id] = t;
    });
  return saida;
}

// ------------------------------------------------------------------ organizar a Entrada

export async function entradaOrganizarPropor(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const [arqR, roteiros, aprovR] = await Promise.all([
    b.servico().from("video_arquivos").select("*").eq("client_id", clientId).eq("estado", "ativo").order("criado_em", { ascending: true }).limit(2000),
    roteirosDoCliente(b, clientId),
    b.servico().from("video_versoes").select("arquivo_id").eq("client_id", clientId).eq("estado", "aprovada").limit(1000),
  ]);
  if (arqR.error) throw semTabela(b, arqR.error, "video_arquivos");
  const aprovados = new Set(((aprovR.data || []) as { arquivo_id: string | null }[]).map((x) => x.arquivo_id).filter((x): x is string => !!x));
  // Na Edição só entra o que a Entrada mostra: gerado e imagem do gerador só depois de mandados para a Edição.
  const todos = ((arqR.data || []) as ArquivoDaEntrada[]).filter((a) => (a.tipo !== "gerado" && a.tipo !== "angulo" && a.tipo !== "quadro") || !!a.edicao_desde);
  const lista = todos.map((a) => ({ ...a, em_versao_aprovada: aprovados.has(a.id) }));
  const falas = falasDoCorpo(corpo.falas, new Set(lista.map((a) => a.id)));

  // Clipes picados: os pares em dúvida vão ao Jev (uma chamada, até 20 pares). Sem o Jev, vale a regra.
  let decisoes: Record<string, boolean> = {};
  const jev: { perguntas: number; respondidas: number; erro: string | null } = { perguntas: 0, respondidas: 0, erro: null };
  if (modoDaEntrada(lista).modo === "varios_clipes") {
    const brutos = brutosDe(lista);
    const pares = paresEmDuvida(brutos, falas);
    if (pares.length) {
      jev.perguntas = pares.length;
      try {
        const r = await jevPerguntar(perguntaDosPares(pares, brutos, falas));
        await cobrarJev(r, { clientId, tarefa: "conversa", criadoPor: UUID.test(b.userId) ? b.userId : null, referencia: { tipo: "edicao_organizar", id: clientId } });
        decisoes = decisoesDoJev(pares, r.answers);
        jev.respondidas = Object.keys(decisoes).length;
      } catch (e) {
        jev.erro = e instanceof JevErro ? e.codigo : "jev_indisponivel";
        console.warn("mesa-videos: jev dos clipes falhou; vale a regra da fala", { erro: String((e as Error)?.message ?? e) });
      }
    }
  }

  const proposta = proporOrganizacaoDaEntrada(lista, { roteiros, falas, decisoes, arquivarRuido: corpo.arquivar_ruido === true, melhores: corpo.melhores !== false }, (id) => aprovados.has(id));
  const acao = acaoDaOrganizacao(lista, proposta.itens, roteiros, { id: `organizador-${Date.now().toString(36)}`, resumo: proposta.resumo });
  const extra = { leitura: proposta.leitura, prefixo: proposta.prefixo, cenas: proposta.cenas, ruido: proposta.ruido.length, jev };
  if (!acao) return b.json({ mensagem_id: null, acao: null, ...extra });
  const { data, error } = await b.servico().from(TABELA_DAS_ACOES).insert({ client_id: clientId, anexos: [acao], criado_por: UUID.test(b.userId) ? b.userId : null }).select("id").single();
  if (error) throw semTabela(b, error, TABELA_DAS_ACOES);
  await b.auditar("video_entrada_organizar_propor", { client_id: clientId, modo: proposta.leitura.modo, itens: proposta.itens.length, jev: jev.respondidas }, true, (data as { id: string }).id);
  return b.json({ mensagem_id: (data as { id: string }).id, acao, ...extra });
}

// ------------------------------------------------------------------ espelho no Workspace

type NoLido = NoDoIndice & { mime?: string | null; size_bytes?: number | null };

async function indiceDoWorkspace(db: SupabaseClient, clientId: string): Promise<NoLido[]> {
  const saida: NoLido[] = [];
  for (let pagina = 0; pagina < 10; pagina++) {
    const { data, error } = await db
      .from("workspace_nodes")
      .select("id, parent_id, kind, name, sort_index, inbox_token, inbox_scan_status, mime, size_bytes")
      .eq("client_id", clientId)
      .eq("scope", "client")
      .order("id", { ascending: true })
      .range(pagina * 1000, pagina * 1000 + 999);
    if (error) throw new Error(error.message);
    const lote = (data || []) as NoLido[];
    lote.forEach((n) => saida.push(n));
    if (lote.length < 1000) break;
  }
  return saida;
}

/** O Workspace pela sessão de quem chamou (as regras de acesso do banco valem). Nunca apaga arquivo. */
function bancoDoWorkspace(db: SupabaseClient, clientId: string, userId: string): BancoDoWorkspace {
  return {
    indice: async () => (await indiceDoWorkspace(db, clientId)) as NoDoIndice[],
    criarPasta: async (nome, parentId) => {
      const { data, error } = await db.from("workspace_nodes").insert({ name: nome, kind: "folder", scope: "client", client_id: clientId, parent_id: parentId, created_by: userId }).select("id").single();
      if (error || !data) throw new Error(error?.message || "a pasta não foi criada");
      return (data as { id: string }).id;
    },
    atualizar: async (id, campos) => {
      const { error } = await db.from("workspace_nodes").update(campos).eq("id", id).eq("client_id", clientId).eq("scope", "client");
      if (error) throw new Error(error.message);
    },
    tirarPastaVazia: async (id) => {
      const { data: dentro, error: e1 } = await db.from("workspace_nodes").select("id").eq("parent_id", id).limit(1);
      if (e1 || (dentro ?? []).length) return false;
      const { error } = await db.from("workspace_nodes").delete().eq("id", id).eq("client_id", clientId).eq("kind", "folder").is("inbox_token", null);
      return !error;
    },
  };
}

export async function workspaceEspelhoPropor(b: BaseDaFuncao, db: SupabaseClient, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const { data, error } = await b.servico().from("video_arquivos").select("id, nome, nome_original, grupo, bytes, estado, tipo, mime").eq("client_id", clientId).eq("estado", "ativo").limit(2000);
  if (error) throw semTabela(b, error, "video_arquivos");
  let nos: NoLido[];
  try {
    nos = await indiceDoWorkspace(db, clientId);
  } catch (e) {
    registrarFalha("mesa-videos: workspace do cliente não foi lido", e, { client_id: clientId });
    throw b.erro(503, "workspace_indisponivel", "Não foi possível ler o Workspace do cliente agora.");
  }
  const videos = ((data || []) as Array<{ id: string; nome: string; nome_original: string; grupo: string | null; bytes: number | null; estado: string; tipo: string; mime: string | null }>).filter((a) => a.tipo !== "audio" && String(a.mime || "").indexOf("audio/") !== 0);
  const plano = planoDoEspelho(videos, nos as NoDoWorkspaceParaEspelho[]);
  return b.json({ plano, videos_no_workspace: nos.filter((n) => ehVideoDoWorkspace(n as NoDoWorkspaceParaEspelho)).length });
}

export async function workspaceEspelhoConfirmar(b: BaseDaFuncao, db: SupabaseClient, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const grupos = normalizarConfirmacao(corpo.grupos);
  if (!grupos.length) throw b.erro(400, "nada_para_confirmar", "Nada para organizar no Workspace.");
  const r = await aplicarOrganizacao(bancoDoWorkspace(db, clientId, b.userId), clientId, null, grupos);
  await b.auditar("video_workspace_espelho", { client_id: clientId, movidos: r.movidos, renomeados: r.renomeados, pastas: r.pastas_criadas, falhas: r.falhas.length }, r.falhas.length === 0);
  return b.json(r);
}

export async function workspaceEspelhoDesfazer(b: BaseDaFuncao, db: SupabaseClient, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const registro = normalizarRegistro(corpo.registro, clientId);
  if (!registro) throw b.erro(400, "registro_invalido", "Não há o que desfazer.");
  const r = await desfazerOrganizacao(bancoDoWorkspace(db, clientId, b.userId), registro);
  await b.auditar("video_workspace_espelho_desfazer", { client_id: clientId, restaurados: r.restaurados, pulados: r.pulados.length }, true);
  return b.json(r);
}

// ------------------------------------------------------------------ legenda do vídeo pronto

type ArquivoFinal = { id: string; client_id: string; nome: string; tipo: string; storage_bucket: string; storage_path: string; duracao_s: number | null; origem: Record<string, unknown> | null };

/** O vídeo pronto (render, amostra, entrega ou gerado) com o projeto do render, quando houver. */
export async function lerFinal(b: BaseDaFuncao, arquivoId: string): Promise<{ arquivo: ArquivoFinal; projeto: ProjetoParaLegenda | null; janela: { inicio_s: number; fim_s: number } | null; versao_id: string | null }> {
  const { data, error } = await b.servico().from("video_arquivos").select("id, client_id, nome, tipo, storage_bucket, storage_path, duracao_s, origem").eq("id", arquivoId).maybeSingle();
  if (error) throw semTabela(b, error, "video_arquivos");
  const a = data as ArquivoFinal | null;
  if (!a) throw b.erro(404, "arquivo_inexistente", "Vídeo não encontrado.");
  await b.garantirAcesso(a.client_id);
  if ((a.storage_bucket || BUCKET) !== BUCKET) throw b.erro(400, "arquivo_fora_do_bucket", "Este vídeo não está no armazenamento da mesa.");
  const origem = a.origem && typeof a.origem === "object" ? a.origem : {};
  const pedidoId = typeof origem.render_pedido_id === "string" && UUID.test(origem.render_pedido_id) ? origem.render_pedido_id : null;
  let projeto: ProjetoParaLegenda | null = null;
  let janela: { inicio_s: number; fim_s: number } | null = null;
  let versaoId: string | null = typeof origem.versao_id === "string" && UUID.test(origem.versao_id) ? origem.versao_id : null;
  if (pedidoId) {
    const { data: p } = await b.servico().from("render_pedidos").select("client_id, tipo, versao_id, projeto, entrada").eq("id", pedidoId).maybeSingle();
    const pedido = p as { client_id: string; tipo: string; versao_id: string | null; projeto: unknown; entrada: Record<string, unknown> | null } | null;
    if (pedido && pedido.client_id === a.client_id && pedido.projeto && typeof pedido.projeto === "object" && Array.isArray((pedido.projeto as { trilhas?: unknown }).trilhas)) {
      projeto = pedido.projeto as ProjetoParaLegenda;
      versaoId = versaoId || pedido.versao_id;
      if (pedido.tipo === "amostra" && pedido.entrada) {
        const i = Number(pedido.entrada.inicio_s);
        const f = Number(pedido.entrada.fim_s);
        if (isFinite(i) && isFinite(f) && f > i) janela = { inicio_s: i, fim_s: f };
      }
    }
  }
  return { arquivo: a, projeto, janela, versao_id: versaoId };
}

/** Palavras que a tela mandou (Whisper sobre o vídeo pronto), conferidas. */
function palavrasDoCorpo(bruto: unknown, duracao: number | null): PalavraComTempo[] {
  const lista = Array.isArray(bruto) ? bruto.slice(0, 20000) : [];
  const teto = duracao && duracao > 0 ? duracao + 1 : 4 * 3600;
  const saida: PalavraComTempo[] = [];
  lista.forEach((w) => {
    const o = w && typeof w === "object" ? (w as Record<string, unknown>) : {};
    const t = String(o.t ?? o.word ?? o.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const i = Number(o.i ?? o.start);
    const f = Number(o.f ?? o.end);
    if (!t || !isFinite(i) || !isFinite(f) || i < 0 || f < i || f > teto) return;
    saida.push({ t, i, f });
  });
  return saida.sort((x, y) => x.i - y.i);
}

/** Custo de transcrever o vídeo pronto (Whisper, minuto começado). */
export const custoDaTranscricaoDoFinal = (duracao_s: number | null) => Math.round(Math.max(1, Math.ceil((Number(duracao_s) || 0) / 60)) * USD_POR_MINUTO_DA_TRANSCRICAO * 10000) / 10000;

export async function finalLegendaGerar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const { arquivo, projeto, janela } = await lerFinal(b, idDe(b, corpo.arquivo_id, "arquivo_id"));
  let linhas: LinhaDaLegenda[] = [];
  let origem: "trilha" | "fala" | "video" | null = null;
  const palavras = palavrasDoCorpo(corpo.palavras, arquivo.duracao_s);
  if (palavras.length) {
    // A fala do próprio vídeo pronto (a tela transcreveu): o tempo já é o do vídeo.
    linhas = linhasDasPalavras(palavras);
    origem = "video";
  } else {
    const r = legendaDoFinal(projeto, janela);
    linhas = r.linhas;
    origem = r.origem;
  }
  if (!linhas.length) {
    return b.json({ linhas: [], origem: null, precisa_transcrever: true, custo_transcricao_usd: custoDaTranscricaoDoFinal(arquivo.duracao_s), duracao_s: arquivo.duracao_s });
  }
  if (arquivo.duracao_s && arquivo.duracao_s > 0) linhas = recortarLinhas(linhas, 0, arquivo.duracao_s + 0.5);
  const srt = srtDe(linhas);
  const vtt = vttDe(linhas);
  const caminhos = caminhosDaLegenda(arquivo.storage_path);
  const [s1, s2] = await Promise.all([
    b.servico().storage.from(BUCKET).upload(caminhos.srt, new Blob([srt], { type: "application/x-subrip" }), { contentType: "application/x-subrip", upsert: true }),
    b.servico().storage.from(BUCKET).upload(caminhos.vtt, new Blob([vtt], { type: "text/vtt" }), { contentType: "text/vtt", upsert: true }),
  ]);
  if (s1.error || s2.error) throw b.erro(500, "armazenamento_falhou", "A legenda saiu, mas não foi gravada ao lado do vídeo. Tente de novo.");
  const legenda = { srt_path: caminhos.srt, vtt_path: caminhos.vtt, origem, linhas: linhas.length, em: new Date().toISOString() };
  const { error } = await b.servico().from("video_arquivos").update({ origem: { ...(arquivo.origem || {}), legenda }, atualizado_em: new Date().toISOString() }).eq("id", arquivo.id).eq("client_id", arquivo.client_id);
  if (error) registrarFalha("mesa-videos: legenda gravada sem a anotação no arquivo", error, { arquivo_id: arquivo.id });
  const { data: assinadas } = await b.servico().storage.from(BUCKET).createSignedUrls([caminhos.srt, caminhos.vtt], URL_DA_LEGENDA_S);
  const urls: Record<string, string | null> = { srt: null, vtt: null };
  ((assinadas || []) as { path: string | null; signedUrl: string | null }[]).forEach((x) => {
    if (x.path === caminhos.srt) urls.srt = x.signedUrl;
    if (x.path === caminhos.vtt) urls.vtt = x.signedUrl;
  });
  await b.auditar("video_final_legenda", { client_id: arquivo.client_id, arquivo_id: arquivo.id, origem, linhas: linhas.length }, true, arquivo.id);
  return b.json({ linhas, origem, srt, vtt, urls, caminhos, precisa_transcrever: false });
}

/** Linhas que a tela mandou para gravar no vídeo (texto curto, tempos conferidos). */
export function linhasDoCorpo(bruto: unknown, duracao: number | null): LinhaDaLegenda[] {
  const lista = Array.isArray(bruto) ? bruto.slice(0, 3000) : [];
  const teto = duracao && duracao > 0 ? duracao + 1 : 4 * 3600;
  return lista
    .map((l) => {
      const o = l && typeof l === "object" ? (l as Record<string, unknown>) : {};
      return { texto: String(o.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 200), i: Number(o.i), f: Number(o.f) };
    })
    .filter((l) => l.texto && isFinite(l.i) && isFinite(l.f) && l.i >= 0 && l.f > l.i && l.f <= teto)
    .sort((a, b) => a.i - b.i);
}
