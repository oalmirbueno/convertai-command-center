import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocoDaLogo,
  corDaMarcaNoPapel,
  corOpostaNaPaleta,
  descricaoDaLogo,
  ESQUEMA_MOLDE,
  legendaDaLogo,
  mapearNoMolde,
  nomeDaCor,
  normalizarLeituraDaLogo,
  PADRAO_DA_LAMINA,
  promptDaLamina,
  SISTEMA_MOLDE,
  textoExatoNoMolde,
  type MarcaParaDirecao,
  type MoldeDaReferencia,
} from "../../supabase/functions/_shared/direcao-arte";
import { qualidadeNaGeracao } from "@/components/mesa/estudioUtil";

/**
 * Estúdio da Mesa, 27/09 (dono: "está errando tudo, não segue nada da
 * referência, não usa as técnicas, a logo não tem nada a ver").
 * 1. Logo: anexo achatado num fundo de contraste, texto exato e cores por escrito, contraste com a lâmina.
 * 2. Replicar: molde lido por visão (layout como especificação), mapeado bloco a bloco.
 * 3. Modos: técnicas do padrão de volta, imagem primeiro, proibições sem esvaziar a cena.
 * 4. Transparência: prompt e legendas gravados na versão.
 */

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const imagemLocal = ler("supabase/functions/_shared/imagem-local.ts");
const corpoDe = (nome: string) => {
  const i = estudio.indexOf(`function ${nome}(`);
  const fins = [estudio.indexOf("\nasync function ", i + 10), estudio.indexOf("\nfunction ", i + 10)].filter((x) => x > 0);
  return estudio.slice(i, Math.min(...fins));
};

const MARCA: MarcaParaDirecao = {
  nomeCliente: "AcelerIQ",
  paleta: [
    { hex: "#00D52B", nome: "Verde vibrante", papel: "primária e destaque" },
    { hex: "#111111", nome: "Preto carvão", papel: "secundária e fundo" },
    { hex: "#F7F7F7", nome: "Branco suave", papel: "fundo e texto sobre" },
  ],
  estilo: null,
  regras: null,
  fontes: [{ nome: "Citrica", papel: "titulo" }, { nome: "Roboto", papel: "texto" }],
  temLogo: true,
};
const LOGO_ACELERIQ = { tom: "#00D52B", clara: true, aspecto: 3.4, cores: ["#FFFFFF", "#00D52B"] };

