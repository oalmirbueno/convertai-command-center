/**
 * Canal entre um worker e o Aceleriq Motores (frente SUP, 01/10/2026).
 *
 * O supervisor sobe cada worker com um canal IPC e ACELERIQ_SUPERVISOR=1. Por
 * ele o worker avisa quando pega um trabalho ("ocupado") e quando volta a olhar
 * a fila ("ocioso"), e recebe o pedido de parada limpa ("parar"): termina o que
 * está fazendo e sai. Assim o supervisor nunca derruba um "construir" no meio,
 * e só troca de versão com todos ociosos.
 *
 * Rodando na janela antiga (ligar-*.cmd, sem supervisor), tudo aqui é inerte.
 * Sem dependência: os três workers importam por caminho relativo.
 */

export type MensagemDoWorker =
  | { tipo: "pronto"; motor: string; versao: string }
  | { tipo: "ocupado"; id: string | null }
  | { tipo: "ocioso" }
  | { tipo: "parando" };

export type MensagemDoSupervisor = { tipo: "parar" };

type ProcessoComCanal = Pick<NodeJS.Process, "on" | "env"> & {
  send?: (m: unknown) => boolean;
  connected?: boolean;
  disconnect?: () => void;
};

/** Este processo foi aberto pelo Aceleriq Motores (e o canal está de pé)? */
export function comSupervisor(p: ProcessoComCanal = process): boolean {
  return typeof p.send === "function" && p.env.ACELERIQ_SUPERVISOR === "1" && p.connected !== false;
}

/** Avisa o supervisor. Nunca lança: o canal fechado não pode derrubar um trabalho. */
export function avisarSupervisor(m: MensagemDoWorker, p: ProcessoComCanal = process): void {
  if (!comSupervisor(p)) return;
  try {
    p.send!(m);
  } catch {
    /* supervisor saiu: o aviso some, o trabalho segue */
  }
}

/**
 * Chama `fn` uma vez quando o supervisor pede parada limpa ou quando o canal
 * cai (supervisor fechado): o worker termina o que faz e sai, sem trabalho órfão.
 */
export function aoPedirParada(fn: () => void, p: ProcessoComCanal = process): void {
  if (!comSupervisor(p)) return;
  let chamado = false;
  const uma = () => {
    if (chamado) return;
    chamado = true;
    avisarSupervisor({ tipo: "parando" }, p);
    fn();
  };
  p.on("message", (m: unknown) => {
    if (m && typeof m === "object" && (m as { tipo?: unknown }).tipo === "parar") uma();
  });
  p.on("disconnect", uma);
}

/** Fecha o canal no fim do worker (sem isso o processo ficaria preso ao IPC). */
export function encerrarCanal(p: ProcessoComCanal = process): void {
  try {
    if (comSupervisor(p) && typeof p.disconnect === "function") p.disconnect();
  } catch {
    /* já fechado */
  }
}

/**
 * Espera que acorda antes da hora quando a parada é pedida (o worker ocioso não
 * fica 15 s parado depois do "parar"). Devolve uma função de espera e o "acordar".
 */
export function esperaQueAcorda(): { esperar: (ms: number) => Promise<void>; acordar: () => void } {
  let acordar: (() => void) | null = null;
  let acordado = false;
  return {
    esperar: (ms: number) =>
      acordado
        ? Promise.resolve()
        : new Promise<void>((resolver) => {
            const t = setTimeout(() => {
              acordar = null;
              resolver();
            }, ms);
            acordar = () => {
              clearTimeout(t);
              acordar = null;
              resolver();
            };
          }),
    acordar: () => {
      acordado = true;
      if (acordar) acordar();
    },
  };
}
