import type { ExecucaoDoLab } from "./api";
import type { CanvasDoLab } from "./nos";

export const MENSAGEM_DE_NAVEGACAO = "lab-previa-navegar";
export const MENSAGEM_DE_FORMULARIO = "lab-previa-formulario-bloqueado";
const ORIGEM_VIRTUAL = "https://previa-do-projeto.invalid";
const temEspacoOuControle = (valor: string) => Array.from(valor).some((c) => { const cp = c.codePointAt(0)!; return cp <= 32 || cp === 127; });
const NOMES_DAS_PAGINAS: Record<string, string> = { pagina: "Página", landing: "Landing page", checkout: "Checkout", webinar: "Webinar", quiz: "Quiz", teste_ab: "Teste de páginas", area_membros: "Área de membros" };

export interface PaginaDaPrevia {
  caminho: string;
  htmlPath: string;
  noId: string;
  nome: string;
}
export type ResultadoDoDestino = { ok: true; pagina: PaginaDaPrevia } | { ok: false; motivo: string };

function normalizarRota(valor: string): string | null {
  if (!valor || valor.length > 2048 || valor.includes("\\") || temEspacoOuControle(valor)) return null;
  try {
    const rota = decodeURIComponent(valor.split(/[?#]/)[0]);
    if (!rota.startsWith("/") || rota.startsWith("//") || /[\\:#?]/.test(rota) || temEspacoOuControle(rota)) return null;
    const url = new URL(rota, ORIGEM_VIRTUAL);
    if (url.origin !== ORIGEM_VIRTUAL || url.username || url.password) return null;
    return decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";
  } catch { return null; }
}

export function paginasDaPrevia(canvas: CanvasDoLab, execucoes: ExecucaoDoLab[]): PaginaDaPrevia[] {
  const ultimas = new Map<string, ExecucaoDoLab>();
  for (const ex of execucoes) {
    const anterior = ultimas.get(ex.no_id);
    if (!anterior || ex.created_at > anterior.created_at || ex.created_at === anterior.created_at && ex.id > anterior.id) ultimas.set(ex.no_id, ex);
  }
  const paginas: PaginaDaPrevia[] = [];
  const incluir = (caminho: unknown, htmlPath: unknown, noId: string, nome: string) => {
    if (typeof caminho !== "string" || typeof htmlPath !== "string" || !htmlPath.trim() || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(htmlPath)) return;
    const rota = normalizarRota(caminho.trim());
    if (!rota) return;
    if (!paginas.some((p) => p.caminho === rota && p.htmlPath === htmlPath && p.noId === noId)) paginas.push({ caminho: rota, htmlPath, noId, nome });
  };
  for (const no of canvas.nos) {
    const ex = ultimas.get(no.id);
    if (!ex || ex.status !== "pronto") continue;
    const nome = typeof no.dados.nome === "string" && no.dados.nome.trim() ? no.dados.nome : typeof no.dados.titulo === "string" && no.dados.titulo.trim() ? no.dados.titulo : NOMES_DAS_PAGINAS[no.tipo] || no.tipo;
    incluir(no.dados.caminho, ex.saida.html_path, no.id, nome);
    const extras = [...(Array.isArray(ex.saida.paginas) ? ex.saida.paginas : []), ...(Array.isArray(ex.saida.json?.paginas) ? ex.saida.json.paginas : [])];
    for (const extra of extras) {
      if (!extra || typeof extra !== "object" || Array.isArray(extra)) continue;
      const p = extra as Record<string, unknown>;
      incluir(p.caminho, p.html_path, no.id, typeof p.nome === "string" ? p.nome : nome);
    }
  }
  return paginas;
}

export function caminhoDoArquivo(paginas: PaginaDaPrevia[], htmlPath: string): string | null {
  const caminhos = [...new Set(paginas.filter((p) => p.htmlPath === htmlPath).map((p) => p.caminho))];
  return caminhos.length === 1 ? caminhos[0] : null;
}

/** Uma prévia só navega entre caminhos explícitos com HTML pronto do mesmo projeto. */
export function resolverDestinoDaPrevia(paginas: PaginaDaPrevia[], origem: string | null, pedido: unknown): ResultadoDoDestino {
  if (typeof pedido !== "string" || !pedido.trim() || pedido.length > 2048) return { ok: false, motivo: "Este link não tem um caminho de página válido." };
  const href = pedido.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return { ok: false, motivo: "Links externos e pagamentos ficam desativados nesta prévia." };
  if (href.includes("\\") || temEspacoOuControle(href)) return { ok: false, motivo: "Este link não tem um caminho de página válido." };
  if (!origem && !href.startsWith("/")) return { ok: false, motivo: "Defina o caminho da página de origem para usar links relativos." };
  let caminho: string | null = null;
  try {
    const url = new URL(href, ORIGEM_VIRTUAL + (origem || "/"));
    if (url.origin !== ORIGEM_VIRTUAL || url.username || url.password) return { ok: false, motivo: "Links externos ficam desativados nesta prévia." };
    caminho = normalizarRota(url.pathname);
  } catch { /* Mostra a mensagem abaixo, sem tentar um destino parecido. */ }
  if (!caminho) return { ok: false, motivo: "Este link não tem um caminho de página válido." };
  const encontradas = paginas.filter((p) => p.caminho === caminho);
  if (encontradas.length > 1) return { ok: false, motivo: `O caminho ${caminho} está em mais de uma página. Defina caminhos diferentes nos nós.` };
  if (!encontradas.length) return { ok: false, motivo: `A página ${caminho} ainda não tem um HTML pronto neste projeto.` };
  return { ok: true, pagina: encontradas[0] };
}

function semControles(valor: string): boolean {
  return Array.from(valor).every((c) => { const cp = c.codePointAt(0)!; return cp >= 32 && cp !== 127; });
}

/** Controlador estático: srcdoc herda a CSP do painel, que bloqueia scripts inline novos. */
export const CAMINHO_DO_CONTROLADOR = "/lab-preview-controller.js";
export const CAMINHO_DO_TAILWIND = "/vendor/tailwindcss-3.4.17.js";

/** Só o script do visor e o Tailwind conhecido podem rodar; ações da página gerada ficam inativas. */
export function htmlSeguroDaPrevia(html: string, nonce: string): string {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) throw new Error("Identificador inválido da prévia.");
  const controlador = new URL(CAMINHO_DO_CONTROLADOR, window.location.origin);
  const tailwind = new URL(CAMINHO_DO_TAILWIND, window.location.origin);
  if (!["https:", "http:"].includes(controlador.protocol)) throw new Error("Origem inválida da prévia.");
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("iframe,frame,object,embed,base,meta[http-equiv]").forEach((el) => el.remove());
  doc.querySelectorAll("link").forEach((link) => {
    try {
      const url = new URL(link.getAttribute("href") || "");
      if (link.getAttribute("rel")?.toLowerCase() === "stylesheet" && url.protocol === "https:" && url.hostname === "fonts.googleapis.com") return;
    } catch { /* Não pré-carrega destinos ou documentos externos. */ }
    link.remove();
  });
  doc.querySelectorAll("script").forEach((script) => {
    try {
      const url = new URL(script.getAttribute("src") || "");
      if (url.protocol === "https:" && url.hostname === "cdn.tailwindcss.com" && !url.port && !url.username && !url.password && !url.search && !url.hash && ["/", "/3.4.17"].includes(url.pathname)) {
        // O runtime oficial e fixo compila as classes do próprio documento.
        // Não executa configuração ou JavaScript fornecido na página gerada.
        script.src = tailwind.href;
        for (const attr of ["type", "integrity", "crossorigin"]) script.removeAttribute(attr);
        return;
      }
    } catch { /* Inline e scripts de outras origens são retirados. */ }
    script.remove();
  });
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const nome = attr.name.toLowerCase();
      if (nome.startsWith("on") || ["nonce", "srcdoc", "action", "formaction", "target", "formtarget", "download", "ping", "autofocus"].includes(nome)) el.removeAttribute(attr.name);
    }
    if (["img", "video", "audio"].includes(el.tagName.toLowerCase())) { el.setAttribute("crossorigin", "anonymous"); el.setAttribute("referrerpolicy", "no-referrer"); }
    if (["a", "area"].includes(el.tagName.toLowerCase())) {
      const href = el.getAttribute("href") || el.getAttribute("xlink:href") || "";
      el.setAttribute("data-lab-destino", semControles(href) ? href : "");
      // Sem href, uma falha de carregamento do controlador nunca abre o painel
      // dentro do iframe. O controlador também oferece a ativação pelo teclado.
      el.removeAttribute("href");
      el.setAttribute("role", "link");
      el.setAttribute("tabindex", "0");
      el.removeAttribute("xlink:href");
    }
  });
  const referrer = doc.createElement("meta");
  referrer.name = "referrer";
  referrer.content = "no-referrer";
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = `default-src 'none'; script-src ${controlador.href} ${tailwind.href}; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src https: data: blob:; font-src https://fonts.gstatic.com data:; media-src https: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'`;
  const script = doc.createElement("script");
  script.setAttribute("nonce", nonce);
  script.src = controlador.href;
  // Entram antes dos recursos e de qualquer conteúdo original.
  doc.head.prepend(script);
  doc.head.prepend(referrer);
  doc.head.prepend(csp);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}

export function nonceDaPrevia(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
}
