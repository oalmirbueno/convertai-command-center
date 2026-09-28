import { Landmark, PiggyBank, Scale } from "lucide-react";

/*
 * As três leituras da área de Custos fixos. Separadas porque respondem a
 * perguntas diferentes: quanto a estrutura custa, quanto eu posso retirar, e
 * quanto fica reservado para o governo. Juntas numa página só, nenhuma era
 * legível.
 *
 * Moram fora do FixedCosts porque o seletor sobe para a linha do título da
 * página (AdminFinanceiro, 28/09: seletor pequeno não ganha linha própria).
 */
export const ABAS_DOS_CUSTOS = [
  { id: "custos", rotulo: "Custos fixos", icone: Scale },
  { id: "prolabore", rotulo: "Pró-labore", icone: PiggyBank },
  { id: "tributaria", rotulo: "Tributária", icone: Landmark },
] as const;

export type AbaDosCustos = (typeof ABAS_DOS_CUSTOS)[number]["id"];

/** A escolha lembrada da leitura (a mesma chave de antes, no FixedCosts). */
export const CHAVE_DA_ABA_DOS_CUSTOS = "financeiro:custos:aba";

export const validarAbaDosCustos = (v: unknown) => ABAS_DOS_CUSTOS.some((x) => x.id === v);
