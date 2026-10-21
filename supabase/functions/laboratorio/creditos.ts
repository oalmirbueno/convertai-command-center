/**
 * laboratorio: créditos do Laboratório (migration 20261020050000_laboratorio_creditos.sql), 20/10/2026.
 *
 * Uma carteira só da agência para o Laboratório, separada da carteira de IA dos clientes. O motor de IA
 * continua cobrando a carteira de sempre; aqui fica o limite e o extrato do Laboratório.
 *
 * - Na confirmação (no_executar, rodar_tudo, filme_escolher com confirmado) a função RESERVA o custo estimado.
 *   Carteira ativa sem saldo: 402 sem_credito { saldo_usd, custo_usd } e nada roda.
 * - Carteira inativa (o estado inicial) só registra o uso, sem bloquear.
 * - Falha não cobra: o nó que falha (ou não chega a rodar) devolve a parte dele da reserva (estorno).
 * - Migration ainda não aplicada (RPC ausente) ou banco fora: nada trava, só registra a falha.
 */
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { type Chamador, erroDoBanco, ErroHttp, json, limpo, servico } from "./comum.ts";

type ErroDoBanco = { code?: string; message?: string } | null;
export type PortaDosCreditos = {
  rpc: (nome: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: ErroDoBanco }>;
};

const portaPadrao = (): PortaDosCreditos => ({
  rpc: async (nome, args) => {
    const { data, error } = await servico().rpc(nome, args);
    return { data, error: error as ErroDoBanco };
  },
});

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arred = (v: number) => Math.round(v * 1e6) / 1e6;
const usd = (v: number) => `US$ ${v.toFixed(v > 0 && v < 0.1 ? 4 : 2)}`;

/** A RPC ainda não existe no banco (migration pendente): o Laboratório segue sem o limite. */
export function semCreditosNoBanco(error: ErroDoBanco): boolean {
  if (!error) return false;
  const m = String(error.message || "");
  return error.code === "PGRST202" || error.code === "42883" || error.code === "42P01" || error.code === "PGRST205" || /lab_(creditos|carteira)[a-z_]*.*(does not exist|schema cache|could not find)/i.test(m);
}

export type Reserva = { movimentoId: string; valor: number; ativa: boolean; saldo: number };

/**
 * Reserva o custo estimado na confirmação. Devolve null quando não há o que reservar ou o banco não tem
 * os créditos (nada trava). Carteira ativa sem saldo: lança 402 sem_credito com saldo e custo.
 */
export async function reservarCreditos(
  o: { valor: number; projetoId: string | null; execucaoId?: string | null; nota: string; userId: string },
  porta: PortaDosCreditos = portaPadrao(),
): Promise<Reserva | null> {
  const valor = arred(num(o.valor));
  if (!(valor > 0)) return null;
  const { data, error } = await porta.rpc("lab_creditos_reservar", {
    p_valor: valor,
    p_projeto_id: o.projetoId,
    p_execucao_id: o.execucaoId ?? null,
    p_nota: o.nota.slice(0, 400),
    p_ator: o.userId,
  });
  if (error) {
    if (!semCreditosNoBanco(error)) registrarFalha("laboratorio: reserva de créditos falhou (seguiu sem o limite)", error, { projeto_id: o.projetoId });
    return null;
  }
  const r = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (r.ok === false && r.erro === "sem_credito") {
    const saldo = arred(num(r.saldo_usd));
    const custo = arred(num(r.custo_usd) || valor);
    throw new ErroHttp(402, "sem_credito", `Sem crédito no Laboratório: o saldo é ${usd(saldo)} e isto custa ${usd(custo)}. Carregue créditos para rodar.`, { saldo_usd: saldo, custo_usd: custo });
  }
  if (typeof r.movimento_id !== "string") return null;
  return { movimentoId: r.movimento_id, valor, ativa: r.ativa === true, saldo: arred(num(r.saldo_usd)) };
}

/** Devolve (parte de) uma reserva. Nunca lança: falha no estorno só fica registrada. */
export async function estornarCreditos(
  reserva: Reserva | null,
  o: { valor?: number | null; execucaoId?: string | null; nota: string; userId: string },
  porta: PortaDosCreditos = portaPadrao(),
): Promise<void> {
  if (!reserva) return;
  try {
    const { error } = await porta.rpc("lab_creditos_estornar", {
      p_reserva_id: reserva.movimentoId,
      p_valor: o.valor == null ? null : arred(num(o.valor)),
      p_execucao_id: o.execucaoId ?? null,
      p_nota: o.nota.slice(0, 400),
      p_ator: o.userId,
    });
    if (error && !semCreditosNoBanco(error)) registrarFalha("laboratorio: estorno de créditos falhou", error, { reserva_id: reserva.movimentoId });
  } catch (e) {
    registrarFalha("laboratorio: estorno de créditos falhou", e, { reserva_id: reserva.movimentoId });
  }
}

