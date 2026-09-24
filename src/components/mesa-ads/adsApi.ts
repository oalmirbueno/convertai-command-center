import { supabase } from "@/integrations/supabase/client";
import {
  chamarFuncao,
  ErroDaMesa,
  padraoPara,
  saidaPorRaciocinio,
  TAMANHOS,
  type FuncaoDaMesa,
  type ModeloIa,
  type ParteDaEstimativa,
} from "@/lib/mesa/api";
import { extensaoDoAnexo } from "@/components/mesa/mesaV4Api";
import { novoId } from "@/components/mesa/EstudioFotos";

/**
 * Mesa Ads: a ponte da tela com a função mesa-ads e as tabelas ads_*
 * (docs/mesa-ads/SPEC.md). A função é chamada pelo mesmo caminho da Mesa
 * (chamarFuncao), com o erro já traduzido para gente. As leituras vão direto
 * ao banco pela RLS da equipe e devolvem só JSON puro (o cache da Mesa vai
 * para o navegador).
 */

// ------------------------------------------------------------------ tipos

export type EstagioDeConsciencia = "inconsciente" | "problema" | "solucao" | "produto" | "mais_consciente";
export type TipoDeProva = "depoimento" | "numero" | "caso" | "certificacao" | "demonstracao";
export type TipoDeDestino = "whatsapp" | "pagina" | "formulario" | "direct" | "ligacao";
export type AcaoDoObjetivo = "mensagens" | "leads" | "vendas" | "trafego" | "agendamento";
export type Evidencia = "E0" | "E1" | "E2" | "E3" | "E4";
export type FormatoAds = "feed_4x5" | "quadrado_1x1" | "stories_9x16" | "carrossel";
export type StatusDoCriativo = "rascunho" | "pronto" | "no_ar" | "pausado" | "encerrado";
export type StatusDoPlano = "rascunho" | "aprovado" | "em_teste" | "concluido";
export type OrigemDaReferencia =
  | "meta_ad_library"
  | "tiktok"
  | "swiped"
  | "pinterest"
  | "instagram"
  | "upload"
  | "anuncio_proprio"
  | "catalogo"
  | "outro";

export interface ComFonte {
  texto: string;
  fonte: string;
}

export interface Objecao {
  texto: string;
  resposta: string;
  fonte: string;
}

export interface Prova {
  tipo: TipoDeProva;
  texto: string;
  fonte: string;
  autorizado: boolean;
  periodo: string;
}

export interface BriefingAds {
  oferta: { produto: string; promessa: string; condicao: string; preco_confirmado: string; garantia: string };
  publico: { quem: string; situacoes: ComFonte[]; estagio_consciencia: EstagioDeConsciencia | ""; motivacoes: string[] };
  objecoes: Objecao[];
  provas: Prova[];
  destino: { tipo: TipoDeDestino | ""; url: string; primeira_mensagem: string };
  objetivo: { acao: AcaoDoObjetivo | ""; metrica_principal: string; custo_toleravel_brl: string; verba_diaria_brl: string };
  restricoes: string;
}

export interface BriefingSalvo extends BriefingAds {
  id: string;
  versao: number;
  criado_em: string;
}

export interface FichaDaReferencia {
  situacao?: string;
  motivacao?: string;
  estagio?: string;
  gancho_visual?: string;
  gancho_verbal?: string;
  argumento?: string;
  prova?: string;
  objecao?: string;
  cta?: string;
  destino?: string;
  mecanismo?: string;
  o_que_transportar?: string;
  o_que_substituir?: string;
  limites?: string;
  [campo: string]: unknown;
}

export interface ReferenciaAds {
  id: string;
  client_id: string | null;
  titulo: string;
  url: string | null;
  origem: OrigemDaReferencia;
  storage_path: string | null;
  ad_id: string | null;
  plataforma: string | null;
  formato: string | null;
  evidencia: Evidencia;
  metricas: Record<string, unknown>;
  ficha: FichaDaReferencia;
  mecanismo: string | null;
  tags: string[];
  destaque: boolean;
  criado_em: string;
}

export interface NotasDoJev {
  clareza?: number | null;
  relevancia?: number | null;
  prova?: number | null;
  risco_politica?: number | null;
}

export interface Angulo {
  id: string;
  nome: string;
  situacao?: string;
  mecanismo?: string;
  referencia_ids?: string[];
  prova?: string;
  gancho_visual?: string;
  gancho_verbal?: string;
  hipotese?: string;
  metrica?: string;
  janela_dias?: number | null;
  formatos?: FormatoAds[];
  variacoes?: number;
  jev?: NotasDoJev | null;
}

