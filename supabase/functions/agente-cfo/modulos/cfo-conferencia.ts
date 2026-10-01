/**
 * Conferência da explicação da IA (frente CFO): todo valor em reais que a IA
 * escreveu precisa existir na conta do motor (a resposta-base ou os fatos).
 * Comparação exata de número, em código: não é julgamento, então não vai ao
 * Jev. Valor fora da conta faz valer a resposta do motor (sem laço de
 * correção: não se pede para a IA refazer).
 * Puro: sem Deno, sem npm.
 */

/** Valores em reais escritos no formato brasileiro (R$ 1.234,56 ou 1.234,56). */
export function valoresEmReais(texto: string): number[] {
  const re = /R\$\s*-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|-?\d+,\d{2}/g;
  const saida: number[] = [];
  const t = String(texto || "");
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const limpo = m[0].replace(/R\$\s*/, "").replace(/\./g, "").replace(",", ".");
    const n = Number(limpo);
    if (isFinite(n)) saida.push(Math.abs(n));
  }
  return saida;
}

function numerosDoJson(v: unknown, saida: number[]) {
  if (typeof v === "number" && isFinite(v)) saida.push(Math.abs(Math.round(v * 100) / 100));
  else if (Array.isArray(v)) for (const x of v) numerosDoJson(x, saida);
  else if (v && typeof v === "object") for (const k of Object.keys(v as Record<string, unknown>)) numerosDoJson((v as Record<string, unknown>)[k], saida);
  else if (typeof v === "string") for (const n of valoresEmReais(v)) saida.push(n);
}

/** Os valores em reais da IA que não estão na conta (vazio = tudo bate). */
export function numerosForaDaConta(textoDaIa: string, base: string, fatos: unknown): string[] {
  const permitidos: number[] = valoresEmReais(base);
  numerosDoJson(fatos, permitidos);
  const fora: string[] = [];
  for (const v of valoresEmReais(textoDaIa)) {
    if (v === 0) continue;
    const ok = permitidos.some((p) => Math.abs(p - v) < 0.011);
    if (!ok) fora.push(v.toFixed(2));
  }
  return fora;
}
