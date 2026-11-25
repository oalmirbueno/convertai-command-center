// Acesso MCP exclusivo a um projeto e um operador. Módulo PURO (sem Deno/Supabase) para ser
// coberto pelo Vitest. A autorização central usa estas regras ANTES de cache, auditoria
// de sucesso e handler, e também para filtrar tools/list.

export interface ProjectGrant {
  projectId: string;
  clientId: string;
  /** internal_operators.slug (operador interno), nunca profiles.id humano. */
  operatorSlug: string;
  /**
   * Envio de MP4 aberto: concessão criada com allow_video_upload=true (imutável) E servidor com
   * MCP_PROJECT_VIDEO_WRITE=true. Ausente/false = escrita fechada (padrão). Autoria e pauta são conferidas no banco.
   */
  videoWrite?: boolean;
}

/** Linha completa da concessão como gravada (imutável salvo revoked_at). */
export interface ProjectGrantRecord extends ProjectGrant {
  apiKeyId: string;
  createdBy: string;
  createdAt: string;
  /** Opt-in gravado na criação da concessão (padrão false, imutável). */
  allowVideoUpload: boolean;
}

/** Projeto "vivo": existe, é do cliente, não apagado nem arquivado/cancelado. Espelha mcp_project_is_live() do banco. */
export const PROJECT_DEAD_STATUSES = ['archived', 'cancelled', 'canceled', 'deleted'] as const;
export function isProjectLive(
  p: { id: string; client_id: string; deleted_at?: string | null; status?: string | null } | null | undefined,
  grant: Pick<ProjectGrant, 'projectId' | 'clientId'>,
): boolean {
  if (!p || p.id !== grant.projectId || p.client_id !== grant.clientId || p.deleted_at) return false;
  return !(PROJECT_DEAD_STATUSES as readonly string[]).includes(String(p.status ?? '').toLowerCase());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Marcador de escopo: a chave project-scoped nasce SOMENTE com ele (sem escopos legados). */
export const PROJECT_SCOPE_MARKER = 'mcp:project';
export const isProjectScopedKey = (scopes: readonly string[]) => scopes.includes(PROJECT_SCOPE_MARKER);
export const hasOnlyProjectMarker = (scopes: readonly string[]) => scopes.length === 1 && scopes[0] === PROJECT_SCOPE_MARKER;

/** Tools preparadas para chave com concessão. Todo o resto é negado por padrão (inclusive tools públicas e novas). */
export const PROJECT_ONLY_TOOLS = [
  'aceleriq_projeto_identidade',
  'aceleriq_projeto_resumo',
  'aceleriq_projeto_tarefas',
  'aceleriq_projeto_arquivos',
  'aceleriq_projeto_arquivo_ler',
] as const;

/**
 * Nome compartilhado com o catálogo legado: com concessão resolve para a variante RESTRITA (PROJECT_TOOLS);
 * sem concessão continua sendo a tool legada, intacta. Por isso NÃO entra em PROJECT_ONLY_TOOLS.
 */
export const ENTRAR_TOOL = 'aceleriq_escritorio_entrar';

export const PROJECT_GRANT_ALLOWED_TOOLS = [...PROJECT_ONLY_TOOLS, ENTRAR_TOOL] as const;
const ALLOWED = new Set<string>(PROJECT_GRANT_ALLOWED_TOOLS);
const ONLY = new Set<string>(PROJECT_ONLY_TOOLS);

/**
 * Escrita de MP4 à pauta e pedido de revisão HUMANA da agência. Só existem para a concessão com
 * videoWrite=true; sem isso ficam fora de tools/list e tools/call (fechado por padrão).
 */
export const PROJECT_GRANT_WRITE_TOOLS = [
  'aceleriq_projeto_video_preparar',
  'aceleriq_projeto_video_finalizar',
  'aceleriq_projeto_video_pedir_aprovacao',
] as const;
const WRITE = new Set<string>(PROJECT_GRANT_WRITE_TOOLS);

export function isProjectWriteTool(toolName: string): boolean {
  return WRITE.has(toolName);
}

/** Tool que existe SOMENTE no catálogo restrito (indisponível sem concessão). Nomes compartilhados com o legado ficam de fora. */
export function isProjectOnlyTool(toolName: string): boolean {
  return ONLY.has(toolName) || WRITE.has(toolName);
}

/** Leitura preparada sempre; escrita só com a concessão aberta para vídeo. Todo o resto é negado. */
export function projectGrantAllowsTool(toolName: string, grant?: Pick<ProjectGrant, 'videoWrite'>): boolean {
  if (ALLOWED.has(toolName)) return true;
  return WRITE.has(toolName) && grant?.videoWrite === true;
}

/** Escopos internos da chave presa: derivados da concessão ativa, nunca do que está gravado na chave. */
export const PROJECT_GRANT_SCOPES = ['tasks:read', 'files:read'] as const;

/** Escopos efetivos da concessão: leitura; files:write só quando o envio de MP4 está aberto. */
export function grantScopes(grant: Pick<ProjectGrant, 'videoWrite'>): string[] {
  return grant.videoWrite === true ? [...PROJECT_GRANT_SCOPES, 'files:write'] : [...PROJECT_GRANT_SCOPES];
}

/** Opt-in da concessão E chave do servidor (MCP_PROJECT_VIDEO_WRITE=true, exatamente). */
export function effectiveVideoWrite(allowVideoUpload: boolean, serverFlag: string | undefined | null): boolean {
  return allowVideoUpload === true && serverFlag === 'true';
}

/**
 * Projetos com envio de MP4 liberado (opt-in explícito do servidor): MCP_PROJECT_VIDEO_PROJECT_IDS (lista separada
 * por vírgula) ∪ MCP_PROJECT_VIDEO_PROJECT_ID (legado, um ID). Qualquer item que não seja UUID invalida a lista
 * inteira (falha fechada); vazio/ausente = nenhum projeto. Não substitui concessão, kill switch, autoria nem revisão.
 */
export function videoProjectAllowlist(plural: string | null | undefined, singular: string | null | undefined): ReadonlySet<string> {
  const itens = [...String(plural ?? '').split(','), String(singular ?? '')].map((s) => s.trim()).filter(Boolean);
  if (itens.some((s) => !UUID_RE.test(s))) return new Set();
  return new Set(itens.map((s) => s.toLowerCase()));
}

export function projectAllowedForVideo(
  projectId: string, plural: string | null | undefined, singular: string | null | undefined,
): boolean {
  return UUID_RE.test(String(projectId ?? '')) && videoProjectAllowlist(plural, singular).has(String(projectId).toLowerCase());
}

/** Converte a linha do banco; qualquer campo inválido vira null (o chamador falha fechado). */
export function parseProjectGrantRow(row: unknown): ProjectGrant | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const projectId = String(r.project_id ?? '');
  const clientId = String(r.client_id ?? '');
  const operatorSlug = String(r.operator_slug ?? '');
  if (![projectId, clientId].every((v) => UUID_RE.test(v)) || !SLUG_RE.test(operatorSlug)) return null;
  return { projectId, clientId, operatorSlug };
}

