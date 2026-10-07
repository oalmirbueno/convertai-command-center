/** Organização idempotente de anexos prontos, sempre no cliente da tarefa. */
async function identidade(seed: string) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)));
  hash[6] = (hash[6] & 15) | 80; hash[8] = (hash[8] & 63) | 128;
  const s = [...hash.slice(0, 16)].map(n => n.toString(16).padStart(2, "0")).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export async function organizarArquivosDaExecucao(db: any, linkId: string, anexos: { name: string; url: string }[]) {
  const ids = [...new Set(anexos.map(a => /^aceleriq-file:\/\/([a-f0-9-]{36})$/i.exec(a.url)?.[1]).filter(Boolean))];
  if (!ids.length) return { organizados: 0, avisos: [] as string[] };
  const v = await db.from("operator_task_links").select("operator_id,kanban_task_id,painel_task_id").eq("id", linkId).single();
  if (v.error) throw new Error("Vínculo indisponível para organizar arquivos.");
  const [t, op] = await Promise.all([
    db.from("tasks").select("id,title,project:projects!tasks_project_id_fkey(client_id)").eq("id", v.data.kanban_task_id || v.data.painel_task_id).single(),
    db.from("internal_operators").select("display_name").eq("id", v.data.operator_id).single(),
  ]);
  if (t.error || op.error || !t.data?.project?.client_id) throw new Error("A tarefa precisa de um cliente para organizar os arquivos.");
  const clientId = t.data.project.client_id;
  const arquivos = await db.from("files").select("id,file_name,mime_type,size_bytes,storage_bucket,storage_path").in("id", ids).eq("client_id", clientId).eq("status", "ready").is("archived_at", null);
  if (arquivos.error) throw new Error("Não foi possível confirmar os arquivos do cliente.");
  let parentId: string | null = null;
  for (const [chave, name] of [["execucao", "Execução"], [v.data.operator_id, op.data.display_name], [t.data.id, t.data.title]]) {
    let consulta = db.from("workspace_nodes").select("id").eq("kind", "folder").eq("scope", "client").eq("client_id", clientId).eq("name", name);
    consulta = parentId ? consulta.eq("parent_id", parentId) : consulta.is("parent_id", null);
    const existente = await consulta.limit(1).maybeSingle();
    if (existente.error) throw new Error("Não foi possível conferir a pasta do agente.");
    if (existente.data) { parentId = existente.data.id; continue; }
    const id = await identidade(`execucao-folder:${clientId}:${parentId || "root"}:${chave}`);
    const r = await db.from("workspace_nodes").upsert({ id, name, kind: "folder", scope: "client", client_id: clientId, parent_id: parentId }, { onConflict: "id", ignoreDuplicates: true });
    if (r.error) throw new Error("Não foi possível preparar a pasta do agente.");
    parentId = id;
  }
  let organizados = 0;
  const avisos: string[] = [];
  for (const f of arquivos.data || []) {
    const id = await identidade(`execucao-file:${linkId}:${f.id}`);
    const existe = await db.from("workspace_nodes").select("id").eq("id", id).maybeSingle();
    if (existe.error) throw new Error("Não foi possível conferir a pasta da execução.");
    if (existe.data) { organizados++; continue; }
    if (!f.storage_bucket || !f.storage_path || f.size_bytes > 20 * 1024 * 1024) { avisos.push(`${f.file_name}: original preservado em Arquivos; cópia automática indisponível.`); continue; }
    const arquivo = await db.storage.from(f.storage_bucket).download(f.storage_path);
    if (arquivo.error || !arquivo.data || arquivo.data.size > 20 * 1024 * 1024) { avisos.push(`${f.file_name}: não foi possível copiar o original.`); continue; }
    const ext = f.file_name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "bin";
    const path = `client/${clientId}/${id}.${ext}`;
    const upload = await db.storage.from("workspace").upload(path, arquivo.data, { upsert: true, contentType: f.mime_type || "application/octet-stream" });
    if (upload.error) { avisos.push(`${f.file_name}: Workspace não confirmou o envio.`); continue; }
    const r = await db.from("workspace_nodes").upsert({ id, name: f.file_name, kind: "file", scope: "client", client_id: clientId, parent_id: parentId, storage_path: path, mime: f.mime_type, size_bytes: arquivo.data.size }, { onConflict: "id", ignoreDuplicates: true });
    if (r.error) avisos.push(`${f.file_name}: pasta não confirmou o registro.`); else organizados++;
  }
  if (ids.length > (arquivos.data || []).length) avisos.push("Um anexo não está pronto ou não pertence ao cliente da tarefa.");
  return { organizados, avisos };
}
