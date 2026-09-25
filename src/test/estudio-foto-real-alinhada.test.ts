import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lâmina com foto real que saía "uma em cima da outra" (Thainá, 24/09): o
 * gerador reenquadrava a foto (zoom e deslocamento) e o código colava o
 * original no lugar antigo, fora da área do texto. Mais: o prompt pedia véu
 * atrás do texto, fundo liso atrás da logo e "mude a pose e o enquadramento".
 * A conta do alinhamento foi medida em Deno com fotos (zoom 1,12 deslocado:
 * achou 1,122; mesma cena: erro 0,6 a 3,4; pose trocada: 31; outra foto: 69).
 */
const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");
const imagem = ler("supabase/functions/_shared/imagem-local.ts");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const direcao = ler("supabase/functions/_shared/direcao-arte.ts");
const gerar = estudio.slice(estudio.indexOf("async function gerarCard("), estudio.indexOf("// 2) Carrossel contínuo"));

describe("foto real: o original volta alinhado ao que o gerador devolveu", () => {
  it("estima escala e deslocamento antes de devolver o original", () => {
    expect(imagem).toContain("export function estimarAlinhamento(original: Image, gerado: Image, abertas: Area[])");
    expect(imagem).toContain("const est = estimarAlinhamento(o, g, abertas);");
    // Busca do grosso ao fino, com mapas derivados de um só (limite de CPU da função).
    expect(imagem).toContain("const mapas = [9, 3, 1].map((fator) =>");
    expect(imagem).toContain("{ de: 0.8, ate: 1.3, passo: 0.025 }");
    // Só aceita o alinhamento quando ele melhora de verdade.
    expect(imagem).toContain("est.erro < est.erroSemAlinhar * 0.9");
  });

  it("devolverOriginalForaDasAreas continua com a mesma assinatura e passa pelo alinhamento", () => {
    expect(imagem).toContain("return (await devolverOriginalAlinhado(original, gerado, abertas, penaPx, opcoes)).png;");
    expect(imagem).toMatch(/export async function devolverOriginalForaDasAreas\(\n  original: Uint8Array,\n  gerado: Uint8Array,\n  abertas: Area\[\],\n  penaPx = 28,/);
  });

  it("na lâmina com foto real, dentro da área fica só o que o gerador escreveu", () => {
    expect(imagem).toContain("const recortouTexto = !!opcoes.texto && abertas.length > 0 && erro <= LIMITE_ERRO_RECORTE;");
    expect(imagem).toContain("export const LIMITE_ERRO_RECORTE = 16;");
    // Cena trocada: nada de colagem; fica a imagem inteira do gerador, marcada.
    expect(imagem).toContain("if (opcoes.texto && !(erro <= LIMITE_CENA_MUDADA)) {");
    expect(imagem).toContain("export const LIMITE_CENA_MUDADA = 24;");
    // Só na foto real: o panorama cola as letras na fatia intacta (colarMudancasNaBase).
    expect(gerar).toContain("await devolverOriginalAlinhado(baseFoto, img.png, areas, 28, { texto: fotoFixa })");
    expect(gerar).toContain("cena_mudada: volta.cenaMudada");
  });
});

describe("foto real: recorte pelo foco e logo pelo código", () => {
  it("a foto entra na lâmina recortada pelo foco, não pelo centro cego", () => {
    expect(imagem).toContain("return await cobrirComFoco(await decodificar(bytes), largura, altura).encode(1);");
    expect(imagem).toContain("const y = Math.max(0, Math.min(a - altura, Math.round(fy * a - altura * 0.42)));");
    // O Storage só reduz (contain); o "cover" dele cortava pelo centro.
    const fotoReal = estudio.slice(estudio.indexOf("async function fotoRealNaLamina("), estudio.indexOf("async function modeloDoPapel("));
    expect(fotoReal).toContain('transform: { width: 2000, height: 2500, resize: "contain", format: "origin" }');
    expect(fotoReal).not.toContain('resize: "cover"');
  });

  it("a logo oficial é aplicada pelo código na lâmina com foto real fixa", () => {
    // Com referência escolhida a lâmina replica a referência (foto recomposta), então a foto fixa sai de cena.
    expect(gerar).toContain("const fotoFixa = !!baseFoto && !panorama && !elementos.length && !replicar;");
    // Desde 25/09 a logo entra pelo código em todos os modos (acabamento da lâmina), limpa e na versão que contrasta.
    expect(gerar).toContain("logosNoCodigo = daMarca.logos;");
    expect(gerar).toContain("const fim = await acabar(final);");
    expect(gerar).toContain("      logoNoCodigo,\n");
    // Halo do valor oposto só quando falta contraste, sem caixa e sem escurecer a foto.
    expect(imagem).toContain("const poucoContraste = clara ? fundo > 150 : fundo < 95;");
  });
});

describe("foto real: o prompt não pede mais o que quebrava a lâmina", () => {
  it("sem véu ou painel atrás do texto e sem reenquadrar", () => {
    expect(direcao).not.toContain("um painel ou véu suave dentro da área do texto");
    expect(direcao).toContain("Desenhe só o texto, direto sobre a foto, sem painel, véu, caixa ou desfoque atrás dele.");
    expect(gerar).toContain("NAO_REENQUADRAR,");
    expect(estudio).toContain("Não reenquadre a imagem 1: mesmo corte, mesmo zoom");
  });

  it("não manda mudar pose e enquadramento quando a foto está decidida", () => {
    expect(direcao).toContain("opcoes.anteriores && opcoes.anteriores.length && serie && !foto");
    expect(direcao).toContain("opcoes.fioVisual && serie && !foto");
    expect(gerar).toContain("NÃO copie a foto nem o enquadramento dele, a foto desta lâmina é a imagem 1");
  });

  it("a logo aplicada pelo código não é desenhada pelo gerador", () => {
    expect(direcao).toContain("opcoes.logoNoCodigo && opcoes.levaLogo");
    expect(direcao).toContain("A logo oficial é aplicada depois pelo sistema no canto ${cantoDaLogo}");
  });
});
