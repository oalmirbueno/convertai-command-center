/**
 * Índice único dos motores do painel (Frente W, 25/09/2026).
 *
 * Pedido do dono: "reforce todos os motores internos... ele tem que entender
 * skills, tem que entender repositórios, porque são bases que vão se
 * conversando para deixar a ferramenta cada vez mais poderosa, só que sem
 * esses bugs bobos" (queixa real: "o agente não usa as técnicas").
 *
 * Este arquivo diz, por motor (agente e momento), que conhecimento ele recebe
 * no prompt, de qual skill ou repositório cada bloco veio e onde a ligação
 * está no código. Ele não monta texto: quem monta é conhecimento-dos-agentes.ts
 * (por tarefa, com teto). O teste src/test/motores.test.ts cobra a promessa:
 * cada motor recebe de fato os blocos que este índice lista, a função da mesa
 * chama a montagem e cada skill e repositório marcado como integrado chega a
 * algum prompt. Se alguém tirar um bloco, trocar a ligação ou cortar demais o
 * teto, o teste quebra antes de ir para produção.
 *
 * Tabela para gente ler, com licença e estado: docs/motores/REPOSITORIOS.md.
 * Skills da máquina (plugins da Anthropic e skills pessoais):
 * docs/conhecimento/SKILLS-NO-SISTEMA.md.
 *
 * Puro: sem Deno, sem banco. Sem travessão.
 */

import {
  type ConhecimentoMontado,
  conhecimentoAdsPara,
  conhecimentoAgenteSenior,
  conhecimentoCalendarioPara,
  conhecimentoContexto,
  conhecimentoEstudioPara,
  conhecimentoMesaFoto,
  type TarefaAds,
} from "./conhecimento-dos-agentes.ts";
import { VERSAO_CONHECIMENTO_REPOSITORIOS } from "./conhecimento-repositorios.ts";

export const VERSAO_DOS_MOTORES = `2026-09-25.1 (repositórios ${VERSAO_CONHECIMENTO_REPOSITORIOS})`;

// ------------------------------------------------------------------ fontes

export type EstadoDaFonte = "integrado" | "parcial" | "nao_se_aplica" | "avaliado";

export type Fonte = {
  id: string;
  tipo: "repositorio" | "pacote_de_skills" | "especialistas" | "base_da_casa";
  nome: string;
  url?: string;
  /** Licença conferida no arquivo LICENSE (ou no aviso de dados) em 25/09/2026. */
  licenca: string;
  /** Como o conteúdo entrou: sempre texto próprio; nada copiado. */
  uso: string;
  estado: EstadoDaFonte;
  /** Onde entra (texto curto) ou por que não entra. */
  nota: string;
};

