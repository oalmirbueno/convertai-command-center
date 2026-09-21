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
  type EditorialPlatform,
} from "@/lib/editorial";
import {
  buildEditorialTaskLinkIndex,
  type EditorialTaskLinkIndex,
  type EditorialTaskLinkRow,
} from "@/lib/editorialTaskLinks";
import { orderEditorialCarouselFiles } from "@/lib/editorialMedia";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";

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
  connection_status: "connected" | "expired" | "revoked" | "manual";
  automation_enabled: boolean;
}

interface EditorialAccountConnectionRow {
  external_account_id: string;
  connection_status: string;
  automation_enabled: boolean;
}

export interface CreateAndLinkEditorialAccountInput {
  platform: EditorialPlatform;
  displayName: string;
  handle?: string | null;
}

export interface LinkEditorialAccountInput {
  accountId: string;
}

export interface EditorialFileRow {
  id: string;
  client_id: string;
  project_id: string | null;
  file_name: string;
  file_type?: string | null;
  mime_type?: string | null;
  extension?: string | null;
  file_url?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  size_bytes?: number | null;
  caption?: string | null;
  carousel_text?: string | null;
  description?: string | null;
  approval_status: string;
  agency_approval_status?: string;
  visibility: string;
  locked_at: string | null;
  status: string | null;
  archived_at: string | null;
  parent_file_id: string | null;
  created_at?: string | null;
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
  fileChildren?: EditorialFileRow[];
}

export interface EditorialPostBundle {
  post: EditorialPostRow;
  internal: EditorialPostInternalRow | null;
  /**
   * O plano visto INTEIRO, sem o recorte do mês. A tela carrega só as
   * publicações do período visível; decidir "tem agendamento?" ou "já foi
   * publicado?" pelas publicações recortadas fazia o conteúdo agendado para
   * outro mês aparecer DUAS vezes (ancorado no prazo + no dia agendado) e o
   * publicado continuar pintado de "Pronto".
   */
  temPlanoVivoGlobal: boolean;
  publicadoGlobal: boolean;
  primaryFile: EditorialFileRow | null;
  primaryFileChildren?: EditorialFileRow[];
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
  productionStatus?: string;
}

export interface SaveEditorialPostInput {
  payload: Record<string, unknown>;
  expectedVersion?: number | null;
  deferRefresh?: boolean;
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
  deferRefresh?: boolean;
}

export interface EditorialQueryResult {
  posts: EditorialPostBundle[];
  accounts: EditorialAccountRow[];
}

export interface EditorialRealtimeGate {
  pendingCount: number;
  deferred: boolean;
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
      const rows = await readAllPages<{ id: string; client_id: string }>(() =>
        editorialDb
          .from("team_client_assignments")
          .select("id, client_id")
          .eq("user_id", user!.id),
      );
      return unique(rows.map((row) => row.client_id));
    },
    enabled: enabled && !!user && isEditorialStaff,
    refetchInterval: 30_000,
  });
}

// Acha o conteudo VIVO que ja usa uma arte como capa. E o que transforma o
// erro "arte ja usada" em acao: o painel abre o card existente na hora.
export async function findEditorialPostIdByPrimaryFile(
  clientId: string,
  fileId: string,
): Promise<string | null> {
  const { data, error } = await editorialDb
    .from("editorial_posts")
    .select("id")
    .eq("client_id", clientId)
    .eq("primary_file_id", fileId)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const direct = (data as { id: string } | null)?.id ?? null;
  if (direct) return direct;
  // A arte tambem pode estar presa numa PUBLICACAO nao cancelada.
  const { data: pub } = await editorialDb
    .from("editorial_publications")
    .select("post_id")
    .eq("client_id", clientId)
    .eq("file_id", fileId)
    .neq("status", "cancelled")
    .limit(1)
    .maybeSingle();
  return (pub as { post_id: string } | null)?.post_id ?? null;
}

