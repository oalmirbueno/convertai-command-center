/** Continuação de uma confirmação, sem uma segunda cobrança e sem reexecutar peças prontas. */
import { ancestraisDe, type Canvas, ehExecutavel, type NoDoCanvas, ordemTopologica } from "./modulos/regras.ts";
import type { Reserva } from "./creditos.ts";
import { ErroHttp } from "./comum.ts";

export type AutorizacaoDaRodada = { assinatura: string; ator_id: string; reserva: Reserva | null; custo_usd: number; client_id?: string | null };
export type ExecucaoDaRodada = { id: string; no_id: string; status: string; saida: Record<string, unknown> | null; entrada: Record<string, unknown>; created_by: string | null };

/** Nenhum nó inicia até registrar a fila inteira; preparação parcial termina as filas já criadas. */
export async function prepararFilasDaRodada(ordem: string[], porta: { criar(noId: string): Promise<string>; abortar(execucaoIds: string[]): Promise<void> }): Promise<Record<string, string>> {
  const execucoes: Record<string, string> = {};
  try {
    for (const id of ordem) execucoes[id] = await porta.criar(id);
    return execucoes;
  } catch (erro) {
    const criadas = Object.values(execucoes);
    if (criadas.length) await porta.abortar(criadas);
    throw erro;
  }
}

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)]));
}

