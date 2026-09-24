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
 * Mesa Ads v2 (docs/mesa-ads/v2/CONTRATO-V2.md):
 * - oferta_conversar { client_id, mensagem, conversa_id?, anexos? }: o agente da
 *   aba Oferta conversa, cria ofertas em ads_ofertas (conferidas pelo Jev e
 *   reescritas uma vez se houver alerta de política) e sugere ideias.
 * - oferta_salvar { client_id, oferta_id, campos?, status? } e
 *   oferta_listar { client_id }: sem IA.
 * - plano_gerar aceita oferta_id, objetivo, referencia_ids e modo; laço de
 *   qualidade no servidor (Jev em 6 notas, reescrita dos reprovados).
 * - conta_ao_vivo { client_id, dias? }: campanhas e anúncios com métricas,
 *   tendência e sinal em código. Grátis.
 * - conta_sincronizar { client_id }: collect_ads_now() como o usuário.
 * - conta_analisar { client_id, dias? }: leitura do estrategista (ads_analises).
 * - referencia_abrir { client_id, referencia_id, forcar? }: enriquece o link
 *   (página, imagens no bucket mesa) ou o anúncio próprio (imagem, copy, série).
 * - referencia_importar_url { client_id, url, titulo? }: cria e já abre.
 * - biblioteca_do_nicho { client_id, nicho?, quantidade? }: padrões E0 do nicho.
 * - copy_pacote { criativo_id? | plano_id? }: pacote de copy com conferência.
 * - pacote_enviar { client_id, plano_id?, criativo_ids?, criar_tarefa? }:
 *   Markdown em Arquivos (Criativos de anúncio) e tarefa do gestor de tráfego.
 *
 * Regras: só dado real; toda leitura e escrita presa ao client_id; nenhuma
 * falha responde 200; toda ação que gasta devolve custo_usd e saldo_usd;
 * números de conta vêm do código, nunca da IA; relógio de 400 s controlado
 * nos laços (rodadas de qualidade e pacote por plano).
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
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import {
  CONHECIMENTO_AGRESSIVO,
  CONHECIMENTO_ESTRATEGISTA_ADS,
  CTAS_META,
  ESCALA_DE_EVIDENCIA,
  ESTILOS_VISUAIS,
  ESTILOS_VISUAIS_IDS,
  METODO_DA_REFERENCIA,
  NICHOS,
  NIVEIS_CLAREZA,
  NIVEIS_DIFERENCIACAO,
  NIVEIS_FORCA_OFERTA,
  NIVEIS_PARADA,
  NIVEIS_PROVA,
  NIVEIS_RELEVANCIA,
  NIVEIS_RISCO_POLITICA,
  OBJETIVOS_DE_CAMPANHA,
  POLITICAS_META,
  REGRAS_DE_HONESTIDADE,
  regrasDoCriativo,
  TAMANHO_DO_FORMATO,
  textoDoNicho,
  type FormatoAds,
  type Nicho,
} from "../_shared/conhecimento-ads.ts";
import {
  alertaDePolitica,
  anguloAprovado,
  aplicarConferenciaNoPacote,
  cortarNaPalavra,
  type CriativoDoPacote,
  type Diaria,
  diagnosticar,
  direcaoDoResultado,
  ESTILOS_DE_TEXTO_PRINCIPAL,
  evidenciaDaImportacao,
  evidenciaDoAprendizado,
  extrairCopyDoRaw,
  idDoYoutube,
  imagensDoBehance,
  imagensDoReadme,
  ipv4Interno,
  ipv6Interno,
  lerMetaTags,
  maiorEvidencia,
  markdownDoPacote,
  type Metricas,
  motivosDoAngulo,
  normalizarPacoteCopy,
  notaDe0a10,
  origemDoLink,
  type PacoteCopy,
  pontuacaoDoAngulo,
  repoDoGithub,
  semTravessao,
  separarAngulos,
  serieDiaria,
  sinalDoAnuncio,
  somarMetricas,
  tendenciaDoAnuncio,
  textosDoPacote,
  tipoDoLink,
  urlPublicaSegura,
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
/** Conversa da aba Oferta (agente_conversas.referencia_tipo não tem check; referencia_id = client_id). */
const REF_OFERTA = "ads_oferta";

export const FORMATOS: FormatoAds[] = ["feed_4x5", "quadrado_1x1", "stories_9x16", "carrossel"];
const ESTAGIOS = ["inconsciente", "problema", "solucao", "produto", "mais_consciente"] as const;
const TIPOS_PROVA = ["depoimento", "numero", "caso", "certificacao", "demonstracao"] as const;
const TIPOS_DESTINO = ["whatsapp", "pagina", "formulario", "direct", "ligacao"] as const;
/** Ids de OBJETIVOS_DE_CAMPANHA (contrato v2): o briefing guarda o objetivo por eles. */
const ACOES_OBJETIVO = ["vendas", "mensagens", "leads", "seguidores", "agendamento", "trafego", "reconhecimento"] as const;
const STATUS_OFERTA = ["rascunho", "escolhida", "arquivada"] as const;

/** Relógio da função (plano Pro: 400 s). Laços longos param antes de estourar. */
const LIMITE_FUNCAO_MS = 400_000;
/** Tempo que uma chamada de texto mais a conferência do Jev podem levar, com folga. */
const TEMPO_DE_UMA_RODADA_MS = 165_000;
const MAX_RODADAS_QUALIDADE = 2;
const MAX_IMAGENS_REFERENCIA = 12;
const DOWNLOADS_EM_PARALELO = 4;
const MAX_BYTES_PAGINA = 3 * 1024 * 1024;
const TIMEOUT_BUSCA_MS = 15_000;
const URL_ASSINADA_S = 3600;
/** Imagens de anúncio próprio baixadas por importação (o resto fica para a próxima). */
const MAX_IMAGENS_POR_IMPORTACAO = 40;
const ETAPAS_CARROSSEL = ["tensao", "explicacao", "demonstracao", "objecao", "proximo_passo"] as const;

const MAX_CRIATIVOS_POR_CHAMADA = 24;
const ANGULOS_EM_PARALELO = 3;
const MAX_ANEXOS = 6;
const MAX_BYTES_IMAGEM = 12 * 1024 * 1024;
/** Memória de agente: agente_memoria aceita 'estrategista_ads' desde a migration 20260924021731. */
const MEMORIA_ACEITA_ESTRATEGISTA_ADS = true;

// ------------------------------------------------------------------ tipos

/** inicioMs: quando a requisição começou (controle do relógio de 400 s). */
type Chamador = { userId: string; token: string; inicioMs: number };

/** Milissegundos que ainda restam à requisição. */
const restanteMs = (ch: Chamador) => LIMITE_FUNCAO_MS - (Date.now() - ch.inicioMs);

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public extra: Record<string, unknown> = {}) {
    super(mensagem);
  }
}

/** Notas de 0 a 10, todas "mais alto é melhor"; em risco_politica, 10 = sem risco. */
type NotasJev = {
  clareza: number | null;
  relevancia: number | null;
  prova: number | null;
  risco_politica: number | null;
  parada: number | null;
  diferenciacao: number | null;
  alerta_politica: boolean;
};

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
  /** Id de ESTILOS_VISUAIS (v2). */
  estilo_visual: string | null;
  /** Id de OBJETIVOS_DE_CAMPANHA (v2). */
  objetivo: string | null;
  jev: NotasJev | null;
  /** Laço de qualidade (v2): nota final 0 a 10, rodadas de reescrita, aprovação e motivos. */
  pontuacao: number | null;
  rodadas: number;
  aprovado: boolean;
  motivos: string[];
  reprovado?: boolean;
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
  estilo_visual: Snulo(ESTILOS_VISUAIS_IDS),
  objetivo: Snulo(ACOES_OBJETIVO),
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
      estilo_visual: Snulo(ESTILOS_VISUAIS_IDS),
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

// ---- v2

const OFERTA_CAMPOS = {
  nome: S("string"),
  para_quem: S("string"),
  promessa: S("string"),
  mecanismo: S("string"),
  entregaveis: lista(S("string")),
  bonus: lista(S("string")),
  garantia: S(["string", "null"]),
  urgencia_real: S(["string", "null"]),
  ancoragem: S(["string", "null"]),
  cta: S("string"),
  provas_necessarias: lista(S("string")),
  riscos: lista(S("string")),
};

const ESQUEMA_IDEIA = obj({
  titulo: S("string"),
  gancho_verbal: S("string"),
  gancho_visual: S("string"),
  estilo_visual: S("string", { enum: [...ESTILOS_VISUAIS_IDS] }),
  formato: S("string", { enum: [...FORMATOS] }),
});

const ESQUEMA_OFERTA_CONVERSA = {
  nome: "conversa_de_oferta",
  schema: obj({
    resposta: S("string"),
    ofertas: lista(obj(OFERTA_CAMPOS)),
    briefing_sugerido: { ...obj(ESQUEMA_BRIEFING_CORPO), type: ["object", "null"] },
    ideias: lista(ESQUEMA_IDEIA),
  }),
};

const ESQUEMA_OFERTAS_REESCRITAS = {
  nome: "ofertas_reescritas",
  schema: obj({ ofertas: lista(obj({ indice: S("integer"), ...OFERTA_CAMPOS })) }),
};

const ESQUEMA_ANGULOS_REESCRITOS = { nome: "angulos_reescritos", schema: obj({ angulos: lista(ESQUEMA_ANGULO) }) };

const ESQUEMA_ANALISE_CONTA = {
  nome: "analise_da_conta",
  schema: obj({
    resumo: S("string"),
    escalar: lista(obj({ ad_id: S("string"), porque: S("string") })),
    pausar: lista(obj({ ad_id: S("string"), porque: S("string") })),
    renovar: lista(obj({ ad_id: S("string"), porque: S("string"), sugestao: S("string") })),
    copy: lista(obj({ achado: S("string"), recomendacao: S("string") })),
    proximos_testes: lista(obj({ titulo: S("string"), hipotese: S("string"), estilo_visual: Snulo(ESTILOS_VISUAIS_IDS), objetivo: Snulo(ACOES_OBJETIVO) })),
  }),
};

const esquemaPadroesDoNicho = () => ({
  nome: "padroes_do_nicho",
  schema: obj({
    padroes: lista(obj({
      titulo: S("string"),
      estilo_visual: S("string", { enum: [...ESTILOS_VISUAIS_IDS] }),
      formato: S("string", { enum: [...FORMATOS] }),
      situacao: S("string"),
      motivacao: S("string"),
      mecanismo: S("string"),
      gancho_visual: S("string"),
      gancho_verbal: S("string"),
      texto_apoio: S(["string", "null"]),
      argumento: S("string"),
      prova_sugerida: S(["string", "null"]),
      cta: S("string", { enum: [...CTAS_META] }),
      o_que_transportar: S("string"),
      o_que_substituir: S("string"),
      limites: S("string"),
      riscos_de_politica: S("string"),
      tags: lista(S("string")),
    })),
  }),
});

const ESQUEMA_PACOTE = {
  nome: "pacote_de_copy",
  schema: obj({
    textos_principais: lista(obj({ estilo: S("string", { enum: [...ESTILOS_DE_TEXTO_PRINCIPAL] }), texto: S("string") })),
    titulos: lista(S("string")),
    descricoes: lista(S("string")),
    ctas: lista(obj({ cta: S("string", { enum: [...CTAS_META] }), porque: S("string") })),
    ganchos: lista(S("string")),
    gestor: obj({
      objetivo_meta: S("string"),
      evento_otimizacao: S("string"),
      publico_sugerido: S("string"),
      conjuntos: lista(S("string")),
      utm: S("string"),
      regras_de_corte: lista(S("string")),
      regras_de_escala: lista(S("string")),
      verba: S(["string", "null"]),
    }),
  }),
};

const ESQUEMA_TEXTOS_REESCRITOS = {
  nome: "textos_reescritos",
  schema: obj({ textos: lista(obj({ chave: S("string"), texto: S("string") })) }),
};

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

async function identificar(req: Request, servico: SupabaseClient, inicioMs = Date.now()): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico.auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico.rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa a Mesa Ads.");
  return { userId, token, inicioMs };
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

const COLUNAS_DIARIA = "ad_id, campaign_id, day, spend, impressions, reach, clicks, link_clicks, frequency, actions";

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
  campaign_id: string | null;
  updated_at: string | null;
  /** Anúncio como a Meta devolveu (creative.object_story_spec): copy, CTA e destino. */
  raw: Record<string, unknown> | null;
};

/** comRaw: traz o anúncio inteiro da Meta (copy, CTA, destino); pesado, só quando a ação precisa. */
async function lerAnunciosDoCliente(servico: SupabaseClient, clientId: string, comRaw = false): Promise<AnuncioMeta[]> {
  const { data, error } = await servico
    .from("ads_creatives")
    .select(`ad_id, ad_name, titulo, corpo, destino, effective_status, image_url, thumbnail_url, video_id, campaign_id, updated_at${comRaw ? ", raw" : ""}`)
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new ErroHttp(503, "anuncios_indisponiveis", "Não foi possível ler os anúncios do cliente.");
  const vistos = new Set<string>();
  return ((data as unknown as AnuncioMeta[] | null) ?? []).map((a) => ({ ...a, raw: a.raw ?? null })).filter((a) => a.ad_id && !vistos.has(a.ad_id) && vistos.add(a.ad_id));
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

/**
 * Sistema do estrategista de ads: conhecimento inteiro (com as regras de
 * honestidade) mais as regras da execução. Na v2 o conhecimento já traz
 * estilos visuais, objetivos, oferta, agressivo, conta e pacote de copy
 * (conhecimento-ads.ts), então toda ação usa o mesmo sistema e o prompt só
 * leva os dados do caso (e o nicho do cliente, nunca a lista inteira).
 */
function sistemaDoEstrategista(): string {
  return `${CONHECIMENTO_ESTRATEGISTA_ADS}\n\n${REGRAS_DA_EXECUCAO}`;
}

const objetivoPorId = (id: unknown) => OBJETIVOS_DE_CAMPANHA.find((o) => o.id === id) ?? null;
const estiloPorId = (id: unknown) => ESTILOS_VISUAIS.find((e) => e.id === id) ?? null;

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

// notaDe0a10 e alertaDePolitica ficam em calculos.ts (testados).
// Risco de política em 0 a 10 com 10 = SEM risco (níveis do pior ao melhor).

function resumoDoBriefing(b: Briefing | null) {
  if (!b) return null;
  return { oferta: b.oferta, publico: b.publico, objecoes: b.objecoes, provas: b.provas, destino: b.destino, objetivo: b.objetivo, restricoes: b.restricoes };
}

/**
 * O Jev pontua cada ângulo em seis dimensões (Score de níveis ordenados):
 * clareza, relevância, força da prova, risco de política (10 = sem risco),
 * poder de parar a rolagem e diferenciação do "mais do mesmo". Só pontua os
 * ângulos sem nota. Falha do Jev não derruba o plano: nota null.
 */
async function pontuarAngulosComJev(
  angulos: Angulo[],
  briefing: Briefing | null,
  cobranca: { clientId: string; planoId: string; criadoPor: string },
  extra: { oferta?: Record<string, unknown> | null; jaRodou?: unknown[] } = {},
): Promise<{ angulos: Angulo[]; jev_erro: string | null; custo: number }> {
  const alvo = angulos.map((a, i) => ({ a, i })).filter((x) => !x.a.jev);
  if (!alvo.length) return { angulos, jev_erro: null, custo: 0 };
  const state = {
    oferta: extra.oferta ?? briefing?.oferta ?? "não informada",
    publico: briefing?.publico ?? "não informado",
    provas_disponiveis: briefing?.provas ?? [],
    destino: briefing?.destino ?? "não informado",
    politicas: POLITICAS_META,
    anuncios_que_o_cliente_ja_rodou: extra.jaRodou ?? [],
    angulos: alvo.map(({ a }) => ({
      nome: a.nome,
      situacao: a.situacao,
      mecanismo: a.mecanismo,
      prova: a.prova,
      gancho_visual: a.gancho_visual,
      gancho_verbal: a.gancho_verbal,
      hipotese: a.hipotese,
      estilo_visual: estiloPorId(a.estilo_visual)?.nome ?? null,
    })),
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
    questions[`parada_${k}`] = {
      type: "score",
      instructions: `Rolando o feed no celular, quanto o gancho visual e o gancho verbal do ângulo \`angulos[${k}]\` fazem o \`publico\` parar para olhar? Contraste, escala, surpresa com sentido e tensão contam; escurecer a foto não conta.`,
      criteria: NIVEIS_PARADA,
    };
    questions[`diferenciacao_${k}`] = {
      type: "score",
      instructions: `Quanto o ângulo \`angulos[${k}]\` foge do "mais do mesmo" da categoria (a mesma cena, a mesma frase, a mesma prova que todo concorrente usa) e dos \`anuncios_que_o_cliente_ja_rodou\`, sem perder a clareza da oferta?`,
      criteria: NIVEIS_DIFERENCIACAO,
    };
  });
  try {
    const r = await jevPerguntar({ state, questions });
    const cobrado = await cobrarJev(r, { clientId: cobranca.clientId, tarefa: TAREFA, referencia: { tipo: REF_PLANO, id: cobranca.planoId }, criadoPor: cobranca.criadoPor });
    const saida = [...angulos];
    alvo.forEach(({ a, i }, k) => {
      const risco = notaScore(r.answers[`risco_${k}`]);
      saida[i] = avaliarAngulo({
        ...a,
        jev: {
          clareza: notaDe0a10(notaScore(r.answers[`clareza_${k}`]), NIVEIS_CLAREZA.length),
          relevancia: notaDe0a10(notaScore(r.answers[`relevancia_${k}`]), NIVEIS_RELEVANCIA.length),
          prova: notaDe0a10(notaScore(r.answers[`prova_${k}`]), NIVEIS_PROVA.length),
          risco_politica: notaDe0a10(risco, NIVEIS_RISCO_POLITICA.length),
          parada: notaDe0a10(notaScore(r.answers[`parada_${k}`]), NIVEIS_PARADA.length),
          diferenciacao: notaDe0a10(notaScore(r.answers[`diferenciacao_${k}`]), NIVEIS_DIFERENCIACAO.length),
          alerta_politica: alertaDePolitica(risco),
        },
      });
    });
    return { angulos: saida, jev_erro: null, custo: cobrado?.custoUsd ?? 0 };
  } catch (err) {
    const codigo = err instanceof JevErro ? err.codigo : "jev_falhou";
    console.error("[mesa-ads] jev falhou", { codigo });
    return { angulos, jev_erro: codigo, custo: 0 };
  }
}

/** Aprovação, pontuação e motivos do ângulo pelas regras em código (calculos.ts). */
function avaliarAngulo(a: Angulo): Angulo {
  return { ...a, aprovado: anguloAprovado(a.jev), motivos: motivosDoAngulo(a.jev), pontuacao: pontuacaoDoAngulo(a.jev) };
}

/** risco_politica: 0 a 10, 10 = sem risco. */
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