export function useEditorialLinkedTaskIds(
  enabled: boolean,
  realtimeGate?: { current: EditorialRealtimeGate },
) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const isEditorialStaff = ["admin", "manager", "design", "traffic"].includes(
    profile?.role || "",
  );

  const query = useQuery({
    queryKey: ["editorial-linked-task-ids", user?.id, profile?.role],
    queryFn: async (): Promise<EditorialTaskLinkIndex> => {
      // post_id e a chave primaria de editorial_post_internal: serve de cursor.
      const links = await readAllPages<EditorialTaskLinkRow>(
        () =>
          editorialDb
            .from("editorial_post_internal")
            .select("post_id, task_id, revision_of_post_id")
            .not("task_id", "is", null),
        "post_id",
      );
      const postIds = unique(links.map((row) => row.post_id));
      if (postIds.length === 0) {
        return { taskIds: [], postIdByTaskId: {} };
      }

      const activePosts = await readInChunks<{ id: string }>(
        postIds,
        (chunk) =>
          editorialDb
            .from("editorial_posts")
            .select("id")
            .in("id", chunk)
            .in("production_status", ["draft", "production", "ready"])
            .is("archived_at", null),
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
      if (realtimeGate?.current.pendingCount) {
        realtimeGate.current.deferred = true;
        return;
      }
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
  }, [enabled, isEditorialStaff, queryClient, realtimeGate, user]);

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

/**
 * Consulta que o leitor paginado completa com ordem, limite e cursor. O
 * chamador entrega o filtro; a ordenacao final de exibicao, quando importa,
 * e feita em memoria depois da leitura (ver sortRows abaixo).
 */
interface CursorQuery<T> extends PromiseLike<EditorialPage<T>> {
  order: (column: string, options: { ascending: boolean }) => CursorQuery<T>;
  limit: (count: number) => CursorQuery<T>;
  gt: (column: string, value: string) => CursorQuery<T>;
}

/**
 * Paginacao por cursor estavel (mesma regra de useTasks em useSupabaseData):
 * ordena pela coluna unica informada e pede "maior que o ultimo lido". O
 * range numerico sobre colunas que mudam durante a leitura (updated_at,
 * scheduled_at) deslocava as paginas e a mesma linha voltava duplicada, ou
 * uma linha sumia. Com cursor, cada linha aparece uma vez so.
 */
async function readAllPages<T>(
  buildQuery: () => CursorQuery<T>,
  cursor = "id",
) {
  const seen = new Set<string>();
  const rows: T[] = [];
  let after: string | null = null;

  while (true) {
    let query = buildQuery()
      .order(cursor, { ascending: true })
      .limit(EDITORIAL_PAGE_SIZE);
    if (after) query = query.gt(cursor, after);
    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    for (const row of page) {
      const key = (row as Record<string, unknown> | null)?.[cursor];
      if (typeof key === "string") {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      rows.push(row);
    }
    if (page.length < EDITORIAL_PAGE_SIZE) return rows;
    const last = (page[page.length - 1] as Record<string, unknown> | null)?.[cursor];
    if (typeof last !== "string" || last === after) return rows;
    after = last;
  }
}

async function readInChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => CursorQuery<T>,
  cursor = "id",
) {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += EDITORIAL_ID_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + EDITORIAL_ID_CHUNK_SIZE);
    rows.push(...(await readAllPages(() => fetchChunk(chunk), cursor)));
  }
  return rows;
}

type SortDirection = "asc" | "desc";

/**
 * Ordenacao de exibicao em memoria, ja que a leitura agora sai ordenada pelo
 * cursor. Nulos vao para o fim em qualquer direcao (como nullsFirst: false).
 */