/**
 * Decide a concessão a partir de TODAS as linhas da chave (revogadas inclusas). Monotônico e definitivo:
 * exatamente uma linha, ativa, íntegra e com allow_video_upload booleano. Linha revogada, linha extra
 * (nova linha para a mesma chave) ou campo inválido nega; nunca "pega a ativa e ignora o resto".
 */
export function resolveGrantRows(rows: unknown, apiKeyId: string): ProjectGrantRecord | null {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const r = rows[0] as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const base = parseProjectGrantRow(r);
  if (!base || r.revoked_at != null) return null;
  if (String(r.api_key_id ?? '').toLowerCase() !== apiKeyId.toLowerCase()) return null;
  if (typeof r.allow_video_upload !== 'boolean') return null;
  const createdBy = String(r.created_by ?? '');
  const createdAt = String(r.created_at ?? '');
  if (!UUID_RE.test(createdBy) || !createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  return { ...base, apiKeyId, createdBy, createdAt, allowVideoUpload: r.allow_video_upload };
}

/** Principal do cache: muda se a chave for religada a outro projeto ou operador. */
export function cachePrincipalFor(keyId: string, grant: ProjectGrant | undefined): string {
  return grant ? `${keyId}#${grant.projectId}#${grant.operatorSlug}` : keyId;
}

const IDENTITY_KEYS_ALWAYS_FORBIDDEN = [
  'operator', 'operador', 'operator_slug', 'operator_user_id', 'operator_id', 'user_id', 'actor', 'author', 'author_id',
  'created_by', 'uploaded_by', 'principal',
  // Destino e autoria do envio vêm do servidor: nunca bucket, caminho, URL, perfil, chave ou concessão do chamador.
  'bucket', 'storage_bucket', 'storage_path', 'path', 'file_url', 'url', 'upload_url', 'profile_id', 'author_profile_id',
  'api_key_id', 'grant_id',
];

function* walk(value: unknown, depth = 0): Generator<[string, unknown]> {
  if (depth > 4 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) yield* walk(v, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    yield [k, v];
    yield* walk(v, depth + 1);
  }
}

/**
 * Operador, projeto e cliente vêm SEMPRE da concessão. O chamador não escolhe nem "confirma":
 * qualquer campo de identidade de operador é recusado; project_id/client_id só passam se iguais.
 * Devolve o motivo da recusa ou null.
 */
export function findForgedIdentity(args: unknown, grant: ProjectGrant): string | null {
  for (const [key, value] of walk(args)) {
    const k = key.toLowerCase();
    if (IDENTITY_KEYS_ALWAYS_FORBIDDEN.includes(k)) return `campo de identidade não permitido: ${key}`;
    if (k === 'project_id' && String(value ?? '').toLowerCase() !== grant.projectId.toLowerCase()) return 'project_id fora da concessão';
    if (k === 'client_id' && String(value ?? '').toLowerCase() !== grant.clientId.toLowerCase()) return 'client_id fora da concessão';
  }
  return null;
}

export type ToolDecision = { ok: true } | { ok: false; code: 'grant_tool_denied' | 'grant_identity_forged'; message: string };

/** Decisão central por chamada (tools/call). Sem concessão não decide nada (legado segue as regras de sempre). */
export function authorizeGrantCall(grant: ProjectGrant, toolName: string, args: unknown): ToolDecision {
  if (!projectGrantAllowsTool(toolName, grant)) {
    return { ok: false, code: 'grant_tool_denied', message: 'Tool is unavailable for this project-scoped credential' };
  }
  if (toolName === ENTRAR_TOOL) {
    return entrarOperatorError(args, grant)
      ? { ok: false, code: 'grant_identity_forged', message: 'Identity is fixed by the credential grant' }
      : { ok: true };
  }
  const forged = findForgedIdentity(args, grant);
  if (forged) return { ok: false, code: 'grant_identity_forged', message: 'Identity is fixed by the credential grant' };
  return { ok: true };
}

/**
 * Única tool em que `operator` é aceito: omitido ou ESTRITAMENTE igual (string, sem normalizar) ao operador da
 * concessão. Qualquer outro campo, null, outro tipo ou valor divergente é recusado; a identidade nunca vem do cliente.
 * Devolve o motivo ou null.
 */
export function entrarOperatorError(args: unknown, grant: ProjectGrant): string | null {
  if (args == null) return null;
  if (typeof args !== 'object' || Array.isArray(args)) return 'argumentos inválidos';
  const keys = Object.keys(args as object);
  if (keys.some((k) => k !== 'operator')) return 'campo não permitido';
  if (keys.length === 0) return null;
  const v = (args as Record<string, unknown>).operator;
  return typeof v === 'string' && v === grant.operatorSlug ? null : 'operador diferente da concessão';
}

/** Variante restrita de aceleriq_escritorio_entrar: mesma forma essencial (ok, voce.slug); sem caixa, equipe, regras ou presença. */
export function projectEntrar(grant: ProjectGrant, args: unknown) {
  if (entrarOperatorError(args, grant)) throw new ProjectAccessError('not_found', 'Identidade fixada pela credencial.');
  return {
    ok: true,
    voce: { slug: grant.operatorSlug, acesso: acessoDa(grant), projeto_id: grant.projectId, cliente_id: grant.clientId },
  };
}

const acessoDa = (grant: ProjectGrant) =>
  grant.videoWrite === true ? 'leitura e envio de MP4 à pauta, um projeto' : 'somente leitura, um projeto';

/** O que tools/list mostra para a concessão: só a lista preparada (escrita só se aberta). */
export function filterToolsForGrant<T extends { name: string }>(tools: readonly T[], grant?: Pick<ProjectGrant, 'videoWrite'>): T[] {
  return tools.filter((t) => projectGrantAllowsTool(t.name, grant));
}

// ─── Núcleo das tools (portas injetadas; sem rede) ─────────────

export interface TaskRow { deleted_at?: string | null; id: string; title: string; status: string; priority: string; due_date: string | null; updated_at: string | null; project_id: string }
export interface FileRow {
  id: string; project_id: string | null; client_id: string; file_name: string; file_type: string | null; folder: string | null;
  mime_type: string | null; extension: string | null; status: string | null; approval_status: string | null;
  agency_approval_status: string | null; locked_at: string | null; created_at: string | null; archived_at: string | null;
  parent_file_id: string | null; storage_bucket: string | null; storage_path: string | null;
  /** files.sensitivity: 'normal' | 'confidential' | 'restricted'; null conta como normal (igual a mcp-files-services). */
  sensitivity?: string | null;
}

export interface ProjectRow {
  id: string; client_id: string; name: string; status: string | null; description: string | null;
  objectives: string | null; scope: string | null; deadline: string | null; deleted_at: string | null;
}

export interface ProjectPorts {
  project(filter: { projectId: string; clientId: string }): Promise<ProjectRow | null>;
  tasks(filter: { projectId: string; taskId?: string; limit: number }): Promise<TaskRow[]>;
  files(filter: { projectId: string; clientId: string; fileId?: string; limit: number }): Promise<FileRow[]>;
  /** Todas as linhas do registro canônico (files) que apontam para este objeto. Esperado: exatamente uma. */
  objectOwners(bucket: string, path: string): Promise<Array<{ id: string; project_id: string | null; client_id: string }>>;
  signedUrl(bucket: string, path: string, ttlSec: number): Promise<string | null>;
}

export type ProjectAccessCode =
  | 'not_found' | 'not_approved' | 'storage_denied' | 'unavailable'
  | 'denied' | 'author' | 'task' | 'conflict' | 'expired' | 'invalid_object' | 'state' | 'invalid_input';

export class ProjectAccessError extends Error {
  constructor(readonly code: ProjectAccessCode, message: string) { super(message); }
}

export const SIGNED_URL_TTL_SEC = 60;
const BUCKETS = new Set(['files', 'mcp-files']);

/** Caminho sob a pasta do cliente, sem travessia nem segmentos ambíguos para o Storage. */
export function isCleanClientPath(path: string, clientId: string): boolean {
  if (!path.startsWith(`${clientId}/`) || path.length <= clientId.length + 1 || path.length > 512) return false;
  const segmentos = path.split('/');
  if (segmentos.some((s) => s === '' || s === '.' || s === '..' || s !== s.trim())) return false;
  for (const ch of path) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f || ch === '\\' || ch === '%' || ch === '?' || ch === '#') return false;
  }
  return true;
}

