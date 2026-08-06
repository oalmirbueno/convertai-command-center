import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  buildPageMeta,
  compareCalendarEntries,
  contentTypeForEditorialFormat,
  deliveryTypesForEditorialFormat,
  EDITORIAL_CONTENT_TYPE_VALUES,
  EDITORIAL_DELIVERY_TYPE_VALUES,
  EDITORIAL_PRODUCTION_STATUS_VALUES,
  EDITORIAL_PUBLICATION_STATUS_VALUES,
  EDITORIAL_TASK_STATUS_VALUES,
  isValidIsoDate,
  nextIsoDate,
  orderEditorialFiles,
  publicationRangeBoundary,
  type EditorialDeliveryType,
  type EditorialFileQueryRow,
} from "../editorial";
import {
  mcpScopeAllowsClient,
  resolveMcpClientScope,
} from "../client-scope";
import { requireAuth, supabaseForUser } from "../supabase";

const PAGE_SIZE = 500;
const ID_CHUNK_SIZE = 100;

const TASK_FIELDS = [
  "id",
  "project_id",
  "title",
  "description",
  "status",
  "priority",
  "due_date",
  "assigned_to",
  "workstream",
  "delivery_type",
  "source",
  "created_at",
  "updated_at",
].join(", ");

const POST_FIELDS = [
  "id",
  "client_id",
  "project_id",
  "primary_file_id",
  "title",
  "content_type",
  "objective",
  "default_caption",
  "production_status",
  "version",
  "created_at",
  "updated_at",
].join(", ");

const PUBLICATION_FIELDS = [
  "id",
  "post_id",
  "client_id",
  "project_id",
  "external_account_id",
  "file_id",
  "platform",
  "caption",
  "first_comment",
  "alt_text",
  "scheduled_at",
  "scheduled_timezone",
  "status",
  "published_at",
  "permalink",
  "version",
  "created_at",
  "updated_at",
].join(", ");

const ACCOUNT_FIELDS = [
  "id",
  "client_id",
  "platform",
  "display_name",
  "handle",
  "status",
].join(", ");

// storage_path is used only to recover the approved carousel order. The
// whitelist in orderEditorialFiles removes it before the MCP response.
const FILE_QUERY_FIELDS = [
  "id",
  "client_id",
  "project_id",
  "file_name",
  "file_type",
  "mime_type",
  "extension",
  "file_url",
  "size_bytes",
  "caption",
  "carousel_text",
  "description",
  "approval_status",
  "visibility",
  "status",
  "archived_at",
  "parent_file_id",
  "storage_path",
  "created_at",
  "updated_at",
].join(", ");

type DbError = { code?: string; message?: string } | null;
type PageResult<T> = { data: T[] | null; error: DbError };

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  workstream: string;
  delivery_type: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  projects?: { client_id: string } | Array<{ client_id: string }>;
};

type PostRow = {
  id: string;
  client_id: string;
  project_id: string;
  primary_file_id: string | null;
  title: string;
  content_type: string;
  objective: string | null;
  default_caption: string | null;
  production_status: string;
  version: number;
  created_at: string;
  updated_at: string;
  filter_publications?: Array<{ id: string }>;
};

type PublicationRow = {
  id: string;
  post_id: string;
  client_id: string;
  project_id: string;
  external_account_id: string;
  file_id: string | null;
  platform: string;
  caption: string | null;
  first_comment: string | null;
  alt_text: string | null;
  scheduled_at: string | null;
  scheduled_timezone: string;
  status: string;
  published_at: string | null;
  permalink: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type AccountRow = {
  id: string;
  client_id: string;
  platform: string;
  display_name: string;
  handle: string | null;
  status: string;
};

type PostTaskLinkRow = {
  post_id: string;
  task_id: string | null;
};

type PublicationScheduleRow = {
  id: string;
  post_id: string;
  scheduled_at: string | null;
};

type CalendarEntry =
  | {
      kind: "task";
      id: string;
      calendar_at: string | null;
      updated_at: string;
      task: TaskRow;
    }
  | {
      kind: "post";
      id: string;
      calendar_at: string | null;
      updated_at: string;
      post: PostRow;
    };

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter(Boolean) as string[])];
}

function safeDatabaseError(resource: string, error: DbError) {
  const reference = error?.code ? ` (${error.code})` : "";
  return {
    content: [{
      type: "text" as const,
      text: `Não foi possível consultar ${resource} com o acesso atual${reference}.`,
    }],
    isError: true as const,
  };
}

