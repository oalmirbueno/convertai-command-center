import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Sparkles } from "lucide-react";
import { NotesPreview } from "@/components/workspace/NotesPreview";
import { Carregando, EstadoVazio, Painel, etiqueta, juntar, texto } from "@/components/sistema";

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

  if (loading) return <Carregando forma="aba" rotulo="Carregando o plano do projeto" />;
  if (!doc || !doc.published || !doc.notes?.trim()) {
    return (
      <EstadoVazio
        icone={<Sparkles className="h-5 w-5" />}
        titulo="Nenhum documento publicado ainda."
        descricao="Assim que a equipe publicar o plano deste projeto, ele aparece aqui em tempo real."
      />
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
        <FileText className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Documento vivo · atualizado {new Date(doc.updated_at).toLocaleString("pt-BR")}</span>
        <span className={juntar(etiqueta, "ml-2 bg-primary/10 text-primary")}>Ao vivo</span>
      </div>
      <Painel className="md:px-5 md:py-5">
        <div className="studio-doc mx-auto max-w-3xl">
          <NotesPreview src={doc.notes} clientId={null} clientName={null} />
        </div>
      </Painel>
    </div>
  );
}
