import { CalendarRange, Filter, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnalyticsCampaign } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export interface AnalyticsClientOption {
  id: string;
  name: string;
}

export interface AnalyticsProjectOption {
  id: string;
  clientId: string;
  name: string;
}

interface AnalyticsFiltersProps {
  clients: AnalyticsClientOption[];
  projects: AnalyticsProjectOption[];
  campaigns: AnalyticsCampaign[];
  clientId: string;
  projectId: string;
  campaignId: string;
  startDate: string;
  endDate: string;
  defaultStartDate: string;
  defaultEndDate: string;
  canSelectClient: boolean;
  onChange: (
    key: "client" | "project" | "campaign" | "from" | "to",
    value: string,
  ) => void;
  onReset: () => void;
}

export default function AnalyticsFilters({
  clients,
  projects,
  campaigns,
  clientId,
  projectId,
  campaignId,
  startDate,
  endDate,
  defaultStartDate,
  defaultEndDate,
  canSelectClient,
  onChange,
  onReset,
}: AnalyticsFiltersProps) {
  const visibleProjects =
    clientId === "all"
      ? projects
      : projects.filter((project) => project.clientId === clientId);
  const visibleCampaigns = campaigns.filter((campaign) => {
    if (clientId !== "all" && campaign.client_id !== clientId) return false;
    return projectId === "all" || campaign.project_id === projectId;
  });
  const hasCustomFilter =
    (canSelectClient && clientId !== "all") ||
    projectId !== "all" ||
    campaignId !== "all" ||
    startDate !== defaultStartDate ||
    endDate !== defaultEndDate;

  return (
    <section
      className="rounded-2xl border border-border bg-card/75 p-3 shadow-sm"
      aria-labelledby="analytics-filter-title"
    >
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2
            id="analytics-filter-title"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Recorte da análise
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 px-2 text-xs"
          onClick={onReset}
          disabled={!hasCustomFilter}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Limpar
        </Button>
      </div>

      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2",
          canSelectClient
            ? "xl:grid-cols-[1.15fr_1.15fr_1.2fr_0.85fr_0.85fr]"
            : "xl:grid-cols-[1.15fr_1.2fr_0.85fr_0.85fr]",
        )}
      >
        {canSelectClient && (
          <div className="space-y-1.5">
            <Label htmlFor="analytics-client" className="text-xs">
              Cliente
            </Label>
            <Select
              value={clientId}
              onValueChange={(value) => onChange("client", value)}
            >
              <SelectTrigger
                id="analytics-client"
                className="min-h-11 bg-background"
              >
                <SelectValue placeholder="Todos os clientes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="analytics-project" className="text-xs">
            Projeto
          </Label>
          <Select
            value={projectId}
            onValueChange={(value) => onChange("project", value)}
          >
            <SelectTrigger
              id="analytics-project"
              className="min-h-11 bg-background"
            >
              <SelectValue placeholder="Todos os projetos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os projetos</SelectItem>
              {visibleProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="analytics-campaign" className="text-xs">
            Campanha
          </Label>
          <Select
            value={campaignId}
            onValueChange={(value) => onChange("campaign", value)}
          >
            <SelectTrigger
              id="analytics-campaign"
              className="min-h-11 bg-background"
            >
              <SelectValue placeholder="Todas as campanhas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as campanhas</SelectItem>
              {visibleCampaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="analytics-from" className="text-xs">
            De
          </Label>
          <div className="relative">
            <CalendarRange
              className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="analytics-from"
              type="date"
              value={startDate}
              max={endDate}
              onChange={(event) => onChange("from", event.target.value)}
              className="min-h-11 bg-background pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="analytics-to" className="text-xs">
            Até
          </Label>
          <div className="relative">
            <CalendarRange
              className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="analytics-to"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => onChange("to", event.target.value)}
              className="min-h-11 bg-background pl-9"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