/** Repositórios do GitHub pedidos pelo dono e as demais bases do painel. */
export const FONTES: Record<string, Fonte> = {
  marketingskills: {
    id: "marketingskills",
    tipo: "repositorio",
    nome: "coreyhaines31/marketingskills",
    url: "https://github.com/coreyhaines31/marketingskills",
    licenca: "MIT",
    uso: "método resumido em português (conhecimento-repositorios.ts), skill por skill",
    estado: "integrado",
    nota: "Skills mapeadas em SKILLS_MARKETINGSKILLS; cada tarefa carrega a skill pertinente.",
  },
  swipefile: {
    id: "swipefile",
    tipo: "repositorio",
    nome: "gntrs/swipefile",
    url: "https://github.com/gntrs/swipefile",
    licenca: "MIT",
    uso: "método: veredito humano manda, banco de ganchos, longevidade é pista",
    estado: "parcial",
    nota: "O método entra em fontes_do_criativo; o app (CRM, chat, importadores) não se aplica ao painel, que já tem a biblioteca da Mesa Ads.",
  },
  product_swipefile: {
    id: "product_swipefile",
    tipo: "repositorio",
    nome: "nothingbutcici/product-swipefile",
    url: "https://github.com/nothingbutcici/product-swipefile",
    licenca: "MIT",
    uso: "método de inventário: estado de cada fato, não consultado não é não encontrado, fronteira do concorrente",
    estado: "integrado",
    nota: "Entra em pesquisa_de_cliente (agente de contexto).",
  },
  ad_whisperer: {
    id: "ad_whisperer",
    tipo: "repositorio",
    nome: "nord342/ad-whisperer",
    url: "https://github.com/nord342/ad-whisperer",
    licenca: "MIT",
    uso: "campos da decomposição de anúncio (gancho, estrutura, CTA, gatilhos)",
    estado: "parcial",
    nota: "Os campos entram em fontes_do_criativo. A ferramenta (Whisper local, yt-dlp) não roda em Edge Function e o painel não produz vídeo.",
  },
  gpt_image_2_prompts_nochili: {
    id: "gpt_image_2_prompts_nochili",
    tipo: "repositorio",
    nome: "no-chili/awesome-gpt-image-2-prompts",
    url: "https://github.com/no-chili/awesome-gpt-image-2-prompts",
    licenca: "CC BY 4.0 só na curadoria e nos metadados; os prompts são de terceiros e ficam fora da licença (DATA_LICENSE.md)",
    uso: "nenhum texto; consulta humana de estilos",
    estado: "nao_se_aplica",
    nota: "Texto dos prompts sem licença de uso: não entra. A técnica de produto e pôster já vem das coleções CC0 (biblioteca da Mesa Foto e foto_de_produto_com_verdade).",
  },
  gpt_image_2_evolink: {
    id: "gpt_image_2_evolink",
    tipo: "repositorio",
    nome: "EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
    url: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
    licenca: "CC0 1.0",
    uso: "técnica de cena de produto reescrita (biblioteca da Mesa Foto e foto_de_produto_com_verdade)",
    estado: "integrado",
    nota: "4 prompts da biblioteca citam a fonte; a técnica chega ao diretor de fotografia.",
  },
  nano_banana_pro_youmind: {
    id: "nano_banana_pro_youmind",
    tipo: "repositorio",
    nome: "YouMind-OpenLab/awesome-nano-banana-pro-prompts",
    url: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts",
    licenca: "CC BY 4.0 declarada no texto (a API do GitHub mostra NOASSERTION); prompts de criadores",
    uso: "inspiração de estilos, texto próprio",
    estado: "integrado",
    nota: "11 prompts da biblioteca da Mesa Foto citam a fonte como inspiração; nenhum texto copiado.",
  },
  foto_de_produto_jeremygdm: {
    id: "foto_de_produto_jeremygdm",
    tipo: "repositorio",
    nome: "JeremyGDM/awesome-ai-product-photography-prompts",
    url: "https://github.com/JeremyGDM/awesome-ai-product-photography-prompts",
    licenca: "CC0 1.0",
    uso: "modelos adaptados na biblioteca e as dicas de escrita em foto_de_produto_com_verdade",
    estado: "integrado",
    nota: "27 prompts da biblioteca e a técnica do diretor, das variações, do agente e da campanha da Mesa Foto.",
  },
  advertising_ops: {
    id: "advertising_ops",
    tipo: "repositorio",
    nome: "charlesdove977/advertising-ops",
    url: "https://github.com/charlesdove977/advertising-ops",
    licenca: "MIT",
    uso: "briefing de diretor de marketing (tipo, CTA único, oferta concreta) e campos de decomposição",
    estado: "integrado",
    nota: "Entra em briefing_antes_de_criar (oferta da Mesa Ads) e fontes_do_criativo. A raspagem por Apify e a geração por Higgsfield não entram.",
  },
  awesome_ads: {
    id: "awesome_ads",
    tipo: "repositorio",
    nome: "cenoura/awesome-ads",
    url: "https://github.com/cenoura/awesome-ads",
    licenca: "CC BY 4.0",
    uso: "nenhum",
    estado: "nao_se_aplica",
    nota: "Lista de ad tech e mídia programática, parada desde 2023; não traz método de criativo nem de Meta para negócio local.",
  },
  ad_library_scraper_minimaxir: {
    id: "ad_library_scraper_minimaxir",
    tipo: "repositorio",
    nome: "minimaxir/facebook-ad-library-scraper",
    url: "https://github.com/minimaxir/facebook-ad-library-scraper",
    licenca: "MIT",
    uso: "nenhum",
    estado: "nao_se_aplica",
    nota: "Script de 2019 para a API oficial (anúncios políticos). A Mesa Ads já chama a mesma API (ads_archive) direto no código.",
  },
  ads_library_mcp_proxy_intell: {
    id: "ads_library_mcp_proxy_intell",
    tipo: "repositorio",
    nome: "proxy-intell/facebook-ads-library-mcp",
    url: "https://github.com/proxy-intell/facebook-ads-library-mcp",
    licenca: "MIT",
    uso: "avaliado como fonte do agente sênior",
    estado: "avaliado",
    nota: "Depende da ScrapeCreators (paga, por crédito) e do Gemini para vídeo. Não instalado; recomendação em docs/motores/REPOSITORIOS.md.",
  },
  ads_library_mcp_ramses: {
    id: "ads_library_mcp_ramses",
    tipo: "repositorio",
    nome: "RamsesAguirre777/facebook-ads-library-mcp",
    url: "https://github.com/RamsesAguirre777/facebook-ads-library-mcp",
    licenca: "MIT",
    uso: "avaliado como fonte do agente sênior",
    estado: "avaliado",
    nota: "Raspa a página pública com navegador sem conta (fere os termos de coleta automatizada da Meta e quebra quando o layout muda). Não instalado.",
  },
  // ---- bases que não são repositório do GitHub
  anthropic_marketing: {
    id: "anthropic_marketing",
    tipo: "pacote_de_skills",
    nome: "Plugins marketing e sales da Anthropic (knowledge-work-plugins)",
    url: "https://github.com/anthropics/knowledge-work-plugins",
    licenca: "Apache 2.0",
    uso: "resumo próprio em conhecimento-marketing.ts",
    estado: "integrado",
    nota: "Lista completa em docs/conhecimento/SKILLS-NO-SISTEMA.md.",
  },
  skills_de_design: {
    id: "skills_de_design",
    tipo: "pacote_de_skills",
    nome: "Skills de design da máquina (brandkit, redesign, minimalist, soft, taste)",
    licenca: "MIT onde declarada",
    uso: "princípio transferível em anti_generico e identidade_de_marca",
    estado: "integrado",
    nota: "docs/conhecimento/SKILLS-NO-SISTEMA.md.",
  },
  especialistas: {
    id: "especialistas",
    tipo: "especialistas",
    nome: "Pedro Sobral e Natália Torres (conteúdo público)",
    licenca: "conteúdo público resumido com fonte e data",
    uso: "princípios com fonte em conhecimento-especialistas-ads.ts",
    estado: "integrado",
    nota: "docs/conhecimento/pedro-sobral.md e natalia-torres.md.",
  },
  pesquisa_social: {
    id: "pesquisa_social",
    tipo: "base_da_casa",
    nome: "Pesquisa de conteúdo viral e social media (Frente O)",
    licenca: "texto próprio com fontes",
    uso: "conhecimento-social.ts",
    estado: "integrado",
    nota: "docs/conhecimento/conteudo-viral.md.",
  },
};