/** Mover/organizar o canvas não invalida a confirmação. Alterar conteúdo, modelos ou fios, sim. */
export async function assinaturaDoFluxo(canvas: Canvas, contexto: string | null = null, clientId: string | null = null): Promise<string> {
  const conteudo = canonico({ contexto, client_id: clientId, nos: canvas.nos.map((n) => ({ id: n.id, tipo: n.tipo, dados: n.dados })).sort((a, b) => a.id.localeCompare(b.id)), ligacoes: canvas.ligacoes.map((l) => ({ de: l.de, para: l.para, gatilho: l.gatilho || null })).sort((a, b) => `${a.de}:${a.para}`.localeCompare(`${b.de}:${b.para}`)) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(conteudo)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function assinaturaDoNo(canvas: Canvas, id: string, contexto: string | null = null, clientId: string | null = null): Promise<string> {
  const ids = new Set([id, ...ancestraisDe(canvas, id)]);
  return await assinaturaDoFluxo({ ...canvas, nos: canvas.nos.filter((n) => ids.has(n.id)), ligacoes: canvas.ligacoes.filter((l) => ids.has(l.de) && ids.has(l.para)) }, contexto, clientId);
}

/** Um nó estático no meio do caminho não elimina a dependência do gerador que o alimenta. */
export function dependenciasExecutaveis(canvas: Canvas, id: string): NoDoCanvas[] {
  const ids = new Set(ancestraisDe(canvas, id));
  return canvas.nos.filter((n) => ids.has(n.id) && ehExecutavel(n.tipo));
}

/** A mesma seleção alimenta a estimativa e a execução: nenhum ancestral pago fica escondido. */
export async function planoDaRodada(canvas: Canvas, alvos: string[] | null, ultimas: ExecucaoDaRodada[], contexto: string | null = null, clientId: string | null = null): Promise<{ ordem: string[]; reutilizados: ExecucaoDaRodada[]; ocupados: string[] }> {
  const todos = ordemTopologica(canvas, alvos).filter((id) => ehExecutavel(canvas.nos.find((n) => n.id === id)!.tipo));
  const escolhidos = new Set(alvos || []);
  const porNo = new Map(ultimas.map((e) => [e.no_id, e]));
  const ordem: string[] = [], reutilizados: ExecucaoDaRodada[] = [], ocupados: string[] = [];
  for (const id of todos) {
    const ultima = porNo.get(id);
    if (ultima && ["na_fila", "rodando", "aguardando"].includes(ultima.status)) { ocupados.push(id); continue; }
    if (alvos?.length && !escolhidos.has(id) && ultima) {
      const gravada = ultima.entrada?.assinatura_no;
      const mudou = typeof gravada === "string" && gravada !== await assinaturaDoNo(canvas, id, contexto, clientId);
      if (ultima.status === "pronto" && ultima.saida && !mudou) { reutilizados.push(ultima); continue; }
    }
    ordem.push(id);
  }
  return { ordem, reutilizados, ocupados };
}

export function autorizacaoDaExecucao(ex: ExecucaoDaRodada): AutorizacaoDaRodada | null {
  const a = ex.entrada.lab_rodada as Partial<AutorizacaoDaRodada> | undefined;
  if (!a || typeof a.assinatura !== "string" || typeof a.ator_id !== "string" || !Number.isFinite(a.custo_usd) || Number(a.custo_usd) < 0) return null;
  return a as AutorizacaoDaRodada;
}

export interface PortaDaContinuacao {
  /** Compare-and-set no banco: somente um acompanhamento pode assumir esta execução. */
  assumir(ex: ExecucaoDaRodada): Promise<boolean>;
  rodar(no: NoDoCanvas, ex: ExecucaoDaRodada, autorizacao: AutorizacaoDaRodada): Promise<{ status: string; saida: Record<string, unknown> | null }>;
  encerrar(ex: ExecucaoDaRodada, motivo: string, autorizacao: AutorizacaoDaRodada): Promise<void>;
}

/** Esta transição é exclusiva de uma dependência assumida que ainda não chamou nenhum executor. */
export async function encerrarDependenciaPersistida(porta: {
  salvarFim(): Promise<boolean>;
  reabrirEspera(): Promise<boolean>;
  estornar(): Promise<void>;
  incidente(erro: unknown): void;
}): Promise<void> {
  try {
    if (!await porta.salvarFim()) throw new Error("O encerramento não retornou a linha atualizada.");
  } catch (erro) {
    let recuperada = false;
    try { recuperada = await porta.reabrirEspera(); } catch { /* O incidente abaixo exige conferência, sem fingir cancelamento. */ }
    if (!recuperada) {
      porta.incidente(erro);
      throw new ErroHttp(503, "encerramento_pendente_incerto", "Não consegui confirmar o encerramento nem recuperar a espera desta etapa. Nenhum estorno foi solicitado. Confira a execução antes de tentar novamente.");
    }
    throw new ErroHttp(503, "encerramento_pendente_nao_salvo", "Não consegui salvar o encerramento. A etapa continua aguardando e nenhum estorno foi solicitado. Tente novamente.");
  }
  // Só o registro terminal confirmado libera o estorno e a resposta de cancelamento.
  await porta.estornar();
}

/** Só cancela trabalho ainda não iniciado. Pedidos externos/aprovações reais não têm este marcador. */
export async function cancelarPendentes(execucoes: ExecucaoDaRodada[], atorId: string, porta: Pick<PortaDaContinuacao, "assumir" | "encerrar">): Promise<string[]> {
  const canceladas: string[] = [];
  for (const ex of execucoes) {
    if (ex.status !== "aguardando" || ex.saida?.aguardando_dependencias !== true) continue;
    const a = autorizacaoDaExecucao(ex);
    if (!a || a.ator_id !== atorId || ex.created_by !== atorId || !await porta.assumir(ex)) continue;
    await porta.encerrar(ex, "Você cancelou esta etapa antes de ela começar. As peças anteriores continuam salvas e a parte reservada será devolvida.", a);
    ex.status = "erro";
    canceladas.push(ex.no_id);
  }
  return canceladas;
}

/** Só retoma os dependentes explicitamente reservados na confirmação original e pelo mesmo ator. */
export async function continuarRodada(canvas: Canvas, execucoes: ExecucaoDaRodada[], atorId: string, porta: PortaDaContinuacao, contexto: string | null = null, clientId: string | null = null): Promise<void> {
  const porNo = new Map(execucoes.map((e) => [e.no_id, e]));
  const pendentes = execucoes.filter((e) => e.status === "aguardando" && e.saida?.aguardando_dependencias === true);
  // Até N passagens para também consumir sucessores síncronos liberados nesta mesma chamada.
  for (let passo = 0; passo < execucoes.length && pendentes.length; passo++) {
    let mudou = false;
    for (const ex of pendentes.slice()) {
      const a = autorizacaoDaExecucao(ex);
      if (!a || a.ator_id !== atorId || ex.created_by !== atorId) continue;
      const no = canvas.nos.find((n) => n.id === ex.no_id);
      const antes = dependenciasExecutaveis(canvas, ex.no_id);
      const mudouFluxo = !no || a.assinatura !== await assinaturaDoNo(canvas, ex.no_id, contexto, clientId);
      const falhou = antes.some((n) => porNo.get(n.id)?.status === "erro");
      if (!mudouFluxo && !falhou && antes.some((n) => porNo.get(n.id)?.status !== "pronto")) continue;
      if (!await porta.assumir(ex)) { pendentes.splice(pendentes.indexOf(ex), 1); continue; }
      mudou = true;
      pendentes.splice(pendentes.indexOf(ex), 1);
      if (mudouFluxo || falhou) {
        const motivo = mudouFluxo ? "O conteúdo ou as conexões mudaram. Confirme uma nova execução; esta parte não foi gerada e o valor reservado será devolvido." : "Um nó anterior falhou. Esta parte não foi gerada e o valor reservado será devolvido.";
        await porta.encerrar(ex, motivo, a);
        ex.status = "erro";
      } else {
        const r = await porta.rodar(no!, ex, a);
        ex.status = r.status;
        ex.saida = r.saida;
      }
    }
    if (!mudou) break;
  }
}
