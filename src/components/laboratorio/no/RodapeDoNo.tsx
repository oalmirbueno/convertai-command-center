import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { botao, juntar } from "@/components/sistema";
import { estimar, type ExecucaoDoLab } from "@/lib/laboratorio/api";
import { TIPOS_DE_NO, type NoDoLab } from "@/lib/laboratorio/nos";
import { useAcoesDoQuadro } from "./contexto";

/**
 * O pé do nó que roda: o interruptor "Automático" (dados.auto: roda sozinho
 * quando as entradas ficam prontas), o custo estimado (estimar do nó, quando
 * ele está selecionado; senão o custo da última vez) e o Rodar, que passa
 * sempre pelo custo antes (o fluxo do editor).
 */

const dinheiro = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

export default function RodapeDoNo({ no, execucao, selecionado, ocupado, trava }: { no: NoDoLab; execucao: ExecucaoDoLab | undefined; selecionado: boolean; ocupado: boolean; trava: string | null }) {
  const a = useAcoesDoQuadro();
  const def = TIPOS_DE_NO[no.tipo];
  const assinatura = JSON.stringify(no.dados);
  const [assinaturaEstavel, setAssinaturaEstavel] = useState(assinatura);
  useEffect(() => {
    const id = window.setTimeout(() => setAssinaturaEstavel(assinatura), 500);
    return () => window.clearTimeout(id);
  }, [assinatura]);
  const aguardando = assinaturaEstavel !== assinatura;
  const est = useQuery({
    queryKey: ["laboratorio", "estimar-no", a.projetoId, no.id, assinaturaEstavel],
    queryFn: async () => {
      await a.antesDeChamar();
      return estimar(a.projetoId, [no.id]);
    },
    enabled: selecionado && !aguardando && def.roda && !!a.projetoId,
    staleTime: 60_000,
    retry: false,
  });
  if (!def.roda) return null;
  const auto = no.dados.auto === true;
  const noAr = no.tipo === "por_no_ar";
  const ultimo = execucao && typeof execucao.custo_usd === "number" ? execucao.custo_usd : null;
  const custo = aguardando ? "Atualizando custo" : est.data ? `≈ ${dinheiro(est.data.total_usd)}` : est.isFetching ? null : ultimo !== null ? `Último ${dinheiro(ultimo)}` : "";
  return (
    <div className="flex min-w-0 items-center space-x-1.5 px-3 pb-3 pt-1" data-rodape-do-no={no.id}>
      {!noAr ? (
        <label className="mr-2 inline-flex shrink-0 cursor-pointer items-center" title="Automático: roda sozinho quando as entradas ficam prontas (até o teto do projeto; acima, pergunta)">
          <input type="checkbox" className="peer sr-only" checked={auto} onChange={(e) => a.mudarDados(no.id, { auto: e.target.checked })} aria-label="Automático" data-auto-do-no={no.id} />
          <span className={juntar("relative inline-block h-4 w-7 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring", auto ? "bg-primary" : "bg-muted-foreground/40")} aria-hidden="true">
            <span className={juntar("absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all", auto ? "left-3.5" : "left-0.5")} />
          </span>
          <span className="ml-1.5 text-[12px] text-muted-foreground">Auto</span>
        </label>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[12px] tabular-nums text-muted-foreground" data-custo-do-no="" title={custo || (est.isError ? "Estimativa indisponível. Rodar confere o custo antes de executar." : undefined)}>
        {est.isFetching && !est.data ? <Loader2 className="inline h-3 w-3 animate-spin" aria-hidden="true" /> : custo}
      </span>
      <button
        type="button"
        // v4: o verde cheio fica só no "Rodar tudo"; no nó é a pílula de tinta com o play verde (um quadro com dez nós não vira dez botões verdes).
        className={juntar(botao.secundario, "h-8 border-0 bg-foreground pl-1 pr-3 text-[13px] text-background hover:bg-foreground/85")}
        onClick={() => a.rodar(no.id)}
        disabled={ocupado || !!trava}
        title={trava || (noAr ? "Pedir aprovação (mostra o custo antes)" : "Rodar (mostra o custo antes)")}
        data-rodar-no-rodape={no.id}
      >
        <span className="mr-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
          {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        </span>
        {noAr ? "Pedir aprovação" : "Rodar"}
      </button>
    </div>
  );
}
