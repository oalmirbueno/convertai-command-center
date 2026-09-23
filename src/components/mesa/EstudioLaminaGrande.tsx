import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Crop, Loader2, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTamanho } from "./EstudioAltura";
import { ImagemDaMesa } from "./MesaContexto";
import { Cronometro, Esboco, funcaoDaLamina } from "./PranchetaDoEstudio";
import SeletorDeAreas from "./SeletorDeAreas";
import type { Area } from "./estudioUtil";
import type { CardDaDirecao, CardGerado } from "./useItensDoMes";

/**
 * A lâmina escolhida, grande, abaixo da prancheta. O quadro 4:5 ocupa o
 * espaço que sobra na coluna (largura e altura medidas), sem passar do
 * tamanho real. Só a imagem que o gerador devolveu, ou o esboço do layout
 * antes de gerar; nenhum texto por cima da arte. A barra de cima tem a
 * versão vista e o botão de ver grande (Ampliar).
 */

/**
 * Quadro 4:5 que cabe na área do pai: largura = a menor entre a largura da
 * área e 0,8 da altura. A área tem altura mínima (a coluna rola por dentro
 * quando a janela é baixa), então o quadro nunca é cortado.
 */
export function QuadroQueCabe({
  children,
  maximo = 640,
  soPelaLargura = false,
}: {
  children: (largura: number) => ReactNode;
  maximo?: number;
  /** Na página que rola (celular), a altura não limita: vale só a largura. */
  soPelaLargura?: boolean;
}) {
  const [ref, area] = useTamanho<HTMLDivElement>();
  const pelaAltura = soPelaLargura ? Infinity : Math.floor(area.altura * 0.8);
  // Na página que rola, a lâmina não passa de 420 px de largura (525 de altura).
  const teto = soPelaLargura ? Math.min(maximo, 420) : maximo;
  const largura = Math.max(0, Math.floor(Math.min(area.largura, pelaAltura, teto)));
  return (
    <div ref={ref} className={`flex min-w-0 flex-1 items-start justify-center ${soPelaLargura ? "" : "min-h-[300px]"}`}>
      {largura > 0 && (
        <div className="relative shrink-0 overflow-hidden rounded-lg border border-border bg-secondary" style={{ width: largura, height: Math.round(largura * 1.25) }}>
          {children(largura)}
        </div>
      )}
    </div>
  );
}

export default function EstudioLaminaGrande({
  card,
  total,
  versoes,
  versaoVista,
  onVersaoVista,
  gerandoDesde,
  desenhandoAreas,
  areas,
  onAreas,
  ocupado,
  onAmpliar,
  soPelaLargura,
}: {
  card: CardDaDirecao;
  total: number;
  /** Versões desta lâmina, em qualquer ordem. */
  versoes: CardGerado[];
  versaoVista: number | null;
  onVersaoVista: (versao: number) => void;
  gerandoDesde?: number;
  /** Ajuste por área: a lâmina vira a mesa de marcar áreas. */
  desenhandoAreas: boolean;
  areas: Area[];
  onAreas: (areas: Area[]) => void;
  ocupado: boolean;
  onAmpliar: () => void;
  soPelaLargura?: boolean;
}) {
  const ordenadas = versoes.slice().sort((a, b) => a.versao - b.versao);
  const ultima = ordenadas[ordenadas.length - 1] || null;
  const vista = ordenadas.find((v) => v.versao === versaoVista) || ultima;
  const posicao = vista ? ordenadas.indexOf(vista) : -1;
  const irPara = (passo: number) => {
    const alvo = ordenadas[posicao + passo];
    if (alvo) onVersaoVista(alvo.versao);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-2 flex h-8 min-w-0 shrink-0 items-center">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          Lâmina {card.ordem}
          <span className="font-normal text-muted-foreground"> · {funcaoDaLamina(card)}</span>
          {gerandoDesde !== undefined && (
            <span className="ml-2 inline-flex items-center text-[12px] font-normal text-primary">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> gerando <span className="ml-1 tabular-nums"><Cronometro desde={gerandoDesde} /></span>
            </span>
          )}
          {desenhandoAreas && (
            <span className="ml-2 inline-flex items-center text-[12px] font-normal text-primary">
              <Crop className="mr-1 h-3 w-3" /> arraste para marcar a área
            </span>
          )}
        </p>
        {ordenadas.length > 1 && !desenhandoAreas && (
          <div className="ml-2 flex shrink-0 items-center rounded-md border border-border bg-background">
            <button type="button" className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => irPara(-1)} disabled={posicao <= 0} aria-label="Versão anterior">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-1 text-[11.5px] tabular-nums text-muted-foreground">v{vista?.versao} de {ordenadas.length}</span>
            <button type="button" className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => irPara(1)} disabled={posicao >= ordenadas.length - 1} aria-label="Próxima versão">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {vista && !desenhandoAreas && (
          <Button type="button" size="sm" variant="ghost" className="ml-1 h-8 shrink-0 px-2 text-[12px]" onClick={onAmpliar} title="Ver grande (setas passam entre as lâminas)">
            <ZoomIn className="mr-1 h-3.5 w-3.5" /> Ver grande
          </Button>
        )}
      </div>
      <QuadroQueCabe soPelaLargura={soPelaLargura}>
        {(largura) =>
          desenhandoAreas && ultima ? (
            <SeletorDeAreas caminho={ultima.storage_path} areas={areas} onMudar={onAreas} disabled={ocupado} />
          ) : vista ? (
            <button type="button" onDoubleClick={onAmpliar} className="block h-full w-full cursor-zoom-in" aria-label={`Lâmina ${card.ordem}: duplo clique para ver grande`}>
              <ImagemDaMesa caminho={vista.storage_path} alt={`Lâmina ${card.ordem}, versão ${vista.versao}`} className="h-full w-full" />
            </button>
          ) : (
            <Esboco card={card} total={total} largura={largura} />
          )
        }
      </QuadroQueCabe>
    </div>
  );
}
