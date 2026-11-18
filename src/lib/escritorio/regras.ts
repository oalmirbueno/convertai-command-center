import type { RegraPermanente, UsoDeRegra } from "./tipos";

/** A regra de mensagens: a única com modelos de texto e com hora de início e de fim. */
export const REGRA_DE_MENSAGENS = "mensagens_de_rotina";

/** Um limite numérico que o dono ajusta na aba Regras. */
export interface CampoDeLimite {
  chave: string;
  rotulo: string;
  min: number;
  max: number;
  inteiro: boolean;
}

const campo = (chave: string, rotulo: string, min: number, max: number, inteiro = true): CampoDeLimite => ({ chave, rotulo, min, max, inteiro });

/** Os limites de cada regra, na ordem em que a tela mostra. Regra que não está aqui não tem limite para ajustar. */
export const CAMPOS_DA_REGRA: Record<string, CampoDeLimite[]> = {
  conteudo_revisado: [campo("max_rejeicoes", "Rejeições que a peça pode ter", 0, 5)],
  trafego_ate_o_teto: [campo("teto_semana_brl", "Teto por semana (R$)", 0, 100000, false), campo("dias_sem_coleta", "Dias sem coleta", 1, 14)],
  [REGRA_DE_MENSAGENS]: [
    campo("hora_inicio", "Hora de início", 0, 23),
    campo("hora_fim", "Hora de fim", 0, 23),
    campo("max_por_assunto", "Mensagens por assunto", 1, 5),
    campo("intervalo_dias", "Dias entre uma mensagem e outra", 1, 30),
  ],
};

export interface ModeloDeMensagem {
  chave: string;
  nome: string;
  texto: string;
}

/** Os modelos de texto de uma regra (`limites.modelos`), na ordem em que vieram do banco. */
export function modelosDaRegra(limites: Record<string, unknown> | null | undefined): ModeloDeMensagem[] {
  const modelos = limites && typeof limites.modelos === "object" && limites.modelos !== null ? (limites.modelos as Record<string, unknown>) : {};
  return Object.keys(modelos).map((chave) => {
    const m = (modelos[chave] && typeof modelos[chave] === "object" ? modelos[chave] : {}) as { nome?: unknown; texto?: unknown };
    return { chave, nome: typeof m.nome === "string" && m.nome.trim() ? m.nome : chave, texto: typeof m.texto === "string" ? m.texto : "" };
  });
}

function lerNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;
  const limpo = valor.trim().replace(",", ".");
  if (!limpo || !/^-?\d+(\.\d+)?$/.test(limpo)) return null;
  return Number(limpo);
}

export type LimitesValidados =
  | { ok: true; limites: Record<string, unknown> }
  /** `erros` vai por campo: a chave do limite ou `modelo:<chave do modelo>`. */
  | { ok: false; erros: Record<string, string> };

/**
 * Confere os limites antes de mandar para o banco. Aceita o que a pessoa
 * digitou (texto ou número) e devolve o objeto inteiro pronto, porque o banco
 * troca os limites todos de uma vez: o que a tela não edita segue como estava.
 */
export function validarLimites(chave: string, limites: Record<string, unknown>, opcoes: { ligada?: boolean } = {}): LimitesValidados {
  const erros: Record<string, string> = {};
  const pronto: Record<string, unknown> = { ...limites };
  for (const c of CAMPOS_DA_REGRA[chave] ?? []) {
    const bruto = limites[c.chave];
    if (bruto === null || bruto === undefined || (typeof bruto === "string" && !bruto.trim())) { erros[c.chave] = "Preencha este campo."; continue; }
    const n = lerNumero(bruto);
    if (n === null) erros[c.chave] = "Use só números.";
    else if (c.inteiro && !Number.isInteger(n)) erros[c.chave] = "Use um número inteiro.";
    else if (n < c.min || n > c.max) erros[c.chave] = `Use um número de ${c.min} a ${c.max}.`;
    else pronto[c.chave] = n;
  }
  if (chave === REGRA_DE_MENSAGENS) {
    if (!erros.hora_inicio && !erros.hora_fim && (pronto.hora_inicio as number) >= (pronto.hora_fim as number)) erros.hora_fim = "A hora de fim precisa ser depois da hora de início.";
    const modelos: Record<string, { nome: string; texto: string }> = {};
    for (const m of modelosDaRegra(limites)) {
      const texto = m.texto.trim();
      if (!texto && opcoes.ligada) erros[`modelo:${m.chave}`] = "Com a regra ligada, o texto não pode ficar vazio.";
      modelos[m.chave] = { nome: m.nome, texto };
    }
    pronto.modelos = modelos;
  }
  return Object.keys(erros).length > 0 ? { ok: false, erros } : { ok: true, limites: pronto };
}

/** A regra de mensagens só liga com o texto de todos os modelos colado. As outras ligam sempre. */
export function podeLigar(regra: Pick<RegraPermanente, "chave" | "limites">): { pode: boolean; motivo: string | null } {
  if (regra.chave !== REGRA_DE_MENSAGENS) return { pode: true, motivo: null };
  const modelos = modelosDaRegra(regra.limites);
  if (modelos.length === 0 || modelos.some((m) => !m.texto.trim())) return { pode: false, motivo: "Falta colar o texto dos modelos." };
  return { pode: true, motivo: null };
}

/** Segunda-feira, 00:00, no horário de quem está olhando a tela. */
export function inicioDaSemana(agoraMs: number): number {
  const d = new Date(agoraMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Quantas vezes a regra foi usada desde segunda-feira, 00:00. */
export function usosNestaSemana(usos: readonly Pick<UsoDeRegra, "regra" | "usado_em">[], chave: string, agoraMs: number): number {
  const inicio = inicioDaSemana(agoraMs);
  return usos.filter((u) => u.regra === chave && new Date(u.usado_em).getTime() >= inicio).length;
}

/** "usada 3 vezes nesta semana". */
export function fraseDeUsos(n: number): string {
  return n === 1 ? "usada 1 vez nesta semana" : `usada ${n} vezes nesta semana`;
}

/** Quem pode usar a regra, em palavras: os nomes dos agentes ou "qualquer agente". */
export function quemUsaARegra(operadores: readonly string[] | null | undefined, nomeDe: (slug: string) => string): string {
  if (!operadores || operadores.length === 0) return "qualquer agente";
  return operadores.map(nomeDe).join(", ");
}