export interface PlanoAds {
  id: string;
  client_id: string;
  briefing_id: string | null;
  nome: string;
  status: StatusDoPlano;
  angulos: Angulo[];
  estrutura: Record<string, unknown>;
  pedido: string | null;
  conversa_id: string | null;
  custo_usd: number;
  criado_em: string;
  atualizado_em: string;
}

export interface CopyDoAnuncio {
  texto_principal?: string;
  texto_principal_longo?: string;
  titulo?: string;
  descricao?: string;
  cta_meta?: string;
}

export interface CriativoAds {
  id: string;
  client_id: string;
  plano_id: string | null;
  angulo_id: string | null;
  trabalho_id: string | null;
  nome: string | null;
  formato: FormatoAds;
  copy: CopyDoAnuncio;
  status: StatusDoCriativo;
  ad_id: string | null;
  evidencia: Evidencia;
  criado_em: string;
  atualizado_em: string;
}

export interface AnuncioDoCliente {
  ad_id: string;
  ad_name: string | null;
  titulo: string | null;
  thumbnail_url: string | null;
  effective_status: string | null;
}

export interface MetricasDoCriativo {
  gasto?: number | null;
  impressoes?: number | null;
  ctr_saida?: number | null;
  cpc?: number | null;
  cpm?: number | null;
  frequencia?: number | null;
  resultados?: number | null;
  custo_por_resultado?: number | null;
}

export interface DiagnosticoDoCriativo {
  sinal?: string;
  leitura?: string;
  acao?: string;
  [campo: string]: unknown;
}

export interface LinhaDeResultado {
  criativo_id: string | null;
  ad_id: string | null;
  nome: string;
  formato?: string | null;
  metricas: MetricasDoCriativo;
  diagnostico: DiagnosticoDoCriativo | string | null;
}

export interface ResultadosAds {
  periodo: { inicio: string; fim: string } | null;
  linhas: LinhaDeResultado[];
  sem_vinculo: AnuncioDoCliente[];
}

// ------------------------------------------------------------------ rótulos

export const ESTAGIOS: { valor: EstagioDeConsciencia; rotulo: string; dica: string }[] = [
  { valor: "inconsciente", rotulo: "Inconsciente", dica: "Não percebe o problema. O anúncio começa na situação vivida." },
  { valor: "problema", rotulo: "Sabe do problema", dica: "Sente a dor, não conhece saídas. Nomeie o problema com as palavras dele." },
  { valor: "solucao", rotulo: "Sabe da solução", dica: "Conhece saídas, não a sua. Mostre o mecanismo e por que funciona." },
  { valor: "produto", rotulo: "Conhece o produto", dica: "Já viu a marca. Prova e condição decidem." },
  { valor: "mais_consciente", rotulo: "Pronto para comprar", dica: "Só falta o empurrão: oferta, condição e CTA claros." },
];

export const TIPOS_DE_PROVA: { valor: TipoDeProva; rotulo: string }[] = [
  { valor: "depoimento", rotulo: "Depoimento" },
  { valor: "numero", rotulo: "Número" },
  { valor: "caso", rotulo: "Caso" },
  { valor: "certificacao", rotulo: "Certificação" },
  { valor: "demonstracao", rotulo: "Demonstração" },
];

export const DESTINOS: { valor: TipoDeDestino; rotulo: string }[] = [
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "pagina", rotulo: "Página" },
  { valor: "formulario", rotulo: "Formulário" },
  { valor: "direct", rotulo: "Direct" },
  { valor: "ligacao", rotulo: "Ligação" },
];

export const ACOES_DO_OBJETIVO: { valor: AcaoDoObjetivo; rotulo: string }[] = [
  { valor: "mensagens", rotulo: "Mensagens" },
  { valor: "leads", rotulo: "Leads" },
  { valor: "vendas", rotulo: "Vendas" },
  { valor: "trafego", rotulo: "Tráfego" },
  { valor: "agendamento", rotulo: "Agendamento" },
];

export const ESCALA_DE_EVIDENCIA: { valor: Evidencia; rotulo: string; dica: string; cor: string }[] = [
  { valor: "E0", rotulo: "Referência", dica: "Só inspiração: nada se sabe do resultado.", cor: "bg-secondary text-muted-foreground" },
  { valor: "E1", rotulo: "Circulação observada", dica: "Vista no ar, sem sinal de retorno.", cor: "bg-info/10 text-info" },
  { valor: "E2", rotulo: "Sinal indireto", dica: "Longevidade ou muitas variações. Sugere, não prova.", cor: "bg-warning/15 text-warning" },
  { valor: "E3", rotulo: "Resultado documentado", dica: "Gasto, resultado, período e atribuição conhecidos.", cor: "bg-success/10 text-success" },
  { valor: "E4", rotulo: "Replicação própria", dica: "Testado na nossa conta e confirmado em nova janela.", cor: "bg-primary/15 text-primary" },
];

