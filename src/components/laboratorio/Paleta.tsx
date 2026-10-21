import { useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { botao, juntar } from "@/components/sistema";
import { TIPOS_DE_NO, gruposDaPaleta, type TipoDeNo } from "@/lib/laboratorio/nos";
import { IconeDoNo } from "./icones";
import { TIPO_ARRASTADO } from "./QuadroDoLab";

/**
 * Paleta de nós: um ícone por tipo (nome e o que faz no title), em grupos
 * (Entradas, Criação, Funil, Mensagens, Agentes, Publicação; tipo novo sem
 * grupo cai em Outros) com um separador discreto. Ocupa a altura toda e rola
 * por conta própria (nowheel: a roda não mexe no quadro). Recolhe para o
 * lado. Tocar põe o nó no quadro; arrastar solta onde quiser.
 */
export default function Paleta({ onPor, vertical = true }: { onPor: (t: TipoDeNo) => void; vertical?: boolean }) {
  const [recolhida, setRecolhida] = useState(false);
  const grupos = gruposDaPaleta();

  if (vertical && recolhida)
    return (
      <div className="flex h-full min-h-0 flex-col items-center py-1" data-paleta-do-lab="" data-recolhida="">
        <button type="button" className={botao.icone} onClick={() => setRecolhida(false)} aria-label="Abrir a paleta" title="Abrir a paleta de nós" aria-expanded={false}>
          <ChevronsRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );

  const botaoDoTipo = (t: TipoDeNo) => {
    const d = TIPOS_DE_NO[t];
    return (
      <button
        key={t}
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(TIPO_ARRASTADO, t);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => onPor(t)}
        className={juntar(botao.icone, vertical ? "my-0.5" : "m-0.5")}
        aria-label={d.rotulo}
        title={`${d.rotulo}: ${d.dica}`}
        data-por-no={t}
      >
        <span style={{ color: d.cor }} className="inline-flex">
          <IconeDoNo tipo={t} />
        </span>
      </button>
    );
  };

  return (
    <div className={juntar("min-w-0", vertical && "flex h-full min-h-0 flex-col items-center")} data-paleta-do-lab="">
      {vertical ? (
        <button type="button" className={juntar(botao.icone, "mb-1 shrink-0")} onClick={() => setRecolhida(true)} aria-label="Recolher a paleta" title="Recolher a paleta" aria-expanded>
          <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <div
        role="toolbar"
        aria-label="Nós do projeto"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        className={juntar("nowheel min-w-0", vertical ? "flex min-h-0 flex-1 flex-col items-center overflow-y-auto overflow-x-hidden overscroll-contain pb-2" : "flex items-center overflow-x-auto overscroll-contain pb-1")}
        data-rolagem-da-paleta=""
      >
        {grupos.map((g, i) => (
          <div key={g.id} role="group" aria-label={g.rotulo} title={g.rotulo} className={juntar("flex shrink-0", vertical ? "flex-col items-center" : "items-center")} data-grupo-da-paleta={g.id}>
            {i > 0 ? <span role="separator" aria-orientation={vertical ? "horizontal" : "vertical"} className={vertical ? "my-1.5 block h-px w-5 bg-border" : "mx-1 block h-5 w-px bg-border"} /> : null}
            {g.tipos.map(botaoDoTipo)}
          </div>
        ))}
      </div>
    </div>
  );
}
