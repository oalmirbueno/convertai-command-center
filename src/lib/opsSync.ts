// Fire-and-forget notifications to the Ops portal sync endpoint.
// Never throws, never blocks the caller.

const OPS_URL = "https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-portal-sync";
const OPS_SECRET = "aceleriq-ops-portal-bridge-2025-x7k9m2n4p8q";

function push(type: string, data: any, context: Record<string, unknown> = {}) {
  if (!data) return;
  try {
    fetch(OPS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": OPS_SECRET,
      },
      body: JSON.stringify({ type, data, context }),
    }).catch(() => {});
  } catch {
    // silencioso
  }
}

export const notifyOpsMilestone = (milestone: any) => push("milestone", milestone);

export const notifyOpsUpdate = (update: any) => {
  // Skip system-generated updates per spec
  if (!update || update.update_type === "system") return;
  push("update", update);
};
