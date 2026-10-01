/**
 * Executor da Runway (frente V-C, 26/09/2026). Docs: docs.dev.runwayml.com
 * (OpenAPI versão 2024-11-06; resumo em docs/video/PESQUISA-GERADOR.md, seção 9).
 *
 *   enviar:    POST https://api.dev.runwayml.com/v1/image_to_video | text_to_video
 *              Authorization: Bearer <RUNWAYML_API_SECRET>, X-Runway-Version: 2024-11-06
 *              -> { id }
 *   consultar: GET  /v1/tasks/{id} -> { status: PENDING | THROTTLED | RUNNING | SUCCEEDED | FAILED | CANCELLED, progress, output[], failureCode }
 *   cancelar:  DELETE /v1/tasks/{id} (204; 404 = já não existe)
 *
 * O link do vídeo pronto vence em 24 a 48 h: o resultado busca a tarefa de
 * novo (link novo) e a função guarda no Storage na hora.
 * Entrada por URL: HTTPS, com HEAD, Content-Type e Content-Length certos, sem
 * redirecionamento; imagem até 16 MB, proporção entre 0,5 e 2.
 * SEM LAÇO: uma chamada por função, nenhuma nova tentativa.
 */

import { duracaoNoMotor, type MotorDeVideo } from "./modelos-de-video.ts";
import type { EntradaDaGeracao } from "./video-executor.ts";
import {
  type Credenciais,
  detalheDoCorpo,
  type EnviadoAoProvedor,
  ErroDoProvedor,
  type ExecutorDoProvedor,
  fraseDoErro,
  idDoPedidoSeguro,
  pedirJson,
  type RefDoEnvio,
  type ResultadoDoProvedor,
  semVazios,
  type SituacaoNoProvedor,
  soHttps,
} from "./video-provedor-comum.ts";

export const RUNWAY_BASE = "https://api.dev.runwayml.com";
export const RUNWAY_VERSAO = "2024-11-06";
export const RUNWAY_CHAVE = "RUNWAYML_API_SECRET";
const NOME = "A Runway";

/** Rotas que a mesa usa (lista fechada: nada fora dela vai com a chave). */
// Frente TCN (01/10): video_to_video (Aleph 2) para a troca de cenário.
export const ROTAS_DA_RUNWAY = ["image_to_video", "text_to_video", "video_to_video"];

/** Proporção da Runway (largura:altura) por formato da mesa. Imagem para vídeo (Gen-4.5 e Gen-4 Turbo). */
export const PROPORCOES_DA_RUNWAY_IMAGEM: Record<string, string> = { "9:16": "720:1280", "16:9": "1280:720", "1:1": "960:960", "4:5": "832:1104" };
/** Texto para vídeo do Gen-4.5: só deitado ou em pé. */
export const PROPORCOES_DA_RUNWAY_TEXTO: Record<string, string> = { "9:16": "720:1280", "16:9": "1280:720" };

/** O que falta para a Runway aceitar (null = pode). */
export function faltaNaRunway(m: MotorDeVideo, e: Pick<EntradaDaGeracao, "modo" | "formato" | "prompt">): string | null {
  const tabela = e.modo === "texto" ? PROPORCOES_DA_RUNWAY_TEXTO : PROPORCOES_DA_RUNWAY_IMAGEM;
  if (!tabela[e.formato]) return `${m.rotulo} ${e.modo === "texto" ? "pelo texto só faz 9:16 ou 16:9" : `não faz ${e.formato}`}.`;
  if (e.modo !== "texto" && e.modo !== "primeiro_quadro") return `${m.rotulo} só gera pelo texto ou a partir do primeiro quadro.`;
  return null;
}

/** Corpo do pedido no formato da Runway (promptText até 1000 letras). */
export function corpoDaRunway(m: MotorDeVideo, e: EntradaDaGeracao): Record<string, unknown> {
  const falta = faltaNaRunway(m, e);
  if (falta) throw new Error(falta);
  const texto = e.modo === "texto";
  const ratio = (texto ? PROPORCOES_DA_RUNWAY_TEXTO : PROPORCOES_DA_RUNWAY_IMAGEM)[e.formato];
  const seed = typeof e.seed === "number" && isFinite(e.seed) ? Math.max(0, Math.min(4294967295, Math.floor(e.seed))) : undefined;
  const camera = e.camera ? ` Camera: ${String(e.camera).replace(/-/g, " ")}.` : "";
  return semVazios({
    model: m.modelo,
    promptText: `${String(e.prompt || "").trim()}${camera}`.slice(0, 1000),
    promptImage: texto ? undefined : [{ uri: e.quadro_inicial_url, position: "first" }],
    ratio,
    duration: duracaoNoMotor(m, e.duracao_s),
    seed,
    contentModeration: { publicFigureThreshold: "auto" },
  });
}

