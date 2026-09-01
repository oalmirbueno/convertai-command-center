/**
 * O que o agente escreveu, dito em português.
 *
 * A queixa foi direta: "está muito técnico, não dá pra entender nada, só
 * fala parece por código". E é verdade — o painel mostrava, literalmente:
 *
 *   "Evidência verificável: tarefa 9623ab68-cf83-4e1c-af44-edbb62533121
 *    foi lida via aceleriq_fetch (status backlog, prioridade high, prazo
 *    2026-07-20, assigned_to null). O vínculo 60820..."
 *
 * Isso é um log de máquina colado numa tela de gente. Quem lê não tem como
 * agir: o identificador não diz nada, o nome da ferramenta é vocabulário
 * interno, e "assigned_to null" é uma coluna de banco, não uma frase.
 *
 * A tradução aqui é DESCARTÁVEL, nunca destrutiva: o texto original
 * continua guardado e visível num toque. Apagar evidência para deixar a
 * tela bonita seria trocar um problema por outro pior — a evidência é o
 * que sustenta a entrega.
 */

/** Identificador de máquina: 8-4-4-4-12 hexadecimais. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Nome de ferramenta interna: aceleriq_fetch, operator_report_event... */
const PREFIXOS_DE_FERRAMENTA = "aceleriq|operator|memory|social|editorial|ads";
// Aspas duplas, e nao template literal: dentro de crase o "\b" vira o
// caractere BACKSPACE, e a expressao deixa de casar com qualquer coisa.
const FERRAMENTA = new RegExp(
  "\\b(?:" + PREFIXOS_DE_FERRAMENTA + ")_[a-z_]+\\b", "gi",
);

/**
 * "lida via aceleriq_fetch" - a preposicao sai JUNTO com a ferramenta.
 *
 * Remove-las em dois passos deixava um "via" orfao no meio da frase, que e
 * pior que o nome tecnico: pelo menos o nome tecnico era uma palavra.
 */
const VIA_FERRAMENTA = new RegExp(
  "\\s*\\b(?:via|por|pelo|pela|com|usando)\\s+(?:"
    + PREFIXOS_DE_FERRAMENTA + ")_[a-z_]+\\b",
  "gi",
);

/**
 * Coluna de banco → frase. Só entram termos que aparecem de verdade no
 * texto dos agentes; inventar um dicionário grande criaria traduções
 * erradas para casos que ninguém viu.
 */
const DICIONARIO: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bassigned_to\s*[:=]?\s*null\b/gi, "sem responsável"],
  [/\bassigned_to\b/gi, "responsável"],
  [/\bstatus\s+backlog\b/gi, "ainda na fila"],
  [/\bstatus\s+in_progress\b/gi, "em andamento"],
  [/\bstatus\s+done\b/gi, "concluída"],
  [/\bprioridade\s+high\b/gi, "prioridade alta"],
  [/\bprioridade\s+medium\b/gi, "prioridade média"],
  [/\bprioridade\s+low\b/gi, "prioridade baixa"],
  [/\bkanban_task_id\b/gi, "tarefa"],
  [/\bpainel_task_id\b/gi, "tarefa"],
  [/\btask_link_id\b/gi, "vínculo"],
  [/\brun_key\b/gi, "execução"],
  [/\bclient_id\b/gi, "cliente"],
  [/\bnull\b/gi, "nada"],
];

/** Prefixos cerimoniais que não acrescentam nada a quem lê. */
const PREFIXOS = [
  /^evid[êe]ncia\s+verific[áa]vel\s*:\s*/i,
  /^evid[êe]ncia\s*:\s*/i,
  /^resultado\s*:\s*/i,
];

export interface TextoTraduzido {
  /** A frase para ler. */
  humano: string;
  /** O original, palavra por palavra. Nunca se perde. */
  original: string;
  /** Se sobrou algo técnico que valha esconder atrás de um toque. */
  temDetalheTecnico: boolean;
}

/**
 * Traduz um texto de agente para leitura humana.
 *
 * Não tenta reescrever a frase: só remove o que é endereço de máquina e
 * troca nome de coluna por palavra. Reescrever de verdade exigiria
 * entender o conteúdo, e um resumo errado de uma evidência é pior que uma
 * evidência feia.
 */
export function falarComoGente(bruto?: string | null): TextoTraduzido {
  const original = String(bruto ?? "").trim();
  if (!original) {
    return { humano: "", original: "", temDetalheTecnico: false };
  }

  // Link continua link: é a evidência mais forte que existe e não se toca.
  if (/^https?:\/\//i.test(original)) {
    return { humano: original, original, temDetalheTecnico: false };
  }

  const tinhaUuid = UUID.test(original);
  UUID.lastIndex = 0;
  const tinhaFerramenta = FERRAMENTA.test(original);
  FERRAMENTA.lastIndex = 0;

  let texto = original;
  for (const p of PREFIXOS) texto = texto.replace(p, "");

  // O identificador some sem deixar buraco na frase: "a tarefa <uuid> foi
  // lida" vira "a tarefa foi lida".
  texto = texto.replace(UUID, "").replace(/\s{2,}/g, " ");

  // "lida via aceleriq_fetch" vira "lida" — o nome da ferramenta é
  // vocabulário interno e não muda o que aconteceu.
  texto = texto.replace(VIA_FERRAMENTA, "");
  VIA_FERRAMENTA.lastIndex = 0;
  FERRAMENTA.lastIndex = 0;
  texto = texto.replace(FERRAMENTA, "");
  FERRAMENTA.lastIndex = 0;

  for (const [de, para] of DICIONARIO) texto = texto.replace(de, para);

  // Sobras de pontuação: "( , prioridade alta)" vira "(prioridade alta)".
  texto = texto
    .replace(/\(\s*[,;]\s*/g, "(")
    .replace(/\s*[,;]\s*\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Frase que começava com o identificador pode ter ficado com minúscula
  // solta ou espaço na frente.
  texto = texto.replace(/^[,;.\s]+/, "");
  if (texto) texto = texto[0].toUpperCase() + texto.slice(1);

  return {
    humano: texto || original,
    original,
    temDetalheTecnico: tinhaUuid || tinhaFerramenta || texto !== original,
  };
}

/** Rótulo de estado em frase, para o cartão não mostrar o valor cru. */
export const ESTADO_EM_PALAVRAS: Record<string, string> = {
  queued: "na fila",
  in_progress: "trabalhando agora",
  review: "esperando revisão",
  awaiting_input: "esperando algo seu",
  blocked: "travado",
  done: "entregue",
};
