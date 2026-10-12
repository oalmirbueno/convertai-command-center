import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { basesDoPerfil, multiploDoPost, textoDoMultiplo } from "../../supabase/functions/_shared/multiplo-do-post";
import { blocoDosMoldes, estruturaDaLegenda, FORMULAS_DO_GANCHO, moldesDosVencedores } from "../../supabase/functions/agente-calendario/modulos/moldes";
import { fatosDasPublicacoes } from "../../supabase/functions/_shared/cerebro-do-cliente";
import { rankearPosts } from "@/lib/metricasResumo";
import type { SocialPostMetric } from "@/hooks/useSocialMetrics";

/**
 * "O que performou" pelo múltiplo do perfil e o molde do vencedor (12/10/2026, yt-viral e
 * ig-hook-extractor): views (ou alcance, ou interações) ÷ mediana do próprio perfil em 90 dias.
 */

const AGORA = new Date("2026-10-12T12:00:00Z");
const dia = (n: number) => new Date(AGORA.getTime() - n * 86400000).toISOString();
const post = (id: string, o: Partial<SocialPostMetric>): SocialPostMetric => ({
  id, client_id: "c", external_account_id: "e", media_id: id, media_type: "IMAGE", caption: `Legenda ${id}`, permalink: null, media_url: null, thumbnail_url: null,
  posted_at: dia(5), like_count: 10, comments_count: 1, reach: 100, saved: 0, shares: 0, total_interactions: 11, views: 200, captured_at: dia(0), ...o,
});

describe("múltiplo do post", () => {
  const posts = [post("a", { views: 200 }), post("b", { views: 220 }), post("c", { views: 180 }), post("d", { views: 900 }), post("e", { views: 210 })];

  it("mediana do perfil e múltiplo pelas views", () => {
    const b = basesDoPerfil(posts, 90, AGORA);
    expect(b.views).toBe(210);
    const m = multiploDoPost(posts[3], b);
    expect(m).toEqual({ multiplo: 4.3, medida: "views", destaque: true });
    expect(textoDoMultiplo(m)).toBe("4,3x o normal do perfil (views)");
  });

  it("sem views cai para alcance; com menos de 4 posts não há múltiplo", () => {
    const semViews = posts.map((p) => ({ ...p, views: null }));
    expect(multiploDoPost({ ...semViews[0], reach: 300 }, basesDoPerfil(semViews, 90, AGORA)).medida).toBe("alcance");
    expect(basesDoPerfil(posts.slice(0, 3), 90, AGORA).views).toBeNull();
    expect(multiploDoPost(posts[0], basesDoPerfil(posts.slice(0, 3), 90, AGORA)).multiplo).toBeNull();
  });

  it("o ranking da tela vai pelo múltiplo, não pelo número bruto", () => {
    const grande = post("grande", { views: 5000, total_interactions: 900, posted_at: dia(200) }); // fora dos 90 dias da régua
    const r = rankearPosts([...posts, grande], AGORA);
    expect(r[0].id).toBe("grande");
    expect(r[1].id).toBe("d");
  });
});

describe("molde do vencedor", () => {
  const posts = [
    { media_type: "CAROUSEL_ALBUM", caption: "5 erros que travam sua agenda (o 4º quase ninguém vê)\n1. Sem horário fixo\n2. Sem lembrete\nSalve para não esquecer", permalink: "https://x/p/1", posted_at: dia(3), views: 1000, reach: 500 },
    { media_type: "IMAGE", caption: "Post comum da semana com texto suficiente", permalink: null, posted_at: dia(4), views: 200, reach: 100 },
    { media_type: "IMAGE", caption: "Outro post comum da semana com texto", permalink: null, posted_at: dia(6), views: 210, reach: 110 },
    { media_type: "IMAGE", caption: "Mais um post comum da semana com texto", permalink: null, posted_at: dia(8), views: 190, reach: 90 },
    { media_type: "IMAGE", caption: "E outro post comum da semana com texto", permalink: null, posted_at: dia(9), views: 205, reach: 95 },
  ];

  it("estrutura lida em código", () => {
    expect(estruturaDaLegenda(posts[0].caption)).toBe("4 linhas, 113 caracteres, tem lista, pede para salvar");
  });

  it("o Jev escolhe a fórmula e o código monta o molde com o esqueleto (sem copiar o texto)", async () => {
    let perguntas: Record<string, unknown> = {};
    const moldes = await moldesDosVencedores(posts, async (e) => {
      perguntas = e.questions;
      return { answers: { f0: { choice: "f5" } } };
    }, AGORA);
    expect(Object.keys(perguntas)).toEqual(["f0"]);
    expect(moldes).toHaveLength(1);
    expect(moldes[0]).toMatchObject({ formato: "carrossel", formula: "Lista que se salva", objetivo_da_formula: "salvar" });
    expect(moldes[0].esqueleto).toContain("{N}");
    expect(moldes[0].multiplo).toContain("x o normal do perfil");
    expect(blocoDosMoldes(moldes)).toContain("nunca copie o texto");
  });

  it("sem o Jev o molde sai sem fórmula; sem vencedor, nada", async () => {
    const sem = await moldesDosVencedores(posts, null, AGORA);
    expect(sem[0].formula).toBeNull();
    expect(await moldesDosVencedores(posts.slice(1), null, AGORA)).toEqual([]);
    expect(FORMULAS_DO_GANCHO).toHaveLength(10);
  });
});

describe("cérebro e Agente do Mês", () => {
  it("o cérebro grava como 'performou' só quem passou de 1,5x do normal", () => {
    const linhas = [
      { id: "1", media_id: "1", posted_at: dia(2), views: 900, like_count: 1, comments_count: 0, caption: "vencedor" },
      { id: "2", media_id: "2", posted_at: dia(3), views: 200, like_count: 50, comments_count: 9, caption: "muitas curtidas" },
      { id: "3", media_id: "3", posted_at: dia(4), views: 210, like_count: 2, comments_count: 0, caption: "x" },
      { id: "4", media_id: "4", posted_at: dia(5), views: 190, like_count: 2, comments_count: 0, caption: "y" },
    ];
    const f = fatosDasPublicacoes(linhas as never);
    expect(f).toHaveLength(1);
    expect(f[0].texto).toContain("o normal do perfil (views)");
    expect(f[0].texto).toContain("vencedor");
  });

  it("o contexto do Mês lê as views e manda os moldes no pedido", () => {
    const cal = readFileSync(resolve(__dirname, "../../supabase/functions/agente-calendario/index.ts"), "utf8");
    expect(cal).toContain("total_interactions, views");
    expect(cal).toContain("blocoDosMoldes(ctx.moldes ?? [])");
  });
});
