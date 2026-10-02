/**
 * refazer_proposta_interno (02/10): refazer no servidor uma proposta do Mês
 * com as regras novas (cadência e mistura conferidas, peça de foto, sem
 * tutorial), sem o dono clicar. Chamada interna: só com a chave de serviço no
 * Authorization E o x-cron-secret do projeto (CRON_SECRET, do ambiente ou do
 * cofre do painel). Quem assina a proposta nova é o autor da antiga, que
 * precisa ser da equipe e ter acesso ao cliente (a mesma regra de
 * can_access_client, conferida aqui do lado do serviço). Nunca grava na
 * agenda e nunca apaga a antiga.
 *
 * Aqui só a parte pura (sem Deno nem npm): o index.ts usa e os testes leem.
 */

import type { FormatoDoMes } from "./peca-de-foto.ts";
import { formatoDoMes, normalizarDirecaoDeFoto, type DirecaoDeFoto } from "./peca-de-foto.ts";

export const ACAO_REFAZER_INTERNO = "refazer_proposta_interno";

/** Comparação em tempo constante para o mesmo tamanho (não revela até onde acertou). */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = String(a || "");
  const y = String(b || "");
  if (!x || x.length !== y.length) return false;
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return dif === 0;
}

export type AutorizacaoInterna = { ok: true } | { ok: false; status: 401 | 403; codigo: string; mensagem: string };

/**
 * A chamada interna só passa com as duas provas: o Authorization com a chave
 * de serviço (uma das chaves aceitas pelo runtime) e o x-cron-secret igual ao
 * segredo do projeto. Sem segredo configurado, nada passa.
 */
export function autorizarChamadaInterna(e: {
  authorization: string | null | undefined;
  cronSecretDoPedido: string | null | undefined;
  chavesDeServico: Array<string | null | undefined>;
  cronSecret: string | null | undefined;
}): AutorizacaoInterna {
  const segredo = String(e.cronSecret || "").trim();
  const enviado = String(e.cronSecretDoPedido || "").trim();
  if (!segredo || !enviado || !iguaisEmTempoConstante(enviado, segredo)) {
    return { ok: false, status: 401, codigo: "chamada_interna_sem_segredo", mensagem: "Chamada interna sem o x-cron-secret do projeto." };
  }
  const token = String(e.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const chaves = e.chavesDeServico.map((c) => String(c || "").trim()).filter(Boolean);
  // 02/10: a chave de serviço pode estar noutra versão que a do ambiente (as duas valem). A função tem
  // verify_jwt = true: o gateway já conferiu a assinatura, então um JWT com role service_role também serve.
  if (!token || !(chaves.some((c) => iguaisEmTempoConstante(token, c)) || papelDoJwt(token) === "service_role")) {
    return { ok: false, status: 403, codigo: "chamada_interna_sem_servico", mensagem: "Chamada interna só com a chave de serviço no Authorization." };
  }
  return { ok: true };
}

/**
 * A regra de can_access_client para um usuário dado (sem auth.uid()): admin
 * vê todos; manager, design e traffic só os clientes atribuídos
 * (team_client_assignments). Antes disso, is_staff precisa ser verdadeiro.
 */
export function criadorPodeRefazer(e: { staff: boolean; papeis: string[]; atribuido: boolean }): { ok: boolean; motivo: string | null } {
  if (!e.staff) return { ok: false, motivo: "O autor da proposta não é da equipe." };
  if (e.papeis.indexOf("admin") >= 0) return { ok: true, motivo: null };
  const daEquipe = e.papeis.some((p) => p === "manager" || p === "design" || p === "traffic");
  if (daEquipe && e.atribuido) return { ok: true, motivo: null };
  return { ok: false, motivo: "O autor da proposta não tem acesso a este cliente." };
}

/** Orientação que valia para o lote ("Orientação da equipe para todos: ..."), lida da mensagem guardada. */
export function orientacaoDaMensagem(mensagem: unknown): string {
  const m = /Orienta[çc][ãa]o da equipe para tod[oa]s:\s*([\s\S]+)$/i.exec(String(mensagem ?? ""));
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 600) : "";
}

export type ItemAntigo = { data?: unknown; formato?: unknown; tema?: unknown; gancho?: unknown; resumo?: unknown; foto?: unknown };
export type LinhaRefeita = { data: string; formato: FormatoDoMes; formato_pedido: null; tema: string; referencia: string; foto?: DirecaoDeFoto | null };

/** Os itens da proposta antiga viram as linhas da criação (data, formato, tema e a ideia como referência). */
export function linhasDaPropostaAntiga(itens: ItemAntigo[]): LinhaRefeita[] {
  const saida: LinhaRefeita[] = [];
  for (const i of itens || []) {
    const data = String(i.data ?? "").slice(0, 10);
    const tema = String(i.tema ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !tema) continue;
    const formato = formatoDoMes(i.formato) ?? "carrossel";
    const referencia = [i.gancho, i.resumo].map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ").slice(0, 600);
    const linha: LinhaRefeita = { data, formato, formato_pedido: null, tema, referencia };
    if (formato === "foto") linha.foto = normalizarDirecaoDeFoto(i.foto, { tema });
    saida.push(linha);
  }
  return saida.sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Corpo do pedido livre de um lote refeito: os parâmetros guardados da
 * proposta antiga (anexos, campanha, modelo, projeto) e as linhas do lote
 * (pecas, que fixam data, formato e direção da foto).
 */
export function corpoDoLoteRefeito(
  antiga: { client_id: string; project_id: string | null; parametros: Record<string, unknown> | null },
  mensagem: string,
  pecas: LinhaRefeita[],
): Record<string, unknown> {
  const p = antiga.parametros || {};
  const corpo: Record<string, unknown> = { acao: "pedido_livre", client_id: antiga.client_id, mensagem, pecas };
  if (Array.isArray(p.anexos) && p.anexos.length) corpo.anexos = p.anexos.slice(0, 6);
  if (typeof p.campanha_id === "string" && p.campanha_id) corpo.campanha_id = p.campanha_id;
  if (typeof p.modelo === "string" && p.modelo) corpo.modelo_id = p.modelo;
  if (antiga.project_id) corpo.project_id = antiga.project_id;
  return corpo;
}

/** Papel ("role") do JWT, sem conferir assinatura (quem confere é o gateway, verify_jwt = true). */
export function papelDoJwt(token: string): string | null {
  const partes = String(token || "").split(".");
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "===".slice((b64.length + 3) % 4)));
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}
