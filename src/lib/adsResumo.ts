import {
  dinheiro,
  numero,
  summarizeCampaign,
  type AdsDailyRow,
  type GoalKind,
} from "@/lib/adsLanguage";

/**
 * Resumos da área de anúncios (/anuncios e /metricas), em código e sem IA.
 *
 * Duas perguntas que a tela responde antes de qualquer número:
 * 1. a conta está sendo lida? (situacaoDaConta)
 * 2. o dinheiro trouxe o quê? (resultadosPorObjetivo), com o resultado certo
 *    para o objetivo de cada campanha: conversa não soma com venda.
 */

/* ───────────────────────────── resultado por objetivo ───────────────────── */

export interface ResultadoDoObjetivo {
  kind: GoalKind;
  /** Nome do resultado no singular e no plural ("conversa iniciada"). */
  singular: string;
  plural: string;
  resultados: number;
  investido: number;
  custoPorResultado: number | null;
  campanhas: number;
}

/**
 * Soma as campanhas pelo objetivo de cada uma. A soma única de "resultados"
 * juntava conversas, contatos e vendas no mesmo número; aqui cada objetivo
 * tem o seu, ordenado pelo dinheiro investido nele.
 */
export function resultadosPorObjetivo(rows: AdsDailyRow[]): ResultadoDoObjetivo[] {
  const porCampanha = new Map<string, AdsDailyRow[]>();
  for (const row of rows || []) {
    const lista = porCampanha.get(row.campaign_id) || [];
    lista.push(row);
    porCampanha.set(row.campaign_id, lista);
  }
  const porMeta = new Map<GoalKind, ResultadoDoObjetivo>();
  porCampanha.forEach((lista) => {
    const r = summarizeCampaign(lista);
    if (!r) return;
    const atual = porMeta.get(r.goal.kind) || {
      kind: r.goal.kind,
      singular: r.goal.resultSingular,
      plural: r.goal.resultPlural,
      resultados: 0,
      investido: 0,
      custoPorResultado: null,
      campanhas: 0,
    };
    atual.investido += r.investido;
    atual.campanhas += 1;
    // Alcance é o próprio resultado da campanha de alcance.
    atual.resultados += r.goal.kind === "alcance" ? r.alcance : r.resultados || 0;
    porMeta.set(r.goal.kind, atual);
  });
  const saida: ResultadoDoObjetivo[] = [];
  porMeta.forEach((r) => {
    r.custoPorResultado = r.resultados > 0 && r.kind !== "alcance" ? r.investido / r.resultados : null;
    saida.push(r);
  });
  return saida.sort((a, b) => b.investido - a.investido);
}

/** "12 conversas iniciadas" (ou "1 contato"). */
export function rotuloDoResultado(r: ResultadoDoObjetivo): string {
  return `${numero(r.resultados)} ${r.resultados === 1 ? r.singular : r.plural}`;
}

/** "R$ 8,50 cada" quando há custo por resultado. */
export function custoDoResultado(r: ResultadoDoObjetivo): string | null {
  return r.custoPorResultado != null && r.custoPorResultado > 0 ? `${dinheiro(r.custoPorResultado)} cada` : null;
}

/* ───────────────────────────── situação da conta ───────────────────────── */

export type TomDaConta = "ok" | "atencao" | "erro" | "aguardando" | "desligada";

export interface ContaParaSituacao {
  status: string;
  ultima_coleta: string | null;
  account_status?: number | null;
  saldo_disponivel?: number | null;
  erro?: string | null;
}

export interface SituacaoDaConta {
  rotulo: string;
  tom: TomDaConta;
  /** O que fazer, em uma frase; vazio quando está tudo certo. */
  acao: string;
  /** Precisa reconectar com a Meta (token recusado ou vencido). */
  reconectar: boolean;
}

/** Leitura mais velha que isto é atraso: o banco lê de hora em hora. */
export const HORAS_DE_ATRASO = 26;
/** Conta pré-paga abaixo disto para de rodar em poucos dias. */
export const SALDO_BAIXO = 50;

