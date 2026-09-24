import { useEffect, useRef, useState, type MouseEvent as EventoDeMouse, type PointerEvent as EventoDePonteiro, type ReactNode, type TouchEvent as EventoDeToque } from "react";
import { X } from "lucide-react";
import { useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { normalizarArea } from "@/components/mesa/estudioUtil";
import { Moldura } from "./Comuns";
import { proporcaoDaFoto, type Area, type FotoDoAcervo } from "./fotoApi";

/**
 * A foto inteira na proporção real (lida da imagem quando o banco ainda não
 * tem largura e altura) e, no modo de marcar, o desenho das áreas
 * protegidas: arrastar marca um retângulo, o X tira. As áreas saem em
 * frações de 0 a 1 da foto, a mesma medida da máscara do servidor. Nada é
 * pintado na foto e nada a escurece: a área marcada é só uma borda.
 *
 * Eventos de ponteiro quando o navegador tem; no Safari antigo, mouse e toque.
 */

const MINIMO = 0.02;
type Ponto = { x: number; y: number };

export function useProporcaoReal(foto: FotoDoAcervo | null) {
  const [proporcao, setProporcao] = useState(proporcaoDaFoto(foto));
  useEffect(() => setProporcao(proporcaoDaFoto(foto)), [foto ? foto.id : null]); // eslint-disable-line react-hooks/exhaustive-deps
  const aoCarregar = (img: HTMLImageElement) => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      const p = img.naturalWidth / img.naturalHeight;
      if (Math.abs(p - proporcao) > 0.01) setProporcao(p);
    }
  };
  return { proporcao, aoCarregar };
}

export default function AreasNaFoto({
  foto,
  areas,
  onMudar,
  marcando,
  disabled,
  estiloDaImagem,
  children,
}: {
  foto: FotoDoAcervo;
  areas: Area[];
  onMudar: (a: Area[]) => void;
  marcando: boolean;
  disabled?: boolean;
  estiloDaImagem?: Record<string, string>;
  children?: ReactNode;
}) {
  const url = useUrlDaMesa(foto.storage_path, foto.storage_bucket || "mesa");
  const { proporcao, aoCarregar } = useProporcaoReal(foto);
  const caixa = useRef<HTMLDivElement>(null);
  const [inicio, setInicio] = useState<Ponto | null>(null);
  const [atual, setAtual] = useState<Ponto | null>(null);
  const desenhando = useRef(false);
  const temPonteiro = typeof window !== "undefined" && typeof (window as any).PointerEvent !== "undefined";

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const segurar = (e: TouchEvent) => {
      if (desenhando.current) e.preventDefault();
    };
    el.addEventListener("touchmove", segurar, { passive: false });
    return () => el.removeEventListener("touchmove", segurar);
  }, [marcando]);

  const fracao = (x: number, y: number): Ponto | null => {
    const el = caixa.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: Math.max(0, Math.min(1, (x - r.left) / r.width)), y: Math.max(0, Math.min(1, (y - r.top) / r.height)) };
  };
  const comecar = (x: number, y: number) => {
    if (disabled || !marcando) return;
    const p = fracao(x, y);
    if (!p) return;
    desenhando.current = true;
    setInicio(p);
    setAtual(p);
  };
  const mover = (x: number, y: number) => {
    if (!desenhando.current) return;
    const p = fracao(x, y);
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

  const eventos = !marcando
    ? {}
    : temPonteiro
      ? {
          onPointerDown: (e: EventoDePonteiro<HTMLDivElement>) => {
            if (e.button !== undefined && e.button > 0) return;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* sem captura */
            }
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
  const estilo = (a: Area) => ({ left: `${a.x0 * 100}%`, top: `${a.y0 * 100}%`, width: `${(a.x1 - a.x0) * 100}%`, height: `${(a.y1 - a.y0) * 100}%` });

  return (
    <Moldura proporcao={proporcao} className={`border select-none ${marcando ? "border-primary/70" : "border-border"}`}>
      {url.data ? (
        <img src={url.data} alt={foto.nome} onLoad={(e) => aoCarregar(e.currentTarget)} className="h-full w-full object-contain" style={estiloDaImagem} draggable={false} />
      ) : (
        <span className={`block h-full w-full ${url.isError ? "" : "animate-pulse"} bg-muted`} />
      )}
      {(marcando || areas.length > 0) && (
        <div
          ref={caixa}
          className={`absolute inset-0 ${marcando ? `touch-none ${disabled ? "cursor-not-allowed" : "cursor-crosshair"}` : "pointer-events-none"}`}
          {...eventos}
          role={marcando ? "application" : undefined}
          aria-label={marcando ? "Arraste para marcar a área que não pode mudar" : undefined}
        >
          {areas.map((a, i) => (
            <div key={i} className="absolute rounded-sm border-2 border-primary" style={estilo(a)} data-area-protegida="">
              {marcando && (
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
                  className="pointer-events-auto absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-foreground shadow"
                  aria-label={`Tirar a área ${i + 1}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {rascunho && <div className="pointer-events-none absolute rounded-sm border-2 border-dashed border-primary" style={estilo(rascunho)} />}
        </div>
      )}
      {children}
    </Moldura>
  );
}
