import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarAds, chavesAds, formatoDe, rotuloDoAnguloDeVenda, type PropostaDeReescrita } from "./adsApi";

/**
 * "Muda todo o conteúdo" (pedido do dono em 02/10/2026: "pedi para mudar
 * todo o conteúdo e ele só acrescentou um card com o mesmo conteúdo"): a troca
 * proposta pelo servidor (criativos_reescrever) aparece aqui, variação por
 * variação, com o antes e o depois. Nada muda até o Confirmar; depois dele,
 * o Desfazer volta o conteúdo de antes. A troca é no lugar: os mesmos
 * criativos e os mesmos cards, com texto novo.
 */

export interface TrocaParaATela {
  tipo: "pendente" | "feita";
  lote: string;
  ids: string[];
  propostas: PropostaDeReescrita[];
  avisos?: string[];
}

/** Uma linha por variação (os formatos irmãos dividem a mesma copy). */
export function variacoesDaTroca(propostas: PropostaDeReescrita[]): { variacao: number; formatos: string[]; proposta: PropostaDeReescrita }[] {
  const saida: { variacao: number; formatos: string[]; proposta: PropostaDeReescrita }[] = [];
  for (const p of propostas) {
    const ja = saida.find((x) => x.variacao === p.variacao);
    if (ja) ja.formatos.push(formatoDe(p.formato).curto);
    else saida.push({ variacao: p.variacao, formatos: [formatoDe(p.formato).curto], proposta: p });
  }
  return saida.sort((a, b) => a.variacao - b.variacao);
}

export default function TrocaDeConteudo({ troca, onFechar }: { troca: TrocaParaATela; onFechar: () => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<"pendente" | "feita" | "desfeita">(troca.tipo);
  const [rodando, setRodando] = useState<"confirmar" | "descartar" | "desfazer" | null>(null);
  const linhas = variacoesDaTroca(troca.propostas);

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
    void queryClient.invalidateQueries({ queryKey: chavesAds.trabalhos(clientId) });
  };

  const agir = async (qual: "confirmar" | "descartar" | "desfazer") => {
    if (rodando) return;
    setRodando(qual);
    try {
      const acao = qual === "confirmar" ? "criativos_reescrever_confirmar" : qual === "descartar" ? "criativos_reescrever_descartar" : "criativos_reescrever_desfazer";
      const r = await chamarAds<{ aviso?: string }>(acao, { client_id: clientId, lote_id: troca.lote, criativo_ids: troca.ids });
      atualizar();
      if (qual === "confirmar") {
        setEstado("feita");
        toast.success("Conteúdo trocado", { description: (r && r.aviso) || "Gere a arte de novo para o texto novo entrar na peça." });
      } else if (qual === "desfazer") {
        setEstado("desfeita");
        toast.success("Conteúdo de antes de volta");
      } else {
        toast.info("Troca descartada");
        onFechar();
      }
    } catch (e) {
      toast.error(qual === "confirmar" ? "Troca não confirmada" : qual === "desfazer" ? "Não deu para desfazer" : "Não deu para descartar", { description: textoDoErro(e) });
    } finally {
      setRodando(null);
    }
  };

  const girando = (qual: string) => (rodando === qual ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null);

  return (
    <section className="space-y-2 rounded-lg border border-primary/40 bg-background p-3" aria-label="Troca de todo o conteúdo" data-troca={estado}>
      <div className="flex min-w-0 items-center">
        <h4 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
          {estado === "pendente" ? `Conteúdo novo para ${troca.ids.length} criativo${troca.ids.length === 1 ? "" : "s"}` : estado === "feita" ? "Conteúdo trocado" : "Troca desfeita"}
        </h4>
        <button type="button" aria-label="Fechar" className="ml-2 rounded p-1 text-muted-foreground hover:text-foreground" onClick={onFechar}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {estado === "pendente" && <p className="text-[11.5px] text-muted-foreground">Troca no lugar: os mesmos criativos e cards, com texto novo. Nada muda até confirmar.</p>}
      {(troca.avisos || []).length > 0 && estado === "pendente" && (
        <ul className="space-y-0.5 text-[11px] text-warning" aria-label="Avisos da troca">
          {(troca.avisos || []).slice(0, 6).map((a, i) => <li key={i} className="[overflow-wrap:anywhere]">{a}</li>)}
        </ul>
      )}
      {estado === "pendente" && linhas.length > 0 && (
        <ul className="space-y-2" aria-label="Antes e depois">
          {linhas.map(({ variacao, formatos, proposta }) => (
            <li key={variacao} className="rounded-md border border-border p-2">
              <p className="mb-1 flex flex-wrap items-center text-[10.5px] text-muted-foreground">
                <span className="mr-1.5 font-medium text-foreground">V{variacao}</span>
                {rotuloDoAnguloDeVenda(proposta.depois.angulo_de_venda) && <span className="mr-1.5 rounded-full bg-primary/10 px-1.5 py-px text-primary">{rotuloDoAnguloDeVenda(proposta.depois.angulo_de_venda)}</span>}
                <span>{formatos.join(", ")}</span>
              </p>
              {proposta.antes.texto_principal && <p className="text-[11.5px] text-muted-foreground line-through [overflow-wrap:anywhere]">{proposta.antes.texto_principal}</p>}
              <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-snug [overflow-wrap:anywhere]">{proposta.depois.texto_principal}</p>
              {(proposta.depois.headline_arte || proposta.depois.titulo) && (
                <p className="mt-1 text-[11.5px] [overflow-wrap:anywhere]">
                  {proposta.depois.headline_arte && <span className="font-semibold">Na arte: {proposta.depois.headline_arte}</span>}
                  {proposta.depois.headline_arte && proposta.depois.titulo ? " · " : ""}
                  {proposta.depois.titulo && <span>Título: {proposta.depois.titulo}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {estado === "pendente" && (
          <>
            <Button type="button" size="sm" className="h-8 text-[12px]" disabled={!!rodando} onClick={() => void agir("confirmar")}>
              {girando("confirmar") || <Check className="mr-1 h-3.5 w-3.5" />} Confirmar troca
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px]" disabled={!!rodando} onClick={() => void agir("descartar")}>
              {girando("descartar")} Descartar
            </Button>
          </>
        )}
        {estado === "feita" && (
          <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" disabled={!!rodando} onClick={() => void agir("desfazer")}>
            {girando("desfazer") || <Undo2 className="mr-1 h-3.5 w-3.5" />} Desfazer
          </Button>
        )}
      </div>
    </section>
  );
}
