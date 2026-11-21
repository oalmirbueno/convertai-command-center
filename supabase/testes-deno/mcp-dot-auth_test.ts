import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { authenticate } from '../functions/_shared/mcp-auth.ts';
import { DOT_OFFICE_CONSENT_METADATA_KEY } from '../functions/_shared/mcp-dot-oauth.ts';

const subject = '23456789-2345-4abc-8abd-23456789abcd';
const client = '12345678-1234-4abc-8abd-123456789abc';
const other = '3456789a-3456-4abc-8abd-3456789abcde';
const base = 'https://dot-oauth.example.test';
const issuer = base + '/auth/v1';

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const encoder = new TextEncoder();
const jwtPart = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));

Deno.test('o vínculo da Dot exige autorização vigente e um JWT emitido depois da aprovação', async () => {
  const env = {
    SUPABASE_URL: base,
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key-for-local-test',
    APP_PUBLIC_URL: base,
    MCP_RESOURCE_URL: base + '/functions/v1/mcp-server',
    MCP_OAUTH_METADATA_URL: base + '/functions/v1/mcp-oauth-metadata',
    MCP_AUTH_ISSUER: issuer,
    MCP_ADMIN_OAUTH_BINDINGS: '',
    MCP_DOT_OAUTH_BINDING: client + ':' + subject,
  };
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, Deno.env.get(name)]));
  const fetchOriginal = globalThis.fetch;
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', key.publicKey), kid: 'dot-test', alg: 'ES256', use: 'sig' };
  const header = jwtPart({ alg: 'ES256', kid: jwk.kid });

  const issuedAt = Math.floor(Date.now() / 1000);
  const consent = { client_id: client, approved_at: issuedAt - 10 };
  async function tokenFor(clientId = client, validSignature = true, oauthClientClaim = 'client_id') {
    const payload = jwtPart({ sub: subject, [oauthClientClaim]: clientId, iss: issuer, aud: 'authenticated',
      iat: issuedAt, exp: issuedAt + 600, scope: 'admin aceleriq:write',
      app_metadata: { [DOT_OFFICE_CONSENT_METADATA_KEY]: consent } });
    const unsigned = header + '.' + payload;
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, encoder.encode(unsigned)));
    if (!validSignature) sig[0] ^= 1;
    return unsigned + '.' + base64url(sig);
  }

  let allowedClient = true;
  let verifiedSubject = subject;
  let recordedConsent: typeof consent | undefined;
  let roles: Array<{ role: string }> = [];
  let assignments: Array<{ client_id: string }> = [];
  let bindings: Array<{ principal: string }> = [];
  const reply = (value: unknown) => new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
    globalThis.fetch = async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      assertEquals(url.origin, base);
      switch (url.pathname) {
        case '/auth/v1/.well-known/jwks.json': return reply({ keys: [jwk] });
        case '/auth/v1/user': return reply({
          id: verifiedSubject,
          app_metadata: { [DOT_OFFICE_CONSENT_METADATA_KEY]: recordedConsent },
          user_metadata: { [DOT_OFFICE_CONSENT_METADATA_KEY]: consent },
        });
        case '/rest/v1/rpc/validate_api_key_for_audience': return reply([]);
        case '/rest/v1/rpc/is_allowed_mcp_oauth_client': return reply(allowedClient);
        case '/rest/v1/user_roles': return reply(roles);
        case '/rest/v1/team_client_assignments': return reply(assignments);
        case '/rest/v1/operator_key_bindings': return reply(bindings);
        default: throw new Error('Rota fora do teste: ' + url.pathname);
      }
    };

    const token = await tokenFor();
    const request = (value = token) => new Request(base, { headers: { Authorization: 'Bearer ' + value } });
    assertEquals((await authenticate(request())).ok, false);
    recordedConsent = { ...consent, client_id: other };
    assertEquals((await authenticate(request())).ok, false);
    recordedConsent = { ...consent, approved_at: issuedAt };
    assertEquals((await authenticate(request())).ok, false);
    recordedConsent = consent;
    const resultado = await authenticate(request());
    assert(resultado.ok);
    assertEquals(resultado.ctx.officeOperator, 'dot');
    assertEquals(resultado.ctx.scopes, []);
    assertEquals(resultado.ctx.dataScope.clientIds, []);
    assertEquals(resultado.ctx.dataScope.unrestricted, false);
    assertEquals(resultado.ctx.userAccessToken, undefined);

    recordedConsent = undefined;
    assertEquals((await authenticate(request())).ok, false);
    recordedConsent = consent;
    assertEquals((await authenticate(request(await tokenFor(client, true, 'azp')))).ok, false);
    assertEquals((await authenticate(request(await tokenFor(other)))).ok, false);
    assertEquals((await authenticate(request(await tokenFor(client, false)))).ok, false);
    allowedClient = false;
    assertEquals((await authenticate(request())).ok, false);
    allowedClient = true;
    verifiedSubject = other;
    assertEquals((await authenticate(request())).ok, false);
    verifiedSubject = subject;
    roles = [{ role: 'admin' }];
    assertEquals((await authenticate(request())).ok, false);
    roles = [];
    assignments = [{ client_id: other }];
    assertEquals((await authenticate(request())).ok, false);
    assignments = [];
    bindings = [{ principal: 'oauth:' + client }];
    assertEquals((await authenticate(request())).ok, false);
    bindings = [];
    Deno.env.set('MCP_ADMIN_OAUTH_BINDINGS', other + ':' + client);
    assertEquals((await authenticate(request())).ok, false);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
