import { useEffect, useRef, type KeyboardEvent as EventoDeTecla } from "react";
import { juntar, texto } from "@/components/sistema";
import { TIPOS_DE_NO, type TipoDeNo } from "@/lib/laboratorio/nos";
import { IconeDoNo } from "../icones";

/**
 * Menu rápido do quadro: os tipos de nó que ligam com o nó de onde a
 * ligação saiu (podeLigar/entradas de nos.ts). Escolher cria o nó ali e já
 * liga. Abre ao soltar uma ligação no vazio ou no "+" da saída do nó.
 */
export default function MenuRapido({
  x,
  y,
  titulo,
  tipos,
  onEscolher,
  onFechar,
}: {
  /** Ponto do menu dentro do quadro (px). */
  x: number;
  y: number;
  titulo: string;
  tipos: TipoDeNo[];
  onEscolher: (t: TipoDeNo) => void;
  onFechar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    const fora = (e: MouseEvent | TouchEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onFechar();
    };
    window.addEventListener("keydown", tecla);
    // No próximo giro: o mesmo soltar que abriu não pode fechar.
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", fora);
      document.addEventListener("touchstart", fora);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", tecla);
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("touchstart", fora);
    };
  }, [onFechar]);
  useEffect(() => {
    const primeiro = ref.current && (ref.current.querySelector("[role=menuitem]") as HTMLElement | null);
    if (primeiro) primeiro.focus();
  }, []);

  const mover = (e: EventoDeTecla<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const itens = ref.current ? (Array.prototype.slice.call(ref.current.querySelectorAll("[role=menuitem]")) as HTMLElement[]) : [];
    const i = itens.indexOf(document.activeElement as HTMLElement);
    const proximo = itens[(i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length];
    if (proximo) proximo.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={titulo}
      className="nodrag nopan nowheel absolute z-20 w-[232px] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1 text-popover-foreground"
      style={{ left: x, top: y, maxHeight: 320, boxShadow: "0 12px 32px -10px rgba(0,0,0,0.45)" }}
      onKeyDown={mover}
      data-menu-rapido=""
    >
      <p className={juntar(texto.rotulo, "px-2 pb-1 pt-1.5")}>{titulo}</p>
      {tipos.length ? (
        tipos.map((t) => {
          const d = TIPOS_DE_NO[t];
          return (
            <button
              key={t}
              type="button"
              role="menuitem"
              className={juntar(texto.corpo, "flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted")}
              onClick={() => onEscolher(t)}
              title={d.dica}
              data-menu-tipo={t}
            >
              <span className="mr-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `${d.cor}1f`, color: d.cor }}>
                <IconeDoNo tipo={t} className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate">{d.rotulo}</span>
            </button>
          );
        })
      ) : (
        <p className={juntar(texto.auxiliar, "px-2 pb-2")}>Nenhum nó liga aqui.</p>
      )}
    </div>
  );
}
