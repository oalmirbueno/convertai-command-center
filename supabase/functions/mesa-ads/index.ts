/**
 * mesa-ads: o estrategista de criativos de anúncio da Mesa Ads
 * (docs/mesa-ads/SPEC.md).
 *
 * Ações (POST { acao, ... }, só equipe com acesso ao cliente):
 * - briefing_sugerir { client_id }: propõe o briefing de performance a partir
 *   do kit, do contexto consolidado, do dossiê e das métricas de ads. Não grava.
 * - briefing_salvar { client_id, briefing }: nova versão atual.
 * - referencia_ler { client_id, referencia_id }: o leitor preenche a ficha a
 *   partir da imagem (observado separado do inferido; nunca inventa métrica).
 * - referencias_importar_proprias { client_id }: anúncios do cliente com as
 *   métricas somadas; E3 só com gasto e resultado. Grátis.
 * - plano_gerar { client_id, briefing_id?, pedido?, quantidade_angulos? }: 3 a 6
 *   ângulos com hipótese no formato do dossiê; o Jev dá as notas.
 * - plano_conversar { plano_id, mensagem, anexos? }: ajusta o plano pela conversa.
 * - criativos_produzir { plano_id, angulo_ids[], formatos[] }: copy por ângulo,
 *   conferência de política pelo Jev, ads_criativos e estudio_trabalhos tipo
 *   'ads' já dirigido (direção montada em código).
 * - copy_variar { criativo_id, pedido?, quantidade? }: variações de texto.
 * - resultados_ler { client_id, periodo_inicio?, periodo_fim?, dias? }: métricas
 *   por criativo ligado e diagnóstico em código. Grátis.
 * - aprendizado_registrar { criativo_id, periodo_inicio, periodo_fim, texto? }:
 *   grava o aprendizado (E3; E4 quando confirma em nova janela).
 *
 * Regras: só dado real; toda leitura e escrita presa ao client_id; nenhuma
 * falha responde 200; toda ação que gasta devolve custo_usd e saldo_usd.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  carregarModelo,
  chamarTexto,
  cobrarJev,
  IaMotorErro,
  modeloPadrao,
  type Agente,
  type ImagemEntrada,
  type MensagemMotor,
  type ModeloIa,
  type Tarefa,
} from "../_shared/ia-motor.ts";
import { jevPerguntar, JevErro, notaScore, type PerguntaJev } from "../_shared/jev.ts";
import { direcaoDoRoteiro, resumoDaComposicao, type BlocoTexto, type CardDirecao, type LayoutLamina, type MarcaParaDirecao } from "../_shared/direcao-arte.ts";
import { lerContextoConsolidado, lerMarcaParaDirecao } from "../_shared/contexto-cliente.ts";
import {
  CONHECIMENTO_ESTRATEGISTA_ADS,
  CTAS_META,
  ESCALA_DE_EVIDENCIA,
  METODO_DA_REFERENCIA,
  NIVEIS_CLAREZA,
  NIVEIS_PROVA,
  NIVEIS_RELEVANCIA,
  NIVEIS_RISCO_POLITICA,
  POLITICAS_META,
  REGRAS_DE_HONESTIDADE,
  regrasDoCriativo,
  TAMANHO_DO_FORMATO,
  type FormatoAds,
} from "../_shared/conhecimento-ads.ts";
import {
  cortarNaPalavra,
  type Diaria,
  diagnosticar,
  direcaoDoResultado,
  evidenciaDaImportacao,
  evidenciaDoAprendizado,
  maiorEvidencia,
  type Metricas,
  semTravessao,
  somarMetricas,
} from "./calculos.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// O banco aceita a tarefa 'ads' e o agente 'estrategista_ads' (migration
// 20260924015930_mesa_ads); os tipos do motor ainda não listam, daí o cast.
const TAREFA = "ads" as Tarefa;
const AGENTE = "estrategista_ads" as Agente;
const AGENTE_LEITOR = "leitor" as Agente;
const REF_PLANO = "ads_plano";
const REF_CRIATIVO = "ads_criativo";
const REF_REFERENCIA = "ads_referencia";
const REF_CLIENTE = "cliente";

export const FORMATOS: FormatoAds[] = ["feed_4x5", "quadrado_1x1", "stories_9x16", "carrossel"];
const ESTAGIOS = ["inconsciente", "problema", "solucao", "produto", "mais_consciente"] as const;
const TIPOS_PROVA = ["depoimento", "numero", "caso", "certificacao", "demonstracao"] as const;
const TIPOS_DESTINO = ["whatsapp", "pagina", "formulario", "direct", "ligacao"] as const;
const ACOES_OBJETIVO = ["mensagens", "leads", "vendas", "trafego", "agendamento"] as const;
const ETAPAS_CARROSSEL = ["tensao", "explicacao", "demonstracao", "objecao", "proximo_passo"] as const;

const MAX_CRIATIVOS_POR_CHAMADA = 24;
const ANGULOS_EM_PARALELO = 3;
const MAX_ANEXOS = 6;
const MAX_BYTES_IMAGEM = 12 * 1024 * 1024;
/** Memória de agente: agente_memoria aceita 'estrategista_ads' desde a migration 20260924021731. */
const MEMORIA_ACEITA_ESTRATEGISTA_ADS = true;

// ------------------------------------------------------------------ tipos

type Chamador = { userId: string; token: string };

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public extra: Record<string, unknown> = {}) {
    super(mensagem);
  }
}

type NotasJev = { clareza: number | null; relevancia: number | null; prova: number | null; risco_politica: number | null; alerta_politica: boolean };

type Angulo = {
  id: string;
  nome: string;
  situacao: string;
  mecanismo: string;
  tecnica: string;
  referencia_ids: string[];
  prova: string;
  gancho_visual: string;
  gancho_verbal: string;
  hipotese: string;
  metrica: string;
  janela_dias: number;
  formatos: FormatoAds[];
  variacoes: number;
  estagio_consciencia: string | null;
  jev: NotasJev | null;
};

type Plano = {
  id: string;
  client_id: string;
  briefing_id: string | null;
  nome: string;
  status: string;
  angulos: Angulo[];
  estrutura: Record<string, unknown>;
  pedido: string | null;
  conversa_id: string | null;
  custo_usd: number | string;
};

type Briefing = {
  id: string;
  client_id: string;
  versao: number;
  oferta: Record<string, unknown>;
  publico: Record<string, unknown>;
  objecoes: unknown[];
  provas: unknown[];
  destino: Record<string, unknown>;
  objetivo: Record<string, unknown>;
  restricoes: string | null;
};

type Criativo = {
  id: string;
  client_id: string;
  plano_id: string | null;
  angulo_id: string | null;
  trabalho_id: string | null;
  nome: string | null;
  formato: FormatoAds;
  copy: Record<string, unknown>;
  status: string;
  ad_id: string | null;
  evidencia: string;
};

// ------------------------------------------------------------ utilidades

const texto = (v: unknown, max = 2000) => (typeof v === "string" ? semTravessao(v.trim()).slice(0, max) : "");
const textoOuNulo = (v: unknown, max = 2000) => texto(v, max) || null;
const numeroOuNulo = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const doEnum = <T extends string>(v: unknown, lista: readonly T[]): T | null => (lista as readonly string[]).includes(String(v)) ? (v as T) : null;
const arred6 = (v: number) => Math.round(v * 1e6) / 1e6;

