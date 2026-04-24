import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, MessageCircle, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

// ============== Constants ==============

const WHATSAPP_NUMBER = "5541997483429";

type Category = "identidade" | "mercado" | "objetivos" | "perfil" | "maturidade";

type Question = {
  id: string;
  category: Category;
  type: "text" | "single_select";
  label: string;
  helper?: string;
  placeholder?: string;
  minLength?: number;
  options?: { value: string; label: string }[];
};

const CATEGORY_META: Record<Category, { label: string; accent: string }> = {
  identidade: { label: "Identidade", accent: "text-primary" },
  mercado: { label: "Mercado", accent: "text-cyan-400" },
  objetivos: { label: "Objetivos", accent: "text-violet-400" },
  perfil: { label: "Perfil", accent: "text-amber-400" },
  maturidade: { label: "Maturidade", accent: "text-rose-400" },
};

const QUESTIONS: Question[] = [
  { id: "positioning", category: "identidade", type: "text", minLength: 30,
    label: "Em 1-2 frases, como você descreveria o que sua empresa faz?",
    helper: "Sem jargão. Como você explicaria pro seu vizinho.",
    placeholder: "Ex: Ajudamos clínicas de estética a escalar via tráfego pago e CRM..." },
  { id: "differential", category: "identidade", type: "text", minLength: 30,
    label: "O que vocês entregam que os concorrentes não entregam?",
    helper: "O diferencial real, não o de marketing.",
    placeholder: "Ex: O único que entrega relatório semanal com IA..." },
  { id: "icp", category: "mercado", type: "text", minLength: 40,
    label: "Descreva seu cliente ideal: quem é, o que faz, qual o momento dele.",
    helper: "Setor, faturamento, tamanho de equipe, contexto.",
    placeholder: "Ex: Donos de clínicas com 5-15 funcionários, faturando R$ 80-300k/mês..." },
  { id: "main_pains", category: "mercado", type: "text", minLength: 50,
    label: "Quais as 3 principais dores desse cliente antes de fechar com você?",
    helper: "Liste as dores reais que fazem ele buscar uma solução.",
    placeholder: "1. ...\n2. ...\n3. ..." },
  { id: "goals_12m", category: "objetivos", type: "text", minLength: 30,
    label: "Qual é seu principal objetivo para os próximos 12 meses?",
    helper: "Faturamento, escala, novo mercado, posicionamento.",
    placeholder: "Ex: Sair de R$ 200k para R$ 500k/mês com previsibilidade..." },
  { id: "success_metric", category: "objetivos", type: "text",
    label: "Qual métrica define o sucesso dessa jornada?",
    helper: "Uma métrica única, mensurável.",
    placeholder: "Ex: MRR, CAC, LTV, leads/mês..." },
  { id: "revenue_range", category: "perfil", type: "single_select",
    label: "Qual o faturamento médio mensal da empresa hoje?",
    helper: "Escolha a faixa mais próxima.",
    options: [
      "Até R$ 20k/mês","R$ 20k-50k/mês","R$ 50k-200k/mês","R$ 200k-500k/mês",
      "R$ 500k-1M/mês","R$ 1M-5M/mês","R$ 5M+/mês",
    ].map(v => ({ value: v, label: v })) },
  { id: "team_size", category: "perfil", type: "single_select",
    label: "Quantas pessoas tem hoje no time?",
    helper: "Considere o time interno e parceiros fixos.",
    options: ["Solo (1 pessoa)","2-5 pessoas","6-15 pessoas","16-50 pessoas","51-200 pessoas","200+"]
      .map(v => ({ value: v, label: v })) },
  { id: "maturity_digital", category: "maturidade", type: "single_select",
    label: "Como está sua maturidade digital hoje?",
    helper: "Seja honesto — vamos te encontrar onde você está.",
    options: [
      { value: "baixa", label: "Baixa — começando do zero" },
      { value: "media", label: "Média — presença sem método" },
      { value: "alta", label: "Alta — já opera digitalmente" },
    ] },
  { id: "ai_readiness", category: "maturidade", type: "single_select",
    label: "Qual seu nível de prontidão para IA?",
    helper: "IA real, não só ChatGPT pra escrever post.",
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
    description: "Pra quem precisa montar a base: posicionamento, presença digital, CRM e primeiras campanhas com governança.",
  },
  growth: {
    name: "Aceleração",
    tagline: "Escalando com previsibilidade",
    description: "Pra empresas com base instalada que querem destravar crescimento via tráfego, conteúdo e automação operacional.",
  },
  enterprise: {
    name: "Escala IA-First",
    tagline: "Operação aumentada por IA",
    description: "Pra operações maduras que querem alavancar receita com agentes de IA, automação ponta-a-ponta e dados em tempo real.",
  },
};

// ============== Helpers ==============

