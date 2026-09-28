/**
 * Regras do padrão visual em código (docs/design/SISTEMA.md, seções 2, 4 e 8).
 * Funções puras sobre uma string de classes do Tailwind. O teste de catraca
 * (src/test/padrao-visual-catraca.test.ts) usa estas funções para contar o
 * painel inteiro, e qualquer teste de tela pode usar as mesmas.
 *
 * Não é importado pelo app: só por testes. Sem lookbehind e sem classes de
 * caractere Unicode (compatibilidade dos arquivos do sistema).
 */
import { ESCALA_DE_FONTE } from "./estilos";

/** Uma classe separada em variantes ("lg", "hover", "[&>*]") e a base ("max-h-[420px]"). */
export function partesDaClasse(classe: string): { variantes: string[]; base: string } {
  const variantes: string[] = [];
  let atual = "";
  let colchetes = 0;
  for (let i = 0; i < classe.length; i += 1) {
    const c = classe.charAt(i);
    if (c === "[") colchetes += 1;
    else if (c === "]") colchetes = Math.max(0, colchetes - 1);
    if (c === ":" && colchetes === 0) {
      variantes.push(atual);
      atual = "";
    } else atual += c;
  }
  return { variantes, base: atual.charAt(0) === "!" ? atual.slice(1) : atual };
}

/** As classes de uma string, já separadas. */
export function classesDe(texto: string): Array<{ variantes: string[]; base: string }> {
  return texto
    .split(/\s+/)
    .filter(Boolean)
    .map(partesDaClasse);
}

/** Bases sem variante nenhuma (valem em toda largura e sem hover). */
function basesSemVariante(texto: string): string[] {
  return classesDe(texto)
    .filter((c) => c.variantes.length === 0)
    .map((c) => c.base);
}

/**
 * Tamanhos de fonte fora da escala fechada (11, 12, 13, 14, 15, 20, 24 px):
 * `text-[12.5px]` e afins, e os nomes do Tailwind (`text-xs`, `text-sm`,
 * `text-lg`...), que o painel troca pelo `texto.*`.
 */
export function fontesForaDaEscala(texto: string): string[] {
  const fora: string[] = [];
  for (const c of classesDe(texto)) {
    const px = /^text-\[(\d+(?:\.\d+)?)px\]$/.exec(c.base);
    if (px) {
      if ((ESCALA_DE_FONTE as readonly number[]).indexOf(Number(px[1])) < 0) fora.push(c.base);
      continue;
    }
    if (/^text-(xs|sm|base|lg|xl|[2-9]xl)$/.test(c.base)) fora.push(c.base);
  }
  return fora;
}

/**
 * Caixa com rolagem própria em toda largura (`max-h-[..]` com
 * `overflow-y-auto` sem prefixo): no celular prende o dedo. Dentro da página
 * use `rolagem.*` de estilos.ts (só rola de 1024 px para cima) ou a
 * `RegiaoRolavel`. Janela, popover e gaveta ficam de fora (quem chama decide).
 */
export function rolagemPresaNoCelular(texto: string): boolean {
  const bases = basesSemVariante(texto);
  const teto = bases.some((b) => /^max-h-\[/.test(b));
  const rola = bases.some((b) => b === "overflow-y-auto" || b === "overflow-auto" || b === "overflow-y-scroll" || b === "overflow-scroll");
  return teto && rola;
}

/** Rola por conta própria em toda largura (sem prefixo). */
export function rolaSempre(texto: string): boolean {
  return basesSemVariante(texto).some((b) => b === "overflow-y-auto" || b === "overflow-auto" || b === "overflow-y-scroll" || b === "overflow-scroll");
}

/** Está preso na tela ou sobre outra coisa (barra fixa, chip sobre foto, camada). */
export function flutua(texto: string): boolean {
  return basesSemVariante(texto).some((b) => b === "absolute" || b === "fixed" || b === "sticky");
}

/**
 * Fundo translúcido em bloco (`bg-card/40`, `bg-background/60`): no escuro a
 * seção parece transparente. Cartão é sólido. Vale o que flutua (barra fixa,
 * chip sobre foto) e o estado de passar o mouse.
 */
export function translucidoEmBloco(texto: string): boolean {
  if (flutua(texto)) return false;
  return basesSemVariante(texto).some((b) => /^bg-(card|background)\/(\d+|\[[^\]]+\])$/.test(b));
}

/**
 * Cartão feito à mão (canto + borda + fundo de cartão escritos na tela). A
 * catraca conta para BAIXAR: seção não vira cartão; cartão só para o que é
 * uma coisa (mídia, item de grade, formulário que é o assunto, janela,
 * flutuante, lista que é uma coisa só), e aí com o `Painel` ou
 * `superficie.painel`. Tracejado de vazio e camada flutuante não contam.
 */
export function cartaoFeitoAMao(texto: string): boolean {
  if (flutua(texto)) return false;
  const bases = basesSemVariante(texto);
  if (bases.indexOf("border-dashed") >= 0) return false;
  const canto = bases.some((b) => /^rounded-(lg|xl|2xl|3xl)$/.test(b));
  const borda = bases.indexOf("border") >= 0;
  const fundo = bases.indexOf("bg-card") >= 0;
  return canto && borda && fundo;
}

/** Parece cartão (para achar cartão dentro de cartão). */
export function pareceCartao(texto: string): boolean {
  if (flutua(texto)) return false;
  const bases = basesSemVariante(texto);
  if (bases.indexOf("border-dashed") >= 0) return false;
  const canto = bases.some((b) => /^rounded-(lg|xl|2xl|3xl)$/.test(b));
  const borda = bases.indexOf("border") >= 0;
  const fundo = bases.indexOf("bg-card") >= 0;
  return canto && (borda || fundo);
}

/** Canto fora do token (o painel usa 12 px no máximo: `rounded-lg`). */
export function cantosForaDoToken(texto: string): string[] {
  return classesDe(texto)
    .map((c) => c.base)
    .filter((b) => /^rounded(-[trblse]{1,2})?-(2xl|3xl)$/.test(b));
}

/** Título que quebra em várias linhas (a regra é uma linha, com reticências). */
export function tituloQueQuebra(texto: string): boolean {
  return classesDe(texto).some((c) => c.base === "[overflow-wrap:anywhere]" || c.base === "break-words" || c.base === "break-all");
}

/** Sombra forte (o painel usa só `shadow-sm`; sombra maior é de popover e janela). */
export function sombrasFortes(texto: string): string[] {
  return classesDe(texto)
    .map((c) => c.base)
    .filter((b) => /^shadow-(md|lg|xl|2xl)$/.test(b));
}

/** Caixa alta (regra: sem caixa alta em subtítulo novo). */
export function caixaAlta(texto: string): boolean {
  return classesDe(texto).some((c) => c.base === "uppercase");
}

/**
 * Altura fixa pela janela (`h-[calc(100vh-260px)]`, `max-h-[calc(100vh-...)]`):
 * na tela cheia sobra faixa embaixo e, no modo normal, corta. Área de altura da
 * janela mede de onde começa: AreaDeTrabalho ou `useAlturaQueCabe`.
 */
export function alturasFixasDaJanela(texto: string): string[] {
  return classesDe(texto)
    .map((c) => c.base)
    .filter((b) => /^(max-)?h-\[calc\(100(vh|dvh|svh)/.test(b));
}
