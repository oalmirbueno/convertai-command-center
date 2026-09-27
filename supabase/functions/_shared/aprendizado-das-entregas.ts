/**
 * Aprendizado com as entregas no banco (frente AP, 27/09/2026): guardar a
 * memória de cada entrega, ligar aos números reais uma vez por semana e ler
 * o bloco do que funcionou na hora de gerar.
 *
 * Sem Deno e sem import do supabase-js: o banco, a leitura por visão e a
 * gravação no cérebro chegam por parâmetro (o Estúdio passa os de verdade; o
 * Vitest, dublês). Nada aqui derruba quem chama: falha vira resultado com
 * `erro` e a entrega, a geração e o robô seguem.
 *
 * Onde mora: índice JSON por cliente no bucket mesa
 * (<cliente>/aprendizado/entregas.json) e o padrão no cérebro (agente_memoria,
 * área arte, categoria entrega). Sem tabela nova.
 */

import {
  aprendizadoDoDesempenho,
  type ArquivoDaLamina,
  blocoDoQueFuncionou,
  BUCKET_DO_APRENDIZADO,
  caminhoDoIndiceDasEntregas,
  comAprovacoes,
  comEntrega,
  type DescricaoVisual,
  descricaoEmTexto,
  type IndiceDasEntregas,
  indiceVazio,
  jaRegistrada,
  julgarEntregas,
  ligarEntregasAosPosts,
  linhaDaVariedadeDasEntregas,
  medirPosts,
  type MemoriaDaEntrega,
  memoriaDaEntrega,
  motivoDaEntrega,
  normalizarIndice,
  type PostComNumeros,
  type PublicacaoDaEntrega,
  REGRAS_DOS_NUMEROS,
  sugestoesParaOEstilo,
  type SugestaoDaEntrega,
  type TrabalhoParaMemoria,
} from "./aprendizado-continuo.ts";
import type { NovoAprendizado } from "./cerebro-do-cliente.ts";

// deno-lint-ignore no-explicit-any
export type BancoDoAprendizado = { from: (tabela: string) => any; storage: { from: (bucket: string) => any } };

export type GravacaoSimples = { gravada: boolean; situacao: string | null; id: string | null; reforcos: number | null; erro: string | null };
export type GravarNoCerebro = (novo: NovoAprendizado) => Promise<GravacaoSimples>;
export type LerVisaoDaEntrega = (capa: ArquivoDaLamina, miolo: ArquivoDaLamina) => Promise<DescricaoVisual | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Dias entre duas leituras dos números do mesmo cliente (o robô roda toda segunda). */
export const DIAS_ENTRE_LEITURAS = 6;
/** Reforço extra do padrão que ficou no topo do perfil ("reforço forte"). */
export const REFORCO_DO_TOPO = 2;

// ------------------------------------------------------------------ índice no bucket

export async function lerIndiceDasEntregas(db: BancoDoAprendizado, clientId: string): Promise<IndiceDasEntregas> {
  if (!UUID.test(clientId)) return indiceVazio();
  try {
    const { data, error } = await db.storage.from(BUCKET_DO_APRENDIZADO).download(caminhoDoIndiceDasEntregas(clientId));
    if (error || !data) return indiceVazio();
    const texto = typeof (data as Blob).text === "function" ? await (data as Blob).text() : String(data);
    return normalizarIndice(JSON.parse(texto));
  } catch {
    return indiceVazio();
  }
}

