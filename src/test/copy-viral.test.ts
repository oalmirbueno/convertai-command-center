import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// O servidor importa o motor de IA (npm:) e o contexto completo (banco): no teste, os dois são falsos.
vi.mock("../../supabase/functions/_shared/ia-motor.ts", () => ({
  cobrarJev: vi.fn(async () => ({ custoUsd: 0.0003 })),
  carregarModelo: vi.fn(async (id: string) => {
    if (id === "sumiu") throw new Error("modelo_inexistente");
    return { id, tipo: "texto" };
  }),
  modeloPadrao: vi.fn(async (papel: string) => (papel === "copy" ? { id: "openrouter:anthropic/claude-opus-5.5", tipo: "texto" } : null)),
}));
vi.mock("../../supabase/functions/_shared/contexto-completo-da-marca.ts", () => ({
  contextoCompletoParaPrompt: vi.fn(async () => {
    throw new Error("sem banco no teste");
  }),
}));

import {
  blocoDaCopyViral,
  cortarNaoComprovado,
  escolherGanchos,
  escolherModeloDaCopy,
  faltasDoContexto,
  formatoDoLugar,
  type Gancho,
  humanizar,
  lerViralidade,
  MAX_GANCHOS,
  MIN_GANCHOS,
  nichosDoTexto,
  ordemComViralidade,
  passadaFinal,
  perguntasDaViralidade,
} from "../../supabase/functions/estudio-arte/modulos/copy-viral";
import {
  escolherComViralidade,
  lerGanchos,
  limparCacheDosGanchos,
  modeloDaCopy,
  prepararCopyViral,
  type PerfilDoNicho,
} from "../../supabase/functions/estudio-arte/modulos/copy-viral-servidor";
import type { ResultadoJev } from "../../supabase/functions/_shared/jev";

const TRAVESSAO = String.fromCharCode(0x2014);

// ------------------------------------------------------------------ banco falso a partir do seed

const SQL = readFileSync(resolve(process.cwd(), "supabase/migrations/20261023100000_motor_de_copy_viral.sql"), "utf8");

