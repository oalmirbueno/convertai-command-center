/**
 * Padrão visual da campanha (22/10/2026, dono: "a campanha seguir referência de post, onde eu escolho e ele faz
 * os posts já nessa pegada no Estúdio, para ter um padrão único de campanha; e o selo tem que seguir a pegada da
 * referência e não ser genérico").
 *
 * Lógica de campanha (diferente da referência de uma lâmina só): a equipe escolhe 1 a 3 posts de referência; o
 * leitor por visão lê UMA vez o sistema visual deles (layout, hierarquia, tipografia, paleta, tratamento de foto,
 * elementos recorrentes) e isso vira o padrão guardado na campanha (briefing.padrao). Toda peça (post, carrossel,
 * story) e o selo seguem o padrão e levam as referências anexadas ao gerador como guia de estilo (fidelidade
 * "inspirada": composição nova, mesmo sistema gráfico), mudando só o conteúdo de cada fase. Nada de copiar texto,
 * logo ou pessoa da referência, e nada colado: a referência vai ao gerador como referência.
 *
 * Puro (sem Deno nem npm): a tela, as funções e os testes leem o mesmo arquivo. Sem lookbehind, propriedade
 * Unicode ou grupo nomeado em regex (Safari 11).
 */

export const MAX_REFERENCIAS_DO_PADRAO = 3;

export interface CorDoPadrao {
  nome: string;
  hex: string;
}

export interface PadraoDaCampanha {
  /** As referências escolhidas (ids do Estúdio: cliente_referencias ou "g:" do banco da agência), na ordem. */
  referencias_ids: string[];
  /** Caminho de cada uma no bucket mesa quando há (o selo anexa só as da pasta do cliente). */
  caminhos: string[];
  resumo: string;
  layout: string;
  hierarquia: string;
  tipografia: string;
  paleta: CorDoPadrao[];
  tratamento_de_foto: string;
  elementos: string;
  /** Como o selo da campanha fica nesse estilo (forma, letra, cor, acabamento). */
  para_o_selo: string;
  /** O que é da referência e não pode ir para as peças (textos, logos, pessoas, produto de terceiros). */
  nao_copiar: string;
  lido_em: string;
  modelo: string | null;
}

const S = (type: string) => ({ type });

/** Esquema da leitura (estrito: tudo obrigatório, sem extras). */
export const ESQUEMA_DO_PADRAO = {
  nome: "padrao_visual_da_campanha",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resumo", "layout", "hierarquia", "tipografia", "paleta", "tratamento_de_foto", "elementos", "para_o_selo", "nao_copiar"],
    properties: {
      resumo: S("string"),
      layout: S("string"),
      hierarquia: S("string"),
      tipografia: S("string"),
      paleta: { type: "array", items: { type: "object", additionalProperties: false, required: ["nome", "hex"], properties: { nome: S("string"), hex: S("string") } } },
      tratamento_de_foto: S("string"),
      elementos: S("string"),
      para_o_selo: S("string"),
      nao_copiar: S("string"),
    },
  },
};

export const SISTEMA_DO_PADRAO =
  "Você é diretor de arte e lê posts de referência para montar o PADRÃO VISUAL de uma campanha inteira. " +
  "Descreva o sistema gráfico que se repete nas imagens (não o conteúdo de cada uma), em frases curtas e concretas que um gerador de imagem consiga seguir: " +
  "layout (grade, onde fica o título, margens, proporção de texto e imagem), hierarquia (o que se lê primeiro, segundo, terceiro), " +
  "tipografia (família parecida, peso, caixa, tamanho relativo), paleta (3 a 5 cores em hex), tratamento de foto (luz, recorte, filtro, fundo), " +
  "elementos recorrentes (formas, selos, faixas, texturas, ícones). Diga também como um selo (logo da campanha) ficaria nesse estilo. " +
  "Em nao_copiar, liste o que é da referência e não pode ir para as peças: textos, logos, marcas, pessoas e produtos de terceiros. " +
  "Português do Brasil, sem travessão.";

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/\s*[–—]\s*/g, ", ").slice(0, max) : "");
const HEX = /^#[0-9a-f]{6}$/i;

