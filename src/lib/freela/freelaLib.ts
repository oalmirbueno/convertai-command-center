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
  aceita: "Fechados",
  perdida: "Perdidos",
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

/** As colunas do funil, na ordem. */
export const ETAPAS_DO_FUNIL = ["rascunho", "enviada", "negociacao", "aceita", "perdida"];

/** Motivos mais comuns de perda; o detalhe vai no texto livre. */
export const MOTIVOS_DE_PERDA = ["Preço", "Sem orçamento agora", "Escolheu outro", "Prazo", "Parou de responder", "Outro"];

/** Soma por moeda: real e dólar nunca se misturam. */
export const somaPorMoeda = (linhas: { valor: number | string; moeda: string }[]): Record<Moeda, number> =>
  linhas.reduce(
    (t, l) => {
      t[l.moeda === "USD" ? "USD" : "BRL"] += Number(l.valor) || 0;
      return t;
    },
    { BRL: 0, USD: 0 } as Record<Moeda, number>,
  );

/** "R$ 1.000,00 · US$ 50,00"; mostra só a moeda que tem valor. */
export const totalEmTexto = (t: Record<Moeda, number>): string => {
  const partes = (["BRL", "USD"] as Moeda[]).filter((m) => t[m] > 0).map((m) => fmtMoeda(t[m], m));
  return partes.length ? partes.join(" · ") : "vazio";
};

/** Link do WhatsApp com a mensagem pronta; quem envia é a pessoa. Número sem DDI vira Brasil. */
export const linkDoWhatsApp = (numero: string | null | undefined, mensagem: string): string | null => {
  const digitos = (numero || "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  const comPais = digitos.length <= 11 ? `55${digitos}` : digitos;
  return `https://wa.me/${comPais}?text=${encodeURIComponent(mensagem)}`;
};

export const mensagemDeRetomada = (nome: string, titulo: string): string =>
  `Oi, ${nome.split(" ")[0]}! Lembrei da nossa conversa sobre ${titulo}. Mudou alguma coisa por aí? Se fizer sentido, retomamos.`;
