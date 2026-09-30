/**
 * Geração da Mesa Vídeos (frente V-A, 26/09/2026): motores de vídeo e de
 * ângulo, custo antes, carteira do cliente, fila do provedor SEM laço e o
 * resultado no Storage do cliente com miniatura própria.
 * Contrato: docs/video/CONTRATOS.md.
 *
 * Ações (todas POST na função mesa-videos, só equipe com acesso ao cliente):
 * - motores_estado { } -> { motores: [{ id, estado, nivel, ... }] }
 * - custo_estimar { motor, duracao_s, resolucao?, audio?, variacoes?, referencias? } -> { custo }
 * - gerar_video { client_id, motor, modo, prompt, ..., variacoes, uid, custo_confirmado_usd } -> { ok, pedido_id, custo_estimado }
 * - angulo_gerar { client_id, imagem_path, angulo, variacoes?, modelo?, manter?, uid?, custo_confirmado_usd? } -> { ok, pedido_id, custo_estimado }
 * - continuar_video { client_id, arquivo_id, quadro_path?, prompt, motor, ... } -> { ok, pedido_id, custo_estimado, via }
 * - transicao_gerar { client_id, quadro_a_path, quadro_b_path, prompt?, motor, ... } -> { ok, pedido_id, custo_estimado }
 * - antes_depois_imagem { client_id, imagem_path, direcao, descricao, formato?, uid } -> { arquivo, storage_path, custo_usd }
 * - gerar_status { pedido_id } | gerar_status_cliente { client_id } -> { pedidos }
 * - quadro_registrar { client_id, storage_path, origem_arquivo_id?, posicao? } -> { arquivo }
 * - motores_sincronizar { } (cron semanal desligado ou admin) -> { novos, sumiram }
 * Frente V-C (26/09): Runway, Higgsfield e HeyGen pelo mesmo núcleo (executor por provedor).
 * - avatar_gerar { client_id, fonte: "estoque" | "clone", avatar_id? | clone_id?, voz_id, roteiro, formato, resolucao?, legendas?, velocidade?, uid, custo_confirmado_usd } -> { ok, pedido_id, custo_estimado }
 * - heygen_catalogo { tipo: "avatares" | "vozes", token? } -> { itens, proximo }
 * - gerar_cancelar { pedido_id } (Runway e Higgsfield) -> { pedidos, cancelados }
 *
 * Custo: sem `custo_confirmado_usd` a ação NÃO gera; devolve 409
 * confirmar_custo com a estimativa (a tela mostra e a pessoa confirma). Se a
 * estimativa do servidor passar da confirmada, 409 custo_mudou. Saldo da
 * carteira conferido antes; cobrança por variação pronta (ia_registrar_uso).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chamarImagem, garantirSaldo, IaMotorErro, modeloPadrao } from "../_shared/ia-motor.ts";
import { caminhoDaMiniatura, MAX_PIXELS_REDUCAO_NA_FUNCAO, reduzidaSemTransformacao } from "../_shared/imagem-reduzida.ts";
import { reduzirParaCaber } from "../_shared/imagem-local.ts";
import {
  catalogoEmUso,
  chavesQueFaltam,
  custoDaVariacaoPronta,
  custoDoMotor,
  estadoDoMotor,
  type LinhaDoCatalogoDeVideo,
  type MotorDeVideo,
  motorDoNivel,
  motorPorId,
  nivelDoMotor,
  novidadesDoProvedor,
  ROTULO_DO_ESTADO_DO_MOTOR,
  ROTULO_DO_NIVEL,
} from "./modulos/modelos-de-video.ts";
import {
  chaveDaGeracao,
  corpoDaGeracao,
  credenciaisPorNome,
  endpointDaGeracao,
  type EntradaDaGeracao,
  type EnvioAoProvedor,
  estadoDoPedidoPelosEnvios,
  executorDoProvedor,
  faltaParaGerar,
  type ModoDaGeracao,
  passouDoPrazo,
  podeConsultar,
} from "./modulos/video-executor.ts";
import { normalizarAngulo, normalizarManter, normalizarVariacoes } from "./modulos/video-angulo.ts";
import { fotoParaEditar, guardarDoProvedor, LEITURA_DA_FOTO_PARA_EDITAR, LEITURA_DA_MINIATURA_DO_QUADRO } from "./modulos/video-armazenar.ts";
import type { Credenciais, ExecutorDoProvedor, RefDoEnvio } from "./modulos/video-provedor-comum.ts";
import { movimentoValido } from "./modulos/video-provedor-higgsfield.ts";
import { cloneLiberadoParaVideo, duracaoEstimadaDaFala, listarAvataresDaHeygen, listarVozesDaHeygen, ROTEIRO_MAX_CARACTERES } from "./modulos/video-provedor-heygen.ts";

export interface BaseDaFuncao {
  servico: () => SupabaseClient;
  garantirAcesso: (clientId: string) => Promise<void>;
  erro: (status: number, codigo: string, mensagem: string, extra?: Record<string, unknown>) => Error;
  json: (corpo: unknown, status?: number) => Response;
  auditar: (ferramenta: string, input: Record<string, unknown>, sucesso: boolean, ref?: string) => Promise<void>;
  userId: string;
  admin: boolean;
}

const BUCKET = "mesa";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_PARA_O_PROVEDOR_S = 3600;
/** Tarefa e agente do registro de uso (valores que o banco aceita hoje; SQL não é preciso para cobrar). */
const TAREFA_DO_USO = "estudio";
const AGENTE_DO_USO = "gerador_imagem";
const TIPOS_DA_GERACAO = ["gerar_livre", "gerar_plano", "continuar_video", "transicao", "angulo"] as const;
type TipoDaGeracao = (typeof TIPOS_DA_GERACAO)[number];

const linha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const numero = (v: unknown, padrao: number) => (isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : padrao);

function temChave(nome: string): boolean {
  return !!lerSegredo(nome);
}

/** Valor do segredo (só no servidor; nunca volta para a tela nem para o registro). */
function lerSegredo(nome: string): string {
  if (!nome) return "";
  try {
    return (Deno.env.get(nome) || "").trim();
  } catch {
    return "";
  }
}

const credenciaisDoMotor = (m: MotorDeVideo): Credenciais => credenciaisPorNome(m, lerSegredo);

/** Erro de tabela/coluna que falta: o SQL V-01 não foi aplicado. */
function semSql(b: BaseDaFuncao, error: { message?: string; code?: string } | null): Error {
  const m = String((error && error.message) || "");
  if (/tipo_check|estado_check|does not exist|schema cache|PGRST20|42P01|42703|column/i.test(m)) {
    return b.erro(503, "banco_sem_gerador", "O gerador ainda não foi ativado no banco. Aplique o SQL V-01.");
  }
  return b.erro(500, "banco_indisponivel", "Não foi possível gravar agora. Tente de novo.");
}

// ------------------------------------------------------------------ catálogo em uso

// Frente AG2 (29/09): exportados para o diretor propor e gerar com o MESMO catálogo e as
// mesmas travas do gerar_video (preço do banco, motor desligado, chave que falta).
export async function catalogo(b: BaseDaFuncao): Promise<{ motores: MotorDeVideo[]; desligados: string[] }> {
  const { data, error } = await b.servico().from("video_motores").select("id, linha, versao, rotulo, endpoints, preco, novo, disponivel, ativo").limit(500);
  // Sem a tabela (SQL V-01): vale o catálogo em código.
  if (error) return catalogoEmUso([]);
  return catalogoEmUso((data || []) as LinhaDoCatalogoDeVideo[]);
}