/**
 * A cobrança de uma confirmação: a reserva e a parte de cada nó. Cada nó devolve a parte dele
 * uma vez só (falhou, um nó antes falhou, a rodada parou ou o dono cancelou as etapas restantes).
 * Uma dependência assíncrona mantém sua parte reservada para a continuação já confirmada.
 */
export class CobrancaDoLab {
  readonly reserva: Reserva | null;
  readonly porNo: Record<string, number>;
  private readonly devolvidos = new Set<string>();
  private readonly userId: string;
  private readonly porta: PortaDosCreditos | undefined;
  constructor(o: { reserva: Reserva | null; porNo: Record<string, number>; userId: string; porta?: PortaDosCreditos }) {
    this.reserva = o.reserva;
    this.porNo = o.porNo;
    this.userId = o.userId;
    this.porta = o.porta;
  }

  /** Devolve a parte do nó (falha não cobra). */
  async devolverNo(noId: string, execucaoId: string | null, motivo: string): Promise<void> {
    if (!this.reserva || this.devolvidos.has(noId)) return;
    const valor = num(this.porNo[noId]);
    this.devolvidos.add(noId);
    if (!(valor > 0)) return;
    await estornarCreditos(this.reserva, { valor, execucaoId, nota: `Falha não cobra: ${motivo}`.slice(0, 400), userId: this.userId }, this.porta);
  }

  /** Devolve tudo o que ainda não voltou (a confirmação nem chegou a rodar). */
  async devolverTudo(motivo: string): Promise<void> {
    if (!this.reserva) return;
    for (const id of Object.keys(this.porNo)) this.devolvidos.add(id);
    await estornarCreditos(this.reserva, { valor: null, nota: `Falha não cobra: ${motivo}`.slice(0, 400), userId: this.userId }, this.porta);
  }
}

/** O saldo e o estado da carteira do Laboratório (sem debitar). Banco sem a carteira: null. */
export type LerCarteira = () => Promise<{ saldo: number; ativa: boolean } | null>;
const lerCarteiraPadrao: LerCarteira = async () => {
  try {
    const { data, error } = await servico().from("lab_carteira").select("saldo_usd, ativa").eq("id", true).maybeSingle();
    if (error || !data) return null;
    const c = data as { saldo_usd: unknown; ativa: unknown };
    return { saldo: arred(num(c.saldo_usd)), ativa: c.ativa === true };
  } catch {
    return null;
  }
};

/**
 * Confere o saldo SEM debitar (20/10): carteira ativa com saldo menor que o valor lança 402 sem_credito. Inativa ou
 * sem a carteira no banco: passa (como a reserva).
 */
export async function conferirSaldo(valor: number, ler: LerCarteira = lerCarteiraPadrao): Promise<void> {
  const v = arred(num(valor));
  if (!(v > 0)) return;
  const c = await ler();
  if (c && c.ativa && c.saldo < v) {
    throw new ErroHttp(402, "sem_credito", `Sem crédito no Laboratório: o saldo é ${usd(c.saldo)} e isto custa ${usd(v)}. Carregue créditos para rodar.`, { saldo_usd: c.saldo, custo_usd: v });
  }
}

/**
 * Reserva o total da confirmação e guarda a parte de cada nó.
 * 20/10 (cobrança dupla): `foraDaReserva` são os nós que a própria estudio-arte cobra da carteira do Laboratório pelo
 * custo real (Resultado e Carrossel no motor da casa num projeto SEM cliente: migration 20261020002646). Eles não
 * entram na reserva nem no estorno; o saldo é conferido sem debitar (402 sem_credito antes de rodar).
 */
