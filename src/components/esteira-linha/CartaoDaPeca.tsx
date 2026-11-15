import { useNavigate } from "react-router-dom";
import { ExternalLink, Palette } from "lucide-react";
import { MenuMais, foco, juntar } from "@/components/sistema";
import type { CartaoDaEsteira } from "@/lib/esteiraLinha/esteiraLinha";
import { ESTILO_DA_ETAPA } from "./estilosDaEtapa";

/** Para onde leva "Abrir na página completa" (a mesma regra de linkDoCartao). */
const ondeAbreAPaginaCompleta = (cartao: Pick<CartaoDaEsteira, "destino">): string =>
  cartao.destino === "estudio" ? "Estúdio" : "Agenda";

/**
 * Uma peça na grade (limpeza de 14/11/2026, 21h53): o título e uma linha só
 * com a etapa, marcada pela cor dela. O formato sai da vista (fica no nome
 * para leitor de tela e no `title`).
 *
 * O clique abre o painel da peça na própria Esteira (21h54): nada de navegar
 * para a Agenda. "Abrir na página completa" e "Abrir no Estúdio" ficam no
 * menu "…", que não dispara o clique do cartão.
 */
export default function CartaoDaPeca({ cartao, aoAbrir }: { cartao: CartaoDaEsteira; aoAbrir: (cartao: CartaoDaEsteira) => void }) {
  const navigate = useNavigate();
  const estilo = ESTILO_DA_ETAPA[cartao.etapa];
  const pagina = ondeAbreAPaginaCompleta(cartao);
  const estudio = cartao.linkDoEstudio && cartao.linkDoEstudio !== cartao.link ? cartao.linkDoEstudio : null;
  const pararClique = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div className="group relative" data-cartao-da-esteira={cartao.chave} data-etapa={cartao.etapa} data-revisao-interna={cartao.revisao ? "sim" : undefined}>
      <button
        type="button"
        onClick={() => aoAbrir(cartao)}
        title={[cartao.titulo, cartao.formato, cartao.revisao].filter(Boolean).join(" · ")}
        aria-label={`${cartao.titulo}. ${cartao.formato}. ${cartao.rotuloDaEtapa}. Ver detalhes`}
        aria-haspopup="dialog"
        className={juntar(
          "block w-full rounded-md border border-border bg-background py-2 pl-2 pr-7 text-left transition-colors hover:border-foreground/30 hover:bg-muted/50",
          foco,
        )}
        data-abrir-peca=""
      >
        <span className="line-clamp-2 break-words text-[12px] font-medium leading-4 text-foreground">{cartao.titulo}</span>
        <span className="mt-1 flex min-w-0 items-center text-[11px] leading-4 text-muted-foreground">
          <span className={juntar("mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full", estilo.ponto)} aria-hidden="true" />
          <span className="truncate">{cartao.rotuloDaEtapa}</span>
        </span>
      </button>
      <div
        className="absolute right-0.5 top-0.5"
        onClick={pararClique}
        onPointerDown={pararClique}
        onKeyDown={pararClique}
        data-menu-do-cartao=""
      >
        <MenuMais
          rotulo={`Mais ações: ${cartao.titulo}`}
          className="h-6 w-6 text-muted-foreground opacity-70 hover:opacity-100 group-hover:opacity-100"
          itens={[
            {
              rotulo: "Abrir na página completa",
              icone: <ExternalLink className="h-3.5 w-3.5" />,
              dica: `Abre a ${pagina}`,
              aoEscolher: () => navigate(cartao.link),
            },
            estudio && {
              rotulo: "Abrir no Estúdio",
              icone: <Palette className="h-3.5 w-3.5" />,
              aoEscolher: () => navigate(estudio),
            },
          ]}
        />
      </div>
    </div>
  );
}
