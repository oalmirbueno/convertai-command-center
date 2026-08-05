import {
  CalendarCheck,
  CircleDollarSign,
  Plus,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ANALYTICS_TIME_ZONE,
  formatAnalyticsNumber,
  type AnalyticsCampaign,
  type AnalyticsConversionDefinition,
  type AnalyticsConversionEvent,
} from "@/lib/analytics";

interface AnalyticsConversionsProps {
  definitions: AnalyticsConversionDefinition[];
  events: AnalyticsConversionEvent[];
  campaigns: AnalyticsCampaign[];
  canManage: boolean;
  onCreateDefinition: () => void;
  onCreateEvent: () => void;
}

const conversionTypeLabels: Record<string, string> = {
  lead: "Lead",
  message: "Mensagem",
  appointment: "Agendamento",
  purchase: "Compra",
  signup: "Cadastro",
  custom: "Personalizada",
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ANALYTICS_TIME_ZONE,
  }).format(new Date(value));
}

export default function AnalyticsConversions({
  definitions,
  events,
  campaigns,
  canManage,
  onCreateDefinition,
  onCreateEvent,
}: AnalyticsConversionsProps) {
  const campaignNames = new Map(
    campaigns.map((campaign) => [campaign.id, campaign.name]),
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[0.92fr_1.28fr]">
      <section
        className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm sm:p-5"
        aria-labelledby="conversion-definitions-title"
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="conversion-definitions-title"
              className="text-base font-semibold text-foreground"
            >
              Definições
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              O que conta como conversão e o que entra na receita.
            </p>
          </div>
          {canManage && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2 sm:min-h-9"
              onClick={onCreateDefinition}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nova definição
            </Button>
          )}
        </div>

        {definitions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-10 text-center">
            <Target
              className="mx-auto mb-3 h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              Defina a conversão antes de medir
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              Exemplo: lead, agendamento ou compra. Marque uma definição como
              primária para calcular CVR e CPA.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {definitions.map((definition) => (
              <article
                key={definition.id}
                className="rounded-xl border border-border bg-background/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {definition.name}
                    </h3>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {definition.event_key}
                    </p>
                  </div>
                  <Badge
                    variant={definition.active ? "secondary" : "outline"}
                  >
                    {definition.active ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {conversionTypeLabels[definition.conversion_type] ||
                      definition.conversion_type}
                  </Badge>
                  {definition.is_primary && (
                    <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
                      Primária
                    </Badge>
                  )}
                  {definition.counts_as_revenue && (
                    <Badge variant="outline" className="gap-1">
                      <CircleDollarSign
                        className="h-3 w-3"
                        aria-hidden="true"
                      />
                      Receita
                    </Badge>
                  )}
                </div>
                {definition.default_value !== null && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Valor padrão{" "}
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatAnalyticsNumber(definition.default_value, {
                        style: "currency",
                        currency: definition.currency,
                      })}
                    </span>
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm sm:p-5"
        aria-labelledby="conversion-events-title"
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="conversion-events-title"
              className="text-base font-semibold text-foreground"
            >
              Eventos do período
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Registro append-only, sem nome, telefone, e-mail ou outra PII.
            </p>
          </div>
          {canManage && (
            <Button
              type="button"
              className="min-h-11 gap-2 sm:min-h-9"
              onClick={onCreateEvent}
              disabled={definitions.length === 0}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Registrar conversão
            </Button>
          )}
        </div>

        {events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-10 text-center">
            <CalendarCheck
              className="mx-auto mb-3 h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              Nenhuma conversão no período
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              Registre o primeiro evento manual. O identificador idempotente é
              criado automaticamente para evitar duplicidade técnica.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {events.map((event) => (
                <article
                  key={event.id}
                  className="rounded-xl border border-border bg-background/60 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {event.definition_name}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(event.occurred_at)}
                      </p>
                    </div>
                    {event.is_primary && (
                      <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
                        Primária
                      </Badge>
                    )}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Campanha</dt>
                      <dd className="mt-1 truncate text-foreground">
                        {event.campaign_id
                          ? campaignNames.get(event.campaign_id) ||
                            "Campanha removida"
                          : "Sem campanha"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Valor</dt>
                      <dd className="mt-1 font-mono tabular-nums text-foreground">
                        {event.counts_as_revenue
                          ? formatAnalyticsNumber(event.value, {
                              style: "currency",
                              currency: event.currency,
                            })
                          : "Não conta"}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="px-3 py-3 font-medium">
                      Conversão
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Campanha
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Data
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">
                      Valor
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Origem
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr
                      key={event.id}
                      className="border-b border-border last:border-b-0"
                    >
                      <th scope="row" className="px-3 py-3.5">
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          {event.definition_name}
                          {event.is_primary && (
                            <>
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-primary"
                                aria-hidden="true"
                              />
                              <span className="sr-only">
                                Conversão primária
                              </span>
                            </>
                          )}
                        </span>
                        <span className="mt-1 block font-mono text-[10px] font-normal text-muted-foreground">
                          {event.event_key}
                        </span>
                      </th>
                      <td className="max-w-[180px] truncate px-3 py-3.5">
                        {event.campaign_id
                          ? campaignNames.get(event.campaign_id) ||
                            "Campanha removida"
                          : "Sem campanha"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5">
                        {formatDateTime(event.occurred_at)}
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                        {event.counts_as_revenue
                          ? formatAnalyticsNumber(event.value, {
                              style: "currency",
                              currency: event.currency,
                            })
                          : "Não conta"}
                      </td>
                      <td className="px-3 py-3.5">
                        <Badge variant="outline">
                          {event.source === "manual"
                            ? "Manual"
                            : event.source}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
