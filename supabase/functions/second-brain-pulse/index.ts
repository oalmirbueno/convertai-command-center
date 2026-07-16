// deno-lint-ignore-file no-explicit-any
// Second Brain — real-time pulse endpoint for the Admin Dashboard.
// Admin-only. Returns bridge HEAD commit, recent commits, and inbox items.
// GET /functions/v1/second-brain-pulse?limit=8

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  bridgeStatus,
  getBridgePulse,
  listInboxPending,
  listRecentCommits,
  SecondBrainError,
} from '../_shared/second-brain-github.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json(401, { error: 'missing_bearer' });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userRes, error } = await admin.auth.getUser(token);
  if (error || !userRes?.user) return json(401, { error: 'invalid_token' });
  const uid = userRes.user.id;
  const { data: isAdmin } = await admin.rpc('has_role', { _user_id: uid, _role: 'admin' });
  if (!isAdmin) return json(403, { error: 'forbidden' });
  return { userId: uid };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const gate = await requireAdmin(req);
  if (gate instanceof Response) return gate;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '8'), 1), 20);
  const force = url.searchParams.get('force') === '1';

  const status = bridgeStatus();
  if (!status.configured) {
    return json(200, {
      configured: false,
      status,
      pulse: null,
      commits: [],
      inbox: [],
      fetched_at: new Date().toISOString(),
    });
  }

  try {
    const [pulse, commits, inbox] = await Promise.all([
      getBridgePulse(force),
      listRecentCommits(limit).catch(() => []),
      listInboxPending(limit).catch(() => []),
    ]);
    return json(200, {
      configured: true,
      status,
      pulse,
      commits,
      inbox,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    const detail = e instanceof SecondBrainError
      ? e.error
      : { kind: 'internal', detail: String((e as Error)?.message ?? e) };
    // GitHub API can return transient 5xx. Respond 200 with a fallback signal
    // so the widget shows a soft error instead of the SDK throwing.
    return json(200, {
      configured: true,
      status,
      pulse: null,
      commits: [],
      inbox: [],
      fetched_at: new Date().toISOString(),
      error: 'bridge_unavailable',
      detail,
    });
  }
});
