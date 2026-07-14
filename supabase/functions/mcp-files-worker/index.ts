// Aceleriq MCP — Files v2 async worker (Bloco C).
// Processes file_processing_jobs: PDF, DOCX, XLSX, PPTX, images (OCR), text.
// Persists text chunks into file_content_chunks. Retries with backoff.
//
// Trigger modes:
//   POST /mcp-files-worker           -> drain up to MAX_BATCH queued jobs
//   POST /mcp-files-worker { job_id }-> process a single job (fire-and-forget after upload)
//   POST /mcp-files-worker { file_id }-> enqueue+process latest job for that file
//
// Runs with SERVICE ROLE — never exposed to end users. Cron/dispatch only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { unzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8.2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY') ?? '';
const BUCKET = 'mcp-files';
const MAX_ATTEMPTS = Number(Deno.env.get('MCP_FILE_MAX_ATTEMPTS') ?? 3);
const MAX_BATCH = Number(Deno.env.get('MCP_FILE_WORKER_BATCH') ?? 5);
const CHUNK_CHARS = Number(Deno.env.get('MCP_FILE_CHUNK_CHARS') ?? 1800);
const CHUNK_OVERLAP = Number(Deno.env.get('MCP_FILE_CHUNK_OVERLAP') ?? 180);
const OCR_MODEL = Deno.env.get('MCP_FILE_OCR_MODEL') ?? 'google/gemini-2.5-flash';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Entry ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    if (body.job_id) {
      const { data: job } = await db.from('file_processing_jobs').select('*').eq('id', body.job_id).maybeSingle();
      if (!job) return json({ error: 'job not found' }, 404);
      const result = await runJob(job);
      return json({ processed: 1, result });
    }
    if (body.file_id) {
      const { data: job } = await db.from('file_processing_jobs')
        .select('*').eq('file_id', body.file_id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!job) return json({ error: 'no job for file' }, 404);
      const result = await runJob(job);
      return json({ processed: 1, result });
    }
    // Drain batch
    const drained: any[] = [];
    for (let i = 0; i < MAX_BATCH; i++) {
      const job = await claimNext();
      if (!job) break;
      const result = await runJob(job).catch(e => ({ ok: false, error: String(e?.message ?? e) }));
      drained.push({ job_id: job.id, ...(result as any) });
    }
    return json({ processed: drained.length, jobs: drained });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: CORS });
}

