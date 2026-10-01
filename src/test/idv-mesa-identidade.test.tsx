import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement as h } from "react";
import VisaoDoBrandbook from "@/components/mesa-identidade/VisaoDoBrandbook";
import {
  concluirEtapa,
  ETAPAS_DA_IDENTIDADE,
  etapaAtual,
  etapasDoProjeto,
  faltaNaEtapa,
  podeAbrir,
  precisaDeNaming,
  progresso,
  reabrirEtapa,
} from "../../supabase/functions/mesa-identidade/modulos/identidade-etapas";
import {
  ajusteDoDominio,
  arrobaDoNome,
  conferirDominios,
  escolherFinalistas,
  linkDoInpi,
  marcarFinalistas,
  mensagemDoGrupo,
  normalizarCandidatos,
  notaDoScore,
  perguntasDoRanking,
  ranquearComJev,
  situacaoPeloStatus,
  slugDoNome,
  TECNICAS_DE_NAMING,
  urlDoRdap,
} from "../../supabase/functions/mesa-identidade/modulos/naming";
import { cmykIngenuo, contraste, fichaDaCor, hexParaRgb, normalizarHex, proporcaoDeUso, rgbParaCmyk, textoSobre } from "../../supabase/functions/_shared/cores-da-marca";
import {
  brandbookDoProjeto,
  brandbookPublico,
  estadoDoModelo,
  imagensDoBrandbook,
  lacunasDoBrandbook,
  MODELOS_DE_BRANDBOOK,
  normalizarBrandbook,
  PAGINAS_DO_BRANDBOOK,
  SECOES_DA_PRANCHA,
  tokenPublico,
  USOS_INCORRETOS_PADRAO,
} from "../../supabase/functions/mesa-identidade/modulos/brandbook";
import { abrirPng, gerarPdfDoBrandbook, gerarPdfDoNaming, imagemParaPdf, medidasDoJpeg, prepararImagens } from "../../supabase/functions/mesa-identidade/modulos/pdf-identidade";
import { paginasDoPdf, textosDoPdf } from "../../supabase/functions/_shared/pdf-roteiro";
import { montarBriefingDaIdentidade, respostasDoBriefing } from "../../supabase/functions/mesa-identidade/modulos/briefing-da-identidade";
import { alvosDoDiretor, normalizarAcoesDoDiretor, pedidoSobreNome, regrasDoDiretor, respostaPromete } from "../../supabase/functions/mesa-identidade/acoes-do-diretor";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { MESAS_DO_PAINEL, cargasDaMesa, etapaQueVaiAbrir } from "@/lib/mesa/preCarga";
import { MESAS, enderecoDaMesa } from "@/components/mesa-foto/TrocaDeMesas";
import { montarClientesDaMesa, NOME_DA_MESA } from "@/components/mesa/clientesDaMesa";
import { corpoComMarca, definirMarcaAtual, limparMarcaAtual } from "@/lib/mesa/marcas";
import { textoDaAprovacao } from "@/components/mesa-identidade/identidadeApi";
import { dadosDoPublico } from "@/pages/BrandbookPublico";
import { areaPorPalavras, AREAS_DO_PAINEL, AGENTES_DO_PAINEL } from "../../supabase/functions/_shared/mapa-do-painel";
import { AREA_DA_MESA, FONTE_DA_MESA, MESAS_QUE_APRENDEM } from "../../supabase/functions/_shared/aprendizado-das-mesas";

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const C = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

// ------------------------------------------------------------------ 1. etapas e sequência

