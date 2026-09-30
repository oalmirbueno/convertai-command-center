/**
 * documentos: o Registro da entrega (Frente DOC, 29/09/2026). Documento padrão
 * que a Aceleriq manda ao cliente ao concluir uma entrega grande, no estilo do
 * PDF do Roteiro, montado só com o que aconteceu de verdade no painel.
 *
 * POST { acao, ... }, só equipe com acesso ao cliente. Erro sai como
 * { error, mensagem } (nas ações com fôlego o status real vai em status_http).
 *
 * - estimar { client_id, modelo_id? } -> { estimativa_usd, modelo_id } (sem IA)
 * - registrar_entrega { client_id, marca_id?, tipo, referencia, titulo?, resumo?, provas?[] }
 *   -> { documento } (gancho das mesas: sem custo, só guarda o pedido "pendente")
 * - gerar_registro { client_id, marca_id?, tipo, referencia, titulo?, modelo_id?, confirmado: true }
 *   -> { documento, file_id, avisos, eventos, provas, custo_usd, saldo_usd }
 *   Dados da agência (nome e logo, frente BASE; faltando, volta antes de gastar
 *   IA) -> eventos reais (documentos/eventos.ts) -> o agente redige (papel
 *   "documento", modeloDoPapel) -> conferência por código (nada
 *   inventado) -> o Jev escolhe as provas (Score) -> imagens leves
 *   (imagem-reduzida/copias-leves, nunca a cheia) -> PDF (pdf-base) -> Arquivos
 *   (pasta entregas) com a revisão interna pedida. Nada vai ao cliente aqui.
 * - listar { client_id, arquivados? } -> { documentos, arquivados } (sem IA; arquivados: true lista os arquivados)
 * - liberar { documento_id, modo: approval|client_shared, confirmado: true } -> { documento }
 *   (fluxo de aprovação que já existe: admin_release_file_now, com a sessão de quem confirmou)
 * - arquivar { documento_id, arquivar } -> { documento } (apagar = arquivar)
 * Frente BRF2 (rascunho.ts e agenda.ts): rascunho / salvar_rascunho (texto de cada seção, provas
 * escolhidas e na ordem, números com fonte, capa com a identidade do cliente; gerar_registro com
 * usar_rascunho usa o texto da equipe e não chama IA), agenda_ler / agenda_salvar e agenda_cron
 * (x-cron-secret: monta o rascunho do mês anterior, sem IA, e avisa a equipe).
 *
 * Tamanho da mesa-roteiros, sem render nem Chromium: o PDF é gerado em
 * milissegundos pelo gerador próprio. Sem travessão.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chamarTexto, cobrarJev, estimarComModelo, IaMotorErro, modeloDoPapel, type ModeloIa } from "../_shared/ia-motor.ts";
import { type DadosDaAgencia, DadosDaAgenciaIncompletos, exigirDadosDaAgencia, lerLogoDaAgencia, nomeDaAgencia } from "../_shared/dados-da-agencia.ts";
import { JevErro, jevPerguntar, notaScore } from "../_shared/jev.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import { erroQueSobe, registrarFalha } from "../_shared/falha-registrada.ts";
import { superpoderesPara } from "../_shared/superpoderes.ts";
import { marcasDoCliente, resolverMarca } from "../_shared/marca.ts";
import { contextoCompletoParaPrompt } from "../_shared/contexto-completo-da-marca.ts";
import { reduzidaSemTransformacao } from "../_shared/imagem-reduzida.ts";
// FN-01: o imagescript só carrega quando uma imagem é aberta (não na partida da função).
import { dimensoesDoCabecalho, jpegSobreBranco } from "../_shared/imagem-sob-demanda.ts";
import { ehImagemDoPdf, type ImagemDoPdf, imagemParaPdf } from "../_shared/pdf-base.ts";
import {
  candidatosAProva,
  escolherProvas,
  ESQUEMA_DOS_TEXTOS,
  estadoParaOAgente,
  type EventoReal,
  gerarPdfDoRegistro,
  lerPedidoDeRegistro,
  lerTextosDoAgente,
  montarRegistro,
  NIVEIS_DA_PROVA,
  nomeDoArquivoDoRegistro,
  type PedidoDeRegistro,
  type Prova,
  registrarEntregaNoBanco,
  SISTEMA_DO_DOCUMENTO,
  type TextosDoAgente,
} from "./modulos/registro-de-entrega.ts";
import { coletarEventos } from "./eventos.ts";
import { coletarDaLinha, identidadeDaCapa, type LinhaComRascunho, rascunhoDaLinha, vistaDoRascunho } from "./rascunho.ts";
import { lerAgendas, respostaDoCron, salvarAgenda } from "./agenda.ts";
import { DEFINICOES_DE_DOCUMENTO, normalizarRascunho, numerosDoRascunho, provasDoRascunho, secoesDoRascunho } from "../_shared/documento-modelos.ts";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABELA = "documentos_entrega";
const CAMPOS = "id, client_id, marca_id, tipo, referencia, titulo, numero, versao, status, file_id, conteudo, gancho, avisos, custo_usd, pedido_por, gerado_por, gerado_em, liberado_por, liberado_em, arquivado_em, criado_em, atualizado_em, modelo, rascunho, rascunho_em, origem_rascunho, mensagem_envio";
/** Papel da frente BASE: vale em ia_usos.tarefa e ia_usos.agente. */
const TAREFA = "documento" as const;
const AGENTE = "documento" as const;
const TAMANHO = { entrada: 7_000, saida: 1_800 };
const MAX_PROVAS = 8;
/** Cópia leve para o PDF: 640 px no lado maior (cerca de 180 dpi na caixa da prova). */
const LADO_DA_PROVA = 640;

