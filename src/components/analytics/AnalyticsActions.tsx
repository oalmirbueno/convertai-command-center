import { FormEvent, ReactNode, useMemo, useState } from "react";
import { Link2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  analyticsDateTimeLocalToIso,
  analyticsDateTimeLocalValue,
  buildUtmUrl,
  normalizeUtmToken,
  type AnalyticsCampaign,
  type AnalyticsConversionDefinition,
  type AnalyticsUtmLink,
} from "@/lib/analytics";
import {
  useAnalyticsMutations,
  type CreateCampaignInput,
  type CreateDefinitionInput,
  type CreateEventInput,
  type CreateMetricBatchInput,
  type CreateUtmLinkInput,
} from "@/hooks/useAnalytics";
import type {
  AnalyticsClientOption,
  AnalyticsProjectOption,
} from "./AnalyticsFilters";

export type AnalyticsAction =
  | "campaign"
  | "utm"
  | "definition"
  | "event"
  | "metrics"
  | null;

interface AnalyticsActionsProps {
  action: AnalyticsAction;
  onClose: () => void;
  clients: AnalyticsClientOption[];
  projects: AnalyticsProjectOption[];
  campaigns: AnalyticsCampaign[];
  definitions: AnalyticsConversionDefinition[];
  utmLinks: AnalyticsUtmLink[];
  defaultClientId?: string;
  defaultProjectId?: string;
  defaultCampaignId?: string;
}

const UNSET = "__unset";

function scopedOptionLabel(
  name: string,
  clientId: string,
  projectId: string,
  clients: AnalyticsClientOption[],
  projects: AnalyticsProjectOption[],
) {
  const clientName = clients.find((client) => client.id === clientId)?.name;
  const projectName = projects.find(
    (project) => project.id === projectId,
  )?.name;
  const scope = [clientName, projectName].filter(Boolean).join(" / ");
  return scope ? `${name} · ${scope}` : name;
}

const actionMeta = {
  campaign: {
    title: "Nova campanha",
    description:
      "Crie o contêiner que conecta investimento, UTMs e conversões.",
  },
  utm: {
    title: "Novo link UTM",
    description:
      "Monte o link em tempo real sem apagar parâmetros que já existem.",
  },
  definition: {
    title: "Nova definição de conversão",
    description:
      "Defina o evento, a prioridade e se ele compõe receita.",
  },
  event: {
    title: "Registrar conversão manual",
    description:
      "Registre apenas o evento. Não inclua nome, telefone, e-mail ou outra PII.",
  },
  metrics: {
    title: "Lançar lote de métricas",
    description:
      "Informe várias métricas do mesmo período em uma única ação.",
  },
};

const channelOptions = [
  ["meta_ads", "Meta Ads"],
  ["google_ads", "Google Ads"],
  ["tiktok_ads", "TikTok Ads"],
  ["organic", "Orgânico"],
  ["email", "E-mail"],
  ["referral", "Indicação"],
  ["whatsapp", "WhatsApp"],
  ["other", "Outro"],
] as const;

const conversionTypeOptions = [
  ["lead", "Lead"],
  ["message", "Mensagem"],
  ["appointment", "Agendamento"],
  ["purchase", "Compra"],
  ["signup", "Cadastro"],
  ["custom", "Personalizada"],
] as const;

const metricOptions = [
  ["ad_spend", "Investimento"],
  ["impressions", "Impressões"],
  ["clicks", "Cliques"],
  ["sessions", "Sessões"],
] as const;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    if (error.message.includes("metric period overlaps")) {
      return "Já existe uma observação dessa métrica que cruza o período informado.";
    }
    if (
      error.message.includes("analytics_utm_links_tracking_key") ||
      error.message.includes("duplicate key")
    ) {
      return "Este registro já existe neste escopo. Revise campanha, link ou período.";
    }
    return error.message;
  }
  return "Não foi possível salvar. Revise os campos e tente novamente.";
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
    >
      {message}
    </p>
  );
}

