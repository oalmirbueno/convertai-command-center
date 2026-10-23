import { describe, expect, it, vi } from "vitest";
import { desenharProfile } from "@/components/mesa/profile/renderProfile";
import { CORES_DO_CARROSSEL, enquadrar, FUNDOS_PRONTOS, fundoEscuro, linhasRicas, luminancia, paletaDoFundo, pedacosDoTexto, textoDoCredito } from "@/components/mesa/profile/renderCarrossel";
import type { TemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";
import { normalizarNegrito } from "../../supabase/functions/estudio-arte/modulos/destaques-do-texto";

/** Carrossel estilo post do X (22/10): a lâmina inteira, o bloco de mídia e o texto com negrito. */
const base: TemplateProfile = {
  versao: 1, estilo: "carrossel", nome: "Rafael Exemplo", username: "rafael.exemplo", verificado: true,
  texto: "A IA já faz **3 dias de trabalho** em 1.\n\nSe você comprar SÓ esse número, vai pagar caro →",
  tamanho_texto: 34, cor_fundo: "#ffffff", tema: "claro", tamanho_foto: 88, espacamento: 48, arredondamento: 24, seta: true,
};

function quadro() {
  const ctx = {
    font: "", fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1, textAlign: "left", textBaseline: "alphabetic",
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), arcTo: vi.fn(), arc: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), translate: vi.fn(), scale: vi.fn(), rect: vi.fn(), quadraticCurveTo: vi.fn(), bezierCurveTo: vi.fn(),
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
    // 24/10: o "**" sem par é marca sobrando e sai (o asterisco sozinho continua).
    expect(pedacosDoTexto("5 * 3 = 15 **x")).toEqual([{ texto: "5 * 3 = 15 x", negrito: false }]);
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

describe("fundo da lâmina (23/10): qualquer cor, com o texto no contraste certo", () => {
  it("a paleta sai do fundo: branco e preto são os do X; cor da marca escura pede texto claro e a clara, escuro", () => {
    expect(paletaDoFundo("#ffffff")).toEqual(CORES_DO_CARROSSEL.claro);
    expect(paletaDoFundo("#000000")).toEqual(CORES_DO_CARROSSEL.escuro);
    expect(paletaDoFundo("#7a1f3d").texto).toBe("#f7f9f9");
    expect(paletaDoFundo("#f5f1e8").texto).toBe("#0f1419");
    expect(paletaDoFundo("#ffd400").texto).toBe("#0f1419");
    expect(fundoEscuro("#15202b")).toBe(true);
    expect(fundoEscuro("#ffd400")).toBe(false);
    expect(luminancia("#ffffff")).toBeCloseTo(1);
    expect(FUNDOS_PRONTOS.map((f) => f.cor)).toEqual(["#ffffff", "#000000", "#15202b", "#f5f1e8"]);
  });
  it("pinta o fundo escolhido e escreve o nome e o texto em cor clara sobre a cor escura da marca", () => {
    const { canvas, ctx } = quadro();
    const cores: Array<[string, string]> = [];
    ctx.fillText = vi.fn((s: string) => { cores.push([String(s), String(ctx.fillStyle)]); });
    desenharProfile(canvas, { ...base, tema: "claro", cor_fundo: "#7a1f3d" }, "feed_4x5");
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1080, 1350);
    expect(cores.find(([s]) => s === "Rafael Exemplo")?.[1]).toBe("#f7f9f9");
    expect(cores.find(([s]) => s === "3 dias de trabalho")?.[1]).toBe("#f7f9f9");
  });
  it("o crédito da mídia sai embaixo do bloco só quando pedido, com o veículo da matéria", () => {
    const foto = { naturalWidth: 1600, naturalHeight: 900 } as HTMLImageElement;
    const bloco = { tipo: "imagem" as const, posicao: "abaixo" as const, altura: 100, largura: 100, sangrar: false, cantos: 18, borda: false, sombra: false, enquadramento: "inteira" as const, foco_x: 0.5, foco_y: 0.5,
      midia: { bucket: "mesa" as const, caminho: "c/a.jpg", origem: "internet" as const, credito: { fonte: "Notícia · Forbes Brasil", autor: null, licenca: "Imagem da matéria", url: "https://forbes.com.br/x" } } };
    expect(textoDoCredito({ ...bloco, credito_visivel: true })).toBe("Foto: Forbes Brasil");
    expect(textoDoCredito({ ...bloco, midia: { ...bloco.midia, credito: { ...bloco.midia.credito, fonte: "Pexels", autor: "Bia" } }, credito_visivel: true })).toBe("Foto: Pexels · Bia");
    const sem = quadro();
    desenharProfile(sem.canvas, { ...base, bloco }, "feed_4x5", { midia: { fonte: foto, largura: 1600, altura: 900 } });
    expect(textos(sem.ctx)).not.toContain("Foto: Forbes Brasil");
    const com = quadro();
    desenharProfile(com.canvas, { ...base, bloco: { ...bloco, credito_visivel: true } }, "feed_4x5", { midia: { fonte: foto, largura: 1600, altura: 900 } });
    expect(textos(com.ctx)).toContain("Foto: Forbes Brasil");
  });
});