const assinaturaDoAngulo = (a: Pick<Angulo, "situacao" | "mecanismo" | "prova" | "gancho_visual" | "gancho_verbal" | "hipotese"> & { estilo_visual?: string | null }) =>
  [a.situacao, a.mecanismo, a.prova, a.gancho_visual, a.gancho_verbal, a.hipotese, a.estilo_visual ?? ""].join("|");

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
    estilo_visual: doEnum(o.estilo_visual, ESTILOS_VISUAIS_IDS as readonly string[]),
    objetivo: doEnum(o.objetivo, ACOES_OBJETIVO),
    jev: null,
    pontuacao: null,
    rodadas: anterior?.rodadas ?? 0,
    aprovado: false,
    motivos: [],
  };
  // Ângulo que não mudou de conteúdo mantém as notas do Jev (e a avaliação).
  if (anterior && assinaturaDoAngulo(anterior) === assinaturaDoAngulo(a) && anterior.jev) return avaliarAngulo({ ...a, jev: anterior.jev });
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
  info: {
    conceito: string;
    fioVisual: string;
    ganchoVisual: string;
    ctaArte: string;
    /** v2: estilo visual do criativo e objetivo da campanha (vão para o layout e as regras). */
    estilo?: { id: string; nome: string; como_fazer: string } | null;
    objetivo?: { id: string; nome: string; como_o_criativo_muda: string } | null;
  },
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
    if (info.estilo) layout.tratamento = `${layout.tratamento}; estilo ${info.estilo.nome}: ${info.estilo.como_fazer}`.slice(0, 900);
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
    estilo_visual: info.estilo ? { id: info.estilo.id, nome: info.estilo.nome } : null,
    objetivo: info.objetivo ? { id: info.objetivo.id, nome: info.objetivo.nome } : null,
    regras_do_criativo: [
      regrasDoCriativo(formato),
      info.estilo ? `ESTILO VISUAL DESTA PEÇA (${info.estilo.nome}): ${info.estilo.como_fazer}` : "",
      info.objetivo ? `OBJETIVO DA CAMPANHA (${info.objetivo.nome}): ${info.objetivo.como_o_criativo_muda}` : "",
      CONHECIMENTO_AGRESSIVO,
      "Agressivo e vendedor dentro da política da Meta. Nunca escurecer a foto ou a capa para dar destaque: o destaque vem de contraste, composição, tipografia, escala e cor.",
    ].filter(Boolean).join("\n\n"),
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

/** Baixa uma imagem do bucket mesa (png, jpeg ou webp, até 12 MB). */
async function imagemDoMesa(servico: SupabaseClient, caminho: string, nome: string): Promise<ImagemEntrada | null> {
  const { data, error } = await servico.storage.from("mesa").download(caminho);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const mime = mimeDaImagem(bytes);
  return mime && bytes.byteLength <= MAX_BYTES_IMAGEM ? { bytes, mime, nome: `${nome}.${mime.split("/")[1]}` } : null;
}

/**
 * Imagens da referência para o leitor (até 3): o print da equipe, a galeria
 * guardada na abertura e, sem nada disso, o link público (busca segura).
 * Caminho só da pasta do cliente ou das pastas compartilhadas da agência.
 */
async function imagensDaReferencia(
  servico: SupabaseClient,
  clientId: string,
  ref: { client_id: string | null; storage_path: string | null; url: string | null; ficha?: Record<string, unknown> | null },
): Promise<ImagemEntrada[]> {
  const caminhos: string[] = [];
  if (caminhoPermitido(ref, clientId, ref.storage_path)) caminhos.push(ref.storage_path);
  const galeria = Array.isArray(ref.ficha?.galeria) ? ref.ficha!.galeria as { caminho?: unknown }[] : [];
  for (const g of galeria) if (caminhoPermitido(ref, clientId, g?.caminho) && !caminhos.includes(g.caminho as string)) caminhos.push(g.caminho as string);
  const imagens: ImagemEntrada[] = [];
  for (const c of caminhos.slice(0, 3)) {
    const img = await imagemDoMesa(servico, c, `referencia-${imagens.length + 1}`);
    if (img) imagens.push(img);
  }
  if (imagens.length || !ref.url) return imagens;
  const tipo = urlPublicaSegura(ref.url) ? tipoDoLink(new URL(ref.url)) : null;
  if (tipo !== "imagem") return imagens;
  const b = await buscarSeguro(ref.url, { maxBytes: MAX_BYTES_IMAGEM, aceitar: "image/webp,image/png,image/jpeg;q=0.9,image/*;q=0.5" });
  const mime = b ? mimeDaImagem(b.bytes) : null;
  if (b && mime) imagens.push({ bytes: b.bytes, mime, nome: `referencia.${mime.split("/")[1]}` });
  return imagens;
}

/**
 * referencia_ler { client_id, referencia_id, modelo_id?, raciocinio? } -> { referencia, custo_usd, saldo_usd }
 * v2: aceita a biblioteca da agência (grava a ficha nela); abre a referência
 * antes se ainda não foi aberta; lê imagens, página, copy e métricas reais.
 */
