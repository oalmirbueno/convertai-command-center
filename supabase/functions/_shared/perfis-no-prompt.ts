/**
 * Perfis do Instagram no prompt (17/10/2026, dono: "as referências que eu
 * colocar ele tem que ler, tanto pro contexto, tanto pro diretor de arte,
 * tanto pro calendário, perfis de referência ou de concorrência, para se
 * basear e organizar; nunca ser cego e buscar a fundo: conteúdo, estilo,
 * padrão; se o concorrente postou algo a gente se preparar, se antecipar,
 * seguir e até liderar"; "não repetir igual o arsenal, mas juntar detalhes
 * que foram usados em um estilo com outro, para diversificar sem sair do
 * gosto e das referências").
 *
 * Fonte: o que a perfis-instagram já guardou (cliente_perfis_instagram com o
 * resumo de padrão visual e editorial; cliente_perfis_posts com a leitura
 * visual, formato, pilar e o "fora da curva"). Nada é raspado aqui e nenhuma
 * IA roda: só leitura do banco. Perfis que a marca NÃO segue (diretrizes)
 * ficam fora; a outra marca só lê os perfis dela (linhaDaMarca).
 *
 * Quem lê: o agente do Mês (montarContexto, toda geração), o diretor de arte
 * do Estúdio (preparar) e o agente de Contexto (conversa). Nunca lança: sem
 * tabela, sem perfil ou com erro, devolve null e o pedido segue como antes.
 *
 * Sem travessão.
 */

import { linhaDaMarca } from "./heranca-da-marca.ts";
import { normalizarDiretrizes, perfilExcluido } from "./diretrizes-da-marca.ts";

// deno-lint-ignore no-explicit-any
type Banco = { from: (tabela: string) => any };
type MarcaLeve = { id: string; principal: boolean } | null;

const DIA_MS = 86_400_000;
/** Até quantos perfis de cada papel vão para o pedido. */
export const MAX_PERFIS_NO_PROMPT = 6;
/** Posts por perfil (os que mais funcionaram, recentes primeiro no empate). */
export const POSTS_POR_PERFIL = 3;
/** "Postou agora": a janela do concorrente para antecipar e responder. */
export const DIAS_DA_NOVIDADE = 7;

export type PostDoPerfil = {
  data: string | null;
  formato: string | null;
  formato_editorial: string | null;
  pilar: string | null;
  leitura: string | null;
  legenda: string | null;
  vezes_a_mediana: number | null;
  fora_da_curva: boolean;
  link: string | null;
};

export type PerfilNoPrompt = {
  handle: string;
  nome: string | null;
  papel: "referencia" | "concorrente";
  seguidores: number | null;
  resumo: { padrao_visual: string; padrao_editorial: string; o_que_funciona: string; o_que_evitar: string } | null;
  melhores: PostDoPerfil[];
  novidades: PostDoPerfil[];
};

const texto = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const numero = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

export function postDaLinha(l: Record<string, unknown>): PostDoPerfil {
  return {
    data: l.publicado_em ? String(l.publicado_em).slice(0, 10) : null,
    formato: texto(l.formato, 30) || null,
    formato_editorial: texto(l.formato_editorial, 60) || null,
    pilar: texto(l.pilar, 60) || null,
    leitura: texto(l.leitura, 260) || null,
    legenda: texto(l.legenda, 180) || null,
    vezes_a_mediana: numero(l.vezes_a_mediana),
    fora_da_curva: l.fora_da_curva === true,
    link: typeof l.permalink === "string" ? l.permalink : null,
  };
}

/**
 * Os posts de um perfil que vão para o pedido: os que mais funcionaram (fora
 * da curva e vezes a mediana; recente no empate) e, à parte, o que ele postou
 * nos últimos dias (para o concorrente: antecipar e responder).
 */
export function escolherPosts(posts: PostDoPerfil[], hoje: string, quantos = POSTS_POR_PERFIL): { melhores: PostDoPerfil[]; novidades: PostDoPerfil[] } {
  const corte = new Date(Date.parse(`${hoje}T12:00:00Z`) - DIAS_DA_NOVIDADE * DIA_MS).toISOString().slice(0, 10);
  const forca = (p: PostDoPerfil) => (p.fora_da_curva ? 100 : 0) + (p.vezes_a_mediana ?? 1);
  const melhores = posts.slice().sort((a, b) => forca(b) - forca(a) || String(b.data || "").localeCompare(String(a.data || ""))).slice(0, quantos);
  const novidades = posts.filter((p) => p.data && p.data >= corte).sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 3);
  return { melhores, novidades };
}