/** Aprovado = Double-Gate completo (agência e cliente) e ainda não arquivado. */
export function isApprovedFile(f: Pick<FileRow, 'approval_status' | 'agency_approval_status' | 'archived_at'>): boolean {
  return f.approval_status === 'approved' && f.agency_approval_status === 'approved' && !f.archived_at;
}

/**
 * Mesma semântica de mcp-files-services (confidential/restricted exigem files:sensitive:read ou admin).
 * A concessão nunca recebe esse escopo (PROJECT_GRANT_SCOPES), então sensível fica fora; valor desconhecido também (fail-closed).
 */
export function isSensitiveFile(f: Pick<FileRow, 'sensitivity'>): boolean {
  return f.sensitivity != null && f.sensitivity !== 'normal';
}

export async function readProjectTasks(ports: ProjectPorts, grant: ProjectGrant, args: { task_id?: string; limite?: number }) {
  const limit = Math.min(Math.max(Number(args.limite) || 50, 1), 100);
  const rows = await ports.tasks({ projectId: grant.projectId, taskId: args.task_id, limit });
  // Defesa em profundidade: mesmo que a porta erre o filtro, só sai tarefa do projeto da concessão.
  const own = rows.filter((t) => t.project_id === grant.projectId && !t.deleted_at);
  if (args.task_id && own.length === 0) throw new ProjectAccessError('not_found', 'Tarefa não encontrada neste projeto.');
  return { projeto_id: grant.projectId, tarefas: own.map(({ project_id: _p, deleted_at: _d, ...t }) => t) };
}

