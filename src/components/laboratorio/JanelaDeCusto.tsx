import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, Loader2, Play, Wallet } from "lucide-react";
import { JanelaCentral, botao, juntar, lista, texto } from "@/components/sistema";
import { usd } from "@/lib/mesa/api";
import { chaveDosCreditos, saldoDepoisDoCusto } from "@/lib/laboratorio/api";
import { JanelaDeCreditos, useCreditosDoLab } from "./CreditosDoLab";

/**
 * O custo antes de rodar (regra do Laboratório: nada gera sem o dono ver o
 * preço e confirmar). Mostra o custo de cada nó e o total; "Rodar" só chama
 * a função depois do clique aqui.
 *
 * Créditos do Laboratório (20/10): com o limite ligado, mostra o saldo depois
 * de rodar; se faltar, avisa e troca o "Rodar" por "Carregar créditos" (a
 * função responderia 402 sem_credito). Limite desligado: nada muda aqui.
 * `creditos={false}` desliga a linha (quem não desconta do Laboratório).
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
  creditos = true,
  onConfirmar,
  onFechar,
}: {
  aberta: boolean;
  titulo: string;
  linhas: LinhaDeCusto[];
  total: number;
  rodando: boolean;
  aviso?: string;
  /** Desconta dos créditos do Laboratório (padrão: sim). */
  creditos?: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const q = useCreditosDoLab(aberta && creditos);
  const [carregando, setCarregando] = useState(false);
  const saldo = creditos ? saldoDepoisDoCusto(q.data, total) : null;
  const falta = !!saldo && saldo.falta > 0;
  const podeCarregar = !!q.data && q.data.pode_carregar;

  // Ao fechar (rodou ou desistiu), o chip do cabeçalho relê o saldo.
  const estavaAberta = useRef(aberta);
  useEffect(() => {
    if (estavaAberta.current && !aberta && creditos) void queryClient.invalidateQueries({ queryKey: chaveDosCreditos });
    estavaAberta.current = aberta;
  }, [aberta, creditos, queryClient]);
  // Rodou e a janela seguiu aberta (a função recusou, ex.: 402 sem_credito): relê o saldo para mostrar o que falta.
  const estavaRodando = useRef(rodando);
  useEffect(() => {
    if (estavaRodando.current && !rodando && aberta && creditos) void queryClient.invalidateQueries({ queryKey: chaveDosCreditos });
    estavaRodando.current = rodando;
  }, [rodando, aberta, creditos, queryClient]);

  return (
    <>
      <JanelaCentral
        aberta={aberta}
        onFechar={onFechar}
        titulo={titulo}
        icone={<CircleDollarSign className="h-4 w-4" />}
        descricao={`Total estimado ${usd(total)}`}
        ajuda="O valor sai da carteira do cliente escolhido (ou da carteira da agência, no Livre) e, com o limite ligado, dos créditos do Laboratório. Falha não cobra."
        largura="sm"
        data-janela-de-custo=""
        rodape={
          <>
            <button type="button" className={botao.discreto} onClick={onFechar}>Cancelar</button>
            {falta ? (
              <button
                type="button"
                className={botao.primario}
                onClick={() => setCarregando(true)}
                disabled={!podeCarregar}
                title={podeCarregar ? "Carregar créditos do Laboratório" : "Só o admin carrega créditos"}
                data-carregar-creditos-do-custo=""
              >
                <Wallet className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Carregar créditos
              </button>
            ) : (
              <button type="button" className={botao.primario} onClick={onConfirmar} disabled={rodando} data-confirmar-custo="">
                {rodando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                Rodar · {usd(total)}
              </button>
            )}
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
        {saldo ? (
          <div className="mt-3 flex min-w-0 items-center justify-between" data-saldo-depois="">
            <span className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
              <Wallet className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Créditos do Laboratório: {usd(q.data ? q.data.saldo_usd : 0)}</span>
            </span>
            <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums", falta ? "text-destructive" : "")}>
              Saldo depois {usd(saldo.depois)}
            </span>
          </div>
        ) : null}
        {falta ? (
          <p className={juntar(texto.auxiliar, "mt-2 text-destructive")} data-sem-credito="" role="status">
            Falta {usd(saldo!.falta)} nos créditos do Laboratório. {podeCarregar ? "Carregue para rodar." : "Peça ao admin para carregar."}
          </p>
        ) : null}
        {aviso ? <p className={juntar(texto.auxiliar, "mt-3 text-warning")}>{aviso}</p> : null}
      </JanelaCentral>
      {creditos ? <JanelaDeCreditos aberta={carregando} onFechar={() => setCarregando(false)} /> : null}
    </>
  );
}
