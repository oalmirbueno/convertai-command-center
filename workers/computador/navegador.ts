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
 * - rede interna bloqueada em TODO pedido (página, imagem, script): localhost,
 *   *.local, *.internal, IP literal privado, de loopback ou link-local (v4 e v6)
 *   e nome público cujo DNS cai numa dessas faixas (o worker roda na máquina da
 *   agência, ao lado do render e do motor-codigo);
 * - janela nova (popup) é fechada; alerta é dispensado;
 * - campo de senha, de cartão ou de código visível = a página pede login ou
 *   pagamento: quem chama para a tarefa.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { chromium, type Browser, type BrowserContext, type Page, type Request } from "playwright-core";
import { dominioPermitido, urlDeLoginOuPagamento } from "../../supabase/functions/computador-do-agente/modulos/navegador.ts";

export const TELA = { largura: 1280, altura: 800 };
export const TELA_DO_CELULAR = { largura: 390, altura: 844 };

export interface OpcoesDoNavegador {
  dominios: string[];
  /** Regras de DNS do Chromium (só nos testes: "MAP *.com.br 127.0.0.1"). */
  regrasDeHost?: string;
  /** Caminho de um Chrome já baixado (senão o Chromium do Playwright). */
  executavel?: string | null;
  /** Resolve o nome em IPs (padrão: o DNS da máquina). Os testes trocam para não depender da rede. */
  resolver?: (host: string) => Promise<string[]>;
}

export interface Bloqueio {
  url: string;
  motivo: "dominio_fora_da_lista" | "so_leitura" | "protocolo" | "rede_interna";
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

const NOME_INTERNO = /^(localhost|localhost\.localdomain|ip6-localhost|ip6-loopback|metadata|metadata\.google\.internal)$|\.(localhost|local|internal|intranet|lan|home|corp|home\.arpa)$/i;

function ipv4Privado(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return true;
  const [a, b, c] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // "esta rede", privada, loopback, multicast e reservada
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local (metadados de nuvem)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** IP (v4 ou v6) de loopback, privado, link-local, CGNAT, multicast ou reservado. Texto que não é IP: false. */
export function ipPrivado(bruto: string): boolean {
  const ip = String(bruto || "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  const tipo = isIP(ip);
  if (tipo === 4) return ipv4Privado(ip);
  if (tipo !== 6) return false;
  if (/^[0:]*:?:1?$/.test(ip)) return true; // :: e ::1
  const v4 = ip.match(/^[0:]*:ffff:(\d+\.\d+\.\d+\.\d+)$/) || ip.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return ipv4Privado(v4[1]);
  const mapeado = ip.match(/^[0:]*:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapeado) {
    const x = parseInt(mapeado[1], 16);
    const y = parseInt(mapeado[2], 16);
    return ipv4Privado(`${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`);
  }
  const primeiro = parseInt(ip.split(":")[0] || "0", 16);
  return (
    (primeiro & 0xfe00) === 0xfc00 || // fc00::/7 (privada)
    (primeiro & 0xffc0) === 0xfe80 || // fe80::/10 (link-local)
    (primeiro & 0xffc0) === 0xfec0 || // site-local antigo
    (primeiro & 0xff00) === 0xff00 || // multicast
    /^2001:0?db8:/.test(ip) || // documentação
    /^64:ff9b:/.test(ip) // NAT64
  );
}

/** Host da rede interna pelo nome ou pelo IP literal (sem consultar o DNS). */
export function hostDeRedeInterna(bruto: string): boolean {
  const host = String(bruto || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (isIP(host)) return ipPrivado(host);
  // Número solto ou em hexadecimal também vira IP no navegador (http://2130706433/ é 127.0.0.1).
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(host)) return true;
  return NOME_INTERNO.test(host) || host.indexOf(".") < 0;
}

async function resolverPeloDns(host: string): Promise<string[]> {
  try {
    return (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);
  } catch {
    // Nome que não resolve: o Chromium também não abre; não há IP interno a proteger.
    return [];
  }
}

/** IP interno para onde o nome aponta (o primeiro achado) ou null. IP literal: confere direto. */
export async function ipInternoDoHost(host: string, resolver: (h: string) => Promise<string[]> = resolverPeloDns): Promise<string | null> {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(h)) return ipPrivado(h) ? h : null;
  for (const ip of await resolver(h)) if (ipPrivado(ip)) return ip;
  return null;
}

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
  // Rede interna: vale para todo pedido, não só a navegação (uma <img> para 127.0.0.1 também).
  if (hostDeRedeInterna(new URL(p.url).hostname)) return { url: p.url.slice(0, 300), motivo: "rede_interna", metodo: p.metodo };
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

/**
 * Regras de DNS do próprio Chromium: nomes internos não resolvem nem se a checagem de rede falhar.
 * IP literal não passa pelo resolvedor do Chromium: quem barra é a regra de rede (regraDoPedido).
 */
export const REGRAS_DE_HOST_INTERNO = [
  "MAP localhost ~NOTFOUND",
  "MAP *.localhost ~NOTFOUND",
  "MAP *.local ~NOTFOUND",
  "MAP *.internal ~NOTFOUND",
  "MAP *.lan ~NOTFOUND",
  "MAP *.home.arpa ~NOTFOUND",
  "MAP metadata ~NOTFOUND",
].join(",");

export async function abrirNavegador(op: OpcoesDoNavegador): Promise<NavegadorDoAgente> {
  const resolver = op.resolver || resolverPeloDns;
  const args = ["--disable-extensions", "--disable-sync", "--no-first-run", "--disable-background-networking", "--disable-component-update"];
  args.push(`--host-resolver-rules=${op.regrasDeHost ? `${REGRAS_DE_HOST_INTERNO},${op.regrasDeHost}` : REGRAS_DE_HOST_INTERNO}`);
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
    // Nome público que aponta para IP interno (DNS de terceiro): conferido uma vez por host.
    const dnsInterno = new Map<string, Promise<string | null>>();
    const ipInterno = (host: string) => {
      const h = host.toLowerCase();
      if (!dnsInterno.has(h)) dnsInterno.set(h, ipInternoDoHost(h, resolver));
      return dnsInterno.get(h) as Promise<string | null>;
    };
    await contexto.route("**/*", async (rota) => {
      const pedido: Request = rota.request();
      const principal = pedido.isNavigationRequest() && pedido.frame() === pagina.mainFrame();
      let bloqueio = regraDoPedido({ url: pedido.url(), metodo: pedido.method(), navegacaoPrincipal: principal }, op.dominios);
      if (!bloqueio && /^https?:/i.test(pedido.url()) && (await ipInterno(new URL(pedido.url()).hostname))) {
        bloqueio = { url: pedido.url().slice(0, 300), motivo: "rede_interna", metodo: pedido.method() };
      }
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
        // O domínio da tarefa precisa cair na internet pública: resolve o DNS antes de abrir.
        const host = new URL(url).hostname;
        const interno = hostDeRedeInterna(host) ? host : await ipInterno(host);
        if (interno) {
          bloqueios.push({ url: url.slice(0, 300), motivo: "rede_interna", metodo: "GET" });
          throw new Error(`O endereço ${host} aponta para a rede interna (${interno}). O navegador do agente só abre site público.`);
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