const metadadosDoArquivo = (f: FileRow) => ({
  id: f.id, file_name: f.file_name, file_type: f.file_type, folder: f.folder, mime_type: f.mime_type, extension: f.extension,
  status: f.status, approval_status: f.approval_status, agency_approval_status: f.agency_approval_status,
  aprovado: isApprovedFile(f), parent_file_id: f.parent_file_id, created_at: f.created_at,
});

function ownFiles(rows: FileRow[], grant: ProjectGrant) {
  return rows.filter((f) => f.project_id === grant.projectId && f.client_id === grant.clientId && !isSensitiveFile(f));
}

export async function listProjectFiles(ports: ProjectPorts, grant: ProjectGrant, args: { limite?: number }) {
  const limit = Math.min(Math.max(Number(args.limite) || 50, 1), 100);
  const rows = ownFiles(await ports.files({ projectId: grant.projectId, clientId: grant.clientId, limit }), grant);
  return { projeto_id: grant.projectId, arquivos: rows.filter((f) => !f.archived_at && f.status === 'ready').map(metadadosDoArquivo) };
}

export async function readApprovedFile(ports: ProjectPorts, grant: ProjectGrant, args: { file_id: string }) {
  const rows = ownFiles(await ports.files({ projectId: grant.projectId, clientId: grant.clientId, fileId: args.file_id, limit: 1 }), grant)
    .filter((f) => f.id === args.file_id);
  const f = rows[0];
  if (!f) throw new ProjectAccessError('not_found', 'Arquivo não encontrado neste projeto.');
  if (f.status !== 'ready' || !isApprovedFile(f)) throw new ProjectAccessError('not_approved', 'O arquivo ainda não está pronto e aprovado pela agência e pelo cliente.');
  // O caminho precisa estar sob a pasta do cliente da concessão e em bucket conhecido (linha adulterada não vaza outro objeto).
  const path = f.storage_path ?? '';
  if (!f.storage_bucket || !BUCKETS.has(f.storage_bucket) || !isCleanClientPath(path, grant.clientId)) {
    throw new ProjectAccessError('storage_denied', 'O armazenamento deste arquivo não é elegível para leitura.');
  }
  // client_id no caminho NÃO prova o projeto. A proveniência vem do registro canônico: o objeto (bucket+caminho)
  // precisa pertencer a exatamente UMA linha de files, e ela é a lida (mesmo id, projeto e cliente da concessão).
  // Zero linhas, duas ou erro de leitura => download fechado.
  let donos: Awaited<ReturnType<ProjectPorts['objectOwners']>>;
  try { donos = await ports.objectOwners(f.storage_bucket, path); } catch { donos = []; }
  if (donos.length !== 1 || donos[0].id !== f.id || donos[0].project_id !== grant.projectId || donos[0].client_id !== grant.clientId) {
    throw new ProjectAccessError('storage_denied', 'O armazenamento deste arquivo não é elegível para leitura.');
  }
  const url = await ports.signedUrl(f.storage_bucket, path, SIGNED_URL_TTL_SEC);
  if (!url) throw new ProjectAccessError('unavailable', 'Não foi possível gerar o link agora.');
  return { ...metadadosDoArquivo(f), url_assinada: url, expira_em_segundos: SIGNED_URL_TTL_SEC };
}

