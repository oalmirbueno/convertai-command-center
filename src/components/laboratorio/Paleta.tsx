import { botao, juntar } from "@/components/sistema";
import { ORDEM_DA_PALETA, TIPOS_DE_NO, type TipoDeNo } from "@/lib/laboratorio/nos";
import { IconeDoNo } from "./icones";
import { TIPO_ARRASTADO } from "./QuadroDoLab";

/**
 * Paleta de nós: um ícone por tipo (nome e o que faz no title). Tocar põe o
 * nó no quadro; arrastar solta onde quiser.
 */
export default function Paleta({ onPor, vertical = true }: { onPor: (t: TipoDeNo) => void; vertical?: boolean }) {
  return (
    <div role="toolbar" aria-label="Nós do projeto" aria-orientation={vertical ? "vertical" : "horizontal"} className={juntar("flex min-w-0", vertical ? "flex-col items-center py-1" : "flex-wrap")} data-paleta-do-lab="">
      {ORDEM_DA_PALETA.map((t) => {
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
      })}
    </div>
  );
}