type LinhaDoDocumento = {
  id: string;
  client_id: string;
  marca_id: string | null;
  tipo: string;
  referencia: string;
  titulo: string | null;
  numero: number | null;
  versao: number;
  status: string;
  file_id: string | null;
  conteudo: Record<string, unknown>;
  gancho: Record<string, unknown>;
  avisos: string[];
  custo_usd: number;
  arquivado_em: string | null;
  modelo?: string | null;
  rascunho?: unknown;
};

// ------------------------------------------------------------------ erros

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

const MENSAGEM_MOTOR: Record<string, { status: number; mensagem: string }> = {
  saldo_insuficiente: { status: 402, mensagem: "Saldo insuficiente na carteira de IA deste cliente. Peça a recarga a um admin ou gestor." },
  cota_da_chave_esgotada: { status: 402, mensagem: "A cota do mês da chave de IA deste cliente acabou." },
  cliente_sem_chave: { status: 403, mensagem: "Este cliente não tem chave de IA própria e o uso da chave da agência está desligado para ele." },
  provedor_sem_chave: { status: 503, mensagem: "O provedor deste modelo está sem chave de API configurada." },
};

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof IaMotorErro) {
    const conhecido = MENSAGEM_MOTOR[err.codigo];
    const status = conhecido?.status ?? (err.status >= 400 ? err.status : 500);
    return json({ ...err.paraJson(), mensagem: conhecido?.mensagem ?? err.message }, status);
  }
  registrarFalha("documentos: erro inesperado", err);
  return json({ error: "erro_interno", mensagem: "Falha inesperada ao montar o documento da entrega." }, 500);
}

// ------------------------------------------------------------------ banco e acesso

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
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe gera o documento da entrega.");
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

function semTabela(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /documentos_entrega.*(does not exist|schema cache)/i.test(String(error.message || ""));
}

const AVISO_BANCO = "O banco ainda não tem a tabela dos documentos da entrega (migration 20260930040000_documentos_entrega.sql pendente).";

function erroDoBanco(error: { code?: string; message?: string }, onde: string): ErroHttp {
  if (semTabela(error)) return new ErroHttp(503, "banco_sem_documentos", AVISO_BANCO);
  registrarFalha(`documentos: ${onde}`, error);
  return new ErroHttp(503, "documento_indisponivel", "Não foi possível ler ou gravar o documento agora.");
}

async function lerDocumento(ch: Chamador, id: unknown): Promise<LinhaDoDocumento> {
  const s = String(id ?? "");
  if (!UUID.test(s)) throw new ErroHttp(400, "documento_id_invalido", "documento_id precisa ser um UUID.");
  const { data, error } = await servico().from(TABELA).select(CAMPOS).eq("id", s).maybeSingle();
  if (error) throw erroDoBanco(error, "ler documento");
  if (!data) throw new ErroHttp(404, "documento_inexistente", "Documento não encontrado.");
  const linha = data as LinhaDoDocumento;
  await garantirAcesso(ch, linha.client_id);
  return linha;
}

async function nomeDoCliente(clientId: string): Promise<string> {
  const { data } = await servico().from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle();
  const p = data as { company_name?: string | null; full_name?: string | null } | null;
  return (p && (p.company_name || p.full_name)) || "Cliente";
}

/** A linha da entrega (cria "pendente" na primeira vez; o gancho e o gerar usam a mesma). */
async function linhaDaEntrega(ch: Chamador, pedido: PedidoDeRegistro): Promise<LinhaDoDocumento> {
  const r = await registrarEntregaNoBanco(servico(), pedido, ch.userId, CAMPOS);
  if (r.erro || !r.linha) throw erroDoBanco(r.erro || { message: "sem linha" }, "registrar entrega");
  return r.linha as unknown as LinhaDoDocumento;
}

// ------------------------------------------------------------------ modelo e custo

