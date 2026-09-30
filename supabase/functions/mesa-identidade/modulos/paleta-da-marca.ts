/**
 * Gerador de paleta da marca (frente IDV2, 30/09/2026): harmonia a partir de
 * uma cor base, cores de apoio (escala clara e escura), neutras tingidas pela
 * cor da marca e a checagem de contraste WCAG de todos os pares.
 *
 * É regra fixa e conta (roda na tela, sem IA e sem custo). A proposta de
 * paletas com IA (o diretor de marca) usa estas mesmas funções para conferir
 * o contraste e completar as neutras.
 *
 * Puro: sem Deno, sem banco. Sem lookbehind, sem \p{} (Safari 11).
 */

import { contraste, luminanciaRelativa, nivelDoContraste, normalizarHex, type PapelDaCor } from "../../_shared/cores-da-marca.ts";
// HSL e a escala de tons moram em _shared/escala-da-cor.ts (o apoio da paleta da base também usa); a API daqui continua a mesma.
import { escalaDaCor, hexParaHsl, hslParaHex, type Hsl } from "../../_shared/escala-da-cor.ts";

export { escalaDaCor, hexParaHsl, hslParaHex };
export type { Hsl };

export type CorDaPaleta = { nome: string; papel: PapelDaCor; hex: string };

// ------------------------------------------------------------------ nome da cor

const FAIXAS_DE_MATIZ: Array<[number, string]> = [
  [15, "Vermelho"],
  [40, "Laranja"],
  [60, "Âmbar"],
  [75, "Amarelo"],
  [150, "Verde"],
  [185, "Verde-água"],
  [200, "Ciano"],
  [250, "Azul"],
  [280, "Índigo"],
  [320, "Violeta"],
  [345, "Magenta"],
  [360, "Vermelho"],
];

/** Nome de trabalho da cor ("Azul profundo", "Verde claro", "Cinza quente"): a equipe troca pelo nome da marca. */
export function nomeDaCor(hex: string): string {
  const n = normalizarHex(hex);
  if (!n) return "";
  const { h, s, l } = hexParaHsl(n);
  if (l >= 96) return "Branco";
  if (l <= 8) return "Preto";
  if (s < 12) return l > 80 ? "Cinza claro" : l < 25 ? "Grafite" : h < 70 || h > 300 ? "Cinza quente" : "Cinza frio";
  const base = (FAIXAS_DE_MATIZ.filter((f) => h < f[0])[0] || FAIXAS_DE_MATIZ[0])[1];
  if (l < 28) return `${base} profundo`;
  if (l > 78) return `${base} claro`;
  if (s < 35) return `${base} suave`;
  return base;
}

// ------------------------------------------------------------------ harmonias

export const HARMONIAS = [
  { valor: "complementar", rotulo: "Complementar", explica: "A cor oposta no círculo: contraste forte, bom para destaque." },
  { valor: "analoga", rotulo: "Análoga", explica: "Vizinhas no círculo: calma e coesa." },
  { valor: "triadica", rotulo: "Triádica", explica: "Três cores a 120 graus: viva e equilibrada." },
  { valor: "complementar_dividida", rotulo: "Complementar dividida", explica: "As vizinhas da oposta: contraste sem brigar." },
  { valor: "tetradica", rotulo: "Tetrádica", explica: "Dois pares complementares: rica, pede uma cor dominante." },
  { valor: "monocromatica", rotulo: "Monocromática", explica: "Tons da mesma cor: sóbria e elegante." },
] as const;

export type Harmonia = (typeof HARMONIAS)[number]["valor"];

export function ehHarmonia(v: unknown): v is Harmonia {
  return typeof v === "string" && HARMONIAS.some((h) => h.valor === v);
}

const girar = (c: Hsl, graus: number, mudanca: Partial<Hsl> = {}): string => hslParaHex({ h: c.h + graus, s: mudanca.s ?? c.s, l: mudanca.l ?? c.l });

