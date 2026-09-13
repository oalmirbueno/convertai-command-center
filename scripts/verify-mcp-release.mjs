import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function assertMcpReleaseAgreement(server, metadata, expected) {
  const version = server?.mcp?.server_info?.version;
  if (!version || metadata?.mcp?.server_info?.version !== version) throw new Error('MCP versions disagree');
  if (!/^[0-9a-f]{40}$/.test(expected?.source_revision ?? '') || !/^[0-9a-f]{64}$/.test(expected?.bundle_sha256 ?? '')) {
    throw new Error('Expected release must contain a prepared revision and digest');
  }
  for (const doc of [server, metadata]) {
    for (const field of ['source_revision', 'bundle_sha256']) {
      if (doc?.mcp?.release?.[field] !== expected[field]) throw new Error(`MCP ${field} disagrees with the prepared release`);
    }
  }
  return { version, ...expected };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, expectedPath] = process.argv.slice(2);
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
  const fetchJson = async path => {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Metadata unavailable: ${response.status}`);
    return response.json();
  };
  const [server, metadata] = await Promise.all([
    fetchJson('/functions/v1/mcp-server/.well-known/oauth-protected-resource'),
    fetchJson('/functions/v1/mcp-oauth-metadata'),
  ]);
  console.log(JSON.stringify(assertMcpReleaseAgreement(server, metadata, expected)));
}