function hojeSaoPaulo(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mimeDaImagem(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}

// ------------------------------------------------------------ esquemas JSON
// Saída estrita: todo campo obrigatório, sem campo extra; opcional vira null.

const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
const Snulo = (lista: readonly string[]) => ({ type: ["string", "null"], enum: [...lista, null] });
const obj = (props: Record<string, unknown>) => ({
  type: "object",
  properties: props,
  required: Object.keys(props),
  additionalProperties: false,
});
const lista = (items: unknown) => ({ type: "array", items });

const ESQUEMA_BRIEFING_CORPO = {
  oferta: obj({
    produto: S(["string", "null"]),
    promessa: S(["string", "null"]),
    condicao: S(["string", "null"]),
    preco_confirmado: S(["string", "null"]),
    garantia: S(["string", "null"]),
  }),
  publico: obj({
    quem: S(["string", "null"]),
    situacoes: lista(obj({ texto: S("string"), fonte: S("string") })),
    estagio_consciencia: Snulo(ESTAGIOS),
    motivacoes: lista(S("string")),
  }),
  objecoes: lista(obj({ texto: S("string"), resposta: S(["string", "null"]), fonte: S("string") })),
  provas: lista(obj({
    tipo: S("string", { enum: [...TIPOS_PROVA] }),
    texto: S("string"),
    fonte: S("string"),
    autorizado: S("boolean"),
    periodo: S(["string", "null"]),
  })),
  destino: obj({ tipo: Snulo(TIPOS_DESTINO), url: S(["string", "null"]), primeira_mensagem: S(["string", "null"]) }),
  objetivo: obj({
    acao: Snulo(ACOES_OBJETIVO),
    metrica_principal: S(["string", "null"]),
    custo_toleravel_brl: S(["number", "null"]),
    verba_diaria_brl: S(["number", "null"]),
  }),
  restricoes: S(["string", "null"]),
};

const ESQUEMA_SUGESTAO = {
  nome: "briefing_sugerido",
  schema: obj({
    ...ESQUEMA_BRIEFING_CORPO,
    lacunas: lista(S("string")),
    observacoes: S("string"),
  }),
};

const ESQUEMA_FICHA = {
  nome: "ficha_de_referencia",
  schema: obj({
    titulo: S(["string", "null"]),
    observado: S("string"),
    inferido: S("string"),
    tipo: Snulo(["anuncio", "organico", "portfolio", "demonstracao"]),
    plataforma: S(["string", "null"]),
    formato: S(["string", "null"]),
    situacao: S(["string", "null"]),
    motivacao: S(["string", "null"]),
    estagio: Snulo(ESTAGIOS),
    gancho_visual: S(["string", "null"]),
    gancho_verbal: S(["string", "null"]),
    texto_apoio: S(["string", "null"]),
    argumento: S(["string", "null"]),
    prova: S(["string", "null"]),
    limite_da_prova: S(["string", "null"]),
    objecao: S(["string", "null"]),
    cta: S(["string", "null"]),
    destino: S(["string", "null"]),
    mecanismo: S("string"),
    o_que_transportar: S(["string", "null"]),
    o_que_substituir: S(["string", "null"]),
    limites: S("string"),
    metricas_visiveis: S(["string", "null"]),
    tags: lista(S("string")),
  }),
};

const ESQUEMA_ANGULO = obj({
  id: S("string"),
  nome: S("string"),
  situacao: S("string"),
  mecanismo: S("string"),
  tecnica: S("string"),
  referencia_ids: lista(S("string")),
  prova: S("string"),
  gancho_visual: S("string"),
  gancho_verbal: S("string"),
  hipotese: S("string"),
  metrica: S("string"),
  janela_dias: S("integer"),
  formatos: lista(S("string", { enum: [...FORMATOS] })),
  variacoes: S("integer"),
  estagio_consciencia: Snulo(ESTAGIOS),
});

const ESQUEMA_ESTRUTURA = obj({
  conjuntos: lista(obj({ nome: S("string"), angulo_ids: lista(S("string")), verba_diaria_brl: S(["number", "null"]), observacao: S("string") })),
  verba_diaria_total_brl: S(["number", "null"]),
  janela_dias: S("integer"),
  observacoes: S("string"),
});

const ESQUEMA_PLANO = {
  nome: "plano_de_teste",
  schema: obj({
    nome: S("string"),
    resumo: S("string"),
    angulos: lista(ESQUEMA_ANGULO),
    estrutura: ESQUEMA_ESTRUTURA,
    lacunas: lista(S("string")),
  }),
};

const ESQUEMA_CONVERSA_PLANO = {
  nome: "ajuste_do_plano",
  schema: obj({
    resposta: S("string"),
    nome: S(["string", "null"]),
    angulos: { type: ["array", "null"], items: ESQUEMA_ANGULO },
    estrutura: { ...ESQUEMA_ESTRUTURA, type: ["object", "null"] },
  }),
};

const ESQUEMA_COPY_CAMPOS = {
  texto_principal: S("string"),
  texto_principal_longo: S("string"),
  titulo: S("string"),
  descricao: S(["string", "null"]),
  cta_meta: S("string", { enum: [...CTAS_META] }),
};

const ESQUEMA_COPIES = {
  nome: "copies_do_angulo",
  schema: obj({
    variacoes: lista(obj({
      variacao: S("integer"),
      ...ESQUEMA_COPY_CAMPOS,
      headline_arte: S("string"),
      apoio_arte: S(["string", "null"]),
      cta_arte: S("string"),
      gancho_visual: S("string"),
      carrossel: {
        type: ["array", "null"],
        items: obj({ etapa: S("string", { enum: [...ETAPAS_CARROSSEL] }), texto_exato: S("string"), ilustracao: S("string") }),
      },
    })),
  }),
};

const ESQUEMA_VARIAR = {
  nome: "variacoes_de_copy",
  schema: obj({ variacoes: lista(obj({ ...ESQUEMA_COPY_CAMPOS, o_que_mudou: S("string") })) }),
};

const ESQUEMA_APRENDIZADO = { nome: "aprendizado", schema: obj({ texto: S("string") }) };

// ------------------------------------------------------------ banco e acesso

function clienteServico(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cliente do banco com o JWT de quem chamou: can_access_client lê auth.uid(). */
function clienteDoChamador(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function identificar(req: Request, servico: SupabaseClient): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico.auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico.rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa a Mesa Ads.");
  return { userId, token };
}

/** Equipe com acesso ao cliente, conferido no banco com o JWT de quem chamou. */
async function exigirAcessoAoCliente(chamador: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await clienteDoChamador(chamador.token).rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

async function carregarPlano(servico: SupabaseClient, id: unknown): Promise<Plano> {
  const pid = String(id ?? "");
  if (!UUID.test(pid)) throw new ErroHttp(400, "plano_id_invalido", "plano_id precisa ser um UUID.");
  const { data, error } = await servico.from("ads_planos").select("*").eq("id", pid).maybeSingle();
  if (error) throw new ErroHttp(503, "plano_indisponivel", "Não foi possível ler o plano.");
  if (!data) throw new ErroHttp(404, "plano_inexistente", "Plano não encontrado.");
  const p = data as Plano;
  p.angulos = Array.isArray(p.angulos) ? p.angulos : [];
  p.estrutura = (p.estrutura ?? {}) as Record<string, unknown>;
  return p;
}

async function carregarCriativo(servico: SupabaseClient, id: unknown): Promise<Criativo> {
  const cid = String(id ?? "");
  if (!UUID.test(cid)) throw new ErroHttp(400, "criativo_id_invalido", "criativo_id precisa ser um UUID.");
  const { data, error } = await servico.from("ads_criativos").select("*").eq("id", cid).maybeSingle();
  if (error) throw new ErroHttp(503, "criativo_indisponivel", "Não foi possível ler o criativo.");
  if (!data) throw new ErroHttp(404, "criativo_inexistente", "Criativo não encontrado.");
  const c = data as Criativo;
  c.copy = (c.copy ?? {}) as Record<string, unknown>;
  return c;
}

/** Briefing pelo id (do mesmo cliente) ou o atual. */
async function carregarBriefing(servico: SupabaseClient, clientId: string, id?: unknown): Promise<Briefing | null> {
  let q = servico.from("ads_briefings").select("*").eq("client_id", clientId);
  if (id != null && id !== "") {
    if (!UUID.test(String(id))) throw new ErroHttp(400, "briefing_id_invalido", "briefing_id precisa ser um UUID.");
    q = q.eq("id", String(id));
  } else {
    q = q.eq("atual", true);
  }
  const { data, error } = await q.order("versao", { ascending: false }).limit(1);
  if (error) throw new ErroHttp(503, "briefing_indisponivel", "Não foi possível ler o briefing.");
  const b = ((data as Briefing[] | null) ?? [])[0] ?? null;
  if (!b && id != null && id !== "") throw new ErroHttp(404, "briefing_inexistente", "Briefing não encontrado para este cliente.");
  return b;
}

async function salvarPlano(servico: SupabaseClient, p: Plano, campos: Record<string, unknown>): Promise<Plano> {
  const { data, error } = await servico.from("ads_planos").update(campos).eq("id", p.id).eq("client_id", p.client_id).select("*").single();
  if (error || !data) throw new ErroHttp(503, "plano_nao_salvo", "Não foi possível salvar o plano.");
  return data as Plano;
}

/** Soma custo no plano com trava otimista (duas chamadas ao mesmo tempo não se perdem). */
async function somarCustoDoPlano(servico: SupabaseClient, id: string | null, clientId: string, valor: number): Promise<number | null> {
  if (!id || !(valor > 0)) return null;
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const { data } = await servico.from("ads_planos").select("custo_usd").eq("id", id).eq("client_id", clientId).maybeSingle();
    if (!data) return null;
    const bruto = (data as { custo_usd: number | string }).custo_usd;
    const novo = arred6((Number(bruto) || 0) + valor);
    const { data: feito } = await servico.from("ads_planos").update({ custo_usd: novo })
      .eq("id", id).eq("client_id", clientId).eq("custo_usd", bruto).select("id").maybeSingle();
    if (feito) return novo;
  }
  console.error("[mesa-ads] custo do plano nao somado", { plano_id: id, valor });
  return null;
}

async function abrirConversa(servico: SupabaseClient, clientId: string, planoId: string, userId: string): Promise<string> {
  const { data, error } = await servico
    .from("agente_conversas")
    .insert({ client_id: clientId, agente: AGENTE, referencia_tipo: REF_PLANO, referencia_id: planoId, criado_por: userId })
    .select("id")
    .single();
  if (error || !data) throw new ErroHttp(503, "conversa_nao_criada", "Não foi possível abrir a conversa do estrategista de ads.");
  return (data as { id: string }).id;
}

async function registrarMensagens(
  servico: SupabaseClient,
  conversaId: string,
  clientId: string,
  msgs: Array<{ papel: "usuario" | "agente" | "sistema"; conteudo: string; uso_id?: string | null; anexos?: unknown[] }>,
) {
  const base = Date.now();
  const linhas = msgs
    .filter((m) => m.conteudo.trim())
    .map((m, i) => ({
      conversa_id: conversaId,
      client_id: clientId,
      // criado_em crescente: a ordem da conversa não depende do relógio do banco.
      criado_em: new Date(base + i).toISOString(),
      papel: m.papel,
      conteudo: m.conteudo.slice(0, 20000),
      anexos: m.anexos ?? [],
      uso_id: m.uso_id || null,
    }));
  if (!linhas.length) return;
  const { error } = await servico.from("agente_mensagens").insert(linhas);
  if (error) console.error("[mesa-ads] mensagens nao gravadas", { conversa_id: conversaId, code: error.code });
}

/** Imagens anexadas (bucket mesa, só caminho do próprio cliente). */
async function baixarAnexos(servico: SupabaseClient, clientId: string, bruto: unknown): Promise<{ imagens: ImagemEntrada[]; caminhos: string[] }> {
  const caminhos = (Array.isArray(bruto) ? bruto : [])
    .map((c) => String(c ?? ""))
    .filter((c) => c.startsWith(`${clientId}/`) && c.indexOf("..") < 0)
    .slice(0, MAX_ANEXOS);
  const imagens: ImagemEntrada[] = [];
  const validos: string[] = [];
  for (const c of caminhos) {
    const { data, error } = await servico.storage.from("mesa").download(c);
    if (error || !data) continue;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const mime = mimeDaImagem(bytes);
    if (!mime || bytes.byteLength > MAX_BYTES_IMAGEM) continue;
    imagens.push({ bytes, mime, nome: `anexo-${imagens.length + 1}.${mime.split("/")[1]}` });
    validos.push(c);
  }
  return { imagens, caminhos: validos };
}

// ------------------------------------------------------------ métricas de ads

const COLUNAS_DIARIA = "ad_id, day, spend, impressions, reach, clicks, link_clicks, frequency, actions";

/** Linhas diárias do cliente (paginadas), opcionalmente por anúncio e período. */
async function lerDiarias(
  servico: SupabaseClient,
  clientId: string,
  opcoes: { adIds?: string[]; desde?: string | null; ate?: string | null } = {},
): Promise<Diaria[]> {
  const filtrarNoCodigo = !!opcoes.adIds && opcoes.adIds.length > 100;
  if (opcoes.adIds && opcoes.adIds.length === 0) return [];
  const saida: Diaria[] = [];
  for (let pagina = 0; pagina < 30; pagina++) {
    let q = servico.from("ads_creative_daily").select(COLUNAS_DIARIA).eq("client_id", clientId);
    if (opcoes.adIds && !filtrarNoCodigo) q = q.in("ad_id", opcoes.adIds);
    if (opcoes.desde) q = q.gte("day", opcoes.desde);
    if (opcoes.ate) q = q.lte("day", opcoes.ate);
    const { data, error } = await q.order("day").order("ad_id").range(pagina * 1000, pagina * 1000 + 999);
    if (error) throw new ErroHttp(503, "metricas_indisponiveis", "Não foi possível ler as métricas dos anúncios.");
    const linhas = (data as Diaria[] | null) ?? [];
    saida.push(...linhas);
    if (linhas.length < 1000) break;
  }
  if (!filtrarNoCodigo) return saida;
  const ids = new Set(opcoes.adIds);
  return saida.filter((l) => ids.has(l.ad_id));
}

function porAnuncio(linhas: Diaria[]): Map<string, Diaria[]> {
  const mapa = new Map<string, Diaria[]>();
  for (const l of linhas) {
    const lista = mapa.get(l.ad_id) ?? [];
    lista.push(l);
    mapa.set(l.ad_id, lista);
  }
  return mapa;
}

type AnuncioMeta = {
  ad_id: string;
  ad_name: string | null;
  titulo: string | null;
  corpo: string | null;
  destino: string | null;
  effective_status: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  video_id: string | null;
};

async function lerAnunciosDoCliente(servico: SupabaseClient, clientId: string): Promise<AnuncioMeta[]> {
  const { data, error } = await servico
    .from("ads_creatives")
    .select("ad_id, ad_name, titulo, corpo, destino, effective_status, image_url, thumbnail_url, video_id")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new ErroHttp(503, "anuncios_indisponiveis", "Não foi possível ler os anúncios do cliente.");
  const vistos = new Set<string>();
  return ((data as AnuncioMeta[] | null) ?? []).filter((a) => a.ad_id && !vistos.has(a.ad_id) && vistos.add(a.ad_id));
}

// ------------------------------------------------------------ contexto real

type ContextoAds = {
  cliente: string;
  marca: Awaited<ReturnType<typeof lerMarcaParaDirecao>>;
  dados: Record<string, unknown>;
};

/**
 * Contexto do estrategista de ads só com dado real: kit, contexto consolidado,
 * dossiê atual, métricas de ads dos últimos 90 dias, aprendizados registrados
 * e memória. O que não existe vai vazio ou null, nunca preenchido.
 */
async function montarContextoAds(servico: SupabaseClient, clientId: string): Promise<ContextoAds> {
  const desde = somarDias(hojeSaoPaulo(), -90);
  const [marca, consolidado, dossie, anuncios, diarias, aprendizados, memoria] = await Promise.all([
    lerMarcaParaDirecao(servico, clientId),
    lerContextoConsolidado(servico, clientId),
    servico.from("client_dossiers").select("content, summary, version, effective_at")
      .eq("client_id", clientId).eq("dossier_type", "contexto").eq("is_current", true)
      .order("effective_at", { ascending: false }).limit(1),
    lerAnunciosDoCliente(servico, clientId),
    lerDiarias(servico, clientId, { desde }),
    servico.from("ads_aprendizados").select("texto, evidencia, periodo_inicio, periodo_fim, criado_em")
      .eq("client_id", clientId).order("criado_em", { ascending: false }).limit(20),
    servico.from("agente_memoria").select("tipo, texto").eq("client_id", clientId).eq("agente", AGENTE).eq("ativa", true)
      .order("criado_em", { ascending: false }).limit(40),
  ]);
  const d = ((dossie.data as { content: string; summary: string | null; version: number; effective_at: string }[] | null) ?? [])[0];
  const mapa = porAnuncio(diarias);
  const resumoAnuncios = anuncios
    .map((a) => ({ a, m: somarMetricas(mapa.get(a.ad_id) ?? []) }))
    .filter((x) => x.m.impressoes > 0)
    .sort((x, y) => y.m.gasto - x.m.gasto)
    .slice(0, 15)
    .map(({ a, m }) => ({
      ad_id: a.ad_id,
      nome: a.ad_name,
      titulo: a.titulo,
      texto: a.corpo ? a.corpo.slice(0, 300) : null,
      destino: a.destino,
      status: a.effective_status,
      gasto: m.gasto,
      impressoes: m.impressoes,
      ctr_saida_pct: m.ctr_saida_pct,
      cpm: m.cpm,
      resultados: m.resultados_por_tipo,
      custo_por_resultado: m.custo_por_resultado,
      frequencia_media: m.frequencia_media,
    }));
  return {
    cliente: marca.nomeCliente,
    marca,
    dados: {
      cliente: marca.nomeCliente,
      contexto_consolidado: consolidado,
      kit_de_marca: { estilo: marca.estilo, regras: marca.regras, tom_de_voz: marca.tomDeVoz },
      dossie_atual: d ? `Versão ${d.version} (${String(d.effective_at).slice(0, 10)}):\n${(d.summary ? `${d.summary}\n` : "") + String(d.content ?? "").slice(0, 12000)}` : null,
      anuncios_ultimos_90_dias: { total_lidos: anuncios.length, com_entrega: resumoAnuncios },
      aprendizados_registrados: aprendizados.data ?? [],
      memoria_do_estrategista_ads: memoria.data ?? [],
    },
  };
}

const REGRAS_DA_EXECUCAO = `REGRAS DESTA EXECUÇÃO NO PAINEL:
- Use somente os dados reais recebidos. Campo vazio ou null significa que o dado não existe: vira lacuna declarada, nunca suposição apresentada como fato.
- Nunca invente depoimento, número, resultado, prazo, preço, desconto, escassez, urgência ou disponibilidade. Prova só a que está no briefing, com a fonte.
- Respeite a política de anúncios da Meta e o destino real do briefing.
- Português do Brasil, sem travessões.
- Responda somente com o JSON pedido.`;

/** Sistema do estrategista de ads: conhecimento inteiro (com as regras de honestidade) mais as regras da execução. */
function sistemaDoEstrategista(): string {
  return `${CONHECIMENTO_ESTRATEGISTA_ADS}\n\n${REGRAS_DA_EXECUCAO}`;
}

const SISTEMA_DO_LEITOR = [
  "Você é o leitor de referências de anúncio da agência Aceleriq. Recebe a imagem ou o print de um anúncio (ou peça) e preenche a ficha de referência criativa.",
  REGRAS_DE_HONESTIDADE,
  METODO_DA_REFERENCIA,
  ESCALA_DE_EVIDENCIA,
  `REGRAS DA LEITURA:
- observado: só o que se vê ou se lê na imagem (textos transcritos, elementos, cores, pessoas, produto).
- inferido: o que você interpreta (situação, motivação, estágio, objetivo aparente), sempre marcado como interpretação.
- Nunca invente métrica, resultado, gasto, data ou autoria. metricas_visiveis só quando o número aparece na própria imagem, e diga que é o que a imagem mostra, não resultado comprovado.
- mecanismo descrito sem citar a marca ("objeto comum em condição impossível para representar urgência").
- Campo que a imagem não permite preencher fica null.
- tags curtas pela taxonomia: motivação (clareza, confiança, conveniência, controle, economia, qualidade, pertencimento, desejo), mecanismo (demonstração, comparação, metáfora, personificação, objeção, curiosidade, narrativa, prova, contraste) e formato (estático, carrossel, vídeo com pessoa, tela, produto, entrevista, animação).
- Português do Brasil, sem travessões. Responda só com o JSON pedido.`,
].join("\n\n");

// ------------------------------------------------------------ modelo e erros

async function resolverModelo(
  modeloId: unknown,
  raciocinio: unknown,
  papel: "estrategista" | "leitura",
  preferido = "medium",
): Promise<{ modelo: ModeloIa; raciocinio: string | undefined }> {
  let modelo: ModeloIa | null;
  if (typeof modeloId === "string" && modeloId.trim()) modelo = await carregarModelo(modeloId.trim(), "texto");
  else modelo = await modeloPadrao(papel);
  if (!modelo) {
    throw new ErroHttp(409, "sem_modelo_padrao", papel === "leitura"
      ? "Nenhum modelo do catálogo está marcado como padrão de leitura."
      : "Nenhum modelo do catálogo está marcado como padrão do estrategista.");
  }
  const aceitos = modelo.raciocinio ?? [];
  const explicito = typeof raciocinio === "string" && raciocinio.trim() ? raciocinio.trim() : null;
  const r = explicito ?? (aceitos.includes(preferido) ? preferido : aceitos[aceitos.length - 1]);
  return { modelo, raciocinio: r || undefined };
}

// Mensagens claras para os erros de dinheiro e chave. Nunca 200.
const MENSAGEM_ERRO_MOTOR: Record<string, { status: number; mensagem: string }> = {
  saldo_insuficiente: { status: 402, mensagem: "Saldo insuficiente na carteira de IA deste cliente. Peça a recarga a um admin ou manager." },
  cota_da_chave_esgotada: { status: 402, mensagem: "A cota do mês da chave de IA deste cliente acabou. Ajuste a cota ou aguarde o próximo mês." },
  cliente_sem_chave: { status: 403, mensagem: "Este cliente não tem chave de IA própria e o uso da chave da agência está desligado para ele." },
  provedor_sem_chave: { status: 403, mensagem: "O provedor deste modelo está sem chave de API configurada. Escolha outro modelo ou peça a configuração da chave." },
};

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof IaMotorErro) {
    const conhecido = MENSAGEM_ERRO_MOTOR[err.codigo];
    const status = conhecido?.status ?? (err.status >= 400 ? err.status : 500);
    return json({ ...err.paraJson(), mensagem: conhecido?.mensagem ?? err.message }, status);
  }
  console.error("[mesa-ads] erro inesperado", { nome: err instanceof Error ? err.name : "desconhecido" });
  return json({ error: "erro_interno", mensagem: "Falha inesperada na Mesa Ads." }, 500);
}