export const AVISO_DA_EVIDENCIA = "Longevidade, curtidas e \"biblioteca de vencedores\" não são prova de retorno.";

export const ORIGENS: { valor: OrigemDaReferencia; rotulo: string }[] = [
  { valor: "meta_ad_library", rotulo: "Meta Ad Library" },
  { valor: "tiktok", rotulo: "TikTok" },
  { valor: "swiped", rotulo: "Swiped" },
  { valor: "pinterest", rotulo: "Pinterest" },
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "upload", rotulo: "Print" },
  { valor: "anuncio_proprio", rotulo: "Anúncio próprio" },
  { valor: "catalogo", rotulo: "Catálogo" },
  { valor: "outro", rotulo: "Outro" },
];

export const rotuloDaOrigem = (o?: string | null) => (ORIGENS.find((x) => x.valor === o) || { rotulo: "Outro" }).rotulo;

export const FORMATOS: { valor: FormatoAds; rotulo: string; curto: string; largura: number; altura: number }[] = [
  { valor: "feed_4x5", rotulo: "Feed 4:5", curto: "4:5", largura: 1088, altura: 1360 },
  { valor: "quadrado_1x1", rotulo: "Quadrado 1:1", curto: "1:1", largura: 1088, altura: 1088 },
  { valor: "stories_9x16", rotulo: "Stories e Reels 9:16", curto: "9:16", largura: 1088, altura: 1920 },
  { valor: "carrossel", rotulo: "Carrossel", curto: "carrossel", largura: 1088, altura: 1360 },
];

export const formatoDe = (f?: string | null) => FORMATOS.find((x) => x.valor === f) || FORMATOS[0];

/** Zona segura dos stories e reels: nada importante nos 14% de cima e nos 20% de baixo. */
export const ZONA_SEGURA = { topo: 0.14, base: 0.2 };

export const STATUS_DO_CRIATIVO: { valor: StatusDoCriativo; rotulo: string; tom: string }[] = [
  { valor: "rascunho", rotulo: "Rascunho", tom: "bg-secondary text-muted-foreground" },
  { valor: "pronto", rotulo: "Pronto", tom: "bg-info/10 text-info" },
  { valor: "no_ar", rotulo: "No ar", tom: "bg-success/10 text-success" },
  { valor: "pausado", rotulo: "Pausado", tom: "bg-warning/15 text-warning" },
  { valor: "encerrado", rotulo: "Encerrado", tom: "bg-secondary text-muted-foreground" },
];

export const STATUS_DO_PLANO: { valor: StatusDoPlano; rotulo: string }[] = [
  { valor: "rascunho", rotulo: "Rascunho" },
  { valor: "aprovado", rotulo: "Aprovado" },
  { valor: "em_teste", rotulo: "Em teste" },
  { valor: "concluido", rotulo: "Concluído" },
];

/** CTAs do Meta mais usados em anúncios de resposta direta. */
export const CTAS_DO_META: { valor: string; rotulo: string }[] = [
  { valor: "SEND_WHATSAPP_MESSAGE", rotulo: "Enviar mensagem pelo WhatsApp" },
  { valor: "SEND_MESSAGE", rotulo: "Enviar mensagem" },
  { valor: "LEARN_MORE", rotulo: "Saiba mais" },
  { valor: "SIGN_UP", rotulo: "Cadastre-se" },
  { valor: "SHOP_NOW", rotulo: "Comprar agora" },
  { valor: "BOOK_NOW", rotulo: "Reservar" },
  { valor: "GET_QUOTE", rotulo: "Solicitar orçamento" },
  { valor: "CONTACT_US", rotulo: "Fale conosco" },
  { valor: "CALL_NOW", rotulo: "Ligar" },
  { valor: "APPLY_NOW", rotulo: "Inscreva-se" },
  { valor: "GET_OFFER", rotulo: "Obter oferta" },
  { valor: "SUBSCRIBE", rotulo: "Assinar" },
];

export const rotuloDoCta = (v?: string | null) => {
  const c = CTAS_DO_META.find((x) => x.valor === v);
  return c ? c.rotulo : v || "";
};

/** Limites do texto do anúncio (Meta): o texto principal aparece inteiro até ~125 caracteres; título até 40. */
export const LIMITE_TEXTO_VISIVEL = 125;
export const LIMITE_TITULO = 40;

// ------------------------------------------------------------------ função

const NOME_DA_FUNCAO = "estrategista de ads";

