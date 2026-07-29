import { useEffect } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  EDITORIAL_PLATFORMS,
  isFilePublishable,
} from "@/lib/editorial";
import {
  buildEditorialTaskLinkIndex,
  type EditorialTaskLinkIndex,
  type EditorialTaskLinkRow,
} from "@/lib/editorialTaskLinks";

// The generated Database type is updated only after this unapplied migration
// reaches a Supabase branch. Keep the escape hatch local to the new schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const editorialDb = supabase as any;

export interface EditorialPostRow {
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
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EditorialPostInternalRow {
  post_id: string;
  client_id: string;
  task_id: string | null;
  responsible_id: string | null;
  revision_of_post_id: string | null;
  internal_notes: string | null;
  idempotency_key: string;
  last_mutation_id: string | null;
  last_mutation_fingerprint: string | null;
  approval_fingerprint: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface EditorialPublicationRow {
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
  external_post_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface EditorialPublicationInternalRow {
  publication_id: string;
  client_id: string;
  idempotency_key: string;
  included_in_approval_snapshot: boolean;
  failure_code: string | null;
  failure_reason: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  created_by: string;
  updated_by: string;
  scheduled_by: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EditorialAccountRow {
  id: string;
  client_id: string;
  platform: string;
  display_name: string;
  handle: string | null;
  status: string;
}

export interface EditorialFileRow {
  id: string;
  client_id: string;
  project_id: string | null;
  file_name: string;
  file_type?: string | null;
  mime_type?: string | null;
  approval_status: string;
  agency_approval_status?: string;
  visibility: string;
  locked_at: string | null;
  status: string | null;
  archived_at: string | null;
  parent_file_id: string | null;
}

export interface EditorialEventRow {
  id: string;
  client_id: string;
  post_id: string;
  publication_id: string | null;
  actor_id: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_name?: string | null;
}

export interface EditorialPublicationBundle {
  publication: EditorialPublicationRow;
  internal: EditorialPublicationInternalRow | null;
  account: EditorialAccountRow | null;
  file: EditorialFileRow | null;
}

export interface EditorialPostBundle {
  post: EditorialPostRow;
  internal: EditorialPostInternalRow | null;
  primaryFile: EditorialFileRow | null;
  publications: EditorialPublicationBundle[];
  publicationSetComplete: boolean;
}

export interface EditorialCalendarFilters {
  clientId?: string;
  projectId?: string;
  platform?: string;
  rangeStart?: string;
  rangeEnd?: string;
  postId?: string;
}

export interface SaveEditorialPostInput {
  payload: Record<string, unknown>;
  expectedVersion?: number | null;
}

export interface TransitionEditorialPublicationInput {
  publicationId: string;
  action: "schedule" | "publish" | "fail" | "cancel" | "reopen";
  expectedVersion: number;
  scheduledAt?: string | null;
  timezone?: string | null;
  permalink?: string | null;
  externalPostId?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  publishedAt?: string | null;
}

interface EditorialQueryResult {
  posts: EditorialPostBundle[];
  accounts: EditorialAccountRow[];
}

export function useEditorialClientScope(enabled: boolean) {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const isEditorialStaff = ["admin", "manager", "design", "traffic"].includes(
    profile?.role || "",
  );

  return useQuery({
    queryKey: ["editorial-client-scope", user?.id, profile?.role],
    queryFn: async (): Promise<string[] | null> => {
      if (isAdmin) return null;
      const rows = await readAllPages<{ client_id: string }>((from, to) =>
        editorialDb
          .from("team_client_assignments")
          .select("client_id")
          .eq("user_id", user!.id)
          .order("client_id", { ascending: true })
          .range(from, to),
      );
      return unique(rows.map((row) => row.client_id));
    },
    enabled: enabled && !!user && isEditorialStaff,
    refetchInterval: 30_000,
  });
}

export function useEditorialLinkedTaskIds(enabled: boolean) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const isEditorialStaff = ["admin", "manager", "design", "traffic"].includes(
    profile?.role || "",
  );

  const query = useQuery({
    queryKey: ["editorial-linked-task-ids", user?.id, profile?.role],
    queryFn: async (): Promise<EditorialTaskLinkIndex> => {
      const links = await readAllPages<EditorialTaskLinkRow>(
        (from, to) =>
          editorialDb
            .from("editorial_post_internal")
            .select("post_id, task_id, revision_of_post_id")
            .not("task_id", "is", null)
            .order("task_id", { ascending: true })
            .range(from, to),
      );
      const postIds = unique(links.map((row) => row.post_id));
      if (postIds.length === 0) {
        return { taskIds: [], postIdByTaskId: {} };
      }

      const activePosts = await readInChunks<{ id: string }>(
        postIds,
        (chunk, from, to) =>
          editorialDb
            .from("editorial_posts")
            .select("id")
            .in("id", chunk)
            .in("production_status", ["draft", "production", "ready"])
            .is("archived_at", null)
            .order("id", { ascending: true })
            .range(from, to),
      );
      const activePostIds = new Set(activePosts.map((post) => post.id));
      return buildEditorialTaskLinkIndex(links, activePostIds);
    },
    enabled: enabled && !!user && isEditorialStaff,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!enabled || !user || !isEditorialStaff) return;

    const refreshTasks = () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({
        queryKey: ["editorial-linked-task-ids"],
      });
    };
    const channel = supabase
      .channel(`editorial-task-links:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        refreshTasks,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "editorial_posts" },
        refreshTasks,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, isEditorialStaff, queryClient, user]);

  return query;
}

export interface EditorialApprovalPreviewPlan {
  platform: string;
  account_name: string | null;
  account_handle: string | null;
  caption: string | null;
  first_comment: string | null;
  alt_text: string | null;
}

export interface EditorialApprovalPreviewRow {
  post_id: string;
  title: string;
  content_type: string;
  objective: string | null;
  default_caption: string | null;
  plans: EditorialApprovalPreviewPlan[];
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter(Boolean) as string[])];
}

const EDITORIAL_PAGE_SIZE = 500;
const EDITORIAL_ID_CHUNK_SIZE = 100;

interface EditorialPage<T> {
  data: T[] | null;
  error: unknown;
}

async function readAllPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<EditorialPage<T>>,
) {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await fetchPage(
      from,
      from + EDITORIAL_PAGE_SIZE - 1,
    );
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < EDITORIAL_PAGE_SIZE) return rows;
    from += EDITORIAL_PAGE_SIZE;
  }
}

async function readInChunks<T>(
  ids: string[],
  fetchChunk: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<EditorialPage<T>>,
) {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += EDITORIAL_ID_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + EDITORIAL_ID_CHUNK_SIZE);
    rows.push(
      ...(await readAllPages((from, to) =>
        fetchChunk(chunk, from, to),
      )),
    );
  }
  return rows;
}

async function readEditorialCalendar(
  filters: EditorialCalendarFilters,
  actualStaff: boolean,
  exposeInternal: boolean,
  forceClientView: boolean,
): Promise<EditorialQueryResult> {
  const loadInternal =
    exposeInternal || (actualStaff && forceClientView);
  const posts = await readAllPages<EditorialPostRow>((from, to) => {
    let query = editorialDb
      .from("editorial_posts")
      .select("*")
      .is("archived_at", null);

    if (filters.clientId) {
      query = query.eq("client_id", filters.clientId);
    }
    if (filters.projectId) {
      query = query.eq("project_id", filters.projectId);
    }
    if (filters.postId) {
      query = query.eq("id", filters.postId);
    }

    return query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
  });
  const postIds = posts.map((post) => post.id);
  if (postIds.length === 0) return { posts: [], accounts: [] };
  const postIdSet = new Set(postIds);

  const publicationRows = await readAllPages<EditorialPublicationRow>(
    (from, to) => {
      let query = editorialDb
        .from("editorial_publications")
        .select("*");

      if (filters.clientId) {
        query = query.eq("client_id", filters.clientId);
      }
      if (filters.projectId) {
        query = query.eq("project_id", filters.projectId);
      }
      if (filters.postId) {
        query = query.eq("post_id", filters.postId);
      }
      if (filters.platform) {
        query = query.eq("platform", filters.platform);
      }
      if (forceClientView) {
        query = query.in("status", ["scheduled", "published"]);
      }
      if (filters.rangeStart && filters.rangeEnd) {
        query = query.or(
          `scheduled_at.is.null,and(scheduled_at.gte.${filters.rangeStart},scheduled_at.lt.${filters.rangeEnd})`,
        );
      }

      return query
        .order("scheduled_at", {
          ascending: true,
          nullsFirst: false,
        })
        .order("id", { ascending: true })
        .range(from, to);
    },
  );
  const publications = publicationRows.filter((publication) =>
    postIdSet.has(publication.post_id),
  );
  const hasPeriodFilter =
    Boolean(filters.rangeStart && filters.rangeEnd) && !filters.postId;
  let postIdsWithAnyRelevantPublications = new Set<string>();

  if (hasPeriodFilter) {
    const presenceRows = await readAllPages<{
      id: string;
      post_id: string;
    }>(
      (from, to) => {
        let query = editorialDb
          .from("editorial_publications")
          .select("id, post_id");

        if (filters.clientId) {
          query = query.eq("client_id", filters.clientId);
        }
        if (filters.projectId) {
          query = query.eq("project_id", filters.projectId);
        }
        if (filters.postId) {
          query = query.eq("post_id", filters.postId);
        }
        if (filters.platform) {
          query = query.eq("platform", filters.platform);
        }
        if (forceClientView) {
          query = query.in("status", ["scheduled", "published"]);
        }

        return query
          .order("post_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
      },
    );
    postIdsWithAnyRelevantPublications = new Set(
      presenceRows
        .map((row) => row.post_id)
        .filter((postId) => postIdSet.has(postId)),
    );
  }
  const accountIds = unique(
    publications.map((publication) => publication.external_account_id),
  );
  const fileIds = unique([
    ...posts.map((post) => post.primary_file_id),
    ...publications.map((publication) => publication.file_id),
  ]);

  const [postInternalRows, publicationInternalRows, accountRows, fileRows] =
    await Promise.all([
    loadInternal
      ? readInChunks<EditorialPostInternalRow>(
          postIds,
          (chunk, from, to) =>
            editorialDb
              .from("editorial_post_internal")
              .select("*")
              .in("post_id", chunk)
              .order("post_id", { ascending: true })
              .range(from, to),
        )
      : Promise.resolve([]),
    loadInternal && publications.length > 0
      ? readInChunks<EditorialPublicationInternalRow>(
          publications.map((publication) => publication.id),
          (chunk, from, to) =>
            editorialDb
              .from("editorial_publication_internal")
              .select("*")
              .in("publication_id", chunk)
              .order("publication_id", { ascending: true })
              .range(from, to),
        )
      : Promise.resolve([]),
    accountIds.length > 0
      ? readInChunks<EditorialAccountRow>(
          accountIds,
          (chunk, from, to) =>
            editorialDb
              .from("external_accounts")
              .select(
                "id, client_id, platform, display_name, handle, status",
              )
              .in("id", chunk)
              .order("id", { ascending: true })
              .range(from, to),
        )
      : Promise.resolve([]),
    fileIds.length > 0
      ? readInChunks<EditorialFileRow>(
          fileIds,
          (chunk, from, to) =>
            editorialDb
              .from(actualStaff ? "staff_files_secure" : "files")
              .select(
                actualStaff
                  ? "id, client_id, project_id, file_name, file_type, mime_type, approval_status, agency_approval_status, visibility, locked_at, status, archived_at, parent_file_id"
                  : "id, client_id, project_id, file_name, file_type, mime_type, approval_status, visibility, locked_at, status, archived_at, parent_file_id",
              )
              .in("id", chunk)
              .order("id", { ascending: true })
              .range(from, to),
        )
      : Promise.resolve([]),
  ]);

  const postInternalById = new Map(
    postInternalRows.map((row) => [row.post_id, row]),
  );
  const publicationInternalById = new Map(
    publicationInternalRows.map((row) => [row.publication_id, row]),
  );
  const accountById = new Map(
    accountRows.map((row) => [row.id, row]),
  );
  const fileById = new Map(
    fileRows.map((row) => [row.id, row]),
  );
  const publicationsByPostId = new Map<
    string,
    EditorialPublicationRow[]
  >();
  publications.forEach((publication) => {
    const current =
      publicationsByPostId.get(publication.post_id) || [];
    current.push(publication);
    publicationsByPostId.set(publication.post_id, current);
  });

  const publicationSetComplete =
    !forceClientView &&
    !filters.platform &&
    !(filters.rangeStart && filters.rangeEnd);
  let bundledPosts = posts.map((post) => ({
    post,
    internal: postInternalById.get(post.id) || null,
    primaryFile: post.primary_file_id
      ? fileById.get(post.primary_file_id) || null
      : null,
    publications: (publicationsByPostId.get(post.id) || []).map(
      (publication) => ({
        publication,
        internal: publicationInternalById.get(publication.id) || null,
        account:
          accountById.get(publication.external_account_id) || null,
        file: publication.file_id
          ? fileById.get(publication.file_id) || null
          : null,
      }),
    ),
    publicationSetComplete,
  }));

  if (!actualStaff) {
    bundledPosts = bundledPosts.map((bundle) => ({
      ...bundle,
      primaryFile: bundle.primaryFile
        ? {
            ...bundle.primaryFile,
            agency_approval_status: "approved",
          }
        : null,
      publications: bundle.publications.map((publication) => ({
        ...publication,
        file: publication.file
          ? {
              ...publication.file,
              agency_approval_status: "approved",
            }
          : null,
      })),
    }));
  }

  if (forceClientView) {
    bundledPosts = bundledPosts
      .map((bundle) => ({
        ...bundle,
        internal: null,
        publications: bundle.publications.filter(
          ({ publication, internal, file }) => {
            const effectiveFile = publication.file_id
              ? file
              : bundle.primaryFile;
            return (
              ["scheduled", "published"].includes(
                publication.status,
              ) &&
              internal?.included_in_approval_snapshot === true &&
              isFilePublishable(effectiveFile)
            );
          },
        ).map((publication) => ({
          ...publication,
          internal: null,
        })),
      }))
      .filter(
        (bundle) =>
          bundle.post.production_status === "ready" &&
          isFilePublishable(bundle.primaryFile) &&
          postInternalById.get(bundle.post.id)?.approval_fingerprint != null &&
          bundle.publications.length > 0,
      );
  }

  if (hasPeriodFilter) {
    bundledPosts = bundledPosts.filter(
      (bundle) =>
        bundle.publications.length > 0 ||
        (!filters.platform &&
          !postIdsWithAnyRelevantPublications.has(bundle.post.id)),
    );
  }

  return {
    posts: bundledPosts,
    accounts: [...accountById.values()],
  };
}

export async function loadEditorialPostForMutation(
  postId: string,
  clientId: string,
) {
  const result = await readEditorialCalendar(
    { clientId, postId },
    true,
    true,
    false,
  );
  const bundle = result.posts[0];
  if (!bundle || !bundle.publicationSetComplete) {
    throw new Error(
      "Não foi possível carregar o plano editorial completo. Atualize e tente novamente.",
    );
  }
  return bundle;
}

export function useEditorialCalendar(
  filters: EditorialCalendarFilters,
  options: { forceClientView?: boolean } = {},
) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const actualStaff =
    profile?.role === "admin" ||
    ["manager", "design", "traffic"].includes(profile?.role || "");
  const forceClientView = Boolean(options.forceClientView);
  const exposeInternal = actualStaff && !forceClientView;

  const query = useQuery({
    queryKey: [
      "editorial-calendar",
      user?.id,
      profile?.role,
      forceClientView,
      filters,
    ],
    queryFn: () =>
      readEditorialCalendar(
        filters,
        actualStaff,
        exposeInternal,
        forceClientView,
      ),
    placeholderData: keepPreviousData,
    enabled: !!user,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!user) return;

    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
    };
    const channel = supabase
      .channel(`editorial-calendar:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "editorial_posts" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "editorial_publications" },
        refresh,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, user]);

  return query;
}

export function useEditorialPostDetail(
  postId: string | null,
  clientId: string | null,
  options: { forceClientView?: boolean } = {},
) {
  const { user, profile } = useAuth();
  const actualStaff =
    profile?.role === "admin" ||
    ["manager", "design", "traffic"].includes(profile?.role || "");
  const forceClientView = Boolean(options.forceClientView);
  const exposeInternal = actualStaff && !forceClientView;

  return useQuery({
    queryKey: [
      "editorial-calendar",
      "detail",
      user?.id,
      profile?.role,
      forceClientView,
      clientId,
      postId,
    ],
    queryFn: () =>
      readEditorialCalendar(
        {
          clientId: clientId || undefined,
          postId: postId || undefined,
        },
        actualStaff,
        exposeInternal,
        forceClientView,
      ),
    enabled:
      !!user && !!postId && (!forceClientView || !!clientId),
    refetchInterval: 30_000,
  });
}

export function useEditorialPostEvents(postId: string | null, enabled: boolean) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [
      "editorial-events",
      user?.id,
      profile?.role,
      postId,
    ],
    queryFn: async () => {
      const eventRows = await readAllPages<EditorialEventRow>(
        (from, to) =>
          editorialDb
            .from("editorial_events")
            .select("*")
            .eq("post_id", postId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to),
      );
      const actorIds = unique(eventRows.map((event) => event.actor_id));
      const actorRows =
        actorIds.length > 0
          ? await readInChunks<{ id: string; full_name: string | null }>(
              actorIds,
              (chunk, from, to) =>
                editorialDb
                  .from("profiles")
                  .select("id, full_name")
                  .in("id", chunk)
                  .order("id", { ascending: true })
                  .range(from, to),
            )
          : [];
      const actorById = new Map(
        actorRows.map((actor) => [actor.id, actor.full_name]),
      );

      return eventRows.map((event) => ({
        ...event,
        actor_name: event.actor_id
          ? actorById.get(event.actor_id) || null
          : null,
      }));
    },
    enabled: enabled && !!user && !!postId,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!enabled || !user || !postId) return;

    const channel = supabase
      .channel(`editorial-events:${postId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "editorial_events",
          filter: `post_id=eq.${postId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["editorial-events"],
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, postId, queryClient, user]);

  return query;
}

