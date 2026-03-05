import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import TabOverview from "./tabs/TabOverview";
import TabKanban from "./tabs/TabKanban";
import TabTimeline from "./tabs/TabTimeline";
import TabDeliveries from "./tabs/TabDeliveries";
import TabUpdates from "./tabs/TabUpdates";
import TabPayments from "./tabs/TabPayments";
import RequestButton from "./RequestButton";

const statusLabels: Record<string, string> = {
  active: "Ativo",
  review: "Em Revisão",
  planning: "Planejamento",
  done: "Concluído",
  paused: "Pausado",
};

const NON_RECURRING_TYPES = ["automation", "site", "landing_page", "event", "other"];

const typeLabels: Record<string, string> = {
  social_media: "Social Media",
  traffic: "Tráfego",
  automation: "Automação",
  site: "Site",
  landing_page: "Landing Page",
  event: "Evento",
  other: "Outro",
};

const statusDotStyles: Record<string, string> = {
  active: "bg-success pulse-dot",
  review: "bg-warning",
  planning: "bg-info",
  done: "bg-success",
  paused: "bg-muted-foreground",
};

interface ProjectViewProps {
  project: any;
  onBack: () => void;
}

export default function ProjectView({ project, onBack }: ProjectViewProps) {
  return (
    <div className="animate-fade-in space-y-6">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Voltar aos projetos
      </button>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className={`w-2.5 h-2.5 rounded-full ${statusDotStyles[project.status] || "bg-muted-foreground"}`} />
          <h1 className="text-[22px] font-semibold text-foreground">{project.name}</h1>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {typeLabels[project.project_type] || project.project_type}
          <span className="mx-2 text-border">•</span>
          {statusLabels[project.status] || project.status}
          <span className="mx-2 text-border">•</span>
          {project.progress}% concluído
        </p>
        <div className="h-[3px] w-full rounded-full bg-secondary mt-3 overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${project.progress}%` }} />
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-transparent h-auto p-0 gap-8 border-b border-border rounded-none w-full justify-start overflow-x-auto">
          {[
            { value: "overview", label: "Visão Geral" },
            { value: "kanban", label: "Kanban" },
            { value: "timeline", label: "Timeline" },
            { value: "deliveries", label: "Entregas" },
            ...(NON_RECURRING_TYPES.includes(project.project_type) ? [{ value: "payments", label: "Pagamentos" }] : []),
            { value: "updates", label: "Atualizações" },
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="bg-transparent rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none text-muted-foreground text-[13px] font-normal px-0 pb-3 pt-0 hover:text-foreground/70 transition-colors whitespace-nowrap"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <TabOverview project={project} />
        </TabsContent>
        <TabsContent value="kanban" className="mt-6">
          <TabKanban projectId={project.id} />
        </TabsContent>
        <TabsContent value="timeline" className="mt-6">
          <TabTimeline projectId={project.id} />
        </TabsContent>
        <TabsContent value="deliveries" className="mt-6">
          <TabDeliveries projectId={project.id} />
        </TabsContent>
        <TabsContent value="updates" className="mt-6">
          <TabUpdates projectId={project.id} />
        </TabsContent>
      </Tabs>

      {/* Floating request button */}
      <RequestButton projectId={project.id} projectName={project.name} />
    </div>
  );
}
