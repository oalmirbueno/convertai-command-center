/**
 * Papéis de cor de UMA peça (19/11/2026): a regra 60-30-10 aplicada na lâmina.
 *
 * A partir das cores da marca do cliente, decide em código:
 *   · dominante (fundo e áreas grandes, ~60%);
 *   · apoio/neutro (cartões, faixas, painéis, ~30%);
 *   · destaque forte (~10%, só botão, selo e palavra-chave): croma OKLCH de
 *     pelo menos 0,08 e 3:1 contra o fundo (WCAG 1.4.11). Nunca cinza ou
 *     apagado: se nenhuma cor da marca passa, calcula um vivo no matiz oposto
 *     (ou vizinho do oposto) ao da cor primária;
 *   · texto que passa de 4,5:1 sobre o fundo.
 * Marca de uma ou duas cores: o trio fecha com neutro tingido do matiz da
 * marca e destaque calculado, nunca com uma cor genérica.
 *
 * Puro: roda na tela (Vite) e nas funções (Deno).
 */

import { ajustarAteContraste, contraste, cromaMaximo, distancia, hexParaOklch, hexValido, melhorTexto, nomeDaCor, oklchParaHex } from "./oklch.ts";

export type CorDaMarcaNaPeca = { nome?: string; hex?: string; papel?: string };
export type OrigemDaCor = "marca" | "layout" | "calculado";
export type CorNoPapel = { hex: string; nome: string; origem: OrigemDaCor };

export type PapeisDaPeca = {
  fundo: CorNoPapel;
  texto: CorNoPapel & { razao: number };
  apoio: CorNoPapel;
  destaque: CorNoPapel & { razao: number };
  /** Cores da marca que não entraram em nenhum papel (só detalhe). */
  outras: CorNoPapel[];
  avisos: string[];
};

export type OpcoesDosPapeis = {
  /** Claro ou escuro: fundo neutro (da marca, se houver, senão tingido). Marca: a cor primária. */
  fundoPreferido?: "claro" | "escuro" | "marca";
  /** Cor decidida antes (direção da lâmina): respeitada como está. */
  fundo?: string | null;
  /** Texto pedido: fica se passar de 4,5:1 sobre o fundo. */
  texto?: string | null;
  /** Destaque pedido: fica se for vivo e passar de 3:1 sobre o fundo. */
  destaque?: string | null;
};

/** Mesmos neutros da casa do direcao-arte.ts (textoLegivel), para o texto não mudar à toa. */
export const NEUTRO_CLARO = "#F5F3EE";
export const NEUTRO_ESCURO = "#111418";

export const CROMA_MINIMO_DO_DESTAQUE = 0.08;
export const CONTRASTE_DO_DESTAQUE = 3;
export const CONTRASTE_DO_TEXTO = 4.5;

type Cor = { hex: string; nome: string; papel: string };

const virgula = (n: number, casas = 1) => n.toFixed(casas).replace(".", ",");
const croma = (hex: string) => hexParaOklch(hex).c;
const neutra = (hex: string) => croma(hex) < 0.03;
const pura = (hex: string) => {
  const o = hexParaOklch(hex);
  return o.c < 0.005 && (o.l > 0.99 || o.l < 0.01);
};
const igual = (a: string, b: string) => distancia(a, b) < 0.04;
const temPapel = (c: Cor, ...nomes: string[]) => nomes.some((n) => c.papel.indexOf(n) >= 0);

function daMarca(c: Cor): CorNoPapel {
  return { hex: c.hex, nome: c.nome || nomeDaCor(c.hex), origem: "marca" };
}
function calculada(hex: string): CorNoPapel {
  return { hex, nome: nomeDaCor(hex), origem: "calculado" };
}

/** Neutro levemente tingido do matiz da marca (sem matiz: o neutro da casa). */
function neutroTingido(h: number | null, tom: "claro" | "escuro"): string {
  if (h === null) return tom === "claro" ? NEUTRO_CLARO : NEUTRO_ESCURO;
  return tom === "claro" ? oklchParaHex({ l: 0.965, c: 0.014, h }) : oklchParaHex({ l: 0.2, c: 0.025, h });
}