/** Chama uma ação da função mesa-ads; erro vira ErroDaMesa com frase certa. */
export async function chamarAds<T = any>(acao: string, corpo: Record<string, unknown>): Promise<T> {
  try {
    return await chamarFuncao<T>("mesa-ads", { acao, ...corpo });
  } catch (e) {
    if (e instanceof ErroDaMesa && (e.codigo === "servico_indisponivel" || e.codigo === "acao_desconhecida")) {
      const frase =
        e.codigo === "servico_indisponivel"
          ? `O ${NOME_DA_FUNCAO} ainda não respondeu. Pode estar sendo publicado agora; tente de novo em instantes.`
          : `O ${NOME_DA_FUNCAO} ainda não conhece esta ação. Ela entra no ar em breve.`;
      throw new ErroDaMesa(e.codigo, frase, e.detalhes);
    }
    throw e;
  }
}

// ------------------------------------------------------------------ estimativas

export const TAMANHOS_ADS = {
  sugerirBriefing: { entrada: 25000, saida: 3000 },
  gerarPlano: { entrada: 30000 },
  conversarPlano: { entrada: 20000, saida: 4000 },
  produzirPorPeca: { entrada: 12000, saida: 3000 },
  variarCopy: { entrada: 8000, saida: 1500 },
};

export function partesDoBriefing(catalogo: ModeloIa[]): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_ADS.sugerirBriefing.entrada, tokensSaida: TAMANHOS_ADS.sugerirBriefing.saida }];
}

export function partesDoPlano(catalogo: ModeloIa[], angulos: number): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return [
    {
      modeloId: m ? m.id : null,
      tipo: "texto",
      tokensEntrada: TAMANHOS_ADS.gerarPlano.entrada,
      tokensSaida: saidaPorRaciocinio("medium") + angulos * 600,
    },
  ];
}

export function partesDaConversaDoPlano(catalogo: ModeloIa[], anexos: number): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return [
    {
      modeloId: m ? m.id : null,
      tipo: "texto",
      tokensEntrada: TAMANHOS_ADS.conversarPlano.entrada + anexos * TAMANHOS.imagemAnexos.entrada,
      tokensSaida: TAMANHOS_ADS.conversarPlano.saida,
    },
  ];
}

export function partesDaProducao(catalogo: ModeloIa[], pecas: number): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "diretor_arte");
  return [
    { modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_ADS.produzirPorPeca.entrada, tokensSaida: TAMANHOS_ADS.produzirPorPeca.saida, vezes: pecas },
  ];
}

export function partesDaCopy(catalogo: ModeloIa[]): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_ADS.variarCopy.entrada, tokensSaida: TAMANHOS_ADS.variarCopy.saida }];
}

export function partesDaLeitura(catalogo: ModeloIa[]): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "leitura");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS.lerReferencia.entrada, tokensSaida: TAMANHOS.lerReferencia.saida }];
}

// ------------------------------------------------------------------ chaves

export const chavesAds = {
  briefing: (clientId: string) => ["mesa", "ads", "briefing", clientId] as const,
  referencias: (clientId: string) => ["mesa", "ads", "referencias", clientId] as const,
  planos: (clientId: string) => ["mesa", "ads", "planos", clientId] as const,
  criativos: (clientId: string) => ["mesa", "ads", "criativos", clientId] as const,
  anuncios: (clientId: string) => ["mesa", "ads", "anuncios", clientId] as const,
  trabalhos: (clientId: string) => ["mesa", "ads", "trabalhos", clientId] as const,
  conversa: (planoId: string) => ["mesa", "ads", "conversa", planoId] as const,
  resultados: (clientId: string, periodo: string) => ["mesa", "ads", "resultados", clientId, periodo] as const,
  aprendizados: (clientId: string) => ["mesa", "ads", "aprendizados", clientId] as const,
};

// ------------------------------------------------------------------ normalização

const txt = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "number" ? String(v) : "");
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const umDe = <T extends string>(v: unknown, validos: T[]): T | "" => (validos.indexOf(v as T) >= 0 ? (v as T) : "");

export function briefingVazio(): BriefingAds {
  return {
    oferta: { produto: "", promessa: "", condicao: "", preco_confirmado: "", garantia: "" },
    publico: { quem: "", situacoes: [], estagio_consciencia: "", motivacoes: [] },
    objecoes: [],
    provas: [],
    destino: { tipo: "", url: "", primeira_mensagem: "" },
    objetivo: { acao: "", metrica_principal: "", custo_toleravel_brl: "", verba_diaria_brl: "" },
    restricoes: "",
  };
}

