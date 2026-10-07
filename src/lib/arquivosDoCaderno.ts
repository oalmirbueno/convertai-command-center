import { supabase } from "@/integrations/supabase/client";

/** Guarda o original no Workspace do cliente, em Execução / agente / tarefa. */
export async function anexarNoCaderno(file: File, linkId: string, userId: string, agente: string) {
  if (file.size > 100 * 1024 * 1024) throw new Error("Para arquivos acima de 100 MB, use o envio do Workspace.");
  const v = await supabase.from("operator_task_links").select("kanban_task_id,painel_task_id").eq("id", linkId).single();
  if (v.error) throw v.error;
  const taskId = v.data.kanban_task_id || v.data.painel_task_id;
  if (!taskId) throw new Error("Vincule esta execução a uma tarefa antes de anexar.");
  const t = await supabase.from("tasks").select("title,project_id").eq("id", taskId).single();
  if (t.error) throw t.error;
  const p = t.data.project_id ? await supabase.from("projects").select("client_id").eq("id", t.data.project_id).single() : null;
  if (p?.error) throw p.error;
  const clientId = p?.data?.client_id || null;
  const scope = clientId ? "client" as const : "global" as const;
  let parentId: string | null = null;
  for (const name of ["Execução", agente, t.data.title]) {
    let q = supabase.from("workspace_nodes").select("id").eq("kind", "folder").eq("scope", scope).eq("name", name);
    q = parentId ? q.eq("parent_id", parentId) : q.is("parent_id", null);
    q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
    const atual = await q.limit(1).maybeSingle();
    if (atual.error) throw atual.error;
    if (atual.data) parentId = atual.data.id;
    else {
      const nova = await supabase.from("workspace_nodes").insert({ name, kind: "folder", scope, client_id: clientId, parent_id: parentId, created_by: userId }).select("id").single();
      if (nova.error) throw nova.error;
      parentId = nova.data.id;
    }
  }
  const ext = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "bin";
  const path = `${scope}/${clientId || "global"}/${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from("workspace").upload(path, file);
  if (upload.error) throw upload.error;
  const registrado = await supabase.from("workspace_nodes").insert({ name: file.name, kind: "file", scope, client_id: clientId, parent_id: parentId, storage_path: path, mime: file.type || null, size_bytes: file.size, created_by: userId }).select("id").single();
  if (registrado.error) {
    // Uma falha de transporte pode ocorrer depois do commit: confirme antes de remover.
    const confirmado = await supabase.from("workspace_nodes").select("id").eq("storage_path", path).maybeSingle();
    if (confirmado.error) throw new Error("O arquivo foi enviado, mas não foi possível conferir seu registro. Confira o Workspace antes de reenviar.");
    if (!confirmado.data) {
      await supabase.storage.from("workspace").remove([path]);
      throw new Error("Não foi possível registrar o arquivo. Tente novamente.");
    }
  }
  return { name: file.name, url: `workspace://${path}` };
}