// ------------------------------------------------------------ Jev

/** Nota do Score (0 a niveis-1) em 0 a 10 com uma casa. */
const notaDe0a10 = (n: number | null, niveis: number) => (n == null ? null : Math.round((n / (niveis - 1)) * 100) / 10);
/** Abaixo do nível "risco moderado" (2 de 0 a 4) a peça vai com alerta de política. */
const alertaDePolitica = (bruta: number | null) => bruta != null && bruta < 2;

function resumoDoBriefing(b: Briefing | null) {
  if (!b) return null;
  return { oferta: b.oferta, publico: b.publico, objecoes: b.objecoes, provas: b.provas, destino: b.destino, objetivo: b.objetivo, restricoes: b.restricoes };
}

/**
 * O Jev pontua cada ângulo em quatro dimensões (Score de níveis ordenados):
 * clareza, relevância, força da prova e risco de política (10 = sem risco).
 * Só pontua os ângulos sem nota. Falha do Jev não derruba o plano: nota null.
 */
async function pontuarAngulosComJev(
  angulos: Angulo[],
  briefing: Briefing | null,
  cobranca: { clientId: string; planoId: string; criadoPor: string },
): Promise<{ angulos: Angulo[]; jev_erro: string | null; custo: number }> {
  const alvo = angulos.map((a, i) => ({ a, i })).filter((x) => !x.a.jev);
  if (!alvo.length) return { angulos, jev_erro: null, custo: 0 };
  const state = {
    oferta: briefing?.oferta ?? "não informada",
    publico: briefing?.publico ?? "não informado",
    provas_disponiveis: briefing?.provas ?? [],
    destino: briefing?.destino ?? "não informado",
    politicas: POLITICAS_META,
    angulos: alvo.map(({ a }) => ({ nome: a.nome, situacao: a.situacao, mecanismo: a.mecanismo, prova: a.prova, gancho_visual: a.gancho_visual, gancho_verbal: a.gancho_verbal, hipotese: a.hipotese })),
  };
  const questions: Record<string, PerguntaJev> = {};
  alvo.forEach((_, k) => {
    questions[`clareza_${k}`] = {
      type: "score",
      instructions: `Num anúncio visto no celular, quão clara fica a oferta do ângulo \`angulos[${k}]\` (gancho verbal, gancho visual e prova) para o \`publico\`, considerando a \`oferta\` e o \`destino\`?`,
      criteria: NIVEIS_CLAREZA,
    };
    questions[`relevancia_${k}`] = {
      type: "score",
      instructions: `Quanto a situação e o gancho do ângulo \`angulos[${k}]\` conversam com o \`publico\` (quem é, situações vividas, motivações e estágio de consciência)?`,
      criteria: NIVEIS_RELEVANCIA,
    };
    questions[`prova_${k}`] = {
      type: "score",
      instructions: `Quão forte é a prova do ângulo \`angulos[${k}]\`, considerando SOMENTE as \`provas_disponiveis\`? Prova citada que não está em \`provas_disponiveis\` conta como ausente.`,
      criteria: NIVEIS_PROVA,
    };
    questions[`risco_${k}`] = {
      type: "score",
      instructions: `Pelas \`politicas\` de anúncio da Meta, qual o risco de reprovação do ângulo \`angulos[${k}]\` (texto, gancho visual e promessa)?`,
      criteria: NIVEIS_RISCO_POLITICA,
    };
  });
  try {
    const r = await jevPerguntar({ state, questions });
    const cobrado = await cobrarJev(r, { clientId: cobranca.clientId, tarefa: TAREFA, referencia: { tipo: REF_PLANO, id: cobranca.planoId }, criadoPor: cobranca.criadoPor });
    const saida = [...angulos];
    alvo.forEach(({ a, i }, k) => {
      const risco = notaScore(r.answers[`risco_${k}`]);
      saida[i] = {
        ...a,
        jev: {
          clareza: notaDe0a10(notaScore(r.answers[`clareza_${k}`]), NIVEIS_CLAREZA.length),
          relevancia: notaDe0a10(notaScore(r.answers[`relevancia_${k}`]), NIVEIS_RELEVANCIA.length),
          prova: notaDe0a10(notaScore(r.answers[`prova_${k}`]), NIVEIS_PROVA.length),
          risco_politica: notaDe0a10(risco, NIVEIS_RISCO_POLITICA.length),
          alerta_politica: alertaDePolitica(risco),
        },
      };
    });
    return { angulos: saida, jev_erro: null, custo: cobrado?.custoUsd ?? 0 };
  } catch (err) {
    const codigo = err instanceof JevErro ? err.codigo : "jev_falhou";
    console.error("[mesa-ads] jev falhou", { codigo });
    return { angulos, jev_erro: codigo, custo: 0 };
  }
}

type NotasCopy = { risco_politica: number | null; clareza: number | null; alerta_politica: boolean };

/** O Jev confere cada copy: risco de política (10 = sem risco) e clareza da oferta. */
async function conferirCopiesComJev(
  copies: Array<{ texto_principal: string; titulo: string; descricao: string | null; cta_meta: string; texto_na_arte?: string }>,
  briefing: Briefing | null,
  cobranca: { clientId: string; referencia: { tipo: string; id: string }; criadoPor: string },
): Promise<{ notas: (NotasCopy | null)[]; jev_erro: string | null; custo: number }> {
  if (!copies.length) return { notas: [], jev_erro: null, custo: 0 };
  const state = {
    oferta: briefing?.oferta ?? "não informada",
    destino: briefing?.destino ?? "não informado",
    provas_disponiveis: briefing?.provas ?? [],
    politicas: POLITICAS_META,
    copies,
  };
  const questions: Record<string, PerguntaJev> = {};
  copies.forEach((_, i) => {
    questions[`risco_${i}`] = {
      type: "score",
      instructions: `Pelas \`politicas\` de anúncio da Meta, qual o risco de reprovação do anúncio \`copies[${i}]\` (texto principal, título, descrição, CTA e texto na arte)? Número, resultado ou depoimento que não está em \`provas_disponiveis\` conta como alegação não comprovada.`,
      criteria: NIVEIS_RISCO_POLITICA,
    };
    questions[`clareza_${i}`] = {
      type: "score",
      instructions: `Quão clara fica a oferta do anúncio \`copies[${i}]\` para quem lê no celular, considerando a \`oferta\` e o \`destino\`?`,
      criteria: NIVEIS_CLAREZA,
    };
  });
  try {
    const r = await jevPerguntar({ state, questions });
    const cobrado = await cobrarJev(r, { clientId: cobranca.clientId, tarefa: TAREFA, referencia: cobranca.referencia, criadoPor: cobranca.criadoPor });
    return {
      notas: copies.map((_, i) => {
        const risco = notaScore(r.answers[`risco_${i}`]);
        return {
          risco_politica: notaDe0a10(risco, NIVEIS_RISCO_POLITICA.length),
          clareza: notaDe0a10(notaScore(r.answers[`clareza_${i}`]), NIVEIS_CLAREZA.length),
          alerta_politica: alertaDePolitica(risco),
        };
      }),
      jev_erro: null,
      custo: cobrado?.custoUsd ?? 0,
    };
  } catch (err) {
    const codigo = err instanceof JevErro ? err.codigo : "jev_falhou";
    console.error("[mesa-ads] jev da copy falhou", { codigo });
    return { notas: copies.map(() => null), jev_erro: codigo, custo: 0 };
  }
}

// ------------------------------------------------------------ normalização

