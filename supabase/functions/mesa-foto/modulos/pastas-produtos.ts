/** Pastas de organização são metadados: nunca movem ou apagam o arquivo original. */
export function limparPastaDeProdutos(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor.split(/[\\/]/).map((p) => p.replace(/[\u0000-\u001f<>:"|?*]/g, "").trim().replace(/\s+/g, " "))
    .filter((p) => p && p !== "." && p !== "..").slice(0, 4).map((p) => p.slice(0, 60)).join(" / ");
}

export const PUBLICOS_DO_PRODUTO = ["masculino", "feminino", "unissex", "nao_identificado"] as const;
export type PublicoProduto = typeof PUBLICOS_DO_PRODUTO[number];
export type ClassificacaoProduto = { valor: PublicoProduto; origem: "equipe" | "ia"; confianca: number; evidencia: string };
export type OrganizacaoProduto = { pasta: string; publico?: ClassificacaoProduto };
export const ROTULOS_PUBLICO: Record<PublicoProduto, string> = { masculino: "Masculino", feminino: "Feminino", unissex: "Unissex", nao_identificado: "A identificar" };

export function normalizarPublicoProduto(valor: unknown): ClassificacaoProduto | undefined {
  if (!valor || typeof valor !== "object") return undefined;
  const v = valor as Record<string, unknown>;
  if (!PUBLICOS_DO_PRODUTO.includes(v.valor as PublicoProduto)) return undefined;
  const origem = v.origem === "equipe" ? "equipe" : "ia";
  const confianca = origem === "equipe" ? 1 : typeof v.confianca === "number" && Number.isFinite(v.confianca) ? Math.max(0, Math.min(1, v.confianca)) : 0;
  const evidencia = typeof v.evidencia === "string" ? v.evidencia.trim().slice(0, 500) : "";
  // Incerteza não vira uma pasta masculina/feminina por adivinhação.
  return { valor: origem === "ia" && (confianca < 0.8 || !evidencia) ? "nao_identificado" : v.valor as PublicoProduto, origem, confianca, evidencia };
}

export function organizacaoDoProduto(valor: unknown): OrganizacaoProduto | undefined {
  if (!valor || typeof valor !== "object" || !("pasta" in valor)) return undefined;
  const v = valor as Record<string, unknown>;
  const publico = normalizarPublicoProduto(v.publico);
  return { pasta: limparPastaDeProdutos(v.pasta), ...(publico ? { publico } : {}) };
}

export function pastaOrganizadaDoProduto(org?: OrganizacaoProduto): string {
  const pasta = limparPastaDeProdutos(org?.pasta);
  if (!org?.publico) return pasta;
  const rotulo = ROTULOS_PUBLICO[org.publico.valor];
  return pasta.split(" / ").at(-1)?.toLocaleLowerCase("pt-BR") === rotulo.toLocaleLowerCase("pt-BR") ? pasta : [pasta, rotulo].filter(Boolean).join(" / ");
}