// ─── Queue ─────────────────────────────────────────────────────
async function claimNext() {
  // Atomic claim: mark oldest queued/failed(<max) as running.
  const { data: candidates } = await db.from('file_processing_jobs')
    .select('*')
    .in('status', ['queued', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(1);
  const c = candidates?.[0];
  if (!c) return null;
  const { data: updated } = await db.from('file_processing_jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), attempts: (c.attempts ?? 0) + 1 })
    .eq('id', c.id).eq('status', c.status)
    .select('*').maybeSingle();
  return updated;
}

async function markSuccess(jobId: string) {
  await db.from('file_processing_jobs').update({
    status: 'completed', progress: 100, finished_at: new Date().toISOString(), last_error: null,
  }).eq('id', jobId);
}

async function markFailure(job: any, err: string) {
  const attempts = (job.attempts ?? 0);
  const terminal = attempts >= MAX_ATTEMPTS;
  await db.from('file_processing_jobs').update({
    status: terminal ? 'failed' : 'queued', // requeue for retry
    last_error: err.slice(0, 4000),
    finished_at: terminal ? new Date().toISOString() : null,
  }).eq('id', job.id);
  if (terminal) {
    await db.from('files').update({
      extraction_status: 'failed', extraction_error: err.slice(0, 1000),
    }).eq('id', job.file_id);
  }
}

async function updateProgress(jobId: string, pct: number) {
  await db.from('file_processing_jobs').update({ progress: Math.max(0, Math.min(99, pct)) }).eq('id', jobId);
}

// ─── Job runner ────────────────────────────────────────────────
async function runJob(job: any) {
  try {
    if (job.status !== 'running') {
      // Re-claim in case invoked directly with a queued job_id
      await db.from('file_processing_jobs').update({
        status: 'running', started_at: new Date().toISOString(),
        attempts: (job.attempts ?? 0) + 1,
      }).eq('id', job.id);
      job.attempts = (job.attempts ?? 0) + 1;
    }

    const { data: f } = await db.from('files').select('*').eq('id', job.file_id).maybeSingle();
    if (!f) throw new Error('file record not found');
    if (f.status === 'quarantined') throw new Error('file quarantined');
    if (!f.storage_path) throw new Error('missing storage_path');

    await db.from('files').update({ extraction_status: 'processing', extraction_error: null }).eq('id', f.id);
    await updateProgress(job.id, 5);

    const { data: dl, error: dlErr } = await db.storage.from(f.storage_bucket || BUCKET).download(f.storage_path);
    if (dlErr || !dl) throw new Error(`download failed: ${dlErr?.message ?? 'no data'}`);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    await updateProgress(job.id, 20);

    const mime = f.mime_type || 'application/octet-stream';
    const extracted = await extract(bytes, mime, f.file_name || '');
    await updateProgress(job.id, 75);

    // Replace previous chunks (idempotent re-extraction)
    await db.from('file_content_chunks').delete().eq('file_id', f.id);

    if (extracted.status === 'unsupported') {
      await db.from('files').update({
        extraction_status: 'unsupported', extraction_error: null,
        extracted_metadata: extracted.meta ?? {},
      }).eq('id', f.id);
      await markSuccess(job.id);
      return { ok: true, status: 'unsupported' };
    }

    const chunks = buildChunks(f, extracted);
    if (chunks.length) {
      // Insert in batches of 200
      for (let i = 0; i < chunks.length; i += 200) {
        const slice = chunks.slice(i, i + 200);
        const { error } = await db.from('file_content_chunks').insert(slice);
        if (error) throw new Error(`chunk insert: ${error.message}`);
      }
    }

    await db.from('files').update({
      extraction_status: chunks.length ? 'completed' : 'partial',
      extraction_error: null,
      page_count: extracted.page_count ?? null,
      sheet_count: extracted.sheet_count ?? null,
      slide_count: extracted.slide_count ?? null,
      extracted_metadata: {
        engine: extracted.engine, chunk_count: chunks.length,
        total_chars: extracted.total_chars ?? null,
        tags_hint: extracted.tags_hint ?? [],
        ...(extracted.meta ?? {}),
      },
    }).eq('id', f.id);

    await markSuccess(job.id);
    return { ok: true, status: 'completed', chunks: chunks.length };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await markFailure(job, msg);
    return { ok: false, error: msg };
  }
}

// ─── Extraction ────────────────────────────────────────────────
interface ExtractedUnit {
  text: string;
  page_number?: number;
  sheet_name?: string;
  slide_number?: number;
  content_type: 'text' | 'ocr' | 'table' | 'slide' | 'sheet' | 'page';
  metadata?: Record<string, unknown>;
}
interface ExtractionResult {
  status: 'ok' | 'partial' | 'unsupported';
  engine: string;
  units: ExtractedUnit[];
  page_count?: number;
  sheet_count?: number;
  slide_count?: number;
  total_chars?: number;
  tags_hint?: string[];
  meta?: Record<string, unknown>;
}

async function extract(bytes: Uint8Array, mime: string, name: string): Promise<ExtractionResult> {
  // Plain text family
  if (mime.startsWith('text/') || mime === 'application/json') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return { status: 'ok', engine: 'text-decoder', units: [{ text, content_type: 'text' }], total_chars: text.length };
  }
  if (mime === 'application/pdf') return await extractPdf(bytes);
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return extractDocx(bytes);
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return extractXlsx(bytes);
  if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return extractPptx(bytes);
  if (mime.startsWith('image/')) return await extractImageOcr(bytes, mime);
  // Video/audio: mark unsupported — media pipeline handled elsewhere.
  return { status: 'unsupported', engine: 'none', units: [], meta: { reason: `no extractor for ${mime}` } };
}

// ─── PDF (Gemini multimodal) ───────────────────────────────────
async function extractPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  if (!LOVABLE_API_KEY) {
    return { status: 'unsupported', engine: 'pdf-none', units: [], meta: { reason: 'LOVABLE_API_KEY missing' } };
  }
  const b64 = toBase64(bytes);
  const prompt = 'Extract ALL readable text from this PDF, preserving reading order. For each page, emit a line "===PAGE n===" then the text of that page. Include tables as tab-separated text. Do not summarize.';
  const content = [
    { type: 'text', text: prompt },
    { type: 'file', file: { file_data: `data:application/pdf;base64,${b64}`, filename: 'doc.pdf' } },
  ];
  const text = await callLovableAI(content);
  const pages = splitPages(text);
  const units: ExtractedUnit[] = pages.map((t, i) => ({ text: t, page_number: i + 1, content_type: 'page' }));
  return {
    status: 'ok', engine: OCR_MODEL, units,
    page_count: pages.length, total_chars: text.length,
  };
}

function splitPages(raw: string): string[] {
  const parts = raw.split(/===\s*PAGE\s*\d+\s*===/i).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : [raw.trim()];
}

// ─── Image OCR (Gemini vision) ─────────────────────────────────
async function extractImageOcr(bytes: Uint8Array, mime: string): Promise<ExtractionResult> {
  if (!LOVABLE_API_KEY) {
    return { status: 'unsupported', engine: 'ocr-none', units: [], meta: { reason: 'LOVABLE_API_KEY missing' } };
  }
  const b64 = toBase64(bytes);
  const content = [
    { type: 'text', text: 'Perform OCR. Return only the transcribed text, no commentary.' },
    { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
  ];
  const text = await callLovableAI(content);
  return { status: 'ok', engine: `${OCR_MODEL}-ocr`, units: [{ text, content_type: 'ocr' }], total_chars: text.length };
}

async function callLovableAI(content: unknown): Promise<string> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({ model: OCR_MODEL, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const j = await res.json();
  return String(j?.choices?.[0]?.message?.content ?? '').trim();
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// ─── DOCX ──────────────────────────────────────────────────────
function extractDocx(bytes: Uint8Array): ExtractionResult {
  const files = unzipSync(bytes);
  const docXml = files['word/document.xml'];
  if (!docXml) return { status: 'unsupported', engine: 'docx-zip', units: [], meta: { reason: 'no document.xml' } };
  const xml = strFromU8(docXml);
  // Split by <w:p ...>...</w:p> paragraphs
  const paras: string[] = [];
  const pRe = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(xml))) {
    const p = m[0];
    let text = '';
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(p))) text += decodeXml(tm[1]);
    if (text.trim()) paras.push(text.trim());
  }
  const full = paras.join('\n');
  return {
    status: 'ok', engine: 'docx-zip',
    units: [{ text: full, content_type: 'text', metadata: { paragraphs: paras.length } }],
    total_chars: full.length,
  };
}