function normalizarBriefing(b: Record<string, unknown>) {
  const o = (b.oferta ?? {}) as Record<string, unknown>;
  const p = (b.publico ?? {}) as Record<string, unknown>;
  const d = (b.destino ?? {}) as Record<string, unknown>;
  const ob = (b.objetivo ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  return {
    oferta: {
      produto: textoOuNulo(o.produto, 600),
      promessa: textoOuNulo(o.promessa, 800),
      condicao: textoOuNulo(o.condicao, 600),
      preco_confirmado: textoOuNulo(o.preco_confirmado, 200),
      garantia: textoOuNulo(o.garantia, 400),
    },
    publico: {
      quem: textoOuNulo(p.quem, 800),
      situacoes: arr(p.situacoes).map((s) => ({ texto: texto(s?.texto, 600), fonte: texto(s?.fonte, 300) })).filter((s) => s.texto).slice(0, 20),
      estagio_consciencia: doEnum(p.estagio_consciencia, ESTAGIOS),
      motivacoes: (Array.isArray(p.motivacoes) ? p.motivacoes : []).map((m) => texto(m, 200)).filter(Boolean).slice(0, 12),
    },
    objecoes: arr(b.objecoes).map((x) => ({ texto: texto(x?.texto, 600), resposta: textoOuNulo(x?.resposta, 800), fonte: texto(x?.fonte, 300) })).filter((x) => x.texto).slice(0, 20),
    provas: arr(b.provas).map((x) => ({
      tipo: doEnum(x?.tipo, TIPOS_PROVA) ?? "caso",
      texto: texto(x?.texto, 800),
      fonte: texto(x?.fonte, 300),
      // Depoimento e rosto só com autorização registrada: sem a marca explícita, fica false.
      autorizado: x?.autorizado === true,
      periodo: textoOuNulo(x?.periodo, 120),
    })).filter((x) => x.texto).slice(0, 20),
    destino: {
      tipo: doEnum(d.tipo, TIPOS_DESTINO),
      url: textoOuNulo(d.url, 600),
      primeira_mensagem: textoOuNulo(d.primeira_mensagem, 600),
    },
    objetivo: {
      acao: doEnum(ob.acao, ACOES_OBJETIVO),
      metrica_principal: textoOuNulo(ob.metrica_principal, 200),
      custo_toleravel_brl: numeroOuNulo(ob.custo_toleravel_brl),
      verba_diaria_brl: numeroOuNulo(ob.verba_diaria_brl),
    },
    restricoes: textoOuNulo(b.restricoes, 3000),
  };
}

const assinaturaDoAngulo = (a: Pick<Angulo, "situacao" | "mecanismo" | "prova" | "gancho_visual" | "gancho_verbal" | "hipotese">) =>
  [a.situacao, a.mecanismo, a.prova, a.gancho_visual, a.gancho_verbal, a.hipotese].join("|");

function normalizarAngulo(bruto: unknown, id: string, refsValidas: Set<string>, anterior?: Angulo): Angulo {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const formatos = [...new Set((Array.isArray(o.formatos) ? o.formatos : []).map(String).filter((f) => (FORMATOS as string[]).includes(f)))] as FormatoAds[];
  const janela = Math.round(Number(o.janela_dias));
  const variacoes = Math.round(Number(o.variacoes));
  const a: Angulo = {
    id,
    nome: texto(o.nome, 120),
    situacao: texto(o.situacao, 800),
    mecanismo: texto(o.mecanismo, 400),
    tecnica: texto(o.tecnica, 200),
    referencia_ids: [...new Set((Array.isArray(o.referencia_ids) ? o.referencia_ids : []).map(String).filter((r) => refsValidas.has(r)))].slice(0, 6),
    prova: texto(o.prova, 600),
    gancho_visual: texto(o.gancho_visual, 600),
    gancho_verbal: texto(o.gancho_verbal, 300),
    hipotese: texto(o.hipotese, 1200),
    metrica: texto(o.metrica, 200),
    janela_dias: Number.isFinite(janela) ? Math.min(60, Math.max(3, janela)) : 7,
    formatos: formatos.length ? formatos : ["feed_4x5"],
    variacoes: Number.isFinite(variacoes) ? Math.min(3, Math.max(1, variacoes)) : 2,
    estagio_consciencia: doEnum(o.estagio_consciencia, ESTAGIOS),
    jev: null,
  };
  // Ângulo que não mudou de conteúdo mantém as notas do Jev.
  if (anterior && assinaturaDoAngulo(anterior) === assinaturaDoAngulo(a)) a.jev = anterior.jev;
  return a;
}

function normalizarEstrutura(bruto: unknown, idsValidos: Set<string>): Record<string, unknown> {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const janela = Math.round(Number(o.janela_dias));
  return {
    conjuntos: (Array.isArray(o.conjuntos) ? o.conjuntos : []).slice(0, 8).map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      return {
        nome: texto(x.nome, 120),
        angulo_ids: (Array.isArray(x.angulo_ids) ? x.angulo_ids : []).map(String).filter((i) => idsValidos.has(i)),
        verba_diaria_brl: numeroOuNulo(x.verba_diaria_brl),
        observacao: texto(x.observacao, 600),
      };
    }),
    verba_diaria_total_brl: numeroOuNulo(o.verba_diaria_total_brl),
    janela_dias: Number.isFinite(janela) ? Math.min(60, Math.max(3, janela)) : 7,
    observacoes: texto(o.observacoes, 1500),
  };
}

type CopyAnuncio = {
  texto_principal: string;
  texto_principal_longo: string;
  titulo: string;
  descricao: string | null;
  cta_meta: string;
  avisos: string[];
};

/** Limites da Meta aplicados em código: título até 40, texto principal visível em cerca de 125. */
function normalizarCopy(o: Record<string, unknown>): CopyAnuncio {
  const avisos: string[] = [];
  const principal = texto(o.texto_principal, 400);
  if (principal.length > 125) avisos.push(`Texto principal com ${principal.length} caracteres: só cerca de 125 aparecem antes do "ver mais".`);
  const tituloBruto = texto(o.titulo, 200);
  const titulo = cortarNaPalavra(tituloBruto, 40);
  if (titulo.length < tituloBruto.length) avisos.push("Título cortado em 40 caracteres.");
  const cta = (CTAS_META as readonly string[]).includes(String(o.cta_meta)) ? String(o.cta_meta) : "Saiba mais";
  return {
    texto_principal: cortarNaPalavra(principal, 150),
    texto_principal_longo: texto(o.texto_principal_longo, 2200) || principal,
    titulo,
    descricao: textoOuNulo(o.descricao, 120),
    cta_meta: cta,
    avisos,
  };
}

// ------------------------------------------------------------ direção do anúncio

/** Layout padrão ajustado ao anúncio: zona segura do formato e tratamento de performance. */
function layoutDoAnuncio(layout: LayoutLamina, formato: FormatoAds, funcao: string, ganchoVisual: string): LayoutLamina {
  const ajustado: LayoutLamina = { ...layout };
  if (ganchoVisual) ajustado.imagem = ganchoVisual;
  if (formato === "stories_9x16") {
    // Interface cobre os 14% de cima e os 20% de baixo: texto no miolo.
    ajustado.zona_texto = funcao === "cta" ? "centro" : "centro-esquerda";
    ajustado.ponto_focal = `${ajustado.ponto_focal}; nada importante nos 14% de cima nem nos 20% de baixo`;
  }
  ajustado.tratamento = `${ajustado.tratamento}; anúncio: contraste que para a rolagem, leitura em 1 segundo no celular, marca presente sem dominar, pouco texto na arte`;
  return ajustado;
}

type RoteiroCard = { funcao: string; etapa?: string; texto: string; ilustracao: string };

/**
 * Direção do criativo montada EM CÓDIGO, sem IA: o roteiro (capa ou
 * sequência do carrossel) passa pelo compositor da Mesa (direcaoDoRoteiro)
 * e cada card ganha o formato, o layout do anúncio e blocos com o CTA. O
 * prompt da lâmina fica vazio: o Estúdio recompõe pelo layout e pelo formato.
 */
function direcaoDoAnuncio(
  roteiro: RoteiroCard[],
  formato: FormatoAds,
  marca: MarcaParaDirecao,
  info: { conceito: string; fioVisual: string; ganchoVisual: string; ctaArte: string },
): Record<string, unknown> {
  const carrossel = formato === "carrossel";
  const formatoDoCard: Exclude<FormatoAds, "carrossel"> = carrossel ? "feed_4x5" : formato;
  const base = direcaoDoRoteiro(
    roteiro.map((c, i) => ({ ordem: i + 1, funcao: c.funcao, texto: c.texto, ilustracao: c.ilustracao })),
    marca,
    { postUnico: !carrossel, carrosselInfinito: false, conceito: info.conceito, levaLogo: (ordem, total) => ordem === 1 || ordem === total },
  );
  const cards = base.cards.map((c: CardDirecao, i) => {
    const r = roteiro[i];
    const funcao = carrossel ? c.funcao : "capa";
    const layout = layoutDoAnuncio(c.layout!, formatoDoCard, funcao, r?.ilustracao || info.ganchoVisual);
    const linhas = c.texto_exato.split("\n").map((l) => l.trim()).filter(Boolean);
    // Blocos em código: headline, apoio e o CTA escrito na peça (último da capa única ou do fechamento).
    const temCta = linhas.length > 1 && (carrossel ? funcao === "cta" : linhas[linhas.length - 1] === info.ctaArte);
    const blocos: BlocoTexto[] = linhas.map((l, k) => ({
      papel: k === 0 ? "headline" : temCta && k === linhas.length - 1 ? "cta" : k === 1 ? "subtitulo" : "apoio",
      texto: l,
    }));
    return {
      ...c,
      funcao,
      ...(r?.etapa ? { etapa: r.etapa } : {}),
      formato: formatoDoCard,
      blocos,
      layout,
      composicao: resumoDaComposicao(layout),
      ilustracao: layout.imagem,
      prompt_imagem: "",
    };
  });
  return {
    conceito: base.conceito,
    carrossel_infinito: false,
    origem: "roteiro",
    cards,
    fio_visual: info.fioVisual,
    tipo: "ads",
    formato,
    tamanho: TAMANHO_DO_FORMATO[formatoDoCard],
    regras_do_criativo: regrasDoCriativo(formato),
  };
}

/** Roteiro da peça: capa única (headline + apoio + CTA) ou 3 a 5 cards do carrossel (técnica 16). */
function roteiroDaVariacao(v: Record<string, unknown>, formato: FormatoAds, ganchoVisual: string): RoteiroCard[] {
  const headline = cortarNaPalavra(texto(v.headline_arte, 120), 60);
  const apoio = texto(v.apoio_arte, 160);
  const cta = texto(v.cta_arte, 60);
  const capaTexto = [headline, apoio, cta].filter(Boolean).slice(0, 3).join("\n");
  if (formato !== "carrossel") return [{ funcao: "capa", texto: capaTexto, ilustracao: ganchoVisual }];
  const brutos = (Array.isArray(v.carrossel) ? v.carrossel : []) as Record<string, unknown>[];
  let cards: RoteiroCard[] = brutos
    .map((c) => ({ funcao: "", etapa: doEnum(c.etapa, ETAPAS_CARROSSEL) ?? "explicacao", texto: texto(c.texto_exato, 400), ilustracao: texto(c.ilustracao, 500) || ganchoVisual }))
    .filter((c) => c.texto)
    .slice(0, 5);
  if (cards.length < 3) {
    // Sequência mínima em código: tensão, explicação e próximo passo, com o texto da própria copy.
    cards = [
      { funcao: "", etapa: "tensao", texto: [headline, apoio].filter(Boolean).join("\n"), ilustracao: ganchoVisual },
      { funcao: "", etapa: "explicacao", texto: cortarNaPalavra(texto(v.texto_principal, 300), 160), ilustracao: ganchoVisual },
      { funcao: "", etapa: "proximo_passo", texto: cta || texto(v.cta_meta, 40), ilustracao: ganchoVisual },
    ].filter((c) => c.texto);
  }
  return cards.map((c, i) => ({ ...c, funcao: i === 0 ? "capa" : i === cards.length - 1 ? "cta" : "conteudo" }));
}

// ------------------------------------------------------------ ações

