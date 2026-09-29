import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CampoDeFormulario, Carregando, GrupoDeCampos, botao, foco, juntar, superficie, texto } from "@/components/sistema";
import CascaPublica, { campoPublico, campoTextoPublico } from "@/components/publico/CascaPublica";
import { supportWhatsAppUrl } from "@/lib/supportContact";
import { emailDoLeadValido, FRASE_EMAIL_INVALIDO, motivoDoErroDoQuiz } from "@/lib/emailDoLead";

// ============== Constants ==============

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
    helper: "Seja honesto · vamos te encontrar onde você está.",
    options: [
      { value: "baixa", label: "Baixa · começando do zero" },
      { value: "media", label: "Média · presença sem método" },
      { value: "alta", label: "Alta · já opera digitalmente" },
    ] },
  { id: "ai_readiness", category: "maturidade", type: "single_select",
    label: "Qual seu nível de prontidão para IA?",
    helper: "IA real, não só ChatGPT pra escrever post.",
    options: [
      { value: "baixa", label: "Baixa · nunca usou IA" },
      { value: "media", label: "Média · usa ChatGPT pessoal sem estrutura" },
      { value: "alta", label: "Alta · já tem agente/automação com IA" },
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

/**
 * "invalid" é nova: antes, um convite inexistente (404), já usado (409) ou
 * bloqueado por limite (429) caía no formulário de lead, a pessoa respondia
 * tudo e o envio final falhava. Agora o problema aparece na abertura, com
 * contato para resolver.
 */
type Phase = "loading" | "invalid" | "lead" | "quiz" | "submitting" | "done";

type InvalidReason = "not_found" | "used" | "rate_limited" | "network" | "unknown";

/**
 * Classifica a falha do carregamento pelo que a função devolve. O SDK
 * embrulha respostas 4xx em FunctionsHttpError com `context` (a Response).
 */
function classifyLoadFailure(error: unknown): InvalidReason {
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if (status === 404) return "not_found";
  if (status === 409) return "used";
  if (status === 429) return "rate_limited";
  const message = error instanceof Error ? error.message : String(error || "");
  if (/fetch|network|load failed|timeout/i.test(message)) return "network";
  return "unknown";
}

const INVALID_COPY: Record<InvalidReason, { title: string; text: string }> = {
  not_found: {
    title: "Link inválido ou expirado",
    text: "Este link de diagnóstico não é mais válido. Peça um novo para a equipe Aceleriq.",
  },
  used: {
    title: "Diagnóstico já enviado",
    text: "As respostas deste link já foram recebidas. Se precisar refazer, fale com a equipe Aceleriq.",
  },
  rate_limited: {
    title: "Muitas tentativas",
    text: "Este link foi aberto vezes demais em pouco tempo. Aguarde alguns minutos e tente de novo.",
  },
  network: {
    title: "A conexão falhou",
    text: "Não conseguimos carregar o seu diagnóstico agora. Confira a internet e tente de novo: o link continua valendo.",
  },
  unknown: {
    title: "Não foi possível abrir o diagnóstico",
    text: "Algo deu errado ao carregar este link. Tente de novo em instantes ou fale com a equipe Aceleriq.",
  },
};

export default function QuizPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [invalidReason, setInvalidReason] = useState<InvalidReason>("unknown");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [lead, setLead] = useState<Lead>({ lead_name: "", lead_email: "", lead_whatsapp: "", lead_company: "" });
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<{ score: number; plan: string } | null>(null);
  const [savingHint, setSavingHint] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // ---- Load progress ----
  useEffect(() => {
    if (!token) {
      setInvalidReason("not_found");
      setPhase("invalid");
      return;
    }
    let alive = true;
    setPhase("loading");
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("submit-quiz", {
          body: { token, action: "load" },
        });
        if (!alive) return;
        if (error) throw error;
        if ((data as any)?.error) {
          // Resposta 200 com corpo de erro: trata como convite inválido.
          throw new Error(String((data as any).error));
        }
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
        if (!alive) return;
        // Qualquer falha ao carregar fecha a porta com explicação. Abrir o
        // formulário mesmo assim era mandar a pessoa responder 10 perguntas
        // para um convite que o servidor já disse que não existe.
        console.error("[quiz] falha ao carregar:", e);
        setInvalidReason(classifyLoadFailure(e));
        setPhase("invalid");
      }
    })();
    return () => { alive = false; };
  }, [token, loadAttempt]);

  // ---- Save progress (debounced) ----
  const persist = useCallback((nextLead: Lead, nextAnswers: Answers) => {
    if (!token) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSavingHint(true);
    saveTimer.current = window.setTimeout(async () => {
      try {
        // E-mail pela metade (ainda digitando) não derruba o salvamento do
        // resto: vai vazio até ficar válido. O servidor recusa e-mail inválido.
        const leadParaSalvar = emailDoLeadValido(nextLead.lead_email)
          ? nextLead
          : { ...nextLead, lead_email: "" };
        await supabase.functions.invoke("submit-quiz", {
          body: { token, action: "save_progress", ...leadParaSalvar, ...nextAnswers },
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
    return lead.lead_name.trim().length >= 2 && emailDoLeadValido(lead.lead_email);
  }, [lead]);

  const submitLead = () => {
    if (!emailDoLeadValido(lead.lead_email)) {
      toast.error(FRASE_EMAIL_INVALIDO);
      return;
    }
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
      // O motivo vem no corpo do erro. E-mail inválido volta para o
      // formulário do lead com a frase do servidor; o resto segue genérico.
      const motivo = await motivoDoErroDoQuiz(e);
      if (motivo.code === "email_invalido") {
        toast.error(motivo.message || FRASE_EMAIL_INVALIDO);
        setPhase("lead");
        return;
      }
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

  const salvo = (
    <span className={texto.auxiliar} aria-live="polite">{savingHint ? "Salvando..." : "Salvo automaticamente"}</span>
  );

  if (phase === "loading") {
    return (
      <CascaPublica titulo="Diagnóstico" descricao="Carregando seu diagnóstico..." largura="media" centralizar={false}>
        <Carregando linhas={4} rotulo="Carregando seu diagnóstico" />
      </CascaPublica>
    );
  }

  if (phase === "invalid") {
    return <InvalidScreen reason={invalidReason} onRetry={() => setLoadAttempt((n) => n + 1)} />;
  }

  if (phase === "lead") {
    return (
      <LeadForm
        lead={lead}
        onChange={(next) => { setLead(next); persist(next, answers); }}
        onSubmit={submitLead}
        valid={leadValid}
      />
    );
  }

  if (phase === "submitting") {
    return (
      <CascaPublica titulo="Calculando seu resultado" descricao="Calculando seu ICP-Fit..." largura="media" centralizar={false}>
        <Carregando linhas={3} rotulo="Calculando seu ICP-Fit" />
      </CascaPublica>
    );
  }

  if (phase === "done" && result) {
    return <ResultScreen score={result.score} plan={result.plan} leadName={lead.lead_name} />;
  }

  if (phase === "quiz" && current) {
    return (
      <CascaPublica
        titulo={current.label}
        tituloQuebra
        descricao={current.helper}
        aoLadoDaMarca={salvo}
        acimaDoTitulo={<Progresso categoria={CATEGORY_META[current.category].label} passo={stepIdx} total={totalSteps} />}
        largura="media"
        centralizar={false}
      >
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
      </CascaPublica>
    );
  }

  return <CascaPublica largura="media" centralizar={false} />;
}

// ============== Sub-components ==============

/** Indicador simples: bloco da pergunta, "3 de 10" e uma barra fina. */
function Progresso({ categoria, passo, total }: { categoria: string; passo: number; total: number }) {
  return (
    <div className="mb-6 min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between">
        <span className={juntar(texto.rotulo, "truncate text-primary")}>{categoria}</span>
        <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{passo + 1} de {total}</span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Progresso do diagnóstico"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={passo}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(passo / total) * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * Tela de convite inválido, espelho da do primeiro acesso (FirstAccess):
 * o que aconteceu, o que fazer e um contato. Falha de rede ou limite de
 * tentativas ganha botão de tentar de novo; convite inexistente ou já
 * usado, não (tentar de novo não muda o fato).
 */
function InvalidScreen({ reason, onRetry }: { reason: InvalidReason; onRetry: () => void }) {
  const copy = INVALID_COPY[reason];
  const canRetry = reason === "network" || reason === "rate_limited" || reason === "unknown";
  const waUrl = supportWhatsAppUrl("Olá! Tentei abrir o link do diagnóstico e ele não funcionou. Podem me ajudar?");
  return (
    <CascaPublica titulo={copy.title} descricao={copy.text} largura="media">
      {waUrl || canRetry ? (
        <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
          {canRetry && (
            <button type="button" onClick={onRetry} className={botao.primario}>
              Tentar de novo
            </button>
          )}
          {waUrl && (
            <a href={waUrl} target="_blank" rel="noreferrer" className={canRetry ? botao.secundario : botao.primario}>
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" /> Falar com a Aceleriq
            </a>
          )}
        </div>
      ) : null}
      {!waUrl && (
        <p className={juntar(texto.auxiliar, "mt-3 leading-5")}>Fale com a equipe Aceleriq pelo canal em que recebeu este link.</p>
      )}
    </CascaPublica>
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
  // O aviso do e-mail aparece depois que a pessoa sai do campo, não a cada tecla.
  const [emailTocado, setEmailTocado] = useState(false);
  const emailComErro = emailTocado && !emailDoLeadValido(lead.lead_email);
  return (
    <CascaPublica
      titulo="Diagnóstico AI-First"
      descricao="10 perguntas, cerca de 8 minutos."
      ajuda="Vamos descobrir se somos o parceiro certo para a sua operação. As respostas ficam salvas enquanto você responde."
      largura="media"
    >
      <form
        className="min-w-0"
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      >
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="Seu nome" obrigatorio>
            <input
              value={lead.lead_name}
              onChange={(e) => onChange({ ...lead, lead_name: e.target.value })}
              placeholder="Como podemos te chamar?"
              maxLength={120}
              autoComplete="name"
              className={campoPublico}
              autoFocus
            />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="WhatsApp">
            <input
              type="tel"
              inputMode="numeric"
              value={lead.lead_whatsapp}
              onChange={(e) => onChange({ ...lead, lead_whatsapp: maskWhatsapp(e.target.value) })}
              placeholder="+55 11 99999-9999"
              maxLength={20}
              autoComplete="tel"
              className={campoPublico}
            />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="E-mail (opcional)" erro={emailComErro ? FRASE_EMAIL_INVALIDO : undefined}>
            <input
              type="email"
              inputMode="email"
              value={lead.lead_email}
              onChange={(e) => onChange({ ...lead, lead_email: e.target.value })}
              onBlur={() => setEmailTocado(true)}
              placeholder="voce@empresa.com"
              maxLength={200}
              autoComplete="email"
              className={campoPublico}
            />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Empresa (opcional)">
            <input
              value={lead.lead_company}
              onChange={(e) => onChange({ ...lead, lead_company: e.target.value })}
              placeholder="Nome da empresa"
              maxLength={150}
              autoComplete="organization"
              className={campoPublico}
            />
          </CampoDeFormulario>
        </GrupoDeCampos>

        <div className="mt-6 flex min-w-0 justify-end">
          <button type="submit" disabled={!valid} className={juntar(botao.primario, "w-full sm:w-auto")}>
            Começar diagnóstico <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </CascaPublica>
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
    <div className="min-w-0">
      {q.type === "text" ? (
        <div className="min-w-0">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={q.placeholder}
            aria-label={q.label}
            aria-describedby={q.minLength ? `quiz-${q.id}-contagem` : undefined}
            className={juntar(campoTextoPublico, "min-h-[140px] resize-none")}
            maxLength={2000}
          />
          {q.minLength && (
            <p id={`quiz-${q.id}-contagem`} className={juntar(texto.auxiliar, "mt-1.5 text-right tabular-nums", remaining === 0 && "text-primary")}>
              {remaining > 0 ? `Faltam ${remaining} caracteres` : "Pronto"}
            </p>
          )}
        </div>
      ) : (
        <div role="radiogroup" aria-label={q.label} className="min-w-0 space-y-2">
          {q.options?.map((opt) => {
            const selected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(opt.value)}
                className={juntar(
                  "flex min-h-[44px] w-full min-w-0 items-center rounded-md border px-3 py-2.5 text-left text-[14px] leading-5 transition-colors",
                  foco,
                  selected ? "border-primary bg-primary/10 text-foreground" : "border-border text-foreground/90 hover:bg-muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className={juntar(
                    "mr-3 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-primary" : "border-muted-foreground/60",
                  )}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0 flex-1">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-8 flex min-w-0 items-center justify-between">
        <button type="button" onClick={onPrev} disabled={isFirst} className={botao.discreto}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" /> Voltar
        </button>
        <button type="button" onClick={onNext} disabled={!isValid} className={juntar(botao.primario, "ml-3")}>
          {isLast ? "Finalizar diagnóstico" : "Próxima"}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ResultScreen({ score, plan, leadName }: { score: number; plan: string; leadName: string }) {
  const planInfo = PLAN_INFO[plan] ?? PLAN_INFO.starter;
  const size = 112;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, score)) / 100) * c;

  const waText = `Olá! Acabei de fazer o diagnóstico no site. Meu ICP Score foi ${score}. Quero conversar.`;
  const waUrl = supportWhatsAppUrl(waText);

  const firstName = (leadName || "").trim().split(" ")[0];

  return (
    <CascaPublica
      titulo={firstName ? `Pronto, ${firstName}` : "Diagnóstico concluído"}
      descricao="Seu ICP-Fit e o plano mais aderente ao momento da sua operação."
      largura="media"
      centralizar={false}
    >
      <div className="flex min-w-0 items-center">
        {/* Anel parado (sem contagem animada): o número já nasce certo. */}
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[28px] font-semibold leading-8 tabular-nums text-primary">{Math.round(score)}</span>
            <span className={texto.auxiliar}>ICP Score</span>
          </div>
        </div>
        <div className="ml-5 min-w-0 flex-1">
          <p className={texto.rotulo}>Plano recomendado</p>
          <p className="mt-1 text-[20px] font-semibold leading-7 tracking-[-0.01em] text-foreground">{planInfo.name}</p>
          <p className={juntar(texto.auxiliar, "mt-0.5 leading-5")}>{planInfo.tagline}</p>
        </div>
      </div>

      <p className={juntar(texto.corpo, superficie.divisoria, "mt-6 pt-6 text-foreground/90")}>{planInfo.description}</p>

      {waUrl && (
        <div className="mt-6 min-w-0">
          <a href={waUrl} target="_blank" rel="noopener noreferrer" className={juntar(botao.primario, "w-full sm:w-auto")}>
            <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            Falar com o time no WhatsApp
          </a>
          <p className={juntar(texto.auxiliar, "mt-2")}>Alguém do time responde em até 2 horas em dias úteis.</p>
        </div>
      )}
    </CascaPublica>
  );
}