/** Ls tentados para o destaque, do mais perto do preferido para o mais longe. */
function lsEmVolta(preferido: number): number[] {
  const todos = [0.3, 0.36, 0.42, 0.48, 0.54, 0.6, 0.66, 0.72, 0.78, 0.84, 0.88, 0.92];
  return todos.sort((a, b) => Math.abs(a - preferido) - Math.abs(b - preferido));
}

/**
 * Destaque vivo calculado: matiz oposto (ou vizinho do oposto) ao da marca,
 * croma perto do máximo do sRGB e L andando até passar de 3:1 contra o fundo.
 */
export function destaqueCalculado(matizDaMarca: number | null, fundo: string, evitarPerto: string[] = []): string | null {
  const h0 = matizDaMarca ?? 60;
  const giros = matizDaMarca === null ? [0, 330, 30, 150, 210] : [180, 150, 210, 165, 195, 120, 240];
  const lFundo = hexParaOklch(fundo).l;
  const lPreferido = lFundo < 0.5 ? 0.84 : 0.55;
  for (const minimo of [0.12, CROMA_MINIMO_DO_DESTAQUE]) {
    for (const g of giros) {
      const h = (h0 + g + 360) % 360;
      for (const l of lsEmVolta(lPreferido)) {
        const c = cromaMaximo(l, h) * 0.96;
        if (c < minimo) continue;
        const hex = oklchParaHex({ l, c, h });
        if (croma(hex) < minimo) continue;
        if (contraste(hex, fundo) < CONTRASTE_DO_DESTAQUE) continue;
        if (distancia(hex, fundo) < 0.12 || evitarPerto.some((o) => distancia(hex, o) < 0.12)) continue;
        return hex;
      }
    }
  }
  return null;
}

/**
 * Fundo, texto, apoio e destaque da peça a partir da paleta da marca.
 * null quando não há nenhuma cor válida (nem na paleta, nem nas opções).
 */