// ─── XLSX ──────────────────────────────────────────────────────
function extractXlsx(bytes: Uint8Array): ExtractionResult {
  const files = unzipSync(bytes);
  const sharedRaw = files['xl/sharedStrings.xml'];
  const shared: string[] = [];
  if (sharedRaw) {
    const s = strFromU8(sharedRaw);
    const siRe = /<si\b[\s\S]*?<\/si>/g;
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let m: RegExpExecArray | null;
    while ((m = siRe.exec(s))) {
      let txt = ''; let tm: RegExpExecArray | null;
      while ((tm = tRe.exec(m[0]))) txt += decodeXml(tm[1]);
      shared.push(txt);
    }
  }
  // Map sheet id -> name via workbook.xml
  const wb = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const names: string[] = [];
  const shRe = /<sheet[^>]*name="([^"]+)"[^>]*sheetId="(\d+)"/g;
  let sm: RegExpExecArray | null;
  while ((sm = shRe.exec(wb))) names.push(sm[1]);

  const units: ExtractedUnit[] = [];
  const sheetPaths = Object.keys(files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  sheetPaths.forEach((path, idx) => {
    const raw = strFromU8(files[path]);
    const rows: string[] = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(raw))) {
      const cells: string[] = [];
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[1]))) {
        const attrs = cm[1]; const inner = cm[2];
        const isShared = /t="s"/.test(attrs);
        const valM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const inlineM = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(inner);
        let val = '';
        if (inlineM) val = decodeXml(inlineM[1]);
        else if (valM) {
          val = valM[1];
          if (isShared) val = shared[Number(val)] ?? '';
          else val = decodeXml(val);
        }
        cells.push(val);
      }
      if (cells.some(c => c !== '')) rows.push(cells.join('\t'));
    }
    const sheetName = names[idx] ?? `Sheet${idx + 1}`;
    const text = rows.join('\n');
    if (text) units.push({ text, sheet_name: sheetName, content_type: 'sheet', metadata: { rows: rows.length } });
  });
  return { status: 'ok', engine: 'xlsx-zip', units, sheet_count: units.length, total_chars: units.reduce((n, u) => n + u.text.length, 0) };
}

// ─── PPTX ──────────────────────────────────────────────────────
function extractPptx(bytes: Uint8Array): ExtractionResult {
  const files = unzipSync(bytes);
  const slidePaths = Object.keys(files).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const units: ExtractedUnit[] = [];
  const tRe = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  slidePaths.forEach((p, i) => {
    const xml = strFromU8(files[p]);
    let text = ''; let m: RegExpExecArray | null;
    while ((m = tRe.exec(xml))) text += decodeXml(m[1]) + '\n';
    text = text.trim();
    if (text) units.push({ text, slide_number: i + 1, content_type: 'slide' });
  });
  return { status: 'ok', engine: 'pptx-zip', units, slide_count: units.length, total_chars: units.reduce((n, u) => n + u.text.length, 0) };
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// ─── Chunking ──────────────────────────────────────────────────
function buildChunks(f: any, ex: ExtractionResult) {
  const out: any[] = [];
  let idx = 0;
  for (const u of ex.units) {
    const pieces = splitText(u.text, CHUNK_CHARS, CHUNK_OVERLAP);
    for (const t of pieces) {
      if (!t.trim()) continue;
      out.push({
        file_id: f.id, client_id: f.client_id, project_id: f.project_id ?? null,
        chunk_index: idx++, content_type: u.content_type,
        page_number: u.page_number ?? null,
        sheet_name: u.sheet_name ?? null,
        slide_number: u.slide_number ?? null,
        text: t, metadata: u.metadata ?? {},
      });
    }
  }
  return out;
}

function splitText(text: string, size: number, overlap: number): string[] {
  const t = text.replace(/\s+\n/g, '\n').trim();
  if (t.length <= size) return t ? [t] : [];
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(t.length, i + size);
    if (end < t.length) {
      // prefer breaking on paragraph/sentence
      const slice = t.slice(i, end);
      const br = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
      if (br > size * 0.5) end = i + br + 1;
    }
    out.push(t.slice(i, end).trim());
    if (end >= t.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}
