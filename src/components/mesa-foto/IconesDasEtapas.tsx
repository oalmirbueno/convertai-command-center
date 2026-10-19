import type { ReactNode } from "react";
import {
  Activity,
  Aperture,
  BookOpen,
  Bookmark,
  Boxes,
  CalendarDays,
  ChartColumn,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  Compass,
  FileDown,
  FilePen,
  FlaskConical,
  FolderTree,
  Gauge,
  Hammer,
  House,
  Images,
  Inbox,
  Layers,
  LayoutTemplate,
  Library,
  Lightbulb,
  ListChecks,
  MessagesSquare,
  PackageCheck,
  Paintbrush,
  PenLine,
  Plug,
  Presentation,
  Rocket,
  Route,
  Search,
  SearchCheck,
  Send,
  Shapes,
  SlidersHorizontal,
  Smartphone,
  SquarePlay,
  Tag,
  Target,
  Telescope,
  TextCursorInput,
  Type,
  UserRound,
  UsersRound,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import type { ItemDeEtapa } from "@/components/sistema/Etapas";
import type { QualMesa } from "./TrocaDeMesas";

/**
 * Padrão das mesas (16/10/2026, dono: "em tudo que tem texto e ícone, deixa
 * só o ícone"): as etapas do cabeçalho de toda mesa avulsa usam o
 * `Etapas soIcone` do sistema. Fechada mostra só o ícone (o nome vai no title
 * e no leitor de tela); a aberta mostra o nome e o "?" com a explicação.
 *
 * Um mapa só, aqui ao lado da lista de mesas (TrocaDeMesas), para nenhuma mesa
 * repetir ícone entre etapas diferentes (src/test/mesas-icones-das-etapas.test.ts
 * confere). Etapa sem ícone no mapa cai no ícone genérico e o teste acusa.
 */
export const ICONES_DAS_ETAPAS: Partial<Record<QualMesa, Record<string, LucideIcon>>> = {
  // Mesa Foto: os 5 passos da linha de produção (pela etapa do passo) e as ferramentas do "Mais".
  foto: {
    criar: ListChecks,
    acervo: Images,
    estudio: WandSparkles,
    aprovar: CircleCheck,
    usar: Send,
    kits: Boxes,
    biblioteca: Library,
    modelos: UserRound,
    clones: UsersRound,
    book: BookOpen,
    canvas: Shapes,
  },
  ads: {
    oferta: Tag,
    referencias: Bookmark,
    plano: FlaskConical,
    estudio: Paintbrush,
    conta: Gauge,
    auditoria: ClipboardCheck,
    resultados: ChartColumn,
  },
  videos: {
    base: Layers,
    kit: Boxes,
    biblia: BookOpen,
    roteiro: PenLine,
    gerar: WandSparkles,
    resultados: SquarePlay,
  },
  edicao: {
    entrada: Inbox,
    organizar: FolderTree,
    editar: SlidersHorizontal,
  },
  publicidade: {
    campanha: Target,
    direcao: Compass,
    tomadas: Aperture,
    revisao: SearchCheck,
    envio: Send,
  },
  roteiros: {
    agenda: CalendarDays,
    roteiro: PenLine,
    revisao: SearchCheck,
    pdf: FileDown,
    modelos: LayoutTemplate,
  },
  identidade: {
    inicio: House,
    briefing: ClipboardList,
    pesquisa: Search,
    estrategia: Target,
    naming: TextCursorInput,
    conceito: Lightbulb,
    sistema: Shapes,
    mockups: Smartphone,
    guideline: BookOpen,
    apresentacao: Presentation,
    entrega: PackageCheck,
  },
  site: {
    briefing: ClipboardList,
    referencias: Telescope,
    direcao: Compass,
    conteudo: Type,
    imagens: Images,
    integracoes: Plug,
    construcao: Hammer,
    revisao: SearchCheck,
    publicacao: Rocket,
  },
  proposta: {
    contexto: MessagesSquare,
    rascunho: FilePen,
    revisao: ListChecks,
    envio: Send,
    acompanhar: Activity,
  },
};

/** Ícone genérico de etapa (só se faltar no mapa; o teste não deixa passar). */
const SEM_ICONE: LucideIcon = Route;

export function iconeDaEtapaDaMesa(mesa: QualMesa, valor: string): LucideIcon {
  const mapa = ICONES_DAS_ETAPAS[mesa];
  return (mapa && mapa[valor]) || SEM_ICONE;
}

/**
 * O ícone da etapa com o estado que o modo `soIcone` não desenha sozinho:
 * feita (ponto verde no canto), fechada (apagada) e próximo passo (verde).
 */
export function IconeDaEtapa({ Icone, feita, fechada, destaque }: { Icone: LucideIcon; feita?: boolean; fechada?: boolean; destaque?: boolean }) {
  return (
    <span className={`relative inline-flex ${fechada ? "opacity-40" : ""} ${destaque ? "text-primary" : ""}`} data-etapa-feita={feita ? "" : undefined}>
      <Icone className="h-4 w-4" />
      {feita && <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-1 ring-background" />}
    </span>
  );
}

/**
 * Converte as etapas de uma mesa para o modo só ícone: põe o ícone (com o
 * estado), leva a dica para o "?" da aberta e deixa o nome no title das
 * fechadas ("Nome · dica").
 */
export function etapasEmIcone(mesa: QualMesa, itens: ItemDeEtapa[], ajudas?: Record<string, ReactNode>): ItemDeEtapa[] {
  return itens.map((item) => {
    const extra = item.feita ? "concluída" : item.fechada ? "ainda fechada" : "";
    const dica = [item.rotulo, item.dica, extra].filter(Boolean).join(" · ");
    return {
      ...item,
      dica,
      ajuda: item.ajuda || (ajudas && ajudas[item.valor]) || item.dica,
      icone: item.icone || <IconeDaEtapa Icone={iconeDaEtapaDaMesa(mesa, item.valor)} feita={item.feita} fechada={item.fechada} destaque={item.destaque} />,
    };
  });
}
