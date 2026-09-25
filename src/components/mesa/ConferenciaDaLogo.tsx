import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  analisarBlobDaLogo,
  estiloDoFundoDaLogo,
  fundoDeConferencia,
  logoSemFundo,
  type AnaliseDaLogo,
  type TipoDeFundo,
  type TomDaLogo,
} from "./logoAnalise";

/**
 * Conferência da logo antes de gravar (pedido do dono, 25/09: "não ficar com
 * fundo branco, porque não faz sentido; às vezes a logo é branca e ele não vai
 * conseguir ler. Tem que ter uma lógica para isso").
 * - Fundo opaco liso (branco, creme, preto): avisa e oferece tirar o fundo
 *   aqui mesmo (preenchimento a partir da borda, sem custo), com antes e depois.
 * - Letras brancas sobre fundo branco (ilegível): diz que falta a versão certa
 *   e pede o PNG transparente ou a versão para fundo escuro.
 * - PNG já transparente: grava direto, sem pergunta (nunca mexe nas letras).
 */

export type ResultadoDaConferencia =
  | { acao: "gravar"; blob: Blob; semFundo: boolean; tom: TomDaLogo | null }
  | { acao: "cancelar" }
  | { acao: "outra" };

const NOME_DO_FUNDO: Record<TipoDeFundo, string> = { branco: "branco", creme: "creme", preto: "preto", liso: "liso" };

interface Pergunta {
  analise: AnaliseDaLogo;
  original: string;
  limpa: string | null;
  limpaBlob: Blob | null;
  blob: Blob;
  nome: string;
}

function Previa({ url, fundo, rotulo }: { url: string; fundo: ReturnType<typeof fundoDeConferencia>; rotulo: string }) {
  return (
    <figure className="min-w-0">
      <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg border border-border p-2" style={estiloDoFundoDaLogo(fundo)}>
        <img src={url} alt={rotulo} className="max-h-full max-w-full object-contain" />
      </div>
      <figcaption className="mt-1 text-center text-[11px] text-muted-foreground">{rotulo}</figcaption>
    </figure>
  );
}

export function useConferenciaDaLogo(): { conferir: (blob: Blob, nome?: string) => Promise<ResultadoDaConferencia>; dialogo: ReactNode } {
  const [pergunta, setPergunta] = useState<Pergunta | null>(null);
  const resolver = useRef<((r: ResultadoDaConferencia) => void) | null>(null);

  const fechar = useCallback((r: ResultadoDaConferencia) => {
    const fn = resolver.current;
    resolver.current = null;
    setPergunta((p) => {
      if (p) {
        URL.revokeObjectURL(p.original);
        if (p.limpa) URL.revokeObjectURL(p.limpa);
      }
      return null;
    });
    if (fn) fn(r);
  }, []);

  // Saiu da tela com a pergunta aberta: não deixa a gravação pendurada.
  useEffect(() => () => {
    if (resolver.current) resolver.current({ acao: "cancelar" });
  }, []);

  const conferir = useCallback(async (blob: Blob, nome = ""): Promise<ResultadoDaConferencia> => {
    const analise = await analisarBlobDaLogo(blob).catch(() => null);
    if (!analise) return { acao: "gravar", blob, semFundo: false, tom: null };
    if (!analise.ilegivel && (analise.transparente || !analise.fundo)) return { acao: "gravar", blob, semFundo: false, tom: analise.tom };
    const limpaBlob = !analise.ilegivel ? await logoSemFundo(blob, analise).catch(() => null) : null;
    return await new Promise<ResultadoDaConferencia>((ok) => {
      resolver.current = ok;
      setPergunta({ analise, blob, nome, original: URL.createObjectURL(blob), limpaBlob, limpa: limpaBlob ? URL.createObjectURL(limpaBlob) : null });
    });
  }, []);

  let dialogo: ReactNode = null;
  if (pergunta) {
    const { analise } = pergunta;
    const fundo = analise.fundo ? NOME_DO_FUNDO[analise.fundo.tipo] : "liso";
    dialogo = (
      <Dialog open onOpenChange={(v) => !v && fechar({ acao: "cancelar" })}>
        <DialogContent className="max-w-md" data-conferencia-da-logo={analise.ilegivel ? "ilegivel" : "fundo"}>
          <DialogHeader>
            <DialogTitle className="flex items-center text-base">
              <AlertTriangle className="mr-2 h-4 w-4 shrink-0 text-warning" />
              {analise.ilegivel ? "Essa logo não dá para ler" : `A logo tem fundo ${fundo}`}
            </DialogTitle>
            <DialogDescription className="text-[12.5px] leading-snug">
              {analise.ilegivel
                ? "Parece letra branca sobre fundo branco: ninguém lê, nem os agentes. Falta a versão certa. Envie a logo em PNG com fundo transparente ou a versão para fundo escuro."
                : pergunta.limpa
                  ? `Nas artes, o fundo ${fundo} vira uma caixa em volta da logo. Posso tirar o fundo agora e gravar a logo transparente.`
                  : `Nas artes, o fundo ${fundo} vira uma caixa em volta da logo. Não consegui separar o fundo com segurança: o ideal é enviar a logo em PNG transparente.`}
            </DialogDescription>
          </DialogHeader>
          <div className={`grid gap-2 ${pergunta.limpa ? "grid-cols-2" : "grid-cols-1"}`}>
            <Previa url={pergunta.original} fundo="xadrez" rotulo={pergunta.limpa ? "Como veio" : pergunta.nome || "A logo"} />
            {pergunta.limpa && <Previa url={pergunta.limpa} fundo={fundoDeConferencia(analise.tom)} rotulo="Sem o fundo" />}
          </div>
          <div className="flex flex-wrap items-center justify-end">
            <Button type="button" variant="ghost" size="sm" className="mb-1 mr-1.5" onClick={() => fechar({ acao: "cancelar" })}>
              Cancelar
            </Button>
            {analise.ilegivel ? (
              <>
                <Button type="button" variant="outline" size="sm" className="mb-1 mr-1.5" onClick={() => fechar({ acao: "gravar", blob: pergunta.blob, semFundo: false, tom: analise.tom })}>
                  Gravar assim mesmo
                </Button>
                <Button type="button" size="sm" className="mb-1" onClick={() => fechar({ acao: "outra" })}>
                  Escolher outra imagem
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant={pergunta.limpa ? "outline" : "default"}
                  size="sm"
                  className="mb-1 mr-1.5"
                  onClick={() => fechar({ acao: "gravar", blob: pergunta.blob, semFundo: false, tom: analise.tom })}
                >
                  Gravar como está
                </Button>
                {pergunta.limpaBlob && (
                  <Button type="button" size="sm" className="mb-1" onClick={() => fechar({ acao: "gravar", blob: pergunta.limpaBlob as Blob, semFundo: true, tom: analise.tom })}>
                    <Eraser className="mr-1.5 h-3.5 w-3.5" /> Tirar o fundo e gravar
                  </Button>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return { conferir, dialogo };
}
