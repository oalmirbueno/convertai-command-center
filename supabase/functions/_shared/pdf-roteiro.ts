/**
 * PDF da Mesa Roteiros no padrão do documento modelo do dono
 * (Roteiros_Thaina_Rosa_Aceleriq.pdf, "é esse estilo de padrão de PDF de
 * documento"): A4, faixa verde na margem esquerda, logo no topo, rótulos
 * verdes em caixa alta, título grande, blocos de fala numerados (a abertura
 * em fundo escuro), cena e edição por vídeo, direção por vídeo, captação e
 * acabamento, fontes, rodapé com seção e página "02 / 08".
 *
 * Kit V2 (produtor-pdf.md e MESA-ROTEIROS.md, "PDF para gravar"): exportar
 * não reescreve nem aprova. Sai a fala limpa (página de cada vídeo) e o
 * técnico (tempo, imagem, texto na tela, apoio e captação), com revisão, hash
 * e estado; rascunho sai marcado como RASCUNHO e mantém as pendências. Bloco
 * que não cabe vai inteiro para a página seguinte; texto nunca é cortado.
 *
 * Gerador próprio, sem dependência: as primitivas (página A4, faixa verde,
 * logo, rodapé, fontes padrão em WinAnsi com as métricas oficiais, montagem
 * dos bytes) ficam em pdf-base.ts desde 29/09/2026 (Frente DOC), e este
 * arquivo sai igual byte a byte ao de antes (src/test/pdf-base.test.ts).
 * Roda igual no navegador (Baixar) e na Edge Function (Compartilhar), em
 * poucos milissegundos. Puro: sem Deno, sem npm. Compatível com Safari 11. Sem travessão.
 */

import {
  duracaoEstimada,
  faixaDeDuracao,
  faixaDeVarios,
  modoDoTipo,
  ROTULO_DO_STATUS,
  type Roteiro,
  type StatusDoRoteiro,
} from "./roteiro-modelo.ts";
import {
  ALTURA,
  alturaDe,
  CORES,
  caixaAlta,
  dataDoDocumento,
  DIR,
  dois,
  DocumentoPdf as Documento,
  ESQ,
  FIM_DO_CONTEUDO,
  type Fonte,
  MESES,
  MIOLO,
  montarPdf,
  Pagina,
  quebrarLinhas,
  rotuloEmCima,
  tituloDeSecao,
  TOPO_DO_CONTEUDO,
} from "./pdf-base.ts";

// Quem já importava daqui (tela, testes) continua importando.
export { CORES, type Fonte, larguraDoTexto, paginasDoPdf, paraWinAnsi, quebrarLinhas, textosDoPdf } from "./pdf-base.ts";

// ------------------------------------------------------------------ entrada

export type ItemDoPdf = {
  roteiro: Roteiro;
  versao: number;
  hash: string;
  status: StatusDoRoteiro;
  /** Item da agenda ligado (título e data), quando há. */
  agenda?: { titulo: string; data?: string | null; formato?: string | null } | null;
};

export type DocumentoDeRoteiros = {
  cliente: string;
  itens: ItemDoPdf[];
  /** Data do documento (ISO ou Date). Padrão: agora. */
  data?: string | Date;
  /** Linha extra da assinatura nos vídeos (ex.: registro profissional, @perfil). */
  assinatura?: string | null;
};


// ------------------------------------------------------------------ capa

function textoDaDinamica(itens: ItemDoPdf[]): { forte: string[]; leve: string[] } {
  const tipos = itens.map((i) => i.roteiro.tipo);
  if (tipos.length && tipos.every((t) => t === "cinema")) {
    return { forte: ["Uma cena por vez.", "Continuidade em tudo."], leve: ["Confira figurino, luz e objeto.", "Grave cada ação em mais de um take.", "Anote o que mudou entre as cenas."] };
  }
  if (tipos.length && tipos.every((t) => t === "tutorial")) {
    return { forte: ["Mostre o resultado.", "Um passo por vez."], leve: ["Deixe a ação visível na tela.", "Respire, grave e pause.", "Se errar, repita só aquele passo."] };
  }
  return { forte: ["Olhe para a lente.", "Fale uma parte por vez."], leve: ["Leia a próxima fala.", "Respire, grave e pause.", "Se errar, repita só aquela parte."] };
}

