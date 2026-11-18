import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  CalendarPlus2,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FilePlus2,
  List,
  Plus,
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

/**
 * Campo da busca com o texto local (12/11/2026, "Softy" virou "Sy —
 * criativosy"). A busca mora no endereço (?q=) e o React Router 7 aplica
 * toda mudança de endereço dentro de startTransition: o input controlado
 * direto pelo endereço ficava um passo atrás da digitação, o React devolvia
 * o valor antigo ao campo e letras sumiam ou o cursor pulava para o fim.
 * Aqui o que se digita aparece na hora e segue para o endereço a cada tecla.
 *
 * Eco x mudança de fora, sem comparar só o texto: cada tecla abre uma
 * revisão local pendente (o último texto enviado). Enquanto ela está
 * pendente e o campo em foco, valores do endereço diferentes dela são ecos
 * atrasados (ou ambíguos) e não voltam ao campo; quando o endereço chega no
 * último texto enviado, a revisão fecha. Com nada pendente, toda mudança do
 * endereço vale, mesmo em foco e mesmo que repita um texto já enviado (enviar
 * B, depois C, navegação de fora volta B: o campo mostra B). Ao sair do
 * campo, ele assume o endereço. "Limpar filtros" manda um sinal explícito
 * (versaoDoReset): fecha a pendência e assume o endereço, mesmo que ele já
 * estivesse vazio durante a digitação pendente.
 */
export function CampoDeBusca({
  valor,
  onMudar,
  versaoDoReset = 0,
  className,
}: {
  valor: string;
  onMudar: (valor: string) => void;
  /** Incrementada pelo pai em "Limpar filtros". */
  versaoDoReset?: number;
  className?: string;
}) {
  const [texto, setTexto] = useState(valor);
  const ref = useRef<HTMLInputElement>(null);
  // Último texto enviado que o endereço ainda não confirmou (null = nada pendente).
  const pendente = useRef<string | null>(null);
  const valorAtual = useRef(valor);
  valorAtual.current = valor;
  useEffect(() => {
    if (pendente.current !== null) {
      if (valor === pendente.current) {
        pendente.current = null;
        return;
      }
      const emFoco = typeof document !== "undefined" && ref.current !== null && document.activeElement === ref.current;
      if (emFoco) return;
      pendente.current = null;
    }
    setTexto(valor);
  }, [valor]);
  const resetVisto = useRef(versaoDoReset);
  useEffect(() => {
    if (resetVisto.current === versaoDoReset) return;
    resetVisto.current = versaoDoReset;
    pendente.current = null;
    setTexto(valorAtual.current);
  }, [versaoDoReset]);
  return (
    <input
      ref={ref}
      type="search"
      value={texto}
      onChange={(event) => {
        const novo = event.target.value;
        setTexto(novo);
        pendente.current = novo;
        onMudar(novo);
      }}
      onBlur={() => {
        pendente.current = null;
        setTexto(valorAtual.current);
      }}
      placeholder="Buscar conteúdo"
      aria-label="Buscar conteúdo, legenda ou conta"
      className={className}
    />
  );
}

interface SelectOption {
  value: string;
  label: string;
}

