import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, Mail, MessageCircle, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

// ============== Constants ==============

const WHATSAPP_NUMBER = "5511999999999"; // ajuste se necessário
const CONTACT_EMAIL = "contato@aceleriq.online";

type Category = "identidade" | "mercado" | "objetivos" | "perfil" | "maturidade";

type Question = {
  id: string;
  category: Category;
  type: "text" | "single_select";
  label: string;
  placeholder?: string;
  minLength?: number;
  options?: { value: string; label: string }[];
};

const CATEGORY_META: Record<Category, { label: string; hue: string; accent: string }> = {
  identidade: { label: "Identidade", hue: "from-emerald-400/20 to-emerald-600/5", accent: "text-emerald-400" },
  mercado: { label: "Mercado", hue: "from-cyan-400/20 to-cyan-600/5", accent: "text-cyan-400" },
  objetivos: { label: "Objetivos", hue: "from-violet-400/20 to-violet-600/5", accent: "text-violet-400" },
  perfil: { label: "Perfil", hue: "from-amber-400/20 to-amber-600/5", accent: "text-amber-400" },
  maturidade: { label: "Maturidade", hue: "from-rose-400/20 to-rose-600/5", accent: "text-rose-400" },
};

const QUESTIONS: Question[] = [
  { id: "positioning", category: "identidade", type: "text", minLength: 30,
    label: "Em 1-2 frases, como você descreveria o que sua empresa faz?",
    placeholder: "Ex: Ajudamos clínicas de estética a escalar via tráfego pago e CRM..." },
  { id: "differential", category: "identidade", type: "text", minLength: 30,
    label: "O que vocês entregam que os concorrentes não entregam?",
    placeholder: "O diferencial real, não o de marketing." },
  { id: "icp", category: "mercado", type: "text", minLength: 40,
    label: "Descreva seu cliente ideal: quem é, o que faz, qual o momento dele.",
    placeholder: "Setor, faturamento, tamanho de equipe, contexto..." },
  { id: "main_pains", category: "mercado", type: "text", minLength: 50,
    label: "Quais as 3 principais dores desse cliente antes de fechar com você?",
    placeholder: "1. ...\n2. ...\n3. ..." },
  { id: "goals_12m", category: "objetivos", type: "text", minLength: 30,
    label: "Qual é seu principal objetivo para os próximos 12 meses?",
    placeholder: "Faturamento, escala, novo mercado, posicionamento..." },
  { id: "success_metric", category: "objetivos", type: "text",
    label: "Qual métrica define o sucesso dessa jornada?",
    placeholder: "MRR, CAC, LTV, leads/mês..." },
  { id: "revenue_range", category: "perfil", type: "single_select",
    label: "Qual o faturamento médio mensal da empresa hoje?",
    options: [
      "Até R$ 20k/mês","R$ 20k-50k/mês","R$ 50k-200k/mês","R$ 200k-500k/mês",
      "R$ 500k-1M/mês","R$ 1M-5M/mês","R$ 5M+/mês",
    ].map(v => ({ value: v, label: v })) },
  { id: "team_size", category: "perfil", type: "single_select",
    label: "Quantas pessoas tem hoje no time?",
    options: ["Solo (1 pessoa)","2-5 pessoas","6-15 pessoas","16-50 pessoas","51-200 pessoas","200+"]
      .map(v => ({ value: v, label: v })) },
  { id: "maturity_digital", category: "maturidade", type: "single_select",
    label: "Como está sua maturidade digital hoje?",
    options: [
      { value: "baixa", label: "Baixa — começando do zero" },
      { value: "media", label: "Média — presença sem método" },
      { value: "alta", label: "Alta — já opera digitalmente" },
    ] },
  { id: "ai_readiness", category: "maturidade", type: "single_select",
    label: "Qual seu nível de prontidão para IA?",
    options: [
      { value: "baixa", label: "Baixa — nunca usou IA" },
      { value: "media", label: "Média — usa ChatGPT pessoal sem estrutura" },
      { value: "alta", label: "Alta — já tem agente/automação com IA" },
    ] },
];

const PLAN_INFO: Record<string, { name: string; tagline: string; description: string }> = {
  starter: {
    name: "Fundação",
    tagline: "Estruturando o digital com método",
    description: "Para quem precisa montar a base: posicionamento, presença digital, CRM e primeiras campanhas com governança.",
  },
  growth: {
    name: "Aceleração",
    tagline: "Escalando com previsibilidade",
    description: "Para empresas com base instalada que querem destravar crescimento via tráfego, conteúdo e automação operacional.",
  },
  enterprise: {
    name: "Escala IA-First",
    tagline: "Operação aumentada por IA",
    description: "Para operações maduras que querem alavancar receita com agentes de IA, automação ponta-a-ponta e dados em tempo real.",
  },
};

