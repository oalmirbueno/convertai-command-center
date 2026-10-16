/**
 * O que o dono quis dizer no diário da execução (16/10/2026, dono: "quando escrever algo, a gente
 * já tem que entender... já tem que ser inteligente para ler"; "não tem algo tipo concluir, aprovar
 * ou não aprovar").
 *
 * Uma pergunta Choice do Jev escolhe o tipo da fala. O código decide o que fazer com isso:
 * - o tipo vira o `entry_type` do diário (o agente trata instrução diferente de comentário);
 * - aprovação e reprovação NUNCA agem sozinhas: a tela só oferece o botão da ação;
 * - certeza baixa (ou "outro") fica como comentário, que não manda o agente fazer nada.
 * Sem o Jev, um palpite por palavras faz o mesmo papel, e a tela diz que é palpite.
 */

import type { PerguntaChoice, RespostaJev } from "../../_shared/jev.ts";

export const TIPOS_DA_FALA = ["comentario", "instrucao", "correcao", "decisao", "resposta_insumo", "pedido_revisao", "aprovacao", "rejeicao", "outro"] as const;
export type TipoDaFala = (typeof TIPOS_DA_FALA)[number];

export type ContextoDaFala = { tarefa?: string | null; situacao?: string | null; ultimaDoAgente?: string | null };

export type LeituraDaFala = {
  /** O entry_type que vai para o diário (nunca "outro"). */
  tipo: Exclude<TipoDaFala, "outro">;
  confianca: number;
  /** Botão que a tela oferece; nunca é executado sem o clique. */
  acao: "aprovar" | "reprovar" | null;
  fonte: "jev" | "palpite";
};

/** Abaixo disso o tipo escolhido vira comentário (conversa, sem ordem ao agente). */
export const CERTEZA_MINIMA = 0.45;
/** Aprovar ou reprovar só aparece como botão com certeza boa. */
export const CERTEZA_DA_ACAO = 0.6;

export function perguntaDaFala(fala: string, c: ContextoDaFala = {}): { state: Record<string, unknown>; questions: Record<string, PerguntaChoice> } {
  return {
    state: {
      fala: fala.slice(0, 4000),
      tarefa: c.tarefa ? String(c.tarefa).slice(0, 300) : null,
      situacao_da_tarefa: c.situacao || null,
      ultima_mensagem_do_agente: c.ultimaDoAgente ? String(c.ultimaDoAgente).slice(0, 1500) : null,
    },
    questions: {
      tipo: {
        type: "choice",
        instructions: "`fala` é o que o dono da agência escreveu no diário de uma tarefa que um agente de IA está executando. `situacao_da_tarefa` e `ultima_mensagem_do_agente` dão o contexto. Qual é a intenção principal da fala?",
        criteria: {
          comentario: { what: "Observação, opinião, elogio ou conversa que não pede ação nova.", not_for: "Pedidos de fazer, ajustar, parar ou corrigir algo." },
          instrucao: { what: "Pede que o agente faça, ajuste, mude, priorize ou pare algo daqui em diante.", examples: ["faz três versões do carrossel", "prioriza o post de sexta", "para de mexer nas campanhas"] },
          correcao: { what: "Aponta erro em algo que o agente já fez e diz o que está errado ou como corrigir.", examples: ["o preço está errado, é 49,90", "esse logo não é o da marca"] },
          decisao: { what: "Escolhe entre opções ou define um rumo que estava em aberto, sem aprovar a entrega final.", examples: ["vamos com a opção B", "o público é mulheres de 30 a 45"] },
          resposta_insumo: { what: "Entrega o que o agente pediu: dado, acesso, arquivo, link, confirmação ou resposta a uma pergunta dele.", examples: ["o horário é das 11h às 23h", "segue o link da pasta", "sim, pode usar essa foto"] },
          pedido_revisao: { what: "Pede para alguém revisar, conferir ou validar antes de seguir.", examples: ["confere os números antes de mandar", "pede para a Isabella olhar"] },
          aprovacao: { what: "Aprova o resultado entregue e quer dar a tarefa por concluída.", examples: ["aprovado", "ficou ótimo, pode concluir", "ok, pode publicar"], not_for: "Elogio parcial com pedido de ajuste (isso é instrução ou correção)." },
          rejeicao: { what: "Reprova o resultado entregue como um todo e devolve para refazer.", examples: ["reprovado, refaz", "não serve, começa de novo"] },
          outro: "Nenhuma das anteriores ou texto sem sentido claro.",
        },
      },
    },
  };
}

export function leituraDaFala(r: RespostaJev | undefined): LeituraDaFala {
  const escolha = (TIPOS_DA_FALA as readonly string[]).includes(String(r?.choice)) ? (r!.choice as TipoDaFala) : "outro";
  const confianca = Number.isFinite(Number(r?.confidence)) ? Number(r!.confidence) : 0;
  const prob = Number(r?.probabilities?.[escolha] ?? confianca) || 0;
  if (escolha === "outro" || prob < CERTEZA_MINIMA) return { tipo: "comentario", confianca: prob, acao: null, fonte: "jev" };
  const acao = escolha === "aprovacao" && prob >= CERTEZA_DA_ACAO ? "aprovar" : escolha === "rejeicao" && prob >= CERTEZA_DA_ACAO ? "reprovar" : null;
  return { tipo: escolha, confianca: prob, acao, fonte: "jev" };
}

/** Sem o Jev: palpite por palavras. Nunca oferece aprovar/reprovar (a ação pede certeza). */
export function palpiteDaFala(fala: string): LeituraDaFala {
  const t = fala.toLowerCase();
  const tem = (re: RegExp) => re.test(t);
  const tipo: LeituraDaFala["tipo"] = tem(/\b(errad[oa]|corrig|não é|nao e|trocar? (o|a)|está errad)/) ? "correcao"
    : tem(/\b(confer[ei]|revis[ae]|valid[ae])\b/) ? "pedido_revisao"
    : tem(/\b(vamos com|fica (a|o)|decid|escolh|opção|opcao)\b/) ? "decisao"
    : tem(/^(faz|faça|fazer|cria|crie|muda|mude|ajusta|ajuste|prioriz|para de|pare|envia|mande|manda|publica|agenda)\b|\b(precisa|tem que|quero que|pode fazer)\b/) ? "instrucao"
    : tem(/\b(segue|aqui está|o link|a senha não|o horário|o horario|sim, pode|pode usar)\b/) ? "resposta_insumo"
    : "comentario";
  return { tipo, confianca: 0, acao: null, fonte: "palpite" };
}