export async function motorPronto(b: BaseDaFuncao, id: string): Promise<{ motor: MotorDeVideo; motores: MotorDeVideo[] }> {
  const c = await catalogo(b);
  const m = motorPorId(id, c.motores);
  if (!m) throw b.erro(400, "motor_desconhecido", "Motor de vídeo desconhecido.");
  const estado = estadoDoMotor(m, { temChave, desligados: c.desligados });
  // Só o NOME do segredo que falta (nunca o valor).
  const faltam = estado === "precisa_chave" ? chavesQueFaltam(m, temChave) : [];
  if (estado !== "pronto") throw b.erro(409, `motor_${estado}`, `${m.rotulo}: ${ROTULO_DO_ESTADO_DO_MOTOR[estado].toLowerCase()}${faltam.length ? ` (${faltam.join(" e ")})` : ""}.`, { estado, chave: faltam.join(", ") || null });
  if (!executorDoProvedor(m.provedor)) throw b.erro(409, "motor_a_integrar", `${m.rotulo} ainda não gera por aqui.`);
  return { motor: m, motores: c.motores };
}

export async function motoresEstado(b: BaseDaFuncao) {
  const c = await catalogo(b);
  const motores = c.motores.map((m) => {
    const estado = estadoDoMotor(m, { temChave, desligados: c.desligados });
    const nivel = nivelDoMotor(m, c.motores);
    return {
      id: m.id,
      estado,
      estado_rotulo: ROTULO_DO_ESTADO_DO_MOTOR[estado],
      nivel,
      nivel_rotulo: ROTULO_DO_NIVEL[nivel],
      novo: !!m.novo,
      rotulo: m.rotulo,
      linha: m.linha,
      versao: m.versao,
      // Só o NOME do segredo que falta (nunca o valor); par (Higgsfield) vem com os dois nomes.
      chave: estado === "precisa_chave" ? chavesQueFaltam(m, temChave).join(", ") || m.chave_env : null,
      custo_5s: custoDoMotor(m, { duracao_s: 5 }),
    };
  });
  return b.json({ motores, sugestao: { top: idOuNulo(motorDoNivel("top", { modo: "primeiro_quadro" }, c.motores)), normal: idOuNulo(motorDoNivel("normal", { modo: "primeiro_quadro" }, c.motores)), rapido: idOuNulo(motorDoNivel("rapido", { modo: "primeiro_quadro" }, c.motores)) } });
}
const idOuNulo = (m: MotorDeVideo | null) => (m ? m.id : null);

export async function custoEstimar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const c = await catalogo(b);
  const m = motorPorId(linha(corpo.motor, 60), c.motores);
  if (!m) throw b.erro(400, "motor_desconhecido", "Motor de vídeo desconhecido.");
  return b.json({ custo: custoDoMotor(m, { duracao_s: numero(corpo.duracao_s, 5), resolucao: linha(corpo.resolucao, 10) || null, audio: corpo.audio === true, variacoes: numero(corpo.variacoes, 1), referencias: numero(corpo.referencias, 0) }) });
}

// ------------------------------------------------------------------ entradas do Storage

/** Caminho do cliente no bucket mesa (sem ".."). */
function caminhoDoCliente(b: BaseDaFuncao, clientId: string, v: unknown, nome: string): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.indexOf(`${clientId}/`) !== 0 || s.indexOf("..") >= 0 || s.length > 500) throw b.erro(400, `${nome}_invalido`, "Arquivo fora da pasta do cliente.");
  return s;
}

async function urlAssinada(b: BaseDaFuncao, caminho: string | null): Promise<string | null> {
  if (!caminho) return null;
  const { data, error } = await b.servico().storage.from(BUCKET).createSignedUrl(caminho, URL_PARA_O_PROVEDOR_S);
  if (error || !data || !data.signedUrl) throw b.erro(404, "arquivo_indisponivel", "Um dos arquivos de entrada não foi encontrado no armazenamento.");
  return data.signedUrl;
}

// ------------------------------------------------------------------ custo e confirmação

function exigirConfirmacao(b: BaseDaFuncao, estimado: number | null, confirmado: unknown, detalhe: string) {
  if (estimado === null) throw b.erro(409, "sem_cotacao", "Este motor está sem preço conferido: não gera até ter o valor.");
  const c = Number(confirmado);
  if (confirmado === undefined || confirmado === null || confirmado === "" || !isFinite(c)) {
    throw b.erro(409, "confirmar_custo", "Confirme o custo antes de gerar.", { custo_estimado: { usd: estimado, detalhe } });
  }
  if (estimado > c + 0.005) throw b.erro(409, "custo_mudou", "O custo mudou desde a confirmação. Confira de novo.", { custo_estimado: { usd: estimado, detalhe } });
}

async function conferirSaldo(b: BaseDaFuncao, clientId: string, usd: number) {
  try {
    await garantirSaldo(clientId, usd);
  } catch (e) {
    if (e instanceof IaMotorErro) throw b.erro(e.status, e.codigo, e.message, e.detalhes);
    throw e;
  }
}

/** Registra o uso de UMA variação pronta na carteira (ia_registrar_uso, chave da agência). */
async function cobrar(b: BaseDaFuncao, clientId: string, pedidoId: string, motor: string, usd: number, imagens: number, provedor = "fal"): Promise<string | null> {
  const { data, error } = await b.servico().rpc("ia_registrar_uso", {
    _client_id: clientId,
    _tarefa: TAREFA_DO_USO,
    _agente: AGENTE_DO_USO,
    _modelo_id: `video:${motor}`,
    _provedor: provedor,
    _tokens_entrada: 0,
    _tokens_saida: 0,
    _tokens_cache: 0,
    _imagens: imagens,
    _qualidade: null,
    _custo_usd: Math.round(usd * 10000) / 10000,
    _custo_fonte: "tabela",
    _referencia_tipo: "video_pedido",
    _referencia_id: pedidoId,
    _criado_por: b.userId,
    _chave_origem: "agencia",
    _chave_id: null,
  });
  if (error) {
    console.error("[mesa-videos] uso de vídeo não registrado", { pedido_id: pedidoId, motor });
    return null;
  }
  const l = (Array.isArray(data) ? data[0] : data) as { uso_id?: string } | null;
  return l && l.uso_id ? String(l.uso_id) : null;
}

// ------------------------------------------------------------------ enviar (núcleo comum)

interface PedidoDeGeracao {
  clientId: string;
  tipo: TipoDaGeracao;
  motor: MotorDeVideo;
  entrada: EntradaDaGeracao;
  caminhos: { quadro_inicial: string | null; quadro_final: string | null; referencias: string[]; video_arquivo_id: string | null };
  variacoes: number;
  uid: string;
  confirmado: unknown;
  projetoId: string | null;
  planoRef: string | null;
  titulo: string | null;
  /** Campos a mais nos parâmetros do pedido (câmera, avatar); nunca URL assinada nem chave. */
  extras?: Record<string, unknown>;
}

