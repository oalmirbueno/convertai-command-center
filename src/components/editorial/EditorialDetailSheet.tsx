import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AjudaRecolhida, MenuMais, Secao, campo, juntar, superficie, texto } from "@/components/sistema";
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
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { Textarea } from "@/components/ui/textarea";
import CarouselSlider from "@/components/shared/CarouselSlider";
import { PublicacaoDaMesaNaAgenda } from "@/components/mesa/PublicacaoDaPeca";
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
import { entregaDaArteAprovada } from "@/lib/editorialEntregaAprovada";
import {
  AUTOPUBLISH_STAGE_LABELS,
  retryAutopublish,
  useAutopublishStatus,
} from "@/hooks/useAutopublishStatus";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  aprovarPeloCliente,
  motivoDaRecusaDaAprovacao,
  NOTA_DO_AVAL,
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
  /** Endereço da Mesa (estúdio deste item); só vem para admin, gestor e design. */
  mesaHref?: string | null;
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
export function PublicationDeliveryStatus({ publicationId }: { publicationId: string }) {
  const queryClient = useQueryClient();
  const { data } = useAutopublishStatus(publicationId);
  const [retrying, setRetrying] = useState(false);
  if (!data) return null;

  const failed = data.stage === "failed";
  const done = data.stage === "done";
  const cancelled = data.stage === "cancelled";
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
      ) : cancelled ? (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      ) : done ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
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
        {(failed || cancelled) && data.last_error && (
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
    <div className={juntar(superficie.poco, "p-3")}>
      <p className={texto.rotulo}>
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
                "mt-1.5 block text-[11px] leading-4",
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
            "mt-2 text-center text-[11px] font-medium",
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
  mesaHref = null,
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
  /**
   * Frente AP (28/09, bug do dono: "não deixa selecionar o Instagram, a conta
   * correta, nem a data"): o post que veio do Estúdio nasce com publicação
   * PLANEJADA, e o "Programar publicação" só aparecia sem publicação nenhuma.
   * Agora aparece também quando o plano todo ainda é só planejado (nada
   * agendado, publicado ou em falha), com a conta e a data dela.
   */
  const planejadaDoPlano = useMemo(
    () => post?.publications.find(({ publication }) => publication.status === "planned") || null,
    [post],
  );
  const podeProgramarInline =
    !!post &&
    !post.publicadoGlobal &&
    (post.publications.length === 0 ||
      post.publications.every(({ publication }) => publication.status === "planned" || publication.status === "cancelled"));

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
    } else if (planejadaDoPlano) {
      // Frente AP (28/09): post que veio do Estúdio já nasce com a publicação
      // planejada. Abre com a conta e a data dela, e dá para trocar as duas.
      setInlineAccountId(planejadaDoPlano.publication.external_account_id || "");
      setInlineWhen(
        planejadaDoPlano.publication.scheduled_at
          ? isoUtcToZonedDateTimeLocal(planejadaDoPlano.publication.scheduled_at, EDITORIAL_DEFAULT_TIME_ZONE) || ""
          : "",
      );
    } else {
      setInlineAccountId("");
      setInlineWhen("");
    }
  }, [open, agendadaAtual, planejadaDoPlano]);
  const [inlineSaving, setInlineSaving] = useState(false);
  const editorOptions = useEditorialEditorOptions(
    post?.post.client_id || null,
    post?.post.project_id || null,
    open && post !== null && podeProgramarInline,
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
        // Frente AP: arte já aprovada + data = vai com as lâminas na ordem e
        // o modo de entrega, e o caminho aprovado agenda na hora (sem isto o
        // post do Estúdio ia "manual", sem lâminas, e o motor não publicava).
        const entregaAprovada = scheduledAtIso
          ? await entregaDaArteAprovada(fresh, inlineAccountId, editorOptions.data?.accounts || [])
          : null;
        const publications: Record<string, unknown>[] = fresh.publications
          .filter(({ publication }) => publication.status === "planned")
          .map(({ publication, internal }) => {
            const isTarget = active?.publication.id === publication.id;
            return {
              ...(isTarget && entregaAprovada ? entregaAprovada : {}),
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
   * ponta em um clique, pelo cliente (frente EN, 28/09: "o cliente está
   * ocupado e pede para eu aprovar; aprovo valendo pelo cliente e por mim").
   * Uma RPC só no banco (aprovar_pelo_cliente): revisão da agência, liberação
   * e o aval do cliente dado ao admin (canal "equipe"), com as travas de
   * sempre e tudo auditado. O cliente vê no histórico "Aprovado por <nome>
   * em nome do cliente". Só admin e gestor.
   */
  const adminApproveNow = async (fileId: string | null) => {
    if (!fileId) {
      toast.error("Este conteúdo não tem material vinculado para aprovar.");
      return;
    }
    const proceed = await confirmDialog({
      title: "Aprovar pelo cliente?",
      description:
        "O cliente deu o aval para você aprovar. Registra em um passo a revisão interna, a liberação e a aprovação em nome dele; no histórico dele fica \"aprovado por você em nome do cliente\". Depois é só programar a publicação.",
      confirmLabel: "Aprovar tudo",
    });
    if (!proceed) return;
    setAdminActing(true);
    try {
      const r = await aprovarPeloCliente(fileId, NOTA_DO_AVAL);
      if (r?.estado === "disponivel") {
        toast.success(
          "Este material já foi disponibilizado ao cliente e conta como aprovado. Já pode agendar ou concluir.",
        );
      } else if (r?.estado === "ja_aprovado") {
        toast.success("Este material já estava aprovado. Já pode programar a publicação.");
      } else {
        toast.success("Aprovado pelo cliente. Já pode programar a publicação.");
      }
      await sheetQueryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
      await sheetQueryClient.invalidateQueries({ queryKey: ["all-files"] });
    } catch (error: unknown) {
      toast.error(motivoDaRecusaDaAprovacao(error));
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
      {/* Janela central (30/09, dono: "qualquer pop-up abrir no centro e não
          na lateral"): no celular ocupa a tela; o corpo rola e o pé fica parado. */}
      <JanelaCentral
        aberta={open}
        onMudar={onOpenChange}
        largura="xl"
        corpo="fixo"
        semEspaco
        titulo={<span title={post.post.title}>{post.post.title}</span>}
        descricao={`${clientName} · ${projectName}`}
        acoes={
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
        }
      >
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            {/* Frente EA: post que veio de uma entrega do Estúdio mostra a
                publicação da peça e o mesmo "Publicar em" da Entrega. */}
            {isStaff && !isImpersonating && (
              <PublicacaoDaMesaNaAgenda
                postId={post.post.id}
                clientId={post.post.client_id}
                titulo={post.post.title}
                publicacoes={post.publications.map(({ publication }) => ({
                  id: publication.id,
                  status: publication.status,
                  platform: publication.platform,
                  scheduled_at: publication.scheduled_at,
                  published_at: publication.published_at,
                  permalink: publication.permalink,
                }))}
                podePublicar={canPublish}
              />
            )}
            <section className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className={texto.rotulo}>
                  Formato
                </p>
                <p className="mt-1 text-[13px] text-foreground">
                  {post.post.content_type}
                </p>
              </div>
              {isStaff && post.internal?.responsible_id && (
                <div>
                  <p className={texto.rotulo}>
                    Responsável
                  </p>
                  <p className="mt-1 text-[13px] text-foreground">
                    {responsibleName ||
                      `Usuário ${post.internal.responsible_id.slice(0, 8)}`}
                  </p>
                </div>
              )}
              {isStaff && post.internal?.task_id && (
                <div>
                  <p className={texto.rotulo}>
                    Tarefa vinculada
                  </p>
                  <Button
                    type="button"
                    variant="link"
                    className="mt-1 h-auto p-0 text-[13px]"
                    asChild
                  >
                    <Link to={`/kanban?task=${post.internal.task_id}`}>
                      Abrir no Kanban
                    </Link>
                  </Button>
                  {mesaHref && !isImpersonating && (
                    <Button
                      type="button"
                      variant="link"
                      className="ml-3 mt-1 h-auto p-0 text-[13px]"
                      asChild
                    >
                      <Link to={mesaHref}>Mesa</Link>
                    </Button>
                  )}
                </div>
              )}
              <div>
                <p className={texto.rotulo}>
                  Produção
                </p>
                <p className="mt-1 text-[13px] text-foreground">
                  {PRODUCTION_STATUS_LABELS[
                    post.post
                      .production_status as EditorialProductionStatus
                  ] || post.post.production_status}
                </p>
              </div>
              {post.post.objective && (
                <div className="sm:col-span-2">
                  <p className={texto.rotulo}>
                    Objetivo
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground">
                    {post.post.objective}
                  </p>
                </div>
              )}
              {post.post.default_caption && (
                <div className="sm:col-span-2">
                  <p className={texto.rotulo}>
                    Legenda base
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground">
                    {post.post.default_caption}
                  </p>
                </div>
              )}
              {isStaff && post.internal?.revision_of_post_id && (
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-[12px]"
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
                <div className="rounded-md bg-warning/5 p-3 sm:col-span-2">
                  <p className="text-[12px] font-medium text-warning">
                    Nota interna
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground">
                    {post.internal.internal_notes}
                  </p>
                </div>
              )}
            </section>

            <Secao
              titulo="Arquivo principal e aprovação"
              nivel={3}
              divisoria
              descricao={post.primaryFile?.file_name || "Nenhum arquivo principal vinculado"}
              acao={
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
              }
            >
              {isStaff && !isFilePublishable(post.primaryFile) && (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-[12px]"
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
                <div className="mt-3 overflow-hidden">
                  <p className={juntar(texto.rotulo, "mb-2")}>
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
                    <p className="mt-2 text-center text-[11px] text-muted-foreground">
                      Carrossel completo · {1 + post.primaryFileChildren!.length} arquivos na ordem do plano
                    </p>
                  )}
                </div>
              )}
            </Secao>

            {/* Barra de poder do admin: funciona SEMPRE, inclusive quando o
                conteúdo ainda não tem nenhuma publicação criada (antes, nesse
                caso, o card abria sem botão nenhum). */}
            {canPublish && !isImpersonating && (
              <section className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
                <div className="mr-auto flex min-w-0 items-center">
                  <p className={juntar(texto.rotulo, "truncate")}>Ações do admin</p>
                  <AjudaRecolhida className="ml-1.5" rotulo="Sobre as ações do admin">
                    Ações rápidas do admin, valem para este conteúdo inteiro.
                  </AjudaRecolhida>
                </div>
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
                  variant="outline"
                  disabled={adminActing}
                  onClick={() => void adminConcludePost()}
                  title="Marca como publicado para o painel somar. O link pode ser ajustado depois."
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Concluir agora
                </Button>
              </section>
            )}

            <Secao
              titulo="Publicações"
              nivel={3}
              divisoria
              descricao={`${post.publications.length} ${post.publications.length === 1 ? "publicação" : "publicações"}`}
              corpoClassName="divide-y divide-border"
            >

              {post.publications.map((bundle) => {
                const publication = bundle.publication;
                const ready = publicationFileReady(post, bundle);
                const effectiveFile = publication.file_id
                  ? bundle.file
                  : post.primaryFile;
                return (
                  <article
                    key={publication.id}
                    className="space-y-3 py-4 first:pt-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-medium text-foreground">
                          {PLATFORM_LABELS[
                            publication.platform as EditorialPlatform
                          ] || publication.platform}
                        </p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
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

                    <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      {formatDateTime(
                        publication.scheduled_at,
                        publication.scheduled_timezone,
                      )}
                    </div>

                    <PublicationProgress post={post} bundle={bundle} />

                    <div className={juntar(superficie.poco, "flex flex-wrap items-center justify-between gap-2 p-3")}>
                      <div>
                        <p className={texto.rotulo}>
                          {publication.file_id
                            ? "Arquivo específico"
                            : "Arquivo principal usado"}
                        </p>
                        <p className="mt-1 text-[12px] text-foreground">
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
                      <div className="overflow-hidden">
                        <p className={juntar(texto.rotulo, "mb-2")}>
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
                          <p className="mt-2 text-center text-[11px] text-muted-foreground">
                            Carrossel completo · {1 + bundle.fileChildren!.length} arquivos na ordem agendada
                          </p>
                        )}
                      </div>
                    )}

                    {publication.caption && (
                      <p className={juntar(superficie.poco, "whitespace-pre-wrap p-3 text-[12px] text-foreground")}>
                        {publication.caption}
                      </p>
                    )}
                    {publication.first_comment && (
                      <div className={juntar(superficie.poco, "p-3")}>
                        <p className={texto.rotulo}>
                          Primeiro comentário
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-foreground">
                          {publication.first_comment}
                        </p>
                      </div>
                    )}
                    {publication.alt_text && (
                      <div className={juntar(superficie.poco, "p-3")}>
                        <p className={texto.rotulo}>
                          Texto alternativo
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-foreground">
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

                    {canPublish && !isImpersonating && (() => {
                      // Um primário por estado (SISTEMA.md seção 6): a ação que
                      // anda com a publicação fica à vista, a segunda ao lado e
                      // o resto no "...". Nenhuma função saiu.
                      const status = publication.status;
                      const acoes: Array<{
                        chave: string;
                        rotulo: string;
                        icone: ReactNode;
                        aoEscolher: () => void;
                        desativado?: boolean;
                        dica?: string;
                        perigo?: boolean;
                      }> = [];
                      if (!ready) {
                        acoes.push({
                          chave: "aprovar",
                          rotulo: "Aprovar tudo agora",
                          icone: adminActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCheck2 className="h-3.5 w-3.5" />,
                          desativado: adminActing,
                          aoEscolher: () => adminApproveNow(publication.file_id || post.post.primary_file_id),
                        });
                      }
                      if (status === "scheduled") {
                        acoes.push({
                          chave: "publicar",
                          rotulo: "Confirmar publicação",
                          icone: <CheckCircle2 className="h-3.5 w-3.5" />,
                          desativado: !ready,
                          dica: ready ? undefined : "Finalize produção e aprovações primeiro",
                          aoEscolher: () => openAction(bundle, "publish"),
                        });
                      }
                      if (["planned", "scheduled"].includes(status)) {
                        acoes.push({
                          chave: "agendar",
                          rotulo: status === "scheduled" ? "Reagendar" : "Agendar",
                          icone: <CalendarCheck2 className="h-3.5 w-3.5" />,
                          desativado: !ready,
                          dica: ready ? "Agendar publicação" : "Finalize produção e aprovações primeiro",
                          aoEscolher: () => openAction(bundle, "schedule"),
                        });
                      }
                      if (["planned", "scheduled", "failed"].includes(status)) {
                        acoes.push({
                          chave: "concluir",
                          rotulo: "Concluir agora",
                          icone: <CheckCircle2 className="h-3.5 w-3.5" />,
                          desativado: adminActing,
                          dica: "Marca como publicado para o painel somar. O link pode ser ajustado depois.",
                          aoEscolher: () => void adminConcludeNow(bundle),
                        });
                      }
                      if (["failed", "cancelled"].includes(status)) {
                        acoes.push({
                          chave: "reabrir",
                          rotulo: "Reabrir",
                          icone: <RotateCcw className="h-3.5 w-3.5" />,
                          aoEscolher: () => openAction(bundle, "reopen"),
                        });
                      }
                      if (status === "scheduled") {
                        acoes.push({
                          chave: "falha",
                          rotulo: "Registrar falha",
                          icone: <AlertTriangle className="h-3.5 w-3.5" />,
                          aoEscolher: () => openAction(bundle, "fail"),
                        });
                      }
                      if (status !== "published" && status !== "cancelled") {
                        acoes.push({
                          chave: "cancelar",
                          rotulo: "Cancelar",
                          icone: <XCircle className="h-3.5 w-3.5" />,
                          perigo: true,
                          aoEscolher: () => openAction(bundle, "cancel"),
                        });
                      }
                      if (acoes.length === 0) return null;
                      const indicePrimario = acoes.findIndex((a) => !a.desativado && !a.perigo);
                      const primaria = indicePrimario >= 0 ? acoes[indicePrimario] : null;
                      const restantes = acoes.filter((_, i) => i !== indicePrimario);
                      const segunda = restantes.find((a) => !a.perigo) || null;
                      const noMenu = restantes.filter((a) => a !== segunda);
                      return (
                        <div className="flex items-center border-t border-border pt-3 [&>*+*]:ml-2">
                          {primaria && (
                            <Button type="button" size="sm" disabled={primaria.desativado} onClick={primaria.aoEscolher} title={primaria.dica}>
                              <span className="mr-1.5 inline-flex">{primaria.icone}</span>
                              {primaria.rotulo}
                            </Button>
                          )}
                          {segunda && (
                            <Button type="button" size="sm" variant="outline" disabled={segunda.desativado} onClick={segunda.aoEscolher} title={segunda.dica}>
                              <span className="mr-1.5 inline-flex">{segunda.icone}</span>
                              {segunda.rotulo}
                            </Button>
                          )}
                          <MenuMais
                            rotulo="Mais ações da publicação"
                            itens={noMenu.map((a) => ({
                              rotulo: a.rotulo,
                              icone: a.icone,
                              aoEscolher: a.aoEscolher,
                              desativado: a.desativado,
                              dica: a.dica,
                              perigo: a.perigo,
                            }))}
                          />
                        </div>
                      );
                    })()}
                  </article>
                );
              })}

              {podeProgramarInline && (
                <div className="rounded-lg border border-dashed border-primary/40 bg-primary/[0.04] p-4 sm:p-5">
                  <div className="flex min-w-0 items-center">
                    <p className="min-w-0 truncate text-[13px] font-medium text-foreground">
                      {agendadaAtual ? "Remarcar publicação" : "Programar publicação"}
                    </p>
                    <AjudaRecolhida className="ml-1.5" rotulo="Como funciona">
                      {agendadaAtual
                        ? "Já agendada: mude a conta ou o horário e confirme. Atualiza no mesmo card, sem duplicar."
                        : "Escolha a conta e o horário aqui mesmo. Se o material já estiver aprovado, sai no horário marcado; se ainda não estiver, sai até 1 hora depois da aprovação."}
                    </AjudaRecolhida>
                  </div>
                  {canEdit && !isImpersonating && (
                    <div className="mt-3 space-y-2.5">
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Conta</Label>
                        <select
                          value={inlineAccountId}
                          onChange={(event) => setInlineAccountId(event.target.value)}
                          className={juntar(campo, "mt-1")}
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
            </Secao>

            {isStaff && !isImpersonating && (
              <Secao titulo="Histórico" nivel={3} divisoria>
                {loadingEvents ? (
                  <div className="flex h-20 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : eventsFailed ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                  >
                    <p className="text-[12px] font-medium text-destructive">
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
                  <div className="divide-y divide-border/50">
                    {(events || []).map((event) => (
                      <div
                        key={event.id}
                        className="flex gap-3 py-2.5"
                      >
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium text-foreground">
                            {eventLabels[event.event_type] ||
                              event.event_type}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
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
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
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
                      <p className="text-[12px] text-muted-foreground">
                        Nenhum evento registrado.
                      </p>
                    )}
                  </div>
                )}
              </Secao>
            )}
          </div>

          {(editable || canCreateRevision || (canPublish && !isImpersonating)) && (
            <div className="flex shrink-0 flex-wrap items-center justify-between border-t border-border bg-card px-5 py-3 sm:px-7 [&>*+*]:ml-2">
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
      </JanelaCentral>

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
