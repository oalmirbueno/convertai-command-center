import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BarChart3,
  ChevronDown,
  CircleDot,
  Link2,
  Megaphone,
  Plus,
  ReceiptText,
  RefreshCw,
  Target,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { useClients, useProjects } from "@/hooks/useSupabaseData";
import { useAnalyticsData } from "@/hooks/useAnalytics";
import {
  analyticsDateDefaults,
  analyticsDateRangeError,
  isValidAnalyticsDate,
  type AnalyticsDataSet,
} from "@/lib/analytics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import AnalyticsActions, {
  type AnalyticsAction,
} from "@/components/analytics/AnalyticsActions";
import AnalyticsConversions from "@/components/analytics/AnalyticsConversions";
import AnalyticsFilters, {
  type AnalyticsClientOption,
  type AnalyticsProjectOption,
} from "@/components/analytics/AnalyticsFilters";
import AnalyticsOverview from "@/components/analytics/AnalyticsOverview";
import AnalyticsUtms from "@/components/analytics/AnalyticsUtms";

const validTabs = ["overview", "conversions", "utms"] as const;
type AnalyticsTab = (typeof validTabs)[number];

const emptyData: AnalyticsDataSet = {
  campaigns: [],
  utmLinks: [],
  definitions: [],
  events: [],
  metricEntries: [],
};

function AnalyticsLoading() {
  return (
    <div className="space-y-5" aria-label="Carregando analytics">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton
            key={index}
            className="h-[132px] rounded-2xl motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-[360px] rounded-2xl motion-reduce:animate-none" />
        <Skeleton className="h-[360px] rounded-2xl motion-reduce:animate-none" />
      </div>
    </div>
  );
}

function AnalyticsError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-10 text-center"
    >
      <BarChart3
        className="mx-auto mb-3 h-7 w-7 text-destructive"
        aria-hidden="true"
      />
      <h2 className="text-base font-semibold text-foreground">
        Não foi possível carregar Analytics
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {message}
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-5 min-h-11 gap-2"
        onClick={onRetry}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Tentar novamente
      </Button>
    </div>
  );
}

function getQueryErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return `${error.message} Confira se a migration do Bloco 6 já foi aplicada e se seu acesso ao cliente está ativo.`;
  }
  return "Confira se a migration do Bloco 6 já foi aplicada e tente novamente.";
}