// ------------------------------------------------------------------ origem de cada bloco

/**
 * De onde vem cada bloco que algum motor monta (o id é o de montarComTeto).
 * `skills` são nomes de skill dentro das fontes (marketingskills, plugins).
 */
export const ORIGEM_DOS_BLOCOS: Record<string, { modulo: string; fontes: string[]; skills: string[] }> = {
  // conhecimento-marketing.ts
  voz_de_marca: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["brand-review", "draft-content"] },
  revisao_de_marca: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["brand-review"] },
  formulas_de_titulo: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["content-creation"] },
  cta_principios: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["content-creation"] },
  estruturas_de_conteudo: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["content-creation", "draft-content"] },
  plano_de_campanha: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["campaign-plan"] },
  calendario_editorial: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["campaign-plan"] },
  analise_de_desempenho: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["performance-report"] },
  posicionamento_e_concorrencia: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["competitive-brief"] },
  objecoes_e_voz_do_cliente: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["handle-objection", "customer-voice"] },
  anti_generico: { modulo: "conhecimento-marketing.ts", fontes: ["skills_de_design"], skills: ["redesign-skill", "minimalist-skill", "soft-skill", "taste-skill"] },
  identidade_de_marca: { modulo: "conhecimento-marketing.ts", fontes: ["skills_de_design"], skills: ["brandkit"] },
  // conhecimento-especialistas-ads.ts
  ganchos_dos_especialistas: { modulo: "conhecimento-especialistas-ads.ts", fontes: ["especialistas"], skills: [] },
  criativo_natalia: { modulo: "conhecimento-especialistas-ads.ts", fontes: ["especialistas"], skills: [] },
  estrutura_de_conta: { modulo: "conhecimento-especialistas-ads.ts", fontes: ["especialistas"], skills: [] },
  plano_de_teste: { modulo: "conhecimento-especialistas-ads.ts", fontes: ["especialistas"], skills: [] },
  orcamento_inicial: { modulo: "conhecimento-especialistas-ads.ts", fontes: ["especialistas"], skills: [] },
  regras_de_corte_e_escala: { modulo: "conhecimento-especialistas-ads.ts", fontes: ["especialistas"], skills: [] },
  erros_comuns_trafego: { modulo: "conhecimento-especialistas-ads.ts", fontes: ["especialistas"], skills: [] },
  estrategia_senior_de_conta: { modulo: "conhecimento-especialistas-ads.ts", fontes: ["especialistas"], skills: [] },
  // conhecimento-social.ts
  sinais_do_algoritmo: { modulo: "conhecimento-social.ts", fontes: ["pesquisa_social"], skills: [] },
  sinais_para_medir: { modulo: "conhecimento-social.ts", fontes: ["pesquisa_social"], skills: [] },
  alcance_e_conversao: { modulo: "conhecimento-social.ts", fontes: ["pesquisa_social"], skills: [] },
  mistura_do_mes: { modulo: "conhecimento-social.ts", fontes: ["pesquisa_social"], skills: [] },
  datas_e_oportunidades: { modulo: "conhecimento-social.ts", fontes: ["pesquisa_social"], skills: [] },
  ganchos_por_tipo: { modulo: "conhecimento-social.ts", fontes: ["pesquisa_social"], skills: [] },
  carrossel_de_retencao: { modulo: "conhecimento-social.ts", fontes: ["pesquisa_social"], skills: [] },
  checklist_salva_e_envia: { modulo: "conhecimento-social.ts", fontes: ["pesquisa_social"], skills: [] },
  // conhecimento-repositorios.ts (Frente W)
  matriz_de_ganchos: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills"], skills: ["ad-creative"] },
  portfolio_de_estaticos: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills"], skills: ["ad-creative"] },
  fontes_do_criativo: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills", "swipefile", "ad_whisperer", "advertising_ops"], skills: ["ad-creative"] },
  meta_na_pratica: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills"], skills: ["ads"] },
  psicologia_do_comprador: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills"], skills: ["marketing-psychology"] },
  revisao_em_sete_passadas: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills"], skills: ["copy-editing", "copywriting"] },
  briefing_antes_de_criar: { modulo: "conhecimento-repositorios.ts", fontes: ["advertising_ops", "marketingskills"], skills: ["offers"] },
  contexto_de_marketing: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills"], skills: ["product-marketing"] },
  pesquisa_de_cliente: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills", "product_swipefile"], skills: ["customer-research", "competitor-profiling"] },
  lancamento_e_isca: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills"], skills: ["launch", "lead-magnets"] },
  estrategia_de_conteudo: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills"], skills: ["content-strategy", "social"] },
  foto_de_produto_com_verdade: { modulo: "conhecimento-repositorios.ts", fontes: ["foto_de_produto_jeremygdm", "gpt_image_2_evolink"], skills: [] },
  imagem_e_titulo: { modulo: "conhecimento-repositorios.ts", fontes: ["marketingskills", "foto_de_produto_jeremygdm"], skills: ["ad-creative"] },
};

