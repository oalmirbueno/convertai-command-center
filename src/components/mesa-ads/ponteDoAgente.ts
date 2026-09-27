import { apagarEstadoDaTela, gravarEstadoDaTela, lerEstadoDaTela } from "@/components/sistema/useEstadoDaTela";

/**
 * "Enviar ao agente sênior de tráfego" (dono, 27/09: "quando manda pro plano
 * de teste ter a opção enviar ao agente sênior e ali ele já assumir"). O
 * Plano de teste deixa o plano aqui e abre a aba Conta; a aba Conta pega uma
 * vez (some ao pegar) e o agente sênior assume sozinho. Vale 10 minutos:
 * clique esquecido não dispara depois. Fica no navegador (useEstadoDaTela),
 * sob a rota fixa da Mesa Ads, por cliente.
 */

const ROTA = "/mesa-ads";
const VALIDADE_MS = 10 * 60_000;
const chave = (clientId: string) => `mesa-ads:ponte-do-plano:${clientId}`;

export interface PlanoParaOAgente {
  plano_id: string;
  nome: string;
  em: number;
}

const valido = (v: unknown) => {
  const o = v as PlanoParaOAgente | null;
  return !!o && typeof o === "object" && typeof o.plano_id === "string" && !!o.plano_id && typeof o.em === "number";
};

export function deixarPlanoParaOAgente(clientId: string, planoId: string, nome: string, agora = Date.now()) {
  gravarEstadoDaTela<PlanoParaOAgente>(chave(clientId), { plano_id: planoId, nome: nome || "Plano de teste", em: agora }, ROTA);
}

/** Olha o plano deixado, sem tirar (para o estado inicial da tela; quem usa tira com esquecerPlanoParaOAgente). */
export function verPlanoParaOAgente(clientId: string, agora = Date.now()): PlanoParaOAgente | null {
  const v = lerEstadoDaTela<PlanoParaOAgente | null>(chave(clientId), null, valido, ROTA);
  if (!v) return null;
  return agora - v.em >= 0 && agora - v.em < VALIDADE_MS ? v : null;
}

export function esquecerPlanoParaOAgente(clientId: string) {
  apagarEstadoDaTela(chave(clientId), ROTA);
}

/** Pega o plano deixado (uma vez só) se ainda estiver no prazo. */
export function pegarPlanoParaOAgente(clientId: string, agora = Date.now()): PlanoParaOAgente | null {
  const v = verPlanoParaOAgente(clientId, agora);
  esquecerPlanoParaOAgente(clientId);
  return v;
}
