import { describe, expect, it } from 'vitest';
import {
  auditPrincipalSelector,
  buildAuditInput,
  oauthScopesForStaff,
  OAUTH_STAFF_SCOPES,
  persistedAuditKeyId,
  sanitizeAuditError,
  sanitizeAuditInput,
} from '../../supabase/functions/_shared/mcp-security.ts';

describe('legacy MCP security helpers', () => {
  it('denies OAuth capabilities to non-staff and preserves current staff scopes', () => {
    expect(oauthScopesForStaff(false)).toBeNull();
    expect(oauthScopesForStaff(true)).toEqual([...OAUTH_STAFF_SCOPES]);
    expect(oauthScopesForStaff(true)).toContain('aceleriq:write');
  });

  it('persists only API-key UUIDs in the audit foreign key', () => {
    const apiKeyId = '11111111-2222-3333-4444-555555555555';
    expect(persistedAuditKeyId(apiKeyId)).toBe(apiKeyId);
    expect(persistedAuditKeyId('oauth:user-id')).toBeNull();
    expect(auditPrincipalSelector(apiKeyId)).toEqual({ keyId: apiKeyId, principal: null });
    expect(auditPrincipalSelector('oauth:user-id')).toEqual({ keyId: null, principal: 'oauth:user-id' });
  });

  it('redacts secrets, inline base64 and data URLs without removing safe fields', () => {
    const output = sanitizeAuditInput({
      title: 'Material aprovado',
      authorization: 'Bearer secret',
      content_base64: 'c2Vuc2l0aXZlLWZpbGU=',
      nested: {
        preview: 'data:image/png;base64,AAAA',
        url: 'https://example.test/file?token=very-secret&download=1',
        note: 'Falhou com Bearer abc.def.ghi',
        detail: 'api_key: local-secret',
      },
    }) as Record<string, any>;

    expect(output.title).toBe('Material aprovado');
    expect(output.authorization).toBe('[redacted]');
    expect(output.content_base64).toBe('[redacted:binary]');
    expect(output.nested.preview).toBe('[redacted:base64]');
    expect(output.nested.url).toContain('token=[redacted]');
    expect(output.nested.url).not.toContain('very-secret');
    expect(output.nested.note).toBe('Falhou com Bearer [redacted]');
    expect(output.nested.detail).toBe('api_key: [redacted]');
  });

  it('sanitizes and limits audit error messages', () => {
    const message = sanitizeAuditError(
      `Authorization failed: Bearer abc.def.ghi https://x.test?a=1&api_key=secret-value ${'x'.repeat(1500)}`,
    );
    expect(message).not.toContain('abc.def.ghi');
    expect(message).not.toContain('secret-value');
    expect(message?.length).toBeLessThanOrEqual(1001);
  });

  it('keeps OAuth identity and result reference in the sanitized audit payload', () => {
    expect(buildAuditInput(
      { idempotency_key: 'material-2026-01', content_base64: 'AAAA' },
      'oauth:user-id',
      'result-id',
    )).toEqual({
      idempotency_key: 'material-2026-01',
      content_base64: '[redacted:binary]',
      __principal: 'oauth:user-id',
      __result_ref: 'result-id',
    });
  });
});