describe("Mesa Identidade: etapas em sequência", () => {
  const zero = { modo: "zero" as const, com_naming: false, concluidas: ["inicio"] };
  const rebranding = { modo: "rebranding" as const, com_naming: false, concluidas: ["inicio"] };

  it("onze etapas (IDV2: estratégia e apresentação); naming só na marca do zero ou quando pedido", () => {
    expect(ETAPAS_DA_IDENTIDADE.map((e) => e.valor)).toEqual(["inicio", "briefing", "pesquisa", "estrategia", "naming", "conceito", "sistema", "mockups", "guideline", "apresentacao", "entrega"]);
    expect(precisaDeNaming(zero)).toBe(true);
    expect(precisaDeNaming(rebranding)).toBe(false);
    expect(precisaDeNaming({ ...rebranding, com_naming: true })).toBe(true);
    expect(etapasDoProjeto(rebranding)).not.toContain("naming");
    expect(etapasDoProjeto(zero)).toContain("naming");
  });

  it("a próxima etapa só abre quando a de antes fecha; voltar é livre", () => {
    expect(etapaAtual(zero)).toBe("briefing");
    expect(podeAbrir(zero, "briefing").pode).toBe(true);
    expect(podeAbrir(zero, "pesquisa")).toEqual({ pode: false, motivo: "Conclua Briefing antes." });
    expect(podeAbrir(rebranding, "naming").pode).toBe(false);
    const mais = { ...zero, concluidas: ["inicio", "briefing", "pesquisa"] };
    expect(etapaAtual(mais)).toBe("estrategia");
    expect(podeAbrir(mais, "briefing").pode).toBe(true);
    expect(podeAbrir(mais, "naming").pode).toBe(false);
    expect(progresso(mais)).toEqual({ feitas: 3, total: 11 });
    const comEstrategia = { ...zero, concluidas: ["inicio", "briefing", "pesquisa", "estrategia"] };
    expect(etapaAtual(comEstrategia)).toBe("naming");
    expect(podeAbrir(comEstrategia, "conceito").pode).toBe(false);
  });

  it("concluir exige o mínimo da etapa (nada inventado) e devolve a próxima", () => {
    const falha = concluirEtapa(zero, "briefing", {});
    expect(falha.ok).toBe(false);
    if (!falha.ok) expect(falha.falta).toEqual(["O que o negócio faz", "Para quem é a marca", "A personalidade da marca (3 a 5 palavras)"]);
    const ok = concluirEtapa(zero, "briefing", { briefing: { negocio: "Padaria", publico: "Bairro", personalidade: ["calorosa"] } });
    expect(ok).toEqual({ ok: true, concluidas: ["inicio", "briefing"], proxima: "pesquisa" });
    // Depois da pesquisa vem a estratégia (IDV2); rebranding sem naming pula da estratégia para o conceito.
    const r = concluirEtapa({ ...rebranding, concluidas: ["inicio", "briefing"] }, "pesquisa", { pesquisa: { resumo: "x" } });
    expect(r.ok && r.proxima).toBe("estrategia");
    const est = { estrategia: { proposito: "Fazer pão de verdade", arquetipo: { principal: "cuidador" }, posicionamento: { publico: "o bairro", diferencial: "fermentação natural" }, tom: { fala_assim: ["Seu pão sai às 7h."] } } };
    const r2 = concluirEtapa({ ...rebranding, concluidas: ["inicio", "briefing", "pesquisa"] }, "estrategia", est);
    expect(r2.ok && r2.proxima).toBe("conceito");
    // Fora da ordem não fecha.
    expect(concluirEtapa(zero, "sistema", {}).ok).toBe(false);
  });

  it("o mínimo do sistema: logo real, 2 cores e a família de título; mockups não trava", () => {
    expect(faltaNaEtapa("sistema", {})).toEqual(["A logo principal (arquivo SVG ou PNG)", "Ao menos 2 cores na paleta", "A família tipográfica dos títulos"]);
    expect(faltaNaEtapa("sistema", { sistema: { logos: { principal: { caminho: `${C}/marca/identidade/p/logo.svg` } }, cores: [{ hex: "#111111" }, { hex: "#FFFFFF" }], tipografia: [{ familia: "Inter" }] } })).toEqual([]);
    expect(faltaNaEtapa("mockups", {})).toEqual([]);
    expect(faltaNaEtapa("conceito", { conceito: { caminhos: [{ id: "c1" }] } })).toEqual(["O caminho escolhido"]);
  });

  it("reabrir desfaz a etapa e as seguintes", () => {
    const p = { ...zero, concluidas: ["inicio", "briefing", "pesquisa", "naming"] };
    expect(reabrirEtapa(p, "pesquisa")).toEqual(["inicio", "briefing"]);
  });
});

// ------------------------------------------------------------------ 2. naming

const CANDIDATOS = [
  { nome: "Flora Viva", tecnica: "composto", justificativa: "une natureza e vida" },
  { nome: "Florá", tecnica: "neologismo", justificativa: "curto" },
  { nome: "flora viva", tecnica: "evocativo" },
  { nome: "\"Raiz\".", tecnica: "inventada" },
  { nome: "A", tecnica: "descritivo" },
  { nome: "Casa Antiga", tecnica: "descritivo" },
];

