/**
 * Sincronia entre as mesas (frente SYNC, 30/09/2026): o que é decidido ou
 * aprovado numa mesa passa a alimentar as outras.
 *
 * Pedido do dono: "tudo é sincronizado 100%, e aprende e evolui também".
 *
 * O caminho de cada coisa:
 * - estratégia e identidade aprovadas na Mesa Identidade viram kit e
 *   contexto da marca: sugestão com Confirmar e Desfazer campo a campo
 *   (mesa-identidade/brandbook-acoes.ts, kit_contexto, regras em
 *   contexto-completo-regras.ts). Enquanto não vira contexto, a estratégia
 *   aprovada já entra no pacote que todo agente lê (tom e tagline no Mês, na
 *   Proposta e no Site);
 * - o briefing recebido entra no pacote de todo agente (o mais novo da
 *   marca, o respondido primeiro);
 * - a decisão do conselho entra no cérebro do cliente (agente_memoria, área
 *   geral, fonte "conselho"): o "Decidir" do dono é o Confirmar e o
 *   "Desfazer decisão" tira a linha (ativa=false, o histórico fica). Daqui;
 * - a regra aprendida numa mesa que o dono disse valer "em todas" vai para a
 *   área geral com "alcance:todas" (aprendizado-das-mesas.ts) e passa a
 *   valer em todas as mesas.
 *
 * O banco e o julgamento chegam por parâmetro: roda no vitest. Nunca lança.
 * Sem travessão.
 */

import type { BancoDoCerebro, JulgarAprendizado } from "./cerebro-do-cliente.ts";
import { gravarNoCerebro } from "./cerebro-nas-mesas.ts";
import { registrarFalha } from "./falha-registrada.ts";
import { esquecerContextoCompleto } from "./contexto-completo-da-marca.ts";
import { PREFIXO_DA_DECISAO_DO_CONSELHO } from "./contexto-completo-regras.ts";

/** Fonte da decisão do conselho no cérebro (a tela mostra "Decisões do conselho"). */
export const FONTE_DA_DECISAO_DO_CONSELHO = "conselho";
export const PREFIXO_DA_DECISAO = PREFIXO_DA_DECISAO_DO_CONSELHO;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limpa = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** O texto da decisão como aprendizado (curto: o cérebro corta em 600). */
export function textoDaDecisao(tema: string, resumo: string): string {
  const t = limpa(tema, 120);
  const r = limpa(resumo, 440);
  return `${PREFIXO_DA_DECISAO}${t ? ` (${t})` : ""}: ${r || "decisão registrada na ata"}`.slice(0, 590);
}

export type DecisaoNoCerebro = { gravada: boolean; id: string | null; erro: string | null };

/**
 * A decisão do dono no conselho vira aprendizado do cérebro (área geral:
 * todo agente lê). Marca na evidência (a outra marca não herda). Nunca
 * lança: a falha vai para o log e volta em `erro` (a decisão já está na
 * sessão e na memória do projeto).
 */
export async function decisaoDoConselhoNoCerebro(
  db: BancoDoCerebro,
  d: { clientId: string; sessaoId: string; tema: string; resumo: string; marcaId?: string | null; userId?: string | null },
  opcoes: { julgar?: JulgarAprendizado | null } = {},
): Promise<DecisaoNoCerebro> {
  if (!UUID.test(String(d.sessaoId || ""))) return { gravada: false, id: null, erro: "sessão inválida" };
  const g = await gravarNoCerebro(db, {
    client_id: d.clientId,
    area: "geral",
    categoria: "aprendizado",
    texto: textoDaDecisao(d.tema, d.resumo),
    motivo: "O dono decidiu na sessão do conselho.",
    evidencia: [d.marcaId && UUID.test(d.marcaId) ? `marca:${d.marcaId}` : null, `conselho:${d.sessaoId}`].filter(Boolean).join("; "),
    fonte: FONTE_DA_DECISAO_DO_CONSELHO,
    criado_por: d.userId ?? null,
    referencia_id: d.sessaoId,
    // Decisão não vence sozinha: sai quando o dono desfaz ou decide o contrário.
    valido_dias: null,
    agente: "geral",
    // Sem o Jev de "repete ou contradiz": a linha precisa ser desta sessão para o Desfazer achar (só texto igual reforça).
  }, { julgar: opcoes.julgar === undefined ? null : opcoes.julgar });
  esquecerContextoCompleto(d.clientId);
  if (!g.gravada) {
    registrarFalha("sincronia: decisão do conselho fora do cérebro", g.erro || "não gravada", { client_id: d.clientId, sessao_id: d.sessaoId });
    return { gravada: false, id: null, erro: g.erro || "não gravada" };
  }
  return { gravada: true, id: g.id, erro: null };
}

/** "Desfazer decisão": a linha do cérebro sai (ativa=false). Nunca lança. */
export async function desfazerDecisaoNoCerebro(db: BancoDoCerebro, d: { clientId: string; sessaoId: string }): Promise<{ ok: boolean; erro: string | null }> {
  if (!UUID.test(String(d.sessaoId || ""))) return { ok: false, erro: "sessão inválida" };
  try {
    const { error } = await db.from("agente_memoria").update({ ativa: false })
      .eq("client_id", d.clientId).eq("referencia_id", d.sessaoId).eq("fonte", FONTE_DA_DECISAO_DO_CONSELHO).eq("ativa", true);
    esquecerContextoCompleto(d.clientId);
    if (error) return { ok: false, erro: registrarFalha("sincronia: decisão do conselho não saiu do cérebro", error, { sessao_id: d.sessaoId }) };
    return { ok: true, erro: null };
  } catch (e) {
    return { ok: false, erro: registrarFalha("sincronia: decisão do conselho não saiu do cérebro", e, { sessao_id: d.sessaoId }) };
  }
}
