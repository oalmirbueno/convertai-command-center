import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Capas dos modelos prontos do Canvas (dono, 25/09): as fotos de base da Mesa
 * Foto viram capa pública da galeria (estático do front, sem dado do cliente)
 * e referência de estilo só no Canvas do cliente dono da foto.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: vi.fn(),
    from: vi.fn(),
    storage: { from: () => ({ createSignedUrl: vi.fn(), createSignedUrls: vi.fn(), upload: vi.fn() }) },
  },
}));

import {
  aplicarModeloPronto,
  canvasVazio,
  capaDeReserva,
  corpoDoCanvas,
  GUIA_DA_REFERENCIA_DO_MODELO,
  MODELOS_PRONTOS,
  normalizarCanvas,
  novoNo,
  REFERENCIAS_DE_ESTILO_DOS_MODELOS,
  referenciaDeEstiloDoModelo,
  type Canvas,
} from "@/components/mesa-foto/canvasApi";
import { MiniaturaDoModelo } from "@/components/mesa-foto/canvas/Galeria";
import { CHAVES_DOS_MODELOS_PRONTOS, normalizarCanvas as normalizarCanvasNaFuncao } from "../../supabase/functions/mesa-foto/canvas-regras";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const PASTA = resolve(raiz, "public/canvas-modelos");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const DONO = "6a847578-ba39-44cd-be61-08e34e18e4c9";
const OUTRO = "22222222-2222-2222-2222-222222222222";
const GPT = "openai:gpt-image-2.5-sunburst";

const quadro = (clientId: string): Canvas => ({ ...canvasVazio(clientId), nos: [novoNo("gerar", 420, 0, { motores: [GPT] })] });
const estilos = (c: Canvas) => c.nos.filter((n) => n.tipo === "estilo");

