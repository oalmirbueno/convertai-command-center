import { Check, Clock, Plus } from "lucide-react";
import { juntar, texto } from "@/components/sistema";
import { TIPOS_DE_NO, type TipoDeNo } from "@/lib/laboratorio/nos";
import type { ItemUsado, PecaDoPacote } from "@/lib/laboratorio/complemento";
import { useImagens } from "../ResultadoDoNo";
import { IconeDoNo } from "../icones";
import { useAcoesDoQuadro } from "./contexto";

/**
 * O nó criativo mostra o que está usando das entradas ("Marca ✓", "Copy ✓")
 * e sugere o que falta ("+ Ligar Copy" cria e liga o nó). O Pôr no ar mostra
 * o pacote montado: miniatura e texto de tudo que chega a ele.
 */
export function ComplementoDoNo({ noId, usando, sugestoes }: { noId: string; usando: ItemUsado[]; sugestoes: TipoDeNo[] }) {
  const a = useAcoesDoQuadro();
  if (!usando.length && !sugestoes.length) return null;
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center" aria-label="O que este nó usa" data-complemento-do-no={noId}>
      {usando.map((u, i) => (
        <span
          key={`${u.no_id}-${i}`}
          className={juntar("mb-1 mr-1 inline-flex h-5 max-w-full items-center rounded-full px-2 text-[11px] font-medium", u.pronto ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}
          title={u.pronto ? (u.como ? `${u.rotulo}: ${u.como}` : `Usando: ${u.rotulo}`) : `${u.rotulo}: ainda não pronto`}
          data-usando=""
        >
          <span className="truncate">{u.rotulo}</span>
          {u.pronto ? <Check className="ml-0.5 h-3 w-3 shrink-0" aria-label="pronto" /> : <Clock className="ml-0.5 h-3 w-3 shrink-0" aria-label="ainda não pronto" />}
        </span>
      ))}
      {!a.travado
        ? sugestoes.map((t) => (
            <button
              key={t}
              type="button"
              className="mb-1 mr-1 inline-flex h-5 items-center rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              onClick={() => a.ligarNovo(noId, t)}
              title={`Cria um nó ${TIPOS_DE_NO[t].rotulo} e liga aqui`}
              data-sugestao={t}
            >
              <Plus className="mr-0.5 h-3 w-3" aria-hidden="true" />
              Ligar {TIPOS_DE_NO[t].rotulo}
            </button>
          ))
        : null}
    </div>
  );
}

function MiniaturaDaPeca({ peca }: { peca: PecaDoPacote }) {
  const urls = useImagens(peca.imagem ? [peca.imagem] : []);
  const cor = TIPOS_DE_NO[peca.tipo].cor;
  return urls[0] ? (
    <img src={urls[0]} alt="" className="h-10 w-10 shrink-0 rounded-md bg-muted object-cover" loading="lazy" />
  ) : (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md" style={{ background: `${cor}1f`, color: cor }}>
      <IconeDoNo tipo={peca.tipo} className="h-4 w-4" />
    </span>
  );
}

/** O pacote que chega ao Pôr no ar: o dono vê que o fluxo fecha. */
export function PacoteDoFluxo({ pecas }: { pecas: PecaDoPacote[] }) {
  if (!pecas.length) return null;
  const prontas = pecas.filter((p) => p.pronto).length;
  return (
    <div className="mb-2 min-w-0" data-pacote-do-fluxo="">
      <p className={juntar(texto.rotulo, "mb-1")}>
        O que vai junto · {prontas} de {pecas.length} prontas
      </p>
      <ul className="min-w-0 space-y-1">
        {pecas.map((p) => (
          <li key={p.no_id} className="flex min-w-0 items-center" data-peca-do-pacote={p.no_id}>
            <MiniaturaDaPeca peca={p} />
            <span className="ml-2 min-w-0 flex-1">
              <span className={juntar(texto.corpo, "flex min-w-0 items-center font-medium")}>
                <span className="truncate">{p.rotulo}</span>
                {p.pronto ? <Check className="ml-1 h-3 w-3 shrink-0 text-primary" aria-label="pronta" /> : <Clock className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" aria-label="ainda não pronta" />}
              </span>
              {p.texto ? <span className={juntar(texto.auxiliar, "block truncate")}>{p.texto}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