/** Erro de acesso vencido ou revogado (código 190 da Meta, token, sessão). */
const pareceToken = (erro: string) => /token|oauth|sess(ao|ão|ion)|expir|\b190\b/i.test(erro);

/**
 * A situação da conta em uma palavra e o que fazer. Ordem: o que impede a
 * leitura, o que impede a veiculação, o que ameaça a veiculação, e só então
 * "lendo normalmente".
 */
export function situacaoDaConta(conta: ContaParaSituacao, agora: Date = new Date()): SituacaoDaConta {
  if (conta.status !== "active") {
    return { rotulo: "Desligada", tom: "desligada", acao: "Não é lida. Ligue de novo se voltou a ser nossa.", reconectar: false };
  }
  const erro = String(conta.erro || "").trim();
  if (erro) {
    const token = pareceToken(erro);
    return {
      rotulo: "Leitura recusada",
      tom: "erro",
      acao: token ? "Reconecte com a Meta para renovar o acesso." : "Confira o acesso a esta conta no Gerenciador e peça a leitura de novo.",
      reconectar: token,
    };
  }
  const st = conta.account_status;
  if (st === 2 || st === 100 || st === 101) {
    return { rotulo: "Desativada na Meta", tom: "erro", acao: "A conta não veicula. Resolva no Gerenciador de Anúncios.", reconectar: false };
  }
  if (st === 3 || st === 8 || st === 9) {
    return { rotulo: "Pagamento pendente", tom: "atencao", acao: "Acerte o pagamento no Gerenciador para os anúncios não pararem.", reconectar: false };
  }
  if (st === 7) {
    return { rotulo: "Em análise de risco", tom: "atencao", acao: "A Meta está revisando a conta; acompanhe no Gerenciador.", reconectar: false };
  }
  if (!conta.ultima_coleta) {
    return { rotulo: "Aguardando a primeira leitura", tom: "aguardando", acao: "Peça a leitura agora ou espere alguns minutos.", reconectar: false };
  }
  const lida = new Date(conta.ultima_coleta).getTime();
  if (Number.isFinite(lida) && agora.getTime() - lida > HORAS_DE_ATRASO * 3600000) {
    return { rotulo: "Leitura atrasada", tom: "atencao", acao: "Peça a leitura agora; se não vier, reconecte com a Meta.", reconectar: false };
  }
  if (conta.saldo_disponivel != null && Number(conta.saldo_disponivel) < SALDO_BAIXO) {
    return { rotulo: "Saldo baixo", tom: "atencao", acao: "Avise o cliente para recarregar a conta.", reconectar: false };
  }
  return { rotulo: "Lendo normalmente", tom: "ok", acao: "", reconectar: false };
}

const PESO: Record<TomDaConta, number> = { erro: 0, atencao: 1, aguardando: 2, ok: 3, desligada: 4 };

/** Problemas primeiro, depois o que está em dia, e por fim as desligadas. */
export function ordenarPorSituacao<T extends ContaParaSituacao & { display_name?: string }>(contas: T[], agora: Date = new Date()): T[] {
  return contas.slice().sort((a, b) => {
    const d = PESO[situacaoDaConta(a, agora).tom] - PESO[situacaoDaConta(b, agora).tom];
    return d !== 0 ? d : String(a.display_name || "").localeCompare(String(b.display_name || ""), "pt-BR");
  });
}

/** "agora", "há 12 min", "há 3 h", "há 2 dias". */
export function haQuanto(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((agora.getTime() - t) / 60000));
  if (min < 2) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

export const CLASSE_DO_TOM_DA_CONTA: Record<TomDaConta, { ponto: string; texto: string }> = {
  ok: { ponto: "bg-success", texto: "text-success" },
  atencao: { ponto: "bg-warning", texto: "text-warning" },
  erro: { ponto: "bg-destructive", texto: "text-destructive" },
  aguardando: { ponto: "bg-muted-foreground/60", texto: "text-muted-foreground" },
  desligada: { ponto: "bg-muted-foreground/30", texto: "text-muted-foreground" },
};