function capa(d: Documento, doc: DocumentoDeRoteiros, data: Date) {
  const p = new Pagina("PLANO DE PRODUÇÃO");
  d.paginas.push(p);
  p.retangulo(0, 0, 4, ALTURA, CORES.verde);
  p.logo(205.6, 35, 184);
  const mes = `${caixaAlta(MESES[data.getMonth()])} ${data.getFullYear()}`;
  rotuloEmCima(p, ESQ, 118, `Planejamento de conteúdo  /  ${mes}${d.rascunho ? "  /  RASCUNHO" : ""}`);
  const unico = doc.itens.length === 1;
  const titulo = unico ? "Roteiro de gravação" : "Plano de produção audiovisual";
  const linhasTitulo = quebrarLinhas(titulo, "F2", 32, 360);
  linhasTitulo.forEach((l, i) => p.texto(ESQ, 162 + i * 36, l, "F2", 32, CORES.tinta));
  let y = 162 + (linhasTitulo.length - 1) * 36 + 26;
  p.texto(ESQ, y, "Roteiros e direção de gravação", "F1", 11.2, CORES.cinza);
  y += 22;
  y = p.paragrafo(ESQ, y, doc.cliente, "F2", 16, CORES.tinta, MIOLO, 19);
  y += 4;
  p.texto(ESQ, y, `${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}`, "F1", 9.1, CORES.cinza);
  y += 22;
  p.linha(ESQ, y, MIOLO);
  y += 32;
  const roteiros = doc.itens.map((i) => i.roteiro);
  const formato = roteiros.length ? roteiros[0].formato : "9:16";
  const colunas: Array<[string, string]> = [
    [dois(doc.itens.length), doc.itens.length === 1 ? "VÍDEO" : "VÍDEOS"],
    [faixaDeVarios(roteiros), doc.itens.length === 1 ? "DURAÇÃO" : "CADA VÍDEO"],
    [formato, formato === "9:16" ? "NA VERTICAL" : "FORMATO"],
  ];
  colunas.forEach(([valor, rotulo], i) => {
    const x = ESQ + i * 167;
    p.texto(x, y, valor, "F2", 24, CORES.tinta);
    p.texto(x, y + 24, rotulo, "F2", 7.6, CORES.verdeEscuro);
  });
  y += 52;
  // Caixa escura: dinâmica da gravação.
  const dinamica = textoDaDinamica(doc.itens);
  p.arredondado(ESQ, y, MIOLO, 92, 7, CORES.tinta);
  p.texto(ESQ + 18, y + 22, "DINÂMICA DA GRAVAÇÃO", "F2", 7.6, CORES.verdeClaro);
  dinamica.forte.forEach((l, i) => p.texto(ESQ + 18, y + 50 + i * 21, l, "F2", 17, CORES.branco));
  dinamica.leve.forEach((l, i) => p.texto(ESQ + 300, y + 36 + i * 14, l, "F1", 10.3, CORES.branco));
  y += 92 + 34;
  rotuloEmCima(p, ESQ, y, "Conteúdos desta gravação");
  y += 28;
  const cabem = Math.max(1, Math.floor((740 - y) / 52));
  doc.itens.slice(0, cabem).forEach((it, i) => {
    p.texto(ESQ, y + 6, dois(i + 1), "F2", 17, CORES.verde);
    p.texto(ESQ + 42, y, it.roteiro.titulo.slice(0, 70), "F2", 12, CORES.tinta);
    const sub = it.roteiro.subtitulo || (it.agenda && it.agenda.titulo) || modoDoTipo(it.roteiro.tipo).rotulo;
    p.texto(ESQ + 42, y + 19, sub.slice(0, 90), "F1", 9.2, CORES.cinza);
    if (it.status !== "aprovado" && it.status !== "gravado") p.textoADireita(DIR, y, "RASCUNHO", "F2", 7, CORES.cinza);
    if (i < Math.min(cabem, doc.itens.length) - 1) p.linha(ESQ + 42, y + 34, MIOLO - 42);
    y += 52;
  });
  if (doc.itens.length > cabem) {
    p.texto(ESQ + 42, y, `E mais ${doc.itens.length - cabem} ${doc.itens.length - cabem === 1 ? "vídeo" : "vídeos"} nas páginas seguintes.`, "F1", 9.2, CORES.cinza);
    y += 20;
  }
  const n = doc.itens.length;
  const guia = n === 1
    ? "Página 2: roteiro de fala. Depois: roteiro técnico, direção, publicação e captação."
    : `Páginas 2 em diante: um roteiro de fala por vídeo. Depois: roteiro técnico, direção por vídeo, publicação, captação e fontes.`;
  p.paragrafo(ESQ, Math.max(y + 6, 752), guia, "F1", 9.1, CORES.cinza, MIOLO, 12);
}

