/**
 * O preset de consulta que se mantém sozinha em dia.
 *
 * Parte do que o painel mostra é escrita POR FORA dele: a rotina do GPT grava
 * o dossiê pelo MCP, o agente externo registra memória, outra pessoa mexe em
 * outra máquina. Nesses casos nenhuma mutação do app acontece, então nada
 * invalida o cache — e a tela fica mostrando o que leu quando abriu, sem
 * nenhum sinal de que envelheceu.
 *
 * `refetchOnWindowFocus` é o que mais importa neste fluxo, e não o intervalo:
 * quem atualiza o dossiê no ChatGPT volta para a aba do painel logo depois, e
 * é esse retorno que dispara a releitura — sem esperar o relógio.
 *
 * Vive em um arquivo só porque a mesma regra repetida em telas diferentes foi
 * exatamente o que fez a mensagem do Ciclo ficar meses lendo o campo errado
 * enquanto a Central já lia o certo.
 */

/** Intervalo padrão. Curto o bastante para parecer vivo, longo para não pesar. */
export const INTERVALO_AO_VIVO = 20_000;

export const AO_VIVO = {
  refetchInterval: INTERVALO_AO_VIVO,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;

/**
 * Para o que muda menos, mas ainda precisa se atualizar sozinho — dossiê,
 * contexto do cliente. O retorno à aba continua sendo instantâneo.
 */
export const AO_VIVO_CALMO = {
  refetchInterval: 60_000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;
