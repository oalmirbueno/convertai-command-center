/**
 * Ponte do aprendizado com o banco e o Jev (as regras puras moram em
 * aprendizado-do-pedido.ts). Usado pelos agentes da Mesa do cliente:
 * contexto, Mês, campanha, redes e perfil.
 *
 * - lerRegrasDoDono: as regras ativas do cliente para o prompt (evitar
 *   primeiro), sem regra de outra marca.
 * - aprenderComOPedido: o Jev decide se a regra que o modelo leu no pedido
 *   vale para sempre; se vale, grava pelo cérebro (reforça em vez de
 *   duplicar) e devolve o anexo "Aprendi".
 *
 * Nada aqui derruba a conversa: falha vira log com motivo e a resposta segue.
 */
import { jevPerguntar, type PerguntaJev, type ResultadoJev } from "./jev.ts";
import { gravarNoCerebro } from "./cerebro-nas-mesas.ts";
import type { AreaDoCerebro, BancoDoCerebro } from "./cerebro-do-cliente.ts";
import { registrarFalha } from "./falha-registrada.ts";
import {
  type AnexoDoAprendizado,
  anexoDoAprendizado,
  type AreaDaRegra,
  decidirAprendizado,
  type DecisaoDoAprendizado,
  decisaoSemJev,
  type LinhaDaRegra,
  perguntasDoAprendizado,
  type RegraComApelido,
  type RegraProposta,
  referenciaDaMarca,
  regrasParaOAgente,
} from "./aprendizado-do-pedido.ts";

/** O Jev decide rápido: a conversa não espera mais que isto pelo aprendizado. */
export const TIMEOUT_JEV_DO_APRENDIZADO_MS = 8_000;

const COLUNAS_DAS_REGRAS = "id, texto, tipo, categoria, area, agente, reforcos, criado_em, reforcado_em, referencia_id, evidencia, ativa, valido_ate";

/** Regras ativas do cliente para as áreas do agente (mais a geral), da marca aberta. Nunca lança. */
export async function lerRegrasDoDono(db: BancoDoCerebro, clientId: string, opcoes: { areas: AreaDaRegra[]; marcaId?: unknown }): Promise<RegraComApelido[]> {
  try {
    const [memoria, marcas] = await Promise.all([
      db.from("agente_memoria").select(COLUNAS_DAS_REGRAS).eq("client_id", clientId).eq("ativa", true).order("criado_em", { ascending: false }).limit(200),
      db.from("cliente_marcas").select("id").eq("client_id", clientId),
    ]);
    if (memoria.error) {
      registrarFalha("aprendizado: regras nao lidas", memoria.error, { client_id: clientId });
      return [];
    }
    const ids = marcas && !marcas.error ? ((marcas.data || []) as Array<{ id: string }>).map((m) => String(m.id)) : [];
    return regrasParaOAgente((memoria.data || []) as LinhaDaRegra[], { areas: opcoes.areas, marcaId: referenciaDaMarca(opcoes.marcaId), marcasDoCliente: ids });
  } catch (e) {
    registrarFalha("aprendizado: regras nao lidas", e, { client_id: clientId });
    return [];
  }
}

export type ResultadoDoAprendizado = { anexo: AnexoDoAprendizado | null; decisao: DecisaoDoAprendizado | null; erro: string | null };

/**
 * O pedido ensina uma regra duradoura? Grava e devolve o anexo; senão, nada.
 * `regra` é o que o modelo do agente escreveu (null: nem pergunta ao Jev).
 */
export async function aprenderComOPedido(
  db: BancoDoCerebro,
  entrada: {
    clientId: string;
    mensagem: string;
    regra: RegraProposta | null;
    agente: string;
    areas: AreaDaRegra[];
    areaPadrao: AreaDaRegra;
    marcaId?: unknown;
    userId: string | null;
    fonte: string;
    historico?: string[];
    /** Cobra o Jev na carteira do cliente (quem chama passa o cobrarJev do motor). Falha só vai para o log. */
    cobrar?: (r: ResultadoJev) => Promise<unknown>;
  },
): Promise<ResultadoDoAprendizado> {
  if (!entrada.regra) return { anexo: null, decisao: null, erro: null };
  const regra = entrada.regra;
  let decisao: DecisaoDoAprendizado;
  try {
    const { state, questions } = perguntasDoAprendizado({ mensagem: entrada.mensagem, regra, agente: entrada.agente, areas: entrada.areas, historico: entrada.historico });
    const r = await jevPerguntar({ state, questions: questions as unknown as Record<string, PerguntaJev> }, { timeoutMs: TIMEOUT_JEV_DO_APRENDIZADO_MS });
    if (entrada.cobrar) await entrada.cobrar(r).catch((e) => registrarFalha("aprendizado: jev nao cobrado", e, { agente: entrada.agente }));
    decisao = decidirAprendizado(r.answers, { regra, areas: entrada.areas, areaPadrao: entrada.areaPadrao });
  } catch (e) {
    registrarFalha("aprendizado: jev falhou (vale a regra da ordem explícita)", e, { agente: entrada.agente });
    decisao = decisaoSemJev(entrada.mensagem, regra, entrada.areaPadrao);
  }
  if (!decisao.grava) return { anexo: null, decisao, erro: null };
  const marca = referenciaDaMarca(entrada.marcaId);
  const g = await gravarNoCerebro(db, {
    client_id: entrada.clientId,
    area: decisao.area as AreaDoCerebro,
    categoria: decisao.categoria,
    texto: regra.texto,
    motivo: `Pedido do dono ao agente ${entrada.agente}: ${String(entrada.mensagem || "").replace(/\s+/g, " ").trim().slice(0, 300)}`,
    fonte: entrada.fonte,
    criado_por: entrada.userId,
    referencia_id: marca,
  });
  if (!g.gravada) return { anexo: null, decisao, erro: g.erro };
  return { anexo: anexoDoAprendizado(g, regra, decisao, marca), decisao, erro: null };
}
