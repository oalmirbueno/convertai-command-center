import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Scan } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema/estilos";

type Vista = { escala: number; x: number; y: number };
const INICIAL: Vista = { escala: 1, x: 0, y: 0 };
export function limitarVista(v: Vista, largura: number, altura: number): Vista {
  const escala = Math.max(1, Math.min(8, Number.isFinite(v.escala) ? v.escala : 1));
  const dx = largura * (escala - 1) / 2;
  const dy = altura * (escala - 1) / 2;
  return { escala, x: Math.max(-dx, Math.min(dx, v.x)), y: Math.max(-dy, Math.min(dy, v.y)) };
}

/** Zoom de inspeção, sem gerar nem modificar a imagem. Mouse, toque e teclado. */
export default function ImagemComZoom({ src, alt, largura, altura, onProporcao }: {
  src: string; alt: string; largura: number; altura: number; onProporcao: (p: number) => void;
}) {
  const [vista, setVista] = useState(INICIAL);
  const [natural, setNatural] = useState(0);
  const [erro, setErro] = useState(false);
  const quadro = useRef<HTMLDivElement>(null);
  const pontos = useRef(new Map<number, { x: number; y: number }>());
  const ajustar = useCallback((escala: number, x = 0, y = 0) => setVista((v) => {
    const nova = Math.max(1, Math.min(8, escala));
    const fator = nova / v.escala;
    return limitarVista({ escala: nova, x: x + (v.x - x) * fator, y: y + (v.y - y) * fator }, largura, altura);
  }), [largura, altura]);
  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  useEffect(() => { setVista(INICIAL); setErro(false); setNatural(0); pontos.current.clear(); }, [src]);
  useEffect(() => { setVista((v) => limitarVista(v, largura, altura)); }, [largura, altura]);
  useEffect(() => {
    const el = quadro.current;
    if (!el) return;
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      ajustar(vistaRef.current.escala * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener("wheel", roda, { passive: false });
    return () => el.removeEventListener("wheel", roda);
  }, [ajustar]);
  return <div>
    <div role="toolbar" aria-label="Zoom da imagem" className="mb-2 flex items-center space-x-1 pr-6">
      <button type="button" className={botao.icone} aria-label="Diminuir zoom" disabled={vista.escala <= 1 || erro} onClick={() => ajustar(vista.escala / 1.25)}><Minus className="h-4 w-4" /></button>
      <output aria-label="Nível de zoom" className={juntar(texto.etiqueta, "w-12 text-center tabular-nums")}>{Math.round(vista.escala * 100)}%</output>
      <button type="button" className={botao.icone} aria-label="Aumentar zoom" disabled={vista.escala >= 8 || erro} onClick={() => ajustar(vista.escala * 1.25)}><Plus className="h-4 w-4" /></button>
      <button type="button" className={botao.barra} onClick={() => setVista(INICIAL)} aria-label="Ajustar imagem à janela"><Scan className="mr-1 h-4 w-4" />Ajustar</button>
      <button type="button" className={botao.barra} disabled={!natural || erro} onClick={() => ajustar(natural / largura)} title="Um pixel da imagem por pixel da tela, até 8x">1:1</button>
    </div>
    <div ref={quadro} role="region" aria-label="Imagem com zoom; arraste para explorar" tabIndex={0}
      className="relative overflow-hidden rounded-lg bg-secondary/40 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{ width: largura, height: altura, touchAction: "none", cursor: vista.escala > 1 ? "grab" : "zoom-in" }} data-ampliar-quadro=""
      onDoubleClick={() => ajustar(vista.escala > 1 ? 1 : 2)}
      onKeyDown={(e) => {
        if (["+", "=", "-", "0"].includes(e.key)) {
          e.preventDefault(); e.stopPropagation();
          if (e.key === "0") setVista(INICIAL); else ajustar(vista.escala * (e.key === "-" ? 0.8 : 1.25));
        }
        if (vista.escala > 1 && e.key.startsWith("Arrow")) {
          e.preventDefault(); e.stopPropagation();
          setVista((v) => limitarVista({ ...v, x: v.x + (e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0), y: v.y + (e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0) }, largura, altura));
        }
      }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); pontos.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }}
      onPointerMove={(e) => {
        const antes = pontos.current.get(e.pointerId);
        if (!antes) return;
        const outro = Array.from(pontos.current.entries()).find(([id]) => id !== e.pointerId)?.[1];
        pontos.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (outro) {
          const distancia = Math.hypot(antes.x - outro.x, antes.y - outro.y);
          const nova = Math.hypot(e.clientX - outro.x, e.clientY - outro.y);
          if (distancia > 0) ajustar(vistaRef.current.escala * nova / distancia);
        } else setVista((v) => limitarVista({ ...v, x: v.x + e.clientX - antes.x, y: v.y + e.clientY - antes.y }, largura, altura));
      }}
      onPointerUp={(e) => pontos.current.delete(e.pointerId)} onPointerCancel={(e) => pontos.current.delete(e.pointerId)} onLostPointerCapture={(e) => pontos.current.delete(e.pointerId)}>
      {erro ? <p role="alert" className={juntar(texto.corpo, "p-4")}>Não foi possível carregar esta imagem. Feche e abra para tentar novamente.</p> : <img src={src} alt={alt} draggable={false} className="block h-full w-full select-none object-contain"
        style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.escala})`, transformOrigin: "center" }}
        onError={() => setErro(true)} onLoad={(e) => { const img = e.currentTarget; if (img.naturalWidth && img.naturalHeight) { setNatural(img.naturalWidth); onProporcao(img.naturalWidth / img.naturalHeight); } }} />}
    </div>
    <span className="sr-only">Use a roda ou dois dedos para ampliar. Arraste para mover. Duplo clique ajusta. Teclas mais, menos e zero.</span>
  </div>;
}