async function referenciaLer(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  let ref = await carregarReferencia(servico, clientId, corpo.referencia_id);
  // Sem abertura ainda: enriquece primeiro (galeria, página, copy do anúncio), sem IA.
  if (!ref.ficha.aberta_em) {
    ref = (await abrirReferenciaInterna(servico, clientId, ref, false)).referencia;
    ref.ficha = (ref.ficha ?? {}) as Record<string, unknown>;
  }
  const imagens = await imagensDaReferencia(servico, clientId, ref);
  const pagina = (ref.ficha.pagina ?? null) as PaginaRef | null;
  const m = (ref.metricas ?? {}) as Record<string, unknown>;
  const metricasReais = ref.ad_id && Object.keys(m).length
    ? { gasto: m.gasto ?? null, impressoes: m.impressoes ?? null, cliques_saida: m.cliques_saida ?? null, ctr_saida_pct: m.ctr_saida_pct ?? null, resultados: m.resultados ?? null, resultados_por_tipo: m.resultados_por_tipo ?? null, custo_por_resultado: m.custo_por_resultado ?? null, periodo: [m.inicio ?? null, m.fim ?? null] }
    : null;
  const copyDoAnuncio = ref.ad_id
    ? { titulo: ref.ficha.gancho_verbal ?? null, texto: ref.ficha.texto_apoio ?? null, descricao: ref.ficha.descricao_anuncio ?? null, cta: ref.ficha.cta ?? null, destino: ref.ficha.destino ?? null }
    : null;
  if (!imagens.length && !pagina && !copyDoAnuncio) {
    throw new ErroHttp(422, "referencia_sem_imagem", "Não consegui abrir a imagem nem a página desta referência (o link pode ter expirado ou o site bloqueou). Suba o print na referência e tente de novo.");
  }

  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "leitura", "low");
  const contexto = [
    `Referência: "${ref.titulo}"${ref.url ? ` (${ref.url})` : ""}. Origem: ${ref.client_id ? (ref.ad_id ? "anúncio próprio do cliente" : "referência do cliente") : "biblioteca da agência"}. Evidência atual: ${ref.evidencia} (a leitura não muda a evidência).`,
    pagina ? `PÁGINA DO LINK (lida pelo painel): ${JSON.stringify(pagina).slice(0, 5000)}` : "",
    copyDoAnuncio ? `COPY DO ANÚNCIO (como a Meta devolveu): ${JSON.stringify(copyDoAnuncio)}` : "",
    metricasReais ? `MÉTRICAS REAIS DO ANÚNCIO (somadas pelo painel em ads_creative_daily; são fato, não leitura da imagem): ${JSON.stringify(metricasReais)}` : "",
    imagens.length ? `Preencha a ficha a partir das ${imagens.length} imagem(ns) anexa(s) e do contexto acima.` : "Não há imagem: preencha só o que a página ou a copy permitem e deixe null o resto; diga em limites que a leitura foi sem imagem.",
  ].filter(Boolean).join("\n\n");
  const s = await chamarTexto({
    clientId,
    tarefa: TAREFA,
    agente: AGENTE_LEITOR,
    modeloId: modelo.id,
    sistema: SISTEMA_DO_LEITOR,
    mensagens: [{ papel: "usuario", conteudo: contexto, imagens: imagens.length ? imagens : undefined }],
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
  for (const c of campos) {
    const v = textoOuNulo(r[c], 1200);
    // A copy real do anúncio (vinda da Meta) não é trocada pela leitura.
    if (copyDoAnuncio && ["gancho_verbal", "texto_apoio", "cta", "destino"].includes(c) && !vazio(ficha[c])) continue;
    ficha[c] = v;
  }
  ficha.observado = texto(r.observado, 3000);
  ficha.inferido = texto(r.inferido, 3000);
  ficha.mecanismo = texto(r.mecanismo, 600);
  ficha.limites = texto(r.limites, 1200);
  ficha.lido_em = new Date().toISOString();
  ficha.lido_por_modelo = s.modeloId;
  ficha.lido_com = { imagens: imagens.length, pagina: !!pagina, copy_do_anuncio: !!copyDoAnuncio, metricas_reais: !!metricasReais };
  const tags = [...new Set([...(ref.tags ?? []), ...(Array.isArray(r.tags) ? r.tags : []).map((t) => texto(t, 40).toLowerCase()).filter(Boolean)])].slice(0, 20);
  let gravada: LinhaReferencia;
  try {
    gravada = await gravarReferencia(servico, ref, {
      ficha,
      mecanismo: texto(r.mecanismo, 600) || null,
      tags,
      formato: ref.formato ?? textoOuNulo(r.formato, 60),
      plataforma: ref.plataforma ?? textoOuNulo(r.plataforma, 60),
      titulo: ref.titulo || texto(r.titulo, 200) || "Referência",
    });
  } catch {
    throw new ErroHttp(503, "ficha_nao_salva", "A leitura foi feita, mas a ficha não foi salva.", { uso_id: s.usoId });
  }
  return json({ referencia: gravada, custo_usd: s.custoUsd, saldo_usd: s.saldoUsd });
}

/** Métricas de um anúncio no formato guardado na referência. */
function metricasDaReferencia(m: Metricas) {
  return { ...m, fonte: "ads_creative_daily", somado_em: new Date().toISOString() };
}

/**
 * referencias_importar_proprias { client_id }
 * -> { importadas, atualizadas, falhas, e3, imagens_baixadas, imagens_pendentes, avisos, referencias, custo_usd: 0 } (grátis, sem IA).
 * v2: preenche copy, CTA e destino a partir do raw da Meta e baixa a imagem
 * para o bucket mesa (o link da Meta expira), até o limite por importação.
 */
async function referenciasImportarProprias(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const anuncios = await lerAnunciosDoCliente(servico, clientId, true);
  if (!anuncios.length) return json({ importadas: 0, atualizadas: 0, falhas: 0, e3: 0, imagens_baixadas: 0, imagens_pendentes: 0, avisos: [], referencias: [], custo_usd: 0 });
  const diarias = porAnuncio(await lerDiarias(servico, clientId, { adIds: anuncios.map((a) => a.ad_id) }));
  const { data: existentes, error } = await servico.from("ads_referencias").select("id, ad_id, evidencia, ficha, storage_path").eq("client_id", clientId).not("ad_id", "is", null);
  if (error) throw new ErroHttp(503, "referencias_indisponiveis", "Não foi possível ler as referências do cliente.");
  type Existente = { id: string; ad_id: string; evidencia: string; ficha: Record<string, unknown> | null; storage_path: string | null };
  const jaTem = new Map(((existentes as Existente[] | null) ?? []).map((e) => [e.ad_id, e]));

  // A tabela tem índice único parcial (client_id, ad_id): upsert do PostgREST não o
  // enxerga, então atualiza quem existe e insere quem falta.
  const novas: Record<string, unknown>[] = [];
  const atualizar: { id: string; campos: Record<string, unknown> }[] = [];
  const copias = new Map<string, ReturnType<typeof extrairCopyDoRaw>>();
  let e3 = 0;
  for (const a of anuncios) {
    const m = somarMetricas(diarias.get(a.ad_id) ?? []);
    const anterior = jaTem.get(a.ad_id);
    const evidencia = evidenciaDaImportacao(m, anterior?.evidencia);
    if (evidencia === "E3" || evidencia === "E4") e3++;
    const copy = extrairCopyDoRaw(a.raw, a);
    copias.set(a.ad_id, copy);
    // Só o que a Meta devolveu do anúncio (observado); a leitura completa vem do leitor.
    const daMeta: Record<string, unknown> = {
      observado: [copy.titulo ? `Título: ${copy.titulo}` : "", copy.corpo ? `Texto: ${copy.corpo}` : "", copy.descricao ? `Descrição: ${copy.descricao}` : "", copy.cta ? `Botão: ${copy.cta}` : "", copy.destino ? `Destino: ${copy.destino}` : ""].filter(Boolean).join("\n") || null,
      gancho_verbal: copy.titulo,
      texto_apoio: copy.corpo,
      descricao_anuncio: copy.descricao,
      cta: copy.cta,
      destino: copy.destino,
    };
    // Na atualização, título, print (storage_path) e ficha que a equipe ajustou ficam como estão.
    const campos: Record<string, unknown> = {
      url: copy.imagem_url || copy.miniatura_url || null,
      origem: "anuncio_proprio",
      plataforma: "meta",
      formato: copy.video_id ? "video" : "imagem",
      evidencia,
      metricas: metricasDaReferencia(m),
    };
    if (anterior) {
      const ficha: Record<string, unknown> = { ...(anterior.ficha ?? {}) };
      let mudou = false;
      for (const [k, v] of Object.entries(daMeta)) {
        if (vazio(ficha[k]) && !vazio(v)) {
          ficha[k] = v;
          mudou = true;
        }
      }
      atualizar.push({ id: anterior.id, campos: mudou ? { ...campos, ficha } : campos });
    } else {
      novas.push({
        ...campos,
        titulo: texto(a.ad_name, 200) || texto(copy.titulo, 200) || `Anúncio ${a.ad_id}`,
        storage_path: null,
        client_id: clientId,
        ad_id: a.ad_id,
        ficha: daMeta,
        criado_por: chamador.userId,
      });
    }
  }
  const semImagem: { id: string; ad_id: string }[] = [];
  if (novas.length) {
    const { data: inseridas, error: erroInserir } = await servico.from("ads_referencias").insert(novas).select("id, ad_id");
    if (erroInserir) throw new ErroHttp(503, "referencias_nao_importadas", "Não foi possível importar os anúncios do cliente.");
    semImagem.push(...((inseridas as { id: string; ad_id: string }[] | null) ?? []));
  }
  let falhas = 0;
  for (const u of atualizar) {
    const { error: e } = await servico.from("ads_referencias").update(u.campos).eq("id", u.id).eq("client_id", clientId);
    if (e) falhas++;
  }
  if (falhas && falhas === atualizar.length && !novas.length) throw new ErroHttp(503, "referencias_nao_atualizadas", "Não foi possível atualizar as referências dos anúncios.");
  for (const e of jaTem.values()) if (!e.storage_path) semImagem.push({ id: e.id, ad_id: e.ad_id });

  // Imagens: o link da Meta expira, então a imagem vai para o bucket mesa (limite por vez e relógio).
  const avisos: string[] = [];
  const agora = semImagem.slice(0, MAX_IMAGENS_POR_IMPORTACAO);
  let baixadas = 0;
  let naoAbriram = 0;
  let foraDoTempo = 0;
  await emParalelo(agora, DOWNLOADS_EM_PARALELO, async (x) => {
    if (restanteMs(chamador) < 60_000) {
      foraDoTempo++;
      return;
    }
    const copy = copias.get(x.ad_id);
    let guardada: { caminho: string } | null = null;
    for (const fonte of [copy?.imagem_url, copy?.miniatura_url].filter((f): f is string => !!f)) {
      guardada = await guardarImagem(servico, fonte, `${clientId}/ads-proprios/${idSeguro(x.ad_id)}`);
      if (guardada) break;
    }
    if (!guardada) {
      naoAbriram++;
      return;
    }
    const { error: e } = await servico.from("ads_referencias").update({ storage_path: guardada.caminho }).eq("id", x.id).eq("client_id", clientId).is("storage_path", null);
    if (e) naoAbriram++;
    else baixadas++;
  });
  const pendentes = semImagem.length - baixadas - naoAbriram;
  if (naoAbriram) avisos.push(`${naoAbriram} imagem(ns) da Meta não abriram (link expirado): sincronize a conta e importe de novo.`);
  if (pendentes > 0 || foraDoTempo) avisos.push(`${Math.max(pendentes, foraDoTempo)} imagem(ns) ficaram para a próxima importação.`);
  const { data: referencias } = await servico.from("ads_referencias").select("*").eq("client_id", clientId).eq("origem", "anuncio_proprio").order("criado_em", { ascending: false }).limit(500);
  return json({
    importadas: novas.length,
    atualizadas: atualizar.length - falhas,
    falhas,
    e3,
    imagens_baixadas: baixadas,
    imagens_pendentes: Math.max(0, pendentes),
    avisos,
    referencias: referencias ?? [],
    custo_usd: 0,
  });
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

/** Oferta de ads_ofertas no formato do contrato (Oferta). */
type LinhaOferta = {
  id: string;
  client_id: string;
  briefing_id: string | null;
  conversa_id: string | null;
  nome: string;
  oferta: Record<string, unknown>;
  jev: Record<string, unknown> | null;
  status: string;
  criado_em: string;
  atualizado_em: string;
};

function ofertaDaLinha(l: LinhaOferta) {
  const o = (l.oferta ?? {}) as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
  return {
    id: l.id,
    nome: l.nome,
    para_quem: String(o.para_quem ?? ""),
    promessa: String(o.promessa ?? ""),
    mecanismo: String(o.mecanismo ?? ""),
    entregaveis: lista(o.entregaveis),
    bonus: lista(o.bonus),
    garantia: (o.garantia as string | null) ?? null,
    urgencia_real: (o.urgencia_real as string | null) ?? null,
    ancoragem: (o.ancoragem as string | null) ?? null,
    cta: String(o.cta ?? ""),
    provas_necessarias: lista(o.provas_necessarias),
    riscos: lista(o.riscos),
    status: l.status,
    jev: (l.jev ?? null) as { clareza: number | null; forca: number | null; risco_politica: number | null; alerta_politica: boolean } | null,
    briefing_id: l.briefing_id,
    conversa_id: l.conversa_id,
    criado_em: l.criado_em,
    atualizado_em: l.atualizado_em,
  };
}

async function carregarOferta(servico: SupabaseClient, clientId: string, id: unknown): Promise<LinhaOferta> {
  const oid = String(id ?? "");
  if (!UUID.test(oid)) throw new ErroHttp(400, "oferta_id_invalido", "oferta_id precisa ser um UUID.");
  const { data, error } = await servico.from("ads_ofertas").select("*").eq("id", oid).eq("client_id", clientId).maybeSingle();
  if (error) throw new ErroHttp(503, "oferta_indisponivel", "Não foi possível ler a oferta.");
  if (!data) throw new ErroHttp(404, "oferta_inexistente", "Oferta não encontrada para este cliente.");
  return data as LinhaOferta;
}

type ReferenciaCompleta = ReferenciaResumo & { url: string | null; storage_path: string | null; ad_id: string | null; formato: string | null; plataforma: string | null };

/** Exemplos escolhidos pela equipe (do cliente ou da biblioteca da agência). */
async function carregarExemplos(servico: SupabaseClient, clientId: string, bruto: unknown): Promise<ReferenciaCompleta[]> {
  const ids = [...new Set((Array.isArray(bruto) ? bruto : []).map(String).filter((x) => UUID.test(x)))].slice(0, 8);
  if (!ids.length) return [];
  const { data, error } = await servico
    .from("ads_referencias")
    .select("id, client_id, titulo, mecanismo, evidencia, destaque, origem, tags, ficha, metricas, url, storage_path, ad_id, formato, plataforma")
    .in("id", ids);
  if (error) throw new ErroHttp(503, "referencias_indisponiveis", "Não foi possível ler as referências escolhidas.");
  return ((data as ReferenciaCompleta[] | null) ?? []).filter((r) => r.client_id === null || r.client_id === clientId);
}

/** Exemplo escolhido para o prompt: mecanismo, ficha, copy e métricas reais (do código). */
function exemploParaPrompt(r: ReferenciaCompleta) {
  const f = r.ficha ?? {};
  const m = (r.metricas ?? {}) as Record<string, unknown>;
  return {
    ...resumoDaReferencia(r),
    origem: r.origem,
    anuncio_proprio: !!r.ad_id,
    situacao: f.situacao ?? null,
    motivacao: f.motivacao ?? null,
    texto_apoio: f.texto_apoio ?? null,
    argumento: f.argumento ?? null,
    prova: f.prova ?? null,
    cta: f.cta ?? null,
    estilo_visual: f.estilo_visual ?? null,
    metricas_reais: r.ad_id && Object.keys(m).length
      ? { gasto: m.gasto ?? null, impressoes: m.impressoes ?? null, resultados: m.resultados ?? null, custo_por_resultado: m.custo_por_resultado ?? null, ctr_saida_pct: m.ctr_saida_pct ?? null, periodo: [m.inicio ?? null, m.fim ?? null] }
      : null,
  };
}

/** O que o cliente já rodou (títulos e começo do texto), para o Jev medir a diferenciação. */
function jaRodouDoContexto(ctx: ContextoAds): unknown[] {
  const bloco = (ctx.dados.anuncios_ultimos_90_dias ?? {}) as { com_entrega?: { titulo: string | null; texto: string | null }[] };
  return (bloco.com_entrega ?? []).slice(0, 10).map((a) => ({ titulo: a.titulo, texto: a.texto ? a.texto.slice(0, 160) : null }));
}

/**
 * plano_gerar { client_id, briefing_id?, pedido?, quantidade_angulos? (3 a 6), oferta_id?, objetivo?,
 *   referencia_ids?, modo? ("novo" | "variar_vencedor"), modelo_id?, raciocinio? }
 * -> { plano, lacunas, aviso, qualidade, custo_usd, saldo_usd, jev_erro }
 * Laço de qualidade ANTES de devolver: o Jev dá as 6 notas; o reprovado volta
 * ao estrategista com os motivos e é repontuado (até 2 rodadas, dentro do
 * relógio). Ordem final por pontuação; reprovados vão para estrutura.descartados.
 */
async function planoGerar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const briefing = await carregarBriefing(servico, clientId, corpo.briefing_id);
  if (!briefing) throw new ErroHttp(409, "sem_briefing", "Salve o briefing do cliente (etapa Oferta) antes de gerar o plano.");
  const qtd = Math.min(6, Math.max(3, Math.round(Number(corpo.quantidade_angulos) || 4)));
  const pedidoEquipe = texto(corpo.pedido, 2000);
  const modo = corpo.modo === "variar_vencedor" ? "variar_vencedor" : "novo";
  if (corpo.objetivo != null && corpo.objetivo !== "" && !objetivoPorId(corpo.objetivo)) {
    throw new ErroHttp(400, "objetivo_invalido", `Objetivo desconhecido. Use um de: ${ACOES_OBJETIVO.join(", ")}.`);
  }
  const objetivo = objetivoPorId(corpo.objetivo) ?? objetivoPorId((briefing.objetivo ?? {}).acao);
  const [ofertaLinha, ctx, refs, exemplos] = await Promise.all([
    corpo.oferta_id ? carregarOferta(servico, clientId, corpo.oferta_id) : Promise.resolve(null),
    montarContextoAds(servico, clientId),
    referenciasParaOPlano(servico, clientId),
    carregarExemplos(servico, clientId, corpo.referencia_ids),
  ]);
  if (modo === "variar_vencedor" && !exemplos.length) {
    throw new ErroHttp(400, "sem_vencedor", "Para variar um vencedor, escolha ao menos um anúncio ou referência de exemplo.");
  }
  const oferta = ofertaLinha ? ofertaDaLinha(ofertaLinha) : null;
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista", "high");
  const refsValidas = new Set([...refs.map((r) => r.id), ...exemplos.map((r) => r.id)]);
  const jaRodou = jaRodouDoContexto(ctx);

  const planoId = crypto.randomUUID();
  const achado = await nichoDoCliente(ctx, briefing, { clientId, referencia: { tipo: REF_PLANO, id: planoId }, criadoPor: chamador.userId }, corpo.nicho);
  const conversaId = await abrirConversa(servico, clientId, planoId, chamador.userId);
  const pedido = `Gere um plano de teste com ${qtd} ângulos para os anúncios deste cliente${modo === "variar_vencedor" ? ", variando o vencedor escolhido" : ""}.${pedidoEquipe ? ` Pedido da equipe: ${pedidoEquipe}` : ""}`;
  const ofertaParaPrompt = oferta ? (({ status: _s, jev: _j, briefing_id: _b, conversa_id: _c, criado_em: _ce, atualizado_em: _ae, ...o }) => o)(oferta) : null;
  const instrucao = `DADOS REAIS DO CLIENTE (JSON; null ou vazio = não existe):
${JSON.stringify(ctx.dados, null, 1)}

BRIEFING DE PERFORMANCE (versão ${briefing.versao}):
${JSON.stringify(resumoDoBriefing(briefing), null, 1)}

${achado.nicho ? textoDoNicho(achado.nicho) : "NICHO: não identificado com segurança; use o negócio descrito nos dados."}

OFERTA ESCOLHIDA PARA ESTE PLANO: ${JSON.stringify(ofertaParaPrompt)}

OBJETIVO DA CAMPANHA: ${JSON.stringify(objetivo ?? null)}

EXEMPLOS ESCOLHIDOS PELA EQUIPE (métricas reais só dos anúncios próprios, lidas do painel):
${JSON.stringify(exemplos.map(exemploParaPrompt), null, 1)}

REFERÊNCIAS DISPONÍVEIS (use os ids; destaque primeiro; biblioteca_da_agencia é estudo de mecanismo, E0):
${JSON.stringify(refs.map(resumoDaReferencia), null, 1)}

TAREFA: ${pedido}
Regras dos ângulos:
- Exatamente ${qtd} ângulos REALMENTE diferentes: cada um combina uma situação do público, um mecanismo, uma prova e um estilo visual diferentes (vinte paráfrases não são vinte conceitos).
- Agressivo e vendedor dentro da política: o gancho tem que parar a rolagem e a peça tem que levar à ação do objetivo. Nada de "mais do mesmo" da categoria nem repetir o que o cliente já rodou.
- situacao: a cena concreta vivida pelo comprador, com a linguagem dele, ligada a uma situação do briefing.
- mecanismo e tecnica: qual das dezoito técnicas e qual mecanismo (sem citar marca de terceiros).
- prova: só prova do briefing, com a fonte; se não houver, diga "sem prova no briefing" e use demonstração ou mecanismo.
- gancho_visual: o que aparece na imagem e faz parar a rolagem (sem escurecer a foto: contraste, composição, tipografia, escala e cor); gancho_verbal: a headline curta (até 7 palavras).
- estilo_visual: um id da lista de estilos; ângulos diferentes usam estilos diferentes sempre que fizer sentido. Evite estilo de risco de política alto.
- objetivo: ${objetivo ? `"${objetivo.id}"` : "o id do objetivo que o briefing sustenta, ou null"}.
- hipotese no formato: "Acreditamos que [situação + mecanismo] aumentará [resultado], porque [evidência do público]. Vamos comparar com [base] durante [janela], mantendo [condições] e registrando [dados]."
- metrica: a métrica do negócio que decide (pelo objetivo), não só clique. janela_dias: de 3 a 60.
- formatos: entre feed_4x5, quadrado_1x1, stories_9x16 e carrossel (carrossel quando a sequência explica melhor). variacoes: 1 a 3.
- referencia_ids: ids da lista acima ou dos exemplos que inspiraram o ângulo (referências do cliente em destaque primeiro); nunca invente id.
${modo === "variar_vencedor" ? "- MODO VARIAR VENCEDOR: mantenha o mecanismo e a promessa do(s) exemplo(s) vencedor(es) e mude a execução (gancho, prova, estilo visual ou formato), uma variável principal por ângulo, dizendo na hipótese qual variável mudou e contra qual base (o vencedor).\n" : ""}- estrutura: conjuntos de anúncio sugeridos, verba só se o briefing tiver verba (senão null), janela e observações.
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
  let custo = s.custoUsd + achado.custo;
  let saldo = s.saldoUsd;
  const comObjetivo = (a: Angulo): Angulo => ({ ...a, objetivo: a.objetivo ?? objetivo?.id ?? null });
  let angulos = (Array.isArray(r.angulos) ? r.angulos : []).slice(0, 6).map((a, i) => comObjetivo(normalizarAngulo(a, `a${i + 1}`, refsValidas))).filter((a) => a.nome && a.situacao);
  const cobranca = { clientId, planoId, criadoPor: chamador.userId };
  const extraJev = { oferta: ofertaParaPrompt as Record<string, unknown> | null, jaRodou };
  const primeira = await pontuarAngulosComJev(angulos, briefing, cobranca, extraJev);
  angulos = primeira.angulos;
  custo += primeira.custo;
  let jevErro = primeira.jev_erro;
  const avisos: string[] = [];

  // Laço de qualidade: reescreve só os reprovados, com os motivos, e repontua.
  let rodadas = 0;
  while (!jevErro && rodadas < MAX_RODADAS_QUALIDADE && angulos.some((a) => !a.aprovado)) {
    if (restanteMs(chamador) < TEMPO_DE_UMA_RODADA_MS) {
      avisos.push("O tempo da função acabou antes de todas as rodadas de qualidade.");
      break;
    }
    rodadas++;
    const reprovados = angulos.filter((a) => !a.aprovado);
    const aprovados = angulos.filter((a) => a.aprovado);
    let reescrita;
    try {
      reescrita = await chamarTexto({
        clientId,
        tarefa: TAREFA,
        agente: AGENTE,
        modeloId: modelo.id,
        sistema: sistemaDoEstrategista(),
        mensagens: [{
          papel: "usuario",
          conteudo: `BRIEFING: ${JSON.stringify(resumoDoBriefing(briefing))}
OFERTA: ${JSON.stringify(ofertaParaPrompt)}
OBJETIVO: ${JSON.stringify(objetivo ?? null)}
REFERÊNCIAS (ids válidos): ${JSON.stringify([...refs, ...exemplos].map((x) => ({ id: x.id, titulo: x.titulo, mecanismo: x.mecanismo })))}
ÂNGULOS JÁ APROVADOS (não repita situação, mecanismo nem estilo deles): ${JSON.stringify(aprovados.map((a) => ({ id: a.id, nome: a.nome, situacao: a.situacao, mecanismo: a.mecanismo, estilo_visual: a.estilo_visual })))}
ÂNGULOS REPROVADOS NA CONFERÊNCIA (notas de 0 a 10; em risco_politica, 10 = sem risco):
${JSON.stringify(reprovados.map(({ jev, motivos, pontuacao: _p, aprovado: _a, rodadas: _r, reprovado: _x, ...a }) => ({ ...a, notas: jev, motivos })), null, 1)}

Regra de aprovação: clareza >= 7, relevância >= 7, parar a rolagem >= 6, diferenciação >= 6, risco de política >= 7 (10 = sem risco) e sem alerta.
TAREFA: reescreva SOMENTE os ângulos reprovados, mantendo o mesmo id, corrigindo cada motivo: oferta mais clara para quem lê no celular, situação mais específica do público, gancho visual e verbal que param a rolagem (contraste, escala, tensão; nunca escurecer a foto), fuga do clichê da categoria e zero risco de política (sem atributo pessoal, promessa de resultado, antes e depois, sensacionalismo ou imitação de interface). Mesmas regras de hipótese, prova (só do briefing) e referências. Devolva só os reescritos.`,
        }],
        raciocinio,
        esquemaJson: ESQUEMA_ANGULOS_REESCRITOS,
        referencia: { tipo: REF_PLANO, id: planoId },
        criadoPor: chamador.userId,
      });
    } catch (err) {
      // Saldo, cota ou provedor falharam no meio: o plano sai com o que já foi conferido.
      avisos.push(`A rodada ${rodadas} de qualidade não foi feita: ${err instanceof Error ? err.message : "falha do estrategista"}.`);
      rodadas--;
      break;
    }
    custo += reescrita.custoUsd;
    saldo = reescrita.saldoUsd;
    const novos = new Map(
      (((reescrita.json as Record<string, unknown> | undefined)?.angulos as unknown[] | undefined) ?? [])
        .map((b) => [String((b as Record<string, unknown>)?.id ?? ""), b] as const),
    );
    angulos = angulos.map((a) => {
      if (a.aprovado || !novos.has(a.id)) return a;
      const novo = comObjetivo(normalizarAngulo(novos.get(a.id), a.id, refsValidas));
      return novo.nome && novo.situacao ? { ...novo, rodadas: a.rodadas + 1 } : a;
    });
    const repontuado = await pontuarAngulosComJev(angulos, briefing, cobranca, extraJev);
    angulos = repontuado.angulos;
    custo += repontuado.custo;
    if (repontuado.jev_erro) jevErro = repontuado.jev_erro;
  }

  let principais: Angulo[];
  let descartados: Angulo[];
  if (jevErro) {
    // Sem a conferência não há como aprovar nem descartar: tudo fica, marcado sem nota.
    principais = angulos.map((a) => (a.jev ? a : { ...a, aprovado: false, motivos: ["Sem nota do Jev: a conferência não respondeu."] }));
    descartados = [];
    avisos.push("O Jev não respondeu: os ângulos ficaram sem a conferência de qualidade.");
  } else {
    const separados = separarAngulos(angulos, 3);
    principais = separados.principais;
    descartados = separados.descartados;
  }
  const aprovadosTotal = angulos.filter((a) => a.aprovado).length;
  const qualidade = { rodadas, aprovados: aprovadosTotal, reprovados: angulos.length - aprovadosTotal };
  const estrutura = normalizarEstrutura(r.estrutura, new Set(principais.map((a) => a.id)));
  const lacunas = (Array.isArray(r.lacunas) ? r.lacunas : []).map((l) => texto(l, 400)).filter(Boolean);
  if (principais.length < 3) avisos.push(`O estrategista devolveu ${principais.length} ângulos (o pedido era ${qtd}).`);
  if (principais.some((a) => a.reprovado)) avisos.push("Menos de 3 ângulos passaram na conferência: os melhores reprovados ficaram na lista, marcados como reprovados.");
  const aviso = avisos.length ? avisos.join(" ") : null;
  custo = arred6(custo);

  const { data: plano, error } = await servico
    .from("ads_planos")
    .insert({
      id: planoId,
      client_id: clientId,
      briefing_id: briefing.id,
      nome: texto(r.nome, 120) || `Plano de teste ${hojeSaoPaulo()}`,
      status: "rascunho",
      angulos: principais,
      estrutura: {
        ...estrutura,
        lacunas,
        resumo: texto(r.resumo, 3000),
        jev_erro: jevErro,
        objetivo: objetivo?.id ?? null,
        oferta_id: oferta?.id ?? null,
        nicho: achado.nicho?.id ?? null,
        modo,
        referencia_ids: exemplos.map((x) => x.id),
        descartados,
        qualidade,
      },
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
      conteudo: `${texto(r.resumo, 3000)}\n\nÂngulos:\n${principais.map((a) => `${a.id}. ${a.nome}${a.pontuacao != null ? ` (nota ${String(a.pontuacao).replace(".", ",")})` : ""}: ${a.hipotese}`).join("\n")}${descartados.length ? `\n\nDescartados na conferência: ${descartados.map((a) => `${a.nome} (${a.motivos.join(" ")})`).join("; ")}` : ""}${lacunas.length ? `\n\nLacunas: ${lacunas.join("; ")}` : ""}`,
      uso_id: s.usoId,
    },
  ]);
  return json({ plano, lacunas, aviso, qualidade, custo_usd: custo, saldo_usd: saldo, jev_erro: jevErro, reserva_usada: s.reservaUsada ?? null });
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

  // Objetivo do plano (v2): o do ângulo, o do plano ou o do briefing.
  const objetivoDoPlano = objetivoPorId(p.estrutura.objetivo) ?? objetivoPorId((briefing?.objetivo ?? {}).acao);

  const produzirAngulo = async (a: Angulo) => {
    const formatos = formatosDo(a);
    const estilo = estiloPorId(a.estilo_visual);
    const objetivo = objetivoPorId(a.objetivo) ?? objetivoDoPlano;
    const pedido = `BRIEFING: ${JSON.stringify(resumoDoBriefing(briefing))}
MARCA: ${JSON.stringify({ nome: marca.nomeCliente, tom_de_voz: marca.tomDeVoz, regras: marca.regras })}
ÂNGULO: ${JSON.stringify({ nome: a.nome, situacao: a.situacao, mecanismo: a.mecanismo, tecnica: a.tecnica, prova: a.prova, gancho_visual: a.gancho_visual, gancho_verbal: a.gancho_verbal, hipotese: a.hipotese, estagio: a.estagio_consciencia })}
ESTILO VISUAL DO ÂNGULO: ${JSON.stringify(estilo ? { id: estilo.id, nome: estilo.nome, como_fazer: estilo.como_fazer } : null)}
OBJETIVO DA CAMPANHA: ${JSON.stringify(objetivo ? { id: objetivo.id, nome: objetivo.nome, ctas: objetivo.ctas, como_o_criativo_muda: objetivo.como_o_criativo_muda } : null)}
FORMATOS: ${formatos.join(", ")}

TAREFA: escreva ${a.variacoes} variação(ões) de anúncio para este ângulo, agressivas e vendedoras dentro da política da Meta, feitas para parar a rolagem e converter no objetivo acima. Mantenha o mecanismo do ângulo; entre uma variação e outra mude o gancho E a execução visual (composição, escala, estilo), para que as peças NÃO fiquem parecidas entre si nem com o "mais do mesmo" da categoria.
Para cada variação (variacao = 1, 2, 3):
- estilo_visual: a variação 1 usa o estilo do ângulo (se houver); as outras podem usar outro estilo da lista que sirva ao mesmo mecanismo. Evite estilo de risco de política alto.
- texto_principal: a ideia inteira em até 125 caracteres (o que aparece antes do "ver mais").
- texto_principal_longo: a versão completa do texto do anúncio (pode repetir o início do texto_principal).
- titulo: até 40 caracteres, com o benefício ou a oferta. descricao: curta ou null.
- cta_meta: um dos botões da Meta coerente com o destino do briefing.
- headline_arte: até 7 palavras, a frase grande na imagem. apoio_arte: uma linha curta ou null. cta_arte: o CTA escrito na peça, coerente com o botão.
- gancho_visual: o que a imagem mostra (o gancho visual do ângulo, ajustado à variação), descrito para o diretor de arte.
- carrossel: ${formatos.includes("carrossel") ? "de 3 a 5 cards seguindo a sequência tensão, explicação, demonstração, objeção, próximo passo (cada lâmina acrescenta algo; a primeira é a capa com o gancho, a última o próximo passo); texto_exato curto por card e a ilustracao de cada um" : "null"}.
Nada de número, depoimento, prazo, preço ou urgência que não esteja no briefing. Nunca peça para escurecer a foto: o destaque vem de contraste, composição, tipografia, escala e cor.`;
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
    return { angulo: a, formatos, variacoes, copies, notas: conferencia.notas, usoId: s.usoId, estilo, objetivo };
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
      const estiloDaVariacao = estiloPorId(v.estilo_visual) ?? f.estilo;
      for (const formato of f.formatos) {
        const trabalhoId = crypto.randomUUID();
        const criativoId = crypto.randomUUID();
        const roteiro = roteiroDaVariacao(v, formato, gancho);
        const direcao = direcaoDoAnuncio(roteiro, formato, marca, {
          conceito: `${a.nome}. Situação: ${a.situacao} Mecanismo: ${a.mecanismo}.${estiloDaVariacao ? ` Estilo visual: ${estiloDaVariacao.nome}.` : ""}`.slice(0, 900),
          fioVisual: `${gancho}${marca.estilo ? ` Estilo da marca: ${marca.estilo}` : ""}`.slice(0, 800),
          ganchoVisual: gancho,
          ctaArte: texto(v.cta_arte, 60),
          estilo: estiloDaVariacao ? { id: estiloDaVariacao.id, nome: estiloDaVariacao.nome, como_fazer: estiloDaVariacao.como_fazer } : null,
          objetivo: f.objetivo ? { id: f.objetivo.id, nome: f.objetivo.nome, como_o_criativo_muda: f.objetivo.como_o_criativo_muda } : null,
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
          copy: { ...copy, headline_arte: texto(v.headline_arte, 120), apoio_arte: textoOuNulo(v.apoio_arte, 160), cta_arte: texto(v.cta_arte, 60), estilo_visual: estiloDaVariacao?.id ?? null, jev: nota },
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

// ============================================================ Mesa Ads v2

// ------------------------------------------------------------ busca segura

const AGENTE_HTTP = "Mozilla/5.0 (compatible; AceleriqMesaAds/2.0)";
const AVISO_INSTAGRAM = "O Instagram não liberou a imagem sem login. Suba o print da peça na referência para completar a ficha.";
const AVISO_BEHANCE = "O Behance bloqueia a leitura automática da página. Abra o projeto, clique com o botão direito em cada imagem, copie o endereço da imagem e cole aqui em Adicionar imagens (ou suba prints).";
/** Máximo de links de imagem colados pela equipe numa abertura. */
const MAX_IMAGENS_COLADAS = 12;

/** Confere no DNS que o host não aponta para rede interna (quando o runtime deixa resolver). */
async function hostResolvePublico(host: string): Promise<boolean> {
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return true; // IP literal já conferido em urlPublicaSegura
  const resolver = (Deno as unknown as { resolveDns?: (h: string, t: "A" | "AAAA") => Promise<string[]> }).resolveDns;
  if (typeof resolver !== "function") return true;
  const [v4, v6] = await Promise.all([
    resolver(host, "A").catch(() => [] as string[]),
    resolver(host, "AAAA").catch(() => [] as string[]),
  ]);
  return !v4.some((ip) => ipv4Interno(ip)) && !v6.some((ip) => ipv6Interno(ip));
}

type Buscado = { url: URL; tipo: string; bytes: Uint8Array };

/**
 * GET de um link público: redirecionamento conferido a cada salto (só https
 * público, nada de IP interno), tempo limite e teto de bytes. `cortar` guarda
 * só o começo (páginas grandes); sem ele, passar do teto devolve null.
 * Nunca lança: falha vira null.
 */
async function buscarSeguro(inicial: string, opcoes: { maxBytes: number; aceitar?: string; cortar?: boolean; timeoutMs?: number }): Promise<Buscado | null> {
  let url = urlPublicaSegura(inicial);
  for (let salto = 0; url && salto < 5; salto++) {
    if (!(await hostResolvePublico(url.hostname))) return null;
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": AGENTE_HTTP, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8", ...(opcoes.aceitar ? { Accept: opcoes.aceitar } : {}) },
        signal: AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_BUSCA_MS),
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!destino) return null;
      try {
        url = urlPublicaSegura(new URL(destino, url).toString());
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const declarado = Number(res.headers.get("content-length") || 0);
    if (declarado > opcoes.maxBytes && !opcoes.cortar) {
      await res.body.cancel().catch(() => {});
      return null;
    }
    const partes: Uint8Array[] = [];
    let total = 0;
    const leitor = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        if (total + value.byteLength > opcoes.maxBytes) {
          await leitor.cancel().catch(() => {});
          if (!opcoes.cortar) return null;
          partes.push(value.slice(0, opcoes.maxBytes - total));
          total = opcoes.maxBytes;
          break;
        }
        partes.push(value);
        total += value.byteLength;
      }
    } catch {
      return null;
    }
    const bytes = new Uint8Array(total);
    let pos = 0;
    for (const p of partes) {
      bytes.set(p, pos);
      pos += p.byteLength;
    }
    return { url, tipo: (res.headers.get("content-type") || "").toLowerCase(), bytes };
  }
  return null;
}

const textoDe = (b: Buscado) => new TextDecoder().decode(b.bytes);

async function buscarJson(url: string, aceitar = "application/json"): Promise<Record<string, unknown> | null> {
  const b = await buscarSeguro(url, { maxBytes: 1024 * 1024, aceitar });
  if (!b) return null;
  try {
    const v = JSON.parse(textoDe(b));
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Executa `fn` sobre os itens com no máximo `n` ao mesmo tempo; o resultado segue a ordem da lista. */
async function emParalelo<T, R>(itens: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      saida[i] = await fn(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  return saida;
}

const extDoMime = (m: string) => (m === "image/png" ? "png" : m === "image/webp" ? "webp" : "jpg");
const idSeguro = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "sem-id";

/** Baixa uma imagem pública (png, jpeg ou webp, até 12 MB) e guarda no bucket mesa. */
async function guardarImagem(servico: SupabaseClient, url: string, caminhoSemExt: string): Promise<{ caminho: string; mime: string } | null> {
  const b = await buscarSeguro(url, { maxBytes: MAX_BYTES_IMAGEM, aceitar: "image/webp,image/png,image/jpeg;q=0.9,image/*;q=0.5" });
  if (!b) return null;
  const mime = mimeDaImagem(b.bytes);
  if (!mime) return null;
  const caminho = `${caminhoSemExt}.${extDoMime(mime)}`;
  const { error } = await servico.storage.from("mesa").upload(caminho, new Blob([new Uint8Array(b.bytes)], { type: mime }), { contentType: mime, upsert: true });
  return error ? null : { caminho, mime };
}

/** URLs assinadas (1 h) do bucket mesa, por caminho. */
async function assinarCaminhos(servico: SupabaseClient, caminhos: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(caminhos.filter(Boolean))];
  const mapa = new Map<string, string>();
  if (!unicos.length) return mapa;
  const { data } = await servico.storage.from("mesa").createSignedUrls(unicos, URL_ASSINADA_S);
  for (const d of (data ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (d.path && d.signedUrl) mapa.set(d.path, d.signedUrl);
  }
  return mapa;
}

/** Caminho do bucket mesa que esta referência pode usar (pasta do cliente ou pastas compartilhadas da agência). */
function caminhoPermitido(ref: { client_id: string | null }, clientId: string, caminho: unknown): caminho is string {
  if (typeof caminho !== "string" || !caminho || caminho.includes("..")) return false;
  if (ref.client_id) return caminho.startsWith(`${clientId}/`);
  return caminho.startsWith("biblioteca/") || caminho.startsWith("globais/");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const slugArquivo = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "arquivo";

// ------------------------------------------------------------ enriquecer link

type PaginaRef = { titulo: string | null; descricao: string | null; site: string | null; tipo: string; extra: Record<string, unknown> };
type Enriquecido = { pagina: PaginaRef | null; imagens: { url: string; legenda: string }[]; aviso: string | null };

const strOuNulo = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? semTravessao(v.trim()).slice(0, max) : null);

/**
 * Enriquecimento de um link de referência, sem IA: YouTube pela miniatura do
 * id e oEmbed; GitHub pela API pública (descrição, estrelas, tópicos, começo do
 * README e imagens dele); Spotify pelo oEmbed; Behance pelas imagens dos
 * módulos; o resto (Instagram, Pinterest, sites) pelas og:tags.
 */
async function enriquecerLink(bruto: string): Promise<Enriquecido> {
  const u = urlPublicaSegura(bruto);
  if (!u) return { pagina: null, imagens: [], aviso: "O link precisa ser https público." };
  const tipo = tipoDoLink(u);
  const link = u.toString();

  if (tipo === "imagem") {
    return { pagina: { titulo: null, descricao: null, site: u.hostname, tipo: "imagem", extra: {} }, imagens: [{ url: link, legenda: "Imagem do link" }], aviso: null };
  }

  if (tipo === "youtube") {
    const id = idDoYoutube(u);
    const o = await buscarJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link)}`);
    return {
      pagina: {
        titulo: strOuNulo(o?.title, 300),
        descricao: o?.author_name ? `Canal: ${String(o.author_name)}` : null,
        site: "YouTube",
        tipo: "video",
        extra: { video_id: id, canal: strOuNulo(o?.author_name, 200), canal_url: strOuNulo(o?.author_url, 400) },
      },
      imagens: id ? [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, legenda: "Miniatura do vídeo" }] : [],
      aviso: id ? null : "Não achei o id do vídeo neste link do YouTube.",
    };
  }

  const repo = tipo === "github" ? repoDoGithub(u) : null;
  if (repo) {
    const base = `https://api.github.com/repos/${repo.dono}/${repo.repo}`;
    const [info, readme] = await Promise.all([
      buscarJson(base, "application/vnd.github+json"),
      buscarSeguro(`${base}/readme`, { maxBytes: 400 * 1024, aceitar: "application/vnd.github.raw", cortar: true }),
    ]);
    const md = readme ? textoDe(readme) : "";
    const licenca = (info?.license ?? null) as { spdx_id?: string } | null;
    return {
      pagina: {
        titulo: strOuNulo(info?.full_name, 200) ?? `${repo.dono}/${repo.repo}`,
        descricao: strOuNulo(info?.description, 1000),
        site: "GitHub",
        tipo: "repositorio",
        extra: {
          estrelas: typeof info?.stargazers_count === "number" ? info.stargazers_count : null,
          topicos: Array.isArray(info?.topics) ? (info!.topics as unknown[]).map(String).slice(0, 20) : [],
          linguagem: strOuNulo(info?.language, 60),
          site_do_projeto: strOuNulo(info?.homepage, 400),
          licenca: licenca?.spdx_id ?? null,
          atualizado_em: strOuNulo(info?.pushed_at, 40),
          readme_inicio: md ? semTravessao(md.slice(0, 3000)) : null,
        },
      },
      imagens: [
        { url: `https://opengraph.githubassets.com/1/${repo.dono}/${repo.repo}`, legenda: "Cartão do repositório" },
        ...imagensDoReadme(md, repo.dono, repo.repo, 8).map((x, i) => ({ url: x, legenda: `Imagem ${i + 1} do README` })),
      ],
      aviso: info ? null : "A API pública do GitHub não respondeu (limite de 60 consultas por hora sem chave). Abra de novo mais tarde para trazer descrição e estrelas.",
    };
  }

  if (tipo === "spotify") {
    const o = await buscarJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(link)}`);
    const capa = strOuNulo(o?.thumbnail_url, 800);
    return {
      pagina: { titulo: strOuNulo(o?.title, 300), descricao: null, site: "Spotify", tipo: strOuNulo(o?.type, 40) ?? "audio", extra: {} },
      imagens: capa ? [{ url: capa, legenda: "Capa" }] : [],
      aviso: o ? null : "O Spotify não respondeu agora. Abra de novo mais tarde.",
    };
  }

  const [b, oembedBehance] = await Promise.all([
    buscarSeguro(link, { maxBytes: MAX_BYTES_PAGINA, aceitar: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", cortar: true }),
    tipo === "behance" ? buscarJson(`https://www.behance.net/services/oembed?url=${encodeURIComponent(link)}`) : Promise.resolve(null),
  ]);
  if (!b) {
    if (tipo === "behance" && oembedBehance) {
      // A página do Behance devolve 403 para servidor; o oEmbed oficial traz título e autor.
      return {
        pagina: {
          titulo: strOuNulo(oembedBehance.title, 300),
          descricao: oembedBehance.author_name ? `Projeto de ${String(oembedBehance.author_name)} no Behance` : null,
          site: "Behance",
          tipo: "behance",
          extra: { autor: strOuNulo(oembedBehance.author_name, 200), autor_url: strOuNulo(oembedBehance.author_url, 400) },
        },
        imagens: [],
        aviso: AVISO_BEHANCE,
      };
    }
    return { pagina: null, imagens: [], aviso: tipo === "instagram" ? AVISO_INSTAGRAM : tipo === "behance" ? AVISO_BEHANCE : "Não consegui abrir a página deste link (fora do ar, bloqueada ou lenta). Suba um print para completar." };
  }
  if (b.tipo.startsWith("image/")) {
    return { pagina: { titulo: null, descricao: null, site: u.hostname, tipo: "imagem", extra: {} }, imagens: [{ url: b.url.toString(), legenda: "Imagem do link" }], aviso: null };
  }
  const html = textoDe(b);
  const meta = lerMetaTags(html, b.url.toString());
  const modulos = tipo === "behance" ? imagensDoBehance(html, MAX_IMAGENS_REFERENCIA) : [];
  const vistas = new Set<string>();
  const imagens = [
    ...modulos.map((x, i) => ({ url: x, legenda: `Módulo ${i + 1} do projeto` })),
    ...meta.imagens.map((x, i) => ({ url: x, legenda: i === 0 ? "Imagem de capa da página" : `Imagem ${i + 1} da página` })),
  ].filter((x) => (vistas.has(x.url) ? false : (vistas.add(x.url), true)));
  let aviso: string | null = null;
  if (!imagens.length) aviso = tipo === "instagram" ? AVISO_INSTAGRAM : "A página não tem imagem de capa. Suba um print para completar a referência.";
  return {
    pagina: {
      titulo: meta.titulo ? semTravessao(meta.titulo).slice(0, 300) : null,
      descricao: meta.descricao ? semTravessao(meta.descricao).slice(0, 1500) : null,
      site: meta.site ?? u.hostname.replace(/^www\./, ""),
      tipo: tipo === "pagina" ? meta.tipo ?? "pagina" : tipo,
      extra: tipo === "behance" ? { modulos: modulos.length } : {},
    },
    imagens,
    aviso,
  };
}

