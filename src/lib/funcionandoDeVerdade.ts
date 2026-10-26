/**
 * "Funcionando de verdade" (26/10/2026, dono: "eu vendo realmente funcionando
 * de lado"): a última ação REAL de cada agente, com prova e quando. Conta só
 * o que deixou prova (last_evidence no vínculo); conversa, rodada sem fato e
 * "disse que fez" não entram. Puro, para o teste.
 */

export interface VinculoComProva {
  id: string;
  operator_id: string;
  status: string;
  last_evidence: string | null;
  updated_at: string;
}

export interface AgenteParaProva {
  id: string;
  display_name: string;
  status?: string | null;
}

export interface UltimaAcaoReal {
  agenteId: string;
  agente: string;
  linkId: string;
  /** "Cliente · Área · assunto" */
  nome: string;
  quando: string;
  prova: string;
  /** Concluída (done) ou entregue esperando a sua revisão. */
  estado: "feito" | "revisao" | "andando";
}

export function ultimasAcoesReais(
  agentes: readonly AgenteParaProva[],
  vinculos: readonly VinculoComProva[],
  nomeDoVinculo: (v: VinculoComProva) => string,
): { comProva: UltimaAcaoReal[]; semProva: string[] } {
  const ultima = new Map<string, VinculoComProva>();
  for (const v of vinculos) {
    if (!v.last_evidence || !String(v.last_evidence).trim()) continue;
    if (v.status === "blocked" || v.status === "cancelled") continue;
    const atual = ultima.get(v.operator_id);
    if (!atual || String(v.updated_at) > String(atual.updated_at)) ultima.set(v.operator_id, v);
  }
  const comProva: UltimaAcaoReal[] = [];
  const semProva: string[] = [];
  for (const a of agentes) {
    const v = ultima.get(a.id);
    if (!v) {
      if (a.status !== "paused" && a.status !== "retired" && a.status !== "inactive") semProva.push(a.display_name);
      continue;
    }
    comProva.push({
      agenteId: a.id,
      agente: a.display_name,
      linkId: v.id,
      nome: nomeDoVinculo(v),
      quando: v.updated_at,
      prova: String(v.last_evidence),
      estado: v.status === "done" ? "feito" : v.status === "review" ? "revisao" : "andando",
    });
  }
  comProva.sort((x, y) => (x.quando < y.quando ? 1 : -1));
  return { comProva, semProva };
}

/** "há 5 min", "há 3 h", "ontem", "há 4 dias". */
export function haQuanto(iso: string, agora = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((agora - t) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 172800) return "ontem";
  return `há ${Math.floor(s / 86400)} dias`;
}