/** Papel "documento" (frente BASE): o modelo escolhido na tela, senão o padrão do papel, senão o da estratégia. */
async function modeloDoDocumento(pedido?: unknown): Promise<ModeloIa> {
  const m = await modeloDoPapel("documento", typeof pedido === "string" && pedido.trim() ? pedido.trim() : null);
  if (!m) throw new ErroHttp(409, "sem_modelo", "O catálogo não tem modelo padrão ativo para redigir o documento.");
  return m;
}

/** Dados da agência (nome e logo no cabeçalho): faltando, volta à tela antes de gastar IA. */
async function dadosDaAgencia(): Promise<DadosDaAgencia> {
  try {
    return await exigirDadosDaAgencia(servico(), "documento");
  } catch (e) {
    if (e instanceof DadosDaAgenciaIncompletos) {
      throw new ErroHttp(409, e.codigo, e.message, { faltas: e.faltas }); // a mensagem já traz "Preencha em Configurações" (QA 30/09)
    }
    registrarFalha("documentos: dados da agência não lidos", e);
    throw new ErroHttp(503, "dados_da_agencia_indisponiveis", "Não foi possível ler os dados da agência agora.");
  }
}

/** Maior logo que abre aqui para virar JPEG (a logo vem inteira dos dados da agência). */
const MAX_PIXELS_DA_LOGO = 2_000_000;

/** Logo da agência para o PDF. Sem logo ou sem como abrir: a padrão fica, com aviso (nada engolido). */
async function logoDaAgencia(dados: DadosDaAgencia, avisos: string[]): Promise<ImagemDoPdf | null> {
  try {
    const lida = await lerLogoDaAgencia(servico(), dados);
    if (!lida) return null;
    const direta = imagemParaPdf(lida.bytes);
    if (ehImagemDoPdf(direta)) return direta;
    const d = dimensoesDoCabecalho(lida.bytes);
    if (!d || d.largura * d.altura > MAX_PIXELS_DA_LOGO) {
      avisos.push("A logo da agência não abre aqui (SVG ou grande demais); o PDF saiu com a logo padrão. Envie um PNG ou JPEG menor em Dados da agência.");
      return null;
    }
    const jpeg = imagemParaPdf(await jpegSobreBranco(lida.bytes, 90));
    return ehImagemDoPdf(jpeg) ? jpeg : null;
  } catch (e) {
    registrarFalha("documentos: logo da agência não lida", e);
    avisos.push("A logo da agência não foi lida; o PDF saiu com a logo padrão.");
    return null;
  }
}

const raciocinioPara = (m: ModeloIa) => ["low", "medium"].find((r) => (m.raciocinio ?? []).includes(r));
const custoEstimado = (m: ModeloIa) => estimarComModelo(m, { tokensEntrada: TAMANHO.entrada, tokensSaida: TAMANHO.saida });

async function estimar(_ch: Chamador, corpo: Record<string, unknown>) {
  await garantirAcesso(_ch, String(corpo.client_id ?? ""));
  await dadosDaAgencia(); // faltando dado da agência, a tela sabe já no custo (QA 30/09)
  const m = await modeloDoDocumento(corpo.modelo_id);
  // Com o rascunho da equipe (texto escrito e provas escolhidas), o gerar não chama modelo nem Jev.
  if (corpo.usar_rascunho === true && UUID.test(String(corpo.documento_id || ""))) {
    const linha = await lerDocumento(_ch, corpo.documento_id);
    const r = linha.rascunho ? normalizarRascunho(linha.rascunho) : null;
    if (r) return json({ estimativa_usd: (r.resumo.trim() ? 0 : custoEstimado(m)) + (r.provas.some((p) => p.incluir) ? 0 : 0.002), modelo_id: m.id, custo_usd: 0, texto_da_equipe: !!r.resumo.trim() });
  }
  return json({ estimativa_usd: custoEstimado(m), modelo_id: m.id, custo_usd: 0 });
}

// ------------------------------------------------------------------ rascunho e agenda (frente BRF2)

async function rascunho(ch: Chamador, corpo: Record<string, unknown>) {
  let linha: LinhaDoDocumento;
  if (corpo.documento_id) linha = await lerDocumento(ch, corpo.documento_id);
  else {
    const pedido = lerPedidoDeRegistro(corpo);
    if ("erro" in pedido) throw new ErroHttp(400, "pedido_invalido", pedido.erro);
    await garantirAcesso(ch, pedido.client_id);
    linha = await linhaDaEntrega(ch, pedido);
  }
  let coletado;
  try {
    coletado = await coletarDaLinha(servico(), linha as unknown as LinhaComRascunho);
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m === "projeto_inexistente" || m === "projeto_de_outra_marca") throw new ErroHttp(409, m, "Este projeto não é desta marca ou deste cliente.");
    throw e;
  }
  const r = rascunhoDaLinha(linha as unknown as LinhaComRascunho, coletado.coleta, corpo.modelo);
  return json({ documento: semConteudo(linha), rascunho: r, ...vistaDoRascunho(coletado.coleta), custo_usd: 0 });
}