// ============== Component ==============

type Lead = {
  lead_name: string;
  lead_email: string;
  lead_whatsapp: string;
  lead_company: string;
};

type Answers = Record<string, string>;

type Phase = "loading" | "lead" | "quiz" | "submitting" | "done";

export default function QuizPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [stepIdx, setStepIdx] = useState(0);
  const [lead, setLead] = useState<Lead>({ lead_name: "", lead_email: "", lead_whatsapp: "", lead_company: "" });
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<{ score: number; plan: string } | null>(null);
  const [savingHint, setSavingHint] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // ---- Load progress ----
  useEffect(() => {
    if (!token) {
      setPhase("lead");
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("submit-quiz", {
          body: { token, action: "load" },
        });
        if (error) throw error;
        const row = (data as any)?.data;
        if (row) {
          setLead({
            lead_name: row.lead_name ?? "",
            lead_email: row.lead_email ?? "",
            lead_whatsapp: row.lead_whatsapp ?? "",
            lead_company: row.lead_company ?? "",
          });
          const a: Answers = {};
          QUESTIONS.forEach(q => { if (row[q.id]) a[q.id] = row[q.id]; });
          setAnswers(a);
          if (row.status === "submitted" && row.icp_fit_score != null) {
            setResult({ score: row.icp_fit_score, plan: row.recommended_plan ?? "starter" });
            setPhase("done");
            return;
          }
          // resume on next unanswered question if lead present
          if (row.lead_name && row.lead_email) {
            const nextIdx = QUESTIONS.findIndex(q => !a[q.id]);
            setStepIdx(nextIdx === -1 ? QUESTIONS.length - 1 : nextIdx);
            setPhase("quiz");
            return;
          }
        }
        setPhase("lead");
      } catch (e: any) {
        console.error(e);
        setPhase("lead");
      }
    })();
  }, [token]);

  // ---- Save progress (debounced) ----
  const persist = useCallback((nextLead: Lead, nextAnswers: Answers) => {
    if (!token) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSavingHint(true);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await supabase.functions.invoke("submit-quiz", {
          body: { token, action: "save_progress", ...nextLead, ...nextAnswers },
        });
      } catch (e) {
        console.error("save_progress failed", e);
      } finally {
        setSavingHint(false);
      }
    }, 600);
  }, [token]);

  // ---- Lead form ----
  const leadValid = useMemo(() => {
    if (!lead.lead_name.trim()) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.lead_email.trim());
  }, [lead]);

  const submitLead = () => {
    if (!leadValid) {
      toast.error("Preencha nome e e-mail válido para continuar.");
      return;
    }
    persist(lead, answers);
    setPhase("quiz");
    setStepIdx(0);
  };

  // ---- Quiz nav ----
  const current = QUESTIONS[stepIdx];
  const totalSteps = QUESTIONS.length;
  const progress = ((stepIdx) / totalSteps) * 100;

  const isCurrentValid = useMemo(() => {
    const v = (answers[current?.id] ?? "").trim();
    if (!v) return false;
    if (current.minLength && v.length < current.minLength) return false;
    return true;
  }, [answers, current]);

  const setAnswer = (id: string, value: string) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    persist(lead, next);
  };

  const goNext = useCallback(() => {
    if (!isCurrentValid) return;
    if (stepIdx < totalSteps - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      void submitFinal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrentValid, stepIdx, totalSteps]);

  const goPrev = () => {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  };

  const submitFinal = async () => {
    if (!token) return;
    setPhase("submitting");
    try {
      const { data, error } = await supabase.functions.invoke("submit-quiz", {
        body: { token, action: "submit", ...lead, ...answers },
      });
      if (error) throw error;
      const r = data as { score: number; plan: string };
      setResult({ score: r.score, plan: r.plan });
      setPhase("done");
    } catch (e: any) {
      toast.error("Não conseguimos enviar. Tente novamente.");
      setPhase("quiz");
    }
  };

  // ---- Keyboard nav ----
  useEffect(() => {
    if (phase !== "quiz") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && current.type === "single_select") {
        e.preventDefault();
        goNext();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        goNext();
      }
      if (e.key === "ArrowLeft" && (e.metaKey || e.altKey)) {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, current, goNext]);

  // ============== Render ==============

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      {/* Background gradient blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute top-1/2 -right-40 w-[36rem] h-[36rem] rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      {/* Header */}
      <header className="px-6 py-5 flex items-center justify-between max-w-5xl mx-auto">
        <img src={aceleriqLogo} alt="Aceleriq" className="h-9 w-auto" />
        {phase === "quiz" && (
          <div className="text-xs font-mono text-muted-foreground">
            {savingHint ? "Salvando…" : "Salvo automaticamente"}
          </div>
        )}
      </header>

      {/* Progress bar (during quiz) */}
      {phase === "quiz" && (
        <div className="max-w-3xl mx-auto px-6">
          <div className="flex items-center justify-between mb-2 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            <span className={CATEGORY_META[current.category].accent}>
              {CATEGORY_META[current.category].label}
            </span>
            <span>{stepIdx + 1} / {totalSteps}</span>
          </div>
          <div className="h-1 w-full bg-secondary rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-6 py-10 md:py-14">
        <AnimatePresence mode="wait">
          {phase === "loading" && (
            <motion.div key="loading" className="flex flex-col items-center gap-3 py-32"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Carregando seu diagnóstico…</p>
            </motion.div>
          )}

          {phase === "lead" && (
            <LeadForm
              key="lead"
              lead={lead}
              onChange={(next) => { setLead(next); persist(next, answers); }}
              onSubmit={submitLead}
              valid={leadValid}
            />
          )}

          {phase === "quiz" && current && (
            <QuestionScreen
              key={current.id}
              q={current}
              value={answers[current.id] ?? ""}
              onChange={(v) => setAnswer(current.id, v)}
              onNext={goNext}
              onPrev={goPrev}
              isFirst={stepIdx === 0}
              isLast={stepIdx === totalSteps - 1}
              isValid={isCurrentValid}
            />
          )}

          {phase === "submitting" && (
            <motion.div key="submitting" className="flex flex-col items-center gap-3 py-32"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Calculando seu ICP-Fit…</p>
            </motion.div>
          )}

          {phase === "done" && result && (
            <ResultScreen key="done" score={result.score} plan={result.plan} leadName={lead.lead_name} />
          )}
        </AnimatePresence>
      </main>

      <footer className="text-center text-[11px] font-mono uppercase tracking-widest text-muted-foreground py-8">
        Powered by Aceleriq · Performance OS
      </footer>
    </div>
  );
}

// ============== Sub-components ==============

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl shadow-2xl shadow-primary/5 p-7 md:p-10 ${className}`}>
      {children}
    </div>
  );
}

function LeadForm({
  lead, onChange, onSubmit, valid,
}: {
  lead: Lead;
  onChange: (l: Lead) => void;
  onSubmit: () => void;
  valid: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
      transition={{ type: "spring", stiffness: 120, damping: 20 }}>
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-primary mb-3">
          <Sparkles className="h-3.5 w-3.5" /> Diagnóstico Estratégico Aceleriq
        </span>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-3">
          Vamos descobrir o estágio da sua operação.
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          São 10 perguntas rápidas. Ao final, você recebe seu ICP-Fit score e o plano ideal para sua empresa.
        </p>
      </div>

      <GlassCard>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Seu nome *">
            <Input value={lead.lead_name} onChange={(e) => onChange({ ...lead, lead_name: e.target.value })}
              placeholder="Como podemos te chamar?" maxLength={120} />
          </Field>
          <Field label="E-mail *">
            <Input type="email" value={lead.lead_email} onChange={(e) => onChange({ ...lead, lead_email: e.target.value })}
              placeholder="voce@empresa.com" maxLength={200} />
          </Field>
          <Field label="WhatsApp">
            <Input value={lead.lead_whatsapp} onChange={(e) => onChange({ ...lead, lead_whatsapp: e.target.value })}
              placeholder="(11) 99999-9999" maxLength={30} />
          </Field>
          <Field label="Empresa">
            <Input value={lead.lead_company} onChange={(e) => onChange({ ...lead, lead_company: e.target.value })}
              placeholder="Nome da empresa" maxLength={150} />
          </Field>
        </div>

        <Button
          size="lg"
          className="mt-7 w-full h-12 text-base font-medium"
          disabled={!valid}
          onClick={onSubmit}
        >
          Começar diagnóstico <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </GlassCard>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-2 block">
        {label}
      </Label>
      {children}
    </div>
  );
}

function QuestionScreen({
  q, value, onChange, onNext, onPrev, isFirst, isLast, isValid,
}: {
  q: Question;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onPrev: () => void;
  isFirst: boolean;
  isLast: boolean;
  isValid: boolean;
}) {
  const meta = CATEGORY_META[q.category];
  const remaining = q.minLength ? Math.max(0, q.minLength - (value?.length ?? 0)) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24 }}
      transition={{ type: "spring", stiffness: 140, damping: 22 }}
    >
      <div className={`rounded-3xl border border-border/60 bg-gradient-to-br ${meta.hue} backdrop-blur-xl p-7 md:p-10 shadow-2xl shadow-black/30`}>
        <h2 className="text-2xl md:text-[28px] leading-tight font-semibold tracking-tight mb-6">
          {q.label}
        </h2>

        {q.type === "text" && (
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={q.placeholder}
            rows={5}
            maxLength={2000}
            autoFocus
            className="text-base bg-background/60 border-border/60 focus-visible:ring-primary"
          />
        )}

        {q.type === "single_select" && (
          <div className="grid gap-2.5">
            {q.options!.map((opt) => {
              const selected = value === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange(opt.value)}
                  className={`group flex items-center justify-between text-left px-4 py-3.5 rounded-xl border transition-all
                    ${selected
                      ? "border-primary bg-primary/10 text-foreground shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]"
                      : "border-border/60 bg-background/40 hover:border-primary/40 hover:bg-background/70"}`}
                >
                  <span className="text-sm md:text-base">{opt.label}</span>
                  <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors
                    ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {q.type === "text" && q.minLength && (
          <p className="mt-3 text-xs text-muted-foreground">
            {remaining > 0
              ? `${remaining} caracteres para continuar`
              : `${value.length} caracteres`}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between mt-6">
        <Button
          variant="ghost"
          onClick={onPrev}
          disabled={isFirst}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Anterior
        </Button>

        <div className="hidden md:block text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          {q.type === "text" ? "Ctrl + Enter para avançar" : "Enter para avançar"}
        </div>

        <Button
          size="lg"
          onClick={onNext}
          disabled={!isValid}
          className="h-11 px-6"
        >
          {isLast ? "Finalizar" : "Próxima"} <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  );
}

function ResultScreen({ score, plan, leadName }: { score: number; plan: string; leadName: string }) {
  const info = PLAN_INFO[plan] ?? PLAN_INFO.starter;
  const firstName = (leadName || "").split(" ")[0];

  const waMessage = encodeURIComponent(
    `Olá! Sou ${leadName || "novo lead"}. Acabei de fazer o diagnóstico Aceleriq (ICP-Fit ${score} · Plano ${info.name}) e quero conversar.`
  );

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 120, damping: 20 }}>
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-primary mb-3">
          <Sparkles className="h-3.5 w-3.5" /> Diagnóstico concluído
        </span>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          {firstName ? `Pronto, ${firstName}.` : "Pronto."}
        </h1>
        <p className="text-muted-foreground mt-2">Aqui está sua leitura estratégica.</p>
      </div>

      <GlassCard className="text-center">
        <div className="flex flex-col items-center gap-6">
          <ScoreRing score={score} />

          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
              Plano recomendado
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-primary">{info.name}</h2>
            <p className="text-sm text-muted-foreground mt-1">{info.tagline}</p>
          </div>

          <p className="text-[15px] leading-relaxed text-foreground/90 max-w-xl">
            {info.description}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md pt-2">
            <Button asChild size="lg" className="flex-1 h-12">
              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}?text=${waMessage}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="mr-2 h-4 w-4" /> Agendar conversa
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="flex-1 h-12">
              <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Diagnóstico Aceleriq")}`}>
                <Mail className="mr-2 h-4 w-4" /> Por e-mail
              </a>
            </Button>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 70;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative" style={{ width: radius * 2 + stroke, height: radius * 2 + stroke }}>
      <svg width={radius * 2 + stroke} height={radius * 2 + stroke} className="-rotate-90">
        <circle
          cx={(radius * 2 + stroke) / 2}
          cy={(radius * 2 + stroke) / 2}
          r={radius}
          stroke="hsl(var(--secondary))"
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={(radius * 2 + stroke) / 2}
          cy={(radius * 2 + stroke) / 2}
          r={radius}
          stroke="hsl(var(--primary))"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">ICP-Fit</div>
        <div className="text-5xl font-semibold tracking-tight font-mono">{clamped}</div>
      </div>
    </div>
  );
}