describe("arte do estilo X (23/10): perfil, número grande, cabeçalho e quebras", () => {
  const blocoBase = { posicao: "abaixo" as const, altura: 100, largura: 100, sangrar: false, cantos: 24, borda: true, sombra: false, enquadramento: "inteira" as const, foco_x: 0.5, foco_y: 0.5 };
  it("o print do perfil no jeito do Instagram: números, nome, bio e o Seguir; no X, Seguindo e Seguidores", () => {
    const ig = quadro();
    desenharProfile(ig.canvas, { ...base, texto: "Siga para mais →", bloco: { ...blocoBase, tipo: "perfil", perfil: { estilo: "instagram", nome: "Thainá Rosa", username: "thaina.adv", bio: "Advogada previdenciária", posts: 120, seguidores: 34500, seguindo: 210 } } }, "feed_4x5");
    const t = textos(ig.ctx);
    expect(t).toEqual(expect.arrayContaining(["120", "34,5 mil", "210", "publicações", "seguidores", "seguindo", "Thainá Rosa", "Advogada previdenciária", "Seguir", "Mensagem"]));
    const x = quadro();
    desenharProfile(x.canvas, { ...base, texto: "Siga →", bloco: { ...blocoBase, tipo: "perfil", perfil: { estilo: "x", nome: "Thainá Rosa", username: "thaina.adv", seguidores: 1200, seguindo: 80 } } }, "feed_4x5");
    expect(textos(x.ctx)).toEqual(expect.arrayContaining(["Seguir", "@thaina.adv", "80", " Seguindo", "1,2 mil", " Seguidores"]));
  });
  it("número grande: o valor com a unidade e o rótulo embaixo", () => {
    const g = quadro();
    desenharProfile(g.canvas, { ...base, bloco: { ...blocoBase, tipo: "grafico", grafico: { tipo: "numero", unidade: "%", dados: [{ rotulo: "dos pedidos negados", valor: 40 }] } } }, "feed_4x5");
    expect(textos(g.ctx)).toEqual(expect.arrayContaining(["40%", "dos pedidos negados"]));
  });
  it("nome e @ formam um bloco centrado na altura da foto; o selo tem oito lobos", () => {
    const { canvas, ctx } = quadro();
    desenharProfile(canvas, base, "feed_4x5");
    const yNome = ctx.fillText.mock.calls.find((c) => c[0] === "Rafael Exemplo")![2] as number;
    const yArroba = ctx.fillText.mock.calls.find((c) => c[0] === "@rafael.exemplo")![2] as number;
    const foto = ctx.arc.mock.calls[0] as number[];
    const centro = foto[1];
    // O meio entre as duas linhas fica perto do centro da foto (dentro de 20 px).
    expect(Math.abs((yNome - 34 * 0.8 + yArroba) / 2 - centro)).toBeLessThan(20);
    expect(yArroba).toBeGreaterThan(yNome);
    expect(ctx.arc.mock.calls.length).toBeGreaterThanOrEqual(9);
  });
  it("quebra de linha e parágrafo saem como linhas separadas na lâmina", () => {
    const { canvas, ctx } = quadro();
    desenharProfile(canvas, { ...base, texto: "Primeira linha\nSegunda linha\n\nNovo parágrafo" }, "feed_4x5");
    const ys = ["Primeira linha", "Segunda linha", "Novo parágrafo"].map((s) => ctx.fillText.mock.calls.find((c) => c[0] === s)![2] as number);
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(ys[2] - ys[1]).toBeGreaterThan(ys[1] - ys[0]);
  });
  it("o texto acompanha o quadro: maior no 9:16 que no 1:1, com o mesmo tamanho escolhido", () => {
    const fonteDe = (formato: "quadrado_1x1" | "stories_9x16") => {
      const { canvas, ctx } = quadro();
      const fontes: string[] = [];
      ctx.fillText = vi.fn(() => { fontes.push(ctx.font); });
      desenharProfile(canvas, { ...base, texto: "Texto curto" }, formato);
      return Math.max(...fontes.map((f) => Number((/(\d+)px/.exec(f) || [])[1] || 0)));
    };
    expect(fonteDe("stories_9x16")).toBeGreaterThan(fonteDe("quadrado_1x1"));
  });
});

