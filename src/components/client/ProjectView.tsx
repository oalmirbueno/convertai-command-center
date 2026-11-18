import { ArrowLeft } from "lucide-react";
import {
  botao,
  espaco,
  juntar,
  texto,
  useEstadoDaTela,
  type ItemDeEtapa,
} from "@/components/sistema";
import { Card, PageHeader, PillTabs, ProgressBar, StatCard, StatGrid, StatusPill, type Tone } from "@/components/ds";
import { FadeUp, StaggerContainer } from "./motion";
import TabOverview from "./tabs/TabOverview";
import TabDeliveries from "./tabs/TabDeliveries";
import TabPayments from "./tabs/TabPayments";
import TabDocument from "./tabs/TabDocument";
import RequestButton from "./RequestButton";
import { useFiles, useMilestones } from "@/hooks/useSupabaseData";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
const ABAS_VALIDAS = ["overview", "deliveries", "payments", "document"];

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

  // A aba Documento só existe se houver documento publicado: aba vazia com
  // "nenhum documento ainda" só confundia o cliente.
  const { data: studioDoc } = useQuery({
    queryKey: ["studio-doc-published", project.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("studio_docs")
        .select("published, notes")
        .eq("project_id", project.id)
        .maybeSingle();
      return data as { published: boolean; notes: string | null } | null;
    },
    staleTime: 60_000,
  });
  const hasPublishedDoc = !!studioDoc?.published && !!studioDoc?.notes?.trim();

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

  const pagamentos = NON_RECURRING_TYPES.includes(project.project_type);
  const abas: ItemDeEtapa[] = [
    { valor: "overview", rotulo: "Visão geral" },
    { valor: "deliveries", rotulo: "Entregas", contador: pendingApprovals || null },
    ...(pagamentos ? [{ valor: "payments", rotulo: "Pagamentos" }] : []),
    ...(hasPublishedDoc ? [{ valor: "document", rotulo: "Plano do projeto" }] : []),
  ];
  // Aba aberta lembrada por projeto (sair e voltar mantém). Aba que não existe
  // neste projeto (documento despublicado) cai na visão geral.
  const [abaGuardada, setAba] = useEstadoDaTela<string>(`projeto:aba:${project.id}`, "overview", {
    validar: (v) => typeof v === "string" && ABAS_VALIDAS.indexOf(v) >= 0,
  });
  const aba = abas.some((a) => a.valor === abaGuardada) ? abaGuardada : "overview";

  const previsao = project.deadline
    ? `Previsão ${formatDateShort(project.deadline)}${
        deadlineDistance !== null && deadlineDistance >= 0 ? `, ${deadlineDistance} dia(s)` : ", em atualização"
      }`
    : "";

  const passos = (FLUXOS[project.project_type] || FLUXO_PADRAO);

  return (
    <StaggerContainer className={espaco.pagina}>
      <FadeUp>
        <button
          type="button"
          onClick={onBack}
          className={juntar(botao.secundario, "mb-4 h-8 px-3 text-[12px]")}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Voltar aos projetos
        </button>
        <PageHeader
          title={project.name}
          subtitle={`${typeLabels[project.project_type] || "Projeto"}${previsao ? ` · ${previsao}` : ""}`}
          help={project.description ? summarizeProjectText(project.description) : undefined}
          beside={<StatusPill tone={tomDoStatus[project.status] || "neutral"}>{statusLabels[project.status] || project.status}</StatusPill>}
          actions={!isImpersonating ? <RequestButton projectId={project.id} projectName={project.name} /> : undefined}
        />
      </FadeUp>

      <FadeUp>
        <StatGrid cols={4} label="Números do projeto">
          <StatCard
            variant="accent"
            size="xl"
            label="Progresso"
            value={`${project.progress || 0}%`}
            hint={previsao || undefined}
            chart={<ProgressBar value={project.progress || 0} max={100} label={`${project.progress || 0}% concluído`} />}
          />
          <StatCard
            variant="ink"
            size="xl"
            label="Etapas concluídas"
            value={`${completedMilestones}/${allMilestones.length}`}
            chart={allMilestones.length > 0 ? <ProgressBar value={completedMilestones} max={allMilestones.length} tone={1} striped /> : undefined}
          />
          <StatCard
            size="xl"
            label="Entregas liberadas"
            value={visibleFiles.length}
            hint={`${approvedDeliveries} aprovada(s)`}
            chart={visibleFiles.length > 0 ? <ProgressBar value={approvedDeliveries} max={visibleFiles.length} tone={1} label={`${approvedDeliveries} de ${visibleFiles.length} entregas aprovadas`} /> : undefined}
          />
          <StatCard
            size="xl"
            label="Aguardando decisão"
            value={pendingApprovals}
            hint={pendingApprovals ? <span className="font-medium text-warning">Sua aprovação</span> : "Nenhuma pendência"}
            onClick={pendingApprovals ? () => setAba("deliveries") : undefined}
          />
        </StatGrid>
      </FadeUp>

      <FadeUp>
        <PillTabs
          label="Seções do projeto"
          tabs={abas.map((a) => ({ value: a.valor, label: a.rotulo, count: typeof a.contador === "number" ? a.contador : undefined }))}
          value={aba}
          onChange={setAba}
        />
        <div className="mt-6 min-w-0 sm:mt-8">
          {aba === "overview" && (
            <>
              {/* Como funciona este servico: o processo desenhado, curto e claro */}
              <Card title={passos.title} className="mb-6 sm:mb-8">
                <ol className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-5 sm:gap-4">
                  {passos.steps.map((step, index) => (
                    <li key={step.label} className="flex min-w-0 items-center rounded-md bg-muted/60 p-3 sm:block sm:p-4">
                      <span className={juntar("mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums sm:mb-3 sm:mr-0", index === 0 ? "bg-accent-solid text-on-accent" : "bg-foreground text-background")}>
                        {index + 1}
                      </span>
                      <span className="block min-w-0">
                        <span className="block text-[13px] font-semibold leading-5 text-foreground">{step.label}</span>
                        <span className={juntar(texto.auxiliar, "mt-0.5 block")}>{step.hint}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
              <TabOverview project={project} />
            </>
          )}
          {aba === "deliveries" && <TabDeliveries projectId={project.id} />}
          {aba === "payments" && pagamentos && (
            <TabPayments projectId={project.id} clientId={project.client_id} projectName={project.name} />
          )}
          {aba === "document" && hasPublishedDoc && <TabDocument projectId={project.id} />}
        </div>
      </FadeUp>
    </StaggerContainer>
  );
}

const tomDoStatus: Record<string, Tone> = {
  active: "success",
  review: "warning",
  planning: "info",
  done: "neutral",
  paused: "neutral",
};

type Fluxo = { title: string; steps: { label: string; hint: string }[] };

const FLUXOS: Record<string, Fluxo> = {
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

const FLUXO_PADRAO: Fluxo = {
  title: "Como funciona este projeto",
  steps: [
    { label: "Planejamento", hint: "Escopo e objetivos" },
    { label: "Produção", hint: "Mão na massa" },
    { label: "Sua aprovação", hint: "Você valida no painel" },
    { label: "Entrega", hint: "Material liberado" },
    { label: "Acompanhamento", hint: "Resultado medido" },
  ],
};
