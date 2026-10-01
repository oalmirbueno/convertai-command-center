/**
 * Baixar os mockups em alta: um arquivo ou vários num ZIP (o jszip só carrega na hora do ZIP).
 */

/** Nome de arquivo seguro: sem acento, sem espaço, com a extensão. */
export function nomeDeArquivo(nome: string, extensao: string): string {
  const base = String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${base || "mockup"}.${extensao.replace(/^\./, "")}`;
}

/** Nomes sem repetição dentro do ZIP ("a.png", "a-2.png"...). */
export function nomesUnicos(nomes: string[]): string[] {
  const usados: Record<string, number> = {};
  return nomes.map((n) => {
    if (!usados[n]) {
      usados[n] = 1;
      return n;
    }
    usados[n] += 1;
    const ponto = n.lastIndexOf(".");
    return ponto > 0 ? `${n.slice(0, ponto)}-${usados[n]}${n.slice(ponto)}` : `${n}-${usados[n]}`;
  });
}

export function salvarArquivo(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Vários arquivos num ZIP (PNG já é comprimido: guarda sem recomprimir). */
export async function baixarZip(itens: Array<{ nome: string; blob: Blob }>, nomeDoZip: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modulo: any = await import("jszip");
  const JSZip = modulo.default || modulo;
  const zip = new JSZip();
  const nomes = nomesUnicos(itens.map((i) => i.nome));
  itens.forEach((i, k) => zip.file(nomes[k], i.blob));
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  salvarArquivo(blob, nomeDoZip);
}
