import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  List,
  Plus,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type EditorialView = "board" | "month" | "week" | "list";

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
  onClearFilters: () => void;
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
  { value: "board", label: "Produção", icon: Columns3 },
  { value: "month", label: "Mês", icon: CalendarDays },
  { value: "week", label: "Semana", icon: Rows3 },
  { value: "list", label: "Lista", icon: List },
];

function FilterSelect({
  value,
  label,
  options,
  onChange,
  className,
}: {
  value: string;
  label: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          "h-11 w-full min-w-0 bg-background sm:h-9",
          className,
        )}
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
  onClearFilters,
  onPrevious,
  onToday,
  onNext,
  onCreate,
}: EditorialToolbarProps) {
  const isActiveFilter = (value: string) =>
    Boolean(value && value !== "all");
  const advancedFilterCount = [
    status,
    productionStatus,
    approvalStatus,
    responsibleId,
  ].filter(isActiveFilter).length;
  const hasAnyActiveFilter =
    Boolean(search.trim()) ||
    [
      clientId,
      projectId,
      platform,
      status,
      productionStatus,
      approvalStatus,
      responsibleId,
    ].some(isActiveFilter);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/70 p-3 lg:flex-row lg:items-center lg:justify-between sm:p-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {view !== "board" && (
            <div className="flex shrink-0 items-center rounded-lg border border-border bg-background">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-10 rounded-r-none sm:h-9 sm:w-9"
                onClick={onPrevious}
                aria-label="Período anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 rounded-none border-x border-border px-3 text-xs sm:h-9"
                onClick={onToday}
              >
                Hoje
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-10 rounded-l-none sm:h-9 sm:w-9"
                onClick={onNext}
                aria-label="Próximo período"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          <h2 className="min-w-0 truncate text-base font-semibold text-foreground sm:text-lg">
            {title}
          </h2>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div
            className="grid h-11 grid-cols-4 rounded-lg border border-border bg-background p-1 sm:h-auto"
            role="group"
            aria-label="Visualização do calendário"
          >
            {viewOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onViewChange(option.value)}
                className={cn(
                  "inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  view === option.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={view === option.value}
                aria-label={`Visualização: ${option.label}`}
              >
                <option.icon className="h-3.5 w-3.5" />
                <span className="hidden min-[520px]:inline">
                  {option.label}
                </span>
              </button>
            ))}
          </div>

          {canCreate && (
            <Button
              type="button"
              size="sm"
              className="h-11 w-full px-4 sm:h-9 sm:w-auto"
              onClick={onCreate}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Novo conteúdo
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card/60 p-3 sm:grid-cols-2 xl:flex xl:items-center">
        <div className="relative min-w-0 sm:col-span-2 xl:min-w-[280px] xl:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar conteúdo, legenda ou conta"
            aria-label="Buscar conteúdo, legenda ou conta"
            className="h-11 bg-background pl-9 sm:h-9"
          />
        </div>
        {clients.length > 0 && (
          <FilterSelect
            value={clientId}
            label="Todos os clientes"
            options={clients}
            onChange={onClientChange}
            className="xl:w-[170px]"
          />
        )}
        <FilterSelect
          value={projectId}
          label="Todos os projetos"
          options={projects}
          onChange={onProjectChange}
          className="xl:w-[170px]"
        />
        <FilterSelect
          value={platform}
          label="Todas as plataformas"
          options={platforms}
          onChange={onPlatformChange}
          className="xl:w-[170px]"
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full justify-start gap-2 bg-background px-3 sm:h-9 xl:w-auto xl:min-w-[142px]"
              aria-label={`Mais filtros, ${advancedFilterCount} ${
                advancedFilterCount === 1 ? "ativo" : "ativos"
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Mais filtros</span>
              <span
                className={cn(
                  "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                  advancedFilterCount > 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                {advancedFilterCount}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[calc(100vw-2rem)] max-w-[360px] rounded-xl p-3"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Mais filtros
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Refine a etapa, aprovação e responsável.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 px-2 text-xs"
                onClick={onClearFilters}
                disabled={!hasAnyActiveFilter}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Limpar
              </Button>
            </div>

            <div className="mt-3 grid gap-3">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">
                  Publicação
                </p>
                <FilterSelect
                  value={status}
                  label="Todas as publicações"
                  options={statuses}
                  onChange={onStatusChange}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">
                  Etapa de produção
                </p>
                <FilterSelect
                  value={productionStatus}
                  label="Todas as etapas"
                  options={productionStatuses}
                  onChange={onProductionStatusChange}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">
                  Aprovação
                </p>
                <FilterSelect
                  value={approvalStatus}
                  label="Toda aprovação"
                  options={approvalStatuses}
                  onChange={onApprovalStatusChange}
                />
              </div>
              {responsibles.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground">
                    Responsável
                  </p>
                  <FilterSelect
                    value={responsibleId}
                    label="Todos os responsáveis"
                    options={responsibles}
                    onChange={onResponsibleChange}
                  />
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