// ------------------------------------------------------------------ roteiro de fala (uma página por vídeo)

function paginaDeFala(d: Documento, it: ItemDoPdf, i: number) {
  const r = it.roteiro;
  const secao = `ROTEIRO ${dois(i + 1)}`;
  const rascunho = it.status !== "aprovado" && it.status !== "gravado";
  const p0 = d.nova(secao, "PRODUÇÃO AUDIOVISUAL", rascunho);
  rotuloEmCima(p0, ESQ, d.y, `Vídeo ${dois(i + 1)}${rascunho ? "  /  rascunho" : ""}`);
  p0.textoADireita(DIR - 88, d.y, faixaDeDuracao(r), "F1", 8.5, CORES.cinza);
  d.y += 34;
  const linhasTitulo = quebrarLinhas(r.titulo, "F2", 25, MIOLO);
  linhasTitulo.forEach((l, k) => p0.texto(ESQ, d.y + k * 29, l, "F2", 25, CORES.tinta));
  d.y += (linhasTitulo.length - 1) * 29 + 20;
  if (r.subtitulo) d.y = p0.paragrafo(ESQ, d.y, r.subtitulo, "F1", 9.7, CORES.cinza, MIOLO, 12.5) + 6;
  if (r.logline) d.y = p0.paragrafo(ESQ, d.y, `Premissa: ${r.logline}`, "F1", 9.2, CORES.cinza, MIOLO, 12.5) + 4;
  d.y += 8;

  const largura = MIOLO - 62;
  r.blocos.forEach((b, k) => {
    const primeiro = k === 0;
    const ultimo = k === r.blocos.length - 1 && r.blocos.length > 1;
    const fonteFala: Fonte = primeiro ? "F2" : "F1";
    const fundo = primeiro ? CORES.tinta : ultimo ? CORES.cartaoVerde : CORES.cartao;
    const continuar = () => {
      rotuloEmCima(d.atual(), ESQ, d.y, `Vídeo ${dois(i + 1)}  /  continuação`);
      d.y += 20;
    };
    // O bloco vai inteiro para a página seguinte; só o que não cabe numa página
    // inteira continua em partes, com o mesmo número e a mesma função.
    let resto = quebrarLinhas(b.fala || "(sem fala neste bloco)", fonteFala, 11.2, largura);
    const cabemNumaPagina = Math.floor((FIM_DO_CONTEUDO - TOPO_DO_CONTEUDO - 20 - 47) / 14.6);
    let parte = 0;
    while (resto.length) {
      d.garantir(Math.min(resto.length, cabemNumaPagina) * 14.6 + 47, secao, continuar);
      const cabem = Math.max(1, Math.floor((FIM_DO_CONTEUDO - d.y - 47) / 14.6));
      const agora = resto.slice(0, cabem);
      resto = resto.slice(cabem);
      const altura = 30 + agora.length * 14.6 + 10;
      const p = d.atual();
      p.arredondado(ESQ, d.y, MIOLO, altura, 6, fundo);
      p.texto(ESQ + 12, d.y + 22, dois(b.ordem), "F2", 12, primeiro ? CORES.branco : CORES.verdeEscuro);
      p.texto(ESQ + 46, d.y + 16, caixaAlta(b.funcao) + (parte > 0 ? "  (continuação)" : ""), "F2", 7, primeiro ? CORES.verdeClaro : CORES.verdeEscuro);
      agora.forEach((l, n) => p.texto(ESQ + 46, d.y + 33 + n * 14.6, l, fonteFala, 11.2, primeiro ? CORES.branco : CORES.tinta));
      d.y += altura + 7;
      parte++;
    }
  });

  // Aberturas alternativas: as outras duas opções de gancho, para gravar e testar.
  const outras = r.ganchos.filter((_, k) => k !== r.gancho_escolhido);
  if (outras.length) {
    const textos = outras.map((g, k) => `${String.fromCharCode(66 + k)}) ${g.texto}${g.mecanismo ? ` (${g.mecanismo})` : ""}`);
    const altura = 18 + textos.reduce((s, t) => s + alturaDe(t, "F1", 9.2, MIOLO - 24, 12.4) + 4, 0);
    d.garantir(altura + 10, secao);
    const p = d.atual();
    rotuloEmCima(p, ESQ, d.y + 8, "Aberturas para testar");
    let y = d.y + 24;
    for (const t of textos) y = p.paragrafo(ESQ + 12, y, t, "F1", 9.2, CORES.cinza, MIOLO - 24, 12.4) + 4;
    d.y = y + 6;
  }

  // Cena e edição, em duas colunas (como no documento modelo).
  const dir = r.direcao;
  const cena = [dir.enquadramento, dir.ambiente, dir.luz].filter(Boolean).join(". ") || "A definir com a equipe.";
  const naTela = r.blocos.filter((b) => b.texto_na_tela).map((b) => b.texto_na_tela);
  const edicao = [naTela.length ? `Na tela: ${naTela.slice(0, 3).join(" / ")}` : "", r.cta ? `Chamada: ${r.cta}` : ""].filter(Boolean).join(". ") || "Cortes limpos e legendas em até duas linhas.";
  const meia = (MIOLO - 20) / 2;
  const altura = 30 + Math.max(alturaDe(cena, "F1", 9.1, meia, 12.2), alturaDe(edicao, "F1", 9.1, meia, 12.2));
  d.garantir(altura + 16, secao);
  const p = d.atual();
  p.linha(ESQ, d.y + 4, MIOLO);
  rotuloEmCima(p, ESQ, d.y + 22, "Cena", CORES.verdeEscuro);
  rotuloEmCima(p, ESQ + meia + 20, d.y + 22, "Edição", CORES.verdeEscuro);
  p.paragrafo(ESQ, d.y + 38, cena, "F1", 9.1, CORES.cinza, meia, 12.2);
  p.paragrafo(ESQ + meia + 20, d.y + 38, edicao, "F1", 9.1, CORES.cinza, meia, 12.2);
  d.y += altura + 16;
}