/** O checklist de criativo do objetivo entra com id checklist_<objetivo> e vem dos especialistas. */
export function origemDoBloco(id: string): { modulo: string; fontes: string[]; skills: string[] } | null {
  if (ORIGEM_DOS_BLOCOS[id]) return ORIGEM_DOS_BLOCOS[id];
  if (id.startsWith("checklist_")) return { modulo: "conhecimento-especialistas-ads.ts", fontes: ["especialistas"], skills: [] };
  return null;
}

// ------------------------------------------------------------------ skills do marketingskills

export type SkillMapeada = {
  /** integrado: chega ao prompt pelos blocos; coberto: a base da casa já cobre; nao_se_aplica: fora do que o painel faz. */
  estado: "integrado" | "coberto" | "nao_se_aplica";
  blocos: string[];
  nota: string;
};

/**
 * As 50 skills de coreyhaines31/marketingskills (versão de 25/09/2026) e o
 * que cada uma virou no painel. Uma skill integrada tem bloco em algum motor
 * (o teste confere).
 */
export const SKILLS_MARKETINGSKILLS: Record<string, SkillMapeada> = {
  "ad-creative": { estado: "integrado", blocos: ["matriz_de_ganchos", "portfolio_de_estaticos", "fontes_do_criativo", "imagem_e_titulo"], nota: "Mesa Ads (ângulos, copy, pacote, sênior) e Estúdio (direção)." },
  ads: { estado: "integrado", blocos: ["meta_na_pratica"], nota: "Mesa Ads (pacote, conta) e agente sênior." },
  "marketing-psychology": { estado: "integrado", blocos: ["psicologia_do_comprador"], nota: "Mesa Ads (copy, oferta)." },
  "copy-editing": { estado: "integrado", blocos: ["revisao_em_sete_passadas"], nota: "Mesa Ads (copy), Mês (escrita) e Estúdio (legenda)." },
  copywriting: { estado: "integrado", blocos: ["revisao_em_sete_passadas"], nota: "A parte de página já está em estruturas_de_conteudo; o que serve ao post entra pela revisão." },
  offers: { estado: "integrado", blocos: ["briefing_antes_de_criar"], nota: "Mesa Ads (oferta). A equação de valor já estava em CONHECIMENTO_OFERTA." },
  "product-marketing": { estado: "integrado", blocos: ["contexto_de_marketing"], nota: "Agente de contexto (montar e conversar)." },
  "customer-research": { estado: "integrado", blocos: ["pesquisa_de_cliente"], nota: "Agente de contexto." },
  "competitor-profiling": { estado: "integrado", blocos: ["pesquisa_de_cliente"], nota: "Fronteira do concorrente; o resto já está em posicionamento_e_concorrencia." },
  launch: { estado: "integrado", blocos: ["lancamento_e_isca"], nota: "Mês (campanha)." },
  "lead-magnets": { estado: "integrado", blocos: ["lancamento_e_isca"], nota: "Mês (campanha com objetivo de lead)." },
  "content-strategy": { estado: "integrado", blocos: ["estrategia_de_conteudo"], nota: "Mês (temas)." },
  social: { estado: "integrado", blocos: ["estrategia_de_conteudo"], nota: "Mês (temas); ganchos e calendário já estavam em conhecimento-social.ts." },
  "ab-testing": { estado: "coberto", blocos: [], nota: "ROTINA_DE_TESTE, METODO_DA_REFERENCIA e plano_de_teste já cobrem hipótese, uma variável e volume." },
  attribution: { estado: "coberto", blocos: [], nota: "analise_de_desempenho já diz que atribuição é direção, não verdade." },
  "marketing-plan": { estado: "coberto", blocos: [], nota: "plano_de_campanha e o ciclo do painel; o plano anual de cliente é da Central (outra frente)." },
  "marketing-ideas": { estado: "coberto", blocos: [], nota: "Ideias de SaaS; o Mês já propõe temas com datas, mistura e pesquisa." },
  emails: { estado: "coberto", blocos: [], nota: "SEQUENCIAS_DE_MENSAGEM em conhecimento-marketing.ts (ainda sem motor que use)." },
  "seo-audit": { estado: "coberto", blocos: [], nota: "SEO_ESSENCIAL em conhecimento-marketing.ts (ainda sem motor que use)." },
  video: { estado: "nao_se_aplica", blocos: [], nota: "O painel não produz vídeo (o Mês só aceita carrossel e estático)." },
  image: { estado: "nao_se_aplica", blocos: [], nota: "Escolha de ferramenta e de modelo; o modelo do painel é escolha do dono." },
  cro: { estado: "nao_se_aplica", blocos: [], nota: "Otimização de página do site; o painel não edita páginas." },
  "ai-seo": { estado: "nao_se_aplica", blocos: [], nota: "Site e blog, fora dos motores de conteúdo social e anúncio." },
  analytics: { estado: "nao_se_aplica", blocos: [], nota: "Instalação de rastreamento; os números vêm do banco." },
  aso: { estado: "nao_se_aplica", blocos: [], nota: "Loja de aplicativos." },
  "churn-prevention": { estado: "nao_se_aplica", blocos: [], nota: "Assinatura de software." },
  "co-marketing": { estado: "nao_se_aplica", blocos: [], nota: "Parceria; entra só como canal emprestado em lancamento_e_isca." },
  "cold-email": { estado: "nao_se_aplica", blocos: [], nota: "Prospecção B2B; o painel tem CRM próprio." },
  "community-marketing": { estado: "nao_se_aplica", blocos: [], nota: "Comunidade de produto digital." },
  competitors: { estado: "nao_se_aplica", blocos: [], nota: "Página de comparação para SEO." },
  "directory-submissions": { estado: "nao_se_aplica", blocos: [], nota: "Diretórios de startup." },
  events: { estado: "nao_se_aplica", blocos: [], nota: "Eventos e webinars." },
  "free-tools": { estado: "nao_se_aplica", blocos: [], nota: "Ferramenta gratuita como marketing." },
  "influencer-marketing": { estado: "nao_se_aplica", blocos: [], nota: "Contratação de influenciador; fora dos motores." },
  "marketing-council": { estado: "nao_se_aplica", blocos: [], nota: "Simula conselheiros famosos; risco de atribuir fala a quem não disse." },
  "marketing-loops": { estado: "nao_se_aplica", blocos: [], nota: "Rotinas de agente; o painel tem os próprios ciclos." },
  onboarding: { estado: "nao_se_aplica", blocos: [], nota: "Ativação de usuário de software." },
  paywalls: { estado: "nao_se_aplica", blocos: [], nota: "Aplicativo." },
  popups: { estado: "nao_se_aplica", blocos: [], nota: "Site." },
  pricing: { estado: "nao_se_aplica", blocos: [], nota: "Preço de software; o preço do cliente vem do briefing." },
  "programmatic-seo": { estado: "nao_se_aplica", blocos: [], nota: "Páginas em escala." },
  prospecting: { estado: "nao_se_aplica", blocos: [], nota: "Lista de prospecção; é do CRM." },
  "public-relations": { estado: "nao_se_aplica", blocos: [], nota: "Imprensa." },
  referrals: { estado: "nao_se_aplica", blocos: [], nota: "Programa de indicação." },
  revops: { estado: "nao_se_aplica", blocos: [], nota: "Operação de receita." },
  "sales-enablement": { estado: "nao_se_aplica", blocos: [], nota: "Material de vendas." },
  schema: { estado: "nao_se_aplica", blocos: [], nota: "Dados estruturados de site." },
  "site-architecture": { estado: "nao_se_aplica", blocos: [], nota: "Mapa de site." },
  signup: { estado: "nao_se_aplica", blocos: [], nota: "Cadastro de software." },
  sms: { estado: "nao_se_aplica", blocos: [], nota: "SMS; o canal do painel é WhatsApp e e-mail." },
};