async function salvarRascunho(ch: Chamador, corpo: Record<string, unknown>) {
  const linha = await lerDocumento(ch, corpo.documento_id);
  if (linha.arquivado_em) throw new ErroHttp(409, "documento_arquivado", "Este documento está arquivado.");
  const r = normalizarRascunho(corpo.rascunho);
  const agora = new Date().toISOString();
  const { data, error } = await servico().from(TABELA).update({ rascunho: r, modelo: r.modelo, titulo: r.titulo || linha.titulo, rascunho_em: agora, rascunho_por: ch.userId, origem_rascunho: "equipe", atualizado_em: agora }).eq("id", linha.id).select(CAMPOS).single();
  if (error) throw erroDoBanco(error, "salvar rascunho");
  return json({ documento: semConteudo(data as LinhaDoDocumento), rascunho: r, custo_usd: 0 });
}

async function agendaLer(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await garantirAcesso(ch, clientId);
  try {
    return json({ agendas: await lerAgendas(servico(), clientId), custo_usd: 0 });
  } catch (e) {
    throw erroDoBanco(e as { code?: string; message?: string }, "ler agenda");
  }
}

async function agendaSalvar(ch: Chamador, corpo: Record<string, unknown>) {
  await garantirAcesso(ch, String(corpo.client_id ?? ""));
  try {
    return json({ agenda: await salvarAgenda(servico(), ch.userId, corpo), custo_usd: 0 });
  } catch (e) {
    if (e instanceof Error && !("code" in e)) throw new ErroHttp(400, "agenda_invalida", e.message);
    throw erroDoBanco(e as { code?: string; message?: string }, "salvar agenda");
  }
}

// ------------------------------------------------------------------ gancho (sem custo)

async function registrarEntrega(ch: Chamador, corpo: Record<string, unknown>) {
  const pedido = lerPedidoDeRegistro(corpo);
  if ("erro" in pedido) throw new ErroHttp(400, "pedido_invalido", pedido.erro);
  await garantirAcesso(ch, pedido.client_id);
  const linha = await linhaDaEntrega(ch, pedido);
  return json({ documento: semConteudo(linha), custo_usd: 0 });
}

const semConteudo = (l: LinhaDoDocumento) => ({ ...l, conteudo: undefined, rascunho: undefined, tem_rascunho: !!l.rascunho });

// ------------------------------------------------------------------ gerar

async function notasDasProvas(clientId: string, titulo: string, candidatos: EventoReal[], ch: Chamador, refId: string, avisos: string[]): Promise<Record<string, number | null>> {
  const notas: Record<string, number | null> = {};
  if (candidatos.length < 2) return notas;
  const questions: Record<string, { type: "score"; instructions: string; criteria: string[] }> = {};
  const state = {
    entrega: titulo,
    candidatos: candidatos.map((c, i) => ({ apelido: `p${i + 1}`, tipo: c.fonte, titulo: c.titulo, detalhe: c.detalhe || "", data: c.quando.slice(0, 10), publicado_com_link: !!c.link, aprovado_ou_publicado: !!c.forte })),
  };
  candidatos.forEach((_, i) => {
    questions[`p${i + 1}`] = {
      type: "score",
      instructions: `O candidato \`p${i + 1}\` em \`candidatos\` é uma boa prova, para o cliente, de que a \`entrega\` foi feita? Vale mais a própria peça aprovada ou publicada do que um arquivo de apoio.`,
      criteria: NIVEIS_DA_PROVA,
    };
  });
  try {
    const res = await jevPerguntar({ state, questions });
    await cobrarJev(res, { clientId, tarefa: TAREFA, referencia: { tipo: "documento_entrega", id: refId }, criadoPor: ch.userId });
    candidatos.forEach((c, i) => (notas[c.id] = notaScore(res.answers[`p${i + 1}`])));
  } catch (e) {
    registrarFalha("documentos: Jev não escolheu as provas", e, { codigo: e instanceof JevErro ? e.codigo : "desconhecido" });
    avisos.push("O Jev não respondeu; as provas seguiram a ordem padrão (publicado e aprovado primeiro).");
  }
  return notas;
}

