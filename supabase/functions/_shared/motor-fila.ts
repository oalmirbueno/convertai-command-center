/**
 * Fila do motor de código no banco (frente SIT, 30/09/2026). As regras puras
 * estão em motor-codigo.ts; aqui ficam as leituras e gravações com a
 * service_role, usadas pela função motor-codigo e pelo agente da Mesa Site
 * (mudança por conversa vira trabalho do motor, com Parar). Nunca roda o
 * agente: só grava o pedido, a reserva e o estado.
 *
 * O banco chega por parâmetro (roda no vitest com banco falso).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  efeitoDoParar,
  ehEstado,
  estimarTrabalho,
  gasta,
  type ModeloDoMotor,
  modeloServeParaCodigo,
  motivoParaRecusar,
  normalizarPedido,
  normalizarTrabalho,
  type PedidoDoMotor,
  podeDesfazer,
  reservaAberta,
  saldoLivre,
  type TrabalhoDoMotor,
} from "./motor-codigo.ts";

export class ErroDoMotor extends Error {
  status: number;
  codigo: string;
  extra: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, extra: Record<string, unknown> = {}) {
    super(mensagem);
    this.name = "ErroDoMotor";
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

export const CAMPOS_DO_TRABALHO =
  "id, client_id, marca_id, mesa, projeto, referencia_tipo, referencia_id, tipo, estado, modelo, instrucao, teto_usd, estimativa_usd, custo_usd, preview_url, preview_expira_em, commit, commit_anterior, zip_path, resultado, erro, executor, pego_em, terminado_em, criado_em";

const semTabela = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /motor_(trabalhos|eventos|executores).*(does not exist|schema cache)/i.test(String(e.message || "")));

export const AVISO_SEM_MOTOR = "O banco ainda não tem a fila do motor de código (migration 20260930090000 pendente).";

/** O modelo do trabalho: o escolhido na tela quando serve para código; senão o padrão do papel `site`. */
export async function modeloDoMotor(db: SupabaseClient, escolhidoId: string | null | undefined): Promise<ModeloDoMotor | null> {
  const campos = "id, provedor, modelo_api, tipo, ativo, preco_entrada_1m, preco_saida_1m, preco_cache_1m, contexto_tokens, padrao_para";
  if (escolhidoId) {
    const { data } = await db.from("ia_modelos").select(campos).eq("id", escolhidoId).maybeSingle();
    if (!data) throw new ErroDoMotor(404, "modelo_inexistente", "Esse modelo não está no catálogo.");
    if (!modeloServeParaCodigo(data as never)) throw new ErroDoMotor(400, "modelo_nao_serve", "Esse modelo não serve para o motor de código (precisa de texto, preço no catálogo e contexto grande).");
    return data as ModeloDoMotor;
  }
  for (const papel of ["site", "estrategista"]) {
    const { data } = await db.from("ia_modelos").select(campos).eq("ativo", true).contains("padrao_para", [papel]).limit(3);
    const achado = ((data as Array<Record<string, unknown>> | null) ?? []).find((m) => modeloServeParaCodigo(m as never));
    if (achado) return achado as unknown as ModeloDoMotor;
  }
  return null;
}

export async function saldoDaCarteira(db: SupabaseClient, clientId: string): Promise<number> {
  const { data, error } = await db.from("ia_carteiras").select("saldo_usd").eq("client_id", clientId).maybeSingle();
  if (error) throw new ErroDoMotor(503, "carteira_indisponivel", "Não foi possível ler a carteira agora.");
  return Number((data as { saldo_usd?: unknown } | null)?.saldo_usd) || 0;
}

export async function reservaDoCliente(db: SupabaseClient, clientId: string): Promise<number> {
  const { data, error } = await db.from("motor_trabalhos").select("estado, teto_usd, custo_usd").eq("client_id", clientId).in("estado", ["na_fila", "executando", "parando"]);
  if (error) {
    if (semTabela(error)) throw new ErroDoMotor(503, "banco_sem_motor", AVISO_SEM_MOTOR);
    throw new ErroDoMotor(503, "fila_indisponivel", "Não foi possível ler a fila do motor agora.");
  }
  return reservaAberta((data as Array<{ estado: string; teto_usd: unknown; custo_usd: unknown }>) ?? []);
}

export type OrcamentoDoPedido = {
  pedido: PedidoDoMotor;
  modelo: ModeloDoMotor | null;
  estimativa_usd: number;
  teto_sugerido_usd: number;
  passos: number;
  saldo_usd: number;
  reservado_usd: number;
  livre_usd: number;
};

