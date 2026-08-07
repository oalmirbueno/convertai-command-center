import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_GATEWAY_ACTION_SCOPES,
  API_GATEWAY_AUDIENCE,
  API_GATEWAY_DEFAULT_PAGE_LIMIT,
  API_GATEWAY_KEY_ORIGIN,
  API_GATEWAY_MAX_PAGE_LIMIT,
  API_GATEWAY_SCOPE_PRESETS,
  LEGACY_API_GATEWAY_ORIGIN,
  LEGACY_API_GATEWAY_SCOPES,
  apiGatewayScopeAllowsClient,
  allowedApiGatewayActions,
  authorizeApiGatewayAction,
  normalizeApiGatewayPageLimit,
  type ApiGatewayPrincipal,
} from '../../supabase/functions/_shared/api-gateway-auth.ts';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const principal = (
  scopes: readonly string[],
  overrides: Partial<ApiGatewayPrincipal> = {},
): ApiGatewayPrincipal => ({
  audience: API_GATEWAY_AUDIENCE,
  origin: API_GATEWAY_KEY_ORIGIN,
  scopes,
  keyId: '00000000-0000-4000-8000-000000000010',
  ownerId: '00000000-0000-4000-8000-000000000001',
  ownerIsAdmin: true,
  scope: 'explicit',
  clientIds: ['00000000-0000-4000-8000-000000000002'],
  ...overrides,
});

