import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  History,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import CarouselSlider from "@/components/shared/CarouselSlider";
import {
  loadEditorialPostForMutation,
  useEditorialEditorOptions,
  useEditorialMutations,
  useEditorialPostEvents,
  type EditorialPostBundle,
  type EditorialPublicationBundle,
} from "@/hooks/useEditorialCalendar";
import {
  EDITORIAL_STATUS_CONFIG,
  PLATFORM_LABELS,
  PRODUCTION_STATUS_LABELS,
  PUBLICATION_STATUS_LABELS,
  aggregateEditorialStatus,
  isFileEditable,
  isFilePublishable,
  type EditorialPlatform,
  type EditorialPublicationStatus,
  type EditorialProductionStatus,
} from "@/lib/editorial";
import {
  EDITORIAL_DEFAULT_TIME_ZONE,
  isoUtcToZonedDateTimeLocal,
  zonedDateTimeLocalToIso,
} from "@/lib/editorialDate";
import { cn } from "@/lib/utils";
import { editorialErrorMessage } from "@/lib/editorialErrorMessage";
import {
  AUTOPUBLISH_STAGE_LABELS,
  retryAutopublish,
  useAutopublishStatus,
} from "@/hooks/useAutopublishStatus";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  recordOfflineClientApproval,
  releaseFileToClient,
  requestFileAgencyReview,
  reviewFileAgency,
} from "@/lib/fileApprovalActions";

type PublicationAction =
  | "schedule"
  | "publish"
  | "fail"
  | "cancel"
  | "reopen";

interface EditorialDetailSheetProps {
  open: boolean;
  post: EditorialPostBundle | null;
  clientName: string;
  projectName: string;
  responsibleName?: string | null;
  canEdit: boolean;
  canPublish: boolean;
  isImpersonating: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (post: EditorialPostBundle) => void;
  onCreateRevision: (post: EditorialPostBundle) => void;
  onArchived: () => void;
}

const eventLabels: Record<string, string> = {
  post_created: "Conteúdo criado",
  post_updated: "Conteúdo atualizado",
  production_status_changed: "Etapa de produção alterada",
  post_archived: "Conteúdo arquivado",
  publication_created: "Plano de publicação criado",
  publication_updated: "Plano de publicação atualizado",
  publication_scheduled: "Publicação agendada",
  publication_rescheduled: "Publicação reagendada",
  publication_published: "Publicação confirmada",
  publication_failed: "Falha registrada",
  publication_cancelled: "Publicação cancelada",
  publication_reopened: "Publicação reaberta",
  approval_snapshot_agency_approved:
    "Snapshot editorial aprovado pela agência",
  approval_snapshot_agency_rejected:
    "Ajustes editoriais pedidos pela agência",
  approval_snapshot_client_approved:
    "Snapshot editorial aprovado pelo cliente",
  approval_snapshot_client_rejected:
    "Ajustes editoriais pedidos pelo cliente",
};

const publicationStatusClasses: Record<string, string> = {
  planned: "border-violet-500/25 bg-violet-500/10 text-violet-500",
  scheduled: "border-sky-500/25 bg-sky-500/10 text-sky-500",
  published: "border-success/25 bg-success/10 text-success",
  failed: "border-destructive/25 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-muted text-muted-foreground",
};

function formatDateTime(value: string | null, timeZone: string) {
  if (!value) return "Sem data definida";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function publicationFileReady(
  post: EditorialPostBundle,
  publication: EditorialPublicationBundle,
) {
  const effectiveFile = publication.publication.file_id
    ? publication.file
    : post.primaryFile;
  return (
    post.post.production_status === "ready" &&
    isFilePublishable(post.primaryFile) &&
    isFilePublishable(effectiveFile)
  );
}

/**
 * Em que pé está a publicação automática, para a equipe.
 *
 * Antes, quando o motor falhava, o erro ficava só no banco e a agenda seguia
 * mostrando "Programado" como se estivesse tudo certo. Agora a falha aparece
 * aqui, com o passo em que parou e o motivo.
 */
function PublicationDeliveryStatus({ publicationId }: { publicationId: string }) {
  const queryClient = useQueryClient();
  const { data } = useAutopublishStatus(publicationId);
  const [retrying, setRetrying] = useState(false);
  if (!data) return null;

  const failed = data.stage === "failed";
  const done = data.stage === "done";
  if (done && !data.last_error) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retryAutopublish(publicationId);
      toast.success("Reprocessando. O motor retoma em até um minuto.");
      await queryClient.invalidateQueries({ queryKey: ["autopublish-status", publicationId] });
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível reprocessar.");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border p-3",
        failed
          ? "border-destructive/20 bg-destructive/5"
          : "border-sky-500/20 bg-sky-500/5",
      )}
    >
      {failed ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      ) : (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-sky-500" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-medium", failed ? "text-destructive" : "text-sky-500")}>
          {AUTOPUBLISH_STAGE_LABELS[data.stage]}
          {/* "Tentativas" é contagem de idas à Meta, não de erros; mostrar
              durante o processo assustava sem motivo. Só aparece na falha. */}
          {failed && data.attempts > 1 && ` · ${data.attempts} idas à Meta`}
        </p>
        {failed && data.last_error && (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{data.last_error}</p>
        )}
        {failed && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-7 gap-1 px-2 text-xs"
            disabled={retrying}
            onClick={handleRetry}
          >
            {retrying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Tentar de novo
          </Button>
        )}
      </div>
    </div>
  );
}