function resumoDoPerfil(bruto: unknown): PerfilNoPrompt["resumo"] {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  const resumo = { padrao_visual: texto(r.padrao_visual, 500), padrao_editorial: texto(r.padrao_editorial, 500), o_que_funciona: texto(r.o_que_funciona, 500), o_que_evitar: texto(r.o_que_evitar, 400) };
  return resumo.padrao_visual || resumo.padrao_editorial || resumo.o_que_funciona ? resumo : null;
}

/** Lê os perfis da marca aberta e os posts deles. Nunca lança: falha ou nada guardado = null. */
export async function lerPerfisParaOPrompt(db: Banco, clientId: string, marca: MarcaLeve, opcoes: { hoje?: string } = {}): Promise<PerfilNoPrompt[] | null> {
  try {
    const hoje = opcoes.hoje ?? new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const [perfisR, diretrizesR] = await Promise.all([
      db.from("cliente_perfis_instagram").select("id, handle, nome, papel, seguidores, resumo, marca_id").eq("client_id", clientId).is("arquivado_em", null).order("criado_em", { ascending: true }).limit(40),
      marca && !marca.principal
        ? db.from("cliente_marcas").select("contexto").eq("id", marca.id).maybeSingle()
        : db.from("cliente_kit_marca").select("contexto").eq("client_id", clientId).maybeSingle(),
    ]);
    if (perfisR.error) return null;
    const diretrizes = normalizarDiretrizes(((diretrizesR.data?.contexto ?? {}) as Record<string, unknown>).diretrizes);
    const linhas = ((perfisR.data ?? []) as Array<Record<string, unknown>>)
      .filter((p) => (p.papel === "referencia" || p.papel === "concorrente") && linhaDaMarca((p.marca_id as string | null) ?? null, marca))
      .filter((p) => !(p.papel === "referencia" && perfilExcluido(diretrizes, p.handle)));
    const escolhidos = [
      ...linhas.filter((p) => p.papel === "referencia").slice(0, MAX_PERFIS_NO_PROMPT),
      ...linhas.filter((p) => p.papel === "concorrente").slice(0, MAX_PERFIS_NO_PROMPT),
    ];
    if (!escolhidos.length) return null;
    const ha120 = new Date(Date.now() - 120 * DIA_MS).toISOString();
    const { data: posts, error } = await db
      .from("cliente_perfis_posts")
      .select("perfil_id, publicado_em, formato, formato_editorial, pilar, leitura, legenda, vezes_a_mediana, fora_da_curva, permalink")
      .eq("client_id", clientId)
      .in("perfil_id", escolhidos.map((p) => String(p.id)))
      .is("arquivado_em", null)
      .gte("publicado_em", ha120)
      .order("publicado_em", { ascending: false })
      .limit(400);
    const todos = error ? [] : ((posts ?? []) as Array<Record<string, unknown>>);
    return escolhidos.map((p) => {
      const { melhores, novidades } = escolherPosts(todos.filter((x) => x.perfil_id === p.id).map(postDaLinha), hoje);
      return {
        handle: texto(p.handle, 60).replace(/^@/, ""),
        nome: texto(p.nome, 80) || null,
        papel: p.papel === "concorrente" ? "concorrente" : "referencia",
        seguidores: numero(p.seguidores),
        resumo: resumoDoPerfil(p.resumo),
        melhores,
        novidades,
      } as PerfilNoPrompt;
    });
  } catch {
    return null;
  }
}

const postCurto = (p: PostDoPerfil, foco: FocoDosPerfis) => ({
  ...(p.data ? { data: p.data } : {}),
  ...(p.formato ? { formato: p.formato } : {}),
  ...(p.formato_editorial ? { formato_editorial: p.formato_editorial } : {}),
  ...(p.pilar && foco !== "arte" ? { pilar: p.pilar } : {}),
  ...(p.leitura ? { como_e_a_imagem: p.leitura } : {}),
  ...(p.legenda && foco !== "arte" ? { legenda: p.legenda } : {}),
  ...(p.vezes_a_mediana ? { desempenho: `${p.vezes_a_mediana.toFixed(1).replace(".", ",")}x a mediana do perfil` } : {}),
});