/** Valida, confere custo e saldo, grava o pedido e envia cada variação UMA vez. */
export async function enviarGeracao(b: BaseDaFuncao, p: PedidoDeGeracao): Promise<Record<string, unknown>> {
  const falta = faltaParaGerar(p.motor, p.entrada);
  if (falta) throw b.erro(400, "entrada_incompleta", falta);
  const executor = executorDoProvedor(p.motor.provedor);
  if (!executor) throw b.erro(409, "motor_a_integrar", `${p.motor.rotulo} ainda não gera por aqui.`);
  const custo = custoDoMotor(p.motor, { duracao_s: p.entrada.duracao_s, resolucao: p.entrada.resolucao, audio: p.entrada.audio, variacoes: p.variacoes, referencias: (p.entrada.referencias_urls || []).length });
  exigirConfirmacao(b, custo.usd, p.confirmado, custo.detalhe);
  const chave = chaveDaGeracao(p.tipo, p.uid);
  const { data: existente, error: eEx } = await b.servico().from("video_pedidos").select("*").eq("client_id", p.clientId).eq("chave", chave).limit(1).maybeSingle();
  if (eEx) throw semSql(b, eEx);
  if (existente) return { ok: true, pedido_id: (existente as { id: string }).id, custo_estimado: (existente as { custo_estimado: unknown }).custo_estimado, ja_existia: true };
  await conferirSaldo(b, p.clientId, custo.usd as number);

  const endpoint = endpointDaGeracao(p.motor, p.entrada);
  const agora = new Date();
  const prazo = new Date(agora.getTime() + p.motor.prazo_min * 60_000).toISOString();
  const custoEstimado = { usd: custo.usd, detalhe: custo.detalhe, incerto: custo.incerto, motor: p.motor.id, confirmado_usd: Number(p.confirmado), por_variacao: Math.round(((custo.usd as number) / p.variacoes) * 10000) / 10000 };
  const { data: criado, error } = await b.servico()
    .from("video_pedidos")
    .insert({
      client_id: p.clientId,
      tipo: p.tipo,
      alvo: { motor: p.motor.id, modo: p.entrada.modo, plano_ref: p.planoRef, projeto_id: p.projetoId, video_arquivo_id: p.caminhos.video_arquivo_id, titulo: p.titulo },
      parametros: {
        prompt: p.entrada.prompt,
        negativo: p.entrada.negativo || null,
        duracao_s: p.entrada.duracao_s,
        formato: p.entrada.formato,
        resolucao: p.entrada.resolucao || p.motor.resolucao_padrao,
        audio: p.entrada.audio,
        variacoes: p.variacoes,
        seed: p.entrada.seed ?? null,
        angulo: p.entrada.angulo || null,
        manter: p.entrada.manter || null,
        quadro_inicial_path: p.caminhos.quadro_inicial,
        quadro_final_path: p.caminhos.quadro_final,
        referencias_paths: p.caminhos.referencias,
        endpoint,
        camera: p.entrada.camera || null,
        provedor: p.motor.provedor,
        ...(p.extras || {}),
      },
      custo_estimado: custoEstimado,
      executor: p.motor.id,
      estado: "enviado",
      chave,
      resultado: { envios: [] },
      criado_por: b.userId,
      projeto_id: p.projetoId,
      prazo_em: prazo,
    })
    .select("id")
    .single();
  if (error) throw semSql(b, error);
  const pedidoId = (criado as { id: string }).id;

  const envios: EnvioAoProvedor[] = [];
  const credenciais = credenciaisDoMotor(p.motor);
  for (let n = 1; n <= p.variacoes; n++) {
    const entrada = { ...p.entrada, seed: typeof p.entrada.seed === "number" ? p.entrada.seed + n - 1 : p.entrada.seed };
    const base: EnvioAoProvedor = { n, request_id: "", status_url: "", response_url: "", endpoint, estado: "erro", enviado_em: new Date().toISOString(), consultado_em: null, posicao: null, erro: null, arquivo_id: null, storage_path: null, uso_id: null, custo_usd: null };
    try {
      // Chave de idempotência (a HeyGen usa): o mesmo pedido e variação nunca paga duas vezes.
      const r = await executor.enviar(endpoint, corpoDaGeracao(p.motor, entrada), credenciais, { idempotencia: `${pedidoId}-${n}` });
      envios.push({ ...base, ...r, estado: "enviado" });
    } catch (e) {
      // Sem nova tentativa: o erro fica registrado e nada é cobrado. Frente FS: e no log.
      console.error("mesa-videos: envio ao provedor falhou", { endpoint, n, motivo: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      envios.push({ ...base, erro: e instanceof Error ? e.message : "Falha ao enviar." });
    }
  }
  const estado = estadoDoPedidoPelosEnvios(envios);
  await b.servico().from("video_pedidos").update({ estado, resultado: { envios }, atualizado_em: new Date().toISOString() }).eq("id", pedidoId);
  await b.auditar("video_gerar", { client_id: p.clientId, tipo: p.tipo, motor: p.motor.id, variacoes: p.variacoes, enviados: envios.filter((x) => x.estado === "enviado").length }, estado !== "erro", pedidoId);
  if (estado === "erro") throw b.erro(502, "provedor_recusou", envios[0] && envios[0].erro ? envios[0].erro : "O provedor não aceitou o pedido. Nada foi cobrado.", { pedido_id: pedidoId });
  return { ok: true, pedido_id: pedidoId, custo_estimado: custoEstimado, enviados: envios.filter((x) => x.estado === "enviado").length };
}

// ------------------------------------------------------------------ ações de gerar

const MODOS: ModoDaGeracao[] = ["texto", "primeiro_quadro", "primeiro_ultimo", "referencia", "estender"];

async function entradaDoCorpo(b: BaseDaFuncao, clientId: string, corpo: Record<string, unknown>, motor: MotorDeVideo, modo: ModoDaGeracao) {
  const qi = caminhoDoCliente(b, clientId, corpo.quadro_inicial_path, "quadro_inicial");
  const qf = caminhoDoCliente(b, clientId, corpo.quadro_final_path, "quadro_final");
  const refs = (Array.isArray(corpo.referencias_paths) ? (corpo.referencias_paths as unknown[]) : []).slice(0, 10).map((x) => caminhoDoCliente(b, clientId, x, "referencia")).filter((x): x is string => !!x);
  let videoArquivoId: string | null = null;
  let videoPath: string | null = null;
  if (modo === "estender") {
    videoArquivoId = String(corpo.video_arquivo_id || corpo.arquivo_id || "");
    if (!UUID.test(videoArquivoId)) throw b.erro(400, "arquivo_id_invalido", "Escolha o vídeo para continuar.");
    const { data } = await b.servico().from("video_arquivos").select("id, client_id, storage_path").eq("id", videoArquivoId).maybeSingle();
    const a = data as { client_id: string; storage_path: string } | null;
    if (!a || a.client_id !== clientId) throw b.erro(404, "arquivo_inexistente", "Vídeo não encontrado.");
    videoPath = a.storage_path;
  }
  const [ini, fim, video, ...refUrls] = await Promise.all([urlAssinada(b, qi), urlAssinada(b, qf), urlAssinada(b, videoPath), ...refs.map((r) => urlAssinada(b, r))]);
  const entrada: EntradaDaGeracao = {
    modo,
    prompt: String(corpo.prompt || "").replace(/\s+/g, " ").trim().slice(0, 2400),
    negativo: linha(corpo.negativo, 600) || null,
    duracao_s: numero(corpo.duracao_s, 5),
    formato: ["9:16", "16:9", "1:1", "4:5"].indexOf(String(corpo.formato)) >= 0 ? String(corpo.formato) : "9:16",
    resolucao: linha(corpo.resolucao, 10) || null,
    audio: corpo.audio === true,
    seed: corpo.seed === undefined || corpo.seed === null || corpo.seed === "" ? null : numero(corpo.seed, 0),
    quadro_inicial_url: ini,
    quadro_final_url: fim,
    referencias_urls: refUrls.filter((u): u is string => !!u),
    video_url: video,
    // Movimento pronto de câmera (Higgsfield); outro motor ignora.
    camera: motor.cap.camera ? movimentoValido(corpo.camera) : null,
  };
  if (motor.formatos.indexOf(entrada.formato) < 0) throw b.erro(400, "formato_nao_aceito", `${motor.rotulo} não faz ${entrada.formato}.`);
  return { entrada, caminhos: { quadro_inicial: qi, quadro_final: qf, referencias: refs, video_arquivo_id: videoArquivoId } };
}

export async function gerarVideo(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const { motor } = await motorPronto(b, linha(corpo.motor, 60));
  if (motor.familia !== "video") throw b.erro(400, "motor_nao_e_de_video", `${motor.rotulo} não gera vídeo.`);
  const modo = MODOS.indexOf(corpo.modo as ModoDaGeracao) >= 0 ? (corpo.modo as ModoDaGeracao) : corpo.quadro_inicial_path ? "primeiro_quadro" : "texto";
  const tipo: TipoDaGeracao = (TIPOS_DA_GERACAO as readonly string[]).indexOf(String(corpo.tipo)) >= 0 ? (corpo.tipo as TipoDaGeracao) : "gerar_livre";
  const { entrada, caminhos } = await entradaDoCorpo(b, clientId, corpo, motor, modo);
  const r = await enviarGeracao(b, {
    clientId,
    tipo,
    motor,
    entrada,
    caminhos,
    variacoes: normalizarVariacoes(corpo.variacoes),
    uid: linha(corpo.uid, 64),
    confirmado: corpo.custo_confirmado_usd,
    projetoId: UUID.test(String(corpo.projeto_id || "")) ? String(corpo.projeto_id) : null,
    planoRef: linha(corpo.plano_ref, 8) || null,
    titulo: linha(corpo.titulo, 120) || null,
  });
  return b.json(r);
}

/** Contrato com a V-B: angulo_gerar. */
export async function anguloGerar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const imagem = caminhoDoCliente(b, clientId, corpo.imagem_path, "imagem_path");
  if (!imagem) throw b.erro(400, "imagem_path_invalido", "Escolha a imagem.");
  let angulo;
  try {
    angulo = normalizarAngulo(corpo.angulo);
  } catch (e) {
    throw b.erro(400, "angulo_invalido", e instanceof Error ? e.message : "Ângulo inválido.");
  }
  const c = await catalogo(b);
  const escolhido = corpo.modelo ? motorPorId(linha(corpo.modelo, 60), c.motores) : motorDoNivel("top", { modo: "angulo" }, c.motores);
  if (!escolhido || escolhido.familia !== "angulo") throw b.erro(400, "motor_desconhecido", "Motor de ângulo desconhecido.");
  const { motor } = await motorPronto(b, escolhido.id);
  const variacoes = normalizarVariacoes(corpo.variacoes);
  const custo = custoDoMotor(motor, { variacoes });
  // Só estimar: a tela (ou a V-B) mostra o custo antes do clique.
  if (corpo.so_estimar === true) return b.json({ ok: true, pedido_id: null, custo_estimado: { usd: custo.usd, detalhe: custo.detalhe, incerto: custo.incerto, motor: motor.id } });
  const entrada: EntradaDaGeracao = {
    modo: "angulo",
    prompt: linha(corpo.prompt, 300),
    duracao_s: 0,
    formato: "9:16",
    audio: false,
    seed: corpo.seed === undefined || corpo.seed === null ? null : numero(corpo.seed, 0),
    quadro_inicial_url: await urlAssinada(b, imagem),
    angulo,
    manter: normalizarManter(corpo.manter),
  };
  const r = await enviarGeracao(b, {
    clientId,
    tipo: "angulo",
    motor,
    entrada,
    caminhos: { quadro_inicial: imagem, quadro_final: null, referencias: [], video_arquivo_id: null },
    variacoes,
    uid: linha(corpo.uid, 64) || `${imagem}:${angulo.azimute}:${angulo.elevacao}:${angulo.distancia}:${Date.now()}`,
    confirmado: corpo.custo_confirmado_usd,
    projetoId: UUID.test(String(corpo.projeto_id || "")) ? String(corpo.projeto_id) : null,
    planoRef: null,
    titulo: linha(corpo.titulo, 120) || null,
  });
  return b.json(r);
}

/**
 * Continuar um vídeo: extensão nativa quando o motor tem (e a pessoa não
 * pediu o contrário); senão, imagem para vídeo a partir do último quadro
 * (extraído no navegador, quadro_path). Mesmo prompt de personagem/cenário.
 */
export async function continuarVideo(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const { motor } = await motorPronto(b, linha(corpo.motor, 60));
  const nativo = motor.cap.estender && corpo.usar_extensao !== false;
  const modo: ModoDaGeracao = nativo ? "estender" : "primeiro_quadro";
  if (!nativo && !corpo.quadro_path) throw b.erro(400, "quadro_faltando", "Falta o último quadro do vídeo (a tela extrai antes).");
  const { entrada, caminhos } = await entradaDoCorpo(b, clientId, { ...corpo, quadro_inicial_path: nativo ? null : corpo.quadro_path, video_arquivo_id: corpo.arquivo_id }, motor, modo);
  const r = await enviarGeracao(b, {
    clientId,
    tipo: "continuar_video",
    motor,
    entrada,
    caminhos: { ...caminhos, video_arquivo_id: String(corpo.arquivo_id || "") || null },
    variacoes: normalizarVariacoes(corpo.variacoes),
    uid: linha(corpo.uid, 64),
    confirmado: corpo.custo_confirmado_usd,
    projetoId: UUID.test(String(corpo.projeto_id || "")) ? String(corpo.projeto_id) : null,
    planoRef: linha(corpo.plano_ref, 8) || null,
    titulo: linha(corpo.titulo, 120) || null,
  });
  return b.json({ ...r, via: nativo ? "extensao_nativa" : "ultimo_quadro" });
}

/** Transição A -> B: primeiro quadro = último de A; último quadro = primeiro de B. */
export async function transicaoGerar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const { motor } = await motorPronto(b, linha(corpo.motor, 60));
  if (!motor.cap.ultimo_quadro) throw b.erro(400, "motor_sem_ultimo_quadro", `${motor.rotulo} não aceita último quadro. Escolha outro motor.`);
  const prompt = linha(corpo.prompt, 2400) || "Seamless continuous transition between the two shots, same characters, same place and light, smooth camera move, photorealistic.";
  const { entrada, caminhos } = await entradaDoCorpo(b, clientId, { ...corpo, prompt, quadro_inicial_path: corpo.quadro_a_path, quadro_final_path: corpo.quadro_b_path }, motor, "primeiro_ultimo");
  const r = await enviarGeracao(b, {
    clientId,
    tipo: "transicao",
    motor,
    entrada,
    caminhos,
    variacoes: normalizarVariacoes(corpo.variacoes),
    uid: linha(corpo.uid, 64),
    confirmado: corpo.custo_confirmado_usd,
    projetoId: UUID.test(String(corpo.projeto_id || "")) ? String(corpo.projeto_id) : null,
    planoRef: null,
    titulo: linha(corpo.titulo, 120) || "Transição",
  });
  return b.json(r);
}

