import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  gerarPdfDeRoteiros,
  larguraDoTexto,
  nomeDoArquivoPdf,
  paginasDoPdf,
  paraWinAnsi,
  quebrarLinhas,
  textosDoPdf,
  type ItemDoPdf,
} from "../../supabase/functions/_shared/pdf-roteiro";
import { hashDoRoteiro, normalizarRoteiro } from "../../supabase/functions/_shared/roteiro-modelo";

/**
 * PDF da Mesa Roteiros no padrão do documento modelo do dono
 * (Roteiros_Thaina_Rosa_Aceleriq.pdf): gera bytes de PDF válido, com a capa,
 * uma página de fala por vídeo com os blocos, o técnico, a direção, a
 * publicação e a captação; acentos do português certos; rascunho marcado;
 * texto nunca cortado (bloco longo vai inteiro para a página seguinte).
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const roteiro = normalizarRoteiro({
  titulo: "Salário-maternidade",
  subtitulo: "Estou desempregada e agora?",
  tipo: "fala_camera",
  ganchos: [
    { texto: "Estou grávida e sem emprego. Tenho direito ao salário-maternidade?", mecanismo: "pergunta concreta" },
    { texto: "Perdeu o emprego grávida? Ainda pode haver proteção.", mecanismo: "contraste" },
    { texto: "A data em que você saiu do emprego muda tudo.", mecanismo: "resultado primeiro" },
  ],
  blocos: [
    { funcao: "Abertura", fala: "Estou grávida e sem emprego. Tenho direito ao salário-maternidade?", segundos: 6, visual: "Sentada, peito para cima", texto_na_tela: "Grávida e sem emprego?" },
    { funcao: "Resposta", fala: "Não necessariamente. Mesmo depois de sair do emprego, você pode continuar protegida pelo INSS.", segundos: 8, visual: "Aproximar" },
    { funcao: "Explicação", fala: "Isso se chama período de graça. É preciso conferir as contribuições e as datas.", segundos: 10, visual: "Gesto leve", broll: "Agenda sem dados pessoais" },
    { funcao: "Fechamento", fala: "Salve para consultar depois. 🤰", segundos: 5, visual: "Expressão acolhedora" },
  ],
  direcao: { enquadramento: "Peito para cima", ambiente: "Sentada à mesa", luz: "Janela a 45 graus", orientacoes: ["Olhar firme na lente."] },
  broll: ["Abrindo uma agenda sem dados pessoais"],
  cta: "Salve para consultar depois.",
  legenda: "Grávida e sem emprego? Você pode continuar protegida pelo INSS.",
  hashtags: ["inss"],
  pendencias: ["Conferir o prazo do período de graça."],
  fontes: ["Contexto do cliente"],
});

const item = (status: "rascunho" | "aprovado" | "gravado", r = roteiro): ItemDoPdf => ({ roteiro: r, versao: 3, hash: hashDoRoteiro(r), status });
const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

describe("PDF do roteiro", () => {
  it("gera bytes de PDF válido, com xref apontando para o lugar certo", () => {
    const bytes = gerarPdfDeRoteiros({ cliente: "Thainá Lima Rosa Advogada", itens: [item("aprovado")], data: "2026-09-26T12:00:00Z" });
    const bruto = latin1(bytes);
    expect(bruto.startsWith("%PDF-1.4")).toBe(true);
    expect(bruto.trimEnd().endsWith("%%EOF")).toBe(true);
    const inicio = Number(/startxref\n(\d+)\n%%EOF/.exec(bruto)![1]);
    expect(bruto.slice(inicio, inicio + 4)).toBe("xref");
    // Cada objeto do xref começa no deslocamento declarado.
    const linhas = bruto.slice(inicio).split("\n").slice(3);
    let n = 1;
    for (const l of linhas) {
      const m = /^(\d{10}) 00000 n $/.exec(l);
      if (!m) break;
      expect(bruto.slice(Number(m[1]), Number(m[1]) + `${n} 0 obj`.length)).toBe(`${n} 0 obj`);
      n++;
    }
    expect(n).toBeGreaterThan(10);
    // Fontes padrão com WinAnsi (acentos) e a logo com máscara.
    expect(bruto).toContain("/BaseFont /Helvetica /Encoding /WinAnsiEncoding");
    expect(bruto).toContain("/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding");
    expect(bruto).toContain("/SMask 6 0 R");
    // Objetos: 7 fixos e 2 por página (página e conteúdo).
    expect(paginasDoPdf(bytes)).toBe((n - 1 - 7) / 2);
    expect(paginasDoPdf(bytes)).toBeGreaterThanOrEqual(6);
  });

  it("tem as seções do documento modelo e os blocos de fala, na ordem", () => {
    const bytes = gerarPdfDeRoteiros({ cliente: "Thainá Lima Rosa Advogada", itens: [item("aprovado")] });
    const textos = textosDoPdf(bytes);
    const total = String(paginasDoPdf(bytes)).padStart(2, "0");
    const tudo = textos.join("\n");
    for (const t of [
      "Roteiro de gravação",
      "DINÂMICA DA GRAVAÇÃO",
      "CONTEÚDOS DESTA GRAVAÇÃO",
      "VÍDEO 01",
      "Salário-maternidade",
      "ABERTURA",
      "RESPOSTA",
      "EXPLICAÇÃO",
      "FECHAMENTO",
      "CENA",
      "EDIÇÃO",
      "ABERTURAS PARA TESTAR",
      "Tempo, imagem e texto na tela",
      "O que captar em cada cena",
      "COMO GRAVAR AS IMAGENS DE APOIO",
      "Legenda e chamada de cada vídeo",
      "Captação e acabamento",
      "ASSINATURA NOS VÍDEOS",
      "PENDÊNCIAS ANTES DE GRAVAR",
      "BASE EDITORIAL E FONTES",
      "REVISÕES EXPORTADAS",
    ]) expect(tudo, t).toContain(t);
    // Rodapé como no modelo: seção e "02 / 07".
    expect(textos).toContain(`02 / ${total}`);
    expect(textos).toContain("THAINÁ LIMA ROSA ADVOGADA  /  ROTEIRO 01");
    expect(textos.indexOf("ABERTURA")).toBeLessThan(textos.indexOf("FECHAMENTO"));
    // As falas saem inteiras (as palavras de cada bloco estão lá).
    for (const b of roteiro.blocos) for (const palavra of b.fala.replace("🤰", "").split(/\s+/).filter(Boolean)) expect(tudo).toContain(palavra);
    // Emoji some; o resto da frase fica.
    expect(tudo).not.toContain("🤰");
    expect(tudo).toContain(`revisão 3 (Aprovado)`);
    expect(tudo).toContain(hashDoRoteiro(roteiro));
  });

  it("rascunho sai marcado como RASCUNHO; aprovado, não", () => {
    const rascunho = textosDoPdf(gerarPdfDeRoteiros({ cliente: "Cliente", itens: [item("rascunho")] })).join("\n");
    expect(rascunho).toContain("RASCUNHO");
    const aprovado = textosDoPdf(gerarPdfDeRoteiros({ cliente: "Cliente", itens: [item("aprovado")] })).join("\n");
    expect(aprovado).not.toContain("RASCUNHO");
  });

  it("acentos do português viram os códigos certos do WinAnsi", () => {
    expect(paraWinAnsi("ção")).toEqual([0xe7, 0xe3, 0x6f]);
    expect(paraWinAnsi("Á É Í Ó Ú Â Ê Ô Ã Õ Ç à ü")).toEqual(
      [0xc1, 32, 0xc9, 32, 0xcd, 32, 0xd3, 32, 0xda, 32, 0xc2, 32, 0xca, 32, 0xd4, 32, 0xc3, 32, 0xd5, 32, 0xc7, 32, 0xe0, 32, 0xfc],
    );
    // Acento solto (NFD) é recomposto.
    expect(paraWinAnsi("ão")).toEqual([0xe3, 0x6f]);
    expect(paraWinAnsi("• “aspas” … –")).toEqual([0x95, 32, 0x93, 0x61, 0x73, 0x70, 0x61, 0x73, 0x94, 32, 0x85, 32, 0x96]);
    // No arquivo, o acento vai escapado em octal: o fluxo fica em ASCII.
    const bruto = latin1(gerarPdfDeRoteiros({ cliente: "Ação", itens: [item("aprovado")] }));
    expect(bruto).toContain("A\\347\\343o");
  });

  it("quebra de linha pela largura real da fonte, sem cortar palavra nem texto", () => {
    const frase = "Isso se chama período de graça. Precisamos conferir se essa proteção existe na data do parto.";
    const l = quebrarLinhas(frase, "F1", 11.2, 200);
    expect(l.length).toBeGreaterThan(1);
    expect(l.join(" ")).toBe(frase);
    for (const x of l) expect(larguraDoTexto(x, "F1", 11.2)).toBeLessThanOrEqual(200);
    expect(larguraDoTexto("W", "F2", 10)).toBeGreaterThan(larguraDoTexto("i", "F2", 10));
    // Palavra maior que a linha quebra por letra, sem perder nada.
    expect(quebrarLinhas("a".repeat(300), "F1", 12, 100).join("")).toBe("a".repeat(300));
  });

  it("vários vídeos e bloco enorme: continua na página seguinte com todo o texto", () => {
    const longa = Array.from({ length: 180 }, (_, i) => `palavra${i}`).join(" ");
    const grande = normalizarRoteiro({ ...roteiro, titulo: "Vídeo longo", blocos: [...roteiro.blocos, { funcao: "Detalhe", fala: longa, segundos: 60, visual: "x" }, { funcao: "Outro", fala: longa, segundos: 60, visual: "y" }] });
    const bytes = gerarPdfDeRoteiros({ cliente: "Cliente", itens: [item("aprovado"), item("rascunho", grande), item("gravado")] });
    const textos = textosDoPdf(bytes);
    const tudo = textos.join(" ");
    for (let i = 0; i < 180; i++) expect(tudo).toContain(`palavra${i}`);
    expect(tudo).toContain("VÍDEO 02  /  CONTINUAÇÃO");
    expect(paginasDoPdf(bytes)).toBeGreaterThan(8);
    expect(textos).toContain("03");
  });

  it("bloco maior que uma página continua em partes, com o mesmo número e sem perder texto", () => {
    const enorme = Array.from({ length: 520 }, (_, i) => `termo${i}`).join(" ").slice(0, 3990);
    const r = normalizarRoteiro({ ...roteiro, blocos: [{ funcao: "Explicação", fala: enorme, segundos: 120, visual: "x" }] });
    expect(r.blocos[0].fala).toBe(enorme);
    const textos = textosDoPdf(gerarPdfDeRoteiros({ cliente: "Cliente", itens: [item("aprovado", r)] }));
    expect(textos).toContain("EXPLICAÇÃO  (continuação)");
    const tudo = textos.join(" ");
    for (const palavra of enorme.split(" ").slice(0, -1)) expect(tudo).toContain(palavra);
  });

  it("nome do arquivo sem acento nem espaço, com a revisão", () => {
    expect(nomeDoArquivoPdf("Thainá Lima Rosa", [item("aprovado")])).toBe("roteiro-thaina-lima-rosa-salario-maternidade-r3.pdf");
    expect(nomeDoArquivoPdf("Loja", [item("aprovado"), item("aprovado")])).toBe("roteiros-loja-2-videos.pdf");
  });

  it("gerador puro e rápido: sem Deno, sem npm, sem travessão na interface", () => {
    const fonte = ler("supabase/functions/_shared/pdf-roteiro.ts");
    expect(fonte).not.toMatch(/from "npm:|Deno\./);
    expect(fonte).not.toMatch(/\(\?<[=!a-z]/i);
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) gerarPdfDeRoteiros({ cliente: "Cliente", itens: [item("aprovado"), item("rascunho")] });
    // Folga larga: na Edge Function o limite é 2 s de CPU por pedido.
    expect((Date.now() - t0) / 10).toBeLessThan(400);
    expect(() => gerarPdfDeRoteiros({ cliente: "Cliente", itens: [] })).toThrow();
  });
});