describe("1. logo: o gerador vê a logo inteira e sabe o texto dela", () => {
  it("leitura da logo por visão: texto, partes com cor e símbolo; baixa confiança ou vazia não vale", () => {
    const l = normalizarLeituraDaLogo({
      texto_da_logo: "Aceleriq",
      partes: [{ texto: "Aceler", cor_nome: "branco", cor_hex: "#ffffff" }, { texto: "iq", cor_nome: "verde", cor_hex: "#00d52b" }],
      simbolo: "seta angular verde e branca à esquerda",
      confianca: "alta",
    });
    expect(l).toEqual({ texto: "Aceleriq", partes: [{ texto: "Aceler", cor: "branco #FFFFFF" }, { texto: "iq", cor: "verde #00D52B" }], simbolo: "seta angular verde e branca à esquerda" });
    expect(normalizarLeituraDaLogo({ texto_da_logo: "Aceleriq", partes: [], simbolo: "", confianca: "baixa" })).toBeNull();
    expect(normalizarLeituraDaLogo({ texto_da_logo: "", partes: [], simbolo: "" })).toBeNull();
  });

  it("descrição da logo: o texto exato com a cor de cada parte; sem leitura, o nome da marca sem inventar grafia", () => {
    const leitura = normalizarLeituraDaLogo({ texto_da_logo: "Aceleriq", partes: [{ texto: "Aceler", cor_nome: "branco", cor_hex: "#FFFFFF" }, { texto: "iq", cor_nome: "verde", cor_hex: "#00D52B" }], simbolo: "seta", confianca: "alta" });
    const d = descricaoDaLogo({ nome: "AcelerIQ", leitura, medida: LOGO_ACELERIQ })!;
    expect(d).toContain('As letras da logo formam exatamente "Aceleriq" ("Aceler" em branco #FFFFFF, "iq" em verde #00D52B), com estas maiúsculas e minúsculas.');
    expect(d).toContain("Cores medidas no arquivo: branco #FFFFFF, verde #00D52B.");
    const semLeitura = descricaoDaLogo({ nome: "AcelerIQ", leitura: null, medida: LOGO_ACELERIQ })!;
    expect(semLeitura).toContain("A logo é a da marca AcelerIQ: copie as letras exatamente como estão no anexo (todas elas, inclusive as brancas ou claras)");
    expect(descricaoDaLogo({ nome: "", leitura: null, medida: null })).toBeNull();
    expect(nomeDaCor("#00D52B")).toBe("verde");
    expect(nomeDaCor("#FFFFFF")).toBe("branco");
    expect(nomeDaCor("#111111")).toBe("preto");
  });

  it("legenda do anexo: o fundo de contraste é só para enxergar a logo; nunca vai para a arte", () => {
    const clara = legendaDaLogo({ clara: true, texto: "Aceleriq" });
    expect(clara).toContain('LOGO OFICIAL da marca (as letras dizem "Aceleriq")');
    expect(clara).toContain("fundo cinza-escuro liso SÓ para você enxergar as partes claras; esse fundo não faz parte da logo e não vai para a arte");
    expect(legendaDaLogo({ clara: false })).toContain("fundo claro liso SÓ para você enxergar a logo");
    expect(legendaDaLogo({ comFundo: false })).not.toContain("SÓ para você enxergar");
  });

  it("bloco LOGO: o que a logo é, o tamanho mínimo de sempre e o contraste com a lâmina (logo clara em fundo claro ganha área escura)", () => {
    const b = blocoDaLogo({ levaLogo: true, temLogo: true, quadro: { largura: 1080, altura: 1350 }, logo: LOGO_ACELERIQ, descricao: 'As letras da logo formam exatamente "Aceleriq".', fundoDaLamina: "#F7F7F7", corParaALogo: "#111111" }).join("\n");
    expect(b).toContain('- O que a logo é: As letras da logo formam exatamente "Aceleriq".');
    expect(b).toContain("nunca menor que");
    expect(b).toContain("fica sobre uma área ESCURA da própria arte");
    expect(b).toContain("O fundo desta lâmina é claro e a logo é clara: a composição tem uma parte escura para ela (uma faixa do grid de borda a borda em #111111");
    // Fundo escuro: sem a regra extra.
    const escuro = blocoDaLogo({ levaLogo: true, temLogo: true, quadro: { largura: 1080, altura: 1350 }, logo: LOGO_ACELERIQ, fundoDaLamina: "#111111", corParaALogo: "#111111" }).join("\n");
    expect(escuro).not.toContain("O fundo desta lâmina é claro");
    // Área fixa da máscara (foto real, contínuo): o lugar é a área, sem regra de faixa.
    const fixa = blocoDaLogo({ levaLogo: true, temLogo: true, quadro: { largura: 1080, altura: 1350 }, logo: LOGO_ACELERIQ, fundoDaLamina: "#F7F7F7", areaFixa: { x0: 10, y0: 5, x1: 40, y1: 12 } }).join("\n");
    expect(fixa).not.toContain("O fundo desta lâmina é claro");
    expect(corOpostaNaPaleta(MARCA.paleta, true)).toBe("#111111");
    expect(corOpostaNaPaleta(MARCA.paleta, false)).toBe("#F7F7F7");
  });

  it("servidor: logo achatada no anexo (gerar e ajuste), leitura guardada pelo hash, nada colado pelo código", () => {
    const anexo = corpoDe("anexoDaLogo");
    expect(anexo).toContain("await logoSobreContraste(logo.imagem.bytes, clara)");
    expect(anexo).toContain("legendaDaLogo({ clara, texto: leitura?.texto || null, comFundo: !!achatada })");
    const leitura = corpoDe("leituraDaLogo");
    expect(leitura).toContain("const hash = (await sha256Hex(logo.imagem.bytes)).slice(0, 24);");
    expect(leitura).toContain('tarefa: "leitura_referencia"');
    expect(corpoDe("ajustarCard")).toContain("const anexo = await anexoDaLogo(base, logo, nome, ch.userId);");
    expect(corpoDe("gerarCard")).toContain("logoDescricao: anexoLogo ? anexoLogo.descricao : null,");
    expect(estudio).not.toContain("LEGENDA_DA_LOGO");
    // Achatar é leve: tela da logo (até 512 px) com margem, sem abrir nada grande.
    expect(imagemLocal).toContain("export async function logoSobreContraste(bytes: Uint8Array, clara: boolean): Promise<Uint8Array> {");
    expect(imagemLocal).toContain('export const FUNDO_DA_LOGO_CLARA = "#2B2B2B";');
    // Logo com parte branca grande é clara (o verde sozinho escondia o branco).
    expect(imagemLocal).toContain("clara: luminancia > 0.45 || fracaoBranca >= 0.2");
  });
});

