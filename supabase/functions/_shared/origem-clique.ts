/**
 * Origem do clique (19/10/2026, ideia 8 do estudo do ClickMax): de qual
 * anúncio o lead veio. O site da Mesa Site guarda os parâmetros do link de
 * entrada (utm_* e os ids da Meta) e manda junto com o formulário; aqui eles
 * são conferidos antes de ir para commercial_leads.origem_clique.
 *
 * Regra: só o que veio no link. Nada é deduzido além do padrão da Meta
 * (utm_content={{ad.id}} e utm_campaign={{campaign.id}} viram ad_id e
 * campaign_id quando são só dígitos). Macro que a Meta não trocou
 * ("{{ad.id}}" literal) não é dado e fica de fora.
 *
 * Puro: sem Deno, sem npm e sem banco. A função site-formulario, a tela de
 * anúncios, o CRM e os testes importam o mesmo arquivo. Sem expressão regular
 * com recursos que o Safari 11 não tem (o piso do painel).
 */

export const CAMPOS_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export const CAMPOS_DE_ID = ["ad_id", "adset_id", "campaign_id"] as const;
/** Tudo o que o site repassa do link para o formulário (campos ocultos). */
export const CAMPOS_DA_ORIGEM = [...CAMPOS_UTM, ...CAMPOS_DE_ID, "fbclid"] as const;

export type CampoDaOrigem = (typeof CAMPOS_DA_ORIGEM)[number];
export type OrigemDoClique = Partial<Record<CampoDaOrigem, string>>;

/** Id da Meta: só dígitos (anúncio, conjunto e campanha têm de 6 a 25 hoje). */
const ID_DA_META = /^\d{5,25}$/;
const FBCLID = /^[A-Za-z0-9_.-]{8,500}$/;

const limpo = (v: unknown, max: number): string => {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
};

/** Macro que não foi trocada ou texto com marcação: não é dado do link. */
const pareceMacroOuMarcacao = (s: string) => s.indexOf("{{") >= 0 || s.indexOf("}}") >= 0 || s.indexOf("<") >= 0 || s.indexOf(">") >= 0;

/**
 * Lê a origem do clique de um objeto (o corpo do formulário ou o jsonb do
 * banco). Devolve null quando nada veio: lead sem link de anúncio continua
 * sem origem, nunca com uma inventada.
 */
export function lerOrigemDoClique(bruto: unknown): OrigemDoClique | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const o = bruto as Record<string, unknown>;
  const saida: OrigemDoClique = {};
  for (const c of CAMPOS_UTM) {
    const v = limpo(o[c], 150);
    if (v && !pareceMacroOuMarcacao(v)) saida[c] = v;
  }
  for (const c of CAMPOS_DE_ID) {
    const v = limpo(o[c], 30);
    if (ID_DA_META.test(v)) saida[c] = v;
  }
  const fbclid = limpo(o.fbclid, 500);
  if (FBCLID.test(fbclid)) saida.fbclid = fbclid;
  // Padrão da Meta: utm_content={{ad.id}} e utm_campaign={{campaign.id}}.
  if (!saida.ad_id && saida.utm_content && ID_DA_META.test(saida.utm_content)) saida.ad_id = saida.utm_content;
  if (!saida.campaign_id && saida.utm_campaign && ID_DA_META.test(saida.utm_campaign)) saida.campaign_id = saida.utm_campaign;
  return Object.keys(saida).length ? saida : null;
}

/** Lê os parâmetros de um endereço (a busca "?utm_source=...") com a mesma régua. */
export function origemDaBusca(busca: string): OrigemDoClique | null {
  const o: Record<string, string> = {};
  const texto = String(busca || "").replace(/^\?/, "");
  if (!texto) return null;
  for (const par of texto.split("&")) {
    const i = par.indexOf("=");
    const chave = i >= 0 ? par.slice(0, i) : par;
    if ((CAMPOS_DA_ORIGEM as readonly string[]).indexOf(chave) < 0) continue;
    try {
      o[chave] = decodeURIComponent((i >= 0 ? par.slice(i + 1) : "").replace(/\+/g, " "));
    } catch {
      /* parâmetro mal codificado: fica de fora */
    }
  }
  return lerOrigemDoClique(o);
}

/** A origem veio de anúncio? (id do anúncio ou da campanha, ou o fbclid da Meta). */
export const veioDeAnuncio = (o: OrigemDoClique | null | undefined) => !!o && !!(o.ad_id || o.campaign_id || o.fbclid);

/** O link sugerido para o dono colar em "Parâmetros de URL" do anúncio na Meta. */
export const PARAMETROS_DE_URL_DA_META = "utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}";