/** Estimativa sem gravar nada (a tela mostra o custo antes). */
export async function orcar(db: SupabaseClient, clientId: string, bruto: unknown, modeloId: string | null | undefined): Promise<OrcamentoDoPedido> {
  const pedido = normalizarPedido(bruto);
  const modelo = gasta(pedido.tipo) ? await modeloDoMotor(db, modeloId) : null;
  const est = estimarTrabalho(modelo, pedido.tipo, pedido.secoes.length || 1);
  const [saldo, reservado] = await Promise.all([saldoDaCarteira(db, clientId), reservaDoCliente(db, clientId)]);
  return { pedido, modelo, estimativa_usd: est.estimativa_usd, teto_sugerido_usd: est.teto_sugerido_usd, passos: est.passos, saldo_usd: saldo, reservado_usd: reservado, livre_usd: saldoLivre(saldo, reservado) };
}

export type NovoTrabalho = {
  clientId: string;
  marcaId: string | null;
  mesa: "site";
  projeto: string;
  referencia: { tipo: string; id: string } | null;
  pedidoBruto: unknown;
  modeloId: string | null;
  /** Pacote do site (kit da marca, DNA, copy, imagens) que o worker escreve no projeto. */
  pacote: Record<string, unknown>;
  userId: string;
};

/** Grava o pedido na fila com o teto reservado. Recusa com motivo claro, antes de gravar. */
export async function criarTrabalho(db: SupabaseClient, n: NovoTrabalho): Promise<{ trabalho: TrabalhoDoMotor; orcamento: OrcamentoDoPedido }> {
  const o = await orcar(db, n.clientId, n.pedidoBruto, n.modeloId);
  const recusa = motivoParaRecusar(o.pedido, { estimativaUsd: o.estimativa_usd, saldoLivreUsd: o.livre_usd, temModelo: !!o.modelo });
  if (recusa) {
    throw new ErroDoMotor(recusa.codigo === "saldo_insuficiente" ? 402 : 400, recusa.codigo, recusa.mensagem, {
      estimativa_usd: o.estimativa_usd,
      teto_sugerido_usd: o.teto_sugerido_usd,
      saldo_usd: o.saldo_usd,
      reservado_usd: o.reservado_usd,
      livre_usd: o.livre_usd,
    });
  }
  let commitAlvo: { commit: string | null; commit_anterior: string | null } | null = null;
  if (o.pedido.tipo === "desfazer" && o.pedido.alvo_trabalho_id) {
    const { data: alvo } = await db.from("motor_trabalhos").select(CAMPOS_DO_TRABALHO).eq("id", o.pedido.alvo_trabalho_id).maybeSingle();
    const t = normalizarTrabalho(alvo);
    if (!t || t.client_id !== n.clientId || t.projeto !== n.projeto) throw new ErroDoMotor(404, "trabalho_inexistente", "Trabalho não encontrado neste site.");
    if (!podeDesfazer(t)) throw new ErroDoMotor(409, "nao_desfaz", "Este trabalho não tem o que desfazer (sem commit ou ainda rodando).");
    commitAlvo = { commit: t.commit, commit_anterior: t.commit_anterior };
  }
  const linha = {
    client_id: n.clientId,
    marca_id: n.marcaId,
    mesa: n.mesa,
    projeto: n.projeto,
    referencia_tipo: n.referencia ? n.referencia.tipo : null,
    referencia_id: n.referencia ? n.referencia.id : null,
    tipo: o.pedido.tipo,
    estado: "na_fila",
    modelo: o.modelo ? o.modelo.id : null,
    instrucao: o.pedido.instrucao,
    pedido: {
      secoes: o.pedido.secoes,
      secao: o.pedido.secao,
      alvo_trabalho_id: o.pedido.alvo_trabalho_id,
      alvo: commitAlvo,
      modelo: o.modelo ? { id: o.modelo.id, provedor: o.modelo.provedor, modelo_api: o.modelo.modelo_api, preco_entrada_1m: o.modelo.preco_entrada_1m, preco_saida_1m: o.modelo.preco_saida_1m, preco_cache_1m: o.modelo.preco_cache_1m ?? null } : null,
      pacote: n.pacote,
    },
    teto_usd: gasta(o.pedido.tipo) ? o.pedido.teto_usd : 0,
    estimativa_usd: o.estimativa_usd,
    criado_por: n.userId,
  };
  const { data, error } = await db.from("motor_trabalhos").insert(linha).select(CAMPOS_DO_TRABALHO).single();
  if (error) {
    if (semTabela(error)) throw new ErroDoMotor(503, "banco_sem_motor", AVISO_SEM_MOTOR);
    throw new ErroDoMotor(503, "fila_indisponivel", "Não foi possível pôr o trabalho na fila agora.");
  }
  const trabalho = normalizarTrabalho(data)!;
  await gravarEvento(db, trabalho, "estado", "Na fila: esperando o motor");
  return { trabalho, orcamento: o };
}