/** As cores da harmonia (sem as neutras): a base é sempre a primária. */
export function coresDaHarmonia(baseHex: string, harmonia: Harmonia): CorDaPaleta[] {
  const hex = normalizarHex(baseHex);
  if (!hex) return [];
  const c = hexParaHsl(hex);
  // Satura um pouco a cor de destaque quando a base é apagada (destaque precisa aparecer).
  const sDestaque = Math.max(c.s, 55);
  const lMeio = Math.max(35, Math.min(60, c.l));
  let outras: Array<{ papel: PapelDaCor; hex: string }> = [];
  switch (harmonia) {
    case "complementar":
      outras = [
        { papel: "secundaria", hex: girar(c, 0, { l: c.l > 50 ? c.l - 28 : c.l + 28, s: Math.max(20, c.s - 15) }) },
        { papel: "destaque", hex: girar(c, 180, { s: sDestaque, l: lMeio }) },
      ];
      break;
    case "analoga":
      outras = [
        { papel: "secundaria", hex: girar(c, -30) },
        { papel: "secundaria", hex: girar(c, 30) },
        { papel: "destaque", hex: girar(c, 60, { s: sDestaque, l: lMeio }) },
      ];
      break;
    case "triadica":
      outras = [
        { papel: "secundaria", hex: girar(c, 120) },
        { papel: "destaque", hex: girar(c, 240, { s: sDestaque, l: lMeio }) },
      ];
      break;
    case "complementar_dividida":
      outras = [
        { papel: "secundaria", hex: girar(c, 150) },
        { papel: "destaque", hex: girar(c, 210, { s: sDestaque, l: lMeio }) },
      ];
      break;
    case "tetradica":
      outras = [
        { papel: "secundaria", hex: girar(c, 90) },
        { papel: "secundaria", hex: girar(c, 180) },
        { papel: "destaque", hex: girar(c, 270, { s: sDestaque, l: lMeio }) },
      ];
      break;
    case "monocromatica":
      outras = [
        { papel: "secundaria", hex: girar(c, 0, { l: Math.max(12, c.l - 25) }) },
        { papel: "secundaria", hex: girar(c, 0, { l: Math.min(90, c.l + 25), s: Math.max(15, c.s - 20) }) },
        { papel: "destaque", hex: girar(c, 0, { s: Math.min(100, c.s + 20), l: lMeio }) },
      ];
      break;
  }
  const lista: CorDaPaleta[] = [{ nome: nomeDaCor(hex), papel: "primaria", hex }];
  for (const o of outras) {
    if (lista.some((x) => x.hex === o.hex)) continue;
    lista.push({ nome: nomeDaCor(o.hex), papel: o.papel, hex: o.hex });
  }
  return lista;
}

/**
 * Neutras tingidas pela cor da marca: uma escura (para texto), uma média e
 * uma clara (para fundo). Tingir 6 a 10 por cento de saturação deixa o cinza
 * "da marca" sem virar cor.
 */
export function neutrasDaMarca(baseHex: string): CorDaPaleta[] {
  const hex = normalizarHex(baseHex);
  if (!hex) return [];
  const c = hexParaHsl(hex);
  const tons = [
    { l: 11, s: 14, nome: "Tinta" },
    { l: 46, s: 8, nome: "Cinza da marca" },
    { l: 96, s: 12, nome: "Papel" },
  ];
  return tons.map((t) => ({ nome: t.nome, papel: "neutra" as PapelDaCor, hex: hslParaHex({ h: c.h, s: c.s < 5 ? 0 : t.s, l: t.l }) }));
}

/** Paleta completa: harmonia + neutras, sem repetir cor. */
export function paletaHarmonica(baseHex: string, harmonia: Harmonia, comNeutras = true): CorDaPaleta[] {
  const lista = coresDaHarmonia(baseHex, harmonia);
  if (!comNeutras) return lista;
  for (const n of neutrasDaMarca(baseHex)) if (!lista.some((x) => x.hex === n.hex)) lista.push(n);
  return lista.slice(0, 8);
}

// ------------------------------------------------------------------ contraste (WCAG)

export type ParDeContraste = { frente: string; fundo: string; razao: number; nivel: "AAA" | "AA" | "AA grande" | "baixo" };