// ------------------------------------------------------------------ roteiro técnico

function paginasTecnicas(d: Documento, itens: ItemDoPdf[]) {
  const secao = "ROTEIRO TÉCNICO";
  d.nova(secao);
  tituloDeSecao(d, "Roteiro técnico", "Tempo, imagem e texto na tela", "Mesma revisão das falas. Cada bloco com o tempo estimado, o que a câmera mostra, o texto na tela e a imagem de apoio.");
  itens.forEach((it, i) => {
    const r = it.roteiro;
    d.garantir(60, secao);
    const p0 = d.atual();
    p0.texto(ESQ, d.y + 4, `${dois(i + 1)}  ${r.titulo}`.slice(0, 80), "F2", 12, CORES.tinta);
    d.y += 22;
    let inicio = 0;
    r.blocos.forEach((b) => {
      const fim = inicio + (Number(b.segundos) || 0);
      const linhas = [
        b.visual ? `Imagem: ${b.visual}` : "",
        b.texto_na_tela ? `Na tela: ${b.texto_na_tela}` : "",
        b.broll ? `Apoio: ${b.broll}` : "",
      ].filter(Boolean);
      if (!linhas.length) linhas.push("Pessoa para a câmera, sem apoio.");
      const largura = MIOLO - 118;
      const altura = 14 + linhas.reduce((s, l) => s + alturaDe(l, "F1", 9, largura, 12) + 2, 0) + 8;
      d.garantir(altura + 5, secao, () => {
        d.atual().texto(ESQ, d.y + 4, `${dois(i + 1)}  ${r.titulo}  (continuação)`.slice(0, 90), "F2", 10, CORES.tinta);
        d.y += 20;
      });
      const p = d.atual();
      p.arredondado(ESQ, d.y, MIOLO, altura, 5, CORES.cartao);
      p.texto(ESQ + 12, d.y + 17, `${inicio} a ${fim}s`, "F2", 9, CORES.verdeEscuro);
      p.texto(ESQ + 12, d.y + 30, caixaAlta(b.funcao).slice(0, 18), "F2", 6.8, CORES.cinza);
      let y = d.y + 17;
      for (const l of linhas) y = p.paragrafo(ESQ + 106, y, l, "F1", 9, CORES.tinta, largura, 12) + 2;
      d.y += altura + 5;
      inicio = fim;
    });
    d.y += 12;
  });
}

