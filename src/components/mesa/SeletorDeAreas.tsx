import { useEffect, useRef, useState, type MouseEvent as EventoDeMouse, type PointerEvent as EventoDePonteiro, type TouchEvent as EventoDeToque } from "react";
import { X } from "lucide-react";
import { ImagemDaMesa } from "./MesaContexto";
import { normalizarArea, type Area } from "./estudioUtil";

/**
 * Desenho de áreas sobre a lâmina para o ajuste pontual. Cada retângulo é uma
 * div com borda, em posição absoluta por percentual: nada é pintado na
 * imagem e nenhum texto vai por cima da arte. As áreas saem em frações de 0 a
 * 1 da lâmina (a mesma medida que o estúdio usa para a máscara).
 *
 * Eventos de ponteiro quando o navegador tem (mouse, caneta e toque); no
 * Safari antigo, que não tem, mouse e toque separados. O toque que desenha
 * não rola a página.
 */

const MINIMO = 0.02;

type Ponto = { x: number; y: number };

export default function SeletorDeAreas({
  caminho,
  areas,
  onMudar,
  disabled,
}: {
  caminho: string | null | undefined;
  areas: Area[];
  onMudar: (areas: Area[]) => void;
  disabled?: boolean;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [inicio, setInicio] = useState<Ponto | null>(null);
  const [atual, setAtual] = useState<Ponto | null>(null);
  const desenhando = useRef(false);
  const temPonteiro = typeof window !== "undefined" && typeof (window as any).PointerEvent !== "undefined";

  // Toque que desenha não rola a página (listener não passivo, só enquanto desenha).
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const segurar = (e: TouchEvent) => {
      if (desenhando.current) e.preventDefault();
    };
    el.addEventListener("touchmove", segurar, { passive: false });
    return () => el.removeEventListener("touchmove", segurar);
  }, []);

  const fracao = (clientX: number, clientY: number): Ponto | null => {
    const el = caixa.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (clientY - r.top) / r.height)),
    };
  };

  const comecar = (clientX: number, clientY: number) => {
    if (disabled) return;
    const p = fracao(clientX, clientY);
    if (!p) return;
    desenhando.current = true;
    setInicio(p);
    setAtual(p);
  };
  const mover = (clientX: number, clientY: number) => {
    if (!desenhando.current) return;
    const p = fracao(clientX, clientY);
    if (p) setAtual(p);
  };
  const terminar = () => {
    if (!desenhando.current) return;
    desenhando.current = false;
    if (inicio && atual) {
      const a = normalizarArea({ x0: inicio.x, y0: inicio.y, x1: atual.x, y1: atual.y });
      if (a.x1 - a.x0 >= MINIMO && a.y1 - a.y0 >= MINIMO) onMudar(areas.concat([a]));
    }
    setInicio(null);
    setAtual(null);
  };

  const eventos = temPonteiro
    ? {
        onPointerDown: (e: EventoDePonteiro<HTMLDivElement>) => {
          if (e.button !== undefined && e.button > 0) return;
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
          e.preventDefault();
          comecar(e.clientX, e.clientY);
        },
        onPointerMove: (e: EventoDePonteiro<HTMLDivElement>) => mover(e.clientX, e.clientY),
        onPointerUp: () => terminar(),
        onPointerCancel: () => terminar(),
      }
    : {
        onMouseDown: (e: EventoDeMouse<HTMLDivElement>) => {
          if (e.button > 0) return;
          e.preventDefault();
          comecar(e.clientX, e.clientY);
        },
        onMouseMove: (e: EventoDeMouse<HTMLDivElement>) => mover(e.clientX, e.clientY),
        onMouseUp: () => terminar(),
        onMouseLeave: () => terminar(),
        onTouchStart: (e: EventoDeToque<HTMLDivElement>) => {
          const t = e.touches[0];
          if (t) comecar(t.clientX, t.clientY);
        },
        onTouchMove: (e: EventoDeToque<HTMLDivElement>) => {
          const t = e.touches[0];
          if (t) mover(t.clientX, t.clientY);
        },
        onTouchEnd: () => terminar(),
        onTouchCancel: () => terminar(),
      };

  const rascunho = inicio && atual ? normalizarArea({ x0: inicio.x, y0: inicio.y, x1: atual.x, y1: atual.y }) : null;
  const estilo = (a: Area) => ({
    left: `${a.x0 * 100}%`,
    top: `${a.y0 * 100}%`,
    width: `${(a.x1 - a.x0) * 100}%`,
    height: `${(a.y1 - a.y0) * 100}%`,
  });

  return (
    <div className="relative w-full select-none overflow-hidden rounded-lg border-2 border-primary/70" style={{ paddingBottom: "125%" }}>
      <ImagemDaMesa caminho={caminho} alt="Lâmina para marcar a área" className="absolute inset-0 h-full w-full" />
      <div
        ref={caixa}
        className={`absolute inset-0 touch-none ${disabled ? "cursor-not-allowed" : "cursor-crosshair"}`}
        {...eventos}
        aria-label="Arraste para marcar a área que deve mudar"
        role="application"
      >
        {areas.map((a, i) => (
          <div key={i} className="absolute rounded-sm border-2 border-primary bg-primary/20 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={estilo(a)}>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onMudar(areas.filter((_, k) => k !== i));
              }}
              disabled={disabled}
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-foreground shadow"
              aria-label={`Tirar a área ${i + 1}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {rascunho && <div className="pointer-events-none absolute rounded-sm border-2 border-dashed border-primary bg-primary/10" style={estilo(rascunho)} />}
      </div>
    </div>
  );
}