function sortRows<T>(
  rows: T[],
  keys: Array<[keyof T & string, SortDirection]>,
) {
  return [...rows].sort((left, right) => {
    for (const [key, direction] of keys) {
      const a = left[key] as unknown as string | number | null | undefined;
      const b = right[key] as unknown as string | number | null | undefined;
      const aNull = a === null || a === undefined;
      const bNull = b === null || b === undefined;
      if (aNull && bNull) continue;
      if (aNull) return 1;
      if (bNull) return -1;
      if (a === b) continue;
      const order = a < b ? -1 : 1;
      return direction === "asc" ? order : -order;
    }
    return 0;
  });
}

const EDITORIAL_RANGE_PADDING_DAYS = 45;

function shiftIsoDays(iso: string, days: number) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

async function readEditorialCalendar(
  filters: EditorialCalendarFilters,
  actualStaff: boolean,
  exposeInternal: boolean,
  forceClientView: boolean,
  fileChildrenMode: "none" | "scheduled" | "all" = "none",
): Promise<EditorialQueryResult> {
  const loadInternal = exposeInternal || (actualStaff && forceClientView);
  const posts = sortRows(
    await readAllPages<EditorialPostRow>(() => {
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
      if (filters.productionStatus) {
        query = query.eq("production_status", filters.productionStatus);
      }
      return query;
    }),
    [["updated_at", "desc"], ["id", "asc"]],
  );
  const postIds = posts.map((post) => post.id);
  if (postIds.length === 0) return { posts: [], accounts: [] };
  const postIdSet = new Set(postIds);

  const publicationRows = sortRows(
    await readAllPages<EditorialPublicationRow>(() => {
      let query = editorialDb.from("editorial_publications").select("*");

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
        if (filters.clientId) {
          query = query.or(
            `scheduled_at.is.null,and(scheduled_at.gte.${filters.rangeStart},scheduled_at.lt.${filters.rangeEnd})`,
          );
        } else {
          // Sem cliente ("Todos"): janela do periodo visivel com folga de 45
          // dias para cada lado, e sem as linhas sem data. Trazer o backlog
          // sem data de TODOS os clientes era ler a tabela inteira a cada
          // troca de mes; o sem-data so entra com um cliente escolhido.
          query = query
            .gte("scheduled_at", shiftIsoDays(filters.rangeStart, -EDITORIAL_RANGE_PADDING_DAYS))
            .lt("scheduled_at", shiftIsoDays(filters.rangeEnd, EDITORIAL_RANGE_PADDING_DAYS));
        }
      }
      return query;
    }),
    [["scheduled_at", "asc"], ["id", "asc"]],
  );
  const publications = publicationRows.filter((publication) =>
    postIdSet.has(publication.post_id),
  );
  const hasPeriodFilter =
    Boolean(filters.rangeStart && filters.rangeEnd) && !filters.postId;
  let postIdsWithAnyRelevantPublications = new Set<string>();
  const postIdsComPlanoVivoGlobal = new Set<string>();
  const postIdsPublicadosGlobal = new Set<string>();

  if (hasPeriodFilter) {
    // Presenca so dos conteudos carregados, em lotes de 100 ids: sem o
    // .in("post_id") esta leitura varria editorial_publications inteira, de
    // todos os clientes, a cada troca de mes.
    const presenceRows = await readInChunks<{
      id: string;
      post_id: string;
      status: string;
      scheduled_at: string | null;
    }>(postIds, (chunk) => {
      let query = editorialDb
        .from("editorial_publications")
        .select("id, post_id, status, scheduled_at")
        .in("post_id", chunk);

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
      return query;
    });
    postIdsWithAnyRelevantPublications = new Set(
      presenceRows
        .map((row) => row.post_id)
        .filter((postId) => postIdSet.has(postId)),
    );
    /* O recorte por período era a raiz do card DUPLICADO: a tela só carrega
       as publicações do mês visível, então um conteúdo agendado para OUTRO
       mês parecia "sem plano" — continuava ancorado no prazo da tarefa (ou
       no backlog) e ainda aparecia no dia agendado quando aquele mês era
       aberto. E o publicado fora do recorte seguia pintado de "Pronto".
       Estes dois conjuntos enxergam o plano INTEIRO, sem recorte. */
    for (const row of presenceRows) {
      if (!postIdSet.has(row.post_id)) continue;
      if (row.scheduled_at && row.status !== "cancelled") {
        postIdsComPlanoVivoGlobal.add(row.post_id);
      }
      if (row.status === "published" || row.status === "partially_published") {
        postIdsPublicadosGlobal.add(row.post_id);
      }
    }
  }
  const accountIds = unique(
    publications.map((publication) => publication.external_account_id),
  );
  const fileIds = unique([
    ...posts.map((post) => post.primary_file_id),
    ...publications.map((publication) => publication.file_id),
  ]);
  const primaryFileIdByPostId = new Map(
    posts.map((post) => [post.id, post.primary_file_id]),
  );
  const childRootIds =
    fileChildrenMode === "all"
      ? fileIds
      : fileChildrenMode === "scheduled"
        ? unique(
            publications
              .filter((publication) => Boolean(publication.scheduled_at))
              .map(
                (publication) =>
                  publication.file_id ||
                  primaryFileIdByPostId.get(publication.post_id),
              ),
          )
        : [];

  const [postInternalRows, publicationInternalRows, accountRows, fileRows] =
    await Promise.all([
      loadInternal
        ? readInChunks<EditorialPostInternalRow>(
            postIds,
            (chunk) =>
              editorialDb
                .from("editorial_post_internal")
                .select("*")
                .in("post_id", chunk),
            "post_id",
          )
        : Promise.resolve([]),
      loadInternal && publications.length > 0
        ? readInChunks<EditorialPublicationInternalRow>(
            publications.map((publication) => publication.id),
            (chunk) =>
              editorialDb
                .from("editorial_publication_internal")
                .select("*")
                .in("publication_id", chunk),
            "publication_id",
          )
        : Promise.resolve([]),
      accountIds.length > 0
        ? readInChunks<EditorialAccountRow>(accountIds, (chunk) =>
            editorialDb
              .from("external_accounts")
              .select("id, client_id, platform, display_name, handle, status")
              .in("id", chunk),
          )
        : Promise.resolve([]),
      fileIds.length > 0
        ? readInChunks<EditorialFileRow>(fileIds, (chunk) =>
            editorialDb
              .from(actualStaff ? "staff_files_secure" : "files")
              .select(
                actualStaff
                  ? "id, client_id, project_id, file_name, file_type, mime_type, extension, file_url, storage_bucket, storage_path, size_bytes, caption, carousel_text, description, approval_status, agency_approval_status, visibility, locked_at, status, archived_at, parent_file_id, created_at"
                  : "id, client_id, project_id, file_name, file_type, mime_type, extension, file_url, storage_bucket, storage_path, size_bytes, caption, carousel_text, description, approval_status, visibility, locked_at, status, archived_at, parent_file_id, created_at",
              )
              .in("id", chunk),
          )
        : Promise.resolve([]),
    ]);

  const childFileRows =
    childRootIds.length > 0
      ? sortRows(
          await readInChunks<EditorialFileRow>(childRootIds, (chunk) =>
            editorialDb
              .from(actualStaff ? "staff_files_secure" : "files")
              .select(
                actualStaff
                  ? "id, client_id, project_id, file_name, file_type, mime_type, extension, file_url, storage_bucket, storage_path, size_bytes, caption, carousel_text, description, approval_status, agency_approval_status, visibility, locked_at, status, archived_at, parent_file_id, created_at"
                  : "id, client_id, project_id, file_name, file_type, mime_type, extension, file_url, storage_bucket, storage_path, size_bytes, caption, carousel_text, description, approval_status, visibility, locked_at, status, archived_at, parent_file_id, created_at",
              )
              .in("parent_file_id", chunk)
              .is("archived_at", null),
          ),
          [["created_at", "asc"], ["id", "asc"]],
        )
      : [];

  const postInternalById = new Map(
    postInternalRows.map((row) => [row.post_id, row]),
  );
  const publicationInternalById = new Map(
    publicationInternalRows.map((row) => [row.publication_id, row]),
  );
  const accountById = new Map(accountRows.map((row) => [row.id, row]));
  const fileById = new Map(fileRows.map((row) => [row.id, row]));
  const childrenByParentId = new Map<string, EditorialFileRow[]>();
  childFileRows.forEach((file) => {
    if (!file.parent_file_id) return;
    const current = childrenByParentId.get(file.parent_file_id) || [];
    current.push(file);
    childrenByParentId.set(file.parent_file_id, current);
  });
  const orderedChildren = (root: EditorialFileRow | null) =>
    root
      ? orderEditorialCarouselFiles(
          root,
          childrenByParentId.get(root.id) || [],
        ).slice(1) as EditorialFileRow[]
      : [];
  const publicationsByPostId = new Map<string, EditorialPublicationRow[]>();
  publications.forEach((publication) => {
    const current = publicationsByPostId.get(publication.post_id) || [];
    current.push(publication);
    publicationsByPostId.set(publication.post_id, current);
  });

  const publicationSetComplete =
    !forceClientView &&
    !filters.platform &&
    !(filters.rangeStart && filters.rangeEnd);
  let bundledPosts = posts.map((post) => {
    const primaryFile = post.primary_file_id
      ? fileById.get(post.primary_file_id) || null
      : null;
    const vivoLocal = (publicationsByPostId.get(post.id) || []).some(
      (publication) =>
        Boolean(publication.scheduled_at) && publication.status !== "cancelled",
    );
    const publicadoLocal = (publicationsByPostId.get(post.id) || []).some(
      (publication) =>
        publication.status === "published" ||
        publication.status === "partially_published",
    );
    return {
      post,
      internal: postInternalById.get(post.id) || null,
      // Sem recorte de período (quadro, detalhe), o local JÁ é o global.
      temPlanoVivoGlobal: hasPeriodFilter
        ? postIdsComPlanoVivoGlobal.has(post.id)
        : vivoLocal,
      publicadoGlobal: hasPeriodFilter
        ? postIdsPublicadosGlobal.has(post.id)
        : publicadoLocal,
      primaryFile,
      primaryFileChildren: orderedChildren(primaryFile),
      publications: (publicationsByPostId.get(post.id) || []).map(
        (publication) => {
          const file = publication.file_id
            ? fileById.get(publication.file_id) || null
            : null;
          return {
            publication,
            internal: publicationInternalById.get(publication.id) || null,
            account: accountById.get(publication.external_account_id) || null,
            file,
            fileChildren: orderedChildren(file),
          };
        },
      ),
      publicationSetComplete,
    };
  });

  if (!actualStaff) {
    bundledPosts = bundledPosts.map((bundle) => ({
      ...bundle,
      primaryFile: bundle.primaryFile
        ? {
            ...bundle.primaryFile,
            agency_approval_status: "approved",
          }
        : null,
      primaryFileChildren: (bundle.primaryFileChildren || []).map((file) => ({
        ...file,
        agency_approval_status: "approved",
      })),
      publications: bundle.publications.map((publication) => ({
        ...publication,
        file: publication.file
          ? {
              ...publication.file,
              agency_approval_status: "approved",
            }
          : null,
        fileChildren: (publication.fileChildren || []).map((file) => ({
          ...file,
          agency_approval_status: "approved",
        })),
      })),
    }));
  }

  if (forceClientView) {
    bundledPosts = bundledPosts
      .map((bundle) => ({
        ...bundle,
        internal: null,
        publications: bundle.publications
          // Cronograma COMPLETO na visao do cliente (decisao do dono):
          // planejado, agendado e publicado. O que nao entra e cancelado.
          // A RLS do banco continua garantindo o dono e escondendo internos.
          .filter(({ publication }) =>
            ["planned", "scheduled", "published"].includes(publication.status),
          )
          .map((publication) => ({
            ...publication,
            internal: null,
          })),
      }))
      // Todos os conteudos vivos entram (backlog, producao, pronto): o
      // cliente ve o trabalho planejado, nao um calendario vazio.
      .filter((bundle) => bundle.post.production_status !== "archived");
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
  options: {
    forceClientView?: boolean;
    realtimeGate?: { current: EditorialRealtimeGate };
  } = {},
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
        "scheduled",
      ),
    placeholderData: keepPreviousData,
    enabled: !!user,
    refetchInterval: () =>
      options.realtimeGate?.current.pendingCount ? false : 30_000,
  });

  useEffect(() => {
    if (!user) return;

    const refresh = () => {
      if (options.realtimeGate?.current.pendingCount) {
        options.realtimeGate.current.deferred = true;
        return;
      }
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
  }, [options.realtimeGate, queryClient, user]);

  return query;
}