// ------------------------------------------------------------ abrir referência

type LinhaReferencia = {
  id: string;
  client_id: string | null;
  titulo: string;
  url: string | null;
  origem: string;
  storage_path: string | null;
  ad_id: string | null;
  plataforma: string | null;
  formato: string | null;
  evidencia: string;
  metricas: Record<string, unknown> | null;
  ficha: Record<string, unknown>;
  mecanismo: string | null;
  tags: string[];
};

type Galeria = { url: string; legenda: string }[];
type AnuncioAberto = {
  ad_id: string;
  status: string | null;
  campanha: string | null;
  titulo: string | null;
  corpo: string | null;
  descricao: string | null;
  cta: string | null;
  destino: string | null;
  metricas: Metricas;
  serie: ReturnType<typeof serieDiaria>;
  diagnostico: ReturnType<typeof diagnosticar>;
};
type Aberta = { referencia: LinhaReferencia; galeria: Galeria; pagina: PaginaRef | null; anuncio: AnuncioAberto | null; aviso: string | null };

/** Referência do cliente ou da biblioteca da agência (client_id null). */
async function carregarReferencia(servico: SupabaseClient, clientId: string, id: unknown): Promise<LinhaReferencia> {
  const refId = String(id ?? "");
  if (!UUID.test(refId)) throw new ErroHttp(400, "referencia_id_invalido", "referencia_id precisa ser um UUID.");
  const { data, error } = await servico.from("ads_referencias").select("*").eq("id", refId).maybeSingle();
  if (error) throw new ErroHttp(503, "referencia_indisponivel", "Não foi possível ler a referência.");
  if (!data) throw new ErroHttp(404, "referencia_inexistente", "Referência não encontrada.");
  const ref = data as LinhaReferencia;
  if (ref.client_id !== null && ref.client_id !== clientId) throw new ErroHttp(403, "referencia_de_outro_cliente", "Esta referência é de outro cliente.");
  ref.ficha = (ref.ficha ?? {}) as Record<string, unknown>;
  return ref;
}

/** Grava na referência (a da biblioteca da agência só pela chave de serviço, presa a client_id nulo). */
async function gravarReferencia(servico: SupabaseClient, ref: LinhaReferencia, campos: Record<string, unknown>): Promise<LinhaReferencia> {
  let q = servico.from("ads_referencias").update(campos).eq("id", ref.id);
  q = ref.client_id ? q.eq("client_id", ref.client_id) : q.is("client_id", null);
  const { data, error } = await q.select("*").single();
  if (error || !data) throw new ErroHttp(503, "referencia_nao_salva", "Não foi possível salvar a referência.");
  return data as LinhaReferencia;
}

const vazio = (v: unknown) => v == null || (typeof v === "string" && !v.trim());

/** Anúncio próprio: imagem da Meta para o storage, copy do raw, série diária e diagnóstico. */
async function abrirAnuncioProprio(servico: SupabaseClient, clientId: string, ref: LinhaReferencia, forcar: boolean): Promise<Aberta> {
  const adId = String(ref.ad_id);
  const [{ data: criativos }, linhas, briefing] = await Promise.all([
    servico.from("ads_creatives")
      .select("ad_id, ad_name, titulo, corpo, destino, effective_status, image_url, thumbnail_url, video_id, campaign_id, updated_at, raw")
      .eq("client_id", clientId).eq("ad_id", adId).order("updated_at", { ascending: false }).limit(1),
    lerDiarias(servico, clientId, { adIds: [adId] }),
    carregarBriefing(servico, clientId).catch(() => null),
  ]);
  const criativo = ((criativos as AnuncioMeta[] | null) ?? [])[0] ?? null;
  const copy = extrairCopyDoRaw(criativo?.raw, criativo ?? {});
  let campanha: string | null = null;
  if (criativo?.campaign_id) {
    const { data: c } = await servico.from("ads_campaigns").select("name").eq("client_id", clientId).eq("campaign_id", criativo.campaign_id).limit(1);
    campanha = ((c as { name: string | null }[] | null) ?? [])[0]?.name ?? null;
  }
  const avisos: string[] = [];
  let caminho = caminhoPermitido(ref, clientId, ref.storage_path) ? ref.storage_path : null;
  if (!caminho || forcar) {
    let guardada: { caminho: string } | null = null;
    for (const fonte of [copy.imagem_url, copy.miniatura_url].filter((x): x is string => !!x)) {
      guardada = await guardarImagem(servico, fonte, `${clientId}/ads-proprios/${idSeguro(adId)}`);
      if (guardada) break;
    }
    if (guardada) caminho = guardada.caminho;
    else if (!caminho) {
      avisos.push(criativo
        ? "O link da imagem da Meta expirou ou não abriu. Sincronize a conta (Conta ao vivo) e abra de novo."
        : "Este anúncio não veio na última sincronização da Meta. Sincronize a conta e abra de novo.");
    }
  }
  const metricas = somarMetricas(linhas);
  const tolera = numeroOuNulo((briefing?.objetivo ?? {}).custo_toleravel_brl);
  const diagnostico = diagnosticar(metricas, linhas, tolera);
  const desde = somarDias(hojeSaoPaulo(), -89);
  const serie = serieDiaria(linhas.filter((l) => String(l.day).slice(0, 10) >= desde));

  // Ficha: só completa o que está vazio (o que a equipe ajustou fica).
  const ficha: Record<string, unknown> = { ...ref.ficha };
  const completar: [string, unknown][] = [
    ["gancho_verbal", copy.titulo],
    ["texto_apoio", copy.corpo],
    ["descricao_anuncio", copy.descricao],
    ["cta", copy.cta],
    ["destino", copy.destino],
    ["plataforma", "meta"],
  ];
  for (const [k, v] of completar) if (vazio(ficha[k]) && !vazio(v)) ficha[k] = v;
  if (vazio(ficha.observado)) {
    ficha.observado = [copy.titulo ? `Título: ${copy.titulo}` : "", copy.corpo ? `Texto: ${copy.corpo}` : "", copy.descricao ? `Descrição: ${copy.descricao}` : "", copy.cta ? `Botão: ${copy.cta}` : "", copy.destino ? `Destino: ${copy.destino}` : ""].filter(Boolean).join("\n") || null;
  }
  if (caminho) ficha.galeria = [{ caminho, legenda: "Imagem do anúncio", origem_url: null }];
  ficha.aberta_em = new Date().toISOString();
  ficha.aviso_abertura = avisos[0] ?? null;
  const referencia = await gravarReferencia(servico, ref, {
    ficha,
    storage_path: caminho,
    metricas: metricasDaReferencia(metricas),
    evidencia: evidenciaDaImportacao(metricas, ref.evidencia),
  });
  const assinadas = await assinarCaminhos(servico, caminho ? [caminho] : []);
  const galeria: Galeria = caminho && assinadas.get(caminho)
    ? [{ url: assinadas.get(caminho)!, legenda: "Imagem do anúncio" }]
    : copy.imagem_url ? [{ url: copy.imagem_url, legenda: "Imagem do anúncio (link da Meta, expira)" }] : [];
  return {
    referencia,
    galeria,
    pagina: null,
    anuncio: {
      ad_id: adId,
      status: criativo?.effective_status ?? null,
      campanha,
      titulo: copy.titulo,
      corpo: copy.corpo,
      descricao: copy.descricao,
      cta: copy.cta,
      destino: copy.destino,
      metricas,
      serie,
      diagnostico,
    },
    aviso: avisos.length ? avisos.join(" ") : null,
  };
}

