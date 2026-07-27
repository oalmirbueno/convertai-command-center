import { supabase } from "@/integrations/supabase/client";
import { storageRefFromFile } from "@/lib/fileUrls";

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

type ApprovalFile = {
  id: string;
  agency_approval_status: string | null;
  approval_status: string | null;
  archived_at: string | null;
  client_id: string;
  file_url: string;
  locked_at: string | null;
  parent_file_id: string | null;
  project_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  visibility: string | null;
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

  const seenAttachmentUrls = new Set<string>();
  const sortedAttachments = sortAttachments((attachments || []) as TaskAttachment[])
    .filter((attachment) => {
      if (seenAttachmentUrls.has(attachment.file_url)) return false;
      seenAttachmentUrls.add(attachment.file_url);
      return true;
    });
  if (sortedAttachments.length === 0) return { insertedCount: 0 };

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("client_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) throw projectError;
  if (!project?.client_id) return { insertedCount: 0 };

  const { data: existingFiles, error: existingFilesError } = await (supabase as any)
    .from("staff_files_secure")
    .select("id, agency_approval_status, approval_status, archived_at, client_id, file_url, locked_at, parent_file_id, project_id, storage_bucket, storage_path, visibility")
    .eq("project_id", projectId)
    .eq("client_id", project.client_id)
    .is("archived_at", null);

  if (existingFilesError) throw existingFilesError;

  const graphicAttachments = sortedAttachments.filter((attachment) =>
    isGraphicAsset(attachment.file_name, attachment.file_url)
  );
  const otherAttachments = sortedAttachments.filter(
    (attachment) => !isGraphicAsset(attachment.file_name, attachment.file_url)
  );
  const imageAttachments = graphicAttachments.filter((attachment) =>
    isImageAsset(attachment.file_name, attachment.file_url)
  );
  const nonImageGraphicAttachments = graphicAttachments.filter((attachment) =>
    !isImageAsset(attachment.file_name, attachment.file_url)
  );

  let insertedCount = 0;
  const reviewFiles = new Map<string, ApprovalFile>();
  const filesById = new Map<string, ApprovalFile>();
  const filesByUrl = new Map<string, ApprovalFile>();
  const filesByStorage = new Map<string, ApprovalFile>();
  const storageKey = (bucket?: string | null, path?: string | null) =>
    bucket && path ? `${bucket}\u0000${path}` : null;
  const registerFile = (file: ApprovalFile) => {
    filesById.set(file.id, file);
    if (!filesByUrl.has(file.file_url)) filesByUrl.set(file.file_url, file);
    const ref = storageRefFromFile({
      fileUrl: file.file_url,
      storageBucket: file.storage_bucket,
      storagePath: file.storage_path,
    });
    const key = storageKey(ref?.bucket, ref?.path);
    if (key && !filesByStorage.has(key)) filesByStorage.set(key, file);
  };
  ((existingFiles || []) as ApprovalFile[]).forEach(registerFile);

  const secureFields = (attachment: TaskAttachment) => {
    const storage = storageRefFromFile({ fileUrl: attachment.file_url });
    return {
      agency_approval_status: "not_requested",
      approval_status: "none",
      requires_approval: false,
      status: "ready",
      storage_bucket: storage?.bucket || null,
      storage_path: storage?.path || null,
      visibility: "internal",
    };
  };

  const cachedFileForAttachment = (attachment: TaskAttachment) => {
    const storage = storageRefFromFile({ fileUrl: attachment.file_url });
    const key = storageKey(storage?.bucket, storage?.path);
    return (key ? filesByStorage.get(key) : undefined) || filesByUrl.get(attachment.file_url) || null;
  };

  const fetchExistingFile = async (attachment: TaskAttachment) => {
    const storage = storageRefFromFile({ fileUrl: attachment.file_url });
    let query = (supabase as any)
      .from("staff_files_secure")
      .select("id, agency_approval_status, approval_status, archived_at, client_id, file_url, locked_at, parent_file_id, project_id, storage_bucket, storage_path, visibility")
      .eq("project_id", projectId)
      .eq("client_id", project.client_id)
      .is("archived_at", null);

    query = storage
      ? query.eq("storage_bucket", storage.bucket).eq("storage_path", storage.path)
      : query.eq("file_url", attachment.file_url);

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    if (data) registerFile(data as ApprovalFile);
    return (data as ApprovalFile | null) || null;
  };

  const ensureFile = async (
    attachment: TaskAttachment,
    row: Record<string, unknown>,
    expectedParentId: string | null,
  ) => {
    let file = cachedFileForAttachment(attachment);
    let inserted = false;

    if (!file) {
      const { data, error } = await (supabase as any)
        .from("files")
        .insert(row)
        .select("id")
        .single();

      if (error) {
        file = await fetchExistingFile(attachment);
        if (!file) throw error;
      } else {
        file = {
          ...row,
          id: data.id,
          agency_approval_status: "not_requested",
          approval_status: "none",
          archived_at: null,
          client_id: project.client_id,
          file_url: attachment.file_url,
          locked_at: null,
          parent_file_id: expectedParentId,
          project_id: projectId,
          storage_bucket: (row.storage_bucket as string | null) || null,
          storage_path: (row.storage_path as string | null) || null,
          visibility: "internal",
        } as ApprovalFile;
        registerFile(file);
        inserted = true;
      }
    }

    if (
      file.client_id !== project.client_id
      || file.project_id !== projectId
      || (file.parent_file_id || null) !== expectedParentId
      || file.archived_at
    ) {
      throw new Error(`O anexo "${attachment.file_name}" já está vinculado a outra entrega.`);
    }

    if (inserted) insertedCount += 1;
    return file;
  };

  const addReviewFile = (file: ApprovalFile) => {
    reviewFiles.set(file.id, file);
  };

  const rootForFile = (file: ApprovalFile) =>
    file.parent_file_id ? filesById.get(file.parent_file_id) || null : file;
  const canRequestReview = (file: ApprovalFile) =>
    !file.locked_at
    && file.visibility === "internal"
    && (file.agency_approval_status || "not_requested") === "not_requested"
    && (file.approval_status || "none") === "none";

  const existingImageRoots = imageAttachments
    .map(cachedFileForAttachment)
    .filter((file): file is ApprovalFile => !!file)
    .map(rootForFile)
    .filter((file): file is ApprovalFile => !!file);
  existingImageRoots.forEach(addReviewFile);

  const recoverableCarouselRoot = existingImageRoots.find(canRequestReview) || null;
  const newImageAttachments = imageAttachments.filter(
    (attachment) => !cachedFileForAttachment(attachment)
  );

  if (recoverableCarouselRoot) {
    for (const attachment of newImageAttachments) {
      const index = imageAttachments.indexOf(attachment);
      await ensureFile(
        attachment,
        {
          ...secureFields(attachment),
          client_id: project.client_id,
          file_name: buildGraphicName(taskTitle, attachment.file_name, index + 1, imageAttachments.length),
          file_type: "creative",
          file_url: attachment.file_url,
          folder: "materiais",
          parent_file_id: recoverableCarouselRoot.id,
          project_id: projectId,
          uploaded_by: authorId,
        },
        recoverableCarouselRoot.id,
      );
    }
  } else if (newImageAttachments.length > 1) {
    const parentAttachment = newImageAttachments[0];
    const parentFile = await ensureFile(
      parentAttachment,
      {
        ...secureFields(parentAttachment),
        caption: `Carrossel — ${taskTitle}`,
        client_id: project.client_id,
        description: `Gerado automaticamente da tarefa "${taskTitle}"`,
        file_name: buildGraphicName(taskTitle, parentAttachment.file_name),
        file_type: "creative",
        file_url: parentAttachment.file_url,
        folder: "materiais",
        project_id: projectId,
        uploaded_by: authorId,
      },
      null,
    );
    addReviewFile(parentFile);

    for (const [index, attachment] of newImageAttachments.slice(1).entries()) {
      await ensureFile(
        attachment,
        {
          ...secureFields(attachment),
          client_id: project.client_id,
          file_name: buildGraphicName(taskTitle, attachment.file_name, index + 2, newImageAttachments.length),
          file_type: "creative",
          file_url: attachment.file_url,
          folder: "materiais",
          parent_file_id: parentFile.id,
          project_id: projectId,
          uploaded_by: authorId,
        },
        parentFile.id,
      );
    }
  }

  const standaloneGraphicAttachments =
    !recoverableCarouselRoot && newImageAttachments.length === 1
    ? [newImageAttachments[0], ...nonImageGraphicAttachments]
    : nonImageGraphicAttachments;

  for (const attachment of standaloneGraphicAttachments) {
    const file = await ensureFile(
      attachment,
      {
        ...secureFields(attachment),
        client_id: project.client_id,
        description: `Gerado automaticamente da tarefa "${taskTitle}"`,
        file_name: buildGraphicName(taskTitle, attachment.file_name),
        file_type: isImageAsset(attachment.file_name, attachment.file_url) ? "creative" : "video",
        file_url: attachment.file_url,
        folder: "materiais",
        project_id: projectId,
        uploaded_by: authorId,
      },
      null,
    );
    addReviewFile(file);
  }

  for (const attachment of otherAttachments) {
    const file = await ensureFile(
      attachment,
      {
        ...secureFields(attachment),
        client_id: project.client_id,
        description: `Gerado automaticamente da tarefa "${taskTitle}"`,
        file_name: attachment.file_name,
        file_type: attachment.file_type || "documento",
        file_url: attachment.file_url,
        folder: "operacionais",
        project_id: projectId,
        uploaded_by: authorId,
      },
      null,
    );
    addReviewFile(file);
  }

  const approvalLabel =
    graphicAttachments.length > 1
      ? (imageAttachments.length > 1 ? "Carrossel" : "Arquivos")
      : graphicAttachments.length === 1
        ? "Arte"
        : otherAttachments.length > 1
          ? "Arquivos"
          : "Arquivo";

  let requestedReviewCount = 0;
  for (const file of reviewFiles.values()) {
    const agencyStatus = file.agency_approval_status || "not_requested";
    if (agencyStatus !== "not_requested") continue;
    if (
      file.locked_at
      || file.visibility !== "internal"
      || (file.approval_status || "none") !== "none"
    ) {
      throw new Error(`O arquivo "${file.file_url}" não pode mais entrar em revisão.`);
    }
    const { error } = await (supabase as any).rpc("request_file_agency_review", {
      p_file_id: file.id,
    });
    if (error) throw error;
    requestedReviewCount += 1;
  }

  if (requestedReviewCount > 0) {
    const { error: updateError } = await supabase.from("updates").insert({
      author_id: authorId,
      client_visible: false,
      message: `${approvalLabel} da tarefa "${taskTitle}" enviado para revisão interna`,
      project_id: projectId,
      update_type: "delivery",
    });
    if (updateError) throw updateError;
  }

  return { insertedCount };
}
