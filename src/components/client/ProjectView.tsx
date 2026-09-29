import { ArrowLeft } from "lucide-react";
import {
  CabecalhoDePagina,
  Etapas,
  Secao,
  foco,
  juntar,
  texto,
  useEstadoDaTela,
  type ItemDeEtapa,
} from "@/components/sistema";
import CircularProgress from "./CircularProgress";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
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

  return (
    <StaggerContainer className="min-w-0 space-y-6">
      <FadeUp>
        <button
          type="button"
          onClick={onBack}
          className={juntar("mb-1 inline-flex items-center rounded text-[12px] text-muted-foreground transition-colors hover:text-foreground", foco)}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Voltar aos projetos
        </button>
        <CabecalhoDePagina
          titulo={project.name}
          descricao={`${typeLabels[project.project_type] || "Projeto"} · ${statusLabels[project.status] || project.status}${previsao ? ` · ${previsao}` : ""}`}
          ajuda={project.description ? summarizeProjectText(project.description) : undefined}
          acoes={
            <>
              <span className="hidden items-center sm:flex" title="Progresso">
                <CircularProgress progress={project.progress || 0} size={44} strokeWidth={4} />
              </span>
              {!isImpersonating && <RequestButton projectId={project.id} projectName={project.name} />}
            </>
          }
        />
      </FadeUp>

      <FadeUp>
        <FaixaDeNumeros
          rotulo="Números do projeto"
          itens={[
            { rotulo: "Etapas concluídas", valor: `${completedMilestones}/${allMilestones.length}` },
            { rotulo: "Entregas liberadas", valor: visibleFiles.length },
            { rotulo: "Aprovadas", valor: approvedDeliveries, corDoValor: "text-emerald-500" },
            { rotulo: "Aguardando decisão", valor: pendingApprovals, corDoValor: pendingApprovals ? "text-amber-500" : "text-foreground" },
          ]}
        />
      </FadeUp>

      <FadeUp>
        <Etapas rotulo="Seções do projeto" itens={abas} valor={aba} onEscolher={setAba} className="border-b border-border" />
        <div className="mt-5 min-w-0">
          {aba === "overview" && (
            <>
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
                  <Secao titulo={flow.title} className="mb-6">
                    <ol className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
                      {flow.steps.map((step, index) => (
                        <li key={step.label} className="flex min-w-0 items-start">
                          <span className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                            {index + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium leading-5 text-foreground">{step.label}</span>
                            <span className={juntar(texto.auxiliar, "block")}>{step.hint}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </Secao>
                );
              })()}
              <div className="border-t border-border pt-5">
                <TabOverview project={project} />
              </div>
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
