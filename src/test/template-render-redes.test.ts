import { describe, expect, it } from "vitest";
import { ALTURAS_PROFILE, CORES_DO_IG, CORES_DO_X, desenharProfile, linhasDaLegenda, numeroDoIG, numeroDoX, type FormatoProfile } from "@/components/mesa/profile/renderProfile";
import type { TemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";
import { caracteresDoX, limiteDoTexto, LIMITE_DO_X } from "../../supabase/functions/estudio-arte/modulos/limites-do-post";

/** Contexto 2D falso que anota tudo (as funções que o desenho chama e as cores aplicadas). */
function quadro() {
  const chamadas: Array<[string, unknown[]]> = [];
  const estado: Record<string, unknown> = { font: "16px x" };
  const ctx = new Proxy(estado, {
    get(alvo, nome: string) {
      if (nome in alvo) return alvo[nome];
      if (nome === "measureText") return (s: string) => ({ width: Array.from(s).length * Number(String(alvo.font).match(/(\d+)px/)?.[1] || "16") * 0.5 });
      if (nome === "createLinearGradient") return () => ({ addColorStop: () => undefined });
      return (...args: unknown[]) => { chamadas.push([nome, args]); };
    },
    set(alvo, nome: string, valor) {
      alvo[nome] = valor;
      if (nome === "fillStyle") chamadas.push(["fillStyle", [valor]]);
      return true;
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const textos = () => chamadas.filter((c) => c[0] === "fillText").map((c) => String(c[1][0]));
  const de = (nome: string) => chamadas.filter((c) => c[0] === nome).map((c) => c[1]);
  return { canvas, chamadas, textos, de };
}

const base: TemplateProfile = { versao: 1, estilo: "twitter", nome: "Padaria Bom Dia", username: "padariabomdia", verificado: true, texto: "Pão de fermentação natural sai às 7h.\nChegue cedo.", tamanho_texto: 34, cor_fundo: "#ffffff", tema: "claro", tamanho_foto: 88, espacamento: 48, arredondamento: 24 };
const foto = { naturalWidth: 1600, naturalHeight: 900 } as HTMLImageElement;

describe("Post do X desenhado como no app", () => {
  it("tem nome, @ · tempo, texto com quebra, mídia arredondada e as seis ações com números do X", () => {
    const q = quadro();
    const r = desenharProfile(q.canvas, { ...base, numeros: { respostas: 12, reposts: 1234, curtidas: 15_600, visualizacoes: 2_300_000 } }, "feed_4x5", { imagem: foto });
    const t = q.textos();
    expect(t).toContain("Padaria Bom Dia");
    expect(t).toContain("@padariabomdia · 2h");
    expect(t).toContain("Pão de fermentação natural sai às 7h.");
    expect(t).toContain("Chegue cedo.");
    expect(t).toEqual(expect.arrayContaining(["12", "1,2 mil", "15 mil", "2,3 mi"]));
    // A foto entra inteira (mesma proporção) e a mídia tem cantos de 16 px escalados.
    expect(r.imagem!.largura / r.imagem!.altura).toBeCloseTo(1600 / 900);
    const [ax, ay, aw, ah] = q.de("fillRect")[2] as number[];
    const clip = q.de("arcTo").find((c) => c[0] === ax + aw && c[1] === ay && c[3] === ay + ah) as number[];
    expect(clip[4]).toBeCloseTo(16 * 34 / 15);
    // Seis ícones de ação + o "…" (desenho próprio, por translate/scale).
    expect(q.de("translate").length).toBe(7);
  });
  it("muda as cores pelos temas claro, dim e escuro (apagar as luzes)", () => {
    for (const tema of ["claro", "dim", "escuro"] as const) {
      const q = quadro();
      desenharProfile(q.canvas, { ...base, tema }, "feed_4x5");
      const cores = q.de("fillStyle").map((c) => c[0]);
      expect(cores).toContain(CORES_DO_X[tema].fundo);
      expect(cores).toContain(CORES_DO_X[tema].texto);
    }
  });
  it("desenha a linha do fio só entre os posts do meio", () => {
    const linhas = (atual: number) => { const q = quadro(); desenharProfile(q.canvas, { ...base, fio: true }, "feed_4x5", { posicao: { atual, total: 3 } }); return q.de("moveTo").length; };
    const sozinho = (() => { const q = quadro(); desenharProfile(q.canvas, base, "feed_4x5"); return q.de("moveTo").length; })();
    expect(linhas(1)).toBe(sozinho + 1);
    expect(linhas(2)).toBe(sozinho + 2);
    expect(linhas(3)).toBe(sozinho + 1);
  });
  it.each(Object.keys(ALTURAS_PROFILE) as FormatoProfile[])("exporta %s em 1080 de largura, na altura do formato", (formato) => {
    const q = quadro();
    desenharProfile(q.canvas, base, formato, { imagem: foto });
    expect([q.canvas.width, q.canvas.height]).toEqual([1080, ALTURAS_PROFILE[formato]]);
  });
});

describe("Post do feed do Instagram", () => {
  const ig: TemplateProfile = { ...base, estilo: "instagram", texto: "Hoje tem fornada extra de pão de queijo, saindo quentinho às 16h para o café da tarde de quem passa por aqui.\n\nVem buscar o seu.\n#padaria #paodequeijo", local: "Curitiba, Paraná", curtido_por: "maria.silva", numeros: { comentarios: 48 } };
  it("tem anel, @, local, ações, curtido por, legenda com @ e \"mais\", comentários e data", () => {
    const q = quadro();
    desenharProfile(q.canvas, ig, "retrato_3x4", { imagem: foto });
    const t = q.textos();
    expect(t).toEqual(expect.arrayContaining(["padariabomdia", "Curitiba, Paraná", "Curtido por ", "maria.silva", "outras pessoas", "mais", "Ver todos os 48 comentários", "Há 2 horas"]));
    expect(t.filter((x) => x === "padariabomdia").length).toBe(2); // cabeçalho e o @ em negrito da legenda
    expect(q.de("fillStyle").map((c) => c[0])).toContain(CORES_DO_IG.claro.fundo);
  });
  it("carrossel mostra \"2/5\" e os pontinhos, com o atual em azul", () => {
    const q = quadro();
    desenharProfile(q.canvas, ig, "feed_4x5", { imagem: foto, posicao: { atual: 2, total: 5 } });
    expect(q.textos()).toContain("2/5");
    expect(q.de("fillStyle").map((c) => c[0])).toContain("#0095f6");
  });
  it("legenda corta em 2 linhas com \"… mais\" e abre inteira quando pedida", () => {
    const medir = (s: string) => s.length * 10;
    const curta = linhasDaLegenda("loja", "um dois três quatro cinco seis sete oito nove dez onze doze treze catorze quinze", 200, medir);
    expect(curta).toHaveLength(2);
    expect(curta[0].arroba).toBe("loja");
    expect(curta[1].mais).toBe(true);
    expect(curta.every((l, i) => medir(l.texto) + (i === 0 ? medir("loja ") : 0) + (l.mais ? medir("… mais") : 0) <= 200)).toBe(true);
    const aberta = linhasDaLegenda("loja", "um dois três quatro cinco seis sete oito nove dez onze doze treze catorze quinze", 200, medir, true);
    expect(aberta.length).toBeGreaterThan(2);
    expect(aberta.some((l) => l.mais)).toBe(false);
  });
});

describe("Story 9:16", () => {
  it("ocupa o quadro inteiro no formato Stories com uma barra por lâmina e o rodapé de resposta", () => {
    const q = quadro();
    desenharProfile(q.canvas, { ...base, estilo: "story", texto: "Fornada às 16h" }, "stories_9x16", { imagem: foto, posicao: { atual: 2, total: 4 } });
    expect([q.canvas.width, q.canvas.height]).toEqual([1080, 1920]);
    const brancas = q.de("fillStyle").map((c) => c[0]).filter((c) => c === "#ffffff" || c === "rgba(255,255,255,0.35)");
    expect(brancas.filter((c) => c === "rgba(255,255,255,0.35)").length).toBe(2);
    expect(q.textos()).toEqual(expect.arrayContaining(["padariabomdia", "2 h", "Enviar mensagem", "Fornada às 16h"]));
  });
  it("sem foto vira Story de texto no fundo escolhido, com a cor do texto pelo contraste", () => {
    const q = quadro();
    desenharProfile(q.canvas, { ...base, estilo: "story", texto: "Hoje tem", cor_fundo: "#ffe14d" }, "stories_9x16");
    const cores = q.de("fillStyle").map((c) => c[0]);
    expect(cores).toContain("#ffe14d");
    expect(cores).toContain("#111111");
  });
  it("nos outros formatos o Story é um quadro 9:16 no meio do fundo", () => {
    const q = quadro();
    desenharProfile(q.canvas, { ...base, estilo: "story" }, "feed_4x5", { imagem: foto });
    const [x, y, w, h] = q.de("fillRect")[1] as number[];
    expect(w / h).toBeCloseTo(9 / 16);
    expect(x).toBeGreaterThan(0);
    expect(y).toBe(48);
  });
});

describe("Limites reais das redes", () => {
  it("conta como o X: emoji vale 2 e link vale 23", () => {
    expect(caracteresDoX("abc")).toBe(3);
    expect(caracteresDoX("ação")).toBe(4);
    expect(caracteresDoX("oi 🙂")).toBe(5);
    expect(caracteresDoX("veja https://exemplo.com.br/um/caminho/bem/longo")).toBe(5 + 23);
  });
  it("avisa acima de 280 no X, da legenda de 2.200 e de 30 hashtags no Instagram, e do Story", () => {
    expect(limiteDoTexto("twitter", "a".repeat(LIMITE_DO_X)).passou).toBe(false);
    const passou = limiteDoTexto("twitter", "a".repeat(LIMITE_DO_X + 5));
    expect(passou.passou).toBe(true);
    expect(passou.texto).toContain("Passou 5");
    expect(limiteDoTexto("instagram", "a".repeat(2201)).passou).toBe(true);
    expect(limiteDoTexto("instagram", Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ")).texto).toContain("31 hashtags");
    expect(limiteDoTexto("instagram", "oi #um #dois").texto).toContain("2 hashtags");
    expect(limiteDoTexto("story", "a".repeat(161)).passou).toBe(true);
  });
  it("formata números como cada app em português", () => {
    expect(numeroDoX(999)).toBe("999");
    expect(numeroDoX(1000)).toBe("1 mil");
    expect(numeroDoX(1250)).toBe("1,2 mil");
    expect(numeroDoX(48_000)).toBe("48 mil");
    expect(numeroDoX(3_400_000)).toBe("3,4 mi");
    expect(numeroDoIG(1234567)).toBe("1.234.567");
  });
  it("texto do X que não cabe é recusado, nunca cortado", () => {
    const q = quadro();
    expect(() => desenharProfile(q.canvas, { ...base, texto: "palavra ".repeat(400), tamanho_texto: 56 }, "quadrado_1x1")).toThrow("não cabe");
  });
});

describe("Edição à mão do post do X", () => {
  const comNumeros = { ...base, numeros: { respostas: 12, curtidas: 1500 } };
  it("esconde números e tempo quando pedido", () => {
    const q = quadro();
    desenharProfile(q.canvas, { ...comNumeros, ocultar_numeros: true, ocultar_tempo: true }, "feed_4x5");
    expect(q.textos()).not.toContain("12");
    expect(q.textos()).toContain("@padariabomdia");
    expect(q.textos()).not.toContain("@padariabomdia · 2h");
  });
  it("a mídia encolhe pela porcentagem, sem cortar a foto", () => {
    const larguraDaMidia = (midia?: number) => { const q = quadro(); desenharProfile(q.canvas, { ...base, midia }, "feed_4x5", { imagem: foto }); return (q.de("fillRect")[2] as number[])[2]; };
    expect(larguraDaMidia(50)).toBeCloseTo(larguraDaMidia(100) / 2, 0);
  });
  it("a escala aumenta ou diminui o post inteiro no quadro", () => {
    const larguraDoPost = (escala?: number) => { const q = quadro(); desenharProfile(q.canvas, { ...base, escala }, "feed_4x5"); return Math.max(...(q.de("arcTo").slice(0, 4) as number[][]).map((c) => c[0])) - Math.min(...(q.de("arcTo").slice(0, 4) as number[][]).map((c) => c[2])); };
    expect(larguraDoPost(60)).toBeLessThan(larguraDoPost(100));
  });
});
