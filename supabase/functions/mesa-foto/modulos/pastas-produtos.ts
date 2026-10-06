/** Pastas de organização são metadados: nunca movem ou apagam o arquivo original. */
export function limparPastaDeProdutos(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor.split(/[\\/]/).map((p) => p.replace(/[\u0000-\u001f<>:"|?*]/g, "").trim().replace(/\s+/g, " "))
    .filter((p) => p && p !== "." && p !== "..").slice(0, 4).map((p) => p.slice(0, 60)).join(" / ");
}

export function organizacaoDoProduto(valor: unknown): { pasta: string } | undefined {
  if (!valor || typeof valor !== "object" || !("pasta" in valor)) return undefined;
  return { pasta: limparPastaDeProdutos((valor as { pasta: unknown }).pasta) };
}
