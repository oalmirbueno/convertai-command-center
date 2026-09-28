/**
 * Item novo na Agenda para um post de fotos (frente MF, 27/09): quando o dono
 * prepara as fotos para uma data que ainda não tem item, o item nasce pelo
 * MESMO caminho do agente do Mês (createEditorialItem, o escritor editorial do
 * MCP), com escopo só deste cliente e idempotência pelo pedido: a mesma
 * tentativa repetida não cria dois itens.
 *
 * Só as funções (Deno) usam este arquivo: ele importa o escritor do MCP.
 */
import { createEditorialItem, createEditorialItemSchema, type WriteCtx } from "./mcp-write-services.ts";
import { auditLog } from "./mcp-audit.ts";
import { ErroDoPost, type BancoDoPost } from "./post-de-fotos.ts";

export const PRINCIPAL_MESA_FOTO = "mesa:mesa-foto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Projeto do item novo: o do item editorial mais recente do cliente; sem ele, o projeto mais novo. */
export async function projetoDoPostDeFotos(db: BancoDoPost, clientId: string): Promise<string> {
  const { data: projetos } = await db.from("projects").select("id, created_at").eq("client_id", clientId).is("deleted_at", null).order("created_at", { ascending: false }).limit(50);
  const ids = ((projetos as { id: string }[] | null) || []).map((p) => p.id);
  if (!ids.length) throw new ErroDoPost(409, "cliente_sem_projeto", "O cliente não tem projeto ativo para receber o item da Agenda.");
  const { data: tarefas } = await db.from("tasks").select("project_id, created_at").in("project_id", ids).in("delivery_type", ["carousel", "static", "design"]).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(1);
  const ultima = ((tarefas as { project_id: string }[] | null) || [])[0];
  return ultima && ids.indexOf(ultima.project_id) >= 0 ? ultima.project_id : ids[0];
}

/**
 * Cria (ou reencontra) o item da Agenda do post de fotos. `pedidoId` é o id do
 * clique (ou da mensagem do diretor): repetir o mesmo pedido devolve o mesmo item.
 */
export async function criarItemDoPostDeFotos(db: BancoDoPost, p: {
  clientId: string;
  userId: string;
  titulo: string;
  data: string;
  carrossel: boolean;
  pedidoId: string;
  descricao?: string | null;
  /** Frente AE (28/09): o projeto da marca (Acerbi ou CME); sem ele, o editorial mais recente. */
  projetoId?: string | null;
}): Promise<{ task_id: string; project_id: string; title: string; due_date: string; replayed: boolean }> {
  if (!UUID.test(p.clientId)) throw new ErroDoPost(400, "client_id_invalido", "Cliente inválido.");
  if (!DATA.test(p.data)) throw new ErroDoPost(400, "data_invalida", "Escolha a data do post (AAAA-MM-DD).");
  const titulo = String(p.titulo || "").replace(/\s+/g, " ").trim().slice(0, 200) || "Post de fotos";
  const pedido = String(p.pedidoId || "").replace(/[^0-9a-zA-Z:_-]/g, "").slice(0, 80);
  if (!pedido) throw new ErroDoPost(400, "pedido_invalido", "Pedido sem identificador.");
  const projectId = p.projetoId && UUID.test(p.projetoId) ? p.projetoId : await projetoDoPostDeFotos(db, p.clientId);
  const dataScope = { unrestricted: false, clientIds: [p.clientId], principalUserId: p.userId, source: "oauth" as const };
  const correlationId = crypto.randomUUID();
  const resultRefHolder: { value?: string } = {};
  const ctx = { keyId: PRINCIPAL_MESA_FOTO, origin: "mesa:mesa-foto", correlationId, dataScope, resultRefHolder } as unknown as WriteCtx;
  const entrada = {
    client_id: p.clientId,
    project_id: projectId,
    title: titulo,
    description: [
      `Post de fotos da Mesa Foto (sem arte): ${titulo}.`,
      "Mesa: Mesa Foto. As fotos, a legenda, a aprovação do cliente e a publicação saem de lá.",
      p.descricao ? String(p.descricao).slice(0, 2000) : "",
    ].filter(Boolean).join("\n"),
    format: p.carrossel ? "carousel" : "static",
    due_date: p.data,
    priority: "medium" as const,
    idempotency_key: `mesa-foto:post:${pedido}`,
  };
  const inicio = Date.now();
  try {
    const parsed = createEditorialItemSchema.parse(entrada);
    const r = await createEditorialItem(parsed, ctx);
    const id = String((r.record as Record<string, unknown>).id);
    await auditLog({
      correlationId, toolName: "aceleriq_create_editorial_item", origin: "mesa:mesa-foto",
      keyId: `${PRINCIPAL_MESA_FOTO}:${p.userId}`, scopes: ["editorial:write"],
      input: { ...entrada, description: "[post de fotos]", pedido_por: p.userId },
      success: true, statusCode: 200, durationMs: Date.now() - inicio, resultRef: id,
    });
    return { task_id: id, project_id: projectId, title: titulo, due_date: p.data, replayed: !!r.replayed };
  } catch (err) {
    const m = err instanceof Error ? err.message : "";
    await auditLog({
      correlationId, toolName: "aceleriq_create_editorial_item", origin: "mesa:mesa-foto",
      keyId: `${PRINCIPAL_MESA_FOTO}:${p.userId}`, scopes: ["editorial:write"],
      input: { ...entrada, description: "[post de fotos]", pedido_por: p.userId },
      success: false, statusCode: 409, durationMs: Date.now() - inicio, errorCode: "item_nao_criado", errorMessage: m.slice(0, 300),
    }).catch(() => undefined);
    throw new ErroDoPost(409, "item_nao_criado", `A Agenda não aceitou o item novo${m ? `: ${m.slice(0, 200)}` : "."}`);
  }
}