/** Qualquer formato que venha do banco ou da sugestão vira o formulário completo, sem inventar nada. */
export function normalizarBriefing(bruto: unknown): BriefingAds {
  const b = obj(bruto);
  const oferta = obj(b.oferta);
  const publico = obj(b.publico);
  const destino = obj(b.destino);
  const objetivo = obj(b.objetivo);
  return {
    oferta: {
      produto: txt(oferta.produto),
      promessa: txt(oferta.promessa),
      condicao: txt(oferta.condicao),
      preco_confirmado: txt(oferta.preco_confirmado),
      garantia: txt(oferta.garantia),
    },
    publico: {
      quem: txt(publico.quem),
      situacoes: lista(publico.situacoes).map((s) => (typeof s === "string" ? { texto: s, fonte: "" } : { texto: txt(obj(s).texto), fonte: txt(obj(s).fonte) })),
      estagio_consciencia: umDe(publico.estagio_consciencia, ESTAGIOS.map((e) => e.valor)),
      motivacoes: lista(publico.motivacoes).map(txt).filter(Boolean),
    },
    objecoes: lista(b.objecoes).map((o) => ({ texto: txt(obj(o).texto), resposta: txt(obj(o).resposta), fonte: txt(obj(o).fonte) })),
    provas: lista(b.provas).map((p) => ({
      tipo: (umDe(obj(p).tipo, TIPOS_DE_PROVA.map((t) => t.valor)) || "depoimento") as TipoDeProva,
      texto: txt(obj(p).texto),
      fonte: txt(obj(p).fonte),
      autorizado: obj(p).autorizado === true,
      periodo: txt(obj(p).periodo),
    })),
    destino: {
      tipo: umDe(destino.tipo, DESTINOS.map((d) => d.valor)),
      url: txt(destino.url),
      primeira_mensagem: txt(destino.primeira_mensagem),
    },
    objetivo: {
      acao: umDe(objetivo.acao, ACOES_DO_OBJETIVO.map((a) => a.valor)),
      metrica_principal: txt(objetivo.metrica_principal),
      custo_toleravel_brl: txt(objetivo.custo_toleravel_brl),
      verba_diaria_brl: txt(objetivo.verba_diaria_brl),
    },
    restricoes: txt(b.restricoes),
  };
}

const numeroOuNulo = (v: string): number | null => {
  const t = String(v || "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
};

/** O que vai para briefing_salvar: listas sem linhas vazias e valores em número onde o banco espera número. */
export function briefingParaSalvar(b: BriefingAds): Record<string, unknown> {
  return {
    oferta: { ...b.oferta },
    publico: {
      quem: b.publico.quem,
      situacoes: b.publico.situacoes.filter((s) => s.texto.trim()),
      estagio_consciencia: b.publico.estagio_consciencia || null,
      motivacoes: b.publico.motivacoes.filter((m) => m.trim()),
    },
    objecoes: b.objecoes.filter((o) => o.texto.trim()),
    provas: b.provas.filter((p) => p.texto.trim()),
    destino: { ...b.destino, tipo: b.destino.tipo || null },
    objetivo: {
      acao: b.objetivo.acao || null,
      metrica_principal: b.objetivo.metrica_principal,
      custo_toleravel_brl: numeroOuNulo(b.objetivo.custo_toleravel_brl),
      verba_diaria_brl: numeroOuNulo(b.objetivo.verba_diaria_brl),
    },
    restricoes: b.restricoes.trim() || null,
  };
}

function normalizarReferencia(r: any): ReferenciaAds {
  return {
    id: String(r.id),
    client_id: r.client_id ? String(r.client_id) : null,
    titulo: txt(r.titulo) || "Referência",
    url: r.url ? String(r.url) : null,
    origem: (r.origem || "outro") as OrigemDaReferencia,
    storage_path: r.storage_path ? String(r.storage_path) : null,
    ad_id: r.ad_id ? String(r.ad_id) : null,
    plataforma: r.plataforma ? String(r.plataforma) : null,
    formato: r.formato ? String(r.formato) : null,
    evidencia: (["E0", "E1", "E2", "E3", "E4"].indexOf(r.evidencia) >= 0 ? r.evidencia : "E0") as Evidencia,
    metricas: obj(r.metricas),
    ficha: obj(r.ficha) as FichaDaReferencia,
    mecanismo: r.mecanismo ? String(r.mecanismo) : null,
    tags: lista(r.tags).map(txt).filter(Boolean),
    destaque: r.destaque === true,
    criado_em: txt(r.criado_em),
  };
}

export function normalizarPlano(p: any): PlanoAds {
  return {
    id: String(p.id),
    client_id: String(p.client_id || ""),
    briefing_id: p.briefing_id ? String(p.briefing_id) : null,
    nome: txt(p.nome) || "Plano de teste",
    status: (p.status || "rascunho") as StatusDoPlano,
    angulos: lista(p.angulos).map((a, i) => ({ ...obj(a), id: txt(obj(a).id) || `a${i + 1}`, nome: txt(obj(a).nome) || `Ângulo ${i + 1}` })) as Angulo[],
    estrutura: obj(p.estrutura),
    pedido: p.pedido ? String(p.pedido) : null,
    conversa_id: p.conversa_id ? String(p.conversa_id) : null,
    custo_usd: Number(p.custo_usd || 0),
    criado_em: txt(p.criado_em),
    atualizado_em: txt(p.atualizado_em),
  };
}

function normalizarCriativo(c: any): CriativoAds {
  return {
    id: String(c.id),
    client_id: String(c.client_id || ""),
    plano_id: c.plano_id ? String(c.plano_id) : null,
    angulo_id: c.angulo_id ? String(c.angulo_id) : null,
    trabalho_id: c.trabalho_id ? String(c.trabalho_id) : null,
    nome: c.nome ? String(c.nome) : null,
    formato: formatoDe(c.formato).valor,
    copy: obj(c.copy) as CopyDoAnuncio,
    status: (c.status || "rascunho") as StatusDoCriativo,
    ad_id: c.ad_id ? String(c.ad_id) : null,
    evidencia: (c.evidencia || "E0") as Evidencia,
    criado_em: txt(c.criado_em),
    atualizado_em: txt(c.atualizado_em),
  };
}

// ------------------------------------------------------------------ leituras

const sb = () => supabase as any;

export async function lerBriefing(clientId: string): Promise<BriefingSalvo | null> {
  const { data, error } = await sb()
    .from("ads_briefings")
    .select("id, versao, oferta, publico, objecoes, provas, destino, objetivo, restricoes, criado_em")
    .eq("client_id", clientId)
    .eq("atual", true)
    .order("versao", { ascending: false })
    .limit(1);
  if (error) throw error;
  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha) return null;
  return { ...normalizarBriefing(linha), id: String(linha.id), versao: Number(linha.versao || 1), criado_em: txt(linha.criado_em) };
}

