// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { gerarPdfDeRoteiros } from "../../supabase/functions/_shared/pdf-roteiro";
import {
  ehImagemDoPdf,
  encaixar,
  imagemJpeg,
  imagemParaPdf,
  imagemPng,
  imagensDoPdf,
  lerJpeg,
  montarPdf,
  Pagina,
  paginasDoPdf,
  textosDoPdf,
  type ImagemDoPdf,
} from "../../supabase/functions/_shared/pdf-base";
import { CASOS_DO_PDF_DO_ROTEIRO } from "./fixtures/roteiros-golden";
import { JPEG_CINZA, JPEG_CMYK, JPEG_PROGRESSIVO, JPEG_RGB, PNG_PALETA, PNG_RGB, PNG_TRANSPARENTE } from "./fixtures/imagens-pdf";

/**
 * Base comum dos PDFs (Frente DOC, 29/09/2026): as primitivas saíram de
 * pdf-roteiro.ts para pdf-base.ts e o PDF do Roteiro continua igual byte a
 * byte (SHA-256 gerado ANTES da extração, com o gerador antigo); o JPEG entra
 * como veio (DCTDecode) e o PNG simples com os próprios dados; o PDF abre num
 * leitor de verdade (pdf.js) e conta as imagens.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/** Gerados com o pdf-roteiro.ts de antes da extração (main 21ae1d02). */
const SHA_ANTES: Record<string, { bytes: number; sha: string }> = {
  "um-aprovado": { bytes: 28975, sha: "12242c76090ceabdd3186036d67a35b22b938b4a10704c49209cc0275fd7930e" },
  rascunho: { bytes: 29072, sha: "c8fdb0048ee250c498d1ad89a395eee30fe4e8607aae15988674f97407bf7e9f" },
  "varios-e-longo": { bytes: 76988, sha: "3a7f36dfbfa28b922c5677b8f50ed4cb010eab9666af09c83ea644328d17ac97" },
  "so-cinema": { bytes: 28733, sha: "cd8373f59b19ac26df7584eb262b60603eac831f892eb6ac875c5998c02a4866" },
};

async function abrirComPdfJs(bytes: Uint8Array): Promise<{ paginas: number; imagens: number }> {
  const pdfjs: any = await import(pathToFileURL(resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
  const tarefa = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
    standardFontDataUrl: pathToFileURL(resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")).href + "/",
  });
  const doc = await tarefa.promise;
  let imagens = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const ops = await p.getOperatorList();
    imagens += ops.fnArray.filter((f: number) => f === pdfjs.OPS.paintImageXObject).length;
  }
  const paginas = doc.numPages;
  await tarefa.destroy();
  return { paginas, imagens };
}

