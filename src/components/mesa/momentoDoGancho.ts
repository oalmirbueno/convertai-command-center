/**
 * O hype na agenda (17/10/2026). Dono: "quando adiciona na agenda os gerados
 * pelo hype, ele some dali e também marca com o foguinho do hype na esteira
 * do Estúdio".
 *
 * A marca é a linha "Gancho do momento: Hype: <título>" (ou "Nicho: ...") da
 * descrição da tarefa. O "Usar a pauta" manda o hype junto do pedido e o
 * servidor grava essa linha exata em cada conteúdo, então o título casa.
 * Puro: nada de rede (o raio-x do mês já lê a mesma linha).
 */
import { tipoDoGancho } from "./contaDoRaioX";

export type MomentoDoGancho = "hype" | "nicho";

/** A linha "Gancho do momento: ..." da descrição (sem o rótulo), ou null. */
export function ganchoDaDescricao(descricao: string | null | undefined): string | null {
  const m = /Gancho do momento:\s*([^\n]+)/.exec(String(descricao || ""));
  const g = m ? m[1].trim() : "";
  return g || null;
}

/** Hype ou nicho (gancho de concorrente não é foguinho). */
export function momentoDoGancho(gancho: string | null | undefined): MomentoDoGancho | null {
  const t = tipoDoGancho(gancho || null);
  return t === "hype" || t === "nicho" ? t : null;
}

/** Minúsculas, sem acento e sem pontuação, para comparar título com gancho. */
export function semAcento(t: string): string {
  const base = String(t || "").toLowerCase().normalize("NFD");
  let out = "";
  for (let i = 0; i < base.length; i += 1) {
    const c = base.charCodeAt(i);
    if (c >= 0x300 && c <= 0x36f) continue;
    out += base[i];
  }
  return out.replace(/[^a-z0-9]+/g, " ").trim();
}

/** O hype já virou conteúdo na agenda: algum gancho gravado cita o título dele. */
export function hypeNaAgenda(titulo: string, ganchos: string[]): boolean {
  const t = semAcento(titulo);
  if (t.length < 4) return false;
  return ganchos.some((g) => semAcento(g).indexOf(t) >= 0);
}

/** O gancho exato que o pedido de um hype grava em cada conteúdo. */
export function ganchoDoHype(h: { tipo?: string | null; titulo: string }): string {
  return `${h.tipo === "nicho" ? "Nicho" : "Hype"}: ${h.titulo}`;
}