async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ rows: T[]; error: DbError }> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) return { rows: [], error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, error: null };
    from += PAGE_SIZE;
  }
}

async function readInChunks<T>(
  ids: string[],
  fetchChunk: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<PageResult<T>>,
): Promise<{ rows: T[]; error: DbError }> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + ID_CHUNK_SIZE);
    const pageResult = await readAllPages<T>((from, to) => (
      fetchChunk(chunk, from, to)
    ));
    if (pageResult.error) return { rows: [], error: pageResult.error };
    rows.push(...pageResult.rows);
  }
  return { rows, error: null };
}

function stripTaskRelation(row: TaskRow): TaskRow {
  const { projects: _projects, ...task } = row;
  return task;
}

function stripPostFilter(row: PostRow): PostRow {
  const { filter_publications: _filter, ...post } = row;
  return post;
}

function safePublication(row: PublicationRow, account: AccountRow | null) {
  return {
    id: row.id,
    post_id: row.post_id,
    client_id: row.client_id,
    project_id: row.project_id,
    platform: row.platform,
    caption: row.caption,
    first_comment: row.first_comment,
    alt_text: row.alt_text,
    scheduled_at: row.scheduled_at,
    scheduled_timezone: row.scheduled_timezone,
    status: row.status,
    published_at: row.published_at,
    permalink: row.permalink,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    account,
  };
}

