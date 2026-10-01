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
import { conhecimentoDoPlano } from "../agente-contexto/modulos/conhecimento-do-plano.ts";
import { NOMES_DAS_FERRAMENTAS } from "../agente-contexto/modulos/ferramentas-do-cliente.ts";
import { conhecimentoEdicao } from "../mesa-videos/modulos/conhecimento-edicao.ts";
import { conhecimentoPublicidade } from "./conhecimento-publicidade.ts";
import { conhecimentoRoteiros } from "./conhecimento-roteiros.ts";
import { conhecimentoEstilo } from "./conhecimento-estilo.ts";
import { conhecimentoDaBaseDeDesign } from "./uiux/citar.ts";
import {
  AGENTES_COM_SUPERPODERES,
  type IdDoMetodo,
  LICENCA_DO_SUPERPOWERS,
  SKILL_DE_ORIGEM,
  SKILLS_DO_SUPERPOWERS,
  type SkillDoSuperpowers,
  URL_DO_SUPERPOWERS,
  VERSAO_DOS_SUPERPODERES,
} from "./superpoderes-catalogo.ts";

export const VERSAO_DOS_MOTORES = `2026-09-30.1 (repositórios ${VERSAO_CONHECIMENTO_REPOSITORIOS}; superpoderes ${VERSAO_DOS_SUPERPODERES})`;

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
  // Frente UXM (30/09): base de inteligência de design da Mesa Site e da Mesa Identidade.
  ui_ux_pro_max: {
    id: "ui_ux_pro_max",
    tipo: "repositorio",
    nome: "nextlevelbuilder/ui-ux-pro-max-skill (npm ui-ux-pro-max-cli 2.15.0)",
    url: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    licenca: "MIT (Next Level Builder); o pacote npm não traz o LICENSE, o texto vem do repositório (workers/motor-codigo/vendor/ui-ux-pro-max/LICENSE)",
    uso: "dado importado com aviso MIT (styles, products, colors, ui-reasoning, typography, landing, ux-guidelines, charts, google-fonts) em _shared/uiux/dados, gerado por scripts/uiux/importar-base.mjs; textos da tela e dos agentes são nossos (uiux/pt.ts e citar.ts)",
    estado: "integrado",
    nota: "Mesa Site (Direção: estilos da base, padrão, par, variantes, paleta de apoio; Revisão: regras de UX), Mesa Identidade (paleta do setor e pares) e Preencher com IA (fonte base). O diretor de site cita a base (base_citada).",
  },
  // Frente SPP (30/09): o método da casa em todos os agentes (superpoderes-catalogo.ts e superpoderes.ts).
  superpowers: {
    id: "superpowers",
    tipo: "pacote_de_skills",
    nome: "obra/superpowers",
    url: URL_DO_SUPERPOWERS,
    licenca: LICENCA_DO_SUPERPOWERS,
    uso: "método resumido em português (superpoderes-catalogo.ts); no motor de código, as skills originais v6.4.2 vendorizadas",
    estado: "integrado",
    nota: "Blocos sp_* em todos os agentes de conversa e geração; skills originais no worker do motor de código; escritor de cenas com o método próprio. Aviso da licença em docs/licencas/superpowers-MIT.txt.",
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
  // uiux/citar.ts (frente UXM, 30/09)
  base_de_design: { modulo: "uiux/citar.ts", fontes: ["ui_ux_pro_max"], skills: [] },
  // superpoderes-catalogo.ts (frente SPP, 30/09): o método da casa, adaptado de obra/superpowers (MIT).
  sp_abertura: { modulo: "superpoderes-catalogo.ts", fontes: ["superpowers"], skills: ["using-superpowers"] },
  sp_entender: { modulo: "superpoderes-catalogo.ts", fontes: ["superpowers"], skills: SKILL_DE_ORIGEM.entender },
  sp_plano: { modulo: "superpoderes-catalogo.ts", fontes: ["superpowers"], skills: SKILL_DE_ORIGEM.plano },
  sp_prova: { modulo: "superpoderes-catalogo.ts", fontes: ["superpowers"], skills: SKILL_DE_ORIGEM.prova },
  sp_causa: { modulo: "superpoderes-catalogo.ts", fontes: ["superpowers"], skills: SKILL_DE_ORIGEM.causa },
  sp_receber: { modulo: "superpoderes-catalogo.ts", fontes: ["superpowers"], skills: SKILL_DE_ORIGEM.receber },
  sp_revisor: { modulo: "superpoderes-catalogo.ts", fontes: ["superpowers"], skills: SKILL_DE_ORIGEM.revisor },
  sp_aceite: { modulo: "superpoderes-catalogo.ts", fontes: ["superpowers"], skills: SKILL_DE_ORIGEM.aceite },
  sp_frentes: { modulo: "superpoderes-catalogo.ts", fontes: ["superpowers"], skills: SKILL_DE_ORIGEM.frentes },
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
  schema: { estado: "coberto", blocos: [], nota: "A Mesa Site monta os dados estruturados do negócio no pacote (schemaDoNegocio em site-lancamento.ts) e a revisão confere o JSON-LD." },
  "site-architecture": { estado: "coberto", blocos: [], nota: "A Mesa Site edita o mapa do site (tipos, páginas e as 25 seções da biblioteca em site-biblioteca.ts) e os padrões de landing da base UI UX Pro Max (site-variantes.ts)." },
  signup: { estado: "nao_se_aplica", blocos: [], nota: "Cadastro de software." },
  sms: { estado: "nao_se_aplica", blocos: [], nota: "SMS; o canal do painel é WhatsApp e e-mail." },
};

