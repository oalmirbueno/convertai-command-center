import { Link } from "react-router-dom";
import { etiqueta, foco, juntar } from "@/components/sistema";
import type { CartaoDaEsteira } from "@/lib/esteiraLinha/esteiraLinha";
import { ESTILO_DA_ETAPA } from "./estilosDaEtapa";

/** Uma peça na grade: título, formato e etapa. O cartão inteiro leva à Agenda ou ao Estúdio. */
export default function CartaoDaPeca({ cartao }: { cartao: CartaoDaEsteira }) {
  const onde = cartao.destino === "estudio" ? "Abrir no Estúdio" : "Abrir na Agenda";
  const estilo = ESTILO_DA_ETAPA[cartao.etapa];
  return (
    <Link
      to={cartao.link}
      title={`${cartao.titulo} · ${onde}`}
      aria-label={`${cartao.titulo}. ${cartao.formato}. ${cartao.rotuloDaEtapa}. ${onde}`}
      data-cartao-da-esteira={cartao.chave}
      data-etapa={cartao.etapa}
      className={juntar("block rounded-md border border-border bg-background p-2 text-left transition-colors hover:border-foreground/30 hover:bg-muted/50", foco)}
    >
      <span className="line-clamp-2 break-words text-[12px] font-medium leading-4 text-foreground">{cartao.titulo}</span>
      <span className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{cartao.formato}</span>
        <span className={juntar(etiqueta, estilo.selo)}>
          <span className={juntar("mr-1 h-1.5 w-1.5 rounded-full", estilo.ponto)} aria-hidden="true" />
          {cartao.rotuloDaEtapa}
        </span>
      </span>
    </Link>
  );
}
