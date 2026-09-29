/**
 * Regras puras do gerar_elemento (frente EDT, F4): o prompt (isolado, fundo
 * transparente, sem texto e sem marca de ninguém) e a escolha do modelo. Sem
 * import: a tela e os testes usam também.
 */

export interface ModeloParaElemento {
  id: string;
  tipo: string;
  ativo: boolean;
  padrao_para: string[] | null;
  preco_imagem: Record<string, number> | null;
}

export const TIPOS_DE_ELEMENTO = ["icone", "objeto"] as const;
export type TipoDeElemento = (typeof TIPOS_DE_ELEMENTO)[number];
export const TAMANHO_DO_ELEMENTO = "1024x1024";

/** Prompt do elemento: isolado, fundo transparente, sem texto e sem marca de ninguém. */
export function promptDoElemento(tipo: TipoDeElemento, pedido: string): string {
  const base = String(pedido || "").replace(/\s+/g, " ").trim().slice(0, 600);
  const estilo = tipo === "icone"
    ? "Ícone único, desenho plano e limpo, traço firme, cores sólidas, centralizado, com margem em volta."
    : "Objeto único isolado, aparência real, luz de estúdio suave, centralizado, com margem em volta.";
  return `${estilo} Assunto: ${base}. Fundo transparente. Sem texto, sem letras, sem logotipo, sem marca de empresa, sem pessoa.`;
}

/** Modelo de imagem que faz fundo transparente: o padrão de imagem se fizer; senão o mais barato que faz. */
export function escolherModeloDoElemento<M extends ModeloParaElemento>(modelos: M[], fazTransparente: (m: M) => boolean): M | null {
  const ativos = modelos.filter((m) => m.tipo === "imagem" && m.ativo && fazTransparente(m));
  const padrao = ativos.find((m) => (m.padrao_para || []).indexOf("imagem") >= 0);
  if (padrao) return padrao;
  const preco = (m: M) => Number((m.preco_imagem || {}).media) || Number((m.preco_imagem || {}).alta) || 99;
  return ativos.sort((a, b) => preco(a) - preco(b))[0] || null;
}