const cabecalhos = (c: Credenciais, json = true): Record<string, string> => {
  const h: Record<string, string> = { Authorization: `Bearer ${c.chave}`, "X-Runway-Version": RUNWAY_VERSAO };
  if (json) h["Content-Type"] = "application/json";
  return h;
};

/** Erro HTTP da Runway em frase clara. */
export function erroDaRunway(status: number, corpo: Record<string, unknown> | null): ErroDoProvedor {
  const d = detalheDoCorpo(corpo);
  if (status === 401 || status === 403) return new ErroDoProvedor("chave_invalida", fraseDoErro("chave_invalida", NOME, RUNWAY_CHAVE), status);
  if (status === 402 || status === 412 || /credit|saldo|balance/i.test(d)) return new ErroDoProvedor("sem_credito", fraseDoErro("sem_credito", "Runway", RUNWAY_CHAVE), status);
  if (status === 429) return new ErroDoProvedor("limite_de_uso", fraseDoErro("limite_de_uso", NOME, RUNWAY_CHAVE, d || "limite de gerações ao mesmo tempo ou do dia"), status);
  if (status === 400 || status === 422) {
    if (/moderat|safety|public figure/i.test(d)) return new ErroDoProvedor("conteudo_recusado", fraseDoErro("conteudo_recusado", NOME, RUNWAY_CHAVE, d), status);
    return new ErroDoProvedor("parametros", fraseDoErro("parametros", NOME, RUNWAY_CHAVE, d), status);
  }
  if (status >= 500) return new ErroDoProvedor("indisponivel", fraseDoErro("indisponivel", NOME, RUNWAY_CHAVE), status);
  return new ErroDoProvedor("provedor", fraseDoErro("provedor", "Runway", RUNWAY_CHAVE, `${status}${d ? ` ${d}` : ""}`), status);
}