export function useEditorialSchedulingPosts(
  clientId: string | null,
  projectId: string | null,
  enabled: boolean,
) {
  const { user, profile } = useAuth();
  const actualStaff =
    profile?.role === "admin" ||
    ["manager", "design", "traffic"].includes(profile?.role || "");

  return useQuery({
    queryKey: [
      "editorial-scheduling-posts",
      user?.id,
      profile?.role,
      clientId,
      projectId,
    ],
    queryFn: async () => {
      if (!clientId || !projectId || !actualStaff) return [];
      const result = await readEditorialCalendar(
        { clientId, projectId, productionStatus: "ready" },
        true,
        true,
        false,
      );
      return result.posts;
    },
    enabled:
      enabled && actualStaff && !!user && !!clientId && !!projectId,
    staleTime: 15_000,
  });
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
        "all",
      ),
    enabled: !!user && !!postId && (!forceClientView || !!clientId),
    refetchInterval: 30_000,
  });
}

export function useEditorialPostEvents(
  postId: string | null,
  enabled: boolean,
) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["editorial-events", user?.id, profile?.role, postId],
    queryFn: async () => {
      const eventRows = sortRows(
        await readAllPages<EditorialEventRow>(() =>
          editorialDb
            .from("editorial_events")
            .select("*")
            .eq("post_id", postId),
        ),
        [["created_at", "desc"], ["id", "desc"]],
      );
      const actorIds = unique(eventRows.map((event) => event.actor_id));
      const actorRows =
        actorIds.length > 0
          ? await readInChunks<{ id: string; full_name: string | null }>(
              actorIds,
              (chunk) =>
                editorialDb
                  .from("profiles")
                  .select("id, full_name")
                  .in("id", chunk),
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
  mode: "full" | "schedule" = "full",
) {
  const { user, profile } = useAuth();
  return useQuery({
    queryKey: [
      "editorial-editor-options",
      user?.id,
      profile?.role,
      clientId,
      projectId,
      mode,
    ],
    queryFn: async () => {
      if (!clientId || !projectId) {
        return {
          accounts: [],
          availableAccounts: [],
          canManageAccounts: false,
          accountPermissionUnavailable: false,
          files: [],
          tasks: [],
          assignments: [],
          usedFileIds: [],
        };
      }

      const [
        links,
        rawAccounts,
        accountConnections,
        accountPermission,
        files,
        tasks,
        assignments,
        usedPrimaryFiles,
        usedPublicationFiles,
      ] = await Promise.all([
        readAllPages<{ id: string; external_account_id: string }>(() =>
          editorialDb
            .from("project_external_accounts")
            .select("id, external_account_id")
            .eq("client_id", clientId)
            .eq("project_id", projectId),
        ),
        (async () =>
          sortRows(
            await readAllPages<EditorialAccountRow>(() =>
              editorialDb
                .from("external_accounts")
                .select("id, client_id, platform, display_name, handle, status")
                .eq("client_id", clientId)
                .in("platform", [...EDITORIAL_PLATFORMS])
                .eq("status", "active"),
            ),
            [["display_name", "asc"], ["id", "asc"]],
          ))(),
        // external_account_id e a chave primaria da tabela de conexoes.
        readAllPages<EditorialAccountConnectionRow>(
          () =>
            editorialDb
              .from("external_account_connections")
              .select(
                "external_account_id, connection_status, automation_enabled",
              )
              .eq("client_id", clientId),
          "external_account_id",
        ),
        (async () => {
          const { data, error } = await editorialDb.rpc(
            "can_manage_client",
            { _client_id: clientId },
          );
          return {
            canManage: !error && data === true,
            unavailable: Boolean(error),
          };
        })(),
        (async () =>
          sortRows(
            await readAllPages<EditorialFileRow>(() =>
              editorialDb
                .from("staff_files_secure")
                .select(
                  "id, client_id, project_id, file_name, file_type, mime_type, extension, file_url, storage_bucket, storage_path, size_bytes, caption, carousel_text, description, approval_status, agency_approval_status, visibility, locked_at, status, archived_at, parent_file_id, created_at",
                )
                .eq("client_id", clientId)
                // Arquivo do cliente SEM projeto também entra: o upload em
                // Arquivos permite subir sem escolher projeto, e o material
                // recém-subido ficava invisível aqui — nenhum botão de atualizar
                // o traria. Ao ser escolhido como arte, ele é adotado no projeto.
                .or(`project_id.eq.${projectId},project_id.is.null`)
                .is("archived_at", null),
            ),
            [["created_at", "asc"], ["id", "asc"]],
          ))(),
        mode === "full" ? (async () =>
          sortRows(
            await readAllPages<{
              id: string;
              project_id: string;
              title: string;
              assigned_to: string | null;
              status: string;
              due_date: string | null;
              workstream: string | null;
              delivery_type: string | null;
              source: string | null;
              updated_at: string;
            }>(() =>
              editorialDb
                .from("tasks")
                .select(
                  "id, project_id, title, assigned_to, status, due_date, workstream, delivery_type, source, updated_at",
                )
                .eq("project_id", projectId)
                .is("deleted_at", null),
            ),
            [["updated_at", "desc"], ["id", "asc"]],
          ))() : Promise.resolve([]),
        mode === "full" ? readAllPages<{ id: string; user_id: string }>(() =>
          editorialDb
            .from("team_client_assignments")
            .select("id, user_id")
            .eq("client_id", clientId),
        ) : Promise.resolve([]),
        readAllPages<{
          id: string;
          primary_file_id: string | null;
        }>(() =>
          editorialDb
            .from("editorial_posts")
            .select("id, primary_file_id")
            .eq("client_id", clientId)
            .eq("project_id", projectId)
            // Conteúdo apagado libera a arte (mesma regra do banco): sem este
            // filtro a arte sumia do seletor para sempre depois de um Apagar.
            .is("archived_at", null)
            .not("primary_file_id", "is", null),
        ),
        readAllPages<{
          id: string;
          file_id: string | null;
        }>(() =>
          editorialDb
            .from("editorial_publications")
            .select("id, file_id")
            .eq("client_id", clientId)
            .eq("project_id", projectId)
            .neq("status", "cancelled")
            .not("file_id", "is", null),
        ),
      ]);

      const linkedAccountIds = unique(
        links.map((link) => link.external_account_id),
      );
      const connectionByAccountId = new Map(
        accountConnections.map((connection) => [
          connection.external_account_id,
          connection,
        ]),
      );
      const allAccounts = rawAccounts.map((account) => {
        const connection = connectionByAccountId.get(account.id);
        return {
          ...account,
          connection_status: !connection
            ? ("manual" as const)
            : connection.connection_status === "connected"
              ? ("connected" as const)
              : connection.connection_status === "revoked"
                ? ("revoked" as const)
                : ("expired" as const),
          automation_enabled: connection?.automation_enabled === true,
        };
      });
      const linkedAccountIdSet = new Set(linkedAccountIds);
      const accounts = allAccounts.filter((account) =>
        linkedAccountIdSet.has(account.id),
      );
      const availableAccounts = allAccounts.filter(
        (account) => !linkedAccountIdSet.has(account.id),
      );

      return {
        accounts,
        availableAccounts,
        canManageAccounts: accountPermission.canManage,
        accountPermissionUnavailable: accountPermission.unavailable,
        files,
        tasks,
        assignments: assignments.map((row) => row.user_id),
        usedFileIds: unique([
          ...usedPrimaryFiles.map((row) => row.primary_file_id),
          ...usedPublicationFiles.map((row) => row.file_id),
        ]),
      };
    },
    enabled: enabled && !!user && !!clientId && !!projectId,
    refetchInterval: 30_000,
  });
}

export function useEditorialAccountMutations(
  clientId: string | null,
  projectId: string | null,
) {
  const queryClient = useQueryClient();

  const refreshAccounts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["editorial-editor-options"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["external-accounts", clientId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["project-external-accounts", clientId],
      }),
    ]);
  };

  const createAndLinkAccount = useMutation({
    mutationFn: async ({
      platform,
      displayName,
      handle = null,
    }: CreateAndLinkEditorialAccountInput) => {
      if (!clientId || !projectId) {
        throw new Error("Selecione o cliente e o projeto antes de cadastrar.");
      }

      const { data, error } = await editorialDb.rpc(
        "create_and_link_editorial_account",
        {
          p_client_id: clientId,
          p_project_id: projectId,
          p_platform: platform,
          p_display_name: displayName,
          p_handle: handle,
        },
      );
      if (error) {
        throw new Error(
          await getSupabaseFunctionErrorMessage(
            error,
            "Não foi possível cadastrar e vincular a conta.",
          ),
        );
      }
      if (typeof data !== "string" || !data) {
        throw new Error(
          "A conta foi processada, mas a plataforma não confirmou o vínculo.",
        );
      }
      await refreshAccounts();
      return data;
    },
  });

  const linkAccount = useMutation({
    mutationFn: async ({ accountId }: LinkEditorialAccountInput) => {
      if (!clientId || !projectId) {
        throw new Error("Selecione o cliente e o projeto antes de vincular.");
      }

      const { error } = await editorialDb
        .from("project_external_accounts")
        .insert({
          client_id: clientId,
          project_id: projectId,
          external_account_id: accountId,
        });
      if (error) {
        throw new Error(
          await getSupabaseFunctionErrorMessage(
            error,
            "Não foi possível vincular a conta ao projeto.",
          ),
        );
      }
      await refreshAccounts();
      return accountId;
    },
  });

  return { createAndLinkAccount, linkAccount };
}

export function useEditorialApprovalPreview(
  fileId: string | null,
  enabled: boolean,
) {
  const { user, profile } = useAuth();

  return useQuery({
    queryKey: ["editorial-approval-preview", user?.id, profile?.role, fileId],
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
      queryClient.invalidateQueries({ queryKey: ["editorial-scheduling-posts"] }),
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
      if (error) {
        throw new Error(
          await getSupabaseFunctionErrorMessage(
            error,
            "Não foi possível salvar o conteúdo.",
          ),
        );
      }
      return data as {
        post_id: string;
        version: number;
        recovered: boolean;
      };
    },
    onSuccess: (_data, variables) =>
      variables.deferRefresh ? undefined : refresh(),
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
    onSuccess: (_data, variables) =>
      variables.deferRefresh ? undefined : refresh(),
  });

  const archivePost = useMutation({
    mutationFn: async ({
      postId,
      expectedVersion,
    }: {
      postId: string;
      expectedVersion: number;
    }) => {
      const { data, error } = await editorialDb.rpc("archive_editorial_post", {
        p_post_id: postId,
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

  return { savePost, transitionPublication, archivePost };
}
