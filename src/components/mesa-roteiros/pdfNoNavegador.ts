import { gerarPdfDeRoteiros, nomeDoArquivoPdf, type ItemDoPdf } from "../../../supabase/functions/_shared/pdf-roteiro";
import { hashDoRoteiro, versaoPorNumero, type LinhaDoRoteiro, type Roteiro, type StatusDoRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";

/**
 * O PDF da Mesa Roteiros montado no navegador (Baixar), com o mesmo gerador
 * da função (Compartilhar): _shared/pdf-roteiro.ts. Nada vai para a rede.
 */

/** Que versão exportar: a aprovada (quando pedida e existe) ou a atual. Rascunho sai marcado. */
export function itemDoPdf(linha: LinhaDoRoteiro, usarAprovada: boolean): ItemDoPdf | null {
  const numero = usarAprovada && linha.versao_aprovada ? linha.versao_aprovada : linha.versao_atual;
  const v = versaoPorNumero(linha.versoes, numero);
  if (!v) return null;
  // A versão atual só é "aprovada" quando é a mesma que foi aprovada.
  const status: StatusDoRoteiro = v.numero === linha.versao_aprovada && linha.status !== "rascunho" ? linha.status : "rascunho";
  return { roteiro: v.conteudo, versao: v.numero, hash: v.hash || hashDoRoteiro(v.conteudo), status };
}

/** Roteiro ainda não guardado (banco sem a tabela): sai como rascunho, versão 1. */
export function itemSolto(r: Roteiro): ItemDoPdf {
  return { roteiro: r, versao: 1, hash: hashDoRoteiro(r), status: "rascunho" };
}

export function montarPdf(cliente: string, itens: ItemDoPdf[]): { bytes: Uint8Array; nome: string } {
  return { bytes: gerarPdfDeRoteiros({ cliente, itens }), nome: nomeDoArquivoPdf(cliente, itens) };
}

export function urlDoPdf(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

/**
 * Baixa os bytes com o nome certo. iPhone antigo (sem o atributo download)
 * abre o PDF numa aba, de onde dá para salvar ou compartilhar.
 */
export function baixarBytes(bytes: Uint8Array, nome: string) {
  const url = urlDoPdf(bytes);
  const a = document.createElement("a");
  const temDownload = typeof (a as { download?: unknown }).download === "string";
  a.href = url;
  if (temDownload) a.download = nome;
  else a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