/** Identidade mínima da PRÓPRIA credencial: sem organograma, equipe, outros projetos ou clientes. */
export function projectIdentity(grant: ProjectGrant) {
  return { projeto_id: grant.projectId, cliente_id: grant.clientId, operador: grant.operatorSlug, acesso: acessoDa(grant) };
}

/** Resumo/briefing do projeto da concessão (só campos descritivos). */
export async function readProjectSummary(ports: ProjectPorts, grant: ProjectGrant) {
  const p = await ports.project({ projectId: grant.projectId, clientId: grant.clientId });
  if (!p || !isProjectLive(p, grant)) {
    throw new ProjectAccessError('not_found', 'Projeto não encontrado.');
  }
  return { projeto_id: p.id, nome: p.name, status: p.status, prazo: p.deadline, descricao: p.description, objetivos: p.objectives, escopo: p.scope };
}

// ─── Envio de MP4 à pauta + pedido de revisão humana da agência ─────────────
// Identidade, projeto, cliente, operador, autoria, bucket e caminho são decididos no banco
// (RPCs mcp_project_video_*, transacionais, com conferência viva). Aqui: entrada, formato e roteiro.

export const VIDEO_MIN_BYTES = 1024;
/** Teto do envio (o servidor baixa o objeto inteiro para conferir sha256): 100 MiB. Igual ao CHECK do banco. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;

/** Marcas ISO-BMFF de MP4. QuickTime ('qt  '), 3GP, HEIF etc. ficam de fora. */
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ']);