export default defineTool({
  name: "list_editorial_calendar",
  title: "Listar calendário editorial",
  description:
    "Lista somente entregas publicáveis do cliente, em ordem cronológica estável (calendar_at, atualização, tipo e ID), com posts, planos de publicação, conta segura e todos os arquivos ordenados de cada carrossel. Usa a sessão OAuth e respeita RLS.",
  inputSchema: {
    client_id: z.string().uuid().describe("Cliente obrigatório para isolar o calendário."),
    project_id: z.string().uuid().optional().describe("Projeto do mesmo cliente."),
    date_from: z.string().refine(isValidIsoDate).optional()
      .describe("Data inicial inclusiva (YYYY-MM-DD). Com período, posts ainda sem publicação agendada ficam fora."),
    date_to: z.string().refine(isValidIsoDate).optional()
      .describe("Data final inclusiva (YYYY-MM-DD). Com período, posts ainda sem publicação agendada ficam fora."),
    format: z.enum(EDITORIAL_DELIVERY_TYPE_VALUES).optional()
      .describe("Formato publicável. design e static representam arte estática."),
    status: z.enum(EDITORIAL_TASK_STATUS_VALUES).optional()
      .describe("Status das tarefas publicáveis ainda sem post."),
    production_status: z.enum(EDITORIAL_PRODUCTION_STATUS_VALUES).optional()
      .describe("Etapa dos posts; quando informado, tarefas sem post ficam fora."),
    publication_status: z.enum(EDITORIAL_PUBLICATION_STATUS_VALUES).optional()
      .describe("Status das publicações; quando informado, tarefas sem post ficam fora."),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (input, ctx) => {
    const guard = requireAuth(ctx);
    if (guard) return guard;

    if (input.date_from && input.date_to && input.date_from > input.date_to) {
      return {
        content: [{
          type: "text",
          text: "date_from deve ser anterior ou igual a date_to.",
        }],
        isError: true,
      };
    }

    const sb = supabaseForUser(ctx);
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    const scopeResult = await resolveMcpClientScope(sb, ctx.getUserId());
    if (scopeResult.error) {
      return safeDatabaseError("os clientes autorizados", scopeResult.error);
    }
    if (!mcpScopeAllowsClient(scopeResult.scope, input.client_id)) {
      return {
        content: [{
          type: "text",
          text: "Cliente não encontrado no acesso editorial atual.",
        }],
        isError: true,
      };
    }

    if (input.project_id) {
      const { data: project, error: projectError } = await sb
        .from("projects")
        .select("id")
        .eq("id", input.project_id)
        .eq("client_id", input.client_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (projectError) return safeDatabaseError("o projeto", projectError);
      if (!project) {
        return {
          content: [{
            type: "text",
            text: "Projeto não encontrado neste cliente ou sem acesso pela sessão atual.",
          }],
          isError: true,
        };
      }
    }

    const hasPublicationFilter = Boolean(
      input.publication_status || input.date_from || input.date_to,
    );
    const postSelect = hasPublicationFilter
      ? `${POST_FIELDS}, filter_publications:editorial_publications!inner(id)`
      : POST_FIELDS;

    const includeTasks = !input.production_status && !input.publication_status;
    const taskRequest = includeTasks
      ? readAllPages<TaskRow>((from, to) => {
        let query = sb
          .from("tasks")
          .select(`${TASK_FIELDS}, projects!inner(client_id)`)
          .eq("projects.client_id", input.client_id)
          .is("deleted_at", null)
          .in("delivery_type", [...EDITORIAL_DELIVERY_TYPE_VALUES])
          .not("status", "in", "(done,archived,cancelled)")
          .or(
            "source.is.null,and(source.not.ilike.client_request,source.not.ilike.client_request:*)",
          );
        if (input.project_id) {
          query = query.eq("project_id", input.project_id);
        }
        if (input.date_from) query = query.gte("due_date", input.date_from);
        if (input.date_to) query = query.lte("due_date", input.date_to);
        if (input.status) query = query.eq("status", input.status);
        if (input.format) {
          query = query.in(
            "delivery_type",
            deliveryTypesForEditorialFormat(
              input.format as EditorialDeliveryType,
            ),
          );
        }
        return query
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<TaskRow>>;
      })
      : Promise.resolve({ rows: [] as TaskRow[], error: null });

    const [taskResult, postResult] = await Promise.all([
      taskRequest,
      readAllPages<PostRow>((from, to) => {
        let query = sb
          .from("editorial_posts")
          .select(postSelect)
          .eq("client_id", input.client_id)
          .is("archived_at", null)
          .in("content_type", [...EDITORIAL_CONTENT_TYPE_VALUES]);
        if (input.project_id) {
          query = query.eq("project_id", input.project_id);
        }
        if (input.format) {
          query = query.eq(
            "content_type",
            contentTypeForEditorialFormat(
              input.format as EditorialDeliveryType,
            ),
          );
        }
        if (input.production_status) {
          query = query.eq("production_status", input.production_status);
        } else {
          query = query.in("production_status", [
            "draft",
            "production",
            "ready",
          ]);
        }
        if (input.publication_status) {
          query = query.eq(
            "filter_publications.status",
            input.publication_status,
          );
        }
        if (input.date_from) {
          query = query.gte(
            "filter_publications.scheduled_at",
            publicationRangeBoundary(input.date_from),
          );
        }
        if (input.date_to) {
          query = query.lt(
            "filter_publications.scheduled_at",
            publicationRangeBoundary(nextIsoDate(input.date_to)),
          );
        }
        return query
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<PostRow>>;
      }),
    ]);
    if (taskResult.error) {
      return safeDatabaseError("as tarefas editoriais", taskResult.error);
    }
    if (postResult.error) {
      return safeDatabaseError("os conteúdos editoriais", postResult.error);
    }

    const taskRows = taskResult.rows.map(stripTaskRelation);
    const postRows = postResult.rows.map(stripPostFilter);
    const activePostIds = postRows
      .filter((post) => ["draft", "production", "ready"].includes(
        post.production_status,
      ))
      .map((post) => post.id);
    const [
      visiblePostLinkResult,
      taskLinkCandidateResult,
      publicationScheduleResult,
    ] = await Promise.all([
      readInChunks<PostTaskLinkRow>(activePostIds, (chunk, from, to) => (
        sb
          .from("editorial_post_internal")
          .select("post_id, task_id")
          .in("post_id", chunk)
          .not("task_id", "is", null)
          .order("post_id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<
            PageResult<PostTaskLinkRow>
          >
      )),
      readInChunks<PostTaskLinkRow>(
        taskRows.map((task) => task.id),
        (chunk, from, to) => (
          sb
            .from("editorial_post_internal")
            .select("post_id, task_id")
            .in("task_id", chunk)
            .order("post_id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<
              PageResult<PostTaskLinkRow>
            >
        ),
      ),
      readInChunks<PublicationScheduleRow>(
        postRows.map((post) => post.id),
        (chunk, from, to) => {
          let query = sb
            .from("editorial_publications")
            .select("id, post_id, scheduled_at")
            .eq("client_id", input.client_id)
            .in("post_id", chunk);
          if (input.project_id) {
            query = query.eq("project_id", input.project_id);
          }
          if (input.publication_status) {
            query = query.eq("status", input.publication_status);
          }
          if (input.date_from) {
            query = query.gte(
              "scheduled_at",
              publicationRangeBoundary(input.date_from),
            );
          }
          if (input.date_to) {
            query = query.lt(
              "scheduled_at",
              publicationRangeBoundary(nextIsoDate(input.date_to)),
            );
          }
          return query
            .order("post_id", { ascending: true })
            .order("scheduled_at", { ascending: true, nullsFirst: false })
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<
              PageResult<PublicationScheduleRow>
            >;
        },
      ),
    ]);
    if (
      visiblePostLinkResult.error
      || taskLinkCandidateResult.error
      || publicationScheduleResult.error
    ) {
      return safeDatabaseError(
        "os vínculos e datas editoriais",
        visiblePostLinkResult.error
          ?? taskLinkCandidateResult.error
          ?? publicationScheduleResult.error,
      );
    }
    const candidateLinkedPostIds = unique(
      taskLinkCandidateResult.rows.map((link) => link.post_id),
    );
    const activeLinkedPostResult = await readInChunks<{ id: string }>(
      candidateLinkedPostIds,
      (chunk, from, to) => {
        let query = sb
          .from("editorial_posts")
          .select("id")
          .eq("client_id", input.client_id)
          .in("id", chunk)
          .in("production_status", ["draft", "production", "ready"])
          .is("archived_at", null);
        if (input.project_id) {
          query = query.eq("project_id", input.project_id);
        }
        return query
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<
            PageResult<{ id: string }>
          >;
      },
    );
    if (activeLinkedPostResult.error) {
      return safeDatabaseError(
        "o estado dos conteúdos vinculados",
        activeLinkedPostResult.error,
      );
    }
    const activeLinkedPostIds = new Set(
      activeLinkedPostResult.rows.map((post) => post.id),
    );
    const taskIdByPostId = new Map(
      visiblePostLinkResult.rows.map((link) => [link.post_id, link.task_id]),
    );
    const linkedTaskIds = new Set(
      taskLinkCandidateResult.rows.flatMap((link) => (
        link.task_id && activeLinkedPostIds.has(link.post_id)
          ? [link.task_id]
          : []
      )),
    );
    const unlinkedTaskRows = taskRows.filter((task) => (
      !linkedTaskIds.has(task.id)
    ));
    const calendarAtByPostId = new Map<string, string>();
    publicationScheduleResult.rows.forEach((publication) => {
      if (!publication.scheduled_at) return;
      const current = calendarAtByPostId.get(publication.post_id);
      if (!current || publication.scheduled_at < current) {
        calendarAtByPostId.set(publication.post_id, publication.scheduled_at);
      }
    });
    const total = unlinkedTaskRows.length + postRows.length;
    const entries: CalendarEntry[] = [
      ...unlinkedTaskRows.map((task): CalendarEntry => ({
        kind: "task",
        id: task.id,
        calendar_at: task.due_date,
        updated_at: task.updated_at,
        task,
      })),
      ...postRows.map((post): CalendarEntry => ({
        kind: "post",
        id: post.id,
        calendar_at: calendarAtByPostId.get(post.id) ?? null,
        updated_at: post.updated_at,
        post,
      })),
    ];
    const selectedEntries = entries
      .sort(compareCalendarEntries)
      .slice(offset, offset + limit);
    const selectedPosts = selectedEntries.flatMap((entry) => (
      entry.kind === "post" ? [entry.post] : []
    ));
    const selectedPostIds = selectedPosts.map((post) => post.id);

    let publications: PublicationRow[] = [];
    if (selectedPostIds.length > 0) {
      const publicationResult = await readInChunks<PublicationRow>(
        selectedPostIds,
        (chunk, from, to) => {
          let query = sb
            .from("editorial_publications")
            .select(PUBLICATION_FIELDS)
            .eq("client_id", input.client_id)
            .in("post_id", chunk);
          if (input.project_id) {
            query = query.eq("project_id", input.project_id);
          }
          if (input.publication_status) {
            query = query.eq("status", input.publication_status);
          }
          if (input.date_from) {
            query = query.gte(
              "scheduled_at",
              publicationRangeBoundary(input.date_from),
            );
          }
          if (input.date_to) {
            query = query.lt(
              "scheduled_at",
              publicationRangeBoundary(nextIsoDate(input.date_to)),
            );
          }
          return query
            .order("scheduled_at", { ascending: true, nullsFirst: false })
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<
              PageResult<PublicationRow>
            >;
        },
      );
      if (publicationResult.error) {
        return safeDatabaseError(
          "os planos de publicação",
          publicationResult.error,
        );
      }
      publications = publicationResult.rows;
    }

    const accountIds = unique(
      publications.map((publication) => publication.external_account_id),
    );
    const rootFileIds = unique([
      ...selectedPosts.map((post) => post.primary_file_id),
      ...publications.map((publication) => publication.file_id),
    ]);

    const [accountResult, rootFileResult, childFileResult] = await Promise.all([
      readInChunks<AccountRow>(accountIds, (chunk, from, to) => (
        sb
          .from("external_accounts")
          .select(ACCOUNT_FIELDS)
          .eq("client_id", input.client_id)
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<AccountRow>>
      )),
      readInChunks<EditorialFileQueryRow>(
        rootFileIds,
        (chunk, from, to) => {
          let query = sb
            .from("files")
            .select(FILE_QUERY_FIELDS)
            .eq("client_id", input.client_id)
            .in("id", chunk)
            .is("archived_at", null);
          if (input.project_id) query = query.eq("project_id", input.project_id);
          return query
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<
              PageResult<EditorialFileQueryRow>
            >;
        },
      ),
      readInChunks<EditorialFileQueryRow>(
        rootFileIds,
        (chunk, from, to) => {
          let query = sb
            .from("files")
            .select(FILE_QUERY_FIELDS)
            .eq("client_id", input.client_id)
            .in("parent_file_id", chunk)
            .is("archived_at", null);
          if (input.project_id) query = query.eq("project_id", input.project_id);
          return query
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<
              PageResult<EditorialFileQueryRow>
            >;
        },
      ),
    ]);
    if (accountResult.error) {
      return safeDatabaseError("as contas de publicação", accountResult.error);
    }
    if (rootFileResult.error || childFileResult.error) {
      return safeDatabaseError(
        "os arquivos editoriais",
        rootFileResult.error ?? childFileResult.error,
      );
    }

    const accountById = new Map(
      accountResult.rows.map((account) => [account.id, account]),
    );
    const rootFileById = new Map(
      rootFileResult.rows.map((file) => [file.id, file]),
    );
    const childrenByRootId = new Map<string, EditorialFileQueryRow[]>();
    childFileResult.rows.forEach((file) => {
      if (!file.parent_file_id) return;
      const current = childrenByRootId.get(file.parent_file_id) ?? [];
      current.push(file);
      childrenByRootId.set(file.parent_file_id, current);
    });
    const publicationsByPostId = new Map<string, PublicationRow[]>();
    publications.forEach((publication) => {
      const current = publicationsByPostId.get(publication.post_id) ?? [];
      current.push(publication);
      publicationsByPostId.set(publication.post_id, current);
    });

    const mediaFor = (rootId: string | null | undefined) => {
      if (!rootId) return null;
      const root = rootFileById.get(rootId);
      if (!root) return null;
      return {
        root_id: root.id,
        files: orderEditorialFiles(root, childrenByRootId.get(root.id) ?? []),
      };
    };

    const items = selectedEntries.map((entry) => {
      if (entry.kind === "task") {
        return {
          kind: "task" as const,
          calendar_at: entry.calendar_at,
          task: { ...entry.task, client_id: input.client_id },
        };
      }
      const postPublications = publicationsByPostId.get(entry.post.id) ?? [];
      return {
        kind: "post" as const,
        calendar_at: entry.calendar_at,
        linked_task_id: taskIdByPostId.get(entry.post.id) ?? null,
        post: entry.post,
        media: mediaFor(entry.post.primary_file_id),
        publications: postPublications.map((publication) => ({
          ...safePublication(
            publication,
            accountById.get(publication.external_account_id) ?? null,
          ),
          media: mediaFor(
            publication.file_id ?? entry.post.primary_file_id,
          ),
        })),
      };
    });

    const meta = {
      ...buildPageMeta(total, items.length, offset, limit),
      ordering: "calendar_at_asc_nulls_last,updated_at_desc,kind_asc,id_asc",
    };
    return {
      content: [{
        type: "text",
        text: `${items.length} de ${total} itens editoriais.`,
      }],
      structuredContent: {
        client_id: input.client_id,
        project_id: input.project_id ?? null,
        items,
        meta,
      },
    };
  },
});