/** Link de catálogo ou URL: página e até 12 imagens no bucket mesa; enriquece uma vez (ou com forcar). */
async function abrirLink(servico: SupabaseClient, clientId: string, ref: LinhaReferencia, forcar: boolean, coladas: string[] = []): Promise<Aberta> {
  const ficha = ref.ficha ?? {};
  type ItemGaleria = { caminho: string; legenda: string; origem_url: string | null };
  let galeriaSalva: ItemGaleria[] = (Array.isArray(ficha.galeria) ? ficha.galeria as ItemGaleria[] : []).filter((g) => caminhoPermitido(ref, clientId, g?.caminho));
  let pagina = (ficha.pagina ?? null) as PaginaRef | null;
  let aviso = (ficha.aviso_abertura ?? null) as string | null;
  let referencia = ref;
  if (!ficha.aberta_em || forcar) {
    if (!ref.url) {
      aviso = ref.storage_path ? null : "Esta referência não tem link nem imagem. Suba um print para completar.";
    } else {
      const e = await enriquecerLink(ref.url);
      const pasta = ref.client_id ? `${ref.client_id}/referencias/${ref.id}` : `biblioteca/${ref.id}`;
      const guardadas = await emParalelo(e.imagens.slice(0, MAX_IMAGENS_REFERENCIA), DOWNLOADS_EM_PARALELO, async (img, i): Promise<ItemGaleria | null> => {
        const g = await guardarImagem(servico, img.url, `${pasta}/${String(i + 1).padStart(2, "0")}`);
        return g ? { caminho: g.caminho, legenda: img.legenda, origem_url: img.url } : null;
      });
      const novas = guardadas.filter((g): g is ItemGaleria => !!g);
      // Reabertura: tira do storage o que a galeria nova não usa mais.
      const sobras = galeriaSalva.map((g) => g.caminho).filter((c) => !novas.some((n) => n.caminho === c) && c !== ref.storage_path);
      if (sobras.length) await servico.storage.from("mesa").remove(sobras).catch(() => {});
      galeriaSalva = novas;
      pagina = e.pagina;
      aviso = e.aviso ?? (e.imagens.length && !novas.length ? "As imagens do link não puderam ser baixadas (bloqueio do site ou formato não aceito). Suba um print." : null);
      const campos: Record<string, unknown> = { ficha: { ...ficha, galeria: galeriaSalva, pagina, aberta_em: new Date().toISOString(), aviso_abertura: aviso } };
      if (!ref.storage_path && galeriaSalva[0]) campos.storage_path = galeriaSalva[0].caminho;
      if ((!ref.titulo || ref.titulo === ref.url) && pagina?.titulo) campos.titulo = pagina.titulo.slice(0, 200);
      if (!ref.plataforma) campos.plataforma = tipoDoLink(new URL(ref.url));
      referencia = await gravarReferencia(servico, ref, campos);
    }
  }
  // Imagens coladas pela equipe (sites que bloqueiam leitura, como o Behance): somam à galeria.
  if (coladas.length) {
    const pasta = ref.client_id ? `${ref.client_id}/referencias/${ref.id}` : `biblioteca/${ref.id}`;
    const jaTem = new Set(galeriaSalva.map((g) => g.origem_url).filter(Boolean));
    const novasUrls = coladas.filter((u) => !jaTem.has(u)).slice(0, MAX_IMAGENS_REFERENCIA * 2);
    const base = galeriaSalva.length;
    const guardadas = await emParalelo(novasUrls, DOWNLOADS_EM_PARALELO, async (url, i): Promise<ItemGaleria | null> => {
      const g = await guardarImagem(servico, url, `${pasta}/colada-${String(base + i + 1).padStart(2, "0")}`);
      return g ? { caminho: g.caminho, legenda: `Imagem ${base + i + 1}`, origem_url: url } : null;
    });
    const novas = guardadas.filter((g): g is ItemGaleria => !!g);
    if (novas.length) {
      galeriaSalva = [...galeriaSalva, ...novas];
      aviso = novas.length < novasUrls.length ? `${novasUrls.length - novas.length} imagem(ns) não puderam ser baixadas.` : null;
      const fichaAtual = (referencia.ficha ?? {}) as Record<string, unknown>;
      const campos: Record<string, unknown> = { ficha: { ...fichaAtual, galeria: galeriaSalva, aberta_em: fichaAtual.aberta_em ?? new Date().toISOString(), aviso_abertura: aviso } };
      if (!referencia.storage_path) campos.storage_path = galeriaSalva[0].caminho;
      referencia = await gravarReferencia(servico, referencia, campos);
    } else {
      aviso = "Nenhuma das imagens coladas pôde ser baixada. Confira se o link é da imagem (termina em .png, .jpg ou .webp).";
    }
  }
  const itens: { caminho: string; legenda: string }[] = [...galeriaSalva];
  if (caminhoPermitido(ref, clientId, referencia.storage_path) && !itens.some((g) => g.caminho === referencia.storage_path)) {
    itens.unshift({ caminho: referencia.storage_path!, legenda: "Imagem enviada pela equipe" });
  }
  const assinadas = await assinarCaminhos(servico, itens.map((g) => g.caminho));
  const galeria = itens.flatMap((g) => (assinadas.get(g.caminho) ? [{ url: assinadas.get(g.caminho)!, legenda: g.legenda }] : []));
  return { referencia, galeria, pagina, anuncio: null, aviso };
}

async function abrirReferenciaInterna(servico: SupabaseClient, clientId: string, ref: LinhaReferencia, forcar: boolean, coladas: string[] = []): Promise<Aberta> {
  if (ref.ad_id && ref.client_id) return await abrirAnuncioProprio(servico, clientId, ref, forcar);
  return await abrirLink(servico, clientId, ref, forcar, coladas);
}

/** Links de imagem colados pela equipe: só https público, sem repetir, no máximo MAX_IMAGENS_COLADAS. */
function imagensColadas(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s+/) : [];
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const bruto of lista) {
    const u = urlPublicaSegura(bruto);
    if (!u) continue;
    // Behance: a versão webp pequena vira a original em png de 1200 px.
    const url = u.toString().replace(/\/project_modules\/(?:max_1200_webp|1400_webp|disp_webp|fs_webp)\//, "/project_modules/max_1200/");
    if (vistas.has(url)) continue;
    vistas.add(url);
    saida.push(url);
    if (saida.length >= MAX_IMAGENS_COLADAS) break;
  }
  return saida;
}

/**
 * referencia_abrir { client_id, referencia_id, forcar?, imagens_urls? (links de imagem colados pela equipe) }
 * -> { referencia, galeria: [{ url, legenda }], pagina, anuncio, aviso, custo_usd: 0 }
 * Sem IA: enriquece uma vez (ficha.aberta_em) e devolve tudo para a janela de detalhe.
 */
async function referenciaAbrir(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const ref = await carregarReferencia(servico, clientId, corpo.referencia_id);
  const aberta = await abrirReferenciaInterna(servico, clientId, ref, corpo.forcar === true, imagensColadas(corpo.imagens_urls));
  return json({ ...aberta, custo_usd: 0 });
}

/**
 * referencia_importar_url { client_id, url, titulo? }
 * -> { referencia, galeria, pagina, anuncio: null, aviso, criada, custo_usd: 0 }
 * Cria a referência do cliente a partir de qualquer link público e já abre.
 */
async function referenciaImportarUrl(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const u = urlPublicaSegura(corpo.url);
  if (!u) throw new ErroHttp(400, "url_invalida", "Cole um link https público (Pinterest, Instagram, Behance, imagem ou página).");
  const url = u.toString();
  const { data: existentes, error } = await servico.from("ads_referencias").select("*").eq("client_id", clientId).eq("url", url).limit(1);
  if (error) throw new ErroHttp(503, "referencias_indisponiveis", "Não foi possível ler as referências do cliente.");
  let ref = ((existentes as LinhaReferencia[] | null) ?? [])[0] ?? null;
  const criada = !ref;
  if (!ref) {
    const { data, error: erroCriar } = await servico
      .from("ads_referencias")
      .insert({
        client_id: clientId,
        titulo: texto(corpo.titulo, 200) || u.hostname.replace(/^www\./, ""),
        url,
        origem: origemDoLink(u),
        plataforma: tipoDoLink(u),
        evidencia: "E0",
        criado_por: chamador.userId,
      })
      .select("*")
      .single();
    if (erroCriar || !data) throw new ErroHttp(503, "referencia_nao_criada", "Não foi possível criar a referência a partir do link.");
    ref = data as LinhaReferencia;
  }
  ref.ficha = (ref.ficha ?? {}) as Record<string, unknown>;
  const aberta = await abrirReferenciaInterna(servico, clientId, ref, false);
  return json({ ...aberta, criada, custo_usd: 0 });
}

// ------------------------------------------------------------ Jev: política e ofertas

type NotaPolitica = { risco_politica: number | null; alerta_politica: boolean };

/** O Jev dá o risco de política de cada item (lotes de até 40 perguntas). Falha não derruba: nota null. */
async function conferirPoliticaComJev(
  itens: unknown[],
  contexto: Record<string, unknown>,
  cobranca: { clientId: string; referencia: { tipo: string; id: string }; criadoPor: string },
  oQue: string,
): Promise<{ notas: (NotaPolitica | null)[]; jev_erro: string | null; custo: number }> {
  const notas: (NotaPolitica | null)[] = itens.map(() => null);
  let custo = 0;
  let jevErro: string | null = null;
  for (let inicio = 0; inicio < itens.length; inicio += 40) {
    const lote = itens.slice(inicio, inicio + 40);
    const questions: Record<string, PerguntaJev> = {};
    lote.forEach((_, k) => {
      questions[`risco_${k}`] = {
        type: "score",
        instructions: `Pelas \`politicas\` de anúncio da Meta, qual o risco de reprovação de \`itens[${k}]\` (${oQue})? Número, resultado, depoimento ou garantia que não está em \`provas_disponiveis\` conta como alegação não comprovada.`,
        criteria: NIVEIS_RISCO_POLITICA,
      };
    });
    try {
      const r = await jevPerguntar({ state: { ...contexto, politicas: POLITICAS_META, itens: lote }, questions });
      const cobrado = await cobrarJev(r, { clientId: cobranca.clientId, tarefa: TAREFA, referencia: cobranca.referencia, criadoPor: cobranca.criadoPor });
      custo += cobrado?.custoUsd ?? 0;
      lote.forEach((_, k) => {
        const bruta = notaScore(r.answers[`risco_${k}`]);
        notas[inicio + k] = { risco_politica: notaDe0a10(bruta, NIVEIS_RISCO_POLITICA.length), alerta_politica: alertaDePolitica(bruta) };
      });
    } catch (err) {
      jevErro = err instanceof JevErro ? err.codigo : "jev_falhou";
      console.error("[mesa-ads] jev de politica falhou", { codigo: jevErro });
    }
  }
  return { notas, jev_erro: jevErro, custo };
}

/**
 * Confiança mínima da escolha do nicho pelo Jev (a distribuição fica
 * espalhada entre ~19 opções; abaixo disso o prompt segue sem nicho).
 */
const CONFIANCA_MINIMA_NICHO = 0.3;

/**
 * Nicho do cliente para o prompt (só ele, nunca a lista inteira): o pedido
 * explícito ou uma escolha do Jev (Choice) sobre o contexto real do cliente.
 * "nenhum", confiança baixa ou falha do Jev = sem nicho.
 */
async function nichoDoCliente(
  ctx: ContextoAds,
  briefing: Briefing | null,
  cobranca: { clientId: string; referencia: { tipo: string; id: string }; criadoPor: string },
  pedido?: unknown,
): Promise<{ nicho: Nicho | null; custo: number; jev_erro: string | null }> {
  const explicito = pedido != null && pedido !== "" ? NICHOS.find((n) => n.id === pedido) ?? null : null;
  if (explicito) return { nicho: explicito, custo: 0, jev_erro: null };
  const criteria: Record<string, string> = { nenhum: "Nenhum destes nichos descreve o negócio do cliente." };
  for (const n of NICHOS) criteria[n.id] = n.nome;
  const consolidado = ctx.dados.contexto_consolidado;
  const state = {
    cliente: ctx.cliente,
    contexto: (typeof consolidado === "string" ? consolidado : JSON.stringify(consolidado ?? null)).slice(0, 6000),
    dossie: String(ctx.dados.dossie_atual ?? "").slice(0, 3000),
    oferta: briefing?.oferta ?? null,
    publico: briefing?.publico ?? null,
  };
  try {
    const r = await jevPerguntar({
      state,
      questions: {
        nicho: {
          type: "choice",
          instructions: "Qual nicho de mercado descreve o negócio deste cliente (o que ele vende e para quem), pelo `contexto`, pelo `dossie` e pela `oferta`?",
          criteria,
        },
      },
    });
    const cobrado = await cobrarJev(r, { clientId: cobranca.clientId, tarefa: TAREFA, referencia: cobranca.referencia, criadoPor: cobranca.criadoPor });
    const a = r.answers.nicho;
    const confiante = typeof a?.confidence === "number" && a.confidence >= CONFIANCA_MINIMA_NICHO;
    const nicho = a?.choice && a.choice !== "nenhum" && confiante ? NICHOS.find((n) => n.id === a.choice) ?? null : null;
    return { nicho, custo: cobrado?.custoUsd ?? 0, jev_erro: null };
  } catch (err) {
    const codigo = err instanceof JevErro ? err.codigo : "jev_falhou";
    console.error("[mesa-ads] jev do nicho falhou", { codigo });
    return { nicho: null, custo: 0, jev_erro: codigo };
  }
}

type NotasOferta = { clareza: number | null; forca: number | null; risco_politica: number | null; alerta_politica: boolean };

/** O Jev confere cada oferta: clareza, força (valor x risco x esforço) e risco de política (10 = sem risco). */
async function conferirOfertasComJev(
  ofertas: { nome: string; oferta: Record<string, unknown> }[],
  briefing: Briefing | null,
  cobranca: { clientId: string; referencia: { tipo: string; id: string }; criadoPor: string },
): Promise<{ notas: (NotasOferta | null)[]; jev_erro: string | null; custo: number }> {
  if (!ofertas.length) return { notas: [], jev_erro: null, custo: 0 };
  const state = {
    publico: briefing?.publico ?? "não informado",
    provas_disponiveis: briefing?.provas ?? [],
    destino: briefing?.destino ?? "não informado",
    politicas: POLITICAS_META,
    ofertas: ofertas.map((o) => ({ nome: o.nome, ...o.oferta })),
  };
  const questions: Record<string, PerguntaJev> = {};
  ofertas.forEach((_, i) => {
    questions[`clareza_${i}`] = {
      type: "score",
      instructions: `Quão clara é a oferta \`ofertas[${i}]\` (o que é, para quem, o que inclui e o próximo passo) para o \`publico\`?`,
      criteria: NIVEIS_CLAREZA,
    };
    questions[`forca_${i}`] = {
      type: "score",
      instructions: `Quão forte é a oferta \`ofertas[${i}]\` para o \`publico\`: valor percebido contra risco e esforço de quem compra, com garantia, bônus e urgência só quando reais?`,
      criteria: NIVEIS_FORCA_OFERTA,
    };
    questions[`risco_${i}`] = {
      type: "score",
      instructions: `Pelas \`politicas\` de anúncio da Meta, qual o risco de reprovação de anunciar a oferta \`ofertas[${i}]\` (promessa, garantia, urgência e ancoragem)? Prova ou número que não está em \`provas_disponiveis\` conta como alegação não comprovada.`,
      criteria: NIVEIS_RISCO_POLITICA,
    };
  });
  try {
    const r = await jevPerguntar({ state, questions });
    const cobrado = await cobrarJev(r, { clientId: cobranca.clientId, tarefa: TAREFA, referencia: cobranca.referencia, criadoPor: cobranca.criadoPor });
    return {
      notas: ofertas.map((_, i) => {
        const risco = notaScore(r.answers[`risco_${i}`]);
        return {
          clareza: notaDe0a10(notaScore(r.answers[`clareza_${i}`]), NIVEIS_CLAREZA.length),
          forca: notaDe0a10(notaScore(r.answers[`forca_${i}`]), NIVEIS_FORCA_OFERTA.length),
          risco_politica: notaDe0a10(risco, NIVEIS_RISCO_POLITICA.length),
          alerta_politica: alertaDePolitica(risco),
        };
      }),
      jev_erro: null,
      custo: cobrado?.custoUsd ?? 0,
    };
  } catch (err) {
    const codigo = err instanceof JevErro ? err.codigo : "jev_falhou";
    console.error("[mesa-ads] jev da oferta falhou", { codigo });
    return { notas: ofertas.map(() => null), jev_erro: codigo, custo: 0 };
  }
}

// ------------------------------------------------------------ ofertas

function normalizarOferta(o: Record<string, unknown>): { nome: string; oferta: Record<string, unknown> } {
  const lista = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v : []).map((x) => texto(x, max)).filter(Boolean).slice(0, n);
  return {
    nome: texto(o.nome, 120),
    oferta: {
      para_quem: texto(o.para_quem, 600),
      promessa: texto(o.promessa, 800),
      mecanismo: texto(o.mecanismo, 800),
      entregaveis: lista(o.entregaveis, 12, 300),
      bonus: lista(o.bonus, 8, 300),
      garantia: textoOuNulo(o.garantia, 400),
      urgencia_real: textoOuNulo(o.urgencia_real, 400),
      ancoragem: textoOuNulo(o.ancoragem, 400),
      cta: texto(o.cta, 120),
      provas_necessarias: lista(o.provas_necessarias, 10, 300),
      riscos: lista(o.riscos, 10, 300),
    },
  };
}

function normalizarIdeia(bruto: unknown) {
  const o = (bruto ?? {}) as Record<string, unknown>;
  return {
    titulo: texto(o.titulo, 160),
    gancho_verbal: texto(o.gancho_verbal, 200),
    gancho_visual: texto(o.gancho_visual, 600),
    estilo_visual: doEnum(o.estilo_visual, ESTILOS_VISUAIS_IDS as readonly string[]),
    formato: doEnum(o.formato, FORMATOS),
  };
}

/**
 * oferta_conversar { client_id, mensagem, conversa_id?, anexos?, modelo_id?, raciocinio? }
 * -> { conversa_id, resposta, ofertas: Oferta[] (as criadas nesta mensagem), briefing_sugerido, ideias, custo_usd, saldo_usd, jev_erro }
 * O Jev confere cada oferta nova ANTES de responder; a que vier com alerta de
 * política é reescrita uma vez e conferida de novo.
 */