// ------------------------------------------------------------------ motores

export type Motor = {
  id: string;
  nome: string;
  /** Edge Function que chama a IA. */
  funcao: string;
  /** Arquivo onde a ligação está e trechos que precisam existir nele. */
  ligacao: { arquivo: string; trechos: string[] };
  /** Base principal do agente, que vem antes deste bloco e vale sobre ele. */
  bases: string[];
  /** Monta o conhecimento que este motor recebe (com o objetivo, quando a tarefa aceita). */
  montar: (objetivo?: unknown) => ConhecimentoMontado;
  /** Blocos que nunca podem faltar, com qualquer objetivo. */
  promete: string[];
};

const ADS = "supabase/functions/mesa-ads/index.ts";
const ESTUDIO = "supabase/functions/estudio-arte/index.ts";
const CALENDARIO = "supabase/functions/agente-calendario/index.ts";
const FOTO = "supabase/functions/mesa-foto/index.ts";
const CONTEXTO = "supabase/functions/agente-contexto/index.ts";

const BASE_ADS = ["conhecimento-ads.ts: CONHECIMENTO_ESTRATEGISTA_ADS (inteira, antes)", "mesa-ads: REGRAS_DA_EXECUCAO (depois)"];

const motorAds = (tarefa: TarefaAds, promete: string[]): Motor => ({
  id: `mesa_ads.${tarefa}`,
  nome: `Mesa Ads: estrategista (${tarefa})`,
  funcao: "mesa-ads",
  ligacao: { arquivo: ADS, trechos: ["conhecimentoAdsPara(tarefa, { objetivo })", `sistema: sistemaDoEstrategista("${tarefa}"`] },
  bases: BASE_ADS,
  montar: (objetivo) => conhecimentoAdsPara(tarefa, { objetivo }),
  promete,
});