const MOLDE: MoldeDaReferencia = {
  versao: 1,
  proporcao: "4:5",
  fundo: "escuro liso",
  cor_do_fundo: "#0A0A0A",
  grade: "Título gigante embaixo; objeto no centro; @perfil no topo.",
  assunto: { tipo: "objeto", descricao: "objeto no centro", enquadramento: "frontal", x0: 25, y0: 20, x1: 75, y1: 60 },
  blocos: [
    { papel: "perfil", x0: 35, y0: 3, x1: 65, y1: 6, altura_da_letra: 1.6, linhas: 1, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "medio", cor: "#FFFFFF", alinhamento: "centro" },
    { papel: "titulo", x0: 5, y0: 64, x1: 95, y1: 92, altura_da_letra: 11, linhas: 2, caixa_alta: true, familia: "sem serifa", largura_da_letra: "condensada", peso: "black", cor: "#39E75F", alinhamento: "centro" },
    { papel: "cta", x0: 30, y0: 94, x1: 70, y1: 97, altura_da_letra: 1.8, linhas: 1, caixa_alta: true, familia: "sem serifa", largura_da_letra: "normal", peso: "negrito", cor: "#FFFFFF", alinhamento: "centro" },
  ],
  elementos: [],
  tratamento: "Contraste alto, objeto iluminado de cima.",
};

describe("2. molde da referência: leitura por visão como especificação de layout", () => {
  it("o esquema pede posição, tamanho, caixa, família, largura, peso e cor de cada bloco, assunto e elementos", () => {
    const req = (ESQUEMA_MOLDE.schema.properties.blocos.items as { required: string[] }).required;
    for (const campo of ["papel", "x0", "y0", "x1", "y1", "altura_da_letra", "linhas", "caixa_alta", "familia", "largura_da_letra", "peso", "cor", "alinhamento"]) expect(req).toContain(campo);
    expect(ESQUEMA_MOLDE.schema.required).toEqual(["proporcao", "fundo", "cor_do_fundo", "grade", "assunto", "blocos", "elementos", "tratamento"]);
    expect(SISTEMA_MOLDE).toContain("Meça; não copie o texto nem a marca da peça.");
    expect(SISTEMA_MOLDE).not.toMatch(/[—–]/);
  });

  it("mapeia headline no título, CTA no CTA e a logo no @perfil; texto sem lugar vai abaixo do principal", () => {
    const mapa = mapearNoMolde(
      [{ papel: "headline", texto: "Destroem sua campanha" }, { papel: "apoio", texto: "Três erros comuns" }, { papel: "cta", texto: "Salve" }],
      MOLDE,
    );
    expect(mapa.lugares.map((l) => l.alvo && l.alvo.papel)).toEqual(["titulo", null, "cta"]);
    expect(mapa.marca && mapa.marca.papel).toBe("perfil");
    expect(mapa.vagos).toEqual([]);
    expect(textoExatoNoMolde("Destroem sua campanha\nTrês erros comuns\nSalve", mapa)).toBe("DESTROEM SUA CAMPANHA\nTrês erros comuns\nSALVE");
  });

  it("cores da referência viram as da marca na mesma função: neutra pela claridade, colorida pelo destaque", () => {
    expect(corDaMarcaNoPapel("#0A0A0A", MARCA.paleta)).toBe("#111111");
    expect(corDaMarcaNoPapel("#FAFAFA", MARCA.paleta)).toBe("#F7F7F7");
    expect(corDaMarcaNoPapel("#1E4FD8", MARCA.paleta)).toBe("#00D52B");
    expect(corDaMarcaNoPapel(null, MARCA.paleta)).toBeNull();
  });

  it("servidor: molde lido uma vez, guardado no bucket mesa (sem coluna nova), junto com a logo e em paralelo", () => {
    const m = corpoDe("moldeDaReferencia");
    expect(m).toContain("const guardado = await leituraGuardada(caminho);");
    expect(m).toContain("if (guardado && guardado.versao === VERSAO_DO_MOLDE) return normalizarMolde(guardado.molde);");
    expect(m).toContain("esquemaJson: ESQUEMA_MOLDE,");
    expect(m).toContain('modeloDoPapel("leitura")');
    expect(estudio).toContain("const pastaDasLeituras = (clientId: string) => `${clientId}/estudio/leituras`;");
    const g = corpoDe("gerarCard");
    expect(g).toContain("const [anexoLogo, moldes] = await Promise.all([");
    // Leitura que falha não trava a lâmina (volta null e o prompt usa a cópia geral).
    expect(m).toContain("return null;");
  });
});

