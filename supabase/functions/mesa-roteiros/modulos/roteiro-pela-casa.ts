/**
 * Frente CPY: o roteiro pelo motor de copy da casa. Puro (sem Deno e sem
 * rede), para o vitest ler o mesmo arquivo que a função usa.
 *
 * - roteiroPeloMotorDeCopy: limpeza da casa (travessão, espaços) na fala, nos
 *   ganchos, no CTA e na legenda, e a conferência em código (clichê de IA,
 *   promessa proibida, legenda sem CTA) como frases de aviso.
 * - avisoComAsFrasesDaCasa: junta essas frases ao aviso do Jev. Quando o Jev
 *   não respondeu (sem chave, fora do ar, 402), a conferência em código vale
 *   sozinha: é justamente o caso em que ela mais importa.
 */

import { conferirCopy, limparCopy } from "../../_shared/motor-de-copy.ts";
import type { AvisoDoJev, Roteiro } from "../../_shared/roteiro-modelo.ts";

export function roteiroPeloMotorDeCopy(r: Roteiro): { roteiro: Roteiro; frases: string[] } {
  const limpo = (v: string) => limparCopy(v, "roteiro", { cortar: false }).texto;
  const roteiro: Roteiro = {
    ...r,
    ganchos: r.ganchos.map((g) => ({ ...g, texto: limpo(g.texto) })),
    blocos: r.blocos.map((b) => ({ ...b, fala: limpo(b.fala) })),
    cta: limpo(r.cta),
    legenda: limparCopy(r.legenda, "legenda", { cortar: false }).texto,
  };
  const gancho = roteiro.ganchos[roteiro.gancho_escolhido];
  const fala = [gancho ? gancho.texto : "", ...roteiro.blocos.map((b) => b.fala), roteiro.cta].filter(Boolean).join("\n");
  const frases: string[] = [];
  for (const x of conferirCopy(fala, "roteiro").problemas) if (x.tipo === "cliche" || x.tipo === "promessa") frases.push(`Fala: ${x.texto}`);
  if (roteiro.legenda) for (const x of conferirCopy(roteiro.legenda, "legenda").problemas) if (x.tipo === "cliche" || x.tipo === "promessa" || x.tipo === "sem_cta") frases.push(`Legenda: ${x.texto}`);
  return { roteiro, frases };
}

/** O aviso do Jev com as frases da conferência em código; sem o Jev, só elas (ou null se não houver nenhuma). */
export function avisoComAsFrasesDaCasa(aviso: AvisoDoJev | null, frases: string[]): AvisoDoJev | null {
  if (!aviso) return frases.length ? { retencao: null, clareza: null, promessa_cumprida: null, frases: frases.slice() } : null;
  const juntas = aviso.frases.slice();
  for (const f of frases) if (juntas.indexOf(f) < 0) juntas.push(f);
  return { ...aviso, frases: juntas };
}
