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
  TrendingDown, TrendingUp,
} from "lucide-react";
import { buildJourneyNarrative } from "@/lib/clientJourneyNarrative";
import { readMemory } from "@/lib/clientMemory";
import RitualEstruturado from "@/components/client/RitualEstruturado";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
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
import {
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  Secao,
  botao,
  etiqueta,
  foco,
  juntar,
  lista,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";

/**
 * O narrador do mês: a IA escreve 3 a 5 frases contando o mês do cliente a
 * partir da linha do tempo real do painel. Cache local de 24 horas por
 * cliente e mês, para a página abrir na hora e a IA não rodar a cada visita.
 * Sem movimento no mês ou com o narrador indisponível, o bloco simplesmente
 * não aparece: nunca um erro na cara do cliente.
 */
function MonthNarrative({ clientId }: { clientId: string }) {
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
      ajuda="Contado pela Aceleriq a partir do que aconteceu de verdade no seu painel neste mês."
    >
      <p className={juntar(texto.corpo, "max-w-3xl leading-6 text-foreground/90")}>{data.narrative}</p>
    </Secao>
  );
}

/**
 * Bastidores da semana: o trabalho que acontece antes de qualquer post ir ao
 * ar. Vem do checklist que a equipe fecha toda semana, traduzido para a
 * linguagem do cliente. Sem movimento na semana, o bloco não aparece: o
 * cliente nunca vê uma caixa vazia dizendo que nada foi feito.
 */
