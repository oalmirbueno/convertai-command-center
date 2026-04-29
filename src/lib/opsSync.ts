/**
 * opsSync — notificações fire-and-forget do portal para o Ops.
 *
 * Chama a edge function `notify-ops` do próprio portal (mesmo Supabase),
 * que faz a chamada server-to-server para o Ops.
 *
 * Isso evita problemas de CORS/CSP que ocorrem quando o browser tenta
 * chamar diretamente um domínio externo (grxljyocuadywcksfyvu.supabase.co).
 */

// URL hardcoded do portal — VITE_SUPABASE_URL pode ser undefined em alguns contextos
const NOTIFY_URL = "https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/notify-ops";
const ANON_KEY   = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

function push(type: string, data: any, context: Record<string, unknown> = {}) {
  if (!data) return;
  try {
    fetch(NOTIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ type, data, context }),
    }).catch(() => {});
  } catch {
    // silencioso
  }
}

export const notifyOpsProfile = (profile: any, context?: Record<string, unknown>) =>
  push("profile", profile, context ?? {});

export const notifyOpsProject = (project: any, context?: Record<string, unknown>) =>
  push("project", project, context ?? {});

export const notifyOpsMilestone = (milestone: any) =>
  push("milestone", milestone);

export const notifyOpsUpdate = (update: any) => {
  if (!update || update.update_type === "system") return;
  push("update", update);
};