const COLUNAS_DA_REFERENCIA =
  "id, client_id, titulo, url, origem, storage_path, ad_id, plataforma, formato, evidencia, metricas, ficha, mecanismo, tags, destaque, criado_em";

/** Referências do cliente e da biblioteca da agência (client_id nulo). */
export async function lerReferencias(clientId: string): Promise<ReferenciaAds[]> {
  const { data, error } = await sb()
    .from("ads_referencias")
    .select(COLUNAS_DA_REFERENCIA)
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("ativa", true)
    .order("criado_em", { ascending: false })
    .limit(300);
  if (error) throw error;
  return lista(data).map(normalizarReferencia);
}

export async function lerPlanos(clientId: string): Promise<PlanoAds[]> {
  const { data, error } = await sb()
    .from("ads_planos")
    .select("id, client_id, briefing_id, nome, status, angulos, estrutura, pedido, conversa_id, custo_usd, criado_em, atualizado_em")
    .eq("client_id", clientId)
    .order("criado_em", { ascending: false })
    .limit(50);
  if (error) throw error;
  return lista(data).map(normalizarPlano);
}

export async function lerCriativos(clientId: string): Promise<CriativoAds[]> {
  const { data, error } = await sb()
    .from("ads_criativos")
    .select("id, client_id, plano_id, angulo_id, trabalho_id, nome, formato, copy, status, ad_id, evidencia, criado_em, atualizado_em")
    .eq("client_id", clientId)
    .order("criado_em", { ascending: false })
    .limit(300);
  if (error) throw error;
  return lista(data).map(normalizarCriativo);
}

export async function lerAnunciosDoCliente(clientId: string): Promise<AnuncioDoCliente[]> {
  const { data, error } = await sb()
    .from("ads_creatives")
    .select("ad_id, ad_name, titulo, thumbnail_url, effective_status")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return lista(data).map((a) => ({
    ad_id: String(a.ad_id),
    ad_name: a.ad_name ? String(a.ad_name) : null,
    titulo: a.titulo ? String(a.titulo) : null,
    thumbnail_url: a.thumbnail_url ? String(a.thumbnail_url) : null,
    effective_status: a.effective_status ? String(a.effective_status) : null,
  }));
}

export const nomeDoAnuncio = (a: AnuncioDoCliente) => a.ad_name || a.titulo || `Anúncio ${a.ad_id}`;

/** Trabalhos do Estúdio ligados aos criativos (miniatura e estado), numa leitura só. */
export async function lerTrabalhos(ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  const { data, error } = await sb().from("estudio_trabalhos").select("*").in("id", ids);
  if (error) throw error;
  return lista(data);
}

