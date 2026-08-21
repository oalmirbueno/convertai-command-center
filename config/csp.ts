import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/**
 * A Content-Security-Policy do painel, injetada SO NO BUILD.
 *
 * Por que nao fica no index.html: o servidor de desenvolvimento do Vite
 * injeta scripts inline proprios (o preambulo do React Refresh, o cliente de
 * HMR) que nenhum hash fixo cobre. Com a meta no HTML, a CSP bloqueava esses
 * scripts, o app nunca montava e o preview do Lovable ficava na tela de
 * "demorando para abrir" para sempre. No site publicado funcionava, o que
 * tornou o defeito invisivel por um dia inteiro.
 *
 * Por que os hashes sao calculados aqui e nao escritos a mao: o index.html
 * tem scripts inline (o truque do manifest /ciclo e a tela de carregamento),
 * e mudar uma virgula neles com o hash velho quebraria o PWA em producao em
 * silencio. Calcular na hora do build elimina a categoria inteira do erro.
 */

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

export function hashesDosScriptsInline(html: string): string[] {
  const hashes: string[] = [];
  for (const [, corpo] of html.matchAll(INLINE_SCRIPT)) {
    hashes.push(createHash("sha256").update(corpo).digest("base64"));
  }
  return hashes;
}

export function montarCsp(html: string): string {
  const scripts = ["'self'", ...hashesDosScriptsInline(html).map((h) => `'sha256-${h}'`)];
  return [
    "default-src 'self'",
    `script-src ${scripts.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function injetarCsp(html: string): string {
  if (html.includes('http-equiv="Content-Security-Policy"')) return html;
  const meta = `    <meta http-equiv="Content-Security-Policy" content="${montarCsp(html)}" />\n`;
  return html.replace("</head>", `${meta}  </head>`);
}

/** So no build; em desenvolvimento o HTML sai sem CSP, de proposito. */
export function pluginCsp(): Plugin {
  return {
    name: "aceleriq-csp",
    apply: "build",
    transformIndexHtml: {
      // 'post': depois de o Vite injetar os proprios <script src> e preloads,
      // para os hashes serem calculados sobre o HTML FINAL.
      order: "post",
      handler: (html) => injetarCsp(html),
    },
  };
}
