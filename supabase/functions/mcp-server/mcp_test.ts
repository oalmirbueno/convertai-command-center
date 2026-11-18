// Unit tests for the MCP server dispatch layer.
// Runs without network: we import the shared modules directly and craft
// synthetic AuthResult objects, so we don't need Supabase credentials.

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canInvoke, canUseToolWithDataScope, TOOL_MAP, TOOLS } from '../_shared/mcp-tools.ts';
import {
  fetchJwksDocument,
  hasScope,
  MAX_JWKS_BODY_BYTES,
  type AuthContext,
  validateJwksDocument,
} from '../_shared/mcp-auth.ts';
import { sanitize } from '../_shared/mcp-audit.ts';
import {
  canonicalizeEditorialIdempotencyInput,
  createEditorialItemSchema,
  createTaskSchema,
  deterministicEditorialTaskId,
  editorialPayloadFingerprint,
  updateTaskSchema,
} from '../_shared/mcp-write-services.ts';
import {
  acceptsMcpResponse,
  isMcpOriginAllowed,
  isMcpProtocolVersionSupported,
  MAX_MCP_REQUEST_BODY_BYTES,
  McpRequestBodyTooLargeError,
  MCP_PROTOCOL_VERSION,
  prefersSse,
  readMcpJsonBody,
  resolveMcpAllowedOrigins,
  rpcError,
  RpcErrors,
  rpcResult,
  validateJsonRpcRequest,
} from './modulos/mcp-response.ts';
import {
  assertWritableInbox,
  buildProposalMarkdown,
  CONTEXT_ORDER,
  INBOX_PREFIX,
  normalizePath,
  SecondBrainError,
} from '../_shared/second-brain-github.ts';

const readCtx: AuthContext = {
  keyId: '00000000-0000-0000-0000-000000000001',
  keyName: 'test-key',
  scopes: ['aceleriq:read'],
  origin: 'test',
  dataScope: {
    unrestricted: true,
    clientIds: [],
    principalUserId: '00000000-0000-0000-0000-000000000001',
    source: 'api_key',
  },
};
const emptyCtx: AuthContext = { ...readCtx, scopes: [] };
const adminCtx: AuthContext = { ...readCtx, scopes: ['admin'] };
const restrictedCtx: AuthContext = {
  ...readCtx,
  dataScope: {
    unrestricted: false,
    clientIds: ['00000000-0000-0000-0000-0000000000aa'],
    principalUserId: '00000000-0000-0000-0000-000000000001',
    source: 'oauth',
  },
};

Deno.test('MCP JSON reader parses bounded requests', async () => {
  const body = await readMcpJsonBody(new Request('https://mcp.example.test', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list' }),
  })) as Record<string, unknown>;
  assertEquals(body.jsonrpc, '2.0');
  assertEquals(body.method, 'tools/list');
});

Deno.test('MCP JSON reader rejects streamed bodies above the hard limit', async () => {
  const testLimit = 32;
  let error: unknown;
  try {
    await readMcpJsonBody(new Request('https://mcp.example.test', {
      method: 'POST',
      body: 'x'.repeat(testLimit + 1),
    }), testLimit);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof McpRequestBodyTooLargeError);
});

Deno.test('MCP JSON reader rejects a declared body above the hard limit before parsing', async () => {
  const testLimit = 32;
  let error: unknown;
  try {
    await readMcpJsonBody(new Request('https://mcp.example.test', {
      method: 'POST',
      headers: { 'content-length': String(testLimit + 1) },
      body: '{}',
    }), testLimit);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof McpRequestBodyTooLargeError);
});

Deno.test('MCP JSON reader rejects invalid UTF-8 instead of replacing bytes', async () => {
  let error: unknown;
  try {
    await readMcpJsonBody(new Request('https://mcp.example.test', {
      method: 'POST',
      body: new Uint8Array([0xff]),
    }));
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof TypeError);
});

Deno.test('MCP transport limit preserves the 10 MiB inline-file contract', () => {
  const inlineFileBytes = 10 * 1024 * 1024;
  const base64Bytes = 4 * Math.ceil(inlineFileBytes / 3);
  assert(
    MAX_MCP_REQUEST_BODY_BYTES >= base64Bytes + 64 * 1024,
    'transport limit must leave room for the base64 file and JSON-RPC envelope',
  );
});

