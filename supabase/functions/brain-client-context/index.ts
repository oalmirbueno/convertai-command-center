// Read-only client context. Check authorization before accessing the repository.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { bridgeStatusPublic, getFile, searchCode } from "../_shared/second-brain-github.ts";
import { makeBrainContextHandler } from "../_shared/brain-client-context-handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const authOptions = { persistSession: false, autoRefreshToken: false };
const admin = createClient(url, serviceKey, { auth: authOptions });

Deno.serve(makeBrainContextHandler({
  async authenticate(token) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return null;
    const [staff, role] = await Promise.all([
      admin.rpc("is_staff", { _user_id: data.user.id }),
      admin.rpc("has_role", { _user_id: data.user.id, _role: "admin" }),
    ]);
    if (staff.error || role.error) throw new Error("Authorization unavailable");
    return { id: data.user.id, staff: staff.data === true, admin: role.data === true };
  },
  async resolveClient(input) {
    const base = () => admin.from("profiles").select("id, full_name, company_name").is("deleted_at", null);
    const results = input.id
      ? [await base().eq("id", input.id).limit(1)]
      : await Promise.all([base().eq("full_name", input.name!).limit(2), base().eq("company_name", input.name!).limit(2)]);
    if (results.some(r => r.error)) throw new Error("Client lookup unavailable");
    const rows = [...new Map(results.flatMap(r => r.data ?? []).map(r => [r.id, r])).values()];
    if (rows.length !== 1) return null;
    return { id: rows[0].id, name: rows[0].company_name?.trim() || rows[0].full_name || rows[0].id };
  },
  async canAccess(token, clientId) {
    // can_access_client reads auth.uid(): preserve the caller's JWT in this RPC.
    const scoped = createClient(url, serviceKey, { auth: authOptions,
      global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data, error } = await scoped.rpc("can_access_client", { _client_id: clientId });
    if (error) throw new Error("Authorization unavailable");
    return data === true;
  },
  configured: () => bridgeStatusPublic().configured,
  search: searchCode,
  read: getFile,
}, corsHeaders));
