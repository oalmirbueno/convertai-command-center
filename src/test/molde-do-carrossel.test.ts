import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  candidatosAoMolde,
  laminasDoCarrossel,
  lerRespostasDoMolde,
  MAX_LAMINAS_LIDAS,
  moldeParaAPauta,
  normalizarLeituraDoCarrossel,
  perguntasDoMolde,
  quantosCarrosseis,
} from "../../supabase/functions/perfis-instagram/modulos/molde-do-carrossel";
import { blocoDosPerfis, postDaLinha } from "../../supabase/functions/_shared/perfis-no-prompt";

/**
 * 11/11/2026, dono: "crie algo para a Aceleriq para esse template, só que melhore". O carrossel da referência é
 * lido lâmina a lâmina e vira molde de ESTRUTURA; o texto alheio nunca vai para o pedido de conteúdo.
 */
const post = (o: Record<string, unknown>) => ({ id: "a", ig_media_id: "1", fora_da_curva: false, vezes_a_mediana: 1 as number | null, publicado_em: "2026-11-01", ...o });

describe("lâminas do carrossel", () => {
  it("mantém a ordem do post, conta o vídeo sem endereço e para no limite", () => {
    const filhos = [{ media_url: "https://x/1.jpg", media_type: "IMAGE" }, { media_url: "https://x/2.mp4", media_type: "VIDEO" }, { media_url: "http://sem-https/3.jpg", media_type: "IMAGE" }];
    expect(laminasDoCarrossel(filhos)).toEqual([
      { ordem: 1, tipo: "imagem", url: "https://x/1.jpg" },
      { ordem: 2, tipo: "video", url: null },
      { ordem: 3, tipo: "imagem", url: null },
    ]);
    const muitos = Array.from({ length: 20 }, (_, i) => ({ media_url: `https://x/${i}.jpg`, media_type: "IMAGE" }));
    expect(laminasDoCarrossel(muitos)).toHaveLength(MAX_LAMINAS_LIDAS);
    expect(laminasDoCarrossel(null)).toEqual([]);
  });
});

describe("quais carrosséis ler", () => {
  it("só os que a API ainda devolve, fora da curva primeiro, e nada abaixo da mediana", () => {
    const posts = [
      post({ id: "velho", ig_media_id: "9", fora_da_curva: true, vezes_a_mediana: 30 }),
      post({ id: "fraco", ig_media_id: "2", vezes_a_mediana: 0.4 }),
      post({ id: "bom", ig_media_id: "3", vezes_a_mediana: 1.8 }),
      post({ id: "estouro", ig_media_id: "4", fora_da_curva: true, vezes_a_mediana: 5 }),
      post({ id: "sem_numero", ig_media_id: "5", vezes_a_mediana: null }),
    ];
    const r = candidatosAoMolde(posts, ["2", "3", "4", "5"], 2);
    expect(r.escolhidos.map((p) => p.id)).toEqual(["estouro", "bom"]);
    expect(r.foraDaJanela).toBe(1);
    expect(r.abaixoDaMediana).toBe(1);
  });

  it("quantos por chamada: padrão 2, teto 3", () => {
    expect(quantosCarrosseis(undefined)).toBe(2);
    expect(quantosCarrosseis(1)).toBe(1);
    expect(quantosCarrosseis(50)).toBe(3);
  });
});

describe("leitura do modelo", () => {
  const guardadas = [
    { ordem: 1, tipo: "imagem" as const, caminho: "c/l01.jpg" },
    { ordem: 2, tipo: "video" as const, caminho: null },
    { ordem: 3, tipo: "imagem" as const, caminho: "c/l03.jpg" },
  ];
  it("a imagem 2 do modelo é a lâmina 3 do carrossel quando a 2 é vídeo", () => {
    const r = normalizarLeituraDoCarrossel({
      laminas: [
        { imagem: 1, texto: `Gancho ${String.fromCharCode(8212)} forte`, hierarquia: "título gigante", visual: "so_texto", funcao: "gancho" },
        { imagem: 2, texto: "Comenta EU", hierarquia: "", visual: "inventado", funcao: "chamada" },
        { imagem: 9, texto: "fora", hierarquia: "", visual: "so_texto", funcao: "ponto" },
      ],
      tema: "tema", gancho: "Gancho", formula_do_gancho: "número + assunto", promessa: "p", chamada_final: "comentar",
      esqueleto: ["abre com promessa", "", "fecha pedindo comentário"],
    }, guardadas, [1, 3], 12);
    expect(r.laminas.map((l) => [l.ordem, l.funcao, l.texto])).toEqual([[1, "gancho", "Gancho , forte"], [2, null, ""], [3, "chamada", "Comenta EU"]]);
    expect(r.laminas[2].visual).toBeNull();
    expect(r.molde.esqueleto).toEqual(["abre com promessa", "fecha pedindo comentário"]);
    expect(r.molde.laminas_total).toBe(12);
    expect(r.molde.laminas_lidas).toBe(2);
  });

  it("resposta vazia não quebra", () => {
    const r = normalizarLeituraDoCarrossel(null, guardadas, [1, 3], 3);
    expect(r.laminas).toHaveLength(3);
    expect(r.molde.esqueleto).toEqual([]);
  });
});

