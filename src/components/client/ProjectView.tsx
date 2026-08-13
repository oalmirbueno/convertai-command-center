import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  FileCheck,
  PackageCheck,
  Target,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CircularProgress from "./CircularProgress";
import { FadeUp, StaggerContainer } from "./motion";
import TabOverview from "./tabs/TabOverview";
import TabDeliveries from "./tabs/TabDeliveries";
import TabPayments from "./tabs/TabPayments";
import TabDocument from "./tabs/TabDocument";
import RequestButton from "./RequestButton";
import { useFiles, useMilestones } from "@/hooks/useSupabaseData";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { daysUntil, formatDateShort } from "./dashboardHelpers";
import { summarizeProjectText } from "@/lib/projectPresentation";

const statusLabels: Record<string, string> = {
  active: "Em andamento",
  review: "Em revisão",
  planning: "Planejamento",
  done: "Concluído",
  paused: "Pausado",
};

const typeLabels: Record<string, string> = {
  social_media: "Social Media",
  traffic: "Tráfego",
  automation: "Automação",
  site: "Site",
  landing_page: "Landing Page",
  event: "Evento",
  other: "Outro",
};

const NON_RECURRING_TYPES = ["automation", "site", "landing_page", "event", "other"];

interface ProjectViewProps {
  project: any;
  onBack: () => void;
}

