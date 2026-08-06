import type { SupabaseClient } from "@supabase/supabase-js";

const ASSIGNMENT_PAGE_SIZE = 500;
const EDITORIAL_STAFF_ROLES = new Set([
  "manager",
  "design",
  "traffic",
]);

export interface McpClientScope {
  unrestricted: boolean;
  clientIds: string[];
  role: string | null;
}

type ScopeError = { code?: string; message?: string };

export type McpClientScopeResult =
  | { scope: McpClientScope; error: null }
  | { scope: null; error: ScopeError };

/**
 * The official MCP uses the user's JWT, but operational profile/project RLS is
 * intentionally broader than the editorial assignment model. Resolve the
 * same explicit client scope used by the editorial UI before discovery or an
 * editorial read/write.
 */
export async function resolveMcpClientScope(
  sb: SupabaseClient,
  userId: string | null | undefined,
): Promise<McpClientScopeResult> {
  if (!userId) {
    return { scope: null, error: { code: "missing_user" } };
  }

  const { data: roleRow, error: roleError } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (roleError) return { scope: null, error: roleError };

  const role = typeof roleRow?.role === "string" ? roleRow.role : null;
  if (role === "admin") {
    return {
      scope: { unrestricted: true, clientIds: [], role },
      error: null,
    };
  }
  if (role === "client") {
    return {
      scope: { unrestricted: false, clientIds: [userId], role },
      error: null,
    };
  }
  if (!role || !EDITORIAL_STAFF_ROLES.has(role)) {
    return {
      scope: { unrestricted: false, clientIds: [], role },
      error: null,
    };
  }

  const clientIds: string[] = [];
  for (let from = 0; ; from += ASSIGNMENT_PAGE_SIZE) {
    const { data, error } = await sb
      .from("team_client_assignments")
      .select("client_id")
      .eq("user_id", userId)
      .order("client_id", { ascending: true })
      .range(from, from + ASSIGNMENT_PAGE_SIZE - 1);
    if (error) return { scope: null, error };
    const page = data ?? [];
    clientIds.push(...page.map((row) => row.client_id));
    if (page.length < ASSIGNMENT_PAGE_SIZE) break;
  }

  return {
    scope: {
      unrestricted: false,
      clientIds: [...new Set(clientIds)],
      role,
    },
    error: null,
  };
}

export function mcpScopeAllowsClient(
  scope: Pick<McpClientScope, "unrestricted" | "clientIds">,
  clientId: string,
) {
  return scope.unrestricted || scope.clientIds.includes(clientId);
}
