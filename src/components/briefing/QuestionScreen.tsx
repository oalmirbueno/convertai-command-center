import { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUESTIONS, type Question } from "./questions";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

interface Props {
  answers: Record<string, any>;
  onUpdate: (key: string, value: any) => void;
  onComplete: () => void;
}

export default function QuestionScreen({ answers, onUpdate, onComplete }: Props) {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<"next" | "prev">("next");
  const [shake, setShake] = useState(false);

  const total = QUESTIONS.length;
  const q = QUESTIONS[idx];
  const progress = ((idx + 1) / total) * 100;

  const getAnswer = useCallback(() => {
    const val = answers[q.key];
    if (val === undefined || val === null) return q.type === "multi-chip" ? [] : "";
    return val;
  }, [answers, q]);

  const canAdvance = useCallback(() => {
    if (!q.required) return true;
    const val = getAnswer();
    if (Array.isArray(val)) return val.length > 0;
    return typeof val === "string" && val.trim().length > 0;
  }, [q, getAnswer]);

  const goNext = useCallback(() => {
    if (!canAdvance()) {
      setShake(true);
      setTimeout(() => setShake(false), 600);
      return;
    }
    if (idx < total - 1) {
      setDir("next");
      setIdx(i => i + 1);
    } else {
      onComplete();
    }
  }, [canAdvance, idx, total, onComplete]);

  const goPrev = useCallback(() => {
    if (idx > 0) { setDir("prev"); setIdx(i => i - 1); }
  }, [idx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); goNext(); }
      if (e.key === "Escape") goPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev]);

  const handleChipSingle = (val: string) => onUpdate(q.key, val);
  const handleChipMulti = (val: string) => {
    const current: string[] = answers[q.key] || [];
    if (current.includes(val)) {
      onUpdate(q.key, current.filter(v => v !== val));
    } else {
      if (q.maxSelect && current.length >= q.maxSelect) return;
      onUpdate(q.key, [...current, val]);
    }
  };

  const chipCls = (selected: boolean) => cn(
    "inline-flex px-5 py-3 rounded-xl text-sm border cursor-pointer transition-all select-none",
    selected
      ? "bg-primary/10 border-primary text-primary"
      : "bg-[#1A1A1A] border-[#2A2A2A] text-muted-foreground hover:border-primary/40 hover:text-foreground"
  );

  const inputCls = "w-full rounded-xl px-[18px] py-[14px] text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none transition-all border bg-[#1A1A1A] border-[#2A2A2A] focus:border-primary focus:shadow-[0_0_0_3px_rgba(0,255,102,0.08)]";

  const renderInput = () => {
    const answer = getAnswer();

    switch (q.type) {
      case "text":
        return (
          <input
            type="text"
            value={answer as string}
            onChange={e => onUpdate(q.key, e.target.value)}
            placeholder={q.placeholder}
            className={inputCls}
            autoFocus
          />
        );

      case "textarea":
        return (
          <div className="w-full">
            <textarea
              value={answer as string}
              onChange={e => {
                const v = e.target.value;
                if (q.maxChars && v.length > q.maxChars) return;
                onUpdate(q.key, v);
              }}
              placeholder={q.placeholder}
              rows={4}
              className={cn(inputCls, "resize-none min-h-[120px]")}
              autoFocus
            />
            {q.maxChars && (
              <div className={cn("text-right text-xs mt-1.5", (answer as string).length >= q.maxChars ? "text-destructive" : "text-muted-foreground/40")}>
                {(answer as string).length}/{q.maxChars}
              </div>
            )}
          </div>
        );

      case "single-chip":
        return (
          <div className="flex flex-wrap gap-2.5">
            {q.options!.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => handleChipSingle(opt)}
                className={chipCls(answer === opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        );

      case "multi-chip":
        return (
          <div>
            <div className="flex flex-wrap gap-2.5">
              {q.options!.map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleChipMulti(opt)}
                  className={chipCls((answer as string[]).includes(opt))}
                >
                  {opt}
                </button>
              ))}
            </div>
            {q.maxSelect && (
              <p className="text-xs text-muted-foreground/40 mt-2">Máximo: {q.maxSelect} opções</p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0D0D0D" }}>
      <div className="tech-grid-bg" />

      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-[#1A1A1A]">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Logo + Question counter */}
      <div className="fixed top-3 left-4 z-50">
        <img src={aceleriqLogo} alt="Aceleriq" className="h-20 w-auto" />
      </div>
      <div className="fixed top-3 right-4 z-50 text-xs text-muted-foreground/50">
        Pergunta {idx + 1} de {total}
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-12 sm:py-16 relative z-10">
        <div
          key={idx}
          className={cn("w-full max-w-[560px]", shake && "animate-shake")}
          style={{
            animation: shake
              ? undefined
              : dir === "next"
                ? "qSlideIn 0.3s ease-out"
                : "qSlideInReverse 0.3s ease-out",
          }}
        >
          {/* Block label */}
          <div className="text-[11px] uppercase tracking-[2px] text-primary font-semibold mb-4">
            {q.blockLabel}
          </div>

          {/* Question */}
          <h2 className="text-xl sm:text-2xl md:text-[28px] font-semibold text-foreground mb-2 leading-tight">
            {q.question}
          </h2>

          {/* Hint */}
          <p className="text-sm text-muted-foreground/60 mb-8">{q.hint}</p>

          {/* Input area */}
          {renderInput()}
        </div>
      </div>

      {/* Nav */}
      <div className="sticky bottom-0 z-40 px-4 sm:px-6 py-4 sm:py-5 safe-area-bottom" style={{ background: "rgba(13,13,13,0.9)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-[560px] mx-auto flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
          {idx > 0 ? (
            <button
              onClick={goPrev}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none"
            >
              <ChevronLeft className="w-4 h-4" /> Voltar
            </button>
          ) : <div />}

          <div className="flex items-center gap-4 w-full sm:w-auto">
            <span className="text-[11px] text-muted-foreground/30 hidden sm:inline">⌨ Enter para avançar</span>
            <button
              onClick={goNext}
              disabled={q.required && !canAdvance()}
              className="w-full sm:w-auto px-8 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer border-none disabled:opacity-40 bg-primary text-primary-foreground hover:opacity-90 btn-interactive"
            >
              {idx === total - 1 ? "Finalizar ✓" : "Próxima →"}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes qSlideIn { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }
        @keyframes qSlideInReverse { from { opacity:0; transform:translateX(-40px); } to { opacity:1; transform:translateX(0); } }
        .animate-shake { animation: shake 0.5s ease-in-out; }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
      `}</style>
    </div>
  );
}