/** Primeira caixa do arquivo é `ftyp` (tamanho 16..1024) com marca de MP4. */
export function isMp4Header(head: Uint8Array): boolean {
  if (!(head instanceof Uint8Array) || head.length < 12) return false;
  const size = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  const ascii = (a: number, b: number) => String.fromCharCode(...head.subarray(a, b));
  return size >= 16 && size <= 1024 && ascii(4, 8) === 'ftyp' && MP4_BRANDS.has(ascii(8, 12));
}

export interface VideoSession {
  status: 'prepared' | 'finalized' | 'review_requested';
  storage_path: string;
  size_bytes: number;
  sha256: string;
  file_id: string | null;
  attachment_id: string | null;
  /** Tamanho que o Storage registrou para o objeto; null = ainda não enviado. */
  object_bytes: number | null;
  object_id: string | null;
  object_version: string | null;
}

/** Portas do envio (RPCs + Storage). A chave é a da credencial autenticada; nenhuma porta recebe projeto/cliente/caminho do chamador. */
export interface VideoPorts {
  prepare(a: { taskId: string; sizeBytes: number; sha256: string; idempotencyKey: string }): Promise<{
    upload_id: string; status: VideoSession['status']; storage_path: string | null; expires_at: string; reused: boolean;
  }>;
  /** URL assinada de envio (PUT, sem upsert) para o caminho gerado pelo banco. Nunca guardada, logada ou devolvida em erro. */
  signedUploadUrl(storagePath: string): Promise<string | null>;
  open(a: { uploadId: string; idempotencyKey: string }): Promise<VideoSession>;
  /** Baixa o objeto (service role) e devolve tamanho, sha256 e cabeçalho. null = indisponível. */
  inspect(storagePath: string): Promise<{ size: number; sha256: string; head: Uint8Array } | null>;
  finalize(a: { uploadId: string; idempotencyKey: string; sizeBytes: number; sha256: string; headerOk: boolean; objectId: string; objectVersion: string }): Promise<{
    status: VideoSession['status']; file_id: string; attachment_id: string; reused: boolean;
  }>;
  requestReview(a: { uploadId: string; idempotencyKey: string }): Promise<{
    status: VideoSession['status']; file_id: string; agency_approval_status: string; reused: boolean;
  }>;
}