// ------------------------------------------------------------------ direção por vídeo

function paginaDeDirecao(d: Documento, itens: ItemDoPdf[]) {
  const secao = "PLANOS DE GRAVAÇÃO";
  d.nova(secao);
  tituloDeSecao(d, "Direção por vídeo", "O que captar em cada cena", "Grave todas as falas primeiro. Faça as imagens de apoio ao final.");
  itens.forEach((it, i) => {
    const r = it.roteiro;
    const dir = r.direcao;
    const largura = MIOLO - 78;
    const linhaVerde = [dir.ambiente, dir.enquadramento].filter(Boolean).join(" • ") || modoDoTipo(r.tipo).rotulo;
    const corpo = [dir.orientacoes.join(" "), dir.camera ? `Câmera: ${dir.camera}.` : "", dir.luz ? `Luz: ${dir.luz}.` : ""].filter(Boolean).join(" ") || modoDoTipo(r.tipo).cuidados;
    const extra = [dir.figurino ? `Figurino: ${dir.figurino}` : "", dir.objetos ? `Objetos: ${dir.objetos}` : ""].filter(Boolean).join(". ");
    const apoio = r.broll.length ? `Imagem de apoio: ${r.broll.join("; ")}` : "";
    const altura =
      24 + alturaDe(r.titulo, "F2", 12, largura, 15) + alturaDe(linhaVerde, "F2", 8, largura, 11) + 6 + alturaDe(corpo, "F1", 9.2, largura, 12.4) +
      (extra ? alturaDe(extra, "F1", 8.6, largura, 11.6) + 4 : 0) + (apoio ? alturaDe(apoio, "F1", 8, largura, 11) + 8 : 0) + 12;
    d.garantir(altura + 8, secao);
    const p = d.atual();
    p.arredondado(ESQ, d.y, MIOLO, altura, 6, CORES.cartao);
    p.texto(ESQ + 14, d.y + 32, dois(i + 1), "F2", 20, CORES.verde);
    let y = p.paragrafo(ESQ + 64, d.y + 22, r.titulo, "F2", 12, CORES.tinta, largura, 15);
    y = p.paragrafo(ESQ + 64, y + 2, linhaVerde, "F2", 8, CORES.verdeEscuro, largura, 11) + 6;
    y = p.paragrafo(ESQ + 64, y, corpo, "F1", 9.2, CORES.tinta, largura, 12.4);
    if (extra) y = p.paragrafo(ESQ + 64, y + 4, extra, "F1", 8.6, CORES.tinta, largura, 11.6);
    if (apoio) p.paragrafo(ESQ + 64, y + 10, apoio, "F1", 8, CORES.cinza, largura, 11);
    d.y += altura + 8;
  });
  const caixa = "Grave cada ação por 6 a 8 segundos, com a câmera estável. Faça uma tomada mais aberta e outra de detalhe. Na edição, use apenas 2 a 3 segundos com a voz por cima. Não é preciso falar durante essas imagens.";
  const altura = 34 + alturaDe(caixa, "F1", 9.2, MIOLO - 28, 12.6) + 12;
  d.garantir(altura + 4, secao);
  const p = d.atual();
  p.arredondado(ESQ, d.y, MIOLO, altura, 6, CORES.cartaoVerde);
  rotuloEmCima(p, ESQ + 14, d.y + 20, "Como gravar as imagens de apoio");
  p.paragrafo(ESQ + 14, d.y + 38, caixa, "F1", 9.2, CORES.tinta, MIOLO - 28, 12.6);
  d.y += altura + 8;
}

