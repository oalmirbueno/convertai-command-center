/**
 * Estado do canal em tempo real dos avisos (EX-07, 30/09), dividido pela
 * lista do sino (useNotifications) e pela contagem de não lidas
 * (useContagemDeNaoLidas). Quem liga e desliga é useAvisosEmTempoReal.
 *
 * Com o canal de pé, cada aviso novo chega em meio segundo; o intervalo vira
 * só a rede de segurança e passa a 5 min. Canal caído, ainda não conectado
 * ou sem suporte: 30 s, como antes. Eram as duas leituras mais frequentes do
 * painel (24 h de 29/09: 1.227 GET e 1.232 HEAD em notifications, para 92
 * avisos criados).
 */

export const INTERVALO_COM_CANAL_MS = 5 * 60_000;
export const INTERVALO_SEM_CANAL_MS = 30_000;

let vivo = false;

export function canalDosAvisosVivo(): boolean {
  return vivo;
}

export function marcarCanalDosAvisos(estado: boolean) {
  vivo = estado;
}

/** Intervalo das leituras do sino agora (é relido depois de cada leitura). */
export function intervaloDosAvisos(): number {
  return vivo ? INTERVALO_COM_CANAL_MS : INTERVALO_SEM_CANAL_MS;
}
