import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { useMesa } from "@/components/mesa/MesaContexto";
import { usd } from "@/lib/mesa/api";
import { chamarAcaoDoAgente, type AcaoDoAgente, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import { atualizarTelasDepoisDoDiretor, confirmarGeracaoItemAItem, custoDaProposta, executarItemDoDiretor, type RespostaDoItem } from "./diretorApi";

/**
 * Cartão das fotos que o diretor vai gerar (proposta paga, agente
 * "diretor_geracao"): a lista, o custo estimado no próprio botão e só a
 * confirmação gera, uma foto por vez. A cada foto a etapa aberta (Clones,
 * Book, Fotos) relê a lista e a foto aparece ali, sem o dono sair de onde
 * está. Cancelar antes não gasta nada; Desfazer depois arquiva o que saiu.
 */
export default function CartaoDaGeracao({
  acao,
  mensagemId,
  executar = executarItemDoDiretor,
}: {
  acao: AcaoDoAgente;
  mensagemId: string;
  /** Para os testes: a chamada de uma foto. */
  executar?: (mensagemId: string, acaoId: string, ref: string) => Promise<RespostaDoItem>;
}) {
  const { clientId, saldoUsd, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const [andamento, setAndamento] = useState<{ feitos: number; total: number } | null>(null);
  const { valor, incompleto } = custoDaProposta(acao);
  const total = acao.itens.length;
  const semSaldo = typeof saldoUsd === "number" && typeof valor === "number" && valor > saldoUsd + 1e-9;
  const textoDoCusto = valor === null ? "custo a confirmar" : `${incompleto ? "a partir de " : "~"}${usd(valor)}`;

  const onPedido = async (pedido: "confirmar" | "descartar" | "desfazer"): Promise<RespostaDaAcao> => {
    if (pedido !== "confirmar") return chamarAcaoDoAgente("mesa-foto", mensagemId, acao.id, pedido);
    setAndamento({ feitos: (acao.resultados || []).length, total });
    try {
      const r = await confirmarGeracaoItemAItem({
        mensagemId,
        acao,
        executar,
        aoComecarItem: (feitos, t) => setAndamento({ feitos, total: t }),
        aoAvancar: (feitos, t, anexo) => {
          setAndamento({ feitos, total: t });
          // A foto nova aparece na etapa aberta sem esperar o lote inteiro.
          atualizarTelasDepoisDoDiretor(queryClient, clientId, anexo || acao);
          atualizarCusto();
        },
      });
      return { anexo: r.anexo, custo_usd: r.custo_usd };
    } finally {
      setAndamento(null);
    }
  };

  return (
    <CartaoDeAcao
      acao={acao}
      titulo="O diretor vai gerar"
      observacao={
        andamento
          ? `Gerando ${Math.min(andamento.feitos + 1, andamento.total)} de ${andamento.total}...`
          : semSaldo
            ? "Saldo da carteira do cliente não cobre. Peça a recarga."
            : "Uma foto por vez. Desfazer arquiva o que saiu."
      }
      onPedido={onPedido}
      onFeito={(_p, r) => {
        atualizarTelasDepoisDoDiretor(queryClient, clientId, (r && (r.anexo as AcaoDoAgente)) || acao);
        atualizarCusto();
      }}
      renderConfirmar={(confirmar, ocupado) => (
        <Button type="button" size="sm" className="h-8" onClick={() => void confirmar()} disabled={ocupado || semSaldo || total === 0} data-confirmar-geracao="">
          {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Gerar {total} {total === 1 ? "foto" : "fotos"} · {textoDoCusto}
        </Button>
      )}
    />
  );
}
