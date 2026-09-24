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
  type Qualidade,
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
/** Objetivos de campanha (OBJETIVOS_DE_CAMPANHA do conhecimento de ads). */
export type AcaoDoObjetivo = "vendas" | "mensagens" | "leads" | "seguidores" | "agendamento" | "trafego" | "reconhecimento";
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
  | "padrao"
  | "url"
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
  parada?: number | null;
  diferenciacao?: number | null;
  alerta_politica?: unknown;
}

export interface Angulo {
  /** v2: laço de qualidade do servidor. */
  estilo_visual?: string;
  objetivo?: string;
  pontuacao?: number | null;
  rodadas?: number | null;
  aprovado?: boolean;
  reprovado?: boolean;
  motivos?: string[];
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
  /** Pacote completo (copy_pacote) gravado junto; a tela normaliza com normalizarPacote. */
  pacote?: unknown;
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

export const OBJETIVOS: { valor: AcaoDoObjetivo; rotulo: string; dica: string }[] = [
  { valor: "vendas", rotulo: "Vendas", dica: "Compra no site ou no catálogo. Decide o custo por compra." },
  { valor: "mensagens", rotulo: "Mensagens", dica: "Conversa no WhatsApp ou no Direct. Decide a conversa qualificada." },
  { valor: "leads", rotulo: "Leads", dica: "Cadastro no formulário. Decide o lead que atende." },
  { valor: "seguidores", rotulo: "Seguidores do perfil", dica: "Visita e seguidor no Instagram. Decide o custo por seguidor que fica." },
  { valor: "agendamento", rotulo: "Agendamento", dica: "Horário marcado. Decide a consulta ou visita que acontece." },
  { valor: "trafego", rotulo: "Tráfego", dica: "Visita na página. Decide o clique que lê a página." },
  { valor: "reconhecimento", rotulo: "Reconhecimento", dica: "Alcance e lembrança. Decide o custo por mil pessoas." },
];

export const ACOES_DO_OBJETIVO: { valor: AcaoDoObjetivo; rotulo: string }[] = OBJETIVOS.map((o) => ({ valor: o.valor, rotulo: o.rotulo }));

export const rotuloDoObjetivo = (v?: string | null) => {
  const o = OBJETIVOS.find((x) => x.valor === v);
  return o ? o.rotulo : v ? humanizar(v) : "";
};

/** id_de_coisa vira "Id de coisa" (estilos visuais, nichos e sinais que chegam como id). */
export function humanizar(v?: string | null): string {
  const t = String(v || "").replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

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
  { valor: "padrao", rotulo: "Padrão do nicho" },
  { valor: "url", rotulo: "Link" },
  { valor: "outro", rotulo: "Outro" },
];

export const CAMPOS_DA_FICHA: { chave: keyof FichaDaReferencia; rotulo: string; longo?: boolean }[] = [
  { chave: "situacao", rotulo: "Situação do comprador", longo: true },
  { chave: "motivacao", rotulo: "Motivação" },
  { chave: "estagio", rotulo: "Estágio de consciência" },
  { chave: "gancho_visual", rotulo: "Gancho visual", longo: true },
  { chave: "gancho_verbal", rotulo: "Primeira fala ou headline", longo: true },
  { chave: "argumento", rotulo: "Argumento central", longo: true },
  { chave: "prova", rotulo: "Prova apresentada e limite dela", longo: true },
  { chave: "objecao", rotulo: "Objeção respondida" },
  { chave: "cta", rotulo: "CTA" },
  { chave: "destino", rotulo: "Destino" },
  { chave: "o_que_transportar", rotulo: "O que transportar", longo: true },
  { chave: "o_que_substituir", rotulo: "O que substituir e produzir original", longo: true },
  { chave: "limites", rotulo: "Limites e direitos de uso", longo: true },
];

/** A ficha já foi lida (IA ou equipe) quando tem os campos que explicam o anúncio. */
export function fichaLida(ficha: FichaDaReferencia | null | undefined): boolean {
  if (!ficha) return false;
  if (ficha.lida_em || ficha.lido_em) return true;
  return ["situacao", "gancho_verbal", "gancho_visual", "argumento", "o_que_transportar"].some(
    (k) => typeof ficha[k] === "string" && String(ficha[k]).trim().length > 0,
  );
}

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
export const LIMITE_DESCRICAO = 30;

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
  conversarOferta: { entrada: 25000, saida: 5000 },
  analisarConta: { entrada: 30000, saida: 5000 },
  pacotePorCriativo: { entrada: 10000, saida: 4500 },
  padraoDoNicho: { entrada: 12000, saidaPorPadrao: 700 },
  /** Conferência do Jev por ângulo nas rodadas de qualidade do plano. */
  rodadaPorAngulo: 900,
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

/** Plano v2: a geração e até 2 rodadas de reescrita dos ângulos reprovados. */
export function partesDoPlanoV2(catalogo: ModeloIa[], angulos: number): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return partesDoPlano(catalogo, angulos).concat([
    { modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: 8000, tokensSaida: angulos * TAMANHOS_ADS.rodadaPorAngulo },
  ]);
}

export function partesDaOferta(catalogo: ModeloIa[], anexos: number): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return [
    {
      modeloId: m ? m.id : null,
      tipo: "texto",
      tokensEntrada: TAMANHOS_ADS.conversarOferta.entrada + anexos * TAMANHOS.imagemAnexos.entrada,
      tokensSaida: TAMANHOS_ADS.conversarOferta.saida,
    },
  ];
}

export function partesDaAnaliseDaConta(catalogo: ModeloIa[]): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_ADS.analisarConta.entrada, tokensSaida: TAMANHOS_ADS.analisarConta.saida }];
}