// ------------------------------------------------------------------ antes e depois de uma foto só

const TAMANHO_DO_FORMATO: Record<string, string> = { "9:16": "1024x1536", "4:5": "1088x1360", "1:1": "1024x1024", "16:9": "1536x1024" };

/**
 * Gera a outra versão da foto (o "antes" ou o "depois") com o modelo de
 * imagem do painel (padrão "imagem" no ia_modelos; nada de trocar o modelo de
 * outra tela), pelo motor de IA e a carteira do cliente. Mesma câmera, luz e
 * enquadramento; só muda o que a descrição pede.
 */
export async function antesDepoisImagem(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const origem = caminhoDoCliente(b, clientId, corpo.imagem_path, "imagem_path");
  if (!origem) throw b.erro(400, "imagem_path_invalido", "Escolha a foto.");
  const direcao = corpo.direcao === "antes" ? "antes" : "depois";
  const descricao = linha(corpo.descricao, 600);
  if (!descricao) throw b.erro(400, "descricao_vazia", `Diga como é o ${direcao}.`);
  const modelo = await modeloPadrao("imagem");
  if (!modelo) throw b.erro(409, "sem_modelo_de_imagem", "Nenhum modelo de imagem padrão ativo no painel.");
  // Cópia leve (até 2048 px; pedida à copias-leves quando falta), nunca o original inteiro sem teto.
  const L = LEITURA_DA_FOTO_PARA_EDITAR;
  const leitura = await reduzidaSemTransformacao(b.servico(), BUCKET, origem, L.caixa, L.caixa, L.opcoes).catch(() => null);
  const foto = fotoParaEditar(leitura);
  if (foto.erro === "foto_ilegivel") throw b.erro(404, "arquivo_indisponivel", "Não deu para ler a foto (arquivo ou formato).");
  if (foto.erro === "foto_grande_demais") throw b.erro(413, "foto_grande_demais", "A foto é grande demais para editar aqui. Abra a foto na Mesa Foto (grava a cópia leve) e tente de novo.");
  const bytes = foto.bytes as Uint8Array;
  const prompt = direcao === "depois"
    ? `Edit this exact photo to show the AFTER state: ${descricao}. Keep the same camera position, lens, framing, perspective, light and everything else identical. Photorealistic, no text.`
    : `Edit this exact photo to show the BEFORE state: ${descricao}. Keep the same camera position, lens, framing, perspective, light and everything else identical. Photorealistic, no text.`;
  let saida;
  try {
    saida = await chamarImagem({
      clientId,
      modeloId: modelo.id,
      prompt,
      referencias: [],
      qualidade: "alta",
      tamanho: TAMANHO_DO_FORMATO[String(corpo.formato)] || "1024x1536",
      editar: { bytes },
      tarefa: "estudio",
      agente: "gerador_imagem",
      criadoPor: b.userId,
    });
  } catch (e) {
    if (e instanceof IaMotorErro) throw b.erro(e.status, e.codigo, e.message, e.detalhes);
    throw e;
  }
  const ext = saida.mime === "image/jpeg" ? "jpg" : saida.mime === "image/webp" ? "webp" : "png";
  const caminho = `${clientId}/video/quadros/${direcao}-${crypto.randomUUID()}.${ext}`;
  const up = await b.servico().storage.from(BUCKET).upload(caminho, saida.png, { contentType: saida.mime, upsert: false });
  if (up.error) throw b.erro(500, "armazenamento_falhou", "A imagem foi gerada, mas não foi gravada. O custo já foi registrado.");
  await gravarMiniaturaDaImagem(b, caminho, saida.png);
  const arquivo = await registrarArquivo(b, clientId, { caminho, tipo: "quadro", nome: `${direcao} ${descricao}`.slice(0, 100), mime: saida.mime, bytes: saida.png.byteLength, nota: `${direcao === "depois" ? "Depois" : "Antes"} gerado de ${origem.split("/").pop()}`, pedidoId: null, origem: { tipo: "antes_depois", direcao, de: origem, modelo: saida.modeloId } });
  await b.auditar("video_antes_depois_imagem", { client_id: clientId, direcao }, true);
  return b.json({ arquivo, storage_path: caminho, custo_usd: saida.custoUsd, saldo_usd: saida.saldoUsd, origem_path: origem });
}