export async function gravarIndiceDasEntregas(db: BancoDoAprendizado, clientId: string, indice: IndiceDasEntregas): Promise<boolean> {
  if (!UUID.test(clientId)) return false;
  try {
    const { error } = await db.storage.from(BUCKET_DO_APRENDIZADO).upload(
      caminhoDoIndiceDasEntregas(clientId),
      new Blob([JSON.stringify(indice)], { type: "application/json" }),
      { upsert: true, contentType: "application/json" },
    );
    return !error;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ memória da entrega

export type ResultadoDoRegistro = {
  situacao: "registrada" | "ja_registrada" | "sem_versoes" | "falhou";
  memoria: MemoriaDaEntrega | null;
  leu_visao: boolean;
  cerebro: GravacaoSimples | null;
  erro?: string;
};

/**
 * Registra a memória da entrega UMA vez (id = trabalho:rodada): a leitura por
 * visão da capa e de uma lâmina do miolo (barata, cópia leve) e o padrão no
 * cérebro (área arte, categoria entrega, reforço quando se repete). Chamar de
 * novo com a mesma entrega não lê nem grava nada.
 */
export async function registrarMemoriaDaEntrega(
  db: BancoDoAprendizado,
  t: TrabalhoParaMemoria,
  deps: { gravarNoCerebro: GravarNoCerebro; lerVisao?: LerVisaoDaEntrega | null; titulo?: string | null; agora?: Date },
): Promise<ResultadoDoRegistro> {
  try {
    const agora = deps.agora ?? new Date();
    const m = memoriaDaEntrega(t, { agora, titulo: deps.titulo ?? null });
    if (!m) return { situacao: "sem_versoes", memoria: null, leu_visao: false, cerebro: null };
    const antes = await lerIndiceDasEntregas(db, t.client_id);
    if (jaRegistrada(antes, m.id)) return { situacao: "ja_registrada", memoria: antes.entregas.find((e) => e.id === m.id) || null, leu_visao: false, cerebro: null };
    let descricao: DescricaoVisual | null = null;
    if (deps.lerVisao && m.capa) {
      descricao = await deps.lerVisao(m.capa, m.miolo).catch(() => null);
    }
    const memoria: MemoriaDaEntrega = { ...m, descricao_visual: descricao };
    // Relê antes de gravar: outra entrega do mesmo cliente pode ter entrado agora.
    const atual = await lerIndiceDasEntregas(db, t.client_id);
    if (jaRegistrada(atual, memoria.id)) return { situacao: "ja_registrada", memoria, leu_visao: !!descricao, cerebro: null };
    await gravarIndiceDasEntregas(db, t.client_id, comEntrega(atual, memoria));
    const cerebro = await deps.gravarNoCerebro({
      client_id: t.client_id,
      area: "arte",
      categoria: "entrega",
      texto: memoria.padrao,
      motivo: motivoDaEntrega(memoria),
      evidencia: descricaoEmTexto(descricao) || null,
      fonte: "entrega",
      referencia_id: t.id,
      agente: "geral",
    }).catch((e) => ({ gravada: false, situacao: null, id: null, reforcos: null, erro: e instanceof Error ? e.message : "falha" }));
    return { situacao: "registrada", memoria, leu_visao: !!descricao, cerebro };
  } catch (e) {
    return { situacao: "falhou", memoria: null, leu_visao: false, cerebro: null, erro: e instanceof Error ? e.message : "falha ao registrar" };
  }
}

// ------------------------------------------------------------------ números reais (junto com o robô semanal)

export type ResultadoDosNumeros = {
  situacao: "sem_entregas" | "recente" | "poucos_posts" | "lido" | "falhou";
  julgadas: number;
  topo: number;
  fundo: number;
  erro?: string;
};

const linhas = (r: { data?: unknown } | null | undefined): Record<string, unknown>[] => (r && Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : []);

/**
 * Liga as entregas aos posts publicados e aos números reais. Sem IA, sem laço:
 * cada entrega é julgada uma vez; topo vira "padrão que funcionou" com reforço
 * forte, fundo vira "rendeu abaixo" (sinal fraco). Um cliente é lido no máximo
 * a cada 6 dias (forcar ignora).
 */
export async function aprenderComOsNumeros(
  db: BancoDoAprendizado,
  clientId: string,
  deps: { gravarNoCerebro: GravarNoCerebro; agora?: Date; forcar?: boolean },
): Promise<ResultadoDosNumeros> {
  const agora = deps.agora ?? new Date();
  try {
    let indice = await lerIndiceDasEntregas(db, clientId);
    if (!indice.entregas.length) return { situacao: "sem_entregas", julgadas: 0, topo: 0, fundo: 0 };
    if (!deps.forcar && indice.numeros_em && agora.getTime() - new Date(indice.numeros_em).getTime() < DIAS_ENTRE_LEITURAS * 86_400_000) {
      return { situacao: "recente", julgadas: 0, topo: 0, fundo: 0 };
    }
    const idsDosTrabalhos = Array.from(new Set(indice.entregas.map((e) => e.trabalho_id))).filter((id) => UUID.test(id)).slice(0, 100);
    const trabalhos = idsDosTrabalhos.length
      ? linhas(await db.from("estudio_trabalhos").select("id, post_id, entrega_status, entrega_rodada").eq("client_id", clientId).in("id", idsDosTrabalhos))
      : [];
    // O post da agenda nasce quando a arte é agendada: a entrega aprende o post_id aqui.
    const postDoTrabalho = new Map(trabalhos.map((t) => [String(t.id), typeof t.post_id === "string" ? t.post_id : null]));
    indice = comAprovacoes(
      { ...indice, entregas: indice.entregas.map((e) => (e.post_id || !postDoTrabalho.get(e.trabalho_id) ? e : { ...e, post_id: postDoTrabalho.get(e.trabalho_id) || null })) },
      trabalhos.map((t) => ({ id: String(t.id), entrega_status: (t.entrega_status as string | null) ?? null, entrega_rodada: (t.entrega_rodada as number | null) ?? null })),
    );
    const semNumero = indice.entregas.filter((e) => !e.desempenho);
    const postIds = Array.from(new Set(semNumero.map((e) => e.post_id).filter((x): x is string => !!x && UUID.test(x)))).slice(0, 100);
    const arquivoIds = Array.from(new Set(semNumero.map((e) => e.arquivo_id).filter((x): x is string => !!x && UUID.test(x)))).slice(0, 100);
    const colunas = "post_id, file_id, external_post_id, permalink, published_at, status";
    const [porPost, porArquivo, posts] = await Promise.all([
      postIds.length ? db.from("editorial_publications").select(colunas).eq("client_id", clientId).eq("status", "published").in("post_id", postIds) : Promise.resolve({ data: [] }),
      arquivoIds.length ? db.from("editorial_publications").select(colunas).eq("client_id", clientId).eq("status", "published").in("file_id", arquivoIds) : Promise.resolve({ data: [] }),
      db.from("social_post_metrics")
        .select("media_id, media_type, caption, permalink, posted_at, reach, saved, shares, comments_count, like_count")
        .eq("client_id", clientId)
        .gte("posted_at", new Date(agora.getTime() - REGRAS_DOS_NUMEROS.janela_dias * 86_400_000).toISOString())
        .order("posted_at", { ascending: false })
        .limit(300),
    ]);
    const medidos = medirPosts(linhas(posts) as unknown as PostComNumeros[], agora);
    if (medidos.length < REGRAS_DOS_NUMEROS.posts_para_julgar) {
      await gravarIndiceDasEntregas(db, clientId, { ...indice, numeros_em: agora.toISOString() });
      return { situacao: "poucos_posts", julgadas: 0, topo: 0, fundo: 0 };
    }
    const publicacoes = [...linhas(porPost), ...linhas(porArquivo)] as unknown as PublicacaoDaEntrega[];
    const ligados = ligarEntregasAosPosts(indice.entregas, publicacoes, medidos);
    const r = julgarEntregas(indice, ligados, agora);
    await gravarIndiceDasEntregas(db, clientId, r.indice);
    let topo = 0;
    let fundo = 0;
    for (const j of r.novos) {
      const e = r.indice.entregas.find((x) => x.id === j.id);
      const a = e ? aprendizadoDoDesempenho(e) : null;
      if (!e || !a) continue;
      const g = await deps.gravarNoCerebro({
        client_id: clientId,
        area: "arte",
        categoria: a.categoria,
        texto: a.texto,
        motivo: a.motivo,
        evidencia: a.evidencia,
        fonte: "desempenho",
        referencia_id: e.trabalho_id,
      }).catch(() => null);
      if (j.posicao === "topo") {
        topo++;
        // Reforço forte: o número real pesa mais que um pedido repetido.
        if (g && g.gravada && g.id && UUID.test(g.id)) {
          await Promise.resolve(db.from("agente_memoria").update({ reforcos: Math.max(1, g.reforcos || 1) + REFORCO_DO_TOPO, reforcado_em: agora.toISOString() }).eq("id", g.id).eq("client_id", clientId))
            .then(() => undefined, () => undefined);
        }
      } else if (j.posicao === "fundo") fundo++;
    }
    return { situacao: "lido", julgadas: r.novos.length, topo, fundo };
  } catch (e) {
    return { situacao: "falhou", julgadas: 0, topo: 0, fundo: 0, erro: e instanceof Error ? e.message : "falha" };
  }
}

/**
 * Rodada da semana (junto com o robô semanal do Instagram, sem cron novo):
 * os clientes com entrega nos últimos 200 dias, no máximo `limiteClientes`,
 * dentro do tempo. Quem foi lido há menos de 6 dias pula sozinho.
 */
export async function aprenderComOsNumerosDaSemana(
  db: BancoDoAprendizado,
  deps: { gravarNoCerebro: GravarNoCerebro; agora?: Date; tempoMs?: number; limiteClientes?: number },
): Promise<{ clientes: number; lidos: number; julgadas: number }> {
  const inicio = Date.now();
  const agora = deps.agora ?? new Date();
  const desde = new Date(agora.getTime() - REGRAS_DOS_NUMEROS.janela_dias * 86_400_000).toISOString();
  let clientes: string[] = [];
  try {
    const r = await db.from("estudio_trabalhos").select("client_id").eq("status", "entregue").gte("atualizado_em", desde).order("atualizado_em", { ascending: false }).limit(1000);
    clientes = Array.from(new Set(linhas(r).map((l) => String(l.client_id || "")).filter((c) => UUID.test(c)))).slice(0, deps.limiteClientes ?? 60);
  } catch {
    return { clientes: 0, lidos: 0, julgadas: 0 };
  }
  let lidos = 0;
  let julgadas = 0;
  for (const c of clientes) {
    if (Date.now() - inicio > (deps.tempoMs ?? 60_000)) break;
    const r = await aprenderComOsNumeros(db, c, { gravarNoCerebro: deps.gravarNoCerebro, agora });
    if (r.situacao === "lido" || r.situacao === "poucos_posts") lidos++;
    julgadas += r.julgadas;
  }
  return { clientes: clientes.length, lidos, julgadas };
}

// ------------------------------------------------------------------ leitura na geração e no estilo

/**
 * O bloco do que funcionou e, na capa, a linha da variedade, para a lâmina e
 * o diretor. Cliente sem entrega (ou leitura que falhou): os dois vazios.
 */
export async function blocosDasEntregas(
  db: BancoDoAprendizado,
  clientId: string,
  opcoes: { tipo?: "social" | "ads"; capa?: boolean } = {},
): Promise<{ bloco: string; variedade: string; entregas: number }> {
  try {
    const indice = await lerIndiceDasEntregas(db, clientId);
    if (!indice.entregas.length) return { bloco: "", variedade: "", entregas: 0 };
    return {
      bloco: blocoDoQueFuncionou(indice.entregas, { tipo: opcoes.tipo }),
      variedade: opcoes.capa ? linhaDaVariedadeDasEntregas(indice.entregas, opcoes.tipo) : "",
      entregas: indice.entregas.length,
    };
  } catch {
    return { bloco: "", variedade: "", entregas: 0 };
  }
}

/** Sugestões para o painel do Estilo ("sugeridas pelas entregas"). */
export async function sugestoesDasEntregas(db: BancoDoAprendizado, clientId: string, jaNoEstilo: string[] = []): Promise<SugestaoDaEntrega[]> {
  try {
    return sugestoesParaOEstilo((await lerIndiceDasEntregas(db, clientId)).entregas, jaNoEstilo);
  } catch {
    return [];
  }
}
