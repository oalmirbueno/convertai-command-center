import { useState } from "react";
import { useProjects, useTasks } from "@/hooks/useSupabaseData";
import { buildProgressView, cycleFillPercent } from "@/lib/projectProgress";
import { useAuth } from "@/contexts/AuthContext";
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
  etiqueta,
  foco,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";

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

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  };

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
        descricao={isLoading ? undefined : `${filtered.length} ${filtered.length === 1 ? "projeto" : "projetos"}`}
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
      <AreaDeTrabalho className="mt-4" rotuloDoPrincipal="Lista de projetos" memoriaDaRolagem="projetos:lista">
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
          <ul aria-label="Projetos" data-tour="projects-list" className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
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
                    className={juntar("flex min-w-0 items-center px-4 py-3 transition-colors", clicavel && "cursor-pointer hover:bg-muted/40", clicavel && foco)}
                  >
                    <span aria-hidden="true" className={juntar("mr-3 h-2 w-2 shrink-0 rounded-full", statusDotColors[p.status] || "bg-muted-foreground")} />
                    <div className="mr-3 min-w-0 flex-1">
                      <div className="flex min-w-0 items-center">
                        <span className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{p.name}</span>
                        {p.project_type && (
                          <span className={juntar(etiqueta, "ml-2 hidden bg-muted capitalize text-muted-foreground sm:inline-flex")}>{p.project_type.replace("_", " ")}</span>
                        )}
                      </div>
                      <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
                        {[p.client?.company_name || p.client?.full_name, statusLabels[p.status]].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="mr-3 hidden w-36 shrink-0 md:block">
                      <div className="h-[3px] overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${cycleFillPercent(view)}%` }} />
                      </div>
                      <p className="mt-1 truncate text-right text-[11px] tabular-nums text-muted-foreground">
                        {view.mode === "percent" ? `${view.percent}%` : view.label}
                      </p>
                    </div>
                    {p.deadline && (
                      <span className={juntar(texto.auxiliar, "hidden shrink-0 items-center tabular-nums sm:flex", isAdmin && "mr-2")}>
                        <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
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