async function ofertaConversar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const mensagem = texto(corpo.mensagem, 6000);
  if (!mensagem) throw new ErroHttp(400, "mensagem_vazia", "Escreva o que você quer para a oferta.");

  let conversaId: string;
  let conversaNova = false;
  if (corpo.conversa_id) {
    const cid = String(corpo.conversa_id);
    if (!UUID.test(cid)) throw new ErroHttp(400, "conversa_id_invalido", "conversa_id precisa ser um UUID.");
    const { data } = await servico.from("agente_conversas").select("id, client_id, referencia_tipo").eq("id", cid).maybeSingle();
    const c = data as { id: string; client_id: string; referencia_tipo: string | null } | null;
    if (!c || c.client_id !== clientId || c.referencia_tipo !== REF_OFERTA) throw new ErroHttp(404, "conversa_inexistente", "Conversa de oferta não encontrada para este cliente.");
    conversaId = c.id;
  } else {
    const { data, error } = await servico
      .from("agente_conversas")
      .insert({ client_id: clientId, agente: AGENTE, referencia_tipo: REF_OFERTA, referencia_id: clientId, criado_por: chamador.userId })
      .select("id")
      .single();
    if (error || !data) throw new ErroHttp(503, "conversa_nao_criada", "Não foi possível abrir a conversa de oferta.");
    conversaId = (data as { id: string }).id;
    conversaNova = true;
  }

  const [briefing, ctx, anexos, { data: ofertasAtuais }, { data: historico }] = await Promise.all([
    carregarBriefing(servico, clientId).catch(() => null),
    montarContextoAds(servico, clientId),
    baixarAnexos(servico, clientId, corpo.anexos),
    servico.from("ads_ofertas").select("*").eq("client_id", clientId).neq("status", "arquivada").order("criado_em", { ascending: false }).limit(12),
    servico.from("agente_mensagens").select("papel, conteudo").eq("conversa_id", conversaId).order("criado_em", { ascending: false }).limit(16),
  ]);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista");
  const achado = await nichoDoCliente(ctx, briefing, { clientId, referencia: { tipo: REF_OFERTA, id: conversaId }, criadoPor: chamador.userId });
  const anteriores: MensagemMotor[] = ((historico ?? []) as Array<{ papel: string; conteudo: string }>)
    .reverse()
    .filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => ({ papel: m.papel as "usuario" | "agente", conteudo: m.conteudo.slice(0, 3000) }));
  const existentes = ((ofertasAtuais as LinhaOferta[] | null) ?? []).map(ofertaDaLinha)
    .map((o) => ({ id: o.id, nome: o.nome, promessa: o.promessa, para_quem: o.para_quem, status: o.status }));

  const pedido = `DADOS REAIS DO CLIENTE (JSON; null ou vazio = não existe):
${JSON.stringify(ctx.dados)}

BRIEFING ATUAL: ${JSON.stringify(resumoDoBriefing(briefing))}
OFERTAS JÁ CRIADAS: ${JSON.stringify(existentes)}
${achado.nicho ? textoDoNicho(achado.nicho) : "NICHO: não identificado com segurança; use o negócio descrito nos dados."}

MENSAGEM DA EQUIPE: ${mensagem}
${anexos.imagens.length ? `A equipe anexou ${anexos.imagens.length} imagem(ns) (exemplos ou material do cliente); use o conteúdo com fidelidade.\n` : ""}
Responda como o estrategista de ofertas da agência. Devolva:
- resposta: a conversa, direta, em até 8 frases. Se faltar dado para uma oferta honesta, pergunte objetivamente o que falta.
- ofertas: de 0 a 3 ofertas NOVAS e específicas, só quando a equipe pediu ou quando já há dado suficiente. Oferta VENDEDORA e agressiva dentro da política (equação de valor: resultado desejado grande, prova de que acontece, pouco tempo, pouco esforço, risco revertido). Cada campo segue a montagem de oferta:
  - nome: nome de oferta que dá vontade (até 6 palavras), não descrição de serviço.
  - para_quem: a situação concreta de quem compra.
  - promessa: o resultado que o comprador quer, na língua dele, forte e específico (ex.: "árvore podada com segurança e quintal limpo no mesmo dia"). Sem garantia absoluta de resultado e sem número inventado, mas SEM ressalva dentro da promessa: ressalvas e limites vão em riscos e provas_necessarias.
  - mecanismo: por que funciona, em uma frase concreta.
  - entregaveis: tudo que a pessoa leva, item por item, para o valor ficar visível.
  - bonus: bônus que resolvem o próximo problema do comprador; os que o cliente ainda não confirmou vêm com "(sugestão, confirmar com o cliente)".
  - garantia, urgencia_real e ancoragem: as reais; se não houver, proponha uma possível marcada "(sugestão, confirmar com o cliente)" ou null. Nunca urgência falsa.
  - cta: verbo de ação e o próximo passo em até 8 palavras (ex.: "Mande a foto da árvore no Direct").
  - provas_necessarias (o que o cliente precisa confirmar ou enviar) e riscos (de política e de entrega).
  - Toda oferta leva pelo menos 1 bônus e 1 reversão de risco (reais ou sugestão marcada). Nada de "a confirmar" dentro de nome, promessa ou entregáveis: isso vai em provas_necessarias. Veja os exemplos de promessa fraca e forte na MONTAGEM DE OFERTA.
- briefing_sugerido: o briefing COMPLETO atualizado só quando a conversa trouxe dado novo para ele; senão null.
- ideias: de 0 a 6 ideias de criativo quando a equipe pedir criativos a partir de uma oferta ou de exemplos; cada uma com gancho verbal, gancho visual (sem escurecer a foto), estilo_visual da lista e formato.`;

  let s;
  try {
    s = await chamarTexto({
      clientId,
      tarefa: TAREFA,
      agente: AGENTE,
      modeloId: modelo.id,
      sistema: sistemaDoEstrategista(),
      mensagens: [...anteriores, { papel: "usuario", conteudo: pedido, imagens: anexos.imagens.length ? anexos.imagens : undefined }],
      raciocinio,
      esquemaJson: ESQUEMA_OFERTA_CONVERSA,
      referencia: { tipo: REF_OFERTA, id: conversaId },
      criadoPor: chamador.userId,
    });
  } catch (err) {
    if (conversaNova) await servico.from("agente_conversas").delete().eq("id", conversaId).eq("client_id", clientId);
    throw err;
  }
  const r = (s.json ?? {}) as Record<string, unknown>;
  let custo = s.custoUsd + achado.custo;
  let saldo = s.saldoUsd;
  let novas =(Array.isArray(r.ofertas) ? r.ofertas : []).slice(0, 3).map((o) => normalizarOferta((o ?? {}) as Record<string, unknown>))
    .filter((o) => o.nome && o.oferta.promessa);
  const cobranca = { clientId, referencia: { tipo: REF_OFERTA, id: conversaId }, criadoPor: chamador.userId };
  const conferencia = await conferirOfertasComJev(novas, briefing, cobranca);
  custo += conferencia.custo;
  let notas = conferencia.notas;
  let jevErro = conferencia.jev_erro;

  // Alerta de política ou oferta fraca (força ou clareza abaixo de 7): reescreve uma vez e confere de novo antes de responder.
  const precisaReforco = (n: (typeof notas)[number]) => !!n && (n.alerta_politica || (n.forca != null && n.forca < 7) || (n.clareza != null && n.clareza < 7));
  const alertadas = notas.map((n, i) => (precisaReforco(n) ? i : -1)).filter((i) => i >= 0);
  if (alertadas.length && restanteMs(chamador) > TEMPO_DE_UMA_RODADA_MS) {
    try {
      const re = await chamarTexto({
        clientId,
        tarefa: TAREFA,
        agente: AGENTE,
        modeloId: modelo.id,
        sistema: sistemaDoEstrategista(),
        mensagens: [{
          papel: "usuario",
          conteudo: `BRIEFING: ${JSON.stringify(resumoDoBriefing(briefing))}
OFERTAS QUE A CONFERÊNCIA DO JEV REPROVOU (indice = posição; notas de 0 a 10: clareza e força, quanto maior melhor; risco_politica 10 = sem risco):
${JSON.stringify(alertadas.map((i) => ({ indice: i, ...novas[i], notas: notas[i] })))}

Reescreva cada uma para passar: força e clareza 7 ou mais e sem alerta de política.
- Força baixa: promessa mais desejável e específica na língua do comprador, entregáveis concretos, bônus que resolvem o próximo problema, reversão de risco e CTA curto com verbo de ação. Ressalvas saem da promessa e vão para riscos.
- Clareza baixa: em 1 segundo precisa ficar claro o que é, para quem e qual o próximo passo.
- Alerta de política: sem atributo pessoal, sem promessa de resultado garantido, sem antes e depois, sem urgência ou escassez que não seja real, sem número ou prova fora do briefing.
Devolva cada oferta com o mesmo indice.`,
        }],
        raciocinio,
        esquemaJson: ESQUEMA_OFERTAS_REESCRITAS,
        referencia: { tipo: REF_OFERTA, id: conversaId },
        criadoPor: chamador.userId,
      });
      custo += re.custoUsd;
      saldo = re.saldoUsd;
      const trocadas = new Map<number, { nome: string; oferta: Record<string, unknown> }>();
      for (const b of (((re.json as Record<string, unknown> | undefined)?.ofertas as unknown[] | undefined) ?? [])) {
        const o = (b ?? {}) as Record<string, unknown>;
        const i = Math.round(Number(o.indice));
        const n = normalizarOferta(o);
        if (alertadas.includes(i) && n.nome && n.oferta.promessa) trocadas.set(i, n);
      }
      if (trocadas.size) {
        const idx = [...trocadas.keys()];
        const segunda = await conferirOfertasComJev(idx.map((i) => trocadas.get(i)!), briefing, cobranca);
        custo += segunda.custo;
        if (segunda.jev_erro) jevErro = segunda.jev_erro;
        // Só troca quando a reescrita ficou melhor (sem alerta e força mais clareza maior ou igual).
        const valor = (n: NotasOferta | null) => (n ? (n.forca ?? 0) + (n.clareza ?? 0) : -1);
        const melhorou = (i: number) => {
          const nova = segunda.notas[idx.indexOf(i)] ?? null;
          if (!nova || nova.alerta_politica) return !!notas[i]?.alerta_politica && !!nova && !nova.alerta_politica;
          return !!notas[i]?.alerta_politica || valor(nova) >= valor(notas[i]);
        };
        const aceitas = new Set(idx.filter(melhorou));
        novas = novas.map((o, i) => (aceitas.has(i) ? trocadas.get(i)! : o));
        notas = notas.map((n, i) => (aceitas.has(i) ? segunda.notas[idx.indexOf(i)] ?? null : n));
      }
    } catch (err) {
      console.error("[mesa-ads] reescrita da oferta falhou", { nome: err instanceof Error ? err.name : "desconhecido" });
    }
  }

  let criadas: ReturnType<typeof ofertaDaLinha>[] = [];
  if (novas.length) {
    const { data, error } = await servico
      .from("ads_ofertas")
      .insert(novas.map((o, i) => ({
        client_id: clientId,
        briefing_id: briefing?.id ?? null,
        conversa_id: conversaId,
        nome: o.nome,
        oferta: o.oferta,
        jev: notas[i] ?? null,
        status: "rascunho",
        criado_por: chamador.userId,
      })))
      .select("*");
    if (error || !data) throw new ErroHttp(503, "ofertas_nao_salvas", "As ofertas foram escritas, mas não foram salvas.", { uso_id: s.usoId, custo_usd: arred6(custo) });
    criadas = (data as LinhaOferta[]).map(ofertaDaLinha);
  }
  const resposta = texto(r.resposta, 4000) || (criadas.length ? "Ofertas criadas." : "Certo.");
  const comAlerta = criadas.filter((o) => o.jev?.alerta_politica).map((o) => o.nome);
  await registrarMensagens(servico, conversaId, clientId, [
    { papel: "usuario", conteudo: mensagem, anexos: anexos.caminhos.map((x) => ({ caminho: x })) },
    {
      papel: "agente",
      conteudo: `${resposta}${criadas.length ? `\n\nOfertas criadas: ${criadas.map((o) => o.nome).join("; ")}.` : ""}${comAlerta.length ? `\nAinda com alerta de política: ${comAlerta.join("; ")}.` : ""}`,
      uso_id: s.usoId,
    },
  ]);
  const sugerido = r.briefing_sugerido && typeof r.briefing_sugerido === "object" ? normalizarBriefing(r.briefing_sugerido as Record<string, unknown>) : null;
  const ideias = (Array.isArray(r.ideias) ? r.ideias : []).slice(0, 6).map(normalizarIdeia).filter((x) => x.titulo);
  return json({ conversa_id: conversaId, resposta, ofertas: criadas, briefing_sugerido: sugerido, ideias, custo_usd: arred6(custo), saldo_usd: saldo, jev_erro: jevErro });
}

/** oferta_salvar { client_id, oferta_id, campos?, status? } -> { oferta } (sem IA; mudar o conteúdo apaga a nota do Jev, que ficou velha). */
async function ofertaSalvar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const linha = await carregarOferta(servico, clientId, corpo.oferta_id);
  const update: Record<string, unknown> = {};
  if (corpo.campos && typeof corpo.campos === "object") {
    const base = { nome: linha.nome, ...(linha.oferta ?? {}) };
    const n = normalizarOferta({ ...base, ...(corpo.campos as Record<string, unknown>) });
    if (!n.nome) throw new ErroHttp(400, "oferta_sem_nome", "A oferta precisa de um nome.");
    const mudou = n.nome !== linha.nome || JSON.stringify(n.oferta) !== JSON.stringify(normalizarOferta(base).oferta);
    if (mudou) {
      update.nome = n.nome;
      update.oferta = n.oferta;
      update.jev = null;
    }
  }
  if (corpo.status != null) {
    const st = doEnum(corpo.status, STATUS_OFERTA);
    if (!st) throw new ErroHttp(400, "status_invalido", "Status da oferta: rascunho, escolhida ou arquivada.");
    update.status = st;
  }
  if (!Object.keys(update).length) return json({ oferta: ofertaDaLinha(linha) });
  const { data, error } = await servico.from("ads_ofertas").update(update).eq("id", linha.id).eq("client_id", clientId).select("*").single();
  if (error || !data) throw new ErroHttp(503, "oferta_nao_salva", "Não foi possível salvar a oferta.");
  return json({ oferta: ofertaDaLinha(data as LinhaOferta) });
}

/** oferta_listar { client_id, incluir_arquivadas? } -> { ofertas } */
async function ofertaListar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  let q = servico.from("ads_ofertas").select("*").eq("client_id", clientId);
  if (corpo.incluir_arquivadas !== true) q = q.neq("status", "arquivada");
  const { data, error } = await q.order("criado_em", { ascending: false }).limit(100);
  if (error) throw new ErroHttp(503, "ofertas_indisponiveis", "Não foi possível ler as ofertas.");
  return json({ ofertas: ((data as LinhaOferta[] | null) ?? []).map(ofertaDaLinha) });
}

// ------------------------------------------------------------ conta ao vivo

const DIAS_CONTA = [7, 14, 30];

/** Conta do cliente no período, tudo em código (métricas, tendência, sinal e diagnóstico). */
async function lerContaAoVivo(servico: SupabaseClient, clientId: string, diasBruto: unknown) {
  const dias = DIAS_CONTA.includes(Number(diasBruto)) ? Number(diasBruto) : 14;
  const fim = hojeSaoPaulo();
  const inicio = somarDias(fim, -(dias - 1));
  const [contas, campanhasQ, anuncios, diarias, briefing, refsQ] = await Promise.all([
    servico.from("external_accounts").select("id, status").eq("client_id", clientId).eq("platform", "meta_ads"),
    servico.from("ads_campaigns").select("campaign_id, name, effective_status, objective, daily_budget, updated_at").eq("client_id", clientId).order("updated_at", { ascending: false }).limit(300),
    lerAnunciosDoCliente(servico, clientId, true),
    lerDiarias(servico, clientId, { desde: inicio, ate: fim }),
    carregarBriefing(servico, clientId).catch(() => null),
    servico.from("ads_referencias").select("id, ad_id, storage_path").eq("client_id", clientId).not("ad_id", "is", null),
  ]);
  if (campanhasQ.error) throw new ErroHttp(503, "campanhas_indisponiveis", "Não foi possível ler as campanhas do cliente.");
  const campanhasLidas = (campanhasQ.data as { campaign_id: string; name: string | null; effective_status: string | null; objective: string | null; daily_budget: number | string | null; updated_at: string | null }[] | null) ?? [];
  const refs = (refsQ.data as { id: string; ad_id: string; storage_path: string | null }[] | null) ?? [];
  const refPorAd = new Map(refs.map((r) => [r.ad_id, r]));
  const conectada = ((contas.data as unknown[] | null) ?? []).length > 0 || anuncios.length > 0 || campanhasLidas.length > 0;
  const datas = [...anuncios.map((a) => a.updated_at), ...campanhasLidas.map((c) => c.updated_at)].filter((x): x is string => !!x).sort();
  const totais = somarMetricas(diarias);
  const tolera = numeroOuNulo((briefing?.objetivo ?? {}).custo_toleravel_brl);
  const custoReferencia = tolera ?? totais.custo_por_resultado;
  const porAd = porAnuncio(diarias);
  const nomeCampanha = new Map(campanhasLidas.map((c) => [c.campaign_id, c.name]));
  const campanhaDoAd = new Map(anuncios.map((a) => [a.ad_id, a.campaign_id]));
  const porCampanha = new Map<string, Diaria[]>();
  for (const l of diarias) {
    const cid = l.campaign_id ?? campanhaDoAd.get(l.ad_id) ?? null;
    if (!cid) continue;
    const lista = porCampanha.get(cid) ?? [];
    lista.push(l);
    porCampanha.set(cid, lista);
  }
  const idsCampanha = [...new Set([...campanhasLidas.filter((c) => c.effective_status === "ACTIVE").map((c) => c.campaign_id), ...porCampanha.keys()])];
  const campanhaLida = new Map(campanhasLidas.map((c) => [c.campaign_id, c]));
  const campanhas = idsCampanha.map((id) => {
    const c = campanhaLida.get(id);
    return {
      campaign_id: id,
      nome: c?.name ?? null,
      status: c?.effective_status ?? null,
      objetivo: c?.objective ?? null,
      orcamento_diario: c?.daily_budget != null ? Number(c.daily_budget) : null,
      metricas: somarMetricas(porCampanha.get(id) ?? []),
    };
  }).sort((a, b) => b.metricas.gasto - a.metricas.gasto);

  const adsNoPeriodo = new Set(porAd.keys());
  const alvo = anuncios.filter((a) => a.effective_status === "ACTIVE" || adsNoPeriodo.has(a.ad_id)).slice(0, 200);
  const assinadas = await assinarCaminhos(servico, alvo.map((a) => refPorAd.get(a.ad_id)?.storage_path ?? "").filter((c) => c.startsWith(`${clientId}/`)));
  const lista = alvo.map((a) => {
    const linhas = porAd.get(a.ad_id) ?? [];
    const metricas = somarMetricas(linhas);
    const tendencia = tendenciaDoAnuncio(linhas);
    const copy = extrairCopyDoRaw(a.raw, a);
    const ref = refPorAd.get(a.ad_id) ?? null;
    return {
      ad_id: a.ad_id,
      nome: a.ad_name,
      status: a.effective_status,
      campaign_id: a.campaign_id,
      campanha: a.campaign_id ? nomeCampanha.get(a.campaign_id) ?? null : null,
      imagem_url: (ref?.storage_path && assinadas.get(ref.storage_path)) || copy.imagem_url || copy.miniatura_url,
      titulo: copy.titulo,
      corpo: copy.corpo,
      descricao: copy.descricao,
      cta: copy.cta,
      destino: copy.destino,
      metricas,
      diagnostico: diagnosticar(metricas, linhas, tolera),
      tendencia,
      sinal: sinalDoAnuncio(metricas, tendencia, custoReferencia),
      referencia_id: ref?.id ?? null,
    };
  }).sort((x, y) => Number(y.status === "ACTIVE") - Number(x.status === "ACTIVE") || y.metricas.gasto - x.metricas.gasto);
  return {
    conectada,
    atualizado_em: datas[datas.length - 1] ?? null,
    periodo: { inicio, fim },
    totais,
    custo_referencia: { valor: custoReferencia, fonte: tolera ? "briefing" : totais.custo_por_resultado != null ? "media_da_conta" : null },
    campanhas,
    anuncios: lista,
  };
}

/**
 * conta_ao_vivo { client_id, dias?: 7 | 14 | 30 (padrão 14) }
 * -> { conectada, atualizado_em, periodo, totais, custo_referencia, campanhas, anuncios, custo_usd: 0 }
 * Grátis e sem IA: sinal, tendência e diagnóstico em código (calculos.ts).
 */
async function contaAoVivo(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  return json({ ...(await lerContaAoVivo(servico, clientId, corpo.dias)), custo_usd: 0 });
}

/** conta_sincronizar { client_id } -> o que collect_ads_now() devolveu ({ campanhas, criativos }) + custo_usd: 0. */
async function contaSincronizar(_servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  // Como o usuário (JWT dele): a RPC confere is_staff(auth.uid()). Nunca com a chave de serviço.
  const { data, error } = await clienteDoChamador(chamador.token).rpc("collect_ads_now");
  if (error) throw new ErroHttp(503, "sincronizacao_falhou", "A sincronização com a Meta não respondeu agora. Tente de novo em instantes.", { detalhe: error.message });
  const r = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : { resultado: data ?? null };
  return json({ ...r, custo_usd: 0 });
}

