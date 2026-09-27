import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { useMesa } from "@/components/mesa/MesaContexto";
import { usd } from "@/lib/mesa/api";
import { chamarAcaoDoAgente, type AcaoDoAgente, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import { atualizarTelasDepoisDoDiretor, confirmarGeracaoItemAItem, custoDaProposta, executarItemDoDiretor, type RespostaDoItem } from "./diretorApi";
import ProvaDoDiretor from "./ProvaDoDiretor";

/**
 * Cartão das fotos que o diretor vai gerar (proposta paga, agente
 * "diretor_geracao"): a lista, o custo estimado no próprio botão e só a
 * confirmação gera, uma foto por vez. A cada foto a etapa aberta (Clones,
 * Book, Fotos) relê a lista e a foto aparece ali, sem o dono sair de onde
 * está. Cancelar antes não gasta nada; Desfazer depois arquiva o que saiu.
 *
 * Frente MF (27/09, "diretor que faz"): pedido claro e barato (até o teto do
 * servidor, poucas fotos e com saldo) chega marcado `ir_sozinho` e começa
 * sozinho quando a resposta acaba de chegar, com o custo à vista e o botão
 * Parar (o que já saiu fica, nada mais é gerado). Terminado, o cartão mostra
 * a prova (antes e depois) e o caminho para a área onde as fotos estão.
 */
export default function CartaoDaGeracao({
  acao,
  mensagemId,
  executar = executarItemDoDiretor,
  iniciarSozinha = false,
}: {
  acao: AcaoDoAgente;
  mensagemId: string;
  /** Para os testes: a chamada de uma foto. */
  executar?: (mensagemId: string, acaoId: string, ref: string) => Promise<RespostaDoItem>;
  /** A resposta acabou de chegar e o servidor liberou ir sozinho (teto, ordem clara, saldo). */
  iniciarSozinha?: boolean;
}) {
  const { clientId, saldoUsd, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const [andamento, setAndamento] = useState<{ feitos: number; total: number } | null>(null);
  const [feita, setFeita] = useState<AcaoDoAgente | null>(null);
  const parar = useRef(false);
  const { valor, incompleto } = custoDaProposta(acao);
  const total = acao.itens.length;
  const semSaldo = typeof saldoUsd === "number" && typeof valor === "number" && valor > saldoUsd + 1e-9;
  const textoDoCusto = valor === null ? "custo a confirmar" : `${incompleto ? "a partir de " : "~"}${usd(valor)}`;
  const vaiSozinha = iniciarSozinha && !semSaldo && !!acao.contexto && (acao.contexto as Record<string, unknown>).ir_sozinho === true;

  const onPedido = async (pedido: "confirmar" | "descartar" | "desfazer"): Promise<RespostaDaAcao> => {
    if (pedido !== "confirmar") return chamarAcaoDoAgente("mesa-foto", mensagemId, acao.id, pedido);
    parar.current = false;
    setAndamento({ feitos: (acao.resultados || []).length, total });
    try {
      const r = await confirmarGeracaoItemAItem({
        mensagemId,
        acao,
        executar,
        deveParar: () => parar.current,
        aoComecarItem: (feitos, t) => setAndamento({ feitos, total: t }),
        aoAvancar: (feitos, t, anexo) => {
          setAndamento({ feitos, total: t });
          // A foto nova aparece na etapa aberta sem esperar o lote inteiro.
          atualizarTelasDepoisDoDiretor(queryClient, clientId, anexo || acao);
          atualizarCusto();
        },
      });
      if (r.parou) {
        // Parou no meio: o servidor fecha a proposta (o que saiu fica, com o Desfazer).
        const fechada = await chamarAcaoDoAgente("mesa-foto", mensagemId, acao.id, "descartar");
        return { anexo: fechada.anexo || r.anexo, custo_usd: r.custo_usd };
      }
      return { anexo: r.anexo, custo_usd: r.custo_usd };
    } finally {
      setAndamento(null);
    }
  };

  return (
    <div className="min-w-0" data-cartao-da-geracao={acao.id}>
      <CartaoDeAcao
        acao={acao}
        titulo={vaiSozinha ? "O diretor já está gerando" : "O diretor vai gerar"}
        observacao={
          andamento
            ? `Gerando ${Math.min(andamento.feitos + 1, andamento.total)} de ${andamento.total}... (${textoDoCusto} no total)`
            : semSaldo
              ? "Saldo da carteira do cliente não cobre. Peça a recarga."
              : "Uma foto por vez. Desfazer arquiva o que saiu."
        }
        onPedido={onPedido}
        onFeito={(_p, r) => {
          const anexo = (r && (r.anexo as AcaoDoAgente)) || acao;
          setFeita(anexo);
          atualizarTelasDepoisDoDiretor(queryClient, clientId, anexo);
          atualizarCusto();
        }}
        renderConfirmar={(confirmar, ocupado) => (
          <>
            {vaiSozinha && <ConfirmarSozinho confirmar={confirmar} />}
            <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" onClick={() => void confirmar()} disabled={ocupado || semSaldo || total === 0} data-confirmar-geracao="">
              {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              Gerar {total} {total === 1 ? "foto" : "fotos"} · {textoDoCusto}
            </Button>
            {ocupado && andamento && (
              <Button type="button" size="sm" variant="outline" className="mb-1 h-8" onClick={() => (parar.current = true)} data-parar-geracao="">
                <Square className="mr-1.5 h-3.5 w-3.5" /> Parar
              </Button>
            )}
          </>
        )}
      />
      {feita && <ProvaDoDiretor acao={feita} />}
      {!feita && acao.resultados && acao.resultados.length > 0 && <ProvaDoDiretor acao={acao} />}
    </div>
  );
}

/** Confirma uma vez, sozinho, quando o cartão aparece (a resposta acabou de chegar). */
function ConfirmarSozinho({ confirmar }: { confirmar: () => Promise<unknown> }) {
  const foi = useRef(false);
  useEffect(() => {
    if (foi.current) return;
    foi.current = true;
    void confirmar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
