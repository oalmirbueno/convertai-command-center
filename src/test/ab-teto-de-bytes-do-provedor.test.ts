import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  imagensNoTetoDeBytes,
  mensagensNoTetoDeBytes,
  tamanhoEmBase64,
  TETO_BASE64_DAS_IMAGENS,
} from "../../supabase/functions/_shared/capacidades-imagem";

/**
 * Anti-bug 26/09: soma das imagens enviadas acima de 30 MB derruba o pedido
 * com 413 no OpenRouter. O motor corta pelo teto de 24 MB de base64, em ordem,
 * com aviso; nas conversas, as imagens mais antigas saem primeiro.
 */

const img = (mb: number, nome = "") => ({ bytes: new Uint8Array(Math.round(mb * 1024 * 1024)), mime: "image/jpeg", nome });
const motor = readFileSync(resolve(process.cwd(), "supabase/functions/_shared/ia-motor.ts"), "utf8");

describe("teto de bytes das imagens por pedido", () => {
  it("base64 conta 4/3 do arquivo", () => {
    expect(tamanhoEmBase64(3)).toBe(4);
    expect(tamanhoEmBase64(4)).toBe(8);
    expect(TETO_BASE64_DAS_IMAGENS).toBe(24 * 1024 * 1024);
  });

  it("abaixo do teto nada muda (mesmo array)", () => {
    const lista = [img(2), img(3), img(4)];
    const r = imagensNoTetoDeBytes(lista);
    expect(r.imagens).toBe(lista);
    expect(r.cortadas).toBe(0);
    expect(r.aviso).toBeNull();
  });

  it("corta do fim a partir da primeira que não cabe, mantendo a numeração", () => {
    // 6 MB viram 8 MB em base64: 3 cabem (24), a 4ª não; a 5ª pequena também sai (ordem).
    const lista = [img(6, "a"), img(6, "b"), img(6, "c"), img(6, "d"), img(0.1, "e")];
    const r = imagensNoTetoDeBytes(lista);
    expect(r.imagens.map((x) => x.nome)).toEqual(["a", "b", "c"]);
    expect(r.cortadas).toBe(2);
    expect(r.aviso).toBe("2 imagens ficaram de fora: juntas passavam de 24 MB, o limite do provedor por pedido.");
  });

  it("a primeira (editada ou identidade) sempre vai, mesmo grande", () => {
    const r = imagensNoTetoDeBytes([img(20, "grande"), img(1, "b")]);
    expect(r.imagens.map((x) => x.nome)).toEqual(["grande"]);
    expect(r.cortadas).toBe(1);
  });

  it("na conversa, as imagens da mensagem mais nova ficam e as antigas saem", () => {
    const mensagens = [
      { papel: "usuario", conteudo: "antiga", imagens: [img(8, "velha1"), img(8, "velha2")] },
      { papel: "agente", conteudo: "ok" },
      { papel: "usuario", conteudo: "nova", imagens: [img(6, "n1"), img(6, "n2")] },
    ];
    const r = mensagensNoTetoDeBytes(mensagens);
    expect(r.mensagens[2].imagens!.map((x) => x.nome)).toEqual(["n1", "n2"]);
    // 16 MB da nova; a velha1 (10,7 MB em base64) já não cabe, e a velha2 vai junto.
    expect(r.mensagens[0].imagens).toEqual([]);
    expect(r.cortadas).toBe(2);
    expect(r.aviso).toContain("2 imagens ficaram de fora");
    expect(mensagens[0].imagens).toHaveLength(2);
  });

  it("conversa abaixo do teto volta igual", () => {
    const mensagens = [{ papel: "usuario", conteudo: "x", imagens: [img(1)] }];
    const r = mensagensNoTetoDeBytes(mensagens);
    expect(r.mensagens).toBe(mensagens);
    expect(r.cortadas).toBe(0);
  });

  it("o motor aplica o teto no texto (avisando o modelo) e nos dois caminhos de imagem do OpenRouter", () => {
    expect(motor).toContain("const noTeto = mensagensNoTetoDeBytes(e.mensagens);");
    expect(motor).toContain("(Aviso do sistema: ${noTeto.aviso})");
    expect(motor.split("const noTeto = imagensNoTetoDeBytes(noLimite.imagens);").length - 1).toBe(2);
    expect(motor.split("[noLimite.aviso, noTeto.aviso]").length - 1).toBe(2);
  });
});
