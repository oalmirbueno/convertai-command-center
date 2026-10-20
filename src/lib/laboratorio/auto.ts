/**
 * "Clica, conecta e ele gera automático" (21/10): o nó que roda pode ter
 * `dados.auto`. Quando todas as entradas dele estão prontas (a última
 * execução de cada entrada que roda virou "pronto"; entrada que só guarda
 * dado conta como pronta) a tela pede no_executar { automatico: true }.
 *
 * Contra laço: dispara uma vez por mudança de entrada. A "assinatura" das
 * entradas (quem entra e qual execução de cada uma) só muda quando uma
 * entrada roda de novo ou uma ligação entra/sai; a mesma assinatura nunca
 * dispara duas vezes. Funções puras.
 */
import { TIPOS_DE_NO, type CanvasDoLab, type NoDoLab } from "./nos";
import type { ExecucaoDoLab } from "./api";

export type EstadoDoAuto = "desligado" | "aguardando" | "pronto" | "rodando" | "em_dia";

export const ehAuto = (no: NoDoLab | undefined | null): boolean => !!no && no.dados.auto === true && !!TIPOS_DE_NO[no.tipo] && TIPOS_DE_NO[no.tipo].roda;

const emAndamento = (s: string | undefined) => s === "na_fila" || s === "rodando" || s === "aguardando";

/** As entradas do nó, cada uma pronta ou não. */
export function entradasDoAuto(canvas: CanvasDoLab, execucoes: Record<string, ExecucaoDoLab | undefined>, noId: string): Array<{ id: string; pronta: boolean; execucao: string }> {
  return canvas.ligacoes
    .filter((l) => l.para === noId)
    .map((l) => canvas.nos.find((n) => n.id === l.de))
    .filter((n): n is NoDoLab => !!n)
    .map((n) => {
      if (!TIPOS_DE_NO[n.tipo] || !TIPOS_DE_NO[n.tipo].roda) return { id: n.id, pronta: true, execucao: "dado" };
      const e = execucoes[n.id];
      return { id: n.id, pronta: !!e && e.status === "pronto", execucao: e ? e.id : "" };
    });
}

/** Assinatura das entradas (muda quando uma entrada roda de novo ou uma ligação muda). */
export function assinaturaDasEntradas(canvas: CanvasDoLab, execucoes: Record<string, ExecucaoDoLab | undefined>, noId: string): string {
  return entradasDoAuto(canvas, execucoes, noId)
    .map((e) => `${e.id}:${e.execucao}`)
    .sort()
    .join("|");
}

/** O estado do automático no nó (para a pílula "Aguardando entradas"). */
export function estadoDoAuto(canvas: CanvasDoLab, execucoes: Record<string, ExecucaoDoLab | undefined>, noId: string): EstadoDoAuto {
  const no = canvas.nos.find((n) => n.id === noId);
  if (!ehAuto(no)) return "desligado";
  const proprio = execucoes[noId];
  if (proprio && emAndamento(proprio.status)) return "rodando";
  const entradas = entradasDoAuto(canvas, execucoes, noId);
  if (!entradas.length || entradas.some((e) => !e.pronta)) return "aguardando";
  // Já rodou depois da última entrada pronta: está em dia.
  if (proprio && proprio.status === "pronto") {
    const ultima = entradas.map((e) => (e.execucao && execucoes[e.id] ? execucoes[e.id]!.created_at || "" : "")).sort().pop() || "";
    if ((proprio.created_at || "") >= ultima) return "em_dia";
  }
  return "pronto";
}

/**
 * Os nós automáticos que devem rodar agora. `disparados` guarda a última
 * assinatura disparada de cada nó (é atualizado aqui). Na primeira leitura
 * (`base` = true) só registra o que já está no quadro, sem disparar: abrir o
 * projeto não roda nada sozinho.
 */
export function nosParaDisparar(canvas: CanvasDoLab, execucoes: Record<string, ExecucaoDoLab | undefined>, disparados: Record<string, string>, base = false): string[] {
  const saida: string[] = [];
  canvas.nos.forEach((n) => {
    if (!ehAuto(n)) {
      delete disparados[n.id];
      return;
    }
    const assinatura = assinaturaDasEntradas(canvas, execucoes, n.id);
    if (disparados[n.id] === assinatura) return;
    const estado = estadoDoAuto(canvas, execucoes, n.id);
    if (estado === "rodando" || estado === "aguardando") return;
    disparados[n.id] = assinatura;
    if (!base && estado === "pronto") saida.push(n.id);
  });
  return saida;
}