export type FocoDosPerfis = "conteudo" | "arte" | "contexto";

const COMO_USAR: Record<FocoDosPerfis, string> = {
  conteudo: `COMO USAR NO CONTEÚDO
- Referências são a BASE do gosto: pilares, formatos, ganchos e ritmo que funcionam nelas guiam as pautas, adaptados ao negócio e à oferta deste cliente.
- Concorrentes: leia o que postaram nos últimos ${DIAS_DA_NOVIDADE} dias ("postou_agora") e decida por pauta: ANTECIPAR (o assunto que eles vão puxar e ainda não puxaram), RESPONDER com ângulo melhor ou mais completo, OCUPAR o espaço que nenhum deles cobre, ou LIDERAR com um formato que funcionou neles e o cliente ainda não usa. Diga qual perfil e qual movimento no campo gancho_do_momento (quando existir): "Concorrente @perfil: antecipar" (ou responder, ocupar, liderar).
- MISTURE, nunca copie: junte o detalhe de um perfil com o de outro e com a base de conhecimento e o que o cliente já publicou (ex.: o formato de @a com o gancho de @b no pilar do cliente). Nunca o texto, o gancho literal nem a sequência de um post específico.`,
  arte: `COMO USAR NA ARTE
- Referências são o GOSTO visual: tratamento, tipografia, composição, ritmo do carrossel e formatos delas valem como direção, sempre dentro do kit da marca.
- MISTURE, nunca copie: combine um detalhe de uma referência (ex.: o recorte, o grid) com outro de outra (a textura, a escala do título) e com a base de conhecimento e as artes já feitas do cliente, para cada peça sair nova sem sair do gosto. Nunca o layout inteiro de um post específico.
- Concorrentes: o que funciona neles é sinal; diferencie a marca visualmente (outro tratamento, outra composição), nunca pareça cópia do concorrente.`,
  contexto: `COMO USAR NO CONTEXTO
- Referências mostram o gosto que a marca quer seguir; concorrentes mostram o mercado e o que está funcionando agora. Use para responder, montar o contexto e sugerir à equipe o que antecipar, responder, ocupar ou liderar, sempre citando o @ e o post.`,
};

/** O bloco dos perfis para o pedido (vazio sem perfil). `enxuto`: menos posts por perfil. */
export function blocoDosPerfis(perfis: PerfilNoPrompt[] | null | undefined, foco: FocoDosPerfis, opcoes: { enxuto?: boolean } = {}): string {
  if (!perfis || !perfis.length) return "";
  const n = opcoes.enxuto ? 2 : POSTS_POR_PERFIL;
  const umPerfil = (p: PerfilNoPrompt) => ({
    perfil: `@${p.handle}`,
    ...(p.nome ? { nome: p.nome } : {}),
    ...(p.seguidores ? { seguidores: p.seguidores } : {}),
    ...(p.resumo ? { padrao: foco === "arte" ? { visual: p.resumo.padrao_visual, evitar: p.resumo.o_que_evitar } : p.resumo } : {}),
    ...(p.melhores.length ? { posts_que_mais_funcionaram: p.melhores.slice(0, n).map((x) => postCurto(x, foco)) } : {}),
    ...(p.papel === "concorrente" && p.novidades.length && foco !== "arte" ? { postou_agora: p.novidades.map((x) => postCurto(x, foco)) } : {}),
  });
  const referencias = perfis.filter((p) => p.papel === "referencia" && (p.resumo || p.melhores.length));
  const concorrentes = perfis.filter((p) => p.papel === "concorrente" && (p.resumo || p.melhores.length || p.novidades.length));
  if (!referencias.length && !concorrentes.length) {
    return `PERFIS DO INSTAGRAM: ${perfis.map((p) => `@${p.handle} (${p.papel})`).join(", ")} estão cadastrados, mas ainda sem posts capturados nem resumo (capture em Contexto, Perfis do Instagram).`;
  }
  const dados = {
    ...(referencias.length ? { referencias: referencias.map(umPerfil) } : {}),
    ...(concorrentes.length ? { concorrentes: concorrentes.map(umPerfil) } : {}),
  };
  return `PERFIS DE REFERÊNCIA E CONCORRENTES DO INSTAGRAM (cadastrados pela equipe; posts reais com a leitura da imagem):\n${JSON.stringify(dados)}\n${COMO_USAR[foco]}`;
}