// ------------------------------------------------------------------ publicação (legenda e CTA)

function paginaDePublicacao(d: Documento, itens: ItemDoPdf[]) {
  const secao = "PUBLICAÇÃO";
  d.nova(secao);
  tituloDeSecao(d, "Publicação", "Legenda e chamada de cada vídeo", "Texto do post e chamada final. Confira com o cliente antes de publicar.");
  itens.forEach((it, i) => {
    const r = it.roteiro;
    const largura = MIOLO - 28;
    const cta = r.cta ? `Chamada: ${r.cta}` : "Chamada: a definir.";
    const legenda = r.legenda || "Legenda a escrever.";
    const tags = r.hashtags.join(" ");
    const altura = 26 + alturaDe(cta, "F2", 9.2, largura, 12.4) + 6 + alturaDe(legenda, "F1", 9.2, largura, 12.6) + (tags ? alturaDe(tags, "F1", 8.4, largura, 11.4) + 6 : 0) + 12;
    d.garantir(Math.min(altura, 300) + 8, secao);
    // Legenda muito longa: vai em partes, sem cortar texto.
    const p = d.atual();
    if (d.y + altura > FIM_DO_CONTEUDO) {
      p.texto(ESQ, d.y + 4, `${dois(i + 1)}  ${r.titulo}`.slice(0, 80), "F2", 12, CORES.tinta);
      d.y += 22;
      d.y = d.atual().paragrafo(ESQ, d.y, cta, "F2", 9.2, CORES.verdeEscuro, MIOLO, 12.4) + 6;
      for (const l of quebrarLinhas(legenda, "F1", 9.2, MIOLO)) {
        d.garantir(13, secao);
        d.atual().texto(ESQ, d.y, l, "F1", 9.2, CORES.tinta);
        d.y += 12.6;
      }
      if (tags) {
        d.garantir(24, secao);
        d.y = d.atual().paragrafo(ESQ, d.y + 4, tags, "F1", 8.4, CORES.cinza, MIOLO, 11.4);
      }
      d.y += 12;
      return;
    }
    p.arredondado(ESQ, d.y, MIOLO, altura, 6, CORES.cartao);
    p.texto(ESQ + 14, d.y + 20, `${dois(i + 1)}  ${r.titulo}`.slice(0, 80), "F2", 12, CORES.tinta);
    let y = p.paragrafo(ESQ + 14, d.y + 38, cta, "F2", 9.2, CORES.verdeEscuro, largura, 12.4) + 6;
    y = p.paragrafo(ESQ + 14, y, legenda, "F1", 9.2, CORES.tinta, largura, 12.6);
    if (tags) p.paragrafo(ESQ + 14, y + 6, tags, "F1", 8.4, CORES.cinza, largura, 11.4);
    d.y += altura + 8;
  });
}

// ------------------------------------------------------------------ captação, assinatura e fontes

