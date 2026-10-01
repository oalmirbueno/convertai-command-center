/**
 * Estúdio de mockups, rodada 2 (frente MCK, 30/09): mais mockups (PSDs recuperados e feitos com
 * IA, categorias fachada e sinalização, fundo trocável) e funções melhores (ajustes por mockup,
 * variações de cor, posição, giro, padrão, luz, fundo da cena, ZIP e acervo).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ajustesDoItem, AJUSTES_PADRAO, ANCORAS, chaveDosAjustes, normalizarAjustes, soOQueMuda, variacoesDeCor } from "@/lib/mockups/ajustes";
import { comporMockup, ganhoMedioPorSlot, RAZAO_MAX_DO_FUNDO, type CamadasDoMockup, type ImagemRGBA } from "@/lib/mockups/composicao";
import { caixaDaLogo, posicoesDoPadrao, varianteForcada } from "@/lib/mockups/designDoSlot";
import { buscarMockups, CATEGORIAS, filtrarPorFonte, normalizarMockup, ordenarNaSequencia } from "@/lib/mockups/catalogo";
import { ajustarCor, fundoDosAjustes } from "@/lib/mockups/fundoDaCena";
import { nomeDeArquivo, nomesUnicos } from "@/lib/mockups/baixar";
import { TIPOS_DE_CENA as TIPOS_NA_TELA } from "@/lib/mockups/cenas";
import { distribuicaoDaLogo, escolherVarianteDaLogo, lumaDaLogo, lumaDoHex, parteIlegivel } from "@/lib/mockups/varianteDaLogo";
import { aplicarCuradoria, caminhosDoMockup, CATEGORIAS as CATEGORIAS_DO_SCRIPT, enviosDoMockup, linhaDoCatalogo } from "../../tools/mockups/catalogo-linhas.mjs";
import { promptDaCena, TAMANHO_DA_CENA, TIPOS_DE_CENA } from "../../supabase/functions/mesa-mockups/sugestao";
import { type ArquivoDoAcervo, type BancoDoAcervo, guardarMockupNoAcervo, type MarcaDoAcervo } from "../../supabase/functions/mesa-mockups/acervo";

function camadasDeUmPixel(p: { base: number; vazio: number; ganho: number; slot: number; objeto?: number; luzDoFundo?: number }): CamadasDoMockup {
  const px = (v: number) => new Uint8ClampedArray([v, v, v, 255]);
  return {
    largura: 1,
    altura: 1,
    base: px(p.base),
    vazio: px(p.vazio),
    ganho: px(p.ganho),
    uv: new Uint8ClampedArray([128, 128, 0, 255]),
    mapa: new Uint8ClampedArray([p.slot, 0, 0, 255]),
    fundo: typeof p.objeto === "number" ? new Uint8ClampedArray([p.objeto, Math.round(((p.luzDoFundo ?? 1) / RAZAO_MAX_DO_FUNDO) * 255), 0, 255]) : null,
  };
}

const branco: ImagemRGBA = { largura: 1, altura: 1, pixels: new Uint8ClampedArray([255, 255, 255, 255]) };

describe("ajustes por mockup (o geral com os do item por cima)", () => {
  it("guardado estranho vira ajuste válido; o que falta vem do padrão", () => {
    const a = normalizarAjustes({ fundo: "2", escala: 9, posicaoX: -4, variante: "roxa", luz: 1.2, fundoCena: "degrade" });
    expect(a.fundo).toBe(2);
    expect(a.escala).toBe(1);
    expect(a.posicaoX).toBe(-1);
    expect(a.variante).toBe("auto");
    expect(a.luz).toBe(1.2);
    expect(a.fundoCena).toBe("degrade");
    expect(a.brilho).toBe(1);
    expect(normalizarAjustes(null)).toEqual(AJUSTES_PADRAO);
  });

  it("o item herda o geral e guarda só o que muda", () => {
    const geral = { ...AJUSTES_PADRAO, fundo: 1, luz: 0.8 };
    const item = ajustesDoItem(geral, { posicaoX: 1, rotacao: 15 });
    expect(item.fundo).toBe(1);
    expect(item.luz).toBe(0.8);
    expect(item.posicaoX).toBe(1);
    expect(soOQueMuda(geral, item)).toEqual({ posicaoX: 1, rotacao: 15 });
    expect(soOQueMuda(geral, geral)).toEqual({});
    expect(ajustesDoItem(geral, undefined)).toBe(geral);
  });

  it("a chave muda quando o ajuste ou o kit mudam (o lote só remonta o que mudou)", () => {
    const a = AJUSTES_PADRAO;
    expect(chaveDosAjustes(a, "kit1")).toBe(chaveDosAjustes({ ...a }, "kit1"));
    expect(chaveDosAjustes({ ...a, rotacao: 5 }, "kit1")).not.toBe(chaveDosAjustes(a, "kit1"));
    expect(chaveDosAjustes(a, "kit2")).not.toBe(chaveDosAjustes(a, "kit1"));
  });

  it("variações de cor: pares diferentes, sem repetir, até o máximo", () => {
    expect(variacoesDeCor(1)).toEqual([{ fundo: 0, segunda: 0 }]);
    const tres = variacoesDeCor(3, 8);
    expect(tres).toHaveLength(6);
    expect(tres.every((v) => v.fundo !== v.segunda)).toBe(true);
    expect(new Set(tres.map((v) => `${v.fundo}-${v.segunda}`)).size).toBe(6);
    expect(tres[0]).toEqual({ fundo: 0, segunda: 1 });
    expect(variacoesDeCor(6, 8)).toHaveLength(8);
  });

  it("9 posições rápidas, do canto superior esquerdo ao inferior direito", () => {
    expect(ANCORAS).toHaveLength(9);
    expect(ANCORAS[0]).toMatchObject({ x: -1, y: -1 });
    expect(ANCORAS[4]).toMatchObject({ x: 0, y: 0 });
    expect(ANCORAS[8]).toMatchObject({ x: 1, y: 1 });
  });
});

describe("posição, giro, padrão e versão da logo", () => {
  it("a posição desliza a logo até a borda da área segura", () => {
    const area: [number, number, number, number] = [0.1, 0.1, 0.9, 0.9];
    const centro = caixaDaLogo(area, 1000, 1000, 100, 50, 0.5);
    const esquerda = caixaDaLogo(area, 1000, 1000, 100, 50, 0.5, { x: -1, y: -1 });
    const direita = caixaDaLogo(area, 1000, 1000, 100, 50, 0.5, { x: 1, y: 1 });
    expect(esquerda.x).toBeCloseTo(100);
    expect(esquerda.y).toBeCloseTo(100);
    expect(direita.x + direita.w).toBeCloseTo(900);
    expect(direita.y + direita.h).toBeCloseTo(900);
    expect(centro.x).toBeCloseTo((esquerda.x + direita.x) / 2);
  });

  it("o padrão cobre a arte inteira, com folga nas bordas", () => {
    const p = posicoesDoPadrao(1000, 600, 80, 40);
    expect(p.length).toBeGreaterThan(20);
    expect(Math.min(...p.map((q) => q.x))).toBeLessThan(0);
    expect(Math.max(...p.map((q) => q.x)) + 80).toBeGreaterThan(1000);
    expect(Math.max(...p.map((q) => q.y)) + 40).toBeGreaterThan(600);
    expect(posicoesDoPadrao(100000, 100000, 1, 1).length).toBeLessThanOrEqual(600);
  });

  it("a versão pedida vence a automática; auto mantém a regra do contraste", () => {
    const auto = { variante: { tipo: "branca" as const }, contraste: 9, motivo: "x" };
    expect(varianteForcada(auto, "auto", [{ id: "principal" }])).toBe(auto);
    expect(varianteForcada(auto, "preta", []).variante).toEqual({ tipo: "preta" });
    expect(varianteForcada(auto, "original", [{ id: "principal" }]).variante).toEqual({ tipo: "original", id: "principal" });
  });
});

/** Imagem RGBA de teste: `cor(x, y)` devolve [r, g, b, a] ou null (transparente). */
function imagemDeTeste(w: number, h: number, cor: (x: number, y: number) => number[] | null): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cor(x, y);
      if (c) px.set(c.length === 4 ? c : c.concat([255]), (y * w + x) * 4);
    }
  }
  return px;
}

