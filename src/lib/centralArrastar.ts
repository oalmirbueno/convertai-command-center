/**
 * Arrastar arquivos do Workspace para o Gestor ou o Hermes (Central, 09/10/2026).
 *
 * A lista de arquivos do cliente na Central põe no arraste o tipo
 * TIPO_ARQUIVO_DO_WORKSPACE com {nome, mime, url}: a url é ASSINADA (curta,
 * pela sessão do dono, resolveFileUrl). Quem recebe baixa e trata como um
 * arquivo do computador, respeitando o que cada conversa aceita.
 */

export const TIPO_ARQUIVO_DO_WORKSPACE = "application/x-aceleriq-arquivo";

export type ArquivoArrastado = { nome: string; mime: string; url: string };

/** Até 4 itens; só https (url assinada do Storage) ou blob/data da própria página. */
export function lerArrastado(bruto: string): ArquivoArrastado[] {
  try {
    const v = JSON.parse(bruto);
    const lista = Array.isArray(v) ? v : [v];
    return lista
      .filter((x) => x && typeof x.url === "string" && /^(https:|blob:|data:)/.test(x.url))
      .slice(0, 4)
      .map((x) => ({ nome: String(x.nome || "arquivo").slice(0, 200), mime: String(x.mime || "application/octet-stream"), url: String(x.url) }));
  } catch {
    return [];
  }
}

export async function arquivosDoWorkspace(bruto: string): Promise<File[]> {
  const itens = lerArrastado(bruto);
  const arquivos: File[] = [];
  for (const a of itens) {
    const r = await fetch(a.url);
    if (!r.ok) throw new Error(`download ${r.status}`);
    const blob = await r.blob();
    arquivos.push(new File([blob], a.nome, { type: a.mime || blob.type }));
  }
  return arquivos;
}