// ------------------------------------------------------------------ arquivos e miniaturas

async function gravarMiniaturaDaImagem(b: BaseDaFuncao, caminho: string, bytes: Uint8Array) {
  try {
    // Teto de pixels da função (imagem maior não é aberta aqui: a tela mostra o original).
    const r = await reduzirParaCaber(bytes, 640, 640, { qualidadeJpeg: 82, maxPixels: MAX_PIXELS_REDUCAO_NA_FUNCAO });
    if (!r) return;
    await b.servico().storage.from(BUCKET).upload(caminhoDaMiniatura(caminho), r.bytes, { contentType: r.mime, upsert: true, cacheControl: "86400" });
  } catch {
    /* sem miniatura: a tela mostra o original */
  }
}

async function registrarArquivo(
  b: BaseDaFuncao,
  clientId: string,
  a: { caminho: string; tipo: string; nome: string; mime: string; bytes: number; duracao?: number | null; nota: string; pedidoId: string | null; origem: Record<string, unknown>; cenaRef?: string | null; grupo?: string | null },
) {
  const nome = a.nome.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "gerado";
  const { data, error } = await b.servico()
    .from("video_arquivos")
    .insert({
      client_id: clientId,
      nome,
      nome_original: a.caminho.split("/").pop() || nome,
      storage_bucket: BUCKET,
      storage_path: a.caminho,
      tipo: a.tipo,
      mime: a.mime,
      bytes: a.bytes,
      duracao_s: a.duracao ?? null,
      nota: a.nota.slice(0, 600),
      cena_ref: a.cenaRef ? a.cenaRef.slice(0, 40) : null,
      grupo: a.grupo ? a.grupo.slice(0, 80) : null,
      criado_por: b.userId,
      pedido_id: a.pedidoId,
      origem: a.origem,
    })
    .select("*")
    .single();
  if (error) throw semSql(b, error);
  return data;
}

export async function quadroRegistrar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const caminho = caminhoDoCliente(b, clientId, corpo.storage_path, "storage_path");
  if (!caminho || caminho.indexOf(`${clientId}/video/quadros/`) !== 0) throw b.erro(400, "storage_path_invalido", "O quadro precisa estar na pasta de quadros do cliente.");
  const { data: lista } = await b.servico().storage.from(BUCKET).list(caminho.slice(0, caminho.lastIndexOf("/")), { search: caminho.split("/").pop(), limit: 3 });
  if (!(lista || []).some((x: { name: string }) => x.name === caminho.split("/").pop())) throw b.erro(404, "arquivo_indisponivel", "Quadro não encontrado no armazenamento.");
  const posicao = corpo.posicao === "primeiro" ? "primeiro" : corpo.posicao === "ultimo" ? "ultimo" : null;
  const arquivo = await registrarArquivo(b, clientId, { caminho, tipo: "quadro", nome: linha(corpo.nome, 100) || `quadro ${posicao || ""}`.trim(), mime: "image/png", bytes: numero(corpo.bytes, 0), nota: posicao ? `${posicao === "ultimo" ? "Último" : "Primeiro"} quadro` : "Quadro", pedidoId: null, origem: { tipo: "quadro", posicao, de: UUID.test(String(corpo.origem_arquivo_id || "")) ? String(corpo.origem_arquivo_id) : null } });
  return b.json({ arquivo });
}

// ------------------------------------------------------------------ status (sem laço)

type LinhaDoPedido = { id: string; client_id: string; tipo: string; alvo: Record<string, unknown>; parametros: Record<string, unknown>; custo_estimado: Record<string, unknown>; executor: string; estado: string; resultado: { envios?: EnvioAoProvedor[] } | null; consultado_em?: string | null };

const refDoEnvio = (e: EnvioAoProvedor): RefDoEnvio => ({ request_id: e.request_id, status_url: e.status_url, response_url: e.response_url, endpoint: e.endpoint });

/** Miniatura pronta do provedor (imagem pequena, uma chamada; sem ela a tela grava do vídeo). */
async function miniaturaDoProvedor(b: BaseDaFuncao, caminho: string, url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const tamanho = Number(r.headers.get("content-length") || 0);
    if (!r.ok || !/^image\//.test(r.headers.get("content-type") || "") || tamanho > 3 * 1024 * 1024) {
      await r.body?.cancel().catch(() => undefined);
      return false;
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.byteLength > 3 * 1024 * 1024) return false;
    await gravarMiniaturaDaImagem(b, caminho, bytes);
    return true;
  } catch {
    return false;
  }
}