Deno.test('JWKS fetch is bounded, non-redirecting, and accepts supported signing keys', async () => {
  let capturedInit: RequestInit | undefined;
  const validKey = {
    kty: 'RSA',
    alg: 'RS256',
    use: 'sig',
    kid: 'primary-key',
    n: 'test-modulus',
    e: 'AQAB',
  };
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(new Response(JSON.stringify({ keys: [validKey] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  }) as typeof fetch;

  const keys = await fetchJwksDocument('https://issuer.example.test/.well-known/jwks.json', fetchImpl);
  assertEquals(keys.length, 1);
  assertEquals(keys[0].kid, 'primary-key');
  assertEquals(capturedInit?.redirect, 'error');
  assert(capturedInit?.signal instanceof AbortSignal);
  assertEquals(new Headers(capturedInit?.headers).get('accept'), 'application/json');
});

Deno.test('JWKS validation rejects empty, excessive, and unsupported key sets', () => {
  assertThrows(() => validateJwksDocument({ keys: [] }), Error, 'invalid number of keys');
  assertThrows(
    () => validateJwksDocument({
      keys: Array.from({ length: 17 }, (_, index) => ({
        kty: 'RSA', alg: 'RS256', use: 'sig', kid: `key-${index}`,
      })),
    }),
    Error,
    'invalid number of keys',
  );
  assertThrows(
    () => validateJwksDocument({ keys: [{ kty: 'oct', alg: 'HS256', kid: 'shared-secret' }] }),
    Error,
    'unsupported signing key',
  );
});

Deno.test('JWKS fetch rejects an oversized document before reading it', async () => {
  const fetchImpl = (() => Promise.resolve(new Response('{}', {
    status: 200,
    headers: { 'content-length': String(MAX_JWKS_BODY_BYTES + 1) },
  }))) as typeof fetch;
  await assertRejects(
    () => fetchJwksDocument('https://issuer.example.test/.well-known/jwks.json', fetchImpl),
    Error,
    'exceeds the allowed limit',
  );
});

Deno.test('registry exposes the complete reviewed tool catalogue without duplicate names', () => {
  const names = TOOLS.map(t => t.name).sort();
  assertEquals(new Set(names).size, names.length, 'tool names must be unique');
  assertEquals(names, [
    'aceleriq_acesso_estado',
    'aceleriq_acesso_pedir',
    'aceleriq_acesso_usar',
    'aceleriq_add_opportunity_note',
    'aceleriq_ads_boletim',
    'aceleriq_ads_registrar_acao',
    'aceleriq_agent_conversations',
    'aceleriq_agent_handoff',
    'aceleriq_ajustar_formato_publicacao',
    'aceleriq_archive_file',
    'aceleriq_archive_opportunity',
    'aceleriq_archive_project',
    'aceleriq_audit_integrity',
    'aceleriq_aviso_publicacao_decidir',
    'aceleriq_aviso_publicacao_fila',
    'aceleriq_aviso_publicacao_marcar_enviado',
    'aceleriq_aviso_publicacao_preparar',
    'aceleriq_base_dos_agentes',
    'aceleriq_browser_act',
    'aceleriq_browser_session',
    'aceleriq_cancel_contract',
    'aceleriq_capabilities',
    'aceleriq_central_instalar',
    'aceleriq_central_publicar_skill',
    'aceleriq_central_review_decidir',
    'aceleriq_central_review_fila',
    'aceleriq_central_review_marcar_enviado',
    'aceleriq_central_review_preparar',
    'aceleriq_central_skill',
    'aceleriq_central_skills',
    'aceleriq_cerebro_arvore',
    'aceleriq_cerebro_do_cliente',
    'aceleriq_cerebro_registrar',
    'aceleriq_cerebro_salvar_nota',
    'aceleriq_client_instruction',
    'aceleriq_comercial_atribuir_agente',
    'aceleriq_comercial_avisar_caixa',
    'aceleriq_comercial_bolso_liberar',
    'aceleriq_comercial_bolso_pedir',
    'aceleriq_comercial_cobrar',
    'aceleriq_comercial_entrada_nova',
    'aceleriq_comercial_falar',
    'aceleriq_comercial_fila',
    'aceleriq_comercial_horarios',
    'aceleriq_comercial_maquina_buscar',
    'aceleriq_comercial_maquina_candidatos',
    'aceleriq_comercial_marcar_reuniao',
    'aceleriq_comercial_pedir_proposta',
    'aceleriq_comercial_registrar_fato',
    'aceleriq_comercial_registrar_mensagem',
    'aceleriq_comercial_repasse_marcar',
    'aceleriq_comercial_repasses',
    'aceleriq_complete_commercial_activity',
    'aceleriq_complete_task',
    'aceleriq_create_commercial_activity',
    'aceleriq_create_contract',
    'aceleriq_create_editorial_item',
    'aceleriq_create_file_version',
    'aceleriq_create_opportunity',
    'aceleriq_create_project',
    'aceleriq_create_report_draft',
    'aceleriq_create_task',
    'aceleriq_criar_publicacao_de_aprovado',
    'aceleriq_delete_opportunity',
    'aceleriq_delete_task',
    'aceleriq_dia_prioritario',
    'aceleriq_dia_prioritario_registrar',
    'aceleriq_editar_legenda_publicacao',
    'aceleriq_email_conferir',
    'aceleriq_email_entradas',
    'aceleriq_email_marcar_pago',
    'aceleriq_email_migracao',
    'aceleriq_email_registrar',
    'aceleriq_escritorio_automacao',
    'aceleriq_escritorio_caixa',
    'aceleriq_escritorio_diretorio',
    'aceleriq_escritorio_entrar',
    'aceleriq_escritorio_enviar',
    'aceleriq_escritorio_grupos',
    'aceleriq_escritorio_marcar_lida',
    'aceleriq_escritorio_presenca',
    'aceleriq_estudio_erros',
    'aceleriq_estudio_trabalhos',
    'aceleriq_fetch',
    'aceleriq_finalize_file_upload',
    'aceleriq_get_ads_campaigns',
    'aceleriq_get_ads_creatives',
    'aceleriq_get_ads_performance',
    'aceleriq_get_agenda_status',
    'aceleriq_get_briefing',
    'aceleriq_get_client_context',
    'aceleriq_get_client_dossier',
    'aceleriq_get_contract',
    'aceleriq_get_current_dossier',
    'aceleriq_get_cycle_status',
    'aceleriq_get_file',
    'aceleriq_get_file_content',
    'aceleriq_get_file_processing_status',
    'aceleriq_get_finance_ads_investment',
    'aceleriq_get_finance_billing',
    'aceleriq_get_finance_capital',
    'aceleriq_get_finance_cash_flow',
    'aceleriq_get_finance_client_summaries',
    'aceleriq_get_finance_dashboard',
    'aceleriq_get_finance_overview',
    'aceleriq_get_opportunity',
    'aceleriq_get_project',
    'aceleriq_get_project_memory',
    'aceleriq_get_report',
    'aceleriq_get_social_metrics',
    'aceleriq_get_weekly_cycle',
    'aceleriq_get_workspace_node',
    'aceleriq_guia',
    'aceleriq_health',
    'aceleriq_instagram_diagnostico',
    'aceleriq_laboratorio',
    'aceleriq_link_project_to_client',
    'aceleriq_list_briefings',
    'aceleriq_list_clients',
    'aceleriq_list_commercial_activities',
    'aceleriq_list_commercial_organizations',
    'aceleriq_list_contracts',
    'aceleriq_list_editorial_calendar',
    'aceleriq_list_files',
    'aceleriq_list_finance_entries',
    'aceleriq_list_finance_expenses',
    'aceleriq_list_finance_history',
    'aceleriq_list_finance_mensalidades',
    'aceleriq_list_finance_plans',
    'aceleriq_list_finance_project_payments',
    'aceleriq_list_finance_recurring',
    'aceleriq_list_opportunities',
    'aceleriq_list_projects',
    'aceleriq_list_reports',
    'aceleriq_list_social_posts',
    'aceleriq_list_tasks',
    'aceleriq_list_workspace_nodes',
    'aceleriq_listar_precisa_de_voce',
    'aceleriq_marcar_precisa_de_voce',
    'aceleriq_mcp_saude',
    'aceleriq_membros',
    'aceleriq_mensagens_automaticas_fila',
    'aceleriq_mensagens_automaticas_marcar_enviado',
    'aceleriq_mes_campanhas',
    'aceleriq_mesa_ads_arte_gerar',
    'aceleriq_mesa_ads_briefing_salvar',
    'aceleriq_mesa_ads_contexto',
    'aceleriq_mesa_ads_criativos_produzir',
    'aceleriq_mesa_ads_entregar_ao_gestor',
    'aceleriq_mesa_ads_oferta_do_contexto',
    'aceleriq_mesa_ads_oferta_salvar',
    'aceleriq_mesa_ads_plano_gerar',
    'aceleriq_mesa_ads_saude',
    'aceleriq_mesa_calendario_gravar',
    'aceleriq_mesa_calendario_pedido',
    'aceleriq_mesa_campanha_acao',
    'aceleriq_mesa_campanha_criar',
    'aceleriq_mesa_campanha_salvar',
    'aceleriq_mesa_enviar_para_aprovacao',
    'aceleriq_mesa_foto_contexto',
    'aceleriq_mesa_hype',
    'aceleriq_mesa_site',
    'aceleriq_mesa_stories',
    'aceleriq_mesa_templates',
    'aceleriq_move_opportunity',
    'aceleriq_navegador_do_pc',
    'aceleriq_operator_assign',
    'aceleriq_operator_board',
    'aceleriq_operator_checklist',
    'aceleriq_operator_diary',
    'aceleriq_operator_digest',
    'aceleriq_operator_organize',
    'aceleriq_operator_propose_assignee',
    'aceleriq_operator_queue',
    'aceleriq_operator_register',
    'aceleriq_operator_report',
    'aceleriq_operator_request_approval',
    'aceleriq_panorama_da_casa',
    'aceleriq_panorama_do_cliente',
    'aceleriq_perfis_instagram_arquivar',
    'aceleriq_perfis_instagram_gravar',
    'aceleriq_perfis_instagram_listar',
    'aceleriq_prepare_file_upload',
    'aceleriq_reagendar_publicacao',
    'aceleriq_register_dossier_progress',
    'aceleriq_regras_permanentes',
    'aceleriq_reopen_task',
    'aceleriq_restore_file',
    'aceleriq_restore_project',
    'aceleriq_revisar_trabalho_interno',
    'aceleriq_ritual_redigir',
    'aceleriq_search',
    'aceleriq_search_file_content',
    'aceleriq_studio_draft',
    'aceleriq_studio_read',
    'aceleriq_update_client',
    'aceleriq_update_contract',
    'aceleriq_update_file_metadata',
    'aceleriq_update_opportunity',
    'aceleriq_update_project',
    'aceleriq_update_task',
    'aceleriq_upload_file',
    'aceleriq_upload_file_inline',
    'aceleriq_upsert_commercial_contact',
    'aceleriq_upsert_commercial_organization',
    'aceleriq_upsert_current_dossier',
    'aceleriq_upsert_project_memory',
    'aceleriq_vault_overview',
    'aceleriq_workspace_criar_arquivo',
    'aceleriq_workspace_link_arquivo',
    'aceleriq_workspace_mover_arquivo',
    'aceleriq_workspace_retirar_aprovacao',
    'memory_fetch',
    'memory_get_context',
    'memory_get_pulse',
    'memory_list_pending_proposals',
    'memory_propose_update',
    'memory_recent_commits',
    'memory_search',
  ]);
});

Deno.test('foundation tools are open to any authenticated key; gated tools require the right scope', () => {
  // 2.17: aceleriq_guia é o mapa do painel e o manual das ferramentas (o mesmo que tools/list já mostra), sem dado de cliente.
  const foundation = ['aceleriq_health', 'aceleriq_capabilities', 'aceleriq_guia'];
  for (const t of TOOLS) {
    if (foundation.includes(t.name)) {
      assert(canInvoke(emptyCtx, t), `${t.name} should be public-auth`);
      continue;
    }
    assert(!canInvoke(emptyCtx, t), `${t.name} should be gated`);
    assert(canInvoke(adminCtx, t), `${t.name} should allow admin`);
    if (t.name.startsWith('memory_')) continue; // memory scopes tested separately
    if (t.scopes.some(scope => scope.endsWith(':write') || scope === 'files:archive')) {
      assert(!canInvoke(readCtx, t), `${t.name} should reject aceleriq:read`);
      continue;
    }
    assert(canInvoke(readCtx, t), `${t.name} should allow aceleriq:read`);
  }
});

Deno.test('restricted service-role principals only see explicitly client-scoped handlers', () => {
  assert(canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_list_clients')!));
  assert(canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_list_tasks')!));
  assert(canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_list_editorial_calendar')!));
  assert(!canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_list_reports')!));
  assert(!canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_list_contracts')!));
  assert(canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('memory_get_context')!));
  assert(canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('memory_propose_update')!));
  assert(canUseToolWithDataScope(adminCtx, TOOL_MAP.get('aceleriq_list_reports')!));
});

Deno.test('read tools reject invalid input via Zod', async () => {
  const tool = TOOL_MAP.get('aceleriq_get_project')!;
  let threw = false;
  try { await tool.handler({ project_id: 'not-a-uuid' }, readCtx); }
  catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw, 'expected Zod validation to reject invalid UUID');
});

Deno.test('fetch rejects unsupported entity types', async () => {
  const tool = TOOL_MAP.get('aceleriq_fetch')!;
  let threw = false;
  try { await tool.handler({ type: 'expenses', id: '00000000-0000-0000-0000-000000000000' }, readCtx); }
  catch { threw = true; }
  assert(threw, 'expected fetch to reject non-whitelisted entity');
});

Deno.test('search rejects empty query', async () => {
  const tool = TOOL_MAP.get('aceleriq_search')!;
  let threw = false;
  try { await tool.handler({ query: '' }, readCtx); }
  catch { threw = true; }
  assert(threw);
});

Deno.test('hasScope: empty required = allowed, admin overrides everything', () => {
  assert(hasScope(emptyCtx, []));
  assert(!hasScope(emptyCtx, ['aceleriq:write']));
  assert(hasScope(adminCtx, ['aceleriq:finance']));
  assert(hasScope(readCtx, ['aceleriq:read']));
});

Deno.test('aceleriq_health returns server info + key context', async () => {
  const tool = TOOL_MAP.get('aceleriq_health')!;
  const out = await tool.handler({}, readCtx) as Record<string, unknown>;
  assertEquals(out.ok, true);
  assertEquals(out.server, 'aceleriq-mcp');
  assertEquals((out.key as any).name, 'test-key');
  assert(typeof out.now === 'string' && (out.now as string).endsWith('Z'));
});

Deno.test('aceleriq_capabilities lists only tools the key can invoke', async () => {
  const tool = TOOL_MAP.get('aceleriq_capabilities')!;
  const outEmpty = await tool.handler({}, emptyCtx) as Record<string, unknown>;
  assertEquals((outEmpty.tools as any[]).map(t => t.name).sort(), ['aceleriq_capabilities', 'aceleriq_guia', 'aceleriq_health']);
  const outRead = await tool.handler({}, readCtx) as Record<string, unknown>;
  assert((outRead.tools as any[]).length > 2);
  const outRestricted = await tool.handler({}, {
    ...restrictedCtx,
    scopes: ['aceleriq:read', 'aceleriq:write', 'memory:read', 'memory:propose'],
  }) as Record<string, unknown>;
  const restrictedNames = (outRestricted.tools as any[]).map(t => t.name);
  assert(restrictedNames.includes('aceleriq_list_clients'));
  assert(restrictedNames.includes('aceleriq_list_editorial_calendar'));
  assert(restrictedNames.includes('memory_get_context'));
  assert(!restrictedNames.includes('aceleriq_list_reports'));
  assert(!restrictedNames.includes('aceleriq_list_contracts'));
});

Deno.test('sanitize redacts secret-like keys and preserves shape', () => {
  const out = sanitize({
    name: 'ok',
    api_key: 'sk-xxx',
    nested: { authorization: 'Bearer abc', keep: 1 },
    list: [{ password: 'pw' }],
  }) as any;
  assertEquals(out.name, 'ok');
  assertEquals(out.api_key, '[redacted]');
  assertEquals(out.nested.authorization, '[redacted]');
  assertEquals(out.nested.keep, 1);
  assertEquals(out.list[0].password, '[redacted]');
});

Deno.test('rpcResult / rpcError shape', () => {
  assertEquals(rpcResult(1, { a: 1 }), { jsonrpc: '2.0', id: 1, result: { a: 1 } });
  const err = rpcError(2, RpcErrors.unauthorized, 'no');
  assertEquals(err.error?.code, -32001);
});

Deno.test('prefersSse honors Accept header', () => {
  const mk = (accept: string) => new Request('http://x', { headers: { accept } });
  assert(prefersSse(mk('text/event-stream')));
  assert(!prefersSse(mk('application/json, text/event-stream')));
  assert(!prefersSse(mk('application/json')));
  assert(!prefersSse(mk('')));
});

Deno.test('MCP transport Accept negotiation requires JSON or SSE', () => {
  const mk = (accept?: string) => new Request('https://mcp.example/functions/v1/mcp', {
    headers: accept === undefined ? undefined : { accept },
  });
  assert(acceptsMcpResponse(mk('application/json')));
  assert(acceptsMcpResponse(mk('text/event-stream')));
  assert(acceptsMcpResponse(mk('application/json, text/event-stream')));
  assert(acceptsMcpResponse(mk('*/*')));
  assert(!acceptsMcpResponse(mk('text/html')));
  assert(!acceptsMcpResponse(mk()));
});

Deno.test('MCP protocol version accepts current, compatibility baseline, and absent only', () => {
  const mk = (version?: string) => new Request('https://mcp.example/functions/v1/mcp', {
    headers: version === undefined ? undefined : { 'MCP-Protocol-Version': version },
  });
  assert(isMcpProtocolVersionSupported(mk()));
  assert(isMcpProtocolVersionSupported(mk(MCP_PROTOCOL_VERSION)));
  assert(isMcpProtocolVersionSupported(mk('2025-03-26')));
  assert(!isMcpProtocolVersionSupported(mk('2099-01-01')));
});

Deno.test('MCP origin policy allows native, ChatGPT, same-origin, and configured origins only', () => {
  const allowed = resolveMcpAllowedOrigins(
    'https://admin.example, *, javascript:alert(1), https://bad.example/path',
    ['https://project.supabase.co/functions/v1/mcp'],
  );
  const request = (origin?: string, url = 'https://project.supabase.co/functions/v1/mcp') =>
    new Request(url, { headers: origin === undefined ? undefined : { origin } });

  assert(allowed.has('https://chatgpt.com'));
  assert(allowed.has('https://chat.openai.com'));
  assert(allowed.has('https://admin.example'));
  assert(allowed.has('https://project.supabase.co'));
  assert(!allowed.has('*'));
  assert(isMcpOriginAllowed(request(), allowed));
  assert(isMcpOriginAllowed(request('https://chatgpt.com'), allowed));
  assert(isMcpOriginAllowed(request('https://admin.example'), allowed));
  assert(isMcpOriginAllowed(request('https://same.example', 'https://same.example/mcp'), allowed));
  assert(!isMcpOriginAllowed(request('https://evil.example'), allowed));
  assert(!isMcpOriginAllowed(request('null'), allowed));
});

Deno.test('MCP JSON-RPC envelope rejects batches and malformed fields', () => {
  assert(validateJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }).ok);
  assert(validateJsonRpcRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }).ok);

  const batch = validateJsonRpcRequest([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  assertEquals(batch.ok, false);
  if (!batch.ok) assertEquals(batch.code, RpcErrors.invalidRequest);

  for (const malformed of [
    null,
    { id: 1, method: 'tools/list' },
    { jsonrpc: '1.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 1, method: '' },
    { jsonrpc: '2.0', id: {}, method: 'tools/list' },
  ]) {
    assertEquals(validateJsonRpcRequest(malformed).ok, false);
  }

  const badParams = validateJsonRpcRequest({
    jsonrpc: '2.0',
    id: 'x',
    method: 'tools/list',
    params: [],
  });
  assertEquals(badParams.ok, false);
  if (!badParams.ok) assertEquals(badParams.code, RpcErrors.invalidParams);
});

// ─── Round 4: Second Brain bridge ────────────────────────────
const memoryReadCtx: AuthContext = { ...readCtx, scopes: ['memory:read'] };
const memoryProposeCtx: AuthContext = { ...readCtx, scopes: ['memory:propose'] };

Deno.test('memory tools require correct scopes', () => {
  const t = (name: string) => TOOL_MAP.get(name)!;
  assert(!canInvoke(emptyCtx, t('memory_get_context')));
  assert(canInvoke(memoryReadCtx, t('memory_get_context')));
  assert(canInvoke(memoryReadCtx, t('memory_search')));
  assert(canInvoke(memoryReadCtx, t('memory_fetch')));
  assert(canInvoke(memoryReadCtx, t('memory_list_pending_proposals')));
  assert(canInvoke(memoryReadCtx, t('memory_get_pulse')));
  assert(canInvoke(memoryReadCtx, t('memory_recent_commits')));
  assert(!canInvoke(emptyCtx, t('memory_get_pulse')));
  assert(!canInvoke(emptyCtx, t('memory_recent_commits')));
  assert(!canInvoke(memoryReadCtx, t('memory_propose_update')));
  assert(canInvoke(memoryProposeCtx, t('memory_propose_update')));
  assert(canInvoke(adminCtx, t('memory_propose_update')));
});

Deno.test('CONTEXT_ORDER matches AGENTS_MEMORY_BRIDGE hierarchy', () => {
  assertEquals(CONTEXT_ORDER, [
    'AGENTS_MEMORY_BRIDGE.md',
    'memory/agent-context.md',
    'MEMORY.md',
    'memory/now.md',
  ]);
});

Deno.test('normalizePath rejects traversal, absolute paths, and empty segments', () => {
  for (const bad of ['../etc/passwd', '/absolute/path', 'memory/../MEMORY.md', 'a//b', '', './x']) {
    let threw = false;
    try { normalizePath(bad); } catch (e) { threw = e instanceof SecondBrainError; }
    assert(threw, `expected reject: ${bad}`);
  }
  assertEquals(normalizePath('memory/agent-context.md'), 'memory/agent-context.md');
  assertEquals(normalizePath('memory\\inbox\\chatgpt\\x.md'), 'memory/inbox/chatgpt/x.md');
});

Deno.test('assertWritableInbox: only inbox/chatgpt/*.md at root, everything else blocked', () => {
  // allowed
  assertEquals(
    assertWritableInbox(INBOX_PREFIX + '2026-07-12T12-00-00Z--x--abcd1234.md'),
    'memory/inbox/chatgpt/2026-07-12T12-00-00Z--x--abcd1234.md',
  );
  // blocked cases
  const blocked = [
    'MEMORY.md',
    'memory/now.md',
    'memory/decisions.md',
    'memory/lessons.md',
    'memory/pending.md',
    'memory/projects/site/plan.md',
    'memory/context/anything.md',
    'memory/inbox/openclaw/note.md',
    'memory/inbox/hermes/note.md',
    'AGENTS_MEMORY_BRIDGE.md',
    'memory/inbox/chatgpt/sub/nested.md',   // no subfolders
    'memory/inbox/chatgpt/no-ext',          // must be .md
    'README.md',                            // root writes blocked
  ];
  for (const p of blocked) {
    let threw = false;
    try { assertWritableInbox(p); } catch (e) { threw = e instanceof SecondBrainError; }
    assert(threw, `expected block: ${p}`);
  }
});

Deno.test('buildProposalMarkdown emits YAML front-matter + required sections', () => {
  const md = buildProposalMarkdown({
    title: 'Teste',
    summary: 'Este é um resumo suficientemente longo.',
    origin: 'chatgpt-work',
    correlation_id: 'abcd12345678',
    context: 'ctx',
    risks: 'risco baixo',
  }, { path: 'memory/inbox/chatgpt/x.md', created_at: '2026-07-12T00:00:00.000Z' });
  assert(md.startsWith('---\n'), 'must open with YAML front-matter');
  assert(md.includes('status: pending-review'));
  assert(md.includes('# Teste'));
  assert(md.includes('## Resumo'));
  assert(md.includes('## Contexto'));
  assert(md.includes('## Riscos'));
  assert(md.includes('correlation_id: "abcd12345678"'));
});

Deno.test('memory_propose_update rejects invalid input via Zod (short title, missing origin)', async () => {
  const tool = TOOL_MAP.get('memory_propose_update')!;
  let threw = false;
  try { await tool.handler({ title: 'x', summary: 'y', correlation_id: '123456' }, memoryProposeCtx); }
  catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

// ─── Round 5: write tools ────────────────────────────────────
const writeCtx: AuthContext = { ...readCtx, scopes: ['aceleriq:write'], correlationId: '00000000-0000-0000-0000-0000000000aa' };

Deno.test('write tools require aceleriq:write scope', () => {
  for (const name of ['aceleriq_create_task', 'aceleriq_update_task', 'aceleriq_complete_task', 'aceleriq_create_report_draft']) {
    const t = TOOL_MAP.get(name)!;
    assert(!canInvoke(readCtx, t), `${name} must not accept read-only key`);
    assert(canInvoke(writeCtx, t), `${name} must accept write key`);
    assert(canInvoke(adminCtx, t), `${name} must accept admin key`);
    assert(t.scopes.includes('aceleriq:write' as any), `${name} keeps aggregate write scope`);
  }
});

Deno.test('create_task rejects unknown fields (strict allowlist)', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_task')!;
  let threw = false;
  try {
    await tool.handler({
      project_id: '00000000-0000-0000-0000-000000000001',
      title: 'x', idempotency_key: 'abcd1234',
      client_id: '00000000-0000-0000-0000-000000000002', // NOT allowed
    }, writeCtx);
  } catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

Deno.test('create_task requires project_id, title, idempotency_key', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_task')!;
  let threw = false;
  try { await tool.handler({ title: 'x' }, writeCtx); }
  catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

Deno.test('create_task rejects too-short idempotency_key', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_task')!;
  let threw = false;
  try {
    await tool.handler({
      project_id: '00000000-0000-0000-0000-000000000001',
      title: 'x', idempotency_key: 'abc',
    }, writeCtx);
  } catch (e) { threw = true; }
  assert(threw);
});

Deno.test('task write contracts expose optional delivery_type with unspecified compatibility', () => {
  const deliveryTypes = [
    'unspecified',
    'design',
    'branding',
    'static',
    'carousel',
    'reel',
    'story',
    'video',
    'short',
    'article',
    'google_post',
    'planning',
    'copywriting',
    'website',
    'landing_page',
    'automation',
    'traffic',
    'seo',
    'document',
    'report',
    'other',
  ];
  const createTool = TOOL_MAP.get('aceleriq_create_task')!;
  const updateTool = TOOL_MAP.get('aceleriq_update_task')!;
  assertEquals(
    ((createTool.inputSchema as any).properties.delivery_type as any).enum,
    deliveryTypes,
  );
  assertEquals(
    ((updateTool.inputSchema as any).properties.delivery_type as any).enum,
    deliveryTypes,
  );
  assert(
    !(createTool.inputSchema as any).required.includes('delivery_type'),
  );
  assert(
    !(updateTool.inputSchema as any).required.includes('delivery_type'),
  );

  const createBase = {
    project_id: '00000000-0000-0000-0000-000000000001',
    title: 'Tarefa MCP',
    idempotency_key: 'delivery-type-create',
  };
  assert(createTaskSchema.safeParse(createBase).success);
  assert(
    createTaskSchema.safeParse({
      ...createBase,
      delivery_type: 'unspecified',
    }).success,
  );
  assert(
    updateTaskSchema.safeParse({
      task_id: '00000000-0000-0000-0000-000000000002',
      delivery_type: 'carousel',
      idempotency_key: 'delivery-type-update',
    }).success,
  );
  assert(
    !createTaskSchema.safeParse({
      ...createBase,
      delivery_type: 'invalid',
    }).success,
  );
  assert(
    !updateTaskSchema.safeParse({
      task_id: '00000000-0000-0000-0000-000000000002',
      delivery_type: 'invalid',
      idempotency_key: 'delivery-type-update-invalid',
    }).success,
  );
});

Deno.test('editorial tools expose safe, strict contracts and dedicated scopes', () => {
  const list = TOOL_MAP.get('aceleriq_list_editorial_calendar')!;
  const create = TOOL_MAP.get('aceleriq_create_editorial_item')!;
  assert(list.scopes.includes('editorial:read' as any));
  assert(create.scopes.includes('editorial:write' as any));
  assert(!canInvoke(readCtx, create));
  assert(canInvoke({ ...readCtx, scopes: ['editorial:write'] }, create));
  assertEquals((list.inputSchema as any).required, ['client_id']);
  assertEquals((create.inputSchema as any).additionalProperties, false);
  assert(!(create.inputSchema as any).properties.status, 'create must not approve or complete');
  assert(!(create.inputSchema as any).properties.scheduled_at, 'create must not schedule');
  assert(!(create.inputSchema as any).properties.external_account_id, 'create must not publish');

  const base = {
    client_id: '00000000-0000-0000-0000-000000000001',
    project_id: '00000000-0000-0000-0000-000000000002',
    title: 'Carrossel educativo',
    description: 'Briefing editorial completo.',
    delivery_type: 'carousel',
    due_date: '2026-08-20',
    idempotency_key: 'editorial-create-001',
  };
  assert(createEditorialItemSchema.safeParse(base).success);
  assert(!createEditorialItemSchema.safeParse({ ...base, delivery_type: 'planning' }).success);
  assert(!createEditorialItemSchema.safeParse({ ...base, due_date: '2026-02-31' }).success);
  assert(!createEditorialItemSchema.safeParse({ ...base, description: undefined, context: undefined }).success);
});

Deno.test('editorial idempotency canonicalizes aliases and ignores later task state', async () => {
  const original = canonicalizeEditorialIdempotencyInput({
    client_id: '00000000-0000-0000-0000-000000000001',
    project_id: '00000000-0000-0000-0000-000000000002',
    title: '  Carrossel educativo  ',
    description: ' Briefing editorial completo. ',
    delivery_type: 'carousel',
    due_date: '2026-08-20',
  });
  const replay = canonicalizeEditorialIdempotencyInput({
    client_id: '00000000-0000-0000-0000-000000000001',
    project_id: '00000000-0000-0000-0000-000000000002',
    title: 'Carrossel educativo',
    description: 'Briefing editorial completo.',
    format: 'carousel',
    due_date: '2026-08-20',
    status: 'doing',
  });
  assertEquals(replay, original);
  const changed = canonicalizeEditorialIdempotencyInput({
    ...replay,
    title: 'Outro conteúdo',
  });
  assert(JSON.stringify(changed) !== JSON.stringify(original));

  const taskId = await deterministicEditorialTaskId('oauth:user-a', 'editorial-create-001');
  assertEquals(
    taskId,
    await deterministicEditorialTaskId('oauth:user-a', 'editorial-create-001'),
  );
  assert(taskId !== await deterministicEditorialTaskId('oauth:user-b', 'editorial-create-001'));
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(taskId));
  assertEquals(
    await editorialPayloadFingerprint(original),
    await editorialPayloadFingerprint(replay),
  );
  assert(
    await editorialPayloadFingerprint(changed)
      !== await editorialPayloadFingerprint(original),
  );
});

Deno.test('update_task requires at least one updatable field', async () => {
  const tool = TOOL_MAP.get('aceleriq_update_task')!;
  let threw = false;
  try {
    await tool.handler({
      task_id: '00000000-0000-0000-0000-000000000001',
      idempotency_key: 'abcd1234',
    }, writeCtx);
  } catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

Deno.test('update_task rejects unknown/forbidden fields (project_id switch, source, created_by)', async () => {
  const tool = TOOL_MAP.get('aceleriq_update_task')!;
  for (const bad of [{ project_id: '00000000-0000-0000-0000-000000000009' }, { source: 'x' }, { created_by: '00000000-0000-0000-0000-000000000009' }]) {
    let threw = false;
    try {
      await tool.handler({
        task_id: '00000000-0000-0000-0000-000000000001',
        idempotency_key: 'abcd1234',
        title: 'ok',
        ...bad,
      }, writeCtx);
    } catch (e) { threw = true; }
    assert(threw, `expected reject: ${JSON.stringify(bad)}`);
  }
});

Deno.test('create_report_draft rejects status, file_url, internal_notes, client_id (allowlist)', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_report_draft')!;
  const base = {
    project_id: '00000000-0000-0000-0000-000000000001',
    title: 'Rascunho', idempotency_key: 'abcd12345',
  };
  for (const bad of [{ status: 'published' }, { file_url: 'https://x' }, { internal_notes: 'x' }, { client_id: '00000000-0000-0000-0000-000000000009' }, { created_by: '00000000-0000-0000-0000-000000000009' }, { images: [] }]) {
    let threw = false;
    try { await tool.handler({ ...base, ...bad }, writeCtx); }
    catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
    assert(threw, `expected reject: ${JSON.stringify(bad)}`);
  }
});

Deno.test('complete_task minimal schema: only task_id + idempotency_key', () => {
  const tool = TOOL_MAP.get('aceleriq_complete_task')!;
  assertEquals((tool.inputSchema as any).required, ['task_id', 'idempotency_key']);
  assertEquals((tool.inputSchema as any).additionalProperties, false);
});

// ─── Bloco B: contracts scope gating ─────────────────────────
const contractsReadCtx: AuthContext = { ...readCtx, scopes: ['contracts:read'] };
const contractsWriteCtx: AuthContext = { ...readCtx, scopes: ['contracts:write'], correlationId: '00000000-0000-0000-0000-0000000000bb' };

Deno.test('contracts read tools accept contracts:read OR aceleriq:read', () => {
  for (const name of ['aceleriq_list_contracts', 'aceleriq_get_contract']) {
    const t = TOOL_MAP.get(name)!;
    assert(canInvoke(contractsReadCtx, t), `${name} must accept contracts:read`);
    assert(canInvoke(readCtx, t), `${name} must accept aceleriq:read`);
    assert(canInvoke(adminCtx, t));
    assert(!canInvoke(emptyCtx, t));
  }
});

Deno.test('contracts write tools require contracts:write; aceleriq:write is NOT enough', () => {
  const writeOnly: AuthContext = { ...readCtx, scopes: ['aceleriq:write'] };
  for (const name of ['aceleriq_create_contract', 'aceleriq_update_contract', 'aceleriq_cancel_contract']) {
    const t = TOOL_MAP.get(name)!;
    assert(!canInvoke(readCtx, t), `${name} must reject read-only`);
    assert(!canInvoke(writeOnly, t), `${name} must NOT accept plain aceleriq:write`);
    assert(canInvoke(contractsWriteCtx, t), `${name} must accept contracts:write`);
    assert(canInvoke(adminCtx, t));
    assertEquals(t.scopes, ['contracts:write']);
  }
});

Deno.test('generic MCP contract sending is not exposed', () => {
  assertEquals(TOOL_MAP.has('aceleriq_send_contract'), false);
});

Deno.test('create_contract requires client_id, title, file fields, idempotency_key', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_contract')!;
  let threw = false;
  try { await tool.handler({ title: 'x' }, contractsWriteCtx); }
  catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

Deno.test('update_contract requires at least one updatable field', async () => {
  const tool = TOOL_MAP.get('aceleriq_update_contract')!;
  let threw = false;
  try {
    await tool.handler({
      contract_id: '00000000-0000-0000-0000-000000000001',
      idempotency_key: 'abcd1234',
    }, contractsWriteCtx);
  } catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

Deno.test('contracts write tools reject unknown fields (strict allowlist)', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_contract')!;
  let threw = false;
  try {
    await tool.handler({
      client_id: '00000000-0000-0000-0000-000000000002',
      title: 'x',
      original_file_url: 'https://example.com/a.pdf',
      original_file_name: 'a.pdf',
      idempotency_key: 'abcd1234',
      status: 'signed', // forbidden: status is server-controlled
    }, contractsWriteCtx);
  } catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

// ─── Bloco D: granular OAuth scopes ──────────────────────────
import { SCOPE_DESCRIPTIONS, ALL_SCOPES, expandScopes, GRANULAR_SCOPE_BY_TOOL } from '../_shared/mcp-tools.ts';

Deno.test('every scope has a human-readable description', () => {
  for (const s of ALL_SCOPES) {
    const d = SCOPE_DESCRIPTIONS[s];
    assert(d && d.title && d.description, `missing description for ${s}`);
  }
});

Deno.test('aggregate aceleriq:read expands to all granular reads', () => {
  const exp = expandScopes(['aceleriq:read']);
  for (const s of ['clients:read','projects:read','tasks:read','reports:read','briefings:read','files:read','workspace:read','contracts:read','editorial:read']) {
    assert(exp.has(s), `expected expansion to include ${s}`);
  }
  assert(!exp.has('projects:write'), 'read must not grant writes');
});

Deno.test('aggregate aceleriq:write grants editorial creation but never through read scope', () => {
  const write = expandScopes(['aceleriq:write']);
  const read = expandScopes(['aceleriq:read']);
  assert(write.has('editorial:write'));
  assert(!read.has('editorial:write'));
});

Deno.test('granular scope alone authorizes only its own tools', () => {
  const projectsRead: AuthContext = { ...readCtx, scopes: ['projects:read'] };
  const projectsTool = TOOL_MAP.get('aceleriq_list_projects')!;
  const clientsTool = TOOL_MAP.get('aceleriq_list_clients')!;
  assert(canInvoke(projectsRead, projectsTool));
  assert(!canInvoke(projectsRead, clientsTool));
});

Deno.test('every mapped granular scope is on the resolved tool', () => {
  for (const [name, scope] of Object.entries(GRANULAR_SCOPE_BY_TOOL)) {
    const t = TOOL_MAP.get(name);
    assert(t, `missing tool ${name}`);
    assert(t!.scopes.includes(scope as any), `${name} missing scope ${scope}`);
  }
});

// ─── Mesas (v1.46.0): estudar antes de rodar tráfego ──────────
import { arteDoTrabalho, faltaNoBanco, kitParaLer, planoParaLer, tomadaParaLer } from '../_shared/mcp-mesas-formato.ts';

const MESAS = ['aceleriq_mesa_ads_contexto', 'aceleriq_mesa_foto_contexto'];

Deno.test('mesas: as duas leituras estão registradas, só leem e pedem o escopo certo', () => {
  for (const nome of MESAS) {
    const t = TOOL_MAP.get(nome);
    assert(t, `missing ${nome}`);
    assertEquals(t!.annotations?.readOnlyHint, true);
    assertEquals(t!.annotations?.destructiveHint, false);
    assert(canInvoke(readCtx, t!), `${nome} should allow aceleriq:read`);
    assert(!canInvoke(emptyCtx, t!), `${nome} should be gated`);
    assertEquals((t!.inputSchema as any).required, ['client_id']);
    assertEquals((t!.inputSchema as any).additionalProperties, false);
    // Português, orientando a estudar antes, e sem travessão.
    assert(/estudar/i.test(t!.description), `${nome} should tell the agent to study first`);
    assert(!/[–—]/.test(t!.description + (t!.title ?? '')), `${nome} must not use dashes`);
  }
  assert(TOOL_MAP.get('aceleriq_mesa_ads_contexto')!.scopes.includes('reports:read'));
  assert(TOOL_MAP.get('aceleriq_mesa_foto_contexto')!.scopes.includes('files:read'));
  const soRelatorio: AuthContext = { ...readCtx, scopes: ['reports:read'] };
  assert(canInvoke(soRelatorio, TOOL_MAP.get('aceleriq_mesa_ads_contexto')!));
  assert(!canInvoke(soRelatorio, TOOL_MAP.get('aceleriq_mesa_foto_contexto')!));
});

Deno.test('mesas: principal restrito a cliente não alcança (despachante e handler)', async () => {
  for (const nome of MESAS) {
    const t = TOOL_MAP.get(nome)!;
    assert(!canUseToolWithDataScope(restrictedCtx, t), `${nome} is not tenant-scoped`);
    await assertRejects(
      () => t.handler({ client_id: '00000000-0000-0000-0000-0000000000bb' }, restrictedCtx),
      Error,
      'outside this MCP principal data scope',
    );
  }
});

Deno.test('mesas: entrada inválida é recusada pelo Zod', async () => {
  for (const nome of MESAS) {
    const t = TOOL_MAP.get(nome)!;
    await assertRejects(() => t.handler({ client_id: 'nao-e-uuid' }, readCtx), Error, 'Invalid input');
    await assertRejects(() => t.handler({ client_id: '00000000-0000-0000-0000-0000000000aa', extra: 1 }, readCtx), Error, 'Invalid input');
  }
});

Deno.test('mesas: o mapa do painel aponta Mesa Ads e Mesa Foto para as leituras novas', async () => {
  const out = await TOOL_MAP.get('aceleriq_capabilities')!.handler({}, readCtx) as Record<string, unknown>;
  const mapa = out.mapa_do_painel as Array<{ area: string; rota: string; pelo_mcp: string }>;
  const ads = mapa.find((m) => m.area === 'Mesa Ads');
  const foto = mapa.find((m) => m.area === 'Mesa Foto');
  assert(ads && ads.rota === '/mesa-ads' && ads.pelo_mcp.includes('aceleriq_mesa_ads_contexto'));
  assert(foto && foto.rota === '/mesa-foto' && foto.pelo_mcp.includes('aceleriq_mesa_foto_contexto'));
});

Deno.test('mesas: arte entregue vale mais que a do Estúdio; sem entrega, a versão mais recente de cada lâmina', () => {
  const entregue = arteDoTrabalho({
    status: 'entregue',
    direcao: { entrega_ads: { arquivos: [{ ordem: 2, versao: 1, storage_path: 'c/f/v1/2.png' }, { ordem: 1, versao: 3, storage_path: 'c/f/v1/1.png' }] } },
    cards: [{ ordem: 1, versao: 9, storage_path: 'c/estudio/1-9.png' }],
  });
  assertEquals(entregue.fonte, 'entregue');
  assertEquals(entregue.imagens.map((i) => [i.bucket, i.ordem]), [['files', 1], ['files', 2]]);

  const estudio = arteDoTrabalho({
    status: 'pronto',
    direcao: { cards: [{ ordem: 2 }, { ordem: 1 }] },
    cards: [
      { ordem: 1, versao: 1, storage_path: 'a/1-1.png' },
      { ordem: 1, versao: 2, storage_path: 'a/1-2.png' },
      { ordem: 2, versao: 1, storage_path: 'a/2-1.png' },
    ],
  });
  assertEquals(estudio.fonte, 'estudio');
  assertEquals(estudio.imagens.map((i) => [i.bucket, i.caminho]), [['mesa', 'a/1-2.png'], ['mesa', 'a/2-1.png']]);
  assertEquals(arteDoTrabalho(null).fonte, 'sem_arte');
});

Deno.test('mesas: o plano traz o porquê, as notas do Jev e os descartados com motivo', () => {
  const p = planoParaLer({
    id: 'p1',
    nome: 'Plano',
    angulos: [{ id: 'a1', nome: 'Dor', hipotese: 'Quem sente a dor clica', jev: { clareza: 8, alerta_politica: false }, aprovado: true, motivos: [] }],
    estrutura: { descartados: [{ id: 'd1', nome: 'Antes e depois', motivos: ['Antes e depois viola política'] }], lacunas: ['Sem preço confirmado'], conjuntos: [{ nome: 'Frio', angulo_ids: ['a1'] }] },
  });
  const angulo = (p.angulos as any[])[0];
  assertEquals(angulo.por_que, 'Quem sente a dor clica');
  assertEquals(angulo.notas_do_jev.clareza, 8);
  assertEquals((p.descartados as any[])[0].motivos_do_jev, ['Antes e depois viola política']);
  assertEquals(p.lacunas, ['Sem preço confirmado']);
});

Deno.test('mesas: foto sem tabela vira aviso; kit não expõe dados da autorização', () => {
  assert(faltaNoBanco({ code: 'PGRST205', message: "Could not find the table 'public.foto_kits' in the schema cache" }));
  assert(faltaNoBanco({ code: '42703', message: 'column cliente_imagens.aprovada does not exist' }));
  assert(!faltaNoBanco({ code: '42501', message: 'permission denied' }));
  const kit = kitParaLer({ id: 'k', nome: 'Pessoa', autorizacao: { nome: 'Fulana', documento: '123' } }, []);
  assertEquals(kit.autorizacao_registrada, true);
  assert(!JSON.stringify(kit).includes('Fulana'));
  const { paraAssinar } = tomadaParaLer({ versoes: [{ versao: 1, storage_path: 'x/1.png', aprovada: true }, { versao: 2, storage_path: 'x/2.png' }, { versao: 3, storage_path: 'x/3.png' }] });
  assertEquals(paraAssinar.map((v) => v.versao).sort(), [1, 3]);
});

// ─── MCP 2.3: agir nas mesas e o cérebro do cliente ──────────
import { folegoResponse } from './modulos/mcp-response.ts';
import { chamarMesa, esperarOuSeguir } from '../_shared/mcp-mesas-acoes.ts';

const ACOES_2_3 = [
  'aceleriq_mesa_calendario_pedido',
  'aceleriq_mesa_calendario_gravar',
  'aceleriq_mesa_campanha_criar',
  'aceleriq_mesa_campanha_salvar',
  'aceleriq_mesa_ads_briefing_salvar',
  'aceleriq_mesa_ads_oferta_salvar',
  'aceleriq_mesa_ads_oferta_do_contexto',
  'aceleriq_mesa_enviar_para_aprovacao',
];
const escritaCtx: AuthContext = { ...readCtx, scopes: ['aceleriq:write'] };
const soMesas: AuthContext = { ...readCtx, scopes: ['mesas:write'] };

Deno.test('2.3: ações nas mesas exigem mesas:write, não aceitam leitura e dizem que agem', () => {
  for (const nome of ACOES_2_3) {
    const t = TOOL_MAP.get(nome);
    assert(t, `missing ${nome}`);
    assert(t!.scopes.includes('mesas:write'), `${nome} needs mesas:write`);
    assert(!canInvoke(readCtx, t!), `${nome} must reject aceleriq:read`);
    assert(canInvoke(escritaCtx, t!), `${nome} should accept aceleriq:write (expands to mesas:write)`);
    assert(canInvoke(soMesas, t!), `${nome} should accept mesas:write`);
    assertEquals(t!.annotations?.readOnlyHint, false);
    assertEquals((t!.inputSchema as any).additionalProperties, false);
    assert(((t!.inputSchema as any).required as string[]).includes('idempotency_key'), `${nome} requires idempotency_key`);
    assert(/OAuth/.test(t!.description), `${nome} must say it needs OAuth`);
    assert(!/[–—]/.test(t!.description + (t!.title ?? '')), `${nome} must not use dashes`);
    // Restrito a cliente não alcança: nenhuma ação está na lista tenant-scoped.
    assert(!canUseToolWithDataScope(restrictedCtx, t!), `${nome} is not tenant-scoped`);
  }
});

Deno.test('2.3: custo de IA e efeito no cliente pedem confirmação explícita', async () => {
  const base = { client_id: '00000000-0000-0000-0000-0000000000aa', idempotency_key: 'teste-2-3-0001' };
  await assertRejects(() => TOOL_MAP.get('aceleriq_mesa_calendario_pedido')!.handler({ ...base, mensagem: 'três posts' }, adminCtx), Error, 'Invalid input');
  await assertRejects(() => TOOL_MAP.get('aceleriq_mesa_calendario_pedido')!.handler({ ...base, mensagem: 'três posts', confirmar_custo: false }, adminCtx), Error, 'Invalid input');
  await assertRejects(() => TOOL_MAP.get('aceleriq_mesa_campanha_criar')!.handler({ ...base, pedido: 'Dia dos Pais' }, adminCtx), Error, 'Invalid input');
  await assertRejects(
    () => TOOL_MAP.get('aceleriq_mesa_enviar_para_aprovacao')!.handler({ trabalho_ids: ['00000000-0000-0000-0000-0000000000cc'], motivo: 'pronto', idempotency_key: 'teste-2-3-0002' }, adminCtx),
    Error, 'Invalid input',
  );
  await assertRejects(
    () => TOOL_MAP.get('aceleriq_mesa_campanha_salvar')!.handler({ campanha_id: '00000000-0000-0000-0000-0000000000dd', idempotency_key: 'teste-2-3-0003' }, adminCtx),
    Error, 'Invalid input',
  );
  for (const longa of ['aceleriq_mesa_calendario_pedido', 'aceleriq_mesa_campanha_criar', 'aceleriq_mesa_enviar_para_aprovacao']) {
    assertEquals(TOOL_MAP.get(longa)!.longRunning, true, `${longa} responds with breath`);
  }
  assertEquals(TOOL_MAP.get('aceleriq_mesa_campanha_salvar')!.longRunning, false);
});

Deno.test('2.15: chave sem dono não age nas mesas; chave com dono age com a sessão do dono; ação fora da lista nem sai', async () => {
  // Chave sem dono (legada): só lê.
  const chaveSemDono: AuthContext = { ...adminCtx, dataScope: { ...adminCtx.dataScope, source: 'api_key', principalUserId: null } };
  await assertRejects(() => chamarMesa('mesa-ads', 'oferta_do_contexto', { client_id: 'x' }, chaveSemDono), Error, 'mesa:exige_oauth');
  // Chave com dono (19/10, autorizado pelo dono): busca a sessão do dono. Aqui, sem banco, recusa com o motivo
  // em vez de cair na chave de serviço.
  const chaveComDono: AuthContext = { ...adminCtx, dataScope: { ...adminCtx.dataScope, source: 'api_key' } };
  await assertRejects(() => chamarMesa('mesa-ads', 'oferta_do_contexto', { client_id: 'x' }, chaveComDono), Error, 'mesa:dono_da_chave');
  // OAuth sem o token da pessoa também não passa (nunca cai na chave de serviço).
  const oauthSemToken: AuthContext = { ...adminCtx, dataScope: { ...adminCtx.dataScope, source: 'oauth' } };
  await assertRejects(() => chamarMesa('mesa-ads', 'oferta_do_contexto', { client_id: 'x' }, oauthSemToken), Error, 'mesa:exige_oauth');
  // Ação que não está na ponte (mexer na conta da Meta) é recusada mesmo com a pessoa conectada.
  const comToken: AuthContext = { ...oauthSemToken, userAccessToken: 'token-de-teste' };
  await assertRejects(() => chamarMesa('mesa-ads', 'conta_acao_executar', {}, comToken), Error, 'mesa:acao_fora_da_ponte');
  await assertRejects(() => chamarMesa('estudio-arte', 'gerar_card', {}, comToken), Error, 'mesa:acao_fora_da_ponte');
});

const ACOES_ADS_2_12 = [
  'aceleriq_mesa_ads_plano_gerar',
  'aceleriq_mesa_ads_criativos_produzir',
  'aceleriq_mesa_ads_arte_gerar',
  'aceleriq_mesa_ads_entregar_ao_gestor',
];

Deno.test('2.12: Mesa Ads até o gestor exige mesas:write, OAuth, idempotência e confirmação de custo onde há IA', async () => {
  for (const nome of ACOES_ADS_2_12) {
    const t = TOOL_MAP.get(nome);
    assert(t, `missing ${nome}`);
    assert(t!.scopes.includes('mesas:write'), `${nome} needs mesas:write`);
    assert(!canInvoke(readCtx, t!), `${nome} must reject aceleriq:read`);
    assert(canInvoke(soMesas, t!), `${nome} should accept mesas:write`);
    assertEquals((t!.inputSchema as any).additionalProperties, false);
    assert(((t!.inputSchema as any).required as string[]).includes('idempotency_key'), `${nome} requires idempotency_key`);
    assert(/OAuth/.test(t!.description), `${nome} must say it needs OAuth`);
    assert(!/[–—]/.test(t!.description + (t!.title ?? '')), `${nome} must not use dashes`);
    assert(!canUseToolWithDataScope(restrictedCtx, t!), `${nome} is not tenant-scoped`);
  }
  const cliente = '00000000-0000-0000-0000-0000000000aa';
  await assertRejects(() => TOOL_MAP.get('aceleriq_mesa_ads_plano_gerar')!.handler({ client_id: cliente, idempotency_key: 'teste-2-12-0001' }, adminCtx), Error, 'Invalid input');
  await assertRejects(() => TOOL_MAP.get('aceleriq_mesa_ads_criativos_produzir')!.handler({ plano_id: cliente, angulo_id: 'a1', idempotency_key: 'teste-2-12-0002' }, adminCtx), Error, 'Invalid input');
  await assertRejects(() => TOOL_MAP.get('aceleriq_mesa_ads_arte_gerar')!.handler({ trabalho_id: cliente, idempotency_key: 'teste-2-12-0003' }, adminCtx), Error, 'Invalid input');
  // Entregar ao gestor pede o plano ou os criativos.
  await assertRejects(() => TOOL_MAP.get('aceleriq_mesa_ads_entregar_ao_gestor')!.handler({ client_id: cliente, idempotency_key: 'teste-2-12-0004' }, adminCtx), Error, 'Invalid input');
  // Respondem em até ~6 s (o Paperclip corta em 10 s): JSON direto, sem fôlego.
  for (const nome of ACOES_ADS_2_12) assertEquals(TOOL_MAP.get(nome)!.longRunning, false, `${nome} answers fast`);
});

Deno.test('2.12: ação longa responde em andamento e segue; a rápida devolve o resultado e o erro', async () => {
  const ctx: AuthContext = { ...adminCtx, correlationId: 'teste-2-12-segundo-plano' };
  const rapida = await esperarOuSeguir('aceleriq_mesa_ads_plano_gerar', ctx, 'cliente', 'chave-0001',
    Promise.resolve({ ref: 'ads_plano:p1', resultado: { plano_id: 'p1' } }), 50);
  assertEquals(rapida, { ref: 'ads_plano:p1', resultado: { plano_id: 'p1' } });
  await assertRejects(
    () => esperarOuSeguir('aceleriq_mesa_ads_plano_gerar', ctx, 'cliente', 'chave-0002', Promise.reject(new Error('mesa:sem_briefing Salve o briefing')), 50),
    Error, 'mesa:sem_briefing',
  );
  let terminar: (v: { ref: string | null; resultado: Record<string, unknown> }) => void = () => {};
  const lenta = new Promise<{ ref: string | null; resultado: Record<string, unknown> }>((ok) => { terminar = ok; });
  const resposta = await esperarOuSeguir('aceleriq_mesa_ads_criativos_produzir', ctx, 'cliente', 'chave-0003', lenta, 20);
  assertEquals(resposta.resultado.em_andamento, true);
  assertEquals(resposta.ref, 'em_andamento:aceleriq_mesa_ads_criativos_produzir');
  assert(String(resposta.resultado.como_acompanhar).includes('aceleriq_mesa_ads_contexto'));
  terminar({ ref: 'ads_plano:p1:a1', resultado: {} });
  await lenta;
});

Deno.test('2.3: cérebro lê com clients:read e escreve com clients:write', () => {
  const ler = TOOL_MAP.get('aceleriq_cerebro_do_cliente')!;
  const gravar = TOOL_MAP.get('aceleriq_cerebro_registrar')!;
  assert(canInvoke(readCtx, ler));
  assert(!canInvoke(readCtx, gravar));
  assert(canInvoke(escritaCtx, gravar));
  assertEquals(ler.annotations?.readOnlyHint, true);
  assertEquals((gravar.inputSchema as any).required, ['client_id', 'area', 'categoria', 'texto', 'idempotency_key']);
  assert(!canUseToolWithDataScope(restrictedCtx, ler));
  assert(!canUseToolWithDataScope(restrictedCtx, gravar));
});

Deno.test('2.3: o mapa do painel aponta as ações e o cérebro', async () => {
  const out = await TOOL_MAP.get('aceleriq_capabilities')!.handler({}, adminCtx) as Record<string, unknown>;
  const mapa = out.mapa_do_painel as Array<{ area: string; rota: string; pelo_mcp: string }>;
  const mesa = mapa.find((m) => m.area === 'Mesa do cliente');
  assert(mesa && mesa.pelo_mcp.includes('aceleriq_mesa_calendario_pedido') && mesa.pelo_mcp.includes('aceleriq_mesa_enviar_para_aprovacao'));
  assert(mapa.find((m) => m.area === 'Mesa Ads')!.pelo_mcp.includes('aceleriq_mesa_ads_oferta_salvar'));
  assert(mapa.find((m) => m.area === 'Cerebro do cliente')!.pelo_mcp.includes('aceleriq_cerebro_registrar'));
  assert(mapa.find((m) => m.area === 'Mesa Ads')!.pelo_mcp.includes('aceleriq_mesa_ads_entregar_ao_gestor'));
  // 2.17: + aceleriq_mesa_campanha_acao (as ações novas da campanha).
  // 2.28: + aceleriq_revisar_trabalho_interno e aceleriq_marcar_precisa_de_voce (rodam com a sessão da pessoa).
  assertEquals((out.counts as Record<string, number>).mesas_write, ACOES_2_3.length + ACOES_ADS_2_12.length + 1 + 2);
});

Deno.test('2.3: resposta com fôlego respira antes e entrega JSON-RPC válido (JSON e SSE)', async () => {
  const final = rpcResult(7, { ok: true });
  const json = await folegoResponse(() => Promise.resolve(final), false, 7, 5).text();
  assert(json.startsWith(' '));
  assertEquals(JSON.parse(json), final);
  const sse = await folegoResponse(() => Promise.resolve(final), true, 7, 5).text();
  assert(sse.startsWith(': folego'));
  assert(sse.includes(`data: ${JSON.stringify(final)}`));
  const falhou = await folegoResponse(() => Promise.reject(new Error('quebrou')), false, 8, 5).text();
  assertEquals(JSON.parse(falhou).error.message, 'quebrou');
});

Deno.test('AB2: GET sem Bearer desafia, GET pedindo stream e 405, o resto e a descoberta publica', async () => {
  const { decidirGet, descobertaDoMcp, getPedeStream } = await import('../_shared/mcp-descoberta.ts');
  assertEquals(decidirGet({ authorization: null, accept: '*/*' }), 'desafio_oauth');
  assertEquals(decidirGet({ authorization: 'Bearer x', accept: 'text/event-stream' }), 'sem_stream');
  assertEquals(decidirGet({ authorization: 'Bearer x', accept: 'application/json, text/event-stream' }), 'sem_stream');
  // O fetch do navegador manda */*: nao e pedido de stream.
  assertEquals(decidirGet({ authorization: 'Bearer x', accept: '*/*' }), 'descoberta');
  assertEquals(decidirGet({ authorization: 'Bearer x', accept: null }), 'descoberta');
  assert(!getPedeStream('text/*'));
  const d = descobertaDoMcp({
    servidor: { name: 'aceleriq-mcp', version: '9.9.9' },
    protocolVersion: MCP_PROTOCOL_VERSION,
    toolCount: TOOLS.length,
    segundoCerebroConfigurado: false,
    agora: new Date('2026-09-26T12:00:00Z'),
  });
  assertEquals(d.status, 'ok');
  assertEquals(d.toolCount, TOOLS.length);
  assertEquals(d.serverTime, '2026-09-26T12:00:00.000Z');
  assertEquals(Object.keys(d.secondBrain), ['configured']);
});

Deno.test('editar legenda aprovada: ferramenta no catálogo, escopo editorial:write e schema fechado', async () => {
  const { editarLegendaSchema, LIMITE_DA_LEGENDA } = await import('./modulos/editar-legenda-publicacao.ts');
  const { CLIENT_SCOPED_LEGACY_TOOLS } = await import('../_shared/mcp-security.ts');
  const { RPCS_DA_PONTE } = await import('../_shared/mcp-mesas-ponte.ts');
  const tool = TOOL_MAP.get('aceleriq_editar_legenda_publicacao');
  assert(tool, 'ferramenta no catálogo');
  assert(tool.scopes.includes('editorial:write'));
  assertEquals(tool.annotations?.readOnlyHint, false);
  const schema = tool.inputSchema as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
  assertEquals(schema.additionalProperties, false);
  assertEquals([...schema.required].sort(), ['caption', 'confirmar', 'expected_version', 'idempotency_key', 'publication_id']);
  assertEquals(schema.properties.confirmar.const, true);
  assertEquals(schema.properties.caption.maxLength, LIMITE_DA_LEGENDA);
  assert((CLIENT_SCOPED_LEGACY_TOOLS as readonly string[]).includes('aceleriq_editar_legenda_publicacao'));
  assert((RPCS_DA_PONTE as readonly string[]).includes('editar_legenda_publicacao_aprovada'));

  const base = {
    publication_id: '11111111-1111-4111-8111-111111111111',
    expected_version: 3,
    caption: 'Legenda nova',
    confirmar: true,
    idempotency_key: 'legenda-0001',
  };
  assert(editarLegendaSchema.safeParse(base).success);
  assert(!editarLegendaSchema.safeParse({ ...base, confirmar: false }).success, 'sem confirmar não edita');
  assert(!editarLegendaSchema.safeParse({ ...base, caption: '   ' }).success, 'legenda vazia não passa');
  assert(!editarLegendaSchema.safeParse({ ...base, caption: 'x'.repeat(LIMITE_DA_LEGENDA + 1) }).success);
  assert(!editarLegendaSchema.safeParse({ ...base, content_type: 'story' }).success, 'não aceita mudar formato por aqui');
  assert(!editarLegendaSchema.safeParse({ ...base, idempotency_key: 'curta' }).success);
  // Sem escopo de escrita não chama.
  assert(!canInvoke(readCtx, tool));
  assert(canInvoke(adminCtx, tool));
});

Deno.test('ajustar formato aprovado: ferramenta no catálogo, escopo editorial:write e schema fechado', async () => {
  const { ajustarFormatoSchema, FORMATOS_DE_PECA_UNICA } = await import('./modulos/editar-legenda-publicacao.ts');
  const { CLIENT_SCOPED_LEGACY_TOOLS } = await import('../_shared/mcp-security.ts');
  const { RPCS_DA_PONTE } = await import('../_shared/mcp-mesas-ponte.ts');
  const { FERRAMENTAS_POR_AREA } = await import('./modulos/guia-do-painel.ts');
  const tool = TOOL_MAP.get('aceleriq_ajustar_formato_publicacao');
  assert(tool, 'ferramenta no catálogo');
  assert(tool.scopes.includes('editorial:write'));
  assertEquals(tool.annotations?.readOnlyHint, false);
  const schema = tool.inputSchema as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
  assertEquals(schema.additionalProperties, false);
  assertEquals([...schema.required].sort(), ['confirmar', 'content_type', 'expected_version', 'idempotency_key', 'post_id']);
  assertEquals(schema.properties.confirmar.const, true);
  assertEquals(schema.properties.content_type.enum, ['static', 'story', 'reel', 'video']);
  assertEquals([...FORMATOS_DE_PECA_UNICA], ['static', 'story', 'reel', 'video']);
  assert((CLIENT_SCOPED_LEGACY_TOOLS as readonly string[]).includes('aceleriq_ajustar_formato_publicacao'));
  assert((RPCS_DA_PONTE as readonly string[]).includes('ajustar_formato_publicacao_aprovada'));
  assert(FERRAMENTAS_POR_AREA.calendario.includes('aceleriq_ajustar_formato_publicacao'));

  const base = {
    post_id: '22222222-2222-4222-8222-222222222222',
    expected_version: 5,
    content_type: 'story',
    confirmar: true,
    idempotency_key: 'formato-0001',
  };
  assert(ajustarFormatoSchema.safeParse(base).success);
  for (const formato of ['static', 'reel', 'video']) {
    assert(ajustarFormatoSchema.safeParse({ ...base, content_type: formato }).success, formato);
  }
  assert(!ajustarFormatoSchema.safeParse({ ...base, content_type: 'carousel' }).success, 'carrossel não troca por aqui');
  assert(!ajustarFormatoSchema.safeParse({ ...base, confirmar: false }).success, 'sem confirmar não ajusta');
  assert(!ajustarFormatoSchema.safeParse({ ...base, expected_version: undefined }).success, 'versão é obrigatória');
  assert(!ajustarFormatoSchema.safeParse({ ...base, idempotency_key: 'curta' }).success);
  assert(!ajustarFormatoSchema.safeParse({ ...base, caption: 'x' }).success, 'não aceita mudar legenda por aqui');
  assert(!ajustarFormatoSchema.safeParse({ ...base, publication_id: base.post_id }).success, 'é o conteúdo, não a publicação');
  // Sem escopo de escrita não chama.
  assert(!canInvoke(readCtx, tool));
  assert(canInvoke(adminCtx, tool));
});

// ─── MCP 2.28.0 (14/11/2026): revisão interna, caixa Precisa de você e pedido ao dono ───

Deno.test('2.28: as três ferramentas estão no catálogo e contadas na descoberta', async () => {
  const { MCP_VERSION } = await import('../_shared/mcp-release.ts');
  const { descobertaDoMcp } = await import('../_shared/mcp-descoberta.ts');
  for (const nome of ['aceleriq_revisar_trabalho_interno', 'aceleriq_listar_precisa_de_voce', 'aceleriq_marcar_precisa_de_voce']) {
    assert(TOOL_MAP.get(nome), `${nome} no catálogo`);
  }
  const d = descobertaDoMcp({
    servidor: { name: 'aceleriq-mcp', version: MCP_VERSION },
    protocolVersion: MCP_PROTOCOL_VERSION,
    toolCount: TOOLS.length,
    segundoCerebroConfigurado: false,
    agora: new Date('2026-11-14T12:00:00Z'),
  });
  assertEquals(d.toolCount, TOOLS.length);
});

Deno.test('revisão interna: escrita com mesas:write, cliente no escopo, RPC na ponte e schema fechado', async () => {
  const { revisarTrabalhoSchema, NOTA_MINIMA_DO_AJUSTE } = await import('./modulos/precisa-de-voce-e-revisao.ts');
  const { CLIENT_SCOPED_LEGACY_TOOLS } = await import('../_shared/mcp-security.ts');
  const { RPCS_DA_PONTE } = await import('../_shared/mcp-mesas-ponte.ts');
  const { FERRAMENTAS_POR_AREA } = await import('./modulos/guia-do-painel.ts');
  const tool = TOOL_MAP.get('aceleriq_revisar_trabalho_interno');
  assert(tool, 'ferramenta no catálogo');
  assert(tool.scopes.includes('mesas:write'));
  assertEquals(tool.annotations?.readOnlyHint, false);
  assertEquals(tool.annotations?.destructiveHint, false);
  const schema = tool.inputSchema as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
  assertEquals(schema.additionalProperties, false);
  assertEquals([...schema.required].sort(), ['decisao', 'idempotency_key', 'trabalho_id']);
  assertEquals(schema.properties.decisao.enum, ['aprovado', 'ajuste']);
  assert((CLIENT_SCOPED_LEGACY_TOOLS as readonly string[]).includes('aceleriq_revisar_trabalho_interno'));
  assert((RPCS_DA_PONTE as readonly string[]).includes('revisar_trabalho_interno'));
  assert(FERRAMENTAS_POR_AREA.aprovacoes.includes('aceleriq_revisar_trabalho_interno'));
  // A descrição diz o limite, com todas as letras.
  for (const trecho of ['aprovação do cliente NÃO muda', 'não aprova pelo cliente', 'não agenda', 'não publica']) {
    assert(tool.description.includes(trecho), trecho);
  }

  const base = { trabalho_id: '33333333-3333-4333-8333-333333333333', decisao: 'aprovado', idempotency_key: 'revisao-0001' };
  assert(revisarTrabalhoSchema.safeParse(base).success);
  assert(revisarTrabalhoSchema.safeParse({ ...base, decisao: 'ajuste', nota: 'x'.repeat(NOTA_MINIMA_DO_AJUSTE) }).success);
  assert(!revisarTrabalhoSchema.safeParse({ ...base, decisao: 'ajuste' }).success, 'ajuste sem nota não passa');
  assert(!revisarTrabalhoSchema.safeParse({ ...base, decisao: 'ajuste', nota: 'curta' }).success, 'nota curta não passa');
  assert(!revisarTrabalhoSchema.safeParse({ ...base, decisao: 'ajuste', nota: '   espaços   ' }).success, 'espaço não conta');
  assert(!revisarTrabalhoSchema.safeParse({ ...base, decisao: 'approved' }).success);
  assert(!revisarTrabalhoSchema.safeParse({ ...base, decisao: 'aprovado_pelo_cliente' }).success);
  assert(!revisarTrabalhoSchema.safeParse({ ...base, idempotency_key: 'curta' }).success);
  assert(!revisarTrabalhoSchema.safeParse({ ...base, client_approval: 'approved' }).success, 'campo a mais não passa');
  assert(!revisarTrabalhoSchema.safeParse({ ...base, agendar: true }).success, 'não aceita pedir agendamento');
  assert(!canInvoke(readCtx, tool));
  assert(!canInvoke(emptyCtx, tool));
  assert(canInvoke(writeCtx, tool));
  // Credencial presa a clientes pode chamar: o handler confere o cliente da peça.
  assert(canUseToolWithDataScope(restrictedCtx, tool));
});

Deno.test('caixa Precisa de você: só leitura, com cache curto e visível para credencial restrita', async () => {
  const { listarPrecisaDeVoceSchema } = await import('./modulos/precisa-de-voce-e-revisao.ts');
  const { FERRAMENTAS_POR_AREA } = await import('./modulos/guia-do-painel.ts');
  const tool = TOOL_MAP.get('aceleriq_listar_precisa_de_voce');
  assert(tool, 'ferramenta no catálogo');
  assertEquals(tool.annotations?.readOnlyHint, true);
  assertEquals(tool.annotations?.destructiveHint, false);
  assertEquals(tool.cacheSeg, 30);
  assert(tool.scopes.includes('aceleriq:read'));
  assert(canInvoke(readCtx, tool));
  assert(!canInvoke(emptyCtx, tool));
  assert(canUseToolWithDataScope(restrictedCtx, tool));
  assert(FERRAMENTAS_POR_AREA.execucao.includes('aceleriq_listar_precisa_de_voce'));
  const schema = tool.inputSchema as { required?: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
  assertEquals(schema.additionalProperties, false);
  assertEquals(schema.required ?? [], []);
  assertEquals(schema.properties.tipo.enum, ['dinheiro', 'cliente_ou_plano', 'rejeicao_repetida', 'decisao_de_agente']);
  assert(listarPrecisaDeVoceSchema.safeParse({}).success);
  assert(listarPrecisaDeVoceSchema.safeParse({ tipo: 'dinheiro', limite: 10 }).success);
  assert(!listarPrecisaDeVoceSchema.safeParse({ tipo: 'tudo' }).success);
  assert(!listarPrecisaDeVoceSchema.safeParse({ limite: 0 }).success);
  assert(!listarPrecisaDeVoceSchema.safeParse({ decidir: true }).success, 'leitura não aceita ação');
});

Deno.test('marcar para o dono: escrita sem vínculo obrigatório, sem ação escolhida pelo agente e com o limite na descrição', async () => {
  const { marcarPrecisaDeVoceSchema } = await import('./modulos/precisa-de-voce-e-revisao.ts');
  const { CLIENT_SCOPED_LEGACY_TOOLS } = await import('../_shared/mcp-security.ts');
  const { RPCS_DA_PONTE } = await import('../_shared/mcp-mesas-ponte.ts');
  const { FERRAMENTAS_POR_AREA, REGRAS_DE_ACAO } = await import('./modulos/guia-do-painel.ts');
  const tool = TOOL_MAP.get('aceleriq_marcar_precisa_de_voce');
  assert(tool, 'ferramenta no catálogo');
  assert(tool.scopes.includes('mesas:write'));
  assertEquals(tool.annotations?.readOnlyHint, false);
  const schema = tool.inputSchema as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
  assertEquals(schema.additionalProperties, false);
  assertEquals([...schema.required].sort(), ['idempotency_key', 'o_que', 'operator', 'por_que']);
  assert(!schema.required.includes('link_id'), 'não exige vínculo de execução');
  assert(!('action_kind' in schema.properties), 'o agente não escolhe a ação: é sempre o pedido de decisão');
  assert(!('payload' in schema.properties), 'não carrega ação a executar');
  assertEquals(schema.properties.por_que.minLength, 10);
  assert((CLIENT_SCOPED_LEGACY_TOOLS as readonly string[]).includes('aceleriq_marcar_precisa_de_voce'));
  assert((RPCS_DA_PONTE as readonly string[]).includes('marcar_precisa_do_dono'));
  assert(FERRAMENTAS_POR_AREA.execucao.includes('aceleriq_marcar_precisa_de_voce'));
  assert(REGRAS_DE_ACAO.join(' ').includes('aceleriq_marcar_precisa_de_voce'));
  for (const trecho of ['NÃO aprova', 'NÃO agenda', 'NÃO publica', 'não fala com o cliente']) {
    assert(tool.description.includes(trecho), trecho);
  }

  const base = { operator: 'hermes', o_que: 'Renovar o domínio do cliente', por_que: 'O valor passa do teto combinado', idempotency_key: 'precisa-0001' };
  assert(marcarPrecisaDeVoceSchema.safeParse(base).success);
  assert(marcarPrecisaDeVoceSchema.safeParse({ ...base, client_id: '44444444-4444-4444-8444-444444444444', custo_previsto: 120 }).success);
  assert(!marcarPrecisaDeVoceSchema.safeParse({ ...base, por_que: 'porque' }).success, 'motivo curto não passa');
  assert(!marcarPrecisaDeVoceSchema.safeParse({ ...base, o_que: 'curto' }).success);
  assert(!marcarPrecisaDeVoceSchema.safeParse({ ...base, operator: 'Slug Errado!' }).success);
  assert(!marcarPrecisaDeVoceSchema.safeParse({ ...base, custo_previsto: -1 }).success);
  assert(!marcarPrecisaDeVoceSchema.safeParse({ ...base, idempotency_key: 'curta' }).success);
  assert(!marcarPrecisaDeVoceSchema.safeParse({ ...base, action_kind: 'publicar' }).success, 'não aceita escolher ação');
  assert(!marcarPrecisaDeVoceSchema.safeParse({ ...base, status: 'aprovado' }).success, 'não aceita nascer decidido');
  assert(!canInvoke(readCtx, tool));
  assert(canInvoke(writeCtx, tool));
  assert(canUseToolWithDataScope(restrictedCtx, tool));
});

// ─── MCP 2.29.0 (17/11/2026): listar e arquivar Referências e Concorrentes ───

type FiltroDePerfil = { op: 'eq' | 'is' | 'not_is'; coluna: string; valor: unknown };

/** Banco de mentira para perfis: select/eq/is/limit/maybeSingle e update com select. Guarda os updates. */
function bancoDePerfis(
  linhas: Record<string, unknown>[],
  perfis = [{ id: '00000000-0000-4000-8000-0000000000aa', deleted_at: null }],
  antesDoUpdate?: () => void,
) {
  const updates: Array<{ valores: Record<string, unknown>; filtros: FiltroDePerfil[] }> = [];
  const passa = (l: Record<string, unknown>, filtros: FiltroDePerfil[]) =>
    filtros.every((f) => f.op === 'eq' ? l[f.coluna] === f.valor
      : f.op === 'is' ? (l[f.coluna] ?? null) === f.valor
      : (l[f.coluna] ?? null) !== f.valor);
  return {
    updates,
    from(tabela: string) {
      const filtros: FiltroDePerfil[] = [];
      let valores: Record<string, unknown> | null = null;
      const fonte = () => tabela === 'profiles' ? perfis as Record<string, unknown>[] : linhas;
      const resolver = () => {
        if (valores) {
          antesDoUpdate?.();
          const alvo = fonte().filter((l) => passa(l, filtros));
          for (const l of alvo) Object.assign(l, valores);
          updates.push({ valores, filtros: [...filtros] });
          return { data: alvo.map((l) => ({ ...l })), error: null };
        }
        return { data: fonte().filter((l) => passa(l, filtros)).map((l) => ({ ...l })), error: null };
      };
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.limit = () => q;
      q.order = () => q;
      q.eq = (coluna: string, valor: unknown) => { filtros.push({ op: 'eq', coluna, valor }); return q; };
      q.is = (coluna: string, valor: unknown) => { filtros.push({ op: 'is', coluna, valor }); return q; };
      q.not = (coluna: string, _op: 'is', valor: unknown) => { filtros.push({ op: 'not_is', coluna, valor }); return q; };
      q.update = (v: Record<string, unknown>) => { valores = v; return q; };
      q.maybeSingle = () => Promise.resolve(resolver()).then((r) => ({ data: r.data[0] ?? null, error: null }));
      q.then = (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, falha);
      return q;
    },
  };
}

const PERFIS_CLIENTE_A = '00000000-0000-4000-8000-0000000000aa';
const PERFIS_CLIENTE_B = '00000000-0000-4000-8000-0000000000bb';
const perfilDeTeste = (id: string, extra: Record<string, unknown> = {}) => ({
  id, client_id: PERFIS_CLIENTE_A, papel: 'referencia', handle: `h${id.slice(-2)}`, nome: null, seguidores: null,
  monitorar: false, criado_em: '2026-11-01T10:00:00Z', atualizado_em: '2026-11-01T10:00:00Z', arquivado_em: null, ...extra,
});
const idDePerfil = (n: number) => `11111111-1111-4111-8111-1111111111${String(n).padStart(2, '0')}`;
const ctxDoClienteA: AuthContext = {
  ...writeCtx,
  dataScope: { ...writeCtx.dataScope, unrestricted: false, clientIds: [PERFIS_CLIENTE_A] },
};

Deno.test('2.29: as duas ferramentas novas no catálogo, no guia e contadas na descoberta', async () => {
  const { MCP_VERSION } = await import('../_shared/mcp-release.ts');
  const { FERRAMENTAS_POR_AREA, REGRAS_DE_ACAO } = await import('./modulos/guia-do-painel.ts');
  const { descobertaDoMcp } = await import('../_shared/mcp-descoberta.ts');
  for (const nome of ['aceleriq_perfis_instagram_listar', 'aceleriq_perfis_instagram_arquivar', 'aceleriq_perfis_instagram_gravar']) {
    assert(TOOL_MAP.get(nome), `${nome} no catálogo`);
    assert(FERRAMENTAS_POR_AREA.mesa.includes(nome), `${nome} na mesa do guia`);
  }
  assert(REGRAS_DE_ACAO.join(' ').includes('aceleriq_perfis_instagram_arquivar'));
  const d = descobertaDoMcp({
    servidor: { name: 'aceleriq-mcp', version: MCP_VERSION },
    protocolVersion: MCP_PROTOCOL_VERSION,
    toolCount: TOOLS.length,
    segundoCerebroConfigurado: false,
    agora: new Date('2026-11-17T12:00:00Z'),
  });
  assertEquals(d.toolCount, TOOLS.length);
});

Deno.test('perfis listar: só leitura com clients:read, schema fechado e papel no singular ou plural', async () => {
  const { listarPerfisSchema } = await import('./modulos/workspace-e-perfis.ts');
  const tool = TOOL_MAP.get('aceleriq_perfis_instagram_listar')!;
  assert(tool.scopes.includes('clients:read'));
  assertEquals(tool.annotations?.readOnlyHint, true);
  assertEquals(tool.annotations?.destructiveHint, false);
  assert(canInvoke(readCtx, tool));
  assert(!canInvoke(emptyCtx, tool));
  const schema = tool.inputSchema as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
  assertEquals(schema.additionalProperties, false);
  assertEquals(schema.required, ['client_id']);
  assertEquals(schema.properties.papel.enum, ['referencias', 'concorrentes', 'referencia', 'concorrente']);
  const base = { client_id: PERFIS_CLIENTE_A };
  assert(listarPerfisSchema.safeParse(base).success);
  for (const papel of ['referencias', 'concorrentes', 'referencia', 'concorrente']) {
    assert(listarPerfisSchema.safeParse({ ...base, papel, incluir_arquivados: false }).success, papel);
  }
  assert(!listarPerfisSchema.safeParse({}).success);
  assert(!listarPerfisSchema.safeParse({ ...base, papel: 'amigos' }).success);
  assert(!listarPerfisSchema.safeParse({ ...base, arquivar: true }).success, 'leitura não aceita ação');
});

Deno.test('perfis listar: abas com contagem, arquivados depois e recusa de cliente fora do escopo', async () => {
  const { listarPerfisDoInstagram } = await import('./modulos/workspace-e-perfis.ts');
  const linhas = [
    perfilDeTeste(idDePerfil(1)),
    perfilDeTeste(idDePerfil(2), { arquivado_em: '2026-11-10T00:00:00Z' }),
    perfilDeTeste(idDePerfil(3), { papel: 'concorrente', monitorar: true }),
    perfilDeTeste(idDePerfil(4), { client_id: PERFIS_CLIENTE_B }),
  ];
  const banco = bancoDePerfis(linhas);
  const r = await listarPerfisDoInstagram({ client_id: PERFIS_CLIENTE_A }, ctxDoClienteA, banco as never);
  assertEquals(r.referencias!.perfis.map((p) => [p.id, p.status]), [[idDePerfil(1), 'ativo'], [idDePerfil(2), 'arquivado']]);
  assertEquals(r.referencias!.perfis[0].handle, '@h01');
  assertEquals([r.referencias!.ativos, r.referencias!.limite, r.referencias!.vagas], [1, 6, 5]);
  assertEquals(r.concorrentes!.perfis.map((p) => p.id), [idDePerfil(3)]);
  assert(!JSON.stringify(r).includes(idDePerfil(4)), 'não mostra perfil de outro cliente');
  const so = await listarPerfisDoInstagram({ client_id: PERFIS_CLIENTE_A, papel: 'concorrentes', incluir_arquivados: false }, ctxDoClienteA, banco as never);
  assertEquals(Object.keys(so).filter((k) => k === 'referencias' || k === 'concorrentes'), ['concorrentes']);
  await assertRejects(
    () => listarPerfisDoInstagram({ client_id: PERFIS_CLIENTE_B }, ctxDoClienteA, banco as never),
    Error,
    'outside this MCP principal data scope',
  );
});

Deno.test('perfis arquivar: escrita com clients:write e schema fechado (perfil_id ou handle com papel)', async () => {
  const { arquivarPerfilSchema } = await import('./modulos/workspace-e-perfis.ts');
  const tool = TOOL_MAP.get('aceleriq_perfis_instagram_arquivar')!;
  assert(tool.scopes.includes('clients:write'));
  assertEquals(tool.annotations?.readOnlyHint, false);
  assertEquals(tool.annotations?.destructiveHint, false);
  assert(!canInvoke(readCtx, tool));
  assert(canInvoke(writeCtx, tool));
  assert(tool.description.includes('Não apaga nada'));
  const schema = tool.inputSchema as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
  assertEquals(schema.additionalProperties, false);
  assertEquals(schema.required, ['client_id']);
  assert(!('confirmar' in schema.properties), 'sem confirmar');
  const base = { client_id: PERFIS_CLIENTE_A };
  assert(arquivarPerfilSchema.safeParse({ ...base, perfil_id: idDePerfil(1) }).success);
  assert(arquivarPerfilSchema.safeParse({ ...base, handle: 'https://instagram.com/fulano', papel: 'concorrentes' }).success);
  assert(arquivarPerfilSchema.safeParse({ ...base, handle: '@fulano', papel: 'referencia', idempotency_key: 'arquivar-0001' }).success);
  assert(!arquivarPerfilSchema.safeParse(base).success, 'sem perfil_id nem handle');
  assert(!arquivarPerfilSchema.safeParse({ ...base, handle: '@fulano' }).success, 'handle sem papel');
  assert(!arquivarPerfilSchema.safeParse({ ...base, perfil_id: idDePerfil(1), handle: '@fulano', papel: 'referencia' }).success);
  assert(!arquivarPerfilSchema.safeParse({ ...base, perfil_id: 'nao-uuid' }).success);
  assert(!arquivarPerfilSchema.safeParse({ ...base, perfil_id: idDePerfil(1), idempotency_key: 'curta' }).success);
  assert(!arquivarPerfilSchema.safeParse({ ...base, perfil_id: idDePerfil(1), apagar: true }).success, 'campo a mais não passa');
});

Deno.test('perfis arquivar: igual à tela, idempotente, por handle e sem tocar em outro cliente', async () => {
  const { arquivarPerfilDoInstagram } = await import('./modulos/workspace-e-perfis.ts');
  const linhas = [
    perfilDeTeste(idDePerfil(1), { monitorar: true }),
    perfilDeTeste(idDePerfil(2), { handle: 'fulano', papel: 'concorrente' }),
    perfilDeTeste(idDePerfil(3), { client_id: PERFIS_CLIENTE_B }),
    perfilDeTeste(idDePerfil(4), { handle: 'antigo', arquivado_em: '2026-11-05T00:00:00Z' }),
  ];
  const banco = bancoDePerfis(linhas);

  const r = await arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_A, perfil_id: idDePerfil(1) }, writeCtx, banco as never) as Record<string, any>;
  assertEquals(r.ok, true);
  assertEquals(r.ja_estava_arquivado, false);
  assertEquals(r.perfil.status, 'arquivado');
  assertEquals(r.perfil.monitorar, false);
  assertEquals([r.aba, r.ativos, r.limite, r.vagas], ['referencias', 0, 6, 6]);
  assertEquals(banco.updates.length, 1);
  assertEquals(banco.updates[0].valores.arquivado_por, writeCtx.dataScope.principalUserId);
  assertEquals(banco.updates[0].valores.monitorar, false);
  assert(banco.updates[0].filtros.some((f) => f.coluna === 'client_id' && f.valor === PERFIS_CLIENTE_A), 'update preso ao cliente');
  assertEquals(linhas.length, 4, 'nada apagado');

  const de_novo = await arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_A, perfil_id: idDePerfil(1) }, writeCtx, banco as never) as Record<string, any>;
  assertEquals(de_novo.ja_estava_arquivado, true);
  assertEquals(banco.updates.length, 1, 'já arquivado não muda nada');

  const porHandle = await arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_A, handle: 'https://www.instagram.com/Fulano/', papel: 'concorrentes' }, writeCtx, banco as never) as Record<string, any>;
  assertEquals(porHandle.perfil.id, idDePerfil(2));
  assertEquals(porHandle.aba, 'concorrentes');

  const soArquivado = await arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_A, handle: '@antigo', papel: 'referencias' }, writeCtx, banco as never) as Record<string, any>;
  assertEquals(soArquivado.ja_estava_arquivado, true);

  await assertRejects(
    () => arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_A, handle: '@ninguem', papel: 'referencias' }, writeCtx, banco as never),
    Error,
    '@ninguem não está em Referências',
  );
  // Perfil de outro cliente: o mesmo erro de id inexistente, sem update e sem vazar dado.
  const antes = banco.updates.length;
  const erroDeOutro = await assertRejects(
    () => arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_A, perfil_id: idDePerfil(3) }, writeCtx, banco as never),
    Error,
  );
  const erroInexistente = await assertRejects(
    () => arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_A, perfil_id: idDePerfil(99) }, writeCtx, banco as never),
    Error,
  );
  assertEquals(erroDeOutro.message, erroInexistente.message);
  assertEquals(erroDeOutro.message, 'Perfil não encontrado para este cliente.');
  assertEquals(banco.updates.length, antes);
  assertEquals(linhas[2].arquivado_em, null);
  // Credencial presa ao cliente A não arquiva no cliente B.
  await assertRejects(
    () => arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_B, perfil_id: idDePerfil(3) }, ctxDoClienteA, banco as never),
    Error,
    'outside this MCP principal data scope',
  );
});