/** Imagem leve da prova para o PDF: cópia do painel ou copias-leves; nunca a imagem cheia. */
async function imagemDaProva(p: Prova, avisos: string[]): Promise<ImagemDoPdf | undefined> {
  try {
    const r = await reduzidaSemTransformacao(servico(), p.imagem.bucket, p.imagem.caminho, LADO_DA_PROVA, LADO_DA_PROVA, { pedirCopia: true, aceitarCopiaMaiorAte: 450_000, qualidadeJpeg: 82, folga: 1.3 });
    if (!r || !r.cabe) {
      avisos.push(`A imagem de "${p.titulo.slice(0, 60)}" é grande demais para abrir aqui; no PDF aparece o aviso para ver no painel.`);
      return undefined;
    }
    let img = imagemParaPdf(r.bytes);
    if (!ehImagemDoPdf(img)) {
      // PNG com transparência ou WebP: fundo branco e JPEG (a cópia já é leve, abrir é barato).
      img = imagemParaPdf(await jpegSobreBranco(r.bytes, 82));
    }
    return ehImagemDoPdf(img) ? img : undefined;
  } catch (e) {
    registrarFalha("documentos: imagem da prova não abriu", e, { evento: p.evento_id });
    avisos.push(`A imagem de "${p.titulo.slice(0, 60)}" não abriu; no PDF aparece o aviso para ver no painel.`);
    return undefined;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function proximoNumero(clientId: string): Promise<number> {
  const { data, error } = await servico().from(TABELA).select("numero").eq("client_id", clientId).not("numero", "is", null).order("numero", { ascending: false }).limit(1);
  if (error) throw erroDoBanco(error, "número do documento");
  const ultimo = ((data as Array<{ numero: number }>) || [])[0];
  return (ultimo ? ultimo.numero : 0) + 1;
}

async function gerarRegistro(ch: Chamador, corpo: Record<string, unknown>) {
  const pedido = lerPedidoDeRegistro(corpo);
  if ("erro" in pedido) throw new ErroHttp(400, "pedido_invalido", pedido.erro);
  if (corpo.confirmado !== true) throw new ErroHttp(400, "confirmacao_obrigatoria", "Gerar o documento usa IA: confirme o custo na tela antes.");
  await garantirAcesso(ch, pedido.client_id);
  const s = servico();
  const clientId = pedido.client_id;

  const agencia = await dadosDaAgencia(); // antes de tudo: faltando, nada de IA é gasto
  const [marca, marcas, cliente, modelo] = await Promise.all([
    resolverMarca(s, clientId, { marca_id: pedido.marca_id, project_id: pedido.tipo === "projeto" ? pedido.referencia : null }),
    marcasDoCliente(s, clientId),
    nomeDoCliente(clientId),
    modeloDoDocumento(corpo.modelo_id),
  ]);
  const linha = await linhaDaEntrega(ch, pedido);
  if (linha.arquivado_em) throw new ErroHttp(409, "documento_arquivado", "Este documento está arquivado. Desarquive para gerar de novo.");
  const provasDoGancho = linha.gancho && Array.isArray(linha.gancho.provas) ? (linha.gancho.provas as string[]).filter((x) => UUID.test(String(x))) : [];
  const outras = marca ? marcas.filter((m) => m.id !== marca.id && m.project_id).map((m) => m.project_id as string) : [];

  let coleta;
  try {
    coleta = await coletarEventos(s, {
      clientId,
      tipo: pedido.tipo,
      referencia: pedido.referencia,
      marca: marca ? { id: marca.id, nome: marca.nome, principal: marca.principal, project_id: marca.project_id } : null,
      projetosDeOutrasMarcas: outras,
      provasDoGancho,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m === "projeto_inexistente") throw new ErroHttp(404, "projeto_inexistente", "Este projeto não é deste cliente.");
    if (m === "projeto_de_outra_marca") throw new ErroHttp(409, "projeto_de_outra_marca", "Este projeto é de outra marca do cliente.");
    throw e;
  }
  if (!coleta.eventos.length) {
    throw new ErroHttp(409, "sem_eventos", "Não há nada registrado no painel para esta entrega. O documento só mostra o que aconteceu de verdade.", { avisos: coleta.avisos });
  }
  // Rascunho da equipe (frente BRF2): texto, provas na ordem e números com fonte vencem o automático.
  const rasc = corpo.usar_rascunho === true && linha.rascunho ? normalizarRascunho(linha.rascunho) : null;
  const titulo = pedido.titulo || (rasc && rasc.titulo) || linha.titulo || coleta.titulo;
  const avisos = coleta.avisos.slice();
  if (linha.gancho && typeof linha.gancho.resumo === "string" && linha.gancho.resumo) avisos.push(`Resumo mandado pela mesa (só para a equipe conferir): ${String(linha.gancho.resumo).slice(0, 300)}`);
  const doRascunho = rasc ? numerosDoRascunho(coleta.numeros, rasc) : null;
  const numeros = doRascunho ? doRascunho.numeros : coleta.numeros;
  if (doRascunho) doRascunho.avisos.forEach((a) => avisos.push(a));

  // O agente redige (sem texto da equipe); a conferência por código tira o que não tem base.
  const daEquipe = !!rasc && !!rasc.resumo.trim();
  let textos: TextosDoAgente | null = daEquipe ? { resumo: rasc!.resumo, itens: [], proximos: rasc!.proximos } : null;
  let custo = 0;
  let saldo: number | null = null;
  const estado = estadoParaOAgente({ titulo, cliente, marca: marca ? marca.nome : null, tipo: pedido.tipo, periodo: coleta.periodo }, coleta.eventos, numeros);
  // Frente SYNC: o contexto e a estratégia da marca (pela herança) dão o tom; os fatos seguem só os de DADOS.
  const tomDaMarca = daEquipe ? "" : await contextoCompletoParaPrompt(s, clientId, marca, { area: "documento", partes: ["marca", "contexto", "estrategia"], semTitulo: true, teto: 2500 }).then((c) => c.bloco, (e) => (registrarFalha("documentos: contexto da marca não lido", e), ""));
  if (!daEquipe) {
    try {
      const saida = await chamarTexto({
        clientId, tarefa: TAREFA, agente: AGENTE,
        modeloId: modelo.id,
        raciocinio: raciocinioPara(modelo),
        sistema: SISTEMA_DO_DOCUMENTO,
        mensagens: [{ papel: "usuario", conteudo: `Redija o registro desta entrega com o que está em DADOS.\n\nDADOS:\n${JSON.stringify(estado)}${tomDaMarca ? `\n\nTOM E CONTEXTO DA MARCA (só para o jeito de escrever; fato, número e nome vêm só de DADOS):\n${tomDaMarca}` : ""}` }],
        esquemaJson: ESQUEMA_DOS_TEXTOS,
        maxTokensSaida: 2_500,
        metodo: await superpoderesPara(servico(), { agente: "documentos.registro" }),
        referencia: { tipo: "documento_entrega", id: linha.id },
        criadoPor: ch.userId,
      });
      textos = lerTextosDoAgente(saida.json);
      custo += saida.custoUsd;
      saldo = saida.saldoUsd;
    } catch (e) {
      if (erroQueSobe(e) || (e instanceof IaMotorErro && MENSAGEM_MOTOR[e.codigo])) throw e;
      registrarFalha("documentos: o agente não redigiu", e, { documento_id: linha.id });
      avisos.push("O agente não respondeu; o resumo saiu por código, só com as contagens reais.");
    }
  }

  const candidatos = candidatosAProva(coleta.eventos, 40);
  const escolhidasPelaEquipe = !!rasc && rasc.provas.some((p) => p.incluir);
  const provas = escolhidasPelaEquipe ? provasDoRascunho(candidatos, rasc!, MAX_PROVAS) : escolherProvas(candidatos.slice(0, 12), await notasDasProvas(clientId, titulo, candidatos.slice(0, 12), ch, linha.id, avisos), MAX_PROVAS);

  const numero = linha.numero || (await proximoNumero(clientId));
  const versao = (linha.versao || 0) + 1;
  const registro = montarRegistro(
    { numero, versao, tipo: pedido.tipo, referencia: pedido.referencia, titulo, cliente, marca: marca ? marca.nome : null, data: new Date().toISOString(), periodo: coleta.periodo },
    coleta.eventos,
    numeros,
    textos,
    provas,
    avisos,
    { textoDaEquipe: daEquipe },
  );
  if (rasc) {
    registro.secoes = secoesDoRascunho(rasc);
    registro.modelo = rasc.modelo;
    registro.rotulo_da_capa = DEFINICOES_DE_DOCUMENTO[rasc.modelo].capa;
  }

  const imagens: Record<string, ImagemDoPdf | undefined> = {};
  const usarIdentidade = !rasc || rasc.capa.identidade_do_cliente;
  const [lidas, logo, capa] = await Promise.all([
    Promise.all(registro.provas.map((p) => imagemDaProva(p, registro.avisos))),
    logoDaAgencia(agencia, registro.avisos),
    usarIdentidade ? identidadeDaCapa(s, clientId, marca, registro.avisos) : Promise.resolve({ logo: null, cor: null }),
  ]);
  registro.provas.forEach((p, i) => (imagens[p.evento_id] = lidas[i]));
  const bytes = gerarPdfDoRegistro(registro, imagens, { logo, agencia: nomeDaAgencia(agencia), logoDoCliente: capa.logo, corDoCliente: capa.cor });
  const nome = nomeDoArquivoDoRegistro(registro);

  // Arquivos: pasta entregas, mesmo caminho do PDF da Mesa Roteiros.
  const chave = `documentos:${linha.id}:v${versao}`;
  const { data: existente } = await s.from("files").select("id, client_id").eq("idempotency_key", chave).maybeSingle();
  let fileId: string;
  if (existente && (existente as { client_id: string }).client_id === clientId) {
    fileId = (existente as { id: string }).id;
  } else {
    fileId = crypto.randomUUID();
    const caminho = `${clientId}/${fileId}/v1/${nome}`;
    const { error: erroUpload } = await ch.doChamador.storage.from("files").upload(caminho, new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
    if (erroUpload) throw new ErroHttp(503, "envio_de_arquivo_falhou", "Não foi possível enviar o PDF para Arquivos. Tente de novo.", { detalhe: erroUpload.message });
    const { data: registroDoArquivo, error: erroRegistro } = await ch.doChamador.rpc("create_file_record", {
      p_file: {
        id: fileId,
        client_id: clientId,
        project_id: pedido.tipo === "projeto" ? pedido.referencia : null,
        file_name: nome,
        file_url: `files://${caminho}`,
        file_type: "documento",
        mime_type: "application/pdf",
        extension: "pdf",
        storage_bucket: "files",
        storage_path: caminho,
        size_bytes: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        folder: "entregas",
        tags: ["documento_entrega", pedido.tipo],
        status: "ready",
        version: 1,
        description: `${titulo}. Registro da entrega nº ${numero}, versão ${versao}, código ${registro.codigo}.`.slice(0, 1000),
        idempotency_key: chave,
      },
    });
    if (erroRegistro || !registroDoArquivo) {
      await ch.doChamador.storage.from("files").remove([caminho]).catch((e) => registrarFalha("documentos: PDF órfão não removido", e, { caminho }));
      throw new ErroHttp(503, "registro_de_arquivo_falhou", "O PDF subiu, mas o registro em Arquivos falhou. Tente de novo.", { detalhe: erroRegistro?.message ?? null });
    }
    fileId = (registroDoArquivo as { id: string }).id;
    // Revisão interna da agência (não vai ao cliente): mesmo caminho do PDF do Roteiro.
    const { error: e } = await ch.doChamador.rpc("request_file_agency_review", { p_file_id: fileId });
    if (e) {
      registrarFalha("documentos: revisão interna não pedida", e, { file_id: fileId });
      registro.avisos.push(`O PDF foi para Arquivos, mas a revisão interna não foi pedida: ${e.message}`);
    }
  }

  const conteudo = { ...registro, provas: registro.provas.map((p) => ({ ...p, com_imagem: !!imagens[p.evento_id] })) };
  const { data: salvo, error: erroSalvo } = await s.from(TABELA).update({
    numero,
    versao,
    titulo,
    marca_id: marca ? marca.id : linha.marca_id,
    modelo: rasc ? rasc.modelo : linha.modelo ?? null,
    status: "gerado",
    file_id: fileId,
    conteudo,
    avisos: registro.avisos.slice(0, 40),
    custo_usd: Math.round(((Number(linha.custo_usd) || 0) + custo) * 1e6) / 1e6,
    gerado_por: ch.userId,
    gerado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  }).eq("id", linha.id).select(CAMPOS).single();
  if (erroSalvo) throw erroDoBanco(erroSalvo, "guardar documento gerado");

  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "documento_entrega_gerar", origin: "mesa:documentos", keyId: `mesa:documentos:${ch.userId}`, scopes: ["files:write"],
    input: { client_id: clientId, tipo: pedido.tipo, referencia: pedido.referencia, file_id: fileId }, success: true, statusCode: 200, durationMs: 0, resultRef: fileId,
  });
  return json({
    documento: semConteudo(salvo as LinhaDoDocumento),
    file_id: fileId,
    avisos: registro.avisos,
    eventos: registro.eventos_ids.length,
    provas: registro.provas.length,
    provas_com_imagem: lidas.filter(Boolean).length,
    custo_usd: custo,
    saldo_usd: saldo,
  });
}

// ------------------------------------------------------------------ listar, liberar, arquivar

async function listar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await garantirAcesso(ch, clientId);
  const [{ data, error }, contagem] = await Promise.all([corpo.arquivados === true ? servico().from(TABELA).select(CAMPOS).eq("client_id", clientId).not("arquivado_em", "is", null).order("criado_em", { ascending: false }).limit(60) : servico().from(TABELA).select(CAMPOS).eq("client_id", clientId).is("arquivado_em", null).order("criado_em", { ascending: false }).limit(60), corpo.arquivados === true ? null : servico().from(TABELA).select("id", { count: "exact", head: true }).eq("client_id", clientId).not("arquivado_em", "is", null)]);
  if (error) throw erroDoBanco(error, "listar documentos");
  const linhas = (data as LinhaDoDocumento[]) || [];
  const ids = linhas.map((l) => l.file_id).filter((x): x is string => !!x);
  const arquivos: Record<string, unknown> = {};
  if (ids.length) {
    const { data: fs, error: e } = await servico().from("files").select("id, file_name, file_url, storage_bucket, storage_path, mime_type, extension, visibility, approval_status, agency_approval_status, archived_at").in("id", ids);
    if (e) registrarFalha("documentos: arquivos da lista", e, { client_id: clientId });
    ((fs as Array<{ id: string }>) || []).forEach((f) => (arquivos[f.id] = f));
  }
  return json({
    documentos: linhas.map((l) => ({
      ...semConteudo(l),
      resumo: typeof l.conteudo.resumo === "string" ? l.conteudo.resumo : null,
      codigo: typeof l.conteudo.codigo === "string" ? l.conteudo.codigo : null,
      arquivo: l.file_id ? arquivos[l.file_id] || null : null,
    })),
    arquivados: contagem && !contagem.error ? contagem.count ?? 0 : null, custo_usd: 0,
  });
}

async function liberar(ch: Chamador, corpo: Record<string, unknown>) {
  const linha = await lerDocumento(ch, corpo.documento_id);
  const modo = corpo.modo === "client_shared" ? "client_shared" : corpo.modo === "approval" ? "approval" : null;
  if (!modo) throw new ErroHttp(400, "modo_invalido", "modo precisa ser approval (enviar para aprovação) ou client_shared (disponibilizar no portal).");
  if (corpo.confirmado !== true) throw new ErroHttp(400, "confirmacao_obrigatoria", "Nada vai ao cliente sem Confirmar na tela.");
  if (!linha.file_id) throw new ErroHttp(409, "documento_sem_pdf", "Gere o documento antes de mandar ao cliente.");
  if (linha.arquivado_em) throw new ErroHttp(409, "documento_arquivado", "Este documento está arquivado.");
  // Com a sessão de quem confirmou: a própria função do banco confere o papel (admin ou gestor).
  const { error } = await ch.doChamador.rpc("admin_release_file_now", { p_file_id: linha.file_id, p_mode: modo });
  if (error) {
    registrarFalha("documentos: liberar ao cliente falhou", error, { documento_id: linha.id });
    const soAdmin = /somente admin|manager/i.test(error.message || "");
    throw new ErroHttp(soAdmin ? 403 : 409, soAdmin ? "somente_admin_ou_gestor" : "liberacao_falhou", soAdmin ? "Só admin ou gestor manda ao cliente. Peça a um deles para confirmar." : `Não foi possível mandar ao cliente: ${error.message}`);
  }
  const { data, error: e } = await servico().from(TABELA).update({ status: modo === "approval" ? "em_aprovacao" : "no_portal", liberado_por: ch.userId, liberado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(), ...(typeof corpo.mensagem === "string" && corpo.mensagem.trim() ? { mensagem_envio: corpo.mensagem.trim().slice(0, 2000) } : {}) }).eq("id", linha.id).select(CAMPOS).single();
  if (e) throw erroDoBanco(e, "marcar liberação");
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "documento_entrega_liberar", origin: "mesa:documentos", keyId: `mesa:documentos:${ch.userId}`, scopes: ["files:write"],
    input: { client_id: linha.client_id, documento_id: linha.id, file_id: linha.file_id, modo }, success: true, statusCode: 200, durationMs: 0, resultRef: linha.file_id,
  });
  return json({ documento: semConteudo(data as LinhaDoDocumento), custo_usd: 0 });
}