/** O quadro inicial já lido nesta consulta (as variações do mesmo pedido usam o mesmo quadro). */
type CacheDoQuadro = { lido?: boolean; bytes?: Uint8Array | null; mime?: string };

/**
 * Miniatura do vídeo a partir do quadro inicial pela CÓPIA LEVE (640 px; pedida
 * à copias-leves quando falta), lida uma vez por consulta: nunca o original de
 * até 20 MB aberto aqui a cada variação. Sem cópia, a tela grava do vídeo.
 */
async function miniaturaDoQuadro(b: BaseDaFuncao, caminhoDoVideo: string, quadro: string, cache: CacheDoQuadro) {
  if (!cache.lido) {
    cache.lido = true;
    const L = LEITURA_DA_MINIATURA_DO_QUADRO;
    const r = await reduzidaSemTransformacao(b.servico(), BUCKET, quadro, L.caixa, L.caixa, L.opcoes).catch(() => null);
    cache.bytes = r && r.cabe ? r.bytes : null;
    cache.mime = r ? r.mime : undefined;
  }
  if (!cache.bytes) return;
  try {
    await b.servico().storage.from(BUCKET).upload(caminhoDaMiniatura(caminhoDoVideo), cache.bytes, { contentType: cache.mime || "image/jpeg", upsert: true, cacheControl: "86400" });
  } catch {
    /* sem miniatura: a tela grava do vídeo */
  }
}

async function baixarResultado(b: BaseDaFuncao, p: LinhaDoPedido, motor: MotorDeVideo | null, e: EnvioAoProvedor, executor: ExecutorDoProvedor, credenciais: Credenciais, cacheDoQuadro: CacheDoQuadro = {}) {
  const r = await executor.resultado(refDoEnvio(e), credenciais);
  // Avatar com legenda pedida: a versão com a legenda gravada (se o provedor devolveu).
  const avatar = p.parametros.avatar && typeof p.parametros.avatar === "object" ? (p.parametros.avatar as { legendas?: boolean }) : null;
  const url = avatar && avatar.legendas && r.legendado_url ? r.legendado_url : r.urls[0];
  const video = r.tipo === "video";
  const pasta = video ? "gerados" : "angulos";
  // A extensão sai do tipo pedido; o mime real vem do provedor (a imagem de ângulo quase sempre é PNG).
  const caminhoBase = `${p.client_id}/video/${pasta}/${p.id}-${e.n}`;
  const caminho = `${caminhoBase}.${video ? "mp4" : "png"}`;
  // Sem carregar o vídeo inteiro na memória: partes de 6 MB (TUS) ou transmissão direta.
  const g = await guardarDoProvedor(url, r.tipo, {
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
    chaveDeServico: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    bucket: BUCKET,
    caminho,
  });
  const mime = g.mime;
  // Miniatura própria (nunca transformação do Storage): imagem reduzida aqui;
  // miniatura pronta do provedor (HeyGen) quando vem; vídeo com quadro inicial usa o quadro
  // (é o primeiro quadro); sem nada disso, a tela grava do vídeo.
  if (!video && g.conteudo) await gravarMiniaturaDaImagem(b, caminho, g.conteudo);
  else if (video && r.miniatura_url && (await miniaturaDoProvedor(b, caminho, r.miniatura_url))) {
    /* feita pela miniatura do provedor */
  } else if (video && p.parametros.quadro_inicial_path) {
    await miniaturaDoQuadro(b, caminho, String(p.parametros.quadro_inicial_path), cacheDoQuadro);
  }
  const prompt = String(p.parametros.prompt || "");
  const arquivo = (await registrarArquivo(b, p.client_id, {
    caminho,
    tipo: video ? "gerado" : "angulo",
    nome: `${String(p.alvo.titulo || (motor ? motor.rotulo : p.executor))} ${e.n}`,
    mime,
    bytes: g.bytes || 0,
    duracao: video ? (typeof r.duracao_s === "number" && r.duracao_s > 0 ? Math.round(r.duracao_s * 100) / 100 : Number(p.parametros.duracao_s) || null) : null,
    nota: `${motor ? motor.rotulo : p.executor}: ${prompt}`.slice(0, 600),
    pedidoId: p.id,
    origem: { motor: p.executor, provedor: motor ? motor.provedor : null, endpoint: e.endpoint, pedido: p.id, variacao: e.n, plano: p.alvo.plano_ref || null, projeto: p.alvo.projeto_id || null, tipo: p.tipo, modo: p.alvo.modo || null, legendado: !!(avatar && avatar.legendas && r.legendado_url) },
    cenaRef: p.alvo.plano_ref ? String(p.alvo.plano_ref) : null,
    grupo: p.alvo.titulo ? String(p.alvo.titulo) : null,
  })) as { id: string };
  return { arquivo_id: arquivo.id, storage_path: caminho };
}

/**
 * Uma rodada de consulta de UM pedido (a tela pede ao abrir os Resultados ou
 * no botão "Conferir"). Trava por consultado_em: duas abas não consultam juntas.
 */
async function consultarPedido(b: BaseDaFuncao, p: LinhaDoPedido): Promise<LinhaDoPedido> {
  const envios = ((p.resultado && p.resultado.envios) || []).slice();
  const agora = Date.now();
  const precisa = envios.some((e) => podeConsultar(e, agora) || e.estado === "baixando");
  if (!precisa) return p;
  // Trava: só quem conseguir marcar consultado_em segue (intervalo mínimo entre consultas).
  const limite = new Date(agora - 15_000).toISOString();
  const { data: travado, error } = await b.servico()
    .from("video_pedidos")
    .update({ consultado_em: new Date(agora).toISOString() })
    .eq("id", p.id)
    .or(`consultado_em.is.null,consultado_em.lt.${limite}`)
    .select("id")
    .maybeSingle();
  if (error) throw semSql(b, error);
  if (!travado) return p;
  const c = await catalogo(b);
  const motor = motorPorId(p.executor, c.motores);
  // O executor do provedor do motor (fal, Runway, Higgsfield, HeyGen); a chave só pelo nome do segredo.
  const executor = motor ? executorDoProvedor(motor.provedor) : null;
  const credenciais: Credenciais = motor ? credenciaisDoMotor(motor) : { chave: "" };
  const prazoMin = motor ? motor.prazo_min : 30;
  const porVariacao = Number(p.custo_estimado && p.custo_estimado.por_variacao) || 0;
  const cacheDoQuadro: CacheDoQuadro = {};
  for (const e of envios) {
    if (e.estado === "enviado" || e.estado === "gerando") {
      if (passouDoPrazo(e, prazoMin, agora)) {
        e.estado = "erro";
        e.erro = `Passou do prazo de ${prazoMin} min sem terminar. Nada foi cobrado.`;
        continue;
      }
      if (!executor) {
        e.estado = "erro";
        e.erro = "O motor deste pedido saiu do catálogo. Nada foi cobrado.";
        continue;
      }
      try {
        const s = await executor.consultar(refDoEnvio(e), credenciais);
        e.consultado_em = new Date().toISOString();
        e.posicao = s.posicao;
        if (typeof s.duracao_s === "number" && s.duracao_s > 0) e.duracao_s = s.duracao_s;
        if (s.estado === "gerando") {
          e.estado = "gerando";
          e.erro = null;
        } else if (s.estado === "fila") e.erro = null;
        else if (s.estado === "erro") {
          e.estado = "erro";
          e.erro = s.erro;
        } else if (s.estado === "pronto") e.estado = "baixando";
      } catch (err) {
        // Falha de rede na consulta não encerra o envio: a próxima consulta (pedida pela tela) tenta.
        e.consultado_em = new Date().toISOString();
        e.erro = err instanceof Error ? err.message : "Consulta falhou.";
      }
    }
    if (e.estado === "baixando") {
      if (!executor) {
        e.erro = "O motor deste pedido saiu do catálogo.";
        continue;
      }
      // Cobra uma vez só (o provedor já gerou), antes de baixar. Avatar: pela duração real, até o confirmado.
      const valor = custoDaVariacaoPronta(motor, porVariacao, e.duracao_s, String(p.parametros.resolucao || ""));
      if (!e.uso_id && valor > 0) {
        e.uso_id = await cobrar(b, p.client_id, p.id, p.executor, valor, p.tipo === "angulo" ? 1 : 0, motor ? motor.provedor : "fal");
        e.custo_usd = valor;
      }
      try {
        const r = await baixarResultado(b, p, motor, e, executor, credenciais, cacheDoQuadro);
        e.arquivo_id = r.arquivo_id;
        e.storage_path = r.storage_path;
        e.estado = "pronto";
        e.erro = null;
      } catch (err) {
        // Fica "baixando" com o motivo: o botão "Baixar de novo" pede outra vez (nunca sozinho).
        e.erro = err instanceof Error ? err.message : "Não baixou.";
      }
    }
  }
  const estado = estadoDoPedidoPelosEnvios(envios);
  const { data: salvo } = await b.servico().from("video_pedidos").update({ estado, resultado: { ...(p.resultado || {}), envios }, atualizado_em: new Date().toISOString() }).eq("id", p.id).select("*").single();
  return (salvo as LinhaDoPedido) || { ...p, estado, resultado: { envios } };
}