export async function lerConversaDoPlano(conversaId: string | null) {
  if (!conversaId) return [] as { id: string; papel: string; conteudo: string; anexos: any[] }[];
  const { data, error } = await sb()
    .from("agente_mensagens")
    .select("id, papel, conteudo, anexos, criado_em")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: false })
    .limit(80);
  if (error) throw error;
  return lista(data)
    .slice()
    .reverse()
    .map((m) => ({ id: String(m.id), papel: txt(m.papel), conteudo: txt(m.conteudo), anexos: lista(m.anexos) }));
}

export async function lerAprendizados(clientId: string): Promise<{ id: string; criativo_id: string | null; texto: string; evidencia: string; criado_em: string }[]> {
  const { data, error } = await sb()
    .from("ads_aprendizados")
    .select("id, criativo_id, texto, evidencia, criado_em")
    .eq("client_id", clientId)
    .order("criado_em", { ascending: false })
    .limit(100);
  if (error) throw error;
  return lista(data).map((a) => ({ id: String(a.id), criativo_id: a.criativo_id ? String(a.criativo_id) : null, texto: txt(a.texto), evidencia: txt(a.evidencia), criado_em: txt(a.criado_em) }));
}

/**
 * A função mesa-ads (calculos.ts) devolve ctr_saida_pct e frequencia_media;
 * a tabela usa ctr_saida e frequencia. Os dois nomes valem.
 */
function metricasDaFuncao(m: Record<string, any>): Record<string, any> {
  return {
    ...m,
    ctr_saida: m.ctr_saida ?? m.ctr_saida_pct ?? null,
    frequencia: m.frequencia ?? m.frequencia_media ?? null,
  };
}

/**
 * Diagnóstico da função: { situacao, sinais: [{ sinal, hipotese, verificar }], observacoes }.
 * A tela mostra o primeiro sinal (etiqueta), as hipóteses (leitura) e o que verificar (próximo passo).
 */
function diagnosticoDaFuncao(bruto: unknown): DiagnosticoDoCriativo | string | null {
  if (!bruto) return null;
  if (typeof bruto === "string") return bruto;
  const d = obj(bruto);
  const sinais = lista(d.sinais).map((s) => obj(s));
  if (!sinais.length && !d.situacao) return d as DiagnosticoDoCriativo;
  if (!sinais.length) {
    return {
      sinal: d.situacao === "inconclusivo" ? "Inconclusivo" : "Sem alerta",
      leitura: d.situacao === "inconclusivo" ? "Volume ainda baixo para concluir (poucas impressões ou cliques)." : "Nenhum sinal de alerta nos números da Meta.",
      acao: txt(lista(d.observacoes)[0]),
    } as DiagnosticoDoCriativo;
  }
  return {
    sinal: txt(sinais[0].sinal),
    leitura: sinais.map((s) => txt(s.hipotese)).filter(Boolean).join(" "),
    acao: sinais.map((s) => txt(s.verificar)).filter(Boolean).join(" "),
  } as DiagnosticoDoCriativo;
}

/** Resposta de resultados_ler em forma fixa (a função pode mandar campos a mais). */
export function normalizarResultados(bruto: unknown): ResultadosAds {
  const r = obj(bruto);
  const p = obj(r.periodo);
  const linhas = lista(r.criativos || r.linhas || r.resultados).map((l) => ({
    criativo_id: obj(l).criativo_id ? String(obj(l).criativo_id) : null,
    ad_id: obj(l).ad_id ? String(obj(l).ad_id) : null,
    nome: txt(obj(l).nome) || txt(obj(l).ad_name) || "Criativo",
    formato: obj(l).formato ? String(obj(l).formato) : null,
    metricas: metricasDaFuncao(obj(obj(l).metricas)),
    diagnostico: diagnosticoDaFuncao(obj(l).diagnostico),
  }));
  const sem = lista(r.sem_vinculo || r.anuncios_sem_vinculo).map((a) => ({
    ad_id: String(obj(a).ad_id || ""),
    ad_name: obj(a).ad_name ? String(obj(a).ad_name) : null,
    titulo: obj(a).titulo ? String(obj(a).titulo) : null,
    thumbnail_url: obj(a).thumbnail_url ? String(obj(a).thumbnail_url) : null,
    effective_status: obj(a).effective_status ? String(obj(a).effective_status) : null,
  })).filter((a) => a.ad_id);
  return {
    periodo: p.inicio && p.fim ? { inicio: txt(p.inicio), fim: txt(p.fim) } : null,
    linhas,
    sem_vinculo: sem,
  };
}

