/**
 * Roteiro da peça de vídeo com a pegada viral (frente B, 23/10/2026). O dono: "no Gravar eu pego o roteiro
 * certinho do assunto e do tema e posso baixar; ele já gera com o motor de roteiro. E tem o agente de roteiro
 * para eu editar, melhorar, dar ideias; ele faz as coisas de fato e altera conforme eu peço".
 *
 * Aqui mora só o que é puro (sem Deno, sem banco), para a função e o vitest lerem o mesmo arquivo:
 * - Gravar (ação peca_gerar): o roteirista da casa escreve DUAS versões numa chamada, com os ganchos
 *   vencedores do nicho (motor de copy viral, formato reels_abertura); o Jev dá as 5 notas virais por versão
 *   (gancho, clareza, nicho, utilidade, compartilhar) e a mais forte fica como versão atual. A outra fica
 *   no histórico de versões. Sem laço de correção: gera 2, o Jev escolhe, acabou.
 * - Gerar (ação peca_cenas_gerar): o roteiro de cenas da IA de vídeo (gancho, cenas, trilha e CTA) também
 *   em duas versões com os ganchos virais, e a mesma escolha do Jev.
 * - Agente (operação reescrever_roteiro): o pedido da equipe ("encurta o gancho", "troca a cena 2", "deixa
 *   mais engraçado", "faz versão de 15 s") vira o roteiro reescrito como versão nova, com Desfazer.
 * Sem lookbehind, sem classe Unicode e sem grupo nomeado. Sem travessão.
 */

import { ESQUEMA_DO_ROTEIRO, type Roteiro } from "../../_shared/roteiro-modelo.ts";
import { ESQUEMA_DO_ROTEIRO_DE_VIDEO, type RoteiroDeVideo } from "../../agente-calendario/modulos/roteiro-de-video.ts";
import { type NotaViral, porqueViral } from "../../estudio-arte/modulos/copy-viral.ts";

// ------------------------------------------------------------------ custo (a mesma conta na tela e no estimar)

/** Duas versões completas numa chamada (com os ganchos do nicho e a base no prompt). */
export const TAMANHO_DAS_DUAS_VERSOES = { entrada: 18_000, saida: 9_000 };
/** Duas versões do roteiro de cenas (Gerar). */
export const TAMANHO_DAS_CENAS = { entrada: 14_000, saida: 3_500 };
/** O roteiro reescrito pelo pedido ao agente (uma versão). */
export const TAMANHO_DA_REESCRITA = { entrada: 12_000, saida: 5_000 };
/** Quantas perguntas ao Jev cada geração faz (base, notas virais e o aviso de retenção). */
export const CONFERENCIAS_DO_JEV_DA_PECA = 3;

// ------------------------------------------------------------------ o que vai ao modelo

export const INSTRUCAO_DAS_DUAS_VERSOES = [
  "Escreva DUAS versões completas do roteiro desta peça, cada uma com o esquema inteiro (ganchos, blocos, direção, CTA, legenda).",
  "As duas usam GANCHOS DE FÓRMULAS DIFERENTES, tiradas dos ganchos vencedores do nicho (ex.: uma de erro, outra de curiosidade); formula_do_gancho diz qual fórmula a versão usou.",
  "O primeiro bloco fala o gancho escolhido nos 3 primeiros segundos, com imagem e fala juntas. Nunca copie a frase de exemplo; use a fórmula com o assunto e as palavras do público.",
  "O Jev escolhe a mais forte; não existe segunda rodada.",
].join(" ");

