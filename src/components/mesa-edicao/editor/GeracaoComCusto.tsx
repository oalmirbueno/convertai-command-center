import { useState } from "react";
import { Check, Clock, Loader2, Wand2 } from "lucide-react";
import { usd } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { chamarMesaVideos } from "@/components/mesa-videos/videosApi";
import { confirmarGeracao, prepararGeracao, ROTULO_DA_GERACAO, type AcaoDeGeracao, type ResultadoDaGeracao } from "@/lib/editor/geracao";
import { novoId } from "@/lib/editor/api";

/**
 * Geração em duas fases (frente V-B): Preparar (sem gasto: sobe o quadro e o
 * servidor devolve o custo) e Gerar por US$ X (o clique do dono, com o teto
 * igual ao custo mostrado). Ação que o servidor ainda não tem: "em preparação".
 */

export default function GeracaoComCusto({
  acao,
  montarCorpo,
  desativado,
  motivo,
  onConfirmado,
  chamar = chamarMesaVideos,
}: {
  acao: AcaoDeGeracao;
  /** Monta o corpo (sobe quadros); lança Error com a frase para a tela. */
  montarCorpo: () => Promise<Record<string, unknown>>;
  desativado?: boolean;
  motivo?: string | null;
  onConfirmado?: (pedidoId: string) => void;
  chamar?: (corpo: Record<string, unknown>) => Promise<any>;
}) {
  const [estado, setEstado] = useState<ResultadoDaGeracao | { estado: "ocioso" } | { estado: "ocupado"; fase: string }>({ estado: "ocioso" });
  const [corpo, setCorpo] = useState<Record<string, unknown> | null>(null);
  // Um uid por Preparar: gerar de novo com o mesmo uid nao gera duas vezes (contrato V-A).
  const [uid, setUid] = useState<string>("");

  const preparar = async () => {
    setEstado({ estado: "ocupado", fase: "Preparando" });
    try {
      const c = await montarCorpo();
      setCorpo(c);
      setUid(novoId());
      setEstado(await prepararGeracao(chamar, acao, c));
    } catch (e) {
      setEstado({ estado: "erro", mensagem: e instanceof Error ? e.message : "Não foi possível preparar." });
    }
  };

  const confirmar = async (custo: number | null) => {
    setEstado({ estado: "ocupado", fase: "Enviando" });
    const r = await confirmarGeracao(chamar, acao, custo, corpo || {}, uid);
    setEstado(r);
    if (r.estado === "confirmado" && onConfirmado) onConfirmado(r.pedido_id);
  };

  const e = estado;
  return (
    <div className="min-w-0" data-geracao={acao} data-estado-da-geracao={e.estado}>
      {e.estado === "ocioso" || e.estado === "erro" || e.estado === "em_preparacao" ? (
        <div className="flex min-w-0 flex-wrap items-center">
          <button type="button" className={juntar(botao.secundario, "mb-1 mr-2 h-8")} onClick={() => void preparar()} disabled={desativado}>
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            Preparar: {ROTULO_DA_GERACAO[acao].toLowerCase()}
          </button>
          <span className={juntar(texto.auxiliar, "mb-1")}>{desativado && motivo ? motivo : "Sem custo até confirmar."}</span>
        </div>
      ) : null}
      {e.estado === "ocupado" && (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {e.fase}
        </p>
      )}
      {(e.estado === "preparado" || e.estado === "custo_mudou") && (
        <div className="flex min-w-0 flex-wrap items-center rounded-md bg-muted/50 px-2.5 py-2">
          <span className="mb-1 mr-auto text-[12.5px]">
            {e.estado === "custo_mudou" ? "O custo mudou: " : "Custo estimado: "}
            <strong className="tabular-nums">{e.custo_usd !== null ? usd(e.custo_usd) : "sem preço de referência"}</strong>
          </span>
          <button
            type="button"
            className={juntar(botao.primario, "mb-1 mr-1 h-8")}
            onClick={() => void confirmar(e.custo_usd)}
            disabled={e.custo_usd === null || !uid}
            title={e.custo_usd === null ? "Sem custo conhecido não dá para confirmar." : undefined}
          >
            Gerar{e.custo_usd !== null ? ` por ${usd(e.custo_usd)}` : ""}
          </button>
          <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => setEstado({ estado: "ocioso" })}>
            Cancelar
          </button>
        </div>
      )}
      {e.estado === "confirmado" && (
        <p className="flex items-center text-[12.5px]">
          <Check className="mr-1.5 h-3.5 w-3.5 text-primary" />
          Pedido enviado. O resultado aparece na Mídia.
        </p>
      )}
      {e.estado === "em_preparacao" && (
        <p className={juntar(texto.auxiliar, "flex items-center")} data-em-preparacao="">
          <Clock className="mr-1.5 h-3.5 w-3.5" />
          {e.mensagem}
        </p>
      )}
      {e.estado === "erro" && <p className="text-[12px] text-destructive">{e.mensagem}</p>}
    </div>
  );
}
