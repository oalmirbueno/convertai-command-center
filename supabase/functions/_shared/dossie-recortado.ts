/**
 * Dossiê (ou texto que termina com ele) grande demais para o prompt.
 *
 * Antes cada função fazia `.slice(0, n)`: ficava só o começo e sumiam as
 * seções mais recentes, que o dossiê grava no FIM (leitura da semana,
 * "Confirmado pelo dono", avanços recentes). Decisão do dono (AB2, 26/09):
 * fica o resumo do início (cabeçalho curto) e a parte MAIS RECENTE do fim,
 * com um marcador no lugar do meio. Função única, usada por todos os agentes.
 */

export const MARCADOR_DO_MEIO = "[trecho do meio omitido]";

/** Cabeçalho que fica do começo: no máximo isto, ou um quarto do limite. */
export const CABECA_PADRAO = 1200;

const SEPARADOR = `\n\n${MARCADOR_DO_MEIO}\n\n`;

export type OpcoesDoRecorte = {
  /** Tamanho máximo do começo que fica (padrão 1.200, nunca mais que um quarto do limite). */
  cabeca?: number;
};

/**
 * Até `limite` caracteres: o começo curto + o fim inteiro que couber, com
 * "[trecho do meio omitido]" no meio. Texto que já cabe volta igual (sem as
 * pontas em branco). Os cortes caem em quebra de linha (ou espaço) quando dá.
 */
export function recortarDossie(texto: unknown, limite: number, opcoes: OpcoesDoRecorte = {}): string {
  const t = String(texto == null ? "" : texto).trim();
  const max = Math.max(0, Math.floor(Number(limite) || 0));
  if (t.length <= max) return t;
  // Limite pequeno demais para as duas pontas e o marcador: fica o fim (o mais recente).
  if (max < SEPARADOR.length + 60) return t.slice(t.length - max).trim();

  const tetoDaCabeca = Math.max(20, Math.min(opcoes.cabeca ?? CABECA_PADRAO, Math.floor(max / 4)));
  let cabeca = t.slice(0, tetoDaCabeca);
  // Corta a cabeça no fim de uma linha (ou palavra), sem perder mais da metade.
  const quebra = Math.max(cabeca.lastIndexOf("\n"), 0);
  if (quebra >= tetoDaCabeca / 2) cabeca = cabeca.slice(0, quebra);
  else {
    const espaco = cabeca.lastIndexOf(" ");
    if (espaco >= tetoDaCabeca / 2) cabeca = cabeca.slice(0, espaco);
  }
  cabeca = cabeca.trimEnd();

  const tamanhoDoFim = max - cabeca.length - SEPARADOR.length;
  let fim = t.slice(t.length - tamanhoDoFim);
  // Começa o fim numa linha inteira (ou palavra), se a quebra estiver perto do começo.
  const folga = Math.floor(tamanhoDoFim / 4);
  const linha = fim.indexOf("\n");
  if (linha >= 0 && linha <= folga) fim = fim.slice(linha + 1);
  else {
    const espaco = fim.indexOf(" ");
    if (espaco >= 0 && espaco <= Math.min(folga, 80)) fim = fim.slice(espaco + 1);
  }
  fim = fim.trimStart();

  return `${cabeca}${SEPARADOR}${fim}`;
}