export default function ProjectView({ project, onBack }: ProjectViewProps) {
  const { isImpersonating } = useClientIdentity();
  const { data: milestones } = useMilestones(project.id);
  // Busca pelo cliente inteiro: entrega enviada sem vinculo de projeto tambem
  // e do cliente e precisa aparecer aqui - antes a aba Entregas ficava vazia.
  const { data: files } = useFiles(undefined, project.client_id);

  const visibleFiles = (files || []).filter((file: any) =>
    (file.project_id === project.id || !file.project_id)
    && file.status === "ready"
    && !file.archived_at
    && !file.parent_file_id
  );
  const pendingApprovals = visibleFiles.filter((file: any) => file.approval_status === "pending").length;
  const approvedDeliveries = visibleFiles.filter((file: any) => file.approval_status === "approved").length;
  const allMilestones = milestones || [];
  const completedMilestones = allMilestones.filter((milestone: any) => milestone.status === "completed").length;
  const deadlineDistance = project.deadline ? daysUntil(project.deadline) : null;

  return (
    <StaggerContainer className="space-y-6">
      <FadeUp>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar aos projetos
        </button>
      </FadeUp>

      <FadeUp>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-primary/[0.02]" />
          <div className="relative z-10">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                {typeLabels[project.project_type] || "Projeto"}
              </span>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                {statusLabels[project.status] || project.status}
              </span>
            </div>
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{project.name}</h1>
                {project.description && (
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {summarizeProjectText(project.description)}
                  </p>
                )}
              </div>
              <div className="hidden shrink-0 flex-col items-center gap-1.5 sm:flex">
                <CircularProgress progress={project.progress || 0} size={82} strokeWidth={5} />
                <span className="text-[10px] text-muted-foreground">Progresso</span>
              </div>
            </div>
          </div>
        </div>
      </FadeUp>

      <FadeUp>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "Etapas concluídas",
              value: `${completedMilestones}/${allMilestones.length}`,
              icon: Target,
            },
            {
              label: "Entregas liberadas",
              value: visibleFiles.length,
              icon: PackageCheck,
            },
            {
              label: "Aprovadas",
              value: approvedDeliveries,
              icon: CheckCircle2,
            },
            {
              label: "Aguardando decisão",
              value: pendingApprovals,
              icon: FileCheck,
            },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <item.icon className="h-4 w-4 text-primary" />
                <span className="text-xl font-bold text-foreground">{item.value}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
            </div>
          ))}
        </div>
      </FadeUp>

      {project.deadline && (
        <FadeUp>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <Calendar className="h-4 w-4 text-primary" />
            <div>
              <p className="text-xs font-medium text-foreground">
                Previsão: {formatDateShort(project.deadline)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {deadlineDistance !== null && deadlineDistance >= 0
                  ? `${deadlineDistance} dia(s) até a previsão`
                  : "A previsão está sendo atualizada pela equipe."}
              </p>
            </div>
          </div>
        </FadeUp>
      )}

      <FadeUp>
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="h-auto w-full justify-start gap-8 overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-[13px] text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
              Visão geral
            </TabsTrigger>
            <TabsTrigger value="deliveries" className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-[13px] text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
              Entregas
            </TabsTrigger>
            {NON_RECURRING_TYPES.includes(project.project_type) && (
              <TabsTrigger value="payments" className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-[13px] text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
                Pagamentos
              </TabsTrigger>
            )}
            <TabsTrigger value="document" className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-[13px] text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
              Documento
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6">
            {/* Como funciona este servico: o processo desenhado, curto e claro */}
            {(() => {
              const FLOWS: Record<string, { title: string; steps: { label: string; hint: string }[] }> = {
                social_media: {
                  title: "Como funciona o seu Social Media",
                  steps: [
                    { label: "Estratégia", hint: "Definimos os temas do ciclo" },
                    { label: "Criação", hint: "Artes e legendas produzidas" },
                    { label: "Sua aprovação", hint: "Você dá o OK no painel" },
                    { label: "Publicação", hint: "Sai na conta certa, na hora certa" },
                    { label: "Medição", hint: "Resultados viram relatório" },
                  ],
                },
                trafego: {
                  title: "Como funciona o seu Tráfego",
                  steps: [
                    { label: "Público", hint: "Quem deve ver o anúncio" },
                    { label: "Criativos", hint: "Anúncios produzidos" },
                    { label: "Veiculação", hint: "Campanha no ar com verba" },
                    { label: "Otimização", hint: "Ajustes para custo menor" },
                    { label: "Relatório", hint: "Investido × retorno explicado" },
                  ],
                },
                site: {
                  title: "Como funciona o seu Site",
                  steps: [
                    { label: "Estrutura", hint: "Mapa das páginas" },
                    { label: "Design", hint: "Visual e identidade" },
                    { label: "Sua aprovação", hint: "Você valida o caminho" },
                    { label: "Construção", hint: "Página no ar" },
                    { label: "Entrega", hint: "Publicado e revisado" },
                  ],
                },
              };
              const flow = FLOWS[project.project_type] || {
                title: "Como funciona este projeto",
                steps: [
                  { label: "Planejamento", hint: "Escopo e objetivos" },
                  { label: "Produção", hint: "Mão na massa" },
                  { label: "Sua aprovação", hint: "Você valida no painel" },
                  { label: "Entrega", hint: "Material liberado" },
                  { label: "Acompanhamento", hint: "Resultado medido" },
                ],
              };
              return (
                <div className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {flow.title}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {flow.steps.map((step, index) => (
                      <div key={step.label} className="relative rounded-xl border border-border bg-secondary/25 p-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                          {index + 1}
                        </span>
                        <p className="mt-2 text-[12px] font-semibold text-foreground">{step.label}</p>
                        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{step.hint}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <TabOverview project={project} />
          </TabsContent>
          <TabsContent value="deliveries" className="mt-6">
            <TabDeliveries projectId={project.id} />
          </TabsContent>
          {NON_RECURRING_TYPES.includes(project.project_type) && (
            <TabsContent value="payments" className="mt-6">
              <TabPayments projectId={project.id} clientId={project.client_id} projectName={project.name} />
            </TabsContent>
          )}
          <TabsContent value="document" className="mt-6">
            <TabDocument projectId={project.id} />
          </TabsContent>
        </Tabs>
      </FadeUp>

      {!isImpersonating && (
        <RequestButton projectId={project.id} projectName={project.name} />
      )}
    </StaggerContainer>
  );
}