/** Ids de referência aceitos (do cliente ou do banco da agência com "g:"), sem repetir, até 3. */
export function idsDoPadrao(v: unknown): string[] {
  const UUID = /^(g:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const saida: string[] = [];
  (Array.isArray(v) ? v : []).forEach((x) => {
    const id = String(x || "").trim();
    if (UUID.test(id) && saida.indexOf(id) < 0) saida.push(id);
  });
  return saida.slice(0, MAX_REFERENCIAS_DO_PADRAO);
}

/** A leitura (ou o gravado) em forma fixa; null sem referência ou sem nada lido. */
export function normalizarPadrao(v: unknown): PadraoDaCampanha | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const referencias_ids = idsDoPadrao(o.referencias_ids);
  const resumo = txt(o.resumo, 400);
  if (!referencias_ids.length || !resumo) return null;
  return {
    referencias_ids,
    caminhos: (Array.isArray(o.caminhos) ? o.caminhos : []).map((c) => (typeof c === "string" ? c.slice(0, 300) : "")).filter((c) => c && c.indexOf("..") < 0).slice(0, MAX_REFERENCIAS_DO_PADRAO),
    resumo,
    layout: txt(o.layout, 400),
    hierarquia: txt(o.hierarquia, 300),
    tipografia: txt(o.tipografia, 300),
    paleta: (Array.isArray(o.paleta) ? o.paleta : [])
      .map((p) => {
        const x = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
        return { nome: txt(x.nome, 40), hex: txt(x.hex, 7).toUpperCase() };
      })
      .filter((p) => HEX.test(p.hex))
      .slice(0, 6),
    tratamento_de_foto: txt(o.tratamento_de_foto, 300),
    elementos: txt(o.elementos, 300),
    para_o_selo: txt(o.para_o_selo, 300),
    nao_copiar: txt(o.nao_copiar, 300),
    lido_em: txt(o.lido_em, 40),
    modelo: txt(o.modelo, 120) || null,
  };
}

/** Bloco do prompt (diretor e gerador): o padrão que toda peça da campanha segue. */
export function blocoDoPadrao(p: PadraoDaCampanha | null): string {
  if (!p) return "";
  const paleta = p.paleta.map((c) => `${c.nome || "cor"} ${c.hex}`).join(", ");
  return [
    "PADRÃO VISUAL DA CAMPANHA (todas as peças seguem este mesmo sistema; muda só o conteúdo de cada fase)",
    `- Estilo: ${p.resumo}`,
    p.layout ? `- Layout: ${p.layout}` : "",
    p.hierarquia ? `- Hierarquia: ${p.hierarquia}` : "",
    p.tipografia ? `- Tipografia: ${p.tipografia}` : "",
    paleta ? `- Paleta da campanha: ${paleta}` : "",
    p.tratamento_de_foto ? `- Tratamento de foto: ${p.tratamento_de_foto}` : "",
    p.elementos ? `- Elementos recorrentes: ${p.elementos}` : "",
    `- As referências anexadas são o padrão: siga o sistema gráfico com composição nova. Nunca copie textos, logos, marcas, pessoas nem produtos delas${p.nao_copiar ? ` (${p.nao_copiar})` : ""}. Nada colado: tudo desenhado pelo gerador.`,
  ].filter(Boolean).join("\n");
}

/** O pedido do selo pelo padrão (o selo deixa de ser genérico e segue a pegada da referência). */
export function pedidoDoSeloPeloPadrao(p: PadraoDaCampanha | null): string {
  if (!p) return "";
  const paleta = p.paleta.map((c) => c.hex).join(", ");
  return [
    `Siga o padrão visual da campanha: ${p.resumo}`,
    p.para_o_selo ? `Selo nesse estilo: ${p.para_o_selo}` : "",
    p.tipografia ? `Letra: ${p.tipografia}` : "",
    paleta ? `Cores: ${paleta}` : "",
    "As referências anexadas são o estilo; não copie textos, logos nem marcas delas.",
  ].filter(Boolean).join(" ").slice(0, 400);
}

/** Texto curto do padrão para o pedido de uma peça (stories e quem não lê o bloco inteiro). */
export function resumoDoPadraoParaAPeca(p: PadraoDaCampanha | null): string {
  if (!p) return "";
  const paleta = p.paleta.map((c) => c.hex).join(", ");
  return `Padrão visual da campanha: ${p.resumo}${p.tipografia ? ` Tipografia: ${p.tipografia}.` : ""}${paleta ? ` Paleta: ${paleta}.` : ""} Siga as referências da campanha como estilo, sem copiar textos, logos ou pessoas.`.slice(0, 600);
}

/**
 * As referências e a fidelidade de uma peça da campanha com padrão: as do padrão na frente (todas as peças com
 * o mesmo guia), até 4, e "inspirada" (mesmo sistema gráfico, composição nova; a referência nunca é editada nem
 * colada). Sem padrão: as da peça como estão.
 */
export function referenciasDaPecaComPadrao(
  p: PadraoDaCampanha | null,
  daPeca: string[] | null | undefined,
  fidelidade: string | null | undefined,
): { referencias_ids: string[]; fidelidade_referencia: string | null } {
  const atuais = (daPeca || []).slice();
  if (!p) return { referencias_ids: atuais, fidelidade_referencia: fidelidade || null };
  const juntas: string[] = [];
  p.referencias_ids.concat(atuais).forEach((id) => { if (juntas.indexOf(id) < 0) juntas.push(id); });
  return { referencias_ids: juntas.slice(0, 4), fidelidade_referencia: fidelidade || "inspirada" };
}
