/**
 * Navegador isolado do agente (frente MOD, 30/09/2026).
 *
 * Um Chromium headless por tarefa, com contexto novo (sem cookie, sem senha
 * salva, sem extensão, sem download, sem service worker, sem permissão) e as
 * travas de rede e de tela:
 * - navegação da página só para a lista de domínios da tarefa (o resto é
 *   bloqueado e anotado);
 * - só leitura: pedido que não é GET, HEAD ou OPTIONS é bloqueado (formulário
 *   não é enviado, nada é postado);
 * - só http e https (file:, chrome: e afins bloqueados);
 * - janela nova (popup) é fechada; alerta é dispensado;
 * - campo de senha, de cartão ou de código visível = a página pede login ou
 *   pagamento: quem chama para a tarefa.
 */

import { chromium, type Browser, type BrowserContext, type Page, type Request } from "playwright-core";
import { dominioPermitido, urlDeLoginOuPagamento } from "../../supabase/functions/_shared/computador-do-agente.ts";

export const TELA = { largura: 1280, altura: 800 };
export const TELA_DO_CELULAR = { largura: 390, altura: 844 };

export interface OpcoesDoNavegador {
  dominios: string[];
  /** Regras de DNS do Chromium (só nos testes: "MAP *.com.br 127.0.0.1"). */
  regrasDeHost?: string;
  /** Caminho de um Chrome já baixado (senão o Chromium do Playwright). */
  executavel?: string | null;
}

export interface Bloqueio {
  url: string;
  motivo: "dominio_fora_da_lista" | "so_leitura" | "protocolo";
  metodo: string;
}

export interface NavegadorDoAgente {
  pagina: Page;
  bloqueios: Bloqueio[];
  /** Abre a URL (só se estiver na lista); devolve o status HTTP ou null. */
  ir(url: string, prazoMs?: number): Promise<number | null>;
  /** Motivo para parar agora (login, senha, cartão) ou null. */
  paginaProibida(): Promise<string | null>;
  /** Navegação barrada pela rede vira página de erro: volta para a página de antes. */
  voltarSeBloqueou(): Promise<void>;
  fechar(): Promise<void>;
}

const METODOS_DE_LEITURA = ["GET", "HEAD", "OPTIONS"];

/** Regra de rede de um pedido (pura, testada): null = deixa passar. */
export function regraDoPedido(p: { url: string; metodo: string; navegacaoPrincipal: boolean }, dominios: string[]): Bloqueio | null {
  let protocolo = "";
  try {
    protocolo = new URL(p.url).protocol;
  } catch {
    return { url: p.url.slice(0, 300), motivo: "protocolo", metodo: p.metodo };
  }
  // data: e blob: são conteúdo da própria página (imagens embutidas); o resto que não é web, não.
  if (protocolo === "data:" || protocolo === "blob:") return null;
  if (protocolo !== "http:" && protocolo !== "https:") return { url: p.url.slice(0, 300), motivo: "protocolo", metodo: p.metodo };
  if (METODOS_DE_LEITURA.indexOf(p.metodo.toUpperCase()) < 0) return { url: p.url.slice(0, 300), motivo: "so_leitura", metodo: p.metodo };
  if (p.navegacaoPrincipal && !dominioPermitido(p.url, dominios)) return { url: p.url.slice(0, 300), motivo: "dominio_fora_da_lista", metodo: p.metodo };
  return null;
}

/**
 * Roda dentro de cada página antes do script dela (addInitScript): bloqueia
 * envio de formulário, link e window.open para fora da lista e avisa o worker.
 * Precisa ser autocontida (vai como texto para o navegador).
 */
export function travaNaPagina(dominios: string[]) {
  const w = window as unknown as { __aceleriqBloqueio?: (url: string, motivo: string) => void; open: typeof window.open };
  const avisar = (url: string, motivo: string) => {
    try {
      if (w.__aceleriqBloqueio) void w.__aceleriqBloqueio(url, motivo);
    } catch { /* o aviso é só registro */ }
  };
  const permitido = (href: string) => {
    try {
      const u = new URL(href, location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      const host = u.hostname.toLowerCase();
      return dominios.some((d) => host === d || host.slice(-(d.length + 1)) === "." + d);
    } catch {
      return false;
    }
  };
  document.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const f = e.target as HTMLFormElement | null;
    avisar(f && f.action ? f.action : location.href, "so_leitura");
  }, true);
  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    avisar(this.action || location.href, "so_leitura");
  };
  HTMLFormElement.prototype.requestSubmit = function (this: HTMLFormElement) {
    avisar(this.action || location.href, "so_leitura");
  };
  document.addEventListener("click", (e) => {
    const alvo = e.target as Element | null;
    const a = alvo && alvo.closest ? (alvo.closest("a[href]") as HTMLAnchorElement | null) : null;
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (/^#/.test(href) || /^javascript:/i.test(href)) return;
    const ok = permitido(a.href);
    if (!ok || a.hasAttribute("download") || a.target === "_blank") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!ok) avisar(a.href, "dominio_fora_da_lista");
      else if (a.target === "_blank" && !a.hasAttribute("download")) location.href = a.href;
    }
  }, true);
  w.open = function (url?: string | URL) {
    const href = String(url || "");
    if (href && permitido(href)) location.href = new URL(href, location.href).toString();
    else if (href) avisar(href, "dominio_fora_da_lista");
    return null;
  } as typeof window.open;
}

