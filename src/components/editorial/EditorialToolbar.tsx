import type { ReactNode } from "react";
import {
  CalendarDays,
  CalendarPlus2,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FilePlus2,
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
import { Etapas, botao, campo, juntar, texto } from "@/components/sistema";
import { useCelular } from "@/hooks/useCelular";

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
  /** Período curto para o celular (16/10/2026), ex.: "13–19 out". */
  tituloCurto?: string;
  /** Celular: o "Hoje" só aparece quando o período na tela não contém hoje. */
  mostrarHoje?: boolean;
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

/**
 * Área (Agenda ou Conteúdos) e visão da agenda numa fileira só de ícones
 * (16/10/2026, dono: "mês, semana não precisa escrever, só o ícone"). A
 * Agenda abre no Mês, então o Mês é a própria "Agenda".
 */
const visoes: Array<{
  value: EditorialView;
  label: string;
  icon: typeof CalendarDays;
}> = [
  { value: "month", label: "Mês", icon: CalendarDays },
  { value: "week", label: "Semana", icon: Rows3 },
  { value: "list", label: "Lista", icon: List },
  { value: "board", label: "Conteúdos", icon: Columns3 },
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
 * Barra da Agenda editorial (frente E4, 26/09; uma linha desde 16/10/2026):
 * título, visões em ícone (Mês, Semana, Lista e Conteúdos), período, busca,
 * cliente, projeto, o "Filtros" (formato, plataforma, publicação, etapa,
 * aprovação e responsável) e a ação principal em ícone. Sem caixa nem borda
 * nos botões. Quando a largura não comporta, cliente e projeto moram no
 * "Filtros" e a linha quebra por dentro (nada passa da borda).
 */
export default function EditorialToolbar({
  cabecalho,
  inicioDaLinha,
  title,
  tituloCurto,
  mostrarHoje = true,
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
  const celular = useCelular();

  // O corpo do "Filtros" é o mesmo no computador e no celular (16/10/2026).
  const cabecalhoDosFiltros = (
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
  );
  const gradeDosFiltros = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {/* Cliente e projeto moram aqui quando a linha não comporta. */}
      {clients.length > 0 && (
        <div className="md:hidden">
          <CampoDoFiltro rotulo="Cliente">
            <FilterSelect value={clientId} label="Todos os clientes" options={clients} onChange={onClientChange} />
          </CampoDoFiltro>
        </div>
      )}
      <div className="xl:hidden">
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
  );

  if (celular) {
    // 16/10/2026 (dono: "cara de aplicativo, menos poluído"). Abaixo de
    // 768 px a barra vira duas linhas: título com "Buscar e filtrar" e a ação
    // principal; depois as visões em ícone e o período. A busca, o cliente e
    // o projeto moram dentro do "Buscar e filtrar": nada some, só recolhe.
    const filtrosAtivos = [
      search.trim() ? "q" : "",
      clientId,
      projectId,
      format,
      platform,
      status,
      productionStatus,
      approvalStatus,
      responsibleId,
    ].filter(isActiveFilter).length;
    return (
      <div className="min-w-0">
        <div className="mb-2 flex min-w-0 items-center">
          <div className="min-w-0 flex-1">{cabecalho}</div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={juntar(botao.icone, "relative ml-1 h-11 w-11", filtrosAtivos > 0 && "text-foreground")}
                aria-label={`Buscar e filtrar, ${filtrosAtivos} ${filtrosAtivos === 1 ? "ativo" : "ativos"}`}
                title="Buscar e filtrar"
              >
                <Search className="h-[18px] w-[18px]" aria-hidden="true" />
                {filtrosAtivos > 0 && (
                  <span
                    className="absolute right-1 top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
                    aria-hidden="true"
                  >
                    {filtrosAtivos}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            {/* Janela por cima (como diálogo): pode rolar por dentro quando os
                filtros passam da altura do celular. */}
            <PopoverContent
              align="end"
              className="max-h-[70vh] w-[calc(100vw-24px)] max-w-[380px] overflow-y-auto overscroll-contain p-3"
            >
              {cabecalhoDosFiltros}
              <div className="relative mb-3 min-w-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="Buscar conteúdo"
                  aria-label="Buscar conteúdo, legenda ou conta"
                  className={juntar(campo, "h-11 pl-9")}
                />
              </div>
              {gradeDosFiltros}
            </PopoverContent>
          </Popover>
          {view === "board" && canCreate && (
            <button
              type="button"
              className={juntar(botao.icone, "h-11 w-11 text-primary hover:text-primary")}
              onClick={onCreate}
              aria-label="Criar conteúdo"
              title="Criar conteúdo"
            >
              <FilePlus2 className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {view !== "board" && canSchedule && (
            <button
              type="button"
              className={juntar(botao.icone, "h-11 w-11 text-primary hover:text-primary")}
              onClick={onSchedule}
              aria-label="Agendar publicação"
              title="Agendar publicação"
            >
              <CalendarPlus2 className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="mb-2 flex min-w-0 items-center">
          <Etapas
            soIcone
            rotulo="Área editorial e visualização da agenda"
            itens={visoes.map((option) => ({
              valor: option.value,
              rotulo: option.label,
              icone: <option.icon className="h-4 w-4" />,
            }))}
            valor={view}
            onEscolher={(v) => onViewChange(v as EditorialView)}
            className="shrink-0"
          />
          {view !== "board" ? (
            <div className="ml-auto flex min-w-0 items-center pl-1">
              <button
                type="button"
                className={juntar(botao.icone, "h-11 w-9")}
                onClick={onPrevious}
                aria-label="Período anterior"
                title="Período anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className={juntar(texto.tituloSecao, "min-w-0 truncate text-center")} title={title}>
                <span className="sr-only">{title}</span>
                <span aria-hidden="true">{tituloCurto || title}</span>
              </h2>
              <button
                type="button"
                className={juntar(botao.icone, "h-11 w-9")}
                onClick={onNext}
                aria-label="Próximo período"
                title="Próximo período"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {mostrarHoje && (
                <button
                  type="button"
                  className={juntar(botao.discreto, "h-11 shrink-0 px-2 text-foreground")}
                  onClick={onToday}
                  title="Voltar para hoje"
                >
                  Hoje
                </button>
              )}
            </div>
          ) : (
            inicioDaLinha ? <div className="ml-auto flex min-w-0 items-center pl-2">{inicioDaLinha}</div> : null
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center">
      {/* 16/10/2026 (dono): "está ocupando duas linhas; a parte de baixo
          encaixa na de cima". Uma linha só: título, visões em ícone (o nome
          fica no title e no leitor de tela), período, busca, filtros e a
          ação principal em ícone, sem bordas. Só quebra quando não cabe. */}
      <div className="mb-2 mr-3 min-w-0 max-w-full">{cabecalho}</div>

      <div className="mb-2 mr-3 flex min-w-0 max-w-full items-center">
        <Etapas
          soIcone
          rotulo="Área editorial e visualização da agenda"
          itens={visoes.map((option) => ({
            valor: option.value,
            rotulo: option.label,
            icone: <option.icon className="h-4 w-4" />,
          }))}
          valor={view}
          onEscolher={(v) => onViewChange(v as EditorialView)}
          className="shrink-0"
        />
        {view !== "board" ? (
          <div className="ml-2 flex min-w-0 items-center">
            <button
              type="button"
              className={botao.icone}
              onClick={onPrevious}
              aria-label="Período anterior"
              title="Período anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={juntar(botao.discreto, "h-8 px-2 text-foreground")}
              onClick={onToday}
              title="Voltar para hoje"
            >
              Hoje
            </button>
            <button
              type="button"
              className={botao.icone}
              onClick={onNext}
              aria-label="Próximo período"
              title="Próximo período"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <h2 className={juntar(texto.tituloSecao, "ml-1 min-w-0 truncate first-letter:uppercase")}>
              {title}
            </h2>
          </div>
        ) : (
          inicioDaLinha ? <div className="ml-2 flex min-w-0 items-center">{inicioDaLinha}</div> : null
        )}
      </div>

      <div className="mb-2 ml-auto flex w-full min-w-0 items-center sm:w-auto sm:flex-1 sm:justify-end">
        <div className="relative mr-2 min-w-0 flex-1 lg:w-[200px] lg:flex-none">
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
          <div className="mr-2 hidden w-[160px] shrink-0 md:block">
            <FilterSelect
              value={clientId}
              label="Todos os clientes"
              options={clients}
              onChange={onClientChange}
            />
          </div>
        )}
        <div className="mr-2 hidden w-[160px] shrink-0 xl:block">
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
              className={juntar(botao.icone, "relative", advancedFilterCount > 0 && "text-foreground")}
              aria-label={`Mais filtros, ${advancedFilterCount} ${
                advancedFilterCount === 1 ? "ativo" : "ativos"
              }`}
              title="Filtros"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {advancedFilterCount > 0 && (
                <span
                  className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
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
            {cabecalhoDosFiltros}
            {gradeDosFiltros}
          </PopoverContent>
        </Popover>
        {hasAnyActiveFilter && (
          <button
            type="button"
            onClick={onClearFilters}
            className={botao.icone}
            aria-label="Limpar filtros"
            title="Limpar filtros"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* A ação principal em ícone (o nome no title). Ícone próprio: o
            Criar conteúdo não repete o ícone da visão Conteúdos. */}
        {view === "board" && canCreate && (
          <button
            type="button"
            className={juntar(botao.icone, "ml-1 text-primary hover:text-primary")}
            onClick={onCreate}
            aria-label="Criar conteúdo"
            title="Criar conteúdo"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        {view !== "board" && canSchedule && (
          <button
            type="button"
            className={juntar(botao.icone, "ml-1 text-primary hover:text-primary")}
            onClick={onSchedule}
            aria-label="Agendar publicação"
            title="Agendar publicação"
          >
            <CalendarPlus2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
