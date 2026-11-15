import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import {
  FileCheck, CalendarDays, Inbox, ArrowUpRight,
  CheckCircle2, Clock, ExternalLink, ChevronDown,
} from "lucide-react";
import { buildJourneyNarrative } from "@/lib/clientJourneyNarrative";
import { readMemory } from "@/lib/clientMemory";
import RitualEstruturado from "@/components/client/RitualEstruturado";
import { estruturaDoRitual } from "@/lib/ritualTexto";
import {
  formatMetricNumber,
  useSocialMetricsWeekly,
  agruparPorConta,
  semanaEmAndamento,
  weekDeltaPct,
  type SocialMetricsWeek,
} from "@/hooks/useSocialMetrics";
import { useIdentidadesPorConta } from "@/components/admin/LogoDoCliente";
import { useTelaPequena } from "@/components/client/useTelaPequena";
import {
  Carregando,
  EstadoDeErro,
  Secao,
  botao,
  espaco,
  foco,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import { CardSurface, Chip, OverflowMenu, PageHeader, PillTabs, ProgressBar, Sparkline, StatCard, StatGrid, StatusPill, type Tone } from "@/components/ds";
import { Bolha, Legenda } from "@/components/client/pecasOusadas";

/** Rótulo curto dos sinais para o cartão estreito do celular (o texto inteiro continua na tela larga). */
const ROTULO_CURTO: Record<string, string> = {
  "Entregas concluídas no mês": "Entregas no mês",
  "Em produção agora": "Em produção",
  "Publicações no ar": "No ar",
  "Esperando você": "Esperando você",
};

/**
 * O narrador do mês: a IA escreve 3 a 5 frases contando o mês do cliente a
 * partir da linha do tempo real do painel. Cache local de 24 horas por
 * cliente e mês, para a página abrir na hora e a IA não rodar a cada visita.
 * Sem movimento no mês ou com o narrador indisponível, o bloco simplesmente
 * não aparece: nunca um erro na cara do cliente.
 */
function MonthNarrative({ clientId, recolhida = false }: { clientId: string; recolhida?: boolean }) {
  const monthKey = new Date().toISOString().slice(0, 7);
  const cacheKey = `aceleriq-narrative-${clientId}-${monthKey}`;

  const { data } = useQuery({
    queryKey: ["journey-narrative", clientId, monthKey],
    queryFn: async (): Promise<{ narrative: string | null; month?: string }> => {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - (parsed.at || 0) < 24 * 3600_000) return parsed.value;
        }
      } catch { /* cache corrompido: gera de novo */ }

      const { data: result, error } = await supabase.functions.invoke("journey-narrative", {
        body: { client_id: clientId },
      });
      if (error || result?.error) return { narrative: null };
      const value = { narrative: result?.narrative ?? null, month: result?.month };
      // Só uma resposta com texto entra no cache de 24h. Falha ou mês sem
      // movimento não ficam gravados: na próxima visita tenta de novo.
      if (value.narrative) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), value }));
        } catch { /* armazenamento cheio: segue sem cache */ }
      }
      return value;
    },
    staleTime: 24 * 3600_000,
    retry: 1,
  });

  if (!data?.narrative) return null;
  return (
    <Secao
      divisoria
      titulo={`O seu mês${data.month ? ` de ${data.month}` : ""}`}
      recolhidaDeInicio={recolhida}
      ajuda="Contado pela Aceleriq a partir do que aconteceu de verdade no seu painel neste mês."
    >
      <CardSurface padded>
        <p className="max-w-3xl text-[15px] leading-7 text-foreground/90">{data.narrative}</p>
      </CardSurface>
    </Secao>
  );
}

/**
 * Bastidores da semana: o trabalho que acontece antes de qualquer post ir ao
 * ar. Vem do checklist que a equipe fecha toda semana, traduzido para a
 * linguagem do cliente. Sem movimento na semana, o bloco não aparece: o
 * cliente nunca vê uma caixa vazia dizendo que nada foi feito.
 */
