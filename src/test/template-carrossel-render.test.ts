import { describe, expect, it, vi } from "vitest";
import { desenharProfile } from "@/components/mesa/profile/renderProfile";
import { enquadrar, linhasRicas, pedacosDoTexto } from "@/components/mesa/profile/renderCarrossel";
import type { TemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";

/** Carrossel estilo post do X (22/10): a lâmina inteira, o bloco de mídia e o texto com negrito. */
const base: TemplateProfile = {
  versao: 1, estilo: "carrossel", nome: "Rafael Exemplo", username: "rafael.exemplo", verificado: true,
  texto: "A IA já faz **3 dias de trabalho** em 1.\n\nSe você comprar SÓ esse número, vai pagar caro →",
  tamanho_texto: 34, cor_fundo: "#ffffff", tema: "claro", tamanho_foto: 88, espacamento: 48, arredondamento: 24, seta: true,
};

function quadro() {
  const ctx = {
    font: "", fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1, textAlign: "left", textBaseline: "alphabetic",
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), arcTo: vi.fn(), arc: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    measureText: (s: string) => ({ width: Array.from(s).length * (parseFloat(ctx.font.match(/(\d+)px/)?.[1] || "36")) * 0.5 }),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}
const textos = (ctx: ReturnType<typeof quadro>["ctx"]) => ctx.fillText.mock.calls.map((c) => String(c[0]));

describe("texto com negrito por trecho", () => {
  it("separa os trechos marcados e mantém asterisco sem par como texto", () => {
    expect(pedacosDoTexto("A **IA** faz")).toEqual([{ texto: "A ", negrito: false }, { texto: "IA", negrito: true }, { texto: " faz", negrito: false }]);
    expect(pedacosDoTexto("5 * 3 = 15 **x")).toEqual([{ texto: "5 * 3 = 15 **x", negrito: false }]);
  });
  it("quebra palavra a palavra e marca o parágrafo depois da linha vazia", () => {
    const linhas = linhasRicas("um dois **três quatro**\n\ncinco", 9, (s) => Array.from(s).length);
    expect(linhas.map((l) => l.pedacos.map((p) => p.texto).join(""))).toEqual(["um dois", "três", "quatro", "cinco"]);
    expect(linhas[1].pedacos[0].negrito).toBe(true);
    expect(linhas[3].paragrafo).toBe(true);
  });
});

describe("lâmina do carrossel", () => {
  it("desenha nome, @, texto em negrito e nada de contador 1/N", () => {
    const { canvas, ctx } = quadro();
    desenharProfile(canvas, base, "feed_4x5", { posicao: { atual: 1, total: 6 } });
    expect([canvas.width, canvas.height]).toEqual([1080, 1350]);
    const t = textos(ctx);
    expect(t).toContain("Rafael Exemplo");
    expect(t).toContain("@rafael.exemplo");
    expect(t).toContain("3 dias de trabalho");
    expect(t.some((x) => /^\d+\/\d+$/.test(x))).toBe(false);
    // O trecho em negrito sai com peso 700.
    const i = ctx.fillText.mock.calls.findIndex((c) => c[0] === "3 dias de trabalho");
    expect(i).toBeGreaterThanOrEqual(0);
  });
  it("põe a foto INTEIRA no bloco e devolve onde ela ficou (sem nada por cima)", () => {
    const { canvas, ctx } = quadro();
    const foto = { naturalWidth: 1600, naturalHeight: 900 } as HTMLImageElement;
    const r = desenharProfile(canvas, { ...base, bloco: { tipo: "imagem", posicao: "abaixo", altura: 100, largura: 100, sangrar: false, cantos: 18, borda: true, sombra: false, enquadramento: "inteira", foco_x: 0.5, foco_y: 0.5, midia: { bucket: "mesa", caminho: "c/estudio/a.jpg", origem: "internet" } } }, "feed_4x5", { midia: { fonte: foto, largura: 1600, altura: 900 } });
    const chamada = ctx.drawImage.mock.calls.find((c) => c[0] === foto)!;
    expect(chamada).toHaveLength(5);
    expect(chamada[3] / chamada[4]).toBeCloseTo(1600 / 900);
    expect(r.carrossel?.bloco).toBeTruthy();
    expect(r.carrossel!.bloco!.largura / r.carrossel!.bloco!.altura).toBeCloseTo(1600 / 900, 1);
  });
  it("preencher cobre o bloco a partir do ponto focal", () => {
    const q = enquadrar({ largura: 1000, altura: 1000 }, { x: 0, y: 0, largura: 800, altura: 400 }, "preencher", 0.5, 0);
    expect(q.largura).toBe(800);
    expect(q.y).toBe(0);
    const q2 = enquadrar({ largura: 1000, altura: 1000 }, { x: 0, y: 0, largura: 800, altura: 400 }, "preencher", 0.5, 1);
    expect(q2.y).toBe(-400);
  });
  it("gráfico e manchete são desenhados por código a partir dos dados", () => {
    const g = quadro();
    desenharProfile(g.canvas, { ...base, bloco: { tipo: "grafico", posicao: "abaixo", altura: 100, largura: 100, sangrar: false, cantos: 18, borda: false, sombra: false, enquadramento: "inteira", foco_x: 0.5, foco_y: 0.5, grafico: { tipo: "barras", titulo: "Vendas por setor", unidade: "%", dados: [{ rotulo: "Turismo", valor: 18.6 }, { rotulo: "Serviços", valor: 10.8 }] } } }, "feed_4x5");
    expect(textos(g.ctx)).toContain("Vendas por setor");
    expect(textos(g.ctx)).toContain("18,6%");
    const m = quadro();
    desenharProfile(m.canvas, { ...base, bloco: { tipo: "manchete", posicao: "abaixo", altura: 100, largura: 100, sangrar: false, cantos: 18, borda: true, sombra: false, enquadramento: "inteira", foco_x: 0.5, foco_y: 0.5, manchete: { veiculo: "g1", titulo: "Venda de carros elétricos cresce", data: "21/10/2026" } } }, "feed_4x5");
    expect(textos(m.ctx)).toContain("g1");
    expect(textos(m.ctx).join(" ")).toContain("carros elétricos");
  });
  it("lâmina de vídeo só grava o ícone de som quando pedido, e a seta some na última", () => {
    const quadroDoVideo = { width: 1920, height: 1080 } as unknown as HTMLVideoElement;
    const bloco = { tipo: "video" as const, posicao: "abaixo" as const, altura: 100, largura: 100, sangrar: false, cantos: 18, borda: false, sombra: false, enquadramento: "inteira" as const, foco_x: 0.5, foco_y: 0.5, midia: { bucket: "mesa" as const, caminho: "c/v.mp4", origem: "enviada" as const } };
    const a = quadro();
    desenharProfile(a.canvas, { ...base, bloco }, "feed_4x5", { midia: { fonte: quadroDoVideo, largura: 1920, altura: 1080 }, posicao: { atual: 6, total: 6 } });
    const b = quadro();
    desenharProfile(b.canvas, { ...base, bloco: { ...bloco, som_na_peca: true } }, "feed_4x5", { midia: { fonte: quadroDoVideo, largura: 1920, altura: 1080 }, posicao: { atual: 6, total: 6 } });
    expect(b.ctx.arc.mock.calls.length).toBeGreaterThan(a.ctx.arc.mock.calls.length);
    const c = quadro();
    desenharProfile(c.canvas, { ...base, bloco }, "feed_4x5", { midia: { fonte: quadroDoVideo, largura: 1920, altura: 1080 }, posicao: { atual: 2, total: 6 } });
    // Com a seta (não é a última) há um círculo a mais que sem ela.
    expect(c.ctx.arc.mock.calls.length).toBeGreaterThan(a.ctx.arc.mock.calls.length);
  });
  it("recusa texto que não cabe em vez de cortar", () => {
    const { canvas } = quadro();
    expect(() => desenharProfile(canvas, { ...base, texto: "conteúdo muito longo ".repeat(120), tamanho_texto: 56 }, "quadrado_1x1")).toThrow("não cabe");
  });
});
