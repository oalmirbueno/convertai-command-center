import { useState } from "react";
import { useProjects, useTasks } from "@/hooks/useSupabaseData";
import { buildProgressView, cycleFillPercent } from "@/lib/projectProgress";
import { useAuth } from "@/contexts/AuthContext";
import { dataDoPortal } from "@/lib/clientes/cobrancaDoPortal";
import { Plus, MoreHorizontal, Clock, Sparkles, FolderOpen, ListFilter } from "lucide-react";
import CreateProjectModal from "@/components/admin/CreateProjectModal";
import ProjectDrawer from "@/components/admin/ProjectDrawer";
import MeetingToProjectModal from "@/components/admin/MeetingToProjectModal";
import ProjectView from "@/components/client/ProjectView";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  Carregando,
  EstadoVazio,
  RegiaoRolavel,
  SeletorCompacto,
  botao,
  foco,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import { Avatar, Chip, Donut, ProgressBar, StatCard, StatGrid, StatusPill, type Tone } from "@/components/ds";

const STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "planning", label: "Planejamento" },
  { value: "active", label: "Ativo" },
  { value: "review", label: "Revisão" },
  { value: "paused", label: "Pausado" },
  { value: "done", label: "Concluído" },
];

// Sem pulse-dot: nada piscando na tela parada.
const statusDotColors: Record<string, string> = {
  active: "bg-info",
  review: "bg-warning",
  planning: "bg-muted-foreground",
  paused: "bg-muted-foreground",
  done: "bg-success",
};

const statusTone: Record<string, Tone> = { active: "info", review: "warning", planning: "neutral", paused: "neutral", done: "success" };

const statusLabels: Record<string, string> = {
  planning: "Planejamento", active: "Ativo", review: "Revisão", paused: "Pausado", done: "Concluído",
};