describe("capas dos modelos prontos: arquivos estáticos", () => {
  const comCapa = MODELOS_PRONTOS.filter((m) => m.capa);

  it("cada capa é da própria chave e combina com a cena do modelo", () => {
    expect(comCapa.map((m) => m.chave)).toEqual(["produto-na-mao", "flat-lay", "carrossel-de-produto", "produto-no-ambiente"]);
    comCapa.forEach((m) => expect(m.capa).toBe(`/canvas-modelos/${m.chave}.webp`));
    // Sem foto que combine: continuam com o desenho dos cartões.
    expect(MODELOS_PRONTOS.filter((m) => !m.capa).map((m) => m.chave)).toEqual(["produto-na-praia", "loja-da-marca", "ugc-selfie", "vitrine", "modelo-na-rua"]);
  });

  it("webp e jpg de reserva existem, são pequenos e o webp é webp de verdade", () => {
    comCapa.forEach((m) => {
      const webp = resolve(raiz, "public" + m.capa);
      const jpg = resolve(raiz, "public" + capaDeReserva(m.capa!));
      expect(statSync(webp).size).toBeLessThanOrEqual(60 * 1024);
      expect(statSync(jpg).size).toBeLessThanOrEqual(60 * 1024);
      const b = readFileSync(webp);
      expect(b.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(b.subarray(8, 12).toString("latin1")).toBe("WEBP");
      expect(readFileSync(jpg).subarray(0, 2).toString("hex")).toBe("ffd8");
    });
  });

  it("a pasta só tem as capas usadas, com nome de modelo (sem id nem nome de cliente)", () => {
    const esperados = MODELOS_PRONTOS.filter((m) => m.capa).flatMap((m) => [`${m.chave}.webp`, `${m.chave}.jpg`]).sort();
    const nomes = readdirSync(PASTA).sort();
    expect(nomes).toEqual(esperados);
    nomes.forEach((n) => expect(n).not.toMatch(UUID));
  });

  it("jpg de reserva sai do mesmo nome", () => {
    expect(capaDeReserva("/canvas-modelos/flat-lay.webp")).toBe("/canvas-modelos/flat-lay.jpg");
  });

  it("as chaves continuam espelhadas com a função (nenhum modelo novo sem a função saber)", () => {
    expect(MODELOS_PRONTOS.map((m) => m.chave)).toEqual(CHAVES_DOS_MODELOS_PRONTOS);
    REFERENCIAS_DE_ESTILO_DOS_MODELOS.forEach((r) => expect(CHAVES_DOS_MODELOS_PRONTOS).toContain(r.chave));
  });
});

describe("referência de estilo: só no Canvas do cliente dono da foto", () => {
  it("de outro cliente ou sem cliente, nada muda", () => {
    expect(referenciaDeEstiloDoModelo("flat-lay", OUTRO)).toBeNull();
    expect(referenciaDeEstiloDoModelo("flat-lay", "")).toBeNull();
    for (const chave of ["produto-na-mao", "flat-lay", "produto-no-ambiente"]) {
      const c = aplicarModeloPronto(quadro(OUTRO), chave, GPT);
      c.nos.forEach((n) => expect(n.dados.imagem_id || null).toBeNull());
      const m = MODELOS_PRONTOS.find((x) => x.chave === chave)!;
      expect(c.nos).toHaveLength(1 + m.cartoes.length);
    }
  });

  it("flat lay do dono: a foto entra no cartão Estilo do modelo, que mantém o guia", () => {
    const c = aplicarModeloPronto(quadro(DONO), "flat-lay", GPT);
    const e = estilos(c);
    expect(e).toHaveLength(1);
    expect(e[0].dados.imagem_id).toBe("ecfc7b8a-2f14-4421-b195-ae98154fcb8c");
    expect(e[0].dados.texto).toContain("Flat lay visto de cima");
  });

  it("produto na mão e no ambiente do dono: cartão Estilo novo, ligado ao Resultado, antes do pedido", () => {
    const casos: [string, string][] = [
      ["produto-na-mao", "4d5cf2df-f329-4f42-a267-4ed8a2636a6d"],
      ["produto-no-ambiente", "2be68898-cc48-46e4-957b-1eb9acc27b15"],
    ];
    casos.forEach(([chave, imagem]) => {
      const c = aplicarModeloPronto(quadro(DONO), chave, GPT);
      const g = c.nos.find((n) => n.tipo === "gerar")!;
      const e = estilos(c);
      expect(e).toHaveLength(1);
      expect(e[0].dados).toMatchObject({ imagem_id: imagem, texto: GUIA_DA_REFERENCIA_DO_MODELO });
      expect(e[0].dados.biblioteca_id || null).toBeNull();
      const ligacao = c.ligacoes.find((l) => l.de === e[0].id)!;
      expect(ligacao.para).toBe(g.id);
      expect(ligacao.entrada).toBe("estilo");
      const tipos = c.nos.filter((n) => n.tipo !== "gerar").map((n) => n.tipo);
      expect(tipos.indexOf("estilo")).toBeLessThan(tipos.indexOf("texto"));
    });
  });

  it("modelo sem referência (carrossel) não ganha cartão Estilo nem para o dono", () => {
    expect(estilos(aplicarModeloPronto(quadro(DONO), "carrossel-de-produto", GPT))).toHaveLength(0);
  });

  it("o cartão Estilo com a foto vai à função como imagem_ids e volta igual", () => {
    const c = { ...aplicarModeloPronto(quadro(DONO), "produto-na-mao", GPT), id: "cccccccc-0000-4000-8000-000000000001", versao: 1 };
    const naFuncao = normalizarCanvasNaFuncao(corpoDoCanvas(c));
    const estiloNaFuncao = naFuncao.nos.find((n) => n.tipo === "estilo")!;
    expect(estiloNaFuncao.dados.imagem_ids).toEqual(["4d5cf2df-f329-4f42-a267-4ed8a2636a6d"]);
    const deVolta = normalizarCanvas({ ...naFuncao, id: c.id, versao: 1 }, DONO)!;
    expect(estilos(deVolta)[0].dados).toEqual(estilos(c)[0].dados);
  });
});

describe("miniatura da galeria", () => {
  const naMao = MODELOS_PRONTOS.find((m) => m.chave === "produto-na-mao")!;
  const praia = MODELOS_PRONTOS.find((m) => m.chave === "produto-na-praia")!;

  it("com capa: webp com jpg de reserva; se a capa falhar, volta ao desenho dos cartões", () => {
    const { container } = render(h(MiniaturaDoModelo, { m: naMao }));
    const caixa = container.querySelector("[data-miniatura-do-modelo]")!;
    expect(caixa.hasAttribute("data-com-capa")).toBe(true);
    const fonte = caixa.querySelector("picture source")!;
    expect(fonte.getAttribute("type")).toBe("image/webp");
    expect(fonte.getAttribute("srcset")).toBe("/canvas-modelos/produto-na-mao.webp");
    const img = caixa.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/canvas-modelos/produto-na-mao.jpg");
    fireEvent.error(img);
    expect(caixa.querySelector("img")).toBeNull();
    expect(caixa.hasAttribute("data-com-capa")).toBe(false);
    expect(caixa.querySelectorAll("svg").length).toBe(naMao.cartoes.length);
  });

  it("sem capa: só o desenho dos cartões", () => {
    const { container } = render(h(MiniaturaDoModelo, { m: praia }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("svg").length).toBe(praia.cartoes.length);
  });

  it("piso Safari 11 e texto sem travessão na galeria", () => {
    const galeria = ler("src/components/mesa-foto/canvas/Galeria.tsx");
    expect(galeria).not.toMatch(/aspect-ratio|aspect-\[|aspect-(square|video)|:has\(/);
    expect(galeria).not.toMatch(/[–—]/);
    const api = ler("src/components/mesa-foto/canvasApi.ts");
    const bloco = api.slice(api.indexOf("// ------------------------------------------------------------------ modelos prontos"), api.indexOf("// ------------------------------------------------------------------ agente do Canvas"));
    expect(bloco.length).toBeGreaterThan(100);
    expect(bloco).not.toMatch(/[–—]/);
  });
});
