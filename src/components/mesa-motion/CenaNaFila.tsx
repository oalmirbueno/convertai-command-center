import { Loader2, Square } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { ROTULO_DA_ETAPA, type EtapaDoRender } from "../../../supabase/functions/_shared/render-do-editor";
import { chaveDoPedido, type ModoDoPedidoDaCena, renderDaCena } from "../../../supabase/functions/_shared/motion-metodo";
import type { CenaDoFilme, FormatoDoMotion } from "../../../supabase/functions/_shared/cena-hf";
import { erroDaChave, type FilaDoFilme, type Filme, pedidoAtivoDaChave } from "./motionApi";

/**
 * O que a cena tem pronto num modo e formato (still, amostra de 5 s ou final
 * com alfa), com o estado do pedido na fila e o Cancelar. Mídia pelo link
 * assinado de 1 h que o filme trouxe.
 */
export default function CenaNaFila({
  filme,
  links,
  fila,
  cena,
  modo,
  formato,
  onCancelar,
  compacta,
}: {
  filme: Filme;
  links: Record<string, string>;
  fila: FilaDoFilme | undefined;
  cena: CenaDoFilme;
  modo: ModoDoPedidoDaCena;
  formato: FormatoDoMotion;
  onCancelar: (pedidoId: string) => void;
  compacta?: boolean;
}) {
  const chave = chaveDoPedido(cena.id, modo, formato);
  const ativo = pedidoAtivoDaChave(fila, chave);
  const erro = erroDaChave(fila, chave);
  const pronto = renderDaCena(filme, cena, modo, formato);
  const url = pronto && pronto.saida_path ? links[pronto.saida_path] : null;
  const folha = pronto && pronto.folha_path ? links[pronto.folha_path] : null;
  const deitado = formato === "16:9";
  return (
    <div className="min-w-0" data-cena-na-fila={`${modo}:${formato}`}>
      {url && modo === "still" && <img src={url} alt={`Still da cena ${cena.titulo}`} className={juntar("block rounded-md border border-border bg-muted", deitado ? "w-full max-w-[420px]" : "w-full max-w-[220px]")} />}
      {url && modo !== "still" && (
        <video src={url} controls playsInline loop className={juntar("block rounded-md border border-border bg-muted", deitado ? "w-full max-w-[420px]" : "w-full max-w-[220px]")} />
      )}
      {folha && !compacta && <img src={folha} alt="Folha de contato em tamanho de celular" className="mt-2 block w-full max-w-[560px] rounded-md" />}
      {pronto && !pronto.em_dia && <p className={juntar(texto.auxiliar, "mt-1 text-warning")}>A cena mudou depois deste {modo === "still" ? "still" : "render"}.</p>}
      {ativo && (
        <p className={juntar(texto.auxiliar, "mt-1 flex items-center")}>
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          <span className="min-w-0 flex-1">
            {ativo.estado === "fila"
              ? fila && fila.worker.situacao !== "ligado"
                ? "Na fila: a máquina da agência parece desligada"
                : "Na fila"
              : `${ativo.etapa ? ROTULO_DA_ETAPA[ativo.etapa as EtapaDoRender] || ativo.etapa : "Renderizando"} ${Math.round((Number(ativo.progresso) || 0) * 100)}%`}
          </span>
          <button type="button" className={juntar(botao.barra, "h-7")} onClick={() => onCancelar(ativo.id)}>
            <Square className="mr-1 h-3 w-3" />
            Cancelar
          </button>
        </p>
      )}
      {!ativo && erro && (
        <p className={juntar(texto.auxiliar, "mt-1 text-destructive")} role="alert">
          {erro.erro_mensagem || "Não saiu."}
        </p>
      )}
    </div>
  );
}
