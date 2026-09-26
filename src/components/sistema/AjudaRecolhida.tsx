import { useEffect, useRef, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { foco, juntar } from "./estilos";

/**
 * Ajuda recolhida: um "?" pequeno ao lado do título que guarda a explicação.
 * Regra do sistema (dono, 26/09: "o subtítulo poderia ser um ponto de
 * interrogação do lado"): na tela fica só o título curto; o que a seção faz
 * mora aqui.
 *
 * Computador (mouse): abre ao passar o mouse, como um tooltip, e fecha ao
 * sair. Celular e teclado: toque ou Enter abre e fecha (popover). Esc fecha.
 */

/** O aparelho tem mouse de verdade (passar por cima)? */
function temMouse(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return false;
  }
}

export default function AjudaRecolhida({
  children,
  rotulo = "O que é isto?",
  titulo,
  className = "",
  lado = "bottom",
}: {
  children: ReactNode;
  /** Nome do botão para leitor de tela. */
  rotulo?: string;
  /** Título opcional dentro do balão. */
  titulo?: ReactNode;
  className?: string;
  lado?: "top" | "bottom" | "left" | "right";
}) {
  const [aberto, setAberto] = useState(false);
  const fechar = useRef<number | null>(null);
  const pararFechar = () => {
    if (fechar.current !== null) {
      window.clearTimeout(fechar.current);
      fechar.current = null;
    }
  };
  const agendarFechar = () => {
    pararFechar();
    fechar.current = window.setTimeout(() => setAberto(false), 150);
  };
  useEffect(() => pararFechar, []);

  const entrar = () => {
    if (!temMouse()) return;
    pararFechar();
    setAberto(true);
  };
  const sair = () => {
    if (!temMouse()) return;
    agendarFechar();
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={rotulo}
          onMouseEnter={entrar}
          onMouseLeave={sair}
          data-ajuda-recolhida=""
          className={juntar(
            "toque-compacto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
            aberto && "text-foreground",
            foco,
            className,
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={lado}
        align="start"
        sideOffset={6}
        onMouseEnter={entrar}
        onMouseLeave={sair}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[calc(100vw-24px)] max-w-[320px] p-3 text-[12.5px] leading-5 text-foreground"
      >
        {titulo && <p className="mb-1 text-[13px] font-semibold">{titulo}</p>}
        <div className="text-muted-foreground [overflow-wrap:anywhere]">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
