import type { ModeloIa } from "@/lib/mesa/api";
import type { UsoDoAgente } from "@/lib/config/chavesECustos";

/**
 * Custo estimado por semana ao trocar o modelo padrão de um papel (frente CHV,
 * 01/10/2026; pedido do dono: "mostrar o custo estimado por semana antes de
 * confirmar"). A base é o uso real dos últimos 7 dias do agente daquele papel
 * (ia_usos: tokens e imagens), repreçado com a tabela do modelo novo.
 * É estimativa: o volume da próxima semana pode ser outro.
 */

/** O agente do registro de uso para cada papel (quando o nome não é o mesmo). */
export const AGENTE_DO_PAPEL: Record<string, string> = {
  imagem: "gerador_imagem",
  leitura: "leitor",
  estrategista_rapido: "estrategista",
};

export const agenteDoPapel = (papel: string) => AGENTE_DO_PAPEL[papel] || papel;

export function usoDoPapel(agentes: UsoDoAgente[] | undefined, papel: string): UsoDoAgente | null {
  if (!agentes) return null;
  const alvo = agenteDoPapel(papel);
  return agentes.find((a) => a.agente === alvo) || null;
}

const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);

/** US$ por semana com o modelo, pelo volume da última semana. null quando o preço não é conhecido. */
export function custoSemanalCom(uso: UsoDoAgente | null, modelo: ModeloIa | null): number | null {
  if (!uso || !modelo) return null;
  if (modelo.tipo === "imagem") {
    const tabela = modelo.preco_imagem || {};
    const preco = tabela.media ?? tabela.baixa ?? tabela.alta;
    return typeof preco === "number" ? Math.round(n(uso.imagens) * preco * 10000) / 10000 : null;
  }
  if (modelo.preco_entrada_1m === null && modelo.preco_saida_1m === null) return null;
  // Sem desconto de cache: a estimativa fica do lado de cima (nunca promete menos do que custa).
  const usd = (n(uso.tokens_entrada) * n(modelo.preco_entrada_1m) + n(uso.tokens_saida) * n(modelo.preco_saida_1m)) / 1_000_000;
  return Math.round(usd * 10000) / 10000;
}
