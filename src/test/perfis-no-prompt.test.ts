import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blocoDosPerfis, escolherPosts, lerPerfisParaOPrompt, type PostDoPerfil } from "../../supabase/functions/_shared/perfis-no-prompt";

/**
 * 17/10/2026, dono: as referências e os concorrentes do Instagram entram no Contexto, no diretor de arte e no
 * calendário; o concorrente que postou vira antecipar, responder, ocupar ou liderar; misturar, nunca copiar.
 */
const post = (o: Partial<PostDoPerfil>): PostDoPerfil => ({ data: null, formato: null, formato_editorial: null, pilar: null, leitura: null, legenda: null, vezes_a_mediana: null, fora_da_curva: false, link: null, ...o });

/** Banco falso encadeável: cada tabela devolve as linhas dadas. */
function banco(tabelas: Record<string, unknown>) {
  return {
    from(t: string) {
      const resposta = { data: tabelas[t] ?? null, error: null };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order", "limit", "in", "gte"]) q[m] = () => q;
      q.maybeSingle = () => Promise.resolve(resposta);
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok);
      return q;
    },
  };
}

describe("posts escolhidos", () => {
  it("os que mais funcionaram primeiro e o que postou nos últimos 7 dias à parte", () => {
    const r = escolherPosts([
      post({ data: "2026-10-15", vezes_a_mediana: 1 }),
      post({ data: "2026-09-01", fora_da_curva: true, vezes_a_mediana: 4 }),
      post({ data: "2026-08-01", vezes_a_mediana: 2 }),
    ], "2026-10-17");
    expect(r.melhores[0].data).toBe("2026-09-01");
    expect(r.novidades.map((p) => p.data)).toEqual(["2026-10-15"]);
  });
});

describe("leitura do banco", () => {
  const perfis = [
    { id: "r1", handle: "@refa", nome: "Ref A", papel: "referencia", resumo: { padrao_visual: "fundo claro, título grande" }, marca_id: null },
    { id: "r2", handle: "naosegue", nome: null, papel: "referencia", resumo: { padrao_visual: "x" }, marca_id: null },
    { id: "c1", handle: "conc", nome: "Concorrente", papel: "concorrente", resumo: null, marca_id: null },
  ];
  const posts = [
    { perfil_id: "c1", publicado_em: "2026-10-16T10:00:00Z", formato: "carrossel", legenda: "5 erros no tráfego", leitura: "carrossel azul", vezes_a_mediana: 3, fora_da_curva: true },
    { perfil_id: "r1", publicado_em: "2026-09-10T10:00:00Z", formato: "estatico", leitura: "foto com título", vezes_a_mediana: 2 },
  ];
  const kit = { contexto: { diretrizes: { perfis_excluidos: [{ handle: "naosegue", motivo: "dono", em: "2026-10-01" }] } } };

  it("lê referências e concorrentes, tira quem a marca não segue e marca o que o concorrente postou agora", async () => {
    const r = await lerPerfisParaOPrompt(banco({ cliente_perfis_instagram: perfis, cliente_perfis_posts: posts, cliente_kit_marca: kit }), "cli", null, { hoje: "2026-10-17" });
    expect(r?.map((p) => p.handle)).toEqual(["refa", "conc"]);
    expect(r?.[1].novidades.length).toBe(1);
    const conteudo = blocoDosPerfis(r, "conteudo");
    expect(conteudo).toContain("postou_agora");
    expect(conteudo).toContain("ANTECIPAR");
    expect(conteudo).toContain("MISTURE, nunca copie");
    const arte = blocoDosPerfis(r, "arte");
    expect(arte).not.toContain("postou_agora");
    expect(arte).toContain("COMO USAR NA ARTE");
  });

  it("sem perfil nada entra; falha no banco não derruba", async () => {
    expect(await lerPerfisParaOPrompt(banco({ cliente_perfis_instagram: [] }), "cli", null)).toBeNull();
    expect(await lerPerfisParaOPrompt({ from: () => { throw new Error("x"); } }, "cli", null)).toBeNull();
    expect(blocoDosPerfis(null, "arte")).toBe("");
  });
});

describe("contrato: as três mesas leem", () => {
  it("Mês (toda geração), diretor de arte e Contexto", () => {
    const mes = readFileSync("supabase/functions/agente-calendario/index.ts", "utf8");
    expect(mes).toContain('blocoDosPerfis(ctx.perfis, "conteudo", { enxuto })');
    const estudio = readFileSync("supabase/functions/estudio-arte/index.ts", "utf8");
    expect(estudio).toContain('blocoDosPerfis(await perfisP, "arte")');
    expect(estudio).toContain("REPERTÓRIO E MISTURA");
    const contexto = readFileSync("supabase/functions/agente-contexto/index.ts", "utf8");
    expect(contexto).toContain('"contexto", { enxuto: true }');
  });
});