export function useEditorialEditorOptions(
  clientId: string | null,
  projectId: string | null,
  enabled: boolean,
) {
  const { user, profile } = useAuth();
  return useQuery({
    queryKey: [
      "editorial-editor-options",
      user?.id,
      profile?.role,
      clientId,
      projectId,
    ],
    queryFn: async () => {
      if (!clientId || !projectId) {
        return { accounts: [], files: [], tasks: [], assignments: [] };
      }

      const [links, files, tasks, assignments] =
        await Promise.all([
          readAllPages<{ external_account_id: string }>((from, to) =>
            editorialDb
              .from("project_external_accounts")
              .select("external_account_id")
              .eq("client_id", clientId)
              .eq("project_id", projectId)
              .order("external_account_id", { ascending: true })
              .range(from, to),
          ),
          readAllPages<EditorialFileRow>((from, to) =>
            editorialDb
              .from("staff_files_secure")
              .select(
                "id, client_id, project_id, file_name, file_type, mime_type, approval_status, agency_approval_status, visibility, locked_at, status, archived_at, parent_file_id",
              )
              .eq("client_id", clientId)
              .eq("project_id", projectId)
              .is("parent_file_id", null)
              .is("archived_at", null)
              .order("created_at", { ascending: false })
              .order("id", { ascending: true })
              .range(from, to),
          ),
          readAllPages<{
            id: string;
            project_id: string;
            title: string;
            assigned_to: string | null;
            status: string;
            due_date: string | null;
            workstream: string | null;
            delivery_type: string | null;
            source: string | null;
          }>((from, to) =>
            editorialDb
              .from("tasks")
              .select(
                "id, project_id, title, assigned_to, status, due_date, workstream, delivery_type, source",
              )
              .eq("project_id", projectId)
              .is("deleted_at", null)
              .order("updated_at", { ascending: false })
              .order("id", { ascending: true })
              .range(from, to),
          ),
          readAllPages<{ user_id: string }>((from, to) =>
            editorialDb
              .from("team_client_assignments")
              .select("user_id")
              .eq("client_id", clientId)
              .order("user_id", { ascending: true })
              .range(from, to),
          ),
        ]);

      const linkedAccountIds = unique(
        links.map((link) => link.external_account_id),
      );
      let accounts: EditorialAccountRow[] = [];
      if (linkedAccountIds.length > 0) {
        accounts = await readInChunks<EditorialAccountRow>(
          linkedAccountIds,
          (chunk, from, to) =>
            editorialDb
              .from("external_accounts")
              .select(
                "id, client_id, platform, display_name, handle, status",
              )
              .in("id", chunk)
              .in("platform", [...EDITORIAL_PLATFORMS])
              .eq("status", "active")
              .order("id", { ascending: true })
              .range(from, to),
        );
      }

      return {
        accounts,
        files,
        tasks,
        assignments: assignments.map((row) => row.user_id),
      };
    },
    enabled: enabled && !!user && !!clientId && !!projectId,
    refetchInterval: 30_000,
  });
}

