/**
 * Guardas do Gerenciador ao vivo que moram no banco (FN-04, 30/09/2026).
 *
 * As guardas em memória da mesa-ads ("grava uma leitura a cada 10 min" e
 * "Atualizar agora no máximo a cada 15 s") quase nunca valiam: cada pedido
 * sobe uma instância nova da função e a memória some ao terminar. Nos 7 dias
 * até 30/09, 20 das 33 leituras não forçadas foram gravadas a menos de 10 min
 * da anterior (mediana de 2 min, a releitura da tela). Aqui a pergunta vai à
 * tabela ads_gerenciador_leituras, pelo índice (client_id, lido_em desc).
 *
 * Nunca lança: consulta que falha devolve `recente: false` com o erro, e quem
 * chama segue como antes (grava ou relê) e registra o erro no log.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ErroDaGuarda = { code?: string; message?: string };
export type ResultadoDaGuarda = { recente: boolean; erro: ErroDaGuarda | null };

/**
 * Há leitura gravada deste cliente (qualquer uma, ou só as forçadas) com
 * lido_em dentro da janela? Sem linha: não. Falha na consulta: não, com o erro.
 */
export async function leituraGravadaRecente(
  servico: SupabaseClient,
  clientId: string,
  janelaMs: number,
  agora: number,
  soForcadas = false,
): Promise<ResultadoDaGuarda> {
  try {
    let consulta = servico.from("ads_gerenciador_leituras").select("lido_em").eq("client_id", clientId);
    if (soForcadas) consulta = consulta.eq("forcada", true);
    const { data, error } = await consulta.order("lido_em", { ascending: false }).limit(1).maybeSingle();
    if (error) return { recente: false, erro: { code: error.code, message: error.message } };
    const lido = data && typeof (data as { lido_em?: unknown }).lido_em === "string" ? Date.parse((data as { lido_em: string }).lido_em) : NaN;
    return { recente: Number.isFinite(lido) && agora - lido < janelaMs, erro: null };
  } catch (e) {
    return { recente: false, erro: { message: e instanceof Error ? e.message : String(e) } };
  }
}