/** Todos os pares (frente sobre fundo) da paleta, com o branco e o preto, do melhor para o pior. */
export function matrizDeContraste(hexes: string[]): ParDeContraste[] {
  const cores = hexes.map((h) => normalizarHex(h)).filter((h): h is string => !!h);
  const todas = cores.slice();
  if (todas.indexOf("#FFFFFF") < 0) todas.push("#FFFFFF");
  if (todas.indexOf("#000000") < 0 && todas.indexOf("#111111") < 0) todas.push("#111111");
  const pares: ParDeContraste[] = [];
  for (let i = 0; i < todas.length; i++) {
    for (let j = 0; j < todas.length; j++) {
      if (i === j) continue;
      // Par só de branco e preto não diz nada da marca.
      if (cores.indexOf(todas[i]) < 0 && cores.indexOf(todas[j]) < 0) continue;
      const razao = contraste(todas[i], todas[j]);
      pares.push({ frente: todas[i], fundo: todas[j], razao, nivel: nivelDoContraste(razao) });
    }
  }
  return pares.sort((a, b) => b.razao - a.razao);
}

/** Pares que servem para texto corrido (AA ou mais), sem repetir o par invertido. */
export function paresParaTexto(hexes: string[]): ParDeContraste[] {
  const vistos: string[] = [];
  return matrizDeContraste(hexes).filter((p) => {
    if (p.razao < 4.5) return false;
    const chave = [p.frente, p.fundo].sort().join("|");
    if (vistos.indexOf(chave) >= 0) return false;
    vistos.push(chave);
    return true;
  });
}

/**
 * Avisos de acessibilidade da paleta (aviso, nunca trava): primária sem texto
 * legível por cima, destaque que some no fundo claro, paleta sem cor escura
 * para texto.
 */
export function avisosDeContraste(cores: Array<{ nome?: string; papel: PapelDaCor; hex: string }>): string[] {
  const avisos: string[] = [];
  const validas = cores.map((c) => ({ ...c, hex: normalizarHex(c.hex) || "" })).filter((c) => c.hex);
  if (!validas.length) return avisos;
  for (const c of validas.filter((x) => x.papel === "primaria")) {
    const melhor = Math.max(contraste(c.hex, "#FFFFFF"), contraste(c.hex, "#111111"));
    if (melhor < 4.5) avisos.push(`${c.nome || c.hex}: nem texto branco nem preto passam de AA por cima (${melhor.toFixed(2)}:1). Use para áreas grandes e títulos, não para texto corrido.`);
  }
  for (const c of validas.filter((x) => x.papel === "destaque")) {
    if (contraste(c.hex, "#FFFFFF") < 3) avisos.push(`${c.nome || c.hex}: como destaque sobre fundo branco fica abaixo de 3:1; botão e ícone podem sumir.`);
  }
  if (!validas.some((c) => luminanciaRelativa(c.hex) < 0.05)) avisos.push("A paleta não tem cor escura para texto: acrescente uma neutra escura.");
  if (!validas.some((c) => luminanciaRelativa(c.hex) > 0.8)) avisos.push("A paleta não tem cor clara para fundo: acrescente uma neutra clara.");
  return avisos;
}

/**
 * Proposta de paleta (da IA ou do gerador) em forma segura: hex válido, sem
 * repetir, papéis conhecidos, primária garantida e as neutras que faltam
 * completadas pelo código.
 */
export function completarPaleta(bruta: Array<{ nome?: unknown; papel?: unknown; hex?: unknown }>): CorDaPaleta[] {
  const papeis: PapelDaCor[] = ["primaria", "secundaria", "destaque", "neutra"];
  const lista: CorDaPaleta[] = [];
  for (const b of bruta) {
    const hex = normalizarHex(b.hex);
    if (!hex || lista.some((x) => x.hex === hex)) continue;
    const papel = papeis.indexOf(b.papel as PapelDaCor) >= 0 ? (b.papel as PapelDaCor) : "secundaria";
    lista.push({ nome: String(b.nome == null ? "" : b.nome).replace(/\s+/g, " ").trim().slice(0, 40) || nomeDaCor(hex), papel, hex });
  }
  if (!lista.length) return [];
  if (!lista.some((c) => c.papel === "primaria")) lista[0] = { ...lista[0], papel: "primaria" };
  const base = lista.filter((c) => c.papel === "primaria")[0].hex;
  const temEscura = lista.some((c) => luminanciaRelativa(c.hex) < 0.05);
  const temClara = lista.some((c) => luminanciaRelativa(c.hex) > 0.8);
  const neutras = neutrasDaMarca(base);
  if (!temEscura) lista.push(neutras[0]);
  if (!temClara) lista.push(neutras[2]);
  return lista.slice(0, 8);
}
