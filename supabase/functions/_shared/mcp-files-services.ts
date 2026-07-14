// Aceleriq OS — MCP Files v2 service layer (v1.7.0, Bloco B).
// Uploads, versioning, metadata, content read/search, archive/restore.
// Reuses public.files (extended in Bloco A) + file_content_chunks + file_processing_jobs.
// Feature flag: MCP_FILE_WRITE_V2 (default true).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { z } from 'https://esm.sh/zod@3.23.8';

// ─── Config / limits (env-overridable) ────────────────────────
export const FILE_WRITE_ENABLED =
  (Deno.env.get('MCP_FILE_WRITE_V2') ?? 'true').toLowerCase() !== 'false';

const N = (k: string, d: number) => {
  const v = Number(Deno.env.get(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};
export const LIMITS = {
  bucket: 'mcp-files',
  inlineMaxBytes: N('MCP_FILE_INLINE_MAX_BYTES', 10 * 1024 * 1024),   // 10 MB
  signedMaxBytes: N('MCP_FILE_SIGNED_MAX_BYTES', 50 * 1024 * 1024),   // 50 MB
  mediaMaxBytes: N('MCP_FILE_MEDIA_MAX_BYTES', 250 * 1024 * 1024),    // 250 MB
  signedUploadTtlSec: N('MCP_FILE_SIGNED_TTL', 900),                  // 15 min
  signedDownloadTtlSec: N('MCP_FILE_DOWNLOAD_TTL', 600),              // 10 min
} as const;

const IDEMP_TTL_HOURS = 24;

// ─── Allowed formats ──────────────────────────────────────────
const DOC_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/markdown', 'text/csv', 'application/json',
]);
const IMG_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const MEDIA_MIMES = new Set(['video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/wav']);
export function isAllowedMime(m: string): boolean {
  return DOC_MIMES.has(m) || IMG_MIMES.has(m) || MEDIA_MIMES.has(m);
}
export function isMedia(m: string): boolean { return MEDIA_MIMES.has(m); }

const FOLDERS = ['estrategicos','materiais','operacionais','contratos','relatorios','entregas'] as const;
const VISIBILITY = ['internal','client_shared','approval'] as const;
const SENSITIVITY = ['normal','confidential','restricted'] as const;

// Pastas cujos documentos são internos por padrão
const INTERNAL_FOLDERS = new Set(['estrategicos','operacionais','contratos','relatorios']);

// ─── Supabase (service role) ──────────────────────────────────
let _db: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (_db) return _db;
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  _db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _db;
}

// ─── Errors ───────────────────────────────────────────────────
export type FileErrorCode =
  | 'auth:required' | 'auth:forbidden' | 'resource:not_found'
  | 'validation:invalid_request' | 'file:too_large' | 'file:unsupported_media_type'
  | 'file:mime_mismatch' | 'file:checksum_mismatch' | 'file:duplicate'
  | 'file:upload_expired' | 'file:quarantined' | 'file:processing'
  | 'file:extraction_failed' | 'file:content_unavailable'
  | 'write:forbidden' | 'conflict:idempotency';

export class FileError extends Error {
  constructor(public code: FileErrorCode, message: string, public field?: string, public retryable = false) {
    super(message);
  }
}

// ─── Ctx ──────────────────────────────────────────────────────
export interface FileCtx {
  keyId: string;
  scopes: string[];
  origin: string | null;
  correlationId: string;
  resultRefHolder?: { value?: string };
}

function ensureWriteAllowed(_ctx: FileCtx) {
  if (!FILE_WRITE_ENABLED) throw new FileError('write:forbidden', 'File write disabled (MCP_FILE_WRITE_V2=false)');
}

// ─── Idempotency (via files.idempotency_key unique index) ─────
async function findByIdempotency(key: string) {
  const { data } = await db().from('files').select('*').eq('idempotency_key', key).maybeSingle();
  return data;
}

// ─── Validation helpers ───────────────────────────────────────
async function assertClientAndProject(clientId: string, projectId?: string) {
  const { data: c } = await db().from('profiles').select('id').eq('id', clientId).maybeSingle();
  if (!c) throw new FileError('resource:not_found', 'client_id not found');
  if (projectId) {
    const { data: p } = await db().from('projects').select('id,client_id').eq('id', projectId).maybeSingle();
    if (!p) throw new FileError('resource:not_found', 'project_id not found');
    if (p.client_id !== clientId) {
      throw new FileError('validation:invalid_request', 'project_id does not belong to client_id', 'project_id');
    }
  }
}