function maskWhatsapp(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 13); // 55 + 11 dígitos
  let local = digits;
  if (digits.startsWith("55")) local = digits.slice(2);
  local = local.slice(0, 11);
  const dd = local.slice(0, 2);
  const p1 = local.slice(2, 7);
  const p2 = local.slice(7, 11);
  let out = "+55";
  if (dd) out += ` ${dd}`;
  if (p1) out += ` ${p1}`;
  if (p2) out += `-${p2}`;
  return out.trim();
}

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
          if (row.lead_name) {
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
    return lead.lead_name.trim().length >= 2;
  }, [lead]);

  const submitLead = () => {
    if (!leadValid) {
      toast.error("Informe seu nome para continuar.");
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

  const submitFinal = useCallback(async () => {
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
  }, [token, lead, answers]);

  const goNext = useCallback(() => {
    if (!isCurrentValid) return;
    if (stepIdx < totalSteps - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      void submitFinal();
    }
  }, [isCurrentValid, stepIdx, totalSteps, submitFinal]);

  const goPrev = () => {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
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

      {/* Header (compact during quiz) */}
      {phase !== "lead" && phase !== "done" && (
        <header className="px-5 md:px-8 py-5 flex items-center justify-between max-w-2xl mx-auto">
          <img src={aceleriqLogo} alt="Aceleriq" className="h-[60px] md:h-20 w-auto" />
          {phase === "quiz" && (
            <div className="text-[10px] md:text-xs font-mono text-muted-foreground">
              {savingHint ? "Salvando…" : "Salvo automaticamente"}
            </div>
          )}
        </header>
      )}

      {/* Progress bar (during quiz) */}
      {phase === "quiz" && (
        <div className="max-w-2xl mx-auto px-5 md:px-8">
          <div className="flex items-center justify-between mb-2 text-[10px] md:text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            <span className={CATEGORY_META[current.category].accent}>
              {CATEGORY_META[current.category].label}
            </span>
            <span>{stepIdx + 1} / {totalSteps}</span>
          </div>
          <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
              style={{ boxShadow: "0 0 12px hsl(var(--primary) / 0.6)" }}
            />
          </div>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-5 md:px-8 py-8 md:py-14">
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

      <footer className="text-center text-[10px] md:text-[11px] font-mono uppercase tracking-widest text-muted-foreground py-8">
        Powered by Aceleriq · Performance OS
      </footer>
    </div>
  );
}

// ============== Sub-components ==============

function LeadForm({
  lead, onChange, onSubmit, valid,
}: {
  lead: Lead;
  onChange: (l: Lead) => void;
  onSubmit: () => void;
  valid: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ type: "spring", stiffness: 120, damping: 20 }}
      className="pt-6 md:pt-12"
    >
      <div className="text-center mb-8 md:mb-10">
        <img
          src={aceleriqLogo}
          alt="Aceleriq"
          className="h-20 md:h-[100px] w-auto mx-auto mb-8"
        />
        <span className="inline-flex items-center gap-2 text-[10px] md:text-[11px] font-mono uppercase tracking-widest text-primary mb-4">
          <Sparkles className="h-3.5 w-3.5" /> Diagnóstico Aceleriq
        </span>
        <h1 className="text-2xl md:text-4xl font-semibold tracking-tight mb-3 leading-tight">
          Diagnóstico Acelerado AI-First
        </h1>
        <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
          10 perguntas. 8 minutos. Vamos descobrir se somos o parceiro certo pra sua operação.
        </p>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl shadow-2xl shadow-primary/5 p-5 md:p-8">
        <div className="grid gap-5">
          <Field label="Seu nome *">
            <Input
              value={lead.lead_name}
              onChange={(e) => onChange({ ...lead, lead_name: e.target.value })}
              placeholder="Como podemos te chamar?"
              maxLength={120}
              className="h-12 text-base"
              autoFocus
            />
          </Field>
          <Field label="WhatsApp">
            <Input
              type="tel"
              inputMode="numeric"
              value={lead.lead_whatsapp}
              onChange={(e) => onChange({ ...lead, lead_whatsapp: maskWhatsapp(e.target.value) })}
              placeholder="+55 11 99999-9999"
              maxLength={20}
              className="h-12 text-base"
            />
          </Field>
          <Field label="E-mail (opcional)">
            <Input
              type="email"
              value={lead.lead_email}
              onChange={(e) => onChange({ ...lead, lead_email: e.target.value })}
              placeholder="voce@empresa.com"
              maxLength={200}
              className="h-12 text-base"
            />
          </Field>
          <Field label="Empresa (opcional)">
            <Input
              value={lead.lead_company}
              onChange={(e) => onChange({ ...lead, lead_company: e.target.value })}
              placeholder="Nome da empresa"
              maxLength={150}
              className="h-12 text-base"
            />
          </Field>
        </div>

        <Button
          size="lg"
          className="mt-7 w-full h-14 text-base font-semibold"
          disabled={!valid}
          onClick={onSubmit}
        >
          Começar diagnóstico <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] md:text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-2 block">
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
  const remaining = q.minLength ? Math.max(0, q.minLength - (value?.length ?? 0)) : 0;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (q.type === "text" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [q.id, q.type]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24 }}
      transition={{ type: "spring", stiffness: 120, damping: 22 }}
      className="space-y-6 md:space-y-8"
    >
      <div>
        <h2 className="text-xl md:text-2xl font-bold tracking-tight leading-snug mb-2">
          {q.label}
        </h2>
        {q.helper && (
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
            {q.helper}
          </p>
        )}
      </div>

      {q.type === "text" ? (
        <div>
          <Textarea
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={q.placeholder}
            className="min-h-[120px] md:min-h-[140px] text-base leading-relaxed resize-none"
            maxLength={2000}
          />
          {q.minLength && (
            <div className="mt-2 text-[11px] font-mono text-muted-foreground text-right">
              {remaining > 0 ? `Faltam ${remaining} caracteres` : "✓ Pronto"}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-2.5">
          {q.options?.map((opt) => {
            const selected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                className={`text-left p-4 rounded-xl border-2 transition-all min-h-[56px] flex items-center ${
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/60 bg-card/30 hover:border-border hover:bg-card/60 text-foreground/90"
                }`}
              >
                <span className="text-base font-medium">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col-reverse md:flex-row gap-3 pt-2">
        <Button
          variant="ghost"
          onClick={onPrev}
          disabled={isFirst}
          className="h-12 px-6 w-full md:w-auto"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="h-12 px-6 w-full md:flex-1 text-base font-semibold"
        >
          {isLast ? "Finalizar diagnóstico" : "Próxima"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  );
}

function ResultScreen({ score, plan, leadName }: { score: number; plan: string; leadName: string }) {
  const planInfo = PLAN_INFO[plan] ?? PLAN_INFO.starter;
  const size = 200;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, score)) / 100) * c;

  const waText = `Olá! Acabei de fazer o diagnóstico no site. Meu ICP Score foi ${score}. Quero conversar.`;
  const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(waText)}`;

  const firstName = (leadName || "").trim().split(" ")[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 120, damping: 22 }}
      className="pt-6 md:pt-10 text-center"
    >
      <img
        src={aceleriqLogo}
        alt="Aceleriq"
        className="h-16 md:h-20 w-auto mx-auto mb-8"
      />

      <span className="inline-flex items-center gap-2 text-[10px] md:text-[11px] font-mono uppercase tracking-widest text-primary mb-4">
        <Sparkles className="h-3.5 w-3.5" /> Diagnóstico concluído
      </span>

      <h1 className="text-2xl md:text-4xl font-semibold tracking-tight mb-3 leading-tight">
        {firstName ? `Pronto, ${firstName}.` : "Pronto."} Seu diagnóstico está aqui.
      </h1>
      <p className="text-base text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
        Calculamos seu ICP-Fit e o plano mais aderente ao momento da sua operação.
      </p>

      {/* ICP Ring */}
      <div className="flex flex-col items-center mb-10">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="hsl(var(--secondary))"
              strokeWidth={stroke}
            />
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
              style={{ filter: "drop-shadow(0 0 12px hsl(var(--primary) / 0.7))" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="text-5xl font-mono font-light text-primary tabular-nums"
            >
              {Math.round(score)}
            </motion.span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mt-1">
              ICP Score
            </span>
          </div>
        </div>
      </div>

      {/* Plan card */}
      <div className="rounded-2xl border border-primary/30 bg-card/40 backdrop-blur-xl p-6 md:p-8 text-left mb-8 shadow-2xl shadow-primary/10">
        <div className="text-[10px] md:text-[11px] font-mono uppercase tracking-widest text-primary mb-2">
          Plano recomendado
        </div>
        <h3 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          {planInfo.name}
        </h3>
        <p className="text-sm md:text-base text-muted-foreground italic mb-4">
          {planInfo.tagline}
        </p>
        <p className="text-base text-foreground/90 leading-relaxed">
          {planInfo.description}
        </p>
      </div>

      {/* Single CTA */}
      <Button
        asChild
        size="lg"
        className="w-full h-14 text-base font-semibold"
      >
        <a href={waUrl} target="_blank" rel="noopener noreferrer">
          <MessageCircle className="mr-2 h-5 w-5" />
          Falar com o time no WhatsApp
        </a>
      </Button>

      <p className="mt-4 text-sm text-muted-foreground">
        Alguém do time responde em até 2 horas em dias úteis.
      </p>
    </motion.div>
  );
}
