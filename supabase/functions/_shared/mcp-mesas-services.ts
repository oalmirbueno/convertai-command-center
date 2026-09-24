/**
 * Leituras das mesas para o MCP: Mesa Ads e Mesa Foto.
 *
 * Quem vai rodar o tráfego (gente ou agente) precisa estudar o que foi
 * gerado ANTES de subir: a oferta, o porquê de cada ângulo, as notas do Jev,
 * o que foi descartado, a copy e a arte final. Estas duas leituras juntam
 * isso numa chamada, com URL assinada das imagens.
 *
 * Acesso: o MCP legado roda com a chave de serviço, então a fronteira do
 * cliente é conferida aqui (assertClientAccess) e no despachante (principal
 * restrito a cliente não alcança ferramenta fora da lista tenant-scoped).
 * Nada aqui escreve.
 */

import { db, isUuid, READ_LIMITS } from './aceleriq-read-services.ts';
import { assertClientAccess, type AuthContext } from './mcp-auth.ts';
import { exigirClienteExistente } from './mcp-client-id-guard.ts';
import {
  arteDoTrabalho,
  COMO_ESTUDAR_ADS,
  COMO_ESTUDAR_FOTO,
  criativoParaLer,
  faltaNoBanco,
  kitParaLer,
  ofertaParaLer,
  planoParaLer,
  tomadaParaLer,
  URL_ASSINADA_S,
  type ArteDoCriativo,
  type Linha,
} from './mcp-mesas-formato.ts';

type Resposta = { data: unknown; error: { code?: string; message: string } | null };

async function comPrazo(p: PromiseLike<unknown>, ms = READ_LIMITS.queryTimeoutMs): Promise<Resposta> {
  return await Promise.race([
    Promise.resolve(p) as Promise<Resposta>,
    new Promise<Resposta>((_, reject) => setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)),
  ]);
}

const linhas = (r: Resposta): Linha[] => (Array.isArray(r.data) ? (r.data as Linha[]) : []);

/** Assina vários caminhos de um bucket numa chamada; o que falhar volta sem URL. */
async function assinar(bucket: string, caminhos: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(caminhos.filter(Boolean))];
  const mapa = new Map<string, string>();
  if (!unicos.length) return mapa;
  for (let i = 0; i < unicos.length; i += 100) {
    const lote = unicos.slice(i, i + 100);
    try {
      const { data } = await db().storage.from(bucket).createSignedUrls(lote, URL_ASSINADA_S);
      for (const item of (data ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
        if (item.path && item.signedUrl) mapa.set(item.path, item.signedUrl);
      }
    } catch {
      // Imagem sem URL continua listada: o agente vê que existe e o caminho de volta ao painel.
    }
  }
  return mapa;
}

async function nomeDoCliente(clientId: string): Promise<string | null> {
  const r = await comPrazo(db().from('profiles').select('full_name, company_name').eq('id', clientId).maybeSingle());
  const p = (r.data ?? {}) as Linha;
  return (typeof p.company_name === 'string' && p.company_name.trim()) || (typeof p.full_name === 'string' && p.full_name.trim()) || null;
}

async function conferirCliente(clientId: string, ctx: AuthContext) {
  if (!isUuid(clientId)) throw new Error('client_id must be a UUID');
  assertClientAccess(ctx, clientId);
  await exigirClienteExistente(db(), clientId);
}

// ─── Mesa Ads ─────────────────────────────────────────────────

