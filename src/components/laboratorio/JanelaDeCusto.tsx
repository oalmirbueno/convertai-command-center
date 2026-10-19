import { CircleDollarSign, Loader2, Play } from "lucide-react";
import { JanelaCentral, botao, juntar, lista, texto } from "@/components/sistema";
import { usd } from "@/lib/mesa/api";

/**
 * O custo antes de rodar (regra do Laboratório: nada gera sem o dono ver o
 * preço e confirmar). Mostra o custo de cada nó e o total; "Rodar" só chama
 * a função depois do clique aqui.
 */
export interface LinhaDeCusto {
  id: string;
  nome: string;
  custo_usd: number;
}

export default function JanelaDeCusto({
  aberta,
  titulo,
  linhas,
  total,
  rodando,
  aviso,
  onConfirmar,
  onFechar,
}: {
  aberta: boolean;
  titulo: string;
  linhas: LinhaDeCusto[];
  total: number;
  rodando: boolean;
  aviso?: string;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      titulo={titulo}
      icone={<CircleDollarSign className="h-4 w-4" />}
      descricao={`Total estimado ${usd(total)}`}
      ajuda="O valor sai da carteira do cliente escolhido (ou da carteira da agência, no Livre). Falha não cobra."
      largura="sm"
      data-janela-de-custo=""
      rodape={
        <>
          <button type="button" className={botao.discreto} onClick={onFechar}>Cancelar</button>
          <button type="button" className={botao.primario} onClick={onConfirmar} disabled={rodando} data-confirmar-custo="">
            {rodando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Rodar · {usd(total)}
          </button>
        </>
      }
    >
      {linhas.length ? (
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {linhas.map((l) => (
            <li key={l.id} className={juntar(lista.linha, "justify-between")}>
              <span className={juntar(texto.corpo, "min-w-0 truncate")}>{l.nome}</span>
              <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{usd(l.custo_usd)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={texto.auxiliar}>Nenhum nó que gasta neste pedido.</p>
      )}
      {aviso ? <p className={juntar(texto.auxiliar, "mt-3 text-warning")}>{aviso}</p> : null}
    </JanelaCentral>
  );
}