export const MOTORES: readonly Motor[] = [
  {
    id: "estudio.direcao",
    nome: "Estúdio: diretor de arte (direção e conversa)",
    funcao: "estudio-arte",
    ligacao: {
      arquivo: ESTUDIO,
      trechos: [
        'const CONHECIMENTO_DA_DIRECAO = conhecimentoEstudioPara("direcao").texto;',
        "sistema: [CONHECIMENTO_DIRETOR, CONHECIMENTO_DA_DIRECAO, prompt, INSTRUCOES_DIRECAO, preferencias.texto]",
      ],
    },
    bases: ["conhecimento-design.ts: CONHECIMENTO_DIRETOR", "direcao-arte.ts: PADRAO_DA_LAMINA e blocoDasProibicoes (texto ao gerador, sem marketing)"],
    montar: () => conhecimentoEstudioPara("direcao"),
    promete: ["anti_generico", "voz_de_marca", "revisao_de_marca", "cta_principios", "imagem_e_titulo"],
  },
  {
    id: "estudio.legenda",
    nome: "Estúdio: legenda final",
    funcao: "estudio-arte",
    ligacao: { arquivo: ESTUDIO, trechos: ['const CONHECIMENTO_DA_LEGENDA = conhecimentoEstudioPara("legenda").texto;', "sistema: `${CONHECIMENTO_DA_LEGENDA}"] },
    bases: ["estudio-arte: INSTRUCOES_LEGENDA"],
    montar: () => conhecimentoEstudioPara("legenda"),
    promete: ["formulas_de_titulo", "cta_principios", "anti_generico", "revisao_em_sete_passadas"],
  },
  {
    id: "calendario.mes",
    nome: "Mês: estrategista (escrever e ajustar o mês)",
    funcao: "agente-calendario",
    ligacao: { arquivo: CALENDARIO, trechos: ['mes: conhecimentoCalendarioPara("mes").texto', 'sistema: sistemaDoCalendario(ctx, "mes")'] },
    bases: ["prompt do banco (agente_prompts) com BASE_DO_ESTRATEGISTA", "conhecimento-conteudo.ts: tipos e frameworks", "REGRAS_DE_SAIDA (depois)"],
    montar: () => conhecimentoCalendarioPara("mes"),
    promete: ["calendario_editorial", "formulas_de_titulo", "cta_principios", "voz_de_marca", "anti_generico", "ganchos_por_tipo", "carrossel_de_retencao", "checklist_salva_e_envia", "revisao_em_sete_passadas"],
  },
  {
    id: "calendario.temas",
    nome: "Mês: propor temas",
    funcao: "agente-calendario",
    ligacao: { arquivo: CALENDARIO, trechos: ['temas: conhecimentoCalendarioPara("temas").texto', 'sistema: sistemaDoCalendario(ctx, "temas")'] },
    bases: ["prompt do banco com BASE_DO_ESTRATEGISTA", "conhecimento-social.ts: datas calculadas no código"],
    montar: () => conhecimentoCalendarioPara("temas"),
    promete: ["calendario_editorial", "mistura_do_mes", "datas_e_oportunidades", "ganchos_por_tipo", "alcance_e_conversao", "estrategia_de_conteudo", "formulas_de_titulo", "cta_principios", "voz_de_marca", "anti_generico"],
  },
  {
    id: "calendario.diagnostico",
    nome: "Mês: pesquisa e diagnóstico",
    funcao: "agente-calendario",
    ligacao: { arquivo: CALENDARIO, trechos: ['diagnostico: conhecimentoCalendarioPara("diagnostico").texto', 'sistema: sistemaDoCalendario(e.ctx, "diagnostico")'] },
    bases: ["prompt do banco com BASE_DO_ESTRATEGISTA"],
    montar: () => conhecimentoCalendarioPara("diagnostico"),
    promete: ["sinais_do_algoritmo", "sinais_para_medir", "alcance_e_conversao", "mistura_do_mes", "datas_e_oportunidades", "analise_de_desempenho", "calendario_editorial", "anti_generico"],
  },
  {
    id: "calendario.campanha",
    nome: "Mês: campanhas",
    funcao: "agente-calendario",
    ligacao: { arquivo: CALENDARIO, trechos: ['campanha: conhecimentoCalendarioPara("campanha").texto', 'sistema: sistemaDoCalendario(ctx, "campanha")'] },
    bases: ["prompt do banco com BASE_DO_ESTRATEGISTA"],
    montar: () => conhecimentoCalendarioPara("campanha"),
    promete: ["plano_de_campanha", "lancamento_e_isca", "voz_de_marca", "formulas_de_titulo", "cta_principios", "anti_generico"],
  },
  motorAds("angulos", [
    "ganchos_dos_especialistas", "matriz_de_ganchos", "criativo_natalia", "portfolio_de_estaticos", "estrutura_de_conta", "plano_de_teste",
    "orcamento_inicial", "regras_de_corte_e_escala", "objecoes_e_voz_do_cliente", "cta_principios", "anti_generico",
  ]),
  motorAds("copy", [
    "ganchos_dos_especialistas", "matriz_de_ganchos", "criativo_natalia", "fontes_do_criativo", "objecoes_e_voz_do_cliente",
    "psicologia_do_comprador", "cta_principios", "anti_generico", "revisao_de_marca", "revisao_em_sete_passadas",
  ]),
  motorAds("pacote", [
    "ganchos_dos_especialistas", "criativo_natalia", "portfolio_de_estaticos", "estrutura_de_conta", "plano_de_teste", "orcamento_inicial",
    "regras_de_corte_e_escala", "meta_na_pratica", "objecoes_e_voz_do_cliente", "anti_generico",
  ]),
  motorAds("oferta", ["briefing_antes_de_criar", "objecoes_e_voz_do_cliente", "posicionamento_e_concorrencia", "psicologia_do_comprador", "cta_principios", "anti_generico"]),
  motorAds("conta", ["estrutura_de_conta", "regras_de_corte_e_escala", "erros_comuns_trafego", "meta_na_pratica"]),
  {
    id: "mesa_ads.senior",
    nome: "Mesa Ads: agente sênior de tráfego",
    funcao: "mesa-ads",
    ligacao: { arquivo: ADS, trechos: ["const extra = conhecimentoAgenteSenior(objetivo).texto;", "sistema: sistemaDoAgenteSenior(objetivo)"] },
    bases: [...BASE_ADS, "Biblioteca de Anúncios da Meta (ads_archive) quando o token do cofre permite; pesquisa web"],
    montar: (objetivo) => conhecimentoAgenteSenior(objetivo),
    promete: [
      "estrategia_senior_de_conta", "estrutura_de_conta", "plano_de_teste", "regras_de_corte_e_escala", "ganchos_dos_especialistas",
      "erros_comuns_trafego", "meta_na_pratica", "orcamento_inicial", "portfolio_de_estaticos", "criativo_natalia",
    ],
  },
  {
    id: "mesa_foto.agente",
    nome: "Mesa Foto: agente e diretor de campanha",
    funcao: "mesa-foto",
    ligacao: { arquivo: FOTO, trechos: ["const CONHECIMENTO_DA_FOTO = conhecimentoMesaFoto().texto;", "${REGRAS_DA_CASA}\n${CONHECIMENTO_DA_FOTO}"] },
    bases: ["mesa-foto: REGRAS_DA_CASA, PADRAO_PUBLICITARIO e ESTETICA_ATUAL", "biblioteca de 138 prompts (foto_biblioteca, títulos no contexto do agente)"],
    montar: () => conhecimentoMesaFoto(),
    promete: ["anti_generico", "identidade_de_marca", "criativo_natalia", "foto_de_produto_com_verdade"],
  },
  {
    id: "mesa_foto.diretor",
    nome: "Mesa Foto: diretor de fotografia (ensaio e variações)",
    funcao: "mesa-foto",
    ligacao: { arquivo: FOTO, trechos: ['const TECNICA_DA_FOTO = conhecimentoMesaFoto("diretor").texto;', "${REGRAS_DA_CASA}\n${TECNICA_DA_FOTO}"] },
    bases: ["mesa-foto: REGRAS_DA_CASA e PADRAO_PUBLICITARIO", "prompt da biblioteca escolhido pela equipe (guia modo biblioteca)"],
    montar: () => conhecimentoMesaFoto("diretor"),
    promete: ["foto_de_produto_com_verdade"],
  },
  {
    id: "contexto",
    nome: "Contexto do cliente (montar e conversar)",
    funcao: "agente-contexto",
    ligacao: {
      arquivo: CONTEXTO,
      trechos: ["const CONHECIMENTO_DO_CONTEXTO = conhecimentoContexto().texto;", "sistema: `${SISTEMA_CONTEXTO}\\n\\n${CONHECIMENTO_DO_CONTEXTO}`"],
    },
    bases: ["agente-contexto: SISTEMA_CONTEXTO e SISTEMA_CONVERSA"],
    montar: () => conhecimentoContexto(),
    promete: ["voz_de_marca", "contexto_de_marketing", "posicionamento_e_concorrencia", "objecoes_e_voz_do_cliente", "pesquisa_de_cliente", "identidade_de_marca"],
  },
];