function paginaFinal(d: Documento, doc: DocumentoDeRoteiros) {
  const secao = "CAPTAÇÃO E EDIÇÃO";
  d.nova(secao);
  tituloDeSecao(d, "Orientações de produção", "Captação e acabamento", "Preparação da gravação, identidade visual e finalização dos vídeos.");
  const n = doc.itens.length;
  const minutos = n * 12;
  const cartoes: Array<[string, string, string]> = [
    ["10 min", "PREPARAÇÃO", "Teste de luz e áudio"],
    [`${minutos} min`, n === 1 ? "UM VÍDEO" : `${n} VÍDEOS`, "Cerca de 12 min por vídeo"],
    [`${Math.max(6, n * 3)} min`, "IMAGENS DE APOIO", "Mesa, mãos e ambiente"],
  ];
  const w = (MIOLO - 24) / 3;
  const p = d.atual();
  cartoes.forEach(([valor, rotulo, apoio], i) => {
    const x = ESQ + i * (w + 12);
    p.arredondado(x, d.y, w, 72, 6, CORES.cartao);
    p.texto(x + 14, d.y + 28, valor, "F2", 18, CORES.tinta);
    p.texto(x + 14, d.y + 46, rotulo, "F2", 7.2, CORES.verdeEscuro);
    p.texto(x + 14, d.y + 61, apoio, "F1", 8, CORES.cinza);
  });
  d.y += 96;
  const ugc = doc.itens.some((i) => i.roteiro.tipo === "ugc");
  const passos: Array<[string, string]> = [
    ["Antes de apertar gravar", "Celular vertical e fixo na altura dos olhos. Microfone próximo. Grave um teste de 10 segundos e escute. Use 4K se estiver disponível e estável."],
    ["Durante as falas", "Deixe 2 segundos antes e depois de cada parte. Faça duas versões da abertura. Mantenha posição e tom entre os cortes. Olhar sempre na lente."],
    ["Na edição", ugc
      ? "Cortes curtos e naturais, sem efeito que esconda o produto. Legendas em até duas linhas. Nada de depoimento ou resultado que não aconteceu."
      : "Cortes limpos e aproximações discretas. Legendas em até duas linhas. Música abaixo da voz. Até duas imagens de apoio por vídeo, sem dados de clientes."],
  ];
  passos.forEach(([titulo, corpo], i) => {
    const altura = 20 + alturaDe(corpo, "F1", 9.2, MIOLO - 34, 12.6) + 12;
    d.garantir(altura, secao);
    const pp = d.atual();
    pp.texto(ESQ, d.y + 14, dois(i + 1), "F2", 13, CORES.verde);
    pp.texto(ESQ + 34, d.y + 12, titulo, "F2", 11, CORES.tinta);
    pp.paragrafo(ESQ + 34, d.y + 30, corpo, "F1", 9.2, CORES.cinza, MIOLO - 34, 12.6);
    d.y += altura;
  });
  d.y += 8;
  // Assinatura nos vídeos (caixa escura).
  const assinatura = [doc.cliente, doc.assinatura || ""].filter(Boolean);
  d.garantir(96, secao);
  const pa = d.atual();
  pa.arredondado(ESQ, d.y, MIOLO, 70, 7, CORES.tinta);
  pa.texto(ESQ + 16, d.y + 20, "ASSINATURA NOS VÍDEOS", "F2", 7.6, CORES.verdeClaro);
  pa.texto(ESQ + 16, d.y + 40, assinatura[0].slice(0, 80), "F2", 11, CORES.branco);
  if (assinatura[1]) pa.texto(ESQ + 16, d.y + 58, assinatura[1].slice(0, 110), "F1", 8.8, CORES.branco);
  d.y += 92;
  const aviso = "Use a identidade do cliente nos vídeos. Preserve as ressalvas das falas e confira o texto com o cliente antes da gravação. Sem promessas de resultado, depoimento inventado ou exposição de casos reais.";
  d.y = d.atual().paragrafo(ESQ, d.y, aviso, "F1", 8.8, CORES.cinza, MIOLO, 12) + 14;

  // Pendências (rascunho mantém) e fontes.
  const pendencias: string[] = [];
  doc.itens.forEach((it, i) => it.roteiro.pendencias.forEach((x) => pendencias.push(`Vídeo ${dois(i + 1)}: ${x}`)));
  if (pendencias.length) {
    d.garantir(40, secao);
    rotuloEmCima(d.atual(), ESQ, d.y, "Pendências antes de gravar");
    d.y += 16;
    for (const x of pendencias) {
      const h = alturaDe(x, "F1", 8.8, MIOLO - 12, 11.8);
      d.garantir(h + 3, secao);
      d.y = d.atual().paragrafo(ESQ + 12, d.y, x, "F1", 8.8, CORES.tinta, MIOLO - 12, 11.8) + 3;
    }
    d.y += 10;
  }
  const fontes: string[] = [];
  doc.itens.forEach((it) => it.roteiro.fontes.forEach((f) => {
    if (fontes.indexOf(f) < 0) fontes.push(f);
  }));
  d.garantir(40, secao);
  rotuloEmCima(d.atual(), ESQ, d.y, "Base editorial e fontes");
  d.y += 16;
  const base = fontes.length ? `Planejamento alinhado ao contexto e à linha editorial da marca. Fontes: ${fontes.join("; ")}.` : "Planejamento alinhado ao contexto e à linha editorial da marca.";
  d.garantir(alturaDe(base, "F1", 8.8, MIOLO, 11.8) + 4, secao);
  d.y = d.atual().paragrafo(ESQ, d.y, base, "F1", 8.8, CORES.cinza, MIOLO, 11.8) + 10;
  // Revisão e hash de cada vídeo: a exportação identifica exatamente o que foi exportado.
  const revisoes = doc.itens.map((it, i) => `Vídeo ${dois(i + 1)}: revisão ${it.versao} (${ROTULO_DO_STATUS[it.status] || it.status}), ${duracaoEstimada(it.roteiro).palavras} palavras, código ${it.hash}`);
  d.garantir(20 + revisoes.length * 11, secao);
  rotuloEmCima(d.atual(), ESQ, d.y, "Revisões exportadas");
  d.y += 14;
  for (const r of revisoes) {
    d.garantir(12, secao);
    d.atual().texto(ESQ, d.y, r, "F1", 8, CORES.verdeEscuro);
    d.y += 11;
  }
}


