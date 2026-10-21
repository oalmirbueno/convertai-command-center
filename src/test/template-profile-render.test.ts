import { describe, expect, it, vi } from "vitest";
import { ALTURAS_PROFILE, desenharProfile, linhasProfile } from "@/components/mesa/profile/renderProfile";
import type { TemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";

const template: TemplateProfile = { versao: 1, estilo: "twitter", nome: "Cliente Exemplo", username: "cliente.exemplo", verificado: false, texto: "Uma foto real.\nUma história do seu negócio.", tamanho_texto: 36, cor_fundo: "#ffffff", tema: "claro", tamanho_foto: 76, espacamento: 30, arredondamento: 16 };
function quadro() {
  const ctx = { font: "", save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), arcTo: vi.fn(), arc: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), translate: vi.fn(), scale: vi.fn(), bezierCurveTo: vi.fn(), createLinearGradient: () => ({ addColorStop: vi.fn() }), measureText: (s: string) => ({ width: Array.from(s).length * (parseFloat(ctx.font.match(/(\d+)px/)?.[1] || "36")) * .5 }) };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}
describe("Profile conserva o conteúdo no quadro final", () => {
  it("preserva parágrafos, acentos e caracteres de palavras longas sem cortar", () => {
    const texto = "Café da manhã\n\nConstrução🤝superlonga";
    const linhas = linhasProfile(texto, 5, (s) => Array.from(s).length);
    expect(linhas.some((l) => l === "")).toBe(true);
    expect(linhas.join("").replace(/\s/g, "")).toBe(texto.replace(/\s/g, ""));
    expect(linhas.every((l) => Array.from(l).length <= 5)).toBe(true);
  });
  it.each(Object.entries(ALTURAS_PROFILE))("exporta formato %s com dimensões reais e texto dentro da tela", (formato, altura) => {
    for (const estilo of ["twitter", "instagram"] as const) {
      const { canvas, ctx } = quadro();
      // No Instagram a legenda aberta mostra o texto inteiro (sem o "mais"), quebrado na largura do post.
      desenharProfile(canvas, { ...template, estilo, ...(estilo === "instagram" ? { legenda_completa: true, proporcao: "1:1" as const } : {}) }, formato as keyof typeof ALTURAS_PROFILE);
      expect([canvas.width, canvas.height]).toEqual([1080, altura]);
      expect(ctx.fillText.mock.calls.map((c) => c[0]).join(" ").replace(/\s+/g, " ")).toContain("Uma foto real.");
      for (const c of ctx.fillText.mock.calls) { expect(c[1]).toBeGreaterThan(0); expect(c[2]).toBeGreaterThan(0); expect(c[2]).toBeLessThan(altura - 30); }
    }
  });
  it("usa a fotografia inteira e mantém o arquivo de origem intacto", () => {
    const { canvas, ctx } = quadro();
    const foto = { naturalWidth: 1600, naturalHeight: 900 } as HTMLImageElement;
    desenharProfile(canvas, template, "feed_4x5", { imagem: foto });
    const chamada = ctx.drawImage.mock.calls[0];
    expect(chamada).toHaveLength(5); // sem crop do retângulo fonte
    expect(chamada[0]).toBe(foto);
    expect(chamada[3] / chamada[4]).toBeCloseTo(1600 / 900);
    expect(foto).toEqual({ naturalWidth: 1600, naturalHeight: 900 });
  });
  it("recusa texto excedente em vez de exportar com corte ou sobreposição", () => {
    const { canvas } = quadro();
    expect(() => desenharProfile(canvas, { ...template, texto: "conteúdo ".repeat(180), tamanho_texto: 56 }, "quadrado_1x1")).toThrow("não cabe");
  });
});
