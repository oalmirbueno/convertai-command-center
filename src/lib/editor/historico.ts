import type { ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Desfazer e refazer do editor (frente V-B). Guarda projetos inteiros (são
 * pequenos e imutáveis). Cada passo tem um rótulo curto para a tela ("Dividir
 * c3", "Cortar silêncios"). Uma skill aplicada é UM passo: um Ctrl+Z desfaz a
 * skill inteira.
 */

export const LIMITE_DO_HISTORICO = 100;

export interface Passo {
  projeto: ProjetoDeEdicao;
  rotulo: string;
}

export interface Historico {
  passado: Passo[];
  presente: Passo;
  futuro: Passo[];
}

export const comecarHistorico = (projeto: ProjetoDeEdicao, rotulo = "Abrir"): Historico => ({ passado: [], presente: { projeto, rotulo }, futuro: [] });

/** Novo passo. Projeto igual (mesmo objeto) não entra. */
export function fazer(h: Historico, projeto: ProjetoDeEdicao, rotulo: string, limite = LIMITE_DO_HISTORICO): Historico {
  if (projeto === h.presente.projeto) return h;
  const passado = h.passado.concat([h.presente]);
  return { passado: passado.length > limite ? passado.slice(passado.length - limite) : passado, presente: { projeto, rotulo }, futuro: [] };
}

export function desfazer(h: Historico): Historico {
  if (!h.passado.length) return h;
  const anterior = h.passado[h.passado.length - 1];
  return { passado: h.passado.slice(0, -1), presente: anterior, futuro: [h.presente].concat(h.futuro) };
}

export function refazer(h: Historico): Historico {
  if (!h.futuro.length) return h;
  return { passado: h.passado.concat([h.presente]), presente: h.futuro[0], futuro: h.futuro.slice(1) };
}

/** Troca o presente sem criar passo (ex.: projeto recarregado do servidor). */
export const trocarPresente = (h: Historico, projeto: ProjetoDeEdicao): Historico => ({ ...h, presente: { ...h.presente, projeto } });
