/**
 * Conferência da série da campanha pelo Jev (21/10/2026, Campanhas › Revisão e agenda).
 *
 * Dois julgamentos sobre o MESMO estado (a campanha com o briefing e a série), numa chamada só:
 * - por peça, um Score: o quanto a peça serve ao briefing (produto em foco, oferta, mensagem central e
 *   público). Vira um selo na tela (forte, ok, fraca): aviso para a equipe, nunca reescrita (regra "sem
 *   laço de correção");
 * - um Choice: qual gancho abre melhor a campanha (ou nenhum serve), para a equipe pôr na capa da série.
 *
 * Puro (sem Deno nem npm): a função e os testes leem o mesmo arquivo.
 */

export interface PecaParaConferir {
  tema_id: string;
  data?: string;
  etapa?: string;
  formato?: string;
  tema?: string;
  gancho?: string;
  laminas?: string[];
  cta?: string;
}

export interface CampanhaParaConferir {
  nome: string;
  objetivo?: string | null;
  conceito?: string | null;
  briefing: Record<string, unknown>;
}

/** Máximo de peças conferidas numa chamada (a série tem até 12). */
export const MAX_PECAS_CONFERIDAS = 12;

const NIVEIS = [
  "A peça não tem relação com o briefing: fala de outro produto ou outro assunto, ignora a oferta e a mensagem central.",
  "A peça toca no tema da campanha, mas genérica: não mostra o produto em foco nem a oferta e serviria para qualquer marca.",
  "A peça serve à campanha: cita o produto ou a oferta e conversa com o público, mas a mensagem central fica fraca ou diluída.",
  "A peça é a campanha: mostra o produto em foco, sustenta a oferta e a mensagem central do briefing e fala direto com o público descrito.",
];

export function perguntasDaConferencia(campanha: CampanhaParaConferir, pecas: PecaParaConferir[]) {
  const lista = pecas.slice(0, MAX_PECAS_CONFERIDAS);
  const questions: Record<string, unknown> = {};
  lista.forEach((p, i) => {
    questions[`peca_${i}`] = {
      type: "score",
      instructions: `Avalie a peça \`serie[${i}]\` contra o briefing da campanha em \`campanha.briefing\`: ela mostra o produto em foco, sustenta a oferta e a mensagem central e fala com o público descrito? Julgue só esta peça, pelo gancho, pelas lâminas e pelo CTA.`,
      criteria: NIVEIS,
    };
  });
  const opcoes: Record<string, string> = {};
  lista.forEach((p, i) => {
    if (p.gancho) opcoes[`p${i}`] = `O gancho da peça \`serie[${i}]\`: "${p.gancho}"`;
  });
  if (Object.keys(opcoes).length >= 1) {
    opcoes.nenhum = "Nenhum desses ganchos para o público da campanha: todos são genéricos ou fogem da oferta.";
    questions.melhor_gancho = {
      type: "choice",
      instructions:
        "Qual destes ganchos mais faria o público descrito em `campanha.briefing.publico` parar de rolar e querer saber da oferta, abrindo bem a campanha? Considere clareza, curiosidade e ligação com a oferta.",
      criteria: opcoes,
    };
  }
  return {
    state: {
      campanha: { nome: campanha.nome, objetivo: campanha.objetivo || "", conceito: campanha.conceito || "", briefing: campanha.briefing },
      serie: lista.map((p) => ({ fase: p.etapa || "", data: p.data || "", formato: p.formato || "", titulo: p.tema || "", gancho: p.gancho || "", laminas: (p.laminas || []).slice(0, 10), cta: p.cta || "" })),
    },
    questions,
    pecas: lista,
  };
}

export type NivelDaPeca = "forte" | "ok" | "fraca";

/** Nota de 0 a 1 (score / 3) e o nível: abaixo de 0,5 fraca; de 0,8 para cima forte. */
export function nivelDaNota(nota: number | null): NivelDaPeca | null {
  if (nota === null) return null;
  if (nota >= 0.8) return "forte";
  if (nota >= 0.5) return "ok";
  return "fraca";
}

export function lerConferencia(
  answers: Record<string, { score?: number; confidence?: number; choice?: string }>,
  pecas: PecaParaConferir[],
): { pecas: { tema_id: string; nota: number | null; nivel: NivelDaPeca | null; confianca: number | null }[]; melhor_gancho: string | null; confianca_do_gancho: number | null } {
  const saida = pecas.map((p, i) => {
    const r = answers[`peca_${i}`];
    const nota = r && typeof r.score === "number" && isFinite(r.score) ? Math.max(0, Math.min(1, r.score / (NIVEIS.length - 1))) : null;
    return {
      tema_id: p.tema_id,
      nota: nota === null ? null : Math.round(nota * 100) / 100,
      nivel: nivelDaNota(nota),
      confianca: r && typeof r.confidence === "number" ? r.confidence : null,
    };
  });
  const g = answers.melhor_gancho;
  const escolha = g && typeof g.choice === "string" ? g.choice : "";
  const i = escolha.indexOf("p") === 0 ? Number(escolha.slice(1)) : -1;
  return {
    pecas: saida,
    melhor_gancho: i >= 0 && pecas[i] ? pecas[i].tema_id : null,
    confianca_do_gancho: g && typeof g.confidence === "number" ? g.confidence : null,
  };
}
