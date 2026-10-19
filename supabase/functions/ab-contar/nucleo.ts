/**
 * ab-contar: a lógica sem Deno.serve (index.ts liga no Supabase; o teste liga
 * numa porta falsa).
 *
 * Público (sem login): { teste_id, variante, tipo: 'visita' | 'conversao' }
 *   → 200 { ok: true } · 400 pedido_invalido · 429 limite (por IP, no banco)
 * Equipe (JWT): { acao: 'totais', teste_id } → { teste_id, variantes: [{ variante, visitas, conversoes, taxa }], por_dia }
 */
import { TESTE_ID, VARIANTE_ID } from "../_shared/ab-divisao.ts";

export type TipoDeContagem = "visita" | "conversao";

export type ContagemPublica = { teste_id: string; variante: string; tipo: TipoDeContagem };

export function lerContagem(bruto: unknown): ContagemPublica | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const o = bruto as Record<string, unknown>;
  const teste = typeof o.teste_id === "string" ? o.teste_id : "";
  const variante = typeof o.variante === "string" ? o.variante : "";
  const tipo = o.tipo;
  if (!TESTE_ID.test(teste) || !VARIANTE_ID.test(variante) || (tipo !== "visita" && tipo !== "conversao")) return null;
  return { teste_id: teste, variante, tipo };
}

export interface PortaDoAb {
  registrar(c: ContagemPublica, ipHash: string): Promise<{ ok: boolean; codigo?: string }>;
  falha(onde: string, erro: unknown): void;
}

export type Resposta = { status: number; corpo: Record<string, unknown> };

export async function contar(porta: PortaDoAb, bruto: unknown, ipHash: string): Promise<Resposta> {
  const c = lerContagem(bruto);
  if (!c) return { status: 400, corpo: { ok: false, codigo: "pedido_invalido" } };
  let r: { ok: boolean; codigo?: string };
  try {
    r = await porta.registrar(c, ipHash);
  } catch (e) {
    porta.falha("ab-contar: banco recusou", e);
    return { status: 503, corpo: { ok: false, codigo: "indisponivel" } };
  }
  if (r.ok) return { status: 200, corpo: { ok: true } };
  const codigo = String(r.codigo || "recusado");
  return { status: codigo === "limite" ? 429 : 400, corpo: { ok: false, codigo } };
}

export type LinhaDeContagem = { variante: string; tipo: TipoDeContagem; dia: string; total: number };

export type TotalDaVariante = { variante: string; visitas: number; conversoes: number; taxa: number | null };

/** Soma as linhas por variante (taxa = conversões ÷ visitas, em %, 1 casa). */
export function somarPorVariante(linhas: LinhaDeContagem[]): TotalDaVariante[] {
  const mapa: Record<string, TotalDaVariante> = {};
  for (const l of linhas) {
    const t = mapa[l.variante] || (mapa[l.variante] = { variante: l.variante, visitas: 0, conversoes: 0, taxa: null });
    if (l.tipo === "visita") t.visitas += Number(l.total) || 0;
    else t.conversoes += Number(l.total) || 0;
  }
  return Object.keys(mapa)
    .sort()
    .map((k) => {
      const t = mapa[k];
      return { ...t, taxa: t.visitas > 0 ? Math.round((t.conversoes / t.visitas) * 1000) / 10 : null };
    });
}