/**
 * conta_analisar { client_id, dias?, modelo_id?, raciocinio? }
 * -> { analise: { resumo, escalar, pausar, renovar, copy, proximos_testes }, analise_id, custo_usd, saldo_usd }
 * O estrategista lê os dados da conta; os números vêm do código.
 */
async function contaAnalisar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const conta = await lerContaAoVivo(servico, clientId, corpo.dias);
  const comDados = conta.anuncios.filter((a) => a.metricas.impressoes > 0).slice(0, 40);
  if (!comDados.length) throw new ErroHttp(409, "sem_dados_de_conta", "Nenhum anúncio com entrega no período. Sincronize a conta ou escolha um período maior.");
  const briefing = await carregarBriefing(servico, clientId).catch(() => null);
  const m = (x: Metricas) => ({ gasto: x.gasto, impressoes: x.impressoes, ctr_saida_pct: x.ctr_saida_pct, cpm: x.cpm, cpc: x.cpc, frequencia_media: x.frequencia_media, resultados: x.resultados, resultados_por_tipo: x.resultados_por_tipo, custo_por_resultado: x.custo_por_resultado });
  const dados = {
    periodo: conta.periodo,
    totais: m(conta.totais),
    custo_referencia: conta.custo_referencia,
    campanhas: conta.campanhas.slice(0, 20).map((c) => ({ campaign_id: c.campaign_id, nome: c.nome, status: c.status, objetivo: c.objetivo, orcamento_diario: c.orcamento_diario, metricas: m(c.metricas) })),
    anuncios: comDados.map((a) => ({
      ad_id: a.ad_id,
      nome: a.nome,
      status: a.status,
      campanha: a.campanha,
      titulo: a.titulo,
      corpo: a.corpo ? a.corpo.slice(0, 400) : null,
      cta: a.cta,
      destino: a.destino,
      metricas: m(a.metricas),
      tendencia: a.tendencia,
      sinal_do_codigo: a.sinal,
      diagnostico: a.diagnostico.sinais.map((x) => x.sinal),
    })),
  };
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista");
  const s = await chamarTexto({
    clientId,
    tarefa: TAREFA,
    agente: AGENTE,
    modeloId: modelo.id,
    sistema: sistemaDoEstrategista(),
    mensagens: [{
      papel: "usuario",
      conteudo: `BRIEFING: ${JSON.stringify(resumoDoBriefing(briefing))}
DADOS DA CONTA (calculados pelo painel; use SÓ estes números, sem arredondar para mais nem estimar):
${JSON.stringify(dados)}

TAREFA: leia a conta e ajude a otimizar criativos e estratégia de copy.
- resumo: o que a conta mostra em até 6 frases, citando só números acima.
- escalar, pausar, renovar: ad_ids da lista com o porquê (renovar leva a sugestão de nova execução). O sinal_do_codigo é a regra da agência: discorde só com motivo claro nos números.
- copy: achados sobre os textos (ganchos, títulos, CTAs) que performam melhor ou pior, com a recomendação.
- proximos_testes: de 2 a 5 testes com hipótese no formato da agência, estilo visual e objetivo.
Período curto ou pouco volume: diga que é inconclusivo em vez de decidir.`,
    }],
    raciocinio,
    esquemaJson: ESQUEMA_ANALISE_CONTA,
    referencia: { tipo: REF_CLIENTE, id: clientId },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as Record<string, unknown>;
  const porId = new Map(comDados.map((a) => [a.ad_id, a]));
  const itens = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  const analise = {
    resumo: texto(r.resumo, 3000),
    // Escalar só com resultado real registrado (regra da honestidade).
    escalar: itens(r.escalar).filter((x) => (porId.get(String(x.ad_id))?.metricas.resultados ?? 0) > 0).map((x) => ({ ad_id: String(x.ad_id), porque: texto(x.porque, 800) })),
    pausar: itens(r.pausar).filter((x) => porId.has(String(x.ad_id))).map((x) => ({ ad_id: String(x.ad_id), porque: texto(x.porque, 800) })),
    renovar: itens(r.renovar).filter((x) => porId.has(String(x.ad_id))).map((x) => ({ ad_id: String(x.ad_id), porque: texto(x.porque, 800), sugestao: texto(x.sugestao, 800) })),
    copy: itens(r.copy).map((x) => ({ achado: texto(x.achado, 800), recomendacao: texto(x.recomendacao, 800) })).filter((x) => x.achado),
    proximos_testes: itens(r.proximos_testes).slice(0, 5).map((x) => ({
      titulo: texto(x.titulo, 200),
      hipotese: texto(x.hipotese, 1200),
      estilo_visual: doEnum(x.estilo_visual, ESTILOS_VISUAIS_IDS as readonly string[]),
      objetivo: doEnum(x.objetivo, ACOES_OBJETIVO),
    })).filter((x) => x.titulo),
  };
  const { data, error } = await servico
    .from("ads_analises")
    .insert({
      client_id: clientId,
      periodo_inicio: conta.periodo.inicio,
      periodo_fim: conta.periodo.fim,
      dados,
      analise,
      custo_usd: s.custoUsd,
      criado_por: chamador.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new ErroHttp(503, "analise_nao_salva", "A análise foi feita, mas não foi salva.", { analise, uso_id: s.usoId, custo_usd: s.custoUsd });
  return json({ analise, analise_id: (data as { id: string }).id, custo_usd: s.custoUsd, saldo_usd: s.saldoUsd });
}

// ------------------------------------------------------------ biblioteca do nicho

/**
 * biblioteca_do_nicho { client_id, nicho?, quantidade? (6 a 16), modelo_id?, raciocinio? }
 * -> { nicho, referencias, descartados, aviso, custo_usd, saldo_usd, jev_erro }
 * Padrões de criativo do nicho (E0, origem 'padrao', ficha completa), conferidos
 * pelo Jev (risco de política): padrão com alerta não entra.
 */
async function bibliotecaDoNicho(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const qtd = Math.min(16, Math.max(6, Math.round(Number(corpo.quantidade) || 10)));
  if (corpo.nicho != null && corpo.nicho !== "" && !NICHOS.some((n) => n.id === corpo.nicho)) throw new ErroHttp(400, "nicho_invalido", "Nicho desconhecido.");
  const [ctx, briefing] = await Promise.all([montarContextoAds(servico, clientId), carregarBriefing(servico, clientId).catch(() => null)]);
  const achado = await nichoDoCliente(ctx, briefing, { clientId, referencia: { tipo: REF_CLIENTE, id: clientId }, criadoPor: chamador.userId }, corpo.nicho);
  const nicho = achado.nicho;
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista");
  const s = await chamarTexto({
    clientId,
    tarefa: TAREFA,
    agente: AGENTE,
    modeloId: modelo.id,
    sistema: sistemaDoEstrategista(),
    mensagens: [{
      papel: "usuario",
      conteudo: `DADOS REAIS DO CLIENTE: ${JSON.stringify(ctx.dados)}
BRIEFING: ${JSON.stringify(resumoDoBriefing(briefing))}
${nicho ? textoDoNicho(nicho) : "NICHO: não identificado nos dados; use o negócio descrito acima."}

TAREFA: crie ${qtd} padrões de criativo estático para este nicho e este cliente, realmente diferentes entre si (situação, mecanismo e estilo visual), que param a rolagem e vendem dentro da política da Meta.
- São PADRÕES de estudo (E0), não anúncios reais: nada de métrica, resultado, marca de terceiros ou depoimento.
- prova_sugerida: o TIPO de prova que o cliente teria de ter (ou null); nunca uma prova inventada.
- gancho_visual sem escurecer a foto: contraste, composição, tipografia, escala e cor.
- riscos_de_politica: o que evitar ao executar.
- tags curtas (motivação, mecanismo, formato).`,
    }],
    raciocinio,
    esquemaJson: esquemaPadroesDoNicho(),
    referencia: { tipo: REF_CLIENTE, id: clientId },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as Record<string, unknown>;
  const padroes =(Array.isArray(r.padroes) ? r.padroes as Record<string, unknown>[] : []).slice(0, qtd)
    .map((p) => ({
      titulo: texto(p.titulo, 200),
      estilo_visual: doEnum(p.estilo_visual, ESTILOS_VISUAIS_IDS as readonly string[]),
      formato: doEnum(p.formato, FORMATOS) ?? "feed_4x5",
      situacao: texto(p.situacao, 800),
      motivacao: texto(p.motivacao, 300),
      mecanismo: texto(p.mecanismo, 600),
      gancho_visual: texto(p.gancho_visual, 600),
      gancho_verbal: texto(p.gancho_verbal, 200),
      texto_apoio: textoOuNulo(p.texto_apoio, 400),
      argumento: texto(p.argumento, 800),
      prova_sugerida: textoOuNulo(p.prova_sugerida, 400),
      cta: doEnum(p.cta, CTAS_META) ?? "Saiba mais",
      o_que_transportar: texto(p.o_que_transportar, 600),
      o_que_substituir: texto(p.o_que_substituir, 600),
      limites: texto(p.limites, 600),
      riscos_de_politica: texto(p.riscos_de_politica, 600),
      tags: (Array.isArray(p.tags) ? p.tags : []).map((t) => texto(t, 40).toLowerCase()).filter(Boolean).slice(0, 10),
    }))
    .filter((p) => p.titulo && p.mecanismo);
  const conferencia = await conferirPoliticaComJev(
    padroes.map((p) => ({ titulo: p.titulo, gancho_visual: p.gancho_visual, gancho_verbal: p.gancho_verbal, texto_apoio: p.texto_apoio, argumento: p.argumento, cta: p.cta })),
    { provas_disponiveis: briefing?.provas ?? [] },
    { clientId, referencia: { tipo: REF_CLIENTE, id: clientId }, criadoPor: chamador.userId },
    "padrão de criativo: gancho visual, gancho verbal, texto de apoio, argumento e CTA",
  );
  const descartados: { titulo: string; motivo: string }[] = [];
  const linhas: Record<string, unknown>[] = [];
  padroes.forEach((p, i) => {
    const nota = conferencia.notas[i];
    if (nota?.alerta_politica) {
      descartados.push({ titulo: p.titulo, motivo: `Alerta de política da Meta (nota de risco ${String(nota.risco_politica ?? "").replace(".", ",")}; 10 = sem risco).` });
      return;
    }
    const estilo = estiloPorId(p.estilo_visual);
    linhas.push({
      client_id: clientId,
      titulo: p.titulo,
      url: null,
      origem: "padrao",
      plataforma: "meta",
      formato: p.formato,
      evidencia: "E0",
      mecanismo: p.mecanismo,
      tags: [...new Set([...(nicho ? [nicho.id] : []), ...(estilo ? [estilo.id] : []), ...p.tags])].slice(0, 20),
      ficha: {
        observado: "Padrão criado pelo estrategista para o nicho: não é anúncio real e não tem métrica (E0).",
        inferido: `${p.situacao} Motivação: ${p.motivacao}`.trim(),
        tipo: "anuncio",
        plataforma: "meta",
        formato: p.formato,
        situacao: p.situacao,
        motivacao: p.motivacao,
        estilo_visual: p.estilo_visual,
        gancho_visual: p.gancho_visual,
        gancho_verbal: p.gancho_verbal,
        texto_apoio: p.texto_apoio,
        argumento: p.argumento,
        prova: p.prova_sugerida,
        cta: p.cta,
        mecanismo: p.mecanismo,
        o_que_transportar: p.o_que_transportar,
        o_que_substituir: p.o_que_substituir,
        limites: p.limites,
        riscos_de_politica: p.riscos_de_politica,
        nicho: nicho ? { id: nicho.id, nome: nicho.nome } : null,
        jev: nota ?? null,
        conferencia_politica: nota ? "feita" : "pendente",
        criado_pelo_modelo: s.modeloId,
      },
      criado_por: chamador.userId,
    });
  });
  let referencias: unknown[] = [];
  if (linhas.length) {
    const { data, error } = await servico.from("ads_referencias").insert(linhas).select("*");
    if (error || !data) throw new ErroHttp(503, "padroes_nao_salvos", "Os padrões foram criados, mas não foram salvos.", { uso_id: s.usoId });
    referencias = data as unknown[];
  }
  const custo = arred6(s.custoUsd + conferencia.custo + achado.custo);
  const avisos = [
    conferencia.jev_erro ? "O Jev não respondeu: os padrões entraram sem a conferência de política (marcados como pendentes)." : "",
    nicho ? "" : "Não deu para identificar o nicho do cliente com segurança: os padrões seguem o negócio descrito nos dados. Escolha o nicho para refazer.",
  ].filter(Boolean);
  return json({
    nicho: nicho ? { id: nicho.id, nome: nicho.nome } : null,
    referencias,
    descartados,
    aviso: avisos.length ? avisos.join(" ") : null,
    custo_usd: custo,
    saldo_usd: s.saldoUsd,
    jev_erro: conferencia.jev_erro ?? achado.jev_erro,
  });
}

// ------------------------------------------------------------ pacote de copy

type ContextoDoPacote = {
  briefing: Briefing | null;
  plano: Plano | null;
  oferta: ReturnType<typeof ofertaDaLinha> | null;
  objetivo: ReturnType<typeof objetivoPorId>;
  marca: Awaited<ReturnType<typeof lerMarcaParaDirecao>>;
};

async function contextoDoPacote(servico: SupabaseClient, clientId: string, plano: Plano | null): Promise<ContextoDoPacote> {
  const [briefing, marca] = await Promise.all([
    carregarBriefing(servico, clientId, plano?.briefing_id ?? undefined).catch(() => null),
    lerMarcaParaDirecao(servico, clientId),
  ]);
  const ofertaId = plano?.estrutura?.oferta_id;
  const ofertaLinha = ofertaId ? await carregarOferta(servico, clientId, ofertaId).catch(() => null) : null;
  const objetivo = objetivoPorId(plano?.estrutura?.objetivo) ?? objetivoPorId((briefing?.objetivo ?? {}).acao);
  return { briefing, plano, oferta: ofertaLinha ? ofertaDaLinha(ofertaLinha) : null, objetivo, marca };
}

type PacoteGerado = { pacote: PacoteCopy; avisos: string[]; conferencia: Record<string, unknown>; custo: number; saldo: number | null; jev_erro: string | null; usoId: string };

/**
 * Pacote de um criativo: o estrategista escreve; o código aplica limites e
 * os campos da Meta (objetivo e evento vêm de OBJETIVOS_DE_CAMPANHA, verba só
 * do briefing); o Jev confere a política de todos os textos numa chamada e o
 * texto com alerta é reescrito uma vez ou sai.
 */
async function gerarPacoteDoCriativo(
  chamador: Chamador,
  c: Criativo,
  ctx: ContextoDoPacote,
  modelo: ModeloIa,
  raciocinio: string | undefined,
): Promise<PacoteGerado> {
  const angulo = ctx.plano?.angulos.find((a) => a.id === c.angulo_id) ?? null;
  const verba = numeroOuNulo((ctx.briefing?.objetivo ?? {}).verba_diaria_brl);
  const s = await chamarTexto({
    clientId: c.client_id,
    tarefa: TAREFA,
    agente: AGENTE,
    modeloId: modelo.id,
    sistema: sistemaDoEstrategista(),
    mensagens: [{
      papel: "usuario",
      conteudo: `BRIEFING: ${JSON.stringify(resumoDoBriefing(ctx.briefing))}
OFERTA: ${JSON.stringify(ctx.oferta ? { nome: ctx.oferta.nome, promessa: ctx.oferta.promessa, para_quem: ctx.oferta.para_quem, entregaveis: ctx.oferta.entregaveis, garantia: ctx.oferta.garantia, urgencia_real: ctx.oferta.urgencia_real, cta: ctx.oferta.cta } : null)}
OBJETIVO DA CAMPANHA: ${JSON.stringify(ctx.objetivo ?? null)}
MARCA: ${JSON.stringify({ nome: ctx.marca.nomeCliente, tom_de_voz: ctx.marca.tomDeVoz, regras: ctx.marca.regras })}
ÂNGULO: ${JSON.stringify(angulo ? { nome: angulo.nome, situacao: angulo.situacao, mecanismo: angulo.mecanismo, prova: angulo.prova, gancho_verbal: angulo.gancho_verbal, hipotese: angulo.hipotese, estagio: angulo.estagio_consciencia } : null)}
CRIATIVO: ${JSON.stringify({ nome: c.nome, formato: c.formato, texto_principal: c.copy.texto_principal, titulo: c.copy.titulo, descricao: c.copy.descricao, cta_meta: c.copy.cta_meta, headline_arte: c.copy.headline_arte })}
VERBA DIÁRIA DO BRIEFING: ${verba != null ? `R$ ${verba}` : "não informada"}

TAREFA: escreva o pacote completo de copy deste criativo para o gestor de tráfego, agressivo e vendedor dentro da política da Meta.
- textos_principais: pelo menos 6, um de cada estilo (curto, medio, longo, pas, historia, prova_objecao); o começo de cada um carrega a ideia inteira (cerca de 125 caracteres aparecem antes do "ver mais").
- titulos: pelo menos 8, até 40 caracteres cada. descricoes: pelo menos 5, até 30 caracteres cada.
- ctas: de 2 a 4 botões da lista da Meta coerentes com o destino e o objetivo, com o porquê.
- ganchos: pelo menos 5 primeiras linhas diferentes (situação, pergunta, contraintuitiva, objeção, demonstração).
- gestor: objetivo_meta e evento_otimizacao do objetivo acima; publico_sugerido (sem atributo sensível); conjuntos; utm (utm_source=meta&utm_medium=paid&utm_campaign=...&utm_content=...); regras_de_corte e regras_de_escala pela métrica que decide, sem prometer número; verba só se o briefing informou (senão null).
- Prova, número, prazo, preço, desconto ou urgência só se estiverem no briefing ou na oferta.`,
    }],
    raciocinio,
    esquemaJson: ESQUEMA_PACOTE,
    referencia: { tipo: REF_CRIATIVO, id: c.id },
    criadoPor: chamador.userId,
  });
  let custo = s.custoUsd;
  let saldo: number | null = s.saldoUsd;
  const normalizado = normalizarPacoteCopy(s.json, CTAS_META);
  let pacote = normalizado.pacote;
  const avisos = [...normalizado.avisos];
  // Campos da Meta vêm do código, não da IA.
  if (ctx.objetivo) pacote.gestor = { ...pacote.gestor, objetivo_meta: ctx.objetivo.objetivo_meta, evento_otimizacao: ctx.objetivo.evento_otimizacao };
  if (verba == null) pacote.gestor = { ...pacote.gestor, verba: null };

  const lista = textosDoPacote(pacote);
  const cobranca = { clientId: c.client_id, referencia: { tipo: REF_CRIATIVO, id: c.id }, criadoPor: chamador.userId };
  const contexto = { oferta: ctx.oferta ?? ctx.briefing?.oferta ?? "não informada", destino: ctx.briefing?.destino ?? "não informado", provas_disponiveis: ctx.briefing?.provas ?? [] };
  const oQue = "texto de anúncio: texto principal, título, descrição ou gancho";
  const conf = await conferirPoliticaComJev(lista.map((t) => ({ campo: t.campo, texto: t.texto })), contexto, cobranca, oQue);
  custo += conf.custo;
  let jevErro = conf.jev_erro;
  const trocas = new Map<string, string>();
  const remover = new Set<string>();
  const alertados = lista.filter((_, i) => conf.notas[i]?.alerta_politica);
  if (alertados.length) {
    const chave = (t: { campo: string; indice: number }) => `${t.campo}:${t.indice}`;
    let reescritos: { chave: string; texto: string }[] = [];
    if (restanteMs(chamador) > TEMPO_DE_UMA_RODADA_MS / 2) {
      try {
        const re = await chamarTexto({
          clientId: c.client_id,
          tarefa: TAREFA,
          agente: AGENTE,
          modeloId: modelo.id,
          sistema: sistemaDoEstrategista(),
          mensagens: [{
            papel: "usuario",
            conteudo: `BRIEFING: ${JSON.stringify(resumoDoBriefing(ctx.briefing))}
TEXTOS COM ALERTA DE POLÍTICA DA META: ${JSON.stringify(alertados.map((t) => ({ chave: chave(t), campo: t.campo, texto: t.texto, limite: t.campo === "titulo" ? 40 : t.campo === "descricao" ? 30 : null })))}

Reescreva cada texto mantendo a força de venda e tirando o risco (sem atributo pessoal, promessa de resultado, antes e depois, sensacionalismo, urgência falsa ou prova fora do briefing), respeitando o limite de caracteres. Devolva com a mesma chave.`,
          }],
          raciocinio,
          esquemaJson: ESQUEMA_TEXTOS_REESCRITOS,
          referencia: { tipo: REF_CRIATIVO, id: c.id },
          criadoPor: chamador.userId,
        });
        custo += re.custoUsd;
        saldo = re.saldoUsd;
        const validas = new Set(alertados.map(chave));
        reescritos = ((((re.json as Record<string, unknown> | undefined)?.textos as unknown[] | undefined) ?? []) as Record<string, unknown>[])
          .map((x) => ({ chave: String(x.chave ?? ""), texto: texto(x.texto, LIMITES_TEXTO_PACOTE) }))
          .filter((x) => validas.has(x.chave) && x.texto);
      } catch (err) {
        console.error("[mesa-ads] reescrita do pacote falhou", { nome: err instanceof Error ? err.name : "desconhecido" });
      }
    }
    if (reescritos.length) {
      const segunda = await conferirPoliticaComJev(reescritos.map((x) => ({ campo: x.chave.split(":")[0], texto: x.texto })), contexto, cobranca, oQue);
      custo += segunda.custo;
      if (segunda.jev_erro) jevErro = segunda.jev_erro;
      reescritos.forEach((x, i) => {
        const nota = segunda.notas[i];
        if (nota && !nota.alerta_politica) trocas.set(x.chave, x.texto);
      });
    }
    for (const t of alertados) if (!trocas.has(chave(t))) remover.add(chave(t));
    pacote = aplicarConferenciaNoPacote(pacote, trocas, remover);
    if (remover.size) avisos.push(`${remover.size} texto(s) com risco de política saíram do pacote.`);
  }
  if (jevErro) avisos.push("O Jev não respondeu a toda a conferência de política: revise os textos antes de subir.");
  return {
    pacote,
    avisos,
    conferencia: { verificados: lista.length, reescritos: trocas.size, removidos: remover.size, jev_erro: jevErro, pendente: !!jevErro },
    custo,
    saldo,
    jev_erro: jevErro,
    usoId: s.usoId,
  };
}

/** Teto de caracteres de um texto reescrito do pacote. */
const LIMITES_TEXTO_PACOTE = 2200;

/**
 * copy_pacote { criativo_id? | plano_id?, refazer?, modelo_id?, raciocinio? }
 * -> { pacotes: [{ criativo_id, pacote, avisos, conferencia }], criativo (só com criativo_id), pendentes, falhas, custo_usd, saldo_usd, jev_erro }
 * Grava em ads_criativos.copy.pacote. Com plano_id, faz os criativos do plano
 * (a mesma copy em formatos diferentes compartilha o pacote) até o tempo
 * acabar e devolve os pendentes.
 */
async function copyPacote(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  let criativos: Criativo[];
  let plano: Plano | null = null;
  let unico: Criativo | null = null;
  if (corpo.criativo_id) {
    unico = await carregarCriativo(servico, corpo.criativo_id);
    await exigirAcessoAoCliente(chamador, unico.client_id);
    plano = unico.plano_id ? await carregarPlano(servico, unico.plano_id).catch(() => null) : null;
    criativos = [unico];
  } else if (corpo.plano_id) {
    plano = await carregarPlano(servico, corpo.plano_id);
    await exigirAcessoAoCliente(chamador, plano.client_id);
    const { data, error } = await servico.from("ads_criativos").select("*").eq("plano_id", plano.id).eq("client_id", plano.client_id).order("criado_em").limit(200);
    if (error) throw new ErroHttp(503, "criativos_indisponiveis", "Não foi possível ler os criativos do plano.");
    criativos = ((data as Criativo[] | null) ?? []).map((c) => ({ ...c, copy: (c.copy ?? {}) as Record<string, unknown> }));
    if (corpo.refazer !== true) criativos = criativos.filter((c) => !c.copy.pacote);
    if (!criativos.length) return json({ pacotes: [], criativo: null, pendentes: [], falhas: [], custo_usd: 0, saldo_usd: null, jev_erro: null, aviso: "Todos os criativos deste plano já têm pacote. Use refazer para gerar de novo." });
  } else {
    throw new ErroHttp(400, "sem_alvo", "Informe criativo_id ou plano_id.");
  }
  const clientId = criativos[0].client_id;
  const ctx = await contextoDoPacote(servico, clientId, plano);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, "estrategista");

  // A mesma copy em formatos diferentes (feed, stories...) divide o pacote.
  const grupos = new Map<string, Criativo[]>();
  for (const c of criativos) {
    const k = `${c.angulo_id ?? c.id}|${String(c.copy.texto_principal ?? c.id)}`;
    const g = grupos.get(k) ?? [];
    g.push(c);
    grupos.set(k, g);
  }
  const lista = [...grupos.values()];
  let custo = 0;
  let saldo: number | null = null;
  let jevErro: string | null = null;
  const pacotes: { criativo_id: string; pacote: PacoteCopy; avisos: string[]; conferencia: Record<string, unknown> }[] = [];
  const pendentes: string[] = [];
  const falhas: { criativo_id: string; erro: string }[] = [];
  let atualizado: unknown = null;
  let primeiroErro: unknown = null;

  await emParalelo(lista, 3, async (grupo, i) => {
    // O primeiro grupo sempre roda; os outros só se ainda cabe uma rodada no relógio.
    if (i > 0 && restanteMs(chamador) < TEMPO_DE_UMA_RODADA_MS) {
      pendentes.push(...grupo.map((c) => c.id));
      return;
    }
    const base = grupo[0];
    try {
      const g = await gerarPacoteDoCriativo(chamador, base, ctx, modelo, raciocinio);
      custo += g.custo;
      if (g.saldo != null) saldo = g.saldo;
      if (g.jev_erro) jevErro = g.jev_erro;
      const registro = { ...g.pacote, avisos: g.avisos, conferencia: g.conferencia, gerado_em: new Date().toISOString(), modelo_id: modelo.id };
      for (const c of grupo) {
        const { data, error } = await servico.from("ads_criativos").update({ copy: { ...c.copy, pacote: registro } }).eq("id", c.id).eq("client_id", c.client_id).select("*").single();
        if (error || !data) {
          falhas.push({ criativo_id: c.id, erro: "O pacote foi escrito, mas não foi salvo neste criativo." });
          continue;
        }
        if (unico && c.id === unico.id) atualizado = data;
        pacotes.push({ criativo_id: c.id, pacote: g.pacote, avisos: g.avisos, conferencia: g.conferencia });
      }
    } catch (err) {
      if (!primeiroErro) primeiroErro = err;
      const msg = err instanceof Error ? err.message : "falha";
      falhas.push(...grupo.map((c) => ({ criativo_id: c.id, erro: msg })));
    }
  });
  custo = arred6(custo);
  await somarCustoDoPlano(servico, plano?.id ?? null, clientId, custo);
  if (!pacotes.length && primeiroErro) throw primeiroErro;
  return json({ pacotes, criativo: atualizado, pendentes, falhas, custo_usd: custo, saldo_usd: saldo, jev_erro: jevErro });
}

// ------------------------------------------------------------ pacote para o gestor

/**
 * Tarefa do gestor de tráfego: projeto ativo do cliente (tarefa sempre tem
 * projeto) e o membro da equipe ligado ao cliente (team_client_assignments)
 * com o papel 'traffic' (user_roles). Criada com o JWT de quem chamou (RLS de
 * tasks). Sem projeto ou com erro: tarefa_id null e o motivo no aviso.
 */
async function criarTarefaDoGestor(servico: SupabaseClient, chamador: Chamador, clientId: string, titulo: string, descricao: string): Promise<{ tarefa_id: string | null; responsavel_id: string | null; aviso: string | null }> {
  const doChamador = clienteDoChamador(chamador.token);
  const { data: projetos } = await doChamador.from("projects").select("id, status, updated_at").eq("client_id", clientId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(20);
  const fechados = ["done", "completed", "concluido", "concluded", "cancelled", "canceled", "cancelado", "archived", "arquivado"];
  const projeto = ((projetos as { id: string; status: string | null }[] | null) ?? []).find((p) => !fechados.includes(String(p.status ?? "").toLowerCase()));
  if (!projeto) {
    return { tarefa_id: null, responsavel_id: null, aviso: "Este cliente não tem projeto ativo, e toda tarefa precisa de um projeto: a tarefa não foi criada. O pacote está em Arquivos." };
  }
  const { data: ligados } = await servico.from("team_client_assignments").select("user_id").eq("client_id", clientId);
  const ids = [...new Set(((ligados as { user_id: string }[] | null) ?? []).map((x) => x.user_id))];
  let gestores: string[] = [];
  if (ids.length) {
    const { data: papeis } = await servico.from("user_roles").select("user_id").eq("role", "traffic").in("user_id", ids);
    gestores = [...new Set(((papeis as { user_id: string }[] | null) ?? []).map((x) => x.user_id))];
  }
  const responsavel = gestores.length === 1 ? gestores[0] : null;
  const { data: tarefa, error } = await doChamador
    .from("tasks")
    .insert({
      project_id: projeto.id,
      title: titulo.slice(0, 200),
      description: descricao.slice(0, 8000),
      status: "todo",
      kanban_status: "todo",
      priority: "medium",
      delivery_type: "traffic",
      workstream: "traffic",
      assigned_to: responsavel,
    })
    .select("id")
    .single();
  if (error || !tarefa) return { tarefa_id: null, responsavel_id: null, aviso: `A tarefa do gestor não foi criada: ${error?.message ?? "sem resposta do banco"}. O pacote está em Arquivos.` };
  const aviso = gestores.length === 0
    ? "Nenhum gestor de tráfego está ligado a este cliente: a tarefa ficou sem responsável."
    : gestores.length > 1
    ? "Mais de um gestor de tráfego está ligado a este cliente: a tarefa ficou sem responsável para a equipe escolher."
    : null;
  return { tarefa_id: (tarefa as { id: string }).id, responsavel_id: responsavel, aviso };
}

/**
 * pacote_enviar { client_id, plano_id?, criativo_ids?, criar_tarefa? }
 * -> { file_id, tarefa_id, markdown, responsavel_id, aviso, custo_usd: 0 }
 * Monta o pacote do gestor (Markdown, sem IA), grava em Arquivos (pasta
 * criativos, tipo "outro": a pasta não aceita "documento") e, com
 * criar_tarefa, abre a tarefa do gestor de tráfego.
 */
async function pacoteEnviar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const ids = [...new Set((Array.isArray(corpo.criativo_ids) ? corpo.criativo_ids : []).map(String).filter((x) => UUID.test(x)))];
  let plano: Plano | null = null;
  if (corpo.plano_id) {
    plano = await carregarPlano(servico, corpo.plano_id);
    if (plano.client_id !== clientId) throw new ErroHttp(403, "plano_de_outro_cliente", "Este plano é de outro cliente.");
  }
  if (!plano && !ids.length) throw new ErroHttp(400, "sem_criativos", "Informe o plano ou os criativos do pacote.");
  let q = servico.from("ads_criativos").select("*").eq("client_id", clientId);
  if (plano) q = q.eq("plano_id", plano.id);
  if (ids.length) q = q.in("id", ids);
  const { data, error } = await q.order("criado_em").limit(200);
  if (error) throw new ErroHttp(503, "criativos_indisponiveis", "Não foi possível ler os criativos.");
  const criativos = ((data as Criativo[] | null) ?? []).map((c) => ({ ...c, copy: (c.copy ?? {}) as Record<string, unknown> }));
  if (!criativos.length) throw new ErroHttp(404, "sem_criativos", "Nenhum criativo encontrado para o pacote.");
  if (!plano && criativos[0].plano_id) plano = await carregarPlano(servico, criativos[0].plano_id).catch(() => null);
  const ctx = await contextoDoPacote(servico, clientId, plano);

  const trabalhoIds = criativos.map((c) => c.trabalho_id).filter((x): x is string => !!x);
  const { data: trabalhos } = trabalhoIds.length
    ? await servico.from("estudio_trabalhos").select("id, status, direcao").eq("client_id", clientId).in("id", trabalhoIds)
    : { data: [] };
  const porTrabalho = new Map(((trabalhos as { id: string; status: string; direcao: Record<string, unknown> | null }[] | null) ?? []).map((t) => [t.id, t]));
  const itens: CriativoDoPacote[] = criativos.map((c) => {
    const t = c.trabalho_id ? porTrabalho.get(c.trabalho_id) : undefined;
    const entrega = (t?.direcao?.entrega_ads ?? null) as { file_ids?: string[] } | null;
    const arte = entrega?.file_ids?.length
      ? `Entregue em Arquivos > Criativos de anúncio (${entrega.file_ids.length} arquivo(s)).`
      : t ? `Ainda no Estúdio (${t.status}).` : "Sem arte no Estúdio.";
    const angulo = plano?.angulos.find((a) => a.id === c.angulo_id) ?? null;
    const p = c.copy.pacote as (PacoteCopy & Record<string, unknown>) | undefined;
    return {
      nome: c.nome ?? `Criativo ${c.formato}`,
      formato: c.formato,
      angulo: angulo?.nome ?? null,
      hipotese: angulo?.hipotese ?? null,
      arte,
      copy: { texto_principal: c.copy.texto_principal as string | null, titulo: c.copy.titulo as string | null, descricao: c.copy.descricao as string | null, cta_meta: c.copy.cta_meta as string | null },
      pacote: p && Array.isArray(p.titulos) ? p : null,
    };
  });
  const agora = new Date().toISOString();
  const verba = numeroOuNulo((ctx.briefing?.objetivo ?? {}).verba_diaria_brl);
  const destino = ctx.briefing?.destino as Record<string, unknown> | undefined;
  const markdown = markdownDoPacote({
    cliente: ctx.marca.nomeCliente,
    plano: plano?.nome ?? null,
    gerado_em: agora,
    objetivo: ctx.objetivo ? { nome: ctx.objetivo.nome, objetivo_meta: ctx.objetivo.objetivo_meta, evento_otimizacao: ctx.objetivo.evento_otimizacao, metrica_que_decide: ctx.objetivo.metrica_que_decide } : null,
    oferta: ctx.oferta ? { nome: ctx.oferta.nome, promessa: ctx.oferta.promessa } : null,
    destino: destino ? [destino.tipo, destino.url].filter(Boolean).join(": ") || null : null,
    verba_diaria_brl: verba,
    criativos: itens,
  });

  const doChamador = clienteDoChamador(chamador.token);
  const fileId = crypto.randomUUID();
  const nome = `Pacote do gestor ${plano?.nome ?? "de criativos"} ${hojeSaoPaulo()}`.slice(0, 150);
  const caminho = `${clientId}/${fileId}/v1/${slugArquivo(nome)}.md`;
  const bytes = new TextEncoder().encode(markdown);
  const { error: erroUpload } = await doChamador.storage.from("files").upload(caminho, new Blob([bytes], { type: "text/markdown" }), { contentType: "text/markdown; charset=utf-8", upsert: false });
  if (erroUpload) throw new ErroHttp(503, "envio_de_arquivo_falhou", "Não foi possível enviar o pacote para Arquivos. Tente de novo.", { detalhe: erroUpload.message, markdown });
  const { data: registro, error: erroRegistro } = await doChamador.rpc("create_file_record", {
    p_file: {
      id: fileId,
      client_id: clientId,
      file_name: `${nome}.md`,
      file_url: `files://${caminho}`,
      file_type: "outro",
      mime_type: "text/markdown",
      extension: "md",
      storage_bucket: "files",
      storage_path: caminho,
      size_bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      folder: "criativos",
      project_id: null,
      status: "ready",
      version: 1,
      description: `Pacote do gestor de tráfego da Mesa Ads: ${criativos.length} criativo(s)${plano ? ` do plano ${plano.nome}` : ""}.`.slice(0, 1000),
      idempotency_key: `mesa-ads:pacote:${fileId}`,
    },
  });
  if (erroRegistro || !registro) {
    await doChamador.storage.from("files").remove([caminho]).catch(() => {});
    throw new ErroHttp(503, "registro_de_arquivo_falhou", "O pacote subiu, mas o registro em Arquivos falhou. Tente de novo.", { detalhe: erroRegistro?.message ?? null, markdown });
  }
  const avisos: string[] = [];
  const semPacote = itens.filter((x) => !x.pacote).length;
  if (semPacote) avisos.push(`${semPacote} criativo(s) foram só com a copy principal: gere o pacote de copy para ter as variações.`);
  let tarefa: { tarefa_id: string | null; responsavel_id: string | null; aviso: string | null } = { tarefa_id: null, responsavel_id: null, aviso: null };
  if (corpo.criar_tarefa === true) {
    tarefa = await criarTarefaDoGestor(
      servico,
      chamador,
      clientId,
      `Subir criativos da Mesa Ads${plano ? `: ${plano.nome}` : ""}`,
      `Pacote do gestor em Arquivos > Criativos de anúncio: "${nome}.md".\n\n${criativos.length} criativo(s). Conferir artes, textos, CTA, UTM e regras de corte e escala antes de subir.${ctx.objetivo ? `\nObjetivo na Meta: ${ctx.objetivo.objetivo_meta} (otimizar para ${ctx.objetivo.evento_otimizacao}).` : ""}`,
    );
    if (tarefa.aviso) avisos.push(tarefa.aviso);
  }
  return json({
    file_id: (registro as { id: string }).id,
    tarefa_id: tarefa.tarefa_id,
    markdown,
    responsavel_id: tarefa.responsavel_id,
    aviso: avisos.length ? avisos.join(" ") : null,
    custo_usd: 0,
  });
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
  // v2 (docs/mesa-ads/v2/CONTRATO-V2.md)
  oferta_conversar: ofertaConversar,
  oferta_salvar: ofertaSalvar,
  oferta_listar: ofertaListar,
  conta_ao_vivo: contaAoVivo,
  conta_sincronizar: contaSincronizar,
  conta_analisar: contaAnalisar,
  referencia_abrir: referenciaAbrir,
  referencia_importar_url: referenciaImportarUrl,
  biblioteca_do_nicho: bibliotecaDoNicho,
  copy_pacote: copyPacote,
  pacote_enviar: pacoteEnviar,
};

/**
 * Ações que podem passar de 150 s (IA, rodadas do Jev, downloads): a resposta
 * começa na hora para a plataforma não derrubar com 504 (resposta-com-folego.ts).
 */
const ACOES_LONGAS = new Set([
  "briefing_sugerir", "referencia_ler", "referencias_importar_proprias", "plano_gerar", "plano_conversar",
  "criativos_produzir", "copy_variar", "oferta_conversar", "conta_sincronizar", "conta_analisar",
  "referencia_abrir", "referencia_importar_url", "biblioteca_do_nicho", "copy_pacote", "pacote_enviar",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido" }, 405);
  const inicioMs = Date.now();
  try {
    const servico = clienteServico();
    const chamador = await identificar(req, servico, inicioMs);
    let corpo: Record<string, unknown> = {};
    try { corpo = await req.json(); } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? corpo.action ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", aceitas: Object.keys(ACOES) }, 400);
    if (ACOES_LONGAS.has(acao)) {
      return respostaComFolego(async () => {
        try {
          return await fn(servico, chamador, corpo);
        } catch (err) {
          return respostaDeErro(err);
        }
      }, corsHeaders);
    }
    return await fn(servico, chamador, corpo);
  } catch (err) {
    return respostaDeErro(err);
  }
});
