import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  Plus,
  Search,
  Rows3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type EditorialView = "month" | "week" | "list";

interface SelectOption {
  value: string;
  label: string;
}

interface EditorialToolbarProps {
  title: string;
  view: EditorialView;
  search: string;
  clientId: string;
  projectId: string;
  platform: string;
  status: string;
  productionStatus: string;
  approvalStatus: string;
  responsibleId: string;
  clients: SelectOption[];
  projects: SelectOption[];
  platforms: SelectOption[];
  statuses: SelectOption[];
  productionStatuses: SelectOption[];
  approvalStatuses: SelectOption[];
  responsibles: SelectOption[];
  canCreate: boolean;
  onViewChange: (view: EditorialView) => void;
  onSearchChange: (value: string) => void;
  onClientChange: (value: string) => void;
  onProjectChange: (value: string) => void;
  onPlatformChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onProductionStatusChange: (value: string) => void;
  onApprovalStatusChange: (value: string) => void;
  onResponsibleChange: (value: string) => void;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  onCreate: () => void;
}

const viewOptions: Array<{
  value: EditorialView;
  label: string;
  icon: typeof CalendarDays;
}> = [
  { value: "month", label: "Mês", icon: CalendarDays },
  { value: "week", label: "Semana", icon: Rows3 },
  { value: "list", label: "Lista", icon: List },
];

function FilterSelect({
  value,
  label,
  options,
  onChange,
}: {
  value: string;
  label: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="h-9 min-w-[150px] bg-card"
        aria-label={label}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function EditorialToolbar({
  title,
  view,
  search,
  clientId,
  projectId,
  platform,
  status,
  productionStatus,
  approvalStatus,
  responsibleId,
  clients,
  projects,
  platforms,
  statuses,
  productionStatuses,
  approvalStatuses,
  responsibles,
  canCreate,
  onViewChange,
  onSearchChange,
  onClientChange,
  onProjectChange,
  onPlatformChange,
  onStatusChange,
  onProductionStatusChange,
  onApprovalStatusChange,
  onResponsibleChange,
  onPrevious,
  onToday,
  onNext,
  onCreate,
}: EditorialToolbarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-card">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-r-none"
              onClick={onPrevious}
              aria-label="Período anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-9 rounded-none border-x border-border px-3 text-xs"
              onClick={onToday}
            >
              Hoje
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-l-none"
              onClick={onNext}
              aria-label="Próximo período"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="min-w-0 truncate text-base font-semibold text-foreground sm:text-lg">
            {title}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-border bg-card p-1"
            role="group"
            aria-label="Visualização do calendário"
          >
            {viewOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onViewChange(option.value)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                  view === option.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={view === option.value}
                aria-label={`Visualização: ${option.label}`}
              >
                <option.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            ))}
          </div>

          {canCreate && (
            <Button type="button" size="sm" className="h-9" onClick={onCreate}>
              <Plus className="mr-1.5 h-4 w-4" />
              Novo conteúdo
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/60 p-3 lg:flex-row lg:flex-wrap">
        <div className="relative min-w-0 flex-1 lg:basis-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar conteúdo, legenda ou conta"
            aria-label="Buscar conteúdo, legenda ou conta"
            className="h-9 bg-background pl-9"
          />
        </div>
        {clients.length > 0 && (
          <FilterSelect
            value={clientId}
            label="Todos os clientes"
            options={clients}
            onChange={onClientChange}
          />
        )}
        <FilterSelect
          value={projectId}
          label="Todos os projetos"
          options={projects}
          onChange={onProjectChange}
        />
        <FilterSelect
          value={platform}
          label="Todas as plataformas"
          options={platforms}
          onChange={onPlatformChange}
        />
        <FilterSelect
          value={status}
          label="Todas as publicações"
          options={statuses}
          onChange={onStatusChange}
        />
        <FilterSelect
          value={productionStatus}
          label="Todas as etapas"
          options={productionStatuses}
          onChange={onProductionStatusChange}
        />
        <FilterSelect
          value={approvalStatus}
          label="Toda aprovação"
          options={approvalStatuses}
          onChange={onApprovalStatusChange}
        />
        {responsibles.length > 0 && (
          <FilterSelect
            value={responsibleId}
            label="Todos os responsáveis"
            options={responsibles}
            onChange={onResponsibleChange}
          />
        )}
      </div>
    </div>
  );
}
