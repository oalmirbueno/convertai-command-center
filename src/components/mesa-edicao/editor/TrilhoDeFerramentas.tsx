import type { ComponentType } from "react";
import { Bot, Captions, Clapperboard, Clock, Copy, Crop, FolderOpen, LayoutGrid, ListVideo, Mountain, Music, Palette, Scissors, SlidersHorizontal, Sparkles, Upload, Wand2, ZoomIn } from "lucide-react";
import { juntar } from "@/components/sistema/estilos";

/**
 * Trilho de ferramentas do editor (02/10/2026): o dono achou o editor
 * desorganizado (16 painéis escondidos numa lista). Agora cada ferramenta tem
 * um ícone fixo à esquerda, em grupos, como nos editores de vídeo; um clique
 * abre o painel. O nome inteiro fica no title e no leitor de tela.
 */

export interface FerramentaDoTrilho {
  valor: string;
  rotulo: string;
}

const ICONES: Record<string, ComponentType<{ className?: string }>> = {
  ia: Sparkles,
  midia: FolderOpen,
  gerar: Clapperboard,
  cenario: Mountain,
  referencias: Copy,
  corte: Scissors,
  formato: Crop,
  zoom: ZoomIn,
  cor: Palette,
  textos: Captions,
  motion: Wand2,
  som: Music,
  timestamp: Clock,
  capitulos: ListVideo,
  exportar: Upload,
  skills: LayoutGrid,
  ajustes: SlidersHorizontal,
  agente: Bot,
};

/** Nome curto embaixo do ícone (o completo vai no title). */
const CURTO: Record<string, string> = {
  ia: "IA",
  midia: "Mídia",
  gerar: "Gerar",
  cenario: "Cenário",
  referencias: "Copiar",
  corte: "Corte",
  formato: "Formato",
  zoom: "Zoom",
  cor: "Cor",
  textos: "Textos",
  motion: "Motion",
  som: "Som",
  timestamp: "Tempo",
  capitulos: "Virais",
  exportar: "Exportar",
  skills: "Skills",
  ajustes: "Ajustes",
};

/** Grupos, na ordem do trabalho: criar, mídia, editar a imagem, texto e som, entregar. */
export const GRUPOS_DO_TRILHO: string[][] = [
  ["ia", "gerar", "cenario", "referencias"],
  ["midia"],
  ["corte", "formato", "zoom", "cor"],
  ["textos", "motion", "som", "timestamp"],
  ["capitulos", "exportar"],
  ["skills", "ajustes"],
];

export function gruposPara(ferramentas: FerramentaDoTrilho[]): FerramentaDoTrilho[][] {
  const porValor = new Map(ferramentas.map((f) => [f.valor, f]));
  const usados = new Set<string>();
  const grupos = GRUPOS_DO_TRILHO.map((g) =>
    g
      .map((v) => porValor.get(v))
      .filter((f): f is FerramentaDoTrilho => !!f)
      .map((f) => (usados.add(f.valor), f)),
  ).filter((g) => g.length);
  // Ferramenta nova sem grupo ainda: entra no fim, nunca some.
  const soltas = ferramentas.filter((f) => !usados.has(f.valor));
  return soltas.length ? grupos.concat([soltas]) : grupos;
}

export default function TrilhoDeFerramentas({ ferramentas, valor, onEscolher }: { ferramentas: FerramentaDoTrilho[]; valor: string; onEscolher: (v: string) => void }) {
  const grupos = gruposPara(ferramentas);
  return (
    // Largura fixa e rolagem invisível: a RegiaoRolavel estica (flex-1) e abria um vão de ~120 px (02/10).
    <div className="scrollbar-hidden h-full w-14 shrink-0 overflow-y-auto overscroll-contain">
      <div role="tablist" aria-orientation="vertical" aria-label="Ferramentas do editor" className="flex flex-col items-stretch gap-0.5 py-0.5" data-trilho-de-ferramentas="">
        {grupos.map((g, i) => (
          <div key={i} className={juntar("flex flex-col gap-0.5", i > 0 && "mt-1 border-t border-border pt-1")}>
            {g.map((f) => {
              const Icone = ICONES[f.valor] || LayoutGrid;
              const ativo = f.valor === valor;
              return (
                <button
                  key={f.valor}
                  type="button"
                  role="tab"
                  aria-selected={ativo}
                  aria-label={f.rotulo}
                  title={f.rotulo}
                  onClick={() => onEscolher(f.valor)}
                  data-ferramenta={f.valor}
                  className={juntar(
                    "flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    ativo && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                  )}
                >
                  <Icone className="h-[18px] w-[18px]" />
                  <span className="max-w-full truncate px-0.5 text-[10px] leading-none">{CURTO[f.valor] || f.rotulo}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
