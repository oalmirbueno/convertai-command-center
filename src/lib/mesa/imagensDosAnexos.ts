/**
 * Caminhos de imagem anexada numa mensagem de agente (log de produção, 17/10).
 *
 * Os anexos de uma mensagem misturam imagens ({ caminho: "<cliente>/..." }) com
 * outros cartões. O anexo "Método:" (metodo_usado, superpoderes.ts) também tem
 * um campo `caminho`, mas ali é o rótulo do caminho do método ("conversa",
 * "pequeno", "grande", "viabilidade"), não um arquivo. As conversas liam todo
 * `caminho` como imagem e o painel pedia a URL assinada de "mesa/grande" e
 * "mesa/conversa" a cada abertura (POST /object/sign 400, com nova tentativa).
 *
 * Regra: o anexo "Método:" nunca é imagem, e só vale caminho com pasta (todo
 * arquivo do bucket mesa mora em "<cliente>/..."), para nenhum outro rótulo
 * virar pedido ao Storage. Função pura (o vitest lê direto).
 */
export const TIPO_DO_ANEXO_DO_METODO = "metodo_usado";

/** Caminho de arquivo de verdade: texto com pasta e sem "..". Prefixo como workspace:// segue valendo (ImagemDaMesa resolve). */
export function pareceCaminhoDeArquivo(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  const c = valor.trim();
  return c.length > 2 && c.indexOf("/") > 0 && c.indexOf("..") < 0;
}

/**
 * Imagens anexadas, na ordem. `aceitarTexto`: as conversas da Mesa Ads também
 * guardam o caminho solto como texto no lugar do objeto.
 */
export function caminhosDeImagemDosAnexos(anexos: unknown, aceitarTexto = false): string[] {
  if (!Array.isArray(anexos)) return [];
  const saida: string[] = [];
  for (const a of anexos) {
    if (typeof a === "string") {
      if (aceitarTexto && pareceCaminhoDeArquivo(a)) saida.push(a.trim());
      continue;
    }
    if (!a || typeof a !== "object") continue;
    const o = a as { tipo?: unknown; caminho?: unknown };
    if (o.tipo === TIPO_DO_ANEXO_DO_METODO) continue;
    if (pareceCaminhoDeArquivo(o.caminho)) saida.push(o.caminho.trim());
  }
  return saida;
}