describe("pdf-base: o PDF do Roteiro sai igual byte a byte", () => {
  for (const c of CASOS_DO_PDF_DO_ROTEIRO) {
    it(`caso ${c.nome}`, () => {
      const bytes = gerarPdfDeRoteiros(c.doc);
      expect(bytes.length).toBe(SHA_ANTES[c.nome].bytes);
      expect(sha(bytes)).toBe(SHA_ANTES[c.nome].sha);
    });
  }

  it("pdf-roteiro.ts usa a base e não tem mais cópia das primitivas", () => {
    const roteiro = ler("supabase/functions/_shared/pdf-roteiro.ts");
    expect(roteiro).toContain('from "./pdf-base.ts"');
    expect(roteiro).not.toMatch(/const LARGURAS_HELV|function montarBytes|class Pagina|WIN_ANSI_ESPECIAIS/);
    const base = ler("supabase/functions/_shared/pdf-base.ts");
    // Puro: roda no navegador e na Edge Function.
    expect(base).not.toMatch(/from "npm:|from "https:|Deno\./);
    expect(base).not.toMatch(/\(\?<[=!a-z]|\\p\{|\.at\(/i);
    expect(base).not.toMatch(/[–—]/);
  });
});

describe("pdf-base: imagens", () => {
  it("lê o cabeçalho do JPEG (RGB, cinza, progressivo e CMYK) sem decodificar", () => {
    expect(lerJpeg(JPEG_RGB)).toMatchObject({ largura: 24, altura: 16, componentes: 3 });
    expect(lerJpeg(JPEG_CINZA)).toMatchObject({ largura: 24, altura: 16, componentes: 1 });
    expect(lerJpeg(JPEG_PROGRESSIVO)).toMatchObject({ largura: 20, altura: 30, componentes: 3 });
    expect(lerJpeg(JPEG_CMYK)).toMatchObject({ largura: 10, altura: 10, componentes: 4 });
    expect(lerJpeg(PNG_RGB)).toBeNull();
    const cmyk = imagemJpeg(JPEG_CMYK);
    expect(ehImagemDoPdf(cmyk) && cmyk.dicionario).toContain("/DeviceCMYK");
  });

  it("PNG simples entra; com transparência é recusado com o motivo", () => {
    const rgb = imagemPng(PNG_RGB);
    expect(ehImagemDoPdf(rgb)).toBe(true);
    expect((rgb as ImagemDoPdf).dicionario).toContain("/Predictor 15 /Colors 3");
    const pal = imagemPng(PNG_PALETA);
    expect(ehImagemDoPdf(pal)).toBe(true);
    expect((pal as ImagemDoPdf).dicionario).toMatch(/\/Indexed \/DeviceRGB \d+ </);
    const alfa = imagemPng(PNG_TRANSPARENTE);
    expect(ehImagemDoPdf(alfa)).toBe(false);
    expect((alfa as { recusada: string }).recusada).toMatch(/transpar/);
    expect(ehImagemDoPdf(imagemParaPdf(new Uint8Array([1, 2, 3])))).toBe(false);
  });

  it("encaixe: conter centra sem cortar; cobrir preenche a caixa", () => {
    expect(encaixar(200, 100, 100, 100, "conter")).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(encaixar(200, 100, 100, 100, "cobrir")).toEqual({ x: -50, y: 0, w: 200, h: 100 });
    expect(encaixar(10, 30, 60, 60)).toEqual({ x: 20, y: 0, w: 20, h: 60 });
  });

  it("JPEG embutido é válido: os bytes são os mesmos do arquivo, abre no pdf.js e conta as imagens", async () => {
    const jpeg = imagemParaPdf(JPEG_RGB) as ImagemDoPdf;
    const cinza = imagemParaPdf(JPEG_CINZA) as ImagemDoPdf;
    const png = imagemParaPdf(PNG_PALETA) as ImagemDoPdf;
    const p1 = new Pagina("PROVAS");
    p1.logo(242.6, 23, 110);
    p1.imagem(jpeg, 40, 100, 240, 160, "conter");
    p1.imagem(cinza, 300, 100, 240, 160, "cobrir");
    p1.texto(40, 300, "Prova com acento: ação", "F1", 10, [0, 0, 0]);
    const p2 = new Pagina("PROVAS");
    // A mesma imagem em duas páginas vira um objeto só.
    p2.imagem(jpeg, 40, 100, 100, 100);
    p2.imagem(png, 160, 100, 100, 100);
    const bytes = montarPdf([p1, p2], { titulo: "Teste", assunto: "imagens", produtor: "Aceleriq OS" });

    const bruto = latin1(bytes);
    expect(paginasDoPdf(bytes)).toBe(2);
    expect(textosDoPdf(bytes)).toContain("Prova com acento: ação");
    // Três imagens únicas (a logo e a máscara não contam).
    const imgs = imagensDoPdf(bytes);
    expect(imgs.map((i) => i.filtro).sort()).toEqual(["DCTDecode", "DCTDecode", "FlateDecode"]);
    expect(imgs.find((i) => i.largura === 24 && i.filtro === "DCTDecode")).toBeTruthy();
    // O fluxo do JPEG é o arquivo inteiro, do FFD8 ao FFD9.
    const inicio = bruto.indexOf("/Filter /DCTDecode");
    const stream = bruto.indexOf("stream\n", inicio) + 7;
    expect(bruto.slice(stream, stream + JPEG_RGB.length)).toBe(latin1(JPEG_RGB));
    // xref aponta para os objetos certos, inclusive os das imagens.
    const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(bruto)![1]);
    const linhas = bruto.slice(xref).split("\n").slice(3);
    let n = 1;
    for (const l of linhas) {
      const m = /^(\d{10}) 00000 n $/.exec(l);
      if (!m) break;
      expect(bruto.slice(Number(m[1]), Number(m[1]) + `${n} 0 obj`.length)).toBe(`${n} 0 obj`);
      n++;
    }
    expect(n - 1).toBe(7 + 2 * 2 + 3);
    // Leitor de verdade: 2 páginas; 1 logo + 2 provas na primeira e 2 provas na segunda.
    const aberto = await abrirComPdfJs(bytes);
    expect(aberto).toEqual({ paginas: 2, imagens: 5 });
  }, 60_000);
});