function computeDefaults(folder: string, sensitivity?: string, visibility?: string) {
  const isInternal = INTERNAL_FOLDERS.has(folder);
  let s = sensitivity ?? 'normal';
  // Contratos e operacionais (políticas etc.) tendem a restrito por padrão
  if (!sensitivity && (folder === 'contratos' || folder === 'operacionais')) s = 'restricted';
  const v = visibility ?? (isInternal ? 'internal' : 'internal');
  return { visibility: v, sensitivity: s, isInternal };
}

function extFromName(n: string): string {
  const i = n.lastIndexOf('.');
  return i >= 0 ? n.slice(i + 1).toLowerCase() : '';
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Schemas ──────────────────────────────────────────────────
const UUID = z.string().uuid();

export const prepareUploadSchema = z.object({
  client_id: UUID,
  project_id: UUID.optional(),
  file_name: z.string().min(1).max(255),
  mime_type: z.string().min(3).max(200),
  size_bytes: z.number().int().min(1).max(LIMITS.mediaMaxBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  folder: z.enum(FOLDERS),
  file_type: z.string().max(64).optional(),
  visibility: z.enum(VISIBILITY).optional(),
  sensitivity: z.enum(SENSITIVITY).optional(),
  requires_approval: z.boolean().optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  idempotency_key: z.string().min(8).max(128),
}).strict();

export const finalizeUploadSchema = z.object({
  file_id: UUID,
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  idempotency_key: z.string().min(8).max(128),
}).strict();

export const inlineUploadSchema = z.object({
  client_id: UUID,
  project_id: UUID.optional(),
  file_name: z.string().min(1).max(255),
  mime_type: z.string().min(3).max(200),
  content_base64: z.string().min(4),
  folder: z.enum(FOLDERS),
  file_type: z.string().max(64).optional(),
  visibility: z.enum(VISIBILITY).optional(),
  sensitivity: z.enum(SENSITIVITY).optional(),
  requires_approval: z.boolean().optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  idempotency_key: z.string().min(8).max(128),
}).strict();

export const getContentSchema = z.object({
  file_id: UUID,
  mode: z.enum(['metadata','full','chunks','pages','sheets','slides']).default('metadata'),
  start_page: z.number().int().min(1).optional(),
  end_page: z.number().int().min(1).optional(),
  sheet_name: z.string().max(120).optional(),
  start_slide: z.number().int().min(1).optional(),
  end_slide: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(50),
  include_metadata: z.boolean().default(true),
}).strict();

export const searchContentSchema = z.object({
  query: z.string().min(1).max(500),
  client_id: UUID.optional(),
  project_id: UUID.optional(),
  file_id: UUID.optional(),
  folder: z.enum(FOLDERS).optional(),
  file_type: z.string().max(64).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  include_snippets: z.boolean().default(true),
}).strict();

export const updateMetadataSchema = z.object({
  file_id: UUID,
  project_id: UUID.nullable().optional(),
  folder: z.enum(FOLDERS).optional(),
  file_type: z.string().max(64).optional(),
  visibility: z.enum(VISIBILITY).optional(),
  sensitivity: z.enum(SENSITIVITY).optional(),
  requires_approval: z.boolean().optional(),
  description: z.string().max(2000).optional(),
  caption: z.string().max(500).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  idempotency_key: z.string().min(8).max(128),
}).strict();

export const createVersionSchema = z.object({
  parent_file_id: UUID,
  content_base64: z.string().min(4),
  file_name: z.string().min(1).max(255).optional(),
  mime_type: z.string().min(3).max(200),
  version_notes: z.string().max(2000).optional(),
  idempotency_key: z.string().min(8).max(128),
}).strict();

export const archiveSchema = z.object({
  file_id: UUID,
  reason: z.string().max(1000).optional(),
  idempotency_key: z.string().min(8).max(128),
}).strict();

export const restoreSchema = z.object({
  file_id: UUID,
  idempotency_key: z.string().min(8).max(128),
}).strict();

export const processingStatusSchema = z.object({
  file_id: UUID.optional(),
  processing_job_id: UUID.optional(),
}).strict().refine(v => v.file_id || v.processing_job_id, {
  message: 'file_id or processing_job_id required',
});

// ─── Storage helpers ──────────────────────────────────────────
function storagePath(clientId: string, fileId: string, version: number, fileName: string) {
  const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(0, 200);
  return `${clientId}/${fileId}/v${version}/${safe}`;
}

// ─── Core: prepare (signed upload URL) ────────────────────────
export async function prepareFileUpload(input: z.infer<typeof prepareUploadSchema>, ctx: FileCtx) {
  ensureWriteAllowed(ctx);
  if (!isAllowedMime(input.mime_type)) throw new FileError('file:unsupported_media_type', `MIME not allowed: ${input.mime_type}`);
  const cap = isMedia(input.mime_type) ? LIMITS.mediaMaxBytes : LIMITS.signedMaxBytes;
  if (input.size_bytes > cap) throw new FileError('file:too_large', `Max ${cap} bytes for this type`);

  const existing = await findByIdempotency(input.idempotency_key);
  if (existing) {
    const { data: signed } = await db().storage.from(LIMITS.bucket)
      .createSignedUploadUrl(existing.storage_path!);
    return {
      file_id: existing.id, upload_id: existing.idempotency_key,
      upload_url: signed?.signedUrl ?? null, storage_path: existing.storage_path,
      required_headers: { 'x-upsert': 'true', 'content-type': existing.mime_type },
      expires_at: new Date(Date.now() + LIMITS.signedUploadTtlSec * 1000).toISOString(),
      max_size_bytes: cap, upload_status: existing.status ?? 'uploading',
      reused: true,
    };
  }

  await assertClientAndProject(input.client_id, input.project_id);
  const defs = computeDefaults(input.folder, input.sensitivity, input.visibility);
  const fileId = crypto.randomUUID();
  const path = storagePath(input.client_id, fileId, 1, input.file_name);

  const { error: insErr } = await db().from('files').insert({
    id: fileId,
    client_id: input.client_id,
    project_id: input.project_id ?? null,
    uploaded_by: input.client_id,          // registro provisório; sobrescrito no finalize se necessário
    file_name: input.file_name,
    file_url: '',                          // preenchido no finalize
    file_type: input.file_type ?? null,
    folder: input.folder,
    approval_status: input.requires_approval ? 'pending' : 'approved',
    description: input.description ?? null,
    version: 1,
    mime_type: input.mime_type,
    extension: extFromName(input.file_name),
    size_bytes: input.size_bytes,
    sha256: input.sha256 ?? null,
    storage_bucket: LIMITS.bucket,
    storage_path: path,
    tags: input.tags ?? [],
    visibility: defs.visibility,
    sensitivity: defs.sensitivity,
    requires_approval: !!input.requires_approval,
    status: 'uploading',
    extraction_status: 'pending',
    source: ctx.origin ?? 'mcp',
    idempotency_key: input.idempotency_key,
  });
  if (insErr) throw new FileError('validation:invalid_request', insErr.message);

  if (ctx.resultRefHolder) ctx.resultRefHolder.value = fileId;

  const { data: signed, error: sErr } = await db().storage.from(LIMITS.bucket).createSignedUploadUrl(path);
  if (sErr) throw new FileError('validation:invalid_request', `signed url: ${sErr.message}`);

  return {
    file_id: fileId, upload_id: input.idempotency_key,
    upload_url: signed.signedUrl, storage_path: path,
    required_headers: { 'x-upsert': 'true', 'content-type': input.mime_type },
    expires_at: new Date(Date.now() + LIMITS.signedUploadTtlSec * 1000).toISOString(),
    max_size_bytes: cap, upload_status: 'uploading',
    accepted_mime_types: [...DOC_MIMES, ...IMG_MIMES, ...MEDIA_MIMES],
  };
}

// ─── Core: finalize ───────────────────────────────────────────
export async function finalizeFileUpload(input: z.infer<typeof finalizeUploadSchema>, ctx: FileCtx) {
  ensureWriteAllowed(ctx);
  const { data: f } = await db().from('files').select('*').eq('id', input.file_id).maybeSingle();
  if (!f) throw new FileError('resource:not_found', 'file not found');
  if (f.idempotency_key !== input.idempotency_key) {
    throw new FileError('conflict:idempotency', 'idempotency_key mismatch');
  }

  const { data: obj, error: hErr } = await db().storage.from(LIMITS.bucket)
    .createSignedUrl(f.storage_path, 60);
  if (hErr || !obj) throw new FileError('resource:not_found', 'upload not found in storage');

  // Baixa para validar tamanho/checksum
  const res = await fetch(obj.signedUrl);
  if (!res.ok) throw new FileError('resource:not_found', 'storage fetch failed');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actualSha = await sha256Hex(bytes);
  if (input.sha256 && input.sha256.toLowerCase() !== actualSha) {
    await db().from('files').update({ status: 'quarantined' }).eq('id', f.id);
    throw new FileError('file:checksum_mismatch', 'sha256 does not match uploaded content');
  }

  // Dedupe soft: se o mesmo cliente já tem um arquivo com esse sha256 pronto, marca warning
  let warnings: string[] = [];
  if (actualSha) {
    const { data: dupes } = await db().from('files')
      .select('id').eq('client_id', f.client_id).eq('sha256', actualSha).neq('id', f.id).limit(1);
    if (dupes && dupes.length) warnings.push(`duplicate:${dupes[0].id}`);
  }

  // Publica URL/registro pronto e enfileira extração
  const publicUrl = `mcp-files://${f.storage_path}`;
  await db().from('files').update({
    file_url: publicUrl, sha256: actualSha, size_bytes: bytes.byteLength,
    status: 'ready', extraction_status: 'pending',
  }).eq('id', f.id);

  const { data: job } = await db().from('file_processing_jobs')
    .insert({ file_id: f.id, job_type: 'extract', payload: { mime_type: f.mime_type } })
    .select('id').single();
  if (job?.id) kickWorker(job.id);

  if (ctx.resultRefHolder) ctx.resultRefHolder.value = f.id;
  return {
    file_id: f.id, storage_status: 'ready', extraction_status: 'pending',
    processing_job_id: job?.id ?? null, sha256: actualSha, size_bytes: bytes.byteLength,
    warnings,
  };
}

// ─── Core: inline upload (base64) ─────────────────────────────
export async function uploadFileInline(input: z.infer<typeof inlineUploadSchema>, ctx: FileCtx) {
  ensureWriteAllowed(ctx);
  if (!isAllowedMime(input.mime_type)) throw new FileError('file:unsupported_media_type', `MIME not allowed: ${input.mime_type}`);

  const existing = await findByIdempotency(input.idempotency_key);
  if (existing) return _summarize(existing, { reused: true });

  await assertClientAndProject(input.client_id, input.project_id);

  const bin = Uint8Array.from(atob(input.content_base64), c => c.charCodeAt(0));
  if (bin.byteLength > LIMITS.inlineMaxBytes) {
    throw new FileError('file:too_large', `inline upload capped at ${LIMITS.inlineMaxBytes} bytes; use aceleriq_prepare_file_upload`);
  }
  const sha = await sha256Hex(bin);
  const defs = computeDefaults(input.folder, input.sensitivity, input.visibility);
  const fileId = crypto.randomUUID();
  const path = storagePath(input.client_id, fileId, 1, input.file_name);

  const { error: upErr } = await db().storage.from(LIMITS.bucket)
    .upload(path, bin, { contentType: input.mime_type, upsert: false });
  if (upErr) throw new FileError('validation:invalid_request', `storage: ${upErr.message}`);

  const { data: inserted, error: insErr } = await db().from('files').insert({
    id: fileId,
    client_id: input.client_id, project_id: input.project_id ?? null,
    uploaded_by: input.client_id, file_name: input.file_name,
    file_url: `mcp-files://${path}`, file_type: input.file_type ?? null, folder: input.folder,
    approval_status: input.requires_approval ? 'pending' : 'approved',
    description: input.description ?? null, version: 1,
    mime_type: input.mime_type, extension: extFromName(input.file_name),
    size_bytes: bin.byteLength, sha256: sha,
    storage_bucket: LIMITS.bucket, storage_path: path,
    tags: input.tags ?? [], visibility: defs.visibility, sensitivity: defs.sensitivity,
    requires_approval: !!input.requires_approval,
    status: 'ready', extraction_status: 'pending',
    source: ctx.origin ?? 'mcp', idempotency_key: input.idempotency_key,
  }).select('*').single();
  if (insErr) throw new FileError('validation:invalid_request', insErr.message);

  const { data: jobRow } = await db().from('file_processing_jobs').insert({
    file_id: fileId, job_type: 'extract', payload: { mime_type: input.mime_type },
  }).select('id').single();
  if (jobRow?.id) kickWorker(jobRow.id);

  if (ctx.resultRefHolder) ctx.resultRefHolder.value = fileId;

  // Dedupe warning
  const warnings: string[] = [];
  const { data: dupes } = await db().from('files')
    .select('id').eq('client_id', input.client_id).eq('sha256', sha).neq('id', fileId).limit(1);
  if (dupes && dupes.length) warnings.push(`duplicate:${dupes[0].id}`);

  return _summarize(inserted, { warnings });
}

function _summarize(f: any, extra: Record<string, unknown> = {}) {
  return {
    file_id: f.id, file_name: f.file_name, mime_type: f.mime_type,
    size_bytes: f.size_bytes, version: f.version,
    status: f.status, extraction_status: f.extraction_status,
    approval_state: f.approval_status,
    is_internal_document: (f.visibility === 'internal'),
    visibility: f.visibility, sensitivity: f.sensitivity,
    sha256: f.sha256, folder: f.folder,
    ...extra,
  };
}

// ─── Read: content ────────────────────────────────────────────
export async function getFileContent(input: z.infer<typeof getContentSchema>, ctx: FileCtx) {
  const { data: f } = await db().from('files').select('*').eq('id', input.file_id).maybeSingle();
  if (!f) throw new FileError('resource:not_found', 'file not found');
  if (f.status === 'quarantined') throw new FileError('file:quarantined', 'file is quarantined');

  const isSensitive = f.sensitivity === 'confidential' || f.sensitivity === 'restricted';
  if (isSensitive) {
    const has = ctx.scopes.includes('files:sensitive:read') || ctx.scopes.includes('admin');
    if (!has) throw new FileError('auth:forbidden', 'files:sensitive:read required for confidential/restricted content');
  }

  if (input.mode === 'metadata') {
    return { file: _summarize(f), extraction_status: f.extraction_status, content_available: !!(f.extraction_status === 'completed' || f.extraction_status === 'partial') };
  }

  if (f.extraction_status === 'pending' || f.extraction_status === 'processing') {
    return { file: _summarize(f), extraction_status: f.extraction_status, content: null, warnings: ['extraction in progress'] };
  }
  if (f.extraction_status === 'unsupported') {
    return { file: _summarize(f), extraction_status: 'unsupported', content: null, warnings: ['content extraction not supported for this type'] };
  }

  let q = db().from('file_content_chunks').select('*', { count: 'exact' })
    .eq('file_id', f.id)
    .order('chunk_index', { ascending: true })
    .range(input.offset, input.offset + input.limit - 1);
  if (input.mode === 'pages') {
    if (input.start_page) q = q.gte('page_number', input.start_page);
    if (input.end_page) q = q.lte('page_number', input.end_page);
  } else if (input.mode === 'sheets' && input.sheet_name) {
    q = q.eq('sheet_name', input.sheet_name);
  } else if (input.mode === 'slides') {
    if (input.start_slide) q = q.gte('slide_number', input.start_slide);
    if (input.end_slide) q = q.lte('slide_number', input.end_slide);
  }
  const { data: chunks, count } = await q;
  const total = count ?? 0;
  return {
    file: _summarize(f), extraction_status: f.extraction_status,
    chunks: chunks ?? [], total,
    has_more: input.offset + (chunks?.length ?? 0) < total,
    next_offset: input.offset + (chunks?.length ?? 0),
  };
}

// ─── Read: search ─────────────────────────────────────────────
export async function searchFileContent(input: z.infer<typeof searchContentSchema>, ctx: FileCtx) {
  const canSensitive = ctx.scopes.includes('files:sensitive:read') || ctx.scopes.includes('admin');

  let q = db().from('file_content_chunks')
    .select('id,file_id,client_id,project_id,page_number,sheet_name,slide_number,text,files!inner(id,file_name,folder,sensitivity,visibility,status)', { count: 'exact' })
    .textSearch('search_vector', input.query, { config: 'portuguese', type: 'websearch' })
    .range(input.offset, input.offset + input.limit - 1);

  if (input.client_id) q = q.eq('client_id', input.client_id);
  if (input.project_id) q = q.eq('project_id', input.project_id);
  if (input.file_id) q = q.eq('file_id', input.file_id);
  if (input.folder) q = q.eq('files.folder', input.folder);

  const { data, count, error } = await q;
  if (error) throw new FileError('validation:invalid_request', error.message);

  const results = (data ?? [])
    .filter((r: any) => {
      if (r.files?.status === 'quarantined') return false;
      const sens = r.files?.sensitivity;
      if ((sens === 'confidential' || sens === 'restricted') && !canSensitive) return false;
      return true;
    })
    .map((r: any) => ({
      file_id: r.file_id, file_name: r.files?.file_name,
      snippet: input.include_snippets ? r.text.slice(0, 320) : undefined,
      page_number: r.page_number, sheet_name: r.sheet_name, slide_number: r.slide_number,
      score: 1,
    }));

  return {
    results, total: count ?? results.length,
    has_more: input.offset + results.length < (count ?? 0),
    next_offset: input.offset + results.length,
  };
}

// ─── Write: metadata ──────────────────────────────────────────
export async function updateFileMetadata(input: z.infer<typeof updateMetadataSchema>, ctx: FileCtx) {
  ensureWriteAllowed(ctx);
  const { data: f } = await db().from('files').select('*').eq('id', input.file_id).maybeSingle();
  if (!f) throw new FileError('resource:not_found', 'file not found');
  if (f.status === 'archived') throw new FileError('write:forbidden', 'file is archived');

  const patch: Record<string, unknown> = {};
  if (input.project_id !== undefined) {
    if (input.project_id) await assertClientAndProject(f.client_id, input.project_id);
    patch.project_id = input.project_id;
  }
  for (const k of ['folder','file_type','visibility','sensitivity','requires_approval','description','caption','tags'] as const) {
    if ((input as any)[k] !== undefined) (patch as any)[k] = (input as any)[k];
  }
  if (Object.keys(patch).length === 0) return _summarize(f);

  const { data: updated, error } = await db().from('files').update(patch).eq('id', f.id).select('*').single();
  if (error) throw new FileError('validation:invalid_request', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = f.id;
  return _summarize(updated);
}

// ─── Write: create version ────────────────────────────────────
export async function createFileVersion(input: z.infer<typeof createVersionSchema>, ctx: FileCtx) {
  ensureWriteAllowed(ctx);
  const { data: parent } = await db().from('files').select('*').eq('id', input.parent_file_id).maybeSingle();
  if (!parent) throw new FileError('resource:not_found', 'parent file not found');
  if (parent.folder === 'contratos' && parent.status !== 'ready') {
    throw new FileError('write:forbidden', 'signed contract copies are immutable');
  }
  if (!isAllowedMime(input.mime_type)) throw new FileError('file:unsupported_media_type', `MIME not allowed: ${input.mime_type}`);

  const existing = await findByIdempotency(input.idempotency_key);
  if (existing) return _summarize(existing, { reused: true, parent_file_id: parent.id });

  const bin = Uint8Array.from(atob(input.content_base64), c => c.charCodeAt(0));
  if (bin.byteLength > LIMITS.inlineMaxBytes) throw new FileError('file:too_large', `version upload capped at ${LIMITS.inlineMaxBytes} bytes inline`);
  const sha = await sha256Hex(bin);

  const newVersion = (parent.version ?? 1) + 1;
  const newId = crypto.randomUUID();
  const fileName = input.file_name ?? parent.file_name;
  const path = storagePath(parent.client_id, newId, newVersion, fileName);

  const { error: upErr } = await db().storage.from(LIMITS.bucket)
    .upload(path, bin, { contentType: input.mime_type, upsert: false });
  if (upErr) throw new FileError('validation:invalid_request', `storage: ${upErr.message}`);

  const { data: inserted, error: insErr } = await db().from('files').insert({
    id: newId,
    client_id: parent.client_id, project_id: parent.project_id,
    uploaded_by: parent.uploaded_by, parent_file_id: parent.id,
    file_name: fileName, file_url: `mcp-files://${path}`,
    file_type: parent.file_type, folder: parent.folder,
    approval_status: parent.requires_approval ? 'pending' : 'approved',
    description: input.version_notes ?? parent.description, version: newVersion,
    mime_type: input.mime_type, extension: extFromName(fileName),
    size_bytes: bin.byteLength, sha256: sha,
    storage_bucket: LIMITS.bucket, storage_path: path,
    tags: parent.tags, visibility: parent.visibility, sensitivity: parent.sensitivity,
    requires_approval: parent.requires_approval,
    status: 'ready', extraction_status: 'pending',
    source: ctx.origin ?? 'mcp', idempotency_key: input.idempotency_key,
  }).select('*').single();
  if (insErr) throw new FileError('validation:invalid_request', insErr.message);

  await db().from('file_processing_jobs').insert({ file_id: newId, job_type: 'extract', payload: { mime_type: input.mime_type } });
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = newId;
  return _summarize(inserted, { parent_file_id: parent.id });
}

// ─── Write: archive/restore ───────────────────────────────────
export async function archiveFile(input: z.infer<typeof archiveSchema>, ctx: FileCtx) {
  ensureWriteAllowed(ctx);
  const { data: f } = await db().from('files').select('*').eq('id', input.file_id).maybeSingle();
  if (!f) throw new FileError('resource:not_found', 'file not found');
  if (f.folder === 'contratos' && f.sensitivity === 'restricted') {
    throw new FileError('write:forbidden', 'signed contract cannot be archived via MCP');
  }
  const { data, error } = await db().from('files')
    .update({ status: 'archived', archived_at: new Date().toISOString(),
      description: input.reason ? `${f.description ?? ''}\n[archived] ${input.reason}` : f.description })
    .eq('id', f.id).select('*').single();
  if (error) throw new FileError('validation:invalid_request', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = f.id;
  return _summarize(data);
}
export async function restoreFile(input: z.infer<typeof restoreSchema>, ctx: FileCtx) {
  ensureWriteAllowed(ctx);
  const { data: f } = await db().from('files').select('*').eq('id', input.file_id).maybeSingle();
  if (!f) throw new FileError('resource:not_found', 'file not found');
  const { data, error } = await db().from('files')
    .update({ status: 'ready', archived_at: null })
    .eq('id', f.id).select('*').single();
  if (error) throw new FileError('validation:invalid_request', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = f.id;
  return _summarize(data);
}

// ─── Read: processing status ──────────────────────────────────
export async function getProcessingStatus(input: z.infer<typeof processingStatusSchema>) {
  if (input.processing_job_id) {
    const { data: j } = await db().from('file_processing_jobs').select('*').eq('id', input.processing_job_id).maybeSingle();
    if (!j) throw new FileError('resource:not_found', 'job not found');
    const { data: f } = await db().from('files').select('id,status,extraction_status,page_count,sheet_count,slide_count').eq('id', j.file_id).maybeSingle();
    return {
      job_id: j.id, file_id: j.file_id,
      upload_status: f?.status ?? null, extraction_status: f?.extraction_status ?? null,
      progress_percent: j.progress, warnings: [],
      error_code: j.last_error ? 'file:extraction_failed' : null,
      updated_at: j.updated_at,
      page_count: f?.page_count ?? null, sheet_count: f?.sheet_count ?? null, slide_count: f?.slide_count ?? null,
    };
  }
  const { data: f } = await db().from('files').select('id,status,extraction_status,page_count,sheet_count,slide_count').eq('id', input.file_id!).maybeSingle();
  if (!f) throw new FileError('resource:not_found', 'file not found');
  const { data: j } = await db().from('file_processing_jobs').select('id,progress,last_error,updated_at').eq('file_id', f.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return {
    job_id: j?.id ?? null, file_id: f.id,
    upload_status: f.status, extraction_status: f.extraction_status,
    progress_percent: j?.progress ?? (f.extraction_status === 'completed' ? 100 : 0),
    warnings: [], error_code: j?.last_error ? 'file:extraction_failed' : null,
    updated_at: j?.updated_at ?? null,
    page_count: f.page_count, sheet_count: f.sheet_count, slide_count: f.slide_count,
  };
}