export default function Analytics() {
  const { profile } = useAuth();
  const { isImpersonating, impersonatedId } = useImpersonation();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useMemo(() => analyticsDateDefaults(), []);
  const requestedTab = searchParams.get("tab");
  const tab: AnalyticsTab = validTabs.includes(
    requestedTab as AnalyticsTab,
  )
    ? (requestedTab as AnalyticsTab)
    : "overview";
  const startDate = isValidAnalyticsDate(searchParams.get("from"))
    ? searchParams.get("from")!
    : defaults.startDate;
  const endDate = isValidAnalyticsDate(searchParams.get("to"))
    ? searchParams.get("to")!
    : defaults.endDate;
  const requestedClientId = searchParams.get("client") || "all";
  const requestedProjectId = searchParams.get("project") || "all";
  const requestedCampaignId = searchParams.get("campaign") || "all";
  const isClient = profile?.role === "client";
  const forcedClientId = isImpersonating
    ? impersonatedId || ""
    : isClient
      ? profile?.id || ""
      : "";
  const clientId = forcedClientId || requestedClientId;
  const projectId = requestedProjectId;
  const campaignId = requestedCampaignId;
  const canManage =
    !isImpersonating &&
    ["admin", "manager", "traffic"].includes(profile?.role || "");
  const [action, setAction] = useState<AnalyticsAction>(null);

  const clientsQuery = useClients();
  const projectsQuery = useProjects();
  const clientOptions = useMemo<AnalyticsClientOption[]>(() => {
    if (isClient && profile) {
      return [
        {
          id: profile.id,
          name:
            profile.company_name ||
            profile.full_name ||
            "Minha empresa",
        },
      ];
    }
    return (clientsQuery.data || []).map((client) => ({
      id: client.id,
      name:
        client.company_name ||
        client.full_name ||
        "Cliente sem nome",
    }));
  }, [clientsQuery.data, isClient, profile]);
  const projectOptions = useMemo<AnalyticsProjectOption[]>(
    () =>
      (projectsQuery.data || []).map((project) => ({
        id: project.id,
        clientId: project.client_id,
        name: project.name,
      })),
    [projectsQuery.data],
  );

  const analyticsQuery = useAnalyticsData({
    clientId: clientId === "all" ? undefined : clientId,
    projectId: projectId === "all" ? undefined : projectId,
    campaignId: campaignId === "all" ? undefined : campaignId,
    startDate,
    endDate,
  });
  const data = analyticsQuery.data || emptyData;

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (!validTabs.includes(next.get("tab") as AnalyticsTab)) {
      next.set("tab", "overview");
      changed = true;
    }
    if (!isValidAnalyticsDate(next.get("from"))) {
      next.set("from", defaults.startDate);
      changed = true;
    }
    if (!isValidAnalyticsDate(next.get("to"))) {
      next.set("to", defaults.endDate);
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [defaults.endDate, defaults.startDate, searchParams, setSearchParams]);

  const updateFilter = (
    key: "client" | "project" | "campaign" | "from" | "to",
    value: string,
  ) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    if (key === "client") {
      next.delete("project");
      next.delete("campaign");
    }
    if (key === "project") {
      next.delete("campaign");
      const selectedProject = projectOptions.find(
        (project) => project.id === value,
      );
      if (selectedProject && !forcedClientId) {
        next.set("client", selectedProject.clientId);
      }
    }
    if (key === "campaign" && value !== "all") {
      const selectedCampaign = data.campaigns.find(
        (campaign) => campaign.id === value,
      );
      if (selectedCampaign) {
        if (!forcedClientId) {
          next.set("client", selectedCampaign.client_id);
        }
        next.set("project", selectedCampaign.project_id);
      }
    }
    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("client");
    next.delete("project");
    next.delete("campaign");
    next.set("from", defaults.startDate);
    next.set("to", defaults.endDate);
    setSearchParams(next, { replace: true });
  };

  const changeTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next, { replace: true });
  };

  const dateRangeError = analyticsDateRangeError(startDate, endDate);
  const selectedClientId =
    clientId === "all" ? undefined : clientId;
  const selectedProjectId =
    projectId === "all" ? undefined : projectId;
  const selectedCampaignId =
    campaignId === "all" ? undefined : campaignId;
  const selectedCampaign = selectedCampaignId
    ? data.campaigns.find(
        (campaign) => campaign.id === selectedCampaignId,
      )
    : undefined;
  const selectedProject = selectedProjectId
    ? projectOptions.find(
        (project) => project.id === selectedProjectId,
      )
    : undefined;
  const effectiveClientId =
    selectedCampaign?.client_id ||
    selectedProject?.clientId ||
    selectedClientId;
  const effectiveProjectId =
    selectedCampaign?.project_id || selectedProjectId;
  const selectedCampaigns = useMemo(
    () =>
      selectedCampaignId
        ? selectedCampaign
          ? [selectedCampaign]
          : []
        : data.campaigns,
    [data.campaigns, selectedCampaign, selectedCampaignId],
  );
  const scopedData = useMemo<AnalyticsDataSet>(
    () => ({
      ...data,
      campaigns: selectedCampaigns,
      definitions: selectedCampaign
        ? data.definitions.filter(
            (definition) =>
              definition.client_id === selectedCampaign.client_id &&
              definition.project_id === selectedCampaign.project_id,
          )
        : data.definitions,
    }),
    [data, selectedCampaign, selectedCampaigns],
  );

  return (
    <div className="space-y-5 pb-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1.5 border-primary/30 bg-primary/5 text-primary"
            >
              <CircleDot className="h-3 w-3" aria-hidden="true" />
              Manual primeiro
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              Sem integração externa fingindo dado
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Analytics, Conversões e UTMs
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Uma leitura honesta de investimento, tráfego, conversão e receita
            por cliente, projeto e campanha.
          </p>
        </div>

        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                className="min-h-11 w-full gap-2 sm:w-auto"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Novo registro
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setAction("campaign")}>
                <Megaphone className="mr-2 h-4 w-4" aria-hidden="true" />
                Campanha
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setAction("utm")}
                disabled={data.campaigns.length === 0}
              >
                <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Link UTM
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAction("definition")}>
                <Target className="mr-2 h-4 w-4" aria-hidden="true" />
                Definição de conversão
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setAction("event")}
                disabled={data.definitions.length === 0}
              >
                <CircleDot className="mr-2 h-4 w-4" aria-hidden="true" />
                Conversão manual
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAction("metrics")}>
                <ReceiptText className="mr-2 h-4 w-4" aria-hidden="true" />
                Lote de métricas
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <AnalyticsFilters
        clients={clientOptions}
        projects={projectOptions}
        campaigns={data.campaigns}
        clientId={clientId}
        projectId={projectId}
        campaignId={campaignId}
        startDate={startDate}
        endDate={endDate}
        defaultStartDate={defaults.startDate}
        defaultEndDate={defaults.endDate}
        canSelectClient={!forcedClientId}
        onChange={updateFilter}
        onReset={resetFilters}
      />

      {dateRangeError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {dateRangeError}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList className="grid h-auto min-h-11 w-full grid-cols-3 rounded-xl bg-muted/70 p-1 sm:w-fit">
            <TabsTrigger
              value="overview"
              className="min-h-9 gap-2 px-3 text-xs sm:text-sm"
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              <span className="hidden min-[390px]:inline">Visão geral</span>
              <span className="min-[390px]:hidden">Visão</span>
            </TabsTrigger>
            <TabsTrigger
              value="conversions"
              className="min-h-9 gap-2 px-3 text-xs sm:text-sm"
            >
              <Target className="h-4 w-4" aria-hidden="true" />
              Conversões
            </TabsTrigger>
            <TabsTrigger
              value="utms"
              className="min-h-9 gap-2 px-3 text-xs sm:text-sm"
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              UTMs
            </TabsTrigger>
          </TabsList>

          {analyticsQuery.isLoading ? (
            <div className="mt-5">
              <AnalyticsLoading />
            </div>
          ) : analyticsQuery.isError ? (
            <div className="mt-5">
              <AnalyticsError
                message={getQueryErrorMessage(analyticsQuery.error)}
                onRetry={() => analyticsQuery.refetch()}
              />
            </div>
          ) : (
            <>
              <TabsContent value="overview" className="mt-5">
                <AnalyticsOverview
                  data={scopedData}
                  startDate={startDate}
                  endDate={endDate}
                  selectedCampaignId={selectedCampaignId}
                  canManage={canManage}
                  onCreateCampaign={() => setAction("campaign")}
                  onCreateMetricBatch={() => setAction("metrics")}
                />
              </TabsContent>
              <TabsContent value="conversions" className="mt-5">
                <AnalyticsConversions
                  definitions={scopedData.definitions}
                  events={data.events}
                  campaigns={selectedCampaigns}
                  canManage={canManage}
                  onCreateDefinition={() => setAction("definition")}
                  onCreateEvent={() => setAction("event")}
                />
              </TabsContent>
              <TabsContent value="utms" className="mt-5">
                <AnalyticsUtms
                  campaigns={selectedCampaigns}
                  utmLinks={data.utmLinks}
                  canManage={canManage}
                  onCreateCampaign={() => setAction("campaign")}
                  onCreateUtm={() => setAction("utm")}
                />
              </TabsContent>
            </>
          )}
        </Tabs>
      )}

      <AnalyticsActions
        action={action}
        onClose={() => setAction(null)}
        clients={clientOptions}
        projects={projectOptions}
        campaigns={selectedCampaigns}
        definitions={scopedData.definitions}
        utmLinks={data.utmLinks}
        defaultClientId={effectiveClientId}
        defaultProjectId={effectiveProjectId}
        defaultCampaignId={selectedCampaignId}
      />
    </div>
  );
}