/** briefing_sugerir { client_id, modelo_id?, raciocinio? } -> { sugestao, lacunas, observacoes, custo_usd, saldo_usd } */
async function briefingSugerir(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const [ctx, atual] = await Promise.all([montarContextoAds(servico, clientId), carregarBriefing(servico, clientId)]);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista");
  const pedido = `DADOS REAIS DO CLIENTE (JSON, lidos do painel agora; null ou vazio = não existe):
${JSON.stringify({ ...ctx.dados, briefing_atual: resumoDoBriefing(atual) }, null, 1)}

TAREFA: proponha o briefing de performance deste cliente para anúncios na Meta.
- Preencha só o que os dados sustentam. Cada situação, objeção e prova leva a fonte exata (ex.: "dossiê v3", "contexto consolidado", "anúncio 1234 com 18 mensagens em 30 dias"). Sem fonte, não entra.
- Preço, condição, garantia e prova só se aparecem nos dados. autorizado = true só quando o dado diz que o uso foi autorizado.
- O que faltar vira null no campo e uma linha em lacunas, dizendo o que perguntar ao cliente.
- observacoes: o que as métricas de anúncio mostram (ou que não há métricas).`;
  const s = await chamarTexto({
    clientId,
    tarefa: TAREFA,
    agente: AGENTE,
    modeloId: modelo.id,
    sistema: sistemaDoEstrategista(),
    mensagens: [{ papel: "usuario", conteudo: pedido }],
    raciocinio,
    esquemaJson: ESQUEMA_SUGESTAO,
    referencia: { tipo: REF_CLIENTE, id: clientId },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as Record<string, unknown>;
  return json({
    sugestao: normalizarBriefing(r),
    lacunas: (Array.isArray(r.lacunas) ? r.lacunas : []).map((l) => texto(l, 400)).filter(Boolean),
    observacoes: texto(r.observacoes, 3000),
    custo_usd: s.custoUsd,
    saldo_usd: s.saldoUsd,
  });
}

/** briefing_salvar { client_id, briefing } -> { briefing } (nova versão atual). */
async function briefingSalvar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  if (!corpo.briefing || typeof corpo.briefing !== "object") throw new ErroHttp(400, "briefing_vazio", "Envie o briefing para salvar.");
  const b = normalizarBriefing(corpo.briefing as Record<string, unknown>);
  const { data: ultimos, error: erroLer } = await servico.from("ads_briefings").select("id, versao, atual").eq("client_id", clientId).order("versao", { ascending: false }).limit(1);
  if (erroLer) throw new ErroHttp(503, "briefing_indisponivel", "Não foi possível ler o briefing atual.");
  const ultimo = ((ultimos as { id: string; versao: number; atual: boolean }[] | null) ?? [])[0];
  const { data: anteriores } = await servico.from("ads_briefings").update({ atual: false }).eq("client_id", clientId).eq("atual", true).select("id");
  const { data, error } = await servico
    .from("ads_briefings")
    .insert({ client_id: clientId, versao: (ultimo?.versao ?? 0) + 1, atual: true, ...b, criado_por: chamador.userId })
    .select("*")
    .single();
  if (error || !data) {
    // Devolve o posto de atual a quem tinha.
    const ids = ((anteriores as { id: string }[] | null) ?? []).map((x) => x.id);
    if (ids.length) await servico.from("ads_briefings").update({ atual: true }).eq("client_id", clientId).in("id", ids.slice(0, 1));
    throw new ErroHttp(503, "briefing_nao_salvo", "Não foi possível salvar o briefing.");
  }
  return json({ briefing: data });
}

/** Imagem da referência: storage_path no bucket mesa (do cliente) ou url pública https. */
async function imagemDaReferencia(servico: SupabaseClient, clientId: string, ref: { storage_path: string | null; url: string | null }): Promise<ImagemEntrada | null> {
  if (ref.storage_path) {
    if (!ref.storage_path.startsWith(`${clientId}/`) || ref.storage_path.includes("..")) return null;
    const { data, error } = await servico.storage.from("mesa").download(ref.storage_path);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const mime = mimeDaImagem(bytes);
    return mime && bytes.byteLength <= MAX_BYTES_IMAGEM ? { bytes, mime, nome: `referencia.${mime.split("/")[1]}` } : null;
  }
  if (!ref.url) return null;
  let u: URL;
  try {
    u = new URL(ref.url);
  } catch {
    return null;
  }
  // Só https público: nada de endereço interno.
  if (u.protocol !== "https:" || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(u.hostname)) return null;
  try {
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(20_000), redirect: "follow" });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = mimeDaImagem(bytes);
    return mime && bytes.byteLength <= MAX_BYTES_IMAGEM ? { bytes, mime, nome: `referencia.${mime.split("/")[1]}` } : null;
  } catch {
    return null;
  }
}

/** referencia_ler { client_id, referencia_id, modelo_id? } -> { referencia, custo_usd, saldo_usd } */
async function referenciaLer(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const refId = String(corpo.referencia_id ?? "");
  if (!UUID.test(refId)) throw new ErroHttp(400, "referencia_id_invalido", "referencia_id precisa ser um UUID.");
  const { data, error } = await servico.from("ads_referencias").select("*").eq("id", refId).maybeSingle();
  if (error) throw new ErroHttp(503, "referencia_indisponivel", "Não foi possível ler a referência.");
  if (!data) throw new ErroHttp(404, "referencia_inexistente", "Referência não encontrada.");
  const ref = data as { id: string; client_id: string | null; titulo: string; url: string | null; storage_path: string | null; ficha: Record<string, unknown>; tags: string[]; formato: string | null; plataforma: string | null; evidencia: string };
  // Biblioteca da agência é só leitura; a leitura grava na ficha, então só referência do cliente.
  if (ref.client_id === null) throw new ErroHttp(403, "biblioteca_somente_leitura", "A biblioteca da agência é só leitura. Copie a referência para o cliente antes de ler.");
  if (ref.client_id !== clientId) throw new ErroHttp(403, "referencia_de_outro_cliente", "Esta referência é de outro cliente.");
  const imagem = await imagemDaReferencia(servico, clientId, ref);
  if (!imagem) throw new ErroHttp(422, "referencia_sem_imagem", "Não consegui abrir a imagem desta referência (o link da Meta pode ter expirado). Suba o print na referência e tente de novo.");

  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "leitura", "low");
  const s = await chamarTexto({
    clientId,
    tarefa: TAREFA,
    agente: AGENTE_LEITOR,
    modeloId: modelo.id,
    sistema: SISTEMA_DO_LEITOR,
    mensagens: [{
      papel: "usuario",
      conteudo: `Referência: "${ref.titulo}"${ref.url ? ` (${ref.url})` : ""}. Preencha a ficha a partir da imagem anexa. Evidência atual: ${ref.evidencia} (a leitura não muda a evidência).`,
      imagens: [imagem],
    }],
    raciocinio,
    esquemaJson: ESQUEMA_FICHA,
    referencia: { tipo: REF_REFERENCIA, id: ref.id },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as Record<string, unknown>;
  const campos = [
    "tipo", "plataforma", "formato", "situacao", "motivacao", "estagio", "gancho_visual", "gancho_verbal", "texto_apoio", "argumento",
    "prova", "limite_da_prova", "objecao", "cta", "destino", "o_que_transportar", "o_que_substituir", "metricas_visiveis",
  ];
  const ficha: Record<string, unknown> = { ...(ref.ficha ?? {}) };
  for (const c of campos) ficha[c] = textoOuNulo(r[c], 1200);
  ficha.observado = texto(r.observado, 3000);
  ficha.inferido = texto(r.inferido, 3000);
  ficha.mecanismo = texto(r.mecanismo, 600);
  ficha.limites = texto(r.limites, 1200);
  ficha.lido_em = new Date().toISOString();
  ficha.lido_por_modelo = s.modeloId;
  const tags = [...new Set([...(ref.tags ?? []), ...(Array.isArray(r.tags) ? r.tags : []).map((t) => texto(t, 40).toLowerCase()).filter(Boolean)])].slice(0, 20);
  const { data: gravada, error: erroGravar } = await servico
    .from("ads_referencias")
    .update({
      ficha,
      mecanismo: texto(r.mecanismo, 600) || null,
      tags,
      formato: ref.formato ?? textoOuNulo(r.formato, 60),
      plataforma: ref.plataforma ?? textoOuNulo(r.plataforma, 60),
      titulo: ref.titulo || texto(r.titulo, 200) || "Referência",
    })
    .eq("id", ref.id)
    .eq("client_id", clientId)
    .select("*")
    .single();
  if (erroGravar || !gravada) throw new ErroHttp(503, "ficha_nao_salva", "A leitura foi feita, mas a ficha não foi salva.", { uso_id: s.usoId });
  return json({ referencia: gravada, custo_usd: s.custoUsd, saldo_usd: s.saldoUsd });
}

/** Métricas de um anúncio no formato guardado na referência. */
function metricasDaReferencia(m: Metricas) {
  return { ...m, fonte: "ads_creative_daily", somado_em: new Date().toISOString() };
}

/** referencias_importar_proprias { client_id } -> { importadas, atualizadas, e3, referencias, custo_usd: 0 } (grátis, sem IA). */
async function referenciasImportarProprias(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const anuncios = await lerAnunciosDoCliente(servico, clientId);
  if (!anuncios.length) return json({ importadas: 0, atualizadas: 0, e3: 0, referencias: [], custo_usd: 0 });
  const diarias = porAnuncio(await lerDiarias(servico, clientId, { adIds: anuncios.map((a) => a.ad_id) }));
  const { data: existentes, error } = await servico.from("ads_referencias").select("id, ad_id, evidencia, ficha").eq("client_id", clientId).not("ad_id", "is", null);
  if (error) throw new ErroHttp(503, "referencias_indisponiveis", "Não foi possível ler as referências do cliente.");
  const jaTem = new Map(((existentes as { id: string; ad_id: string; evidencia: string; ficha: Record<string, unknown> }[] | null) ?? []).map((e) => [e.ad_id, e]));

  // A tabela tem índice único parcial (client_id, ad_id): upsert do PostgREST não o
  // enxerga, então atualiza quem existe e insere quem falta.
  const novas: Record<string, unknown>[] = [];
  const atualizar: { id: string; campos: Record<string, unknown> }[] = [];
  let e3 = 0;
  for (const a of anuncios) {
    const m = somarMetricas(diarias.get(a.ad_id) ?? []);
    const anterior = jaTem.get(a.ad_id);
    const evidencia = evidenciaDaImportacao(m, anterior?.evidencia);
    if (evidencia === "E3" || evidencia === "E4") e3++;
    // Na atualização, título e print (storage_path) que a equipe ajustou ficam como estão.
    const campos = {
      url: a.image_url || a.thumbnail_url || null,
      origem: "anuncio_proprio",
      plataforma: "meta",
      formato: a.video_id ? "video" : "imagem",
      evidencia,
      metricas: metricasDaReferencia(m),
    };
    if (anterior) atualizar.push({ id: anterior.id, campos });
    else {
      novas.push({
        ...campos,
        titulo: texto(a.ad_name, 200) || texto(a.titulo, 200) || `Anúncio ${a.ad_id}`,
        storage_path: null,
        client_id: clientId,
        ad_id: a.ad_id,
        // Só o que a Meta devolveu do anúncio (observado); a leitura completa vem do leitor.
        ficha: { observado: [a.titulo ? `Título: ${a.titulo}` : "", a.corpo ? `Texto: ${a.corpo}` : ""].filter(Boolean).join("\n") || null, gancho_verbal: a.titulo ?? null, destino: a.destino ?? null },
        criado_por: chamador.userId,
      });
    }
  }
  if (novas.length) {
    const { error: erroInserir } = await servico.from("ads_referencias").insert(novas);
    if (erroInserir) throw new ErroHttp(503, "referencias_nao_importadas", "Não foi possível importar os anúncios do cliente.");
  }
  let falhas = 0;
  for (const u of atualizar) {
    const { error: e } = await servico.from("ads_referencias").update(u.campos).eq("id", u.id).eq("client_id", clientId);
    if (e) falhas++;
  }
  if (falhas && falhas === atualizar.length && !novas.length) throw new ErroHttp(503, "referencias_nao_atualizadas", "Não foi possível atualizar as referências dos anúncios.");
  const { data: referencias } = await servico.from("ads_referencias").select("*").eq("client_id", clientId).eq("origem", "anuncio_proprio").order("criado_em", { ascending: false }).limit(500);
  return json({ importadas: novas.length, atualizadas: atualizar.length - falhas, falhas, e3, referencias: referencias ?? [], custo_usd: 0 });
}

type ReferenciaResumo = { id: string; client_id: string | null; titulo: string; mecanismo: string | null; evidencia: string; destaque: boolean; origem: string; tags: string[]; ficha: Record<string, unknown>; metricas: Record<string, unknown> | null };

/** Referências para o plano: do cliente (destaque primeiro, evidência mais alta) e da biblioteca da agência. */
async function referenciasParaOPlano(servico: SupabaseClient, clientId: string): Promise<ReferenciaResumo[]> {
  const colunas = "id, client_id, titulo, mecanismo, evidencia, destaque, origem, tags, ficha, metricas";
  const [doCliente, daAgencia] = await Promise.all([
    servico.from("ads_referencias").select(colunas).eq("client_id", clientId).eq("ativa", true)
      .order("destaque", { ascending: false }).order("evidencia", { ascending: false }).order("criado_em", { ascending: false }).limit(25),
    servico.from("ads_referencias").select(colunas).is("client_id", null).eq("ativa", true)
      .order("destaque", { ascending: false }).order("criado_em", { ascending: true }).limit(40),
  ]);
  return [...((doCliente.data as ReferenciaResumo[] | null) ?? []), ...((daAgencia.data as ReferenciaResumo[] | null) ?? [])];
}

const resumoDaReferencia = (r: ReferenciaResumo) => {
  const f = r.ficha ?? {};
  return {
    id: r.id,
    de: r.client_id ? "cliente" : "biblioteca_da_agencia",
    destaque: r.destaque,
    titulo: r.titulo,
    evidencia: r.evidencia,
    mecanismo: r.mecanismo || f.mecanismo || null,
    gancho_visual: f.gancho_visual ?? null,
    gancho_verbal: f.gancho_verbal ?? null,
    aplicacao: f.aplicacao ?? f.o_que_transportar ?? null,
    limite: f.limite ?? f.limites ?? null,
    metricas: r.metricas && Object.keys(r.metricas).length ? r.metricas : null,
    tags: r.tags,
  };
};

/**
 * plano_gerar { client_id, briefing_id?, pedido?, quantidade_angulos? (3 a 6), modelo_id?, raciocinio? }
 * -> { plano, lacunas, aviso, custo_usd, saldo_usd, jev_erro }
 */
async function planoGerar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const briefing = await carregarBriefing(servico, clientId, corpo.briefing_id);
  if (!briefing) throw new ErroHttp(409, "sem_briefing", "Salve o briefing do cliente (etapa Oferta) antes de gerar o plano.");
  const qtd = Math.min(6, Math.max(3, Math.round(Number(corpo.quantidade_angulos) || 4)));
  const pedidoEquipe = texto(corpo.pedido, 2000);
  const [ctx, refs] = await Promise.all([montarContextoAds(servico, clientId), referenciasParaOPlano(servico, clientId)]);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista", "high");
  const refsValidas = new Set(refs.map((r) => r.id));

  const planoId = crypto.randomUUID();
  const conversaId = await abrirConversa(servico, clientId, planoId, chamador.userId);
  const pedido = `Gere um plano de teste com ${qtd} ângulos para os anúncios deste cliente.${pedidoEquipe ? ` Pedido da equipe: ${pedidoEquipe}` : ""}`;
  const instrucao = `DADOS REAIS DO CLIENTE (JSON; null ou vazio = não existe):
${JSON.stringify(ctx.dados, null, 1)}

BRIEFING DE PERFORMANCE (versão ${briefing.versao}):
${JSON.stringify(resumoDoBriefing(briefing), null, 1)}

REFERÊNCIAS DISPONÍVEIS (use os ids; destaque primeiro; biblioteca_da_agencia é estudo de mecanismo, E0):
${JSON.stringify(refs.map(resumoDaReferencia), null, 1)}

TAREFA: ${pedido}
Regras dos ângulos:
- Exatamente ${qtd} ângulos REALMENTE diferentes: cada um combina uma situação do público, um mecanismo e uma prova diferentes (vinte paráfrases não são vinte conceitos).
- situacao: a cena concreta vivida pelo comprador, com a linguagem dele, ligada a uma situação do briefing.
- mecanismo e tecnica: qual das dezoito técnicas e qual mecanismo (sem citar marca de terceiros).
- prova: só prova do briefing, com a fonte; se não houver, diga "sem prova no briefing" e use demonstração ou mecanismo.
- gancho_visual: o que aparece na imagem e faz parar a rolagem; gancho_verbal: a headline curta (até 7 palavras).
- hipotese no formato: "Acreditamos que [situação + mecanismo] aumentará [resultado], porque [evidência do público]. Vamos comparar com [base] durante [janela], mantendo [condições] e registrando [dados]."
- metrica: a métrica do negócio que decide (pelo objetivo do briefing), não só clique. janela_dias: de 3 a 60.
- formatos: entre feed_4x5, quadrado_1x1, stories_9x16 e carrossel (carrossel quando a sequência explica melhor). variacoes: 1 a 3.
- referencia_ids: ids da lista acima que inspiraram o ângulo (referências do cliente em destaque primeiro); nunca invente id.
- estrutura: conjuntos de anúncio sugeridos, verba só se o briefing tiver verba (senão null), janela e observações.
- lacunas: o que falta no briefing para testar melhor.
- id de cada ângulo: a1, a2, ...`;

  let s;
  try {
    s = await chamarTexto({
      clientId,
      tarefa: TAREFA,
      agente: AGENTE,
      modeloId: modelo.id,
      sistema: sistemaDoEstrategista(),
      mensagens: [{ papel: "usuario", conteudo: instrucao }],
      raciocinio,
      esquemaJson: ESQUEMA_PLANO,
      referencia: { tipo: REF_PLANO, id: planoId },
      criadoPor: chamador.userId,
    });
  } catch (err) {
    // Sem plano, a conversa aberta fica órfã: apaga (só a desta chamada).
    await servico.from("agente_conversas").delete().eq("id", conversaId).eq("client_id", clientId);
    throw err;
  }
  const r = (s.json ?? {}) as Record<string, unknown>;
  let angulos = (Array.isArray(r.angulos) ? r.angulos : []).slice(0, 6).map((a, i) => normalizarAngulo(a, `a${i + 1}`, refsValidas)).filter((a) => a.nome && a.situacao);
  const jev = await pontuarAngulosComJev(angulos, briefing, { clientId, planoId, criadoPor: chamador.userId });
  angulos = jev.angulos;
  const estrutura = normalizarEstrutura(r.estrutura, new Set(angulos.map((a) => a.id)));
  const lacunas = (Array.isArray(r.lacunas) ? r.lacunas : []).map((l) => texto(l, 400)).filter(Boolean);
  const aviso = angulos.length < 3 ? `O estrategista devolveu ${angulos.length} ângulos (o pedido era ${qtd}).` : null;
  const custo = arred6(s.custoUsd + jev.custo);

  const { data: plano, error } = await servico
    .from("ads_planos")
    .insert({
      id: planoId,
      client_id: clientId,
      briefing_id: briefing.id,
      nome: texto(r.nome, 120) || `Plano de teste ${hojeSaoPaulo()}`,
      status: "rascunho",
      angulos,
      estrutura: { ...estrutura, lacunas, resumo: texto(r.resumo, 3000), jev_erro: jev.jev_erro },
      pedido: pedidoEquipe || null,
      conversa_id: conversaId,
      custo_usd: custo,
      criado_por: chamador.userId,
    })
    .select("*")
    .single();
  if (error || !plano) throw new ErroHttp(503, "plano_nao_salvo", "Os ângulos foram gerados, mas o plano não foi salvo.", { uso_id: s.usoId });

  await registrarMensagens(servico, conversaId, clientId, [
    { papel: "usuario", conteudo: pedido },
    {
      papel: "agente",
      conteudo: `${texto(r.resumo, 3000)}\n\nÂngulos:\n${angulos.map((a) => `${a.id}. ${a.nome}: ${a.hipotese}`).join("\n")}${lacunas.length ? `\n\nLacunas: ${lacunas.join("; ")}` : ""}`,
      uso_id: s.usoId,
    },
  ]);
  return json({ plano, lacunas, aviso, custo_usd: custo, saldo_usd: s.saldoUsd, jev_erro: jev.jev_erro, reserva_usada: s.reservaUsada ?? null });
}