Deno.test('perfis arquivar: corrida no update relê o perfil e devolve a linha arquivada', async () => {
  const { arquivarPerfilDoInstagram } = await import('./modulos/workspace-e-perfis.ts');
  const outraChamada = '2026-11-17T09:00:00Z';
  const linhas = [perfilDeTeste(idDePerfil(1), { monitorar: true })];
  // Outra chamada arquiva entre a leitura e o update: o update (is arquivado_em null) não devolve linha.
  const banco = bancoDePerfis(linhas, undefined, () => {
    Object.assign(linhas[0], { arquivado_em: outraChamada, monitorar: false });
  });
  const r = await arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_A, perfil_id: idDePerfil(1) }, writeCtx, banco as never) as Record<string, any>;
  assertEquals(r.ja_estava_arquivado, true);
  assertEquals(r.perfil.status, 'arquivado', 'não devolve a linha ativa antiga');
  assertEquals(r.perfil.arquivado_em, outraChamada);
  assertEquals(r.perfil.monitorar, false);
  assertEquals([r.ativos, r.vagas], [0, 6]);

  // Se a releitura não acha o perfil, erro claro.
  const sumiu = [perfilDeTeste(idDePerfil(2))];
  const bancoSumiu = bancoDePerfis(sumiu, undefined, () => { sumiu.splice(0, 1); });
  await assertRejects(
    () => arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_A, perfil_id: idDePerfil(2) }, writeCtx, bancoSumiu as never),
    Error,
    'não foi encontrado de novo',
  );
});

