import { useState, useRef, useEffect } from "react";
import { HelpCircle, Route, BookOpen } from "lucide-react";

interface HelpButtonProps {
  onFullTour: () => void;
  onPageTour: (() => void) | null;
  pageTourLabel?: string;
}

export default function HelpButton({ onFullTour, onPageTour, pageTourLabel }: HelpButtonProps) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Observa quando o Studio abre em tela cheia mobile — nesse caso o botão some
  // para não sobrepor o input/enviar do agente.
  useEffect(() => {
    const check = () => setHidden(document.body.dataset.studioOpen === "1");
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-studio-open"] });
    return () => obs.disconnect();
  }, []);

  // If no page tour, just trigger full tour directly
  const handleClick = () => {
    if (!onPageTour) {
      onFullTour();
    } else {
      setOpen(!open);
    }
  };

  if (hidden) return null;

  return (
    <div
      ref={ref}
      className="fixed right-4 z-[100] bottom-[calc(env(safe-area-inset-bottom)+104px)] md:bottom-5 md:right-5"
    >

      {/* Menu */}
      {open && onPageTour && (
        <div className="absolute bottom-14 right-0 w-56 rounded-xl bg-popover border border-border p-1.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button
            onClick={() => { setOpen(false); onPageTour(); }}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-[13px] text-foreground hover:bg-secondary/60 transition-colors bg-transparent border-none cursor-pointer text-left"
          >
            <Route className="w-4 h-4 text-primary" />
            <div>
              <p className="font-medium">Tour desta página</p>
              <p className="text-[11px] text-muted-foreground">{pageTourLabel || "Aprenda sobre esta seção"}</p>
            </div>
          </button>
          <button
            onClick={() => { setOpen(false); onFullTour(); }}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-[13px] text-foreground hover:bg-secondary/60 transition-colors bg-transparent border-none cursor-pointer text-left"
          >
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="font-medium">Tour completo</p>
              <p className="text-[11px] text-muted-foreground">Rever toda a plataforma</p>
            </div>
          </button>
        </div>
      )}

      {/* Button */}
      <button
        onClick={handleClick}
        className="w-11 h-11 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center justify-center cursor-pointer group"
        style={{
          boxShadow: "0 4px 20px hsl(var(--primary) / 0.4)",
        }}
        aria-label="Ajuda — Tour de aprendizado"
      >
        <HelpCircle className="w-5 h-5 group-hover:rotate-12 transition-transform" />
      </button>
    </div>
  );
}
