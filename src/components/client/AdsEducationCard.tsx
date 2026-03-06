import { useState } from "react";
import {
  TrendingUp, ChevronDown, ChevronUp, Zap, Target,
  Users, ShieldCheck, BarChart3, Rocket, Timer,
} from "lucide-react";

interface AdsEducationCardProps {
  /** Names of traffic projects that have active tasks */
  activeTrafficProjects: string[];
}

const phases = [
  {
    icon: Rocket,
    title: "Fase de Aprendizado",
    period: "Primeiras 1 a 2 semanas",
    description:
      "Neste período inicial, as plataformas de anúncios (Meta, Google) estão coletando dados sobre o público que interage com seus anúncios. O algoritmo está testando diferentes combinações de público, horário e posicionamento para entender o que funciona melhor para o seu negócio.",
    color: "text-sky-400",
    bg: "bg-sky-500/10",
  },
  {
    icon: BarChart3,
    title: "Fase de Otimização",
    period: "Semanas 2 a 4",
    description:
      "Com os dados coletados, começamos a otimizar as campanhas diariamente. Ajustamos públicos, criativos e lances para direcionar o investimento para onde gera mais resultados. Os leads começam a chegar com mais qualidade e o custo por resultado tende a diminuir.",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  {
    icon: Target,
    title: "Fase de Maturação",
    period: "A partir da semana 4",
    description:
      "As campanhas atingem maturidade e passam a entregar leads cada vez mais qualificados. O algoritmo já conhece o perfil ideal do seu cliente e prioriza a entrega para pessoas com maior potencial de conversão. O desempenho melhora progressivamente.",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
];

export default function AdsEducationCard({ activeTrafficProjects }: AdsEducationCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (activeTrafficProjects.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 flex items-center gap-3 text-left bg-transparent border-none cursor-pointer hover:bg-secondary/30 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
          <TrendingUp className="w-4 h-4 text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            Seus Anúncios Estão Rodando
            <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-sky-500/10 text-sky-400 px-2 py-0.5 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              Ativo
            </span>
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {activeTrafficProjects.length === 1
              ? `Campanha ativa no projeto "${activeTrafficProjects[0]}"`
              : `Campanhas ativas em ${activeTrafficProjects.length} projetos`
            }
          </p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        }
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-5 space-y-5 animate-fade-in">
          {/* Intro */}
          <div className="bg-sky-500/[0.04] border border-sky-500/10 rounded-lg p-4">
            <p className="text-[13px] text-foreground/85 leading-relaxed">
              As campanhas de anúncios passam por um processo natural de maturação.
              Assim como um investimento, os resultados melhoram progressivamente
              conforme o algoritmo aprende e as otimizações são aplicadas diariamente
              pela nossa equipe.
            </p>
          </div>

          {/* Phases */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-3">
              Como funciona o processo
            </p>
            <div className="space-y-3">
              {phases.map((phase, i) => (
                <div key={i} className="flex gap-3">
                  <div className={`w-9 h-9 rounded-lg ${phase.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <phase.icon className={`w-4 h-4 ${phase.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-[13px] font-semibold text-foreground">{phase.title}</p>
                      <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{phase.period}</span>
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">{phase.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Important notes */}
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              O que esperar durante o processo
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <InfoTip
                icon={Users}
                title="Leads curiosos são normais"
                text="No início, é comum receber contatos de pessoas que ainda não estão prontas para comprar. Isso faz parte do processo de aprendizado da campanha e diminui com o tempo."
              />
              <InfoTip
                icon={ShieldCheck}
                title="Otimização diária"
                text="Nossa equipe monitora e ajusta as campanhas todos os dias, refinando públicos e criativos para atrair leads cada vez mais qualificados."
              />
              <InfoTip
                icon={Zap}
                title="Melhoria progressiva"
                text="A cada dia de campanha rodando, o algoritmo acumula dados valiosos. Quanto mais tempo ativo, mais inteligente fica a entrega dos anúncios."
              />
              <InfoTip
                icon={Timer}
                title="Paciência gera resultados"
                text="Campanhas de alta performance são construídas com consistência. As otimizações diárias garantem que a qualidade dos leads melhore continuamente ao longo do tempo."
              />
            </div>
          </div>

          {/* Bottom reassurance */}
          <div className="bg-emerald-500/[0.04] border border-emerald-500/15 rounded-lg p-4 flex items-start gap-3">
            <Target className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-medium text-foreground mb-1">Fique tranquilo, estamos no caminho certo</p>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                Mesmo em operações de grande performance, contatos menos qualificados fazem parte do processo.
                O importante é que, com o acompanhamento e as otimizações contínuas, as campanhas tendem
                a entregar leads cada vez mais qualificados ao longo do tempo. Estamos trabalhando ativamente para isso.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoTip({ icon: Icon, title, text }: { icon: typeof Zap; title: string; text: string }) {
  return (
    <div className="bg-secondary/30 border border-border/50 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
        <p className="text-[12px] font-medium text-foreground">{title}</p>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{text}</p>
    </div>
  );
}