Deno.test('perfis: idempotency_key de gravar e arquivar vale por cliente', async () => {
  const { escopoDaChaveDoCliente } = await import('./modulos/perfis-listar-arquivar.ts');
  const { filtroDeIdempotencia } = await import('../_shared/mcp-write-services.ts');
  const chave = 'arquivar-0001';
  const deA = filtroDeIdempotencia('oauth:pessoa', chave, escopoDaChaveDoCliente(PERFIS_CLIENTE_A));
  const deB = filtroDeIdempotencia('oauth:pessoa', chave, escopoDaChaveDoCliente(PERFIS_CLIENTE_B));
  assertEquals(deA, { client_id: PERFIS_CLIENTE_A, __principal: 'oauth:pessoa', idempotency_key: chave });
  assert(JSON.stringify(deA) !== JSON.stringify(deB), 'mesma chave em outro cliente não casa');
  // O input auditado guarda client_id e idempotency_key crus: o replay do cliente A casa só com A.
  const auditadoDeA = { client_id: PERFIS_CLIENTE_A, perfil_id: idDePerfil(1), idempotency_key: chave, __principal: 'oauth:pessoa' };
  const casa = (filtro: Record<string, unknown>) => Object.entries(filtro).every(([k, v]) => (auditadoDeA as Record<string, unknown>)[k] === v);
  assert(casa(deA));
  assert(!casa(deB));
  // Sem escopo, as outras ferramentas seguem como antes.
  assertEquals(filtroDeIdempotencia(null, chave), { idempotency_key: chave });
});