function PublicationProgress({
  post,
  bundle,
}: {
  post: EditorialPostBundle;
  bundle: EditorialPublicationBundle;
}) {
  const publication = bundle.publication;
  const approved = publicationFileReady(post, bundle);
  const scheduled =
    Boolean(publication.scheduled_at) ||
    ["scheduled", "published"].includes(publication.status);
  const published = publication.status === "published";
  const steps = [
    { label: "Aprovado", complete: approved },
    { label: "Agendado no painel", complete: scheduled },
    { label: "Publicado", complete: published },
  ];

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Rastreio do processo
      </p>
      <ol className="mt-3 grid grid-cols-3 gap-2" aria-label="Etapas da publicação">
        {steps.map((step, index) => (
          <li key={step.label} className="relative min-w-0 text-center">
            {index > 0 && (
              <span
                className={cn(
                  "absolute right-1/2 top-3 h-px w-full",
                  step.complete ? "bg-success/50" : "bg-border",
                )}
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                "relative z-10 mx-auto flex h-6 w-6 items-center justify-center rounded-full border bg-background",
                step.complete
                  ? "border-success/40 text-success"
                  : "border-border text-muted-foreground",
              )}
            >
              {step.complete ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>
            <span
              className={cn(
                "mt-1.5 block text-[9px] leading-3",
                step.complete ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      {["failed", "cancelled"].includes(publication.status) && (
        <p
          className={cn(
            "mt-2 text-center text-[10px] font-medium",
            publication.status === "failed"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {publication.status === "failed"
            ? "Processo com falha registrada"
            : "Agendamento cancelado"}
        </p>
      )}
    </div>
  );
}

export default function EditorialDetailSheet({
  open,
  post,
  clientName,
  projectName,
  responsibleName,
  canEdit,
  canPublish,
  isImpersonating,
  onOpenChange,
  onEdit,
  onCreateRevision,
  onArchived,
}: EditorialDetailSheetProps) {
  const { transitionPublication, archivePost, savePost } = useEditorialMutations();
  // Agendamento inline: conta + data no proprio popup, sem abrir o editor.
  const [inlineAccountId, setInlineAccountId] = useState("");
  const [inlineWhen, setInlineWhen] = useState("");

  /** A publicação agendada deste card, se houver — vira remarcação. */
  const agendadaAtual = useMemo(
    () =>
      post?.publications.find(
        ({ publication }) =>
          publication.status === "scheduled" && publication.scheduled_at,
      ) || null,
    [post],
  );

  // Remarcar começa do estado REAL: conta e horário atuais preenchidos.
  // Campos vazios num card já agendado davam a impressão de agendar do zero
  // — e era um passo a mais para quem só quer empurrar o horário.
  useEffect(() => {
    if (!open) return;
    if (agendadaAtual) {
      setInlineAccountId(agendadaAtual.publication.external_account_id || "");
      setInlineWhen(
        isoUtcToZonedDateTimeLocal(
          agendadaAtual.publication.scheduled_at!,
          EDITORIAL_DEFAULT_TIME_ZONE,
        ) || "",
      );
    } else {
      setInlineAccountId("");
      setInlineWhen("");
    }
  }, [open, agendadaAtual]);
  const [inlineSaving, setInlineSaving] = useState(false);
  const editorOptions = useEditorialEditorOptions(
    post?.post.client_id || null,
    post?.post.project_id || null,
    open && post !== null && post.publications.length === 0,
  );
  const inlineAccounts = (editorOptions.data?.accounts || []).filter(
    (account: any) => (account.status || "active") === "active",
  );

  const scheduleInline = async () => {
    if (!post || !inlineAccountId) {
      toast.error("Escolha a conta que vai receber a publicação.");
      return;
    }
    let scheduledAtIso: string | null = null;
    if (inlineWhen) {
      scheduledAtIso = zonedDateTimeLocalToIso(inlineWhen, EDITORIAL_DEFAULT_TIME_ZONE);
      if (!scheduledAtIso) {
        toast.error("Data ou horário inválido. Ajuste e tente de novo.");
        return;
      }
    }
    setInlineSaving(true);
    try {
      // Anti-duplicação: programar de novo NUNCA cria um segundo card. Se o
      // conteúdo já tem publicação viva, ela é reaproveitada (mesmo card,
      // nova conta ou data); só nasce publicação quando não existe nenhuma.
      const fresh = await loadEditorialPostForMutation(
        post.post.id,
        post.post.client_id,
      );
      const active = fresh.publications.find(({ publication }) =>
        ["planned", "scheduled", "failed"].includes(publication.status),
      );
      const hasTerminal = fresh.publications.some(
        ({ publication }) => !["planned", "cancelled"].includes(publication.status),
      );

      if (active && hasTerminal) {
        if (!scheduledAtIso) {
          toast.error(
            "Este conteúdo já está no fluxo de publicação. Informe a nova data e horário para remarcar.",
          );
          return;
        }
        const contaMudou =
          inlineAccountId !== active.publication.external_account_id;
        if (contaMudou && active.publication.status === "scheduled") {
          /* Trocar a CONTA de uma publicação agendada. A transição oficial só
             move a data; o save do caminho aprovado é quem sabe editar uma
             agendada inteira (conta + horário) no MESMO card — ele a volta
             para o plano e re-agenda no fim, tudo numa transação. Antes, a
             única saída era cancelar e criar outra, que é exatamente o
             card duplicado que estamos evitando. */
          const publications = fresh.publications
            .filter(({ publication }) =>
              ["planned", "scheduled"].includes(publication.status),
            )
            .map(({ publication, internal }) => {
              const alvo = publication.id === active.publication.id;
              return {
                id: publication.id,
                idempotency_key:
                  internal?.idempotency_key || crypto.randomUUID(),
                external_account_id: alvo
                  ? inlineAccountId
                  : publication.external_account_id,
                file_id: publication.file_id,
                caption: publication.caption,
                first_comment: publication.first_comment,
                alt_text: publication.alt_text,
                scheduled_at: alvo ? scheduledAtIso : publication.scheduled_at,
                scheduled_timezone: EDITORIAL_DEFAULT_TIME_ZONE,
              };
            });
          await savePost.mutateAsync({
            payload: {
              id: fresh.post.id,
              idempotency_key:
                fresh.internal?.idempotency_key || crypto.randomUUID(),
              mutation_id: crypto.randomUUID(),
              client_id: fresh.post.client_id,
              project_id: fresh.post.project_id,
              primary_file_id: fresh.post.primary_file_id,
              title: fresh.post.title,
              content_type: fresh.post.content_type,
              objective: fresh.post.objective,
              default_caption: fresh.post.default_caption,
              production_status: fresh.post.production_status,
              task_id: fresh.internal?.task_id || null,
              responsible_id: fresh.internal?.responsible_id || null,
              internal_notes: fresh.internal?.internal_notes || null,
              revision_of_post_id: fresh.internal?.revision_of_post_id ?? null,
              publications,
            },
            expectedVersion: fresh.post.version,
          });
          toast.success("Conta e horário atualizados no mesmo card.");
        } else {
          // Só a data mudou (ou a publicação está em falha): a transição
          // oficial resolve sem tocar no resto do plano.
          await transitionPublication.mutateAsync({
            publicationId: active.publication.id,
            action: "schedule",
            expectedVersion: active.publication.version,
            scheduledAt: scheduledAtIso,
            timezone: EDITORIAL_DEFAULT_TIME_ZONE,
          });
          toast.success("Publicação remarcada no mesmo card, sem duplicar.");
        }
      } else if (!active && hasTerminal) {
        toast.info(
          "Este conteúdo já foi publicado. Para publicar de novo, crie um novo conteúdo.",
        );
        return;
      } else {
        // Só publicações planejadas (ou nenhuma): salva o plano COMPLETO,
        // atualizando a existente em vez de cancelar e criar outra - assim a
        // arte e a legenda do plano nunca se perdem.
        const publications: Record<string, unknown>[] = fresh.publications
          .filter(({ publication }) => publication.status === "planned")
          .map(({ publication, internal }) => {
            const isTarget = active?.publication.id === publication.id;
            return {
              id: publication.id,
              idempotency_key: internal?.idempotency_key || crypto.randomUUID(),
              external_account_id: isTarget
                ? inlineAccountId
                : publication.external_account_id,
              file_id: publication.file_id,
              caption: publication.caption,
              first_comment: publication.first_comment,
              alt_text: publication.alt_text,
              scheduled_at: isTarget ? scheduledAtIso : publication.scheduled_at,
              scheduled_timezone: isTarget
                ? EDITORIAL_DEFAULT_TIME_ZONE
                : publication.scheduled_timezone || EDITORIAL_DEFAULT_TIME_ZONE,
            };
          });
        if (!active) {
          publications.push({
            id: null,
            idempotency_key: crypto.randomUUID(),
            external_account_id: inlineAccountId,
            file_id: null,
            caption: fresh.post.default_caption,
            first_comment: null,
            alt_text: null,
            asset_file_ids: [],
            scheduled_at: scheduledAtIso,
            scheduled_timezone: EDITORIAL_DEFAULT_TIME_ZONE,
          });
        }
        await savePost.mutateAsync({
          payload: {
            id: fresh.post.id,
            idempotency_key:
              fresh.internal?.idempotency_key || crypto.randomUUID(),
            mutation_id: crypto.randomUUID(),
            client_id: fresh.post.client_id,
            project_id: fresh.post.project_id,
            primary_file_id: fresh.post.primary_file_id,
            title: fresh.post.title,
            content_type: fresh.post.content_type,
            objective: fresh.post.objective,
            default_caption: fresh.post.default_caption,
            production_status: fresh.post.production_status,
            task_id: fresh.internal?.task_id || null,
            responsible_id: fresh.internal?.responsible_id || null,
            internal_notes: fresh.internal?.internal_notes || null,
            revision_of_post_id: fresh.internal?.revision_of_post_id ?? null,
            publications,
          },
          expectedVersion: fresh.post.version,
        });
        toast.success(
          scheduledAtIso
            ? "Conta e horário definidos. Se o material já estiver aprovado, a publicação sai no horário; se não, sai até 1 hora depois da aprovação."
            : "Conta definida. Agora é só escolher o horário quando quiser.",
        );
      }
      setInlineAccountId("");
      setInlineWhen("");
    } catch (error: unknown) {
      toast.error(
        editorialErrorMessage(error, "Não foi possível programar a publicação."),
      );
    } finally {
      setInlineSaving(false);
    }
  };
  const confirmDialog = useConfirm();
  const isStaff = canEdit || canPublish;
  const sheetQueryClient = useQueryClient();
  const [adminActing, setAdminActing] = useState(false);

  /**
   * Poder total do admin sem sair da agenda: aprova o material de ponta a
   * ponta em um clique (revisão interna, liberação e o aceite do cliente dado
   * fora do painel). Cada passo usa a RPC oficial, então toda trava de
   * segurança continua valendo e tudo fica auditado.
   */
  const adminApproveNow = async (fileId: string | null) => {
    if (!fileId) {
      toast.error("Este conteúdo não tem material vinculado para aprovar.");
      return;
    }
    const proceed = await confirmDialog({
      title: "Aprovar tudo agora?",
      description:
        "Registra em um passo a revisão interna, a liberação e o aceite do cliente (dado no grupo ou fora do painel). Use quando o aceite realmente aconteceu.",
      confirmLabel: "Aprovar tudo",
    });
    if (!proceed) return;
    setAdminActing(true);
    try {
      const freshFile = async () => {
        // A tabela files tem grants por coluna; a equipe lê pela view
        // staff_files_secure (ler direto dava "permission denied for table files").
        const { data, error } = await (supabase as any)
          .from("staff_files_secure")
          .select("id, version, approval_status, agency_approval_status, visibility")
          .eq("id", fileId)
          .single();
        if (error) throw error;
        return data as any;
      };
      let file = await freshFile();
      if (file.approval_status === "rejected") {
        toast.error(
          "Este material foi rejeitado e a decisão é final. Crie uma revisão para aprovar a nova versão.",
        );
        return;
      }
      // Disponibilizado ao cliente = aprovado pela regra da casa: nada a fazer.
      if (
        file.visibility === "client_shared" &&
        file.agency_approval_status === "approved"
      ) {
        toast.success(
          "Este material já foi disponibilizado ao cliente e conta como aprovado. Já pode agendar ou concluir.",
        );
        await sheetQueryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
        return;
      }
      if (file.agency_approval_status === "not_requested") {
        await requestFileAgencyReview(fileId);
        file = await freshFile();
      }
      if (file.agency_approval_status !== "approved") {
        await reviewFileAgency(fileId, "approved");
        file = await freshFile();
      }
      if (file.visibility !== "approval") {
        await releaseFileToClient(fileId, "approval");
        file = await freshFile();
      }
      if (file.approval_status !== "approved") {
        await recordOfflineClientApproval(fileId, Number(file.version ?? 1), "grupo");
      }
      toast.success("Material aprovado de ponta a ponta. Já pode agendar ou concluir.");
      await sheetQueryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
    } catch (error: unknown) {
      toast.error(
        editorialErrorMessage(error, "Não foi possível aprovar agora."),
      );
    } finally {
      setAdminActing(false);
    }
  };

  /**
   * Concluir o conteúdo INTEIRO, funcione como for:
   * - com publicações pendentes, conclui todas;
   * - sem nenhuma publicação criada, cria uma na hora (com a conta do
   *   cliente) e conclui em seguida. Era o caso em que o card abria sem
   *   nenhum botão e nada podia ser feito.
   */
  const adminConcludePost = async () => {
    if (!post) return;
    const concludable = post.publications.filter(({ publication }) =>
      ["planned", "scheduled", "failed"].includes(publication.status),
    );
    if (concludable.length > 0) {
      for (const bundle of concludable) {
        await adminConcludeNow(bundle);
      }
      return;
    }
    if (post.publications.length > 0) {
      toast.info("As publicações deste conteúdo já estão publicadas ou canceladas.");
      return;
    }

    // Sem publicação criada: cria com a conta do cliente e conclui.
    const accountId =
      inlineAccountId || (inlineAccounts.length === 1 ? inlineAccounts[0].id : "");
    if (!accountId) {
      toast.error(
        inlineAccounts.length === 0
          ? "Conecte ou cadastre a conta do cliente para concluir por aqui."
          : "Escolha a conta no bloco Programar publicação logo abaixo e toque em Concluir de novo.",
      );
      return;
    }
    setAdminActing(true);
    try {
      // Versão fresca também aqui: evita o recuso por versão antiga.
      const current = await loadEditorialPostForMutation(
        post.post.id,
        post.post.client_id,
      );
      await savePost.mutateAsync({
        payload: {
          id: post.post.id,
          idempotency_key:
            (post as any).internal?.idempotency_key || crypto.randomUUID(),
          mutation_id: crypto.randomUUID(),
          client_id: post.post.client_id,
          project_id: post.post.project_id,
          primary_file_id: post.post.primary_file_id,
          title: post.post.title,
          content_type: post.post.content_type,
          objective: post.post.objective,
          default_caption: post.post.default_caption,
          production_status: post.post.production_status,
          task_id: (post as any).internal?.task_id || null,
          responsible_id: (post as any).internal?.responsible_id || null,
          internal_notes: (post as any).internal?.internal_notes || null,
          revision_of_post_id: null,
          publications: [
            {
              id: null,
              idempotency_key: crypto.randomUUID(),
              external_account_id: accountId,
              file_id: null,
              caption: post.post.default_caption,
              first_comment: null,
              alt_text: null,
              asset_file_ids: [],
              // Alguns minutos à frente para passar em qualquer validação de
              // horário; a baixa logo abaixo marca o publicado real.
              scheduled_at: new Date(Date.now() + 2 * 60_000).toISOString(),
              scheduled_timezone: EDITORIAL_DEFAULT_TIME_ZONE,
            },
          ],
        },
        expectedVersion: current.post.version,
      });

      // Releitura pelo caminho oficial (mesma trilha blindada do calendário).
      const freshBundle = await loadEditorialPostForMutation(
        post.post.id,
        post.post.client_id,
      );
      const pending = freshBundle.publications.filter(({ publication }) =>
        ["planned", "scheduled", "failed"].includes(publication.status),
      );
      for (const { publication } of pending) {
        await transitionPublication.mutateAsync({
          publicationId: publication.id,
          action: "publish",
          expectedVersion: publication.version,
          permalink: publication.permalink || "https://www.instagram.com/",
          publishedAt: new Date().toISOString(),
        });
      }
      toast.success("Concluído: publicação registrada e contada no painel.");
    } catch (error: unknown) {
      const message = editorialErrorMessage(error, "Não foi possível concluir.");
      toast.error(
        /approved|publishable|ready|immutable/i.test(message)
          ? "O material ainda não está aprovado. Use Aprovar tudo agora primeiro."
          : message,
      );
    } finally {
      setAdminActing(false);
    }
  };

  /**
   * Concluir agora: marca a publicação como publicada para o painel somar,
   * mesmo sem o link real (entra um link padrão, editável depois).
   */
  const adminConcludeNow = async (bundle: EditorialPublicationBundle) => {
    setAdminActing(true);
    try {
      // Versão fresca antes de agir: a tela pode estar segurando uma versão
      // antiga e o banco recusaria por segurança (o famoso "só funciona na
      // segunda tentativa").
      const fresh = await loadEditorialPostForMutation(
        post!.post.id,
        post!.post.client_id,
      );
      const target = fresh.publications.find(
        ({ publication }) => publication.id === bundle.publication.id,
      );
      if (!target || !["planned", "scheduled", "failed"].includes(target.publication.status)) {
        toast.info("Esta publicação já foi concluída ou cancelada.");
        return;
      }
      await transitionPublication.mutateAsync({
        publicationId: target.publication.id,
        action: "publish",
        expectedVersion: target.publication.version,
        permalink: target.publication.permalink || "https://www.instagram.com/",
        publishedAt: new Date().toISOString(),
      });
      toast.success("Concluído: o painel já conta esta publicação como no ar.");
    } catch (error: unknown) {
      const message =
        (error as { message?: string } | null)?.message || "Não foi possível concluir.";
      toast.error(
        /approved|publishable|ready|immutable/i.test(message)
          ? "O material ainda não está aprovado. Use Aprovar tudo agora primeiro."
          : message,
      );
    } finally {
      setAdminActing(false);
    }
  };
  const {
    data: events,
    isLoading: loadingEvents,
    isError: eventsFailed,
    error: eventsError,
    refetch: refetchEvents,
  } = useEditorialPostEvents(
    post?.post.id || null,
    open && isStaff && !isImpersonating,
  );
  const [actionTarget, setActionTarget] =
    useState<EditorialPublicationBundle | null>(null);
  const [action, setAction] = useState<PublicationAction | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [permalink, setPermalink] = useState("");
  const [externalPostId, setExternalPostId] = useState("");
  const [failureCode, setFailureCode] = useState("");
  const [failureReason, setFailureReason] = useState("");

  useEffect(() => {
    if (!open) {
      setActionTarget(null);
      setAction(null);
    }
  }, [open]);

  const aggregateStatus = useMemo(
    () =>
      aggregateEditorialStatus(
        post?.publications.map(({ publication }) => ({
          status: publication.status,
        })) || [],
      ),
    [post],
  );

  if (!post) return null;

  const editable =
    canEdit &&
    !isImpersonating &&
    post.post.production_status !== "archived" &&
    post.publications.every(({ publication }) =>
      ["planned", "cancelled"].includes(publication.status),
    );
  const approvalFiles = [
    post.primaryFile,
    ...post.publications
      .filter(({ publication }) => publication.status !== "cancelled")
      .map(({ publication, file }) =>
        publication.file_id ? file : null,
      ),
  ].filter(Boolean);
  const canCreateRevision =
    canEdit &&
    !isImpersonating &&
    post.post.production_status !== "archived" &&
    approvalFiles.some((file) => !isFileEditable(file));

  const openAction = (
    publication: EditorialPublicationBundle,
    nextAction: PublicationAction,
  ) => {
    setActionTarget(publication);
    setAction(nextAction);
    setScheduledAt(
      publication.publication.scheduled_at
        ? isoUtcToZonedDateTimeLocal(
            publication.publication.scheduled_at,
            publication.publication.scheduled_timezone,
          ) || ""
        : "",
    );
    setPermalink(publication.publication.permalink || "");
    setExternalPostId(publication.publication.external_post_id || "");
    setFailureCode(publication.internal?.failure_code || "");
    setFailureReason(publication.internal?.failure_reason || "");
  };

  const closeAction = (force = false) => {
    if (transitionPublication.isPending && !force) return;
    setActionTarget(null);
    setAction(null);
  };

  const handleTransition = async () => {
    if (!actionTarget || !action) return;
    const publication = actionTarget.publication;
    let scheduledIso: string | null = null;
    if (action === "schedule") {
      scheduledIso = zonedDateTimeLocalToIso(
        scheduledAt,
        publication.scheduled_timezone || EDITORIAL_DEFAULT_TIME_ZONE,
      );
      if (!scheduledIso) {
        toast.error("Informe uma data e horário válidos.");
        return;
      }
    }
    if (action === "publish" && !/^https?:\/\/\S+$/i.test(permalink.trim())) {
      toast.error("Informe a URL pública da publicação.");
      return;
    }
    if (action === "fail" && failureReason.trim().length < 5) {
      toast.error("Descreva a falha com pelo menos 5 caracteres.");
      return;
    }

    try {
      await transitionPublication.mutateAsync({
        publicationId: publication.id,
        action,
        expectedVersion: publication.version,
        scheduledAt: scheduledIso,
        timezone: publication.scheduled_timezone,
        permalink: permalink.trim() || null,
        externalPostId: externalPostId.trim() || null,
        failureCode: failureCode.trim() || null,
        failureReason: failureReason.trim() || null,
      });
      toast.success(
        action === "schedule"
          ? "Publicação agendada."
          : action === "publish"
            ? "Publicação confirmada."
            : action === "fail"
              ? "Falha registrada."
              : action === "cancel"
                ? "Publicação cancelada."
                : "Publicação reaberta.",
      );
      closeAction(true);
    } catch (error: unknown) {
      // A mensagem crua do banco vem em inglês técnico e, quando o erro não
      // era instância de Error, o texto genérico engolia até a causa. O
      // tradutor devolve o que aconteceu E o que fazer.
      toast.error(
        editorialErrorMessage(error, "Não foi possível atualizar a publicação."),
      );
    }
  };

  const handleArchive = async () => {
    // Apagar em um passo: cancela agendamentos pendentes e arquiva.
    const scheduledCount = post.publications.filter(
      ({ publication }) => publication.status === "scheduled",
    ).length;
    const proceed = await confirmDialog({
      title: "Apagar este conteúdo do calendário?",
      description:
        scheduledCount > 0
          ? `Ele tem ${scheduledCount} publicação(ões) agendada(s), que serão canceladas junto. Nada é publicado depois disso e o histórico fica preservado.`
          : "Ele sai do calendário ativo, mas o histórico fica preservado.",
      confirmLabel: scheduledCount > 0 ? "Cancelar e apagar" : "Apagar",
      destructive: true,
    });
    if (!proceed) return;

    try {
      // O bug do "apagar não funciona": a tela segurava uma VERSÃO antiga do
      // conteúdo e o banco recusava por segurança na primeira tentativa (na
      // segunda, já atualizada, ia). Agora a versão fresca é buscada na hora,
      // então funciona de primeira, sempre.
      const fresh = await loadEditorialPostForMutation(
        post.post.id,
        post.post.client_id,
      );
      for (const bundle of fresh.publications) {
        if (bundle.publication.status !== "scheduled") continue;
        await transitionPublication.mutateAsync({
          publicationId: bundle.publication.id,
          action: "cancel",
          expectedVersion: bundle.publication.version,
          scheduledAt: null,
          timezone: bundle.publication.scheduled_timezone,
          permalink: null,
          externalPostId: null,
          failureCode: null,
          failureReason: "Conteúdo removido do calendário pela equipe.",
          deferRefresh: true,
        });
      }
      // Cancelamentos podem ter avançado a versão do conteúdo: relê antes de
      // arquivar para o passo final também ir de primeira.
      const latest = await loadEditorialPostForMutation(
        post.post.id,
        post.post.client_id,
      );
      await archivePost.mutateAsync({
        postId: latest.post.id,
        expectedVersion: latest.post.version,
      });
      toast.success("Conteúdo removido do calendário.");
      onArchived();
    } catch (error: unknown) {
      // Erro do banco não é instanceof Error: extrai a mensagem de qualquer jeito.
      const message =
        (error as { message?: string } | null)?.message ||
        "Não foi possível apagar o conteúdo.";
      toast.error(
        /version|vers[aã]o|changed/i.test(message)
          ? "O conteúdo mudou agora mesmo em outra tela. Tente de novo que vai."
          : message,
      );
    }
  };

  const aggregateConfig = EDITORIAL_STATUS_CONFIG[aggregateStatus];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="inset-x-0 bottom-0 top-auto mx-auto flex h-[92dvh] w-full max-w-4xl flex-col gap-0 overflow-hidden rounded-t-2xl border border-border p-0 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:h-[88dvh] sm:max-h-[88dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl data-[state=open]:animate-in data-[state=closed]:animate-out"
        >
          <SheetHeader className="shrink-0 border-b border-border bg-card px-5 py-4 text-left sm:px-7 sm:py-5">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div className="min-w-0">
                <SheetTitle className="truncate text-base sm:text-lg">{post.post.title}</SheetTitle>
                <SheetDescription className="mt-1 text-xs">
                  {clientName} · {projectName}
                </SheetDescription>
              </div>
              <Badge
                variant="outline"
                className="shrink-0"
                style={{
                  borderColor: `${aggregateConfig.color}55`,
                  backgroundColor: `${aggregateConfig.color}18`,
                  color: aggregateConfig.color,
                }}
              >
                {aggregateConfig.label}
              </Badge>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            <section className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Formato
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {post.post.content_type}
                </p>
              </div>
              {isStaff && post.internal?.responsible_id && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Responsável
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {responsibleName ||
                      `Usuário ${post.internal.responsible_id.slice(0, 8)}`}
                  </p>
                </div>
              )}
              {isStaff && post.internal?.task_id && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Tarefa vinculada
                  </p>
                  <Button
                    type="button"
                    variant="link"
                    className="mt-1 h-auto p-0 text-sm"
                    asChild
                  >
                    <Link to={`/kanban?task=${post.internal.task_id}`}>
                      Abrir no Kanban
                    </Link>
                  </Button>
                </div>
              )}
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Produção
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {PRODUCTION_STATUS_LABELS[
                    post.post
                      .production_status as EditorialProductionStatus
                  ] || post.post.production_status}
                </p>
              </div>
              {post.post.objective && (
                <div className="sm:col-span-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Objetivo
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                    {post.post.objective}
                  </p>
                </div>
              )}
              {post.post.default_caption && (
                <div className="sm:col-span-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Legenda base
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                    {post.post.default_caption}
                  </p>
                </div>
              )}
              {isStaff && post.internal?.revision_of_post_id && (
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    asChild
                  >
                    <Link
                      to={`/calendario?content=${post.internal.revision_of_post_id}`}
                    >
                      Abrir conteúdo de origem desta revisão
                    </Link>
                  </Button>
                </div>
              )}
              {isStaff && post.internal?.internal_notes && (
                <div className="rounded-lg border border-warning/20 bg-warning/5 p-3 sm:col-span-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-warning">
                    Nota interna
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                    {post.internal.internal_notes}
                  </p>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Arquivo principal e aprovação
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {post.primaryFile?.file_name ||
                      "Nenhum arquivo principal vinculado"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    isFilePublishable(post.primaryFile)
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-warning/30 bg-warning/10 text-warning"
                  }
                >
                  <FileCheck2 className="mr-1 h-3 w-3" />
                  {isFilePublishable(post.primaryFile)
                    ? "Principal aprovado"
                    : "Aprovação pendente"}
                </Badge>
              </div>
              {isStaff && !isFilePublishable(post.primaryFile) && (
                <Button
                  type="button"
                  variant="link"
                  className="mt-2 h-auto p-0 text-xs"
                  asChild
                >
                  <Link
                    to={`/aprovacoes?client=${post.post.client_id}`}
                    onClick={() => onOpenChange(false)}
                  >
                    Abrir Aprovações
                  </Link>
                </Button>
              )}
              {post.primaryFile && (
                <div className="mt-4 overflow-hidden rounded-xl border border-border bg-muted/20 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Conteúdo principal aprovado
                  </p>
                  <CarouselSlider
                    parent={{
                      id: post.primaryFile.id,
                      file_name: post.primaryFile.file_name,
                      file_url: post.primaryFile.file_url || "",
                      storage_bucket: post.primaryFile.storage_bucket,
                      storage_path: post.primaryFile.storage_path,
                      mime_type: post.primaryFile.mime_type,
                      extension: post.primaryFile.extension,
                      created_at: post.primaryFile.created_at,
                    }}
                    initialChildren={(post.primaryFileChildren || []).map(
                      (file) => ({
                        id: file.id,
                        file_name: file.file_name,
                        file_url: file.file_url || "",
                        storage_bucket: file.storage_bucket,
                        storage_path: file.storage_path,
                        mime_type: file.mime_type,
                        extension: file.extension,
                        created_at: file.created_at,
                      }),
                    )}
                  />
                  {(post.primaryFileChildren?.length || 0) > 0 && (
                    <p className="mt-2 text-center text-[10px] text-muted-foreground">
                      Carrossel completo · {1 + post.primaryFileChildren!.length} arquivos na ordem do plano
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Barra de poder do admin: funciona SEMPRE, inclusive quando o
                conteúdo ainda não tem nenhuma publicação criada (antes, nesse
                caso, o card abria sem botão nenhum). */}
            {canPublish && !isImpersonating && (
              <section className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.04] p-3">
                <p className="mr-auto text-[11px] leading-relaxed text-muted-foreground">
                  Ações rápidas do admin, valem para este conteúdo inteiro.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={adminActing || !post.post.primary_file_id}
                  onClick={() => adminApproveNow(post.post.primary_file_id)}
                  title={post.post.primary_file_id ? "Registra revisão, liberação e aceite do cliente em um passo" : "Sem material vinculado para aprovar"}
                >
                  {adminActing ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Aprovar tudo agora
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={adminActing}
                  onClick={() => void adminConcludePost()}
                  title="Marca como publicado para o painel somar. O link pode ser ajustado depois."
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Concluir agora
                </Button>
              </section>
            )}

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  Publicações
                </h3>
                <Badge variant="secondary">{post.publications.length}</Badge>
              </div>

              {post.publications.map((bundle) => {
                const publication = bundle.publication;
                const ready = publicationFileReady(post, bundle);
                const effectiveFile = publication.file_id
                  ? bundle.file
                  : post.primaryFile;
                return (
                  <article
                    key={publication.id}
                    className="space-y-3 rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {PLATFORM_LABELS[
                            publication.platform as EditorialPlatform
                          ] || publication.platform}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {bundle.account?.handle ||
                            bundle.account?.display_name ||
                            "Conta vinculada"}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          publicationStatusClasses[publication.status],
                        )}
                      >
                        {PUBLICATION_STATUS_LABELS[
                          publication.status as EditorialPublicationStatus
                        ] || publication.status}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      {formatDateTime(
                        publication.scheduled_at,
                        publication.scheduled_timezone,
                      )}
                    </div>

                    <PublicationProgress post={post} bundle={bundle} />

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {publication.file_id
                            ? "Arquivo específico"
                            : "Arquivo principal usado"}
                        </p>
                        <p className="mt-1 text-xs text-foreground">
                          {effectiveFile?.file_name ||
                            "Arquivo indisponível"}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          isFilePublishable(effectiveFile)
                            ? "border-success/30 bg-success/10 text-success"
                            : "border-warning/30 bg-warning/10 text-warning"
                        }
                      >
                        {isFilePublishable(effectiveFile)
                          ? "Double-gate aprovado"
                          : "Aprovação pendente"}
                      </Badge>
                    </div>

                    {publication.file_id && effectiveFile && (
                      <div className="overflow-hidden rounded-xl border border-border bg-muted/20 p-3">
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Arquivo usado nesta publicação
                        </p>
                        <CarouselSlider
                          parent={{
                            id: effectiveFile.id,
                            file_name: effectiveFile.file_name,
                            file_url: effectiveFile.file_url || "",
                            storage_bucket: effectiveFile.storage_bucket,
                            storage_path: effectiveFile.storage_path,
                            mime_type: effectiveFile.mime_type,
                            extension: effectiveFile.extension,
                            created_at: effectiveFile.created_at,
                          }}
                          initialChildren={(bundle.fileChildren || []).map(
                            (file) => ({
                              id: file.id,
                              file_name: file.file_name,
                              file_url: file.file_url || "",
                              storage_bucket: file.storage_bucket,
                              storage_path: file.storage_path,
                              mime_type: file.mime_type,
                              extension: file.extension,
                              created_at: file.created_at,
                            }),
                          )}
                        />
                        {(bundle.fileChildren?.length || 0) > 0 && (
                          <p className="mt-2 text-center text-[10px] text-muted-foreground">
                            Carrossel completo · {1 + bundle.fileChildren!.length} arquivos na ordem agendada
                          </p>
                        )}
                      </div>
                    )}

                    {publication.caption && (
                      <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs text-foreground">
                        {publication.caption}
                      </p>
                    )}
                    {publication.first_comment && (
                      <div className="rounded-lg bg-muted/40 p-3">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Primeiro comentário
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                          {publication.first_comment}
                        </p>
                      </div>
                    )}
                    {publication.alt_text && (
                      <div className="rounded-lg bg-muted/40 p-3">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Texto alternativo
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                          {publication.alt_text}
                        </p>
                      </div>
                    )}

                    {isStaff && <PublicationDeliveryStatus publicationId={publication.id} />}

                    {/* Falha do motor já aparece no bloco acima; repetir o
                        mesmo texto aqui era o card com "duas falhas". Este
                        bloco fica só para falha registrada manualmente. */}
                    {isStaff &&
                      bundle.internal?.failure_reason &&
                      bundle.internal?.failure_code !== "autopublish" && (
                      <div className="flex gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        <div>
                          <p className="text-xs font-medium text-destructive">
                            {bundle.internal.failure_code || "Falha"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {bundle.internal.failure_reason}
                          </p>
                        </div>
                      </div>
                    )}

                    {publication.permalink && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        asChild
                      >
                        <a
                          href={publication.permalink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          Ver publicação
                        </a>
                      </Button>
                    )}

                    {canPublish && !isImpersonating && (
                      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                        {/* Poder total do admin, sem sair da agenda. */}
                        {!ready && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={adminActing}
                            onClick={() =>
                              adminApproveNow(
                                publication.file_id || post.post.primary_file_id,
                              )
                            }
                          >
                            {adminActing ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Aprovar tudo agora
                          </Button>
                        )}
                        {["planned", "scheduled", "failed"].includes(publication.status) && (
                          <Button
                            type="button"
                            size="sm"
                            variant={ready ? "default" : "outline"}
                            disabled={adminActing}
                            onClick={() => void adminConcludeNow(bundle)}
                            title="Marca como publicado para o painel somar. O link pode ser ajustado depois."
                          >
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            Concluir agora
                          </Button>
                        )}
                        {["planned", "scheduled"].includes(
                          publication.status,
                        ) && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!ready}
                            onClick={() => openAction(bundle, "schedule")}
                            title={
                              ready
                                ? "Agendar publicação"
                                : "Finalize produção e aprovações primeiro"
                            }
                          >
                            <CalendarCheck2 className="mr-1.5 h-3.5 w-3.5" />
                            {publication.status === "scheduled"
                              ? "Reagendar"
                              : "Agendar"}
                          </Button>
                        )}
                        {publication.status === "scheduled" && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={!ready}
                            onClick={() => openAction(bundle, "publish")}
                          >
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            Confirmar publicação
                          </Button>
                        )}
                        {publication.status === "scheduled" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openAction(bundle, "fail")}
                          >
                            <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                            Registrar falha
                          </Button>
                        )}
                        {publication.status !== "published" &&
                          publication.status !== "cancelled" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => openAction(bundle, "cancel")}
                            >
                              <XCircle className="mr-1.5 h-3.5 w-3.5" />
                              Cancelar
                            </Button>
                          )}
                        {["failed", "cancelled"].includes(
                          publication.status,
                        ) && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => openAction(bundle, "reopen")}
                          >
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                            Reabrir
                          </Button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}

              {post.publications.length === 0 && (
                <div className="rounded-xl border border-dashed border-primary/40 bg-primary/[0.04] p-4 sm:p-5">
                  <p className="text-[13px] font-medium text-foreground">
                    {agendadaAtual ? "Remarcar publicação" : "Programar publicação"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {agendadaAtual
                      ? "Já agendada — mude a conta ou o horário e confirme: atualiza no mesmo card, sem duplicar."
                      : "Escolha a conta e o horário aqui mesmo. Se o material já estiver aprovado, sai no horário marcado; se ainda não estiver, sai até 1 hora depois da aprovação."}
                  </p>
                  {canEdit && !isImpersonating && (
                    <div className="mt-3 space-y-2.5">
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Conta</Label>
                        <select
                          value={inlineAccountId}
                          onChange={(event) => setInlineAccountId(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:border-primary/50 focus:outline-none"
                        >
                          <option value="">
                            {editorOptions.isLoading
                              ? "Carregando contas..."
                              : inlineAccounts.length === 0
                                ? "Nenhuma conta cadastrada para este cliente"
                                : "Escolha o perfil que recebe a publicação"}
                          </option>
                          {inlineAccounts.map((account: any) => (
                            <option key={account.id} value={account.id}>
                              {account.display_name}
                              {account.handle ? ` (${account.handle})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Data e horário</Label>
                        <Input
                          type="datetime-local"
                          value={inlineWhen}
                          onChange={(event) => setInlineWhen(event.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="w-full sm:w-auto"
                        disabled={inlineSaving || !inlineAccountId}
                        onClick={() => void scheduleInline()}
                      >
                        {inlineSaving ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CalendarCheck2 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {agendadaAtual ? "Remarcar" : "Programar"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {isStaff && !isImpersonating && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">
                    Histórico
                  </h3>
                </div>
                {loadingEvents ? (
                  <div className="flex h-20 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : eventsFailed ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                  >
                    <p className="text-xs font-medium text-destructive">
                      Não foi possível carregar o histórico.
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {eventsError instanceof Error
                        ? eventsError.message
                        : "Atualize e tente novamente."}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => refetchEvents()}
                    >
                      Tentar novamente
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(events || []).map((event) => (
                      <div
                        key={event.id}
                        className="flex gap-3 rounded-lg border border-border p-3"
                      >
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground">
                            {eventLabels[event.event_type] ||
                              event.event_type}
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {new Intl.DateTimeFormat("pt-BR", {
                              dateStyle: "short",
                              timeStyle: "short",
                              timeZone:
                                Intl.DateTimeFormat().resolvedOptions()
                                  .timeZone,
                            }).format(new Date(event.created_at))}
                            {event.from_status || event.to_status
                              ? ` · ${event.from_status || "-"} → ${event.to_status || "-"}`
                              : ""}
                          </p>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Por{" "}
                            {event.actor_name ||
                              (event.actor_id
                                ? `usuário ${event.actor_id.slice(0, 8)}`
                                : "sistema")}
                          </p>
                        </div>
                      </div>
                    ))}
                    {(events || []).length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Nenhum evento registrado.
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>

          {(editable || canCreateRevision || (canPublish && !isImpersonating)) && (
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background py-4">
              {canPublish && !isImpersonating && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={archivePost.isPending || transitionPublication.isPending}
                  title="Apagar do calendário (agendamentos pendentes são cancelados junto)"
                  onClick={handleArchive}
                >
                  {archivePost.isPending || transitionPublication.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Archive className="mr-1.5 h-4 w-4" />
                  )}
                  Apagar
                </Button>
              )}
              <div className="flex flex-wrap justify-end gap-2">
              {canCreateRevision && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onCreateRevision(post)}
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  Criar revisão
                </Button>
              )}
              {editable && (
                <Button type="button" onClick={() => onEdit(post)}>
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Editar conteúdo
                </Button>
              )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!actionTarget && !!action} onOpenChange={closeAction}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "schedule"
                ? "Agendar publicação"
                : action === "publish"
                  ? "Confirmar publicação"
                  : action === "fail"
                    ? "Registrar falha"
                    : action === "cancel"
                      ? "Cancelar publicação"
                      : "Reabrir publicação"}
            </DialogTitle>
            <DialogDescription>
              Esta ação será registrada no histórico. Nenhuma plataforma
              externa é acionada automaticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {action === "schedule" && (
              <div className="space-y-2">
                <Label htmlFor="publication-schedule-at">
                  Data e horário
                </Label>
                <Input
                  id="publication-schedule-at"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                />
              </div>
            )}
            {action === "publish" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="publication-permalink">
                    URL pública
                  </Label>
                  <Input
                    id="publication-permalink"
                    type="url"
                    value={permalink}
                    onChange={(event) => setPermalink(event.target.value)}
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="publication-external-id">
                    ID externo (opcional)
                  </Label>
                  <Input
                    id="publication-external-id"
                    value={externalPostId}
                    onChange={(event) =>
                      setExternalPostId(event.target.value)
                    }
                  />
                </div>
              </>
            )}
            {action === "fail" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="publication-failure-code">
                    Código (opcional)
                  </Label>
                  <Input
                    id="publication-failure-code"
                    value={failureCode}
                    onChange={(event) => setFailureCode(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="publication-failure-reason">Motivo</Label>
                  <Textarea
                    id="publication-failure-reason"
                    value={failureReason}
                    onChange={(event) => setFailureReason(event.target.value)}
                    rows={4}
                  />
                </div>
              </>
            )}
            {(action === "cancel" || action === "reopen") && (
              <p className="text-sm text-muted-foreground">
                {action === "cancel"
                  ? "O registro permanece no histórico e pode ser reaberto depois."
                  : "A publicação volta ao estado planejado para ser revisada."}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => closeAction()}
              disabled={transitionPublication.isPending}
            >
              Voltar
            </Button>
            <Button
              type="button"
              onClick={handleTransition}
              disabled={transitionPublication.isPending}
              variant={action === "cancel" ? "destructive" : "default"}
            >
              {transitionPublication.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