describe("Naming: técnicas, filtros e ranking com Jev", () => {
  it("técnicas conhecidas, nome limpo, sem repetição e sem o nome atual", () => {
    expect(TECNICAS_DE_NAMING.map((t) => t.valor)).toEqual(expect.arrayContaining(["descritivo", "evocativo", "neologismo", "composto", "acronimo", "metafora"]));
    const lista = normalizarCandidatos({ candidatos: CANDIDATOS }, { proibidos: ["Casa Antiga"] });
    expect(lista.map((c) => c.nome)).toEqual(["Flora Viva", "Florá", "Raiz"]);
    expect(lista[2].tecnica).toBe("evocativo");
    expect(lista.map((c) => c.id)).toEqual(["n1", "n2", "n3"]);
    expect(lista[0].filtros).toMatchObject({ com_br: "nao_conferido", com: "nao_conferido", instagram: "a_conferir", arroba: "floraviva" });
  });

  it("domínio, @ e INPI por código (link pronto, sem raspagem)", () => {
    expect(slugDoNome("Açaí & Cia.")).toBe("acaiecia");
    expect(slugDoNome("A")).toBeNull();
    expect(arrobaDoNome("Flora Viva")).toBe("floraviva");
    expect(linkDoInpi("Flora Viva")).toContain("marca=Flora%20Viva");
    expect(urlDoRdap("floraviva", "com.br")).toBe("https://rdap.registro.br/domain/floraviva.com.br");
    expect(urlDoRdap("floraviva", "com")).toBe("https://rdap.verisign.com/com/v1/domain/floraviva.com");
    expect([situacaoPeloStatus(404), situacaoPeloStatus(200), situacaoPeloStatus(429)]).toEqual(["livre", "registrado", "nao_conferido"]);
  });

  it("RDAP: 404 livre, 200 registrado; erro e limite ficam não conferido", async () => {
    const lista = normalizarCandidatos({ candidatos: CANDIDATOS.slice(0, 2) });
    const chamados: string[] = [];
    const buscar = async (url: string) => {
      chamados.push(url);
      if (url.indexOf("floraviva.com.br") >= 0) return { status: 404 };
      if (url.indexOf("floraviva.com") >= 0) return { status: 200 };
      if (url.indexOf("flora.com.br") >= 0) throw new Error("rede");
      return { status: 429 };
    };
    const r = await conferirDominios(lista, buscar, { agora: () => "2026-09-30T00:00:00Z" });
    expect(chamados).toHaveLength(4);
    expect(r[0].filtros).toMatchObject({ com_br: "livre", com: "registrado", conferido_em: "2026-09-30T00:00:00Z" });
    expect(r[1].filtros).toMatchObject({ com_br: "nao_conferido", com: "nao_conferido" });
  });

  it("ranking pelo Jev (Score por nome) com ajuste pequeno do domínio; finalistas de 3 a 5", async () => {
    let lista = normalizarCandidatos({ candidatos: [
      { nome: "Alfa", tecnica: "neologismo" },
      { nome: "Beta", tecnica: "composto" },
      { nome: "Gama", tecnica: "metafora" },
      { nome: "Delta", tecnica: "evocativo" },
      { nome: "Epsilon", tecnica: "descritivo" },
    ] });
    lista = lista.map((c) => (c.nome === "Beta" ? { ...c, filtros: { ...c.filtros, com_br: "registrado" as const } } : c.nome === "Gama" ? { ...c, filtros: { ...c.filtros, com_br: "livre" as const } } : c));
    const perguntas: string[][] = [];
    const jevFalso = async (e: { state: unknown; questions: Record<string, any> }) => {
      perguntas.push(Object.keys(e.questions));
      const q = e.questions[Object.keys(e.questions)[0]];
      expect(q.type).toBe("score");
      expect(q.criteria).toHaveLength(5);
      expect((e.state as any).criterios).toEqual(["curto"]);
      const notas: Record<string, number> = { n1: 5, n2: 4.6, n3: 4.6, n4: 2, n5: 1 };
      const answers: Record<string, any> = {};
      Object.keys(e.questions).forEach((k) => (answers[k] = { score: notas[k] }));
      return { answers, usage: { input_tokens: 100 } };
    };
    const r = await ranquearComJev(lista, { alvo: "marca", criterios: ["curto"], briefing: { negocio: "x" } }, jevFalso, { porChamada: 3 });
    expect(perguntas).toEqual([["n1", "n2", "n3"], ["n4", "n5"]]);
    expect(r.falhas).toBe(0);
    expect(r.ranqueados.map((c) => c.nome)).toEqual(["Alfa", "Gama", "Beta", "Delta", "Epsilon"]);
    expect(notaDoScore({ score: 3 })).toBe(0.5);
    expect(ajusteDoDominio({ com_br: "livre", com: "livre" })).toBeCloseTo(0.12);
    const finais = escolherFinalistas(r.ranqueados, 3);
    // .com.br registrado fica fora quando há nome suficiente.
    expect(finais.filter((c) => c.finalista).map((c) => c.nome)).toEqual(["Alfa", "Gama", "Delta"]);
    expect(escolherFinalistas(r.ranqueados, 9).filter((c) => c.finalista)).toHaveLength(4);
    expect(marcarFinalistas(finais, ["n1", "n2", "n3", "n4", "n5", "zz"]).filter((c) => c.finalista)).toHaveLength(5);
  });

  it("Jev fora do ar: a lista fica sem nota, na ordem, e a falha é contada (sem laço)", async () => {
    const lista = normalizarCandidatos({ candidatos: CANDIDATOS.slice(0, 2) });
    let vezes = 0;
    const r = await ranquearComJev(lista, { alvo: "campanha", criterios: [], briefing: {} }, async () => {
      vezes++;
      throw new Error("jev_timeout");
    });
    expect(vezes).toBe(1);
    expect(r.falhas).toBe(1);
    expect(r.ranqueados.map((c) => c.nota)).toEqual([null, null]);
    expect(Object.keys(perguntasDoRanking(lista))).toEqual(["n1", "n2"]);
  });

  it("a mensagem do grupo lista os finalistas, sem travessão e sem prometer registro", () => {
    const f = escolherFinalistas(normalizarCandidatos({ candidatos: CANDIDATOS.slice(0, 4) }), 3).filter((c) => c.finalista);
    const m = mensagemDoGrupo({ cliente: "Flora", alvo: "marca", finalistas: f });
    expect(m).toContain("1. Flora Viva");
    expect(m).toContain("INPI");
    expect(m).not.toMatch(/[–—]/);
  });
});

