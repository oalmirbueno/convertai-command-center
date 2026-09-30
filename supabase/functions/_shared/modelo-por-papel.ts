/**
 * O melhor modelo por papel (frente MOD, 30/09/2026).
 *
 * Revisão pedida pelo dono depois dos lançamentos de setembro (Claude Opus 5.5
 * em 22/09, Claude Sonnet 5.5 em 28/09, GPT-6.1 Sol em 29/09). A escolha pesa
 * qualidade (índice de inteligência da Artificial Analysis e o Design Arena,
 * os dois publicados pelo OpenRouter em /api/v1/models) contra o preço por 1M
 * tokens e o volume de cada papel. A tabela com a justificativa está em
 * docs/motores/MODELOS.md.
 *
 * Cada papel tem candidatos em ordem. Vale o primeiro que existe no catálogo,
 * é do tipo do papel, está ligado e o provedor ainda oferece. Nenhum candidato
 * ligado: o papel fica como está (nada é desligado nem ligado por aqui).
 *
 * A migration 20260930220100_modelo_por_papel.sql grava a mesma lista (o
 * teste confere que as duas batem) e a ação recomendar_padroes do ia-gateway
 * aplica de novo quando o dono liga um modelo novo em Modelos de IA.
 *
 * Puro: sem Deno e sem banco.
 */

export const OPUS_55 = "openrouter:anthropic/claude-opus-5.5";
export const SONNET_55 = "openrouter:anthropic/claude-sonnet-5.5";
export const SOL_61 = "openrouter:openai/gpt-6.1-sol";
export const SOL_6 = "openrouter:openai/gpt-6-sol";
export const LUNA_6 = "openrouter:openai/gpt-6-luna";
export const GEMINI_38_FLASH = "openrouter:google/gemini-3.8-flash";
export const DEEPSEEK_41_FLASH = "openrouter:deepseek/deepseek-v4.1-flash";
export const GPT_IMAGE_25 = "openrouter:openai/gpt-image-2.5-sunburst";

// Equivalentes diretos (sem OpenRouter): mesma família, a chave da Anthropic ou da OpenAI.
export const OPUS_55_DIRETO = "anthropic:claude-opus-5-5";
export const SONNET_55_DIRETO = "anthropic:claude-sonnet-5-5";
export const SOL_61_DIRETO = "openai:gpt-6.1-sol";
export const SOL_6_DIRETO = "openai:gpt-6-sol";
export const LUNA_6_DIRETO = "openai:gpt-6-luna";
export const GPT_IMAGE_25_DIRETO = "openai:gpt-image-2.5-sunburst";

export type TipoDoPapel = "texto" | "imagem";

export interface RecomendacaoDoPapel {
  papel: string;
  tipo: TipoDoPapel;
  candidatos: string[];
  /** Por que o primeiro candidato (uma frase, aparece no "?" de Modelos de IA). */
  porque: string;
}

export const RECOMENDACOES_POR_PAPEL: RecomendacaoDoPapel[] = [
  {
    papel: "estrategista",
    tipo: "texto",
    candidatos: [SONNET_55, SOL_61, OPUS_55, SOL_6, SONNET_55_DIRETO, SOL_61_DIRETO, SOL_6_DIRETO],
    porque: "Sonnet 5.5 chega perto do Opus 5.5 (índice 56 contra 57,6) pela metade do preço; o calendário gera muito texto.",
  },
  {
    papel: "diretor_arte",
    tipo: "texto",
    candidatos: [SONNET_55, OPUS_55, SOL_61, SOL_6, SONNET_55_DIRETO, SOL_6_DIRETO],
    porque: "Dirige cada lâmina (muitas chamadas com imagem): Sonnet 5.5 vê bem e custa metade do Opus.",
  },
  {
    papel: "imagem",
    tipo: "imagem",
    candidatos: [GPT_IMAGE_25, GPT_IMAGE_25_DIRETO],
    porque: "GPT Image 2.5 Sunburst segue o gerador mais novo da OpenAI (09/09) e o que respeita texto e referências.",
  },
  {
    papel: "leitura",
    tipo: "texto",
    candidatos: [LUNA_6, GEMINI_38_FLASH, SOL_61, LUNA_6_DIRETO],
    porque: "Ler texto dentro da imagem é tarefa de volume: GPT-6 Luna vê imagem e custa US$ 0,10/0,50 por 1M.",
  },
  {
    papel: "contexto",
    tipo: "texto",
    candidatos: [SONNET_55, SOL_61, SOL_6, LUNA_6, SONNET_55_DIRETO, SOL_6_DIRETO],
    porque: "Monta o contexto que todos os agentes usam: vale o Sonnet 5.5, com 1M de contexto e cache barato.",
  },
  {
    papel: "estrategista_rapido",
    tipo: "texto",
    candidatos: [LUNA_6, GEMINI_38_FLASH, DEEPSEEK_41_FLASH, LUNA_6_DIRETO],
    porque: "Conteúdo rápido: GPT-6 Luna é o mais barato com ferramentas, JSON e visão.",
  },
  {
    papel: "proposta",
    tipo: "texto",
    candidatos: [OPUS_55, SONNET_55, SOL_61, OPUS_55_DIRETO, SONNET_55_DIRETO],
    porque: "Texto que vende e vai para o cliente: Opus 5.5 é o mais forte (índice 57,6); uma proposta sai por centavos.",
  },
  {
    papel: "contrato",
    tipo: "texto",
    candidatos: [OPUS_55, SONNET_55, SOL_61, OPUS_55_DIRETO, SONNET_55_DIRETO],
    porque: "Precisão jurídica: o modelo mais forte, sem economia num documento que se assina.",
  },
  {
    papel: "briefing",
    tipo: "texto",
    candidatos: [SONNET_55, SOL_61, LUNA_6, SONNET_55_DIRETO, LUNA_6_DIRETO],
    porque: "Conversa longa e organização do briefing: Sonnet 5.5 entende bem e custa metade do Opus.",
  },
  {
    papel: "conselho",
    tipo: "texto",
    candidatos: [SOL_61, SONNET_55, SOL_6, LUNA_6, SOL_61_DIRETO, SOL_6_DIRETO],
    porque: "Segunda opinião de outra casa: GPT-6.1 Sol (29/09) pensa diferente dos Claude das outras mesas, pelo mesmo preço do Sonnet.",
  },
  {
    papel: "identidade",
    tipo: "texto",
    candidatos: [OPUS_55, SONNET_55, SOL_61, OPUS_55_DIRETO],
    porque: "Pensar marca e manual: Opus 5.5 lidera o Design Arena (SVG e componentes).",
  },
  {
    papel: "naming",
    tipo: "texto",
    candidatos: [OPUS_55, SONNET_55, SOL_61, OPUS_55_DIRETO],
    porque: "Poucos tokens e muita criatividade: o melhor modelo custa quase nada aqui.",
  },
  {
    papel: "site",
    tipo: "texto",
    candidatos: [OPUS_55, SONNET_55, SOL_61, OPUS_55_DIRETO, SONNET_55_DIRETO],
    porque: "Código de site: Opus 5.5 é 1º em componentes e 2º em sites no Design Arena.",
  },
  {
    papel: "motion",
    tipo: "texto",
    candidatos: [OPUS_55, SONNET_55, SOL_61, OPUS_55_DIRETO, SONNET_55_DIRETO],
    porque: "Código de motion (Remotion e HyperFrames): o mais forte em código visual.",
  },
  {
    papel: "documento",
    tipo: "texto",
    candidatos: [SONNET_55, OPUS_55, SOL_61, SONNET_55_DIRETO, OPUS_55_DIRETO],
    porque: "Documentos da agência: Sonnet 5.5 escreve muito bem pela metade do preço do Opus.",
  },
];

