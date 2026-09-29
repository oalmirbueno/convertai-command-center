import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { aplicarOperacao, assinaturaDoProjeto, type Operacao } from "../operacoes";

/**
 * Contrato das skills do editor (frente V-B). Uma skill é uma FUNÇÃO PURA e
 * determinística: recebe o projeto (com a fala guardada nele), o contexto e os
 * parâmetros, e devolve uma PROPOSTA (lista de operações da linha do tempo +
 * como o projeto fica). A tela mostra a proposta; nada muda até Aplicar, e
 * Aplicar é um passo só no desfazer. A IA escolhe a skill e os parâmetros;
 * quem calcula tempo é este código.
 */

export type IdDaSkill =
  | "brabo"
  | "cortar_silencios"
  | "legendas"
  | "punch_in"
  | "organizar_por_roteiro"
  | "antes_depois"
  | "fechar_buracos"
  | "transicoes_suaves"
  | "cortar_pela_onda"
  | "ficar_com_melhor_tomada"
  | "efeitos_sonoros";

export interface CenaDoRoteiro {
  ref: string;
  titulo?: string | null;
}

export interface ContextoDaSkill {
  /** Data do registro no histórico do projeto (passe fixo nos testes). */
  agora: string;
  /** Ordem das cenas do roteiro escolhido (organizar por roteiro). */
  cenas?: CenaDoRoteiro[] | null;
  /** Ids dos clipes selecionados na tela (antes e depois, punch-in no trecho). */
  selecionados?: string[];
}

export type ValorDoParametro = number | string | boolean;

export interface ParametroDaSkill {
  chave: string;
  rotulo: string;
  tipo: "numero" | "escolha" | "sim_nao";
  padrao: ValorDoParametro;
  min?: number;
  max?: number;
  passo?: number;
  opcoes?: { valor: string; rotulo: string }[];
}

export interface PropostaDaSkill {
  skill: IdDaSkill;
  titulo: string;
  resumo: string;
  operacoes: Operacao[];
  avisos: string[];
  /** Assinatura do projeto de onde a proposta saiu: mudou, a proposta é refeita. */
  base: string;
  resultado: ProjetoDeEdicao;
}

export interface Skill {
  id: IdDaSkill;
  rotulo: string;
  /** Uma linha, vai no "?" do cartão. */
  descricao: string;
  /** De onde vem (skill da agência ou projeto de referência). */
  referencia: string;
  precisaDeFala: boolean;
  parametros: ParametroDaSkill[];
  propor: (p: ProjetoDeEdicao, ctx: ContextoDaSkill, params: Record<string, ValorDoParametro>) => PropostaDaSkill;
}

/** Aplica passo a passo numa cópia, guardando as operações (a próxima conta já vê a anterior). */
export class Montador {
  projeto: ProjetoDeEdicao;
  operacoes: Operacao[] = [];
  avisos: string[] = [];
  private readonly base: string;
  constructor(p: ProjetoDeEdicao) {
    this.projeto = p;
    this.base = assinaturaDoProjeto(p);
  }
  aplicar(o: Operacao) {
    this.projeto = aplicarOperacao(this.projeto, o);
    this.operacoes.push(o);
  }
  avisar(t: string) {
    if (this.avisos.indexOf(t) < 0) this.avisos.push(t);
  }
  proposta(skill: IdDaSkill, titulo: string, resumo: string): PropostaDaSkill {
    return { skill, titulo, resumo, operacoes: this.operacoes, avisos: this.avisos, base: this.base, resultado: this.projeto };
  }
}

export function parametrosComPadrao(s: Pick<Skill, "parametros">, dados: Record<string, ValorDoParametro> | null | undefined): Record<string, ValorDoParametro> {
  const saida: Record<string, ValorDoParametro> = {};
  s.parametros.forEach((d) => {
    const v = dados ? dados[d.chave] : undefined;
    if (d.tipo === "numero") {
      const n = Number(v);
      saida[d.chave] = v === undefined || v === "" || !isFinite(n) ? d.padrao : Math.max(d.min !== undefined ? d.min : -Infinity, Math.min(d.max !== undefined ? d.max : Infinity, n));
    } else if (d.tipo === "sim_nao") {
      saida[d.chave] = v === undefined ? d.padrao : v === true || v === "true";
    } else {
      saida[d.chave] = d.opcoes && d.opcoes.some((o) => o.valor === v) ? String(v) : d.padrao;
    }
  });
  return saida;
}
