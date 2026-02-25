import { Clock, Lock, BarChart3, ClipboardList, Brain, Rocket } from "lucide-react";
import consultantImg from "@/assets/consultant-avatar.jpg";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

interface Props {
  onStart: () => void;
}

const steps = [
  { icon: ClipboardList, title: "Diagnóstico", desc: "Responda 15 perguntas sobre seu negócio. Leva ~8 min." },
  { icon: Brain, title: "Estratégia", desc: "Analisamos cada resposta para mapear a melhor direção." },
  { icon: Rocket, title: "Proposta", desc: "Em até 48h você recebe um plano personalizado com orçamento." },
];

export default function WelcomeScreen({ onStart }: Props) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: "#0D0D0D" }}>
      <div className="tech-grid-bg" />

      <div
        className="relative z-10 w-full max-w-[800px] rounded-none sm:rounded-3xl p-6 sm:p-10 md:p-14 min-h-screen sm:min-h-0"
        style={{ background: "#121212", animation: "fadeInUp 0.6s ease-out" }}
      >
        {/* Logo + greeting */}
        <div className="flex flex-col items-center text-center mb-10">
          <img
            src={aceleriqLogo}
            alt="Aceleriq"
            className="h-16 sm:h-20 w-auto mb-5"
            style={{ animation: "avatarBounce 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.2s both" }}
          />
          <h1
            className="text-xl sm:text-2xl font-bold text-foreground mb-2"
            style={{ animation: "fadeIn 0.5s ease-out 0.4s both" }}
          >
            Diagnóstico inteligente da Aceler<span className="text-primary">iq</span>
          </h1>
          <p
            className="text-sm text-muted-foreground max-w-md leading-relaxed"
            style={{ animation: "fadeIn 0.5s ease-out 0.55s both" }}
          >
            Vou te fazer algumas perguntas estratégicas para entender seu negócio a fundo.
            Com base nas suas respostas, nossa equipe vai montar a estratégia ideal — sob medida para você.
          </p>
        </div>

        {/* 3 Step Cards with Lucide icons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={i}
                className="rounded-2xl p-6 border border-border hover:border-primary/40 transition-all hover:-translate-y-0.5 card-hover"
                style={{
                  background: "#1A1A1A",
                  animation: `fadeInUp 0.5s ease-out ${0.5 + i * 0.15}s both`,
                }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-primary/10">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-base font-bold text-foreground mb-1">{s.title}</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Trust badges */}
        <div
          className="flex flex-wrap items-center justify-center gap-6 mb-8 text-xs text-muted-foreground/60"
          style={{ animation: "fadeIn 0.5s ease-out 1s both" }}
        >
          <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-primary" /> Suas respostas são confidenciais</span>
          <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-primary" /> ~8 minutos</span>
          <span className="flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5 text-primary" /> 100% personalizado</span>
        </div>

        {/* CTA */}
        <button
          onClick={onStart}
          className="w-full py-[18px] rounded-xl text-base font-bold bg-primary text-primary-foreground hover:opacity-90 transition-all cursor-pointer border-none login-btn btn-interactive"
          style={{ animation: "fadeIn 0.5s ease-out 1.1s both" }}
        >
          Iniciar Diagnóstico →
        </button>

        <p className="text-center text-[13px] text-muted-foreground/50 mt-5" style={{ animation: "fadeIn 0.5s ease-out 1.3s both" }}>
          Prefere falar com alguém?{" "}
          <a href="#" className="text-primary hover:underline">Agende uma call →</a>
        </p>
      </div>

      <style>{`
        @keyframes avatarBounce { from { transform: scale(0); } to { transform: scale(1); } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes fadeInUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}
