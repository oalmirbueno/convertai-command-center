/**
 * Quem pode chamar do navegador as funções que conferem `Origin`
 * (client-first-access, notify-admin, submit-quiz).
 *
 * Antes cada uma aceitava só APP_PUBLIC_URL, igual e exato. Resultado: o
 * painel rodando em localhost (desenvolvimento) e a prévia do Lovable
 * levavam 403 no primeiro acesso, no aviso ao admin e no quiz. Aqui a lista
 * é fechada e explícita, nunca "qualquer origem":
 * - APP_PUBLIC_URL (o domínio que o servidor conhece);
 * - aceleriq.online e www.aceleriq.online;
 * - as prévias do projeto no Lovable (pelo id e pelo nome do projeto, só os
 *   endereços que o Lovable dá a ESTE projeto);
 * - localhost, 127.0.0.1 e [::1], em qualquer porta (o `npm run dev`).
 *
 * Sem cabeçalho Origin (servidor chamando servidor) segue como antes: passa.
 * A resposta devolve em Access-Control-Allow-Origin a origem que chamou,
 * quando ela está na lista; senão fica a APP_PUBLIC_URL.
 */

/** Projeto do painel no Lovable (docs/security/2026-09-12-release-and-preview.md). */
export const ID_DO_PROJETO_LOVABLE = "96b08aa1-81bd-4fdc-b0a4-69d220daf3fe";
export const NOME_DO_PROJETO_LOVABLE = "orbital-command-hq";

const ORIGENS_FIXAS = [
  "https://aceleriq.online",
  "https://www.aceleriq.online",
  `https://${ID_DO_PROJETO_LOVABLE}.lovableproject.com`,
  `https://id-preview--${ID_DO_PROJETO_LOVABLE}.lovable.app`,
  `https://${NOME_DO_PROJETO_LOVABLE}.lovable.app`,
  `https://preview--${NOME_DO_PROJETO_LOVABLE}.lovable.app`,
];

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A origem normalizada (esquema://host[:porta]) ou null se não for http(s) válido. */
export function normalizarOrigem(valor: string | null | undefined): string | null {
  const bruto = (valor ?? "").trim();
  if (!bruto || bruto === "null") return null;
  try {
    const url = new URL(bruto);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function ehLocal(origem: string): boolean {
  try {
    return HOSTS_LOCAIS.has(new URL(origem).hostname);
  } catch {
    return false;
  }
}

/** A lista fechada de origens do painel (sem as locais, que são conferidas à parte). */
export function origensDoPainel(appOrigin?: string | null): Set<string> {
  const lista = new Set<string>(ORIGENS_FIXAS);
  const app = normalizarOrigem(appOrigin);
  if (app) lista.add(app);
  return lista;
}

/**
 * A origem pode chamar? `null` (sem cabeçalho) passa, como antes. Local só
 * em http(s) de localhost/127.0.0.1/[::1]; o resto precisa estar na lista.
 */
export function origemDoPainelPermitida(
  origem: string | null | undefined,
  permitidas: ReadonlySet<string>,
): boolean {
  if (origem === null || origem === undefined) return true;
  const normalizada = normalizarOrigem(origem);
  if (!normalizada) return false;
  return permitidas.has(normalizada) || ehLocal(normalizada);
}

/**
 * Embrulha o handler: recusa (403) origem fora da lista antes de qualquer
 * trabalho e acerta o Access-Control-Allow-Origin da resposta para a origem
 * que chamou. O handler continua montando os cabeçalhos de sempre.
 */
export function comOrigemDoPainel(
  appOrigin: string,
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  const permitidas = origensDoPainel(appOrigin);
  return async (req: Request) => {
    const cabecalho = req.headers.get("Origin");
    if (!origemDoPainelPermitida(cabecalho, permitidas)) {
      return new Response(
        JSON.stringify({ error: "Forbidden", code: "origem_nao_permitida" }),
        {
          status: 403,
          headers: {
            "Access-Control-Allow-Origin": appOrigin,
            "Vary": "Origin",
            "Content-Type": "application/json",
          },
        },
      );
    }
    const resposta = await handler(req);
    const origem = normalizarOrigem(cabecalho);
    if (!origem) return resposta;
    const headers = new Headers(resposta.headers);
    headers.set("Access-Control-Allow-Origin", origem);
    const vary = headers.get("Vary") ?? "";
    if (!/(^|,)\s*origin\s*(,|$)/i.test(vary)) {
      headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
    }
    return new Response(resposta.body, {
      status: resposta.status,
      statusText: resposta.statusText,
      headers,
    });
  };
}