export async function gerarStatus(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const id = String(corpo.pedido_id || "");
  if (!UUID.test(id)) throw b.erro(400, "pedido_id_invalido", "pedido_id precisa ser um UUID.");
  const { data, error } = await b.servico().from("video_pedidos").select("*").eq("id", id).maybeSingle();
  if (error) throw semSql(b, error);
  if (!data) throw b.erro(404, "pedido_inexistente", "Pedido não encontrado.");
  const p = data as LinhaDoPedido;
  await b.garantirAcesso(p.client_id);
  return b.json({ pedidos: [await consultarPedido(b, p)] });
}

/** Os pedidos em andamento do cliente (no máximo 6 por chamada, os mais antigos primeiro). */
export async function gerarStatusCliente(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const { data, error } = await b.servico().from("video_pedidos").select("*").eq("client_id", clientId).in("estado", ["enviado", "gerando", "baixando", "parcial"]).order("criado_em", { ascending: true }).limit(6);
  if (error) throw semSql(b, error);
  const saida: LinhaDoPedido[] = [];
  for (const p of (data || []) as LinhaDoPedido[]) saida.push(await consultarPedido(b, p));
  return b.json({ pedidos: saida });
}

// ------------------------------------------------------------------ cancelar (Runway e Higgsfield; frente V-C)

/**
 * Cancela no provedor as variações ainda na fila ou gerando (UMA chamada por
 * variação, sem repetir). Só Runway e Higgsfield deixam; nada é cobrado do
 * que foi cancelado. A Higgsfield só cancela o que ainda está na fila.
 */
export async function gerarCancelar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const id = String(corpo.pedido_id || "");
  if (!UUID.test(id)) throw b.erro(400, "pedido_id_invalido", "pedido_id precisa ser um UUID.");
  const { data, error } = await b.servico().from("video_pedidos").select("*").eq("id", id).maybeSingle();
  if (error) throw semSql(b, error);
  if (!data) throw b.erro(404, "pedido_inexistente", "Pedido não encontrado.");
  const p = data as LinhaDoPedido;
  await b.garantirAcesso(p.client_id);
  const c = await catalogo(b);
  const motor = motorPorId(p.executor, c.motores);
  const executor = motor ? executorDoProvedor(motor.provedor) : null;
  if (!motor || !executor || !executor.cancelar) throw b.erro(409, "cancelar_indisponivel", "Este provedor não cancela pela API. O pedido termina sozinho ou vence no prazo; erro não é cobrado.");
  const credenciais = credenciaisDoMotor(motor);
  const envios = ((p.resultado && p.resultado.envios) || []).slice();
  let cancelados = 0;
  for (const e of envios) {
    if (e.estado !== "enviado" && e.estado !== "gerando") continue;
    try {
      const ok = await executor.cancelar(refDoEnvio(e), credenciais);
      if (ok) {
        e.estado = "erro";
        e.erro = "Cancelado. Nada foi cobrado.";
        cancelados++;
      } else e.erro = "Já começou a gerar: não deu para cancelar.";
    } catch (err) {
      e.erro = err instanceof Error ? err.message : "Não deu para cancelar.";
    }
  }
  const estado = cancelados && envios.every((e) => e.estado === "erro") ? "cancelado" : estadoDoPedidoPelosEnvios(envios);
  const { data: salvo } = await b.servico().from("video_pedidos").update({ estado, resultado: { ...(p.resultado || {}), envios }, atualizado_em: new Date().toISOString() }).eq("id", p.id).select("*").single();
  await b.auditar("video_cancelar", { client_id: p.client_id, pedido_id: p.id, motor: motor.id, cancelados }, cancelados > 0, p.id);
  return b.json({ pedidos: [(salvo as LinhaDoPedido) || { ...p, estado, resultado: { envios } }], cancelados });
}

// ------------------------------------------------------------------ avatar falando (HeyGen; frente V-C)

const FORMATOS_DO_AVATAR = ["9:16", "16:9", "1:1", "4:5"];

/**
 * Roteiro vira pessoa falando (HeyGen). Quem fala: avatar de estoque ou a foto
 * principal de um CLONE da Mesa Foto, só com a autorização de imagem válida
 * (a mesma regra da Mesa Foto) e a confirmação de que ela cobre vídeo com voz
 * gerada por IA. Custo antes pela duração estimada da fala; cobra pela
 * duração real, até o valor confirmado. O pedido é "gerar_livre" com
 * alvo.modo "avatar" (sem SQL novo) e o vídeo cai nos Resultados.
 */
