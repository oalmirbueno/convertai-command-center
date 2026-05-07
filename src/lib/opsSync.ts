/**
 * opsSync — Local-first sync bridge from Portal → Ops.
 *
 * Estratégia:
 *  1. Caller já gravou o registro localmente no Portal (UI já renderizou).
 *  2. Disparamos a edge function `notify-ops` em background.
 *  3. Quando o Ops responde, atualizamos o registro local com:
 *       - sync_status = 'synced' | 'sync_error'
 *       - sync_error  = mensagem de erro (quando falha)
 *       - ops_*_id    = identificador retornado pelo Ops (se houver)
 *
 * Nada bloqueia o caller. Se a edge function falhar, o registro permanece
 * visível com `sync_status = 'sync_error'` para retry posterior.
 */

import { supabase } from "@/integrations/supabase/client";

const NOTIFY_URL = "https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/notify-ops";
const ANON_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "";

type Table = "profiles" | "projects" | "milestones" | "tasks";

interface PushOptions {
  /** Tabela local para atualizar sync_status / ops_*_id após a resposta. */
  table?: Table;
  /** ID do registro local. */
  localId?: string;
  /** Campo onde o id do Ops deve ser persistido (ex.: ops_workspace_id). */
  opsIdField?: string;
}

async function markSync(
  table: Table,
  localId: string,
  patch: Record<string, unknown>,
) {
  try {
    await (supabase.from(table) as any).update(patch).eq("id", localId);
  } catch {
    /* silent — não devemos quebrar a UI por causa de marcação de sync */
  }
}

function push(
  type: string,
  data: any,
  context: Record<string, unknown> = {},
  opts: PushOptions = {},
) {
  if (!data) return;

  // Marca como pendente imediatamente (não-bloqueante).
  if (opts.table && opts.localId) {
    markSync(opts.table, opts.localId, {
      sync_status: "pending_ops_sync",
      sync_error: null,
    });
  }

  // Dispara a chamada em background.
  (async () => {
    try {
      const res = await fetch(NOTIFY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ type, data, context }),
      });

      let parsed: any = null;
      try {
        parsed = await res.json();
      } catch {
        /* corpo vazio ou não-JSON */
      }

      const ok = res.ok && parsed?.ok !== false;

      if (opts.table && opts.localId) {
        const patch: Record<string, unknown> = ok
          ? { sync_status: "synced", sync_error: null }
          : {
              sync_status: "sync_error",
              sync_error: `HTTP ${res.status}: ${
                parsed?.error ?? parsed?.result?.error ?? "Ops sync failed"
              }`,
            };

        // Persiste id retornado pelo Ops, se aplicável.
        // Mapeamento por entidade — Ops usa nomes diferentes em cada action,
        // então olhamos os campos relevantes em ordem por tipo.
        if (ok && opts.opsIdField) {
          const r = parsed?.result ?? {};
          const pickByField: Record<string, string[]> = {
            ops_client_id:    ["client_id", "id"],
            ops_workspace_id: ["workspace_id", "id"],
            ops_milestone_id: ["milestone_id", "node_id", "id"],
            ops_node_id:      ["node_id", "task_id", "id"],
          };
          const candidates = pickByField[opts.opsIdField] ?? ["id"];
          let opsId: string | null = null;
          for (const k of candidates) {
            if (r[k]) { opsId = r[k]; break; }
          }
          if (opsId) patch[opts.opsIdField] = opsId;
        }

        await markSync(opts.table, opts.localId, patch);
      }
    } catch (err: any) {
      if (opts.table && opts.localId) {
        await markSync(opts.table, opts.localId, {
          sync_status: "sync_error",
          sync_error: err?.message ?? "Network error calling notify-ops",
        });
      }
    }
  })();
}

/* ─────────────── Helpers públicos ─────────────── */

export const notifyOpsProfile = (
  profile: any,
  context?: Record<string, unknown>,
) =>
  push("profile", profile, context ?? {}, {
    table: "profiles",
    localId: profile?.id,
    opsIdField: "ops_client_id",
  });

export const notifyOpsProject = (
  project: any,
  context?: Record<string, unknown>,
) =>
  push("project", project, context ?? {}, {
    table: "projects",
    localId: project?.id,
    opsIdField: "ops_workspace_id",
  });

export const notifyOpsMilestone = (milestone: any) =>
  push("milestone", milestone, {}, {
    table: "milestones",
    localId: milestone?.id,
    opsIdField: "ops_milestone_id",
  });

export const notifyOpsUpdate = (update: any) => {
  if (!update || update.update_type === "system") return;
  push("update", update);
};

/* ─────────────── Deletes ─────────────── */

export const notifyOpsDelete = (
  entity: "profile" | "project" | "milestone" | "task",
  id: string,
  extra: Record<string, unknown> = {},
) => {
  push(`${entity}_deleted`, { id, ...extra });
};