export function partesDoPacote(catalogo: ModeloIa[], criativos: number): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return [
    { modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_ADS.pacotePorCriativo.entrada, tokensSaida: TAMANHOS_ADS.pacotePorCriativo.saida, vezes: Math.max(1, criativos) },
  ];
}

export function partesDosPadroes(catalogo: ModeloIa[], quantidade: number): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return [
    { modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_ADS.padraoDoNicho.entrada, tokensSaida: quantidade * TAMANHOS_ADS.padraoDoNicho.saidaPorPadrao },
  ];
}

/** Arte de anúncio: imagem e conferência por lâmina (mesma conta do Estúdio). */
export function partesDaArte(catalogo: ModeloIa[], laminas: number, qualidade: Qualidade = "media", modeloImagemId?: string | null): ParteDaEstimativa[] {
  const imagem = modeloImagemId || (padraoPara(catalogo, "imagem") || { id: "" }).id;
  const leitor = padraoPara(catalogo, "leitura");
  const vezes = Math.max(1, laminas);
  return [
    { modeloId: imagem || null, tipo: "imagem", imagens: 1, qualidade, tokensEntrada: TAMANHOS.imagemAnexos.entrada, vezes },
    { modeloId: leitor ? leitor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida, vezes },
  ];
}

// ------------------------------------------------------------------ chaves