Deno.test('perfis listar e arquivar: muitos arquivados não escondem o ativo', async () => {
  const { listarPerfisDoInstagram, arquivarPerfilDoInstagram } = await import('./modulos/workspace-e-perfis.ts');
  const linhas = [
    ...Array.from({ length: 60 }, (_, i) => perfilDeTeste(`22222222-2222-4222-8222-2222222222${String(i).padStart(2, '0')}`, {
      handle: 'repetido', arquivado_em: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`,
    })),
    perfilDeTeste(idDePerfil(1), { handle: 'repetido' }),
  ];
  const banco = bancoDePerfis(linhas);
  const lista = await listarPerfisDoInstagram({ client_id: PERFIS_CLIENTE_A, papel: 'referencias' }, ctxDoClienteA, banco as never);
  assertEquals(lista.referencias!.perfis[0].id, idDePerfil(1));
  assertEquals(lista.referencias!.ativos, 1);
  assertEquals(lista.referencias!.perfis.length, 61);
  const r = await arquivarPerfilDoInstagram({ client_id: PERFIS_CLIENTE_A, handle: '@repetido', papel: 'referencias' }, writeCtx, banco as never) as Record<string, any>;
  assertEquals(r.ja_estava_arquivado, false);
  assertEquals(r.perfil.id, idDePerfil(1));
});

Deno.test('perfis gravar: idempotency_key opcional, mesmo schema fechado de antes', async () => {
  const { gravarPerfisSchema } = await import('./modulos/workspace-e-perfis.ts');
  const tool = TOOL_MAP.get('aceleriq_perfis_instagram_gravar')!;
  const schema = tool.inputSchema as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
  assertEquals(schema.additionalProperties, false);
  assertEquals(schema.required, ['client_id']);
  assert('idempotency_key' in schema.properties);
  const base = { client_id: PERFIS_CLIENTE_A, referencias: ['@fulano'] };
  assert(gravarPerfisSchema.safeParse(base).success, 'sem a chave continua valendo');
  assert(gravarPerfisSchema.safeParse({ ...base, idempotency_key: 'perfis-0001' }).success);
  assert(!gravarPerfisSchema.safeParse({ ...base, idempotency_key: 'curta' }).success);
  assert(!gravarPerfisSchema.safeParse({ ...base, idempotency_key: 'x'.repeat(121) }).success);
  assert(!gravarPerfisSchema.safeParse({ client_id: PERFIS_CLIENTE_A, idempotency_key: 'perfis-0001' }).success, 'a chave sozinha não basta');
  assert(!gravarPerfisSchema.safeParse({ ...base, extra: 1 }).success);
});

// ─── MCP 2.30.0 (18/11/2026): publicação planejada de post já aprovado ───

Deno.test('2.30: criar publicação de aprovado no catálogo, no guia e contada na descoberta', async () => {
  const { MCP_VERSION } = await import('../_shared/mcp-release.ts');
  const { FERRAMENTAS_POR_AREA, REGRAS_DE_ACAO } = await import('./modulos/guia-do-painel.ts');
  const { descobertaDoMcp } = await import('../_shared/mcp-descoberta.ts');
  assert(TOOL_MAP.get('aceleriq_criar_publicacao_de_aprovado'), 'no catálogo');
  assert(FERRAMENTAS_POR_AREA.calendario.includes('aceleriq_criar_publicacao_de_aprovado'));
  const regra = REGRAS_DE_ACAO.find((r) => r.includes('aceleriq_criar_publicacao_de_aprovado')) || '';
  assert(regra.includes('aceleriq_reagendar_publicacao') && regra.includes('expected_version'), 'guia ensina o caminho até o reagendar');
  const d = descobertaDoMcp({
    servidor: { name: 'aceleriq-mcp', version: MCP_VERSION },
    protocolVersion: MCP_PROTOCOL_VERSION,
    toolCount: TOOLS.length,
    segundoCerebroConfigurado: false,
    agora: new Date('2026-11-18T12:00:00Z'),
  });
  assertEquals(d.toolCount, TOOLS.length);
});

Deno.test('criar publicação de aprovado: escrita editorial:write, schema fechado, ponte e mesma lista de cliente do reagendar', async () => {
  const { criarPublicacaoSchema } = await import('./modulos/criar-publicacao-de-aprovado.ts');
  const { CLIENT_SCOPED_LEGACY_TOOLS } = await import('../_shared/mcp-security.ts');
  const { RPCS_DA_PONTE } = await import('../_shared/mcp-mesas-ponte.ts');
  const tool = TOOL_MAP.get('aceleriq_criar_publicacao_de_aprovado')!;
  assert(tool.scopes.includes('editorial:write'));
  assertEquals(GRANULAR_SCOPE_BY_TOOL.aceleriq_criar_publicacao_de_aprovado, 'editorial:write');
  assertEquals(tool.annotations?.readOnlyHint, false);
  assertEquals(tool.annotations?.destructiveHint, false);
  assert(!canInvoke(readCtx, tool));
  assert(canInvoke(writeCtx, tool));
  assert(canInvoke({ ...readCtx, scopes: ['editorial:write'] }, tool));
  assert(tool.description.includes('aceleriq_reagendar_publicacao'));
  assert(tool.description.includes('Não aprova, não agenda e não publica'));
  // Como o reagendar: credencial restrita a clientes pode chamar; o handler confere o cliente do post.
  assert((CLIENT_SCOPED_LEGACY_TOOLS as readonly string[]).includes('aceleriq_criar_publicacao_de_aprovado'));
  assert(canUseToolWithDataScope(restrictedCtx, tool));
  assert((RPCS_DA_PONTE as readonly string[]).includes('save_editorial_post'));
  const schema = tool.inputSchema as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
  assertEquals(schema.additionalProperties, false);
  assertEquals([...schema.required].sort(), ['confirmar', 'external_account_id', 'idempotency_key', 'post_id']);
  assertEquals(schema.properties.confirmar.const, true);
  assert(!('scheduled_at' in schema.properties), 'nunca recebe data');

  const base = {
    post_id: '11111111-1111-4111-8111-111111111111',
    external_account_id: '22222222-2222-4222-8222-222222222222',
    confirmar: true,
    idempotency_key: 'criar-pub-0001',
  };
  assert(criarPublicacaoSchema.safeParse(base).success);
  const { confirmar: _c, ...semConfirmar } = base;
  assert(!criarPublicacaoSchema.safeParse(semConfirmar).success, 'sem confirmar recusa');
  assert(!criarPublicacaoSchema.safeParse({ ...base, confirmar: false }).success, 'confirmar false recusa');
  const { idempotency_key: _k, ...semChave } = base;
  assert(!criarPublicacaoSchema.safeParse(semChave).success, 'sem idempotency_key recusa');
  assert(!criarPublicacaoSchema.safeParse({ ...base, idempotency_key: 'curta' }).success);
  assert(!criarPublicacaoSchema.safeParse({ ...base, idempotency_key: 'x'.repeat(121) }).success);
  assert(!criarPublicacaoSchema.safeParse({ ...base, post_id: 'nao-uuid' }).success);
  assert(!criarPublicacaoSchema.safeParse({ ...base, scheduled_at: '2026-11-20T12:00:00-03:00' }).success, 'data não passa');
  await assertRejects(() => Promise.resolve(tool.handler({ ...base, confirmar: false }, writeCtx)), Error, 'Invalid input');
});

Deno.test('2.32: Central de Skills e segundo cérebro em tempo real no catálogo e no guia', async () => {
  const { FERRAMENTAS_POR_AREA } = await import('./modulos/guia-do-painel.ts');
  for (const n of ['aceleriq_central_skills', 'aceleriq_central_skill', 'aceleriq_central_instalar', 'aceleriq_central_publicar_skill']) {
    assert(FERRAMENTAS_POR_AREA.skills.includes(n), `${n} no guia`);
  }
  assert(FERRAMENTAS_POR_AREA.memoria.includes('aceleriq_cerebro_salvar_nota'));
  // Leitura abre para memory:read OU aceleriq:read; escrita só com memory:write.
  for (const n of ['aceleriq_central_skills', 'aceleriq_central_skill', 'aceleriq_central_instalar', 'aceleriq_cerebro_arvore']) {
    assert(canInvoke(readCtx, TOOL_MAP.get(n)!), `${n} lê com aceleriq:read`);
  }
  for (const n of ['aceleriq_central_publicar_skill', 'aceleriq_cerebro_salvar_nota']) {
    const t = TOOL_MAP.get(n)!;
    assertEquals([...t.scopes], ['memory:write']);
    assert(!canInvoke(readCtx, t), `${n} recusa aceleriq:read`);
  }
  // Chave restrita a cliente não enxerga a Central.
  assert(!canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_central_publicar_skill')!));
});

// ─── MCP 2.33.0 (18/11/2026): e-mail profissional pelo agente ───

Deno.test('2.33: versão, as cinco ferramentas de e-mail no catálogo, no guia e contadas na descoberta', async () => {
  const { MCP_VERSION } = await import('../_shared/mcp-release.ts');
  const { FERRAMENTAS_POR_AREA, REGRAS_DE_ACAO } = await import('./modulos/guia-do-painel.ts');
  const { descobertaDoMcp } = await import('../_shared/mcp-descoberta.ts');
  const { CLIENT_SCOPED_LEGACY_TOOLS } = await import('../_shared/mcp-security.ts');
  const leitura = ['aceleriq_email_entradas', 'aceleriq_email_migracao', 'aceleriq_email_conferir'];
  const escrita = ['aceleriq_email_registrar', 'aceleriq_email_marcar_pago'];
  for (const nome of [...leitura, ...escrita]) {
    const t = TOOL_MAP.get(nome);
    assert(t, `${nome} no catálogo`);
    assert(FERRAMENTAS_POR_AREA.clientes.includes(nome), `${nome} no guia`);
    assert(!(CLIENT_SCOPED_LEGACY_TOOLS as readonly string[]).includes(nome), `${nome} fora da lista de cliente: só a casa`);
  }
  for (const nome of leitura) {
    assertEquals(GRANULAR_SCOPE_BY_TOOL[nome], 'clients:read');
    assertEquals(TOOL_MAP.get(nome)!.annotations?.readOnlyHint, true);
    assert(canInvoke(readCtx, TOOL_MAP.get(nome)!));
  }
  for (const nome of escrita) {
    assertEquals(GRANULAR_SCOPE_BY_TOOL[nome], 'clients:write');
    assertEquals(TOOL_MAP.get(nome)!.annotations?.readOnlyHint, false);
    assert(!canInvoke(readCtx, TOOL_MAP.get(nome)!), `${nome} não roda só com leitura`);
  }
  const regra = REGRAS_DE_ACAO.find((r) => r.includes('aceleriq_email_marcar_pago')) || '';
  assert(regra.includes('migracao-email-cliente') && regra.includes('ja_lancado') && /dono disser/.test(regra), 'guia ensina quando marcar pago');
  const d = descobertaDoMcp({
    servidor: { name: 'aceleriq-mcp', version: MCP_VERSION },
    protocolVersion: MCP_PROTOCOL_VERSION,
    toolCount: TOOLS.length,
    segundoCerebroConfigurado: false,
    agora: new Date('2026-11-18T12:00:00Z'),
  });
  assertEquals(d.toolCount, TOOLS.length);
});

// ─── MCP 2.34.0 (18/11/2026): Escritório da Aceleriq ───

Deno.test('2.34: versão, as oito ferramentas do Escritório no catálogo e no guia, leitura e escrita separadas', async () => {
  const { MCP_VERSION } = await import('../_shared/mcp-release.ts');
  assertEquals(MCP_VERSION, '2.34.0');
  const { FERRAMENTAS_POR_AREA } = await import('./modulos/guia-do-painel.ts');
  const { CLIENT_SCOPED_LEGACY_TOOLS } = await import('../_shared/mcp-security.ts');
  const leitura = ['aceleriq_escritorio_entrar', 'aceleriq_escritorio_diretorio', 'aceleriq_escritorio_caixa', 'aceleriq_escritorio_grupos'];
  const escrita = ['aceleriq_escritorio_enviar', 'aceleriq_escritorio_marcar_lida', 'aceleriq_escritorio_presenca', 'aceleriq_escritorio_automacao'];
  for (const nome of [...leitura, ...escrita]) {
    const t = TOOL_MAP.get(nome);
    assert(t, `${nome} no catálogo`);
    assert(FERRAMENTAS_POR_AREA.execucao.includes(nome), `${nome} no guia`);
    assert(!(CLIENT_SCOPED_LEGACY_TOOLS as readonly string[]).includes(nome), `${nome} fora da lista de cliente: só a casa`);
    assert(!canUseToolWithDataScope(restrictedCtx, t!), `${nome}: chave restrita a cliente não entra no Escritório`);
  }
  for (const nome of leitura) {
    assertEquals(TOOL_MAP.get(nome)!.annotations?.readOnlyHint, true);
    assert(canInvoke(readCtx, TOOL_MAP.get(nome)!));
  }
  for (const nome of escrita) {
    assertEquals(TOOL_MAP.get(nome)!.annotations?.readOnlyHint, false);
    assert(!canInvoke(readCtx, TOOL_MAP.get(nome)!), `${nome} não roda só com leitura`);
  }
  // Mandar mensagem exige a chave que impede duplicar.
  assertEquals((TOOL_MAP.get('aceleriq_escritorio_enviar')!.inputSchema as { required: string[] }).required, ['texto', 'idempotency_key']);
  // Regras permanentes do dono: uma ferramenta de leitura; a decisão mora no banco.
  assert(TOOL_MAP.get('aceleriq_regras_permanentes') && FERRAMENTAS_POR_AREA.execucao.includes('aceleriq_regras_permanentes'));
  assert(canInvoke(readCtx, TOOL_MAP.get('aceleriq_regras_permanentes')!));
  assertEquals(TOOLS.length, 219);
});