describe("Jev do molde", () => {
  it("três perguntas por carrossel sobre o mesmo estado", () => {
    const q = perguntasDoMolde(2);
    expect(Object.keys(q).sort()).toEqual(["ensina_0", "ensina_1", "estrutura_0", "estrutura_1", "serve_0", "serve_1"]);
    expect(q.estrutura_1.instructions).toContain("carrosseis[1]");
    expect(q.ensina_0.type).toBe("noul");
  });

  it("lê estrutura, nota de 0 a 10 e o ensina a fazer sozinho pelo limiar", () => {
    const r = lerRespostasDoMolde({
      estrutura_0: { choice: "erro_comum" }, serve_0: { score: 4 }, ensina_0: { noul: 0.2 },
      estrutura_1: { choice: "inexistente" }, serve_1: { score: 1 }, ensina_1: { noul: 0.9 },
    }, 3);
    expect(r[0]).toEqual({ estrutura: "erro_comum", serve: 10, ensina_sozinho: false });
    expect(r[1]).toEqual({ estrutura: null, serve: 2.5, ensina_sozinho: true });
    expect(r[2]).toEqual({ estrutura: null, serve: null, ensina_sozinho: null });
  });
});

describe("molde na pauta: só a estrutura", () => {
  const molde = {
    tema: "Aposentadoria do jogador X", gancho: "A aposentadoria MAIS CARA do futebol", formula_do_gancho: "superlativo + assunto do momento",
    promessa: "entender o caso", chamada_final: "pede comentário", esqueleto: ["abre com superlativo", "mostra o dado", "fecha com pergunta"],
    estrutura: "noticia_comentada", serve: 7.5, ensina_sozinho: false, laminas_total: 3, laminas_lidas: 3,
  };

  it("leva estrutura, fórmula, esqueleto e chamada; nunca o gancho literal nem o tema", () => {
    const m = moldeParaAPauta(molde);
    expect(m).toEqual({ estrutura: "Notícia comentada", formula_do_gancho: "superlativo + assunto do momento", esqueleto: molde.esqueleto, chamada_final: "pede comentário", laminas: 3 });
    expect(JSON.stringify(m)).not.toContain("MAIS CARA");
    expect(JSON.stringify(m)).not.toContain("jogador X");
  });

  it("fica de fora o que ensina a fazer sozinho, o que não serve e o que não tem esqueleto", () => {
    expect(moldeParaAPauta({ ...molde, ensina_sozinho: true })).toBeNull();
    expect(moldeParaAPauta({ ...molde, serve: 2.5 })).toBeNull();
    expect(moldeParaAPauta({ ...molde, esqueleto: ["uma só"] })).toBeNull();
    expect(moldeParaAPauta(null)).toBeNull();
  });

  it("o agente do Mês recebe o molde no post que funcionou, e o diretor de arte não", () => {
    const perfil = {
      handle: "ref", nome: null, papel: "referencia" as const, seguidores: 1000, resumo: null, novidades: [],
      melhores: [postDaLinha({ publicado_em: "2026-11-01T10:00:00Z", formato: "carrossel", legenda: "legenda", vezes_a_mediana: 5, fora_da_curva: true, molde })],
    };
    const conteudo = blocoDosPerfis([perfil], "conteudo");
    expect(conteudo).toContain("molde_do_carrossel");
    expect(conteudo).toContain("abre com superlativo");
    expect(conteudo).not.toContain("MAIS CARA");
    expect(blocoDosPerfis([perfil], "arte")).not.toContain("molde_do_carrossel");
  });
});

describe("ligação na função", () => {
  const fonte = readFileSync("supabase/functions/perfis-instagram/index.ts", "utf8");
  it("as ações existem, a leitura respeita o teto e a rodada da semana lê um carrossel", () => {
    expect(fonte).toContain("moldes_ler: moldesLer,");
    expect(fonte).toContain("if (!cabeNoTeto(custo, estimativa, teto))");
    expect(fonte).toContain("lerMoldesDoPerfil(perfil, ctx, tokens, null, { quantos: 1, teto: TETO_DE_CUSTO_DA_RODADA_USD - custo })");
    expect(fonte).toContain('tipo: "molde"');
  });
});