/**
 * Quem de propósito NÃO recebe base de marketing (para ninguém "consertar"
 * achando que é esquecimento).
 */
export const SEM_BASE_DE_PROPOSITO: Record<string, string> = {
  "estudio.gerador": "promptDaLamina e promptDoReplicar (texto ao gerador de imagem): o gerador entende posição, escala e cor, não método de marketing. Aprovado pelo dono em 25/09.",
  "mesa_foto.leitor_kits_conferencia": "Descrever, agrupar e conferir foto: conhecimento de marketing só atrapalha.",
  "contexto.leitura_acervo": "Leitura de material e acervo: só extração.",
  "central.rituais": "Esteira, coach e rituais (dossiê) são das frentes R e S; conhecimentoMarketingPara(\"dossie\") existe mas não está ligado.",
  mcp: "O MCP não tem prompt próprio: as ações de mesa passam pela ponte (mcp-mesas-ponte.ts) e chamam as funções acima, que já montam o conhecimento.",
};

// ------------------------------------------------------------------ consultas

export function motor(id: string): Motor | null {
  return MOTORES.find((m) => m.id === id) ?? null;
}

/** Motores que prometem o bloco. */
export function motoresDoBloco(bloco: string): string[] {
  return MOTORES.filter((m) => m.promete.includes(bloco)).map((m) => m.id);
}

/** Skills (de qualquer fonte) que chegam ao motor, pelos blocos prometidos. */
export function skillsDoMotor(id: string): string[] {
  const m = motor(id);
  if (!m) return [];
  return Array.from(new Set(m.promete.flatMap((b) => origemDoBloco(b)?.skills ?? [])));
}

/** Fontes (repositórios, pacotes, especialistas) que chegam ao motor. */
export function fontesDoMotor(id: string): string[] {
  const m = motor(id);
  if (!m) return [];
  return Array.from(new Set(m.promete.flatMap((b) => origemDoBloco(b)?.fontes ?? [])));
}

/** Motores alcançados por uma fonte. */
export function motoresDaFonte(fonte: string): string[] {
  return MOTORES.filter((m) => m.promete.some((b) => (origemDoBloco(b)?.fontes ?? []).includes(fonte))).map((m) => m.id);
}