describe("versão da logo mais esperta: nenhum pedaço da marca pode sumir", () => {
  // Logo branca e verde #00a500 (o caso da Aceleriq: "Aceler" branco e "iq" verde), com margem transparente.
  const W = 32;
  const H = 12;
  const pixels = imagemDeTeste(W, H, (x, y) => (y < 2 || y > 9 || x < 2 || x > 29 ? null : x <= 20 ? [255, 255, 255] : [0, 165, 0]));
  const logo = { id: "principal", luminancia: lumaDaLogo(pixels), distribuicao: distribuicaoDaLogo(pixels, W) };

  it("a distribuição separa o branco do verde da borda e ignora o transparente", () => {
    expect(logo.distribuicao.reduce((t, f) => t + f.peso, 0)).toBeCloseTo(1);
    expect(logo.distribuicao).toHaveLength(2);
    const verde = parteIlegivel(logo.distribuicao, lumaDoHex("#00a500")!);
    expect(verde).toBeGreaterThan(0.25);
    expect(verde).toBeLessThan(0.4);
    expect(parteIlegivel(logo.distribuicao, lumaDoHex("#0b0b0b")!)).toBe(0);
  });

  it("no fundo verde da marca, a logo branca e verde vira branca chapada (o 'iq' não some)", () => {
    const e = escolherVarianteDaLogo(lumaDoHex("#00a500"), [logo]);
    expect(e.variante).toEqual({ tipo: "branca" });
    expect(e.motivo).toMatch(/some na superfície/);
  });

  it("no fundo preto, a logo do kit fica como veio", () => {
    expect(escolherVarianteDaLogo(lumaDoHex("#0b0b0b"), [logo]).variante).toEqual({ tipo: "original", id: "principal" });
  });

  it("sem distribuição (logo antiga), a regra da média continua igual", () => {
    expect(escolherVarianteDaLogo(lumaDoHex("#0b0b0b"), [{ id: "principal", luminancia: logo.luminancia }]).variante.tipo).toBe("original");
  });

  it("selo verde-escuro com texto branco dentro, em papel branco ou creme: fica a logo do kit (o miolo não conta)", () => {
    // Círculo #0b5d1e de raio 14 com uma faixa de texto branco no meio (~30% da logo).
    const L = 32;
    const selo = imagemDeTeste(L, L, (x, y) => {
      const dx = x - 15.5;
      const dy = y - 15.5;
      if (dx * dx + dy * dy > 14 * 14) return null;
      return Math.abs(dy) < 4.5 && Math.abs(dx) < 11 ? [255, 255, 255] : [11, 93, 30];
    });
    const branco = selo.reduce((t, v, i) => (i % 4 === 0 && v === 255 && selo[i + 3] === 255 ? t + 1 : t), 0);
    const opacos = selo.reduce((t, v, i) => (i % 4 === 3 && v === 255 ? t + 1 : t), 0);
    expect(branco / opacos).toBeGreaterThan(0.25);
    const kit = [{ id: "principal", luminancia: lumaDaLogo(selo), distribuicao: distribuicaoDaLogo(selo, L) }];
    for (const papel of ["#ffffff", "#f4f1ea"]) {
      const e = escolherVarianteDaLogo(lumaDoHex(papel), kit);
      expect(e.variante).toEqual({ tipo: "original", id: "principal" });
    }
    // A logo inteira (sem a largura) recusaria: é exatamente o defeito que a silhueta corrige.
    expect(parteIlegivel(distribuicaoDaLogo(selo), lumaDoHex("#ffffff")!)).toBeGreaterThan(0.08);
  });

  it("logo preta com miolo branco (~10%) em papel branco: fica a logo do kit", () => {
    const L = 30;
    const contorno = imagemDeTeste(L, L, (x, y) => {
      if (x < 2 || y < 2 || x > 27 || y > 27) return null;
      return x >= 11 && x <= 18 && y >= 11 && y <= 18 ? [255, 255, 255] : [0, 0, 0];
    });
    const kit = [{ id: "principal", luminancia: lumaDaLogo(contorno), distribuicao: distribuicaoDaLogo(contorno, L) }];
    expect(escolherVarianteDaLogo(lumaDoHex("#ffffff"), kit).variante).toEqual({ tipo: "original", id: "principal" });
    // No preto a borda preta some: aí sim vai a branca chapada.
    expect(escolherVarianteDaLogo(lumaDoHex("#000000"), kit).variante).toEqual({ tipo: "branca" });
  });

  it("logo sem transparência (retângulo cheio): a borda da imagem conta como silhueta", () => {
    const cheia = imagemDeTeste(10, 10, (x, y) => (x > 2 && x < 7 && y > 2 && y < 7 ? [0, 0, 0] : [255, 255, 255]));
    const d = distribuicaoDaLogo(cheia, 10);
    expect(d).toHaveLength(1);
    expect(d[0].luma).toBeCloseTo(1);
  });
});

