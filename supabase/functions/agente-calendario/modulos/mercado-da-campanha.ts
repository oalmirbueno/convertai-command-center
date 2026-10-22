/**
 * "O que o mercado está fazendo" (22/10/2026, dono: "usar diferenciação, ver realmente o que o mercado está
 * fazendo"). A pesquisa na web do motor de texto traz campanhas reais atuais da ocasião e do nicho; aqui fica a
 * forma fixa, a regra "sem fonte, não entra" (o link tem que ser uma página que a busca citou) e o bloco do prompt.
 * Puro (sem Deno): a tela e os testes leem o mesmo arquivo.
 */

export interface PadraoDoMercado {
  padrao: string;
  fonte: string;
  link: string;
}

export interface MercadoDaCampanha {
  padroes: PadraoDoMercado[];
  diferenciacao: string;
  evitar: string[];
  pesquisado_em: string;
}

export const ESQUEMA_DO_MERCADO = {
  nome: "mercado_da_campanha",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["padroes", "diferenciacao", "evitar"],
    properties: {
      padroes: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["padrao", "fonte", "link"], properties: { padrao: { type: "string" }, fonte: { type: "string" }, link: { type: "string" } } },
      },
      diferenciacao: { type: "string" },
      evitar: { type: "array", items: { type: "string" } },
    },
  },
};

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/\s*[–—]\s*/g, ", ").slice(0, max) : "");

/** Mesmo endereço, sem barra final nem âncora (para cruzar o link com as fontes da busca). */
const chaveDoLink = (u: string) => u.trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

/**
 * A resposta da pesquisa em forma fixa, só com os padrões cujo link a busca citou (sem fontes da busca, nada
 * entra). Null quando não sobra padrão.
 */
export function mercadoComFonte(v: unknown, fontesDaBusca: string[], hoje: string): MercadoDaCampanha | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const citadas = fontesDaBusca.map(chaveDoLink);
  const padroes = (Array.isArray(o.padroes) ? o.padroes : [])
    .map((x) => {
      const p = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { padrao: txt(p.padrao, 300), fonte: txt(p.fonte, 80), link: txt(p.link, 500) };
    })
    .filter((p) => p.padrao && p.link.indexOf("https://") === 0 && citadas.indexOf(chaveDoLink(p.link)) >= 0)
    .slice(0, 5);
  if (!padroes.length) return null;
  return {
    padroes,
    diferenciacao: txt(o.diferenciacao, 400),
    evitar: (Array.isArray(o.evitar) ? o.evitar : []).map((e) => txt(e, 200)).filter(Boolean).slice(0, 4),
    pesquisado_em: hoje,
  };
}

/** O gravado (briefing.mercado) em forma fixa, ou null. */
export function normalizarMercado(v: unknown): MercadoDaCampanha | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const padroes = (Array.isArray(o.padroes) ? o.padroes : [])
    .map((x) => {
      const p = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { padrao: txt(p.padrao, 300), fonte: txt(p.fonte, 80), link: txt(p.link, 500) };
    })
    .filter((p) => p.padrao && p.link.indexOf("https://") === 0)
    .slice(0, 5);
  if (!padroes.length) return null;
  return {
    padroes,
    diferenciacao: txt(o.diferenciacao, 400),
    evitar: (Array.isArray(o.evitar) ? o.evitar : []).map((e) => txt(e, 200)).filter(Boolean).slice(0, 4),
    pesquisado_em: txt(o.pesquisado_em, 40),
  };
}

export function blocoDoMercado(m: MercadoDaCampanha | null): string {
  if (!m) return "";
  return [
    `O QUE O MERCADO ESTÁ FAZENDO (pesquisa de ${m.pesquisado_em}, com fonte):`,
    ...m.padroes.map((p) => `- ${p.padrao} (${p.fonte || "fonte"})`),
    m.diferenciacao ? `- Diferenciação deste cliente: ${m.diferenciacao}` : "",
    m.evitar.length ? `- Evite o que todo mundo faz: ${m.evitar.join("; ")}.` : "",
  ].filter(Boolean).join("\n");
}