/** Seletores de campo que só existe em login, cadastro ou pagamento. */
export const CAMPOS_PROIBIDOS = [
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="new-password"]',
  'input[autocomplete="one-time-code"]',
  'input[autocomplete^="cc-"]',
  'input[name*="cardnumber" i]',
  'input[name*="card_number" i]',
  'input[name*="cvv" i]',
  'input[name*="cvc" i]',
  'iframe[src*="checkout" i]',
  'iframe[name*="card" i]',
].join(", ");

export async function abrirNavegador(op: OpcoesDoNavegador): Promise<NavegadorDoAgente> {
  const args = ["--disable-extensions", "--disable-sync", "--no-first-run", "--disable-background-networking", "--disable-component-update"];
  if (op.regrasDeHost) args.push(`--host-resolver-rules=${op.regrasDeHost}`);
  const navegador: Browser = await chromium.launch({ headless: true, args, executablePath: op.executavel || undefined });
  let contexto: BrowserContext | null = null;
  try {
    contexto = await navegador.newContext({
      viewport: { width: TELA.largura, height: TELA.altura },
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      bypassCSP: false,
      javaScriptEnabled: true,
      userAgent: undefined,
    });
    const bloqueios: Bloqueio[] = [];
    // Trava dentro da página: formulário não envia, link e window.open para fora da lista não saem do
    // lugar (sem virar página de erro). A rede (abaixo) continua sendo a última palavra.
    await contexto.exposeBinding("__aceleriqBloqueio", (_origem, url: string, motivo: Bloqueio["motivo"]) => {
      if (bloqueios.length < 200) bloqueios.push({ url: String(url).slice(0, 300), motivo, metodo: motivo === "so_leitura" ? "POST" : "GET" });
    });
    await contexto.addInitScript(travaNaPagina, op.dominios);
    const pagina = await contexto.newPage();
    await contexto.route("**/*", async (rota) => {
      const pedido: Request = rota.request();
      const principal = pedido.isNavigationRequest() && pedido.frame() === pagina.mainFrame();
      const bloqueio = regraDoPedido({ url: pedido.url(), metodo: pedido.method(), navegacaoPrincipal: principal }, op.dominios);
      if (bloqueio) {
        if (bloqueios.length < 200) bloqueios.push(bloqueio);
        await rota.abort("blockedbyclient");
        return;
      }
      await rota.continue();
    });
    contexto.on("page", (outra) => {
      if (outra !== pagina) void outra.close().catch(() => undefined);
    });
    pagina.on("dialog", (d) => void d.dismiss().catch(() => undefined));
    pagina.on("download", (d) => void d.cancel().catch(() => undefined));

    const nav: NavegadorDoAgente = {
      pagina,
      bloqueios,
      async voltarSeBloqueou() {
        if (/^chrome-error:/.test(pagina.url())) await pagina.goBack({ waitUntil: "load", timeout: 15_000 }).catch(() => null);
      },
      async ir(url, prazoMs = 30_000) {
        if (!dominioPermitido(url, op.dominios)) {
          bloqueios.push({ url: url.slice(0, 300), motivo: "dominio_fora_da_lista", metodo: "GET" });
          return null;
        }
        try {
          const r = await pagina.goto(url, { waitUntil: "load", timeout: prazoMs });
          return r ? r.status() : null;
        } catch (err) {
          // Tempo da página esgotado: segue com o que carregou (a prova mostra).
          if (err instanceof Error && /Timeout/i.test(err.name + err.message)) return null;
          throw err;
        }
      },
      async paginaProibida() {
        const atual = pagina.url();
        if (atual && /^https?:/.test(atual) && urlDeLoginOuPagamento(atual)) return `A página foi para um endereço de login, conta ou pagamento (${new URL(atual).hostname}). Parei: esse passo é do dono.`;
        const achou = await pagina
          .evaluate((sel) => {
            const lista = Array.prototype.slice.call(document.querySelectorAll(sel)) as HTMLElement[];
            return lista.some((el) => {
              const r = el.getBoundingClientRect();
              const estilo = window.getComputedStyle(el);
              return r.width > 0 && r.height > 0 && estilo.visibility !== "hidden" && estilo.display !== "none";
            });
          }, CAMPOS_PROIBIDOS)
          .catch(() => false);
        return achou ? "A página pede senha, código ou dados de cartão. Parei: o navegador do agente não faz login nem pagamento." : null;
      },
      async fechar() {
        await contexto?.close().catch(() => undefined);
        await navegador.close().catch(() => undefined);
      },
    };
    return nav;
  } catch (err) {
    await contexto?.close().catch(() => undefined);
    await navegador.close().catch(() => undefined);
    throw err;
  }
}

/** Rola até o fim (carrega imagens preguiçosas), no máximo `vezes` telas, e volta ao topo. */
export async function rolarAteOFim(pagina: Page, vezes = 30): Promise<number> {
  let altura = 0;
  for (let i = 0; i < vezes; i++) {
    const r = await pagina.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
      return { y: window.scrollY + window.innerHeight, total: document.documentElement.scrollHeight };
    });
    altura = r.total;
    await pagina.waitForTimeout(250);
    if (r.y >= r.total - 2) break;
  }
  await pagina.evaluate(() => window.scrollTo(0, 0));
  await pagina.waitForTimeout(200);
  return altura;
}