function WeekBackstage({ clientId, recolhida = false }: { clientId: string; recolhida?: boolean }) {
  const { data } = useQuery({
    queryKey: ["cycle-client-pulse", clientId],
    queryFn: async () => {
      const { data: result, error } = await supabase.functions.invoke("cycle-client-pulse", {
        body: { client_id: clientId },
      });
      if (error || result?.error) return null;
      return result as {
        fronts: Array<{ area: string; label: string; done: number; total: number; highlights: string[]; last_at: string | null }>;
        total: number;
      };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!data?.fronts?.length) return null;

  return (
    <Secao
      divisoria
      data-tour="cliente-bastidores"
      titulo="Bastidores da semana"
      recolhidaDeInicio={recolhida}
      descricao={`${data.total} ${data.total === 1 ? "etapa concluída" : "etapas concluídas"}`}
      ajuda="Este é o trabalho de bastidor da semana, atualizado conforme a equipe avança. O que chega até você, como conteúdo e publicações, nasce daqui."
    >
      <ul className={juntar(espaco.grade, "grid-cols-1 lg:grid-cols-2")}>
        {data.fronts.map((front) => (
          <li key={front.area} className={juntar(superficie.painel, "min-w-0 p-5 sm:p-6")}>
            <div className="flex min-w-0 items-end justify-between">
              <p className="min-w-0 truncate text-[15px] font-semibold leading-5 text-foreground">{front.label}</p>
              <p className="ml-3 shrink-0 text-[24px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-foreground">
                {front.done}
                <span className="text-[13px] font-normal tracking-normal text-muted-foreground"> de {front.total}</span>
              </p>
            </div>
            {/* Segmentos com margem (sem gap em flex: Safari 11). */}
            <div className="mt-4 flex h-2.5" aria-hidden="true">
              {Array.from({ length: front.total }, (_, index) => (
                <span
                  key={index}
                  className={juntar("flex-1 rounded-full", index > 0 && "ml-1", index < front.done ? "bg-primary" : "bg-muted")}
                />
              ))}
            </div>
            <p className={juntar(texto.auxiliar, "mt-3 leading-5")}>
              {front.highlights.join(", ")}.
            </p>
          </li>
        ))}
      </ul>
    </Secao>
  );
}

/**
 * A história da parceria, contada em ordem.
 *
 * O cliente via o estado de agora (entregas, publicações) mas não a linha do
 * tempo do que foi construído. Aqui aparecem os capítulos que já foram
 * escritos para ele, então a relação tem memória e ele consegue ver de onde
 * veio o que está acontecendo hoje.
 */
function ClientHistory({ clientId, recolhida = false }: { clientId: string; recolhida?: boolean }) {
  const { data: entries } = useQuery({
    queryKey: ["client-memory-timeline", clientId],
    queryFn: () => readMemory(clientId, { limit: 8, onlyClientVisible: true }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!entries?.length) return null;

  return (
    <Secao
      divisoria
      data-tour="cliente-historia"
      titulo="A nossa história até aqui"
      recolhidaDeInicio={recolhida}
      descricao={`${entries.length} ${entries.length === 1 ? "capítulo" : "capítulos"}`}
      ajuda="Cada capítulo fica guardado aqui: o que foi combinado, o que foi feito e o porquê. Assim nada se perde entre uma conversa e outra."
    >
      <ol className="ml-2 space-y-6 border-l-2 border-border pl-6">
        {entries.map((entry) => (
          <li key={entry.id} className="relative min-w-0">
            <span className="absolute -left-[33px] top-0.5 h-4 w-4 rounded-full border-4 border-background bg-primary" aria-hidden="true" />
            <p className={texto.auxiliar}>
              {new Date(entry.created_at).toLocaleDateString("pt-BR", {
                day: "2-digit", month: "long", year: "numeric",
              })}
            </p>
            {entry.title && (
              <p className="mt-1 text-[15px] font-semibold leading-5 text-foreground">
                {entry.title}
              </p>
            )}
            {/* Capitulo escrito como ritual (blocos de WhatsApp) aparece
                organizado: abertura + dois blocos inteiros, nunca uma frase
                cortada no meio com reticencias e asteriscos. */}
            {estruturaDoRitual(entry.content).blocos.length > 0 ? (
              <RitualEstruturado body={entry.content} compact className="mt-2" />
            ) : (
              <p className={juntar(texto.corpo, "mt-1 whitespace-pre-line text-muted-foreground")}>
                {entry.content.length > 320 ? `${entry.content.slice(0, 320).replace(/\s+\S*$/, "")}…` : entry.content}
              </p>
            )}
          </li>
        ))}
      </ol>
    </Secao>
  );
}

import ProjectJournal from "@/components/shared/ProjectJournal";
import { buildProgressView, cycleFillPercent } from "@/lib/projectProgress";
import { buildGrowthSeries } from "@/lib/reportGrowth";
import { semTextoInterno } from "@/lib/textoInterno";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

/**
 * Onde Estamos: o retrato do trabalho em tempo real.
 *
 * A tela se monta sozinha com o que já existe no painel (frentes, entregas,
 * aprovações, publicações). As atualizações escritas pela Aceleriq entram como
 * uma camada extra na linha do tempo, nunca como pré-requisito: antes, sem
 * ritual publicado, o cliente clicava e caía numa página muda.
 */

const RITUAL_LABELS: Record<string, { label: string; tone: Tone }> = {
  rota_semana: { label: "Rota da Semana", tone: "accent" },
  meio_semana: { label: "Check do Meio da Semana", tone: "info" },
  prova_movimento: { label: "Prova de Movimento", tone: "success" },
  radar_aceleriq: { label: "Radar Aceleriq", tone: "info" },
  marco_90: { label: "Marco 90", tone: "warning" },
};

const SIGNAL_TONE: Record<string, string> = {
  good: "text-success",
  attention: "text-warning",
  neutral: "text-foreground",
};

/**
 * Instagram em números reais: a última semana fechada coletada da Meta, com a
 * variação contra a semana anterior e o histórico de alcance. Sem dados (conta
 * ainda não conectada ou primeira coleta pendente), o bloco não aparece.
 */
function InstagramRealBlock({ clientId, recolhida = false }: { clientId: string; recolhida?: boolean }) {
  // 12 semanas POR CONTA: quem tem duas contas precisa de linhas para as duas.
  const { data: todas } = useSocialMetricsWeekly(clientId, 40);
  const { data: identidades } = useIdentidadesPorConta();
  if (!todas || todas.length === 0) return null;
  // Uma conta por bloco. Misturar as duas contas do mesmo cliente comparava a
  // semana de uma com a mesma semana da outra e mostrava variacao inventada.
  const porConta = agruparPorConta(todas);
  return (
    <>
      {[...porConta.entries()].map(([accountId, rows]) => (
        <InstagramContaBlock
          key={accountId}
          rows={rows.slice(0, 12)}
          username={identidades?.get(accountId)?.username ?? null}
          recolhida={recolhida}
        />
      ))}
    </>
  );
}

function InstagramContaBlock({
  rows,
  username,
  recolhida = false,
}: {
  rows: SocialMetricsWeek[];
  username: string | null;
  recolhida?: boolean;
}) {
  const latest = rows[0];
  const weekLabel = (value: string) => {
    const [, month, day] = value.split("-");
    return `${day}/${month}`;
  };
  const cards = [
    { label: "Seguidores", campo: "followers", value: latest.followers, delta: weekDeltaPct(rows, "followers") },
    { label: "Alcance na semana", campo: "reach", value: latest.reach, delta: weekDeltaPct(rows, "reach") },
    { label: "Interações", campo: "total_interactions", value: latest.total_interactions, delta: weekDeltaPct(rows, "total_interactions") },
    { label: "Visitas ao perfil", campo: "profile_views", value: latest.profile_views, delta: weekDeltaPct(rows, "profile_views") },
  ].filter((card) => card.value != null);
  if (cards.length === 0) return null;
  const maxReach = Math.max(...rows.map((row) => row.reach || 0), 1);
  return (
    <Secao
      divisoria
      titulo={username ? `Instagram @${username}` : "Instagram"}
      recolhidaDeInicio={recolhida}
      descricao={
        <span className="block truncate">
          Semana de {weekLabel(latest.week_start)} a {weekLabel(latest.week_end)}
          {semanaEmAndamento(latest) ? " (em andamento, números parciais)" : ""}
        </span>
      }
      ajuda="Números reais, direto da sua conta. Atualiza sozinho toda semana; a variação compara com a semana anterior."
    >
      <StatGrid cols={4} label="Instagram em números reais">
        {cards.map((card, i) => {
          // A série de cada número: as semanas que a tela já tem, da mais antiga à mais recente.
          const serie = rows.map((row) => Number((row as any)[card.campo])).filter((v) => isFinite(v)).reverse();
          return (
            <StatCard
              key={card.label}
              variant={i === 0 ? "ink" : i === 1 ? "accent" : "default"}
              size="xl"
              label={card.label}
              value={formatMetricNumber(card.value)}
              delta={card.delta != null ? Math.round(card.delta * 10) / 10 : undefined}
              chart={serie.length > 1 ? <Sparkline values={serie} tone={i < 2 ? "current" : i === 2 ? 2 : 1} height={40} /> : undefined}
            />
          );
        })}
      </StatGrid>
      {rows.length > 1 && (
        <CardSurface padded className="mt-4 sm:mt-5">
          <h3 className={texto.tituloSecao}>Alcance semana a semana</h3>
          <ul className="mt-4 space-y-3">
            {rows.slice(0, 8).map((row, i) => (
              <li key={row.id} className="flex min-w-0 items-center">
                <span className={juntar("mr-3 w-24 shrink-0 text-[12px] tabular-nums", i === 0 ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {weekLabel(row.week_start)} a {weekLabel(row.week_end)}
                </span>
                <span className="block min-w-0 flex-1">
                  <ProgressBar value={row.reach || 0} max={maxReach} height={12} tone={i === 0 ? 1 : 2} label={`Alcance de ${formatMetricNumber(row.reach)}`} />
                </span>
                <span className="ml-3 w-14 shrink-0 text-right text-[13px] font-semibold tabular-nums text-foreground">
                  {formatMetricNumber(row.reach)}
                </span>
              </li>
            ))}
          </ul>
        </CardSurface>
      )}
    </Secao>
  );
}

/** Atalhos da página: na linha do título (ícone no celular). */
const ATALHOS = [
  { label: "Aprovações", icon: FileCheck, to: "/aprovacoes" },
  { label: "Calendário", icon: CalendarDays, to: "/calendario" },
  { label: "Pedidos", icon: Inbox, to: "/pedidos" },
];

export default function ClientJourneyUpdates() {
  const navigate = useNavigate();
  const { clientId, isImpersonating } = useClientIdentity();
  // Mês aberto na linha de evolução: lembrado por cliente ao sair e voltar.
  const [expandedMonth, setExpandedMonth] = useEstadoDaTela<string | null>(`onde-estamos:mes-aberto:${clientId || ""}`, null, {
    validar: (v) => v === null || (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)),
  });
  const { profile } = useAuth();
  // Celular (16/10/2026, dono: "muito poluído"): o retrato de agora e as
  // atualizações da Aceleriq ficam abertos; os demais blocos nascem recolhidos
  // (só o título e uma linha), até a pessoa abrir. Do computador, nada muda.
  const pequena = useTelaPequena();
  // Staff sem "Ver como Cliente" nao tem jornada propria: sem esta trava, o
  // admin via os dados do proprio cadastro achando que eram de um cliente.
  const isStaff =
    profile?.role === "admin" ||
    ["design", "traffic", "manager"].includes(profile?.role || "");
  // O redirecionamento em si acontece DEPOIS de todos os hooks (lá embaixo):
  // um return antes do useQuery/useMemo mudava a ordem dos hooks entre um
  // render e outro (perfil chega, papel muda) e o React derrubava a tela.
  // Aqui só se decide; a consulta fica desligada enquanto for para sair.
  const deveRedirecionar = isStaff && !isImpersonating;

  // Um único retrato do momento, atualizado sozinho a cada 30 segundos.
  const { data: snapshot, isLoading, isError, refetch } = useQuery({
    queryKey: ["client-journey-live", clientId],
    queryFn: async () => {
      const [projects, tasks, milestones, approvals, allFiles, publications, reports] =
        await Promise.all([
          supabase
            .from("projects")
            .select("id, name, status, billing_mode, deadline, objectives, project_type, created_at")
            .eq("client_id", clientId!)
            .is("deleted_at", null),
          supabase
            .from("tasks")
            .select("project_id, title, status, due_date, deleted_at")
            .is("deleted_at", null),
          supabase
            .from("milestones")
            .select("project_id, title, status, target_date, updated_at")
            .is("deleted_at", null),
          supabase
            .from("files")
            .select("id, file_name, created_at")
            .eq("client_id", clientId!)
            .eq("visibility", "approval")
            .eq("approval_status", "pending")
            .eq("status", "ready")
            .is("archived_at", null)
            .is("parent_file_id", null),
          supabase
            .from("files")
            .select("id, created_at, approval_status, visibility")
            .eq("client_id", clientId!)
            .in("visibility", ["client_shared", "approval"])
            .eq("status", "ready")
            .is("archived_at", null)
            .is("parent_file_id", null)
            .limit(500),
          supabase
            .from("editorial_publications")
            .select("status, scheduled_at, published_at, permalink, platform")
            .eq("client_id", clientId!),
          supabase
            .from("reports")
            .select("id, title, summary, next_steps, metrics, created_at, period_start, period_end")
            .eq("client_id", clientId!)
            .eq("status", "published")
            .order("created_at", { ascending: false })
            .limit(40),
        ]);

      // Tarefas e marcos vem sem filtro de cliente no banco; recorta aqui
      // pelos projetos DESTE cliente. Sem isso, um admin abrindo a pagina
      // via o painel inteiro somado (609 entregas "em producao").
      const projectIds = new Set((projects.data || []).map((project) => project.id));
      return {
        projects: projects.data || [],
        tasks: (tasks.data || []).filter((task) => task.project_id && projectIds.has(task.project_id)),
        milestones: (milestones.data || []).filter(
          (milestone) => milestone.project_id && projectIds.has(milestone.project_id),
        ),
        approvals: approvals.data || [],
        allFiles: allFiles.data || [],
        publications: publications.data || [],
        // 19/10: nota interna publicada por engano (preparação do Hermes em 09/10) não aparece para o cliente.
        reports: semTextoInterno(reports.data || []),
      };
    },
    enabled: !!clientId && !deveRedirecionar,
    refetchInterval: 30_000,
  });

  const narrative = useMemo(() => {
    if (!snapshot) return null;
    return buildJourneyNarrative({
      projects: snapshot.projects as any[],
      tasks: snapshot.tasks as any[],
      milestones: snapshot.milestones as any[],
      pendingApprovals: snapshot.approvals.length,
      publications: snapshot.publications as any[],
    });
  }, [snapshot]);

  const rituals = useMemo(
    () => (snapshot?.reports || []).filter((r: any) => Boolean((r.metrics as any)?.ritual_type)),
    [snapshot],
  );

  const published = useMemo(
    () =>
      (snapshot?.publications || [])
        .filter((p: any) => p.status === "published" && p.published_at)
        .sort((a: any, b: any) => (b.published_at > a.published_at ? 1 : -1))
        .slice(0, 5),
    [snapshot],
  );

  const activeProjects = useMemo(
    () => (snapshot?.projects || []).filter((p: any) => (p.status || "active") !== "done"),
    [snapshot],
  );

  // v4 F2 (passada estrutural): o que vem depois do retrato fica em abas, no lugar de sete seções empilhadas.
  const [aba, setAba] = useEstadoDaTela("onde-estamos:aba", "andamento", {
    validar: (v) => v === "andamento" || v === "resultados" || v === "diario" || v === "atualizacoes",
  });

  // Todos os hooks já rodaram: agora sim o staff sem "Ver como Cliente" sai.
  if (deveRedirecionar) {
    return <Navigate to="/central" replace />;
  }

  const cabecalho = (
    <PageHeader
      title="Onde estamos"
      subtitle={narrative ? narrative.phase : undefined}
      help="O retrato do seu trabalho agora: o que já foi entregue, o que está em produção e qual é o próximo passo. Esta página se atualiza sozinha."
      actions={
        <>
          <button type="button" onClick={() => navigate(ATALHOS[0].to)} className={botao.primario} aria-label={ATALHOS[0].label}>
            <FileCheck className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">{ATALHOS[0].label}</span>
          </button>
          <OverflowMenu
            label="Mais atalhos"
            items={ATALHOS.slice(1).map((atalho) => ({ label: atalho.label, icon: <atalho.icon className="h-4 w-4" />, onSelect: () => navigate(atalho.to) }))}
          />
        </>
      }
    />
  );

  if (isLoading) {
    return (
      <div className={espaco.pagina}>
        {cabecalho}
        <Carregando forma="aba" rotulo="Carregando o retrato do trabalho" />
      </div>
    );
  }

  return (
    <div className={espaco.pagina}>
      {cabecalho}

      {isError && (
        <EstadoDeErro
          titulo="Não conseguimos carregar as informações agora."
          descricao={snapshot ? "Mostrando o último retrato carregado." : undefined}
          acao={<button type="button" className={botao.secundario} onClick={() => refetch()}>Tentar de novo</button>}
        />
      )}

      {/* ── Retrato automático do momento: o assunto da página ── */}
      {narrative && (
        <Secao titulo="Retrato de agora" corpoClassName="space-y-4 sm:space-y-5">
          <div className={juntar(espaco.grade, "grid-cols-1 lg:grid-cols-5")}>
            <CardSurface variant="ink" padded className="flex flex-col lg:col-span-3">
              <Legenda>Agora</Legenda>
              <p className="mt-3 max-w-3xl text-[24px] font-semibold leading-8 tracking-[-0.02em] text-foreground max-sm:text-[20px] max-sm:leading-7">{narrative.headline}</p>
              <div className="mt-4 hidden max-w-3xl space-y-2 sm:block">
                {narrative.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-[13px] leading-6 text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
              </div>
            </CardSurface>
            <CardSurface variant="accent" padded className="flex flex-col lg:col-span-2">
              <p className="flex items-center text-[13px] font-medium leading-5 text-muted-foreground">
                <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Próximo passo
              </p>
              <p className="mt-3 text-[18px] font-semibold leading-7 tracking-[-0.01em] text-foreground">{narrative.nextStep}</p>
            </CardSurface>
          </div>
          <StatGrid cols={4} label="Sinais do momento">
            {narrative.signals.map((signal) => {
              const signalTarget: Record<string, string> = {
                "Entregas concluídas no mês": "/documentos",
                "Em produção agora": "/projetos",
                "Publicações no ar": "/calendario",
                "Esperando você": "/aprovacoes",
              };
              const target = signalTarget[signal.label];
              return (
                <StatCard
                  key={signal.label}
                  size="xl"
                  label={
                    // Celular: o rótulo curto cabe inteiro no cartão de meia largura.
                    ROTULO_CURTO[signal.label] ? (
                      <>
                        <span className="sm:hidden">{ROTULO_CURTO[signal.label]}</span>
                        <span className="max-sm:hidden">{signal.label}</span>
                      </>
                    ) : signal.label
                  }
                  value={<span className={SIGNAL_TONE[signal.tone]}>{signal.value}</span>}
                  to={target || undefined}
                  corner={target ? <ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : undefined}
                />
              );
            })}
          </StatGrid>
        </Secao>
      )}

      <PillTabs
        label="Partes da página"
        value={aba}
        onChange={(v) => setAba(v)}
        tabs={[
          { value: "andamento", label: "Andamento" },
          { value: "resultados", label: "Resultados" },
          { value: "diario", label: "Diário" },
          ...(rituals.length > 0 ? [{ value: "atualizacoes", label: "Atualizações", count: rituals.length }] : []),
        ]}
      />

      {aba === "andamento" && (<>
      {/* ── O narrador do mês: a IA conta o mês com os fatos reais ── */}
      {clientId && <MonthNarrative clientId={clientId} recolhida={pequena} />}
      {clientId && <WeekBackstage clientId={clientId} recolhida={pequena} />}

      {/* ── Frentes ativas ── */}
      {activeProjects.length > 0 && (
        <Secao divisoria recolhidaDeInicio={pequena} titulo="Suas frentes" descricao={`${activeProjects.length} ${activeProjects.length === 1 ? "ativa" : "ativas"}`}>
          <ul className={juntar(espaco.grade, "grid-cols-1 lg:grid-cols-2")}>
            {activeProjects.map((project: any) => {
              const view = buildProgressView(project, (snapshot?.tasks || []) as any[]);
              // Contexto real: o que esta em producao nesta frente agora
              const doing = (snapshot?.tasks || [])
                .filter((task: any) => task.project_id === project.id &&
                  !["done", "completed", "concluido", "concluída"].includes((task.status || "").toLowerCase()))
                .slice(0, 3);
              return (
                <li key={project.id} className={juntar(superficie.painel, "min-w-0 p-5 sm:p-6")}>
                  <div className="flex min-w-0 items-center justify-between">
                    <p className="flex min-w-0 items-center text-[15px] font-semibold leading-5 text-foreground">
                      <span className="mr-2 min-w-0 truncate">{project.name}</span>
                      <Chip tone="accent">
                        {({ social_media: "Social", trafego: "Tráfego", site: "Site", automacao: "Automação", design: "Design", video: "Vídeo", seo: "SEO" } as Record<string, string>)[(project as any).project_type] || "Projeto"}
                      </Chip>
                    </p>
                    <span className="ml-3 shrink-0 text-[18px] font-semibold leading-6 tabular-nums text-foreground">
                      {view.mode === "percent" ? (view.percent > 0 ? `${view.percent}%` : "Em andamento") : view.label}
                    </span>
                  </div>
                  <div className="mt-4">
                    <ProgressBar value={cycleFillPercent(view)} max={100} height={10} tone={1} striped label={`${Math.round(cycleFillPercent(view))}% do caminho`} />
                  </div>
                  {view.mode === "cycle" && view.nextTitle && (
                    <p className={juntar(texto.auxiliar, "mt-3 flex items-center")}>
                      <Clock className="mr-1.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">A seguir: {view.nextTitle}</span>
                    </p>
                  )}
                  {doing.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {doing.map((task: any, index: number) => (
                        <li key={index} className={juntar(texto.auxiliar, "flex min-w-0 items-start")}>
                          <span className="mr-1.5 mt-[6px] h-1 w-1 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                          <span className="truncate">{task.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </Secao>
      )}

      {/* ── O que já foi ao ar ── */}
      {published.length > 0 && (
        <Secao divisoria recolhidaDeInicio={pequena} titulo="Já publicado" descricao={`${published.length} mais recentes`}>
          <ul className={juntar(superficie.painel, "min-w-0 divide-y divide-border/70 px-2 py-2 sm:px-3")}>
            {published.map((publication: any, index: number) => (
              <li key={`${publication.published_at}-${index}`} className="flex min-w-0 items-center px-3 py-3">
                <Bolha tom="sucesso" className="mr-3"><CheckCircle2 className="h-4 w-4" /></Bolha>
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  Publicado em{" "}
                  {new Date(publication.published_at).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                  })}
                </p>
                {publication.permalink && (
                  <a
                    href={publication.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className={juntar(botao.discreto, "h-8 text-primary")}
                  >
                    Ver <ExternalLink className="ml-1 h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {/* ── Instagram em números REAIS, coletados da Meta toda semana ── */}
      {clientId && <InstagramRealBlock clientId={clientId} recolhida={pequena} />}

      </>)}

      {aba === "resultados" && (<>
      {/* ── O case vivo: de onde saímos para onde chegamos ── */}
      {(() => {
        const projects = (snapshot?.projects || []) as any[];
        if (projects.length === 0) return null;
        const startDates = projects
          .map((project) => project.created_at)
          .filter(Boolean)
          .sort();
        const startedAt = startDates[0];
        if (!startedAt) return null;
        const started = new Date(startedAt);
        const monthsTogether = Math.max(
          1,
          Math.round((Date.now() - started.getTime()) / (30 * 24 * 60 * 60 * 1000)),
        );
        const materials = (snapshot?.allFiles || []).length;
        const postsLive = (snapshot?.publications || []).filter((p: any) => p.status === "published").length;
        const reportsCount = (snapshot?.reports || []).length;
        const series = buildGrowthSeries((snapshot?.reports || []) as any[]);
        const firstPoint = series[0];
        const lastPoint = series[series.length - 1];
        const contactsGrowth =
          firstPoint && lastPoint && firstPoint !== lastPoint && firstPoint.contacts > 0
            ? Math.round(((lastPoint.contacts - firstPoint.contacts) / firstPoint.contacts) * 100)
            : null;
        if (materials === 0 && postsLive === 0 && reportsCount === 0) return null;
        return (
          <Secao
            divisoria
            titulo="A sua história com a Aceleriq"
            recolhidaDeInicio={pequena}
            descricao={`${monthsTogether === 1 ? "No primeiro mês" : `Em ${monthsTogether} meses`} de trabalho, isto foi construído`}
          >
            <div className={juntar(espaco.grade, "grid-cols-1 lg:grid-cols-3")}>
              <CardSurface padded>
                <Legenda>
                  Quando começou · {started.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </Legenda>
                <ul className={juntar(texto.corpo, "mt-4 space-y-2 text-muted-foreground")}>
                  <li>Nenhum material produzido por aqui</li>
                  <li>Nenhuma publicação registrada</li>
                  <li>Sem medição de resultados</li>
                </ul>
              </CardSurface>
              <CardSurface variant="accent" padded className="lg:col-span-2">
                <p className="flex items-center text-[13px] font-medium leading-5 text-muted-foreground">
                  Hoje <ArrowUpRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </p>
                <ul className="mt-4 grid min-w-0 grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
                  {materials > 0 && (
                    <li className="min-w-0"><span className="block text-[40px] font-semibold leading-[44px] tracking-[-0.035em] tabular-nums text-foreground max-sm:text-[32px] max-sm:leading-10">{materials}</span><span className="mt-1 block text-[13px] leading-5 text-muted-foreground">materia(is) produzidos e entregues</span></li>
                  )}
                  {postsLive > 0 && (
                    <li className="min-w-0"><span className="block text-[40px] font-semibold leading-[44px] tracking-[-0.035em] tabular-nums text-foreground max-sm:text-[32px] max-sm:leading-10">{postsLive}</span><span className="mt-1 block text-[13px] leading-5 text-muted-foreground">publicação(ões) no ar</span></li>
                  )}
                  {reportsCount > 0 && (
                    <li className="min-w-0"><span className="block text-[40px] font-semibold leading-[44px] tracking-[-0.035em] tabular-nums text-foreground max-sm:text-[32px] max-sm:leading-10">{reportsCount}</span><span className="mt-1 block text-[13px] leading-5 text-muted-foreground">relatório(s) de resultado medidos</span></li>
                  )}
                </ul>
                {contactsGrowth !== null && contactsGrowth > 0 && (
                  <p className="mt-5 border-t border-border pt-4 text-[13px] leading-5 text-foreground">Contatos crescendo <span className="font-semibold">{contactsGrowth}%</span> entre o primeiro e o último período medido</p>
                )}
              </CardSurface>
            </div>
          </Secao>
        );
      })()}

      {/* ── Crescimento do negócio: contatos e alcance dos relatórios reais ── */}
      {(() => {
        const series = buildGrowthSeries((snapshot?.reports || []) as any[]);
        if (series.length < 2) return null;
        const totalSpend = series.reduce((sum, point) => sum + point.spend, 0);
        const totalContacts = series.reduce((sum, point) => sum + point.contacts, 0);
        const totalRevenue = series.reduce((sum, point) => sum + point.revenue, 0);
        const money = (value: number) =>
          new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
        return (
          <Secao
            divisoria
            titulo="Crescimento do seu negócio"
            recolhidaDeInicio={pequena}
            descricao={
              <span className="block truncate">
                {totalContacts > 0
                  ? `${totalContacts.toLocaleString("pt-BR")} pessoa(s) chegaram até vocês nos períodos medidos`
                  : "A resposta do público ao longo do tempo"}
                {totalSpend > 0 && ` · ${money(totalSpend)} investidos`}
                {totalRevenue > 0 && ` · ${money(totalRevenue)} em retorno`}
              </span>
            }
          >
            <CardSurface padded>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={series} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="contacts" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis yAxisId="reach" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12, color: "hsl(var(--foreground))" }}
                    itemStyle={{ color: "hsl(var(--foreground))" }}
                    labelStyle={{ color: "hsl(var(--primary))", fontSize: 10 }}
                    formatter={(value: any, name: string) => [Number(value).toLocaleString("pt-BR"), name === "contacts" ? "Contatos" : "Alcance"]}
                  />
                  <Bar yAxisId="contacts" dataKey="contacts" fill="hsl(var(--chart-1))" radius={[10, 10, 10, 10]} maxBarSize={36} isAnimationActive={false} />
                  <Line yAxisId="reach" type="monotone" dataKey="reach" stroke="hsl(var(--chart-2))" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap pt-3 text-[12px] text-muted-foreground [&>*]:mr-5">
                <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-chart-1" aria-hidden="true" /> Pessoas que chamaram vocês</span>
                <span className="flex items-center"><span className="mr-1.5 h-0.5 w-3 rounded bg-chart-2" aria-hidden="true" /> Pessoas alcançadas</span>
              </div>
            </CardSurface>
          </Secao>
        );
      })()}

      {/* ── Linha de evolução: do ponto A até hoje, mês a mês ── */}
      {(() => {
        const monthKey = (value: string) => value.slice(0, 7);
        const monthLabel = (key: string) =>
          new Date(`${key}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
        const buckets = new Map<string, { entregas: number; publicacoes: number; relatorios: number }>();
        const bump = (at: string | null | undefined, field: "entregas" | "publicacoes" | "relatorios") => {
          if (!at) return;
          const key = monthKey(at);
          const bucket = buckets.get(key) || { entregas: 0, publicacoes: 0, relatorios: 0 };
          bucket[field] += 1;
          buckets.set(key, bucket);
        };
        for (const file of (snapshot?.allFiles || []) as any[]) bump(file.created_at, "entregas");
        for (const publication of (snapshot?.publications || []) as any[]) {
          if (publication.status === "published") bump(publication.published_at, "publicacoes");
        }
        for (const report of (snapshot?.reports || []) as any[]) bump(report.created_at, "relatorios");
        const keys = Array.from(buckets.keys()).sort();
        if (keys.length === 0) return null;
        let running = 0;
        const rows = keys.map((key) => {
          const bucket = buckets.get(key)!;
          const total = bucket.entregas + bucket.publicacoes + bucket.relatorios;
          running += total;
          return { key, ...bucket, total, running };
        });
        const peak = Math.max(...rows.map((row) => row.total), 1);
        return (
          <Secao
            divisoria
            titulo="Sua evolução desde o início"
            recolhidaDeInicio={pequena}
            descricao={`${rows[rows.length - 1].running} movimento(s) de trabalho registrados`}
            ajuda="Do ponto de partida até hoje, mês a mês. Toque num mês para ver o que foi feito nele."
            acao={
              <div className="hidden text-[11px] text-muted-foreground sm:flex [&>*+*]:ml-3" aria-hidden="true">
                <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-primary" /> Entregas</span>
                <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-info" /> Publicações</span>
                <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-warning" /> Relatórios</span>
              </div>
            }
          >
            <ul className={juntar(superficie.painel, "min-w-0 divide-y divide-border/70 px-2 py-2 sm:px-3")}>
              {rows.map((row) => {
                const isOpen = expandedMonth === row.key;
                return (
                <li key={row.key} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setExpandedMonth(isOpen ? null : row.key)}
                    aria-expanded={isOpen}
                    className={juntar("flex w-full min-w-0 items-center rounded-lg px-3 py-3.5 text-left transition-colors", isOpen ? "bg-muted/60" : "hover:bg-muted/60", foco)}
                  >
                    <span className="mr-3 w-14 shrink-0 text-[13px] font-medium text-foreground">
                      {monthLabel(row.key)}
                    </span>
                    <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="flex h-full overflow-hidden rounded-full"
                        style={{ width: `${Math.max(6, (row.total / peak) * 100)}%` }}
                      >
                        {row.entregas > 0 && <span className="h-full bg-primary" style={{ flex: row.entregas }} />}
                        {row.publicacoes > 0 && <span className="h-full bg-info" style={{ flex: row.publicacoes }} />}
                        {row.relatorios > 0 && <span className="h-full bg-warning" style={{ flex: row.relatorios }} />}
                      </div>
                    </div>
                    <span className="ml-3 w-24 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                      <span className="text-[13px] font-semibold text-foreground">{row.total}</span> · total {row.running}
                    </span>
                    <ChevronDown className={juntar("ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                  </button>
                  {isOpen && (
                    <div className="mb-3 ml-[68px] mr-2 space-y-1.5 border-l-2 border-border pb-1 pl-4">
                      {/* Entregas com nome: o mês deixa de ser só um número. */}
                      {(snapshot?.allFiles || [])
                        .filter((file: any) => file.created_at?.startsWith(row.key))
                        .slice(0, 5)
                        .map((file: any) => (
                          <p key={file.id} className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
                            <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                            <span className="truncate">{file.file_name}</span>
                          </p>
                        ))}
                      {row.entregas > 5 && (
                        <p className={texto.auxiliar}>e mais {row.entregas - 5} material(is) neste mês</p>
                      )}
                      {/* Etapas do plano vencidas no mês. */}
                      {((snapshot?.milestones || []) as any[])
                        .filter((m: any) => m.status === "completed" && (m.updated_at || m.target_date || "").startsWith(row.key))
                        .slice(0, 4)
                        .map((m: any, index: number) => (
                          <p key={`ms-${index}`} className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
                            <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
                            <span className="truncate">Etapa concluída: {m.title}</span>
                          </p>
                        ))}
                      {(snapshot?.publications || [])
                        .filter((pub: any) => pub.status === "published" && pub.published_at && pub.published_at.startsWith(row.key))
                        .map((pub: any, index: number) => (
                          <p key={index} className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
                            <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-info" aria-hidden="true" />
                            Publicação no ar em {new Date(pub.published_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                            {pub.permalink && (
                              <a href={pub.permalink} target="_blank" rel="noreferrer" className="ml-1.5 text-primary hover:opacity-80">ver</a>
                            )}
                          </p>
                        ))}
                      {(snapshot?.reports || [])
                        .filter((report: any) => report.created_at?.startsWith(row.key))
                        .map((report: any) => (
                          <button
                            key={report.id}
                            type="button"
                            onClick={() => navigate(`/relatorios/${report.id}`)}
                            className={juntar(texto.auxiliar, "flex min-w-0 items-center rounded text-left hover:text-foreground", foco)}
                          >
                            <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                            <span className="truncate">{report.title}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
            <div className="mt-2 flex flex-wrap text-[11px] text-muted-foreground sm:hidden [&>*]:mr-3">
              <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden="true" /> Entregas</span>
              <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-info" aria-hidden="true" /> Publicações</span>
              <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-warning" aria-hidden="true" /> Relatórios</span>
            </div>
          </Secao>
        );
      })()}

      </>)}

      {aba === "diario" && (<>
      {/* ── A história da parceria, capítulo a capítulo ── */}
      {clientId && <ClientHistory clientId={clientId} recolhida={pequena} />}

      {/* ── Diário do trabalho: cada movimento, na hora ── */}
      {clientId && (
        <ProjectJournal clientId={clientId} canWrite={false} />
      )}

      </>)}

      {aba === "atualizacoes" && (<>
      {/* ── Atualizações escritas pela Aceleriq ── */}
      {rituals.length > 0 && (
        <Secao divisoria titulo="Atualizações da Aceleriq" descricao={`${rituals.length} ${rituals.length === 1 ? "atualização" : "atualizações"}`}>
          <ul className="min-w-0 space-y-4 sm:space-y-5">
          {rituals.map((update: any, index: number) => {
            const ritualType = (update.metrics as any)?.ritual_type as string;
            const badge: { label: string; tone: Tone } = RITUAL_LABELS[ritualType] || {
              label: "Atualização",
              tone: "neutral",
            };
            const isLatest = index === 0;
            return (
              <li key={update.id} className="min-w-0">
              <article className={juntar(superficie.painel, "min-w-0 p-5 sm:p-6", isLatest && "ring-2 ring-primary/50")}>
                <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-2">
                  <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
                  {isLatest && <Chip className="bg-accent-solid text-on-accent">Mais recente</Chip>}
                  <span className={juntar(texto.auxiliar, "ml-auto")}>
                    {new Date(update.created_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                    })}
                  </span>
                </div>
                <h3 className="mt-2 text-[18px] font-semibold leading-6 tracking-[-0.02em] text-foreground">{update.title}</h3>
                {/* A mesma mensagem do grupo, mas do jeito do painel: secoes
                    com titulo, listas de verdade, sem asteriscos; a mais
                    recente inteira, as antigas resumidas sem frase cortada. */}
                {update.summary && estruturaDoRitual(update.summary).blocos.length > 0 ? (
                  <RitualEstruturado body={update.summary} nextSteps={update.next_steps} compact={!isLatest} className="mt-3" />
                ) : (
                  <>
                    {update.summary && (
                      <div className={juntar(texto.corpo, "mt-3 whitespace-pre-line text-muted-foreground", isLatest ? "" : "line-clamp-6")}>
                        {update.summary}
                      </div>
                    )}
                    {update.next_steps && (
                      <div className="mt-4 rounded-md bg-accent-soft px-4 py-3">
                        <p className={juntar(texto.rotulo, "text-primary")}>Próximo passo</p>
                        <p className={juntar(texto.corpo, "mt-1 whitespace-pre-line")}>{update.next_steps}</p>
                      </div>
                    )}
                  </>
                )}
                {!isLatest && (
                  <button
                    type="button"
                    onClick={() => navigate(`/relatorios/${update.id}`)}
                    className={juntar(botao.discreto, "-ml-2.5 mt-2 h-8 text-primary")}
                  >
                    Ver completa <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </article>
              </li>
            );
          })}
          </ul>
        </Secao>
      )}
      </>)}
    </div>
  );
}