export const chavesAds = {
  ofertas: (clientId: string) => ["mesa", "ads", "ofertas", clientId] as const,
  /** Traz links de imagem que vencem: fica fora do cache do navegador ("urls"). */
  conta: (clientId: string, dias: number) => ["mesa", "urls", "ads-conta", clientId, dias] as const,
  analise: (clientId: string) => ["mesa", "ads", "analise", clientId] as const,
  /** Galeria com URL assinada: fica fora do cache do navegador ("urls"). */
  referenciaAberta: (clientId: string, referenciaId: string) => ["mesa", "urls", "ads-referencia", clientId, referenciaId] as const,
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

export function normalizarReferencia(r: any): ReferenciaAds {
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


const numeroOuNada = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

/**
 * Notas na escala 0 a 10. A escala é decidida pelo conjunto (todas até 1:
 * frações; alguma acima de 10: 0 a 100), para um "1" em 0 a 10 não virar 10.
 */
function notasNaEscala<K extends string>(fonte: Record<string, unknown> | null | undefined, chaves: K[]): Record<K, number | null> {
  const brutos = chaves.map((k) => numeroOuNada(fonte ? fonte[k] : null));
  const validos = brutos.filter((n): n is number => n !== null);
  const maior = validos.length ? Math.max.apply(null, validos) : 0;
  const fator = maior <= 1 ? 10 : maior > 10 ? 0.1 : 1;
  const saida = {} as Record<K, number | null>;
  chaves.forEach((k, i) => {
    const n = brutos[i];
    saida[k] = n === null ? null : Math.max(0, Math.min(10, Math.round(n * fator * 10) / 10));
  });
  return saida;
}

type ChaveDaNota = "clareza" | "relevancia" | "prova" | "risco_politica" | "parada" | "diferenciacao";
const CHAVES_DO_JEV: ChaveDaNota[] = ["clareza", "relevancia", "prova", "risco_politica", "parada", "diferenciacao"];

/** Notas do Jev de um ângulo em 0 a 10 (clareza, relevância, prova, risco, parada, diferenciação). */
export function notasDe10(jev: NotasDoJev | null | undefined): Record<ChaveDaNota, number | null> {
  return notasNaEscala(jev as Record<string, unknown> | null | undefined, CHAVES_DO_JEV);
}

/** Pontuação do ângulo em 0 a 10 (o servidor pode mandar 0 a 1). */
export function pontuacaoDe10(v: unknown): number | null {
  const n = numeroOuNada(v);
  if (n === null) return null;
  const x = n <= 1 ? n * 10 : n > 10 ? n / 10 : n;
  return Math.round(x * 10) / 10;
}

function alertaDe(v: unknown): string | null {
  if (v === true) return "Alerta de política";
  if (typeof v === "string" && v.trim()) return v.trim();
  const o = obj(v);
  if (o.motivo || o.texto) return txt(o.motivo || o.texto) || null;
  return null;
}

/** Alerta de política do Jev em texto (ou nada). */
export const alertaDoJev = (jev: NotasDoJev | null | undefined) => (jev ? alertaDe(jev.alerta_politica) : null);

/**
 * Regra de aprovação do contrato v2 (usada quando o servidor não manda
 * `aprovado`). No Jev, risco_politica vai de 0 (viola) a 10 (sem risco):
 * número alto é seguro.
 */
export function anguloAprovado(a: Angulo): boolean {
  if (a.reprovado === true) return false;
  if (typeof a.aprovado === "boolean") return a.aprovado;
  const n = notasDe10(a.jev);
  if (n.clareza === null && n.relevancia === null) return true;
  return (
    (n.clareza === null ? 0 : n.clareza) >= 7 &&
    (n.relevancia === null ? 0 : n.relevancia) >= 7 &&
    (n.parada === null || n.parada >= 6) &&
    (n.diferenciacao === null || n.diferenciacao >= 6) &&
    (n.risco_politica === null || n.risco_politica >= 7) &&
    !alertaDoJev(a.jev)
  );
}

export interface QualidadeDoPlano {
  rodadas: number | null;
  aprovados: number | null;
  reprovados: number | null;
  objetivo: string;
  oferta_id: string | null;
  descartados: Angulo[];
}

/** Laço de qualidade do plano (estrutura.qualidade e estrutura.descartados). */
export function qualidadeDoPlano(p: PlanoAds): QualidadeDoPlano {
  const e = obj(p.estrutura);
  const q = obj(e.qualidade);
  const descartados = lista(e.descartados).map((a, i) => {
    const o = obj(a);
    return { ...o, id: txt(o.id) || `d${i + 1}`, nome: txt(o.nome) || `Ângulo descartado ${i + 1}`, motivos: lista(o.motivos).map(txt).filter(Boolean) } as Angulo;
  });
  return {
    rodadas: numeroOuNada(q.rodadas),
    aprovados: numeroOuNada(q.aprovados),
    reprovados: numeroOuNada(q.reprovados),
    objetivo: txt(e.objetivo),
    oferta_id: e.oferta_id ? String(e.oferta_id) : null,
    descartados,
  };
}

// ------------------------------------------------------------------ conversa (plano e oferta)

export interface MensagemDaConversa {
  id: string;
  papel: string;
  conteudo: string;
  anexos: any[];
}

/** Mensagens de uma conversa de agente (agente_mensagens), da mais antiga para a mais nova. */
export function lerConversa(conversaId: string | null): Promise<MensagemDaConversa[]> {
  return lerConversaDoPlano(conversaId);
}

// ------------------------------------------------------------------ oferta (v2)

export type StatusDaOferta = "rascunho" | "escolhida" | "arquivada";

export interface NotasDaOferta {
  clareza: number | null;
  forca: number | null;
  risco_politica: number | null;
  alerta_politica: string | null;
}

export interface Oferta {
  id: string;
  nome: string;
  para_quem: string;
  promessa: string;
  mecanismo: string;
  entregaveis: string[];
  bonus: string[];
  garantia: string | null;
  urgencia_real: string | null;
  ancoragem: string | null;
  cta: string;
  provas_necessarias: string[];
  riscos: string[];
  status: StatusDaOferta;
  jev: NotasDaOferta | null;
  conversa_id: string | null;
  criado_em: string;
}

export interface Ideia {
  titulo: string;
  gancho_verbal: string;
  gancho_visual: string;
  estilo_visual: string;
  formato: string;
}

export interface RespostaDaOferta {
  conversa_id: string | null;
  resposta: string;
  ofertas: Oferta[];
  briefing_sugerido: Record<string, unknown> | null;
  ideias: Ideia[];
  custo_usd: number | null;
}

const textos = (v: unknown): string[] =>
  typeof v === "string"
    ? v.split("\n").map((x) => x.trim()).filter(Boolean)
    : lista(v).map((x) => (typeof x === "string" ? x.trim() : txt(obj(x).texto || obj(x).nome))).filter(Boolean);
const textoOuNulo = (v: unknown): string | null => (txt(v).trim() ? txt(v).trim() : null);

function notasDaOferta(bruto: unknown): NotasDaOferta | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = obj(bruto);
  const n = notasNaEscala(b, ["clareza", "forca", "risco_politica"]);
  if (n.clareza === null && n.forca === null && n.risco_politica === null && !alertaDe(b.alerta_politica)) return null;
  return { clareza: n.clareza, forca: n.forca, risco_politica: n.risco_politica, alerta_politica: alertaDe(b.alerta_politica) };
}

/** Oferta da resposta (campos soltos) ou da linha de ads_ofertas (campos em `oferta`). */
export function normalizarOferta(bruto: unknown, i = 0): Oferta {
  const linha = obj(bruto);
  const dentro = obj(linha.oferta);
  const o: Record<string, any> = { ...dentro, ...linha };
  const status = umDe(o.status, ["rascunho", "escolhida", "arquivada"] as StatusDaOferta[]) || "rascunho";
  return {
    id: txt(o.id) || `oferta-${i + 1}`,
    nome: txt(o.nome) || txt(dentro.nome) || `Oferta ${i + 1}`,
    para_quem: txt(o.para_quem),
    promessa: txt(o.promessa),
    mecanismo: txt(o.mecanismo),
    entregaveis: textos(o.entregaveis),
    bonus: textos(o.bonus),
    garantia: textoOuNulo(o.garantia),
    urgencia_real: textoOuNulo(o.urgencia_real),
    ancoragem: textoOuNulo(o.ancoragem),
    cta: txt(o.cta),
    provas_necessarias: textos(o.provas_necessarias),
    riscos: textos(o.riscos),
    status: status as StatusDaOferta,
    jev: notasDaOferta(linha.jev || dentro.jev),
    conversa_id: linha.conversa_id ? String(linha.conversa_id) : null,
    criado_em: txt(linha.criado_em),
  };
}

export function normalizarIdeia(bruto: unknown): Ideia {
  const i = obj(bruto);
  return {
    titulo: txt(i.titulo) || txt(i.nome) || "Ideia",
    gancho_verbal: txt(i.gancho_verbal),
    gancho_visual: txt(i.gancho_visual),
    estilo_visual: txt(i.estilo_visual),
    formato: txt(i.formato),
  };
}

export function normalizarRespostaDaOferta(bruto: unknown): RespostaDaOferta {
  const r = obj(bruto);
  const b = r.briefing_sugerido && typeof r.briefing_sugerido === "object" && !Array.isArray(r.briefing_sugerido) ? (r.briefing_sugerido as Record<string, unknown>) : null;
  return {
    conversa_id: r.conversa_id ? String(r.conversa_id) : null,
    resposta: txt(r.resposta) || txt(r.mensagem),
    ofertas: lista(r.ofertas).map((o, i) => normalizarOferta(o, i)),
    briefing_sugerido: b && Object.keys(b).length ? b : null,
    ideias: lista(r.ideias).map(normalizarIdeia),
    custo_usd: numeroOuNada(r.custo_usd),
  };
}

/** Campos editáveis à mão (oferta_salvar { campos }). */
export function camposDaOferta(o: Oferta): Record<string, unknown> {
  return {
    nome: o.nome,
    para_quem: o.para_quem,
    promessa: o.promessa,
    mecanismo: o.mecanismo,
    entregaveis: o.entregaveis,
    bonus: o.bonus,
    garantia: o.garantia,
    urgencia_real: o.urgencia_real,
    ancoragem: o.ancoragem,
    cta: o.cta,
    provas_necessarias: o.provas_necessarias,
    riscos: o.riscos,
  };
}

/** A oferta vira sugestão de briefing (só o que ela tem; o resto fica como está). */
export function briefingDaOferta(o: Oferta): Record<string, unknown> {
  const condicao = [o.ancoragem, o.urgencia_real].filter(Boolean).join(". ");
  const oferta: Record<string, string> = {};
  if (o.nome) oferta.produto = o.nome;
  if (o.promessa) oferta.promessa = o.promessa;
  if (condicao) oferta.condicao = condicao;
  if (o.garantia) oferta.garantia = o.garantia;
  const saida: Record<string, unknown> = { oferta };
  if (o.para_quem) saida.publico = { quem: o.para_quem };
  return saida;
}

/**
 * Junta uma sugestão ao briefing atual: campo sugerido com valor entra, campo
 * vazio na sugestão não apaga o que a equipe já escreveu. Listas sugeridas
 * substituem só quando vêm com itens.
 */
export function juntarBriefing(atual: BriefingAds, sugestao: Record<string, unknown>): BriefingAds {
  const s = normalizarBriefing(sugestao);
  const bruto = obj(sugestao);
  const n: BriefingAds = JSON.parse(JSON.stringify(atual));
  (Object.keys(n.oferta) as (keyof BriefingAds["oferta"])[]).forEach((k) => {
    if (s.oferta[k]) n.oferta[k] = s.oferta[k];
  });
  if (s.publico.quem) n.publico.quem = s.publico.quem;
  if (s.publico.estagio_consciencia) n.publico.estagio_consciencia = s.publico.estagio_consciencia;
  if (s.publico.situacoes.length) n.publico.situacoes = s.publico.situacoes;
  if (s.publico.motivacoes.length) n.publico.motivacoes = s.publico.motivacoes;
  if (lista(bruto.objecoes).length) n.objecoes = s.objecoes;
  if (lista(bruto.provas).length) n.provas = s.provas;
  if (s.destino.tipo) n.destino.tipo = s.destino.tipo;
  if (s.destino.url) n.destino.url = s.destino.url;
  if (s.destino.primeira_mensagem) n.destino.primeira_mensagem = s.destino.primeira_mensagem;
  if (s.objetivo.acao) n.objetivo.acao = s.objetivo.acao;
  if (s.objetivo.metrica_principal) n.objetivo.metrica_principal = s.objetivo.metrica_principal;
  if (s.objetivo.custo_toleravel_brl) n.objetivo.custo_toleravel_brl = s.objetivo.custo_toleravel_brl;
  if (s.objetivo.verba_diaria_brl) n.objetivo.verba_diaria_brl = s.objetivo.verba_diaria_brl;
  if (s.restricoes) n.restricoes = s.restricoes;
  return n;
}

/** Ofertas do cliente: tabela ads_ofertas pela RLS; sem ela ainda, a ação oferta_listar. */
export async function lerOfertas(clientId: string): Promise<Oferta[]> {
  const { data, error } = await sb()
    .from("ads_ofertas")
    .select("id, client_id, nome, oferta, jev, status, conversa_id, criado_em, atualizado_em")
    .eq("client_id", clientId)
    .order("criado_em", { ascending: false })
    .limit(100);
  if (!error) return lista(data).map((o, i) => normalizarOferta(o, i));
  const r = await chamarAds<any>("oferta_listar", { client_id: clientId });
  return lista(obj(r).ofertas).map((o, i) => normalizarOferta(o, i));
}

// ------------------------------------------------------------------ conta ao vivo (v2)

export type SinalDoAnuncio = "escalar" | "manter" | "observar" | "renovar" | "pausar" | "sem_dados";

export const SINAIS: { valor: SinalDoAnuncio; rotulo: string; dica: string; tom: string }[] = [
  { valor: "escalar", rotulo: "Escalar", dica: "Resultado abaixo do custo tolerável e volume estável.", tom: "border-success/30 bg-success/10 text-success" },
  { valor: "pausar", rotulo: "Pausar", dica: "Gasta sem resultado ou muito acima do custo tolerável.", tom: "border-destructive/30 bg-destructive/10 text-destructive" },
  { valor: "renovar", rotulo: "Renovar", dica: "Fadiga: frequência alta e CTR caindo. Novo criativo no mesmo ângulo.", tom: "border-warning/40 bg-warning/15 text-warning" },
  { valor: "observar", rotulo: "Observar", dica: "Números em movimento. Espere mais volume antes de mexer.", tom: "border-info/30 bg-info/10 text-info" },
  { valor: "manter", rotulo: "Manter", dica: "Dentro do esperado. Deixe rodar.", tom: "border-border bg-secondary text-foreground" },
  { valor: "sem_dados", rotulo: "Sem dados", dica: "Pouca entrega no período para concluir.", tom: "border-border bg-secondary text-muted-foreground" },
];

export const sinalDe = (v?: string | null) => SINAIS.find((s) => s.valor === v) || SINAIS[SINAIS.length - 1];

export interface MetricasDaConta {
  gasto: number | null;
  impressoes: number | null;
  alcance: number | null;
  cliques: number | null;
  ctr: number | null;
  ctr_saida: number | null;
  cpc: number | null;
  cpm: number | null;
  frequencia: number | null;
  resultados: number | null;
  custo_por_resultado: number | null;
}

export interface CampanhaAoVivo {
  campaign_id: string;
  nome: string;
  status: string;
  objetivo: string;
  orcamento_diario: number | null;
  metricas: MetricasDaConta;
}

export interface TendenciaDoAnuncio {
  ctr_var_pct: number | null;
  custo_resultado_var_pct: number | null;
  frequencia: number | null;
}

export interface AnuncioAoVivo {
  ad_id: string;
  nome: string;
  status: string;
  campaign_id: string | null;
  campanha: string;
  imagem_url: string | null;
  titulo: string;
  corpo: string;
  descricao: string;
  cta: string;
  destino: string;
  metricas: MetricasDaConta;
  diagnostico: DiagnosticoDoCriativo | string | null;
  tendencia: TendenciaDoAnuncio;
  sinal: SinalDoAnuncio;
  referencia_id: string | null;
}

export interface ContaAoVivo {
  /** Custo por resultado que decide o sinal: do briefing ou a média da conta. */
  custo_referencia: { valor: number; fonte: "briefing" | "media_da_conta" } | null;
  conectada: boolean;
  atualizado_em: string | null;
  periodo: { inicio: string; fim: string } | null;
  totais: MetricasDaConta;
  campanhas: CampanhaAoVivo[];
  anuncios: AnuncioAoVivo[];
}

const primeiroNumero = (o: Record<string, any>, nomes: string[]) => {
  for (const n of nomes) {
    const v = numeroOuNada(o[n]);
    if (v !== null) return v;
  }
  return null;
};

/** Métricas com os nomes da função (calculos.ts), da tabela ou da Meta. */
export function normalizarMetricas(bruto: unknown): MetricasDaConta {
  const m = obj(bruto);
  return {
    gasto: primeiroNumero(m, ["gasto", "spend", "investimento"]),
    impressoes: primeiroNumero(m, ["impressoes", "impressions"]),
    alcance: primeiroNumero(m, ["alcance", "reach"]),
    cliques: primeiroNumero(m, ["cliques", "cliques_link", "clicks", "link_clicks"]),
    ctr: primeiroNumero(m, ["ctr", "ctr_pct"]),
    ctr_saida: primeiroNumero(m, ["ctr_saida", "ctr_saida_pct", "outbound_ctr"]),
    cpc: primeiroNumero(m, ["cpc"]),
    cpm: primeiroNumero(m, ["cpm"]),
    frequencia: primeiroNumero(m, ["frequencia", "frequencia_media", "frequency"]),
    resultados: primeiroNumero(m, ["resultados", "results", "conversoes"]),
    custo_por_resultado: primeiroNumero(m, ["custo_por_resultado", "custo_resultado", "cpa", "cost_per_result"]),
  };
}

const SINAIS_VALIDOS: SinalDoAnuncio[] = ["escalar", "manter", "observar", "renovar", "pausar", "sem_dados"];

export function normalizarConta(bruto: unknown): ContaAoVivo {
  const r = obj(bruto);
  const p = obj(r.periodo);
  const campanhas: CampanhaAoVivo[] = lista(r.campanhas).map((c) => {
    const o = obj(c);
    return {
      campaign_id: txt(o.campaign_id) || txt(o.id),
      nome: txt(o.nome) || txt(o.name) || "Campanha",
      status: txt(o.status) || txt(o.effective_status),
      objetivo: txt(o.objetivo) || txt(o.objective),
      orcamento_diario: numeroOuNada(o.orcamento_diario),
      metricas: normalizarMetricas(o.metricas),
    };
  });
  const anuncios: AnuncioAoVivo[] = lista(r.anuncios)
    .map((a) => {
      const o = obj(a);
      const t = obj(o.tendencia);
      const adId = txt(o.ad_id) || txt(o.id);
      return {
        ad_id: adId,
        nome: txt(o.nome) || txt(o.ad_name) || txt(o.titulo) || `Anúncio ${adId}`,
        status: txt(o.status) || txt(o.effective_status),
        campaign_id: o.campaign_id ? String(o.campaign_id) : null,
        campanha: txt(o.campanha),
        imagem_url: txt(o.imagem_url) || txt(o.thumbnail_url) || null,
        titulo: txt(o.titulo),
        corpo: txt(o.corpo),
        descricao: txt(o.descricao),
        cta: txt(o.cta),
        destino: txt(o.destino),
        metricas: normalizarMetricas(o.metricas),
        diagnostico: diagnosticoDaFuncao(o.diagnostico),
        tendencia: {
          ctr_var_pct: numeroOuNada(t.ctr_var_pct),
          custo_resultado_var_pct: numeroOuNada(t.custo_resultado_var_pct),
          frequencia: numeroOuNada(t.frequencia),
        },
        sinal: (umDe(o.sinal, SINAIS_VALIDOS) || "sem_dados") as SinalDoAnuncio,
        referencia_id: o.referencia_id ? String(o.referencia_id) : null,
      };
    })
    .filter((a) => !!a.ad_id);
  const ref = obj(r.custo_referencia);
  const valorRef = numeroOuNada(ref.valor);
  return {
    custo_referencia: valorRef !== null ? { valor: valorRef, fonte: ref.fonte === "briefing" ? "briefing" : "media_da_conta" } : null,
    conectada: r.conectada !== false,
    atualizado_em: r.atualizado_em ? String(r.atualizado_em) : null,
    periodo: p.inicio && p.fim ? { inicio: txt(p.inicio), fim: txt(p.fim) } : null,
    totais: normalizarMetricas(r.totais),
    campanhas,
    anuncios,
  };
}

/** "há X min" a partir do horário da última coleta. */
export function tempoDesde(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return "sem coleta ainda";
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "sem coleta ainda";
  const min = Math.max(0, Math.floor((agora - t) / 60000));
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d === 1 ? "" : "s"}`;
}

export interface AnaliseDaConta {
  resumo: string;
  escalar: { ad_id: string; porque: string }[];
  pausar: { ad_id: string; porque: string }[];
  renovar: { ad_id: string; porque: string; sugestao: string }[];
  copy: { achado: string; recomendacao: string }[];
  proximos_testes: { titulo: string; hipotese: string; estilo_visual: string; objetivo: string }[];
}

export function normalizarAnalise(bruto: unknown): AnaliseDaConta | null {
  const a = obj(bruto);
  if (!Object.keys(a).length) return null;
  const itens = (v: unknown) => lista(v).map((x) => ({ ad_id: txt(obj(x).ad_id), porque: txt(obj(x).porque) || txt(obj(x).motivo) }));
  return {
    resumo: txt(a.resumo),
    escalar: itens(a.escalar),
    pausar: itens(a.pausar),
    renovar: lista(a.renovar).map((x) => ({ ad_id: txt(obj(x).ad_id), porque: txt(obj(x).porque), sugestao: txt(obj(x).sugestao) })),
    copy: lista(a.copy).map((x) => ({ achado: txt(obj(x).achado), recomendacao: txt(obj(x).recomendacao) })),
    proximos_testes: lista(a.proximos_testes).map((x) => ({
      titulo: txt(obj(x).titulo) || "Teste",
      hipotese: txt(obj(x).hipotese),
      estilo_visual: txt(obj(x).estilo_visual),
      objetivo: txt(obj(x).objetivo),
    })),
  };
}

/** Última análise guardada (ads_analises); sem a tabela ainda, nada. */
export async function lerUltimaAnalise(clientId: string): Promise<{ analise: AnaliseDaConta; criado_em: string } | null> {
  try {
    const { data, error } = await sb()
      .from("ads_analises")
      .select("id, analise, criado_em")
      .eq("client_id", clientId)
      .order("criado_em", { ascending: false })
      .limit(1);
    if (error) return null;
    const linha = lista(data)[0];
    const analise = linha ? normalizarAnalise(linha.analise) : null;
    return analise ? { analise, criado_em: txt(linha.criado_em) } : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ referência aberta (v2)

export interface ImagemDaGaleria {
  url: string;
  legenda: string;
}

export interface PaginaDaReferencia {
  titulo: string;
  descricao: string;
  site: string;
  tipo: string;
  extra: Record<string, unknown>;
}

export interface PontoDaSerie {
  dia: string;
  gasto: number | null;
  impressoes: number | null;
  cliques: number | null;
  ctr: number | null;
  resultados: number | null;
}

export interface AnuncioDaReferencia {
  ad_id: string;
  status: string;
  campanha: string;
  titulo: string;
  corpo: string;
  descricao: string;
  cta: string;
  destino: string;
  metricas: MetricasDaConta;
  serie: PontoDaSerie[];
  diagnostico: DiagnosticoDoCriativo | string | null;
}

export interface DetalheDaReferencia {
  referencia: ReferenciaAds | null;
  galeria: ImagemDaGaleria[];
  pagina: PaginaDaReferencia | null;
  anuncio: AnuncioDaReferencia | null;
  aviso: string | null;
}

/** Caminho ou endereço de um item de galeria (url assinada, caminho no bucket ou texto solto). */
function enderecoDaImagem(v: unknown): string {
  if (typeof v === "string") return v;
  const o = obj(v);
  return txt(o.url) || txt(o.caminho) || txt(o.storage_path) || txt(o.path) || txt(o.src);
}

export function normalizarGaleria(v: unknown): ImagemDaGaleria[] {
  const vistos: string[] = [];
  const saida: ImagemDaGaleria[] = [];
  lista(v).forEach((x) => {
    const url = enderecoDaImagem(x);
    if (!url || vistos.indexOf(url) >= 0) return;
    vistos.push(url);
    saida.push({ url, legenda: typeof x === "string" ? "" : txt(obj(x).legenda) });
  });
  return saida;
}

/** Imagens que a referência já tem guardadas (print, galeria da ficha, miniatura). */
export function galeriaDaReferencia(r: ReferenciaAds): ImagemDaGaleria[] {
  const itens: unknown[] = [];
  if (r.storage_path) itens.push(r.storage_path);
  lista(r.ficha.galeria).forEach((g) => itens.push(g));
  const m = r.metricas as Record<string, unknown>;
  [m.thumbnail_url, m.image_url, r.ficha.thumbnail_url, r.ficha.imagem_url].forEach((u) => {
    if (typeof u === "string" && u) itens.push(u);
  });
  return normalizarGaleria(itens);
}

/** Capa do cartão: a primeira imagem real que a referência tiver. */
export const capaDaReferencia = (r: ReferenciaAds): string | null => {
  const g = galeriaDaReferencia(r);
  return g.length ? g[0].url : null;
};

export function normalizarDetalhe(bruto: unknown): DetalheDaReferencia {
  const r = obj(bruto);
  const pg = r.pagina && typeof r.pagina === "object" ? obj(r.pagina) : null;
  const an = r.anuncio && typeof r.anuncio === "object" ? obj(r.anuncio) : null;
  const referencia = r.referencia && typeof r.referencia === "object" && obj(r.referencia).id ? normalizarReferencia(r.referencia) : null;
  let galeria = normalizarGaleria(r.galeria);
  if (!galeria.length && referencia) galeria = galeriaDaReferencia(referencia);
  return {
    referencia,
    galeria,
    pagina: pg ? { titulo: txt(pg.titulo), descricao: txt(pg.descricao), site: txt(pg.site), tipo: txt(pg.tipo), extra: obj(pg.extra) } : null,
    anuncio: an
      ? {
          ad_id: txt(an.ad_id),
          status: txt(an.status),
          campanha: txt(an.campanha),
          titulo: txt(an.titulo),
          corpo: txt(an.corpo),
          descricao: txt(an.descricao),
          cta: txt(an.cta),
          destino: txt(an.destino),
          metricas: normalizarMetricas(an.metricas),
          serie: lista(an.serie)
            .map((p) => ({
              dia: txt(obj(p).dia) || txt(obj(p).data),
              gasto: numeroOuNada(obj(p).gasto),
              impressoes: numeroOuNada(obj(p).impressoes),
              cliques: numeroOuNada(obj(p).cliques),
              ctr: numeroOuNada(obj(p).ctr),
              resultados: numeroOuNada(obj(p).resultados),
            }))
            .filter((p) => !!p.dia),
          diagnostico: diagnosticoDaFuncao(an.diagnostico),
        }
      : null,
    aviso: textoOuNulo(r.aviso),
  };
}

/**
 * Nicho e estilo visual: na ficha (texto ou { id, nome }, como os padrões do
 * estrategista gravam) ou nas etiquetas "nicho:x" e "estilo:x".
 */
export function nichoDaReferencia(r: ReferenciaAds): string {
  const n = r.ficha.nicho;
  const f = typeof n === "string" ? n : txt(obj(n).id) || txt(obj(n).nome);
  if (f) return f;
  const t = r.tags.find((x) => x.indexOf("nicho:") === 0);
  return t ? t.slice(6) : "";
}

/** Nome do nicho para a tela (o nome gravado, senão o id legível). */
export function nomeDoNicho(r: ReferenciaAds): string {
  const n = r.ficha.nicho;
  return txt(obj(n).nome) || humanizar(nichoDaReferencia(r));
}

export function estiloDaReferencia(r: ReferenciaAds): string {
  const f = txt(r.ficha.estilo_visual) || txt(r.ficha.estilo);
  if (f) return f;
  const t = r.tags.find((x) => x.indexOf("estilo:") === 0);
  return t ? t.slice(7) : "";
}

/** Ordem da biblioteca: destaque, depois E3 e E4, depois as mais novas. */
export function ordenarReferencias(refs: ReferenciaAds[]): ReferenciaAds[] {
  const forte = (r: ReferenciaAds) => (r.evidencia === "E3" || r.evidencia === "E4" ? 1 : 0);
  return refs.slice().sort((a, b) => {
    if (a.destaque !== b.destaque) return a.destaque ? -1 : 1;
    if (forte(a) !== forte(b)) return forte(b) - forte(a);
    return (b.criado_em || "").localeCompare(a.criado_em || "");
  });
}

// ------------------------------------------------------------------ pacote de copy (v2)

export interface OrientacaoAoGestor {
  objetivo_meta: string;
  evento_otimizacao: string;
  publico_sugerido: string;
  conjuntos: string;
  utm: string;
  regras_de_corte: string;
  regras_de_escala: string;
  verba: string;
}

export interface PacoteDeCopy {
  textos_principais: { estilo: string; texto: string }[];
  titulos: string[];
  descricoes: string[];
  ctas: { cta: string; porque: string }[];
  ganchos: string[];
  gestor: OrientacaoAoGestor | null;
}

export const ESTILOS_DE_TEXTO: Record<string, string> = {
  curto: "Curto",
  medio: "Médio",
  longo: "Longo",
  pas: "Problema, agitação e solução",
  historia: "História",
  prova: "Prova",
  objecao: "Objeção",
  prova_objecao: "Prova e objeção",
};

export const rotuloDoEstilo = (e?: string | null) => ESTILOS_DE_TEXTO[String(e || "")] || humanizar(e);

/** Texto legível de qualquer valor da orientação (lista vira linhas, objeto vira "Chave: valor"). */
function textoLivre(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(textoLivre).filter(Boolean).join("\n");
  const o = obj(v);
  return Object.keys(o)
    .map((k) => {
      const t = textoLivre(o[k]);
      return t ? `${humanizar(k)}: ${t}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function normalizarPacote(bruto: unknown): PacoteDeCopy | null {
  const p = obj(bruto);
  if (!Object.keys(p).length) return null;
  const soTexto = (v: unknown) =>
    lista(v)
      .map((x) => (typeof x === "string" ? x : txt(obj(x).texto)))
      .map((x) => x.trim())
      .filter(Boolean);
  const g = p.gestor && typeof p.gestor === "object" ? obj(p.gestor) : null;
  const pacote: PacoteDeCopy = {
    textos_principais: lista(p.textos_principais)
      .map((t) => (typeof t === "string" ? { estilo: "", texto: t } : { estilo: txt(obj(t).estilo), texto: txt(obj(t).texto) }))
      .filter((t) => t.texto.trim().length > 0),
    titulos: soTexto(p.titulos),
    descricoes: soTexto(p.descricoes),
    ctas: lista(p.ctas)
      .map((c) => (typeof c === "string" ? { cta: c, porque: "" } : { cta: txt(obj(c).cta), porque: txt(obj(c).porque) }))
      .filter((c) => !!c.cta),
    ganchos: soTexto(p.ganchos),
    gestor: g
      ? {
          objetivo_meta: textoLivre(g.objetivo_meta),
          evento_otimizacao: textoLivre(g.evento_otimizacao),
          publico_sugerido: textoLivre(g.publico_sugerido),
          conjuntos: textoLivre(g.conjuntos),
          utm: textoLivre(g.utm),
          regras_de_corte: textoLivre(g.regras_de_corte),
          regras_de_escala: textoLivre(g.regras_de_escala),
          verba: textoLivre(g.verba),
        }
      : null,
  };
  const vazio =
    !pacote.textos_principais.length && !pacote.titulos.length && !pacote.descricoes.length && !pacote.ctas.length && !pacote.ganchos.length && !pacote.gestor;
  return vazio ? null : pacote;
}

export const CAMPOS_DO_GESTOR: { chave: keyof OrientacaoAoGestor; rotulo: string }[] = [
  { chave: "objetivo_meta", rotulo: "Objetivo no Gerenciador" },
  { chave: "evento_otimizacao", rotulo: "Evento de otimização" },
  { chave: "publico_sugerido", rotulo: "Público sugerido" },
  { chave: "conjuntos", rotulo: "Conjuntos" },
  { chave: "utm", rotulo: "UTM" },
  { chave: "regras_de_corte", rotulo: "Quando cortar" },
  { chave: "regras_de_escala", rotulo: "Quando escalar" },
  { chave: "verba", rotulo: "Verba" },
];

/** Pacote em Markdown (copiar tudo e baixar .md). */
export function pacoteEmMarkdown(nome: string, p: PacoteDeCopy): string {
  const linhas: string[] = [`# Pacote de copy: ${nome}`, ""];
  if (p.textos_principais.length) {
    linhas.push("## Textos principais", "");
    p.textos_principais.forEach((t, i) => linhas.push(`### ${i + 1}. ${rotuloDoEstilo(t.estilo) || "Texto"}`, "", t.texto, ""));
  }
  if (p.titulos.length) {
    linhas.push(`## Títulos (até ${LIMITE_TITULO} caracteres)`, "");
    p.titulos.forEach((t) => linhas.push(`- ${t} (${t.length})`));
    linhas.push("");
  }
  if (p.descricoes.length) {
    linhas.push(`## Descrições (até ${LIMITE_DESCRICAO} caracteres)`, "");
    p.descricoes.forEach((t) => linhas.push(`- ${t} (${t.length})`));
    linhas.push("");
  }
  if (p.ctas.length) {
    linhas.push("## Botões (CTA)", "");
    p.ctas.forEach((c) => linhas.push(`- ${rotuloDoCta(c.cta)}${c.porque ? `: ${c.porque}` : ""}`));
    linhas.push("");
  }
  if (p.ganchos.length) {
    linhas.push("## Ganchos (primeira linha)", "");
    p.ganchos.forEach((g) => linhas.push(`- ${g}`));
    linhas.push("");
  }
  if (p.gestor) {
    const gestor = p.gestor;
    linhas.push("## Orientação ao gestor de tráfego", "");
    CAMPOS_DO_GESTOR.forEach((c) => {
      const v = gestor[c.chave];
      if (v) linhas.push(`**${c.rotulo}:** ${v.indexOf("\n") >= 0 ? `\n${v}` : v}`, "");
    });
  }
  return linhas.join("\n").trim() + "\n";
}

// ------------------------------------------------------------------ utilidades da tela

/** Copia para a área de transferência; sem a API nova (Safari 11), usa o caminho antigo. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      await nav.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai no caminho antigo */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    document.body.removeChild(area);
    return !!ok;
  } catch {
    return false;
  }
}

