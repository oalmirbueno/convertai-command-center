import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 16/11/2026 (revisão Codex P2): o arquivo das campanhas é filtrado NO BANCO,
 * antes do order/limit (a página de 60/40 não se enche de arquivadas), e a
 * leitura refaz sem o filtro quando a coluna ainda não existe (42703).
 */

type Chamada = [string, unknown[]];
type Resposta = { data: unknown; error: { code?: string; message?: string } | null };

const banco = vi.hoisted(() => ({
  consultas: [] as { tabela: string; chamadas: [string, unknown[]][] }[],
  responder: (_tabela: string, _chamadas: [string, unknown[]][]): { data: unknown; error: unknown } => ({ data: [], error: null }),
}));

function construtor(tabela: string) {
  const registro = { tabela, chamadas: [] as Chamada[] };
  banco.consultas.push(registro);
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is", "not", "in", "order", "limit", "lte", "gte", "contains"]) {
    q[m] = (...args: unknown[]) => {
      registro.chamadas.push([m, args]);
      return q;
    };
  }
  q.then = (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) =>
    Promise.resolve(banco.responder(tabela, registro.chamadas)).then(ok, erro);
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => construtor(t), channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {} },
}));

import { lerComFiltroDoArquivo } from "../../supabase/functions/_shared/arquivo-da-campanha";
import { lerCampanhas, lerCampanhasArquivadas } from "@/components/mesa/mesaV4Api";
import { lerCampanhasComPecas } from "@/components/mesa-ads/campanhaDaMesaApi";
import { lerCampanhasDoCliente } from "@/components/laboratorio/FaixaDaCampanha";
import { lerCampanhasParaFoto } from "../../supabase/functions/mesa-foto/campanhas";

const SEM_COLUNA = { code: "42703", message: "column mesa_campanhas.arquivada_em does not exist" };
const nomes = (c: Chamada[]) => c.map(([m]) => m);
const posicao = (c: Chamada[], m: string) => nomes(c).indexOf(m);
const temFiltroDeAtivas = (c: Chamada[]) => c.some(([m, a]) => m === "is" && a[0] === "arquivada_em" && a[1] === null);
const temFiltroDeArquivadas = (c: Chamada[]) => c.some(([m, a]) => m === "not" && a[0] === "arquivada_em" && a[1] === "is" && a[2] === null);
const campanhasLidas = () => banco.consultas.filter((x) => x.tabela === "mesa_campanhas");

/** Banco que ainda não tem a coluna: qualquer filtro em arquivada_em devolve 42703. */
const semAColuna = (linhas: unknown[]) => (tabela: string, c: Chamada[]): Resposta => {
  if (tabela !== "mesa_campanhas") return { data: [], error: null };
  const usaColuna = c.some(([m, a]) => (m === "is" || m === "not" || m === "order") && a[0] === "arquivada_em");
  return usaColuna ? { data: null, error: SEM_COLUNA } : { data: linhas, error: null };
};

beforeEach(() => {
  banco.consultas.length = 0;
  banco.responder = () => ({ data: [], error: null });
});