export function useEditorialApprovalPreview(
  fileId: string | null,
  enabled: boolean,
) {
  const { user, profile } = useAuth();

  return useQuery({
    queryKey: [
      "editorial-approval-preview",
      user?.id,
      profile?.role,
      fileId,
    ],
    queryFn: async () => {
      const { data, error } = await editorialDb.rpc(
        "get_editorial_approval_preview",
        { p_file_id: fileId },
      );
      if (error) throw error;
      return (data || []) as EditorialApprovalPreviewRow[];
    },
    enabled: enabled && !!user && !!fileId,
    refetchInterval: 30_000,
  });
}

export function useEditorialMutations() {
  const queryClient = useQueryClient();

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] }),
      queryClient.invalidateQueries({ queryKey: ["editorial-events"] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({
        queryKey: ["editorial-linked-task-ids"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["editorial-editor-options"],
      }),
    ]);
  };

  const savePost = useMutation({
    mutationFn: async ({
      payload,
      expectedVersion = null,
    }: SaveEditorialPostInput) => {
      const { data, error } = await editorialDb.rpc("save_editorial_post", {
        p_payload: payload,
        p_expected_version: expectedVersion,
      });
      if (error) throw error;
      return data as {
        post_id: string;
        version: number;
        recovered: boolean;
      };
    },
    onSuccess: refresh,
  });

  const transitionPublication = useMutation({
    mutationFn: async (input: TransitionEditorialPublicationInput) => {
      const { data, error } = await editorialDb.rpc(
        "transition_editorial_publication",
        {
          p_publication_id: input.publicationId,
          p_action: input.action,
          p_expected_version: input.expectedVersion,
          p_scheduled_at: input.scheduledAt ?? null,
          p_timezone: input.timezone ?? null,
          p_permalink: input.permalink ?? null,
          p_external_post_id: input.externalPostId ?? null,
          p_failure_code: input.failureCode ?? null,
          p_failure_reason: input.failureReason ?? null,
          p_published_at: input.publishedAt ?? null,
        },
      );
      if (error) throw error;
      return data as {
        publication_id: string;
        status: string;
        version: number;
        recovered: boolean;
      };
    },
    onSuccess: refresh,
  });

  const archivePost = useMutation({
    mutationFn: async ({
      postId,
      expectedVersion,
    }: {
      postId: string;
      expectedVersion: number;
    }) => {
      const { data, error } = await editorialDb.rpc(
        "archive_editorial_post",
        {
          p_post_id: postId,
          p_expected_version: expectedVersion,
        },
      );
      if (error) throw error;
      return data as {
        post_id: string;
        version: number;
        recovered: boolean;
      };
    },
    onSuccess: refresh,
  });

  return { savePost, transitionPublication, archivePost };
}
