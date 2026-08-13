import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  BookOpen, CheckCircle2, FileCheck2, Megaphone, PenLine, Send, Loader2,
} from "lucide-react";

/**
 * Diário vivo do projeto: cada movimento vira registro cronológico.
 *
 * Duas fontes na mesma linha do tempo:
 * - Automática: o sistema reconhece sozinho o que aconteceu (material enviado
 *   para aprovação, material aprovado, publicação no ar, atualização enviada).
 * - Manual: equipe ou agente registra "o que foi feito, por que, e o próximo
 *   passo" - e o cliente vê na hora. Transparência total dos dois lados.
 */

interface JournalEntry {
  at: string;
  kind: "auto" | "note";
  icon: "file" | "approved" | "publication" | "report" | "note";
  title: string;
  body?: string | null;
  previewUrl?: string | null;
}

const ICONS = {
  file: FileCheck2,
  approved: CheckCircle2,
  publication: Megaphone,
  report: BookOpen,
  note: PenLine,
} as const;

export default function ProjectJournal({
  clientId,
  canWrite,
}: {
  clientId: string;
  canWrite: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["project-journal", clientId],
    queryFn: async () => {
      const projects = await supabase
        .from("projects")
        .select("id, name")
        .eq("client_id", clientId)
        .is("deleted_at", null);
      const projectIds = (projects.data || []).map((project) => project.id);

      const [notes, files, publications, reports] = await Promise.all([
        projectIds.length
          ? supabase
              .from("updates")
              .select("id, project_id, message, update_type, client_visible, created_at")
              .in("project_id", projectIds)
              .order("created_at", { ascending: false })
              .limit(60)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("files")
          .select("file_name, file_url, mime_type, approval_status, approval_requested_at, client_decided_at, created_at")
          .eq("client_id", clientId)
          .is("archived_at", null)
          .is("parent_file_id", null)
          .order("created_at", { ascending: false })
          .limit(40),
        supabase
          .from("editorial_publications")
          .select("status, platform, published_at, scheduled_at")
          .eq("client_id", clientId),
        supabase
          .from("reports")
          .select("title, created_at, status")
          .eq("client_id", clientId)
          .eq("status", "published")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      return {
        projects: projects.data || [],
        notes: (notes.data as any[]) || [],
        files: files.data || [],
        publications: publications.data || [],
        reports: reports.data || [],
      };
    },
    enabled: !!clientId,
    refetchInterval: 30_000,
  });

  const entries = useMemo<JournalEntry[]>(() => {
    if (!data) return [];
    const list: JournalEntry[] = [];

    for (const note of data.notes) {
      if (!canWrite && !note.client_visible) {
        // Nota interna gerada pelo sistema ("X" concluida) vira linguagem de
        // cliente automaticamente; texto interno livre continua privado.
        const doneMatch = /^[""“]?"?(.+?)"?[""”]?\s+conclu[ií]da\.?$/i.exec(
          (note.message || "").trim(),
        );
        if (doneMatch) {
          list.push({
            at: note.created_at,
            kind: "auto",
            icon: "approved",
            title: `Etapa concluída: ${doneMatch[1].replace(/^"|"$/g, "")}`,
          });
        }
        continue;
      }
      list.push({
        at: note.created_at,
        kind: "note",
        icon: "note",
        title: note.client_visible ? "Atualização do time" : "Nota interna",
        body: note.message,
      });
    }
    for (const file of data.files) {
      // A arte aparece junto do registro: transparencia visual, nao so texto.
      const isImage =
        (file.mime_type || "").startsWith("image/") ||
        /\.(png|jpe?g|webp|gif)$/i.test(file.file_name || "");
      const previewUrl = isImage && file.file_url ? file.file_url : null;
      if (file.approval_requested_at) {
        list.push({
          at: file.approval_requested_at,
          kind: "auto",
          icon: "file",
          title: `Material enviado para sua aprovação: ${file.file_name}`,
          previewUrl,
        });
      }
      if (file.client_decided_at && file.approval_status === "approved") {
        list.push({
          at: file.client_decided_at,
          kind: "auto",
          icon: "approved",
          title: `Material aprovado: ${file.file_name}`,
          previewUrl,
        });
      }
    }
    for (const publication of data.publications) {
      if (publication.status === "published" && publication.published_at) {
        list.push({
          at: publication.published_at,
          kind: "auto",
          icon: "publication",
          title: `Publicação no ar (${publication.platform === "instagram" ? "Instagram" : publication.platform})`,
        });
      }
    }
    for (const report of data.reports) {
      list.push({
        at: report.created_at,
        kind: "auto",
        icon: "report",
        title: `Atualização publicada: ${report.title}`,
      });
    }

    return list
      .filter((entry) => entry.at)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 60);
  }, [data, canWrite]);

  const registerNote = async () => {
    const message = draft.trim();
    if (!message) return;
    const project = data?.projects?.[0];
    if (!project) {
      toast.error("Este cliente ainda não tem projeto para registrar o diário.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("updates").insert({
      project_id: project.id,
      author_id: user!.id,
      message,
      update_type: "progress",
      client_visible: true,
    });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível registrar a atualização.");
      return;
    }
    setDraft("");
    toast.success("Atualização registrada. O cliente já vê no diário.");
    queryClient.invalidateQueries({ queryKey: ["project-journal", clientId] });
  };

  return (
    <section className="space-y-3">
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5" /> Diário do trabalho
      </p>

      {canWrite && (
        <div className="rounded-xl border border-border bg-card p-3.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            placeholder="O que foi feito, por que foi feito e qual o próximo passo. O cliente vê na hora."
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={saving || !draft.trim()}
              onClick={() => void registerNote()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Registrar atualização
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-secondary/40" />
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
          Cada avanço do trabalho aparece aqui automaticamente: materiais, aprovações, publicações e as
          atualizações escritas pelo time.
        </div>
      ) : (
        <>
        <div className="relative max-h-[380px] space-y-0 overflow-y-auto rounded-xl border border-border/60 bg-secondary/[0.15] p-3 pr-2">
          {(showAll ? entries : entries.slice(0, 12)).map((entry, index, visible) => {
            const EntryIcon = ICONS[entry.icon];
            const isNote = entry.kind === "note";
            return (
              <div key={`${entry.at}-${index}`} className="relative flex gap-3 pb-4">
                {index < visible.length - 1 && (
                  <span className="absolute left-[13px] top-7 h-full w-px bg-border" aria-hidden="true" />
                )}
                <span
                  className={`relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                    isNote
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-secondary/50 text-muted-foreground"
                  }`}
                >
                  <EntryIcon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <p className={isNote ? "text-[13px] font-medium leading-snug text-foreground" : "text-[12px] leading-snug text-foreground/80"}>{entry.title}</p>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(entry.at).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {entry.body && (
                    <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-muted-foreground">
                      {entry.body}
                    </p>
                  )}
                  {entry.previewUrl && (
                    <img
                      src={entry.previewUrl}
                      alt=""
                      loading="lazy"
                      className="mt-2 h-16 w-16 rounded-lg border border-border object-cover"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {entries.length > 12 && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="w-full rounded-lg border border-border bg-transparent py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {showAll ? "Mostrar menos" : `Ver histórico completo (${entries.length})`}
          </button>
        )}
        </>
      )}
    </section>
  );
}