interface EditorialToolbarProps {
  /** Título da página (h1 + "?" + resumo): a primeira linha começa por ele. */
  cabecalho?: ReactNode;
  /** Números do período sem cartão, na linha do título (computador). */
  numeros?: ReactNode;
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

/** 1280 px para cima: as visões cabem com o nome escrito (sem matchMedia, fica o ícone). */
function useTelaLarga() {
  const consulta = "(min-width: 1280px)";
  const [largo, setLargo] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(consulta).matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(consulta);
    const ouvir = () => setLargo(mq.matches);
    ouvir();
    mq.addEventListener?.("change", ouvir);
    return () => mq.removeEventListener?.("change", ouvir);
  }, []);
  return largo;
}

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
          // Polimento v4: o filtro é pílula, como a busca e os botões ao lado (antes, caixa de canto reto).
          "h-9 w-full min-w-0 rounded-full bg-card px-3.5 text-[13px]",
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
  numeros,
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
  const largo = useTelaLarga();
  // Sinal explícito para a busca local: "Limpar filtros" ressincroniza o campo.
  const [versaoDoReset, setVersaoDoReset] = useState(0);
  const limparFiltros = () => {
    setVersaoDoReset((v) => v + 1);
    onClearFilters();
  };

  // O corpo do "Filtros" é o mesmo no computador e no celular (16/10/2026).
  const cabecalhoDosFiltros = (
    <div className="mb-3 flex items-center justify-between">
      <p className={texto.tituloSecao}>Filtros</p>
      <button
        type="button"
        className={juntar(botao.discreto, "h-8 px-2 text-[12px]")}
        onClick={limparFiltros}
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
      <div>
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
                    className="absolute right-1 top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent-solid px-1 text-[11px] font-semibold tabular-nums text-on-accent"
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
                <CampoDeBusca
                  valor={search}
                  onMudar={onSearchChange}
                  versaoDoReset={versaoDoReset}
                  className={juntar(campo, "h-11 pl-9")}
                />
              </div>
              {gradeDosFiltros}
            </PopoverContent>
          </Popover>
          {view === "board" && canCreate && (
            <button
              type="button"
              className={juntar(botao.icone, "ml-1 h-11 w-11 bg-accent-solid text-on-accent hover:bg-accent-solid/90 hover:text-on-accent")}
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
              className={juntar(botao.icone, "ml-1 h-11 w-11 bg-accent-solid text-on-accent hover:bg-accent-solid/90 hover:text-on-accent")}
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

  // Passada estrutural (15/11/2026, dono: "menos poluído, mais intuitivo,
  // idêntico às referências"). No computador o topo tem duas linhas, como nas
  // referências de calendário: em cima o título, os números do período sem
  // cartão e UMA ação principal com nome; embaixo as visões com nome, o
  // período e a busca. Projeto e os filtros finos moram no "Filtros".
  const filtrosNaJanela = advancedFilterCount + (isActiveFilter(projectId) ? 1 : 0);
  const acaoPrincipal = juntar(botao.primario, "ml-3 h-11 shrink-0 px-5 text-[14px] font-semibold");
  return (
    <div className="min-w-0" data-barra-da-agenda="">
      <div className="mb-5 flex min-w-0 flex-wrap items-center">
        <div className="mr-6 min-w-0 max-w-full flex-1">{cabecalho}</div>
        {numeros && <div className="mr-3 hidden min-w-0 lg:block">{numeros}</div>}
        {/* A ação principal: verde vivo, texto escuro e o nome escrito. */}
        {view === "board" && canCreate && (
          <button type="button" className={acaoPrincipal} onClick={onCreate} aria-label="Criar conteúdo" title="Criar conteúdo">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Criar conteúdo
          </button>
        )}
        {view !== "board" && canSchedule && (
          <button type="button" className={acaoPrincipal} onClick={onSchedule} aria-label="Agendar publicação" title="Agendar publicação">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Agendar
          </button>
        )}
      </div>

      <div className="mb-4 flex min-w-0 flex-wrap items-center">
        <Etapas
          soIcone={!largo}
          rotulo="Área editorial e visualização da agenda"
          itens={visoes.map((option) => ({
            valor: option.value,
            rotulo: option.label,
            icone: <option.icon className="h-4 w-4" />,
          }))}
          valor={view}
          onEscolher={(v) => onViewChange(v as EditorialView)}
          className="mb-2 mr-4 shrink-0 rounded-full bg-card p-1 shadow-card"
        />
        {view !== "board" ? (
          <div className="mb-2 mr-3 flex min-w-0 items-center">
            <button
              type="button"
              className={juntar(botao.icone, "h-9 w-9 bg-card shadow-card")}
              onClick={onPrevious}
              aria-label="Período anterior"
              title="Período anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={juntar(botao.icone, "ml-1.5 h-9 w-9 bg-card shadow-card")}
              onClick={onNext}
              aria-label="Próximo período"
              title="Próximo período"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <h2 className="ml-4 min-w-0 truncate text-[20px] font-medium leading-7 tracking-[-0.02em] text-foreground first-letter:uppercase" title={title}>
              {title}
            </h2>
            {mostrarHoje && (
              <button
                type="button"
                className="ml-3 shrink-0 rounded-full text-[13px] font-medium text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                onClick={onToday}
                title="Voltar para hoje"
              >
                Hoje
              </button>
            )}
          </div>
        ) : (
          inicioDaLinha ? <div className="mb-2 mr-3 flex min-w-0 items-center">{inicioDaLinha}</div> : null
        )}

        <div className="mb-2 ml-auto flex w-full min-w-0 items-center sm:w-auto sm:flex-1 sm:justify-end">
          <div className="relative mr-2 min-w-0 flex-1 lg:w-[220px] lg:flex-none">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <CampoDeBusca
              valor={search}
              onMudar={onSearchChange}
              versaoDoReset={versaoDoReset}
              className={juntar(campo, "h-10 rounded-full border-transparent bg-card pl-10 shadow-card")}
            />
          </div>
          {clients.length > 0 && (
            <div className="mr-2 hidden w-[180px] shrink-0 md:block">
              <FilterSelect
                value={clientId}
                label="Todos os clientes"
                options={clients}
                onChange={onClientChange}
                className="h-10 border-transparent shadow-card"
              />
            </div>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={juntar(botao.secundario, "relative h-10 shrink-0 border-transparent px-4 shadow-card", filtrosNaJanela > 0 && "text-foreground")}
                aria-label={`Mais filtros, ${filtrosNaJanela} ${
                  filtrosNaJanela === 1 ? "ativo" : "ativos"
                }`}
                title="Filtros"
              >
                <SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
                Filtros
                {filtrosNaJanela > 0 && (
                  <span
                    className="ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-solid px-1 text-[11px] font-semibold tabular-nums text-on-accent"
                    aria-hidden="true"
                  >
                    {filtrosNaJanela}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[calc(100vw-24px)] max-w-[380px] rounded-lg p-5"
            >
              {cabecalhoDosFiltros}
              {gradeDosFiltros}
            </PopoverContent>
          </Popover>
          {hasAnyActiveFilter && (
            <button
              type="button"
              onClick={limparFiltros}
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
