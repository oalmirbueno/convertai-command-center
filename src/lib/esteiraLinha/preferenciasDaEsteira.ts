import { diasDoPeriodoValido, type DiasDoPeriodo } from "./esteiraLinha";

/*
 * Preferências da tela da Esteira lembradas neste aparelho (pedido do Almir,
 * 14/11/2026, 21h53): o período da grade (uma ou duas semanas) e se a caixa
 * "Precisa de você" está aberta. Tudo puro e testável, no mesmo espírito de
 * filtroDeClientes.ts: valor versionado, qualquer coisa estranha volta ao
 * padrão e localStorage bloqueado nunca quebra a tela. Nada de cookie nem banco.
 */

type Leitor = Pick<Storage, "getItem"> | null | undefined;
type Gravador = Pick<Storage, "setItem"> | null | undefined;

function lerJson(armazenamento: Leitor, chave: string): Record<string, unknown> | null {
  let bruto: string | null | undefined;
  try {
    bruto = armazenamento?.getItem(chave);
  } catch {
    return null;
  }
  if (!bruto) return null;
  try {
    const valor = JSON.parse(bruto) as unknown;
    return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function gravarJson(armazenamento: Gravador, chave: string, valor: unknown): void {
  try {
    armazenamento?.setItem(chave, JSON.stringify(valor));
  } catch {
    // Sem espaço ou bloqueado: a escolha vale só nesta aba.
  }
}

// ------------------------------------------------------------------ período

export const CHAVE_DO_PERIODO = "aceleriq:esteira:periodo";

export interface PeriodoGuardado {
  v: 1;
  dias: DiasDoPeriodo;
}

export const PERIODO_PADRAO: PeriodoGuardado = { v: 1, dias: 7 };

/** Lê o período guardado. Versão desconhecida ou valor fora de 7/14 vira uma semana. */
export function lerPeriodo(bruto: string | null | undefined): PeriodoGuardado {
  return lerPeriodoGuardado({ getItem: () => bruto ?? null });
}

export function lerPeriodoGuardado(armazenamento: Leitor): PeriodoGuardado {
  const valor = lerJson(armazenamento, CHAVE_DO_PERIODO);
  if (!valor || valor.v !== 1 || (valor.dias !== 7 && valor.dias !== 14)) return PERIODO_PADRAO;
  return { v: 1, dias: diasDoPeriodoValido(valor.dias) };
}

export const serializarPeriodo = (dias: DiasDoPeriodo): string => JSON.stringify({ v: 1, dias: diasDoPeriodoValido(dias) });

export function gravarPeriodo(armazenamento: Gravador, dias: DiasDoPeriodo): void {
  gravarJson(armazenamento, CHAVE_DO_PERIODO, { v: 1, dias: diasDoPeriodoValido(dias) });
}

// ------------------------------------------------------------------ avisos do topo

export const CHAVE_DOS_AVISOS = "aceleriq:esteira:avisos";

export interface AvisosGuardados {
  v: 1;
  /** A caixa "Precisa de você" está aberta. O padrão é recolhida. */
  precisaDeVoce: boolean;
}

export const AVISOS_PADRAO: AvisosGuardados = { v: 1, precisaDeVoce: false };

/** Lê o estado dos avisos. Só `true` exato abre; o resto (inclusive JSON quebrado) fica recolhido. */
export function lerAvisos(bruto: string | null | undefined): AvisosGuardados {
  return lerAvisosGuardados({ getItem: () => bruto ?? null });
}

export function lerAvisosGuardados(armazenamento: Leitor): AvisosGuardados {
  const valor = lerJson(armazenamento, CHAVE_DOS_AVISOS);
  if (!valor || valor.v !== 1) return AVISOS_PADRAO;
  return { v: 1, precisaDeVoce: valor.precisaDeVoce === true };
}

export const serializarAvisos = (avisos: AvisosGuardados): string => JSON.stringify({ v: 1, precisaDeVoce: avisos.precisaDeVoce === true });

export function gravarAvisos(armazenamento: Gravador, avisos: AvisosGuardados): void {
  gravarJson(armazenamento, CHAVE_DOS_AVISOS, { v: 1, precisaDeVoce: avisos.precisaDeVoce === true });
}

/** O contador da caixa recolhida: "1 item precisa de você", "3 itens precisam de você". */
export const contadorDoPrecisaDeVoce = (quantos: number): string =>
  quantos === 1 ? "1 item precisa de você" : `${quantos} itens precisam de você`;

/** localStorage pode não existir ou estar bloqueado (modo privado). */
export function armazenamentoDoAparelho(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
