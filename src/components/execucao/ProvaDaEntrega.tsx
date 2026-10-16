import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ImageOff, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { destinoDaEvidencia } from "@/lib/execucaoApresentacao";
import { prepararEntrada } from "@/lib/cadernoExecucao";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import EvidenciaVisual, { ConteudoDaProva } from "./EvidenciaVisual";
import { botao, campoTexto, juntar } from "@/components/sistema";

/**
 * A prova da entrega em destaque (16/10/2026, dono: "já trazer o print, a imagem correta em alta
 * qualidade, o PDF, o documento, tudo para eu abrir ali dentro e aprovar com contexto"; "o carrossel
 * era 6 e apareceram 4: tem que ser 6 de 6"; "setinha para ir para os outros"; "ajustar com ele,
 * pedir o que melhorar, até acertar").
 *
 * Junta a última prova do vínculo com TODOS os anexos das entradas do diário, na ordem das peças
 * ("1/6" antes de "2/6"). A primeira aparece grande; todas em miniatura com "N de M". Clicar abre a
 * galeria: imagem grande com setas (e ← →), as miniaturas embaixo e, ao lado, o pedido de ajuste
 * daquela peça (vai para o diário como correção, com a imagem anexada, e a tarefa volta ao agente)
 * e a conversa com o Hermes.
 */
type Prova = { url: string; nome: string };

const ATALHOS = ["Refazer esta peça", "Melhorar a qualidade da imagem", "Trocar ou corrigir o texto", "Ajustar às cores da marca"];

export function provasDoVinculo(ultimaProva: string | null | undefined, entradas: Array<{ body: string; attachments: Array<{ name?: string; url?: string }> }>): Prova[] {
  const vistos = new Map<string, string>();
  for (const e of entradas) for (const a of prepararEntrada(e.body, e.attachments || []).anexos) if (a.url && !vistos.has(a.url)) vistos.set(a.url, a.name || "Arquivo da entrega");
  if (ultimaProva && destinoDaEvidencia(ultimaProva) && !vistos.has(ultimaProva)) vistos.set(ultimaProva, "Prova da entrega");
  return [...vistos.entries()].map(([url, nome]) => ({ url, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true, sensitivity: "base" }));
}

