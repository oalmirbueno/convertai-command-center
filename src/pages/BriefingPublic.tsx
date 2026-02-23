import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, ChevronRight, ChevronLeft, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

const PROJECT_TYPE_OPTIONS = [
  { value: "social_media", label: "Social Media", icon: "📱" },
  { value: "trafego", label: "Tráfego Pago", icon: "🚀" },
  { value: "site", label: "Site / Landing Page", icon: "🌐" },
  { value: "automacao", label: "Automação", icon: "⚡" },
  { value: "evento", label: "Evento", icon: "🎪" },
  { value: "outro", label: "Outro", icon: "📊" },
];

const PRAZO_OPTIONS = [
  { value: "urgent", label: "Urgente (1-2 semanas)" },
  { value: "normal", label: "Normal (2-4 semanas)" },
  { value: "flexible", label: "Flexível (1-2 meses)" },
];

const ORCAMENTO_OPTIONS = [
  { value: "ate_1k", label: "Até R$ 1.000" },
  { value: "1k_3k", label: "R$ 1.000 - R$ 3.000" },
  { value: "3k_10k", label: "R$ 3.000 - R$ 10.000" },
  { value: "acima_10k", label: "Acima de R$ 10.000" },
];

export default function BriefingPublic() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState<any>(null);
  const [invalid, setInvalid] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");

  // Form state
  const [objetivo, setObjetivo] = useState("");
  const [publicoAlvo, setPublicoAlvo] = useState("");
  const [tiposProjeto, setTiposProjeto] = useState<string[]>([]);
  const [referencias, setReferencias] = useState("");
  const [prazo, setPrazo] = useState("");
  const [prazoCustom, setPrazoCustom] = useState("");
  const [orcamento, setOrcamento] = useState("");
  const [orcamentoCustom, setOrcamentoCustom] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [contatoNome, setContatoNome] = useState("");
  const [contatoWhatsapp, setContatoWhatsapp] = useState("");
  const [contatoEmail, setContatoEmail] = useState("");

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return; }
    supabase.from("briefings").select("*").eq("token", token).maybeSingle().then(({ data }) => {
      if (!data || data.submitted) { setInvalid(true); } else { setBriefing(data); }
      setLoading(false);
    });
  }, [token]);

  const needsContact = !briefing?.client_id;

  const steps = [
    "welcome",
    "objetivo",
    "publico",
    "tipo",
    "referencias",
    "prazo",
    "orcamento",
    "observacoes",
    ...(needsContact ? ["contato"] : []),
  ];

  const totalSteps = steps.length;
  const progress = step === 0 ? 0 : Math.round((step / (totalSteps - 1)) * 100);

  const canAdvance = useCallback(() => {
    const currentStep = steps[step];
    if (currentStep === "welcome") return true;
    if (currentStep === "objetivo") return objetivo.trim().length > 0;
    if (currentStep === "publico") return true;
    if (currentStep === "tipo") return tiposProjeto.length > 0;
    if (currentStep === "referencias") return true;
    if (currentStep === "prazo") return prazo !== "" || prazoCustom !== "";
    if (currentStep === "orcamento") return orcamento !== "" || orcamentoCustom !== "";
    if (currentStep === "observacoes") return true;
    if (currentStep === "contato") return contatoNome.trim() && contatoEmail.trim();
    return true;
  }, [step, steps, objetivo, tiposProjeto, prazo, prazoCustom, orcamento, orcamentoCustom, contatoNome, contatoEmail]);

  const goNext = () => {
    if (step < totalSteps - 1) {
      setDirection("next");
      setStep(s => s + 1);
    } else {
      handleSubmit();
    }
  };

  const goPrev = () => {
    if (step > 0) {
      setDirection("prev");
      setStep(s => s - 1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && canAdvance()) {
      e.preventDefault();
      goNext();
    }
  };

  const toggleTipo = (val: string) => {
    setTiposProjeto(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };

  const handleSubmit = async () => {
    if (!canAdvance()) return;
    setSubmitting(true);
    const responses = {
      objetivo,
      publicoAlvo,
      tiposProjeto,
      referencias,
      prazo: prazo || prazoCustom,
      orcamento: orcamento || orcamentoCustom,
      observacoes,
      ...(needsContact ? { contato: { nome: contatoNome, whatsapp: contatoWhatsapp, email: contatoEmail } } : {}),
    };
    await supabase.from("briefings").update({ responses, submitted: true }).eq("id", briefing.id);

    // Notify admin using RPC to bypass RLS
    const { data: adminId } = await supabase.rpc("get_admin_user_id");
    if (adminId) {
      await supabase.from("notifications").insert({
        user_id: adminId,
        message: "Novo briefing recebido!",
        notification_type: "system",
        link: "/briefings",
      });
    }
    setSubmitted(true);
    setSubmitting(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#09090b" }}>
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(240 4% 52%)" }} />
    </div>
  );

  if (invalid) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#09090b" }}>
      <div className="text-center space-y-2">
        <p className="text-lg font-semibold" style={{ color: "#fafafa" }}>Link inválido ou já utilizado</p>
        <p className="text-sm" style={{ color: "hsl(240 4% 52%)" }}>Este briefing já foi enviado ou o link expirou.</p>
      </div>
    </div>
  );

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#09090b" }}>
      <div className="text-center space-y-4 animate-scale-in">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto" style={{ background: "hsl(142 71% 45% / 0.15)" }}>
          <CheckCircle className="w-10 h-10" style={{ color: "hsl(142 71% 45%)" }} />
        </div>
        <p className="text-xl font-semibold" style={{ color: "#fafafa" }}>Briefing enviado com sucesso!</p>
        <p className="text-sm" style={{ color: "hsl(240 4% 52%)" }}>Vamos analisar suas respostas e entrar em contato em breve.</p>
        <p className="text-xs mt-6" style={{ color: "hsl(240 4% 30%)" }}>ConvertAI — Client Execution OS</p>
      </div>
    </div>
  );

  const currentStep = steps[step];

  const inputCls = "w-full border rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors resize-none"
    + " placeholder:opacity-40";
  const inputStyle = {
    background: "#111113",
    borderColor: "hsl(240 4% 16%)",
    color: "#fafafa",
  };
  const inputFocusStyle = "focus:border-[hsl(263,70%,66%)]";

  const renderStep = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <div className="text-center space-y-4">
            <p className="text-4xl">👋</p>
            <h2 className="text-xl font-semibold" style={{ color: "#fafafa" }}>Olá!</h2>
            <p className="text-sm max-w-md mx-auto" style={{ color: "hsl(240 5% 65%)" }}>
              Vamos entender melhor o seu projeto para criar algo incrível.
            </p>
          </div>
        );
      case "objetivo":
        return (
          <div className="space-y-4 w-full max-w-lg">
            <h2 className="text-xl font-semibold" style={{ color: "#fafafa" }}>Qual o objetivo principal do seu projeto?</h2>
            <textarea
              value={objetivo} onChange={e => setObjetivo(e.target.value)} onKeyDown={handleKeyDown}
              rows={4} placeholder="Ex: Aumentar vendas online, fortalecer presença nas redes..."
              className={cn(inputCls, inputFocusStyle)} style={inputStyle} autoFocus
            />
          </div>
        );
      case "publico":
        return (
          <div className="space-y-4 w-full max-w-lg">
            <h2 className="text-xl font-semibold" style={{ color: "#fafafa" }}>Quem é o público-alvo?</h2>
            <textarea
              value={publicoAlvo} onChange={e => setPublicoAlvo(e.target.value)} onKeyDown={handleKeyDown}
              rows={3} placeholder="Ex: Mulheres 25-45 anos, empreendedores locais..."
              className={cn(inputCls, inputFocusStyle)} style={inputStyle} autoFocus
            />
          </div>
        );
      case "tipo":
        return (
          <div className="space-y-4 w-full max-w-lg">
            <h2 className="text-xl font-semibold" style={{ color: "#fafafa" }}>Que tipo de projeto você precisa?</h2>
            <p className="text-xs" style={{ color: "hsl(240 5% 65%)" }}>Selecione um ou mais</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PROJECT_TYPE_OPTIONS.map(opt => {
                const selected = tiposProjeto.includes(opt.value);
                return (
                  <button
                    key={opt.value} onClick={() => toggleTipo(opt.value)}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border transition-all cursor-pointer"
                    style={{
                      background: selected ? "hsl(263 70% 66% / 0.1)" : "#111113",
                      borderColor: selected ? "hsl(263 70% 66%)" : "hsl(240 4% 16%)",
                    }}
                  >
                    <span className="text-2xl">{opt.icon}</span>
                    <span className="text-xs font-medium" style={{ color: selected ? "hsl(263 70% 76%)" : "hsl(240 5% 65%)" }}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      case "referencias":
        return (
          <div className="space-y-4 w-full max-w-lg">
            <h2 className="text-xl font-semibold" style={{ color: "#fafafa" }}>Tem referências visuais ou de estilo?</h2>
            <textarea
              value={referencias} onChange={e => setReferencias(e.target.value)} onKeyDown={handleKeyDown}
              rows={3} placeholder="Cole links, descreva estilos que gosta, marcas de referência..."
              className={cn(inputCls, inputFocusStyle)} style={inputStyle} autoFocus
            />
          </div>
        );
      case "prazo":
        return (
          <div className="space-y-4 w-full max-w-lg">
            <h2 className="text-xl font-semibold" style={{ color: "#fafafa" }}>Qual o prazo desejado?</h2>
            <div className="space-y-2">
              {PRAZO_OPTIONS.map(opt => {
                const selected = prazo === opt.value;
                return (
                  <button
                    key={opt.value} onClick={() => { setPrazo(opt.value); setPrazoCustom(""); }}
                    className="w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer text-sm"
                    style={{
                      background: selected ? "hsl(263 70% 66% / 0.1)" : "#111113",
                      borderColor: selected ? "hsl(263 70% 66%)" : "hsl(240 4% 16%)",
                      color: selected ? "hsl(263 70% 76%)" : "hsl(240 5% 65%)",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div>
              <p className="text-xs mb-2" style={{ color: "hsl(240 5% 45%)" }}>Ou data personalizada:</p>
              <input
                type="date" value={prazoCustom}
                onChange={e => { setPrazoCustom(e.target.value); setPrazo(""); }}
                className={cn(inputCls, inputFocusStyle)} style={inputStyle}
              />
            </div>
          </div>
        );
      case "orcamento":
        return (
          <div className="space-y-4 w-full max-w-lg">
            <h2 className="text-xl font-semibold" style={{ color: "#fafafa" }}>Qual o orçamento disponível?</h2>
            <div className="space-y-2">
              {ORCAMENTO_OPTIONS.map(opt => {
                const selected = orcamento === opt.value;
                return (
                  <button
                    key={opt.value} onClick={() => { setOrcamento(opt.value); setOrcamentoCustom(""); }}
                    className="w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer text-sm"
                    style={{
                      background: selected ? "hsl(263 70% 66% / 0.1)" : "#111113",
                      borderColor: selected ? "hsl(263 70% 66%)" : "hsl(240 4% 16%)",
                      color: selected ? "hsl(263 70% 76%)" : "hsl(240 5% 65%)",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div>
              <p className="text-xs mb-2" style={{ color: "hsl(240 5% 45%)" }}>Ou valor personalizado:</p>
              <input
                value={orcamentoCustom} onChange={e => { setOrcamentoCustom(e.target.value); setOrcamento(""); }}
                placeholder="R$ ..." className={cn(inputCls, inputFocusStyle)} style={inputStyle}
              />
            </div>
          </div>
        );
      case "observacoes":
        return (
          <div className="space-y-4 w-full max-w-lg">
            <h2 className="text-xl font-semibold" style={{ color: "#fafafa" }}>Algo mais que devemos saber?</h2>
            <textarea
              value={observacoes} onChange={e => setObservacoes(e.target.value)} onKeyDown={handleKeyDown}
              rows={4} placeholder="Detalhes extras, restrições, preferências..."
              className={cn(inputCls, inputFocusStyle)} style={inputStyle} autoFocus
            />
          </div>
        );
      case "contato":
        return (
          <div className="space-y-4 w-full max-w-lg">
            <h2 className="text-xl font-semibold" style={{ color: "#fafafa" }}>Como podemos entrar em contato?</h2>
            <input value={contatoNome} onChange={e => setContatoNome(e.target.value)} placeholder="Nome completo *"
              className={cn(inputCls, inputFocusStyle)} style={inputStyle} autoFocus />
            <input value={contatoWhatsapp} onChange={e => setContatoWhatsapp(e.target.value)} placeholder="WhatsApp"
              className={cn(inputCls, inputFocusStyle)} style={inputStyle} />
            <input value={contatoEmail} onChange={e => setContatoEmail(e.target.value)} placeholder="Email *"
              className={cn(inputCls, inputFocusStyle)} style={inputStyle} onKeyDown={handleKeyDown} />
          </div>
        );
      default:
        return null;
    }
  };

  const isLastStep = step === totalSteps - 1;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#09090b" }}>
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50" style={{ height: 3 }}>
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%`, background: "hsl(263 70% 66%)" }}
        />
      </div>

      {/* Logo */}
      <div className="fixed top-5 left-6 z-40 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "hsl(263 70% 66%)" }}>
          <span className="text-xs font-bold" style={{ color: "#fff" }}>C</span>
        </div>
        <span className="text-sm font-semibold hidden sm:inline" style={{ color: "hsl(240 5% 65%)" }}>ConvertAI</span>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center px-6 py-24">
        <div
          key={step}
          className="w-full flex justify-center"
          style={{
            animation: direction === "next"
              ? "briefing-slide-up 0.25s ease-out"
              : "briefing-slide-down 0.25s ease-out",
          }}
        >
          {renderStep()}
        </div>
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-6 py-6 flex items-center justify-between max-w-lg mx-auto w-full">
        {step > 0 ? (
          <button onClick={goPrev} className="flex items-center gap-1 text-sm cursor-pointer bg-transparent border-none transition-opacity hover:opacity-80"
            style={{ color: "hsl(240 5% 45%)" }}>
            <ChevronLeft className="w-4 h-4" />
            Voltar
          </button>
        ) : <div />}

        <div className="flex items-center gap-3">
          {currentStep === "observacoes" && (
            <button onClick={goNext} className="text-sm cursor-pointer bg-transparent border-none"
              style={{ color: "hsl(240 5% 45%)" }}>
              Pular
            </button>
          )}
          <button
            onClick={goNext}
            disabled={!canAdvance() || submitting}
            className="px-6 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer border-none disabled:opacity-40 hover:scale-[1.02]"
            style={{
              background: "hsl(263 70% 66%)",
              color: "#fff",
            }}
          >
            {submitting ? "Enviando..." : isLastStep ? "Enviar Briefing" : currentStep === "welcome" ? "Começar →" : "Próximo →"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes briefing-slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes briefing-slide-down {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes animate-scale-in {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-scale-in { animation: animate-scale-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
      `}</style>
    </div>
  );
}