// ------------------------------------------------------------------ escritas diretas (RLS da equipe)

export async function marcarDestaque(id: string, destaque: boolean) {
  const { error } = await sb().from("ads_referencias").update({ destaque }).eq("id", id);
  if (error) throw error;
}

export async function salvarFicha(id: string, campos: { ficha: FichaDaReferencia; mecanismo: string | null; evidencia: Evidencia; titulo?: string }) {
  const { error } = await sb().from("ads_referencias").update(campos).eq("id", id);
  if (error) throw error;
}

/** Origem pelo endereço colado. */
export function origemDoLink(url: string): OrigemDaReferencia {
  const u = url.toLowerCase();
  if (u.indexOf("facebook.com/ads/library") >= 0 || u.indexOf("fb.com/ads") >= 0) return "meta_ad_library";
  if (u.indexOf("tiktok.com") >= 0) return "tiktok";
  if (u.indexOf("swiped.co") >= 0) return "swiped";
  if (u.indexOf("pinterest.") >= 0 || u.indexOf("pin.it") >= 0) return "pinterest";
  if (u.indexOf("instagram.com") >= 0) return "instagram";
  return "outro";
}

export function linkValido(url: string): boolean {
  return /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url.trim());
}

export async function adicionarLink(clientId: string, url: string, titulo: string) {
  const origem = origemDoLink(url);
  const { error } = await sb()
    .from("ads_referencias")
    .insert({ client_id: clientId, url: url.trim(), titulo: titulo.trim() || `${rotuloDaOrigem(origem)}: ${url.trim().slice(0, 60)}`, origem, evidencia: "E0" });
  if (error) throw error;
}

export const caminhoDaReferencia = (clientId: string, id: string, ext: string) => `${clientId}/ads/referencias/${id}.${ext}`;

/** Sobe o print no bucket mesa e grava a referência. */
export async function adicionarPrint(clientId: string, arquivo: File) {
  const ext = extensaoDoAnexo(arquivo);
  if (!ext) throw new Error("Só imagens JPG, PNG ou WEBP.");
  const caminho = caminhoDaReferencia(clientId, novoId(), ext);
  const tipo = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const { error } = await supabase.storage.from("mesa").upload(caminho, arquivo, { contentType: tipo, upsert: false });
  if (error) throw error;
  const nome = String(arquivo.name || "").replace(/\.[a-z0-9]+$/i, "").trim();
  const { error: erroInsert } = await sb()
    .from("ads_referencias")
    .insert({ client_id: clientId, titulo: nome && nome !== "image" ? nome : "Print de anúncio", origem: "upload", storage_path: caminho, evidencia: "E0" });
  if (erroInsert) throw erroInsert;
  return caminho;
}

export async function mudarCriativo(id: string, campos: { status?: StatusDoCriativo; ad_id?: string | null; copy?: CopyDoAnuncio; nome?: string }) {
  const { error } = await sb().from("ads_criativos").update(campos).eq("id", id);
  if (error) throw error;
}

export async function mudarPlano(id: string, campos: { status?: StatusDoPlano; nome?: string; angulos?: Angulo[] }) {
  const { error } = await sb().from("ads_planos").update(campos).eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------------ números

export const brl = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(Number(v)) ? "-" : `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const inteiro = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(Number(v)) ? "-" : Math.round(Number(v)).toLocaleString("pt-BR");
export const porcento = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(Number(v)) ? "-" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
export const decimal = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(Number(v)) ? "-" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Notas do Jev em 0 a 10. A escala é decidida pelo conjunto (todas até 1:
 * frações; alguma acima de 10: 0 a 100), para um "1" em 0 a 10 não virar 10.
 */
export function notasDe10(jev: NotasDoJev | null | undefined): Record<keyof NotasDoJev, number | null> {
  const chavesDoJev: (keyof NotasDoJev)[] = ["clareza", "relevancia", "prova", "risco_politica"];
  const brutos = chavesDoJev.map((k) => {
    const v = jev ? jev[k] : null;
    const n = Number(v);
    return v === null || v === undefined || (v as unknown) === "" || !isFinite(n) ? null : n;
  });
  const validos = brutos.filter((n): n is number => n !== null);
  const maior = validos.length ? Math.max.apply(null, validos) : 0;
  const fator = maior <= 1 ? 10 : maior > 10 ? 0.1 : 1;
  const saida = {} as Record<keyof NotasDoJev, number | null>;
  chavesDoJev.forEach((k, i) => {
    const n = brutos[i];
    saida[k] = n === null ? null : Math.max(0, Math.min(10, Math.round(n * fator * 10) / 10));
  });
  return saida;
}
