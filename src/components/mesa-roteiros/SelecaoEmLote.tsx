import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { padraoPara, usd } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { TAMANHO_DA_GERACAO } from "../../../supabase/functions/_shared/roteiro-modelo";
import { atualizarNoCache, gerarRoteiro, type PedidoDeGeracao } from "./roteirosApi";
import { rodarLoteDeRoteiros, useFaixa, useLoteDeRoteiros, type ItemParaAbrir } from "./roteirosAbertos";

/**
 * Seleção múltipla da Mesa Roteiros (19/10/2026): marcou várias peças, roteiros
 * ou ideias, "Abrir os selecionados" põe todos na faixa de cima e "Gerar todos"
 * gera, um por vez, os que ainda não têm roteiro. O preço total aparece no
 * botão antes (BotaoComCusto: acima de US$ 1, segundo clique) e o andamento
 * fica em cada aba da faixa.
 */

/** O pedido de geração de um item, sem o cliente e o modelo de IA (a barra põe). */
export type CorpoDoLote = Omit<PedidoDeGeracao, "client_id" | "modelo_id">;

export interface ItemDaSelecao extends ItemParaAbrir {
  /** null: já tem roteiro (só abre). */
  corpo: CorpoDoLote | null;
}

export default function BarraDaSelecao({ itens, onLimpar }: { itens: ItemDaSelecao[]; onLimpar: () => void }) {
  const faixa = useFaixa();
  const mesa = useMesa();
  const qc = useQueryClient();
  const lote = useLoteDeRoteiros(mesa.clientId);
  if (!faixa || !itens.length) return null;
  const padrao = padraoPara(mesa.catalogo, "estrategista");
  const modeloId = padrao ? padrao.id : "";
  const paraGerar = itens.filter((i) => !!i.corpo);
  const n = paraGerar.length;
  const rodando = !!(lote && lote.ativo);
  const { clientId, atualizarCusto } = mesa;

  const gerarTodos = () => {
    const ids = faixa.abrirVarios(itens, { ir: false });
    const trabalhos: { abaId: string; corpo: PedidoDeGeracao }[] = [];
    itens.forEach((it, k) => {
      if (it.corpo) trabalhos.push({ abaId: ids[k], corpo: { ...it.corpo, client_id: clientId, modelo_id: modeloId || null } });
    });
    toast.info(`Gerando ${trabalhos.length} ${trabalhos.length === 1 ? "roteiro" : "roteiros"}, um por vez`, { description: "O andamento aparece em cada aba da faixa. Pode trocar de aba e de etapa." });
    void rodarLoteDeRoteiros({
      clientId,
      itens: trabalhos,
      gerar: gerarRoteiro,
      aoGerado: (abaId, data) => {
        atualizarNoCache(qc, clientId, data.roteiro);
        faixa.atualizarAba(abaId, { roteiro: String(data.roteiro.id), titulo: String(data.roteiro.titulo || "Roteiro"), avulso: false, modelo: null, base: null });
      },
    }).then((r) => {
      atualizarCusto();
      if (!r) return;
      const custo = `Custo real: ${usd(r.custo_usd)}.`;
      if (r.falhas) toast.warning(`${r.feitos} de ${r.feitos + r.falhas} roteiros gerados`, { description: `Passe o mouse na aba com o aviso para ver o motivo. ${custo}`, duration: 12000 });
      else toast.success(`${r.feitos} ${r.feitos === 1 ? "roteiro gerado" : "roteiros gerados"}`, { description: custo });
    });
    onLimpar();
    return Promise.resolve({});
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center" role="group" aria-label="Itens selecionados" data-selecao-em-lote="">
      <span className={juntar(texto.auxiliar, "mr-2")} data-quantos-selecionados={itens.length}>
        {itens.length} {itens.length === 1 ? "selecionado" : "selecionados"}
      </span>
      <button
        type="button"
        className={botao.icone}
        onClick={() => {
          faixa.abrirVarios(itens, { ir: true });
          onLimpar();
        }}
        aria-label="Abrir os selecionados"
        title="Abrir os selecionados na faixa"
      >
        <FolderOpen className="h-4 w-4" aria-hidden="true" />
      </button>
      {n > 0 && (
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Gerar todos ({n})
            </>
          }
          titulo="Roteiros gerados"
          descricao={`Gera, um por vez, ${n === 1 ? "o selecionado" : `os ${n} selecionados`} sem roteiro, com o modelo de IA padrão. Os que já têm roteiro só abrem na faixa.`}
          className="ml-1 h-8"
          disabled={!modeloId || rodando}
          fecharAoConfirmar
          partes={() => paraGerar.map(() => ({ modeloId, tipo: "texto" as const, tokensEntrada: TAMANHO_DA_GERACAO.entrada, tokensSaida: TAMANHO_DA_GERACAO.saida }))}
          executar={gerarTodos}
        />
      )}
      <button type="button" className={juntar(botao.icone, "ml-1")} onClick={onLimpar} aria-label="Limpar a seleção" title="Limpar a seleção">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
