import { useState } from "react";
import { CheckCircle2, Eye, Loader } from "lucide-react";
import { Secao, botao, juntar, lista, texto } from "@/components/sistema";
import { haQuanto, type UltimaAcaoReal } from "@/lib/funcionandoDeVerdade";

/**
 * A lateral da Execução mostra a casa trabalhando (26/10/2026): a última ação
 * real de cada agente, com prova e quando. Uma linha por agente; tocar abre o
 * diário daquela tarefa, onde a prova aparece grande.
 */

const NA_VISTA = 6;

const ESTADO: Record<UltimaAcaoReal["estado"], { rotulo: string; tom: string }> = {
  feito: { rotulo: "feito com prova", tom: "text-success" },
  revisao: { rotulo: "entregue, esperando você", tom: "text-warning" },
  andando: { rotulo: "andando, com prova parcial", tom: "text-info" },
};

export default function FuncionandoDeVerdade({ comProva, semProva, aoAbrir }: {
  comProva: UltimaAcaoReal[];
  semProva: string[];
  aoAbrir: (linkId: string, titulo: string) => void;
}) {
  const [todos, setTodos] = useState(false);
  const visiveis = todos ? comProva : comProva.slice(0, NA_VISTA);
  return (
    <Secao
      titulo="Funcionando de verdade"
      descricao={comProva.length ? `${comProva.length} ${comProva.length === 1 ? "agente com prova" : "agentes com prova"}` : "Nenhuma entrega com prova ainda"}
      ajuda="A última coisa que cada agente fez e deixou prova (imagem, link, documento). Conversa e rodada sem resultado não contam."
      recolher="execucao:funcionando"
      data-funcionando-de-verdade=""
    >
      {comProva.length === 0 ? (
        <p className={texto.auxiliar}>Quando um agente entregar com prova, aparece aqui.</p>
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Última ação real de cada agente">
          {visiveis.map((a) => (
            <li key={a.agenteId} data-acao-real={a.estado}>
              <button
                type="button"
                onClick={() => aoAbrir(a.linkId, a.nome)}
                className={juntar(lista.linha, "w-full items-start text-left")}
                title={`Ver a prova: ${a.nome}`}
              >
                {a.estado === "feito"
                  ? <CheckCircle2 className={juntar("mr-2 mt-0.5 h-3.5 w-3.5 shrink-0", ESTADO[a.estado].tom)} aria-hidden="true" />
                  : <Loader className={juntar("mr-2 mt-0.5 h-3.5 w-3.5 shrink-0", ESTADO[a.estado].tom)} aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline">
                    <span className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{a.agente}</span>
                    <span className={juntar(texto.etiqueta, "ml-auto shrink-0 pl-2 tabular-nums text-muted-foreground")}>{haQuanto(a.quando)}</span>
                  </span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{a.nome}</span>
                  <span className={juntar(texto.etiqueta, "block", ESTADO[a.estado].tom)}>{ESTADO[a.estado].rotulo}</span>
                </span>
                <Eye className="ml-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {comProva.length > NA_VISTA && (
        <button type="button" onClick={() => setTodos(!todos)} className={juntar(botao.discreto, "relative -left-3 mt-1 h-8 text-[12px]")}>
          {todos ? "Mostrar menos" : `Mais ${comProva.length - NA_VISTA}`}
        </button>
      )}
      {semProva.length > 0 && (
        <p className={juntar(texto.auxiliar, "mt-2 line-clamp-2")} title={semProva.join(", ")}>
          Sem entrega com prova ainda: {semProva.length} {semProva.length === 1 ? "agente" : "agentes"}
        </p>
      )}
    </Secao>
  );
}
