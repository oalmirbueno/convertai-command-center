import { Suspense, lazy } from "react";
import { Video } from "lucide-react";
import { juntar, texto } from "@/components/sistema/estilos";
import { useMesa } from "./MesaContexto";
import type { ItemDoMes } from "./useItensDoMes";
import type { ItemProposto } from "./mesaV4Api";
import RoteiroDaPecaDeVideo from "./RoteiroDaPecaDeVideo";
import { useRoteiroDaPeca } from "./roteiroDaPeca";
import { tipoDoEstilo } from "../../../supabase/functions/mesa-roteiros/modulos/roteiro-da-peca";

const GravarVideoDaCampanha = lazy(() => import("./GravarVideoDaCampanha"));

/**
 * Gravar com roteiro, na peça de vídeo do Mês (24/10/2026; dono: "vídeos com roteiro ou IA para selecionar quando
 * eu for preparar"). Agente unificado (dono: "um só agente de roteiro em todo lugar"): o mesmo roteiro e o mesmo
 * agente da peça de vídeo da campanha (RoteiroDaPecaDeVideo): o roteiro sempre à vista, o agente ao lado com o
 * seletor de modelo (escopo "roteiro"), criar com ideia, duração, estilo e criatividade (2 versões, o Jev
 * escolhe), conversa que muda o roteiro com Confirmar e Desfazer, versões. A ligação é pela tarefa da agenda
 * (roteiros.task_id). Embaixo, o que é de gravar (PDF, Word e a direção de gravação).
 */

export function pedidoDoRoteiroDaPauta(item: Pick<ItemDoMes, "title" | "midia">): string {
  const m = item.midia || null;
  return [
    `Peça de vídeo do calendário para a pessoa gravar: "${item.title}".`,
    m && m.gancho ? `Gancho pensado: ${m.gancho}` : "",
    m && m.cenas && m.cenas.length ? `Cenas pensadas: ${m.cenas.join("; ")}` : "",
    m && m.narracao ? `Fala pensada: ${m.narracao}` : "",
  ].filter(Boolean).join("\n").slice(0, 2000);
}

/** A peça do Mês no formato que o roteiro da peça lê (a tarefa e o tema). */
export function itemDaPauta(item: Pick<ItemDoMes, "id" | "title" | "due_date">): ItemProposto {
  return { tema_id: "", tema: item.title || "Vídeo da pauta", data: item.due_date || "", formato: "video", task_id: item.id, cards: [] } as unknown as ItemProposto;
}

export default function GravarDaPauta({ item }: { item: ItemDoMes }) {
  const { clientId } = useMesa();
  const peca = itemDaPauta(item);
  const estado = useRoteiroDaPeca({ clientId, campanha: null, propostaId: null, item: peca });
  return (
    <div className="min-w-0 space-y-4" data-gravar-da-pauta={estado.linha ? "com-roteiro" : "sem-roteiro"}>
      <div className="flex min-w-0 items-center">
        <Video className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className={juntar(texto.rotulo, "mr-auto truncate")}>Gravar com roteiro</span>
      </div>
      <RoteiroDaPecaDeVideo
        campanha={null}
        item={peca}
        estado={estado}
        montarCorpo={({ direcao, modeloId, roteiroId }) => ({
          client_id: clientId,
          task_id: item.id,
          ...(roteiroId ? { roteiro_id: roteiroId } : {}),
          tipo: tipoDoEstilo(direcao.estilo),
          duracao_s: direcao.duracao,
          tema: String(item.title || "Vídeo da pauta").slice(0, 300),
          pedido: pedidoDoRoteiroDaPauta(item),
          modelo_id: modeloId || null,
          ideia: String(direcao.ideia || "").trim().slice(0, 1200),
          estilo: direcao.estilo,
          criatividade: direcao.criatividade,
        })}
      />
      <Suspense fallback={<p className={texto.auxiliar}>Abrindo…</p>}>
        <GravarVideoDaCampanha clientId={clientId} item={peca} linha={estado.linha} roteiro={estado.roteiro} />
      </Suspense>
    </div>
  );
}
