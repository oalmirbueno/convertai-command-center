/**
 * Coleta, recuperação e o "o que falta" da Mesa Vídeos (frente VGN, 30/09/2026).
 *
 * Por que existe: nos dados reais, o único pedido enviado ao fal (28/09,
 * ângulo) foi aceito pelo provedor, consultado uma vez 38 s depois e nunca
 * mais: a consulta só acontecia com a tela aberta ou no botão "Conferir", e o
 * prazo encerrava o pedido sem perguntar ao provedor se ele tinha terminado.
 * Agora o cron coleta (1 min, só quando há pedido em andamento), o prazo só
 * encerra depois da última consulta e o que venceu pode ser recuperado.
 *
 * Puro: sem Deno e sem banco (a tela, a função e os testes usam).
 */

/** Até quantos dias depois do envio ainda vale perguntar ao provedor pelo resultado. */
export const DIAS_PARA_RECUPERAR = 7;

/** Os 7 dias contam sempre do envio ORIGINAL (enviado_em): Recuperar não renova a janela. */
export interface EnvioRecuperavel {
  estado: string;
  erro: string | null;
  request_id: string;
  /** Sem ela (envio antigo ou teste), vale o request_id; com ela, só https. */
  status_url?: string | null;
  arquivo_id: string | null;
  /** Sem ela, a janela de 7 dias não é conferida. */
  enviado_em?: string | null;
  /** Já cobrado: só volta o download que não foi guardado (baixa de novo sem cobrar outra vez). */
  uso_id?: string | null;
}

/** Os erros daqui (não do provedor) que ainda podem ter o resultado lá. */
const ERRO_RECUPERAVEL = /prazo|passou de \d+ h|sem resposta do provedor|saiu do catálogo|consulta|rede|não respondeu|não foi guardado/i;

/**
 * A variação pode ser recuperada ("Recuperar" da frente VGN e "Conferir de
 * novo" da frente MTR são a mesma regra)? Só a que o provedor ACEITOU (tem
 * número), não virou arquivo e parou AQUI: prazo antigo, teto de 24 h, consulta
 * sem resposta, motor fora do catálogo ou download que não foi guardado. Erro
 * dito pelo provedor (recusa, moderação, parâmetros) e cancelado não voltam:
 * gerar de novo é outra decisão, com custo confirmado. Já cobrada, só volta a
 * que não foi guardada (o uso está registrado: baixa de novo sem cobrar).
 */
export function podeRecuperar(e: EnvioRecuperavel, agora: number): boolean {
  if (!e || e.estado !== "erro" || e.arquivo_id || !String(e.request_id || "").trim()) return false;
  if (e.status_url && !/^https:\/\//.test(String(e.status_url))) return false;
  const t = Date.parse(String(e.enviado_em || ""));
  if (isFinite(t) && agora - t > DIAS_PARA_RECUPERAR * 24 * 3600_000) return false;
  const erro = String(e.erro || "");
  if (e.uso_id) return /não foi guardado/i.test(erro);
  return ERRO_RECUPERAVEL.test(erro);
}

export interface PedidoResumido {
  id: string;
  estado: string;
}

/** Quantos a coleta conferiu, quantos ficaram prontos e quantos viraram erro nesta rodada. */
export function resumoDaColeta(antes: PedidoResumido[], depois: PedidoResumido[]): { conferidos: number; prontos: number; erros: number } {
  let prontos = 0;
  let erros = 0;
  depois.forEach((d) => {
    const a = antes.find((x) => x.id === d.id);
    if (!a || a.estado === d.estado) return;
    if (d.estado === "pronto" || d.estado === "parcial") prontos++;
    else if (d.estado === "erro") erros++;
  });
  return { conferidos: depois.length, prontos, erros };
}

/**
 * Intervalo da próxima conferência pela tela aberta: começa em 20 s e vai
 * dobrando até 2 min (a coleta do cron cobre a tela fechada). Sem pedido em
 * andamento, não confere.
 */
export function proximaConferencia(tentativa: number, emAndamento: number): number | null {
  if (emAndamento <= 0) return null;
  const n = Math.max(0, Math.min(6, Math.floor(tentativa)));
  return Math.min(120_000, 20_000 * Math.pow(2, Math.min(n, 3)));
}

/**
 * O que falta para gerar, em uma frase para a tela (null = nada falta).
 * Ordem: chave do provedor (operação), motor, saldo da carteira do cliente.
 */
export function oQueFaltaParaGerar(e: { motorRotulo?: string | null; estado?: string | null; chave?: string | null; custoUsd: number | null; saldoUsd: number | null }): string | null {
  if (e.estado === "precisa_chave") return `${e.motorRotulo || "O motor"} precisa da chave ${e.chave || "do provedor"} no servidor (Supabase > Edge Functions > Secrets). Quem cuida da conta cadastra; a chave nunca vai para a tela.`;
  if (e.estado === "desligado") return `${e.motorRotulo || "O motor"} está desligado no catálogo.`;
  if (e.estado === "encerrado") return `${e.motorRotulo || "O motor"} foi encerrado pelo provedor.`;
  if (e.estado === "sem_preco") return `${e.motorRotulo || "O motor"} está sem preço conferido: não gera até ter o valor.`;
  if (typeof e.saldoUsd === "number" && typeof e.custoUsd === "number" && e.saldoUsd + 1e-9 < e.custoUsd) {
    const f = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;
    return `A carteira de IA do cliente tem ${f(e.saldoUsd)} e este vídeo custa ${f(e.custoUsd)}. Recarregue a carteira do cliente para gerar.`;
  }
  return null;
}
