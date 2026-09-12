import { describe, expect, it } from 'vitest';
import { operatorRunIsStale } from '../../supabase/functions/_shared/operator-freshness';
import { assertMcpReleaseAgreement } from '../../scripts/verify-mcp-release.mjs';

describe('freshness is a pure projection of the persisted heartbeat', () => {
  const now = Date.parse('2026-09-12T21:00:00Z');
  it('uses the same timeout boundary as SQL without modifying status', () => {
    const run = { status: 'progress', heartbeat_at: '2026-09-12T20:44:59Z', timeout_seconds: 900 };
    expect(operatorRunIsStale(run, now)).toBe(true);
    expect(run.status).toBe('progress');
    expect(operatorRunIsStale({ ...run, heartbeat_at: '2026-09-12T20:45:00Z' }, now)).toBe(false);
    expect(operatorRunIsStale({ ...run, status: 'done' }, now)).toBe(false);
    expect(operatorRunIsStale({ ...run, heartbeat_at: null }, now)).toBe(false);
  });
});

describe('coherent MCP deployment', () => {
  const release = { source_revision: 'a'.repeat(40), bundle_sha256: 'b'.repeat(64) };
  const document = { mcp: { server_info: { version: '1.42.1' }, release } };
  it('accepts identical prepared server and metadata', () => {
    expect(assertMcpReleaseAgreement(document, document, release).source_revision).toBe(release.source_revision);
  });
  it('rejects a partial deployment even when the version string matches', () => {
    const partial = { mcp: { ...document.mcp, release: { ...release, bundle_sha256: 'c'.repeat(64) } } };
    expect(() => assertMcpReleaseAgreement(document, partial, release)).toThrow('bundle_sha256');
    expect(() => assertMcpReleaseAgreement(document, { mcp: { ...document.mcp, server_info: { version: '1.41.0' } } }, release)).toThrow('versions');
    expect(() => assertMcpReleaseAgreement(document, document, { source_revision: null })).toThrow('prepared');
  });
});