export default function ProvaDaEntrega({ linkId, ultimaProva, aoConversar }: { linkId: string; ultimaProva?: string | null; aoConversar?: () => void }) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [indice, setIndice] = useState<number | null>(null);
  const [pedido, setPedido] = useState("");
  const [enviando, setEnviando] = useState(false);
  const q = useQuery({
    queryKey: ["prova-da-entrega", linkId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_participations")
        .select("body, attachments, created_at")
        .eq("task_link_id", linkId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw new Error(error.message);
      return (data || []) as Array<{ body: string; attachments: Array<{ name?: string; url?: string }> }>;
    },
  });
  const provas = provasDoVinculo(ultimaProva, q.data || []);
  const atual = indice === null ? null : provas[indice] || null;
  const ir = (passo: number) => setIndice((i) => (i === null || !provas.length ? i : (i + passo + provas.length) % provas.length));
  useEffect(() => {
    if (indice === null) return;
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") { e.preventDefault(); ir(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); ir(-1); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [indice, provas.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const pedirAjuste = async () => {
    if (!atual || !user || !pedido.trim()) return;
    setEnviando(true);
    try {
      const quem = profile?.full_name || "a equipe";
      const peca = `${atual.nome} (${(indice ?? 0) + 1} de ${provas.length})`;
      const r = await (supabase as any).rpc("operator_human_action", { _link_id: linkId, _new_status: "in_progress", _note: `Ajuste pedido por ${quem} em ${peca}: ${pedido.trim()}`.slice(0, 900), _resolve_approval: false });
      if (r.error) throw new Error(r.error.message);
      const e = await (supabase as any).from("operator_participations").insert({ task_link_id: linkId, author_kind: "humano", author_id: user.id, entry_type: "correcao", title: `Ajustar: ${peca}`, body: pedido.trim(), attachments: [{ name: atual.nome, url: atual.url }] });
      if (e.error) throw new Error(e.error.message);
      toast.success("Ajuste pedido. A peça voltou para o agente refazer e mandar de novo.");
      setPedido("");
      void qc.invalidateQueries({ queryKey: ["diario", linkId] });
      void qc.invalidateQueries({ queryKey: ["operador-vinculos"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  };

  if (q.isLoading) return <div className="aspect-[4/3] w-full animate-pulse bg-muted/40" aria-label="Carregando a prova" />;
  if (!provas.length) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
        <ImageOff className="h-7 w-7" aria-hidden="true" />
        <p className="text-[12.5px]">O agente ainda não anexou imagem, print ou documento desta entrega.</p>
      </div>
    );
  }
  const [principal] = provas;
  return (
    <div className="space-y-2 p-3">
      <EvidenciaVisual url={principal.url} nome={principal.nome} aoAbrir={() => setIndice(0)} />
      {provas.length > 1 && (
        <>
          <p className="px-0.5 text-[11.5px] text-muted-foreground">{provas.length} peças · clique para ver em tamanho grande</p>
          <div className="grid grid-cols-4 gap-1.5">
            {provas.slice(1).map((p, i) => <EvidenciaVisual key={p.url} url={p.url} nome={`${i + 2} de ${provas.length}`} compacto aoAbrir={() => setIndice(i + 1)} />)}
          </div>
        </>
      )}

      <Dialog open={indice !== null} onOpenChange={(v) => { if (!v) setIndice(null); }}>
        <DialogContent className="flex h-[94vh] max-h-[94vh] w-[97vw] max-w-7xl flex-col gap-0 overflow-hidden p-0">
          <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3 pr-12">
            <DialogTitle className="min-w-0 flex-1 truncate text-[15px] font-semibold">{atual?.nome || "Entrega"}</DialogTitle>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-medium tabular-nums">{(indice ?? 0) + 1} de {provas.length}</span>
            <DialogDescription className="sr-only">Use as setas para passar as peças. Ao lado, peça um ajuste desta peça.</DialogDescription>
          </div>
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-auto p-4">{atual && <ConteudoDaProva key={atual.url} url={atual.url} nome={atual.nome} />}</div>
              {provas.length > 1 && <>
                <button type="button" onClick={() => ir(-1)} aria-label="Peça anterior" className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 shadow-lg ring-1 ring-border hover:bg-muted"><ChevronLeft className="h-5 w-5" /></button>
                <button type="button" onClick={() => ir(1)} aria-label="Próxima peça" className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 shadow-lg ring-1 ring-border hover:bg-muted"><ChevronRight className="h-5 w-5" /></button>
                <div className="flex shrink-0 gap-1.5 overflow-x-auto border-t border-border p-2">
                  {provas.map((p, i) => (
                    <div key={p.url} className={juntar("w-16 shrink-0 rounded-lg", i === indice && "ring-2 ring-primary")}>
                      <EvidenciaVisual url={p.url} nome={`${i + 1}`} compacto aoAbrir={() => setIndice(i)} />
                    </div>
                  ))}
                </div>
              </>}
            </div>
            {/* Ajustar com o agente, sem sair da imagem. */}
            <aside className="flex shrink-0 flex-col gap-3 border-t border-border p-4 lg:w-80 lg:border-l lg:border-t-0">
              <div>
                <p className="text-[14px] font-semibold">Ajustar esta peça</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">O pedido vai para o agente com esta imagem anexada. Ele refaz e manda de novo para você aprovar.</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ATALHOS.map((a) => <button key={a} type="button" onClick={() => setPedido((t) => (t ? `${t}\n${a}` : a))} className="rounded-full border border-border px-2.5 py-1 text-[12px] hover:bg-muted">{a}</button>)}
              </div>
              <textarea value={pedido} onChange={(e) => setPedido(e.target.value)} rows={5} placeholder="O que mudar nesta peça? Ex.: trocar a foto de fundo, aumentar o título, usar o verde da marca." className={juntar(campoTexto, "min-h-[110px] resize-none")} />
              <button type="button" disabled={enviando || !pedido.trim()} onClick={() => void pedirAjuste()} className={juntar(botao.primario, "h-10")}>{enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Pedir ajuste desta peça</button>
              {aoConversar && <button type="button" onClick={() => { setIndice(null); aoConversar(); }} className={juntar(botao.secundario, "h-10")}><MessageCircle className="mr-1.5 h-4 w-4" />Conversar com o Hermes sobre isto</button>}
            </aside>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
