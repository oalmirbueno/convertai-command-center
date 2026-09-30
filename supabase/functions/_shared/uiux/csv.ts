/**
 * Leitor de CSV da base UI UX Pro Max para o TESTE de igualdade (frente UXM,
 * 30/09/2026). É de propósito outra implementação, independente da do gerador
 * (scripts/uiux/importar-base.mjs lê caractere a caractere; aqui é por
 * expressão regular, registro a registro). Os dois precisam dar o mesmo
 * resultado com toEqual: se um deles errar aspas, vírgula ou quebra de linha
 * dentro do campo, o teste quebra.
 *
 * RFC 4180: campo entre aspas, aspas dobradas, vírgula e quebra de linha
 * dentro do campo, BOM no começo, CRLF ou LF. Sem lookbehind, sem grupo
 * nomeado, sem \p{} (a regra de compatibilidade vale para o repositório todo).
 */

/** Registros do CSV como listas de campos (linha vazia no fim é ignorada). */
export function lerCsv(texto: string): string[][] {
  const t = String(texto).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const registros: string[][] = [];
  const campo = /("((?:[^"]|"")*)"|([^",\n]*))(,|\n|$)/g;
  let atual: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = campo.exec(t)) !== null) {
    atual.push(m[2] !== undefined ? m[2].replace(/""/g, '"') : m[3]);
    if (m[4] === ",") continue;
    registros.push(atual);
    atual = [];
    if (m[4] !== "\n") break;
  }
  return registros.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Objetos pelo mapa de colunas (chave nossa -> nome da coluna no cabeçalho). */
export function objetosDoCsv<C extends Record<string, string>>(texto: string, colunas: C): Array<{ [K in keyof C]: string }> {
  const [cabecalho, ...linhas] = lerCsv(texto);
  const posicao: Record<string, number> = {};
  cabecalho.forEach((nome, i) => {
    posicao[nome] = i;
  });
  const chaves = Object.keys(colunas) as Array<keyof C>;
  for (const k of chaves) {
    if (posicao[colunas[k]] === undefined) throw new Error(`coluna ausente no CSV: ${colunas[k]}`);
  }
  return linhas.map((l) => {
    const o = {} as { [K in keyof C]: string };
    for (const k of chaves) o[k] = l[posicao[colunas[k]]];
    return o;
  });
}