/** plano_conversar { plano_id, mensagem, anexos?, modelo_id?, raciocinio? } -> { plano, resposta, conversa_id, custo_usd, saldo_usd, jev_erro } */
async function planoConversar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarPlano(servico, corpo.plano_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  const mensagem = texto(corpo.mensagem, 4000);
  if (!mensagem) throw new ErroHttp(400, "mensagem_vazia", "Escreva o que você quer no plano.");
  const podeMudar = p.status !== "concluido";

  const [briefing, ctx, refs, anexos] = await Promise.all([
    carregarBriefing(servico, p.client_id, p.briefing_id ?? undefined).catch(() => null),
    montarContextoAds(servico, p.client_id),
    referenciasParaOPlano(servico, p.client_id),
    baixarAnexos(servico, p.client_id, corpo.anexos),
  ]);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista");
  let conversaId = p.conversa_id;
  if (!conversaId) {
    conversaId = await abrirConversa(servico, p.client_id, p.id, chamador.userId);
    await salvarPlano(servico, p, { conversa_id: conversaId });
  }
  const { data: historico } = await servico.from("agente_mensagens").select("papel, conteudo").eq("conversa_id", conversaId).order("criado_em", { ascending: false }).limit(12);
  const anteriores: MensagemMotor[] = ((historico ?? []) as Array<{ papel: string; conteudo: string }>)
    .reverse()
    .filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => ({ papel: m.papel as "usuario" | "agente", conteudo: m.conteudo.slice(0, 2000) }));

  const pedido = `DADOS REAIS DO CLIENTE (JSON):
${JSON.stringify(ctx.dados)}

BRIEFING: ${JSON.stringify(resumoDoBriefing(briefing))}

REFERÊNCIAS DISPONÍVEIS: ${JSON.stringify(refs.map(resumoDaReferencia))}

PLANO ATUAL (${p.status}${podeMudar ? "" : "; CONCLUÍDO, NÃO MUDE OS ÂNGULOS"}):
${JSON.stringify({ nome: p.nome, angulos: p.angulos.map(({ jev: _j, ...a }) => a), estrutura: p.estrutura })}

PEDIDO DA EQUIPE: ${mensagem}
${anexos.imagens.length ? `A equipe anexou ${anexos.imagens.length} imagem(ns); use o conteúdo com fidelidade.\n` : ""}
Aplique o pedido. Devolva:
- resposta: o que mudou ou a resposta, em até 4 frases.
- nome: novo nome só se mudou; senão null.
- angulos: ${podeMudar ? "a lista COMPLETA atualizada só se algum ângulo mudou, entrou ou saiu (mantenha o id dos que ficam; novo recebe id novo); senão null. Mesmas regras de ângulo, hipótese e referências." : "sempre null."}
- estrutura: a estrutura completa só se mudou; senão null.`;
  const s = await chamarTexto({
    clientId: p.client_id,
    tarefa: TAREFA,
    agente: AGENTE,
    modeloId: modelo.id,
    sistema: sistemaDoEstrategista(),
    mensagens: [...anteriores, { papel: "usuario", conteudo: pedido, imagens: anexos.imagens.length ? anexos.imagens : undefined }],
    raciocinio,
    esquemaJson: ESQUEMA_CONVERSA_PLANO,
    referencia: { tipo: REF_PLANO, id: p.id },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as Record<string, unknown>;
  const campos: Record<string, unknown> = {};
  let jevErro: string | null = null;
  let custoJev = 0;
  if (typeof r.nome === "string" && texto(r.nome, 120)) campos.nome = texto(r.nome, 120);
  if (podeMudar && Array.isArray(r.angulos)) {
    const porId = new Map(p.angulos.map((a) => [a.id, a]));
    let seq = Math.max(p.angulos.length, ...p.angulos.map((a) => Number(String(a.id).replace(/^a/, "")) || 0));
    const usados = new Set<string>();
    let angulos = r.angulos.slice(0, 6).map((bruto) => {
      let id = String((bruto as Record<string, unknown>)?.id ?? "");
      if (!porId.has(id) || usados.has(id)) {
        do id = `a${++seq}`; while (usados.has(id) || porId.has(id));
      }
      usados.add(id);
      return normalizarAngulo(bruto, id, new Set(refs.map((x) => x.id)), porId.get(id));
    }).filter((a) => a.nome && a.situacao);
    if (angulos.length) {
      const jev = await pontuarAngulosComJev(angulos, briefing, { clientId: p.client_id, planoId: p.id, criadoPor: chamador.userId });
      angulos = jev.angulos;
      jevErro = jev.jev_erro;
      custoJev = jev.custo;
      campos.angulos = angulos;
    }
  }
  if (r.estrutura && typeof r.estrutura === "object") {
    const ids = new Set(((campos.angulos as Angulo[] | undefined) ?? p.angulos).map((a) => a.id));
    campos.estrutura = { ...p.estrutura, ...normalizarEstrutura(r.estrutura, ids) };
  }
  const plano = Object.keys(campos).length ? await salvarPlano(servico, p, campos) : p;
  const custo = arred6(s.custoUsd + custoJev);
  const total = await somarCustoDoPlano(servico, p.id, p.client_id, custo);
  if (total != null) plano.custo_usd = total;

  const resposta = texto(r.resposta, 2000) || "Plano atualizado.";
  await registrarMensagens(servico, conversaId, p.client_id, [
    { papel: "usuario", conteudo: mensagem, anexos: anexos.caminhos.map((x) => ({ caminho: x })) },
    { papel: "agente", conteudo: resposta, uso_id: s.usoId },
  ]);
  return json({ plano, resposta, conversa_id: conversaId, custo_usd: custo, saldo_usd: s.saldoUsd, jev_erro: jevErro });
}

/**
 * criativos_produzir { plano_id, angulo_ids[], formatos[], modelo_id?, raciocinio? }
 * -> { criativos, trabalho_ids, avisos, falhas, custo_usd, saldo_usd, jev_erro }
 * Uma chamada de copy por ângulo; cada variação x formato vira um ads_criativo
 * e um estudio_trabalhos tipo 'ads' já dirigido (direção em código).
 */
async function criativosProduzir(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarPlano(servico, corpo.plano_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  const ids = new Set((Array.isArray(corpo.angulo_ids) ? corpo.angulo_ids : []).map(String));
  const angulos = p.angulos.filter((a) => ids.has(a.id));
  if (!angulos.length) throw new ErroHttp(400, "nenhum_angulo_valido", "Escolha ao menos um ângulo do plano.");
  const pedidos = [...new Set((Array.isArray(corpo.formatos) ? corpo.formatos : []).map(String).filter((f) => (FORMATOS as string[]).includes(f)))] as FormatoAds[];
  const formatosDo = (a: Angulo) => (pedidos.length ? pedidos : a.formatos.length ? a.formatos : (["feed_4x5"] as FormatoAds[]));
  const total = angulos.reduce((s, a) => s + a.variacoes * formatosDo(a).length, 0);
  if (total > MAX_CRIATIVOS_POR_CHAMADA) {
    throw new ErroHttp(400, "criativos_demais", `Isso daria ${total} criativos; o limite por vez é ${MAX_CRIATIVOS_POR_CHAMADA}. Escolha menos ângulos ou formatos.`);
  }
  const [briefing, marca, modeloImagem] = await Promise.all([
    carregarBriefing(servico, p.client_id, p.briefing_id ?? undefined).catch(() => null),
    lerMarcaParaDirecao(servico, p.client_id),
    modeloPadrao("imagem"),
  ]);
  if (!modeloImagem) throw new ErroHttp(409, "sem_modelo_de_imagem", "O catálogo não tem gerador de imagem padrão.");
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista");

  let custo = 0;
  let saldo: number | null = null;
  let jevErro: string | null = null;
  const avisos: string[] = [];

  const produzirAngulo = async (a: Angulo) => {
    const formatos = formatosDo(a);
    const pedido = `BRIEFING: ${JSON.stringify(resumoDoBriefing(briefing))}
MARCA: ${JSON.stringify({ nome: marca.nomeCliente, tom_de_voz: marca.tomDeVoz, regras: marca.regras })}
ÂNGULO: ${JSON.stringify({ nome: a.nome, situacao: a.situacao, mecanismo: a.mecanismo, tecnica: a.tecnica, prova: a.prova, gancho_visual: a.gancho_visual, gancho_verbal: a.gancho_verbal, hipotese: a.hipotese, estagio: a.estagio_consciencia })}
FORMATOS: ${formatos.join(", ")}

TAREFA: escreva ${a.variacoes} variação(ões) de anúncio para este ângulo. As variações mudam uma coisa só (gancho, prova ou CTA), mantendo o mecanismo.
Para cada variação (variacao = 1, 2, 3):
- texto_principal: a ideia inteira em até 125 caracteres (o que aparece antes do "ver mais").
- texto_principal_longo: a versão completa do texto do anúncio (pode repetir o início do texto_principal).
- titulo: até 40 caracteres, com o benefício ou a oferta. descricao: curta ou null.
- cta_meta: um dos botões da Meta coerente com o destino do briefing.
- headline_arte: até 7 palavras, a frase grande na imagem. apoio_arte: uma linha curta ou null. cta_arte: o CTA escrito na peça, coerente com o botão.
- gancho_visual: o que a imagem mostra (o gancho visual do ângulo, ajustado à variação), descrito para o diretor de arte.
- carrossel: ${formatos.includes("carrossel") ? "de 3 a 5 cards seguindo a sequência tensão, explicação, demonstração, objeção, próximo passo (cada lâmina acrescenta algo; a primeira é a capa com o gancho, a última o próximo passo); texto_exato curto por card e a ilustracao de cada um" : "null"}.
Nada de número, depoimento, prazo, preço ou urgência que não esteja no briefing.`;
    const s = await chamarTexto({
      clientId: p.client_id,
      tarefa: TAREFA,
      agente: AGENTE,
      modeloId: modelo.id,
      sistema: sistemaDoEstrategista(),
      mensagens: [{ papel: "usuario", conteudo: pedido }],
      raciocinio,
      esquemaJson: ESQUEMA_COPIES,
      referencia: { tipo: REF_PLANO, id: p.id },
      criadoPor: chamador.userId,
    });
    custo += s.custoUsd;
    saldo = s.saldoUsd;
    const brutas = (s.json as Record<string, unknown> | undefined)?.variacoes;
    const variacoes = (Array.isArray(brutas) ? brutas as Record<string, unknown>[] : []).slice(0, a.variacoes);
    const copies = variacoes.map((v) => normalizarCopy(v));
    const conferencia = await conferirCopiesComJev(
      copies.map((c, i) => ({
        texto_principal: c.texto_principal,
        titulo: c.titulo,
        descricao: c.descricao,
        cta_meta: c.cta_meta,
        texto_na_arte: [texto(variacoes[i].headline_arte, 120), texto(variacoes[i].apoio_arte, 160), texto(variacoes[i].cta_arte, 60)].filter(Boolean).join(" / "),
      })),
      briefing,
      { clientId: p.client_id, referencia: { tipo: REF_PLANO, id: p.id }, criadoPor: chamador.userId },
    );
    custo += conferencia.custo;
    if (conferencia.jev_erro) jevErro = conferencia.jev_erro;
    return { angulo: a, formatos, variacoes, copies, notas: conferencia.notas, usoId: s.usoId };
  };

  // Pool simples: até ANGULOS_EM_PARALELO chamadas ao mesmo tempo.
  const resultados: PromiseSettledResult<Awaited<ReturnType<typeof produzirAngulo>>>[] = new Array(angulos.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < angulos.length) {
      const i = proximo++;
      try {
        resultados[i] = { status: "fulfilled", value: await produzirAngulo(angulos[i]) };
      } catch (reason) {
        resultados[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ANGULOS_EM_PARALELO, angulos.length) }, trabalhador));
  const feitos = resultados.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const falhas = resultados.map((r, i) => ({ r, id: angulos[i].id })).filter((x) => x.r.status === "rejected");
  if (!feitos.length) {
    await somarCustoDoPlano(servico, p.id, p.client_id, custo);
    throw (falhas[0].r as PromiseRejectedResult).reason;
  }

  const trabalhos: Record<string, unknown>[] = [];
  const criativos: Record<string, unknown>[] = [];
  for (const f of feitos) {
    const a = f.angulo;
    f.variacoes.forEach((v, i) => {
      const copy = f.copies[i];
      const nota = f.notas[i];
      if (nota?.alerta_politica) avisos.push(`${a.nome}, variação ${i + 1}: o Jev viu risco de política. Revise antes de subir.`);
      const gancho = texto(v.gancho_visual, 600) || a.gancho_visual;
      for (const formato of f.formatos) {
        const trabalhoId = crypto.randomUUID();
        const criativoId = crypto.randomUUID();
        const roteiro = roteiroDaVariacao(v, formato, gancho);
        const direcao = direcaoDoAnuncio(roteiro, formato, marca, {
          conceito: `${a.nome}. Situação: ${a.situacao} Mecanismo: ${a.mecanismo}.`.slice(0, 900),
          fioVisual: `${gancho}${marca.estilo ? ` Estilo da marca: ${marca.estilo}` : ""}`.slice(0, 800),
          ganchoVisual: gancho,
          ctaArte: texto(v.cta_arte, 60),
        });
        direcao.ads = { criativo_id: criativoId, plano_id: p.id, angulo_id: a.id, variacao: i + 1 };
        trabalhos.push({
          id: trabalhoId,
          client_id: p.client_id,
          task_id: null,
          tipo: "ads",
          status: "dirigido",
          direcao,
          modelo_imagem_id: modeloImagem.id,
          qualidade: "media",
          cards: [],
          legenda: copy.texto_principal_longo,
          custo_usd: 0,
          criado_por: chamador.userId,
        });
        criativos.push({
          id: criativoId,
          client_id: p.client_id,
          plano_id: p.id,
          angulo_id: a.id,
          trabalho_id: trabalhoId,
          nome: `${a.nome} | V${i + 1} | ${formato}`.slice(0, 200),
          formato,
          copy: { ...copy, headline_arte: texto(v.headline_arte, 120), apoio_arte: textoOuNulo(v.apoio_arte, 160), cta_arte: texto(v.cta_arte, 60), jev: nota },
          roteiro_video: null,
          status: "rascunho",
          evidencia: "E0",
          criado_por: chamador.userId,
        });
      }
    });
  }

  const custoFinal = arred6(custo);
  const totalPlano = await somarCustoDoPlano(servico, p.id, p.client_id, custoFinal);
  if (!criativos.length) throw new ErroHttp(502, "sem_copy", "O estrategista não devolveu nenhuma variação de copy.", { custo_usd: custoFinal });
  const { error: erroTrabalhos } = await servico.from("estudio_trabalhos").insert(trabalhos);
  if (erroTrabalhos) throw new ErroHttp(503, "trabalhos_nao_criados", "A copy foi escrita, mas os trabalhos do Estúdio não foram criados.", { custo_usd: custoFinal });
  const { data: gravados, error: erroCriativos } = await servico.from("ads_criativos").insert(criativos).select("*");
  if (erroCriativos || !gravados) {
    await servico.from("estudio_trabalhos").delete().eq("client_id", p.client_id).in("id", trabalhos.map((t) => t.id as string));
    throw new ErroHttp(503, "criativos_nao_salvos", "A copy foi escrita, mas os criativos não foram salvos.", { custo_usd: custoFinal });
  }
  for (const f of falhas) avisos.push(`Ângulo ${f.id} não foi produzido: ${(f.r as PromiseRejectedResult).reason instanceof Error ? ((f.r as PromiseRejectedResult).reason as Error).message : "falha"}.`);
  for (const f of feitos) for (const c of f.copies) avisos.push(...c.avisos.map((x) => `${f.angulo.nome}: ${x}`));

  return json({
    criativos: gravados,
    trabalho_ids: trabalhos.map((t) => t.id),
    avisos,
    falhas: falhas.map((f) => f.id),
    custo_usd: custoFinal,
    custo_plano_usd: totalPlano,
    saldo_usd: saldo,
    jev_erro: jevErro,
  });
}

/** copy_variar { criativo_id, pedido?, quantidade? (1 a 5), modelo_id? } -> { criativo, variacoes, custo_usd, saldo_usd, jev_erro } */
async function copyVariar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const c = await carregarCriativo(servico, corpo.criativo_id);
  await exigirAcessoAoCliente(chamador, c.client_id);
  const qtd = Math.min(5, Math.max(1, Math.round(Number(corpo.quantidade) || 3)));
  const pedidoEquipe = texto(corpo.pedido, 1500);
  const plano = c.plano_id ? await carregarPlano(servico, c.plano_id).catch(() => null) : null;
  const angulo = plano?.angulos.find((a) => a.id === c.angulo_id) ?? null;
  const briefing = await carregarBriefing(servico, c.client_id, plano?.briefing_id ?? undefined).catch(() => null);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista");
  const s = await chamarTexto({
    clientId: c.client_id,
    tarefa: TAREFA,
    agente: AGENTE,
    modeloId: modelo.id,
    sistema: sistemaDoEstrategista(),
    mensagens: [{
      papel: "usuario",
      conteudo: `BRIEFING: ${JSON.stringify(resumoDoBriefing(briefing))}
ÂNGULO: ${JSON.stringify(angulo ? { nome: angulo.nome, situacao: angulo.situacao, mecanismo: angulo.mecanismo, prova: angulo.prova, hipotese: angulo.hipotese } : null)}
COPY ATUAL: ${JSON.stringify({ texto_principal: c.copy.texto_principal, titulo: c.copy.titulo, descricao: c.copy.descricao, cta_meta: c.copy.cta_meta })}

TAREFA: escreva ${qtd} variação(ões) de texto principal (até 125 caracteres), texto principal longo, título (até 40), descrição e CTA do botão, mudando uma coisa por vez e mantendo o mecanismo do ângulo.${pedidoEquipe ? ` Pedido da equipe: ${pedidoEquipe}` : ""}
o_que_mudou: uma frase dizendo a variável que mudou.`,
    }],
    raciocinio,
    esquemaJson: ESQUEMA_VARIAR,
    referencia: { tipo: REF_CRIATIVO, id: c.id },
    criadoPor: chamador.userId,
  });
  const brutas = (((s.json as Record<string, unknown>)?.variacoes as Record<string, unknown>[] | undefined) ?? []).slice(0, qtd);
  const copies = brutas.map((v) => ({ ...normalizarCopy(v), o_que_mudou: texto(v.o_que_mudou, 300) }));
  const conferencia = await conferirCopiesComJev(copies, briefing, { clientId: c.client_id, referencia: { tipo: REF_CRIATIVO, id: c.id }, criadoPor: chamador.userId });
  const variacoes = copies.map((v, i) => ({ ...v, jev: conferencia.notas[i] ?? null, gerado_em: new Date().toISOString() }));
  // Guarda as alternativas no criativo (as 10 mais recentes); a equipe escolhe e salva a copy na tela.
  const alternativas = [...variacoes, ...(Array.isArray(c.copy.alternativas) ? c.copy.alternativas : [])].slice(0, 10);
  const { data: criativo, error } = await servico.from("ads_criativos").update({ copy: { ...c.copy, alternativas } }).eq("id", c.id).eq("client_id", c.client_id).select("*").single();
  if (error || !criativo) throw new ErroHttp(503, "variacoes_nao_salvas", "As variações foram escritas, mas não foram salvas.", { variacoes, uso_id: s.usoId });
  const custo = arred6(s.custoUsd + conferencia.custo);
  await somarCustoDoPlano(servico, c.plano_id, c.client_id, custo);
  return json({ criativo, variacoes, custo_usd: custo, saldo_usd: s.saldoUsd, jev_erro: conferencia.jev_erro });
}

