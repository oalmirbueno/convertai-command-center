import { ultimasVersoes, type Trabalho } from "@/components/mesa/useItensDoMes";
import { custoDaResposta, ErroDaMesa } from "@/lib/mesa/api";

/**
 * Situação de cada criativo no Estúdio Ads e o lote "Gerar todos": gera a
 * lâmina, confere e, se a conferência pedir (autocorrecao.precisa), corrige e
 * confere de novo, no máximo 2 vezes, antes de dar a arte como pronta. É o
 * mesmo caminho do ArteDoCriativo (gerar_card, conferir_card, corrigir_card),
 * rodado em fila para vários criativos.
 */

export type SituacaoDoCriativo = "sem_arte" | "gerando" | "conferindo" | "corrigindo" | "pronto" | "entregue";
export type EtapaDoLote = "fila" | "gerando" | "conferindo" | "corrigindo";

export const SITUACOES: { valor: SituacaoDoCriativo; rotulo: string; tom: string }[] = [
  { valor: "sem_arte", rotulo: "Sem arte", tom: "bg-secondary text-muted-foreground" },
  { valor: "gerando", rotulo: "Gerando", tom: "bg-info/10 text-info" },
  { valor: "conferindo", rotulo: "Conferindo", tom: "bg-info/10 text-info" },
  { valor: "corrigindo", rotulo: "Corrigindo", tom: "bg-warning/15 text-warning" },
  { valor: "pronto", rotulo: "Pronto", tom: "bg-success/10 text-success" },
  { valor: "entregue", rotulo: "Entregue", tom: "bg-primary/15 text-primary" },
];

export const situacaoDe = (v: SituacaoDoCriativo) => SITUACOES.find((s) => s.valor === v) || SITUACOES[0];

/** Lâminas da direção que ainda não têm arte. */
export function laminasSemArte(t: Trabalho | null | undefined): number[] {
  if (!t) return [];
  const cards = ((t.direcao && t.direcao.cards) || []).slice().sort((a, b) => a.ordem - b.ordem);
  const ultimas = ultimasVersoes(t.cards || []);
  return cards.filter((c) => !ultimas.has(c.ordem)).map((c) => c.ordem);
}

export function trabalhoEntregue(t: Trabalho | null | undefined): boolean {
  if (!t) return false;
  const dir = (t.direcao || {}) as Record<string, any>;
  const entrega = dir.entrega_ads && typeof dir.entrega_ads === "object" ? dir.entrega_ads : null;
  return t.status === "entregue" || !!(entrega && Array.isArray(entrega.file_ids) && entrega.file_ids.length);
}

/** Situação do criativo: o andamento local (lote) vale mais que o trabalho gravado. */
export function situacaoDoTrabalho(t: Trabalho | null | undefined, local?: EtapaDoLote | null): SituacaoDoCriativo {
  if (local === "gerando" || local === "fila") return "gerando";
  if (local === "conferindo") return "conferindo";
  if (local === "corrigindo") return "corrigindo";
  if (!t) return "sem_arte";
  if (trabalhoEntregue(t)) return "entregue";
  if (t.status === "gerando") return "gerando";
  const cards = (t.direcao && t.direcao.cards) || [];
  if (cards.length && laminasSemArte(t).length === 0) return "pronto";
  return "sem_arte";
}

type Chamar = (corpo: Record<string, unknown>) => Promise<any>;

const CODIGOS_QUE_ENCERRAM = ["limite_de_autocorrecao", "acao_desconhecida", "servico_indisponivel"];

/**
 * Gera uma lâmina e só a dá como pronta depois da conferência. Devolve o
 * custo somado e os motivos que sobraram (null quando saiu certa).
 */
export async function produzirLamina(
  chamar: Chamar,
  trabalhoId: string,
  ordem: number,
  aoMudar: (e: EtapaDoLote) => void,
  maxCorrecoes = 2,
): Promise<{ custo_usd: number; correcoes: number; pendencias: string[] | null }> {
  let custo = 0;
  aoMudar("gerando");
  custo += custoDaResposta(await chamar({ acao: "gerar_card", trabalho_id: trabalhoId, ordem })) || 0;
  let correcoes = 0;
  let pendencias: string[] | null = null;
  for (;;) {
    aoMudar("conferindo");
    let conferencia: any;
    try {
      conferencia = await chamar({ acao: "conferir_card", trabalho_id: trabalhoId, ordem });
    } catch {
      // Arte já cobrada: conferência que falha não derruba o lote.
      break;
    }
    custo += custoDaResposta(conferencia) || 0;
    const auto = conferencia && conferencia.autocorrecao && typeof conferencia.autocorrecao === "object" ? conferencia.autocorrecao : null;
    if (!auto || !auto.precisa) {
      pendencias = null;
      break;
    }
    pendencias = Array.isArray(auto.motivos) ? auto.motivos.map((m: unknown) => String(m)) : [];
    if (correcoes >= maxCorrecoes) break;
    aoMudar("corrigindo");
    try {
      custo += custoDaResposta(await chamar({ acao: "corrigir_card", trabalho_id: trabalhoId, ordem })) || 0;
      correcoes += 1;
    } catch (e) {
      if (e instanceof ErroDaMesa && CODIGOS_QUE_ENCERRAM.indexOf(e.codigo) >= 0) break;
      throw e;
    }
  }
  return { custo_usd: custo, correcoes, pendencias };
}
