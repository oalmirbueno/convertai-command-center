export type FotoDaIdentidade = { bucket: string; caminho: string; nome: string };

/** Recupera a procedência da própria versão, nunca um rosto inferido pelo texto. */
export function fotosOriginaisDoAjuste(rosto: unknown): FotoDaIdentidade[] {
  if (!rosto || typeof rosto !== "object") return [];
  const r = rosto as Record<string, unknown>;
  if (r.aplicado === false || !Array.isArray(r.fotos_usadas)) return [];
  return r.fotos_usadas.filter((f): f is { bucket: string; caminho: string } =>
    !!f && typeof f === "object" && ["mesa", "workspace", "files", "mcp-files"].includes(f.bucket) &&
    typeof f.caminho === "string" && !!f.caminho && !f.caminho.includes("..") && !f.caminho.startsWith("/")
  ).slice(0, 3).map((f, i) => ({ ...f, nome: `identidade-original-${i + 1}` }));
}

export function pedidoDiretoNoAjuste(pedido: string, instrucao: string, preferencias: string) {
  return [
    `PEDIDO ATUAL DA EQUIPE (prioridade sobre a interpretação e referências antigas):\n${pedido}`,
    `COMO APLICAR:\n${instrucao}`,
    preferencias,
    "As referências de design orientam apenas o que foi pedido mudar. Não redesenhe o restante para imitar uma referência. Fotos de identidade são a fonte do rosto, nunca a pessoa de uma referência de design.",
  ].filter(Boolean).join("\n\n");
}
