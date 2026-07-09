import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Sparkles } from "lucide-react";
import { NotesPreview } from "@/components/workspace/StudioPanel";

interface Props { projectId: string }

/**
 * TabDocument (cliente) — espelho read-only do documento vivo do Studio.
 * Só aparece quando a equipe publicou o documento. Atualiza em tempo real.
 */
export default function TabDocument({ projectId }: Props) {
  const [doc, setDoc] = useState<{ notes: string; updated_at: string; published: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data } = await supabase.from("studio_docs")
        .select("notes, updated_at, published")
        .eq("project_id", projectId).maybeSingle();
      if (mounted) { setDoc(data as any); setLoading(false); }
    }
    void load();

    const ch = supabase.channel(`studio-doc:${projectId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "studio_docs", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = (payload.new || payload.old) as any;
          if (row) setDoc({ notes: row.notes || "", updated_at: row.updated_at, published: !!row.published });
        })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [projectId]);

  if (loading) return <div className="text-sm text-muted-foreground p-6">Carregando…</div>;
  if (!doc || !doc.published || !doc.notes?.trim()) {
    return (
      <div className="p-10 text-center border border-dashed border-border rounded-xl bg-secondary/20">
        <Sparkles className="w-6 h-6 text-primary mx-auto mb-2" />
        <p className="text-sm font-medium">Nenhum documento publicado ainda.</p>
        <p className="text-xs text-muted-foreground mt-1">Assim que a equipe publicar o plano deste projeto, ele aparece aqui em tempo real.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="w-3.5 h-3.5 text-primary" />
        <span>Documento vivo · atualizado {new Date(doc.updated_at).toLocaleString("pt-BR")}</span>
        <span className="ml-auto px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">AO VIVO</span>
      </div>
      <div className="rounded-2xl border border-border bg-card p-6 md:p-10 shadow-sm">
        <div className="max-w-3xl mx-auto studio-doc">
          <NotesPreview src={doc.notes} clientId={null} clientName={null} />
        </div>
      </div>
    </div>
  );
}