export type LinhaParaRecomendar = {
  id: string;
  tipo: string;
  ativo: boolean;
  disponivel?: boolean | null;
  padrao_para?: string[] | null;
};

/** O modelo recomendado de um papel entre os que existem e estão ligados (null = nenhum). */
export function recomendadoDoPapel(catalogo: LinhaParaRecomendar[], papel: string): string | null {
  const r = RECOMENDACOES_POR_PAPEL.find((x) => x.papel === papel);
  if (!r) return null;
  for (const id of r.candidatos) {
    const m = catalogo.find((x) => x.id === id);
    if (m && m.ativo && m.disponivel !== false && m.tipo === r.tipo) return m.id;
  }
  return null;
}

/** O primeiro candidato do papel, ligado ou não (para a tela mostrar "ligue para usar"). */
export function melhorDoPapel(papel: string): string | null {
  const r = RECOMENDACOES_POR_PAPEL.find((x) => x.papel === papel);
  return r ? r.candidatos[0] : null;
}

export interface MudancaDePadrao {
  papel: string;
  de: string | null;
  para: string;
}

/**
 * O que muda se a recomendação for aplicada: só papéis cujo recomendado ligado
 * é diferente do padrão atual. Papel sem candidato ligado não entra.
 */
export function mudancasDaRecomendacao(catalogo: LinhaParaRecomendar[]): MudancaDePadrao[] {
  const mudancas: MudancaDePadrao[] = [];
  for (const r of RECOMENDACOES_POR_PAPEL) {
    const para = recomendadoDoPapel(catalogo, r.papel);
    if (!para) continue;
    const atual = catalogo.find((m) => (m.padrao_para || []).indexOf(r.papel) >= 0) || null;
    if (atual && atual.id === para) continue;
    mudancas.push({ papel: r.papel, de: atual ? atual.id : null, para });
  }
  return mudancas;
}

/** padrao_para de cada modelo depois de aplicar as mudanças (cada papel num modelo só). */
export function aplicarMudancas(catalogo: LinhaParaRecomendar[], mudancas: MudancaDePadrao[]): Record<string, string[]> {
  const novo: Record<string, string[]> = {};
  const tocados = new Set<string>();
  for (const m of catalogo) novo[m.id] = (m.padrao_para || []).slice();
  for (const mu of mudancas) {
    for (const id of Object.keys(novo)) {
      if (novo[id].indexOf(mu.papel) >= 0 && id !== mu.para) {
        novo[id] = novo[id].filter((p) => p !== mu.papel);
        tocados.add(id);
      }
    }
    if (!novo[mu.para]) novo[mu.para] = [];
    if (novo[mu.para].indexOf(mu.papel) < 0) {
      novo[mu.para] = novo[mu.para].concat([mu.papel]);
      tocados.add(mu.para);
    }
  }
  const saida: Record<string, string[]> = {};
  tocados.forEach((id) => { saida[id] = novo[id]; });
  return saida;
}
