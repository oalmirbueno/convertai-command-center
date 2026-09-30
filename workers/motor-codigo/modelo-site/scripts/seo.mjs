// SEO de cada página (casca da casa, puro): o prerender usa e o painel testa.
// Nada é inventado aqui: título, descrição, endereço, imagem e schema vêm do pacote.

export const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** As páginas do mapa (pacote antigo: só a inicial). */
export function paginasDoPacote(pacote) {
  const lista = Array.isArray(pacote.paginas) && pacote.paginas.length ? pacote.paginas : [{ id: "inicio", slug: "", titulo: "Início" }];
  return lista.map((p) => ({ id: String(p.id || ""), slug: String(p.slug || ""), titulo: String(p.titulo || "") }));
}

function dadosDoSite(pacote) {
  const seo = pacote.seo || {};
  const copySeo = (pacote.copy && pacote.copy.seo) || {};
  const titulo = seo.titulo || copySeo.titulo || pacote.cliente || "Site";
  const descricao = seo.descricao || copySeo.descricao || (pacote.copy && pacote.copy.subtitulo) || "";
  const url = typeof seo.url === "string" && /^https:\/\//.test(seo.url) ? seo.url.replace(/\/$/, "") : null;
  const hero = (pacote.imagens || []).find((i) => i.slot === "hero");
  const og = seo.og_imagem || (hero ? hero.arquivo : pacote.logo || "");
  const ogAbsoluta = og && url && og.charAt(0) === "/" ? `${url}${og}` : og;
  const destaque = ((pacote.paleta || [])[0] || {}).hex || "#111111";
  return { seo, titulo, descricao, url, og: ogAbsoluta, destaque, indexar: seo.indexar !== false };
}

/**
 * A URL das fontes do Google que o painel montou (pacote.fontes_url), só de
 * fonts.googleapis.com/css2 e sempre com display=swap (texto aparece na hora,
 * regras de UX uupm:ux:50 e 75). Qualquer outra coisa: null.
 */
export function urlDasFontes(pacote) {
  const u = pacote && typeof pacote.fontes_url === "string" ? pacote.fontes_url.trim() : "";
  if (!/^https:\/\/fonts\.googleapis\.com\/css2\?family=[A-Za-z0-9+:;,@.&=%_-]+$/.test(u) || u.length > 2000) return null;
  return /[?&]display=swap(&|$)/.test(u) ? u : `${u.replace(/[?&]display=[a-z]+/g, "")}&display=swap`;
}

/** Os links das fontes para o <head> (preconnect e a folha de estilo), ou lista vazia. */
export function linksDasFontes(pacote) {
  const u = urlDasFontes(pacote);
  if (!u) return [];
  return [`<link rel="preconnect" href="https://fonts.googleapis.com" />`, `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`, `<link rel="stylesheet" href="${esc(u)}" data-fontes />`];
}

/** O HTML de uma página: a base do build com o conteúdo pré-renderizado e as tags de SEO. */
export function montarPagina(base, conteudo, pacote, pagina) {
  const d = dadosDoSite(pacote);
  const caminho = pagina.slug ? `/${pagina.slug}/` : "/";
  const titulo = pagina.slug && pagina.titulo ? `${pagina.titulo} | ${d.titulo}`.slice(0, 70) : d.titulo;
  const canonical = d.url ? `${d.url}${caminho}` : null;
  const extras = [
    // As fontes do pacote carregam de verdade no site publicado (antes ficavam só no CSS).
    ...linksDasFontes(pacote),
    canonical ? `<link rel="canonical" href="${esc(canonical)}" />` : "",
    canonical ? `<meta property="og:url" content="${esc(canonical)}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="pt_BR" />`,
    `<meta property="og:site_name" content="${esc(pacote.cliente || d.titulo)}" />`,
    `<meta name="twitter:card" content="${d.og ? "summary_large_image" : "summary"}" />`,
    d.indexar ? "" : `<meta name="robots" content="noindex, nofollow" />`,
    // O schema do negócio vai só na página inicial (é o mesmo negócio em todas).
    !pagina.slug && d.seo.schema ? `<script type="application/ld+json">${JSON.stringify(d.seo.schema).replace(/</g, "\\u003c")}</script>` : "",
  ].filter(Boolean);
  let html = base
    .replace("<!--app-->", conteudo)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(titulo)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${esc(d.descricao)}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(titulo)}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${esc(d.descricao)}"`)
    .replace(/(<meta property="og:image" content=")[^"]*"/, `$1${esc(d.og)}"`)
    .replace(/(<meta name="theme-color" content=")[^"]*"/, `$1${esc(d.destaque)}"`)
    .replace(/(<link rel="icon" href=")[^"]*"/, `$1${esc(pacote.logo || "/favicon.ico")}"`);
  if (extras.length) html = html.replace("</head>", `    ${extras.join("\n    ")}\n  </head>`);
  return html;
}

/** sitemap.xml das páginas (só com o domínio: o sitemap pede endereço absoluto). */
export function sitemapDoPacote(pacote, hoje) {
  const d = dadosDoSite(pacote);
  if (!d.url || !d.indexar) return null;
  const linhas = paginasDoPacote(pacote).map((p) => `  <url><loc>${esc(`${d.url}/${p.slug ? `${p.slug}/` : ""}`)}</loc><lastmod>${hoje}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${linhas.join("\n")}\n</urlset>\n`;
}