// ------------------------------------------------------------------ skills do superpowers

/**
 * As 15 skills de obra/superpowers v6.4.2 e o que cada uma virou no painel
 * (seção 6 do desenho p9). O teste exige exatamente 15, como no marketingskills.
 */
export const SKILLS_SUPERPOWERS: Record<string, SkillDoSuperpowers> = SKILLS_DO_SUPERPOWERS;

// ------------------------------------------------------------------ superpoderes de cada agente

export type LigacaoDoMetodo = { arquivo: string; trechos: string[] };

export type SuperpoderesDoAgente = {
  /** Id do agente em AGENTES_COM_SUPERPODERES (superpoderes-catalogo.ts). */
  id: string;
  funcao: string;
  escolha: "jev" | "codigo";
  /** Métodos possíveis (a prova sempre). */
  metodos: IdDoMetodo[];
  /** Onde a ligação está (superpoderesPara e o metodo na chamada) e, quando o agente mora em mais de um arquivo, os outros. */
  ligacao: LigacaoDoMetodo;
  mais?: LigacaoDoMetodo[];
};

const F = (funcao: string, arquivo = "index.ts") => `supabase/functions/${funcao}/${arquivo}`;

/**
 * Onde cada agente recebe o método da casa (tabela 4.6 do desenho). É a prova
 * de "todas as mesas": o teste cobra que os trechos existem no código de cada
 * função, inclusive das que hoje estão fora de MOTORES (Redes, Vídeos, Edição,
 * Proposta, Contratos, Identidade, Site, Motion, Briefing, Documento,
 * Preencher, Workspace, Assistente geral, Central, Conselho e rituais).
 */