describe('API gateway action authorization', () => {
  it('maps every current handler to exactly one required scope', () => {
    const gateway = read('supabase/functions/api-gateway/index.ts');
    const handlerBlock = gateway.match(
      /const handlers:[\s\S]*?= \{([\s\S]*?)\n\}/,
    )?.[1] ?? '';
    const handlers = [...handlerBlock.matchAll(/^ {2}([a-z_]+): async/gm)]
      .map(match => match[1])
      .sort();
    const docs = read('src/pages/ApiDocs.tsx');
    const docsBlock = docs.match(
      /const actionDocs:[\s\S]*?= \[([\s\S]*?)\n\];\n\nconst totalActions/,
    )?.[1] ?? '';
    const documentedActions = [...docsBlock.matchAll(/\{ name: "([a-z_]+)"/g)]
      .map(match => match[1])
      .sort();

    expect(handlers).toEqual(Object.keys(API_GATEWAY_ACTION_SCOPES).sort());
    expect(documentedActions).toEqual(Object.keys(API_GATEWAY_ACTION_SCOPES).sort());
    expect(handlers).toHaveLength(46);
    expect(Object.values(API_GATEWAY_ACTION_SCOPES).every(Boolean)).toBe(true);
  });

  it('denies unknown actions, wrong audiences, wrong origins, and missing scopes', () => {
    expect(authorizeApiGatewayAction(principal([]), 'unmapped_action')).toMatchObject({
      allowed: false,
      reason: 'unknown_action',
    });
    expect(authorizeApiGatewayAction(
      principal(['projects:read'], { audience: 'mcp', origin: 'mcp' }),
      'list_projects',
    )).toMatchObject({ allowed: false, reason: 'wrong_audience' });
    expect(authorizeApiGatewayAction(
      principal(['projects:read'], { origin: 'mcp' }),
      'list_projects',
    )).toMatchObject({ allowed: false, reason: 'wrong_origin' });
    expect(authorizeApiGatewayAction(principal(['projects:read']), 'create_project'))
      .toMatchObject({ allowed: false, reason: 'missing_scope' });
  });

  it('keeps read, automation, administrator, and legacy capabilities distinct', () => {
    const readOnly = principal(API_GATEWAY_SCOPE_PRESETS.read_only);
    expect(authorizeApiGatewayAction(readOnly, 'list_projects').allowed).toBe(true);
    expect(authorizeApiGatewayAction(readOnly, 'create_project').allowed).toBe(false);
    expect(authorizeApiGatewayAction(readOnly, 'delete_project').allowed).toBe(false);

    const automation = principal(API_GATEWAY_SCOPE_PRESETS.automation);
    expect(authorizeApiGatewayAction(automation, 'create_project').allowed).toBe(true);
    expect(authorizeApiGatewayAction(automation, 'delete_project').allowed).toBe(false);
    expect(authorizeApiGatewayAction(automation, 'create_client').allowed).toBe(false);
    expect(authorizeApiGatewayAction(automation, 'list_audit_log').allowed).toBe(false);

    const administrator = principal(API_GATEWAY_SCOPE_PRESETS.administrator, {
      scope: 'all',
    });
    expect(allowedApiGatewayActions(administrator)).toHaveLength(46);

    const legacy = principal(LEGACY_API_GATEWAY_SCOPES, {
      origin: LEGACY_API_GATEWAY_ORIGIN,
      keyId: null,
      ownerId: null,
      ownerIsAdmin: false,
      scope: 'none',
      clientIds: [],
    });
    expect(allowedApiGatewayActions(legacy)).toEqual(['get_schema', 'health']);
  });

  it('does not let an MCP read key reach gateway reads or writes', () => {
    const mcpKey = principal(['aceleriq:read', 'projects:read'], {
      audience: 'mcp',
      origin: 'mcp',
    });
    expect(authorizeApiGatewayAction(mcpKey, 'list_projects').allowed).toBe(false);
    expect(authorizeApiGatewayAction(mcpKey, 'update_project').allowed).toBe(false);
  });

  it('requires a current admin owner for every non-discovery action', () => {
    expect(authorizeApiGatewayAction(
      principal(['projects:write'], { ownerId: null }),
      'update_project',
    )).toMatchObject({ allowed: false, reason: 'missing_owner' });
    expect(authorizeApiGatewayAction(
      principal(['projects:read'], { ownerIsAdmin: false }),
      'list_projects',
    )).toMatchObject({ allowed: false, reason: 'owner_not_admin' });
    expect(authorizeApiGatewayAction(
      principal(['projects:read'], { scope: 'none', clientIds: [] }),
      'list_projects',
    )).toMatchObject({ allowed: false, reason: 'client_scope_denied' });
    expect(authorizeApiGatewayAction(
      principal(['projects:read'], { scope: 'explicit', clientIds: [] }),
      'list_projects',
    )).toMatchObject({ allowed: false, reason: 'client_scope_denied' });

    expect(authorizeApiGatewayAction(
      principal(['team:read']),
      'list_team',
    )).toMatchObject({ allowed: false, reason: 'global_scope_required' });
    expect(authorizeApiGatewayAction(
      principal(['team:read'], { scope: 'all' }),
      'list_team',
    ).allowed).toBe(true);

    const gateway = read('supabase/functions/api-gateway/index.ts');
    for (const setName of [
      'SAFE_PROJECT_UPDATES', 'SAFE_TASK_UPDATES', 'SAFE_MILESTONE_UPDATES',
      'SAFE_REPORT_UPDATES', 'SAFE_BILLING_UPDATES', 'SAFE_REQUEST_UPDATES',
      'SAFE_WALLET_UPDATES', 'SAFE_RECHARGE_UPDATES',
      'SAFE_CHECKLIST_UPDATES',
    ]) {
      expect(gateway).toContain(`allowedUpdates(p, ${setName}`);
    }
    expect(gateway).not.toMatch(/const \{ (project_id|task_id|report_id|billing_id), \.\.\.updates \} = p/);
    expect(gateway).toContain('created_by: requireActor(context)');
    expect(gateway).toContain('author_id: requireActor(context)');
    expect(gateway).toContain("return err('Internal server error', 500)");
  });

  it('enforces explicit client scope and one shared page clamp', () => {
    const clientA = '00000000-0000-4000-8000-000000000002';
    const clientB = '00000000-0000-4000-8000-000000000003';
    expect(apiGatewayScopeAllowsClient(
      principal([], { scope: 'explicit', clientIds: [clientA] }),
      clientA,
    )).toBe(true);
    expect(apiGatewayScopeAllowsClient(
      principal([], { scope: 'explicit', clientIds: [clientA] }),
      clientB,
    )).toBe(false);
    expect(apiGatewayScopeAllowsClient(
      principal([], { scope: 'all', clientIds: [] }),
      clientB,
    )).toBe(true);

    expect(normalizeApiGatewayPageLimit(undefined)).toBe(API_GATEWAY_DEFAULT_PAGE_LIMIT);
    expect(normalizeApiGatewayPageLimit('invalid')).toBe(API_GATEWAY_DEFAULT_PAGE_LIMIT);
    expect(normalizeApiGatewayPageLimit(0)).toBe(1);
    expect(normalizeApiGatewayPageLimit(25.9)).toBe(25);
    expect(normalizeApiGatewayPageLimit(10_000)).toBe(API_GATEWAY_MAX_PAGE_LIMIT);
  });
});

describe('API gateway integration contract', () => {
  it('validates audience before dispatching a service-role handler', () => {
    const gateway = read('supabase/functions/api-gateway/index.ts');
    expect(gateway).toContain("rpc('validate_api_key_for_audience'");
    expect(gateway).not.toMatch(/rpc\(\s*['"]validate_api_key['"]\s*,/);
    expect(gateway).toContain('_audience: API_GATEWAY_AUDIENCE');
    expect(gateway).toContain('authorizeApiGatewayAction(principal, action)');
    expect(gateway.indexOf('authorizeApiGatewayAction(principal, action)'))
      .toBeLessThan(gateway.indexOf('const response = await handler'));
    expect(gateway).toContain("'consume_api_gateway_rate_limit'");
    expect(gateway).toContain('actionTenantAllowed(');
    expect(gateway.indexOf('actionTenantAllowed('))
      .toBeLessThan(gateway.indexOf('const response = await handler'));
  });

  it('scopes service-role lists and clamps every list page', () => {
    const gateway = read('supabase/functions/api-gateway/index.ts');
    const listActions = Object.keys(API_GATEWAY_ACTION_SCOPES)
      .filter(action => action.startsWith('list_'));
    for (const [index, action] of listActions.entries()) {
      const start = gateway.indexOf(`  ${action}: async`);
      const nextAction = listActions[index + 1];
      const next = nextAction ? gateway.indexOf(`  ${nextAction}: async`, start + 1) : gateway.length;
      expect(start, `${action} handler missing`).toBeGreaterThan(-1);
      expect(
        gateway.slice(start, next),
        `${action} must use the shared page clamp`,
      ).toContain('normalizeApiGatewayPageLimit(p.limit)');
    }
    expect(gateway).toContain("scope_project:projects!inner(client_id)");
    expect(gateway).toContain('scopeClientQuery(q, context)');
    expect(gateway).toContain('if (params.client_id !== undefined)');
    expect(gateway).toContain(".eq('role', 'client')");
    expect(gateway).not.toMatch(/\.limit\(p\.limit\)/);
  });

  it('creates browser keys with CSPRNG, explicit metadata, and selected scopes', () => {
    const docs = read('src/pages/ApiDocs.tsx');
    expect(docs).toContain('crypto.getRandomValues(bytes)');
    expect(docs).not.toContain('Math.random()');
    expect(docs).toContain('audience: API_GATEWAY_AUDIENCE');
    expect(docs).toContain('origin: API_GATEWAY_KEY_ORIGIN');
    expect(docs).toContain('scopes,');
    expect(docs).toContain('client_scope_mode: "none"');
    expect(docs).toContain('"configure_api_gateway_key_scope"');
    expect(docs).toContain('p_scope_mode: "all"');
    expect(docs).toContain('is_active: false');
    expect(docs).toContain('.delete()');
    expect(docs.indexOf('"configure_api_gateway_key_scope"'))
      .toBeLessThan(docs.indexOf('setCreatedKey(rawKey)'));
    expect(docs).toContain('Rotação obrigatória para chaves legadas');
  });

  it('keeps audience validation service-role-only in SQL and in MCP auth', () => {
    const migration = read('supabase/migrations/20260807212000_scope_api_gateway_keys.sql');
    const mcpAuth = read('supabase/functions/_shared/mcp-auth.ts');
    expect(migration).toContain('k.audience = _audience');
    expect(migration).toMatch(/REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE[\s\S]*TO service_role/);
    expect(migration).toMatch(/RETURNS TABLE\([\s\S]*created_by uuid/);
    expect(migration).toContain('k.created_by');
    expect(mcpAuth).toContain("_audience: 'mcp'");
  });

  it('adds a private tenant allowlist and atomic fixed gateway quota', () => {
    const migration = read(
      'supabase/migrations/20260807223000_harden_api_gateway_tenant_scope.sql',
    );
    expect(migration).toContain("SET client_scope_mode = 'none'");
    expect(migration).toContain("CHECK (client_scope_mode IN ('none', 'explicit', 'all'))");
    expect(migration).toContain('CREATE TABLE api_gateway_private.api_gateway_key_client_scopes');
    expect(migration).toContain('REFERENCES public.user_roles(user_id, role) ON DELETE CASCADE');
    expect(migration).toContain('owner_is_admin boolean');
    expect(migration).toContain('client_ids uuid[]');
    expect(migration).toContain('CREATE TABLE api_gateway_private.api_gateway_rate_limits');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('api_keys_active_key_hash_unique_idx');
    expect(migration).toContain('duplicate_key.is_active = true');
    expect(migration).toContain('ambiguous_key.is_active = true');
    expect(migration).toContain("audience NOT IN ('mcp', 'api-gateway')");
    expect(migration).toContain("OR (is_active = false AND revoked_at IS NOT NULL)");
    expect(migration).not.toContain('DROP FUNCTION IF EXISTS public.validate_api_key(text)');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.validate_api_key(_key_hash text)');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.validate_api_key\(text\)[\s\S]*FROM PUBLIC, anon, authenticated[\s\S]*GRANT EXECUTE ON FUNCTION public\.validate_api_key\(text\)[\s\S]*TO service_role/,
    );
    expect(migration).toContain('api_gateway_rate_limits_retention_idx');
    expect(migration).toContain('ON CONFLICT (key_fingerprint, window_started_at)');
    expect(migration).toContain('_request_count <= 120');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.consume_api_gateway_rate_limit\(text\)[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.consume_api_gateway_rate_limit\(text\)[\s\S]*TO service_role/,
    );
  });

  it('configures key tenant scope only through an atomic admin RPC', () => {
    const migration = read(
      'supabase/migrations/20260807223000_harden_api_gateway_tenant_scope.sql',
    );
    const generatedTypes = read('src/integrations/supabase/types.ts');
    expect(migration).toContain('CREATE FUNCTION public.configure_api_gateway_key_scope(');
    expect(migration).toMatch(
      /configure_api_gateway_key_scope[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = ''/,
    );
    expect(migration).toContain("role = 'admin'::public.app_role");
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('DELETE FROM api_gateway_private.api_gateway_key_client_scopes');
    expect(migration).toContain('INNER JOIN public.user_roles AS client_role');
    expect(migration).toContain("client_role.role = 'client'::public.app_role");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.configure_api_gateway_key_scope\(uuid, text, uuid\[\]\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.configure_api_gateway_key_scope\(uuid, text, uuid\[\]\)[\s\S]*TO authenticated/,
    );
    expect(generatedTypes).toContain('configure_api_gateway_key_scope: {');
    expect(generatedTypes).toContain('client_scope_mode: string');
    expect(generatedTypes).toMatch(/\n\s+validate_api_key: \{/);
    expect(generatedTypes).toMatch(/\n\s+validate_api_key_for_audience: \{/);
  });
});
