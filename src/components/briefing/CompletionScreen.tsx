import { CheckCircle } from "lucide-react";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

const timelineSteps = [
  { title: "Análise do diagnóstico", desc: "Nossa equipe analisa suas respostas detalhadamente. Prazo: até 24h.", active: true },
  { title: "Proposta personalizada", desc: "Montamos um plano sob medida com estratégia + orçamento detalhado.", active: false },
  { title: "Call de apresentação", desc: "Agendamos uma conversa para te apresentar tudo e alinhar expectativas.", active: false },
];

export default function CompletionScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ background: "#0D0D0D" }}>
      <div className="tech-grid-bg" />
      <div className="relative z-10 text-center max-w-lg w-full">
        {/* Logo */}
        <img
          src={aceleriqLogo}
          alt="Aceleriq"
          className="h-14 sm:h-16 w-auto mx-auto mb-6"
          style={{ animation: "checkBounce 0.8s cubic-bezier(0.34,1.56,0.64,1)" }}
        />

        {/* Check icon */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{
            background: "rgba(0,255,102,0.12)",
            animation: "checkBounce 0.8s cubic-bezier(0.34,1.56,0.64,1) 0.3s both",
          }}
        >
          <CheckCircle className="w-10 h-10 text-primary" />
        </div>

        <h1
          className="text-2xl sm:text-[32px] font-bold text-foreground mb-3"
          style={{ animation: "fadeIn 0.5s ease-out 0.5s both" }}
        >
          Diagnóstico completo! 🎉
        </h1>
        <p
          className="text-[15px] text-muted-foreground max-w-md mx-auto leading-relaxed mb-8"
          style={{ animation: "fadeIn 0.5s ease-out 0.65s both" }}
        >
          Obrigado por dedicar esse tempo. Cada resposta nos ajuda a construir a melhor estratégia para o seu negócio.
        </p>

        {/* Timeline card */}
        <div
          className="rounded-2xl border border-border p-8 text-left mx-auto max-w-[520px]"
          style={{ background: "#121212", animation: "fadeInUp 0.5s ease-out 0.8s both" }}
        >
          <h3 className="text-lg font-bold text-foreground mb-5">O que acontece agora?</h3>
          <div className="space-y-0">
            {timelineSteps.map((s, i) => (
              <div key={i} className="flex gap-4" style={{ animation: `fadeIn 0.4s ease-out ${1 + i * 0.2}s both` }}>
                <div className="flex flex-col items-center">
                  <div className={`w-3 h-3 rounded-full shrink-0 mt-1 ${s.active ? "bg-primary" : "bg-[#2A2A2A]"}`} />
                  {i < timelineSteps.length - 1 && <div className="w-[2px] flex-1 bg-[#2A2A2A] my-1" />}
                </div>
                <div className="pb-5">
                  <p className="text-sm font-semibold text-foreground">{s.title}</p>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ animation: "fadeIn 0.5s ease-out 1.6s both" }} className="mt-8 space-y-3">
          <p className="text-[13px] text-muted-foreground/50">
            Quer adiantar?{" "}
            <a href="#" className="text-primary hover:underline">Fale pelo WhatsApp</a>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes checkBounce { 0%{transform:scale(0)} 60%{transform:scale(1.1)} 100%{transform:scale(1)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  );
}
