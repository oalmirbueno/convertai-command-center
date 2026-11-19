/**
 * O logo de quem mandou o e-mail (19/11/2026): GET ?d=empresa.com.br devolve o ícone do próprio site
 * (apple-touch-icon, depois favicon), com cache de 7 dias. É pública (verify_jwt = false): só recebe um
 * domínio e devolve uma imagem; nada da pessoa nem da caixa passa por aqui. E-mail pessoal (Gmail,
 * Hotmail...) não tem logo de empresa: responde 404 e a tela mostra as iniciais.
 */
const PESSOAIS = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|uol|bol|terra|ig|globo|r7|zoho|gmx|yandex|mail)\.(com|com\.br|net|me|ch)$/i;
const DOMINIO = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const IMAGEM = /^image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|svg\+xml|webp|gif)/i;

const cabecalhos = (tipo: string, dias = 7) => ({
  "Content-Type": tipo,
  "Cache-Control": `public, max-age=${dias * 86400}, immutable`,
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
});

async function buscar(url: string): Promise<Response | null> {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(4000), headers: { "User-Agent": "Mozilla/5.0 (Aceleriq correio)" } });
    const tipo = r.headers.get("content-type") || "";
    if (!r.ok || !IMAGEM.test(tipo)) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length < 100 || bytes.length > 300_000) return null;
    return new Response(bytes, { headers: cabecalhos(tipo.split(";")[0]) });
  } catch {
    return null;
  }
}

/** Do subdomínio de envio (mail.loja.com.br, email.news.loja.com) para o site (loja.com.br). */
export function dominioDoSite(d: string): string {
  const partes = d.toLowerCase().split(".");
  const br = /\.(com|net|org|gov|edu|art|blog|eco|ind|inf|med|adv|eng|tur|tv)\.br$/.test(d) || /\.co\.uk$/.test(d);
  const manter = br ? 3 : 2;
  return partes.slice(-manter).join(".");
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
    const d = (new URL(req.url).searchParams.get("d") || "").trim().toLowerCase();
    if (!DOMINIO.test(d) || d.length > 120) return new Response("", { status: 400 });
    const site = dominioDoSite(d);
    if (PESSOAIS.test(site)) return new Response("", { status: 404, headers: cabecalhos("text/plain", 30) });
    for (const url of [`https://${site}/apple-touch-icon.png`, `https://www.${site}/apple-touch-icon.png`, `https://${site}/favicon.ico`, `https://www.${site}/favicon.ico`, `https://icons.duckduckgo.com/ip3/${site}.ico`]) {
      const r = await buscar(url);
      if (r) return r;
    }
    return new Response("", { status: 404, headers: cabecalhos("text/plain", 3) });
  });
}
