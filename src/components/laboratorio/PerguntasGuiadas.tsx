import { Loader2, SkipForward, X } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema";
import type { PerguntaGuiada } from "@/lib/laboratorio/api";

/**
 * Perguntas guiadas antes de montar (v3, clickmax-rea.md): até 4, quando o
 * pedido de projeto completo não traz o essencial (produto/oferta, público,
 * preço/ticket, objetivo). Os exemplos só preenchem a caixa (não enviam);
 * o dono responde na caixa e manda, ou pula e o agente monta assim mesmo.
 */
export default function PerguntasGuiadas({
  perguntas,
  onExemplo,
  onPular,
  onFechar,
  ocupado = false,
}: {
  perguntas: PerguntaGuiada[];
  onExemplo: (p: PerguntaGuiada, exemplo: string) => void;
  onPular: () => void;
  onFechar?: () => void;
  ocupado?: boolean;
}) {
  if (!perguntas.length) return null;
  return (
    <div className="mt-2 min-w-0 px-1" role="group" aria-label="Perguntas antes de montar" data-perguntas-guiadas="">
      <div className="flex min-w-0 items-center">
        <span className={juntar(texto.rotulo, "min-w-0 flex-1")}>Antes de montar, responda na caixa</span>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={onPular} disabled={ocupado} aria-label="Pular e montar assim mesmo" title="Pular e montar assim mesmo (o que falta fica em branco, sem inventar)" data-pular-perguntas="">
          {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        {onFechar ? (
          <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={onFechar} disabled={ocupado} aria-label="Fechar as perguntas" title="Fechar as perguntas">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <ol className="mt-1 min-w-0 space-y-2">
        {perguntas.map((p, i) => (
          <li key={p.id} className="min-w-0" data-pergunta={p.id}>
            <p className={juntar(texto.corpo, "min-w-0")}>
              <span className="mr-1 tabular-nums text-muted-foreground">{i + 1}.</span>
              {p.pergunta}
            </p>
            {p.exemplos.length ? (
              <div className="mt-1 flex min-w-0 flex-wrap" aria-label={`Exemplos para: ${p.pergunta}`}>
                {p.exemplos.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className={juntar(botao.discreto, "mb-1 mr-1 h-7 max-w-full truncate border border-border px-2 text-[12px]")}
                    onClick={() => onExemplo(p, ex)}
                    disabled={ocupado}
                    title="Preenche a caixa com este exemplo (não envia)"
                    data-exemplo={p.id}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