function FormActions({
  pending,
  onCancel,
  submitLabel,
}: {
  pending: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={onCancel}
        disabled={pending}
      >
        Cancelar
      </Button>
      <Button type="submit" className="min-h-11" disabled={pending}>
        {pending && (
          <Loader2
            className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        {pending ? "Salvando..." : submitLabel}
      </Button>
    </div>
  );
}

function Field({
  id,
  label,
  required,
  helper,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {helper && (
        <p className="text-[11px] leading-4 text-muted-foreground">{helper}</p>
      )}
    </div>
  );
}

function ScopeFields({
  clients,
  projects,
  clientId,
  projectId,
  onClientChange,
  onProjectChange,
}: {
  clients: AnalyticsClientOption[];
  projects: AnalyticsProjectOption[];
  clientId: string;
  projectId: string;
  onClientChange: (value: string) => void;
  onProjectChange: (value: string) => void;
}) {
  const visibleProjects = projects.filter(
    (project) => project.clientId === clientId,
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="analytics-action-client" label="Cliente" required>
        <Select
          value={clientId || undefined}
          onValueChange={onClientChange}
        >
          <SelectTrigger
            id="analytics-action-client"
            className="min-h-11"
          >
            <SelectValue placeholder="Selecione o cliente" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id="analytics-action-project" label="Projeto" required>
        <Select
          value={projectId || undefined}
          onValueChange={onProjectChange}
          disabled={!clientId}
        >
          <SelectTrigger
            id="analytics-action-project"
            className="min-h-11"
          >
            <SelectValue placeholder="Selecione o projeto" />
          </SelectTrigger>
          <SelectContent>
            {visibleProjects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function CampaignForm({
  clients,
  projects,
  defaultClientId,
  defaultProjectId,
  onClose,
}: Pick<
  AnalyticsActionsProps,
  "clients" | "projects" | "defaultClientId" | "defaultProjectId" | "onClose"
>) {
  const { createCampaign } = useAnalyticsMutations();
  const [clientId, setClientId] = useState(defaultClientId || "");
  const [projectId, setProjectId] = useState(defaultProjectId || "");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [channel, setChannel] = useState("meta_ads");
  const [status, setStatus] = useState("draft");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [utmTouched, setUtmTouched] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!utmTouched) setUtmCampaign(normalizeUtmToken(value));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsedBudget = Number(budget.replace(",", "."));
    if (!clientId || !projectId || !name.trim() || !objective.trim()) {
      setError("Preencha cliente, projeto, nome e objetivo.");
      return;
    }
    if (!budget.trim() || !Number.isFinite(parsedBudget) || parsedBudget < 0) {
      setError("Informe um orçamento válido, mesmo que seja zero.");
      return;
    }
    if (!utmCampaign.trim()) {
      setError("Informe o identificador UTM da campanha.");
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setError("A data final não pode vir antes da data inicial.");
      return;
    }

    const payload: CreateCampaignInput = {
      client_id: clientId,
      project_id: projectId,
      name: name.trim(),
      objective: objective.trim(),
      channel,
      status,
      budget: parsedBudget,
      currency,
      utm_campaign: normalizeUtmToken(utmCampaign),
      start_date: startDate || null,
      end_date: endDate || null,
    };
    try {
      await createCampaign.mutateAsync(payload);
      toast.success("Campanha criada.");
      onClose();
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ScopeFields
        clients={clients}
        projects={projects}
        clientId={clientId}
        projectId={projectId}
        onClientChange={(value) => {
          setClientId(value);
          setProjectId("");
        }}
        onProjectChange={setProjectId}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="analytics-campaign-name" label="Nome" required>
          <Input
            id="analytics-campaign-name"
            value={name}
            onChange={(event) => handleNameChange(event.target.value)}
            className="min-h-11"
            autoComplete="off"
            maxLength={160}
          />
        </Field>
        <Field
          id="analytics-campaign-utm"
          label="utm_campaign"
          required
          helper="Use um nome estável. Os links guardam um snapshot."
        >
          <Input
            id="analytics-campaign-utm"
            value={utmCampaign}
            onChange={(event) => {
              setUtmTouched(true);
              setUtmCampaign(event.target.value);
            }}
            className="min-h-11 font-mono"
            autoComplete="off"
            maxLength={100}
          />
        </Field>
      </div>
      <Field id="analytics-campaign-objective" label="Objetivo" required>
        <Textarea
          id="analytics-campaign-objective"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          className="min-h-24 resize-y"
          placeholder="Ex.: gerar pedidos de diagnóstico para o comercial"
          maxLength={500}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="analytics-campaign-channel" label="Canal" required>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger id="analytics-campaign-channel" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {channelOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="analytics-campaign-status" label="Status" required>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="analytics-campaign-status" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Rascunho</SelectItem>
              <SelectItem value="active">Ativa</SelectItem>
              <SelectItem value="paused">Pausada</SelectItem>
              <SelectItem value="completed">Concluída</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id="analytics-campaign-budget" label="Orçamento" required>
          <div className="flex">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger
                className="min-h-11 w-[88px] rounded-r-none border-r-0"
                aria-label="Moeda do orçamento"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BRL">BRL</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
              </SelectContent>
            </Select>
            <Input
              id="analytics-campaign-budget"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              className="min-h-11 rounded-l-none"
            />
          </div>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="analytics-campaign-start" label="Início">
          <Input
            id="analytics-campaign-start"
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(event) => setStartDate(event.target.value)}
            className="min-h-11"
          />
        </Field>
        <Field id="analytics-campaign-end" label="Fim">
          <Input
            id="analytics-campaign-end"
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(event) => setEndDate(event.target.value)}
            className="min-h-11"
          />
        </Field>
      </div>
      <FormError message={error} />
      <FormActions
        pending={createCampaign.isPending}
        onCancel={onClose}
        submitLabel="Criar campanha"
      />
    </form>
  );
}

function UtmForm({
  clients,
  projects,
  campaigns,
  defaultCampaignId,
  onClose,
}: Pick<
  AnalyticsActionsProps,
  "clients" | "projects" | "campaigns" | "defaultCampaignId" | "onClose"
>) {
  const { createUtmLink } = useAnalyticsMutations();
  const [campaignId, setCampaignId] = useState(defaultCampaignId || "");
  const [name, setName] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const campaign = campaigns.find((item) => item.id === campaignId);
  const built = buildUtmUrl({
    destinationUrl,
    source,
    medium,
    campaign: campaign?.utm_campaign || "",
    content,
    term,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!campaign || !name.trim()) {
      setError("Selecione a campanha e dê um nome ao link.");
      return;
    }
    if (!built.url) {
      setError(built.error);
      return;
    }
    const payload: CreateUtmLinkInput = {
      campaign_id: campaign.id,
      client_id: campaign.client_id,
      project_id: campaign.project_id,
      name: name.trim(),
      destination_url: destinationUrl.trim(),
      utm_source: built.normalized.source,
      utm_medium: built.normalized.medium,
      utm_campaign: built.normalized.campaign,
      utm_content: built.normalized.content || null,
      utm_term: built.normalized.term || null,
    };
    try {
      await createUtmLink.mutateAsync(payload);
      toast.success("Link UTM criado.");
      onClose();
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="analytics-utm-campaign" label="Campanha" required>
          <Select
            value={campaignId || undefined}
            onValueChange={setCampaignId}
          >
            <SelectTrigger id="analytics-utm-campaign" className="min-h-11">
              <SelectValue placeholder="Selecione a campanha" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {scopedOptionLabel(
                    item.name,
                    item.client_id,
                    item.project_id,
                    clients,
                    projects,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="analytics-utm-name" label="Nome do link" required>
          <Input
            id="analytics-utm-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-h-11"
            placeholder="Ex.: Story 01, prova social"
            maxLength={160}
          />
        </Field>
      </div>
      <Field
        id="analytics-utm-destination"
        label="URL de destino"
        required
        helper="Aceita somente http(s) e preserva parâmetros já existentes."
      >
        <Input
          id="analytics-utm-destination"
          type="url"
          inputMode="url"
          value={destinationUrl}
          onChange={(event) => setDestinationUrl(event.target.value)}
          className="min-h-11"
          placeholder="https://site.com.br/pagina?ref=perfil"
          maxLength={2048}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="analytics-utm-source" label="utm_source" required>
          <Input
            id="analytics-utm-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="min-h-11 font-mono"
            placeholder="instagram"
            maxLength={100}
          />
        </Field>
        <Field id="analytics-utm-medium" label="utm_medium" required>
          <Input
            id="analytics-utm-medium"
            value={medium}
            onChange={(event) => setMedium(event.target.value)}
            className="min-h-11 font-mono"
            placeholder="social-pago"
            maxLength={100}
          />
        </Field>
        <Field id="analytics-utm-content" label="utm_content">
          <Input
            id="analytics-utm-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-11 font-mono"
            placeholder="criativo-a"
            maxLength={120}
          />
        </Field>
        <Field id="analytics-utm-term" label="utm_term">
          <Input
            id="analytics-utm-term"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="min-h-11 font-mono"
            placeholder="opcional"
            maxLength={120}
          />
        </Field>
      </div>
      <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
          Link final
        </div>
        <p className="mt-2 min-h-10 break-all font-mono text-[11px] leading-5 text-muted-foreground">
          {built.url ||
            (destinationUrl
              ? built.error
              : "Preencha os campos para gerar o link em tempo real.")}
        </p>
      </div>
      <FormError message={error} />
      <FormActions
        pending={createUtmLink.isPending}
        onCancel={onClose}
        submitLabel="Criar link"
      />
    </form>
  );
}

function DefinitionForm({
  clients,
  projects,
  definitions,
  defaultClientId,
  defaultProjectId,
  onClose,
}: Pick<
  AnalyticsActionsProps,
  | "clients"
  | "projects"
  | "definitions"
  | "defaultClientId"
  | "defaultProjectId"
  | "onClose"
>) {
  const { createDefinition } = useAnalyticsMutations();
  const [clientId, setClientId] = useState(defaultClientId || "");
  const [projectId, setProjectId] = useState(defaultProjectId || "");
  const [name, setName] = useState("");
  const [eventKey, setEventKey] = useState("");
  const [conversionType, setConversionType] = useState("lead");
  const [isPrimary, setIsPrimary] = useState(false);
  const [countsAsRevenue, setCountsAsRevenue] = useState(false);
  const [defaultValue, setDefaultValue] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [funnelOrder, setFunnelOrder] = useState(
    String(Math.min(99, Math.max(1, definitions.length + 1))),
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsedOrder = Number(funnelOrder);
    const parsedValue =
      defaultValue.trim() === ""
        ? null
        : Number(defaultValue.replace(",", "."));
    if (!clientId || !projectId || !name.trim() || !eventKey.trim()) {
      setError("Preencha cliente, projeto, nome e chave do evento.");
      return;
    }
    if (
      !Number.isInteger(parsedOrder) ||
      parsedOrder < 1 ||
      parsedOrder > 99
    ) {
      setError("A ordem do funil deve ser um número inteiro entre 1 e 99.");
      return;
    }
    if (
      parsedValue !== null &&
      (!Number.isFinite(parsedValue) || parsedValue < 0)
    ) {
      setError("Informe um valor padrão válido e não negativo.");
      return;
    }
    const normalizedEventKey = eventKey
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!normalizedEventKey) {
      setError("A chave do evento precisa ter letras ou números.");
      return;
    }
    const payload: CreateDefinitionInput = {
      client_id: clientId,
      project_id: projectId,
      name: name.trim(),
      event_key: normalizedEventKey,
      conversion_type: conversionType,
      is_primary: isPrimary,
      counts_as_revenue: countsAsRevenue,
      default_value: countsAsRevenue ? parsedValue : null,
      currency,
      funnel_order: parsedOrder,
    };
    try {
      await createDefinition.mutateAsync(payload);
      toast.success("Definição criada.");
      onClose();
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ScopeFields
        clients={clients}
        projects={projects}
        clientId={clientId}
        projectId={projectId}
        onClientChange={(value) => {
          setClientId(value);
          setProjectId("");
        }}
        onProjectChange={setProjectId}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="analytics-definition-name" label="Nome" required>
          <Input
            id="analytics-definition-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-h-11"
            placeholder="Ex.: Compra concluída"
            maxLength={160}
          />
        </Field>
        <Field
          id="analytics-definition-key"
          label="Chave do evento"
          required
          helper="Identificador técnico estável, sem espaços."
        >
          <Input
            id="analytics-definition-key"
            value={eventKey}
            onChange={(event) => setEventKey(event.target.value)}
            className="min-h-11 font-mono"
            placeholder="purchase"
            maxLength={100}
          />
        </Field>
        <Field id="analytics-definition-type" label="Tipo" required>
          <Select
            value={conversionType}
            onValueChange={setConversionType}
          >
            <SelectTrigger id="analytics-definition-type" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {conversionTypeOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="analytics-definition-order" label="Ordem no funil" required>
          <Input
            id="analytics-definition-order"
            type="number"
            min="1"
            max="99"
            step="1"
            inputMode="numeric"
            value={funnelOrder}
            onChange={(event) => setFunnelOrder(event.target.value)}
            className="min-h-11"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-h-16 items-center justify-between gap-4 rounded-xl border border-border bg-muted/20 px-4 py-3">
          <div>
            <Label htmlFor="analytics-definition-primary">
              Conversão primária
            </Label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Entra no cálculo de CVR e CPA
            </p>
          </div>
          <Switch
            id="analytics-definition-primary"
            checked={isPrimary}
            onCheckedChange={setIsPrimary}
          />
        </div>
        <div className="flex min-h-16 items-center justify-between gap-4 rounded-xl border border-border bg-muted/20 px-4 py-3">
          <div>
            <Label htmlFor="analytics-definition-revenue">
              Conta como receita
            </Label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Entra no cálculo de receita e ROAS
            </p>
          </div>
          <Switch
            id="analytics-definition-revenue"
            checked={countsAsRevenue}
            onCheckedChange={setCountsAsRevenue}
          />
        </div>
      </div>

      {countsAsRevenue && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="analytics-definition-value"
            label="Valor padrão"
            helper="Opcional. Pode ser substituído no evento manual."
          >
            <Input
              id="analytics-definition-value"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={defaultValue}
              onChange={(event) => setDefaultValue(event.target.value)}
              className="min-h-11"
            />
          </Field>
          <Field id="analytics-definition-currency" label="Moeda">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger
                id="analytics-definition-currency"
                className="min-h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BRL">BRL</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}
      <FormError message={error} />
      <FormActions
        pending={createDefinition.isPending}
        onCancel={onClose}
        submitLabel="Criar definição"
      />
    </form>
  );
}

function EventForm({
  clients,
  projects,
  definitions,
  campaigns,
  utmLinks,
  defaultClientId,
  defaultProjectId,
  defaultCampaignId,
  onClose,
}: Pick<
  AnalyticsActionsProps,
  | "clients"
  | "projects"
  | "definitions"
  | "campaigns"
  | "utmLinks"
  | "defaultClientId"
  | "defaultProjectId"
  | "defaultCampaignId"
  | "onClose"
>) {
  const { createEvent } = useAnalyticsMutations();
  const scopedDefinitions = definitions.filter((definition) => {
    if (defaultClientId && definition.client_id !== defaultClientId) return false;
    if (defaultProjectId && definition.project_id !== defaultProjectId) {
      return false;
    }
    return definition.active;
  });
  const [definitionId, setDefinitionId] = useState("");
  const definition = scopedDefinitions.find(
    (item) => item.id === definitionId,
  );
  const visibleCampaigns = definition
    ? campaigns.filter(
        (campaign) =>
          campaign.client_id === definition.client_id &&
          campaign.project_id === definition.project_id,
      )
    : [];
  const defaultCampaign = campaigns.find(
    (campaign) => campaign.id === defaultCampaignId,
  );
  const [campaignId, setCampaignId] = useState("");
  const visibleUtmLinks = utmLinks.filter(
    (utmLink) => utmLink.campaign_id === campaignId && utmLink.active,
  );
  const [utmLinkId, setUtmLinkId] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [occurredAt, setOccurredAt] = useState(
    analyticsDateTimeLocalValue(),
  );
  const [externalId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);

  const handleDefinitionChange = (selectedId: string) => {
    setDefinitionId(selectedId);
    const selected = definitions.find((item) => item.id === selectedId);
    setValue("");
    setCurrency(selected?.currency || "BRL");
    setCampaignId(
      selected &&
        defaultCampaign &&
        defaultCampaign.client_id === selected.client_id &&
        defaultCampaign.project_id === selected.project_id
        ? defaultCampaign.id
        : "",
    );
    setUtmLinkId("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const occurredAtIso = analyticsDateTimeLocalToIso(occurredAt);
    if (!definition || !occurredAtIso) {
      setError("Selecione a definição e informe a data do evento.");
      return;
    }
    const parsedValue =
      value.trim() === "" ? undefined : Number(value.replace(",", "."));
    if (
      parsedValue !== undefined &&
      (!Number.isFinite(parsedValue) || parsedValue < 0)
    ) {
      setError(
        "Informe um valor válido e não negativo ou deixe em branco para herdar o padrão.",
      );
      return;
    }
    const payload: CreateEventInput = {
      client_id: definition.client_id,
      project_id: definition.project_id,
      campaign_id: campaignId || null,
      utm_link_id: utmLinkId || null,
      definition_id: definition.id,
      external_id: externalId,
      occurred_at: occurredAtIso,
      ...(parsedValue === undefined
        ? {}
        : { value: parsedValue, currency }),
    };
    try {
      await createEvent.mutateAsync(payload);
      toast.success("Conversão registrada.");
      onClose();
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
        <div className="flex gap-3">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <p className="text-xs leading-5 text-muted-foreground">
            Não registre nome, telefone, e-mail, documento ou texto livre sobre
            a pessoa. Este formulário mede o evento, não guarda o lead.
          </p>
        </div>
      </div>
      <Field id="analytics-event-definition" label="Conversão" required>
        <Select
          value={definitionId || undefined}
          onValueChange={handleDefinitionChange}
        >
          <SelectTrigger id="analytics-event-definition" className="min-h-11">
            <SelectValue placeholder="Selecione a definição" />
          </SelectTrigger>
          <SelectContent>
            {scopedDefinitions.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {scopedOptionLabel(
                  item.name,
                  item.client_id,
                  item.project_id,
                  clients,
                  projects,
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="analytics-event-campaign" label="Campanha">
          <Select
            value={campaignId || UNSET}
            onValueChange={(selected) => {
              setCampaignId(selected === UNSET ? "" : selected);
              setUtmLinkId("");
            }}
            disabled={!definition}
          >
            <SelectTrigger id="analytics-event-campaign" className="min-h-11">
              <SelectValue placeholder="Sem campanha" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Sem campanha</SelectItem>
              {visibleCampaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="analytics-event-utm" label="Link UTM">
          <Select
            value={utmLinkId || UNSET}
            onValueChange={(selected) =>
              setUtmLinkId(selected === UNSET ? "" : selected)
            }
            disabled={!campaignId}
          >
            <SelectTrigger id="analytics-event-utm" className="min-h-11">
              <SelectValue placeholder="Sem link específico" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Sem link específico</SelectItem>
              {visibleUtmLinks.map((utmLink) => (
                <SelectItem key={utmLink.id} value={utmLink.id}>
                  {utmLink.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="analytics-event-date" label="Data e hora" required>
          <Input
            id="analytics-event-date"
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            className="min-h-11"
          />
        </Field>
        <Field
          id="analytics-event-value"
          label="Valor"
          helper={
            definition?.default_value !== null &&
            definition?.default_value !== undefined
              ? `Em branco herda ${definition.currency} ${definition.default_value}.`
              : "Deixe em branco quando não houver receita."
          }
        >
          <div className="flex">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger
                className="min-h-11 w-[88px] rounded-r-none border-r-0"
                aria-label="Moeda da conversão"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BRL">BRL</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
              </SelectContent>
            </Select>
            <Input
              id="analytics-event-value"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="min-h-11 rounded-l-none"
            />
          </div>
        </Field>
      </div>
      <FormError message={error} />
      <FormActions
        pending={createEvent.isPending}
        onCancel={onClose}
        submitLabel="Registrar evento"
      />
    </form>
  );
}

function MetricsForm({
  clients,
  projects,
  campaigns,
  utmLinks,
  defaultClientId,
  defaultProjectId,
  defaultCampaignId,
  onClose,
}: Pick<
  AnalyticsActionsProps,
  | "clients"
  | "projects"
  | "campaigns"
  | "utmLinks"
  | "defaultClientId"
  | "defaultProjectId"
  | "defaultCampaignId"
  | "onClose"
>) {
  const { createMetricBatch } = useAnalyticsMutations();
  const [clientId, setClientId] = useState(defaultClientId || "");
  const [projectId, setProjectId] = useState(defaultProjectId || "");
  const visibleCampaigns = campaigns.filter(
    (campaign) =>
      campaign.client_id === clientId && campaign.project_id === projectId,
  );
  const [campaignId, setCampaignId] = useState(defaultCampaignId || "");
  const [currency, setCurrency] = useState(
    campaigns.find((campaign) => campaign.id === defaultCampaignId)
      ?.currency || "BRL",
  );
  const visibleUtmLinks = utmLinks.filter(
    (utmLink) => utmLink.campaign_id === campaignId && utmLink.active,
  );
  const [utmLinkId, setUtmLinkId] = useState("");
  const today = analyticsDateTimeLocalValue().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(today);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [values, setValues] = useState<Record<string, string>>({
    ad_spend: "",
    impressions: "",
    clicks: "",
    sessions: "",
  });
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!clientId || !projectId) {
      setError("Selecione cliente e projeto.");
      return;
    }
    if (!periodStart || !periodEnd || periodStart > periodEnd) {
      setError("Informe um período válido.");
      return;
    }
    const metrics = metricOptions.flatMap(([metricKey]) => {
      const raw = values[metricKey]?.trim();
      if (!raw) return [];
      const metricValue = Number(raw.replace(",", "."));
      return Number.isFinite(metricValue) && metricValue >= 0
        ? [{ metric_key: metricKey, metric_value: metricValue }]
        : [];
    });
    const filledCount = metricOptions.filter(
      ([metricKey]) => values[metricKey]?.trim(),
    ).length;
    if (!metrics.length) {
      setError("Preencha pelo menos uma métrica.");
      return;
    }
    if (metrics.length !== filledCount) {
      setError("Todas as métricas preenchidas precisam ser números válidos.");
      return;
    }
    const payload: CreateMetricBatchInput = {
      client_id: clientId,
      project_id: projectId,
      campaign_id: campaignId || null,
      utm_link_id: utmLinkId || null,
      period_start: periodStart,
      period_end: periodEnd,
      captured_at: new Date().toISOString(),
      currency,
      metrics,
    };
    try {
      await createMetricBatch.mutateAsync(payload);
      toast.success(
        `${metrics.length} ${metrics.length === 1 ? "métrica lançada" : "métricas lançadas"}.`,
      );
      onClose();
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ScopeFields
        clients={clients}
        projects={projects}
        clientId={clientId}
        projectId={projectId}
        onClientChange={(value) => {
          setClientId(value);
          setProjectId("");
          setCampaignId("");
          setUtmLinkId("");
        }}
        onProjectChange={(value) => {
          setProjectId(value);
          setCampaignId("");
          setUtmLinkId("");
        }}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="analytics-metric-campaign" label="Campanha">
          <Select
            value={campaignId || UNSET}
            onValueChange={(selected) => {
              const nextCampaignId = selected === UNSET ? "" : selected;
              setCampaignId(nextCampaignId);
              const selectedCampaign = campaigns.find(
                (campaign) => campaign.id === nextCampaignId,
              );
              if (selectedCampaign) setCurrency(selectedCampaign.currency);
              setUtmLinkId("");
            }}
            disabled={!projectId}
          >
            <SelectTrigger id="analytics-metric-campaign" className="min-h-11">
              <SelectValue placeholder="Sem campanha" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Sem campanha</SelectItem>
              {visibleCampaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          id="analytics-metric-currency"
          label="Moeda"
          helper="O painel não soma moedas diferentes."
        >
          <Select
            value={currency}
            onValueChange={setCurrency}
            disabled={Boolean(campaignId)}
          >
            <SelectTrigger
              id="analytics-metric-currency"
              className="min-h-11"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BRL">BRL</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id="analytics-metric-utm" label="Link UTM">
          <Select
            value={utmLinkId || UNSET}
            onValueChange={(selected) =>
              setUtmLinkId(selected === UNSET ? "" : selected)
            }
            disabled={!campaignId}
          >
            <SelectTrigger id="analytics-metric-utm" className="min-h-11">
              <SelectValue placeholder="Sem link específico" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Sem link específico</SelectItem>
              {visibleUtmLinks.map((utmLink) => (
                <SelectItem key={utmLink.id} value={utmLink.id}>
                  {utmLink.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="analytics-metric-start" label="Início do período" required>
          <Input
            id="analytics-metric-start"
            type="date"
            value={periodStart}
            max={periodEnd}
            onChange={(event) => setPeriodStart(event.target.value)}
            className="min-h-11"
          />
        </Field>
        <Field id="analytics-metric-end" label="Fim do período" required>
          <Input
            id="analytics-metric-end"
            type="date"
            value={periodEnd}
            min={periodStart}
            onChange={(event) => setPeriodEnd(event.target.value)}
            className="min-h-11"
          />
        </Field>
      </div>
      <fieldset className="rounded-xl border border-border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          Métricas do lote
        </legend>
        <p className="mb-4 text-[11px] leading-4 text-muted-foreground">
          Se sessões estiverem presentes, o painel usa sessões como tráfego e
          não soma cliques.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {metricOptions.map(([metricKey, label]) => {
            const prefix = metricKey === "ad_spend" ? currency : "";
            return (
              <Field
                key={metricKey}
                id={`analytics-metric-${metricKey}`}
                label={label}
              >
                <div className="relative">
                  {prefix && (
                  <span className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground">
                    {prefix}
                  </span>
                  )}
                  <Input
                    id={`analytics-metric-${metricKey}`}
                    type="number"
                    min="0"
                    step={metricKey === "ad_spend" ? "0.01" : "1"}
                    inputMode={
                      metricKey === "ad_spend" ? "decimal" : "numeric"
                    }
                    value={values[metricKey]}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [metricKey]: event.target.value,
                      }))
                    }
                    className={`min-h-11 ${prefix ? "pl-12" : ""}`}
                  />
                </div>
              </Field>
            );
          })}
        </div>
      </fieldset>
      <FormError message={error} />
      <FormActions
        pending={createMetricBatch.isPending}
        onCancel={onClose}
        submitLabel="Salvar lote"
      />
    </form>
  );
}

export default function AnalyticsActions({
  action,
  onClose,
  clients,
  projects,
  campaigns,
  definitions,
  utmLinks,
  defaultClientId,
  defaultProjectId,
  defaultCampaignId,
}: AnalyticsActionsProps) {
  const meta = action ? actionMeta[action] : null;
  const content = useMemo(() => {
    if (!action) return null;
    const common = { onClose };
    if (action === "campaign") {
      return (
        <CampaignForm
          {...common}
          clients={clients}
          projects={projects}
          defaultClientId={defaultClientId}
          defaultProjectId={defaultProjectId}
        />
      );
    }
    if (action === "utm") {
      return (
        <UtmForm
          {...common}
          clients={clients}
          projects={projects}
          campaigns={campaigns}
          defaultCampaignId={defaultCampaignId}
        />
      );
    }
    if (action === "definition") {
      return (
        <DefinitionForm
          {...common}
          clients={clients}
          projects={projects}
          definitions={definitions}
          defaultClientId={defaultClientId}
          defaultProjectId={defaultProjectId}
        />
      );
    }
    if (action === "event") {
      return (
        <EventForm
          {...common}
          clients={clients}
          projects={projects}
          definitions={definitions}
          campaigns={campaigns}
          utmLinks={utmLinks}
          defaultClientId={defaultClientId}
          defaultProjectId={defaultProjectId}
          defaultCampaignId={defaultCampaignId}
        />
      );
    }
    return (
      <MetricsForm
        {...common}
        clients={clients}
        projects={projects}
        campaigns={campaigns}
        utmLinks={utmLinks}
        defaultClientId={defaultClientId}
        defaultProjectId={defaultProjectId}
        defaultCampaignId={defaultCampaignId}
      />
    );
  }, [
    action,
    campaigns,
    clients,
    defaultCampaignId,
    defaultClientId,
    defaultProjectId,
    definitions,
    onClose,
    projects,
    utmLinks,
  ]);

  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-2xl overflow-y-auto p-0 motion-reduce:animate-none motion-reduce:transition-none sm:w-full">
        {meta && (
          <>
            <DialogHeader className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 py-4 pr-12 text-left backdrop-blur sm:px-6">
              <DialogTitle>{meta.title}</DialogTitle>
              <DialogDescription>{meta.description}</DialogDescription>
            </DialogHeader>
            <div className="px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-5 sm:px-6">
              {content}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