function WeekBackstage({ clientId }: { clientId: string }) {
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
      descricao={`${data.total} ${data.total === 1 ? "etapa concluída" : "etapas concluídas"}`}
      ajuda="Este é o trabalho de bastidor da semana, atualizado conforme a equipe avança. O que chega até você, como conteúdo e publicações, nasce daqui."
    >
      <ul className={juntar(lista.aberta, lista.divisoria)}>
        {data.fronts.map((front) => (
          <li key={front.area} className="min-w-0 px-2 py-3">
            <div className="flex min-w-0 items-center justify-between">
              <p className="min-w-0 truncate text-[13px] font-medium text-foreground">{front.label}</p>
              <p className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>
                {front.done} de {front.total}
              </p>
            </div>
            {/* Segmentos com margem (sem gap em flex: Safari 11). */}
            <div className="mt-1.5 flex h-1.5" aria-hidden="true">
              {Array.from({ length: front.total }, (_, index) => (
                <span
                  key={index}
                  className={juntar("flex-1 rounded-full", index > 0 && "ml-[3px]", index < front.done ? "bg-primary" : "bg-muted")}
                />
              ))}
            </div>
            <p className={juntar(texto.auxiliar, "mt-1.5 leading-5")}>
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
function ClientHistory({ clientId }: { clientId: string }) {
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
      descricao={`${entries.length} ${entries.length === 1 ? "capítulo" : "capítulos"}`}
      ajuda="Cada capítulo fica guardado aqui: o que foi combinado, o que foi feito e o porquê. Assim nada se perde entre uma conversa e outra."
    >
      <ol className="ml-1 space-y-4 border-l border-border pl-4">
        {entries.map((entry) => (
          <li key={entry.id} className="relative min-w-0">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" aria-hidden="true" />
            <p className={texto.auxiliar}>
              {new Date(entry.created_at).toLocaleDateString("pt-BR", {
                day: "2-digit", month: "long", year: "numeric",
              })}
            </p>
            {entry.title && (
              <p className="mt-0.5 text-[14px] font-medium leading-5 text-foreground">
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

const RITUAL_LABELS: Record<string, { label: string; cls: string }> = {
  rota_semana: { label: "Rota da Semana", cls: "bg-primary/10 text-primary" },
  meio_semana: { label: "Check do Meio da Semana", cls: "bg-sky-500/10 text-sky-500" },
  prova_movimento: { label: "Prova de Movimento", cls: "bg-emerald-500/10 text-emerald-500" },
  radar_aceleriq: { label: "Radar Aceleriq", cls: "bg-info/10 text-info" },
  marco_90: { label: "Marco 90", cls: "bg-amber-500/10 text-amber-500" },
};

const SIGNAL_TONE: Record<string, string> = {
  good: "text-emerald-500",
  attention: "text-amber-500",
  neutral: "text-foreground",
};

/**
 * Instagram em números reais: a última semana fechada coletada da Meta, com a
 * variação contra a semana anterior e o histórico de alcance. Sem dados (conta
 * ainda não conectada ou primeira coleta pendente), o bloco não aparece.
 */
function InstagramRealBlock({ clientId }: { clientId: string }) {
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
        />
      ))}
    </>
  );
}

function InstagramContaBlock({
  rows,
  username,
}: {
  rows: SocialMetricsWeek[];
  username: string | null;
}) {
  const latest = rows[0];
  const weekLabel = (value: string) => {
    const [, month, day] = value.split("-");
    return `${day}/${month}`;
  };
  const cards = [
    { label: "Seguidores", value: latest.followers, delta: weekDeltaPct(rows, "followers") },
    { label: "Alcance na semana", value: latest.reach, delta: weekDeltaPct(rows, "reach") },
    { label: "Interações", value: latest.total_interactions, delta: weekDeltaPct(rows, "total_interactions") },
    { label: "Visitas ao perfil", value: latest.profile_views, delta: weekDeltaPct(rows, "profile_views") },
  ].filter((card) => card.value != null);
  if (cards.length === 0) return null;
  const maxReach = Math.max(...rows.map((row) => row.reach || 0), 1);
  return (
    <Secao
      divisoria
      titulo={username ? `Instagram @${username}` : "Instagram"}
      descricao={
        <span className="block truncate">
          Semana de {weekLabel(latest.week_start)} a {weekLabel(latest.week_end)}
          {semanaEmAndamento(latest) ? " (em andamento, números parciais)" : ""}
        </span>
      }
      ajuda="Números reais, direto da sua conta. Atualiza sozinho toda semana; a variação compara com a semana anterior."
    >
      <FaixaDeNumeros
        rotulo="Instagram em números reais"
        itens={cards.map((card) => {
          const up = card.delta != null && card.delta >= 0;
          return {
            rotulo: card.label,
            valor: formatMetricNumber(card.value),
            aoLado:
              card.delta != null ? (
                <span className={juntar(etiqueta, up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                  {up ? <TrendingUp className="mr-0.5 h-3 w-3" aria-hidden="true" /> : <TrendingDown className="mr-0.5 h-3 w-3" aria-hidden="true" />}
                  {`${up ? "+" : ""}${card.delta.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                </span>
              ) : undefined,
          };
        })}
      />
      {rows.length > 1 && (
        <div className="mt-4">
          <h3 className={texto.rotulo}>Alcance semana a semana</h3>
          <ul className="mt-2 space-y-1.5">
            {rows.slice(0, 8).map((row) => (
              <li key={row.id} className="flex min-w-0 items-center">
                <span className="mr-2 w-24 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {weekLabel(row.week_start)} a {weekLabel(row.week_end)}
                </span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.max(((row.reach || 0) / maxReach) * 100, 2)}%` }}
                  />
                </div>
                <span className="ml-2 w-14 shrink-0 text-right text-[11px] tabular-nums text-foreground">
                  {formatMetricNumber(row.reach)}
                </span>
              </li>
            ))}
          </ul>
        </div>
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
        reports: reports.data || [],
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

  // Todos os hooks já rodaram: agora sim o staff sem "Ver como Cliente" sai.
  if (deveRedirecionar) {
    return <Navigate to="/central" replace />;
  }

  const cabecalho = (
    <CabecalhoDePagina
      titulo="Onde estamos"
      descricao={narrative ? narrative.phase : undefined}
      ajuda="O retrato do seu trabalho agora: o que já foi entregue, o que está em produção e qual é o próximo passo. Esta página se atualiza sozinha."
      acoes={ATALHOS.map((atalho) => (
        <button
          key={atalho.to}
          type="button"
          onClick={() => navigate(atalho.to)}
          className={juntar(botao.secundario, "px-2.5 sm:px-3.5")}
          aria-label={atalho.label}
          title={atalho.label}
        >
          <atalho.icon className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
          <span className="hidden sm:inline">{atalho.label}</span>
        </button>
      ))}
    />
  );

  if (isLoading) {
    return (
      <div className="min-w-0 space-y-5">
        {cabecalho}
        <Carregando forma="aba" rotulo="Carregando o retrato do trabalho" />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
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
        <Secao titulo="Retrato de agora" corpoClassName="space-y-4">
          <p className={juntar(texto.tituloSecao, "max-w-3xl")}>{narrative.headline}</p>
          <FaixaDeNumeros
            rotulo="Sinais do momento"
            itens={narrative.signals.map((signal) => {
              const signalTarget: Record<string, string> = {
                "Entregas concluídas no mês": "/documentos",
                "Em produção agora": "/projetos",
                "Publicações no ar": "/calendario",
                "Esperando você": "/aprovacoes",
              };
              const target = signalTarget[signal.label];
              return {
                rotulo: signal.label,
                valor: signal.value,
                corDoValor: SIGNAL_TONE[signal.tone],
                para: target || undefined,
              };
            })}
          />
          <div className="max-w-3xl space-y-2">
            {narrative.paragraphs.map((paragraph) => (
              <p key={paragraph} className={juntar(texto.corpo, "leading-6")}>
                {paragraph}
              </p>
            ))}
          </div>
          <div className="max-w-3xl border-l-2 border-emerald-500/60 pl-3">
            <p className={juntar(texto.rotulo, "flex items-center text-emerald-500")}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Próximo passo
            </p>
            <p className={juntar(texto.corpo, "mt-1 leading-6")}>{narrative.nextStep}</p>
          </div>
        </Secao>
      )}

      {/* ── O narrador do mês: a IA conta o mês com os fatos reais ── */}
      {clientId && <MonthNarrative clientId={clientId} />}
      {clientId && <WeekBackstage clientId={clientId} />}

      {/* ── Frentes ativas ── */}
      {activeProjects.length > 0 && (
        <Secao divisoria titulo="Suas frentes" descricao={`${activeProjects.length} ${activeProjects.length === 1 ? "ativa" : "ativas"}`}>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {activeProjects.map((project: any) => {
              const view = buildProgressView(project, (snapshot?.tasks || []) as any[]);
              // Contexto real: o que esta em producao nesta frente agora
              const doing = (snapshot?.tasks || [])
                .filter((task: any) => task.project_id === project.id &&
                  !["done", "completed", "concluido", "concluída"].includes((task.status || "").toLowerCase()))
                .slice(0, 3);
              return (
                <li key={project.id} className="min-w-0 px-2 py-3">
                  <div className="flex min-w-0 items-center justify-between">
                    <p className="flex min-w-0 items-center text-[14px] font-medium text-foreground">
                      <span className="mr-2 min-w-0 truncate">{project.name}</span>
                      <span className={juntar(etiqueta, "bg-primary/10 text-primary")}>
                        {({ social_media: "Social", trafego: "Tráfego", site: "Site", automacao: "Automação", design: "Design", video: "Vídeo", seo: "SEO" } as Record<string, string>)[(project as any).project_type] || "Projeto"}
                      </span>
                    </p>
                    <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>
                      {view.mode === "percent" ? (view.percent > 0 ? `${view.percent}%` : "Em andamento") : view.label}
                    </span>
                  </div>
                  <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${cycleFillPercent(view)}%` }}
                    />
                  </div>
                  {view.mode === "cycle" && view.nextTitle && (
                    <p className={juntar(texto.auxiliar, "mt-2 flex items-center")}>
                      <Clock className="mr-1.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">A seguir: {view.nextTitle}</span>
                    </p>
                  )}
                  {doing.length > 0 && (
                    <ul className="mt-2 space-y-1">
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
        <Secao divisoria titulo="Já publicado" descricao={`${published.length} mais recentes`}>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {published.map((publication: any, index: number) => (
              <li key={`${publication.published_at}-${index}`} className="flex min-w-0 items-center px-2 py-2.5">
                <CheckCircle2 className="mr-3 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <p className="min-w-0 flex-1 truncate text-[13px] text-foreground">
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
      {clientId && <InstagramRealBlock clientId={clientId} />}

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
            descricao={`${monthsTogether === 1 ? "No primeiro mês" : `Em ${monthsTogether} meses`} de trabalho, isto foi construído`}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2">
              <div className="min-w-0 pb-4 sm:pb-0 sm:pr-5">
                <p className={texto.rotulo}>
                  Quando começou · {started.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </p>
                <ul className={juntar(texto.corpo, "mt-2 space-y-1 text-muted-foreground")}>
                  <li>Nenhum material produzido por aqui</li>
                  <li>Nenhuma publicação registrada</li>
                  <li>Sem medição de resultados</li>
                </ul>
              </div>
              <div className="min-w-0 border-t border-border pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                <p className={juntar(texto.rotulo, "flex items-center text-primary")}>
                  Hoje <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                </p>
                <ul className={juntar(texto.corpo, "mt-2 space-y-1")}>
                  {materials > 0 && (
                    <li><span className="font-semibold tabular-nums text-primary">{materials}</span> materia(is) produzidos e entregues</li>
                  )}
                  {postsLive > 0 && (
                    <li><span className="font-semibold tabular-nums text-sky-500">{postsLive}</span> publicação(ões) no ar</li>
                  )}
                  {reportsCount > 0 && (
                    <li><span className="font-semibold tabular-nums text-amber-500">{reportsCount}</span> relatório(s) de resultado medidos</li>
                  )}
                  {contactsGrowth !== null && contactsGrowth > 0 && (
                    <li>Contatos crescendo <span className="font-semibold text-emerald-500">{contactsGrowth}%</span> entre o primeiro e o último período medido</li>
                  )}
                </ul>
              </div>
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
            <div className="min-w-0">
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={series} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="contacts" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis yAxisId="reach" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))" }}
                    itemStyle={{ color: "hsl(var(--foreground))" }}
                    labelStyle={{ color: "hsl(var(--primary))", fontSize: 10 }}
                    formatter={(value: any, name: string) => [Number(value).toLocaleString("pt-BR"), name === "contacts" ? "Contatos" : "Alcance"]}
                  />
                  <Bar yAxisId="contacts" dataKey="contacts" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  <Line yAxisId="reach" type="monotone" dataKey="reach" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap px-3 pt-1 text-[11px] text-muted-foreground [&>*]:mr-4">
                <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-sm bg-primary" aria-hidden="true" /> Pessoas que chamaram vocês</span>
                <span className="flex items-center"><span className="mr-1.5 h-0.5 w-3 rounded bg-sky-500" aria-hidden="true" /> Pessoas alcançadas</span>
              </div>
            </div>
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
            descricao={`${rows[rows.length - 1].running} movimento(s) de trabalho registrados`}
            ajuda="Do ponto de partida até hoje, mês a mês. Toque num mês para ver o que foi feito nele."
            acao={
              <div className="hidden text-[11px] text-muted-foreground sm:flex [&>*+*]:ml-3" aria-hidden="true">
                <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-primary" /> Entregas</span>
                <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-sky-500" /> Publicações</span>
                <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-amber-500" /> Relatórios</span>
              </div>
            }
          >
            <ul className={juntar(lista.aberta, lista.divisoria)}>
              {rows.map((row) => {
                const isOpen = expandedMonth === row.key;
                return (
                <li key={row.key} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setExpandedMonth(isOpen ? null : row.key)}
                    aria-expanded={isOpen}
                    className={juntar("flex w-full min-w-0 items-center rounded-lg px-2 py-2.5 text-left transition-colors", isOpen ? "bg-muted/40" : "hover:bg-muted/30", foco)}
                  >
                    <span className="mr-3 w-14 shrink-0 text-[12px] font-medium text-muted-foreground">
                      {monthLabel(row.key)}
                    </span>
                    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="flex h-full overflow-hidden rounded-full"
                        style={{ width: `${Math.max(6, (row.total / peak) * 100)}%` }}
                      >
                        {row.entregas > 0 && <span className="h-full bg-primary" style={{ flex: row.entregas }} />}
                        {row.publicacoes > 0 && <span className="h-full bg-sky-500" style={{ flex: row.publicacoes }} />}
                        {row.relatorios > 0 && <span className="h-full bg-amber-500" style={{ flex: row.relatorios }} />}
                      </div>
                    </div>
                    <span className="ml-3 w-20 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {row.total} · total {row.running}
                    </span>
                    <ChevronDown className={juntar("ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                  </button>
                  {isOpen && (
                    <div className="mb-2 ml-[64px] mr-2 space-y-1 border-l border-border pb-1 pl-3">
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
                            <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                            <span className="truncate">Etapa concluída: {m.title}</span>
                          </p>
                        ))}
                      {(snapshot?.publications || [])
                        .filter((pub: any) => pub.status === "published" && pub.published_at && pub.published_at.startsWith(row.key))
                        .map((pub: any, index: number) => (
                          <p key={index} className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
                            <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden="true" />
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
                            <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
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
              <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-sky-500" aria-hidden="true" /> Publicações</span>
              <span className="flex items-center"><span className="mr-1.5 h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" /> Relatórios</span>
            </div>
          </Secao>
        );
      })()}

      {/* ── A história da parceria, capítulo a capítulo ── */}
      {clientId && <ClientHistory clientId={clientId} />}

      {/* ── Diário do trabalho: cada movimento, na hora ── */}
      {clientId && (
        <div className="border-t border-border pt-5">
          <ProjectJournal clientId={clientId} canWrite={false} />
        </div>
      )}

      {/* ── Atualizações escritas pela Aceleriq ── */}
      {rituals.length > 0 && (
        <Secao divisoria titulo="Atualizações da Aceleriq" descricao={`${rituals.length} ${rituals.length === 1 ? "atualização" : "atualizações"}`}>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
          {rituals.map((update: any, index: number) => {
            const ritualType = (update.metrics as any)?.ritual_type as string;
            const badge = RITUAL_LABELS[ritualType] || {
              label: "Atualização",
              cls: "bg-muted text-muted-foreground",
            };
            const isLatest = index === 0;
            return (
              <li key={update.id} className="min-w-0">
              <article className={juntar("min-w-0 px-2 py-4", isLatest && "border-l-2 border-primary pl-3")}>
                <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-2">
                  <span className={juntar(etiqueta, badge.cls)}>{badge.label}</span>
                  {isLatest && <span className={juntar(etiqueta, "bg-primary text-primary-foreground")}>Mais recente</span>}
                  <span className={juntar(texto.auxiliar, "ml-auto")}>
                    {new Date(update.created_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                    })}
                  </span>
                </div>
                <h3 className="mt-1 text-[14px] font-semibold leading-5 text-foreground">{update.title}</h3>
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
                      <div className="mt-3 border-l-2 border-primary/60 pl-3">
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
    </div>
  );
}
