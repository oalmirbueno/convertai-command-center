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
import { conhecimentoDoPlano } from "./conhecimento-do-plano.ts";
import { NOMES_DAS_FERRAMENTAS } from "./ferramentas-do-cliente.ts";
import { conhecimentoEdicao } from "./conhecimento-edicao.ts";
import { conhecimentoPublicidade } from "./conhecimento-publicidade.ts";
import { conhecimentoRoteiros } from "./conhecimento-roteiros.ts";
import { conhecimentoEstilo } from "./conhecimento-estilo.ts";

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
  // Frente C (26/09): agente do cliente (modo plano do agente de contexto).
  metodo_da_casa_plano: {
    id: "metodo_da_casa_plano",
    tipo: "base_da_casa",
    nome: "Método da casa para o começo do cliente (nicho, estágio, plano ACELERA, caminho e stack)",
    licenca: "texto próprio",
    uso: "comeco_do_cliente e caminho_e_stack em conhecimento-do-plano.ts",
    estado: "integrado",
    nota: "Agente do cliente (agente-contexto, modo plano).",
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
  // Mesa Vídeos (frente V2, 25/09): edição
  brabo_edicao_dinamica: {
    id: "brabo_edicao_dinamica",
    tipo: "pacote_de_skills",
    nome: "Edição dinâmica Brabo com IA, pacote público 2.0 (Fernando Araújo / Brabo Space)",
    licenca: "sem arquivo de licença no pacote (material de estudo); marcas e bibliotecas de terceiros com seus direitos",
    uso: "só o método, resumido em palavras próprias em conhecimento-edicao.ts; nenhum texto, código de composição ou mídia copiado",
    estado: "integrado",
    nota: "Direção do Pacote para editar da Mesa Vídeos (aba Edição).",
  },
  kit_audiovisual: {
    id: "kit_audiovisual",
    tipo: "base_da_casa",
    nome: "Kit do Estúdio Audiovisual V2 (25/09/2026)",
    licenca: "texto próprio",
    uso: "agentes de montagem, legendas, sincronismo e organizador de acervo, resumidos em conhecimento-edicao.ts; papéis de roteiro, modos, inteligência editorial, técnicas e direção de gravação (com o documento de roteiro modelo do dono) em conhecimento-roteiros.ts",
    estado: "integrado",
    nota: "Takes e montagem no Pacote para editar; organizador de takes em organizador-de-takes.ts. Mesa Roteiros: roteirista e agente (só o método; os prompts do kit são proposta).",
  },
  kit_publicidade: {
    id: "kit_publicidade",
    tipo: "base_da_casa",
    nome: "Kit de pesquisa da Mesa de Publicidade (24/09/2026)",
    licenca: "texto próprio com fontes públicas citadas no kit",
    uso: "método de campanha, territórios, tomadas, revisão e receitas por categoria em conhecimento-publicidade.ts",
    estado: "integrado",
    nota: "Mesa Publicidade (diretor de campanha e agente). As receitas entram como dado na mensagem do diretor.",
  },
  // Frente R2 (26/09): Mesa Roteiros (o kit_audiovisual acima também alimenta conhecimento-roteiros.ts).
  skills_de_video: {
    id: "skills_de_video",
    tipo: "pacote_de_skills",
    nome: "Skill hyperframes-creative (referências story-spine e narration)",
    licenca: "uso interno da máquina; resumo próprio",
    uso: "ROTEIRO_DE_VIDEO em conhecimento-marketing.ts (ritmo de fala, valor antes da evidência, estrutura curta)",
    estado: "integrado",
    nota: "Mesa Roteiros. Antes estava escrito e sem motor.",
  },
  // Frente S2 (26/09): agente de estilo do cliente.
  pesquisa_estilo: {
    id: "pesquisa_estilo",
    tipo: "base_da_casa",
    nome: "Pesquisa de guia de estilo para social e de como a IA de imagem segue um estilo (frente S2)",
    licenca: "texto próprio com fontes públicas citadas",
    uso: "conhecimento-estilo.ts (sistema visual, capa e miolo, estilo que a IA segue, aprender com o cliente, tendência do nicho)",
    estado: "integrado",
    nota: "docs/estudio/ESTILO-DO-CLIENTE.md. Agente de estilo (agente-estilo).",
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
  // conhecimento-do-plano.ts (frente C, agente do cliente)
  comeco_do_cliente: { modulo: "conhecimento-do-plano.ts", fontes: ["metodo_da_casa_plano"], skills: [] },
  caminho_e_stack: { modulo: "conhecimento-do-plano.ts", fontes: ["metodo_da_casa_plano"], skills: [] },
  seo_essencial: { modulo: "conhecimento-marketing.ts", fontes: ["anthropic_marketing"], skills: ["seo-audit"] },
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
  // conhecimento-edicao.ts (frente V2, Mesa Vídeos)
  edicao_da_fala_a_imagem: { modulo: "conhecimento-edicao.ts", fontes: ["brabo_edicao_dinamica"], skills: ["brabo-edicao-video-dinamica"] },
  edicao_tres_modos: { modulo: "conhecimento-edicao.ts", fontes: ["brabo_edicao_dinamica"], skills: ["brabo-edicao-video-dinamica"] },
  edicao_ilustracao_explica_o_verbo: { modulo: "conhecimento-edicao.ts", fontes: ["brabo_edicao_dinamica"], skills: ["brabo-edicao-video-dinamica"] },
  edicao_legenda_e_lettering: { modulo: "conhecimento-edicao.ts", fontes: ["brabo_edicao_dinamica", "kit_audiovisual"], skills: ["brabo-edicao-video-dinamica"] },
  edicao_tempo_e_movimento: { modulo: "conhecimento-edicao.ts", fontes: ["brabo_edicao_dinamica"], skills: ["brabo-edicao-video-dinamica"] },
  edicao_sincronia: { modulo: "conhecimento-edicao.ts", fontes: ["brabo_edicao_dinamica", "kit_audiovisual"], skills: ["brabo-edicao-video-dinamica"] },
  edicao_montagem_e_takes: { modulo: "conhecimento-edicao.ts", fontes: ["kit_audiovisual"], skills: [] },
  edicao_revisao_honesta: { modulo: "conhecimento-edicao.ts", fontes: ["brabo_edicao_dinamica"], skills: ["brabo-edicao-video-dinamica"] },
  // conhecimento-publicidade.ts (frente P, 26/09)
  verdade_do_produto: { modulo: "conhecimento-publicidade.ts", fontes: ["kit_publicidade"], skills: [] },
  territorios_criativos: { modulo: "conhecimento-publicidade.ts", fontes: ["kit_publicidade"], skills: [] },
  plano_de_tomadas_publicitarias: { modulo: "conhecimento-publicidade.ts", fontes: ["kit_publicidade"], skills: [] },
  produto_antes_da_estetica: { modulo: "conhecimento-publicidade.ts", fontes: ["kit_publicidade"], skills: [] },
  aprovacoes_separadas: { modulo: "conhecimento-publicidade.ts", fontes: ["kit_publicidade"], skills: [] },
  // conhecimento-roteiros.ts (frente R2, 26/09)
  papeis_do_roteiro: { modulo: "conhecimento-roteiros.ts", fontes: ["kit_audiovisual"], skills: [] },
  modos_do_roteiro: { modulo: "conhecimento-roteiros.ts", fontes: ["kit_audiovisual"], skills: [] },
  inteligencia_editorial: { modulo: "conhecimento-roteiros.ts", fontes: ["kit_audiovisual"], skills: [] },
  tecnicas_editoriais: { modulo: "conhecimento-roteiros.ts", fontes: ["kit_audiovisual"], skills: [] },
  direcao_de_gravacao: { modulo: "conhecimento-roteiros.ts", fontes: ["kit_audiovisual"], skills: [] },
  roteiro_de_video: { modulo: "conhecimento-marketing.ts", fontes: ["skills_de_video"], skills: ["hyperframes-creative"] },
  // conhecimento-estilo.ts (frente S2, 26/09)
  sistema_visual_de_social: { modulo: "conhecimento-estilo.ts", fontes: ["pesquisa_estilo"], skills: [] },
  capa_e_miolo: { modulo: "conhecimento-estilo.ts", fontes: ["pesquisa_estilo"], skills: [] },
  estilo_que_a_ia_segue: { modulo: "conhecimento-estilo.ts", fontes: ["pesquisa_estilo"], skills: [] },
  aprender_com_o_cliente: { modulo: "conhecimento-estilo.ts", fontes: ["pesquisa_estilo"], skills: [] },
  tendencia_do_nicho: { modulo: "conhecimento-estilo.ts", fontes: ["pesquisa_estilo"], skills: [] },
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
  "seo-audit": { estado: "integrado", blocos: ["seo_essencial"], nota: "SEO_ESSENCIAL chega ao agente do cliente (Perfil da Empresa no Google e site no plano)." },
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
  /** Ferramentas internas de leitura que o motor pode pedir (ferramentas-do-cliente.ts). */
  ferramentas?: string[];
};

const ADS = "supabase/functions/mesa-ads/index.ts";
const ESTUDIO = "supabase/functions/estudio-arte/index.ts";
const CALENDARIO = "supabase/functions/agente-calendario/index.ts";
const FOTO = "supabase/functions/mesa-foto/index.ts";
const CONTEXTO = "supabase/functions/agente-contexto/index.ts";
const VIDEOS = "supabase/functions/mesa-videos/index.ts";
const PUBLICIDADE = "supabase/functions/mesa-publicidade/index.ts";
const ROTEIROS = "supabase/functions/mesa-roteiros/index.ts";
const ESTILO = "supabase/functions/agente-estilo/index.ts";
const PERFIS = "supabase/functions/perfis-instagram/index.ts";

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
  // Frente C (26/09): o agente de contexto promovido a agente do cliente (modo plano, mesma conversa).
  {
    id: "contexto.plano",
    nome: "Agente do cliente: começo, plano ACELERA, caminho e tech stack",
    funcao: "agente-contexto",
    ligacao: {
      arquivo: CONTEXTO,
      trechos: ["const CONHECIMENTO_DO_PLANO = conhecimentoDoPlano().texto;", "    SISTEMA_DO_PLANO,", "    CONHECIMENTO_DO_PLANO,", "blocoDasFerramentas(),", "executarLeituras(db, clientId, pedidos"],
    },
    bases: ["agente-contexto: SISTEMA_DO_PLANO", "metodo-acelera.ts: blocoDoMetodoParaPrompt (fase do cliente)", "plano-do-cliente.ts: apelidos de projetos, marcos, tarefas e equipe"],
    montar: () => conhecimentoDoPlano(),
    promete: ["comeco_do_cliente", "caminho_e_stack", "contexto_de_marketing", "posicionamento_e_concorrencia", "plano_de_campanha", "seo_essencial", "pesquisa_de_cliente", "identidade_de_marca"],
    ferramentas: [...NOMES_DAS_FERRAMENTAS],
  },
  {
    id: "mesa_videos.direcao_de_edicao",
    nome: "Mesa Vídeos: direção de edição do Pacote para editar",
    funcao: "mesa-videos",
    ligacao: {
      arquivo: VIDEOS,
      trechos: ['const CONHECIMENTO_DA_EDICAO = conhecimentoEdicao("pacote").texto;', 'pacote.arquivos["direcao.md"].indexOf(CONHECIMENTO_DA_EDICAO) < 0'],
    },
    bases: ["pacote-de-edicao.ts: roteiro, takes, decupagem, legendas e edl.json no formato dos projetos Remotion do dono (sem IA nesta versão)"],
    montar: () => conhecimentoEdicao("pacote"),
    promete: [
      "edicao_da_fala_a_imagem", "edicao_tres_modos", "edicao_ilustracao_explica_o_verbo", "edicao_legenda_e_lettering", "edicao_tempo_e_movimento",
      "edicao_sincronia", "edicao_montagem_e_takes", "edicao_revisao_honesta",
    ],
  },
  {
    id: "mesa_publicidade.diretor",
    nome: "Mesa Publicidade: diretor de campanha (três territórios)",
    funcao: "mesa-publicidade",
    ligacao: { arquivo: PUBLICIDADE, trechos: ['const CONHECIMENTO_DO_DIRETOR = conhecimentoPublicidade("diretor").texto;', "sistema: SISTEMA_DO_DIRETOR"] },
    bases: ["mesa-publicidade: SISTEMA_DO_DIRETOR (regras da saída)", "receita da categoria como dado na mensagem (conhecimento-publicidade.ts)"],
    montar: () => conhecimentoPublicidade("diretor"),
    promete: [
      "verdade_do_produto", "territorios_criativos", "plano_de_tomadas_publicitarias", "produto_antes_da_estetica", "aprovacoes_separadas",
      "identidade_de_marca", "anti_generico", "foto_de_produto_com_verdade",
    ],
  },
  {
    id: "mesa_publicidade.agente",
    nome: "Mesa Publicidade: agente da mesa (conversa e ações confirmadas)",
    funcao: "mesa-publicidade",
    ligacao: { arquivo: PUBLICIDADE, trechos: ['const CONHECIMENTO_DO_AGENTE = conhecimentoPublicidade("agente").texto;', "sistema: sistemaDoAgente(c, comAcoes)"] },
    bases: ["mesa-publicidade: SISTEMA_DO_AGENTE e o contrato comum das ações (acoes-do-agente.ts)"],
    montar: () => conhecimentoPublicidade("agente"),
    promete: ["verdade_do_produto", "produto_antes_da_estetica", "aprovacoes_separadas", "territorios_criativos"],
  },
  // Frente R2 (26/09): Mesa Roteiros. O roteirista escreve; o agente conversa e propõe ações confirmadas.
  {
    id: "mesa_roteiros.roteirista",
    nome: "Mesa Roteiros: roteirista (gerar, refazer gancho, mudar tom)",
    funcao: "mesa-roteiros",
    ligacao: { arquivo: ROTEIROS, trechos: ["const CONHECIMENTO_DO_ROTEIRO = conhecimentoRoteiros().texto;", "sistema: `${SISTEMA_ROTEIRISTA}\\n\\n${CONHECIMENTO_DO_ROTEIRO}`"] },
    bases: ["mesa-roteiros: SISTEMA_ROTEIRISTA (regras da saída) e o papel do modo (roteiro-modelo.ts, MODOS_DE_ROTEIRO)"],
    montar: (objetivo) => conhecimentoRoteiros(objetivo),
    promete: [
      "papeis_do_roteiro", "modos_do_roteiro", "inteligencia_editorial", "tecnicas_editoriais", "direcao_de_gravacao",
      "roteiro_de_video", "cta_principios", "voz_de_marca", "anti_generico",
    ],
  },
  {
    id: "mesa_roteiros.agente",
    nome: "Mesa Roteiros: agente da mesa (conversa e ações confirmadas)",
    funcao: "mesa-roteiros",
    ligacao: { arquivo: ROTEIROS, trechos: ["const CONHECIMENTO_DO_ROTEIRO = conhecimentoRoteiros().texto;", "sistema: `${SISTEMA_AGENTE}\\n\\n${CONHECIMENTO_DO_ROTEIRO}"] },
    bases: ["mesa-roteiros: SISTEMA_AGENTE e o contrato comum das ações (acoes-do-agente.ts)"],
    montar: (objetivo) => conhecimentoRoteiros(objetivo),
    promete: ["papeis_do_roteiro", "modos_do_roteiro", "inteligencia_editorial", "roteiro_de_video"],
  },
  // Frente S2 (26/09): agente de estilo do cliente (botão Estilo no Estúdio e no Estúdio Ads).
  {
    id: "estilo.agente",
    nome: "Estilo do cliente: diretor de estilo (conversa, proposta do guia, leitura das referências)",
    funcao: "agente-estilo",
    ligacao: { arquivo: ESTILO, trechos: ["const CONHECIMENTO_DO_ESTILO = conhecimentoEstilo().texto;", "sistema: `${SISTEMA_DO_ESTILO}\\n\\n${CONHECIMENTO_DO_ESTILO}"] },
    bases: ["agente-estilo: SISTEMA_DO_ESTILO e o contrato comum das ações (acoes-do-agente.ts)", "estilo-do-cliente.ts: o guia guardado, versões e aprendizados"],
    montar: () => conhecimentoEstilo(),
    promete: ["sistema_visual_de_social", "capa_e_miolo", "estilo_que_a_ia_segue", "aprender_com_o_cliente", "tendencia_do_nicho", "identidade_de_marca", "anti_generico"],
  },
  // Frente P (26/09): Perfis do Instagram. Plano "igual a esse perfil" e ideias de resposta a concorrente.
  {
    id: "perfis.plano",
    nome: "Perfis do Instagram: plano igual ao perfil e ideias de resposta",
    funcao: "perfis-instagram",
    ligacao: {
      arquivo: PERFIS,
      trechos: ['const CONHECIMENTO_DO_PLANO_IGUAL = conhecimentoCalendarioPara("temas").texto;', "sistema: `${pedido.sistema}\\n\\n${CONHECIMENTO_DO_PLANO_IGUAL}`"],
    },
    bases: ["perfis-instagram: SISTEMA_DO_PLANO_IGUAL e SISTEMA_DAS_IDEIAS (regras da saída e anti-cópia)", "perfis-instagram.ts: números em código e a conferência de cópia do Jev"],
    montar: () => conhecimentoCalendarioPara("temas"),
    promete: ["calendario_editorial", "mistura_do_mes", "datas_e_oportunidades", "ganchos_por_tipo", "alcance_e_conversao", "estrategia_de_conteudo", "formulas_de_titulo", "cta_principios", "voz_de_marca", "anti_generico"],
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
  "perfis.leitura": "Leitura dos posts dos perfis do Instagram (visão) e o resumo do perfil: só descrição e números, sem método de marketing.",
  "central.rituais": "Esteira, coach e rituais (dossiê) são das frentes R e S; conhecimentoMarketingPara(\"dossie\") existe mas não está ligado.",
  mcp: "O MCP não tem prompt próprio: as ações de mesa passam pela ponte (mcp-mesas-ponte.ts) e chamam as funções acima, que já montam o conhecimento.",
};

/**
 * Mudanças no texto ao gerador do Estúdio (estudio.gerador continua sem base
 * de marketing; ver SEM_BASE_DE_PROPOSITO). Cada item diz o que mudou, onde a
 * ligação está e o que prova que o caminho aprovado pelo dono não mudou. O
 * teste src/test/estudio-fidelidade-referencia.test.ts cobra os trechos.
 */
export type MudancaDoGerador = {
  id: string;
  em: string;
  pedido: string;
  o_que: string;
  /** Módulo puro com a regra (texto do prompt montado em código, sem IA). */
  modulo: string;
  ligacao: { arquivo: string; trechos: string[] };
  /** O que não muda (o teste compara o prompt de hoje, byte a byte). */
  intocado: string;
};

export const MUDANCAS_DO_GERADOR_DO_ESTUDIO: readonly MudancaDoGerador[] = [
  {
    id: "fidelidade_da_referencia",
    em: "2026-09-25",
    pedido: "Dono: \"pode ter o negócio da referência extremamente idêntica, mais ou menos, ser criativo junto, ter os controles que eu consiga aumentar e diminuir\".",
    o_que: "Quatro níveis no modo replicar referência (Idêntica, Próxima, Inspirada, Criativa), por lâmina (card.fidelidade_referencia) com padrão do trabalho (direcao.fidelidade_referencia). Fora de Idêntica a referência não é editada (vai como anexo) e promptDoReplicar troca só os blocos do nível. O nível fica na versão (fidelidade_referencia).",
    modulo: "_shared/fidelidade-da-referencia.ts e promptDoReplicar (direcao-arte.ts)",
    ligacao: {
      arquivo: ESTUDIO,
      trechos: [
        "const fidelidade = fidelidadeDaLamina(card, t.direcao);",
        "const editando = refsNoPrompt[0].indice === 1 && imagens.length > 0 && fidelidade === \"identica\";",
        "fidelidade_referencia: fidelidade,",
      ],
    },
    intocado: "Idêntica (o padrão): prompt, anexos e edição da referência iguais aos de 25/09 (src/test/fixtures/replicar-identica-hoje.json).",
  },
  {
    id: "variedade_com_memoria",
    em: "2026-09-25",
    pedido: "Dono: \"ele entender o que já foi feito, para não ficar fazendo sempre a mesma coisa\".",
    o_que: "Na capa, fora de Idêntica: lê as últimas capas do cliente nas versões gravadas (referencias, molde_lido, modo, fidelidade_referencia, variedade), principalmente as da mesma referência, e escolhe em código o que variar (pose, câmera, posição do texto, elemento gráfico, cor de destaque da paleta). Bloco VARIEDADE no prompt; a escolha fica na versão (variedade).",
    modulo: "_shared/fidelidade-da-referencia.ts (capasNoHistorico, escolherVariedade, blocoDaVariedade)",
    ligacao: { arquivo: ESTUDIO, trechos: ["await variedadeDaCapa(t, fidelidade, refsNoPrompt[0].id", "variedade ? variedade.bloco : \"\","] },
    intocado: "Idêntica não lê o histórico nem ganha bloco; sem IA extra.",
  },
  {
    id: "prancha_de_referencias",
    em: "2026-09-25",
    pedido: "Dono: \"às vezes eu coloco várias artes dentro de uma imagem: um print de um perfil do Instagram com várias capas, ou a sequência de um carrossel num print\".",
    o_que: "Leitura por visão da prancha (uma vez, prancha-<ref>.json), quadros recortados em código: a capa usa um quadro de capa e a lâmina k o quadro de sequência k (ciclando); a capa feita de prancha passa o quadro de sequência às lâminas que não replicam (bloco da série).",
    modulo: "_shared/prancha-de-referencias.ts",
    ligacao: {
      arquivo: ESTUDIO,
      trechos: ["await quadrosDasPranchas(t, refsDaEquipe, ordem, versoesDaLamina)", "prancha: pranchaDaReferencia,", "serieComQuadroDaPrancha({ ordem, total, sequencia: indiceDaSequencia })"],
    },
    intocado: "Referência simples (sem leitura de prancha, ou lida como arte única) segue igual; a geração nunca dispara a leitura da prancha.",
  },
  {
    id: "estilo_do_cliente",
    em: "2026-09-26",
    pedido: "Dono: \"quando ativo, a geração parte desse estilo como ponto de partida para não ficar genérica, e as referências da lâmina continuam complementando\".",
    o_que: "Com direcao.usar_estilo_do_cliente ligado e o estilo do cliente ativo, entram as referências do estilo (até 2) DEPOIS das da lâmina e o bloco curto ESTILO DO CLIENTE no fim do texto, antes das regras de render. Vale para post e criativo de anúncio (o Estúdio Ads gera pelo mesmo gerarCard). A versão guarda estilo_do_cliente.",
    modulo: "_shared/estilo-do-cliente.ts (blocoDoEstiloParaOGerador) e estudio-arte/estilo-na-geracao.ts",
    ligacao: { arquivo: ESTUDIO, trechos: ["const estiloDoCliente = await estiloNaGeracao(t, {", "    blocoDoEstilo,\n    blocoDoTemplate,\n  ].filter(Boolean).join"] },
    intocado: "Desligado (o padrão): estiloNaGeracao devolve null sem ler o banco e o prompt é byte a byte o de hoje (fixture replicar-identica-hoje.json e o do modo normal).",
  },
  {
    id: "referencia_adapta_copy",
    em: "2026-09-26",
    pedido: "Dono: \"copiar o estilo, a estratégia, o layout e a estética da referência, mas montar a imagem com base no contexto da copy e do roteiro; muitas vezes o assunto da referência não tem nada a ver\".",
    o_que: "No modo replicar, com o interruptor direcao.adaptar_conteudo_a_copy ligado (padrão): leitura por visão da referência (estética separada do conteúdo, guardada em conteudo-<ref>.json), Noul e Choice do Jev (serve a partir de 0,75) e, quando o assunto não serve, uma cena do diretor de arte num bloco ADAPTAR O CONTEÚDO À MENSAGEM logo depois do promptDoReplicar. A cena passa pela trava da marca. A versão guarda adaptacao_da_copy.",
    modulo: "estudio-arte/referencia-adapta-copy.ts e _shared/trava-da-marca.ts",
    ligacao: { arquivo: ESTUDIO, trechos: ["const querAdaptar = tentaAdaptar({", "      replica.prompt,\n      adaptacao ? adaptacao.bloco : \"\","] },
    intocado: "Conteúdo que serve, sem copy, com foto do cliente, interruptor desligado ou qualquer falha da leitura, do Jev ou do diretor: bloco vazio e o prompt é byte a byte o de hoje (fixture replicar-identica-hoje.json).",
  },
  {
    id: "rosto_na_referencia",
    em: "2026-09-26",
    pedido: "Dono: \"a equipe escolhe o rosto de quem vai aparecer, o dono ou o cliente, muito fiel, mas pose, ângulo, expressão e enquadramento podem variar para combinar com a arte\".",
    o_que: "Com direcao.rosto (cliente, equipe ou fotos na hora), até 2 fotos de identidade entram depois dos anexos da lâmina (antes das do estilo), no limite de imagens do modelo, e o bloco ROSTO ESCOLHIDO entra depois do bloco da copy. Opção destacar põe o rosto em evidência. A versão guarda rosto.",
    modulo: "estudio-arte/rosto-na-geracao.ts",
    ligacao: { arquivo: ESTUDIO, trechos: ["const rostoEscolhido = replicar && fotosReplicar.length === 0 ? lerRostoDoTrabalho(t.direcao, t.client_id) : null;", "      blocoDoRostoAqui,"] },
    intocado: "Sem rosto escolhido (o padrão): nada é lido, nenhuma imagem entra e o prompt é byte a byte o de hoje.",
  },
  {
    id: "rosto_v2",
    em: "2026-09-26",
    pedido: "Dono: \"posso buscar qualquer foto que tiver pessoas, abrir a pasta, selecionar qualquer foto e também o clone já gerado; detalhar sorrindo, assim; e com base na foto ele tem que variar e compor com a imagem\".",
    o_que: "Fonte escolhidas (1 a 3 fotos do acervo, Workspace, Arquivos ou de um clone, inclusive as geradas, conferidas na geração), campo como (pose e expressão) no bloco ROSTO ESCOLHIDO, que agora pede recriar a pessoa na composição e integrar na luz da arte. Lâmina normal leva o rosto quando o Noul do Jev diz que a direção pede pessoa (a referência automática cede a vaga). A versão guarda as fotos usadas; conferir_rosto é só aviso.",
    modulo: "estudio-arte/rosto-na-geracao.ts",
    ligacao: { arquivo: ESTUDIO, trechos: ["const rostoNaNormal = !replicar && !ads && !baseFoto && !recorteNaLamina && elementos.length === 0 ? lerRostoDoTrabalho(t.direcao, t.client_id) : null;", "    blocoDoRostoNaNormal,"] },
    intocado: "Sem rosto escolhido (o padrão): nada é lido, o Jev não é chamado, nenhuma imagem entra e o prompt da lâmina normal e do replicar é byte a byte o de hoje (fixtures lamina-normal-hoje.json e replicar-identica-hoje.json).",
  },
  {
    id: "composicao_dinamica",
    em: "2026-09-26",
    pedido: "Dono: \"nas referências ele não segue a jogada de texto, fica travado\"; \"atrás estava escrito 'melhor' e ele copiou\"; \"os textos ficam numa cor só\"; \"o card 2 é um textão, tem que chegar refinado\".",
    o_que: "Molde 2 com texto decorativo e camada; headline dividida nos blocos do título da referência; jogada própria em Inspirada e Criativa (muda por lâmina); termo decorativo da copy (Choice do Jev, guardado); cor por papel dentro da paleta; lâminas 2+ acima do limite enxutas na preparação (uma chamada) e desenhadas na geração.",
    modulo: "_shared/jogada-do-texto.ts e estudio-arte/composicao-dinamica.ts",
    ligacao: { arquivo: ESTUDIO, trechos: ["const termoDaLamina = await termoDecorativoDaLamina(", "const enxuto = await enxugarMiolo(direcao.cards, direcao.conceito,"] },
    intocado: "Idêntica sem título quebrado, sem decorativo e sem cores repetidas: o prompt é o de hoje; criativo de anúncio (Mesa Ads) sem a cor por papel nem o miolo desenhado; montar do roteiro continua grátis quando nenhuma lâmina passa do limite (com lâmina longa, a tela mostra o custo da chamada curta antes).",
  },
  {
    id: "serie_e_miolo",
    em: "2026-09-26",
    pedido: "Dono: \"na referência da capa ele fica puxando praticamente tudo para a segunda lâmina; tem elementos que são só da capa\"; \"os outros cards são muito simples; legal ter uma caixa dentro às vezes, ou algo ligado a algo; não com camada, sempre no gerador, sem repetir e sem ficar genérico\".",
    o_que: "A capa de referência (molde) é separada em identidade da série e só da capa, pelo papel dos blocos e por regras; o ambíguo vai a um Choice do Jev por elemento, numa chamada guardada por referência. Lâmina 2 em diante com a referência do conjunto e algo só da capa deixa de replicar a capa e vira lâmina de conteúdo da série (a referência vai como guia da identidade). O bloco da série do post diz o que herdar e o que não repetir. O miolo ganha um componente de lâmina desenhado pelo gerador (cartão, caixas conectadas, linha do tempo, colunas, checklist, número em cartão, balão, citação, chips, mini-gráfico, caixa de dica, ícones de linha), escolhido em código pelo tipo do conteúdo, com rotação na série.",
    modulo: "estudio-arte/serie-da-capa.ts e estudio-arte/miolo-rico.ts",
    ligacao: { arquivo: ESTUDIO, trechos: ["const serieDaCapa = herdaReferenciaDaCapa({", "blocoDaIdentidadeDaSerie({ ordem, total, capa: indiceDaCapa, cenaFixa })", "componente: componenteDoMiolo, zona: zonaDoTexto })"] },
    intocado: "Capa sem mudança; lâmina com referência própria (Idêntica e os outros níveis) igual; referência sem nada só da capa replica como hoje; anúncio (Mesa Ads) com o bloco da série de sempre; fixtures replicar-identica-hoje.json e lamina-normal-hoje.json iguais.",
  },
  {
    id: "tipografia_do_cliente",
    em: "2026-09-26",
    pedido: "Dono: \"tem que seguir a tipografia correta de cada cliente, e cada cliente sem misturar, e não inventar, e seguir a consistência das fontes no carrossel\".",
    o_que: "A fonte vem sempre do kit da marca do trabalho; kit sem fonte não gera (409 sem_tipografia). As amostras da tipografia (título e texto, desenhadas no navegador no peso usado) vão anexadas com o papel TIPOGRAFIA DO CLIENTE, na prioridade lâmina, rosto, tipografia, referência automática, estilo e template. O bloco TIPOGRAFIA DO CLIENTE fixa família, peso e caixa por papel em todas as lâminas; a capa (ou a primeira lâmina gerada) é a âncora e a versão guarda o registro; a lâmina 2+ pedida junto com a capa espera por ela na fila.",
    modulo: "estudio-arte/tipografia-do-cliente.ts",
    ligacao: { arquivo: ESTUDIO, trechos: ["const tipografia = tipografiaDoKit(fontes);", "candidatos.push(...anexosDaTipografia(tipografia, t.client_id)", "const blocoDaTipografiaAqui = blocoDaTipografia({"] },
    intocado: "Com título e texto no kit, a lista de fontes do prompt é a mesma e o promptDaLamina e o promptDoReplicar não mudam (fixtures iguais); o bloco novo entra fora deles. Ajuste, correção e fundo contínuo seguem sem a recusa.",
  },
  {
    id: "texto_da_lamina",
    em: "2026-09-26",
    pedido: "Dono: \"quando gerar a arte, ele já refinar e encurtar o conteúdo, senão fica textão; ou divide em partes e não deixa só em um lugar; ajuda na continuação e dinâmica do carrossel, pra não ficar sempre fixo de um lado, na mesma coisa\".",
    o_que: "Na geração de cada lâmina, o texto acima do limite do papel (capa, miolo, fechamento, estático) vai numa chamada curta ao redator, guardada por texto, mantendo número, nome, preço e CTA; o texto enxuto vai para a direção; resposta que não cabe é cortada no fim de frase, com aviso. O miolo com mais de uma ideia leva o texto dividido em 2 a 4 partes curtas (em código, trechos do texto exato) distribuídas pelo componente do miolo. No modo normal a zona do texto roda na série sem repetir a zona nem o eixo da vizinha, respeitando o lado do assunto (a descrição é espelhada quando troca de lado). A lâmina que não cabe recebe a sugestão de dividir em 2 lâminas, só com a confirmação da equipe.",
    modulo: "estudio-arte/texto-da-lamina.ts e estudio-arte/posicao-na-serie.ts",
    ligacao: {
      arquivo: ESTUDIO,
      trechos: [
        "const textoNaGeracao = ads ? null : await textoDaLaminaNaGeracao(t, card,",
        "if (posicaoDaSerie) cardDoPrompt = posicaoDaSerie.card;",
        "partesDaLamina ? blocoDoTextoEmPartes({",
        "texto_da_lamina: textoDaLamina,",
      ],
    },
    intocado: "Texto dentro do limite: nada é chamado e o prompt é o de hoje; capa que já tem versão não muda; anúncio (Mesa Ads) igual; lâmina com referência (qualquer nível), foto, recorte, contínuo, a capa e o fechamento ficam na zona da direção; promptDaLamina e promptDoReplicar não mudam (fixtures iguais).",
  },
  {
    id: "navegacao_do_carrossel",
    em: "2026-09-28",
    pedido: "Dono: capa do carrossel sempre com o indicador \"arraste para o lado\" na base; lâminas do meio também; última com os ícones de curtir, comentar, salvar e enviar; padronizado, na cor e na fonte da marca. Correção: \"não quero que faça nada por cima, e sim pelo gerador\".",
    o_que: "No carrossel orgânico, o bloco NAVEGAÇÃO DO CARROSSEL entra no fim da base da lâmina (todos os modos) e no replicar: capa e meio pedem o indicador com seta no canto inferior direito, a última a fileira dos quatro ícones centralizada; posição em px, tamanho relativo, cor e fonte da marca iguais em todas. Com foto real, a faixa da base abre na máscara. A conferência pergunta ao Jev (Noul, na mesma chamada da identidade) se veio e grava só o aviso; o texto do indicador não conta como sobrando.",
    modulo: "_shared/navegacao-do-carrossel.ts",
    ligacao: {
      arquivo: ESTUDIO,
      trechos: [
        "const navegacaoDaGeracao = navegacaoDaLamina({ ordem, total, anuncio: ads, post: quadro.post });",
        "questions.navegacao = perguntaDaNavegacao(navegacaoDaConferencia)",
      ],
    },
    intocado: "Arte única, story ou reel (9:16) e criativo de anúncio: bloco vazio e o prompt de hoje; promptDaLamina e promptDoReplicar não mudam (fixtures iguais); a autocorreção não lê o aviso (sem laço).",
  },
];

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

/** Ferramentas internas de leitura de um motor (vazio quando ele não pede leitura). */
export function ferramentasDoMotor(id: string): string[] {
  return motor(id)?.ferramentas?.slice() ?? [];
}

/** Motores alcançados por uma fonte. */
export function motoresDaFonte(fonte: string): string[] {
  return MOTORES.filter((m) => m.promete.some((b) => (origemDoBloco(b)?.fontes ?? []).includes(fonte))).map((m) => m.id);
}