export async function cobrarConfirmacao(
  o: { porNo: Array<{ no_id: string | null; custo_usd: number }>; total: number; projetoId: string; nota: string; userId: string; foraDaReserva?: string[] },
  porta?: PortaDosCreditos,
  lerCarteira?: LerCarteira,
): Promise<CobrancaDoLab> {
  const fora = o.foraDaReserva || [];
  const partes: Record<string, number> = {};
  let deFora = 0;
  for (const p of o.porNo) {
    if (!p.no_id) continue;
    if (fora.indexOf(p.no_id) >= 0) {
      deFora = arred(deFora + num(p.custo_usd));
      continue;
    }
    partes[p.no_id] = arred(num(partes[p.no_id]) + num(p.custo_usd));
  }
  if (deFora > 0) await conferirSaldo(num(o.total), lerCarteira);
  const valor = arred(Math.max(0, num(o.total) - deFora));
  const reserva = await reservarCreditos({ valor, projetoId: o.projetoId, nota: o.nota, userId: o.userId }, porta);
  return new CobrancaDoLab({ reserva, porNo: partes, userId: o.userId, porta });
}

// ------------------------------------------------------------------ extrato (ações creditos e creditos_carregar)

export type Movimento = {
  id: string;
  tipo: "carga" | "uso" | "estorno" | "ajuste";
  valor_usd: number;
  saldo_depois: number;
  projeto_id: string | null;
  execucao_id: string | null;
  nota: string | null;
  criado_por: string | null;
  criado_em: string;
};

/** Primeiro dia do mês em Brasília (UTC-3), em ISO. */
export function inicioDoMes(agora = new Date()): string {
  const br = new Date(agora.getTime() - 3 * 3600 * 1000);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), 1, 3, 0, 0)).toISOString();
}

/** Gasto líquido (uso menos estorno) no total e por projeto, maior primeiro. */
export function gastoDosMovimentos(movs: Array<Pick<Movimento, "tipo" | "valor_usd" | "projeto_id">>): { total: number; porProjeto: Array<{ projeto_id: string | null; gasto_usd: number }> } {
  const por = new Map<string, number>();
  let total = 0;
  for (const m of movs) {
    const sinal = m.tipo === "uso" ? 1 : m.tipo === "estorno" ? -1 : 0;
    if (!sinal) continue;
    const v = sinal * num(m.valor_usd);
    total += v;
    const k = m.projeto_id || "";
    por.set(k, num(por.get(k)) + v);
  }
  const porProjeto = [...por.entries()]
    .map(([k, v]) => ({ projeto_id: k || null, gasto_usd: arred(Math.max(0, v)) }))
    .filter((p) => p.gasto_usd > 0)
    .sort((a, b) => b.gasto_usd - a.gasto_usd);
  return { total: arred(Math.max(0, total)), porProjeto };
}

const CAMPOS_DO_MOVIMENTO = "id, tipo, valor_usd, saldo_depois, projeto_id, execucao_id, nota, criado_por, criado_em";

/** creditos {} → { saldo_usd, ativa, pode_carregar, movimentos (50), gasto_mes_usd, por_projeto, disponivel }. */
export async function lerCreditos(ch: Chamador): Promise<Response> {
  const db = servico();
  const podeCarregar = ch.papeis.indexOf("admin") >= 0;
  const { data: carteira, error } = await db.from("lab_carteira").select("saldo_usd, ativa, atualizado_em").eq("id", true).maybeSingle();
  if (error) {
    if (semCreditosNoBanco(error)) return json({ disponivel: false, saldo_usd: 0, ativa: false, pode_carregar: podeCarregar, movimentos: [], gasto_mes_usd: 0, por_projeto: [] });
    throw erroDoBanco(error, "creditos_indisponiveis", "Não consegui ler os créditos do Laboratório agora.");
  }
  const c = (carteira || {}) as { saldo_usd?: unknown; ativa?: unknown; atualizado_em?: unknown };
  const [ultimos, doMes] = await Promise.all([
    db.from("lab_creditos_movimentos").select(CAMPOS_DO_MOVIMENTO).order("criado_em", { ascending: false }).limit(50),
    db.from("lab_creditos_movimentos").select("tipo, valor_usd, projeto_id").gte("criado_em", inicioDoMes()).in("tipo", ["uso", "estorno"]).limit(5000),
  ]);
  if (ultimos.error) throw erroDoBanco(ultimos.error, "creditos_indisponiveis", "Não consegui ler o extrato do Laboratório agora.");
  if (doMes.error) throw erroDoBanco(doMes.error, "creditos_indisponiveis", "Não consegui ler o gasto do mês agora.");
  const movimentos = ((ultimos.data || []) as Array<Record<string, unknown>>).map((m) => ({ ...m, valor_usd: num(m.valor_usd), saldo_depois: num(m.saldo_depois) })) as Movimento[];
  const gasto = gastoDosMovimentos((doMes.data || []) as Movimento[]);

  // Nome dos projetos (de cliente, só se esta pessoa acessa o cliente).
  const ids = [...new Set(movimentos.map((m) => m.projeto_id).concat(gasto.porProjeto.map((p) => p.projeto_id)).filter((x): x is string => !!x))];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data: projetos } = await db.from("lab_projetos").select("id, nome, client_id").in("id", ids);
    const linhas = (projetos || []) as Array<{ id: string; nome: string; client_id: string | null }>;
    const clientes = [...new Set(linhas.map((l) => l.client_id).filter((x): x is string => !!x))];
    const pode = new Set<string>();
    for (const cl of clientes) {
      const { data: ok } = await ch.doChamador.rpc("can_access_client", { _client_id: cl });
      if (ok === true) pode.add(cl);
    }
    for (const l of linhas) nomes.set(l.id, !l.client_id || pode.has(l.client_id) ? l.nome : "Projeto de outro cliente");
  }
  const nomeDe = (id: string | null) => (id ? nomes.get(id) ?? "Projeto apagado" : null);
  return json({
    disponivel: true,
    saldo_usd: arred(num(c.saldo_usd)),
    ativa: c.ativa === true,
    atualizado_em: c.atualizado_em ?? null,
    pode_carregar: podeCarregar,
    movimentos: movimentos.map((m) => ({ ...m, projeto_nome: nomeDe(m.projeto_id) })),
    gasto_mes_usd: gasto.total,
    por_projeto: gasto.porProjeto.slice(0, 20).map((p) => ({ ...p, projeto_nome: nomeDe(p.projeto_id) || "Sem projeto" })),
  });
}

