import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { X, ChevronRight, ChevronLeft, SkipForward } from "lucide-react";
import { TourStep } from "./tourConfigs";
import { cn } from "@/lib/utils";

interface OnboardingTourProps {
  steps: TourStep[];
  isOpen: boolean;
  onClose: () => void;
  storageKey: string;
}

export default function OnboardingTour({ steps, isOpen, onClose, storageKey }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const navigate = useNavigate();
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;
  const isCentered = step?.placement === "center";

  const findTarget = useCallback(() => {
    if (!step || isCentered) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(step.target);
    if (el) {
      // Scroll into view if not visible
      const rect = el.getBoundingClientRect();
      const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!isVisible) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Wait for scroll to finish before measuring
        const timer = setTimeout(() => {
          setTargetRect(el.getBoundingClientRect());
        }, 350);
        return () => clearTimeout(timer);
      }
      setTargetRect(rect);
    } else {
      setTargetRect(null);
    }
  }, [step, isCentered]);

  // Navigate to route if needed, then find target
  useEffect(() => {
    if (!isOpen || !step) return;
    if (step.route) {
      navigate(step.route);
      // Wait for render
      const timer = setTimeout(findTarget, 400);
      return () => clearTimeout(timer);
    } else {
      findTarget();
    }
  }, [isOpen, step, navigate, findTarget]);

  // Recalc on resize/scroll
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => findTarget();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [isOpen, findTarget]);

  // Position tooltip relative to target
  useEffect(() => {
    if (!isOpen || !step) return;

    if (isCentered || !targetRect) {
      setTooltipStyle({
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      });
      return;
    }

    const pad = 16;
    const tooltipW = 360;
    const tooltipH = 220;
    let top = 0, left = 0;

    switch (step.placement) {
      case "bottom":
        top = targetRect.bottom + pad;
        left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
        break;
      case "top":
        top = targetRect.top - tooltipH - pad;
        left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
        break;
      case "left":
        top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
        left = targetRect.left - tooltipW - pad;
        break;
      case "right":
        top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
        left = targetRect.right + pad;
        break;
    }

    // Clamp to viewport
    left = Math.max(12, Math.min(left, window.innerWidth - tooltipW - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - tooltipH - 12));

    setTooltipStyle({ position: "fixed", top, left });
  }, [targetRect, step, isCentered, isOpen]);

  const handleNext = () => {
    if (isLast) {
      handleFinish();
    } else {
      setCurrentStep(c => c + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) setCurrentStep(c => c - 1);
  };

  const handleFinish = () => {
    setCurrentStep(0);
    onClose();
  };

  const handleSkip = () => {
    handleFinish();
  };

  if (!isOpen || !step) return null;

  const spotlightPad = 8;

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Overlay with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="tour-spotlight">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && !isCentered && (
              <rect
                x={targetRect.left - spotlightPad}
                y={targetRect.top - spotlightPad}
                width={targetRect.width + spotlightPad * 2}
                height={targetRect.height + spotlightPad * 2}
                rx={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.75)"
          mask="url(#tour-spotlight)"
          style={{ pointerEvents: "auto" }}
          onClick={(e) => e.stopPropagation()}
        />
      </svg>

      {/* Spotlight ring glow */}
      {targetRect && !isCentered && (
        <div
          className="absolute rounded-xl pointer-events-none"
          style={{
            left: targetRect.left - spotlightPad,
            top: targetRect.top - spotlightPad,
            width: targetRect.width + spotlightPad * 2,
            height: targetRect.height + spotlightPad * 2,
            boxShadow: "0 0 0 2px hsl(var(--primary) / 0.6), 0 0 20px hsl(var(--primary) / 0.3)",
            transition: "all 0.3s ease",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className={cn(
          "z-[10000] w-[340px] sm:w-[380px] rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200",
          isCentered && "w-[90vw] max-w-[420px]"
        )}
        style={{ ...tooltipStyle, pointerEvents: "auto" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-primary/15">
              <span className="text-[10px] font-bold text-primary">{currentStep + 1}</span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Passo {currentStep + 1} de {steps.length}
            </span>
          </div>
          <button
            onClick={handleSkip}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors bg-transparent border-none cursor-pointer"
          >
            <SkipForward className="w-3 h-3" />
            Pular tour
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-2">
          <h3 className="text-[15px] font-semibold text-foreground">{step.title}</h3>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{step.description}</p>
        </div>

        {/* Progress bar */}
        <div className="px-5">
          <div className="h-1 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 flex items-center justify-between">
          <button
            onClick={handlePrev}
            disabled={isFirst}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] transition-colors bg-transparent border border-border cursor-pointer",
              isFirst ? "opacity-30 cursor-not-allowed" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ChevronLeft className="w-3 h-3" />
            Anterior
          </button>
          <button
            onClick={handleNext}
            className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
          >
            {isLast ? "Concluir" : "Próximo"}
            {!isLast && <ChevronRight className="w-3 h-3" />}
          </button>
        </div>
      </div>
    </div>
  );
}