const LIGACOES_DOS_SUPERPODERES: Record<string, { ligacao: LigacaoDoMetodo; mais?: LigacaoDoMetodo[] }> = {
  "contexto.conversa": { ligacao: { arquivo: F("agente-contexto"), trechos: ['superpoderesPara(db, { agente: "contexto.conversa"', "metodo: sp,", "declarados: o.metodos_usados"] } },
  // Revisão 30/09: o montar (motor "contexto" do índice), no cliente e na marca.
  "contexto.montar": { ligacao: { arquivo: F("agente-contexto"), trechos: ['metodo: await superpoderesPara(db, { agente: "contexto.montar", momento: "gerar" }),'] } },
  "contexto.plano": { ligacao: { arquivo: F("agente-contexto"), trechos: ['superpoderesPara(db, { agente: "contexto.plano"', "metodo: spPlano,", "fechadoDoPlano.anexo"] } },
  "calendario.conversa": { ligacao: { arquivo: F("agente-calendario"), trechos: ['superpoderesPara(servico, { agente: "calendario.conversa"', "metodo: await spP,", "metodo: await spCampanhaP,", "metodo: await spMesP,"] } },
  "calendario.gerar": { ligacao: { arquivo: F("agente-calendario"), trechos: ['superpoderesPara(servico, { agente: "calendario.gerar", momento })', "metodo: await metodoDaGeracao(servico),"] } },
  "estudio.conversa": { ligacao: { arquivo: F("estudio-arte"), trechos: ['superpoderesPara(servico(), { agente: "estudio.conversa"', "metodo: await spP,", "fechado.anexo ? [fechado.anexo]"] } },
  "estudio.direcao": { ligacao: { arquivo: F("estudio-arte"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "estudio.direcao"'] } },
  "estudio.refino": { ligacao: { arquivo: F("estudio-arte"), trechos: ['superpoderesPara(servico(), { agente: "estudio.refino", momento: "ajustar" })', "metodo: spRefino,"] } },
  "estilo.agente": { ligacao: { arquivo: F("agente-estilo"), trechos: ['superpoderesPara(servico(), { agente: "estilo.agente"', "metodo: await spP,"] } },
  "instagram.agente": { ligacao: { arquivo: F("mesa-instagram"), trechos: ['superpoderesPara(servico(), { agente: "instagram.agente"', "metodo: await spP,"] } },
  "instagram.geracao": { ligacao: { arquivo: F("mesa-instagram"), trechos: ['superpoderesPara(servico(), { agente: "instagram.geracao", momento: "gerar" })', "sistema: SISTEMA_DAS_SUGESTOES,\n      metodo: spGeracao,", "sistema: SISTEMA_DOS_DESTAQUES,\n      metodo: spGeracao,"] } },
  "perfis.conversa": { ligacao: { arquivo: F("perfis-instagram"), trechos: ['superpoderesPara(servico(), { agente: "perfis.conversa"', "metodo: await spP,"] } },
  "perfis.plano": { ligacao: { arquivo: F("perfis-instagram"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "perfis.plano", momento: "gerar" }),'] } },
  "ads.plano": { ligacao: { arquivo: F("mesa-ads"), trechos: ['superpoderesPara(servico, { agente: "ads.plano"', "metodo: await spPlanoP,"] } },
  "ads.oferta": { ligacao: { arquivo: F("mesa-ads"), trechos: ['superpoderesPara(servico, { agente: "ads.oferta"', "metodo: await spOfertaP,"] } },
  "ads.senior": { ligacao: { arquivo: F("mesa-ads"), trechos: ['superpoderesPara(servico, { agente: "ads.senior"', "metodo: await spSeniorP,"] } },
  "ads.estrategista": { ligacao: { arquivo: F("mesa-ads"), trechos: ['superpoderesPara(servico, { agente: "ads.estrategista", momento })', 'metodo: await metodoDoEstrategista(servico, "gerar"),', 'metodo: await metodoDoEstrategista(clienteServico(), "lote"),'] } },
  "foto.agente": { ligacao: { arquivo: F("mesa-foto"), trechos: ['superpoderesPara(servico(), { agente: "foto.agente"', "metodo: await spP,"] } },
  "foto.campanha": { ligacao: { arquivo: F("mesa-foto"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "foto.campanha", momento: "gerar" }),'] } },
  "foto.canvas": { ligacao: { arquivo: F("mesa-foto", "canvas.ts"), trechos: ['superpoderesPara(db(), { agente: "foto.canvas"', "metodo: await spP,", "comMetodosUsados(esquema),", "metodo: fechado.anexo"] } },
  "videos.diretor": { ligacao: { arquivo: F("mesa-videos", "diretor.ts"), trechos: ['superpoderesPara(b.servico(), { agente: "videos.diretor"', "metodo: await spP,"] } },
  "edicao.agente": { ligacao: { arquivo: F("editor-video"), trechos: ['superpoderesPara(servico(), { agente: "edicao.agente"', "metodo: sp,", "metodo_usado: fechado.anexo"] } },
  "publicidade.diretor": { ligacao: { arquivo: F("mesa-publicidade"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "publicidade.diretor"'] } },
  "publicidade.agente": { ligacao: { arquivo: F("mesa-publicidade"), trechos: ['superpoderesPara(servico(), { agente: "publicidade.agente"', "metodo: await spP,"] } },
  "roteiros.roteirista": { ligacao: { arquivo: F("mesa-roteiros"), trechos: ['superpoderesPara(servico(), { agente: "roteiros.roteirista"', "metodo: sp,"] } },
  "roteiros.agente": { ligacao: { arquivo: F("mesa-roteiros"), trechos: ['agente: "roteiros.agente"', "metodo: sp,", "fecharComMetodo(servico(), { usoId: saida.usoId, metodo: sp,"] } },
  "proposta.escrever": {
    ligacao: { arquivo: F("mesa-proposta"), trechos: ['superpoderesPara(servico(), { agente: "proposta.escrever"', "metodo: sp,"] },
    mais: [{ arquivo: F("mesa-proposta", "evolucao.ts"), trechos: ['metodo: await superpoderesPara(d.servico(), { agente: "proposta.escrever"'] }],
  },
  "proposta.agente": { ligacao: { arquivo: F("mesa-proposta"), trechos: ['superpoderesPara(servico(), { agente: "proposta.agente"', "metodo: await spP,"] } },
  "contratos.agente": { ligacao: { arquivo: F("contratos"), trechos: ['superpoderesPara(servico(), { agente: "contratos.agente"', "metodo: await spP,"] } },
  "identidade.diretor": { ligacao: { arquivo: F("mesa-identidade", "diretor.ts"), trechos: ['superpoderesPara(servico(), { agente: "identidade.diretor"', "metodo: await spP,"] } },
  "identidade.acoes": {
    ligacao: { arquivo: F("mesa-identidade", "estrategia-acoes.ts"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "identidade.acoes"'] },
    mais: [
      { arquivo: F("mesa-identidade", "naming-acoes.ts"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "identidade.acoes"'] },
      { arquivo: F("mesa-identidade", "projeto-acoes.ts"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "identidade.acoes"'] },
    ],
  },
  "site.agente": { ligacao: { arquivo: F("mesa-site"), trechos: ['superpoderesPara(servico(), { agente: "site.agente"', "metodo: await spP,"] } },
  "site.geracao": {
    ligacao: { arquivo: F("mesa-site"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "site.geracao"'] },
    mais: [{ arquivo: F("mesa-site", "estrutura.ts"), trechos: ['metodo: await superpoderesPara(ctx.servico(), { agente: "site.geracao"'] }],
  },
  "motion.agente": { ligacao: { arquivo: F("mesa-motion"), trechos: ['superpoderesPara(servico(), { agente: "motion.agente"', "metodo: await spP,"] } },
  "motion.geracao": { ligacao: { arquivo: F("mesa-motion"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "motion.geracao"'] } },
  "briefing.preencher": { ligacao: { arquivo: F("briefing-agente", "preencher.ts"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "briefing.preencher" })'] } },
  "preencher.campos": { ligacao: { arquivo: F("preencher-ia"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "preencher.campos" })'] } },
  "documentos.registro": { ligacao: { arquivo: F("documentos"), trechos: ['metodo: await superpoderesPara(servico(), { agente: "documentos.registro" })'] } },
  "conselho.especialista": { ligacao: { arquivo: F("conselho"), trechos: ['agente: "conselho.especialista"', "metodo: await superpoderesPara(servico(),"] } },
  "conselho.sintese": { ligacao: { arquivo: F("conselho"), trechos: ['{ agente: "conselho.sintese", momento: "lote" }'] } },
  // Cadeia antiga (ai-provider): sem usoId, o fecharComMetodo grava o método no registro sem uso, com o cliente.
  "workspace.agente": { ligacao: { arquivo: F("workspace-agent"), trechos: ['superpoderesPara(admin, { agente: "workspace.agente"', "}, fetch, sp);", "}), fetch, sp);", "acaoFeita: false, clientId: safeClientId });", "clientId: o.clientId,"] } },
  // Revisão 30/09: o Jev do método corre junto com o pré-contexto (spAgirP criado antes do Promise.all).
  "assistente.lancador": { ligacao: { arquivo: F("voice-assistant-agent"), trechos: ['const spAgirP = agir ? superpoderesPara(supabase, { agente: "assistente.lancador"', "juntarMetodoAoSistema(sistemaDaConversa, sp)", "spAgir);", "clientId: body.clientId || null });"] } },
  "central.agente": {
    // Revisão 30/09: o método fecha a resposta (prova com a ação feita e a linha "Método:" junto do "Segui").
    ligacao: { arquivo: F("agente-central"), trechos: ['superpoderesPara(db, { agente: "central.agente"', "escolha, await spP);", "escolha, spAplicar);", "fecharComMetodo(servicoDoMetodo(), {", "comAnexoDoMetodo(anexosDoAprendizado("] },
    mais: [{ arquivo: "supabase/functions/_shared/modelo-da-central.ts", trechos: ["metodo: e.metodo ?? null,", "juntarMetodoAoSistema(p.sistema, p.metodo)", "usoId: r.usoId ?? null"] }],
  },
  "rituais.escritor": {
    ligacao: { arquivo: F("ritual-writer"), trechos: ['superpoderesPara(admin, { agente: "rituais.escritor" })', "metodo: metodoDoRitual,", "registrarMetodoSemUso(admin, { metodo: metodoDoRitual"] },
    mais: [
      { arquivo: F("ritual-writer", "escritor.ts"), trechos: ["metodo: p.metodo ?? null,", "metodo: p.metodo ?? null });"] },
      { arquivo: F("agente-central"), trechos: ['superpoderesPara(db, { agente: "rituais.escritor" })', "escolha, metodo: metodoDoRitual,", "registrarMetodoDoRitual(metodoDoRitual, escrito, clientId);"] },
    ],
  },
  // Revisão 30/09: a cadeia antiga e a reserva não geram linha em ia_usos; o método conta pelo registro sem uso.
  "rituais.esteira": { ligacao: { arquivo: F("esteira-semana"), trechos: ['superpoderesPara(db, { agente: "rituais.esteira" })', "metodo: metodoDaEsteira", "registrarMetodoSemUso(db, { metodo: metodoDaEsteira"] } },
  "rituais.coach": { ligacao: { arquivo: F("cycle-coach"), trechos: ['superpoderesPara(db, { agente: "rituais.coach" })', "}, fetch, metodoDoCoach);", "registrarMetodoSemUso(db, { metodo: metodoDoCoach"] } },
  "rituais.radar": { ligacao: { arquivo: F("radar-ideas"), trechos: ['superpoderesPara(db, { agente: "rituais.radar" })', "fetch,\n      metodoDoRadar,\n", "registrarMetodoSemUso(db, { metodo: metodoDoRadar"] } },
};

export const SUPERPODERES_DOS_AGENTES: readonly SuperpoderesDoAgente[] = AGENTES_COM_SUPERPODERES.map((a) => {
  const l = LIGACOES_DOS_SUPERPODERES[a.id] || { ligacao: { arquivo: "", trechos: [] } };
  return { id: a.id, funcao: a.funcao, escolha: a.escolha, metodos: a.metodos.slice(), ligacao: l.ligacao, ...(l.mais ? { mais: l.mais } : {}) };
});

/** Quem de propósito NÃO recebe o método da casa (o teste cobra; ninguém "conserta" achando que é esquecimento). */
export const SEM_METODO_DE_PROPOSITO: Record<string, string> = {
  "estudio.gerador": "Texto ao gerador de imagem (direcao-arte.ts, promptDaLamina e promptDoReplicar, a instrução de edição do ajuste da lâmina e a cena que adapta a referência à copy): o gerador entende posição, escala e cor, não método de trabalho.",
  "estudio.legenda": "Legenda do Estúdio: texto curto com teto próprio e o prompt do diretor; o método vai na direção, no refino e na conversa.",
  "estudio.enxugar": "Enxugar o texto da lâmina no limite (miolo e geração): corte com teto próprio, sem peça nova; o método vai na direção.",
  "estudio.conferencias": "Conferências do Estúdio por visão (rosto da pessoa real e leitura da peça gerada): julgam o que a imagem mostra, sem método de trabalho.",
  "mesa_foto.diretor_e_variacoes": "Diretor, book, variações e sugestões de variação do clone da Mesa Foto recebem só a técnica da foto (o teste de motores exige).",
  "mesa_foto.leitores_e_conferencias": "Leitores, kits, clones, personas e conferências da Mesa Foto (a conferência do Canvas também): descrever, sugerir elenco e conferir foto, sem método. O agente do Canvas conversa com a equipe e recebe o método (foto.canvas).",
  leituras: "Leituras por visão e de acervo (referências, perfis, quadros do vídeo, selo, logo, página do site, brand book, pranchas e carrosséis do estilo, lote do Workspace), o resumo e a comparação dos perfis (só números e fatos) e o significado dos nomes em outros idiomas: só extração.",
  "contexto.pedido_externo": "Pedido para colar num LLM externo (pacote externo da Mesa do cliente): é texto para outro modelo seguir, e o método da casa não vale fora do painel.",
  "estilo.templates": "Combinação de templates do Estilo: o Jev escolhe o melhor de cada fonte, a redação só junta o que foi escolhido e o resultado vira cartão para Confirmar; não é peça nova.",
  "videos.pacote_de_edicao": "Pacote para editar da Mesa Vídeos: montado em código, sem IA; o conhecimento vai para o arquivo direcao.md, não para um prompt.",
  "motion.cena": "escreverCena da Mesa Motion: o escritor de cenas tem o método próprio (frente SPM, _shared/cena-hf.ts) e a prova é o lint e o check do worker.",
  mcp: "O MCP não tem prompt próprio: as ações de mesa passam pela ponte e chamam as funções acima, que já levam o método.",
  jev: "O Jev (julgamento) não é modelo de texto: pergunta tipada, sem sistema; o método não se aplica.",
  "cfo.explicacao": "Explicação do CFO (frente CFO): a IA só reescreve a conta do motor em código, presa aos números (valor fora da conta faz valer o motor); método de trabalho puxaria conteúdo além da conta.",
};

/**
 * Cada chamada a chamarTexto (ou escreverComModeloDaCentral) das funções que
 * NÃO passa `metodo`, pelo caminho da função onde ela mora
 * ("arquivo#funcao/propriedade"), com a entrada de SEM_METODO_DE_PROPOSITO que
 * diz o porquê (revisão de 30/09). O teste varre o código: chamada nova sem
 * `metodo` e fora desta lista reprova, e entrada que não tem mais chamada
 * também. Quem repassa o pedido inteiro (`...pedido`) leva o `metodo` de quem
 * chama e não entra aqui.
 */
export const CHAMADAS_SEM_METODO: Record<string, string> = {
  "agente-cfo/index.ts#explicar": "cfo.explicacao",
  "agente-calendario/selo-da-campanha.ts#classificarReferencia": "leituras",
  "agente-calendario/selo-da-campanha.ts#lerTextoDoSelo": "leituras",
  "agente-contexto/index.ts#acervoClassificar": "leituras",
  "agente-contexto/index.ts#importarBrandBook": "leituras",
  "agente-contexto/index.ts#lerComOLeitor/lerLote": "leituras",
  "agente-contexto/index.ts#pacoteExterno": "contexto.pedido_externo",
  "agente-estilo/index.ts#lerReferencias": "leituras",
  "agente-estilo/templates.ts#combinarInterno": "estilo.templates",
  "agente-estilo/templates.ts#laminasDoPrint": "leituras",
  "agente-estilo/templates.ts#lerSequencia": "leituras",
  "editor-video/index.ts#receitaLer/respostaComFolego": "leituras",
  "editor-video/index.ts#visaoDescrever/respostaComFolego": "leituras",
  "editor-video/edicao-com-ia.ts#rostoRastrear/a.folego": "leituras",
  "estudio-arte/aprendizado-no-estudio.ts#lerVisaoDaEntrega": "leituras",
  "estudio-arte/index.ts#ajustarCard": "estudio.gerador",
  "estudio-arte/index.ts#conferirRosto": "estudio.conferencias",
  "estudio-arte/index.ts#depsDaAdaptacao/escreverCena": "estudio.gerador",
  "estudio-arte/index.ts#depsDaAdaptacao/lerPorVisao": "leituras",
  "estudio-arte/index.ts#legenda": "estudio.legenda",
  "estudio-arte/index.ts#leituraDaLogo": "leituras",
  "estudio-arte/index.ts#lerPrancha": "leituras",
  "estudio-arte/index.ts#lerReferencia": "leituras",
  "estudio-arte/index.ts#marcarPessoasNasFotos": "leituras",
  "estudio-arte/index.ts#moldeDaReferencia": "leituras",
  "estudio-arte/index.ts#prepararItem/enxugarMiolo": "estudio.enxugar",
  "estudio-arte/index.ts#textoDaLaminaNaGeracao/escrever": "estudio.enxugar",
  "estudio-arte/index.ts#verificar": "estudio.conferencias",
  "mesa-ads/index.ts#referenciaLer": "leituras",
  "mesa-foto/book.ts#bookDiretor": "mesa_foto.diretor_e_variacoes",
  "mesa-foto/canvas.ts#canvasConferir": "mesa_foto.leitores_e_conferencias",
  "mesa-foto/clones.ts#cloneConferir": "mesa_foto.leitores_e_conferencias",
  "mesa-foto/clones.ts#cloneVariacoesSugerir": "mesa_foto.diretor_e_variacoes",
  "mesa-foto/clones.ts#lerExpressaoPorVisao": "mesa_foto.leitores_e_conferencias",
  "mesa-foto/index.ts#acervoLerFoto": "mesa_foto.leitores_e_conferencias",
  "mesa-foto/index.ts#ensaioPlanejar": "mesa_foto.diretor_e_variacoes",
  "mesa-foto/index.ts#kitSugerir": "mesa_foto.leitores_e_conferencias",
  "mesa-foto/index.ts#leituraPorVisao": "mesa_foto.leitores_e_conferencias",
  "mesa-foto/index.ts#produtoIdentificar": "mesa_foto.leitores_e_conferencias",
  "mesa-foto/index.ts#variacoesPlanejar": "mesa_foto.diretor_e_variacoes",
  "mesa-foto/index.ts#versaoConferir": "mesa_foto.leitores_e_conferencias",
  "mesa-foto/modelos.ts#modeloConferir": "mesa_foto.leitores_e_conferencias",
  "mesa-foto/modelos.ts#modeloSugerir": "mesa_foto.leitores_e_conferencias",
  "mesa-identidade/completar-acoes.ts#lerLogoComVisao": "leituras",
  "mesa-identidade/naming-v2-acoes.ts#namingIdiomas": "leituras",
  "mesa-motion/index.ts#escreverCena": "motion.cena",
  "mesa-site/index.ts#referenciasLer": "leituras",
  "mesa-videos/diretor.ts#diretorAvaliar": "leituras",
  "perfis-instagram/index.ts#comparar": "leituras",
  "perfis-instagram/index.ts#gerarResumo": "leituras",
  "perfis-instagram/index.ts#lerPostsDoPerfil": "leituras",
  "workspace-organizar/nucleo.ts#lerNoCliente/lerLote": "leituras",
};

/**
 * Cada motor do índice (MOTORES) e quem leva o método por ele: um agente de
 * AGENTES_COM_SUPERPODERES da mesma função ou uma entrada de
 * SEM_METODO_DE_PROPOSITO (revisão de 30/09: antes o teste cobrava só a
 * função, e o "montar contexto" passava pela conversa).
 */
export const METODO_DOS_MOTORES: Record<string, string[]> = {
  "estudio.direcao": ["estudio.direcao", "estudio.conversa"],
  "estudio.legenda": ["estudio.legenda"],
  "calendario.mes": ["calendario.gerar", "calendario.conversa"],
  "calendario.temas": ["calendario.gerar"],
  "calendario.diagnostico": ["calendario.gerar"],
  "calendario.campanha": ["calendario.gerar", "calendario.conversa"],
  "mesa_ads.angulos": ["ads.estrategista", "ads.plano"],
  "mesa_ads.copy": ["ads.estrategista"],
  "mesa_ads.pacote": ["ads.estrategista"],
  "mesa_ads.oferta": ["ads.estrategista", "ads.oferta"],
  "mesa_ads.conta": ["ads.estrategista"],
  "mesa_ads.senior": ["ads.senior"],
  "mesa_foto.agente": ["foto.agente", "foto.campanha"],
  "mesa_foto.diretor": ["mesa_foto.diretor_e_variacoes"],
  contexto: ["contexto.montar", "contexto.conversa"],
  "contexto.plano": ["contexto.plano"],
  "mesa_videos.direcao_de_edicao": ["videos.pacote_de_edicao"],
  "mesa_publicidade.diretor": ["publicidade.diretor"],
  "mesa_publicidade.agente": ["publicidade.agente"],
  "mesa_roteiros.roteirista": ["roteiros.roteirista"],
  "mesa_roteiros.agente": ["roteiros.agente"],
  "estilo.agente": ["estilo.agente"],
  "perfis.plano": ["perfis.plano"],
  // Integração UXM + SPP (30/09): o diretor de site com a base de design é o agente do site, que já leva o método.
  "mesa_site.direcao": ["site.agente"],
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
  // Frente UXM (30/09): o diretor de site recebe o método da base UI UX Pro Max e o bloco BASE DA DIREÇÃO (apelidos b1..bN).
  {
    id: "mesa_site.direcao",
    nome: "Mesa Site: diretor de site (base de design UI UX Pro Max na direção e na revisão)",
    funcao: "mesa-site",
    ligacao: {
      arquivo: "supabase/functions/mesa-site/index.ts",
      trechos: ["const CONHECIMENTO_DA_BASE = conhecimentoDaBaseDeDesign().texto;", "sistema: `${SISTEMA_DO_AGENTE}\\n\\n${CONHECIMENTO_DA_BASE}", "blocoDaBaseDeDesign({ papel: PAPEL, itens: itensDaBase"],
    },
    bases: ["mesa-site: SISTEMA_DO_AGENTE e o contrato comum das ações (acoes-do-site.ts)", "uiux/jev-da-base.ts: o Jev escolhe produto, estilo, padrão, par e preset (perguntasDaBase em mesa-site/base-de-design.ts)"],
    montar: () => conhecimentoDaBaseDeDesign(),
    promete: ["base_de_design"],
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
      trechos: ["await quadrosDasPranchas(t, refsDaEquipe, ordem, versoesDaLamina, avisosDaGeracao)", "prancha: pranchaDaReferencia,", "serieComQuadroDaPrancha({ ordem, total, sequencia: indiceDaSequencia })"],
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
    ligacao: { arquivo: ESTUDIO, trechos: ["const rostoEscolhido = replicar && fotosReplicar.length === 0 ? rostoDaFotoNoReplicar || lerRostoDoTrabalho(t.direcao, t.client_id) : null;", "      blocoDoRostoAqui,"] },
    intocado: "Sem rosto escolhido (o padrão): nada é lido, nenhuma imagem entra e o prompt é byte a byte o de hoje.",
  },
  {
    id: "rosto_v2",
    em: "2026-09-26",
    pedido: "Dono: \"posso buscar qualquer foto que tiver pessoas, abrir a pasta, selecionar qualquer foto e também o clone já gerado; detalhar sorrindo, assim; e com base na foto ele tem que variar e compor com a imagem\".",
    o_que: "Fonte escolhidas (1 a 3 fotos do acervo, Workspace, Arquivos ou de um clone, inclusive as geradas, conferidas na geração), campo como (pose e expressão) no bloco ROSTO ESCOLHIDO, que agora pede recriar a pessoa na composição e integrar na luz da arte. Lâmina normal leva o rosto quando o Noul do Jev diz que a direção pede pessoa (a referência automática cede a vaga). A versão guarda as fotos usadas; conferir_rosto é só aviso.",
    modulo: "estudio-arte/rosto-na-geracao.ts",
    ligacao: { arquivo: ESTUDIO, trechos: ["const rostoNaNormal = rostoDaFotoNaNormal || (!replicar && !ads && !baseFoto && !recorteNaLamina && elementos.length === 0 ? lerRostoDoTrabalho(t.direcao, t.client_id) : null);", "    blocoDoRostoNaNormal,"] },
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
  {
    id: "rosto_identidade",
    em: "2026-09-29",
    pedido: "Dono: \"eu coloco uma imagem do rosto na arte e ele faz exatamente aquela foto, em vez de aproveitar as características do rosto e fazer junto da imagem. Tem que ser feito pelo gerador, e não a mesma pose; tudo tem que fazer sentido com o tema e a composição. Mas tem imagens que eu quero que sejam exatamente elas\".",
    o_que: "Cada foto da lâmina tem um uso: Foto exata (o de sempre, foto intacta e alinhada) ou Usar o rosto (fotos_livres[].uso e uso_do_acervo). No modo rosto a foto não é base nem elemento: vai ao gerador como imagem de identidade (mesmo caminho do rosto escolhido), com o bloco ROSTO ESCOLHIDO mais a frase do dono (mantenha a identidade da pessoa da imagem de referência; crie nova pose e composição conforme a direção; não copie a foto), sem colar o original. A versão guarda rosto.origem foto_da_lamina e a conferência do rosto também avisa pose igual à da foto (leitura por visão e alinhamento em código). Arte rápida ganha o papel Rosto (identidade) e, em Automático, o Jev (Choice com confiança mínima) decide exata ou rosto pelo pedido; a conversa com o diretor troca pelo campo uso_da_foto.",
    modulo: "_shared/uso-da-foto.ts",
    ligacao: {
      arquivo: ESTUDIO,
      trechos: [
        "const acervoComoRosto = !!fotoDoAcervo && usoDoAcervo(card) === \"rosto\";",
        "const rotuloDoRosto = rostoVeioDaFoto ? ROTULO_DA_FOTO_DE_IDENTIDADE : ROTULO_DA_FOTO_DO_ROSTO;",
      ],
    },
    intocado: "Foto sem o campo uso (todas as de hoje): exata, byte a byte o caminho da foto real intacta (alinhamento, recorte das letras, logo). Recorte sem fundo e logo do pedido não têm uso. Sem foto em modo rosto, o rosto escolhido do trabalho segue como na frente R2.",
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

const BLOCO_DO_METODO: Record<IdDoMetodo, string> = {
  entender: "sp_entender",
  plano: "sp_plano",
  prova: "sp_prova",
  causa: "sp_causa",
  receber: "sp_receber",
  revisor: "sp_revisor",
  aceite: "sp_aceite",
  frentes: "sp_frentes",
};

/** Blocos sp_* que um agente pode receber (a abertura sempre). */
export function blocosDoMetodoDoAgente(id: string): string[] {
  const a = SUPERPODERES_DOS_AGENTES.find((x) => x.id === id);
  return a ? ["sp_abertura"].concat(a.metodos.map((m) => BLOCO_DO_METODO[m])) : [];
}

/** Motores alcançados por uma fonte (os do índice e, desde a frente SPP, os agentes com o método da casa). */
export function motoresDaFonte(fonte: string): string[] {
  const doIndice = MOTORES.filter((m) => m.promete.some((b) => (origemDoBloco(b)?.fontes ?? []).includes(fonte))).map((m) => m.id);
  const doMetodo = SUPERPODERES_DOS_AGENTES
    .filter((a) => blocosDoMetodoDoAgente(a.id).some((b) => (origemDoBloco(b)?.fontes ?? []).includes(fonte)))
    .map((a) => `superpoderes.${a.id}`);
  return doIndice.concat(doMetodo);
}
