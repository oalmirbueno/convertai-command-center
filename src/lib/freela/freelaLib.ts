/**
 * Mesa Freela (MVP): regras compartilhadas de moeda e texto.
 *
 * O freela é um canal de aquisição ao lado da agência. BRL e USD NUNCA se
 * somam nem se convertem: cada total é por moeda, sempre. As linhas antigas
 * de billing sem `currency` são BRL (o painel só trabalhava em real).
 */

export type Moeda = "BRL" | "USD";

/** Moeda de uma linha de billing; linhas antigas sem currency são BRL. */
export const moedaDe = (linha: { currency?: string | null } | null | undefined): Moeda =>
  linha?.currency === "USD" ? "USD" : "BRL";

/** R$ para BRL, US$ para USD, sempre no formato pt-BR. */
export const fmtMoeda = (valor: number, moeda: Moeda | string | null | undefined): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda === "USD" ? "USD" : "BRL" }).format(Number(valor) || 0);

/** Marcador curto da moeda para as linhas de lista. */
export const simboloDaMoeda = (moeda: Moeda | string | null | undefined): string => (moeda === "USD" ? "US$" : "R$");

/** Busca sem acento e sem maiúscula ("José" acha "jose"). */
export const normalizar = (texto: string | null | undefined): string =>
  (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** YYYY-MM-DD de hoje no fuso do painel (America/Sao_Paulo). */
export const hojeISO = (): string => {
  const agora = new Date();
  const sp = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const ano = sp.getFullYear();
  const mes = String(sp.getMonth() + 1).padStart(2, "0");
  const dia = String(sp.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
};

/** Soma meses a uma data YYYY-MM-DD sem surpresa de fuso (meio-dia local). */
export const somarMeses = (iso: string, meses: number): string => {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(ano, (mes - 1) + meses, dia, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** DD/MM/AAAA para exibição. */
export const dataBR = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "-";
  return `${dia}/${mes}/${ano}`;
};

/** Parcela aberta com vencimento no passado aparece como atrasada. */
export const statusVisualDaParcela = (parcela: { status: string; vencimento: string }, hoje = hojeISO()): string =>
  parcela.status === "aberta" && parcela.vencimento < hoje ? "atrasada" : parcela.status;

export const ROTULO_STATUS_PROPOSTA: Record<string, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  negociacao: "Em negociação",
  aceita: "Aceita",
  perdida: "Perdida",
};

export const ROTULO_STATUS_PROJETO: Record<string, string> = {
  kickoff: "Kickoff",
  em_andamento: "Em andamento",
  entrega: "Entrega",
  pago: "Pago",
  arquivado: "Arquivado",
};

export const ROTULO_STATUS_PARCELA: Record<string, string> = {
  aberta: "Em aberto",
  paga: "Paga",
  atrasada: "Atrasada",
  cancelada: "Cancelada",
};
