import { useState } from "react";
import { CalendarRange, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useFinanceDashboard } from "./api/useFinanceV2";
import { CashFlowTab } from "./components/CashFlowTab";
import { Failed, Loading } from "./components/FinanceUi";
import { FixedCostsTab } from "./components/FixedCostsTab";
import { OverviewTab } from "./components/OverviewTab";
import { PlansTab } from "./components/PlansTab";
import { SubscriptionsTab } from "./components/SubscriptionsTab";
import { currentMonthRange } from "./lib/finance";
import type { FinanceDateRange } from "./types";

export function FinanceDashboardV2() {
  const [range, setRange] = useState<FinanceDateRange>(() =>
    currentMonthRange(),
  );
  const query = useFinanceDashboard(range);
  const invalid = range.start > range.end;

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Financeiro
            </h1>
            {query.data && (
              <Badge
                variant={
                  query.data.period.status === "closed"
                    ? "secondary"
                    : "outline"
                }
              >
                {query.data.period.status === "closed"
                  ? "Fechado · rev. " +
                    String(query.data.period.revision ?? 1)
                  : "Período aberto"}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Caixa, competência e previsão sem dupla contagem.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-1 rounded-lg border p-1">
            <CalendarRange className="ml-2 hidden size-4 text-muted-foreground sm:block" />
            <Input
              aria-label="Data inicial"
              type="date"
              className="h-8 min-w-32 border-0 px-1 shadow-none"
              value={range.start}
              onChange={(event) =>
                setRange((current) => ({
                  ...current,
                  start: event.target.value,
                }))
              }
            />
            <span className="text-muted-foreground">até</span>
            <Input
              aria-label="Data final"
              type="date"
              className="h-8 min-w-32 border-0 px-1 shadow-none"
              value={range.end}
              onChange={(event) =>
                setRange((current) => ({
                  ...current,
                  end: event.target.value,
                }))
              }
            />
          </div>
          <Button
            size="icon"
            variant="outline"
            aria-label="Atualizar financeiro"
            disabled={query.isFetching || invalid}
            onClick={() => query.refetch()}
          >
            <RefreshCw
              className={
                query.isFetching ? "size-4 animate-spin" : "size-4"
              }
            />
          </Button>
        </div>
      </header>

      {invalid ? (
        <Failed
          message="A data inicial precisa ser anterior à final."
          retry={() => setRange(currentMonthRange())}
        />
      ) : query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <Failed message={query.error.message} retry={() => query.refetch()} />
      ) : (
        query.data && (
          <Tabs defaultValue="overview" className="space-y-4">
            <div className="overflow-x-auto pb-1">
              <TabsList className="inline-flex h-10 min-w-max">
                <TabsTrigger value="overview">Visão geral</TabsTrigger>
                <TabsTrigger value="flow">Fluxo</TabsTrigger>
                <TabsTrigger value="subscriptions">Mensalidades</TabsTrigger>
                <TabsTrigger value="costs">Custos fixos</TabsTrigger>
                <TabsTrigger value="plans">Planos</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="overview">
              <OverviewTab data={query.data} />
            </TabsContent>
            <TabsContent value="flow">
              <CashFlowTab items={query.data.cash_flow} />
            </TabsContent>
            <TabsContent value="subscriptions">
              <SubscriptionsTab
                items={query.data.subscriptions}
                clients={query.data.clients}
                plans={query.data.plans}
              />
            </TabsContent>
            <TabsContent value="costs">
              <FixedCostsTab items={query.data.fixed_costs} />
            </TabsContent>
            <TabsContent value="plans">
              <PlansTab
                items={query.data.plans}
                settings={query.data.settings}
              />
            </TabsContent>
          </Tabs>
        )
      )}
    </section>
  );
}
