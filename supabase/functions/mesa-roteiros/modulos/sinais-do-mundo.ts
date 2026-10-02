/**
 * Sinais do mundo real para as "Ideias com o agente" (02/10/2026): o que
 * está em alta no Instagram por hashtag (Graph API, conta Business conectada
 * da agência ou do cliente), os posts fora da curva dos perfis de referência
 * e concorrentes já capturados, os posts do próprio cliente que mais
 * funcionaram e os roteiros que ele já tem. A busca na web não mora aqui: é
 * o próprio modelo com a busca ligada (chamarTexto com pesquisaWeb).
 *
 * Cada fonte é opcional: sem token, sem permissão, sem tabela ou fora do ar,
 * a fonte fica vazia com o motivo em uma frase, e as outras seguem. Nunca
 * lança. O token do Instagram nunca sai daqui (nem para o prompt, nem para
 * a tela, nem para o log).
 *
 * Sem import de Deno nem de npm (o banco e o fetch chegam por parâmetro):
 * o Vitest lê este arquivo. Sem travessão.
 */

import { hashtagsParaOlhar, MAX_HASHTAGS, POSTS_POR_HASHTAG, type PostDoSinal, postsQueFuncionaram, type SinaisDoMundo } from "./ideias-de-tema.ts";

// deno-lint-ignore no-explicit-any
type Banco = { from: (tabela: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export const GRAPH_DO_INSTAGRAM = "https://graph.facebook.com/v21.0";
const DIA_MS = 86_400_000;
/** Cache por isolado: a busca de hashtag tem limite de 30 hashtags por semana por conta. */
const CACHE_MS = 6 * 60 * 60 * 1000;
const cacheDeHashtag = new Map<string, { em: number; posts: PostDoSinal[] }>();

export type TokenDaConta = { igUserId: string; token: string; origem: "cliente" | "agencia" };

type MarcaLeve = { id: string; principal: boolean } | null;

const texto = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Tokens do Instagram (cliente primeiro, depois agência). Sem nenhum, o motivo em uma frase. */
export async function tokensDaConta(db: Banco, clientId: string): Promise<{ tokens: TokenDaConta[]; motivo: string | null }> {
  try {
    const { data, error } = await db.rpc("perfis_instagram_token", { _client_id: clientId });
    if (error) {
      const semFuncao = error.code === "PGRST202" || error.code === "42883";
      return { tokens: [], motivo: semFuncao ? "a leitura do token do Instagram ainda não está no banco." : "o token do Instagram não pôde ser lido agora." };
    }
    const linhas = (Array.isArray(data) ? data : []) as Array<{ ig_user_id?: string; access_token?: string; origem?: string }>;
    const tokens = linhas
      .filter((l) => l.ig_user_id && l.access_token)
      .map((l) => ({ igUserId: String(l.ig_user_id), token: String(l.access_token), origem: (l.origem === "cliente" ? "cliente" : "agencia") as "cliente" | "agencia" }));
    return { tokens, motivo: tokens.length ? null : "conecte o Instagram da agência (ou o do cliente) em Integrações para ver o que está em alta." };
  } catch {
    return { tokens: [], motivo: "o token do Instagram não pôde ser lido agora." };
  }
}

async function provaDoSegredo(token: string, segredo: string | null | undefined): Promise<string | null> {
  if (!segredo) return null;
  const cod = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", cod.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign("HMAC", chave, cod.encode(token)));
  return Array.from(assinatura).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class ErroDaHashtag extends Error {
  tipo: "token" | "permissao" | "limite" | "rede" | "vazia";
  constructor(tipo: ErroDaHashtag["tipo"], mensagem: string) {
    super(mensagem);
    this.tipo = tipo;
  }
}

/** Frase da tela para o erro da Graph API (o token nunca entra na frase). */
export function motivoDoErroDoInstagram(erro: { code?: unknown; error_subcode?: unknown } | null | undefined): ErroDaHashtag {
  const codigo = Number(erro && erro.code ? erro.code : 0);
  if (codigo === 190 || codigo === 102) return new ErroDaHashtag("token", "a conexão do Instagram venceu; reconecte a conta em Integrações.");
  if (codigo === 10 || codigo === 200 || codigo === 3) return new ErroDaHashtag("permissao", "a conta conectada não tem a permissão de busca por hashtag (Instagram Public Content Access).");
  if (codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613 || codigo === 24) return new ErroDaHashtag("limite", "o Instagram pediu uma pausa (limite de buscas de hashtag); tente mais tarde.");
  return new ErroDaHashtag("rede", "o Instagram recusou a busca por hashtag agora.");
}

async function pedirAoGraph(url: URL, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    const sinal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(12_000) : undefined;
    res = await fetchImpl(url.toString(), sinal ? { signal: sinal } : {});
  } catch {
    throw new ErroDaHashtag("rede", "o Instagram não respondeu a tempo.");
  }
  const corpo = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const erro = corpo && typeof corpo.error === "object" ? (corpo.error as { code?: unknown; error_subcode?: unknown }) : null;
  if (!res.ok || erro) throw motivoDoErroDoInstagram(erro);
  return corpo || {};
}

type MidiaDaHashtag = { id?: string; caption?: string; media_type?: string; comments_count?: number; like_count?: number; permalink?: string; timestamp?: string };

/** Posts em alta de uma hashtag (top_media), Reels primeiro, pelo engajamento. */
export function postsDaHashtag(midias: MidiaDaHashtag[]): PostDoSinal[] {
  const nota = (m: MidiaDaHashtag) => (Number(m.like_count) || 0) + 3 * (Number(m.comments_count) || 0);
  return midias
    .filter((m) => m && (m.caption || m.permalink))
    .sort((a, b) => Number(b.media_type === "VIDEO") - Number(a.media_type === "VIDEO") || nota(b) - nota(a))
    .slice(0, POSTS_POR_HASHTAG)
    .map((m) => ({
      legenda: texto(m.caption, 400),
      link: typeof m.permalink === "string" && /^https:\/\/(www\.)?instagram\.com\//.test(m.permalink) ? m.permalink : null,
      data: m.timestamp ? String(m.timestamp).slice(0, 10) : null,
      curtidas: numero(m.like_count),
      comentarios: numero(m.comments_count),
      tipo: m.media_type === "VIDEO" ? "reels" : m.media_type === "CAROUSEL_ALBUM" ? "carrossel" : m.media_type ? "foto" : null,
    }));
}

/** ig_hashtag_search + top_media com o token da conta (cache de 6 h por conta e hashtag). */
export async function buscarHashtag(conta: TokenDaConta, tag: string, opcoes: { fetchImpl?: typeof fetch; segredo?: string | null; agora?: number } = {}): Promise<PostDoSinal[]> {
  const agora = opcoes.agora ?? Date.now();
  const chave = `${conta.igUserId}:${tag}`;
  const guardado = cacheDeHashtag.get(chave);
  if (guardado && agora - guardado.em < CACHE_MS) return guardado.posts;
  const f = opcoes.fetchImpl ?? fetch;
  const prova = await provaDoSegredo(conta.token, opcoes.segredo);
  const busca = new URL(`${GRAPH_DO_INSTAGRAM}/ig_hashtag_search`);
  busca.searchParams.set("user_id", conta.igUserId);
  busca.searchParams.set("q", tag);
  busca.searchParams.set("access_token", conta.token);
  if (prova) busca.searchParams.set("appsecret_proof", prova);
  const achado = await pedirAoGraph(busca, f);
  const id = Array.isArray(achado.data) && achado.data[0] && typeof (achado.data[0] as { id?: unknown }).id === "string" ? String((achado.data[0] as { id: string }).id) : "";
  if (!id) throw new ErroDaHashtag("vazia", `a hashtag #${tag} não existe no Instagram.`);
  const topo = new URL(`${GRAPH_DO_INSTAGRAM}/${encodeURIComponent(id)}/top_media`);
  topo.searchParams.set("user_id", conta.igUserId);
  topo.searchParams.set("fields", "id,caption,media_type,comments_count,like_count,permalink,timestamp");
  topo.searchParams.set("limit", "20");
  topo.searchParams.set("access_token", conta.token);
  if (prova) topo.searchParams.set("appsecret_proof", prova);
  const midias = await pedirAoGraph(topo, f);
  const posts = postsDaHashtag(Array.isArray(midias.data) ? (midias.data as MidiaDaHashtag[]) : []);
  cacheDeHashtag.set(chave, { em: agora, posts });
  return posts;
}

/** Só para teste: esvazia o cache das hashtags. */
export function limparCacheDasHashtags() {
  cacheDeHashtag.clear();
}

const linhaDaMarca = (marcaId: string | null | undefined, marca: MarcaLeve) => !marca || (marca.principal ? !marcaId || marcaId === marca.id : !!marcaId && marcaId === marca.id);

/** Conteúdo da versão atual de um roteiro guardado (só o que as ideias precisam). */
function resumoDoRoteiro(l: Record<string, unknown>) {
  const versoes = Array.isArray(l.versoes) ? (l.versoes as Array<Record<string, unknown>>) : [];
  const atual = versoes.filter((v) => Number(v && v.numero) === Number(l.versao_atual))[0] || versoes[versoes.length - 1] || null;
  const c = (atual && typeof atual.conteudo === "object" && atual.conteudo ? atual.conteudo : {}) as Record<string, unknown>;
  const base = c.base && typeof c.base === "object" ? texto((c.base as { nome?: unknown }).nome, 80) : "";
  return {
    titulo: texto(l.titulo || c.titulo, 120),
    subtitulo: texto(c.subtitulo, 160),
    status: texto(l.status, 20),
    objetivo: texto(c.objetivo, 160),
    base: base || null,
    quando: l.atualizado_em ? String(l.atualizado_em).slice(0, 10) : null,
  };
}

/**
 * Lê todas as fontes em paralelo. `web` só diz se a busca vai ligada (quem
 * busca é o modelo). `contas`: as contas da marca aberta (null = todas do
 * cliente). Nunca lança: cada fonte devolve vazio com o motivo.
 */
export async function lerSinaisDoMundo(
  db: Banco,
  p: {
    clientId: string;
    marca: MarcaLeve;
    contas: string[] | null;
    mensagem: string;
    hashtags: unknown;
    web: { ligada: boolean; motivo: string | null };
    fetchImpl?: typeof fetch;
    segredo?: string | null;
    agora?: number;
  },
): Promise<SinaisDoMundo> {
  const agora = p.agora ?? Date.now();
  const ha180 = new Date(agora - 180 * DIA_MS).toISOString();

  const roteirosP = (async () => {
    try {
      const { data, error } = await db.from("roteiros").select("titulo, status, versoes, versao_atual, arquivado_em, atualizado_em").eq("client_id", p.clientId).order("atualizado_em", { ascending: false }).limit(30);
      if (error) return { lista: [], motivo: "os roteiros do cliente não foram lidos agora." };
      const lista = ((data as Array<Record<string, unknown>> | null) ?? []).map(resumoDoRoteiro).filter((r) => r.titulo);
      return { lista, motivo: lista.length ? null : "o cliente ainda não tem roteiro na mesa." };
    } catch {
      return { lista: [], motivo: "os roteiros do cliente não foram lidos agora." };
    }
  })();

  const publicadosP = (async () => {
    try {
      if (p.contas && !p.contas.length) return { posts: [] as PostDoSinal[], legendas: [] as string[], motivo: "esta marca não tem Instagram ligado." };
      let q = db.from("social_post_metrics").select("media_type, caption, permalink, posted_at, reach, saved, shares, comments_count, like_count, external_account_id").eq("client_id", p.clientId).gte("posted_at", ha180);
      if (p.contas) q = q.in("external_account_id", p.contas);
      const { data, error } = await q.order("posted_at", { ascending: false }).limit(200);
      if (error) return { posts: [], legendas: [], motivo: "os números do Instagram do cliente não foram lidos agora." };
      const linhas = (data as Array<Record<string, unknown>> | null) ?? [];
      const legendas = linhas.map((l) => String(l.caption || ""));
      const melhores = postsQueFuncionaram(linhas as Array<{ saved?: number | null; shares?: number | null; comments_count?: number | null; like_count?: number | null; reach?: number | null }>, 12) as Array<Record<string, unknown>>;
      const posts: PostDoSinal[] = melhores.map((l) => ({
        legenda: texto(l.caption, 400),
        link: typeof l.permalink === "string" ? l.permalink : null,
        data: l.posted_at ? String(l.posted_at).slice(0, 10) : null,
        curtidas: numero(l.like_count),
        comentarios: numero(l.comments_count),
        tipo: l.media_type ? String(l.media_type).toLowerCase() : null,
        destaque: `salvos ${numero(l.saved) ?? 0}, compartilhamentos ${numero(l.shares) ?? 0}, alcance ${numero(l.reach) ?? 0}`,
      }));
      return { posts, legendas, motivo: posts.length ? null : "sem posts com números nos últimos 6 meses (Instagram do cliente não conectado?)." };
    } catch {
      return { posts: [], legendas: [], motivo: "os números do Instagram do cliente não foram lidos agora." };
    }
  })();

  const referenciasP = (async () => {
    try {
      const { data, error } = await db.from("cliente_perfis_instagram").select("id, handle, papel, marca_id").eq("client_id", p.clientId).is("arquivado_em", null).limit(20);
      if (error) return { perfis: [], motivo: "os perfis de referência não foram lidos agora." };
      const perfis = ((data as Array<{ id: string; handle: string; papel: string; marca_id?: string | null }> | null) ?? []).filter((x) => linhaDaMarca(x.marca_id, p.marca));
      if (!perfis.length) return { perfis: [], motivo: "cadastre perfis de referência ou concorrentes no Contexto da Mesa." };
      const { data: posts, error: e2 } = await db
        .from("cliente_perfis_posts")
        .select("perfil_id, legenda, permalink, publicado_em, curtidas, comentarios, formato, fora_da_curva, vezes_a_mediana")
        .in("perfil_id", perfis.map((x) => x.id))
        .is("arquivado_em", null)
        .order("vezes_a_mediana", { ascending: false, nullsFirst: false })
        .limit(80);
      if (e2) return { perfis: [], motivo: "os posts dos perfis de referência não foram lidos agora." };
      const lista = perfis
        .map((x) => ({
          handle: x.handle,
          papel: x.papel,
          posts: ((posts as Array<Record<string, unknown>> | null) ?? [])
            .filter((q) => q.perfil_id === x.id && (q.legenda || q.permalink))
            .sort((a, b) => Number(!!b.fora_da_curva) - Number(!!a.fora_da_curva))
            .slice(0, 5)
            .map((q) => ({
              legenda: texto(q.legenda, 400),
              link: typeof q.permalink === "string" ? q.permalink : null,
              data: q.publicado_em ? String(q.publicado_em).slice(0, 10) : null,
              curtidas: numero(q.curtidas),
              comentarios: numero(q.comentarios),
              tipo: q.formato ? String(q.formato) : null,
              destaque: q.vezes_a_mediana ? `${Number(q.vezes_a_mediana).toFixed(1).replace(".", ",")}x a mediana` : null,
            })),
        }))
        .filter((x) => x.posts.length);
      return { perfis: lista, motivo: lista.length ? null : "os perfis de referência ainda não têm posts capturados." };
    } catch {
      return { perfis: [], motivo: "os perfis de referência não foram lidos agora." };
    }
  })();

  const publicados = await publicadosP;
  const instagramP = (async () => {
    const tags = hashtagsParaOlhar(p.mensagem, p.hashtags, publicados.legendas).slice(0, MAX_HASHTAGS);
    if (!tags.length) return { hashtags: [], motivo: "escreva uma #hashtag do nicho para eu olhar o que está em alta." };
    const { tokens, motivo } = await tokensDaConta(db, p.clientId);
    if (!tokens.length) return { hashtags: [], motivo };
    const conta = tokens[0];
    const hashtags: Array<{ tag: string; posts: PostDoSinal[] }> = [];
    let falha: string | null = null;
    for (const tag of tags) {
      try {
        const posts = await buscarHashtag(conta, tag, { fetchImpl: p.fetchImpl, segredo: p.segredo, agora });
        if (posts.length) hashtags.push({ tag, posts });
      } catch (e) {
        falha = e instanceof ErroDaHashtag ? e.message : "o Instagram recusou a busca por hashtag agora.";
        // Token vencido, sem permissão ou limite valem para todas: não insiste nas outras.
        if (e instanceof ErroDaHashtag && e.tipo !== "vazia" && e.tipo !== "rede") break;
      }
    }
    return { hashtags, motivo: hashtags.length ? null : falha || "as hashtags não devolveram posts agora." };
  })();

  const [roteiros, referencias, instagram] = await Promise.all([roteirosP, referenciasP, instagramP]);
  return {
    web: p.web,
    instagram,
    referencias,
    publicados: { posts: publicados.posts, motivo: publicados.motivo },
    roteiros,
  };
}