/**
 * Gera o PDF (bytes) dos roteiros, na ordem recebida. Não altera nenhum
 * texto: o que sai é a versão pedida de cada roteiro.
 */
export function gerarPdfDeRoteiros(doc: DocumentoDeRoteiros): Uint8Array {
  if (!doc.itens.length) throw new Error("Nenhum roteiro para exportar.");
  const data = dataDoDocumento(doc.data);
  const rascunho = doc.itens.some((i) => i.status !== "aprovado" && i.status !== "gravado");
  const d = new Documento(doc.cliente || "Cliente", rascunho, "PRODUÇÃO AUDIOVISUAL");
  capa(d, doc, data);
  doc.itens.forEach((it, i) => paginaDeFala(d, it, i));
  paginasTecnicas(d, doc.itens);
  paginaDeDirecao(d, doc.itens);
  paginaDePublicacao(d, doc.itens);
  paginaFinal(d, doc);
  d.rodapes();
  const titulo = doc.itens.length === 1 ? `Roteiro: ${doc.itens[0].roteiro.titulo}` : `Plano de produção audiovisual: ${doc.cliente}`;
  const assunto = doc.itens.map((it) => `r${it.versao}:${it.hash}`).join(" ");
  return montarPdf(d.paginas, { titulo, assunto, produtor: "Aceleriq OS, Mesa Roteiros" });
}

/** Nome do arquivo: roteiro-cliente-titulo-r3.pdf, sem acento nem espaço. */
export function nomeDoArquivoPdf(cliente: string, itens: ItemDoPdf[]): string {
  const limpar = (t: string) =>
    String(t || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  const base = itens.length === 1 ? `roteiro-${limpar(cliente)}-${limpar(itens[0].roteiro.titulo)}-r${itens[0].versao}` : `roteiros-${limpar(cliente)}-${itens.length}-videos`;
  return `${base.replace(/-+/g, "-")}.pdf`;
}