export async function gravarEvento(db: SupabaseClient, t: Pick<TrabalhoDoMotor, "id" | "client_id">, tipo: string, resumo: string, dados: Record<string, unknown> = {}) {
  const { error } = await db.from("motor_eventos").insert({ trabalho_id: t.id, client_id: t.client_id, tipo, resumo: resumo.slice(0, 300) || "-", dados });
  if (error) console.error("[motor-fila] evento não gravado", { trabalho_id: t.id, codigo: error.code ?? null });
}

export async function lerTrabalho(db: SupabaseClient, id: string): Promise<TrabalhoDoMotor> {
  const { data, error } = await db.from("motor_trabalhos").select(CAMPOS_DO_TRABALHO).eq("id", id).maybeSingle();
  if (error) {
    if (semTabela(error)) throw new ErroDoMotor(503, "banco_sem_motor", AVISO_SEM_MOTOR);
    throw new ErroDoMotor(503, "fila_indisponivel", "Não foi possível ler o trabalho agora.");
  }
  const t = normalizarTrabalho(data);
  if (!t) throw new ErroDoMotor(404, "trabalho_inexistente", "Trabalho não encontrado.");
  return t;
}

/** Parar: na fila vira cancelado na hora; rodando vira "parando" e o worker aborta a sessão. */
export async function pararTrabalho(db: SupabaseClient, t: TrabalhoDoMotor, userId: string): Promise<TrabalhoDoMotor> {
  const novo = efeitoDoParar(t.estado);
  if (!novo) return t;
  const campos: Record<string, unknown> = { estado: novo, parar_pedido_em: new Date().toISOString(), parar_pedido_por: userId };
  if (novo === "cancelado") campos.terminado_em = new Date().toISOString();
  const { data, error } = await db.from("motor_trabalhos").update(campos).eq("id", t.id).eq("estado", t.estado).select(CAMPOS_DO_TRABALHO).maybeSingle();
  if (error) throw new ErroDoMotor(503, "fila_indisponivel", "Não foi possível parar agora.");
  if (!data) return await lerTrabalho(db, t.id);
  const atual = normalizarTrabalho(data)!;
  await gravarEvento(db, atual, "estado", novo === "cancelado" ? "Cancelado antes de começar" : "Parar pedido: o motor encerra no próximo passo");
  return atual;
}

export async function trabalhosDoProjeto(db: SupabaseClient, clientId: string, referenciaId: string, limite = 30): Promise<TrabalhoDoMotor[]> {
  const { data, error } = await db.from("motor_trabalhos").select(CAMPOS_DO_TRABALHO).eq("client_id", clientId).eq("referencia_id", referenciaId).order("criado_em", { ascending: false }).limit(limite);
  if (error) {
    if (semTabela(error)) throw new ErroDoMotor(503, "banco_sem_motor", AVISO_SEM_MOTOR);
    throw new ErroDoMotor(503, "fila_indisponivel", "Não foi possível ler a fila agora.");
  }
  return ((data as unknown[]) ?? []).map(normalizarTrabalho).filter((t): t is TrabalhoDoMotor => !!t);
}

export async function eventosDoTrabalho(db: SupabaseClient, trabalhoId: string, desde = 0, limite = 200) {
  const { data, error } = await db.from("motor_eventos").select("id, tipo, resumo, dados, em").eq("trabalho_id", trabalhoId).gt("id", desde).order("id", { ascending: true }).limit(limite);
  if (error) throw new ErroDoMotor(503, "fila_indisponivel", "Não foi possível ler os eventos agora.");
  return (data as Array<{ id: number; tipo: string; resumo: string; dados: Record<string, unknown>; em: string }>) ?? [];
}

export async function executorDoMotor(db: SupabaseClient): Promise<{ nome: string; visto_em: string; versao: string | null; capacidades: Record<string, unknown> } | null> {
  const { data, error } = await db.from("motor_executores").select("nome, visto_em, versao, capacidades").order("visto_em", { ascending: false }).limit(1);
  if (error) return null;
  return ((data as Array<{ nome: string; visto_em: string; versao: string | null; capacidades: Record<string, unknown> }>) ?? [])[0] ?? null;
}

export { ehEstado };