describe("luz da cena e fundo trocável (mesma conta do shader)", () => {
  it("luz 1 e brilho 1 dão exatamente a conta de antes", () => {
    const c = camadasDeUmPixel({ base: 10, vazio: 200, ganho: 150, slot: 1 });
    expect(Array.from(comporMockup(c, [branco]))).toEqual(Array.from(comporMockup(c, [branco], undefined, { luz: 1, brilho: 1 })));
    expect(comporMockup(c, [branco])[0]).toBe(160);
  });

  it("luz 0 deixa o design chapado no ganho médio do slot; brilho multiplica a cor", () => {
    const c = camadasDeUmPixel({ base: 0, vazio: 200, ganho: 100, slot: 1 });
    expect(comporMockup(c, [branco], undefined, { luz: 0, ganhoMedio: [0.8] })[0]).toBe(204);
    expect(comporMockup(c, [branco], undefined, { luz: 1.5, ganhoMedio: [0.8] })[0]).toBe(48);
    expect(comporMockup(c, [branco], undefined, { brilho: 1.2 })[0]).toBe(120);
  });

  it("o fundo novo entra onde não há objeto, com a sombra guardada; o objeto fica", () => {
    const novo = new Uint8ClampedArray([200, 100, 50, 255]);
    const fundo = camadasDeUmPixel({ base: 236, vazio: 236, ganho: 0, slot: 0, objeto: 0, luzDoFundo: 0.5 });
    const r = comporMockup(fundo, [], undefined, { novoFundo: novo });
    expect(r[0]).toBeCloseTo(100, -1);
    expect(r[1]).toBeCloseTo(50, -1);
    const objeto = camadasDeUmPixel({ base: 90, vazio: 90, ganho: 0, slot: 0, objeto: 255 });
    expect(comporMockup(objeto, [], undefined, { novoFundo: novo })[0]).toBe(90);
    // Sem a camada, o fundo pedido não muda nada (mockup sem fundo trocável).
    expect(comporMockup(camadasDeUmPixel({ base: 90, vazio: 90, ganho: 0, slot: 0 }), [], undefined, { novoFundo: novo })[0]).toBe(90);
  });

  it("ganho médio por slot ignora onde o design não aparece", () => {
    const ganho = new Uint8ClampedArray([204, 204, 204, 255, 0, 0, 0, 255, 102, 102, 102, 255]);
    const mapa = new Uint8ClampedArray([1, 0, 0, 255, 1, 0, 0, 255, 2, 0, 0, 255]);
    const g = ganhoMedioPorSlot(ganho, mapa, 3);
    expect(g[0]).toBeCloseTo(0.8);
    expect(g[1]).toBeCloseTo(0.4);
    expect(g[2]).toBe(1);
  });

  it("fundo pelos ajustes: original não desenha; degradê vai para a cor seguinte", () => {
    expect(fundoDosAjustes({ fundoCena: "original", corDoFundoCena: 0, opacidade: 0.3 }, ["#112233"], null)).toBeNull();
    const d = fundoDosAjustes({ fundoCena: "degrade", corDoFundoCena: 1, opacidade: 0.3 }, ["#112233", "#445566", "#778899"], null)!;
    expect(d.cor).toBe("#445566");
    expect(d.cor2).toBe("#778899");
    expect(fundoDosAjustes({ fundoCena: "textura", corDoFundoCena: 0, opacidade: 0.3 }, ["#112233"], null)!.tipo).toBe("cor");
    expect(ajustarCor("#000000", 1.5)).toBe("#808080");
    expect(ajustarCor("#ffffff", 0.5)).toBe("#808080");
    expect(ajustarCor("xyz", 1)).toBe("#ececec");
  });
});

