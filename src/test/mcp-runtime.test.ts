import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveMcpRuntimeConfig,
  type McpRuntimeEnvName,
} from '../../supabase/functions/_shared/mcp-runtime.ts';

function env(values: Partial<Record<McpRuntimeEnvName, string>>) {
  return (name: McpRuntimeEnvName) => values[name];
}

describe('portable MCP runtime configuration', () => {
  it('derives every endpoint from SUPABASE_URL', () => {
    const config = resolveMcpRuntimeConfig(env({
      SUPABASE_URL: ' https://project.example/supabase/ ',
      APP_PUBLIC_URL: 'https://app.example.test',
    }));

    expect(config).toEqual({
      supabaseUrl: 'https://project.example/supabase',
      authIssuer: 'https://project.example/supabase/auth/v1',
      resourceUrl: 'https://project.example/supabase/functions/v1/mcp-server',
      oauthMetadataUrl: 'https://project.example/supabase/functions/v1/mcp-oauth-metadata',
      appPublicUrl: 'https://app.example.test',
      authorizationServerMetadataUrl:
        'https://project.example/supabase/auth/v1/.well-known/oauth-authorization-server',
      jwksUrl: 'https://project.example/supabase/auth/v1/.well-known/jwks.json',
    });
  });

  it('honors independent public resource, metadata and issuer overrides', () => {
    const config = resolveMcpRuntimeConfig(env({
      SUPABASE_URL: 'http://supabase-kong:8000/',
      MCP_AUTH_ISSUER: 'https://project.supabase.co/auth/v1/',
      MCP_RESOURCE_URL: 'https://mcp.aceleriq.test/mcp/',
      MCP_OAUTH_METADATA_URL: 'https://mcp.aceleriq.test/oauth/resource/',
      APP_PUBLIC_URL: 'https://app.aceleriq.test',
    }));

    expect(config.supabaseUrl).toBe('http://supabase-kong:8000');
    expect(config.authIssuer).toBe('https://project.supabase.co/auth/v1');
    expect(config.resourceUrl).toBe('https://mcp.aceleriq.test/mcp');
    expect(config.oauthMetadataUrl).toBe('https://mcp.aceleriq.test/oauth/resource');
    expect(config.appPublicUrl).toBe('https://app.aceleriq.test');
    expect(config.authorizationServerMetadataUrl).toBe(
      'https://project.supabase.co/auth/v1/.well-known/oauth-authorization-server',
    );
  });

  it('allows metadata resolution from complete overrides without a Supabase base URL', () => {
    const config = resolveMcpRuntimeConfig(env({
      MCP_AUTH_ISSUER: 'https://auth.example.test',
      MCP_RESOURCE_URL: 'https://mcp.example.test/mcp',
      MCP_OAUTH_METADATA_URL: 'https://mcp.example.test/.well-known/oauth-protected-resource',
      APP_PUBLIC_URL: 'https://app.example.test',
    }));

    expect(config.supabaseUrl).toBeNull();
    expect(config.jwksUrl).toBe('https://auth.example.test/.well-known/jwks.json');
  });

  it('fails closed for incomplete or malformed endpoint configuration', () => {
    expect(() => resolveMcpRuntimeConfig(env({}))).toThrow(
      'MCP_AUTH_ISSUER or SUPABASE_URL must be configured',
    );
    expect(() => resolveMcpRuntimeConfig(env({
      MCP_AUTH_ISSUER: 'https://auth.example.test',
      MCP_RESOURCE_URL: 'not-a-url',
      MCP_OAUTH_METADATA_URL: 'https://mcp.example.test/oauth',
    }))).toThrow('MCP_RESOURCE_URL must be an absolute HTTP(S) URL');
    expect(() => resolveMcpRuntimeConfig(env({
      SUPABASE_URL: 'https://user:secret@example.test',
      APP_PUBLIC_URL: 'https://app.example.test',
    }))).toThrow('SUPABASE_URL must not contain embedded credentials');
    expect(() => resolveMcpRuntimeConfig(env({
      SUPABASE_URL: 'http://remote.example.test',
      APP_PUBLIC_URL: 'https://app.example.test',
    }))).toThrow('MCP_AUTH_ISSUER must use HTTPS outside localhost');
  });

  it('allows HTTP only for a loopback development transport', () => {
    const config = resolveMcpRuntimeConfig(env({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      APP_PUBLIC_URL: 'http://127.0.0.1:5173',
    }));
    expect(config.resourceUrl).toBe(
      'http://127.0.0.1:54321/functions/v1/mcp-server',
    );
  });

  it('rejects an insecure public application URL', () => {
    expect(() => resolveMcpRuntimeConfig(env({
      SUPABASE_URL: 'https://project.example',
      APP_PUBLIC_URL: 'http://app.example.test',
    }))).toThrow('APP_PUBLIC_URL must use HTTPS outside localhost');
  });

  it.each([
    'https://app.example.test/',
    'https://app.example.test/aceleriq',
  ])('rejects an APP_PUBLIC_URL that the root BrowserRouter cannot serve: %s', (appPublicUrl) => {
    expect(() => resolveMcpRuntimeConfig(env({
      SUPABASE_URL: 'https://project.example',
      APP_PUBLIC_URL: appPublicUrl,
    }))).toThrow('APP_PUBLIC_URL must contain only an origin');
  });

  it('wires every MCP Edge Function to the shared runtime without a project ref fallback', () => {
    const root = process.cwd();
    const sources = [
      'supabase/functions/mcp-server/index.ts',
      'supabase/functions/mcp-oauth-metadata/index.ts',
      'supabase/functions/_shared/mcp-auth.ts',
      'supabase/functions/_shared/mcp-contracts-services.ts',
    ].map(path => readFileSync(resolve(root, path), 'utf8'));
    const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');

    for (const source of sources) {
      expect(source).toContain('getMcpRuntimeConfig');
      expect(source).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/i);
      expect(source).not.toContain('SUPABASE_PROJECT_ID');
    }
    expect(config).toMatch(/\[functions\.mcp\]\s+verify_jwt = false/);
  });
});