/** Período pedido: periodo_inicio/periodo_fim ou os últimos `dias` (padrão 30), fechando hoje em São Paulo. */
function lerPeriodo(corpo: Record<string, unknown>): { inicio: string; fim: string } {
  const p = (corpo.periodo ?? {}) as Record<string, unknown>;
  const inicio = String(corpo.periodo_inicio ?? p.inicio ?? "");
  const fim = String(corpo.periodo_fim ?? p.fim ?? "");
  if (inicio || fim) {
    if (!DATA.test(inicio) || !DATA.test(fim) || fim < inicio) {
      throw new ErroHttp(400, "periodo_invalido", "Informe periodo_inicio e periodo_fim (AAAA-MM-DD), com o fim depois do início.");
    }
    return { inicio, fim };
  }
  const dias = Math.min(365, Math.max(1, Math.round(Number(corpo.dias) || 30)));
  const hoje = hojeSaoPaulo();
  return { inicio: somarDias(hoje, -(dias - 1)), fim: hoje };
}

/**
 * resultados_ler { client_id, periodo_inicio?, periodo_fim?, dias? (padrão 30) }
 * -> { periodo, criativos: [{ ...criativo, metricas, diagnostico }], sem_vinculo, custo_usd: 0 }
 * Grátis e sem IA: conta e tabela DIAGNOSTICO em código (calculos.ts).
 */
