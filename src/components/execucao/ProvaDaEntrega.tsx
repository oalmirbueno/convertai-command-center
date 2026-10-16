import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { destinoDaEvidencia } from "@/lib/execucaoApresentacao";
import { prepararEntrada } from "@/lib/cadernoExecucao";
import EvidenciaVisual from "./EvidenciaVisual";

/**
 * A prova da entrega em destaque (16/10/2026, dono: "já trazer o print, a imagem correta em alta
 * qualidade, o PDF, o documento, tudo para eu abrir ali dentro e aprovar com contexto").
 *
 * Junta a última prova do vínculo com os anexos das entradas recentes do diário (o agente anexa ali)
 * e mostra a primeira grande, que abre no visualizador do painel (imagem ampliável, PDF, documento),
 * e as outras em miniatura. Sem nada anexado, diz isso, sem fingir.
 */
export default function ProvaDaEntrega({ linkId, ultimaProva }: { linkId: string; ultimaProva?: string | null }) {
  const q = useQuery({
    queryKey: ["prova-da-entrega", linkId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_participations")
        .select("body, attachments, created_at")
        .eq("task_link_id", linkId)
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw new Error(error.message);
      return (data || []) as Array<{ body: string; attachments: Array<{ name?: string; url?: string }> }>;
    },
  });
  const vistos = new Map<string, string>();
  if (ultimaProva && destinoDaEvidencia(ultimaProva)) vistos.set(ultimaProva, "Prova da entrega");
  for (const e of q.data || []) for (const a of prepararEntrada(e.body, e.attachments || []).anexos) if (a.url && !vistos.has(a.url)) vistos.set(a.url, a.name || "Arquivo da entrega");
  const provas = [...vistos.entries()].slice(0, 5);
  if (q.isLoading) return <div className="aspect-[4/3] w-full animate-pulse bg-muted/40" aria-label="Carregando a prova" />;
  if (!provas.length) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
        <ImageOff className="h-7 w-7" aria-hidden="true" />
        <p className="text-[12.5px]">O agente ainda não anexou imagem, print ou documento desta entrega.</p>
      </div>
    );
  }
  const [principal, ...outras] = provas;
  return (
    <div className="space-y-2 p-3">
      <EvidenciaVisual url={principal[0]} nome={principal[1]} />
      {outras.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {outras.map(([url, nome]) => <EvidenciaVisual key={url} url={url} nome={nome} compacto />)}
        </div>
      )}
    </div>
  );
}
