import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Crop, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTamanho } from "./EstudioAltura";
import { ImagemDaMesa } from "./MesaContexto";
import { ESTILO_VELADO, Esboco, funcaoDaLamina, VeuDaLamina, type AndamentoDaLamina } from "./PranchetaDoEstudio";
import SeletorDeAreas from "./SeletorDeAreas";
import type { Area } from "./estudioUtil";
import type { CardDaDirecao, CardGerado } from "./useItensDoMes";

/**
 * A lâmina escolhida, GRANDE, no centro do estúdio (pedido do dono em 23/09:
 * "o estúdio ficou muito pequeno para editar e trabalhar"). O quadro 4:5
 * ocupa todo o espaço que sobra (largura e altura medidas), sem passar do
 * tamanho real da imagem gerada. Só a imagem que o gerador devolveu, ou o
 * esboço do layout antes de gerar; nenhum texto por cima da arte. A barra
 * de cima tem a versão vista e o botão de ver grande (Ampliar).
 *
 * O cronômetro da geração NÃO aparece aqui: o indicador da lâmina é um só,
 * na prancheta. Aqui a imagem fica esmaecida enquanto a lâmina trabalha e,
 * com `andamento`, velada (borrada, com a etapa em texto) até a conferência
 * e a autocorreção terminarem.
 */

/** Maior largura do quadro (px): a imagem gerada tem 1088 de largura. */
export const LARGURA_MAXIMA_DA_LAMINA = 1088;

/**
 * Quadro 4:5 que cabe na área do pai: largura = a menor entre a largura da
 * área e 0,8 da altura. A área tem altura mínima (a coluna rola por dentro
 * quando a janela é baixa), então o quadro nunca é cortado.
 */
export function QuadroQueCabe({
  children,
  maximo = LARGURA_MAXIMA_DA_LAMINA,
  soPelaLargura = false,
  proporcao = 0.8,
}: {
  children: (largura: number) => ReactNode;
  maximo?: number;
  /** Largura dividida pela altura do formato (0,8 no 4:5). */
  proporcao?: number;
  /** Na página que rola (celular), a altura não limita: vale só a largura. */
  soPelaLargura?: boolean;
}) {
  const [ref, area] = useTamanho<HTMLDivElement>();
  const r = proporcao > 0 ? proporcao : 0.8;
  const pelaAltura = soPelaLargura ? Infinity : Math.floor(area.altura * r);
  // Na página que rola, a lâmina não passa de 650 px de altura.
  const teto = soPelaLargura ? Math.min(maximo, Math.round(650 * r)) : maximo;
  const largura = Math.max(0, Math.floor(Math.min(area.largura, pelaAltura, teto)));
  return (
    <div ref={ref} className={`flex min-h-0 min-w-0 flex-1 items-start justify-center ${soPelaLargura ? "" : "min-h-[320px]"}`}>
      {largura > 0 && (
        <div className="relative shrink-0 overflow-hidden rounded-lg border border-border bg-secondary shadow-sm" style={{ width: largura, height: Math.round(largura / r) }}>
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
  desenhandoAreas,
  areas,
  onAreas,
  ocupado,
  andamento,
  onAmpliar,
  soPelaLargura,
  faixa,
  proporcao = 0.8,
  aviso,
}: {
  card: CardDaDirecao;
  total: number;
  /** Versões desta lâmina, em qualquer ordem. */
  versoes: CardGerado[];
  versaoVista: number | null;
  onVersaoVista: (versao: number) => void;
  /** Ajuste por área: a lâmina vira a mesa de marcar áreas. */
  desenhandoAreas: boolean;
  areas: Area[];
  onAreas: (areas: Area[]) => void;
  /** A lâmina está gerando, ajustando ou na conferência: a imagem fica esmaecida. */
  ocupado: boolean;
  /** Etapa da lâmina (gerando, conferindo, corrigindo...): vela a arte até terminar. */
  andamento?: AndamentoDaLamina;
  onAmpliar: () => void;
  soPelaLargura?: boolean;
  /** Faixa logo abaixo do título: a foto e as referências da próxima geração (EstudioBaseDaLamina). */
  faixa?: ReactNode;
  /** Largura dividida pela altura do formato do post (0,8 no 4:5). */
  proporcao?: number;
  /** Aviso acima da faixa (ex.: trabalho entregue, com o botão de reabrir). */
  aviso?: ReactNode;
}) {
  const ordenadas = versoes.slice().sort((a, b) => a.versao - b.versao);
  const ultima = ordenadas[ordenadas.length - 1] || null;
  const vista = ordenadas.find((v) => v.versao === versaoVista) || ultima;
  const posicao = vista ? ordenadas.indexOf(vista) : -1;
  const velada = !!andamento && andamento.etapa !== "fila";
  const irPara = (passo: number) => {
    const alvo = ordenadas[posicao + passo];
    if (alvo) onVersaoVista(alvo.versao);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-2 flex h-8 min-w-0 shrink-0 items-center">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          Lâmina {card.ordem}
          <span className="font-normal text-muted-foreground"> · {funcaoDaLamina(card)} · {card.ordem} de {total}</span>
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
            <Maximize2 className="mr-1 h-3.5 w-3.5" /> Ver grande
          </Button>
        )}
      </div>
      {aviso}
      {faixa}
      <QuadroQueCabe soPelaLargura={soPelaLargura} proporcao={proporcao}>
        {(largura) =>
          desenhandoAreas && ultima ? (
            <SeletorDeAreas caminho={ultima.storage_path} areas={areas} onMudar={onAreas} disabled={ocupado} />
          ) : vista ? (
            <>
              <button type="button" onDoubleClick={velada ? undefined : onAmpliar} className="block h-full w-full cursor-zoom-in overflow-hidden" aria-label={`Lâmina ${card.ordem}: duplo clique para ver grande`}>
                <div className="h-full w-full" style={velada ? ESTILO_VELADO : undefined}>
                  <ImagemDaMesa caminho={vista.storage_path} alt={`Lâmina ${card.ordem}, versão ${vista.versao}`} className={`h-full w-full transition-opacity ${ocupado && !velada ? "opacity-50" : ""}`} />
                </div>
              </button>
              {velada && andamento && <VeuDaLamina andamento={andamento} />}
            </>
          ) : (
            <Esboco card={card} total={total} largura={largura} />
          )
        }
      </QuadroQueCabe>
    </div>
  );
}
