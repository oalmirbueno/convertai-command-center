import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import CartaoDoDiaPrioritario from "@/components/dia-prioritario/CartaoDoDiaPrioritario";
import { ehRecorrenteParaODia } from "@/lib/diaPrioritario";
import { supabase } from "@/integrations/supabase/client";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCheck,
  FileText,
  FolderOpen,
  Inbox,
  Newspaper,
  PackageCheck,
  Repeat,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  AjudaRecolhida,
  BarraDeAcoes,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Secao,
  botao,
  campoTexto,
  espaco,
  foco,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import { Card, CardSurface, Donut, List, ListRow, PageHeader, StatCard, StatGrid, StatusPill, chartColor, type ChartTone, type Tone } from "@/components/ds";
import CircularProgress from "./CircularProgress";
import { AvisoEmFaixa, Azulejo, Bolha, Legenda, Metrica, Trilha } from "./pecasOusadas";
import { FadeUp, StaggerContainer } from "./motion";
import { useTelaPequena } from "./useTelaPequena";
import ProjectJournal from "@/components/shared/ProjectJournal";
import { estruturaDoRitual, resumoDoRitual } from "@/lib/ritualTexto";
import { primeiraFrase } from "@/lib/frases";
import { todayBR } from "@/lib/dateBR";
import { cobrancaAtrasada } from "@/lib/clientes/cobrancaDoPortal";
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
  // 16/10/2026 (dono: "cara de aplicativo, menos informação"): abaixo de 640 px o
  // Início mostra só o que importa agora (avisos, aprovar, novidade, próximo
  // passo) e o resto fica recolhido em "Mais detalhes", lembrado por cliente.
  const pequena = useTelaPequena();
  const [maisDetalhes, setMaisDetalhes] = useEstadoDaTela<boolean>(`inicio:mais-detalhes:${clientId}`, false, {
    validar: (v) => typeof v === "boolean",
  });
  const recolhidoNoCelular = pequena && !maisDetalhes;
  const { loadingProjects, loadingDetails, errorProjects, refetchProjects, errorAprovacoes, refetchAprovacoes, data } = useClientDashboardData(clientId);
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
  // Atraso só depois do dia do vencimento (dia de calendário de São Paulo). Antes, `due_date` às 12h < agora
  // punha "Pagamento em atraso" na cobrança que vence hoje a partir do meio-dia. O conjunto lido já é o das
  // cobranças em aberto; aqui só a data decide.
  const hojeBR = todayBR();
  const overdueBills = (clientPendingBilling || []).filter((b: any) => cobrancaAtrasada("pending", b.due_date, hojeBR));
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
      const { data: fresh, error: erroDeLeitura } = await supabase
        .from("profiles")
        .select("services_config")
        .eq("id", clientId)
        .maybeSingle();
      // Sem a leitura, `current` virava {} e o update gravava SÓ o pulso, apagando o resto do services_config
      // (frentes, empresa interna, avulso concluído, vínculo com o lead). Sem o cadastro lido, não grava nada.
      if (erroDeLeitura) throw erroDeLeitura;
      if (!fresh) throw new Error("Cadastro do cliente não encontrado.");
      const current = (fresh.services_config as any) || {};
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

  // Cartões do celular (16/10/2026): a novidade da semana e o próximo passo.
  type CartaoDoCelular = { chave: string; rotulo: string; titulo: string; apoio?: string; para: string; icone: typeof FileText; tomDoIcone: string };
  const semAsterisco = (valor: unknown) => primeiraFrase(String(valor).replace(/\*/g, ""));
  const cartaoNovidade: CartaoDoCelular =
    latestReport && reportIsFresh
      ? {
          chave: "novidade",
          rotulo: "Novidade",
          titulo: latestReport.title || "Nova atualização do seu trabalho",
          apoio: latestReport.highlights ? semAsterisco(latestReport.highlights) : undefined,
          para: "/onde-estamos",
          icone: Newspaper,
          tomDoIcone: "bg-accent-soft text-primary",
        }
      : {
          chave: "novidade",
          rotulo: "Onde estamos",
          titulo: deliveredFiles.length > 0
            ? `Trabalho em movimento: ${deliveredFiles.length} entrega(s) liberada(s)`
            : "Estamos organizando o seu ciclo de trabalho",
          apoio: "Ver o retrato completo",
          para: "/onde-estamos",
          icone: Newspaper,
          tomDoIcone: "bg-accent-soft text-primary",
        };
  const proximaEtapa = upcomingMilestones[0] || null;
  const cartaoProximo: CartaoDoCelular | null = nextPublication
    ? {
        chave: "proximo",
        rotulo: "Próximo passo",
        titulo: `Publicação ${dataEHora(nextPublication.scheduled_at)}`,
        apoio: nextPublication.platform ? platformLabel[nextPublication.platform] || nextPublication.platform : undefined,
        para: "/calendario",
        icone: Send,
        tomDoIcone: "bg-info-soft text-info",
      }
    : proximaEtapa
      ? {
          chave: "proximo",
          rotulo: "Próximo passo",
          titulo: proximaEtapa.title,
          apoio: `${proximaEtapa.project?.name || "Projeto"} · previsão ${formatDateShort(proximaEtapa.target_date)}`,
          para: "/onde-estamos",
          icone: CalendarDays,
          tomDoIcone: "bg-info-soft text-info",
        }
      : latestReport?.next_steps
        ? {
            chave: "proximo",
            rotulo: "Próximo passo",
            titulo: semAsterisco(latestReport.next_steps),
            para: "/onde-estamos",
            icone: CalendarDays,
            tomDoIcone: "bg-info-soft text-info",
          }
        : null;

  // Espera a primeira carga de tudo: a tela entra inteira, sem bloco chegando depois e empurrando o resto.
  if (loadingProjects || loadingDetails) {
    return <Carregando forma="aba" rotulo="Carregando o seu painel" />;
  }

  if (errorProjects) {
    return (
      <div className={espaco.pagina}>
        <PageHeader title="Bem-vindo de volta," greeting={firstName} subtitle={hoje} />
        <EstadoDeErro
          titulo="Não foi possível carregar o seu painel."
          acao={<button type="button" className={botao.secundario} onClick={() => refetchProjects()}>Tentar de novo</button>}
        />
      </div>
    );
  }

  const temProjetos = activeProjects.length > 0 || doneProjects.length > 0;
  const projetosComPrazo = [...closedProjects, ...doneProjects];
  const temPendencia = pendingFiles.length > 0;
  const diaRecorrente = !!clientProfile && ehRecorrenteParaODia({ id: String(clientId), ...clientProfile });
  // Rosca do ciclo: as publicações que a tela já tem, separadas por situação.
  const publicadosAntes = Math.max(0, published.length - publishedThisMonth.length);
  const totalDePublicacoes = scheduled.length + published.length;

  return (
    <StaggerContainer className={espaco.pagina}>
      {/* 1 · Boas-vindas: saudação grande com o nome apagado, data como estado, explicação no "?" */}
      <FadeUp>
        <PageHeader
          title={pequena ? "Olá," : "Bem-vindo de volta,"}
          greeting={firstName}
          subtitle={`${hoje}${isImpersonation ? " · somente leitura" : ""}`}
          help="Acompanhe suas frentes, entregas e publicações liberadas pela Aceleriq. Os números se atualizam sozinhos."
          actions={
            closedProjects.length > 0 ? (
              <div className="hidden items-center rounded-full bg-card py-1.5 pl-1.5 pr-4 shadow-card sm:flex" title="Média dos projetos com prazo">
                <CircularProgress progress={closedAvgProgress} size={44} strokeWidth={4} />
                <span className={juntar(texto.auxiliar, "ml-2.5 leading-4")}>Projetos<br />com prazo</span>
              </div>
            ) : undefined
          }
        />
        <nav aria-label="Atalhos" className="mt-5 grid min-w-0 grid-cols-3 gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-6">
          {ATALHOS.map((atalho) => (
            <Azulejo
              key={atalho.to}
              icone={<atalho.icon className="h-5 w-5" />}
              rotulo={atalho.label}
              aoClicar={() => navigate(atalho.to)}
              destaque={atalho.to === "/aprovacoes" && temPendencia}
              contador={atalho.to === "/aprovacoes" ? pendingFiles.length : undefined}
            />
          ))}
        </nav>
      </FadeUp>

      {/* 1b · Dia Prioritário (12/10/2026): o dia fixo de atenção estratégica; sem dia confirmado, estado neutro */}
      {/* 23/10/2026: no celular recolhido ele vira uma linha, sempre à vista (antes sumia em "Mais detalhes" e o cliente não via o dia). */}
      {diaRecorrente && recolhidoNoCelular ? (
        // Cliente recorrente sempre tem a linha do dia: o lugar dela fica guardado enquanto o dia carrega (nada pula).
        <div className="min-h-[84px] min-w-0 min-[380px]:min-h-[68px] [&>[data-compacto]]:min-h-[84px] min-[380px]:[&>[data-compacto]]:min-h-[68px]">
          <CartaoDoDiaPrioritario clientId={clientId} recorrente compacto />
        </div>
      ) : (
        <CartaoDoDiaPrioritario clientId={clientId} recorrente={diaRecorrente} compacto={recolhidoNoCelular} />
      )}

      {/* 2 · Avisos importantes: atraso e renovação chegando */}
      {overdueBills.length > 0 && (
        <FadeUp>
          <AvisoEmFaixa
            tom="perigo"
            icone={<CalendarDays className="h-5 w-5" />}
            titulo={<>Pagamento em atraso: {dinheiro(overdueAmount)}</>}
            apoio="Regularize para manter as entregas sem pausa. Toque para ver os detalhes."
            aoClicar={() => navigate("/financeiro")}
          />
        </FadeUp>
      )}

      {renewalSoon && overdueBills.length === 0 && (
        <FadeUp>
          <AvisoEmFaixa
            tom="info"
            icone={<Repeat className="h-5 w-5" />}
            titulo={
              <>
                {renewalDays === 0
                  ? "Sua renovação vence hoje"
                  : `Sua renovação vence em ${renewalDays} dia${renewalDays === 1 ? "" : "s"}`}
                {clientProfile?.plan_value ? ` · ${dinheiro(Number(clientProfile.plan_value))}` : ""}
              </>
            }
            apoio="Garanta a continuidade dos resultados. Toque para ver os detalhes."
            aoClicar={() => navigate("/financeiro")}
          />
        </FadeUp>
      )}

      {/* 2b · Etapas ou entregas não carregaram: avisa em vez de mostrar "nenhuma pendência" */}
      {errorAprovacoes && (
        <EstadoDeErro
          titulo="Não foi possível conferir as suas entregas e aprovações."
          acao={<button type="button" className={botao.secundario} onClick={() => refetchAprovacoes()}>Tentar de novo</button>}
        />
      )}

      {/* 3 · Ação necessária: o que precisa aprovar. É o cartão sólido da tela (cor da marca, texto quase preto). */}
      {temPendencia && (
        <FadeUp>
          <section aria-label="Aprovações pendentes" className="min-w-0">
          <CardSurface variant="accent" className="overflow-hidden">
            <div className="flex min-w-0 flex-wrap items-center p-5 sm:flex-nowrap sm:p-6">
              <span className="mr-4 shrink-0 text-[64px] font-medium leading-[64px] tracking-[-0.05em] tabular-nums text-foreground max-sm:text-[56px] max-sm:leading-[56px]" aria-hidden="true">
                {pendingFiles.length}
              </span>
              <div className="flex min-w-0 flex-1 items-center sm:mr-4">
                <h2 className="min-w-0 text-[18px] font-semibold leading-6 tracking-[-0.02em] text-foreground">
                  <span className="sr-only">{pendingFiles.length} </span>
                  {pendingFiles.length === 1 ? "entrega aguarda a sua aprovação" : "entregas aguardam a sua aprovação"}
                </h2>
                <AjudaRecolhida className="ml-1.5">
                  Sua aprovação libera o agendamento da publicação. Aprovou, a Aceleriq programa na data planejada.
                </AjudaRecolhida>
              </div>
              <button
                type="button"
                onClick={() => navigate("/aprovacoes")}
                className={juntar(botao.primario, "mt-4 h-12 w-full px-6 text-[14px] sm:mt-0 sm:h-11 sm:w-auto")}
              >
                Aprovar agora
                <ArrowUpRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <ul className="hidden min-w-0 border-t border-border px-6 py-2 sm:block">
              {pendingFiles.slice(0, 3).map((file: any) => (
                <li key={file.id} className="flex min-w-0 items-center py-2 text-[13px] leading-5 text-muted-foreground">
                  <span aria-hidden="true" className="mr-3 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-foreground">{file.file_name}</span>
                    {file.project?.name ? ` · ${file.project.name}` : ""}
                  </span>
                </li>
              ))}
              {pendingFiles.length > 3 && (
                <li className="py-2 pl-[18px] text-[13px] leading-5 text-muted-foreground">e mais {pendingFiles.length - 3} na área de Aprovações</li>
              )}
            </ul>
          </CardSurface>
          </section>
        </FadeUp>
      )}

      {/* 3b · Só no celular (16/10/2026): a novidade e o próximo passo em cartões
          grandes de toque, e o resto da tela recolhido em "Mais detalhes". */}
      {pequena && (
        <FadeUp className="min-w-0 space-y-3">
          {[cartaoNovidade, cartaoProximo].map((cartao) =>
            cartao ? (
              <button
                key={cartao.chave}
                type="button"
                onClick={() => navigate(cartao.para)}
                className={juntar(superficie.painel, cartao.chave === "novidade" && superficie.tinta, "flex w-full min-w-0 items-center p-5 text-left transition-transform duration-200 active:scale-[0.99]", foco)}
              >
                <span className={juntar("mr-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-full", cartao.chave === "novidade" ? "bg-muted text-primary" : cartao.tomDoIcone)}>
                  <cartao.icone className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.rotulo, "block")}>{cartao.rotulo}</span>
                  <span className="mt-1 line-clamp-2 text-[15px] font-semibold leading-5 text-foreground break-words">{cartao.titulo}</span>
                  {cartao.apoio && <span className="mt-1 block truncate text-[13px] leading-5 text-muted-foreground">{cartao.apoio}</span>}
                </span>
                <ChevronRight className="ml-2 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ) : null,
          )}
          <button
            type="button"
            onClick={() => setMaisDetalhes(!maisDetalhes)}
            aria-expanded={maisDetalhes}
            className={juntar("flex h-12 w-full min-w-0 items-center justify-center rounded-full bg-muted text-[13px] font-medium text-foreground transition-colors active:bg-border", foco)}
          >
            {maisDetalhes ? "Menos detalhes" : "Mais detalhes"}
            <ChevronDown className={juntar("ml-1.5 h-4 w-4 transition-transform duration-200", maisDetalhes && "rotate-180")} aria-hidden="true" />
          </button>
        </FadeUp>
      )}

      {/* 4 · Números gerais: número grande, um cartão de tinta e (sem pendência) um sólido */}
      {!recolhidoNoCelular && (
      <FadeUp>
        <StatGrid cols={4} label="Resumo">
          <StatCard
            variant={temPendencia ? "default" : "accent"}
            size="xl"
            label="Frentes ativas"
            value={activeProjects.length}
            hint={doneProjects.length ? `${doneProjects.length} concluída(s)` : "Nenhuma concluída"}
            icon={<Briefcase className="h-4 w-4" />}
          />
          <StatCard
            variant="ink"
            size="xl"
            label="Entregas liberadas"
            value={totalFiles}
            hint={approvedFiles ? `${approvedFiles} aprovada(s)` : "Aguardando decisões"}
            icon={<PackageCheck className="h-4 w-4" />}
            progress={totalFiles > 0 ? { value: approvedFiles || 0, max: totalFiles } : undefined}
          />
          <StatCard
            size="xl"
            label="Etapas concluídas"
            value={completedMilestonesCount}
            hint={`de ${totalMilestones} etapa(s)`}
            icon={<CheckCircle2 className="h-4 w-4" />}
            progress={totalMilestones > 0 ? { value: completedMilestonesCount || 0, max: totalMilestones } : undefined}
          />
          <StatCard
            size="xl"
            label="Aprovações pendentes"
            value={pendingFiles.length}
            hint={temPendencia ? <span className="font-medium text-warning">Ação necessária</span> : "Nenhuma pendência"}
            icon={<FileCheck className="h-4 w-4" />}
            to={temPendencia ? "/aprovacoes" : undefined}
            corner={temPendencia ? <ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : undefined}
          />
        </StatGrid>
      </FadeUp>
      )}

      {/* 5 e 6 · Conteúdos do ciclo (só para quem tem frente de conteúdo) e a etapa do processo, lado a lado */}
      {!recolhidoNoCelular && (
      <FadeUp>
        <div className={juntar(espaco.grade, "grid-cols-1", hasContentFront && "lg:grid-cols-5")}>
          {hasContentFront && (
            <Card
              className="lg:col-span-3"
              collapsible={false}
              title="Conteúdos do ciclo"
              subtitle={
                nextPublication ? (
                  <span className="block truncate">
                    Próxima publicação {dataEHora(nextPublication.scheduled_at)}
                    {nextPublication.platform ? ` · ${platformLabel[nextPublication.platform] || nextPublication.platform}` : ""}
                  </span>
                ) : undefined
              }
              action={
                <button type="button" onClick={() => navigate("/calendario")} className={botao.secundario} aria-label="Ver calendário completo">
                  <CalendarDays className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Calendário</span>
                </button>
              }
            >
              <div className="flex min-w-0 flex-col sm:flex-row sm:items-center">
                {totalDePublicacoes > 0 && (
                  <div className="mb-5 flex shrink-0 justify-center sm:mb-0 sm:mr-8">
                    <Donut
                      size={148}
                      thickness={16}
                      segments={[
                        { label: "Publicados no mês", value: publishedThisMonth.length, tone: 1 },
                        { label: "Programados", value: scheduled.length, tone: 2 },
                        { label: "Publicados antes", value: publicadosAntes, tone: "muted" },
                      ]}
                    >
                      <span className="text-[28px] font-semibold leading-8 tracking-[-0.03em] tabular-nums">{totalDePublicacoes}</span>
                      <span className="text-[11px] leading-4 text-muted-foreground">publicações</span>
                    </Donut>
                  </div>
                )}
                <div role="group" aria-label="Conteúdos do ciclo" className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-6">
                  <Metrica
                    rotulo="Aguardando aprovação"
                    valor={pendingFiles.length}
                    corDoValor={temPendencia ? "text-warning" : "text-muted-foreground"}
                  />
                  <Metrica rotulo={<Ponto tom={2}>Programados</Ponto>} valor={scheduled.length} />
                  <Metrica rotulo={<Ponto tom={1}>Publicados no mês</Ponto>} valor={publishedThisMonth.length} />
                  <Metrica rotulo="Publicados no total" valor={published.length} />
                </div>
              </div>
            </Card>
          )}

          <Card
            className={hasContentFront ? "lg:col-span-2" : undefined}
            collapsible={false}
            title="Etapa do processo"
            help={STAGE_HINTS[currentStage]}
          >
            <div className="flex min-w-0 items-end">
              <span className={juntar(texto.numeroGrande, "shrink-0")}>
                {currentStage + 1}
                <span className="text-[20px] font-medium tracking-normal text-muted-foreground">/{STAGES.length}</span>
              </span>
              <span className="mb-1 ml-4 min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold leading-5 text-foreground">{STAGES[currentStage]}</span>
                <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>{`Etapa ${currentStage + 1} de ${STAGES.length}`}</span>
              </span>
            </div>
            <div className="mt-6 min-w-0">
              <Trilha etapas={STAGES} atual={currentStage} rotulo="Etapas do trabalho" />
            </div>
          </Card>
        </div>
      </FadeUp>
      )}

      {/* 7 · O que estamos fazendo, onde estamos e o próximo passo
          (no celular os cartões 3b já fazem esse papel: fica em "Mais detalhes") */}
      {!recolhidoNoCelular && (
      <FadeUp>
        <Secao
          titulo="Onde estamos agora"
          acao={
            <button type="button" onClick={() => navigate("/onde-estamos")} className={botao.secundario} aria-label="Abrir Onde Estamos">
              <span className="hidden sm:inline">Abrir</span>
              <ArrowUpRight className="h-4 w-4 sm:ml-1" aria-hidden="true" />
            </button>
          }
        >
          {!(latestReport && reportIsFresh) && (
            <button
              type="button"
              onClick={() => navigate("/onde-estamos")}
              className={juntar(superficie.painel, "group flex w-full min-w-0 items-center p-5 text-left transition-transform duration-200 hover:-translate-y-0.5 sm:p-6", foco)}
            >
              <Bolha tom="marca" tamanho="lg" className="mr-4">
                <Newspaper className="h-5 w-5" />
              </Bolha>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-6 text-foreground">
                  {deliveredFiles.length > 0
                    ? `Trabalho em movimento: ${deliveredFiles.length} entrega(s) já liberada(s).`
                    : "Estamos organizando o seu ciclo de trabalho."}
                  {nextPublication?.scheduled_at &&
                    ` Próxima publicação em ${new Date(nextPublication.scheduled_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}.`}
                </span>
                <span className="mt-1.5 flex items-center text-[13px] font-medium text-primary">
                  Ver o retrato completo em tempo real
                  <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </span>
            </button>
          )}
          {latestReport && reportIsFresh && (
            <button
              type="button"
              onClick={() => navigate("/onde-estamos")}
              className={juntar(superficie.painel, "group block w-full min-w-0 text-left transition-transform duration-200 hover:-translate-y-0.5", foco)}
            >
              <span className="flex min-w-0 items-center p-5 sm:p-6">
                <Bolha tom="solido" tamanho="lg" className="mr-4">
                  <FileText className="h-5 w-5" />
                </Bolha>
                <span className="min-w-0 flex-1">
                  <Legenda>Última atualização</Legenda>
                  <span className="mt-0.5 block truncate text-[18px] font-semibold leading-6 tracking-[-0.02em] text-foreground">{latestReport.title}</span>
                </span>
                <span aria-hidden="true" className="ml-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </span>
              <span className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-5 border-t border-border/70 p-5 sm:p-6 lg:grid-cols-3">
                {latestReport.highlights && (
                  <span className="block min-w-0">
                    <Legenda>O que estamos fazendo</Legenda>
                    <span className={juntar(texto.corpo, "mt-1.5 line-clamp-4 block")}>{latestReport.highlights}</span>
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
                    <span className="block min-w-0">
                      <Legenda>Resultado explicado</Legenda>
                      <span className={juntar(texto.corpo, "mt-1.5 block text-muted-foreground", e.blocos.length > 0 ? "" : "line-clamp-4 whitespace-pre-line")}>{resumo}</span>
                      {demais.length > 0 && (
                        <span className={juntar(texto.auxiliar, "mt-1.5 block")}>Também nesta atualização: {demais.join(" · ")}.</span>
                      )}
                    </span>
                  );
                })()}
                {latestReport.next_steps && (
                  <span className="block min-w-0">
                    <Legenda>Próxima etapa</Legenda>
                    <span className={juntar(texto.corpo, "mt-1.5 block text-muted-foreground")}>{primeiraFrase(String(latestReport.next_steps).replace(/\*/g, ""))}</span>
                  </span>
                )}
              </span>
            </button>
          )}
        </Secao>
      </FadeUp>
      )}

      {/* 8 · Projetos com prazo e Entregas recentes lado a lado. Sem projetos
          com prazo, as Entregas ocupam a linha inteira (sem buraco ao lado).
          Listas curtas (até 6): a página rola, nada de caixa com rolagem própria. */}
      {!recolhidoNoCelular && (
      <FadeUp>
        <div className={juntar(espaco.grade, "grid-cols-1", projetosComPrazo.length > 0 && "lg:grid-cols-2")}>
          {projetosComPrazo.length > 0 && (
            <Card
              title="Projetos com prazo"
              subtitle={`${closedProjects.length} ativo(s)${doneProjects.length > 0 ? ` · ${doneProjects.length} concluído(s)` : ""}`}
            >
              <List label="Projetos com prazo">
                {projetosComPrazo.map((project: any) => {
                  const projectMilestones = milestones.filter((milestone: any) => milestone.project_id === project.id);
                  const completed = projectMilestones.filter((milestone: any) => milestone.status === "completed").length;
                  const deadlineDistance = project.deadline ? daysUntil(project.deadline) : null;
                  return (
                    <ListRow
                      key={project.id}
                      onClick={() => onSelectProject(project)}
                      leading={<CircularProgress progress={project.progress || 0} size={48} strokeWidth={4} />}
                      title={project.name}
                      subtitle={
                        <>
                          {typeLabels[project.project_type] || "Projeto"}
                          {" · "}
                          {completed}/{projectMilestones.length} etapas
                          {project.deadline &&
                            (deadlineDistance !== null && deadlineDistance < 0
                              ? " · Prazo em atualização"
                              : ` · Previsão ${formatDateShort(project.deadline)}`)}
                        </>
                      }
                      status={<StatusPill tone={tomDoProjeto[project.status] || "neutral"}>{projectStatusLabel[project.status] || project.status}</StatusPill>}
                      action={<ChevronRight className="pointer-events-none h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                    />
                  );
                })}
              </List>
            </Card>
          )}
          <Card
            title="Entregas recentes"
            subtitle={deliveredFiles.length > 0 ? `${deliveredFiles.length} liberada(s)` : undefined}
            action={
              deliveredFiles.length > 0 ? (
                <button type="button" onClick={() => navigate("/documentos")} className={botao.secundario} aria-label="Ver todas as entregas em Documentos">
                  <span className="hidden sm:inline">Ver todas</span>
                  <ChevronRight className="h-4 w-4 sm:ml-1" aria-hidden="true" />
                </button>
              ) : undefined
            }
          >
            {deliveredFiles.length === 0 ? (
              <EstadoVazio compacto titulo="Nenhuma entrega liberada ainda." />
            ) : (
              <List label="Entregas recentes">
                {deliveredFiles.slice(0, 6).map((file: any) => (
                  <ListRow
                    key={file.id}
                    leading={<Bolha tom="sucesso"><PackageCheck className="h-4 w-4" /></Bolha>}
                    title={file.file_name}
                    subtitle={file.project?.name || "Entrega"}
                    value={`v${file.version || 1}`}
                  />
                ))}
              </List>
            )}
          </Card>
        </div>
      </FadeUp>
      )}

      {/* 9 · Frentes recorrentes + diário à esquerda; agenda e próximas entregas à direita */}
      {!recolhidoNoCelular && (
      <FadeUp>
        <div className={juntar(espaco.grade, "grid-cols-1 lg:grid-cols-3")}>
          <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-2">
            {/* Frentes recorrentes: ciclo mensal, sem porcentagem eterna */}
            {recurringFronts.length > 0 && (
              <Card title="Frentes recorrentes" subtitle="Ciclo mensal">
                <List label="Frentes recorrentes">
                  {recurringFronts.map((project: any) => {
                    const projectDeliveredMonth = monthDelivered.filter((f: any) => f.project_id === project.id).length;
                    const projectPending = pendingFiles.filter((f: any) => f.project?.name === project.name).length;
                    return (
                      <ListRow
                        key={project.id}
                        onClick={() => onSelectProject(project)}
                        leading={<Bolha tom="marca" tamanho="lg"><Repeat className="h-5 w-5" /></Bolha>}
                        title={project.name}
                        subtitle={
                          <>
                            {typeLabels[project.project_type] || "Recorrente"}
                            {" · "}
                            {projectStatusLabel[project.status] || project.status}
                            {nextPublication && ` · Próxima publicação ${formatDateShort(nextPublication.scheduled_at)}`}
                          </>
                        }
                        status={projectPending > 0 ? <StatusPill tone="warning">{projectPending} aguardando sua aprovação</StatusPill> : undefined}
                        value={projectDeliveredMonth}
                        valueHint="entrega(s) no mês"
                        action={<ChevronRight className="pointer-events-none h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                      />
                    );
                  })}
                </List>
              </Card>
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

          <div className="min-w-0 space-y-4 sm:space-y-5">
            {/* Quando será postado: agenda das publicações confirmadas */}
            {(scheduled.length > 0 || published.length > 0) && (
              <Card
                title="Quando será postado"
                action={
                  <button type="button" onClick={() => navigate("/calendario")} className={botao.icone} aria-label="Ver calendário">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  </button>
                }
              >
                <List label="Quando será postado">
                  {scheduled.length === 0 ? (
                    <li className={juntar(texto.auxiliar, "px-3 py-3")}>Nenhuma publicação programada no momento.</li>
                  ) : (
                    scheduled
                      .filter((p: any) => p.scheduled_at)
                      .slice(0, 5)
                      .map((publication: any) => (
                        <ListRow
                          key={publication.id}
                          dense
                          leading={<Bolha tom="info"><Send className="h-4 w-4" /></Bolha>}
                          title={dataEHora(publication.scheduled_at)}
                          subtitle={`${platformLabel[publication.platform] || publication.platform || "Rede social"} · Programado`}
                        />
                      ))
                  )}
                  {published
                    .filter((p: any) => p.permalink)
                    .slice(0, 2)
                    .map((publication: any) => (
                      <li key={publication.id} className="relative min-w-0">
                        <a
                          href={publication.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className={juntar("flex min-w-0 items-center rounded-lg px-3 py-2.5 text-[13px] font-medium text-success no-underline transition-colors hover:bg-muted/60", foco)}
                        >
                          <Bolha tom="sucesso" className="mr-3"><CheckCircle2 className="h-4 w-4" /></Bolha>
                          <span className="min-w-0 flex-1 truncate">Publicado · ver no {platformLabel[publication.platform] || "perfil"}</span>
                          <ArrowUpRight className="ml-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                </List>
              </Card>
            )}

            {/* Próximas entregas (etapas com data) */}
            {upcomingMilestones.length > 0 && (
              <Card title="Próximas entregas">
                <List label="Próximas entregas">
                  {upcomingMilestones.map((milestone: any) => (
                    <ListRow
                      key={milestone.id}
                      dense
                      leading={<Bolha><CalendarDays className="h-4 w-4" /></Bolha>}
                      title={milestone.title}
                      subtitle={milestone.project?.name || "Projeto"}
                      value={formatDateShort(milestone.target_date)}
                      valueHint="previsão"
                    />
                  ))}
                </List>
              </Card>
            )}
          </div>
        </div>
      </FadeUp>
      )}

      {/* 10 · Pulso Aceleriq: avaliação rápida da experiência (formulário em destaque) */}
      {showPulse && (
        <FadeUp>
          <Card
            as="section"
            aria-label="Avaliação da experiência"
            title="Como está sendo a experiência com a Aceleriq?"
            help="Leva 5 segundos e vai direto para o nosso time. Sua opinião guia o próximo ciclo."
          >
            <div className="flex min-w-0 flex-wrap items-center">
              <div role="radiogroup" aria-label="Nota de 1 a 5" className="mr-4 inline-grid grid-cols-5 gap-1.5 sm:gap-3">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    role="radio"
                    aria-checked={pulseScore === score}
                    onClick={() => setPulseScore(score)}
                    aria-label={`Nota ${score}`}
                    className={juntar(
                      "flex h-10 w-10 items-center justify-center rounded-full text-[18px] sm:h-12 sm:w-12 font-semibold tabular-nums transition-colors",
                      foco,
                      pulseScore === score
                        ? "bg-accent-solid text-on-accent"
                        : "bg-muted text-muted-foreground hover:bg-foreground hover:text-background",
                    )}
                  >
                    {score}
                  </button>
                ))}
              </div>
              <span className={juntar(texto.auxiliar, "mt-3 sm:mt-0")}>1 = precisa melhorar · 5 = excelente</span>
            </div>
            {pulseScore !== null && (
              <div className="mt-4 space-y-3">
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
          </Card>
        </FadeUp>
      )}

      {/* 11 · Evolução acumulada: a faixa de tinta que fecha a tela, com os números grandes */}
      {!recolhidoNoCelular && (
      <FadeUp>
        <CardSurface variant="ink" padded>
          <p className="flex min-w-0 items-center text-[13px] font-medium leading-5 text-muted-foreground">
            <ShieldCheck className="mr-2 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            Evolução acumulada
          </p>
          <div className="mt-5 grid min-w-0 grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
            <Metrica tamanho="xl" rotulo="Entregas liberadas" valor={totalFiles} />
            <Metrica tamanho="xl" rotulo="Aprovadas" valor={approvedFiles} />
            {published.length > 0 && <Metrica tamanho="xl" rotulo="Publicações realizadas" valor={published.length} />}
            {doneProjects.length > 0 && <Metrica tamanho="xl" rotulo="Projetos concluídos" valor={doneProjects.length} />}
          </div>
        </CardSurface>
      </FadeUp>
      )}
    </StaggerContainer>
  );
}

const tomDoProjeto: Record<string, Tone> = {
  active: "success",
  review: "warning",
  planning: "info",
  done: "neutral",
  paused: "neutral",
};

/** Bolinha na cor do gráfico antes do rótulo: liga o número à fatia da rosca. */
function Ponto({ tom, children }: { tom: ChartTone; children: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center">
      <span aria-hidden="true" className="mr-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: chartColor(tom) }} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