describe("catálogo maior: PSDs recuperados, mockups de IA e categorias novas", () => {
  const metaIa = {
    id: "ia-embalagem-sacola",
    nome: "Sacola de papel (IA)",
    categoria: "sacola",
    tags: ["sacola", "ia"],
    fonte: "ia",
    fundo_trocavel: true,
    largura: 1024,
    altura: 1536,
    largura_trabalho: 853,
    altura_trabalho: 1280,
    luminancia_media: 0.9,
    versao_pipeline: 3,
    slots: [{ indice: 1, papel: "arte", nome: "superfície lisa", so_px: [1300, 1700], area_segura: [0, 0, 1, 1], luminancia_superficie: 0.95, px_na_tela: 850 }],
    qualidade: { aprovado: true, diferenca: 0, limite: 2, metodo: "ia: design branco devolve o papel da cena; cantos automatica", avisos: [] },
    bytes: { alta: { "base.jpg": 1 }, trabalho: {}, thumb: 1 },
  };

  it("curadoria: vista repetida sobe guardada (ativo=false) e some da tela; cada pacote mantém 2 ou mais vistas", () => {
    const itens = aplicarCuradoria([metaIa, { ...metaIa, id: "dispositivo-tablet-002" }], { inativos: { "dispositivo-tablet-002": "repetida" } });
    expect(linhaDoCatalogo(itens[0]).linha.ativo).toBe(true);
    const guardada = linhaDoCatalogo(itens[1]).linha;
    expect(guardada.ativo).toBe(false);
    expect(normalizarMockup(guardada)).toBeNull();
    const cur = JSON.parse(readFileSync("tools/mockups/curadoria-catalogo.json", "utf8")) as { inativos: Record<string, string> };
    const ids = Object.keys(cur.inativos);
    expect(ids.length).toBeGreaterThan(0);
    // Os pacotes que dominavam a sugestão continuam com vistas ativas.
    for (const fica of ["dispositivo-tablet-001", "dispositivo-tablet-003", "dispositivo-tablet-005", "outdoor-tela-1", "outdoor-tela-2", "outdoor-tela-6", "dispositivo-iphone-15-01", "dispositivo-gadgets-06-1", "dispositivo-gadgets-07-3149"]) {
      expect(ids).not.toContain(fica);
    }
  });

  it("mockup de IA com fundo trocável sobe com o fundo.png e volta marcado na tela", () => {
    const { linha, erro } = linhaDoCatalogo(metaIa);
    expect(erro).toBeUndefined();
    expect(linha.fonte).toBe("ia");
    expect(linha.caminhos.alta.fundo).toBe("catalogo/ia-embalagem-sacola/alta/fundo.png");
    expect(linha.qualidade.metodo).toMatch(/^ia:/);
    const m = normalizarMockup(linha)!;
    expect(m.fonte).toBe("ia");
    expect(m.fundoTrocavel).toBe(true);
    expect(enviosDoMockup("ia-embalagem-sacola", "C:/x", true)).toHaveLength(13);
    expect(caminhosDoMockup("x-1").alta.fundo).toBeUndefined();
  });

  it("PSD continua PSD, sem fundo trocável; linha antiga sem 'fonte' também", () => {
    const { linha } = linhaDoCatalogo({ ...metaIa, id: "cartao-2", fonte: undefined, fundo_trocavel: undefined, categoria: "cartao" });
    expect(linha.fonte).toBe("psd");
    const m = normalizarMockup({ ...linha, fonte: undefined })!;
    expect(m.fonte).toBe("psd");
    expect(m.fundoTrocavel).toBe(false);
  });

  it("fachada e sinalização entram, no fim da sequência (exterior)", () => {
    expect(linhaDoCatalogo({ ...metaIa, id: "ia-fachada-loja", categoria: "fachada" }).erro).toBeUndefined();
    expect(linhaDoCatalogo({ ...metaIa, id: "ia-totem", categoria: "sinalizacao" }).erro).toBeUndefined();
    const base = normalizarMockup(linhaDoCatalogo(metaIa).linha)!;
    const itens = [
      { ...base, id: "totem", categoria: "sinalizacao" as const, nome: "Totem" },
      { ...base, id: "cartao", categoria: "cartao" as const, nome: "Cartão" },
      { ...base, id: "van", categoria: "veiculo" as const, nome: "Van" },
      { ...base, id: "loja", categoria: "fachada" as const, nome: "Loja" },
    ];
    expect(ordenarNaSequencia(itens).map((i) => i.id)).toEqual(["cartao", "loja", "totem", "van"]);
  });

  it("as três listas de categorias batem: tela, script de subida e a CHECK da migration", () => {
    const naTela = CATEGORIAS.map((c) => c.id).sort();
    expect(naTela).toEqual([...CATEGORIAS_DO_SCRIPT].sort());
    const sql = readFileSync("supabase/migrations/20260930322000_mockups_mais_modelos.sql", "utf8");
    const bloco = /categoria IN \(([\s\S]*?)\)\);/.exec(sql)![1];
    const naCheck = (bloco.match(/'([a-z-]+)'/g) || []).map((s) => s.replace(/'/g, "")).sort();
    expect(naCheck).toEqual(naTela);
    expect(sql).toMatch(/fonte IN \('psd', 'ia'\)/);
  });

  it("filtro por origem e busca sem acento", () => {
    const base = normalizarMockup(linhaDoCatalogo(metaIa).linha)!;
    const psd = { ...base, id: "caneca-xicara-2", nome: "Caneca e copo · xícara", fonte: "psd" as const, tags: ["xicara", "cafe"], categoria: "caneca" as const };
    const lista = [base, psd];
    expect(filtrarPorFonte(lista, "ia").map((m) => m.id)).toEqual(["ia-embalagem-sacola"]);
    expect(filtrarPorFonte(lista, "todos")).toHaveLength(2);
    expect(buscarMockups(lista, "Café").map((m) => m.id)).toEqual(["caneca-xicara-2"]);
    expect(buscarMockups(lista, "XICARA")).toHaveLength(1);
    expect(buscarMockups(lista, "  ")).toHaveLength(2);
  });
});

describe("cenas sob medida (IA desenha a superfície lisa; a marca entra pelo código)", () => {
  const cliente = { nome: "Padaria Sol", negocio: "padaria de bairro", publico: null, oferta: null, estilo: null };

  it("todo tipo pede superfície lisa, proíbe texto e logo e tem tamanho", () => {
    for (const t of TIPOS_DE_CENA) {
      const p = promptDaCena(t, cliente, ["#aa0000"], "");
      expect(p).toContain("Nenhum texto");
      expect(p).toMatch(/branca/);
      expect(p).toContain("padaria de bairro");
      expect(TAMANHO_DA_CENA[t]).toMatch(/^\d+x\d+$/);
    }
  });

  it("a tela oferece exatamente os tipos que a função aceita", () => {
    expect(TIPOS_NA_TELA.map((t) => t.id).sort()).toEqual([...TIPOS_DE_CENA].sort());
  });
});

describe("baixar em alta", () => {
  it("nome de arquivo seguro e sem repetição no ZIP", () => {
    expect(nomeDeArquivo("Cartão de visita · colorido", "png")).toBe("Cartao-de-visita-colorido.png");
    expect(nomeDeArquivo("", ".zip")).toBe("mockup.zip");
    expect(nomesUnicos(["a.png", "a.png", "b.png", "a.png"])).toEqual(["a.png", "a-2.png", "b.png", "a-3.png"]);
  });
});

describe("acervo_guardar: o mockup enviado entra no acervo do cliente", () => {
  const CLIENTE = "11111111-1111-4111-8111-111111111111";
  const OUTRO = "22222222-2222-4222-8222-222222222222";
  const ARQ = "33333333-3333-4333-8333-333333333333";
  const PRINCIPAL = "44444444-4444-4444-8444-444444444444";
  const SEGUNDA = "55555555-5555-4555-8555-555555555555";

  function bancoFalso(o: { arquivo?: Partial<ArquivoDoAcervo> | null; corrida?: boolean } = {}) {
    const imagens: Array<Record<string, unknown>> = [];
    const arquivo: ArquivoDoAcervo | null =
      o.arquivo === null ? null : { id: ARQ, client_id: CLIENTE, storage_bucket: "files", storage_path: `${CLIENTE}/m.png`, file_name: "m.png", tags: ["mockup", "identidade"], ...(o.arquivo || {}) };
    const marcas: Record<string, MarcaDoAcervo> = {
      [PRINCIPAL]: { id: PRINCIPAL, client_id: CLIENTE, principal: true },
      [SEGUNDA]: { id: SEGUNDA, client_id: CLIENTE, principal: false },
    };
    let corrida = !!o.corrida;
    const banco: BancoDoAcervo = {
      lerArquivo: async () => arquivo,
      lerMarca: async (id) => marcas[id] || null,
      acharImagem: async (c, f) => {
        const ja = imagens.find((i) => i.client_id === c && i.file_id === f);
        return ja ? String(ja.id) : null;
      },
      inserirImagem: async (linha) => {
        if (corrida) {
          // Outro envio do mesmo arquivo entrou entre a leitura e a inserção: o índice único recusa.
          corrida = false;
          imagens.push({ ...linha, id: "img-da-corrida" });
          throw new Error("duplicate key value violates unique constraint");
        }
        const id = `img-${imagens.length + 1}`;
        imagens.push({ ...linha, id });
        return id;
      },
    };
    return { banco, imagens };
  }

  it("arquivo de outro cliente: 404, nada gravado", async () => {
    const { banco, imagens } = bancoFalso({ arquivo: { client_id: OUTRO } });
    await expect(guardarMockupNoAcervo(banco, { clientId: CLIENTE, fileId: ARQ })).rejects.toMatchObject({ status: 404, codigo: "arquivo_de_outro_cliente" });
    expect(imagens).toHaveLength(0);
  });

  it("arquivo que não é mockup do estúdio: 400", async () => {
    const { banco } = bancoFalso({ arquivo: { tags: ["identidade"] } });
    await expect(guardarMockupNoAcervo(banco, { clientId: CLIENTE, fileId: ARQ })).rejects.toMatchObject({ status: 400, codigo: "nao_e_mockup" });
  });

  it("file_id inválido e marca de outro cliente: 400", async () => {
    const { banco } = bancoFalso();
    await expect(guardarMockupNoAcervo(banco, { clientId: CLIENTE, fileId: "x" })).rejects.toMatchObject({ status: 400, codigo: "file_id_invalido" });
    await expect(guardarMockupNoAcervo(banco, { clientId: CLIENTE, fileId: ARQ, marcaId: OUTRO })).rejects.toMatchObject({ status: 400, codigo: "marca_de_outro_cliente" });
  });

  it("segunda chamada com o mesmo arquivo: ja_existia, sem duplicar", async () => {
    const { banco, imagens } = bancoFalso();
    const a = await guardarMockupNoAcervo(banco, { clientId: CLIENTE, fileId: ARQ, nome: "Mockup Cartão" });
    const b = await guardarMockupNoAcervo(banco, { clientId: CLIENTE, fileId: ARQ, nome: "Mockup Cartão" });
    expect(a).toEqual({ imagem_id: "img-1", ja_existia: false });
    expect(b).toEqual({ imagem_id: "img-1", ja_existia: true });
    expect(imagens).toHaveLength(1);
    expect(imagens[0]).toMatchObject({ nome: "Mockup Cartão", categoria: "mockup", storage_path: `${CLIENTE}/m.png`, aprovada: false });
  });

  it("corrida no índice único: vale a imagem que entrou primeiro", async () => {
    const { banco, imagens } = bancoFalso({ corrida: true });
    expect(await guardarMockupNoAcervo(banco, { clientId: CLIENTE, fileId: ARQ })).toEqual({ imagem_id: "img-da-corrida", ja_existia: true });
    expect(imagens).toHaveLength(1);
  });

  it("etiqueta da marca só na marca que não é a principal", async () => {
    const principal = bancoFalso();
    await guardarMockupNoAcervo(principal.banco, { clientId: CLIENTE, fileId: ARQ, marcaId: PRINCIPAL });
    expect((principal.imagens[0].tags as string[]).some((t) => t.indexOf("marca:") === 0)).toBe(false);
    const segunda = bancoFalso();
    await guardarMockupNoAcervo(segunda.banco, { clientId: CLIENTE, fileId: ARQ, marcaId: SEGUNDA });
    expect(segunda.imagens[0].tags).toContain(`marca:${SEGUNDA}`);
  });
});
