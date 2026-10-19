import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { juntar, lista, texto } from "@/components/sistema";
import { TIPOS_DE_NO, ordemTopologica, resumoDoNo, type CanvasDoLab, type TipoDeNo } from "@/lib/laboratorio/nos";
import type { ExecucaoDoLab } from "@/lib/laboratorio/api";
import { EstadoDoNo } from "./ResultadoDoNo";
import { IconeDoNo } from "./icones";
import Paleta from "./Paleta";

/**
 * Modo lista (celular, abaixo de 768 px, como o da Mesa Foto): o mesmo grafo
 * em linhas, na ordem em que roda. Tocar abre o inspetor do nó ali mesmo.
 */
export default function ModoListaDoLab({
  canvas,
  execucoes,
  selecionado,
  onSelecionar,
  onPor,
  inspetor,
}: {
  canvas: CanvasDoLab;
  execucoes: Record<string, ExecucaoDoLab>;
  selecionado: string | null;
  onSelecionar: (id: string | null) => void;
  onPor: (t: TipoDeNo) => void;
  inspetor: ReactNode;
}) {
  const ordem = ordemTopologica(canvas);
  const nos = ordem.map((id) => canvas.nos.find((n) => n.id === id)).filter(Boolean).concat(canvas.nos.filter((n) => ordem.indexOf(n.id) < 0)) as CanvasDoLab["nos"];
  return (
    <div className="min-w-0 space-y-3" data-modo-lista-do-lab="">
      <Paleta onPor={onPor} vertical={false} />
      {!nos.length && <p className={texto.auxiliar}>Nenhum nó ainda. Toque num ícone acima.</p>}
      <ul className={juntar(lista.aberta, lista.divisoria)}>
        {nos.map((n) => {
          const aberto = selecionado === n.id;
          const e = execucoes[n.id];
          const def = TIPOS_DE_NO[n.tipo];
          return (
            <li key={n.id} className="min-w-0 py-1" data-linha-do-no={n.id}>
              <button type="button" className={juntar(lista.linha, "w-full text-left")} onClick={() => onSelecionar(aberto ? null : n.id)} aria-expanded={aberto}>
                <span className="mr-2 inline-flex shrink-0" style={{ color: def.cor }}>
                  <IconeDoNo tipo={n.tipo} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{def.rotulo}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{resumoDoNo(n) || def.dica}</span>
                </span>
                {e ? <EstadoDoNo status={e.status} /> : null}
                {aberto ? <ChevronDown className="ml-1 h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="ml-1 h-4 w-4 shrink-0" aria-hidden="true" />}
              </button>
              {aberto ? <div className="min-w-0 px-2 pb-3 pt-1">{inspetor}</div> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