async function resultadosLer(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const periodo = lerPeriodo(corpo);
  const [{ data: ligados, error }, anuncios, briefing] = await Promise.all([
    servico.from("ads_criativos").select("id, nome, plano_id, angulo_id, formato, status, ad_id, evidencia, trabalho_id, copy").eq("client_id", clientId).not("ad_id", "is", null).limit(500),
    lerAnunciosDoCliente(servico, clientId),
    carregarBriefing(servico, clientId).catch(() => null),
  ]);
  if (error) throw new ErroHttp(503, "criativos_indisponiveis", "Não foi possível ler os criativos do cliente.");
  const lista = (ligados as (Criativo & { ad_id: string })[] | null) ?? [];
  const diarias = porAnuncio(await lerDiarias(servico, clientId, { desde: periodo.inicio, ate: periodo.fim }));
  const tolera = numeroOuNulo((briefing?.objetivo ?? {}).custo_toleravel_brl);
  const criativos = lista.map((c) => {
    const linhas = diarias.get(c.ad_id) ?? [];
    const metricas = somarMetricas(linhas);
    return { ...c, metricas, diagnostico: diagnosticar(metricas, linhas, tolera) };
  });
  const vinculados = new Set(lista.map((c) => c.ad_id));
  const semVinculo = anuncios
    .filter((a) => !vinculados.has(a.ad_id))
    .map((a) => {
      const m = somarMetricas(diarias.get(a.ad_id) ?? []);
      return { ad_id: a.ad_id, ad_name: a.ad_name, titulo: a.titulo, thumbnail_url: a.thumbnail_url || a.image_url, effective_status: a.effective_status, gasto: m.gasto, impressoes: m.impressoes, resultados: m.resultados };
    })
    .sort((x, y) => y.gasto - x.gasto);
  return json({ periodo, criativos, sem_vinculo: semVinculo, custo_toleravel_brl: tolera, custo_usd: 0 });
}

/**
 * aprendizado_registrar { criativo_id, periodo_inicio, periodo_fim, texto?, modelo_id? }
 * -> { aprendizado, criativo, memoria, custo_usd, saldo_usd }
 */
async function aprendizadoRegistrar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const c = await carregarCriativo(servico, corpo.criativo_id);
  await exigirAcessoAoCliente(chamador, c.client_id);
  if (!c.ad_id) throw new ErroHttp(409, "criativo_sem_anuncio", "Ligue o criativo ao anúncio da Meta antes de registrar o aprendizado.");
  const inicio = String(corpo.periodo_inicio ?? "");
  const fim = String(corpo.periodo_fim ?? "");
  if (!DATA.test(inicio) || !DATA.test(fim) || fim < inicio) {
    throw new ErroHttp(400, "periodo_invalido", "Informe periodo_inicio e periodo_fim (AAAA-MM-DD), com o fim depois do início.");
  }
  const linhas = await lerDiarias(servico, c.client_id, { adIds: [c.ad_id], desde: inicio, ate: fim });
  const m = somarMetricas(linhas);
  // E3 pede resultado documentado: sem gasto e entrega no período, não há o que registrar.
  if (!(m.gasto > 0) || m.impressoes <= 0) {
    throw new ErroHttp(409, "sem_metricas_no_periodo", "Este anúncio não tem gasto nem impressões no período. Sem dado documentado, não há aprendizado E3.");
  }
  const plano = c.plano_id ? await carregarPlano(servico, c.plano_id).catch(() => null) : null;
  const angulo = plano?.angulos.find((a) => a.id === c.angulo_id) ?? null;
  const briefing = await carregarBriefing(servico, c.client_id, plano?.briefing_id ?? undefined).catch(() => null);
  const tolera = numeroOuNulo((briefing?.objetivo ?? {}).custo_toleravel_brl);
  const diagnostico = diagnosticar(m, linhas, tolera);
  const direcao = direcaoDoResultado(m, tolera);

  // Aprendizados anteriores do mesmo ângulo (mesmo plano e angulo_id) para a E4.
  let anteriores: { evidencia: string; periodo_fim: string | null; direcao: string | null }[] = [];
  if (c.plano_id && c.angulo_id) {
    const { data: irmaos } = await servico.from("ads_criativos").select("id").eq("client_id", c.client_id).eq("plano_id", c.plano_id).eq("angulo_id", c.angulo_id);
    const idsIrmaos = ((irmaos as { id: string }[] | null) ?? []).map((x) => x.id);
    if (idsIrmaos.length) {
      const { data: aps } = await servico.from("ads_aprendizados").select("evidencia, periodo_fim, diagnostico").eq("client_id", c.client_id).in("criativo_id", idsIrmaos);
      anteriores = ((aps as { evidencia: string; periodo_fim: string | null; diagnostico: Record<string, unknown> }[] | null) ?? [])
        .map((x) => ({ evidencia: x.evidencia, periodo_fim: x.periodo_fim, direcao: typeof x.diagnostico?.direcao === "string" ? x.diagnostico.direcao : null }));
    }
  }
  const evidencia = evidenciaDoAprendizado(anteriores, direcao, inicio);

  let textoFinal = texto(corpo.texto, 4000);
  let custo = 0;
  let saldo: number | null = null;
  let usoId: string | null = null;
  if (!textoFinal) {
    const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista", "low");
    const s = await chamarTexto({
      clientId: c.client_id,
      tarefa: TAREFA,
      agente: AGENTE,
      modeloId: modelo.id,
      sistema: sistemaDoEstrategista(),
      mensagens: [{
        papel: "usuario",
        conteudo: `Registre o aprendizado deste criativo em até 4 frases, exatamente no formato: "No projeto X, para a oferta Y, no período Z, a execução A apresentou [resultado] em comparação com B, sob [condições]. Ainda não sabemos [incerteza]. O próximo teste mudará [componente]."
Use só os números abaixo; comparação sem base vira "sem base de comparação registrada".
CLIENTE: ${JSON.stringify({ oferta: briefing?.oferta ?? null, objetivo: briefing?.objetivo ?? null })}
CRIATIVO: ${JSON.stringify({ nome: c.nome, formato: c.formato, copy: { texto_principal: c.copy.texto_principal, titulo: c.copy.titulo }, angulo: angulo ? { nome: angulo.nome, hipotese: angulo.hipotese } : null })}
PERÍODO: ${inicio} a ${fim}
MÉTRICAS: ${JSON.stringify(m)}
DIAGNÓSTICO (código): ${JSON.stringify({ situacao: diagnostico.situacao, sinais: diagnostico.sinais, direcao })}`,
      }],
      raciocinio,
      esquemaJson: ESQUEMA_APRENDIZADO,
      referencia: { tipo: REF_CRIATIVO, id: c.id },
      criadoPor: chamador.userId,
      maxTokensSaida: 1500,
    });
    textoFinal = texto((s.json as Record<string, unknown>)?.texto, 4000);
    custo = s.custoUsd;
    saldo = s.saldoUsd;
    usoId = s.usoId;
    if (!textoFinal) throw new ErroHttp(502, "aprendizado_vazio", "O estrategista não devolveu o texto do aprendizado. Escreva o texto e tente de novo.", { uso_id: usoId });
  }

  const { data: aprendizado, error } = await servico
    .from("ads_aprendizados")
    .insert({
      client_id: c.client_id,
      criativo_id: c.id,
      plano_id: c.plano_id,
      periodo_inicio: inicio,
      periodo_fim: fim,
      metricas: m,
      diagnostico: { ...diagnostico, direcao, angulo_id: c.angulo_id },
      texto: textoFinal,
      evidencia,
      criado_por: chamador.userId,
    })
    .select("*")
    .single();
  if (error || !aprendizado) throw new ErroHttp(503, "aprendizado_nao_salvo", "Não foi possível salvar o aprendizado.", { uso_id: usoId });

  const novaEvidencia = maiorEvidencia(c.evidencia, evidencia);
  const { data: criativo } = await servico.from("ads_criativos").update({ evidencia: novaEvidencia }).eq("id", c.id).eq("client_id", c.client_id).select("*").single();
  // A referência do anúncio próprio acompanha a evidência conquistada.
  const { data: refs } = await servico.from("ads_referencias").select("id, evidencia").eq("client_id", c.client_id).eq("ad_id", c.ad_id);
  for (const r of (refs as { id: string; evidencia: string }[] | null) ?? []) {
    const e = maiorEvidencia(r.evidencia, evidencia);
    if (e !== r.evidencia) await servico.from("ads_referencias").update({ evidencia: e }).eq("id", r.id).eq("client_id", c.client_id);
  }
  await somarCustoDoPlano(servico, c.plano_id, c.client_id, custo);

  // Memória do estrategista de ads: o aprendizado também vira memória do
  // agente (além de ads_aprendizados, que o contexto do estrategista já lê).
  let memoria: Record<string, unknown> = { gravada: false, onde_fica: "ads_aprendizados" };
  if (MEMORIA_ACEITA_ESTRATEGISTA_ADS) {
    const { error: erroMemoria } = await servico.from("agente_memoria").insert({
      client_id: c.client_id,
      agente: AGENTE,
      tipo: "aprendizado",
      origem: "metrica",
      referencia_id: (aprendizado as { id?: string } | null)?.id ?? null,
      texto: String((aprendizado as { texto?: string } | null)?.texto ?? "").slice(0, 4000),
    });
    memoria = erroMemoria
      ? { gravada: false, motivo: erroMemoria.message, onde_fica: "ads_aprendizados" }
      : { gravada: true, onde_fica: "agente_memoria e ads_aprendizados" };
  }
  return json({ aprendizado, criativo: criativo ?? c, memoria, custo_usd: custo, saldo_usd: saldo });
}

const ACOES: Record<string, (s: SupabaseClient, c: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  briefing_sugerir: briefingSugerir,
  briefing_salvar: briefingSalvar,
  referencia_ler: referenciaLer,
  referencias_importar_proprias: referenciasImportarProprias,
  plano_gerar: planoGerar,
  plano_conversar: planoConversar,
  criativos_produzir: criativosProduzir,
  copy_variar: copyVariar,
  resultados_ler: resultadosLer,
  aprendizado_registrar: aprendizadoRegistrar,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido" }, 405);
  try {
    const servico = clienteServico();
    const chamador = await identificar(req, servico);
    let corpo: Record<string, unknown> = {};
    try { corpo = await req.json(); } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? corpo.action ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", aceitas: Object.keys(ACOES) }, 400);
    return await fn(servico, chamador, corpo);
  } catch (err) {
    return respostaDeErro(err);
  }
});
