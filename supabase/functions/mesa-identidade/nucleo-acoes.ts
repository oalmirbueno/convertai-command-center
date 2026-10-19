/**
 * mesa-identidade: o núcleo da marca (19/10/2026).
 *
 * - marca_ler_links { projeto_id, site?, instagram? } -> { projeto, leitura, avisos, custo_usd: 0 }
 *   Lê a página pública do site e do perfil do Instagram (sem login, com tempo
 *   limite, só http/https, nada de endereço interno) e guarda em dados.nucleo.web
 *   o título, a descrição, a cor do tema e os títulos da página. Sem link no
 *   pedido, usa os do cliente (identidade do Instagram conectado e a ficha
 *   comercial), só na marca principal (outra marca tem o site dela).
 *   Sem IA: custo zero. O núcleo (modulos/nucleo-da-marca.ts) junta isso ao
 *   que o projeto já decidiu e vai em toda geração.
 *
 * O que vem das páginas é dado, nunca instrução. Sem travessão.
 */

import { registrarFalha } from "../_shared/falha-registrada.ts";
import { type Chamador, dadosComParte, gravarProjeto, json, lerProjeto, limpo, servico } from "./comum.ts";
import { hostBloqueado, type LeituraDoLink, type LeituraWeb, lerHtml, normalizarInstagram, normalizarSite } from "./modulos/leitura-web.ts";

const TEMPO_LIMITE_MS = 7000;
const TETO_DO_HTML = 700_000;
const AGENTE_DO_NAVEGADOR = "Mozilla/5.0 (compatible; AceleriqBot/1.0; +https://aceleriq.com)";

/** Busca a página pública: segue até 3 redirecionamentos conferindo o endereço a cada passo. */
export async function buscarPagina(url: string, f: typeof fetch = fetch): Promise<{ html: string; url: string } | null> {
  let atual = url;
  for (let i = 0; i < 4; i++) {
    let u: URL;
    try {
      u = new URL(atual);
    } catch {
      return null;
    }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || hostBloqueado(u.hostname)) return null;
    const res = await f(u.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": AGENTE_DO_NAVEGADOR, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9" },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const proximo = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!proximo) return null;
      atual = new URL(proximo, u).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const tipo = res.headers.get("content-type") || "";
    if (tipo && !/html|xml|text\/plain/i.test(tipo)) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    // Lê no máximo TETO_DO_HTML bytes (página gigante não segura a função).
    const leitor = res.body ? res.body.getReader() : null;
    if (!leitor) return { html: await res.text(), url: u.toString() };
    const partes: Uint8Array[] = [];
    let total = 0;
    while (total < TETO_DO_HTML) {
      const { done, value } = await leitor.read();
      if (done || !value) break;
      partes.push(value);
      total += value.length;
    }
    await leitor.cancel().catch(() => {});
    const tudo = new Uint8Array(Math.min(total, TETO_DO_HTML));
    let pos = 0;
    for (const p of partes) {
      const cabe = Math.min(p.length, tudo.length - pos);
      if (cabe <= 0) break;
      tudo.set(p.subarray(0, cabe), pos);
      pos += cabe;
    }
    return { html: new TextDecoder("utf-8", { fatal: false }).decode(tudo), url: u.toString() };
  }
  return null;
}

/** Os links do cliente que o painel já conhece (Instagram conectado e ficha comercial). */
async function linksDoCliente(clientId: string): Promise<{ site: string | null; instagram: string | null; bio: string | null }> {
  const [identidade, ficha] = await Promise.all([
    servico().from("social_client_identity").select("username, website, biography").eq("client_id", clientId).order("captured_at", { ascending: false }).limit(1).maybeSingle().then((r) => (r.data as Record<string, unknown> | null) || null, () => null),
    servico().from("commercial_organizations").select("site, instagram").eq("client_id", clientId).is("archived_at", null).limit(1).maybeSingle().then((r) => (r.data as Record<string, unknown> | null) || null, () => null),
  ]);
  return {
    site: normalizarSite((identidade && identidade.website) || (ficha && ficha.site)),
    instagram: normalizarInstagram((identidade && identidade.username) || (ficha && ficha.instagram)),
    bio: identidade && typeof identidade.biography === "string" ? limpo(identidade.biography, 300) || null : null,
  };
}

async function lerUm(url: string | null, rotulo: string, avisos: string[]): Promise<LeituraDoLink | null> {
  if (!url) return null;
  try {
    const p = await buscarPagina(url);
    if (!p) {
      avisos.push(`${rotulo}: a página não abriu sem login (ou não é uma página pública).`);
      return null;
    }
    const l = lerHtml(p.html, p.url);
    if (!l.titulo && !l.descricao && !l.titulos.length) {
      avisos.push(`${rotulo}: a página abriu, mas não tem texto legível sem login.`);
      return null;
    }
    return l;
  } catch (e) {
    registrarFalha(`mesa-identidade: leitura do ${rotulo}`, e);
    avisos.push(`${rotulo}: não respondeu a tempo.`);
    return null;
  }
}

export async function marcaLerLinks(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const pedidoSite = normalizarSite(corpo.site);
  const pedidoInsta = normalizarInstagram(corpo.instagram);
  const avisos: string[] = [];
  if (corpo.site && !pedidoSite) avisos.push("O link do site não é um endereço público válido.");
  if (corpo.instagram && !pedidoInsta) avisos.push("O Instagram não é um @ ou link de perfil válido.");
  // Outra marca do cliente tem o site e o Instagram dela: sem link no pedido, não usa os do cliente.
  const doCliente = !p.marca_id ? await linksDoCliente(p.client_id).catch((e) => (registrarFalha("mesa-identidade: links do cliente", e), { site: null, instagram: null, bio: null })) : { site: null, instagram: null, bio: null };
  const site = pedidoSite || doCliente.site;
  const instagram = pedidoInsta || doCliente.instagram;
  if (!site && !instagram) {
    return json({ error: "sem_links", mensagem: "Sem site nem Instagram conhecidos: escreva o link ou o @ para ler." }, 400);
  }
  const [lidoSite, lidoInsta] = await Promise.all([lerUm(site, "Site", avisos), lerUm(instagram, "Instagram", avisos)]);
  const leitura: LeituraWeb = { site: lidoSite, instagram: lidoInsta, bio: doCliente.bio, lido_em: new Date().toISOString(), avisos };
  // Guarda os links pedidos mesmo quando a página não abriu (a tela mostra e dá para tentar de novo).
  const links = { site: site || null, instagram: instagram || null };
  // Relê antes de gravar (a equipe pode ter salvo o projeto enquanto as páginas respondiam).
  const fresco = await lerProjeto(ch, p.id);
  const projeto = await gravarProjeto(fresco, { dados: dadosComParte(fresco.dados, "nucleo", { web: leitura, links }) });
  return json({ projeto, leitura, avisos, custo_usd: 0 });
}
