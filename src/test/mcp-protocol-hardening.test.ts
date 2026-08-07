import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acceptsMcpResponse,
  isMcpOriginAllowed,
  isMcpProtocolVersionSupported,
  MCP_PROTOCOL_VERSION,
  prefersSse,
  resolveMcpAllowedOrigins,
  RpcErrors,
  validateJsonRpcRequest,
} from '../../supabase/functions/_shared/mcp-response.ts';

const server = readFileSync(
  resolve(process.cwd(), 'supabase/functions/mcp-server/index.ts'),
  'utf8',
);

describe('canonical MCP transport hardening', () => {
  it('allows native, ChatGPT, same-origin, and configured browser origins only', () => {
    const allowed = resolveMcpAllowedOrigins(
      'https://admin.example, *, null, https://bad.example/path',
      ['https://project.supabase.co/functions/v1/mcp'],
    );
    const request = (origin?: string, url = 'https://project.supabase.co/functions/v1/mcp') =>
      new Request(url, { headers: origin === undefined ? undefined : { origin } });

    expect([...allowed]).toEqual(expect.arrayContaining([
      'https://chatgpt.com',
      'https://chat.openai.com',
      'https://admin.example',
      'https://project.supabase.co',
    ]));
    expect(allowed.has('*')).toBe(false);
    expect(isMcpOriginAllowed(request(), allowed)).toBe(true);
    expect(isMcpOriginAllowed(request('https://chatgpt.com'), allowed)).toBe(true);
    expect(isMcpOriginAllowed(request('https://same.example', 'https://same.example/mcp'), allowed)).toBe(true);
    expect(isMcpOriginAllowed(request('https://evil.example'), allowed)).toBe(false);
    expect(isMcpOriginAllowed(request('null'), allowed)).toBe(false);
    expect(isMcpOriginAllowed(request('https://chatgpt.com.evil.example'), allowed)).toBe(false);
  });

  it('accepts only known Streamable HTTP protocol versions', () => {
    const request = (version?: string) => new Request('https://mcp.example/mcp', {
      headers: version === undefined ? undefined : { 'MCP-Protocol-Version': version },
    });

    expect(isMcpProtocolVersionSupported(request())).toBe(true);
    expect(isMcpProtocolVersionSupported(request(MCP_PROTOCOL_VERSION))).toBe(true);
    expect(isMcpProtocolVersionSupported(request('2025-03-26'))).toBe(true);
    expect(isMcpProtocolVersionSupported(request('2099-01-01'))).toBe(false);
    expect(isMcpProtocolVersionSupported(request(''))).toBe(false);
  });

  it('requires an acceptable JSON or SSE representation', () => {
    const request = (accept?: string) => new Request('https://mcp.example/mcp', {
      headers: accept === undefined ? undefined : { accept },
    });

    expect(acceptsMcpResponse(request('application/json'))).toBe(true);
    expect(acceptsMcpResponse(request('text/event-stream'))).toBe(true);
    expect(acceptsMcpResponse(request('application/json, text/event-stream'))).toBe(true);
    expect(acceptsMcpResponse(request('*/*'))).toBe(true);
    expect(acceptsMcpResponse(request('text/html'))).toBe(false);
    expect(acceptsMcpResponse(request())).toBe(false);
    expect(prefersSse(request('text/event-stream'))).toBe(true);
    expect(prefersSse(request('application/json, text/event-stream'))).toBe(false);
  });

  it('accepts one valid JSON-RPC request or notification and rejects batches', () => {
    expect(validateJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    })).toEqual(expect.objectContaining({ ok: true }));
    expect(validateJsonRpcRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })).toEqual(expect.objectContaining({ ok: true }));

    expect(validateJsonRpcRequest([
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    ])).toEqual(expect.objectContaining({
      ok: false,
      code: RpcErrors.invalidRequest,
      message: 'JSON-RPC batch requests are not supported',
    }));
  });

  it.each([
    ['null body', null, RpcErrors.invalidRequest],
    ['missing jsonrpc', { id: 1, method: 'tools/list' }, RpcErrors.invalidRequest],
    ['wrong jsonrpc', { jsonrpc: '1.0', id: 1, method: 'tools/list' }, RpcErrors.invalidRequest],
    ['missing method', { jsonrpc: '2.0', id: 1 }, RpcErrors.invalidRequest],
    ['empty method', { jsonrpc: '2.0', id: 1, method: ' ' }, RpcErrors.invalidRequest],
    ['object id', { jsonrpc: '2.0', id: {}, method: 'tools/list' }, RpcErrors.invalidRequest],
    ['array params', { jsonrpc: '2.0', id: 'x', method: 'tools/list', params: [] }, RpcErrors.invalidParams],
    ['null params', { jsonrpc: '2.0', id: 'x', method: 'tools/list', params: null }, RpcErrors.invalidParams],
  ])('rejects malformed envelope: %s', (_label, body, code) => {
    expect(validateJsonRpcRequest(body)).toEqual(expect.objectContaining({ ok: false, code }));
  });

  it('wires every guard before dispatch and does not expose GET health', () => {
    expect(server).toContain("Deno.env.get('MCP_ALLOWED_ORIGINS')");
    expect(server).toContain('isMcpOriginAllowed(req, MCP_ALLOWED_ORIGINS)');
    expect(server).toContain('isMcpProtocolVersionSupported(req)');
    expect(server).toContain('if (!acceptsMcpResponse(req))');
    expect(server).toContain('validateJsonRpcRequest(body)');
    expect(server).toContain("status: 405");
    expect(server).toContain("capabilities: { tools: { listChanged: false } }");
    expect(server).not.toContain("status: 'ok'");
    expect(server).not.toContain('bridgeStatusPublic()');
  });
});