// ------------------------------------------------------------------ 3. cores por código

describe("Cores: HEX, RGB e CMYK calculados por código (perfil, não a conta ingênua)", () => {
  // Régua: os números do Illustrator na prancha recebida (Whatsflow), perfil de papel revestido.
  const REGUA: Array<[string, [number, number, number, number]]> = [
    ["#191D20", [76, 67, 63, 75]],
    ["#11BC76", [75, 0, 74, 0]],
    ["#39F7B2", [55, 0, 49, 0]],
    ["#EBEFEF", [7, 3, 4, 0]],
    ["#4F5AE3", [76, 68, 0, 0]],
  ];

  it("RGB exato e hex normalizado", () => {
    expect(hexParaRgb("#11bc76")).toEqual({ r: 17, g: 188, b: 118 });
    expect(normalizarHex("abc")).toBe("#AABBCC");
    expect(normalizarHex("#12")).toBeNull();
  });

  it("CMYK perto da régua do Illustrator (até 10 pontos por canal) e longe da conta ingênua", () => {
    for (const [hex, esperado] of REGUA) {
      const c = rgbParaCmyk(hex);
      const obtido = [c.c, c.m, c.y, c.k];
      obtido.forEach((v, i) => expect(Math.abs(v - esperado[i]), `${hex} canal ${i}: ${obtido.join("/")}`).toBeLessThanOrEqual(10));
    }
    // A conta ingênua põe preto no verde vivo; o perfil não.
    expect(cmykIngenuo("#11BC76").k).toBeGreaterThan(20);
    expect(rgbParaCmyk("#11BC76").k).toBe(0);
  });

  it("branco é 0/0/0/0; preto é rico e respeita o limite de tinta de 300%", () => {
    expect(rgbParaCmyk("#FFFFFF")).toEqual({ c: 0, m: 0, y: 0, k: 0 });
    const preto = rgbParaCmyk("#000000");
    expect(preto.k).toBeGreaterThanOrEqual(85);
    expect(preto.c + preto.m + preto.y + preto.k).toBeLessThanOrEqual(300);
    for (const h of ["#1B2A4A", "#3A0D0D", "#101010", "#224422"]) {
      const c = rgbParaCmyk(h);
      expect(c.c + c.m + c.y + c.k, h).toBeLessThanOrEqual(300);
    }
  });

  it("ficha, contraste e proporção 60/30/10", () => {
    const f = fichaDaCor({ nome: "Verde", papel: "primaria", hex: "#11bc76" })!;
    expect(f).toMatchObject({ hex: "#11BC76", rgb: { r: 17, g: 188, b: 118 }, papel: "primaria" });
    expect(contraste("#000000", "#FFFFFF")).toBe(21);
    expect(textoSobre("#191D20")).toBe("#FFFFFF");
    const p = proporcaoDeUso([{ hex: "#111111", papel: "primaria" }, { hex: "#222222", papel: "secundaria" }, { hex: "#333333", papel: "destaque" }]);
    expect(p.map((x) => x.parte)).toEqual([60, 30, 10]);
    const semDestaque = proporcaoDeUso([{ hex: "#111111", papel: "primaria" }, { hex: "#222222", papel: "secundaria" }]);
    expect(Math.round(semDestaque.reduce((s, x) => s + x.parte, 0))).toBe(100);
  });
});

// ------------------------------------------------------------------ 4. modelo de brandbook

