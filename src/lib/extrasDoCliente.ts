/**
 * Extras do cliente (14/11/2026): o que ele comprou além da mensalidade base. Aqui ficam só as contas
 * e os nomes; a tela está em src/components/clientes/ExtrasDoCliente.tsx e as regras de cobrança no
 * banco (supabase/migrations/20261114120000_extras_do_cliente.sql).
 */

export type CobrancaDoExtra = "mensal" | "unico" | "comissao";
export type StatusDoExtra = "ativo" | "aguardando" | "encerrado";

export type Extra = {
  id: string;
  client_id: string;
  nome: string;
  categoria: string;
  cobranca: CobrancaDoExtra;
  valor: number;
  percentual: number | null;
  base_da_comissao: string | null;
  inicio: string | null;
  dia_vencimento: number | null;
  status: StatusDoExtra;
  encerrado_em: string | null;
  observacao: string | null;
  created_at: string;
};

export type CobrancaDeExtra = { id: string; extra_id: string; amount: number; paid_amount: number | null; status: string; due_date: string; paid_date: string | null; description: string | null };

export const CATEGORIAS: { valor: string; rotulo: string }[] = [
  { valor: "suporte", rotulo: "Suporte e manutenção" },
  { valor: "sistema", rotulo: "Sistema" },
  { valor: "automacao", rotulo: "Automação" },
  { valor: "crm", rotulo: "CRM" },
  { valor: "email", rotulo: "E-mail profissional" },
  { valor: "site", rotulo: "Site" },
  { valor: "trafego", rotulo: "Tráfego" },
  { valor: "conteudo", rotulo: "Conteúdo" },
  { valor: "outro", rotulo: "Outro" },
];
export const nomeDaCategoria = (c?: string | null) => CATEGORIAS.find((x) => x.valor === c)?.rotulo ?? "Outro";

/** Os atalhos da janela: um toque preenche o que é e como cobra; o valor continua com o dono. */
export const ATALHOS: { id: string; rotulo: string; nome: string; categoria: string; cobranca: CobrancaDoExtra }[] = [
  { id: "suporte", rotulo: "Suporte mensal", nome: "Suporte e manutenção", categoria: "suporte", cobranca: "mensal" },
  { id: "sistema", rotulo: "Sistema", nome: "Sistema sob medida", categoria: "sistema", cobranca: "unico" },
  { id: "automacao-impl", rotulo: "Automação: implementação", nome: "Automação · implementação", categoria: "automacao", cobranca: "unico" },
  { id: "automacao-mensal", rotulo: "Automação: mensal", nome: "Automação · suporte e operação", categoria: "automacao", cobranca: "mensal" },
  { id: "crm", rotulo: "CRM", nome: "CRM", categoria: "crm", cobranca: "mensal" },
  { id: "email", rotulo: "E-mail profissional", nome: "E-mail profissional", categoria: "email", cobranca: "mensal" },
  { id: "comissao", rotulo: "Comissão", nome: "Comissão sobre resultado", categoria: "outro", cobranca: "comissao" },
];

const centavos = (n: number) => Math.round(n * 100);

/** "2026-11-13" mais N meses, no mesmo dia (ou no último dia quando o mês é mais curto). */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${alvo.getUTCFullYear()}-${dois(alvo.getUTCMonth() + 1)}-${dois(Math.min(d, ultimo))}`;
}

export type ParcelaDoExtra = { valor: number; vencimento: string; paga: boolean; paga_em?: string | null; rotulo?: string };

/**
 * Entrada livre mais o restante em parcelas iguais. O centavo que sobra da divisão vai para a última
 * parcela, para a soma fechar no valor contratado.
 */
export function montarParcelas(dados: {
  total: number;
  entrada: number;
  entradaPaga: boolean;
  entradaEm: string;
  parcelas: number;
  primeiraEm: string;
}): ParcelaDoExtra[] {
  const total = centavos(dados.total);
  const entrada = Math.min(Math.max(0, centavos(dados.entrada)), total);
  const resto = total - entrada;
  const n = resto > 0 ? Math.max(1, Math.floor(dados.parcelas) || 1) : 0;
  const lista: ParcelaDoExtra[] = [];
  if (entrada > 0) {
    lista.push({ valor: entrada / 100, vencimento: dados.entradaEm, paga: dados.entradaPaga, paga_em: dados.entradaPaga ? dados.entradaEm : null, rotulo: n === 0 ? "pagamento único" : "entrada" });
  }
  const cada = n ? Math.floor(resto / n) : 0;
  for (let i = 0; i < n; i += 1) {
    const valor = i === n - 1 ? resto - cada * (n - 1) : cada;
    lista.push({ valor: valor / 100, vencimento: somarMeses(dados.primeiraEm, i), paga: false, rotulo: `parcela ${i + 1}/${n}` });
  }
  return lista;
}

/** O que falta para salvar. Devolve a frase que aparece embaixo do formulário, ou null quando está tudo certo. */
export function conferirExtra(f: {
  nome: string;
  cobranca: CobrancaDoExtra;
  valor: number;
  percentual: number;
  comecaAgora: boolean;
  inicio: string;
  parcelas: ParcelaDoExtra[];
}): string | null {
  if (f.nome.trim().length < 2) return "Escreva o que o cliente está comprando.";
  if (f.cobranca === "comissao") {
    if (!(f.percentual > 0) || f.percentual > 100) return "Diga o percentual da comissão (entre 0 e 100).";
    return null;
  }
  if (!(f.valor > 0)) return "Diga o valor.";
  if (f.cobranca === "mensal") {
    if (f.comecaAgora && !/^\d{4}-\d{2}-\d{2}$/.test(f.inicio)) return "Diga em que dia começa a cobrar.";
    return null;
  }
  if (f.parcelas.length === 0) return "Diga como o valor vai ser pago.";
  if (f.parcelas.some((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p.vencimento))) return "Preencha as datas do pagamento.";
  if (centavos(f.parcelas.reduce((s, p) => s + p.valor, 0)) !== centavos(f.valor)) return "As parcelas não somam o valor total.";
  return null;
}

/** Quanto os extras somam por mês (só os mensais já ativos) e quanto está esperando a entrega. */
export function resumoDosExtras(extras: Extra[]): { porMes: number; aguardando: number; ativos: number } {
  const mensais = extras.filter((e) => e.cobranca === "mensal");
  const soma = (l: Extra[]) => Math.round(l.reduce((s, e) => s + (Number(e.valor) || 0), 0) * 100) / 100;
  return {
    porMes: soma(mensais.filter((e) => e.status === "ativo")),
    aguardando: soma(mensais.filter((e) => e.status === "aguardando")),
    ativos: extras.filter((e) => e.status !== "encerrado").length,
  };
}

/** Como está o pagamento de um extra de valor único: quanto já entrou e quanto falta. */
export function andamentoDoUnico(cobrancas: CobrancaDeExtra[]): { pago: number; aberto: number; proxima: string | null } {
  const pagas = cobrancas.filter((c) => c.status === "paid");
  const abertas = cobrancas.filter((c) => c.status !== "paid").sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  return {
    pago: Math.round(pagas.reduce((s, c) => s + Number(c.paid_amount ?? c.amount), 0) * 100) / 100,
    aberto: Math.round(abertas.reduce((s, c) => s + Number(c.amount), 0) * 100) / 100,
    proxima: abertas[0]?.due_date ?? null,
  };
}
