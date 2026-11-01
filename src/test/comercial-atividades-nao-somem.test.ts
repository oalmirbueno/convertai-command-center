import { describe, expect, it, vi } from "vitest";

/**
 * CRM: a leitura das atividades era uma só, em ordem crescente com limite de 500. Com mais de 500 linhas
 * (contando as concluídas), voltavam as 500 MAIS ANTIGAS: as de hoje e do futuro sumiam da Agenda, o funil
 * marcava o lead como "sem próximo passo" e a ficha do lead ficava sem compromisso.
 *
 * O Supabase falso abaixo aplica de verdade os filtros, a ordem e o limite pedidos.
 */

type Linha = { id: string; lead_id: string | null; kind: string; title: string; due_at: string; done_at: string | null; owner_id: null; notes: null };

const banco = vi.hoisted(() => ({ linhas: [] as Array<Record<string, unknown>> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const filtros: Array<(l: Record<string, unknown>) => boolean> = [];
    let ordem: { coluna: string; asc: boolean } | null = null;
    let limite = Infinity;
    const q: Record<string, unknown> = {
      select: () => q,
      is: (c: string, v: null) => { filtros.push((l) => l[c] === v); return q; },
      not: (c: string, op: string, v: null) => { if (op === "is") filtros.push((l) => l[c] !== v); return q; },
      order: (c: string, o: { ascending: boolean }) => { ordem = { coluna: c, asc: o.ascending }; return q; },
      limit: (n: number) => { limite = n; return q; },
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => {
        let dados = banco.linhas.filter((l) => filtros.every((f) => f(l)));
        if (ordem) {
          const { coluna, asc } = ordem;
          dados = [...dados].sort((a, b) => (String(a[coluna]) < String(b[coluna]) ? -1 : 1) * (asc ? 1 : -1));
        }
        return Promise.resolve({ data: dados.slice(0, limite), error: null }).then(ok, erro);
      },
    };
    return q;
  };
  return { supabase: { from: () => consulta() } };
});

import { listarAtividades } from "@/lib/comercial";

function atividade(i: number, dueAt: string, doneAt: string | null): Linha {
  return { id: `a${i}`, lead_id: `l${i % 7}`, kind: "ligacao", title: `Atividade ${i}`, due_at: dueAt, done_at: doneAt, owner_id: null, notes: null };
}

describe("as atividades do Comercial não somem quando a tabela cresce", () => {
  it("com 550 concluídas antigas e 50 abertas futuras, as 50 abertas aparecem", async () => {
    const antigas = Array.from({ length: 550 }, (_, i) => {
      const dia = String((i % 28) + 1).padStart(2, "0");
      const mes = String((i % 9) + 1).padStart(2, "0");
      return atividade(i, `2026-${mes}-${dia}T12:00:00Z`, `2026-${mes}-${dia}T13:00:00Z`);
    });
    const futuras = Array.from({ length: 50 }, (_, i) => atividade(1000 + i, `2026-11-${String((i % 28) + 1).padStart(2, "0")}T15:00:00Z`, null));
    banco.linhas = [...antigas, ...futuras];

    const lidas = await listarAtividades();
    const abertas = lidas.filter((a) => !a.done_at);
    expect(abertas).toHaveLength(50);
    // As concluídas que vêm são as mais recentes, e a lista final continua em ordem crescente.
    expect(lidas.length).toBe(550);
    const datas = lidas.map((a) => a.due_at);
    expect([...datas].sort()).toEqual(datas);
  });

  it("aberta atrasada (antiga) também continua na lista", async () => {
    banco.linhas = [
      atividade(1, "2025-01-10T12:00:00Z", null),
      ...Array.from({ length: 600 }, (_, i) => atividade(10 + i, `2026-0${(i % 9) + 1}-10T12:00:00Z`, "2026-10-01T00:00:00Z")),
    ];
    const lidas = await listarAtividades();
    expect(lidas.some((a) => a.id === "a1" && !a.done_at)).toBe(true);
  });
});
