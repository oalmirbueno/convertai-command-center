import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, FileDown, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { textoDoErro } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema";
import { useMesa } from "./MesaContexto";
import type { ItemProposto } from "./mesaV4Api";
import type { LinhaDoRoteiro, Roteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import { baixarRoteiro } from "./roteiroDaPeca";

/**
 * Vídeo da campanha, caminho GRAVAR (22/10/2026; agente unificado em 23/10, dono: "no Gravar, pega o roteiro
 * certinho do tema e baixa"). O roteiro é o mesmo da peça (RoteiroDaPecaDeVideo, tabela roteiros, sempre à
 * vista acima com o agente ao lado); aqui fica o que é de gravar: o PDF e o Word para baixar, o Roteiros
 * para aprovar e marcar gravado, a direção de gravação, o B-roll e o que confirmar antes de gravar.
 *
 * Interface (CampanhaVideos.tsx liga este componente em cada peça de vídeo):
 *   <GravarVideoDaCampanha clientId={clientId} item={peca} linha={linhaOuNull} roteiro={roteiroOuNull} />
 * - linha: o roteiro na tabela (null: a peça só tem o roteiro antigo do item, que também baixa).
 * - roteiro: o conteúdo à vista (a versão atual ou o do item).
 */

export interface PropsDoGravarVideo {
  clientId: string;
  item: ItemProposto;
  linha: LinhaDoRoteiro | null;
  roteiro: Roteiro | null;
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  if (!valor) return null;
  return (
    <p className={juntar(texto.corpo, "min-w-0 whitespace-pre-line [overflow-wrap:anywhere]")}>
      <span className={texto.rotulo}>{rotulo}: </span>
      {valor}
    </p>
  );
}

function Lista({ titulo, itens }: { titulo: string; itens: string[] }) {
  if (!itens.length) return null;
  return (
    <section className="min-w-0" aria-label={titulo}>
      <h4 className={juntar(texto.rotulo, "mb-1 truncate")}>{titulo}</h4>
      <ul className="min-w-0 list-disc space-y-0.5 pl-5">
        {itens.map((x, i) => (
          <li key={i} className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>{x}</li>
        ))}
      </ul>
    </section>
  );
}

/** O que é de gravar: direção (enquadramento, ambiente, figurino, objetos, luz e câmera), B-roll e pendências. */
export function DirecaoParaGravar({ roteiro: r }: { roteiro: Roteiro }) {
  const d = r.direcao;
  const temDirecao = !!(d.enquadramento || d.ambiente || d.figurino || d.objetos || d.luz || d.camera || d.orientacoes.length > 0);
  if (!temDirecao && !r.broll.length && !r.pendencias.length) return <p className={texto.auxiliar}>Sem direção de gravação neste roteiro: peça ao agente.</p>;
  return (
    <div className="min-w-0 space-y-3" data-direcao-para-gravar="">
      {temDirecao && (
        <section className="min-w-0 space-y-0.5" aria-label="Direção de gravação">
          <h4 className={juntar(texto.rotulo, "mb-1 truncate")}>Direção de gravação</h4>
          <Campo rotulo="Enquadramento" valor={d.enquadramento} />
          <Campo rotulo="Ambiente" valor={d.ambiente} />
          <Campo rotulo="Figurino" valor={d.figurino} />
          <Campo rotulo="Objetos" valor={d.objetos} />
          <Campo rotulo="Luz" valor={d.luz} />
          <Campo rotulo="Câmera" valor={d.camera} />
          {d.orientacoes.length > 0 && (
            <ul className="min-w-0 list-disc space-y-0.5 pl-5">
              {d.orientacoes.map((o, i) => (
                <li key={i} className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>{o}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <Lista titulo="B-roll" itens={r.broll} />
      <Lista titulo="Confirmar antes de gravar" itens={r.pendencias} />
    </div>
  );
}

export default function GravarVideoDaCampanha({ clientId, item, linha, roteiro }: PropsDoGravarVideo) {
  const mesa = useMesa();
  const [baixando, setBaixando] = useState<"pdf" | "docx" | null>(null);
  const tema = item.tema || "o vídeo";
  const baixar = async (tipo: "pdf" | "docx") => {
    if (!roteiro) return;
    setBaixando(tipo);
    try {
      await baixarRoteiro(tipo, { roteiro, linha, cliente: mesa.clientName || "Cliente", tema: item.tema || "" });
    } catch (e) {
      toast.error(tipo === "pdf" ? "PDF não gerado" : "Word não gerado", { description: textoDoErro(e) });
    } finally {
      setBaixando(null);
    }
  };
  if (!roteiro) return <p className={texto.auxiliar} data-gravar-video={item.tema_id || ""}>Sem roteiro para gravar: crie com o agente acima.</p>;
  return (
    <div className="min-w-0 space-y-3" data-gravar-video={item.tema_id || ""} data-estado-do-roteiro-para-gravar={linha ? "pronto" : "item"}>
      <div className="flex min-w-0 items-center">
        <span className={juntar(texto.rotulo, "mr-auto truncate")}>Para gravar</span>
        {linha && (
          <Link
            to={`/mesa-roteiros?client=${clientId}&etapa=roteiro&roteiro=${linha.id}`}
            className={juntar(botao.icone, "text-primary hover:text-primary")}
            aria-label={`Abrir o roteiro de ${tema} no Roteiros`}
            title="Abrir no Roteiros (aprovar, marcar gravado, comentários)"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
        <button type="button" className={botao.icone} onClick={() => void baixar("pdf")} disabled={baixando !== null} aria-label={`Baixar o roteiro de ${tema} em PDF`} title="Baixar o roteiro em PDF">
          {baixando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileDown className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button type="button" className={botao.icone} onClick={() => void baixar("docx")} disabled={baixando !== null} aria-label={`Baixar o roteiro de ${tema} em Word`} title="Baixar o roteiro em Word">
          {baixando === "docx" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <DirecaoParaGravar roteiro={roteiro} />
    </div>
  );
}
