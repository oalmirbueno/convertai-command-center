import { useMemo, useState } from "react";
import { Archive, CalendarDays, FileText, Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta, textoDoErro } from "@/lib/mesa/api";
import { ROTULO_DO_FORMATO, ROTULO_DO_STATUS, modoDoTipo, type LinhaDoRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import { roteiroDaPeca, usePecasDeVideo, useRoteiros } from "./roteirosApi";
import { AvisoDoBanco, SeloDoStatus } from "./Comuns";

/**
 * Etapa 1: a agenda. Lista as peças de vídeo da agenda do cliente (Reels,
 * vídeo, short e story; tasks.delivery_type), da semana passada até seis
 * semanas à frente, com o estado do roteiro de cada uma, e os roteiros
 * avulsos. O roteiro já gravado no calendário, o contexto, o cérebro e a
 * campanha entram como base quando o roteiro é gerado.
 */
export default function EtapaAgenda({
  onAbrirRoteiro,
  onNovoDaPeca,
  onAvulso,
}: {
  onAbrirRoteiro: (id: string) => void;
  onNovoDaPeca: (taskId: string) => void;
  onAvulso: () => void;
}) {
  const { clientId } = useMesa();
  const pecasQ = usePecasDeVideo(clientId);
  const roteirosQ = useRoteiros(clientId);
  const [comArquivados, setComArquivados] = useState(false);
  const lista = roteirosQ.data ? roteirosQ.data.lista : [];
  const pecas = pecasQ.data || [];
  const idsDasPecas = useMemo(() => {
    const m: Record<string, true> = {};
    pecas.forEach((p) => (m[p.id] = true));
    return m;
  }, [pecas]);
  const outros = lista.filter((r) => (!r.task_id || !idsDasPecas[r.task_id]) && (comArquivados || !r.arquivado_em));
  const arquivados = lista.filter((r) => !!r.arquivado_em).length;

  return (
    <div className="space-y-5" data-etapa-agenda="">
      {roteirosQ.data && roteirosQ.data.indisponivel && <AvisoDoBanco />}

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex min-w-0 flex-wrap items-center">
          <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-primary" />
          <h2 className="mr-auto min-w-0 truncate text-[14px] font-semibold">Peças de vídeo da agenda</h2>
          <Button type="button" size="sm" variant="outline" onClick={onAvulso} className="mt-1 h-8 text-[12px] sm:mt-0">
            <Plus className="mr-1 h-3.5 w-3.5" /> Roteiro avulso
          </Button>
        </div>
        {pecasQ.isLoading && (
          <p className="flex items-center text-[12.5px] text-muted-foreground">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo a agenda...
          </p>
        )}
        {pecasQ.isError && <p className="text-[12.5px] text-destructive">{textoDoErro(pecasQ.error, "Não foi possível ler a agenda.")}</p>}
        {pecasQ.isSuccess && !pecas.length && (
          <p className="text-[12.5px] text-muted-foreground">Nenhuma peça de vídeo na agenda entre a semana passada e as próximas seis semanas. Use o roteiro avulso.</p>
        )}
        {pecas.length > 0 && (
          <ul className="divide-y divide-border" data-pecas-de-video="">
            {pecas.map((p) => {
              const r = roteiroDaPeca(lista, p.id);
              return (
                <li key={p.id} className="flex min-w-0 flex-wrap items-center py-2.5" data-peca={p.id}>
                  <div className="mr-3 w-[74px] shrink-0 text-[12px] text-muted-foreground">{p.data ? dataCurta(p.data) : "sem data"}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{p.titulo}</p>
                    <p className="truncate text-[11.5px] text-muted-foreground">
                      {ROTULO_DO_FORMATO[p.formato] || p.formato}
                      {p.temRoteiroDaAgenda ? " · roteiro do calendário entra como base" : ""}
                      {r ? ` · ${modoDoTipo(r.tipo).rotulo} · versão ${r.versao_atual}` : ""}
                    </p>
                  </div>
                  <div className="mt-1 flex w-full items-center justify-end sm:mt-0 sm:w-auto">
                    {r ? <SeloDoStatus status={r.status} /> : <span className="mr-2 text-[11px] text-muted-foreground">Sem roteiro</span>}
                    {r ? (
                      <Button type="button" size="sm" variant="outline" className="ml-2 h-8 text-[12px]" onClick={() => onAbrirRoteiro(r.id)}>
                        <FileText className="mr-1 h-3.5 w-3.5" /> Abrir
                      </Button>
                    ) : (
                      <Button type="button" size="sm" className="ml-2 h-8 text-[12px]" onClick={() => onNovoDaPeca(p.id)}>
                        <Sparkles className="mr-1 h-3.5 w-3.5" /> Escrever roteiro
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex min-w-0 flex-wrap items-center">
          <FileText className="mr-2 h-4 w-4 shrink-0 text-primary" />
          <h2 className="mr-auto min-w-0 truncate text-[14px] font-semibold">Roteiros avulsos e de outras datas</h2>
          {arquivados > 0 && (
            <button type="button" onClick={() => setComArquivados((v) => !v)} className="text-[11.5px] text-muted-foreground hover:text-foreground">
              <Archive className="mr-1 inline h-3.5 w-3.5" />
              {comArquivados ? "Esconder arquivados" : `Mostrar arquivados (${arquivados})`}
            </button>
          )}
        </div>
        {roteirosQ.isLoading && <p className="text-[12.5px] text-muted-foreground">Carregando roteiros...</p>}
        {roteirosQ.isError && <p className="text-[12.5px] text-destructive">{textoDoErro(roteirosQ.error, "Não foi possível ler os roteiros.")}</p>}
        {roteirosQ.isSuccess && !outros.length && <p className="text-[12.5px] text-muted-foreground">Nenhum roteiro avulso ainda.</p>}
        {outros.length > 0 && (
          <ul className="divide-y divide-border">
            {outros.map((r: LinhaDoRoteiro) => (
              <li key={r.id} className="flex min-w-0 items-center py-2.5" data-roteiro={r.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{r.titulo}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {modoDoTipo(r.tipo).rotulo} · versão {r.versao_atual}
                    {r.arquivado_em ? " · arquivado" : ""}
                    {r.task_id ? " · peça fora do período" : " · avulso"}
                  </p>
                </div>
                <SeloDoStatus status={r.status} />
                <Button type="button" size="sm" variant="outline" className="ml-2 h-8 text-[12px]" onClick={() => onAbrirRoteiro(r.id)}>
                  Abrir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-[11.5px] text-muted-foreground">Estados: {Object.keys(ROTULO_DO_STATUS).map((k) => ROTULO_DO_STATUS[k as keyof typeof ROTULO_DO_STATUS]).join(", ")}. Aprovado fica ligado à peça da agenda.</p>
    </div>
  );
}
