import { describe, expect, it, vi } from "vitest";
import { ALTURAS_PROFILE, desenharProfile } from "@/components/mesa/profile/renderProfile";
import type { TemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";

const template: TemplateProfile = { versao: 1, estilo: "twitter", nome: "Loja A", username: "loja.a", texto: "Leia as instruções.", verificado: false, tema: "claro", cor_fundo: "#ffffff", tamanho_texto: 36, tamanho_foto: 76, espacamento: 30, arredondamento: 16 };
function quadro() {
  const ctx = { font: "", save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), arcTo: vi.fn(), arc: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), measureText: (s: string) => ({ width: Array.from(s).length * Number(ctx.font.match(/(\d+)px/)?.[1] || "36") * .6 }) };
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, ctx };
}
const pontos = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: .5, y: 0 }, { x: .5, y: 1 }, { x: 0, y: .5 }, { x: 1, y: .5 }];
describe("Rótulo do Profile fica reservado à área da foto", () => {
  it.each(["twitter", "instagram"] as const)("não invade copy nem cabeçalho de %s, inclusive nos limites e com 60 caracteres", (estilo) => {
    for (const formato of Object.keys(ALTURAS_PROFILE) as Array<keyof typeof ALTURAS_PROFILE>) {
      for (const dimensoes of [{ naturalWidth: 400, naturalHeight: 1600 }, { naturalWidth: 2400, naturalHeight: 400 }]) {
        for (const ponto of pontos) {
          const { canvas, ctx } = quadro(), imagem = dimensoes as HTMLImageElement;
          const resultado = desenharProfile(canvas, { ...template, estilo, destaque: { ...ponto, rotulo: "W".repeat(60) } }, formato, { imagem, imagemExata: true });
          // A caixa preenchida da imagem é distinta do canvas e do avatar.
          const area = ctx.fillRect.mock.calls[2];
          const [ax, ay, aw, ah] = area;
          const caixaRotulo = ctx.arcTo.mock.calls.slice(-4);
          const esquerda = Math.min(...caixaRotulo.flatMap((c) => [c[0], c[2]]));
          const direita = Math.max(...caixaRotulo.flatMap((c) => [c[0], c[2]]));
          const topo = Math.min(...caixaRotulo.flatMap((c) => [c[1], c[3]]));
          const base = Math.max(...caixaRotulo.flatMap((c) => [c[1], c[3]]));
          expect(esquerda).toBeGreaterThanOrEqual(ax + 12);
          expect(direita).toBeLessThanOrEqual(ax + aw - 12);
          expect(topo).toBeGreaterThanOrEqual(ay + 12);
          expect(base).toBeLessThanOrEqual(ay + ah - 12);
          const rotulo = ctx.fillText.mock.calls.filter((c) => /^W+$/.test(c[0]));
          expect(rotulo.map((c) => c[0]).join("")).toBe("W".repeat(60));
          expect(rotulo.length).toBeGreaterThan(1);
          for (const [linha, x, y] of rotulo) {
            expect(x).toBeGreaterThanOrEqual(esquerda + 12);
            expect(x + ctx.measureText(linha).width).toBeLessThanOrEqual(direita - 12 + .00001);
            expect(y).toBeGreaterThanOrEqual(topo + 9);
            expect(y + 22).toBeLessThanOrEqual(base - 8);
          }
          const real = resultado.imagem!, circulos = ctx.arc.mock.calls;
          expect(circulos[circulos.length - 1]).toEqual([real.x + real.largura * ponto.x, real.y + real.altura * ponto.y, 17, 0, Math.PI * 2]);
          // Clip da anotação também segura círculo e conector na área da foto.
          const clipDaAnotacao = ctx.arcTo.mock.calls.slice(-8, -4);
          expect(clipDaAnotacao).toEqual([[ax + aw, ay, ax + aw, ay + ah, 0], [ax + aw, ay + ah, ax, ay + ah, 0], [ax, ay + ah, ax, ay, 0], [ax, ay, ax + aw, ay, 0]]);
          expect(ctx.clip).toHaveBeenCalledTimes(3); // avatar, imagem, anotação
        }
      }
    }
  });
});
