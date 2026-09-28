import type { ReactNode } from "react";
import {
  CalendarDays,
  CalendarPlus2,
  ChevronLeft,
  ChevronRight,
  Columns3,
  List,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
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
import { SeletorCompacto, botao, campo, juntar, texto } from "@/components/sistema";

export type EditorialView = "board" | "month" | "week" | "list";

interface SelectOption {
  value: string;
  label: string;
}

interface EditorialToolbarProps {
  /** Título da página (h1 + "?" + resumo): a primeira linha começa por ele. */
  cabecalho?: ReactNode;
  /** No quadro de conteúdos (sem período), o que vai no começo da segunda linha. */
  inicioDaLinha?: ReactNode;
  title: string;
  view: EditorialView;
  search: string;
  clientId: string;
  projectId: string;
  format: string;
  platform: string;
  status: string;
  productionStatus: string;
  approvalStatus: string;
  responsibleId: string;
  clients: SelectOption[];
  projects: SelectOption[];
  formats: SelectOption[];
  platforms: SelectOption[];
  statuses: SelectOption[];
  productionStatuses: SelectOption[];
  approvalStatuses: SelectOption[];
  responsibles: SelectOption[];
  canCreate: boolean;
  canSchedule: boolean;
  onViewChange: (view: EditorialView) => void;
  onSearchChange: (value: string) => void;
  onClientChange: (value: string) => void;
  onProjectChange: (value: string) => void;
  onFormatChange: (value: string) => void;
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
  onSchedule: () => void;
}

const agendaViewOptions: Array<{
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
        className={juntar(
          "h-9 w-full min-w-0 bg-background text-[13px]",
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

function CampoDoFiltro({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={juntar(texto.rotulo, "mb-1")}>{rotulo}</p>
      {children}
    </div>
  );
}

/**
 * Barra da Agenda editorial (frente E4, 26/09): duas linhas, sem caixa em
 * volta. Linha 1: título, área (Agenda ou Conteúdos) e a ação principal.
 * Linha 2: período e visão à esquerda; busca, cliente, projeto e o seletor
 * "Filtros" (formato, plataforma, publicação, etapa, aprovação e
 * responsável) à direita. No celular, cliente e projeto moram no "Filtros".
 */
export default function EditorialToolbar({
  cabecalho,
  inicioDaLinha,
  title,
  view,
  search,
  clientId,
  projectId,
  format,
  platform,
  status,
  productionStatus,
  approvalStatus,
  responsibleId,
  clients,
  projects,
  formats,
  platforms,
  statuses,
  productionStatuses,
  approvalStatuses,
  responsibles,
  canCreate,
  canSchedule,
  onViewChange,
  onSearchChange,
  onClientChange,
  onProjectChange,
  onFormatChange,
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
  onSchedule,
}: EditorialToolbarProps) {
  const isActiveFilter = (value: string) =>
    Boolean(value && value !== "all");
  const advancedFilterCount = [
    format,
    platform,
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
      format,
      platform,
      status,
      productionStatus,
      approvalStatus,
      responsibleId,
    ].some(isActiveFilter);

  return (
    <div className="min-w-0">
      {/* Linha 1: título e ações */}
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <div className="mb-3 mr-3 min-w-0 flex-1">{cabecalho}</div>
        <div className="mb-3 flex shrink-0 items-center [&>*+*]:ml-2">
          <SeletorCompacto
            className="hidden sm:inline-flex"
            rotulo="Área editorial"
            opcoes={[
              { valor: "agenda", rotulo: "Agenda", icone: <CalendarDays className="h-3.5 w-3.5" /> },
              { valor: "board", rotulo: "Conteúdos", icone: <Columns3 className="h-3.5 w-3.5" /> },
            ]}
            valor={view === "board" ? "board" : "agenda"}
            onEscolher={(v) => onViewChange(v === "board" ? "board" : "month")}
          />

          {view === "board" && canCreate && (
            <button
              type="button"
              className={botao.primario}
              onClick={onCreate}
              aria-label="Criar conteúdo"
            >
              <Columns3 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Criar conteúdo</span>
            </button>
          )}

          {view !== "board" && canSchedule && (
            <button
              type="button"
              className={botao.primario}
              onClick={onSchedule}
              aria-label="Agendar publicação"
            >
              <CalendarPlus2 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Agendar publicação</span>
            </button>
          )}
        </div>
      </div>

      {/* Linha 2: período e visão | busca e filtros */}
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <div className="mb-2 mr-3 flex min-w-0 flex-wrap items-center">
          {view !== "board" ? (
            <>
              <div className="mr-2 flex shrink-0 items-center rounded-md border border-border">
                <button
                  type="button"
                  className={juntar(botao.icone, "h-9 w-9 rounded-r-none")}
                  onClick={onPrevious}
                  aria-label="Período anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={juntar(botao.discreto, "rounded-none border-x border-border px-3 text-foreground")}
                  onClick={onToday}
                >
                  Hoje
                </button>
                <button
                  type="button"
                  className={juntar(botao.icone, "h-9 w-9 rounded-l-none")}
                  onClick={onNext}
                  aria-label="Próximo período"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <h2 className={juntar(texto.tituloSecao, "mr-3 min-w-0 truncate first-letter:uppercase")}>
                {title}
              </h2>
              <SeletorCompacto
                rotulo="Visualização da agenda"
                opcoes={agendaViewOptions.map((option) => ({
                  valor: option.value,
                  rotulo: option.label,
                  icone: <option.icon className="h-3.5 w-3.5" />,
                }))}
                valor={view}
                onEscolher={(v) => onViewChange(v as EditorialView)}
                className="hidden sm:inline-flex"
              />
            </>
          ) : (
            inicioDaLinha
          )}
        </div>

        {/* No tablet a busca e os filtros dividem a linha com o período (sem uma
            terceira linha); só quebram quando não cabem mesmo. */}
        <div className="mb-2 flex w-full min-w-0 items-center sm:w-auto sm:flex-1 sm:justify-end">
          {/* Celular: área e visão num seletor só (a linha do título não comporta os dois segmentados). */}
          <div className="mr-2 shrink-0 sm:hidden">
            <SeletorCompacto
              rotulo="Visão"
              modo="lista"
              opcoes={[
                ...agendaViewOptions.map((option) => ({
                  valor: option.value,
                  rotulo: option.label,
                  icone: <option.icon className="h-3.5 w-3.5" />,
                })),
                { valor: "board", rotulo: "Conteúdos", icone: <Columns3 className="h-3.5 w-3.5" /> },
              ]}
              valor={view}
              onEscolher={(v) => onViewChange(v as EditorialView)}
            />
          </div>
          <div className="relative mr-2 min-w-0 flex-1 lg:w-[220px] lg:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar conteúdo"
              aria-label="Buscar conteúdo, legenda ou conta"
              className={juntar(campo, "pl-9")}
            />
          </div>
          {clients.length > 0 && (
            <div className="mr-2 hidden w-[170px] shrink-0 sm:block">
              <FilterSelect
                value={clientId}
                label="Todos os clientes"
                options={clients}
                onChange={onClientChange}
              />
            </div>
          )}
          <div className="mr-2 hidden w-[170px] shrink-0 sm:block">
            <FilterSelect
              value={projectId}
              label="Todos os projetos"
              options={projects}
              onChange={onProjectChange}
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={juntar(botao.secundario, "px-2.5")}
                aria-label={`Mais filtros, ${advancedFilterCount} ${
                  advancedFilterCount === 1 ? "ativo" : "ativos"
                }`}
              >
                <SlidersHorizontal className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Filtros</span>
                {advancedFilterCount > 0 && (
                  <span
                    className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums text-primary-foreground"
                    aria-hidden="true"
                  >
                    {advancedFilterCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[calc(100vw-24px)] max-w-[380px] p-3"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className={texto.tituloSecao}>Filtros</p>
                <button
                  type="button"
                  className={juntar(botao.discreto, "h-8 px-2 text-[12px]")}
                  onClick={onClearFilters}
                  disabled={!hasAnyActiveFilter}
                >
                  <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Limpar
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* No celular cliente e projeto moram aqui (a linha não comporta). */}
                {clients.length > 0 && (
                  <div className="sm:hidden">
                    <CampoDoFiltro rotulo="Cliente">
                      <FilterSelect value={clientId} label="Todos os clientes" options={clients} onChange={onClientChange} />
                    </CampoDoFiltro>
                  </div>
                )}
                <div className="sm:hidden">
                  <CampoDoFiltro rotulo="Projeto">
                    <FilterSelect value={projectId} label="Todos os projetos" options={projects} onChange={onProjectChange} />
                  </CampoDoFiltro>
                </div>
                <CampoDoFiltro rotulo="Formato">
                  <FilterSelect value={format} label="Todos os formatos" options={formats} onChange={onFormatChange} />
                </CampoDoFiltro>
                <CampoDoFiltro rotulo="Plataforma">
                  <FilterSelect value={platform} label="Todas as plataformas" options={platforms} onChange={onPlatformChange} />
                </CampoDoFiltro>
                <CampoDoFiltro rotulo="Publicação">
                  <FilterSelect value={status} label="Todas as publicações" options={statuses} onChange={onStatusChange} />
                </CampoDoFiltro>
                <CampoDoFiltro rotulo="Etapa de produção">
                  <FilterSelect value={productionStatus} label="Todas as etapas" options={productionStatuses} onChange={onProductionStatusChange} />
                </CampoDoFiltro>
                <CampoDoFiltro rotulo="Aprovação">
                  <FilterSelect value={approvalStatus} label="Toda aprovação" options={approvalStatuses} onChange={onApprovalStatusChange} />
                </CampoDoFiltro>
                {responsibles.length > 0 && (
                  <CampoDoFiltro rotulo="Responsável">
                    <FilterSelect value={responsibleId} label="Todos os responsáveis" options={responsibles} onChange={onResponsibleChange} />
                  </CampoDoFiltro>
                )}
              </div>
            </PopoverContent>
          </Popover>
          {hasAnyActiveFilter && (
            <button
              type="button"
              onClick={onClearFilters}
              className={juntar(botao.icone, "ml-1")}
              aria-label="Limpar filtros"
              title="Limpar filtros"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
