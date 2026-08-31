import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extrairPaleta, identidadeEmTexto, luminancia, paraHex, textoSobre,
} from "@/lib/identidadeVisual";
import { iniciaisDe } from "@/components/admin/LogoDoCliente";

/**
 * A identidade que dá para extrair — e a que não dá.
 *
 * Logo, nome, bio e site vêm do perfil; a cor sai dos pixels da logo. A
 * tipografia não vem de lugar nenhum, e um nome de fonte chutado aqui
 * seria copiado para um briefing e viraria decisão de marca baseada num
 * palpite do painel.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

/** Monta pixels RGBA a partir de uma lista de [r,g,b,a]. */
const px = (...cores: Array<[number, number, number, number]>) =>
  new Uint8ClampedArray(cores.flat());

describe("a paleta agrupa tons próximos", () => {
  it("dois pixels quase iguais contam como a mesma cor", () => {
    // Sem agrupar, uma logo com gradiente devolveria mil "cores da marca"
    // e nenhuma seria útil.
    const paleta = extrairPaleta(px([200, 10, 10, 255], [203, 12, 9, 255]));
    expect(paleta).toHaveLength(1);
    expect(paleta[0].peso).toBe(2);
  });

  it("o representante é a MÉDIA do grupo, não o primeiro pixel", () => {
    // Assim a cor fica no centro do grupo em vez de num canto dele.
    const paleta = extrairPaleta(px([200, 0, 0, 255], [210, 0, 0, 255]));
    expect(paleta[0].hex).toBe("#CD0000");
  });

  it("pixel transparente não vira cor da marca", () => {
    // A borda de um PNG arredondado renderia um cinza que não existe na marca.
    const paleta = extrairPaleta(px([255, 255, 255, 10], [0, 0, 200, 255]));
    expect(paleta).toHaveLength(1);
    expect(paleta[0].hex).toBe("#0000C8");
  });

  it("ordena pela frequência e devolve a proporção", () => {
    const paleta = extrairPaleta(px(
      [0, 0, 200, 255], [0, 0, 200, 255], [0, 0, 200, 255], [200, 0, 0, 255],
    ));
    expect(paleta[0].hex).toBe("#0000C8");
    expect(paleta[0].proporcao).toBeCloseTo(0.75, 5);
    expect(paleta[1].proporcao).toBeCloseTo(0.25, 5);
  });

  it("imagem toda transparente devolve vazio, e não uma cor inventada", () => {
    expect(extrairPaleta(px([10, 10, 10, 0]))).toHaveLength(0);
  });
});

describe("o contraste do texto sobre a cor", () => {
  it("escuro pede texto branco, claro pede preto", () => {
    expect(textoSobre("#000000")).toBe("#FFFFFF");
    expect(textoSobre("#FFFFFF")).toBe("#000000");
    expect(textoSobre("#1A1A1A")).toBe("#FFFFFF");
  });

  it("a luminância cresce do preto para o branco", () => {
    expect(luminancia("#000000")).toBeLessThan(luminancia("#808080"));
    expect(luminancia("#808080")).toBeLessThan(luminancia("#FFFFFF"));
  });

  it("o hex sai sempre com dois dígitos por canal", () => {
    expect(paraHex(0, 5, 255)).toBe("#0005FF");
  });
});

describe("o texto para o briefing", () => {
  it("diz que a tipografia não foi informada, em vez de omitir", () => {
    // Quem cola isso precisa saber que o campo existe e está vazio, e não
    // concluir que a marca não tem fonte definida.
    const texto = identidadeEmTexto({ nome: "Marca", cores: [] });
    expect(texto).toContain("não informada");
    expect(texto).toContain("o Instagram não expõe a fonte da marca");
  });

  it("usa a tipografia quando alguém preencheu", () => {
    const texto = identidadeEmTexto({ nome: "Marca", cores: [], tipografia: "Poppins" });
    expect(texto).toContain("Tipografia: Poppins");
    expect(texto).not.toContain("não informada");
  });

  it("cada cor sai com o peso dela na imagem", () => {
    const texto = identidadeEmTexto({
      nome: "Marca",
      cores: [{ hex: "#FF0000", peso: 3, proporcao: 0.75 }],
    });
    expect(texto).toContain("#FF0000");
    expect(texto).toContain("75.0%");
  });
});

describe("a logo do cliente na lista", () => {
  const comp = ler("src/components/admin/LogoDoCliente.tsx");

  it("as iniciais dizem que falta a imagem, e não fingem ser a marca", () => {
    expect(iniciaisDe("Preserva Eco")).toBe("PE");
    expect(iniciaisDe("  ")).toBe("?");
    expect(iniciaisDe(null)).toBe("?");
  });

  it("uma consulta só para a grade inteira", () => {
    // Uma por cartão seria N chamadas para desenhar a mesma tela.
    expect(comp).toContain("useIdentidadesDosClientes");
    expect(comp).toContain("porCliente.has(linha.client_id)");
  });

  it("a CDN da Meta exige referrer vazio", () => {
    expect(comp).toContain('referrerPolicy="no-referrer"');
  });

  it("aparece nas duas grades, e não só numa", () => {
    for (const rel of ["src/pages/AdminMetricas.tsx", "src/pages/AdminAds.tsx"]) {
      expect(ler(rel)).toContain("<LogoDoCliente");
    }
  });
});

describe("a aba de identidade", () => {
  const comp = ler("src/components/admin/IdentidadeDoCliente.tsx");

  it("a tipografia é campo do humano, não invenção do painel", () => {
    expect(comp).toContain("Este campo é seu de propósito");
    expect(comp).toContain("Preferi deixar em branco a preencher com invenção");
  });

  it("CORS bloqueado vira aviso, e não paleta falsa", () => {
    // Cor errada num briefing vira arte errada.
    expect(comp).toContain("não deixa o painel ler os pixels (CORS)");
  });

  it("lê só 64×64: mais pixels não melhoram a paleta", () => {
    expect(comp).toContain("const lado = 64;");
  });

  it("dá para copiar tudo e baixar a logo", () => {
    expect(comp).toContain("Copiar tudo");
    expect(comp).toContain("baixarLogo");
  });

  it("está montada como aba nas métricas", () => {
    const pagina = ler("src/pages/AdminMetricas.tsx");
    expect(pagina).toContain("<IdentidadeDoCliente clientId={clientId}");
    expect(pagina).toContain('abaDoCliente === "desempenho"');
  });

  it("o detalhe deixou de limitar os posts em 25", () => {
    // Agora que a coleta pagina, limitar aqui esconderia justamente os
    // posts que passaram a existir.
    expect(ler("src/pages/AdminMetricas.tsx")).toContain("useSocialPostMetrics(clientId, 200)");
  });
});