describe("lerComFiltroDoArquivo", () => {
  it("ativas: filtra arquivada_em is null antes do order e do limite", async () => {
    banco.responder = () => ({ data: [{ id: "a" }], error: null });
    const { supabase } = await import("@/integrations/supabase/client");
    const r = await lerComFiltroDoArquivo<{ id: string }>((f) => f((supabase as any).from("mesa_campanhas").select("*").eq("client_id", "c")).order("criado_em").limit(60));
    expect(r).toEqual({ linhas: [{ id: "a" }], semColuna: false });
    const [q] = campanhasLidas();
    expect(temFiltroDeAtivas(q.chamadas)).toBe(true);
    expect(posicao(q.chamadas, "is")).toBeLessThan(posicao(q.chamadas, "order"));
    expect(posicao(q.chamadas, "is")).toBeLessThan(posicao(q.chamadas, "limit"));
  });

  it("arquivadas: consulta própria com not is null antes do limite", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    await lerComFiltroDoArquivo((f) => f((supabase as any).from("mesa_campanhas").select("*")).limit(60), "arquivadas");
    const [q] = campanhasLidas();
    expect(temFiltroDeArquivadas(q.chamadas)).toBe(true);
    expect(temFiltroDeAtivas(q.chamadas)).toBe(false);
    expect(posicao(q.chamadas, "not")).toBeLessThan(posicao(q.chamadas, "limit"));
  });

  it("coluna ausente (42703): ativas refaz sem o filtro; arquivadas vira lista vazia", async () => {
    banco.responder = semAColuna([{ id: "a" }, { id: "b" }]);
    const { supabase } = await import("@/integrations/supabase/client");
    const ler = (modo: "ativas" | "arquivadas") =>
      lerComFiltroDoArquivo((f) => f((supabase as any).from("mesa_campanhas").select("*")).order("criado_em").limit(60), modo);
    expect(await ler("ativas")).toEqual({ linhas: [{ id: "a" }, { id: "b" }], semColuna: true });
    expect(campanhasLidas()).toHaveLength(2);
    expect(temFiltroDeAtivas(campanhasLidas()[1].chamadas)).toBe(false);
    banco.consultas.length = 0;
    expect(await ler("arquivadas")).toEqual({ linhas: [], semColuna: true });
    expect(campanhasLidas()).toHaveLength(1);
  });

  it("outro erro do banco não é engolido", async () => {
    banco.responder = () => ({ data: null, error: { code: "42501", message: "permission denied" } });
    const { supabase } = await import("@/integrations/supabase/client");
    await expect(lerComFiltroDoArquivo((f) => f((supabase as any).from("mesa_campanhas").select("*")).limit(60))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("leituras das telas", () => {
  it("Mesa (lerCampanhas): ativas e arquivadas em consultas separadas, cada uma com limite 60", async () => {
    await lerCampanhas("cliente-1");
    await lerCampanhasArquivadas("cliente-1");
    const [ativas, arquivadas] = campanhasLidas();
    expect(temFiltroDeAtivas(ativas.chamadas) && posicao(ativas.chamadas, "is") < posicao(ativas.chamadas, "limit")).toBe(true);
    expect(temFiltroDeArquivadas(arquivadas.chamadas) && posicao(arquivadas.chamadas, "not") < posicao(arquivadas.chamadas, "limit")).toBe(true);
    expect(ativas.chamadas).toContainEqual(["limit", [60]]);
    expect(arquivadas.chamadas).toContainEqual(["limit", [60]]);
  });

  it("Mesa (lerCampanhas): sem a coluna, devolve todas e as arquivadas ficam vazias", async () => {
    banco.responder = semAColuna([{ id: "a", nome: "A" }]);
    expect(await lerCampanhas("cliente-1")).toEqual([{ id: "a", nome: "A" }]);
    expect(await lerCampanhasArquivadas("cliente-1")).toEqual([]);
  });

  it("Mesa Ads (Puxar de uma campanha): filtra no banco e cai para sem filtro", async () => {
    await lerCampanhasComPecas("cliente-1");
    const q = campanhasLidas()[0];
    expect(temFiltroDeAtivas(q.chamadas)).toBe(true);
    expect(posicao(q.chamadas, "is")).toBeLessThan(posicao(q.chamadas, "limit"));
    banco.consultas.length = 0;
    banco.responder = semAColuna([]);
    await expect(lerCampanhasComPecas("cliente-1")).resolves.toEqual([]);
    expect(campanhasLidas()).toHaveLength(2);
  });

  it("Laboratório (Ligar a uma campanha): filtra no banco e cai para sem filtro", async () => {
    await lerCampanhasDoCliente("cliente-1");
    const q = campanhasLidas()[0];
    expect(temFiltroDeAtivas(q.chamadas)).toBe(true);
    expect(posicao(q.chamadas, "is")).toBeLessThan(posicao(q.chamadas, "limit"));
    banco.consultas.length = 0;
    banco.responder = semAColuna([{ id: "x", nome: "X", status: "planejada", periodo_inicio: null, periodo_fim: null }]);
    expect((await lerCampanhasDoCliente("cliente-1")).map((c) => c.id)).toEqual(["x"]);
  });
});

describe("Mesa Foto (lerCampanhasParaFoto)", () => {
  const db = { from: (t: string) => construtor(t) } as never;
  const agora = new Date("2026-11-16T15:00:00Z");

  it("lista padrão: só a consulta de ativas (filtro antes do limite 40)", async () => {
    banco.responder = (t) => ({ data: t === "mesa_campanhas" ? [{ id: "ativa-1", nome: "Ativa", status: "planejada" }] : [], error: null });
    const r = await lerCampanhasParaFoto(db, "cliente-1", agora);
    expect(r.campanhas.map((c) => c.id)).toEqual(["ativa-1"]);
    const qs = campanhasLidas();
    expect(qs).toHaveLength(1);
    expect(temFiltroDeAtivas(qs[0].chamadas)).toBe(true);
    expect(posicao(qs[0].chamadas, "is")).toBeLessThan(posicao(qs[0].chamadas, "limit"));
    expect(qs[0].chamadas).toContainEqual(["limit", [40]]);
  });

  it("incluir_arquivadas: consulta própria das arquivadas, marcadas e nunca a do mês", async () => {
    banco.responder = (t, c) => {
      if (t !== "mesa_campanhas") return { data: [], error: null };
      return temFiltroDeArquivadas(c)
        ? { data: [{ id: "arq-1", nome: "Velha", status: "ativa", periodo_inicio: "2026-11-01", periodo_fim: "2026-11-30", arquivada_em: "2026-11-15T10:00:00Z" }], error: null }
        : { data: [{ id: "ativa-1", nome: "Ativa", status: "planejada" }], error: null };
    };
    const r = await lerCampanhasParaFoto(db, "cliente-1", agora, null, { incluirArquivadas: true });
    expect(campanhasLidas()).toHaveLength(2);
    expect(r.campanhas.map((c) => c.id).sort()).toEqual(["arq-1", "ativa-1"]);
    expect(r.campanha_do_mes_id).not.toBe("arq-1");
  });

  it("sem a coluna: refaz sem o filtro e não cai", async () => {
    banco.responder = semAColuna([{ id: "ativa-1", nome: "Ativa", status: "planejada" }]);
    const r = await lerCampanhasParaFoto(db, "cliente-1", agora, null, { incluirArquivadas: true });
    expect(r.campanhas.map((c) => c.id)).toEqual(["ativa-1"]);
  });
});