describe("3. modos: técnicas de volta, imagem primeiro, proibições que não esvaziam a cena", () => {
  const card = {
    ordem: 1,
    funcao: "capa",
    texto_exato: "Seu orçamento parece\numa lista de tarefas?",
    blocos: [{ papel: "headline" as const, texto: "Seu orçamento parece\numa lista de tarefas?" }],
    layout: { zona_texto: "topo-esquerda" as const, alinhamento: "esquerda" as const, cor_fundo: "#F7F7F7", imagem: "proposta impressa na mesa", ponto_focal: "headline", fundo: "mesa clara", tratamento: "editorial" },
    ilustracao: "proposta impressa na mesa",
  };

  it("padrão com as técnicas de 23 e 24/09 (sem a linha que proibia o nome da marca)", () => {
    for (const t of ["rei da lâmina", "planos (fundo, texto, sujeito)", "recorte intencional", "cores da foto puxadas para a paleta", "mesmo eixo e na mesma margem", "sombra de contato"]) expect(PADRAO_DA_LAMINA).toContain(t);
    expect(PADRAO_DA_LAMINA).not.toContain("Nunca escreva o nome da marca");
  });

  it("capa com o elemento visual forte e inesperado de volta; logo clara em lâmina clara ganha área escura", () => {
    const p = promptDaLamina(card, MARCA, { total: 4, carrosselInfinito: false, levaLogo: true, logo: LOGO_ACELERIQ, logoDescricao: 'As letras da logo formam exatamente "Aceleriq".' });
    expect(p.indexOf("1. IMAGEM E COMPOSIÇÃO")).toBeLessThan(p.indexOf("2. TEXTO EXATO"));
    expect(p).toContain("um elemento visual forte e inesperado (escala grande, recorte ousado, objeto cortado pela borda, rosto ou olhar para a câmera, gesto em ação)");
    expect(p).toContain('- O que a logo é: As letras da logo formam exatamente "Aceleriq".');
    expect(p).toContain("O fundo desta lâmina é claro e a logo é clara");
    expect(p).toContain("alinhamento à esquerda");
    expect(p).not.toContain("alinhamento à centro");
  });
});

describe("4. transparência e custo à vista", () => {
  it("todos os modos gravam o prompt enviado (até 20 mil caracteres) e as legendas dos anexos", () => {
    const g = corpoDe("gerarCard");
    expect(g.match(/\.\.\.transparencia\(prompt, legendas,/g) ?? []).toHaveLength(5);
    const t = corpoDe("transparencia");
    expect(t).toContain("prompt_enviado:");
    expect(t).toContain("anexos_legendas: legendas.map((l) => texto(l, 600)),");
    expect(estudio).toContain("const MAX_PROMPT_GRAVADO = 20_000;");
  });

  it("a lâmina com referência escolhida entra no preço em qualidade alta (fora do contínuo)", () => {
    expect(qualidadeNaGeracao({ referencias_ids: ["r1"] }, [], false, "media")).toBe("alta");
    expect(qualidadeNaGeracao({}, ["g:1"], false, "baixa")).toBe("alta");
    expect(qualidadeNaGeracao({ referencias_ids: ["r1"] }, [], true, "media")).toBe("media");
    expect(qualidadeNaGeracao({}, [], false, "media")).toBe("media");
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain("partes={() => partesGerarDas(ordensDaFila).concat(partesDoFundo(ordensDaFila))}");
  });
});
