import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { ErroDaOperacao } from "../operacoes";
import { SKILL_ANTES_DEPOIS } from "./antesDepois";
import { SKILL_BRABO } from "./brabo";
import { SKILL_CORTAR_SILENCIOS } from "./cortarSilencios";
import { SKILL_LEGENDAS } from "./legendas";
import { SKILL_FECHAR_BURACOS, SKILL_ORGANIZAR, SKILL_TRANSICOES } from "./organizar";
import { SKILL_PUNCH_IN } from "./punchIn";
import type { ContextoDaSkill, IdDaSkill, PropostaDaSkill, Skill, ValorDoParametro } from "./tipos";

export * from "./tipos";

/** Catálogo das skills do editor, na ordem dos cartões. */
export const SKILLS_DO_EDITOR: Skill[] = [
  SKILL_BRABO,
  SKILL_CORTAR_SILENCIOS,
  SKILL_LEGENDAS,
  SKILL_PUNCH_IN,
  SKILL_ORGANIZAR,
  SKILL_ANTES_DEPOIS,
  SKILL_FECHAR_BURACOS,
  SKILL_TRANSICOES,
];

export const skillPorId = (id: string): Skill | null => SKILLS_DO_EDITOR.find((s) => s.id === id) || null;

/** Proposta de uma skill; erro de operação vira proposta vazia com o motivo (nunca aplica pela metade). */
export function proporSkill(id: IdDaSkill, p: ProjetoDeEdicao, ctx: ContextoDaSkill, params?: Record<string, ValorDoParametro> | null): PropostaDaSkill {
  const s = skillPorId(id);
  if (!s) throw new Error("Skill desconhecida.");
  try {
    return s.propor(p, ctx, params || {});
  } catch (e) {
    const motivo = e instanceof ErroDaOperacao ? e.message : "Não deu para montar a proposta.";
    return { skill: id, titulo: s.rotulo, resumo: "Nada a aplicar.", operacoes: [], avisos: [motivo], base: "", resultado: p };
  }
}

const sem = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Reserva sem IA para escolher a skill por palavras (quando o servidor não
 * responde a editor_escolher_skill, que usa o Jev). Ordem importa: o pedido
 * mais completo primeiro.
 */
export function skillPorPalavras(texto: string): IdDaSkill | null {
  const t = sem(texto);
  if (/brabo|dinamic/.test(t)) return "brabo";
  if (/antes e depois|antes\/depois|comparar|cortina/.test(t)) return "antes_depois";
  if (/silenci|pausa|respiro/.test(t)) return "cortar_silencios";
  if (/legenda|caption|subtitul/.test(t)) return "legendas";
  if (/punch|zoom|gancho/.test(t)) return "punch_in";
  if (/roteiro|ordem|organiz/.test(t)) return "organizar_por_roteiro";
  if (/buraco|encost|vao/.test(t)) return "fechar_buracos";
  if (/transic|fade|dissolv/.test(t)) return "transicoes_suaves";
  return null;
}
