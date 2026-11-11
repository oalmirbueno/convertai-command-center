/**
 * Regras puras do link assinado do Workspace e da retirada da aprovação.
 * Sem Deno e sem banco: o teste e a ferramenta leem o mesmo arquivo.
 */

export const TTL_MIN_SEG = 60;
export const TTL_MAX_SEG = 3600;

const CLIENTE_NO_CAMINHO = /^client\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

/** O blob tem de ser da pasta client/{id}/ desse nó. Global não aponta para pasta de cliente. */
export function caminhoDoMesmoCliente(caminho: string | null | undefined, clientId: string | null, noGlobal: boolean): boolean {
  if (!caminho || caminho.includes("..") || caminho.startsWith("/") || caminho.includes("\\") || caminho.includes("\0")) return false;
  const normal = caminho.replace(/^\/+/, "");
  const achou = CLIENTE_NO_CAMINHO.exec(normal);
  if (achou) return !!clientId && achou[1].toLowerCase() === clientId.toLowerCase();
  return noGlobal && !clientId;
}

export function validadeDoLink(pedido: number | undefined, padrao: number): number {
  if (pedido !== undefined) {
    const n = Math.trunc(pedido);
    if (!Number.isFinite(n) || n < TTL_MIN_SEG || n > TTL_MAX_SEG) {
      throw new Error(`validade_seg precisa ficar entre ${TTL_MIN_SEG} e ${TTL_MAX_SEG} segundos.`);
    }
    return n;
  }
  const base = Math.trunc(padrao);
  if (!Number.isFinite(base)) return 600;
  return Math.min(TTL_MAX_SEG, Math.max(TTL_MIN_SEG, base));
}

export type NoParaLink = {
  id: string;
  kind: string;
  scope: string;
  client_id: string | null;
  storage_path: string | null;
  name: string;
  mime: string | null;
  size_bytes: number | null;
  thumb_path: string | null;
};

/** A auditoria guarda o nó, nunca a URL assinada. */
export function referenciaDeAuditoria(nodeId: string): string {
  return `workspace_nodes:${nodeId}`;
}

export function conferenciaDoLink(
  no: NoParaLink | null,
  permiteCliente: (clientId: string) => boolean,
  admin: boolean,
): { ok: true; no: NoParaLink } | { ok: false; mensagem: string; fora: boolean } {
  if (!no) return { ok: false, mensagem: "Arquivo não encontrado no Workspace.", fora: false };
  if (no.scope === "global") {
    if (!admin) return { ok: false, mensagem: "resource is outside this MCP principal data scope", fora: true };
  } else if (!no.client_id || !permiteCliente(no.client_id)) {
    return { ok: false, mensagem: "resource is outside this MCP principal data scope", fora: true };
  }
  if (no.kind !== "file" || !no.storage_path) {
    return { ok: false, mensagem: "Este nó não é um arquivo com blob no Workspace.", fora: false };
  }
  const global = no.scope === "global";
  if (!caminhoDoMesmoCliente(no.storage_path, global ? null : no.client_id, admin && global)) {
    return { ok: false, mensagem: "O arquivo não está na pasta deste cliente.", fora: true };
  }
  if (no.thumb_path && !caminhoDoMesmoCliente(no.thumb_path, global ? null : no.client_id, admin && global)) {
    return { ok: false, mensagem: "A miniatura não está na pasta deste cliente.", fora: true };
  }
  return { ok: true, no };
}

export function podeRetirarDaAprovacao(f: {
  parent_file_id?: string | null;
  archived_at?: string | null;
  locked_at?: string | null;
  visibility?: string | null;
  approval_status?: string | null;
} | null | undefined): boolean {
  if (!f || f.parent_file_id || f.archived_at || f.locked_at) return false;
  return f.visibility === "approval" && f.approval_status === "pending";
}
