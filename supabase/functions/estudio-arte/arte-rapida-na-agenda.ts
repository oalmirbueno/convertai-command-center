/**
 * Frente AE (28/09): a arte rápida vai para a Agenda.
 *
 * Pedido do dono: "no fim leva para o mês ou calendário (pergunta a data,
 * confirma, envia)". O item nasce pelo MESMO escritor editorial do agente do
 * Mês e do post de fotos (createEditorialItem), com escopo só deste cliente e
 * idempotência pelo pedido (o mesmo clique repetido não cria dois itens).
 * Depois o trabalho ganha o task_id e segue o fluxo de sempre: entrega em
 * Arquivos, post da Agenda, data confirmada e aprovação do cliente.
 *
 * Só as funções (Deno) usam este arquivo: ele importa o escritor do MCP.
 */
import { createEditorialItem, createEditorialItemSchema, type WriteCtx } from "../_shared/mcp-write-services.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import { projetoDoPostDeFotos } from "../_shared/post-de-fotos-item.ts";
import type { BancoDoPost } from "../_shared/post-de-fotos.ts";

export const PRINCIPAL_ARTE_RAPIDA = "mesa:arte-rapida";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class ErroDoItemDaArte extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

/** Data de hoje em São Paulo (AAAA-MM-DD). */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  const local = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/** A data escolhida vale: formato certo, dia que existe e não no passado. */
export function dataDaAgendaValida(data: string, hoje: string): boolean {
  if (!DATA.test(data)) return false;
  const d = new Date(`${data}T12:00:00Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== data) return false;
  return data >= hoje;
}

/**
 * Cria (ou reencontra) o item da Agenda da arte rápida. `projetoId`: o da
 * marca do trabalho (Acerbi ou CME); sem ele, o projeto editorial mais recente.
 */
export async function criarItemDaArteRapida(db: BancoDoPost, p: {
  clientId: string;
  userId: string;
  titulo: string;
  data: string;
  carrossel: boolean;
  pedidoId: string;
  descricao: string;
  projetoId?: string | null;
}): Promise<{ task_id: string; project_id: string; title: string; due_date: string; replayed: boolean }> {
  if (!UUID.test(p.clientId)) throw new ErroDoItemDaArte(400, "client_id_invalido", "Cliente inválido.");
  if (!DATA.test(p.data)) throw new ErroDoItemDaArte(400, "data_invalida", "Escolha a data do post (AAAA-MM-DD).");
  const titulo = String(p.titulo || "").replace(/\s+/g, " ").trim().slice(0, 200) || "Arte rápida";
  const pedido = String(p.pedidoId || "").replace(/[^0-9a-zA-Z:_-]/g, "").slice(0, 80);
  if (!pedido) throw new ErroDoItemDaArte(400, "pedido_invalido", "Pedido sem identificador.");
  let projectId = p.projetoId && UUID.test(p.projetoId) ? p.projetoId : null;
  if (!projectId) {
    try {
      projectId = await projetoDoPostDeFotos(db, p.clientId);
    } catch (e) {
      throw new ErroDoItemDaArte(409, "cliente_sem_projeto", e instanceof Error ? e.message : "O cliente não tem projeto ativo.");
    }
  }
  const dataScope = { unrestricted: false, clientIds: [p.clientId], principalUserId: p.userId, source: "oauth" as const };
  const correlationId = crypto.randomUUID();
  const resultRefHolder: { value?: string } = {};
  const ctx = { keyId: PRINCIPAL_ARTE_RAPIDA, origin: PRINCIPAL_ARTE_RAPIDA, correlationId, dataScope, resultRefHolder } as unknown as WriteCtx;
  const entrada = {
    client_id: p.clientId,
    project_id: projectId,
    title: titulo,
    description: [p.descricao, "Mesa: Estúdio (arte rápida). A arte, a legenda, a aprovação do cliente e a publicação saem de lá."].filter(Boolean).join("\n").slice(0, 3500),
    format: p.carrossel ? "carousel" : "static",
    due_date: p.data,
    priority: "medium" as const,
    idempotency_key: `mesa-estudio:arte-rapida:${pedido}`,
  };
  const inicio = Date.now();
  const registro = { ...entrada, description: "[arte rápida]", pedido_por: p.userId };
  try {
    const parsed = createEditorialItemSchema.parse(entrada);
    const r = await createEditorialItem(parsed, ctx);
    const id = String((r.record as Record<string, unknown>).id);
    await auditLog({
      correlationId, toolName: "aceleriq_create_editorial_item", origin: PRINCIPAL_ARTE_RAPIDA,
      keyId: `${PRINCIPAL_ARTE_RAPIDA}:${p.userId}`, scopes: ["editorial:write"],
      input: registro, success: true, statusCode: 200, durationMs: Date.now() - inicio, resultRef: id,
    });
    return { task_id: id, project_id: projectId, title: titulo, due_date: p.data, replayed: !!r.replayed };
  } catch (err) {
    const m = err instanceof Error ? err.message : "";
    await auditLog({
      correlationId, toolName: "aceleriq_create_editorial_item", origin: PRINCIPAL_ARTE_RAPIDA,
      keyId: `${PRINCIPAL_ARTE_RAPIDA}:${p.userId}`, scopes: ["editorial:write"],
      input: registro, success: false, statusCode: 409, durationMs: Date.now() - inicio, errorCode: "item_nao_criado", errorMessage: m.slice(0, 300),
    }).catch(() => undefined);
    throw new ErroDoItemDaArte(409, "item_nao_criado", `A Agenda não aceitou o item novo${m ? `: ${m.slice(0, 200)}` : "."}`);
  }
}
