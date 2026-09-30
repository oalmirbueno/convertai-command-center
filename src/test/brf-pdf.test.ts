import { describe, expect, it } from "vitest";
import { gerarPdfDoBriefing, nomeDoArquivoDoBriefing } from "../../supabase/functions/briefing-agente/modulos/pdf-briefing";
import { paginasDoPdf, textosDoPdf } from "../../supabase/functions/_shared/pdf-roteiro";

/** Frente BRF: o PDF do briefing que vai para Arquivos (no lugar do window.print). */
describe("PDF do briefing", () => {
  it("leva capa, pontos principais e as respostas, sem cortar texto longo", () => {
    const longa = "Resposta longa com acentuação: não, ção, é, à. ".repeat(400);
    const bytes = gerarPdfDoBriefing({
      cliente: "Padaria Aurora",
      titulo: "Briefing do site",
      enviadoEm: "2026-09-30T12:00:00Z",
      estado: "enviado",
      tom: "Acolhedor e cuidadoso",
      pontos: [{ rotulo: "Palavras-chave", itens: ["fermentação natural", "bairro"] }],
      blocos: [
        { titulo: "Negócio", itens: [{ pergunta: "Conte a história da empresa", resposta: longa }] },
        { titulo: "Vazio", itens: [] },
      ],
    });
    const textos = textosDoPdf(bytes).join(" ");
    expect(String.fromCharCode(...Array.from(bytes.slice(0, 8)))).toBe("%PDF-1.4");
    expect(textos).toContain("Briefing do site");
    expect(textos).toContain("Tom de voz: Acolhedor e cuidadoso");
    expect(textos).toContain("fermentação natural; bairro");
    expect(textos).toContain("Conte a história da empresa");
    expect(textos).not.toContain("VAZIO");
    expect(paginasDoPdf(bytes)).toBeGreaterThan(1);
  });

  it("nome do arquivo sem acento e com a data do envio", () => {
    expect(nomeDoArquivoDoBriefing("Identidade e logo", "Padaria Açaí & Cia", "2026-09-30T12:00:00Z")).toBe("briefing-identidade-e-logo-padaria-acai-cia-2026-09-30.pdf");
  });
});