function exigirEscrita(grant: ProjectGrant) {
  if (grant.videoWrite !== true) throw new ProjectAccessError('denied', 'Envio de vídeo não está habilitado para esta credencial.');
}

function exigirConfirmacao(args: { confirmar?: unknown; idempotency_key?: unknown }) {
  if (args.confirmar !== true) throw new ProjectAccessError('invalid_input', 'Confirme a operação com confirmar: true.');
  if (typeof args.idempotency_key !== 'string' || !IDEMPOTENCY_KEY_RE.test(args.idempotency_key)) {
    throw new ProjectAccessError('invalid_input', 'idempotency_key obrigatória (8 a 128 caracteres: letras, números, . _ : -).');
  }
}

export async function prepareProjectVideo(
  ports: VideoPorts, grant: ProjectGrant,
  args: { task_id: string; tamanho_bytes: number; sha256: string; idempotency_key: string; confirmar: true },
) {
  exigirEscrita(grant);
  exigirConfirmacao(args);
  if (!UUID_RE.test(String(args.task_id ?? ''))) throw new ProjectAccessError('invalid_input', 'task_id inválido.');
  if (!Number.isInteger(args.tamanho_bytes) || args.tamanho_bytes < VIDEO_MIN_BYTES || args.tamanho_bytes > VIDEO_MAX_BYTES) {
    throw new ProjectAccessError('invalid_input', `tamanho_bytes deve estar entre ${VIDEO_MIN_BYTES} e ${VIDEO_MAX_BYTES}.`);
  }
  if (typeof args.sha256 !== 'string' || !SHA256_RE.test(args.sha256)) throw new ProjectAccessError('invalid_input', 'sha256 em hexadecimal minúsculo (64).');
  const r = await ports.prepare({ taskId: args.task_id, sizeBytes: args.tamanho_bytes, sha256: args.sha256, idempotencyKey: args.idempotency_key });
  const base = { upload_id: r.upload_id, status: r.status, reaproveitado: r.reused, expira_em: r.expires_at };
  if (r.status !== 'prepared') return { ...base, proximo_passo: r.status === 'finalized' ? 'pedir_aprovacao' : null };
  if (!r.storage_path) throw new ProjectAccessError('unavailable', 'Não foi possível preparar o envio agora.');
  const url = await ports.signedUploadUrl(r.storage_path);
  if (!url) throw new ProjectAccessError('unavailable', 'Não foi possível gerar o link de envio agora.');
  return {
    ...base,
    upload_url: url,
    metodo: 'PUT',
    cabecalhos: { 'content-type': 'video/mp4' },
    tamanho_bytes: args.tamanho_bytes,
    observacao: 'Envie o MP4 exatamente uma vez para upload_url (sem sobrescrita) e depois chame aceleriq_projeto_video_finalizar.',
    proximo_passo: 'finalizar',
  };
}