/** Lê as linhas do insert do seed (id, formula, exemplo, por_que, gatilho, formato, nichos...). */
function ganchosDoSeed(): Gancho[] {
  const re = /\('([a-z]{3}-\d{2})', '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '([a-z_]+)', '([a-z_]+)', array\[([^\]]*)\]::text\[\], '([a-z]+)', (\d)/g;
  const lista: Gancho[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL))) {
    lista.push({
      id: m[1],
      formula: m[2].replace(/''/g, "'"),
      exemplo: m[3].replace(/''/g, "'"),
      por_que_funciona: m[4].replace(/''/g, "'"),
      gatilho: m[5],
      formato: m[6],
      nichos: m[7].split(",").map((x) => x.trim().replace(/'/g, "")),
      tom: m[8],
      nivel_de_ousadia: Number(m[9]),
    });
  }
  return lista;
}

const SEED = ganchosDoSeed();

function bancoFalso(lista: Gancho[], erro: unknown = null) {
  const chamadas: Array<{ tabela: string; overlaps?: string[] }> = [];
  const db = {
    from(tabela: string) {
      const registro: { tabela: string; overlaps?: string[] } = { tabela };
      chamadas.push(registro);
      const q = {
        select: () => q,
        eq: () => q,
        not: () => q,
        overlaps: (_c: string, v: string[]) => {
          registro.overlaps = v;
          return q;
        },
        limit: async () => ({ data: erro ? null : lista.filter((g) => !registro.overlaps || g.nichos.some((n) => registro.overlaps!.indexOf(n) >= 0)), error: erro }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
  };
  return { db, chamadas };
}

describe("seed do banco de ganchos", () => {
  it("tem pelo menos 300 ganchos originais, sem travessão, com todas as fórmulas e nichos pedidos", () => {
    expect(SEED.length).toBeGreaterThanOrEqual(300);
    expect(SEED.every((g) => g.exemplo.indexOf(TRAVESSAO) < 0 && g.por_que_funciona.length > 30)).toBe(true);
    const nichos = new Set<string>();
    SEED.forEach((g) => g.nichos.forEach((n) => nichos.add(n)));
    for (const n of ["odontologia", "advocacia", "informatica", "alimentacao", "cafe", "moda", "varejo", "saude_estetica", "imobiliario", "educacao", "servicos_locais", "marketing", "automotivo", "eventos", "moveis_decoracao", "jardinagem", "esporte", "geral"]) {
      expect(SEED.filter((g) => g.nichos.indexOf(n) >= 0).length, n).toBeGreaterThanOrEqual(15);
    }
    const formulas = new Set(SEED.map((g) => g.formula));
    for (const f of ["Curiosidade com lacuna", "Contrário ao senso comum", "Número + promessa útil", "Erro comum + consequência", "O que ninguém conta", "Antes e depois", "Pare de + o porquê", "Pergunta direta", "História em uma linha", "Prova social real", "Dor específica", "Ação com prazo curto", "Comparação lado a lado", "Bastidor", "Mito ou verdade"]) {
      expect(formulas.has(f), f).toBe(true);
    }
    const formatos = new Set(SEED.map((g) => g.formato));
    expect([...formatos].sort()).toEqual(["anuncio", "lamina_capa", "legenda_primeira_linha", "reels_abertura", "story"]);
    // Ids únicos (o upsert do seed é por id).
    expect(new Set(SEED.map((g) => g.id)).size).toBe(SEED.length);
  });

  it("a tabela tem leitura só para a equipe e para o service_role", () => {
    expect(SQL).toMatch(/revoke all on table public\.ganchos_vencedores from public, anon, authenticated/);
    expect(SQL).toMatch(/for select to authenticated\s+using \(public\.is_staff/);
    expect(SQL).toMatch(/grant select, insert, update, delete on public\.ganchos_vencedores to service_role/);
  });
});

describe("busca de ganchos por nicho e formato", () => {
  beforeEach(() => limparCacheDosGanchos());

  it("nicho pelo texto do cliente, sempre com geral", () => {
    expect(nichosDoTexto("Clínica odontológica no Bacacheri, implante dentário")).toEqual(["odontologia", "geral"]);
    expect(nichosDoTexto("Stop Informática: conserto de notebook e celular")[0]).toBe("informatica");
    expect(nichosDoTexto("Cafeteria e torrefação")[0]).toBe("cafe");
    expect(nichosDoTexto("")).toEqual(["geral"]);
  });

  it("traz de 8 a 15, do nicho primeiro, no formato pedido e com fórmulas variadas", async () => {
    const { db, chamadas } = bancoFalso(SEED);
    const ganchos = await lerGanchos(db, { nichos: ["odontologia"], formato: "lamina_capa", n: 12 });
    expect(chamadas[0].tabela).toBe("ganchos_vencedores");
    expect(chamadas[0].overlaps).toEqual(["odontologia", "geral"]);
    expect(ganchos.length).toBeGreaterThanOrEqual(MIN_GANCHOS);
    expect(ganchos.length).toBeLessThanOrEqual(MAX_GANCHOS);
    // Os primeiros são do nicho e no formato pedido.
    expect(ganchos[0].nichos).toContain("odontologia");
    expect(ganchos[0].formato).toBe("lamina_capa");
    expect(ganchos.filter((g) => g.nichos.indexOf("odontologia") >= 0).length).toBeGreaterThanOrEqual(8);
    // No máximo 2 por fórmula.
    const porFormula: Record<string, number> = {};
    ganchos.forEach((g) => { porFormula[g.formula] = (porFormula[g.formula] || 0) + 1; });
    expect(Math.max(...Object.values(porFormula))).toBeLessThanOrEqual(2);
    // Nada de outro nicho específico.
    expect(ganchos.every((g) => g.nichos.indexOf("odontologia") >= 0 || g.nichos.indexOf("geral") >= 0)).toBe(true);
  });

  it("story pede story, e o gatilho pedido sobe", () => {
    const story = escolherGanchos(SEED, { nichos: ["cafe", "geral"], formato: "story", n: 8 });
    expect(story[0].formato).toBe("story");
    const medo = escolherGanchos(SEED, { nichos: ["automotivo", "geral"], formato: "lamina_capa", gatilhos: ["medo_de_perder"], n: 8 });
    expect(medo[0].gatilho).toBe("medo_de_perder");
  });

  it("banco fora do ar: lista vazia e o prompt segue só com o guia", async () => {
    const { db } = bancoFalso(SEED, { message: "relation does not exist" });
    expect(await lerGanchos(db, { nichos: ["moda"], formato: "story" })).toEqual([]);
  });

  it("formato pelo lugar onde o texto nasce", () => {
    expect(formatoDoLugar("legenda")).toBe("legenda_primeira_linha");
    expect(formatoDoLugar("mesa-stories")).toBe("story");
    expect(formatoDoLugar("roteiro de vídeo")).toBe("reels_abertura");
    expect(formatoDoLugar("lamina")).toBe("lamina_capa");
  });
});

describe("prompt com contexto forte e exemplos", () => {
  beforeEach(() => limparCacheDosGanchos());
  const perfil: PerfilDoNicho = { cliente: "Sorriso Bacacheri", segmento: "Odontologia", nichos: ["odontologia", "geral"], publico: "famílias do bairro, 30 a 55 anos", dor: "medo de dentista e preço", oferta: "avaliação e limpeza", negocio: "clínica odontológica" };

  it("leva nicho, público, dor, oferta, o que o cliente ensinou, hype e de 8 a 15 exemplos do nicho", async () => {
    const { db } = bancoFalso(SEED);
    const r = await prepararCopyViral(db, {
      clientId: "c1",
      formato: "lamina_capa",
      versoes: 3,
      perfil,
      contexto: { ensinou: "Nunca falar de preço no feed", hype: "Dia do Dentista (25/10)", mundo_real: "Fila do SUS para canal" },
    });
    expect(r.bloco).toMatch(/SKILL: COPY VIRAL DO NICHO/);
    expect(r.bloco).toMatch(/Público: famílias do bairro/);
    expect(r.bloco).toMatch(/Dor real do público: medo de dentista/);
    expect(r.bloco).toMatch(/Oferta: avaliação e limpeza/);
    expect(r.bloco).toMatch(/Nunca falar de preço no feed/);
    expect(r.bloco).toMatch(/Dia do Dentista/);
    expect(r.bloco).toMatch(/GANCHOS VENCEDORES DA CASA/);
    expect(r.bloco).toMatch(/nunca copie a frase/);
    expect(r.bloco).toMatch(/Escreva 3 versões com GANCHOS DE FÓRMULAS DIFERENTES/);
    expect(r.bloco).toMatch(/Humanizer:/);
    expect(r.ganchos.length).toBeGreaterThanOrEqual(8);
    expect(r.bloco).toContain(r.ganchos[0].exemplo);
  });

  it("sem público e sem dor no painel: o modelo é avisado para não inventar", () => {
    expect(faltasDoContexto({ nicho: "Moda", oferta: "vestidos" })).toEqual(["Público", "Dor real do público"]);
    const bloco = blocoDaCopyViral({ contexto: { nicho: "Moda", oferta: "vestidos" }, ganchos: [], formato: "story" });
    expect(bloco).toMatch(/Falta no painel: Público, Dor real do público\. Deduza só do que está no contexto completo; não invente\./);
  });
});

describe("humanizer remove os padrões de IA", () => {
  it("corta clichê, ponte, sinceridade encenada, travessão e emoji demais sem mudar o fato", () => {
    const bruto = `No mundo de hoje, cuidar do sorriso faz toda a diferença ${TRAVESSAO} e a gente sabe disso.\nO resultado? Menos dor no dia a dia.\nVou ser sincero: desbloqueie o seu potencial na sua jornada!!! \u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}`;
    const h = humanizar(bruto);
    expect(h.texto).not.toMatch(/mundo de hoje|O resultado\?|Vou ser sincero|desbloqueie|!!/i);
    expect(h.texto).not.toContain(TRAVESSAO);
    expect(h.texto).toMatch(/^Cuidar do sorriso muda o resultado, e a gente sabe disso\./);
    expect(h.texto).toMatch(/\nMenos dor no dia a dia\./);
    expect(h.texto).toMatch(/\nAbra o seu potencial na sua caminhada! /);
    expect((h.texto.match(/\u{1F600}/gu) || []).length).toBe(3);
    expect(h.mudancas).toEqual(expect.arrayContaining(["travessão", "pergunta-ponte", "sinceridade encenada", "\"desbloqueie\"", "emojis demais"]));
  });

  it("texto limpo passa igual", () => {
    const limpo = "Escovar com força deixa o dente sensível.\nTroque por movimentos curtos.";
    expect(humanizar(limpo)).toEqual({ texto: limpo, mudancas: [] });
  });
});

describe("nada inventado", () => {
  const fontes = "Clínica Sorriso. Atendimento desde 2012. Avaliação gratuita às segundas. 4,9 estrelas no Google.";

  it("tira número, depoimento e prova sem fonte e a chave sem dado", () => {
    const texto = [
      "Escovar com força deixa o dente sensível.",
      "Mais de 1.200 pacientes atendidos este ano.",
      "\"Saí sem dor nenhuma\", disse uma cliente.",
      "Estudos mostram que o fio dental reduz a cárie.",
      "{N} pacientes perguntaram isso.",
      "Nota 4,9 estrelas no Google.",
      "Agende pelo WhatsApp.",
    ].join(" ");
    const r = cortarNaoComprovado(texto, fontes);
    expect(r.texto).toBe("Escovar com força deixa o dente sensível. Nota 4,9 estrelas no Google. Agende pelo WhatsApp.");
    expect(r.cortes.map((c) => c.split(":")[0])).toEqual(["número sem fonte", "depoimento sem fonte", "prova sem fonte", "chave sem dado real"]);
  });

  it("número estrutural (3 sinais) e número com fonte ficam", () => {
    const texto = "3 sinais de que a gengiva pede ajuda. A gente atende desde 2012.";
    expect(cortarNaoComprovado(texto, fontes)).toEqual({ texto, cortes: [] });
  });

  it("se tudo cairia, o texto volta como veio e a equipe confere", () => {
    const r = cortarNaoComprovado("97% dos clientes voltam.", fontes);
    expect(r.texto).toBe("97% dos clientes voltam.");
    expect(r.cortes[r.cortes.length - 1]).toMatch(/nada sobraria/);
  });

  it("a passada final corta e humaniza junto", () => {
    const r = passadaFinal("No mundo de hoje, 80% das pessoas erram. Escove devagar.", fontes);
    expect(r.texto).toBe("Escove devagar.");
    expect(r.cortes.length).toBe(1);
  });
});

describe("duas versões e o Jev escolhe (mock)", () => {
  const voz = { bloco: "Marca: Sorriso", essencial: "Marca: Sorriso, clínica odontológica de bairro.", usando: "", nome: "Sorriso", regras: { semTravessao: true } };
  const v0 = "Cuidamos do seu sorriso com carinho e qualidade.\nAgende sua consulta.";
  const v1 = "Escovar logo depois do café pode estar gastando o seu esmalte.\nEspere 30 minutos e salve este post. Agende sua avaliação pelo WhatsApp.";

  it("as 5 perguntas virais vão na mesma chamada da conferência e a versão mais forte vence", async () => {
    const chamadas: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
    const jev = vi.fn(async (args: { state: unknown; questions: Record<string, unknown> }): Promise<ResultadoJev> => {
      chamadas.push(args as never);
      const answers: Record<string, { score?: number; noul?: number }> = {};
      for (let i = 0; i < 2; i++) {
        const forte = i === 1;
        answers[`voz_${i}`] = { score: 3 };
        answers[`forca_${i}`] = { score: forte ? 4 : 2 };
        answers[`inventa_${i}`] = { noul: 0.1 };
        answers[`promessa_${i}`] = { noul: 0.05 };
        answers[`cliche_${i}`] = { noul: forte ? 0.1 : 0.8 };
        answers[`marcas_${i}`] = { noul: 0.1 };
        for (const d of ["gancho", "clareza", "nicho", "utilidade", "compartilhar"]) answers[`v_${d}_${i}`] = { score: forte ? 4 : 1 };
      }
      return { answers, usage: { input_tokens: 2000 }, modelo: "jev-latest" };
    });
    const r = await escolherComViralidade({
      textos: [v0, v1],
      canal: "legenda",
      objetivo: "educacao",
      voz,
      nicho: "Odontologia",
      publico: "famílias do bairro",
      fontes: "Clínica Sorriso. Atendimento pelo WhatsApp.",
      semHashtags: true,
      cobranca: { clientId: "c1", tarefa: "estudio" },
      jev: jev as never,
    });
    expect(jev).toHaveBeenCalledTimes(1);
    const q = chamadas[0].questions;
    expect(Object.keys(q)).toEqual(expect.arrayContaining(["voz_0", "forca_1", "v_gancho_0", "v_clareza_1", "v_nicho_0", "v_utilidade_1", "v_compartilhar_0"]));
    expect(chamadas[0].state.nicho).toBe("Odontologia");
    expect(chamadas[0].state.publico).toBe("famílias do bairro");
    expect(r.ordem[0]).toBe(1);
    expect(r.virais[1].nota).toBe(100);
    expect(r.virais[0].nota).toBe(25);
    expect(r.porque_viral).toMatch(/^Viral 100 de 100/);
    // "30 minutos" não é número de prova: a versão escolhida sai inteira.
    expect(r.finais[1]).toBe(v1);
    expect(r.custo_usd).toBeGreaterThan(0);
  });

  it("sem o Jev: vale a conferência em código e o texto sai mesmo assim", async () => {
    const r = await escolherComViralidade({
      textos: [v0, v1],
      canal: "legenda",
      objetivo: "educacao",
      voz,
      nicho: "Odontologia",
      fontes: "",
      cobranca: { clientId: "c1", tarefa: "estudio" },
      jev: (async () => { throw new Error("fora do ar"); }) as never,
    });
    expect(r.jev_erro).toBe("jev_falhou");
    expect(r.virais.every((v) => v.nota === null)).toBe(true);
    expect(r.finais.length).toBe(2);
    expect(r.porque_viral).toBe("");
  });

  it("alerta (fato inventado) vai para o fim mesmo com nota viral maior", () => {
    const virais = lerViralidade({ v_gancho_0: { score: 4 }, v_gancho_1: { score: 1 } }, 2);
    const ordem = ordemComViralidade([{ indice: 0, nota: 70, alerta: true }, { indice: 1, nota: 60, alerta: false }], virais);
    expect(ordem.map((o) => o.indice)).toEqual([1, 0]);
    expect(Object.keys(perguntasDaViralidade(1))).toEqual(["v_gancho_0", "v_clareza_0", "v_nicho_0", "v_utilidade_0", "v_compartilhar_0"]);
  });
});

describe("seletor de modelo da copy", () => {
  const catalogo = [
    { id: "openrouter:openai/gpt-6.1-sol", tipo: "texto", ativo: true, padrao_para: ["estrategista"] },
    { id: "openrouter:anthropic/claude-opus-5.5", tipo: "texto", ativo: true, padrao_para: ["proposta", "copy"] },
    { id: "openrouter:anthropic/claude-fable-5.1", tipo: "texto", ativo: true, padrao_para: [] },
    { id: "desligado", tipo: "texto", ativo: false, padrao_para: [] },
    { id: "imagem", tipo: "imagem", ativo: true, padrao_para: [] },
  ];

  it("o escolhido vale; sem escolha, o melhor para copy; sem ele, o estrategista", () => {
    expect(escolherModeloDaCopy(catalogo, "openrouter:anthropic/claude-fable-5.1")).toEqual({ modelo: catalogo[2], motivo: "escolhido" });
    expect(escolherModeloDaCopy(catalogo, "")).toEqual({ modelo: catalogo[1], motivo: "padrao_copy" });
    expect(escolherModeloDaCopy(catalogo, "desligado").motivo).toBe("padrao_copy");
    expect(escolherModeloDaCopy(catalogo, "imagem").motivo).toBe("padrao_copy");
    expect(escolherModeloDaCopy([catalogo[0]], null)).toEqual({ modelo: catalogo[0], motivo: "estrategista" });
    expect(escolherModeloDaCopy([], null)).toEqual({ modelo: null, motivo: "nenhum" });
  });

  it("no servidor: o pedido, depois o lembrado do cliente, depois o padrão copy", async () => {
    const db = (guardado: string | null) => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: guardado ? { modelo_copy_id: guardado } : null, error: null }) }) }) }),
    });
    expect((await modeloDaCopy(db("lembrado"), "c1", "pedido"))!.id).toBe("pedido");
    expect((await modeloDaCopy(db("lembrado"), "c1"))!.id).toBe("lembrado");
    expect((await modeloDaCopy(db("sumiu"), "c1"))!.id).toBe("openrouter:anthropic/claude-opus-5.5");
    expect((await modeloDaCopy(db(null), "c1"))!.id).toBe("openrouter:anthropic/claude-opus-5.5");
  });

  it("a migration lembra a escolha por cliente e marca o Opus 5.5 como o melhor para copy", () => {
    expect(SQL).toMatch(/alter table public\.mesa_cliente_config add column if not exists modelo_copy_id text/);
    expect(SQL).toMatch(/function public\.definir_modelo_da_copy\(_client_id uuid, _modelo_id text\)/);
    expect(SQL).toMatch(/public\.can_access_client\(_client_id\)/);
    expect(SQL).toMatch(/where id = 'openrouter:anthropic\/claude-opus-5\.5'/);
  });
});

describe("skills do método do texto (índice dos motores)", () => {
  it("a copy viral do nicho, o Jev viral, o humanizer e o modelo da copy estão ligados no código", async () => {
    const { HABILIDADES_DE_TEXTO } = await import("../../supabase/indice/motores");
    expect(HABILIDADES_DE_TEXTO.map((h) => h.id)).toEqual(["copy_viral_do_nicho", "jev_viral", "humanizer_e_verdade", "modelo_da_copy"]);
    for (const h of HABILIDADES_DE_TEXTO) {
      for (const l of h.ligacoes) {
        const codigo = readFileSync(resolve(process.cwd(), l.arquivo), "utf8");
        for (const t of l.trechos) expect(codigo.indexOf(t) >= 0, `${h.id}: ${l.arquivo} sem ${t}`).toBe(true);
      }
    }
  });
});