describe("correções de 24/10: negrito em todo modelo e cor do card do perfil", () => {
  const comFontes = () => {
    const q = quadro();
    const escritos: Array<[string, string]> = [];
    q.ctx.fillText = vi.fn((s: string) => { escritos.push([String(s), String(q.ctx.font)]); });
    return { ...q, escritos };
  };
  it("Post do X: **trecho** sai em negrito, vizinhos juntos, sem asterisco na peça", () => {
    const { canvas, escritos } = comFontes();
    desenharProfile(canvas, { ...base, estilo: "twitter", texto: "**Separe** **atestados** e laudos **" }, "feed_4x5");
    const textos = escritos.map(([s]) => s);
    expect(textos.some((s) => s.indexOf("**") >= 0)).toBe(false);
    expect(escritos.find(([s]) => s === "Separe atestados")?.[1]).toMatch(/^700 /);
    expect(escritos.find(([s]) => s.indexOf("e laudos") >= 0)?.[1]).toMatch(/^400 /);
  });
  it("Story: negrito no texto, quebras respeitadas; legenda do Instagram sem as marcas", () => {
    const st = comFontes();
    desenharProfile(st.canvas, { ...base, estilo: "story", texto: "Linha **forte**\nOutra" }, "stories_9x16");
    expect(st.escritos.find(([s]) => s === "forte")?.[1]).toMatch(/^700 /);
    expect(st.escritos.map(([s]) => s)).toContain("Outra");
    const ig = comFontes();
    desenharProfile(ig.canvas, { ...base, estilo: "instagram", texto: "Legenda **com** marca" }, "feed_4x5", { imagem: { naturalWidth: 800, naturalHeight: 1000 } as HTMLImageElement });
    expect(ig.escritos.some(([s]) => s.indexOf("**") >= 0)).toBe(false);
  });
  it("pedaços: o ** sem par sai e negritos vizinhos viram um (mesma leitura do campo)", () => {
    expect(pedacosDoTexto("**Separe** **atestados** e")).toEqual([{ texto: "Separe atestados", negrito: true }, { texto: " e", negrito: false }]);
    expect(normalizarNegrito("**a**  **b** c **")).toBe("**a  b** c");
  });
  it("card do perfil: cor própria com o texto no contraste e o Seguir na cor escolhida", () => {
    const { canvas, ctx } = quadro();
    const pintados: string[] = [];
    const fill = ctx.fill;
    ctx.fill = vi.fn(() => { pintados.push(String(ctx.fillStyle)); fill(); });
    const cores: Array<[string, string]> = [];
    ctx.fillText = vi.fn((s: string) => { cores.push([String(s), String(ctx.fillStyle)]); });
    const bloco = { posicao: "abaixo" as const, altura: 100, largura: 100, sangrar: false, cantos: 24, borda: true, sombra: false, enquadramento: "inteira" as const, foco_x: 0.5, foco_y: 0.5, tipo: "perfil" as const,
      perfil: { estilo: "instagram" as const, nome: "Thainá Rosa", username: "thaina.adv", seguidores: 3400, cor_fundo: "#15202b", cor_botao: "#ffd400" } };
    desenharProfile(canvas, { ...base, texto: "Siga →", bloco }, "feed_4x5");
    expect(cores.find(([s]) => s === "Thainá Rosa")?.[1]).toBe("#f7f9f9");
    expect(pintados).toContain("#ffd400");
    expect(cores.find(([s]) => s === "Seguir")?.[1]).toBe("#0f1419");
  });
});
