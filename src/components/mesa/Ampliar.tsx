import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useUrlDaMesa } from "./MesaContexto";

/**
 * Ver a imagem grande (pedido do dono, 23/09: "não deu a opção de abrir a
 * imagem em maior"; depois: "quando abre para ampliar abre espremido"). Um
 * só componente para toda a Mesa: referências, acervo, lâminas e fontes.
 * Setas (na tela e no teclado) passam entre as imagens do grupo.
 *
 * O tamanho é calculado em px pela proporção real da imagem (4:5 até ela
 * carregar) e pela janela: a imagem ocupa até ~90% da altura e 94% da
 * largura, sem nunca mudar de proporção. A janela do Dialog acompanha a
 * imagem (sem o max-w-lg padrão, que espremia a lâmina, e sem min() no CSS,
 * que o Chrome 64 não entende).
 */
export type ImagemAmpliavel = {
  /** Caminho no Storage (bucket abaixo) ou URL pronta (com "://"). */
  caminho: string;
  bucket?: string;
  titulo?: string;
  legenda?: string;
  /** Largura dividida pela altura, quando já se sabe (4:5 = 0,8). Sem ela, vale 4:5 até a imagem carregar. */
  proporcao?: number;
};

/** 4:5, a proporção das lâminas. */
export const PROPORCAO_PADRAO = 0.8;
/** Respiro interno da janela (px de cada lado). */
const RESPIRO = 16;
/** Altura da linha de baixo (título, contagem e pontos). */
const RODAPE = 52;

/**
 * Tamanho da imagem no Ampliar: cabe em 94% da largura e 90% da altura da
 * janela (menos o respiro e o rodapé), mantendo a proporção.
 */
export function tamanhoNoAmpliar(proporcao: number | null | undefined, larguraDaJanela: number, alturaDaJanela: number): { largura: number; altura: number } {
  const p = typeof proporcao === "number" && proporcao > 0 && Number.isFinite(proporcao) ? proporcao : PROPORCAO_PADRAO;
  const maxLargura = Math.max(120, Math.floor(larguraDaJanela * 0.94) - 2 * RESPIRO);
  const maxAltura = Math.max(120, Math.floor(alturaDaJanela * 0.9) - 2 * RESPIRO - RODAPE);
  const largura = Math.floor(Math.min(maxLargura, maxAltura * p));
  return { largura, altura: Math.round(largura / p) };
}

function useJanela() {
  const medir = () => ({
    largura: (typeof window !== "undefined" && window.innerWidth) || 1280,
    altura: (typeof window !== "undefined" && window.innerHeight) || 800,
  });
  const [janela, setJanela] = useState(medir);
  useEffect(() => {
    const aoMudar = () => setJanela(medir());
    window.addEventListener("resize", aoMudar);
    window.addEventListener("orientationchange", aoMudar);
    return () => {
      window.removeEventListener("resize", aoMudar);
      window.removeEventListener("orientationchange", aoMudar);
    };
  }, []);
  return janela;
}

function ImagemGrande({
  imagem,
  tamanho,
  onProporcao,
}: {
  imagem: ImagemAmpliavel;
  tamanho: { largura: number; altura: number };
  onProporcao: (p: number) => void;
}) {
  const { data: url, isError } = useUrlDaMesa(imagem.caminho, imagem.bucket || "mesa");
  const caixa = { width: tamanho.largura, height: tamanho.altura };
  if (isError) {
    return (
      <div className="flex items-center justify-center rounded-lg bg-secondary/60 text-[13px] text-muted-foreground" style={caixa}>
        Imagem indisponível.
      </div>
    );
  }
  if (!url) return <div className="animate-pulse rounded-lg bg-secondary/60" style={caixa} />;
  return (
    <div className="overflow-hidden rounded-lg bg-secondary/40" style={caixa} data-ampliar-quadro="">
      <img
        src={url}
        alt={imagem.titulo || "Imagem"}
        className="block h-full w-full object-contain"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) onProporcao(img.naturalWidth / img.naturalHeight);
        }}
      />
    </div>
  );
}

