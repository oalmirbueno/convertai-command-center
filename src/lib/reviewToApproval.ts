import { supabase } from "@/integrations/supabase/client";
import { notifyUser } from "@/lib/notifyHelpers";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp"];
const VIDEO_EXTS = ["mp4", "mov", "avi"];

function getExt(name: string) {
  return name?.split(".").pop()?.toLowerCase() || "";
}

function isVisualFile(name: string) {
  const ext = getExt(name);
  return IMAGE_EXTS.includes(ext) || VIDEO_EXTS.includes(ext);
}

/**
 * When a task moves to "review", fetch its attachments and create
 * file entries for client approval. Groups multiple visual files
 * as a carousel (parent + children), single files as static.
 */
export async function sendTaskAttachmentsToApproval(
  taskId: string,
  projectId: string,
  taskTitle: string,
  authorId: string
) {
  // 1. Fetch task attachments
  const { data: attachments } = await supabase
    .from("task_attachments")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (!attachments || attachments.length === 0) return;

  // 2. Get project info for client_id
  const { data: project } = await supabase
    .from("projects")
    .select("client_id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project?.client_id) return;

  // 3. Filter only visual files (images/videos) for approval
  const visualFiles = attachments.filter((a) => isVisualFile(a.file_name));
  const nonVisualFiles = attachments.filter((a) => !isVisualFile(a.file_name));

  // 4. Check if files already exist in approval (avoid duplicates)
  const existingUrls = new Set<string>();
  const { data: existingFiles } = await supabase
    .from("files")
    .select("file_url")
    .eq("project_id", projectId)
    .in("file_url", attachments.map((a) => a.file_url));
  (existingFiles || []).forEach((f) => existingUrls.add(f.file_url));

  const newVisual = visualFiles.filter((a) => !existingUrls.has(a.file_url));
  const newNonVisual = nonVisualFiles.filter((a) => !existingUrls.has(a.file_url));

  if (newVisual.length === 0 && newNonVisual.length === 0) return;

  // 5. Handle visual files — carousel if >1, static if 1
  if (newVisual.length > 1) {
    // Create parent (first file)
    const parent = newVisual[0];
    const { data: parentFile } = await supabase
      .from("files")
      .insert({
        file_name: parent.file_name,
        file_url: parent.file_url,
        file_type: parent.file_type || null,
        project_id: projectId,
        client_id: project.client_id,
        uploaded_by: authorId,
        approval_status: "pending",
        folder: "entregas",
        caption: `Carrossel — ${taskTitle}`,
        description: `Gerado automaticamente da tarefa "${taskTitle}"`,
      })
      .select("id")
      .single();

    if (parentFile) {
      // Create children
      const children = newVisual.slice(1).map((a) => ({
        file_name: a.file_name,
        file_url: a.file_url,
        file_type: a.file_type || null,
        project_id: projectId,
        client_id: project.client_id,
        uploaded_by: authorId,
        approval_status: "none",
        folder: "entregas",
        parent_file_id: parentFile.id,
      }));
      await supabase.from("files").insert(children);
    }
  } else if (newVisual.length === 1) {
    // Single static file
    const file = newVisual[0];
    await supabase.from("files").insert({
      file_name: file.file_name,
      file_url: file.file_url,
      file_type: file.file_type || null,
      project_id: projectId,
      client_id: project.client_id,
      uploaded_by: authorId,
      approval_status: "pending",
      folder: "entregas",
      description: `Gerado automaticamente da tarefa "${taskTitle}"`,
    });
  }

  // 6. Handle non-visual files (docs, zips, etc.) as individual static files
  for (const file of newNonVisual) {
    await supabase.from("files").insert({
      file_name: file.file_name,
      file_url: file.file_url,
      file_type: file.file_type || null,
      project_id: projectId,
      client_id: project.client_id,
      uploaded_by: authorId,
      approval_status: "pending",
      folder: "entregas",
      description: `Gerado automaticamente da tarefa "${taskTitle}"`,
    });
  }

  // 7. Notify client about pending approval
  const label = newVisual.length > 1 ? "Carrossel" : "Arte";
  await notifyUser(
    project.client_id,
    `${label} "${taskTitle}" enviado para sua aprovação`,
    "approval",
    "/aprovacoes"
  );

  // 8. Create update entry
  await supabase.from("updates").insert({
    project_id: projectId,
    author_id: authorId,
    message: `${label} da tarefa "${taskTitle}" enviado para aprovação do cliente`,
    update_type: "delivery",
  });
}