export async function finalizeProjectVideo(
  ports: VideoPorts, grant: ProjectGrant,
  args: { upload_id: string; idempotency_key: string; confirmar: true },
) {
  exigirEscrita(grant);
  exigirConfirmacao(args);
  if (!UUID_RE.test(String(args.upload_id ?? ''))) throw new ProjectAccessError('invalid_input', 'upload_id inválido.');
  const ids = { uploadId: args.upload_id, idempotencyKey: args.idempotency_key };
  const s = await ports.open(ids);
  if (s.status !== 'prepared') {
    return { upload_id: args.upload_id, status: s.status, file_id: s.file_id, anexo_id: s.attachment_id, reaproveitado: true };
  }
  if (s.object_bytes == null || !s.object_id || !s.object_version) throw new ProjectAccessError('invalid_object', 'O MP4 ainda não chegou ao armazenamento. Envie para upload_url e finalize de novo.');
  if (s.object_bytes !== s.size_bytes) throw new ProjectAccessError('invalid_object', 'O objeto enviado não tem o tamanho declarado. Prepare um novo envio.');
  const obj = await ports.inspect(s.storage_path);
  if (!obj) throw new ProjectAccessError('unavailable', 'Não foi possível conferir o objeto agora.');
  const headerOk = isMp4Header(obj.head);
  if (obj.size !== s.size_bytes || obj.sha256 !== s.sha256 || !headerOk) {
    throw new ProjectAccessError('invalid_object', 'O objeto enviado não é o MP4 declarado (tamanho, sha256 ou formato). Prepare um novo envio.');
  }
  const r = await ports.finalize({ ...ids, sizeBytes: obj.size, sha256: obj.sha256, headerOk, objectId: s.object_id, objectVersion: s.object_version });
  return { upload_id: args.upload_id, status: r.status, file_id: r.file_id, anexo_id: r.attachment_id, reaproveitado: r.reused, proximo_passo: 'pedir_aprovacao' };
}

export async function requestProjectVideoReview(
  ports: VideoPorts, grant: ProjectGrant,
  args: { upload_id: string; idempotency_key: string; confirmar: true },
) {
  exigirEscrita(grant);
  exigirConfirmacao(args);
  if (!UUID_RE.test(String(args.upload_id ?? ''))) throw new ProjectAccessError('invalid_input', 'upload_id inválido.');
  const r = await ports.requestReview({ uploadId: args.upload_id, idempotencyKey: args.idempotency_key });
  return {
    upload_id: args.upload_id, status: r.status, file_id: r.file_id, revisao_agencia: r.agency_approval_status, reaproveitado: r.reused,
    aviso: 'Pedido de revisão humana da agência registrado só para este arquivo. Nada foi aprovado, liberado ao cliente, agendado, publicado ou notificado fora do painel.',
  };
}

/** Erro das RPCs (RAISE 'mcp_video:<codigo>') vira erro claro; mensagem do banco nunca é repassada. */
const MAPA_DO_BANCO: Record<string, [ProjectAccessCode, string]> = {
  negado: ['denied', 'Credencial sem permissão de envio (chave, concessão, operador ou projeto não estão ativos).'],
  autoria: ['author', 'Autoria do agente não está configurada ou mudou (perfil dedicado, vínculo ou carteira do cliente).'],
  tarefa: ['task', 'A tarefa não está viva neste projeto ou mudou (projeto, estado ou responsável) desde o preparo.'],
  conflito: ['conflict', 'idempotency_key já usada com outros dados.'],
  expirado: ['expired', 'O envio expirou. Prepare de novo com outra idempotency_key.'],
  objeto: ['invalid_object', 'O objeto enviado não confere (tamanho, tipo ou sha256).'],
  estado: ['state', 'O arquivo não está mais elegível para esta etapa.'],
  entrada: ['invalid_input', 'Entrada inválida.'],
  nao_encontrado: ['not_found', 'Envio não encontrado para esta credencial.'],
};

export function videoErrorFromDb(message: string | null | undefined): ProjectAccessError {
  const m = /mcp_video:([a-z_]+)/.exec(String(message ?? ''));
  const par = m ? MAPA_DO_BANCO[m[1]] : undefined;
  return par ? new ProjectAccessError(par[0], par[1]) : new ProjectAccessError('unavailable', 'Operação indisponível agora.');
}
