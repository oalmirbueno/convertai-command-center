import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useUrlDaMesa } from "./MesaContexto";

/**
 * Ver a imagem grande (pedido do dono, 23/09: "não deu a opção de abrir a
 * imagem em maior"). Um só componente para toda a Mesa: referências, acervo,
 * lâminas e fontes. Setas do teclado passam entre as imagens do grupo.
 */
export type ImagemAmpliavel = {
  /** Caminho no Storage (bucket abaixo) ou URL pronta (com "://"). */
  caminho: string;
  bucket?: string;
  titulo?: string;
  legenda?: string;
};

function ImagemGrande({ imagem }: { imagem: ImagemAmpliavel }) {
  const { data: url, isError } = useUrlDaMesa(imagem.caminho, imagem.bucket || "mesa");
  if (isError) return <p className="py-24 text-center text-[13px] text-muted-foreground">Imagem indisponível.</p>;
  if (!url) return <div className="h-[60vh] w-full animate-pulse rounded-lg bg-secondary/60" />;
  return <img src={url} alt={imagem.titulo || "Imagem"} className="mx-auto block max-h-[78vh] max-w-full rounded-lg object-contain" />;
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

  const imagem = imagens[atual];
  return (
    <Dialog open={indice !== null && !!imagem} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-w-[min(1100px,96vw)] border-border bg-background p-3 sm:p-4">
        <DialogTitle className="sr-only">{imagem?.titulo || "Imagem ampliada"}</DialogTitle>
        {imagem && (
          <div className="relative">
            <ImagemGrande imagem={imagem} />
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
          <div className="mt-2 flex items-start justify-between">
            <div className="min-w-0 pr-3">
              {imagem.titulo && <p className="truncate text-[13px] font-medium text-foreground">{imagem.titulo}</p>}
              {imagem.legenda && <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{imagem.legenda}</p>}
            </div>
            {total > 1 && <span className="shrink-0 text-[12px] text-muted-foreground">{atual + 1} de {total}</span>}
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