/** Baixa um texto como arquivo (.md). */
export function baixarTexto(nomeDoArquivo: string, texto: string, tipo = "text/markdown;charset=utf-8") {
  try {
    const blob = new Blob([texto], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeDoArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    /* navegador sem download: fica o copiar */
  }
}

export const nomeDeArquivo = (t: string) =>
  (t || "pacote")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "pacote";

// ------------------------------------------------------------------ pedido de plano entre etapas

/**
 * Pedido de plano que nasce em outra etapa (oferta, ideia, anúncio vencedor,
 * próximo teste da análise): a Mesa Ads leva para o Plano de teste, que chama
 * plano_gerar com estes campos uma vez.
 */
export interface PedidoDePlano {
  rotulo: string;
  oferta_id?: string;
  objetivo?: string;
  modo?: "novo" | "variar_vencedor";
  referencia_ids?: string[];
  pedido?: string;
  quantidade_angulos?: number;
}

/** Corpo de plano_gerar: só os campos com valor. */
export function corpoDoPlano(base: {
  client_id: string;
  briefing_id?: string | null;
  pedido?: string;
  quantidade_angulos: number;
  oferta_id?: string | null;
  objetivo?: string | null;
  modo?: "novo" | "variar_vencedor";
  referencia_ids?: string[];
}): Record<string, unknown> {
  const corpo: Record<string, unknown> = { client_id: base.client_id, quantidade_angulos: base.quantidade_angulos };
  if (base.briefing_id) corpo.briefing_id = base.briefing_id;
  if (base.pedido && base.pedido.trim()) corpo.pedido = base.pedido.trim();
  if (base.oferta_id) corpo.oferta_id = base.oferta_id;
  if (base.objetivo) corpo.objetivo = base.objetivo;
  if (base.modo && base.modo !== "novo") corpo.modo = base.modo;
  if (base.referencia_ids && base.referencia_ids.length) corpo.referencia_ids = base.referencia_ids;
  return corpo;
}
