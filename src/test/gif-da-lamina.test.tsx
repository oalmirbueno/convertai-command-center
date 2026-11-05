import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODELO_DO_GIF, promptDoGif, quadrosDoGif, tamanhoDoGif } from "../../supabase/functions/estudio-arte/gif-da-arte";
import { textoDosQuadros } from "@/components/mesa/GifDaLamina";

/** 05/11/2026 (dono): a arte do Estúdio pode virar GIF, como uma peça a mais. */
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");

// GIF mínimo de verdade: cabeçalho, paleta de 2 cores e N quadros 1x1, com extensão de controle antes de cada um.
const gif = (quadros: number) => {
  const b = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  for (let n = 0; n < quadros; n++) {
    b.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0);
    b.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0);
  }
  b.push(0x3b);
  return new Uint8Array(b);
};

describe("quadros do arquivo", () => {
  it("conta os quadros pelos blocos do GIF", () => {
    expect(quadrosDoGif(gif(1))).toBe(1);
    expect(quadrosDoGif(gif(12))).toBe(12);
  });

  it("o que não é GIF dá zero", () => {
    expect(quadrosDoGif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(0);
    expect(quadrosDoGif(new Uint8Array())).toBe(0);
  });

  it("a tela só chama de animado o que tem mais de um quadro", () => {
    expect(textoDosQuadros(12)).toBe("Animado, 12 quadros");
    expect(textoDosQuadros(1)).toContain("sem movimento");
  });
});

describe("pedido ao gerador", () => {
  it("leva o texto exato e a direção; o movimento é opcional", () => {
    const p = promptDoGif({ texto: "Seu tráfego está dormindo?", cena: "fundo verde", movimento: "o produto gira" });
    expect(p).toContain('"Seu tráfego está dormindo?"');
    expect(p).toContain("Cena: fundo verde");
    expect(p).toContain("Movimento: o produto gira.");
    expect(promptDoGif({})).toContain("Sem texto na peça.");
    expect(promptDoGif({})).toContain("Movimento: uma luz passa");
  });

  it("só tamanhos que cabem na folha de 9 quadros, na proporção da lâmina", () => {
    expect(tamanhoDoGif("1088x1360")).toBe("640x800");
    expect(tamanhoDoGif("1024x1024")).toBe("640x640");
    expect(tamanhoDoGif("1088x1920")).toBe("576x1024");
    expect(tamanhoDoGif("1536x1024")).toBe("1024x576");
    expect(tamanhoDoGif("qualquer")).toBe("640x800");
  });

  it("usa o 2.6 sem reserva e sem imagem de base (com base o gerador devolve PNG); o padrão do motor continua PNG", () => {
    expect(MODELO_DO_GIF).toBe("openrouter:openai/gpt-image-2.6-sunburst");
    const servidor = ler("supabase/functions/estudio-arte/index.ts");
    const corpo = servidor.slice(servidor.indexOf("async function gifDaLamina"), servidor.indexOf("async function ajustarCard"));
    expect(servidor).toContain("gif_card: gifDaLamina");
    expect(corpo).toContain("mesmoModelo: true");
    expect(corpo).toContain('formatoSaida: "gif"');
    expect(corpo).toContain("referencias: []");
    expect(corpo).not.toContain("editar:");
    expect(ler("supabase/functions/_shared/ia-motor.ts")).toContain('corpo.output_format = e.formatoSaida ?? "png";');
  });

  it("a lâmina não muda: o GIF é guardado à parte, sem criar versão", () => {
    const servidor = ler("supabase/functions/estudio-arte/index.ts");
    const corpo = servidor.slice(servidor.indexOf("async function gifDaLamina"), servidor.indexOf("async function ajustarCard"));
    expect(corpo).not.toContain("gravarVersao");
    expect(corpo).toContain("card-${ordem}-gif-");
  });
});