export async function avatarGerar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const fonte = corpo.fonte === "clone" ? "clone" : "estoque";
  const { motor } = await motorPronto(b, fonte === "clone" ? "heygen-foto" : "heygen-avatar-iv");
  const roteiro = String(corpo.roteiro || corpo.prompt || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!roteiro) throw b.erro(400, "roteiro_vazio", "Escreva o roteiro.");
  if (roteiro.length > ROTEIRO_MAX_CARACTERES) throw b.erro(400, "roteiro_longo", `Roteiro longo demais (até ${ROTEIRO_MAX_CARACTERES} letras por vídeo).`);
  const voz = linha(corpo.voz_id, 128).replace(/[^A-Za-z0-9_-]/g, "");
  if (!voz) throw b.erro(400, "voz_faltando", "Escolha a voz.");
  const formato = FORMATOS_DO_AVATAR.indexOf(String(corpo.formato)) >= 0 ? String(corpo.formato) : "9:16";
  const velocidade = Math.max(0.5, Math.min(1.5, numero(corpo.velocidade, 1)));
  const legendas = corpo.legendas === true;
  let avatarId: string | null = null;
  let fotoPath: string | null = null;
  let fotoUrl: string | null = null;
  let cloneId: string | null = null;
  if (fonte === "clone") {
    cloneId = String(corpo.clone_id || "");
    if (!UUID.test(cloneId)) throw b.erro(400, "clone_id_invalido", "Escolha o clone.");
    const { data: clone, error } = await b.servico().from("foto_modelos").select("id, client_id, origem, status, autorizacao, identidade_real").eq("id", cloneId).maybeSingle();
    if (error) throw b.erro(503, "clones_indisponivel", "Não foi possível ler o clone agora.");
    const liberado = cloneLiberadoParaVideo(clone as Record<string, unknown> | null, clientId);
    if (!liberado.ok) throw b.erro(422, "autorizacao_invalida", liberado.motivo || "Clone sem autorização de imagem válida.");
    if (corpo.confirma_uso_em_video !== true) throw b.erro(422, "confirmar_uso_em_video", "Confirme que a autorização desta pessoa cobre vídeo com voz gerada por IA.");
    const reais = Array.isArray((clone as { identidade_real?: unknown }).identidade_real) ? ((clone as { identidade_real: { imagem_id?: string; principal?: boolean }[] }).identidade_real) : [];
    const principal = reais.find((r) => r && r.principal) || reais[0];
    if (!principal || !UUID.test(String(principal.imagem_id || ""))) throw b.erro(409, "clone_sem_foto", "O clone não tem foto real principal.");
    const { data: img } = await b.servico().from("cliente_imagens").select("id, client_id, storage_bucket, storage_path, ativa").eq("id", String(principal.imagem_id)).maybeSingle();
    const foto = img as { client_id: string; storage_bucket: string | null; storage_path: string; ativa: boolean | null } | null;
    if (!foto || foto.client_id !== clientId || foto.ativa === false || !foto.storage_path) throw b.erro(409, "clone_sem_foto", "A foto principal do clone não está no acervo.");
    const { data: assinada, error: eAss } = await b.servico().storage.from(foto.storage_bucket || BUCKET).createSignedUrl(foto.storage_path, URL_PARA_O_PROVEDOR_S);
    if (eAss || !assinada || !assinada.signedUrl) throw b.erro(404, "arquivo_indisponivel", "A foto do clone não foi encontrada no armazenamento.");
    fotoPath = foto.storage_path;
    fotoUrl = assinada.signedUrl;
  } else {
    avatarId = linha(corpo.avatar_id, 128).replace(/[^A-Za-z0-9_-]/g, "");
    if (!avatarId) throw b.erro(400, "avatar_faltando", "Escolha o avatar.");
  }
  const duracao = duracaoEstimadaDaFala(roteiro, velocidade);
  const titulo = linha(corpo.titulo, 120) || "Avatar falando";
  const entrada: EntradaDaGeracao = {
    modo: "avatar",
    prompt: roteiro,
    duracao_s: duracao,
    formato,
    resolucao: linha(corpo.resolucao, 10) || null,
    audio: true,
    avatar: { tipo: fonte === "clone" ? "foto" : "estoque", avatar_id: avatarId, foto_url: fotoUrl, voz_id: voz, legendas, velocidade, locale: corpo.locale === "pt-BR" ? "pt-BR" : null, titulo },
  };
  const r = await enviarGeracao(b, {
    clientId,
    tipo: "gerar_livre",
    motor,
    entrada,
    // A foto do clone só entra como quadro inicial quando está no bucket da mesa (miniatura de reserva).
    caminhos: { quadro_inicial: fotoPath && fotoPath.indexOf(`${clientId}/`) === 0 ? fotoPath : null, quadro_final: null, referencias: [], video_arquivo_id: null },
    variacoes: 1,
    uid: linha(corpo.uid, 64),
    confirmado: corpo.custo_confirmado_usd,
    projetoId: UUID.test(String(corpo.projeto_id || "")) ? String(corpo.projeto_id) : null,
    planoRef: linha(corpo.plano_ref, 8) || null,
    titulo,
    // Nada de URL assinada no banco: só o que dá para auditar depois.
    extras: { avatar: { fonte, avatar_id: avatarId, clone_id: cloneId, foto_path: fotoPath, voz_id: voz, legendas, velocidade, duracao_estimada_s: duracao, confirma_uso_em_video: fonte === "clone" } },
  });
  return b.json(r);
}

/** Avatares de estoque ou vozes em português da HeyGen (listas grátis; a tela guarda por uma hora). */
export async function heygenCatalogo(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const tipo = corpo.tipo === "vozes" ? "vozes" : "avatares";
  const c = await catalogo(b);
  const m = motorPorId("heygen-avatar-iv", c.motores);
  if (!m) throw b.erro(409, "motor_a_integrar", "HeyGen fora do catálogo.");
  const faltam = chavesQueFaltam(m, temChave);
  if (faltam.length) throw b.erro(409, "motor_precisa_chave", `HeyGen: precisa de chave (${faltam.join(" e ")}).`, { estado: "precisa_chave", chave: faltam.join(", ") });
  const token = linha(corpo.token, 300) || null;
  try {
    const r = tipo === "vozes" ? await listarVozesDaHeygen(credenciaisDoMotor(m), token) : await listarAvataresDaHeygen(credenciaisDoMotor(m), token);
    return b.json({ tipo, itens: r.itens, proximo: r.proximo });
  } catch (e) {
    throw b.erro(502, "provedor_recusou", e instanceof Error ? e.message : "A HeyGen não respondeu.");
  }
}

// ------------------------------------------------------------------ sincronização do catálogo (semanal, desligada)

export async function motoresSincronizar(b: BaseDaFuncao) {
  const lista: { endpoint_id: string; status?: string | null }[] = [];
  const chave = (Deno.env.get("FAL_KEY") || "").trim();
  let completa = true;
  for (const categoria of ["image-to-video", "text-to-video", "video-to-video", "image-to-image"]) {
    let cursor = "";
    for (let pagina = 0; pagina < 8; pagina++) {
      const url = `https://api.fal.ai/v1/models?category=${categoria}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      let r: Response;
      try {
        r = await fetch(url, { headers: chave ? { Authorization: `Key ${chave}` } : {}, signal: AbortSignal.timeout(15_000) });
      } catch {
        completa = false;
        break;
      }
      if (!r.ok) {
        completa = false;
        break;
      }
      const j = (await r.json().catch(() => null)) as { models?: { endpoint_id: string; metadata?: { status?: string } }[]; next_cursor?: string | null; has_more?: boolean } | null;
      (j && j.models ? j.models : []).forEach((m) => lista.push({ endpoint_id: m.endpoint_id, status: m.metadata ? m.metadata.status : null }));
      if (!j || !j.has_more || !j.next_cursor) break;
      cursor = j.next_cursor;
    }
  }
  const c = await catalogo(b);
  const { novos, sumiram } = novidadesDoProvedor(lista, c.motores, completa && lista.length > 50);
  let gravados = 0;
  for (const n of novos) {
    const { error } = await b.servico().from("video_motores").upsert({ ...n, sincronizado_em: new Date().toISOString() }, { onConflict: "id", ignoreDuplicates: true });
    if (!error) gravados++;
  }
  for (const id of sumiram) {
    await b.servico().from("video_motores").upsert({ id, linha: (motorPorId(id) || { linha: "?" }).linha, versao: (motorPorId(id) || { versao: "?" }).versao, rotulo: (motorPorId(id) || { rotulo: id }).rotulo, endpoints: {}, preco: null, novo: false, disponivel: false, ativo: true, sincronizado_em: new Date().toISOString() }, { onConflict: "id" });
  }
  if (completa && lista.length > 50) {
    // Motor do código que voltou a aparecer na lista volta a ficar disponível.
    const voltaram = c.motores.filter((m) => m.provedor === "fal" && !m.situacao && sumiram.indexOf(m.id) < 0).map((m) => m.id);
    if (voltaram.length) await b.servico().from("video_motores").update({ disponivel: true, sincronizado_em: new Date().toISOString() }).in("id", voltaram).eq("disponivel", false);
  }
  return b.json({ ok: true, recebidos: lista.length, completa, novos: novos.map((n) => n.id), gravados, sumiram });
}