const comFormula = (schema: unknown) => {
  const s = schema as { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
  return {
    type: "object",
    properties: { ...s.properties, formula_do_gancho: { type: "string" } },
    required: s.required.concat(["formula_do_gancho"]),
    additionalProperties: false,
  };
};

/** Duas versões do roteiro para gravar (o esquema do roteirista mais a fórmula do gancho). */
export const ESQUEMA_DAS_DUAS_VERSOES = {
  nome: "roteiro_da_peca_em_duas_versoes",
  schema: {
    type: "object",
    properties: { versoes: { type: "array", items: comFormula(ESQUEMA_DO_ROTEIRO.schema) } },
    required: ["versoes"],
    additionalProperties: false,
  },
};

/** Duas versões do roteiro de cenas da IA de vídeo (o esquema da campanha mais a fórmula do gancho). */
export const ESQUEMA_DAS_CENAS_VIRAIS = {
  nome: "cenas_da_peca_em_duas_versoes",
  schema: {
    type: "object",
    properties: { versoes: { type: "array", items: comFormula(ESQUEMA_DO_ROTEIRO_DE_VIDEO.schema) } },
    required: ["versoes"],
    additionalProperties: false,
  },
};

/** O pedido das cenas (Gerar): a peça, a fase e a trilha da campanha. */
export function instrucaoDasCenas(p: { trilha: string | null; duracaoS: number }): string {
  return [
    "TAREFA: o roteiro de cenas deste Reels 9:16, que a IA de vídeo vai gerar cena a cena (sem pessoa real falando para a câmera).",
    "Escreva DUAS versões com GANCHOS DE FÓRMULAS DIFERENTES, tiradas dos ganchos vencedores do nicho; formula_do_gancho diz qual. O Jev escolhe a mais forte.",
    "gancho: o que prende nos 2 primeiros segundos (a primeira cena mostra e diz o gancho). cenas: de 3 a 6, cada uma com descricao (o que aparece, com plano e movimento, filmável por IA), fala (narração exata ou vazia), texto_na_tela (até 6 palavras ou vazio) e segundos.",
    `Total perto de ${p.duracaoS} segundos (cerca de 2,5 palavras por segundo de fala). cta: a ação direta da fase.`,
    p.trilha ? `trilha: ${p.trilha} (já escolhida na campanha).` : "trilha: o clima da trilha em poucas palavras.",
    "Nada de promessa, número, preço ou depoimento que não esteja nos DADOS. Sem travessão.",
  ].join("\n");
}

// ------------------------------------------------------------------ as versões que voltam

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** As versões brutas da saída (até 2), cada uma com a fórmula do gancho. */
export function versoesDaSaida(json: unknown): Array<{ bruto: Record<string, unknown>; formula: string }> {
  const lista = obj(json).versoes;
  return (Array.isArray(lista) ? lista : []).slice(0, 2).map((v) => {
    const o = obj(v);
    return { bruto: o, formula: umaLinha(o.formula_do_gancho, 80) };
  });
}

/** O que a pessoa ouve e lê no vídeo (gancho escolhido, falas, texto na tela e CTA), para o Jev. */
export function falaDoRoteiro(r: Roteiro): string {
  const g = r.ganchos[r.gancho_escolhido];
  return [
    g ? `Gancho: ${g.texto}` : "",
    ...r.blocos.map((b, i) => `${i + 1}. ${b.funcao}: ${b.fala}${b.texto_na_tela ? ` [tela: ${b.texto_na_tela}]` : ""}`),
    r.cta ? `CTA: ${r.cta}` : "",
  ].filter(Boolean).join("\n").slice(0, 3000);
}

/** O mesmo para o roteiro de cenas (Gerar). */
export function falaDasCenas(r: RoteiroDeVideo): string {
  return [
    r.gancho ? `Gancho: ${r.gancho}` : "",
    ...r.cenas.map((c) => `${c.ordem}. ${c.descricao}${c.fala ? ` | fala: ${c.fala}` : ""}${c.texto_na_tela ? ` [tela: ${c.texto_na_tela}]` : ""}`),
    r.cta ? `CTA: ${r.cta}` : "",
  ].filter(Boolean).join("\n").slice(0, 3000);
}

/** O estado do Jev para as 5 notas virais (o mesmo formato da conferência do motor de copy: copies.c0, c1). */
export function estadoDaEscolhaViral(textos: string[], ctx: { nicho: string; publico: string | null }) {
  const copies: Record<string, string> = {};
  textos.forEach((t, i) => {
    copies[`c${i}`] = t;
  });
  return { copies, nicho: ctx.nicho || "negócio local", publico: ctx.publico || "o público da marca" };
}

export type EscolhaDaPeca = {
  indice: number;
  como: "jev" | "regra" | "unica";
  notas: NotaViral[];
  formulas: string[];
  porque: string;
};

const virgula = (n: number) => String(n).replace(".", ",");

/**
 * A versão que fica: sem aviso da conferência da casa (clichê de IA, promessa) antes; depois a maior nota
 * viral; empate fica com a versão 1. Sem as notas do Jev: a primeira sem aviso (ou a 1), pela regra.
 */
export function escolherPelaViralidade(notas: NotaViral[], alertas: boolean[], formulas: string[] = []): EscolhaDaPeca {
  const n = Math.max(notas.length, alertas.length);
  if (n < 2) return { indice: 0, como: "unica", notas, formulas, porque: "Só uma versão voltou do modelo." };
  const comNota = notas.every((x) => x && x.nota != null);
  if (!comNota) {
    const limpa = alertas.indexOf(false);
    const i = limpa >= 0 ? limpa : 0;
    return { indice: i, como: "regra", notas, formulas, porque: `O Jev não respondeu: ficou a versão ${i + 1} pela conferência da casa.` };
  }
  const ordem = notas
    .map((x, i) => ({ i, nota: x.nota as number, alerta: !!alertas[i] }))
    .sort((a, b) => Number(a.alerta) - Number(b.alerta) || b.nota - a.nota || a.i - b.i);
  const melhor = ordem[0];
  const outra = ordem[1];
  const formula = formulas[melhor.i] ? ` (gancho de ${formulas[melhor.i]})` : "";
  const porque = `Versão ${melhor.i + 1}${formula}, viral ${virgula(melhor.nota)} contra ${virgula(outra.nota)}.` + (outra.alerta && !melhor.alerta && outra.nota > melhor.nota ? " A outra tinha aviso da conferência da casa." : "") + (porqueViral(notas[melhor.i]) ? ` ${porqueViral(notas[melhor.i])}` : "");
  return { indice: melhor.i, como: "jev", notas, formulas, porque };
}

// ------------------------------------------------------------------ o pedido ao agente (reescrever_roteiro)

/**
 * A duração pedida em palavras ("versão de 15 s", "30 segundos", "1 minuto", "1min30"). null: o pedido não
 * fala de duração (o roteiro mantém a dele). Fica entre 10 e 300 s, como o gerar.
 */
export function duracaoDoPedido(texto: unknown): number | null {
  const t = String(texto == null ? "" : texto).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const minSeg = /\b(\d{1,2})\s*(?:min|minutos?)\s*(?:e\s*)?(\d{1,2})\s*(?:s|seg|segundos?)?\b/.exec(t);
  const min = /\b(\d{1,2})\s*(?:min|minutos?)\b/.exec(t);
  const seg = /\b(\d{1,3})\s*(?:s|seg|segs|segundos?)\b/.exec(t);
  let total: number | null = null;
  if (minSeg) total = Number(minSeg[1]) * 60 + Number(minSeg[2]);
  else if (min) total = Number(min[1]) * 60;
  else if (seg) total = Number(seg[1]);
  if (total == null || !isFinite(total) || total <= 0) return null;
  return Math.max(10, Math.min(300, Math.round(total)));
}

/** O pedido limpo para o cartão e para o roteirista (uma frase, até 400 caracteres). */
export function pedidoDaReescrita(bruto: unknown): string | null {
  const s = umaLinha(bruto, 400);
  return s.replace(/\s/g, "").length >= 3 ? s : null;
}

/** A instrução ao roteirista: reescrever o roteiro atual pelo pedido, mudando só o que o pedido pede. */
export function instrucaoDaReescrita(pedido: string, duracaoS: number | null): string {
  return [
    `Reescreva o roteiro_atual pelo PEDIDO DA EQUIPE: "${pedido}".`,
    "Mude o que o pedido pede (um bloco, o gancho, o tom, o tamanho, uma cena) e preserve o resto: fatos, base, ordem das funções que não foram citadas, CTA e pendências.",
    "\"Cena 2\" ou \"bloco 2\" é o segundo item de blocos. Gancho novo segue uma das fórmulas dos ganchos vencedores do nicho e o primeiro bloco fala esse gancho.",
    duracaoS
      ? `Duração nova: ${duracaoS} segundos. A soma dos segundos dos blocos fica perto disso (cerca de 2,5 palavras por segundo de fala): corte ou junte blocos, nunca acelere a fala.`
      : "Mantenha a duração do roteiro atual, a não ser que o pedido diga outra.",
    "Responda com o roteiro completo no esquema.",
  ].join("\n");
}

/** O roteiro reescrito com o que não pode mudar por conta do modelo (título, tipo, base) e a duração pedida. */
export function roteiroReescrito(novo: Roteiro, atual: Roteiro, duracaoS: number | null): Roteiro {
  return {
    ...novo,
    titulo: atual.titulo || novo.titulo,
    tipo: atual.tipo,
    duracao_alvo_s: duracaoS || atual.duracao_alvo_s,
    ...(atual.base ? { base: atual.base } : {}),
  };
}

// ------------------------------------------------------------------ o agente ao lado do roteiro da peça

/** O que o agente da Mesa Roteiros ganha quando está ao lado do roteiro da peça (escopo "peca"). */
export const SISTEMA_DO_AGENTE_DA_PECA = `MODO PEÇA DE VÍDEO: você está ao lado do roteiro aberto (r1) na peça de vídeo, com a equipe que vai gravar.
- Pedido de mudança no roteiro ("encurta o gancho", "troca a cena 2", "deixa mais engraçado", "faz versão de 15 s", "corta o CTA") vira UMA ação reescrever_roteiro em r1, com para = o pedido em uma frase (cena 2 = segundo bloco; duração em segundos quando houver). Trocar só título, CTA ou legenda por um texto que a equipe ditou pode ser editar_texto.
- Pedido de ideia ou opinião ("me dá ideias", "o que melhora?") é resposta: até 3 ideias concretas para ESTE roteiro, cada uma em uma frase, e a sugestão de pedido pronto para virar ação. Sem ação.
- Fale do roteiro r1 pelo que está em roteiro_aberto_na_tela (blocos numerados a partir de 1). Não proponha ação em outro roteiro nem em peça da agenda, a não ser que a equipe peça pelo nome.`;