export function papeisDaPeca(paleta: CorDaMarcaNaPeca[], opcoes: OpcoesDosPapeis = {}): PapeisDaPeca | null {
  const cores: Cor[] = [];
  for (const p of paleta || []) {
    const hex = hexValido(p?.hex);
    if (!hex || cores.some((c) => c.hex === hex)) continue;
    cores.push({ hex, nome: String(p.nome || "").trim(), papel: String(p.papel || "").toLowerCase() });
  }
  const fundoPedido = hexValido(opcoes.fundo);
  if (!cores.length && !fundoPedido) return null;
  const avisos: string[] = [];
  const achar = (...nomes: string[]) => {
    for (const n of nomes) {
      const c = cores.find((x) => temPapel(x, n));
      if (c) return c;
    }
    return null;
  };

  // Matiz da marca: o da primária (ou da cor de fundo da marca); sem uma colorida, o da cor mais viva.
  const primaria = achar("primaria", "primária", "principal");
  const fundoDaMarca = achar("fundo");
  const coloridasPorCroma = cores.filter((c) => !neutra(c.hex)).sort((a, b) => croma(b.hex) - croma(a.hex));
  const corDoMatiz = [primaria, fundoDaMarca].find((c) => c && !neutra(c.hex)) ?? coloridasPorCroma[0] ?? null;
  const h0 = corDoMatiz ? hexParaOklch(corDoMatiz.hex).h : null;

  // ---------------------------------------------------------------- fundo (60%)
  let fundo: CorNoPapel;
  if (fundoPedido) {
    const c = cores.find((x) => x.hex === fundoPedido);
    fundo = c ? daMarca(c) : { hex: fundoPedido, nome: nomeDaCor(fundoPedido), origem: "layout" };
  } else if (opcoes.fundoPreferido === "claro" || opcoes.fundoPreferido === "escuro") {
    const claro = opcoes.fundoPreferido === "claro";
    const serve = cores.filter((c) => (claro ? hexParaOklch(c.hex).l >= 0.9 : hexParaOklch(c.hex).l <= 0.3) && croma(c.hex) < 0.06 && !(cores.length <= 2 && pura(c.hex)));
    serve.sort((a, b) => (claro ? hexParaOklch(b.hex).l - hexParaOklch(a.hex).l : hexParaOklch(a.hex).l - hexParaOklch(b.hex).l));
    fundo = serve[0] ? daMarca(serve[0]) : calculada(neutroTingido(h0, claro ? "claro" : "escuro"));
  } else {
    const pelaRegra = opcoes.fundoPreferido === "marca"
      ? primaria ?? corDoMatiz ?? achar("fundo")
      : achar("fundo", "primaria", "primária", "principal");
    const neutraDaMarca = cores.find((c) => neutra(c.hex) && !(cores.length <= 2 && pura(c.hex)));
    const escolhida = pelaRegra ?? (cores.length >= 3 ? neutraDaMarca ?? null : null);
    if (escolhida && !(cores.length <= 2 && pura(escolhida.hex) && h0 !== null)) {
      fundo = daMarca(escolhida);
    } else {
      // Marca de uma ou duas cores (ou branco/preto puro): neutro tingido do matiz da marca.
      const escuro = escolhida ? hexParaOklch(escolhida.hex).l < 0.5 : false;
      fundo = calculada(neutroTingido(h0, escuro ? "escuro" : "claro"));
      avisos.push(`Fundo ${fundo.nome} ${fundo.hex} derivado do matiz da marca (neutro tingido), no lugar de ${escolhida ? `${escolhida.hex} puro` : "uma cor genérica"}.`);
    }
  }

  // ---------------------------------------------------------------- texto (4,5:1)
  const textoPedido = hexValido(opcoes.texto) ?? achar("texto")?.hex ?? null;
  let texto: CorNoPapel & { razao: number };
  if (textoPedido && contraste(textoPedido, fundo.hex) >= CONTRASTE_DO_TEXTO) {
    const c = cores.find((x) => x.hex === textoPedido);
    texto = { ...(c ? daMarca(c) : { hex: textoPedido, nome: nomeDaCor(textoPedido), origem: "layout" as const }), razao: contraste(textoPedido, fundo.hex) };
  } else {
    let t = melhorTexto(fundo.hex, [NEUTRO_CLARO, NEUTRO_ESCURO]);
    if (t.razao < CONTRASTE_DO_TEXTO) t = melhorTexto(fundo.hex, ["#FFFFFF", "#000000"]);
    if (textoPedido) avisos.push(`Texto ${textoPedido} tem só ${virgula(contraste(textoPedido, fundo.hex))}:1 sobre ${fundo.hex}: trocado por ${t.hex}.`);
    texto = { ...calculada(t.hex), razao: t.razao };
  }

  // ---------------------------------------------------------------- apoio (30%)
  // O apoio pode ter a cor do texto (texto vai sobre o fundo, não sobre o apoio); só não repete o fundo.
  const livre = (c: Cor) => !igual(c.hex, fundo.hex);
  const apoioDaMarca = [achar("secundaria", "secundária", "apoio"), achar("neutra", "neutro")]
    .concat(cores.filter((c) => !temPapel(c, "destaque", "acento", "texto")))
    .concat(cores.filter((c) => temPapel(c, "texto")))
    .filter((c): c is Cor => !!c && livre(c))[0] ?? null;
  let apoio: CorNoPapel;
  if (apoioDaMarca) {
    apoio = daMarca(apoioDaMarca);
  } else {
    const lFundo = hexParaOklch(fundo.hex).l;
    const hex = lFundo < 0.6 ? oklchParaHex({ l: 0.94, c: h0 === null ? 0 : 0.02, h: h0 ?? 0 }) : oklchParaHex({ l: 0.3, c: h0 === null ? 0 : Math.min(0.06, cromaMaximo(0.3, h0) * 0.6), h: h0 ?? 0 });
    apoio = calculada(hex);
  }

  // ---------------------------------------------------------------- destaque (10%)
  const usadas = [fundo.hex, texto.hex, apoio.hex];
  const passa = (hex: string) => croma(hex) >= CROMA_MINIMO_DO_DESTAQUE && contraste(hex, fundo.hex) >= CONTRASTE_DO_DESTAQUE;
  const motivo = (hex: string) => {
    const r: string[] = [];
    if (croma(hex) < CROMA_MINIMO_DO_DESTAQUE) r.push(`apagado (croma ${virgula(croma(hex), 3)})`);
    if (contraste(hex, fundo.hex) < CONTRASTE_DO_DESTAQUE) r.push(`só ${virgula(contraste(hex, fundo.hex))}:1 sobre o fundo`);
    return r.join(" e ");
  };
  let destaque: (CorNoPapel & { razao: number }) | null = null;
  const destaquePedido = hexValido(opcoes.destaque);
  if (destaquePedido) {
    if (passa(destaquePedido)) {
      const c = cores.find((x) => x.hex === destaquePedido);
      destaque = { ...(c ? daMarca(c) : { hex: destaquePedido, nome: nomeDaCor(destaquePedido), origem: "layout" as const }), razao: contraste(destaquePedido, fundo.hex) };
    } else avisos.push(`Destaque pedido ${destaquePedido} ${motivo(destaquePedido)}: não serve para botão.`);
  }
  if (!destaque) {
    const oficial = cores.filter((c) => temPapel(c, "destaque", "acento"));
    for (const c of oficial) if (!passa(c.hex)) avisos.push(`Destaque da marca ${c.nome || nomeDaCor(c.hex)} ${c.hex} ${motivo(c.hex)}: não salta do fundo ${fundo.hex}.`);
    const resto = cores.filter((c) => !oficial.includes(c)).sort((a, b) => croma(b.hex) - croma(a.hex));
    const achada = oficial.concat(resto).find((c) => passa(c.hex) && !usadas.some((u) => igual(u, c.hex)));
    if (achada) destaque = { ...daMarca(achada), razao: contraste(achada.hex, fundo.hex) };
  }
  if (!destaque) {
    // Antes de ir ao matiz oposto: o próprio destaque da marca, mesmo matiz, com o L andando até 3:1 (se continuar vivo).
    for (const c of cores.filter((x) => temPapel(x, "destaque", "acento"))) {
      const ajustado = ajustarAteContraste(c.hex, fundo.hex, CONTRASTE_DO_DESTAQUE);
      if (!ajustado || !passa(ajustado) || usadas.some((u) => distancia(u, ajustado) < 0.12)) continue;
      destaque = { hex: ajustado, nome: `${c.nome || nomeDaCor(c.hex)} ajustado`, origem: "calculado", razao: contraste(ajustado, fundo.hex) };
      avisos.push(`Destaque de apoio calculado: ${ajustado}, o tom de ${c.hex} clareado ou escurecido até ${virgula(destaque.razao)}:1 sobre o fundo; não é cor oficial da marca.`);
      break;
    }
  }
  if (!destaque) {
    const hex = destaqueCalculado(h0, fundo.hex, usadas) ?? melhorTexto(fundo.hex, ["#FFFFFF", "#000000"]).hex;
    destaque = { ...calculada(hex), razao: contraste(hex, fundo.hex) };
    avisos.push(`Destaque de apoio calculado: ${destaque.nome} ${hex} (${virgula(destaque.razao)}:1 sobre o fundo, croma ${virgula(croma(hex), 3)}); não é cor oficial da marca.`);
  }

  const emPapel = [fundo.hex, texto.hex, apoio.hex, destaque.hex];
  const outras = cores.filter((c) => !emPapel.includes(c.hex)).map(daMarca);
  return {
    fundo,
    texto: { ...texto, razao: Math.round(texto.razao * 100) / 100 },
    apoio,
    destaque: { ...destaque, razao: Math.round(destaque.razao * 100) / 100 },
    outras,
    avisos,
  };
}

/**
 * Linha da paleta para o prompt de imagem: a proporção e o papel de cada cor,
 * dito com todas as letras. O destaque calculado vem marcado como tal, para o
 * gerador (e quem lê o prompt) não achar que é cor oficial.
 */
export function linhaDosPapeis(p: PapeisDaPeca, onde: { foto?: boolean } = {}): string {
  const rot = (c: CorNoPapel) => `${c.nome} ${c.hex}`;
  const destaque = p.destaque.origem === "calculado"
    ? `destaque de apoio calculado ${rot(p.destaque)} (não é cor oficial da marca)`
    : `destaque ${rot(p.destaque)}`;
  const outras = p.outras.length ? `; outras cores da marca só em detalhe pequeno: ${p.outras.map(rot).join(", ")}` : "";
  return `dominante ${rot(p.fundo)} em ~60% (${onde.foto ? "painéis e áreas gráficas grandes" : "fundo e áreas grandes"}); ` +
    `apoio ${rot(p.apoio)} em ~30% (cartões, faixas e painéis); ` +
    `${destaque} em ~10%, só no botão, no selo e na palavra-chave; ` +
    `texto ${p.texto.hex} sobre o fundo (razão ${virgula(p.texto.razao)}:1)${outras}`;
}
