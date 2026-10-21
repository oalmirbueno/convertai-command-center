// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { linhasDoPdf, pdfDoProjeto } from "@/lib/laboratorio/exportarPdf";
import type { DocumentoDoProjeto } from "@/lib/laboratorio/exportar";

const fonte = new Uint8Array(readFileSync(resolve(__dirname, "../../public/editor/fontes/Figtree-Variable.ttf")));
const documento = (markdown: string): DocumentoDoProjeto => ({ nome: "funil-documentacao", titulo: "Funil da ação de café", markdown, json: "{}", totalNos: 3, totalExecucoes: 2, pendencias: [] });

describe("PDF real do Canvas", () => {
  it("quebra parágrafos e referências longas pela largura sem perder conteúdo", () => {
    const longo = "https://arquivos.example/" + "x".repeat(180);
    const linhas = linhasDoPdf(longo, 40, (s) => Array.from(s).length);
    expect(linhas.every((s) => Array.from(s).length <= 40)).toBe(true);
    expect(linhas.join("")).toBe(longo);
    const frase = "Ação, criação e revisão do café brasileiro";
    expect(linhasDoPdf(frase, 20, (s) => s.length).join(" ")).toBe(frase);
  });

  it("gera um PDF A4 multipágina com acentos brasileiros, cabeçalhos e numeração sem ações ativas", async () => {
    const paragrafo = "Ação com aprovação, café brasileiro, criação, revisão, públicos e condições. Informação completa, sem perder contatos ou negócios.";
    const markdown = "# Funil da ação de café\n\n## Contexto\n\n" + Array.from({ length: 100 }, (_, i) => `${i + 1}. ${paragrafo}`).join("\n\n") + "\n\n## Última peça\n\nFim da documentação. Símbolo adicional 🚀 preservado como código se não existir na fonte.";
    const blob = await pdfDoProjeto(documento(markdown), fonte);
    expect(blob.type).toBe("application/pdf");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch(/^%PDF-1\./);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(2);
    expect(pdf.getTitle()).toBe("Funil da ação de café");
    expect(pdf.catalog.get(PDFName.of("Lang"))?.toString()).toContain("pt-BR");
    expect(pdf.catalog.get(PDFName.of("OpenAction"))).toBeUndefined();
    for (const pagina of pdf.getPages()) {
      expect(pagina.getSize().width).toBeCloseTo(595.28, 1);
      expect(pagina.getSize().height).toBeCloseTo(841.89, 1);
      expect(pagina.node.Annots()?.size() || 0).toBe(0);
    }
  }, 20000);

  it("busca só a fonte local ao clicar, sem credenciais e sem serviço de geração externo", async () => {
    const buscar = vi.fn(async () => ({ ok: true, arrayBuffer: async () => fonte.buffer }));
    vi.stubGlobal("fetch", buscar);
    try {
      const blob = await pdfDoProjeto(documento("# Café brasileiro\n\nAção, crédito e condições de aprovação."));
      expect(blob.size).toBeGreaterThan(1000);
      expect(buscar).toHaveBeenCalledTimes(1);
      expect(buscar).toHaveBeenCalledWith("/editor/fontes/Figtree-Variable.ttf", { credentials: "omit", cache: "force-cache" });
    } finally { vi.unstubAllGlobals(); }
  }, 20000);
});