export default function Projects() {
  const { profile } = useAuth();
  const { data: projects, isLoading } = useProjects();
  const { data: tasks } = useTasks();
  const isAdmin = profile?.role === "admin";
  const isClient = profile?.role === "client";

  // Filtro lembrado ao sair e voltar (docs/design/SISTEMA.md, "Estado que não se perde").
  const [filter, setFilter] = useEstadoDaTela("filtro:status", "all", {
    validar: (v) => STATUS_OPTIONS.some((s) => s.value === v),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [editProject, setEditProject] = useState<any>(null);
  const [drawerProject, setDrawerProject] = useState<any>(null);
  const [clientProject, setClientProject] = useState<any>(null);

  const visiveis = (projects || []).filter((p: any) => !(isClient && p.client_id !== profile?.id));
  const filtered = visiveis.filter((p: any) => filter === "all" || p.status === filter);
  const contagem = (valor: string) => (valor === "all" ? visiveis.length : visiveis.filter((p: any) => p.status === valor).length);

  // `deadline` é DATE: `new Date("2026-11-10")` é 09/11 às 21h em São Paulo e a tela mostrava o dia anterior.
  const formatDate = (d: string) => dataDoPortal(d);

  if (isClient && clientProject) {
    return <ProjectView project={clientProject} onBack={() => setClientProject(null)} />;
  }

  const abrir = (p: any) => {
    if (isClient) setClientProject(p);
    else if (isAdmin) setDrawerProject(p);
  };
  const clicavel = isClient || isAdmin;

  return (
    <div className="min-w-0">
      <CabecalhoDePagina
        titulo="Projetos"
        ajuda={isClient ? "Seus projetos com a Aceleriq. Toque num projeto para ver o andamento." : "Todos os projetos da agência, com status, andamento e prazo. Clique num projeto para abrir o detalhe."}
        descricao={isLoading ? "\u00a0" : `${filtered.length} ${filtered.length === 1 ? "projeto" : "projetos"}`}
        acoes={
          <>
            <SeletorCompacto
              rotulo="Status"
              icone={<ListFilter className="h-3.5 w-3.5" />}
              opcoes={STATUS_OPTIONS.map((s) => ({ valor: s.value, rotulo: s.label, contador: isLoading ? null : contagem(s.value) }))}
              valor={filter}
              onEscolher={setFilter}
            />
            {isAdmin && (
              <button type="button" onClick={() => setMeetingModalOpen(true)} className={botao.secundario} aria-label="Gerar projeto pela ata">
                <Sparkles className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Gerar via ata</span>
              </button>
            )}
            {isAdmin && (
              <button type="button" onClick={() => setCreateOpen(true)} data-tour="projects-create-btn" className={botao.primario} aria-label="Novo projeto">
                <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Novo projeto</span>
              </button>
            )}
          </>
        }
      />

      {/* A lista rola sozinha de 1024 px para cima e lembra onde estava. */}
      <AreaDeTrabalho className="mt-6 sm:mt-8" rotuloDoPrincipal="Lista de projetos" memoriaDaRolagem="projetos:lista">
        {!isLoading && visiveis.length > 0 && (
          <StatGrid cols={4} className="mb-5 sm:mb-6" label="Projetos em números">
            <StatCard
              variant="ink"
              label="Projetos"
              value={visiveis.length}
              hint={filter !== "all" ? `${filtered.length} neste filtro` : "na carteira"}
              chartPosition="side"
              chart={
                <span className="flex justify-end max-sm:hidden">
                  <Donut
                    size={72}
                    thickness={10}
                    segments={STATUS_OPTIONS.filter((s) => s.value !== "all").map((s, i) => ({ label: s.label, value: contagem(s.value), tone: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5 }))}
                  />
                </span>
              }
              onClick={() => setFilter("all")}
            />
            <StatCard
              variant="accent"
              label="Ativos"
              value={contagem("active")}
              hint={`de ${visiveis.length}`}
              chart={<ProgressBar value={contagem("active")} max={visiveis.length} tone="current" />}
              onClick={() => setFilter("active")}
            />
            <StatCard label="Em revisão" value={contagem("review")} hint={`${contagem("planning")} em planejamento`} onClick={() => setFilter("review")} />
            <StatCard
              label="Concluídos"
              value={contagem("done")}
              hint={`${contagem("paused")} ${contagem("paused") === 1 ? "pausado" : "pausados"}`}
              chart={<ProgressBar value={contagem("done")} max={visiveis.length} striped />}
              onClick={() => setFilter("done")}
            />
          </StatGrid>
        )}
        {isLoading ? (
          <Carregando rotulo="Carregando projetos" linhas={6} />
        ) : filtered.length === 0 ? (
          <EstadoVazio
            icone={<FolderOpen className="h-5 w-5" />}
            titulo="Nenhum projeto encontrado."
            descricao={filter !== "all" ? "Nenhum projeto com este status." : undefined}
            acao={
              filter !== "all" ? (
                <button type="button" onClick={() => setFilter("all")} className={botao.secundario}>Ver todos</button>
              ) : isAdmin ? (
                <button type="button" onClick={() => setCreateOpen(true)} className={botao.primario}>Novo projeto</button>
              ) : undefined
            }
          />
        ) : (
          <ul aria-label="Projetos" data-tour="projects-list" className={juntar(superficie.painel, "space-y-0.5 overflow-hidden px-2 py-2 sm:px-3")}>
            {filtered.map((p: any) => {
              // Recorrente nao tem "80% pronto": mostra o ritmo do ciclo.
              const view = buildProgressView(p, (tasks || []) as any[]);
              return (
                <li key={p.id} className="min-w-0">
                  <div
                    role={clicavel ? "button" : undefined}
                    tabIndex={clicavel ? 0 : undefined}
                    aria-label={clicavel ? `Abrir projeto ${p.name}` : undefined}
                    onClick={() => abrir(p)}
                    onKeyDown={(event) => {
                      if (!clicavel || event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        abrir(p);
                      }
                    }}
                    className={juntar("flex min-w-0 items-center rounded-md px-3 py-4 transition-colors sm:px-4", clicavel && "cursor-pointer hover:bg-muted/60", clicavel && foco)}
                  >
                    <span className="relative mr-3 shrink-0 sm:mr-4">
                      <Avatar name={p.client?.company_name || p.client?.full_name || p.name} size="md" square />
                      <span aria-hidden="true" className={juntar("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card sm:hidden", statusDotColors[p.status] || "bg-muted-foreground")} />
                    </span>
                    <div className="mr-3 min-w-0 flex-1">
                      <div className="flex min-w-0 items-center">
                        <span className="min-w-0 truncate text-[15px] font-semibold leading-5 tracking-[-0.01em] text-foreground">{p.name}</span>
                        {p.project_type && (
                          <Chip className="ml-2 hidden capitalize text-muted-foreground sm:inline-flex">{p.project_type.replace("_", " ")}</Chip>
                        )}
                      </div>
                      <p className={juntar(texto.auxiliar, "mt-1 truncate")}>
                        {p.client?.company_name || p.client?.full_name}
                        {/* O status já aparece na pílula de 1024 px para cima: aqui só quando ela some. */}
                        {statusLabels[p.status] && <span className="lg:hidden">{p.client?.company_name || p.client?.full_name ? " · " : ""}{statusLabels[p.status]}</span>}
                      </p>
                    </div>
                    {view.mode === "percent" && <span className="mr-1 shrink-0 text-[13px] font-semibold tabular-nums text-foreground md:hidden" aria-hidden="true">{view.percent}%</span>}
                    <div className="mr-4 hidden w-40 shrink-0 md:block">
                      <p className="mb-1.5 truncate text-right text-[13px] font-semibold tabular-nums text-foreground">
                        {view.mode === "percent" ? `${view.percent}%` : view.label}
                      </p>
                      <ProgressBar value={cycleFillPercent(view)} max={100} height={6} label={view.mode === "percent" ? `${view.percent}% pronto` : view.label} />
                    </div>
                    {statusLabels[p.status] && <StatusPill tone={statusTone[p.status] || "neutral"} className="mr-4 hidden w-[116px] justify-start lg:inline-flex">{statusLabels[p.status]}</StatusPill>}
                    {p.deadline && (
                      <span className={juntar(texto.auxiliar, "hidden shrink-0 items-center tabular-nums sm:flex", isAdmin && "mr-2")}>
                        <Clock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        {formatDate(p.deadline)}
                      </span>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        aria-label={`Ações do projeto ${p.name}`}
                        onClick={(e) => { e.stopPropagation(); setDrawerProject(p); }}
                        onKeyDown={(e) => e.stopPropagation()}
                        className={botao.icone}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AreaDeTrabalho>

      <CreateProjectModal open={createOpen || !!editProject} onClose={() => { setCreateOpen(false); setEditProject(null); }} editProject={editProject} />
      <MeetingToProjectModal open={meetingModalOpen} onClose={() => setMeetingModalOpen(false)} />

      {isAdmin && (
        <ProjectDrawer
          project={drawerProject}
          open={!!drawerProject}
          onClose={() => setDrawerProject(null)}
          onEdit={(p) => { setDrawerProject(null); setEditProject(p); }}
        />
      )}
    </div>
  );
}