export async function mesaAdsContexto(
  input: { client_id: string; plano_id?: string; limite_planos?: number; limite_criativos?: number; incluir_urls?: boolean },
  ctx: AuthContext,
) {
  const clientId = input.client_id;
  await conferirCliente(clientId, ctx);
  const limitePlanos = Math.min(Math.max(input.limite_planos ?? 5, 1), 20);
  const limiteCriativos = Math.min(Math.max(input.limite_criativos ?? 30, 1), 80);
  const avisos: string[] = [];

  let planosQ = db()
    .from('ads_planos')
    .select('id, client_id, briefing_id, nome, status, angulos, estrutura, pedido, custo_usd, criado_em, atualizado_em')
    .eq('client_id', clientId)
    .order('criado_em', { ascending: false })
    .limit(limitePlanos);
  if (input.plano_id) planosQ = planosQ.eq('id', input.plano_id);

  let criativosQ = db()
    .from('ads_criativos')
    .select('id, client_id, plano_id, angulo_id, trabalho_id, nome, formato, copy, status, ad_id, evidencia, criado_em')
    .eq('client_id', clientId)
    .order('criado_em', { ascending: false })
    .limit(limiteCriativos);
  if (input.plano_id) criativosQ = criativosQ.eq('plano_id', input.plano_id);

  const [cliente, briefingR, ofertasR, planosR, criativosR, analisesR, aprendizadosR] = await Promise.all([
    nomeDoCliente(clientId),
    comPrazo(
      db()
        .from('ads_briefings')
        .select('id, versao, oferta, publico, objecoes, provas, destino, objetivo, restricoes, criado_em')
        .eq('client_id', clientId)
        .eq('atual', true)
        .order('versao', { ascending: false })
        .limit(1),
    ),
    comPrazo(
      db()
        .from('ads_ofertas')
        .select('id, nome, oferta, jev, status, criado_em')
        .eq('client_id', clientId)
        .neq('status', 'arquivada')
        .order('criado_em', { ascending: false })
        .limit(20),
    ),
    comPrazo(planosQ),
    comPrazo(criativosQ),
    comPrazo(
      db()
        .from('ads_analises')
        .select('id, periodo_inicio, periodo_fim, analise, criado_em')
        .eq('client_id', clientId)
        .order('criado_em', { ascending: false })
        .limit(3),
    ),
    comPrazo(
      db()
        .from('ads_aprendizados')
        .select('id, criativo_id, texto, evidencia, criado_em')
        .eq('client_id', clientId)
        .order('criado_em', { ascending: false })
        .limit(30),
    ),
  ]);

  // Tabelas da v2 (ofertas, análises) podem ainda não existir: vira aviso, não erro.
  const opcional = (r: Resposta, nome: string): Linha[] => {
    if (!r.error) return linhas(r);
    if (faltaNoBanco(r.error)) {
      avisos.push(`A tabela ${nome} ainda não existe no banco: essa parte volta vazia até a migration ser aplicada.`);
      return [];
    }
    avisos.push(`${nome}: ${r.error.message}`);
    return [];
  };
  if (briefingR.error) throw new Error(`ads_briefings: ${briefingR.error.message}`);
  if (planosR.error) throw new Error(`ads_planos: ${planosR.error.message}`);
  if (criativosR.error) throw new Error(`ads_criativos: ${criativosR.error.message}`);

  const planosBrutos = linhas(planosR);
  const criativosBrutos = linhas(criativosR);

  // Planos citados pelos criativos que ficaram fora do limite também explicam o porquê.
  const idsDosPlanos = new Set(planosBrutos.map((p) => String(p.id)));
  const faltando = [...new Set(criativosBrutos.map((c) => c.plano_id).filter((id): id is string => typeof id === 'string' && !idsDosPlanos.has(id)))];
  if (faltando.length) {
    const extra = await comPrazo(
      db()
        .from('ads_planos')
        .select('id, client_id, briefing_id, nome, status, angulos, estrutura, pedido, custo_usd, criado_em, atualizado_em')
        .eq('client_id', clientId)
        .in('id', faltando.slice(0, 20)),
    );
    if (!extra.error) planosBrutos.push(...linhas(extra));
  }

  const trabalhoIds = [...new Set(criativosBrutos.map((c) => c.trabalho_id).filter((id): id is string => typeof id === 'string'))];
  const trabalhosR = trabalhoIds.length
    ? await comPrazo(db().from('estudio_trabalhos').select('id, status, direcao, cards').eq('client_id', clientId).in('id', trabalhoIds))
    : { data: [], error: null };
  if (trabalhosR.error) avisos.push(`As artes do Estúdio não puderam ser lidas: ${trabalhosR.error.message}`);
  const trabalhos = new Map(linhas(trabalhosR).map((t) => [String(t.id), t]));

  const angulosPorPlano = new Map<string, Map<string, Linha>>();
  for (const p of planosBrutos) {
    const m = new Map<string, Linha>();
    for (const a of Array.isArray(p.angulos) ? (p.angulos as Linha[]) : []) {
      if (a && typeof a === 'object' && a.id) m.set(String(a.id), a);
    }
    angulosPorPlano.set(String(p.id), m);
  }

  const artes: ArteDoCriativo[] = [];
  const criativos = criativosBrutos.map((c) => {
    const angulo = c.plano_id && c.angulo_id ? angulosPorPlano.get(String(c.plano_id))?.get(String(c.angulo_id)) ?? null : null;
    const arte = arteDoTrabalho(c.trabalho_id ? trabalhos.get(String(c.trabalho_id)) : null);
    artes.push(arte);
    return criativoParaLer(c, angulo, arte);
  });

  if (input.incluir_urls !== false) {
    const porBucket = new Map<string, string[]>();
    for (const arte of artes) {
      for (const img of arte.imagens) {
        const l = porBucket.get(img.bucket) ?? [];
        l.push(img.caminho);
        porBucket.set(img.bucket, l);
      }
    }
    const assinadas = new Map<string, Map<string, string>>();
    for (const [bucket, caminhos] of porBucket) assinadas.set(bucket, await assinar(bucket, caminhos));
    criativos.forEach((c, i) => {
      const imagens = (c.arte as { imagens: Array<{ url: string | null }> }).imagens;
      artes[i].imagens.forEach((img, j) => {
        imagens[j].url = assinadas.get(img.bucket)?.get(img.caminho) ?? null;
      });
    });
  }

  const briefing = linhas(briefingR)[0] ?? null;
  const ofertas = opcional(ofertasR, 'ads_ofertas').map(ofertaParaLer);
  const planos = planosBrutos.map(planoParaLer);
  const semArte = criativos.filter((c) => (c.arte as { fonte: string }).fonte === 'sem_arte').length;
  const semPacote = criativos.filter((c) => !c.pacote_de_copy).length;
  if (!briefing) avisos.push('Este cliente não tem briefing de anúncios salvo na Mesa Ads: não há base confirmada para promessa, prova ou preço.');
  if (semArte) avisos.push(`${semArte} criativo(s) ainda sem arte no Estúdio.`);
  if (semPacote) avisos.push(`${semPacote} criativo(s) sem pacote de copy completo (só a copy principal).`);

  return {
    cliente: { id: clientId, nome: cliente },
    como_estudar: COMO_ESTUDAR_ADS,
    briefing,
    ofertas,
    oferta_escolhida: ofertas.find((o) => o.status === 'escolhida') ?? null,
    planos,
    criativos,
    analises_da_conta: opcional(analisesR, 'ads_analises'),
    aprendizados: opcional(aprendizadosR, 'ads_aprendizados'),
    urls_valem_segundos: input.incluir_urls === false ? null : URL_ASSINADA_S,
    totais: { planos: planos.length, criativos: criativos.length, ofertas: ofertas.length },
    avisos,
  };
}

