import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileCheck,
  FileText,
  FolderOpen,
  Inbox,
  PackageCheck,
  Repeat,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  AjudaRecolhida,
  BarraDeAcoes,
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Painel,
  Secao,
  botao,
  campoTexto,
  etiqueta,
  foco,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import CircularProgress from "./CircularProgress";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import { FadeUp, StaggerContainer } from "./motion";
import ProjectJournal from "@/components/shared/ProjectJournal";
import { estruturaDoRitual, resumoDoRitual } from "@/lib/ritualTexto";
import { primeiraFrase } from "@/lib/frases";
import {
  daysUntil,
  formatDateShort,
  isRecurringProject,
  typeLabels,
  useClientDashboardData,
} from "./dashboardHelpers";

interface Props {
  clientId: string;
  clientName: string;
  onSelectProject: (project: any) => void;
  isImpersonation?: boolean;
}

const projectStatusLabel: Record<string, string> = {
  active: "Em andamento",
  review: "Em revisão",
  planning: "Planejamento",
  done: "Concluído",
  paused: "Pausado",
};

const platformLabel: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  google_business: "Google",
};

const isSameMonth = (value: string | null | undefined, ref: Date) => {
  if (!value) return false;
  const d = new Date(value);
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
};

const dinheiro = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const dataEHora = (iso: string) =>
  `${new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })} às ${new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

/** Atalhos do portal: sempre a um toque, numa linha discreta (sem cartão por atalho). */
const ATALHOS = [
  { label: "Projetos", icon: Briefcase, to: "/projetos" },
  { label: "Aprovações", icon: FileCheck, to: "/aprovacoes" },
  { label: "Calendário", icon: CalendarDays, to: "/calendario" },
  { label: "Relatórios", icon: FileText, to: "/relatorios" },
  { label: "Cofre", icon: FolderOpen, to: "/cofre" },
  { label: "Pedidos", icon: Inbox, to: "/pedidos" },
];

// Etapas genericas de growth: valem para qualquer servico (social, trafego,
// site, avulso, hibrido). A etapa e lida dos dados reais.
const STAGES = ["Planejamento", "Produção", "Sua aprovação", "Entrega", "Acompanhamento"];
const STAGE_HINTS = [
  "Estamos organizando a base do trabalho.",
  "As entregas estão sendo produzidas agora.",
  "Tem material esperando o seu OK.",
  "Entregas liberadas e trabalho rodando.",
  "No ar e medindo resultado para otimizar.",
];

export default function ClientJourneyDashboard({
  clientId,
  clientName,
  onSelectProject,
  isImpersonation,
}: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Avaliação em andamento: sair e voltar não apaga a nota nem o comentário.
  const [pulseScore, setPulseScore] = useEstadoDaTela<number | null>(`inicio:pulso:nota:${clientId}`, null, {
    validar: (v) => v === null || (typeof v === "number" && v >= 1 && v <= 5),
  });
  const [pulseComment, setPulseComment] = useEstadoDaTela<string>(`inicio:pulso:comentario:${clientId}`, "");
  const [pulseSending, setPulseSending] = useState(false);
  const { loadingProjects, errorProjects, refetchProjects, data } = useClientDashboardData(clientId);
  const {
    activeProjects,
    doneProjects,
    milestones,
    completedMilestonesCount,
    totalMilestones,
    pendingFiles,
    deliveredFiles,
    approvedFiles,
    totalFiles,
    contentPublications,
    latestReport,
    clientProfile,
    clientPendingBilling,
  } = data as any;
  const firstName = clientName.split(" ")[0] || "cliente";

  // Avisos grandes: renovação chegando (7 dias) e pagamento em atraso.
  const renewalDays = clientProfile?.plan_renewal_date ? daysUntil(clientProfile.plan_renewal_date) : null;
  const renewalSoon = renewalDays !== null && renewalDays >= 0 && renewalDays <= 7 && clientProfile?.plan_status === "active";
  const overdueBills = (clientPendingBilling || []).filter((b: any) => {
    const due = new Date(`${b.due_date}T12:00:00`);
    return due.getTime() < Date.now();
  });
  const overdueAmount = overdueBills.reduce((s: number, b: any) => s + Number(b.amount || 0), 0);

  // Pulso Aceleriq: avaliação rápida do cliente (guardada no próprio cadastro).
  const pulseHistory: any[] = Array.isArray(clientProfile?.services_config?.pulse_history)
    ? clientProfile.services_config.pulse_history
    : [];
  const lastPulse = pulseHistory[pulseHistory.length - 1] || null;
  const lastPulseDays = lastPulse?.date
    ? Math.floor((Date.now() - new Date(lastPulse.date).getTime()) / 86400000)
    : null;
  const showPulse = !isImpersonation && (lastPulseDays === null || lastPulseDays >= 30);

  const submitPulse = async () => {
    if (pulseScore === null || pulseSending) return;
    setPulseSending(true);
    try {
      const { data: fresh } = await supabase
        .from("profiles")
        .select("services_config")
        .eq("id", clientId)
        .maybeSingle();
      const current = (fresh?.services_config as any) || {};
      const history = Array.isArray(current.pulse_history) ? current.pulse_history : [];
      const entry = {
        date: new Date().toISOString(),
        score: pulseScore,
        comment: pulseComment.trim() || undefined,
      };
      const { error } = await supabase
        .from("profiles")
        .update({ services_config: { ...current, pulse_history: [...history, entry] } as any })
        .eq("id", clientId);
      if (error) throw error;
      void notifyAdmin(
        `Pulso respondido: ${clientName} avaliou a experiência com nota ${pulseScore}/5${pulseComment.trim() ? ` · "${pulseComment.trim().slice(0, 120)}"` : ""}`,
        // O tipo pulse não existe no notify-admin (400 calado): o pulso vai como atualização.
        "update",
        "/central"
      );
      toast.success("Obrigado pela avaliação. Ela nos ajuda a melhorar sempre.");
      queryClient.invalidateQueries({ queryKey: ["client-profile-lite", clientId] });
      setPulseScore(null);
      setPulseComment("");
    } catch {
      toast.error("Não foi possível enviar agora. Tente novamente em instantes.");
    } finally {
      setPulseSending(false);
    }
  };

  // Frentes: recorrente (ciclo mensal) x projeto com começo e fim (marcos + %).
  const recurringFronts = activeProjects.filter((p: any) => isRecurringProject(p));
  const closedProjects = activeProjects.filter((p: any) => !isRecurringProject(p));
  const closedAvgProgress = closedProjects.length > 0
    ? Math.round(closedProjects.reduce((s: number, p: any) => s + (p.progress || 0), 0) / closedProjects.length)
    : 0;

  const now = new Date();
  const monthDelivered = (deliveredFiles || []).filter((f: any) => isSameMonth(f.created_at, now));
  const publications = contentPublications || [];
  const scheduled = publications.filter((p: any) => p.status === "scheduled");
  const published = publications.filter((p: any) => p.status === "published");
  const publishedThisMonth = published.filter((p: any) => isSameMonth(p.published_at || p.scheduled_at, now));
  // Relatorio velho nao e "agora": depois de 21 dias o card passa a mostrar o
  // retrato vivo (dados reais do proprio painel) em vez de texto antigo.
  const reportIsFresh = Boolean(
    latestReport &&
      Date.now() - new Date(latestReport.created_at || latestReport.period_end || 0).getTime() <
        21 * 24 * 60 * 60 * 1000,
  );
  const nextPublication = scheduled
    .filter((p: any) => p.scheduled_at && new Date(p.scheduled_at) >= now)
    .sort((a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0] || null;
  const hasContentFront = recurringFronts.length > 0 || publications.length > 0;

  const upcomingMilestones = (milestones || [])
    .filter((m: any) => m.status !== "completed" && m.target_date)
    .slice(0, 4);

  const hasDeliveries = deliveredFiles.length > 0;
  const currentStage =
    published.length > 0 || latestReport ? 4 :
    hasDeliveries || scheduled.length > 0 ? 3 :
    pendingFiles.length > 0 ? 2 :
    activeProjects.length > 0 ? 1 : 0;

  const hojeTexto = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const hoje = hojeTexto.charAt(0).toUpperCase() + hojeTexto.slice(1);

  if (loadingProjects) {
    return <Carregando forma="aba" rotulo="Carregando o seu painel" />;
  }

  if (errorProjects) {
    return (
      <div className="min-w-0 space-y-5">
        <CabecalhoDePagina titulo={`Bem-vindo de volta, ${firstName}`} descricao={hoje} />
        <EstadoDeErro
          titulo="Não foi possível carregar o seu painel."
          acao={<button type="button" className={botao.secundario} onClick={() => refetchProjects()}>Tentar de novo</button>}
        />
      </div>
    );
  }

  const temProjetos = activeProjects.length > 0 || doneProjects.length > 0;
  const projetosComPrazo = [...closedProjects, ...doneProjects];

  return (
    <StaggerContainer className="min-w-0 space-y-6">
      {/* 1 · Boas-vindas: título curto, data como estado, explicação no "?" */}
      <FadeUp>
        <CabecalhoDePagina
          titulo={`Bem-vindo de volta, ${firstName}`}
          descricao={`${hoje}${isImpersonation ? " · somente leitura" : ""}`}
          ajuda="Acompanhe suas frentes, entregas e publicações liberadas pela Aceleriq. Os números se atualizam sozinhos."
          acoes={
            closedProjects.length > 0 ? (
              <div className="hidden items-center sm:flex" title="Média dos projetos com prazo">
                <CircularProgress progress={closedAvgProgress} size={44} strokeWidth={4} />
                <span className={juntar(texto.auxiliar, "ml-2 leading-4")}>Projetos<br />com prazo</span>
              </div>
            ) : undefined
          }
        />
        <nav aria-label="Atalhos" className="-ml-2 mt-2 grid grid-cols-3 gap-1 sm:flex sm:flex-wrap sm:gap-0 sm:[&>*+*]:ml-1">
          {ATALHOS.map((atalho) => (
            <button
              key={atalho.to}
              type="button"
              onClick={() => navigate(atalho.to)}
              className={juntar(
                "flex h-10 min-w-0 touch-manipulation items-center justify-center rounded-md px-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:justify-start",
                foco,
              )}
            >
              <atalho.icon className="mr-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{atalho.label}</span>
            </button>
          ))}
        </nav>
      </FadeUp>

      {/* 2 · Avisos importantes: atraso e renovação chegando */}
      {overdueBills.length > 0 && (
        <FadeUp>
          <button
            type="button"
            onClick={() => navigate("/financeiro")}
            className={juntar("flex w-full min-w-0 items-center rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-left transition-colors hover:border-red-500/70", foco)}
          >
            <CalendarDays className="mr-3 h-5 w-5 shrink-0 text-red-500" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold leading-5 text-foreground">
                Pagamento em atraso: {dinheiro(overdueAmount)}
              </span>
              <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                Regularize para manter as entregas sem pausa. Toque para ver os detalhes.
              </span>
            </span>
            <ArrowUpRight className="ml-3 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
          </button>
        </FadeUp>
      )}

      {renewalSoon && overdueBills.length === 0 && (
        <FadeUp>
          <button
            type="button"
            onClick={() => navigate("/financeiro")}
            className={juntar("flex w-full min-w-0 items-center rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-left transition-colors hover:border-sky-500/60", foco)}
          >
            <Repeat className="mr-3 h-5 w-5 shrink-0 text-sky-500" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold leading-5 text-foreground">
                {renewalDays === 0
                  ? "Sua renovação vence hoje"
                  : `Sua renovação vence em ${renewalDays} dia${renewalDays === 1 ? "" : "s"}`}
                {clientProfile?.plan_value ? ` · ${dinheiro(Number(clientProfile.plan_value))}` : ""}
              </span>
              <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                Garanta a continuidade dos resultados. Toque para ver os detalhes.
              </span>
            </span>
            <ArrowUpRight className="ml-3 h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
          </button>
        </FadeUp>
      )}

      {/* 3 · Ação necessária: o que precisa aprovar (o destaque da tela) */}
      {pendingFiles.length > 0 && (
        <FadeUp>
          <section aria-label="Aprovações pendentes" className="min-w-0 rounded-lg border border-amber-500/40 bg-amber-500/[0.04]">
            <div className="flex min-w-0 items-center px-4 py-3">
              <FileCheck className="mr-3 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
              <div className="mr-3 flex min-w-0 flex-1 items-center">
                <h2 className={juntar(texto.tituloSecao, "min-w-0 text-[14px]")}>
                  {pendingFiles.length === 1
                    ? "1 entrega aguarda a sua aprovação"
                    : `${pendingFiles.length} entregas aguardam a sua aprovação`}
                </h2>
                <AjudaRecolhida className="ml-1.5">
                  Sua aprovação libera o agendamento da publicação. Aprovou, a Aceleriq programa na data planejada.
                </AjudaRecolhida>
              </div>
              <button
                type="button"
                onClick={() => navigate("/aprovacoes")}
                className={juntar(botao.primario.replace("bg-primary text-primary-foreground hover:bg-primary/90", ""), "bg-amber-500 text-white hover:bg-amber-500/90")}
              >
                Aprovar<span className="hidden sm:inline">&nbsp;agora</span>
              </button>
            </div>
            <ul className="divide-y divide-amber-500/15 border-t border-amber-500/20">
              {pendingFiles.slice(0, 3).map((file: any) => (
                <li key={file.id} className={juntar(texto.auxiliar, "truncate px-4 py-2 leading-5")}>
                  <span className="font-medium text-foreground">{file.file_name}</span>
                  {file.project?.name ? ` · ${file.project.name}` : ""}
                </li>
              ))}
              {pendingFiles.length > 3 && (
                <li className={juntar(texto.auxiliar, "px-4 py-2")}>e mais {pendingFiles.length - 3} na área de Aprovações</li>
              )}
            </ul>
          </section>
        </FadeUp>
      )}

      {/* 4 · Números gerais: uma faixa só, sem um cartão por número */}
      <FadeUp>
        <FaixaDeNumeros
          rotulo="Resumo"
          itens={[
            {
              rotulo: "Frentes ativas",
              valor: activeProjects.length,
              apoio: doneProjects.length ? `${doneProjects.length} concluída(s)` : "Nenhuma concluída",
              corDoValor: "text-primary",
            },
            { rotulo: "Etapas concluídas", valor: completedMilestonesCount, apoio: `${totalMilestones} etapa(s) no total`, corDoValor: "text-sky-500" },
            {
              rotulo: "Entregas liberadas",
              valor: totalFiles,
              apoio: approvedFiles ? `${approvedFiles} aprovada(s)` : "Aguardando decisões",
              corDoValor: "text-emerald-500",
            },
            {
              rotulo: "Aprovações pendentes",
              valor: pendingFiles.length,
              apoio: pendingFiles.length ? "Ação necessária" : "Nenhuma pendência",
              corDoValor: pendingFiles.length ? "text-amber-500" : "text-foreground",
              para: pendingFiles.length ? "/aprovacoes" : undefined,
            },
          ]}
        />
      </FadeUp>

      {/* 5 · Conteúdos deste ciclo (só para quem tem frente de conteúdo) */}
      {hasContentFront && (
        <FadeUp>
          <Secao
            divisoria
            titulo="Conteúdos do ciclo"
            descricao={
              nextPublication ? (
                <span className="block truncate">
                  Próxima publicação {dataEHora(nextPublication.scheduled_at)}
                  {nextPublication.platform ? ` · ${platformLabel[nextPublication.platform] || nextPublication.platform}` : ""}
                </span>
              ) : undefined
            }
            acao={
              <button type="button" onClick={() => navigate("/calendario")} className={botao.discreto} aria-label="Ver calendário completo">
                <CalendarDays className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Calendário</span>
              </button>
            }
          >
            <FaixaDeNumeros
              rotulo="Conteúdos do ciclo"
              itens={[
                {
                  rotulo: "Aguardando aprovação",
                  valor: pendingFiles.length,
                  corDoValor: pendingFiles.length > 0 ? "text-amber-500" : "text-muted-foreground",
                },
                { rotulo: "Programados", valor: scheduled.length, corDoValor: "text-sky-500" },
                { rotulo: "Publicados no mês", valor: publishedThisMonth.length, corDoValor: "text-emerald-500" },
                { rotulo: "Publicados no total", valor: published.length },
              ]}
            />
          </Secao>
        </FadeUp>
      )}

      {/* 6 · Em que ponto do processo o trabalho está agora */}
      <FadeUp>
        <Secao divisoria titulo="Etapa do processo" descricao={`Etapa ${currentStage + 1} de ${STAGES.length}: ${STAGES[currentStage]}`}>
          <ol className="flex min-w-0 items-start" aria-label="Etapas do trabalho">
            {STAGES.map((stage, index) => {
              const done = index < currentStage;
              const current = index === currentStage;
              return (
                <li key={stage} className="flex min-w-0 flex-1 items-start" aria-current={current ? "step" : undefined}>
                  <div className="flex min-w-0 flex-1 flex-col items-center text-center">
                    <span
                      className={juntar(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                        current
                          ? "border-primary bg-primary text-primary-foreground"
                          : done
                            ? "border-primary/40 bg-primary/15 text-primary"
                            : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {done ? <CheckCircle2 className="h-3.5 w-3.5" aria-label="Concluída" /> : index + 1}
                    </span>
                    {/* No celular os nomes não cabem sem cortar: a etapa atual vai na linha de cima. */}
                    <span
                      className={juntar(
                        "mt-1.5 hidden max-w-full truncate px-0.5 text-[11px] leading-4 sm:block",
                        current ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {stage}
                    </span>
                  </div>
                  {index < STAGES.length - 1 && (
                    <span className={juntar("mt-3.5 h-px w-4 shrink-0 sm:w-auto sm:flex-1", done ? "bg-primary/50" : "bg-border")} aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ol>
          <p className={juntar(texto.auxiliar, "mt-2 text-center")}>{STAGE_HINTS[currentStage]}</p>
        </Secao>
      </FadeUp>

      {/* 7 · O que estamos fazendo, onde estamos e o próximo passo */}
      <FadeUp>
        <Secao
          divisoria
          titulo="Onde estamos agora"
          acao={
            <button type="button" onClick={() => navigate("/onde-estamos")} className={botao.discreto} aria-label="Abrir Onde Estamos">
              <span className="hidden sm:inline">Abrir</span>
              <ArrowUpRight className="h-4 w-4 sm:ml-1" aria-hidden="true" />
            </button>
          }
        >
          {!(latestReport && reportIsFresh) && (
            <button
              type="button"
              onClick={() => navigate("/onde-estamos")}
              className={juntar("group block w-full min-w-0 rounded-lg border border-primary/25 bg-primary/[0.04] px-4 py-3 text-left transition-colors hover:border-primary/40", foco)}
            >
              <span className={juntar(texto.corpo, "block")}>
                {deliveredFiles.length > 0
                  ? `Trabalho em movimento: ${deliveredFiles.length} entrega(s) já liberada(s).`
                  : "Estamos organizando o seu ciclo de trabalho."}
                {nextPublication?.scheduled_at &&
                  ` Próxima publicação em ${new Date(nextPublication.scheduled_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}.`}
              </span>
              <span className="mt-1.5 flex items-center text-[12px] text-primary">
                Ver o retrato completo em tempo real
                <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden="true" />
              </span>
            </button>
          )}
          {latestReport && reportIsFresh && (
            <button
              type="button"
              onClick={() => navigate("/onde-estamos")}
              className={juntar("group block w-full min-w-0 rounded-lg border border-primary/25 bg-primary/[0.04] text-left transition-colors hover:border-primary/40", foco)}
            >
              <span className="flex min-w-0 items-center border-b border-primary/15 px-4 py-2.5">
                <FileText className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{latestReport.title}</span>
                <ArrowUpRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
              </span>
              <span className="block space-y-3 px-4 py-3">
                {latestReport.highlights && (
                  <span className="block">
                    <span className={juntar(texto.rotulo, "block text-primary")}>O que estamos fazendo</span>
                    <span className={juntar(texto.corpo, "mt-0.5 line-clamp-2 block")}>{latestReport.highlights}</span>
                  </span>
                )}
                {latestReport.summary && (() => {
                  // Cartao de entrada: a abertura e o primeiro bloco inteiros, sem
                  // asteriscos e sem "..." no meio da frase; o resto fica em
                  // "Onde Estamos", que e para onde o cartao leva.
                  const e = estruturaDoRitual(latestReport.summary);
                  const resumo = e.blocos.length > 0 ? resumoDoRitual(latestReport.summary, 260) : String(latestReport.summary);
                  const demais = e.blocos.slice(1).map((b) => b.titulo.replace(/[:*]/g, "").trim());
                  return (
                    <span className="block">
                      <span className={juntar(texto.rotulo, "block text-primary")}>Resultado explicado</span>
                      <span className={juntar(texto.corpo, "mt-0.5 block text-muted-foreground", e.blocos.length > 0 ? "" : "line-clamp-4 whitespace-pre-line")}>{resumo}</span>
                      {demais.length > 0 && (
                        <span className={juntar(texto.auxiliar, "mt-1 block")}>Também nesta atualização: {demais.join(" · ")}.</span>
                      )}
                    </span>
                  );
                })()}
                {latestReport.next_steps && (
                  <span className="block">
                    <span className={juntar(texto.rotulo, "block text-primary")}>Próxima etapa</span>
                    <span className={juntar(texto.corpo, "mt-0.5 block text-muted-foreground")}>{primeiraFrase(String(latestReport.next_steps).replace(/\*/g, ""))}</span>
                  </span>
                )}
              </span>
            </button>
          )}
        </Secao>
      </FadeUp>

      {/* 8 · Projetos com prazo e Entregas recentes lado a lado. Sem projetos
          com prazo, as Entregas ocupam a linha inteira (sem buraco ao lado).
          Listas curtas (até 6): a página rola, nada de caixa com rolagem própria. */}
      <FadeUp>
        <div className={juntar("grid min-w-0 grid-cols-1 gap-6 border-t border-border pt-5", projetosComPrazo.length > 0 && "lg:grid-cols-2")}>
          {projetosComPrazo.length > 0 && (
            <Secao
              titulo="Projetos com prazo"
              descricao={`${closedProjects.length} ativo(s)${doneProjects.length > 0 ? ` · ${doneProjects.length} concluído(s)` : ""}`}
            >
              <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
                {projetosComPrazo.map((project: any) => {
                  const projectMilestones = milestones.filter((milestone: any) => milestone.project_id === project.id);
                  const completed = projectMilestones.filter((milestone: any) => milestone.status === "completed").length;
                  const deadlineDistance = project.deadline ? daysUntil(project.deadline) : null;
                  return (
                    <li key={project.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelectProject(project)}
                        className={juntar("group flex w-full min-w-0 items-center px-4 py-3 text-left transition-colors hover:bg-muted/40", foco)}
                        aria-label={`Abrir o projeto ${project.name}`}
                      >
                        <span className="mr-3 shrink-0">
                          <CircularProgress progress={project.progress || 0} size={44} strokeWidth={3} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium leading-5 text-foreground">{project.name}</span>
                          <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                            {typeLabels[project.project_type] || "Projeto"} · {projectStatusLabel[project.status] || project.status}
                            {" · "}
                            {completed}/{projectMilestones.length} etapas
                            {project.deadline &&
                              (deadlineDistance !== null && deadlineDistance < 0
                                ? " · Prazo em atualização"
                                : ` · Previsão ${formatDateShort(project.deadline)}`)}
                          </span>
                        </span>
                        <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Secao>
          )}
          <Secao
            titulo="Entregas recentes"
            descricao={deliveredFiles.length > 0 ? `${deliveredFiles.length} liberada(s)` : undefined}
            acao={
              deliveredFiles.length > 0 ? (
                <button type="button" onClick={() => navigate("/documentos")} className={botao.discreto} aria-label="Ver todas as entregas em Documentos">
                  <span className="hidden sm:inline">Ver todas</span>
                  <ChevronRight className="h-4 w-4 sm:ml-1" aria-hidden="true" />
                </button>
              ) : undefined
            }
          >
            {deliveredFiles.length === 0 ? (
              <EstadoVazio compacto titulo="Nenhuma entrega liberada ainda." />
            ) : (
              <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
                {deliveredFiles.slice(0, 6).map((file: any) => (
                  <li key={file.id} className="flex min-w-0 items-center px-4 py-2.5">
                    <PackageCheck className="mr-3 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-5 text-foreground">{file.file_name}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>
                        {file.project?.name || "Entrega"} · v{file.version || 1}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </div>
      </FadeUp>

      {/* 9 · Frentes recorrentes + diário à esquerda; agenda e próximas entregas à direita */}
      <FadeUp>
        <div className="grid min-w-0 grid-cols-1 gap-6 border-t border-border pt-5 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            {/* Frentes recorrentes: ciclo mensal, sem porcentagem eterna */}
            {recurringFronts.length > 0 && (
              <Secao titulo="Frentes recorrentes" descricao="Ciclo mensal">
                <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
                  {recurringFronts.map((project: any) => {
                    const projectDeliveredMonth = monthDelivered.filter((f: any) => f.project_id === project.id).length;
                    const projectPending = pendingFiles.filter((f: any) => f.project?.name === project.name).length;
                    return (
                      <li key={project.id} className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onSelectProject(project)}
                          className={juntar("group flex w-full min-w-0 items-center px-4 py-3 text-left transition-colors hover:bg-muted/40", foco)}
                          aria-label={`Abrir a frente ${project.name}`}
                        >
                          <Repeat className="mr-3 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center">
                              <span className="mr-2 min-w-0 truncate text-[14px] font-medium leading-5 text-foreground">{project.name}</span>
                              <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>
                                {typeLabels[project.project_type] || "Recorrente"}
                              </span>
                            </span>
                            <span className={juntar(texto.auxiliar, "mt-1 block")}>
                              {projectStatusLabel[project.status] || project.status}
                              {" · "}
                              {projectDeliveredMonth} entrega(s) liberada(s) neste mês
                              {projectPending > 0 && <span className="text-amber-500"> · {projectPending} aguardando sua aprovação</span>}
                              {nextPublication && ` · Próxima publicação ${formatDateShort(nextPublication.scheduled_at)}`}
                            </span>
                          </span>
                          <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Secao>
            )}

            {clientId && <ProjectJournal clientId={clientId} canWrite={false} />}

            {!temProjetos && (
              <EstadoVazio
                icone={<Briefcase className="h-5 w-5" />}
                titulo="Nenhum projeto ainda"
                descricao="Novos projetos aparecerão aqui quando forem iniciados."
              />
            )}
          </div>

          <div className="min-w-0 space-y-6">
            {/* Quando será postado: agenda das publicações confirmadas */}
            {(scheduled.length > 0 || published.length > 0) && (
              <Secao
                titulo="Quando será postado"
                acao={
                  <button type="button" onClick={() => navigate("/calendario")} className={botao.discreto} aria-label="Ver calendário">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  </button>
                }
              >
                <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
                  {scheduled.length === 0 ? (
                    <li className={juntar(texto.auxiliar, "px-4 py-3")}>Nenhuma publicação programada no momento.</li>
                  ) : (
                    scheduled
                      .filter((p: any) => p.scheduled_at)
                      .slice(0, 5)
                      .map((publication: any) => (
                        <li key={publication.id} className="flex min-w-0 items-center px-4 py-2.5">
                          <Send className="mr-3 h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium leading-5 text-foreground">{dataEHora(publication.scheduled_at)}</span>
                            <span className={juntar(texto.auxiliar, "block truncate")}>
                              {platformLabel[publication.platform] || publication.platform || "Rede social"} · Programado
                            </span>
                          </span>
                        </li>
                      ))
                  )}
                  {published
                    .filter((p: any) => p.permalink)
                    .slice(0, 2)
                    .map((publication: any) => (
                      <li key={publication.id} className="min-w-0">
                        <a
                          href={publication.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className={juntar("flex min-w-0 items-center px-4 py-2.5 text-[12.5px] text-emerald-500 no-underline transition-colors hover:bg-muted/40", foco)}
                        >
                          <CheckCircle2 className="mr-3 h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">Publicado · ver no {platformLabel[publication.platform] || "perfil"}</span>
                          <ArrowUpRight className="ml-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                </ul>
              </Secao>
            )}

            {/* Próximas entregas (etapas com data) */}
            {upcomingMilestones.length > 0 && (
              <Secao titulo="Próximas entregas">
                <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
                  {upcomingMilestones.map((milestone: any) => (
                    <li key={milestone.id} className="min-w-0 px-4 py-2.5">
                      <p className="truncate text-[13px] font-medium leading-5 text-foreground">{milestone.title}</p>
                      <p className={juntar(texto.auxiliar, "truncate")}>
                        {milestone.project?.name || "Projeto"} · previsão {formatDateShort(milestone.target_date)}
                      </p>
                    </li>
                  ))}
                </ul>
              </Secao>
            )}
          </div>
        </div>
      </FadeUp>

      {/* 10 · Pulso Aceleriq: avaliação rápida da experiência (formulário em destaque) */}
      {showPulse && (
        <FadeUp>
          <Painel
            as="section"
            aria-label="Avaliação da experiência"
            titulo={
              <span className="flex min-w-0 items-center">
                <span className="min-w-0">Como está sendo a experiência com a Aceleriq?</span>
                <AjudaRecolhida className="ml-1.5">
                  Leva 5 segundos e vai direto para o nosso time. Sua opinião guia o próximo ciclo.
                </AjudaRecolhida>
              </span>
            }
          >
            <div className="flex min-w-0 flex-wrap items-center">
              <div role="radiogroup" aria-label="Nota de 1 a 5" className="mr-3 inline-grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    role="radio"
                    aria-checked={pulseScore === score}
                    onClick={() => setPulseScore(score)}
                    aria-label={`Nota ${score}`}
                    className={juntar(
                      "flex h-10 w-10 items-center justify-center rounded-md border text-[15px] font-semibold transition-colors",
                      foco,
                      pulseScore === score
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {score}
                  </button>
                ))}
              </div>
              <span className={juntar(texto.auxiliar, "mt-2 sm:mt-0")}>1 = precisa melhorar · 5 = excelente</span>
            </div>
            {pulseScore !== null && (
              <div className="mt-3 space-y-3">
                <textarea
                  value={pulseComment}
                  onChange={(e) => setPulseComment(e.target.value)}
                  rows={2}
                  aria-label="Comentário (opcional)"
                  placeholder="Quer contar algo para a gente? (opcional)"
                  className={juntar(campoTexto, "min-h-[64px] resize-none")}
                />
                <BarraDeAcoes inicio={`Nota ${pulseScore} de 5`}>
                  <button type="button" onClick={submitPulse} disabled={pulseSending} className={botao.primario}>
                    {pulseSending ? "Enviando..." : "Enviar avaliação"}
                  </button>
                </BarraDeAcoes>
              </div>
            )}
          </Painel>
        </FadeUp>
      )}

      {/* 11 · Evolução acumulada: uma linha de estado, sem caixa */}
      <FadeUp>
        <div className={juntar(superficie.divisoria, "flex min-w-0 flex-wrap items-center pt-4 text-[12px] text-muted-foreground [&>*]:mr-5 [&>*]:mb-1")}>
          <span className="flex items-center font-medium text-foreground">
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
            Evolução acumulada
          </span>
          <span><span className="font-semibold tabular-nums text-foreground">{totalFiles}</span> entregas liberadas</span>
          <span><span className="font-semibold tabular-nums text-foreground">{approvedFiles}</span> aprovadas</span>
          {published.length > 0 && (
            <span><span className="font-semibold tabular-nums text-foreground">{published.length}</span> publicações realizadas</span>
          )}
          {doneProjects.length > 0 && (
            <span><span className="font-semibold tabular-nums text-foreground">{doneProjects.length}</span> projetos concluídos</span>
          )}
        </div>
      </FadeUp>
    </StaggerContainer>
  );
}