function pngRgba(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const crc32 = (b: Uint8Array) => {
    let c = ~0;
    for (let i = 0; i < b.length; i++) {
      c ^= b[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (n: string, d: Uint8Array) => {
    const o = new Uint8Array(12 + d.length);
    const dv = new DataView(o.buffer);
    dv.setUint32(0, d.length);
    for (let i = 0; i < 4; i++) o[4 + i] = n.charCodeAt(i);
    o.set(d, 8);
    dv.setUint32(8 + d.length, crc32(o.subarray(4, 8 + d.length)));
    return o;
  };
  const cru = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    cru[y * (w * 4 + 1)] = y % 2 ? 1 : 0; // filtros Sub e None
    for (let x = 0; x < w; x++) {
      const p = pixel(x, y);
      const i = y * (w * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 4; k++) {
        const antes = y % 2 && x > 0 ? pixel(x - 1, y)[k] : 0;
        cru[i + k] = (p[k] - antes + 256) & 255;
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const partes = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(cru))), chunk("IEND", new Uint8Array())];
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

const LOGO = `${C}/marca/identidade/p1/logos/principal-1-previa.png`;
const DADOS_COMPLETOS = {
  marca: { nome: "Flora Viva", slogan: "Da raiz ao fruto" },
  conceito: { resumo: "Natureza viva.", significado_do_logo: "A folha é a raiz.", palavras: ["viva", "raiz"] },
  plataforma: { proposito: "Cuidar", missao: "Levar verde", valores: ["cuidado"], personalidade: ["calorosa", "direta"] },
  tom: { como_fala: ["curto"], como_nao_fala: ["jargão"] },
  logos: { principal: { caminho: `${C}/marca/identidade/p1/logos/principal-1.svg`, mime: "image/svg+xml", rotulo: "", previa_png: LOGO }, secundario: { caminho: `${OUTRO}/marca/x.png` } },
  cores: [{ nome: "Verde", papel: "primaria", hex: "#11bc76" }, { nome: "Tinta", papel: "primaria", hex: "#191D20" }, { nome: "verde repetido", papel: "secundaria", hex: "#11BC76" }, { nome: "ruim", hex: "zz" }],
  tipografia: [{ familia: "Readex Pro", uso: "titulo", pesos: ["400", "700"], licenca: "OFL" }],
  grafismos: [{ tipo: "pattern", descricao: "Folhas", imagem: null }],
  fotografia: { coloracao: "Luz natural" },
};

describe("Brandbook: modelos como dado, JSON seguro e PDF", () => {
  it("dois modelos: prancha-resumo (7 seções) e brandbook de 24 páginas com o que o pedido lista", () => {
    expect(MODELOS_DE_BRANDBOOK.map((m) => m.valor)).toEqual(["prancha", "paginado"]);
    expect(SECOES_DA_PRANCHA).toHaveLength(7);
    expect(PAGINAS_DO_BRANDBOOK).toHaveLength(24);
    expect(PAGINAS_DO_BRANDBOOK.map((p) => p.n)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    const ids = PAGINAS_DO_BRANDBOOK.map((p) => p.id);
    for (const id of ["conceito", "logo_principal", "grid", "protecao", "incorretos", "cores", "tipografia", "grafismos", "mockups", "tom", "arquivos"]) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(24);
  });

  it("normalizar: caminho de outro cliente sai, cor repetida ou inválida sai, usos incorretos têm padrão", () => {
    const d = normalizarBrandbook(DADOS_COMPLETOS, C);
    expect(d.logos.principal && d.logos.principal.previa_png).toBe(LOGO);
    expect(d.logos.secundario).toBeNull();
    expect(d.cores.map((c) => c.hex)).toEqual(["#11BC76", "#191D20"]);
    expect(d.regras.usos_incorretos).toEqual(USOS_INCORRETOS_PADRAO);
    expect(normalizarBrandbook({ logos: { principal: { caminho: "../../etc/senha" } } }).logos.principal).toBeNull();
  });

  it("estado das páginas e lacunas mostram o que falta (nada inventado)", () => {
    const vazio = normalizarBrandbook({}, C);
    expect(lacunasDoBrandbook("prancha", vazio)).toEqual(["nome da marca", "logo principal", "ao menos 2 cores", "grafismos ou pattern", "família tipográfica", "mockups (etapa Mockups)"]);
    const d = normalizarBrandbook(DADOS_COMPLETOS, C);
    const est = estadoDoModelo("paginado", d);
    expect(est.filter((p) => p.pronta).length).toBeGreaterThanOrEqual(18);
    expect(est.filter((p) => p.id === "mockups")[0].pronta).toBe(false);
  });

  it("o rascunho sai do projeto (naming, caminho escolhido, sistema) e do kit", () => {
    const d = brandbookDoProjeto({
      nomeDaMarca: "Cliente X",
      clientId: C,
      dados: {
        naming: { nome: "Flora Viva" },
        briefing: { publico: "bairro", personalidade: "calorosa, direta", evita: ["gritar"] },
        conceito: { escolhido: "c2", caminhos: [{ id: "c1", ideia: "não" }, { id: "c2", ideia: "Natureza viva", palavras: ["viva"], tom: ["curto"], arquetipo: "Cuidador" }] },
        sistema: { logos: DADOS_COMPLETOS.logos, tipografia: DADOS_COMPLETOS.tipografia },
      },
      kit: { paleta: [{ nome: "Kit", hex: "#123456", papel: "primaria" }] },
    });
    expect(d.marca.nome).toBe("Flora Viva");
    expect(d.conceito.resumo).toBe("Natureza viva");
    expect(d.plataforma.personalidade).toEqual(["calorosa", "direta"]);
    expect(d.plataforma.arquetipo).toBe("Cuidador");
    expect(d.tom.como_nao_fala).toEqual(["gritar"]);
    expect(d.cores.map((c) => c.hex)).toEqual(["#123456"]);
  });

  it("página pública: sem caminho de arquivo, cores com RGB e CMYK, token de 32", () => {
    const d = normalizarBrandbook(DADOS_COMPLETOS, C);
    expect(imagensDoBrandbook(d)).toEqual([LOGO]);
    const pub = brandbookPublico(d, { [LOGO]: "data:image/png;base64,AAAA" });
    const texto = JSON.stringify(pub);
    expect(texto).not.toContain(C);
    expect(texto).not.toContain("/marca/");
    expect((pub.cores as any[])[0]).toMatchObject({ hex: "#11BC76", rgb: { r: 17 }, cmyk: expect.any(Object) });
    const volta = dadosDoPublico(pub as any);
    expect(volta.dados.logos.principal && volta.imagens[volta.dados.logos.principal.previa_png as string]).toBe("data:image/png;base64,AAAA");
    const t = tokenPublico(new Uint8Array(32).map((_, i) => i * 7));
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(() => tokenPublico(new Uint8Array(16))).toThrow();
  });

  it("PDF: 24 páginas A4 deitado e a prancha numa página só, com a logo real (PNG com transparência)", async () => {
    const png = pngRgba(8, 4, (x) => [17, 188, 118, x < 4 ? 255 : 0]);
    const aberto = await abrirPng(png);
    expect(aberto && aberto.largura).toBe(8);
    expect(aberto && aberto.alfa && aberto.alfa[7]).toBe(0);
    expect(aberto && Array.from(aberto.rgb.slice(0, 3))).toEqual([17, 188, 118]);
    const imagens = await prepararImagens({ [LOGO]: png, "ruim.png": new Uint8Array([1, 2, 3]) });
    expect(Object.keys(imagens)).toEqual([LOGO]);
    expect(imagens[LOGO].mascara).not.toBeNull();
    const d = normalizarBrandbook(DADOS_COMPLETOS, C);
    const paginado = gerarPdfDoBrandbook({ modelo: "paginado", dados: d, versao: 3, imagens, data: "2026-09-30T12:00:00Z" });
    expect(paginasDoPdf(paginado)).toBe(24);
    const textos = textosDoPdf(paginado).join(" | ");
    expect(textos).toContain("MANUAL DA MARCA");
    expect(textos).toContain("#11BC76");
    expect(textos).toContain("R 17  G 188  B 118");
    expect(textos).toContain("CMYK calculado por código");
    expect(textos).not.toMatch(/[–—]/);
    const bruto = new TextDecoder("latin1").decode(paginado);
    expect(bruto).toContain("/SMask");
    const prancha = gerarPdfDoBrandbook({ modelo: "prancha", dados: d, versao: 3, imagens });
    expect(paginasDoPdf(prancha)).toBe(1);
    expect(textosDoPdf(prancha).join(" ")).toContain("PALETA DE CORES");
  });

  it("JPEG entra como está (medidas pelo marcador SOF)", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 0, 0, 0, 0xff, 0xd9]);
    expect(medidasDoJpeg(jpeg)).toEqual({ altura: 20, largura: 30, canais: 3 });
    const img = await imagemParaPdf(jpeg);
    expect(img).toMatchObject({ filtro: "DCTDecode", largura: 30, altura: 20, mascara: null });
  });

  it("PDF do naming: finalistas com a justificativa e a lista inteira", () => {
    const lista = escolherFinalistas(normalizarCandidatos({ candidatos: CANDIDATOS }), 3);
    const pdf = gerarPdfDoNaming({ cliente: "Cliente X", alvo: "nome da marca", criterios: ["curto"], candidatos: lista });
    const t = textosDoPdf(pdf).join(" | ");
    expect(t).toContain("Flora Viva");
    expect(t).toContain("une natureza e vida");
    expect(t).toContain("TODOS OS NOMES");
    expect(paginasDoPdf(pdf)).toBeGreaterThanOrEqual(2);
  });
});

// ------------------------------------------------------------------ 5. briefing (frente BRF ou antigo)

describe("Briefing da identidade", () => {
  it("lê o formato da frente BRF (responses.respostas) e o antigo; o que falta vira pergunta", () => {
    expect(respostasDoBriefing({ template_id: "t", respostas: { negocio: "Padaria" } })).toEqual({ negocio: "Padaria" });
    const b = montarBriefingDaIdentidade({
      respostas: respostasDoBriefing({ companyDescription: "Padaria de bairro", idealClient: "famílias", atributos: ["calorosa", "simples"] }),
      briefingId: "b1",
      contexto: { nicho: "panificação" },
      salvo: { publico: "vizinhos" },
    });
    expect(b.campos.negocio).toEqual({ valor: "Padaria de bairro", fonte: "briefing" });
    expect(b.campos.publico).toEqual({ valor: "vizinhos", fonte: "equipe" });
    expect(b.campos.personalidade).toEqual({ valor: ["calorosa", "simples"], fonte: "briefing" });
    expect(b.campos.segmento).toEqual({ valor: "panificação", fonte: "contexto" });
    expect(b.lacunas.slice(0, 2)).toEqual(["Onde a marca atua (cidade, região, online)?", "Quem são os concorrentes diretos?"]);
    expect(b.origem).toEqual({ briefing_id: "b1", respondido: true });
    const vazio = montarBriefingDaIdentidade({});
    expect(vazio.lacunas.slice(0, 3)).toEqual(["O que o negócio faz, em uma frase?", "Quem é o público prioritário e o que ele busca?", "Quais 3 a 5 palavras descrevem a personalidade da marca?"]);
  });
});

// ------------------------------------------------------------------ 6. diretor de marca e aprovação

describe("Diretor de marca: ações com apelido, na hora ou com Confirmar", () => {
  const alvos = alvosDoDiretor({
    projeto: { id: "p-1", titulo: "Marca nova", etapa: "conceito" },
    caminhos: [{ id: "c1", nome: "Raiz" }, { id: "c2", nome: "Folha" }],
    rodada: { id: "r-1", candidatos: [{ id: "n1", nome: "Alfa", finalista: false }, { id: "n2", nome: "Beta", finalista: true, nota: 0.9 }] },
    brandbook: { id: "b-1", versao: 2, modelo: "paginado", status: "rascunho", tem_logo: false },
  });

  it("apelidos p1, c1..c2, n1.. (finalistas primeiro) e b1", () => {
    expect(alvos.projeto.map((a) => a.ref)).toEqual(["p1"]);
    expect(alvos.caminhos.map((a) => [a.ref, a.id])).toEqual([["c1", "p-1:c1"], ["c2", "p-1:c2"]]);
    expect(alvos.nomes.map((a) => [a.ref, a.titulo])).toEqual([["n1", "Beta"], ["n2", "Alfa"]]);
    expect(alvos.brandbook[0].ref).toBe("b1");
  });

  it("escolher e concluir vão na hora; IA tem custo no cartão; envio sem logo é recusado", () => {
    const direta = normalizarAcoesDoDiretor({ resumo: "x", itens: [{ operacao: "escolher_caminho", ref: "c2", para: "" }, { operacao: "concluir_etapa", ref: "p1", para: "conceito" }] }, alvos, {});
    expect(direta && direta.itens.map((i) => [i.operacao, i.alvo_id, i.para])).toEqual([["escolher_caminho", "p-1:c2", null], ["concluir_etapa", "p-1", "conceito"]]);
    expect(podeExecutarDireto(direta!, regrasDoDiretor(), { pedidoClaro: true }).direto).toBe(true);
    const ia = normalizarAcoesDoDiretor({ resumo: "x", itens: [{ operacao: "gerar_nomes", ref: "p1", para: "" }] }, alvos, { gerar_nomes: 0.0123 });
    expect(ia && ia.custo_estimado_usd).toBe(0.0123);
    expect(podeExecutarDireto(ia!, regrasDoDiretor(), { pedidoClaro: true }).direto).toBe(false);
    const envio = normalizarAcoesDoDiretor({ resumo: "x", itens: [{ operacao: "enviar_para_aprovacao", ref: "b1", para: "" }] }, alvos, {});
    expect(envio && envio.recusados[0].motivo).toContain("logo principal");
    const inventado = normalizarAcoesDoDiretor({ resumo: "x", itens: [{ operacao: "escolher_nome", ref: "n9", para: "" }] }, alvos, {});
    expect(inventado).toBeNull();
    expect(respostaPromete("Vou gerar os nomes agora")).toBe(true);
    expect(pedidoSobreNome("não gostei desses nomes")).toBe(true);
  });

  it("aprovação: PDF em Arquivos com a revisão da agência; grupo só registra (o Hermes envia)", () => {
    const comum = ler("supabase/functions/mesa-identidade/comum.ts");
    expect(comum).toContain('rpc("request_file_agency_review"');
    expect(comum).toContain('rpc("create_file_record"');
    const naming = ler("supabase/functions/mesa-identidade/naming-acoes.ts");
    expect(naming).toContain("naming_grupo");
    expect(naming).toContain("enviado_grupo_em: agora");
    expect(naming).toContain("jevPerguntar(e)");
    expect(textoDaAprovacao({ agency_approval_status: "pending", approval_status: "none" })).toBe("Na revisão da agência");
    expect(textoDaAprovacao({ agency_approval_status: "approved", approval_status: "approved" })).toBe("Aprovado pelo cliente");
    // Conselho de agentes (frente CNS): gancho pronto, hoje a recomendação é o Jev (aviso).
    const gancho = ler("supabase/functions/mesa-identidade/conselho-gancho.ts");
    expect(gancho).toContain("CONSELHO_NO_MAIN = false");
    expect(gancho).toContain('type: "choice"');
  });

  it("aprende: identidade (arte) e naming (textos) entram nas mesas que aprendem", () => {
    expect(MESAS_QUE_APRENDEM).toEqual(expect.arrayContaining(["identidade", "naming"]));
    expect(AREA_DA_MESA.identidade).toBe("arte");
    expect(AREA_DA_MESA.naming).toBe("copy");
    expect(FONTE_DA_MESA.naming).toBe("mesa_naming");
    const diretor = ler("supabase/functions/mesa-identidade/diretor.ts");
    expect(diretor).toContain("gravarTroca(servico()");
    expect(diretor).toContain('regrasDaMesa(servico(), { clientId, mesa: "naming", marcaId })');
  });
});

// ------------------------------------------------------------------ 7. esqueleto das mesas e banco

describe("Mesa Identidade no esqueleto das mesas", () => {
  it("rota, pré-carga (fora da ociosa), troca de mesas, clientes e mapa", () => {
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-identidade"].etapas)).toEqual(ETAPAS_DA_IDENTIDADE.map((e) => e.valor));
    expect(etapaQueVaiAbrir("/mesa-identidade", `?client=${C}`)).toBe("inicio");
    expect(cargasDaMesa("/mesa-identidade", `?client=${C}&etapa=sistema`).map(([k]) => k)).toEqual(["pagina/mesa-identidade", "mesa-identidade/sistema", "mesa-identidade/agente"]);
    const pre = ler("src/lib/mesa/preCarga.ts");
    const primeiras = pre.slice(pre.indexOf("const PRIMEIRAS"), pre.indexOf("];", pre.indexOf("const PRIMEIRAS")));
    expect(primeiras).not.toContain("identidade");
    expect(MESAS.some((m) => m.valor === "identidade" && m.caminho === "/mesa-identidade")).toBe(true);
    expect(enderecoDaMesa("identidade", C)).toBe(`/mesa-identidade?client=${C}`);
    expect(NOME_DA_MESA.identidade).toBe("Mesa Identidade");
    expect(montarClientesDaMesa("identidade", [{ id: C, company_name: "Avulso", plan_status: "inactive", client_type: "one_off" }], []).visiveis).toHaveLength(1);
    expect(AREAS_DO_PAINEL.some((a) => a.chave === "mesa_identidade")).toBe(true);
    expect(AGENTES_DO_PAINEL.some((g) => g.chave === "identidade" && g.funcao === "mesa-identidade")).toBe(true);
    expect(areaPorPalavras("preciso do brandbook da marca")!.area).toBe("mesa_identidade");
    const dono = {};
    definirMarcaAtual(C, { id: OUTRO, client_id: C, nome: "CME", principal: false } as any, dono);
    expect(corpoComMarca("mesa-identidade", { client_id: C }).marca_id).toBe(OUTRO);
    limparMarcaAtual(dono);
    const app = ler("src/App.tsx");
    expect(app).toContain('<Route path="/mesa-identidade"');
    expect(app).toContain('<Route path="/marca/:token"');
    expect(ler("supabase/config.toml")).toContain("[functions.mesa-identidade]\n    verify_jwt = true");
  });

  it("migration: só amplia, RLS por cliente, escrita só pelo servidor, página pública por token", () => {
    const sql = ler("supabase/migrations/20260930060000_mesa_identidade.sql");
    const codigo = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(codigo).not.toMatch(/DROP TABLE|DROP POLICY IF EXISTS (?!idv_)|DELETE FROM|TRUNCATE/i);
    expect(codigo).not.toMatch(/can_access_client\s*\(\s*_client_id uuid/i);
    expect(codigo).toContain("unnest(_valores || ARRAY['identidade'])");
    expect(codigo).toContain("string_to_array(substring(_def from");
    for (const t of ["idv_projetos", "idv_naming_rodadas", "idv_brandbooks", "idv_eventos"]) {
      expect(codigo).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      expect(codigo).toMatch(new RegExp(`CREATE POLICY ${t}_staff_read ON public\\.${t}\\s+FOR SELECT TO authenticated USING \\(public\\.is_staff\\(\\(select auth\\.uid\\(\\)\\)\\) AND public\\.can_access_client\\(client_id\\)\\)`));
    }
    expect(codigo).toContain("REVOKE INSERT, UPDATE, DELETE ON public.idv_projetos, public.idv_naming_rodadas, public.idv_brandbooks, public.idv_eventos FROM authenticated");
    expect(codigo).toContain("GRANT EXECUTE ON FUNCTION public.idv_brandbook_publico(text) TO anon");
    expect(codigo).toContain("AND b.revogado_em IS NULL");
    expect(codigo).toMatch(/\^\[A-Za-z0-9_-\]\{32\}\$/);
  });
});

// ------------------------------------------------------------------ 8. prévia em HTML (a mesma da página pública)


describe("Prévia do brandbook em HTML", () => {
  it("24 páginas no paginado (as incompletas marcadas) e a prancha com a logo real", () => {
    const d = normalizarBrandbook(DADOS_COMPLETOS, C);
    const urlDe = (c: string | null | undefined) => (c === LOGO ? "https://x.test/logo.png" : null);
    const { container, unmount } = render(h(VisaoDoBrandbook, { dados: d, modelo: "paginado", urlDe }));
    expect(container.querySelectorAll("[data-pagina-do-brandbook]")).toHaveLength(24);
    expect(screen.getAllByText("falta preencher").length).toBeGreaterThan(0);
    unmount();
    render(h(VisaoDoBrandbook, { dados: d, modelo: "prancha", urlDe }));
    expect(screen.getByText("MANUAL DA MARCA")).toBeTruthy();
    expect(screen.getAllByRole("img").some((i) => i.getAttribute("src") === "https://x.test/logo.png")).toBe(true);
    expect(screen.getByText("HEX #11BC76")).toBeTruthy();
  });
});