// ─── Mesa Foto ────────────────────────────────────────────────

const AVISO_SEM_TABELA =
  'A Mesa Foto ainda não está no banco deste ambiente (tabelas foto_kits e foto_ensaios, e as colunas novas de cliente_imagens). A migration da Mesa Foto precisa ser aplicada; até lá esta leitura volta vazia.';

export async function mesaFotoContexto(
  input: { client_id: string; limite?: number; incluir_urls?: boolean },
  ctx: AuthContext,
) {
  const clientId = input.client_id;
  await conferirCliente(clientId, ctx);
  const limite = Math.min(Math.max(input.limite ?? 40, 1), 100);
  const avisos: string[] = [];
  const cliente = await nomeDoCliente(clientId);

  const [kitsR, ensaiosR, aprovadasR] = await Promise.all([
    comPrazo(db().from('foto_kits').select('*').eq('client_id', clientId).order('atualizado_em', { ascending: false }).limit(50)),
    comPrazo(db().from('foto_ensaios').select('*').eq('client_id', clientId).order('atualizado_em', { ascending: false }).limit(20)),
    comPrazo(
      db()
        .from('cliente_imagens')
        .select('id, nome, storage_bucket, storage_path, descricao, tags, modo, gerada, derivada_de, kit_id, largura, altura, aprovada, atualizado_em')
        .eq('client_id', clientId)
        .eq('aprovada', true)
        .eq('ativa', true)
        .order('atualizado_em', { ascending: false })
        .limit(limite),
    ),
  ]);

  const semTabela = [kitsR, ensaiosR, aprovadasR].some((r) => r.error && faltaNoBanco(r.error));
  if (semTabela) {
    return {
      cliente: { id: clientId, nome: cliente },
      disponivel: false,
      como_estudar: COMO_ESTUDAR_FOTO,
      kits: [],
      ensaios: [],
      fotos_aprovadas: [],
      avisos: [AVISO_SEM_TABELA],
    };
  }
  for (const [r, nome] of [[kitsR, 'foto_kits'], [ensaiosR, 'foto_ensaios'], [aprovadasR, 'cliente_imagens']] as const) {
    if (r.error) throw new Error(`${nome}: ${r.error.message}`);
  }

  const kitsBrutos = linhas(kitsR);
  const kitIds = kitsBrutos.map((k) => String(k.id));
  const refsR = kitIds.length
    ? await comPrazo(db().from('foto_kit_refs').select('kit_id, imagem_id, papel, vista, prioridade').in('kit_id', kitIds).order('prioridade', { ascending: true }).limit(500))
    : { data: [], error: null };
  if (refsR.error) avisos.push(faltaNoBanco(refsR.error) ? 'A tabela foto_kit_refs ainda não existe: os kits voltam sem as fotos de referência.' : `foto_kit_refs: ${refsR.error.message}`);
  const refs = linhas(refsR);

  // Fotos das referências dos kits (identidade primeiro), para o agente ver o produto real.
  const idsDasRefs = [...new Set(refs.map((r) => String(r.imagem_id)).filter(Boolean))].slice(0, 200);
  const imagensDasRefsR = idsDasRefs.length
    ? await comPrazo(db().from('cliente_imagens').select('id, nome, storage_bucket, storage_path').eq('client_id', clientId).in('id', idsDasRefs))
    : { data: [], error: null };
  const imagensDasRefs = new Map(linhas(imagensDasRefsR).map((i) => [String(i.id), i]));

  const aprovadas = linhas(aprovadasR);
  const ensaiosBrutos = linhas(ensaiosR);
  const tomadasPorEnsaio = ensaiosBrutos.map((e) => (Array.isArray(e.tomadas) ? e.tomadas : []).map(tomadaParaLer));

  // Assinaturas por bucket numa passada só.
  const porBucket = new Map<string, string[]>();
  const pedir = (bucket: unknown, caminho: unknown) => {
    if (typeof caminho !== 'string' || !caminho) return;
    const b = typeof bucket === 'string' && bucket ? bucket : 'mesa';
    const l = porBucket.get(b) ?? [];
    l.push(caminho);
    porBucket.set(b, l);
  };
  const querUrls = input.incluir_urls !== false;
  if (querUrls) {
    aprovadas.forEach((i) => pedir(i.storage_bucket, i.storage_path));
    imagensDasRefs.forEach((i) => pedir(i.storage_bucket, i.storage_path));
    tomadasPorEnsaio.forEach((ts) => ts.forEach((t) => t.paraAssinar.forEach((v) => pedir('mesa', v.caminho))));
  }
  const assinadas = new Map<string, Map<string, string>>();
  for (const [bucket, caminhos] of porBucket) assinadas.set(bucket, await assinar(bucket, caminhos));
  const urlDe = (bucket: unknown, caminho: unknown) =>
    querUrls && typeof caminho === 'string'
      ? assinadas.get(typeof bucket === 'string' && bucket ? bucket : 'mesa')?.get(caminho) ?? null
      : null;

  const kits = kitsBrutos.map((k) =>
    kitParaLer(
      k,
      refs
        .filter((r) => String(r.kit_id) === String(k.id))
        .map((r) => {
          const img = imagensDasRefs.get(String(r.imagem_id));
          return {
            imagem_id: r.imagem_id ?? null,
            papel: r.papel ?? null,
            vista: r.vista ?? null,
            prioridade: r.prioridade ?? null,
            nome: img ? img.nome ?? null : null,
            url: img ? urlDe(img.storage_bucket, img.storage_path) : null,
          };
        }),
    )
  );

  const ensaios = ensaiosBrutos.map((e, i) => ({
    id: e.id ?? null,
    kit_id: e.kit_id ?? null,
    receita_id: e.receita_id ?? null,
    finalidade: e.finalidade ?? null,
    formatos: Array.isArray(e.formatos) ? e.formatos : [],
    status: e.status ?? null,
    custo_usd: e.custo_usd ?? null,
    atualizado_em: e.atualizado_em ?? e.criado_em ?? null,
    tomadas: tomadasPorEnsaio[i].map(({ tomada, paraAssinar }) => {
      const versoes = (tomada.versoes as Array<Linha & { url: string | null }>).map((v) => {
        const alvo = paraAssinar.find((p) => p.versao === v.versao);
        return { ...v, url: alvo ? urlDe('mesa', alvo.caminho) : null };
      });
      return { ...tomada, versoes };
    }),
  }));

  const fotos_aprovadas = aprovadas.map((i) => ({
    id: i.id ?? null,
    nome: i.nome ?? null,
    descricao: i.descricao ?? null,
    tags: Array.isArray(i.tags) ? i.tags : [],
    modo: i.modo ?? null,
    gerada: i.gerada === true,
    derivada_de: i.derivada_de ?? null,
    kit_id: i.kit_id ?? null,
    largura: i.largura ?? null,
    altura: i.altura ?? null,
    url: urlDe(i.storage_bucket, i.storage_path),
  }));

  if (!kits.length && !ensaios.length && !fotos_aprovadas.length) avisos.push('Nada na Mesa Foto deste cliente ainda: sem kits, ensaios ou fotos aprovadas.');

  return {
    cliente: { id: clientId, nome: cliente },
    disponivel: true,
    como_estudar: COMO_ESTUDAR_FOTO,
    kits,
    ensaios,
    fotos_aprovadas,
    urls_valem_segundos: querUrls ? URL_ASSINADA_S : null,
    totais: { kits: kits.length, ensaios: ensaios.length, fotos_aprovadas: fotos_aprovadas.length },
    avisos,
  };
}
