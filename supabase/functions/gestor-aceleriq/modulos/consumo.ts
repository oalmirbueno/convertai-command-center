/**
 * Gasto de uma conversa do Gestor (15/10/2026, dono: "a soma de quanto estou
 * gastando por conversa e quantos tokens, para saber o valor").
 *
 * Fonte: ia_usos marcados com referencia_tipo = "gestor_conversa" e o id da
 * conversa (modelo e Jev, a partir desta versão). Respostas de antes não têm a
 * marca: entram só pelo custo_usd do modelo gravado na mensagem ("antes_usd"),
 * sem tokens, e a tela diz isso. Nada é estimado.
 */

export type UsoDaConversa = {
  id: string;
  agente: string;
  modelo_id: string;
  tokens_entrada: number | string | null;
  tokens_saida: number | string | null;
  tokens_cache: number | string | null;
  custo_usd: number | string | null;
};

export type ConsumoDaConversa = {
  total_usd: number;
  tokens: number;
  modelos: Array<{ id: string; rotulo: string; chamadas: number; entrada: number; saida: number; cache: number; usd: number }>;
  conferencia: { chamadas: number; tokens: number; usd: number };
  antes_usd: number;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const arred = (v: number) => Math.round(v * 1e6) / 1e6;

export function somarConsumo(
  usos: UsoDaConversa[],
  respostas: Array<{ uso_id: string | null; custo_usd: number | string | null }>,
  rotulos: Record<string, string> = {},
): ConsumoDaConversa {
  const marcados = new Set(usos.map((u) => u.id));
  const porModelo = new Map<string, ConsumoDaConversa["modelos"][number]>();
  const conferencia = { chamadas: 0, tokens: 0, usd: 0 };
  for (const u of usos) {
    if (u.agente === "jev") {
      conferencia.chamadas += 1;
      conferencia.tokens += num(u.tokens_entrada) + num(u.tokens_saida);
      conferencia.usd += num(u.custo_usd);
      continue;
    }
    const m = porModelo.get(u.modelo_id) || { id: u.modelo_id, rotulo: rotulos[u.modelo_id] || u.modelo_id.replace(/^[^:]+:\s*/, ""), chamadas: 0, entrada: 0, saida: 0, cache: 0, usd: 0 };
    m.chamadas += 1;
    m.entrada += num(u.tokens_entrada);
    m.saida += num(u.tokens_saida);
    m.cache += num(u.tokens_cache);
    m.usd += num(u.custo_usd);
    porModelo.set(u.modelo_id, m);
  }
  // Resposta de antes da marca: o custo do modelo gravado na mensagem, sem contar duas vezes a que já tem uso marcado.
  const antes = respostas.filter((r) => !r.uso_id || !marcados.has(r.uso_id)).reduce((t, r) => t + num(r.custo_usd), 0);
  const modelos = [...porModelo.values()].map((m) => ({ ...m, usd: arred(m.usd) })).sort((a, b) => b.usd - a.usd);
  const tokens = modelos.reduce((t, m) => t + m.entrada + m.saida, 0);
  const total = modelos.reduce((t, m) => t + m.usd, 0) + conferencia.usd + antes;
  return {
    total_usd: arred(total),
    tokens,
    modelos,
    conferencia: { ...conferencia, usd: arred(conferencia.usd) },
    antes_usd: arred(antes),
  };
}
