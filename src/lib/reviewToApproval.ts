import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { notifyUser } from "@/lib/notifyHelpers";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp"];
const VIDEO_EXTS = ["mp4", "mov", "webm"];
const GRAPHIC_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];

type TaskAttachment = {
  created_at?: string;
  file_name: string;
  file_type: string | null;
  file_url: string;
  uploaded_by: string;
};

const getExt = (value?: string) => {
  if (!value) return "";
  const normalized = value.split("?")[0].split("#")[0];
  return normalized.split(".").pop()?.toLowerCase() || "";
};

const resolveExt = (fileName: string, fileUrl?: string) => getExt(fileName) || getExt(fileUrl);

const isGraphicAsset = (fileName: string, fileUrl?: string) =>
  GRAPHIC_EXTS.includes(resolveExt(fileName, fileUrl));

const isImageAsset = (fileName: string, fileUrl?: string) =>
  IMAGE_EXTS.includes(resolveExt(fileName, fileUrl));

const buildGraphicName = (taskTitle: string, originalName: string, index?: number, total?: number) => {
  const ext = resolveExt(originalName) || "png";

  if (typeof index === "number" && typeof total === "number") {
    return `${taskTitle} (${index}/${total}).${ext}`;
  }

  return `${taskTitle}.${ext}`;
};

const sortAttachments = (attachments: TaskAttachment[]) =>
  [...attachments].sort(
    (a, b) =>
      (a.created_at || "").localeCompare(b.created_at || "") ||
      a.file_name.localeCompare(b.file_name)
  );

export async function sendTaskAttachmentsToApproval(
  taskId: string,
  projectId: string,
  taskTitle: string,
  authorId: string
) {
  const { data: attachments, error: attachmentsError } = await supabase
    .from("task_attachments")
    .select("created_at, file_name, file_type, file_url, uploaded_by")
    .eq("task_id", taskId);

  if (attachmentsError) throw attachmentsError;

  const sortedAttachments = sortAttachments((attachments || []) as TaskAttachment[]);
  if (sortedAttachments.length === 0) return { insertedCount: 0 };

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("client_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) throw projectError;
  if (!project?.client_id) return { insertedCount: 0 };

  const attachmentUrls = sortedAttachments.map((attachment) => attachment.file_url);
  const { data: existingFiles, error: existingFilesError } = await supabase
    .from("files")
    .select("file_url")
    .eq("project_id", projectId)
    .in("file_url", attachmentUrls);

  if (existingFilesError) throw existingFilesError;

  const existingUrls = new Set((existingFiles || []).map((file) => file.file_url));
  const newAttachments = sortedAttachments.filter((attachment) => !existingUrls.has(attachment.file_url));

  if (newAttachments.length === 0) return { insertedCount: 0 };

  const graphicAttachments = newAttachments.filter((attachment) =>
    isGraphicAsset(attachment.file_name, attachment.file_url)
  );
  const otherAttachments = newAttachments.filter(
    (attachment) => !isGraphicAsset(attachment.file_name, attachment.file_url)
  );
  const imageAttachments = graphicAttachments.filter((attachment) =>
    isImageAsset(attachment.file_name, attachment.file_url)
  );
  const singleGraphicAttachments = graphicAttachments.filter((attachment) =>
    !isImageAsset(attachment.file_name, attachment.file_url)
  );

  let insertedCount = 0;

  if (imageAttachments.length > 1) {
    const parentAttachment = imageAttachments[0];
    const { data: parentFile, error: parentError } = await supabase
      .from("files")
      .insert({
        approval_status: "pending",
        caption: `Carrossel — ${taskTitle}`,
        client_id: project.client_id,
        description: `Gerado automaticamente da tarefa \"${taskTitle}\"`,
        file_name: buildGraphicName(taskTitle, parentAttachment.file_name),
        file_type: "creative",
        file_url: parentAttachment.file_url,
        folder: "materiais",
        project_id: projectId,
        uploaded_by: parentAttachment.uploaded_by || authorId,
      })
      .select("id")
      .single();

    if (parentError) throw parentError;
    insertedCount += 1;

    const childRows = imageAttachments.slice(1).map((attachment, index) => ({
      approval_status: "none",
      client_id: project.client_id,
      file_name: buildGraphicName(taskTitle, attachment.file_name, index + 2, imageAttachments.length),
      file_type: "creative",
      file_url: attachment.file_url,
      folder: "materiais",
      parent_file_id: parentFile.id,
      project_id: projectId,
      uploaded_by: attachment.uploaded_by || authorId,
    }));

    if (childRows.length > 0) {
      const { error: childrenError } = await supabase.from("files").insert(childRows);
      if (childrenError) throw childrenError;
      insertedCount += childRows.length;
    }
  } else if (imageAttachments.length === 1) {
    singleGraphicAttachments.unshift(imageAttachments[0]);
  }

  if (singleGraphicAttachments.length > 0) {
    const singleRows = singleGraphicAttachments.map((attachment) => ({
      approval_status: "pending",
      client_id: project.client_id,
      description: `Gerado automaticamente da tarefa \"${taskTitle}\"`,
      file_name: buildGraphicName(taskTitle, attachment.file_name),
      file_type: isImageAsset(attachment.file_name, attachment.file_url) ? "creative" : "video",
      file_url: attachment.file_url,
      folder: "materiais",
      project_id: projectId,
      uploaded_by: attachment.uploaded_by || authorId,
    }));
    const { error: graphicError } = await supabase.from("files").insert({
      ...singleRows[0],
    });

    if (graphicError) throw graphicError;
    if (singleRows.length > 1) {
      const { error: moreGraphicError } = await supabase.from("files").insert(singleRows.slice(1));
      if (moreGraphicError) throw moreGraphicError;
    }
    insertedCount += singleRows.length;
  }

  if (otherAttachments.length > 0) {
    const otherRows = otherAttachments.map((attachment) => ({
      approval_status: "pending",
      client_id: project.client_id,
      description: `Gerado automaticamente da tarefa \"${taskTitle}\"`,
      file_name: attachment.file_name,
      file_type: attachment.file_type || "documento",
      file_url: attachment.file_url,
      folder: "operacionais",
      project_id: projectId,
      uploaded_by: attachment.uploaded_by || authorId,
    }));

    const { error: otherError } = await supabase.from("files").insert(otherRows);
    if (otherError) throw otherError;
    insertedCount += otherRows.length;
  }

  if (insertedCount === 0) return { insertedCount: 0 };

  const approvalLabel =
    graphicAttachments.length > 1
      ? (imageAttachments.length > 1 ? "Carrossel" : "Arquivos")
      : graphicAttachments.length === 1
        ? "Arte"
        : otherAttachments.length > 1
          ? "Arquivos"
          : "Arquivo";

  const [, updRes] = await Promise.all([
    notifyUser(
      project.client_id,
      `${approvalLabel} \"${taskTitle}\" enviado para sua aprovação`,
      "approval",
      "/aprovacoes"
    ),
    supabase.from("updates").insert({
      author_id: authorId,
      message: `${approvalLabel} da tarefa \"${taskTitle}\" enviado para aprovação do cliente`,
      project_id: projectId,
      update_type: "delivery",
    }).select().single(),
  ]);
  notifyOpsUpdate(updRes?.data);

  return { insertedCount };
}