/** Valor da carga: de 1 a 10.000 (US$), até centavos. */
export function valorDaCarga(v: unknown): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 10000) throw new ErroHttp(400, "valor_invalido", "Carregue de US$ 1 a US$ 10.000.");
  return Math.round(n * 100) / 100;
}

/** creditos_carregar { valor_usd, nota? } (só admin) → { saldo_usd, ativa, movimento_id }. Registro manual, sem pagamento. */
export async function carregarCreditos(ch: Chamador, corpo: Record<string, unknown>, porta: PortaDosCreditos = portaPadrao()): Promise<Response> {
  if (ch.papeis.indexOf("admin") < 0) throw new ErroHttp(403, "somente_admin", "Só o admin carrega créditos do Laboratório.");
  const valor = valorDaCarga(corpo.valor_usd ?? corpo.valor);
  const { data, error } = await porta.rpc("lab_creditos_carregar", { p_valor: valor, p_nota: limpo(corpo.nota, 400) || null, p_ator: ch.userId });
  if (error) {
    if (semCreditosNoBanco(error)) throw new ErroHttp(503, "banco_sem_creditos", "O banco ainda não tem os créditos do Laboratório (migration 20261020050000_laboratorio_creditos.sql pendente).");
    if (/LAB_CREDITOS_SO_ADMIN/.test(String(error.message || ""))) throw new ErroHttp(403, "somente_admin", "Só o admin carrega créditos do Laboratório.");
    throw erroDoBanco(error, "carga_nao_registrada", "Não consegui registrar a carga agora. Nada mudou.");
  }
  const r = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return json({ saldo_usd: arred(num(r.saldo_usd)), ativa: r.ativa === true, movimento_id: r.movimento_id ?? null, primeira: r.primeira === true });
}

/** creditos_limite { ativa } (só admin) → { saldo_usd, ativa }. Desligado: o uso só fica registrado, sem bloquear. */
export async function definirLimite(ch: Chamador, corpo: Record<string, unknown>, porta: PortaDosCreditos = portaPadrao()): Promise<Response> {
  if (ch.papeis.indexOf("admin") < 0) throw new ErroHttp(403, "somente_admin", "Só o admin liga ou desliga o limite do Laboratório.");
  if (typeof corpo.ativa !== "boolean") throw new ErroHttp(400, "ativa_invalida", "Diga se o limite fica ligado (ativa: true) ou desligado (ativa: false).");
  const { data, error } = await porta.rpc("lab_creditos_limite", { p_ativa: corpo.ativa, p_ator: ch.userId });
  if (error) {
    if (semCreditosNoBanco(error)) throw new ErroHttp(503, "banco_sem_creditos", "O banco ainda não tem os créditos do Laboratório (migration 20261020050000_laboratorio_creditos.sql pendente).");
    throw erroDoBanco(error, "limite_nao_salvo", "Não consegui mudar o limite agora. Nada mudou.");
  }
  const r = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return json({ saldo_usd: arred(num(r.saldo_usd)), ativa: r.ativa === true });
}