export function Ampliar({
  imagens,
  indice,
  onFechar,
}: {
  imagens: ImagemAmpliavel[];
  /** Índice aberto; null fecha. */
  indice: number | null;
  onFechar: () => void;
}) {
  const [atual, setAtual] = useState(indice ?? 0);
  // Proporção real de cada imagem, lida quando ela carrega (por caminho).
  const [proporcoes, setProporcoes] = useState<Record<string, number>>({});
  const janela = useJanela();
  useEffect(() => {
    if (indice !== null) setAtual(indice);
  }, [indice]);
  const total = imagens.length;
  const ir = (passo: number) => setAtual((i) => (total ? (i + passo + total) % total : 0));

  useEffect(() => {
    if (indice === null) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") ir(1);
      if (e.key === "ArrowLeft") ir(-1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indice, total]);

  const imagem = imagens[Math.min(atual, Math.max(0, total - 1))];
  const proporcao = imagem ? proporcoes[imagem.caminho] || imagem.proporcao || PROPORCAO_PADRAO : PROPORCAO_PADRAO;
  const tamanho = tamanhoNoAmpliar(proporcao, janela.largura, janela.altura);
  const guardarProporcao = (p: number) => {
    if (!imagem) return;
    const chave = imagem.caminho;
    setProporcoes((m) => (Math.abs((m[chave] || 0) - p) < 0.001 ? m : { ...m, [chave]: p }));
  };

  return (
    <Dialog open={indice !== null && !!imagem} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent
        className="block w-auto max-w-none gap-0 border-border bg-background p-4 sm:p-4"
        style={{ width: tamanho.largura + 2 * RESPIRO, maxWidth: "96vw" }}
      >
        <DialogTitle className="sr-only">{imagem?.titulo || "Imagem ampliada"}</DialogTitle>
        {imagem && (
          <div className="relative mx-auto" style={{ width: tamanho.largura }}>
            <ImagemGrande key={imagem.caminho} imagem={imagem} tamanho={tamanho} onProporcao={guardarProporcao} />
            {total > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => ir(-1)}
                  aria-label="Imagem anterior"
                  className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => ir(1)}
                  aria-label="Próxima imagem"
                  className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </div>
        )}
        {imagem && (imagem.titulo || imagem.legenda || total > 1) && (
          <div className="mt-2 flex min-w-0 items-start justify-between">
            <div className="min-w-0 pr-3">
              {imagem.titulo && <p className="truncate text-[13px] font-medium text-foreground">{imagem.titulo}</p>}
              {imagem.legenda && <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{imagem.legenda}</p>}
            </div>
            {total > 1 && (
              <div className="flex shrink-0 items-center">
                {total <= 12 && (
                  <div className="mr-2 hidden items-center sm:flex" aria-label="Ir para a imagem">
                    {imagens.map((im, i) => (
                      <button
                        key={`${im.caminho}-${i}`}
                        type="button"
                        onClick={() => setAtual(i)}
                        aria-label={`Imagem ${i + 1}`}
                        aria-current={i === atual ? "true" : undefined}
                        className="flex h-5 w-4 items-center justify-center"
                      >
                        <span className={`block h-1.5 w-1.5 rounded-full ${i === atual ? "bg-primary" : "bg-muted-foreground/40"}`} />
                      </button>
                    ))}
                  </div>
                )}
                <span className="text-[12px] tabular-nums text-muted-foreground">{atual + 1} de {total}</span>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Miniatura clicável que abre o Ampliar. */
export function BotaoAmpliar({ onClick, children, className = "", rotulo = "Ver maior" }: { onClick: () => void; children: ReactNode; className?: string; rotulo?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} className={`group relative block overflow-hidden ${className}`}>
      {children}
    </button>
  );
}

// Fechar explícito para quem usa o componente sem o X do Dialog.
export const IconeFechar = X;