async function arquivar(ch: Chamador, corpo: Record<string, unknown>) {
  const linha = await lerDocumento(ch, corpo.documento_id);
  const sim = corpo.arquivar !== false;
  const { data, error } = await servico().from(TABELA).update({ arquivado_em: sim ? new Date().toISOString() : null, arquivado_por: sim ? ch.userId : null, atualizado_em: new Date().toISOString() }).eq("id", linha.id).select(CAMPOS).single();
  if (error) throw erroDoBanco(error, "arquivar documento");
  return json({ documento: semConteudo(data as LinhaDoDocumento), custo_usd: 0 });
}

// ------------------------------------------------------------------ rotas

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  estimar,
  registrar_entrega: registrarEntrega,
  gerar_registro: gerarRegistro,
  listar,
  liberar,
  arquivar,
  rascunho,
  salvar_rascunho: salvarRascunho,
  agenda_ler: agendaLer,
  agenda_salvar: agendaSalvar,
};

/** Ações que podem passar de 150 s (IA, imagens, envio de arquivo): a resposta começa na hora. */
const ACOES_LONGAS = new Set(["gerar_registro", "rascunho"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  const doCron = await respostaDoCron(req, json);
  if (doCron) return doCron;
  try {
    const chamador = await identificar(req);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = await req.json();
    } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    const rodar = async () => {
      try {
        return await fn(chamador, corpo);
      } catch (err) {
        return respostaDeErro(err);
      }
    };
    return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