/** Motivo da falha da tarefa (failureCode da Runway) em frase clara. */
export function motivoDaFalhaDaRunway(codigo: unknown, falha: unknown): string {
  const c = String(codigo || "");
  const f = String(falha || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (/^SAFETY\./.test(c) || /^INPUT_PREPROCESSING\.SAFETY/.test(c)) return `A Runway recusou o conteúdo (moderação)${f ? `: ${f}` : ""}. Nada foi cobrado do cliente.`;
  if (c === "ASSET.INVALID") return "A Runway não aceitou a imagem de entrada (formato, tamanho ou proporção entre 0,5 e 2).";
  if (/^INTERNAL\.BAD_OUTPUT/.test(c)) return "A Runway descartou o resultado (texto ou logo no quadro). Ajuste o texto e gere de novo.";
  if (c === "THIRD_PARTY.UNAVAILABLE") return "Serviço de terceiro da Runway indisponível. Gere de novo mais tarde.";
  return `Falha na Runway${f ? `: ${f}` : ""}. Gere de novo mais tarde.`;
}

/** Lê a tarefa da Runway. */
export function lerTarefaDaRunway(corpo: Record<string, unknown> | null): SituacaoNoProvedor {
  const s = String((corpo && corpo.status) || "");
  const progresso = corpo && typeof corpo.progress === "number" ? Math.max(0, Math.min(1, corpo.progress as number)) : null;
  if (s === "PENDING" || s === "THROTTLED") return { estado: "fila", posicao: null, erro: null, progresso: null };
  if (s === "RUNNING") return { estado: "gerando", posicao: null, erro: null, progresso };
  if (s === "SUCCEEDED") {
    const saida = Array.isArray(corpo && corpo.output) ? ((corpo as { output: unknown[] }).output).map(soHttps).filter(Boolean) : [];
    return saida.length ? { estado: "pronto", posicao: null, erro: null, progresso: 1 } : { estado: "erro", posicao: null, erro: "A Runway terminou sem devolver o vídeo." };
  }
  if (s === "FAILED") return { estado: "erro", posicao: null, erro: motivoDaFalhaDaRunway(corpo && corpo.failureCode, corpo && corpo.failure) };
  if (s === "CANCELLED") return { estado: "erro", posicao: null, erro: "Cancelado na Runway. Nada foi cobrado." };
  return { estado: "erro", posicao: null, erro: s ? `Situação desconhecida na Runway: ${s}` : "A Runway não disse a situação." };
}

const urlDaTarefa = (id: string) => `${RUNWAY_BASE}/v1/tasks/${encodeURIComponent(id)}`;

/** Envia UMA tarefa. Não repete. */
export async function enviarNaRunway(endpoint: string, corpo: Record<string, unknown>, c: Credenciais): Promise<EnviadoAoProvedor> {
  if (!c.chave) throw new ErroDoProvedor("chave_invalida", `Falta a chave da Runway (${RUNWAY_CHAVE}).`);
  if (ROTAS_DA_RUNWAY.indexOf(endpoint) < 0) throw new ErroDoProvedor("parametros", "Rota da Runway fora da lista.");
  const r = await pedirJson(c.fetchImpl || fetch, `${RUNWAY_BASE}/v1/${endpoint}`, { method: "POST", headers: cabecalhos(c), body: JSON.stringify(corpo) });
  if (r.status < 200 || r.status >= 300 || !r.corpo) throw erroDaRunway(r.status, r.corpo);
  const id = idDoPedidoSeguro(r.corpo.id);
  if (!id) throw new ErroDoProvedor("provedor", "A Runway não devolveu o número da tarefa.");
  return { request_id: id, status_url: urlDaTarefa(id), response_url: urlDaTarefa(id) };
}

async function lerTarefa(e: RefDoEnvio, c: Credenciais): Promise<{ status: number; corpo: Record<string, unknown> | null }> {
  const id = idDoPedidoSeguro(e.request_id);
  if (!id) throw new ErroDoProvedor("parametros", "Número da tarefa da Runway inválido.");
  return await pedirJson(c.fetchImpl || fetch, urlDaTarefa(id), { method: "GET", headers: cabecalhos(c, false) });
}

/**
 * UMA consulta. Tarefa que sumiu (404) vira erro definitivo; limite, chave e
 * falha passageira sobem como erro (o envio continua e a próxima consulta,
 * pedida pela tela, tenta de novo).
 */
export async function consultarNaRunway(e: RefDoEnvio, c: Credenciais): Promise<SituacaoNoProvedor> {
  const r = await lerTarefa(e, c);
  if (r.status === 404) return { estado: "erro", posicao: null, erro: "A tarefa não existe mais na Runway (cancelada ou apagada). Nada foi cobrado." };
  if (r.status < 200 || r.status >= 300) throw erroDaRunway(r.status, r.corpo);
  return lerTarefaDaRunway(r.corpo);
}

/** Busca a tarefa de novo e devolve o link novo do vídeo. */
export async function resultadoDaRunway(e: RefDoEnvio, c: Credenciais): Promise<ResultadoDoProvedor> {
  const r = await lerTarefa(e, c);
  if (r.status < 200 || r.status >= 300) throw erroDaRunway(r.status, r.corpo);
  const saida = Array.isArray(r.corpo && r.corpo.output) ? ((r.corpo as { output: unknown[] }).output).map(soHttps).filter(Boolean) : [];
  if (String((r.corpo && r.corpo.status) || "") !== "SUCCEEDED" || !saida.length) throw new ErroDoProvedor("provedor", "A Runway ainda não tem o vídeo pronto.");
  return { tipo: "video", urls: saida };
}

/** Cancela a tarefa (na fila ou gerando). true = cancelada ou já não existia. */
export async function cancelarNaRunway(e: RefDoEnvio, c: Credenciais): Promise<boolean> {
  const id = idDoPedidoSeguro(e.request_id);
  if (!id) return false;
  const r = await pedirJson(c.fetchImpl || fetch, urlDaTarefa(id), { method: "DELETE", headers: cabecalhos(c, false) });
  if (r.status === 204 || r.status === 200 || r.status === 404) return true;
  throw erroDaRunway(r.status, r.corpo);
}

export const EXECUTOR_DA_RUNWAY: ExecutorDoProvedor = {
  provedor: "runway",
  rotulo: "Runway",
  enviar: (endpoint, corpo, c) => enviarNaRunway(endpoint, corpo, c),
  consultar: consultarNaRunway,
  resultado: resultadoDaRunway,
  cancelar: cancelarNaRunway,
};
