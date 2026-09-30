import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { totaisDosItens } from "../../../supabase/functions/_shared/proposta-modelo";
import {
  normalizarPagamento,
  PAGAMENTO_SUGERIDO,
  resumoDosPacotes,
  ROTULO_DO_PAGAMENTO,
  textoDaOpcao,
  TIPOS_DE_PAGAMENTO,
  type OpcaoDePagamento,
  type TipoDePagamento,
} from "../../../supabase/functions/_shared/proposta-comercial";
import { aplicarNaLista, chamarProposta, type Proposta } from "./propostaApi";

/**
 * Condições de pagamento da proposta (frente PRO2): à vista com desconto,
 * parcelado (com ou sem entrada) e mensal. A página do cliente mostra o valor
 * de cada forma (pelo pacote recomendado, quando há pacotes) e o cliente
 * escolhe no aceite. O valor continua saindo dos itens.
 */

type OpcaoNaTela = { ativo: boolean; desconto: string; parcelas: string; entrada: string; observacao: string };
type Estado = Record<TipoDePagamento, OpcaoNaTela>;

const vazio: OpcaoNaTela = { ativo: false, desconto: "0", parcelas: "3", entrada: "0", observacao: "" };

function paraTela(opcoes: OpcaoDePagamento[]): Estado {
  const e = { a_vista: { ...vazio }, parcelado: { ...vazio }, mensal: { ...vazio } } as Estado;
  for (const o of opcoes) e[o.tipo] = { ativo: true, desconto: String(o.desconto_pct).replace(".", ","), parcelas: String(o.parcelas), entrada: String(o.entrada_pct).replace(".", ","), observacao: o.observacao };
  return e;
}

function daTela(e: Estado): OpcaoDePagamento[] {
  return normalizarPagamento({
    opcoes: TIPOS_DE_PAGAMENTO.filter((t) => e[t].ativo).map((t) => ({ id: t, tipo: t, desconto_pct: Number(e[t].desconto.replace(",", ".")) || 0, parcelas: Number(e[t].parcelas) || 3, entrada_pct: Number(e[t].entrada.replace(",", ".")) || 0, observacao: e[t].observacao })),
  }).opcoes;
}

export default function PagamentoDaProposta({ proposta }: { proposta: Proposta }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [estado, setEstado] = useState<Estado>(() => paraTela(proposta.pagamento.opcoes));
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setEstado(paraTela(proposta.pagamento.opcoes)), [proposta.id, proposta.versao]);

  const opcoes = daTela(estado);
  const mudou = JSON.stringify(opcoes) !== JSON.stringify(proposta.pagamento.opcoes);
  const pacotes = resumoDosPacotes(proposta.itens, proposta.pacotes);
  const base = pacotes.length ? (pacotes.find((p) => p.destaque) || pacotes[1]).totais : totaisDosItens(proposta.itens);
  const m = (t: TipoDePagamento, c: Partial<OpcaoNaTela>) => setEstado((e) => ({ ...e, [t]: { ...e[t], ...c } }));

  const salvar = async () => {
    setSalvando(true);
    try {
      const d = await chamarProposta<any>("salvar", { proposta_id: proposta.id, versao_base: proposta.versao, pagamento: { opcoes } });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      toast.success("Formas de pagamento salvas.");
    } catch (e) {
      avisarErro(e, "O pagamento não foi salvo");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Secao
      titulo="Pagamento"
      divisoria
      descricao={`${opcoes.length ? `${opcoes.length} forma(s)` : "Só o texto das condições"}${mudou ? " · não salvo" : ""}`}
      ajuda="As formas de pagamento aparecem com o valor calculado na página do cliente, que escolhe uma no aceite. O desconto vale só para o valor único; o mensal segue mensal. Sem nenhuma forma ligada, vale o texto das condições do Rascunho."
      acao={
        <>
          {!opcoes.length && (
            <button type="button" className={botao.discreto} onClick={() => setEstado(paraTela(PAGAMENTO_SUGERIDO.opcoes))}>
              Usar o sugerido
            </button>
          )}
          <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={!mudou || salvando || proposta.status === "aceita"}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      <ul className={juntar(lista.aberta, "space-y-3")} aria-label="Formas de pagamento">
        {TIPOS_DE_PAGAMENTO.map((t) => {
          const e = estado[t];
          const op = opcoes.find((o) => o.tipo === t);
          return (
            <li key={t} className="min-w-0" data-forma-de-pagamento={t}>
              <label className={juntar(texto.corpo, "inline-flex items-center font-medium")}>
                <input type="checkbox" className="mr-2" checked={e.ativo} onChange={(ev) => m(t, { ativo: ev.target.checked })} />
                {ROTULO_DO_PAGAMENTO[t]}
              </label>
              {e.ativo && (
                <div className="mt-2 grid min-w-0 grid-cols-2 items-end gap-2 sm:grid-cols-[96px_96px_96px_minmax(0,1fr)]">
                  {t !== "mensal" && (
                    <CampoDeFormulario rotulo="Desconto (%)">
                      <input value={e.desconto} onChange={(ev) => m(t, { desconto: ev.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" className={campo} />
                    </CampoDeFormulario>
                  )}
                  {t === "parcelado" && (
                    <>
                      <CampoDeFormulario rotulo="Parcelas">
                        <input value={e.parcelas} onChange={(ev) => m(t, { parcelas: ev.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" className={campo} />
                      </CampoDeFormulario>
                      <CampoDeFormulario rotulo="Entrada (%)">
                        <input value={e.entrada} onChange={(ev) => m(t, { entrada: ev.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" className={campo} />
                      </CampoDeFormulario>
                    </>
                  )}
                  <CampoDeFormulario rotulo="Observação" className="col-span-2 sm:col-span-1">
                    <input value={e.observacao} onChange={(ev) => m(t, { observacao: ev.target.value })} maxLength={200} className={campo} placeholder="Ex.: PIX ou boleto" />
                  </CampoDeFormulario>
                </div>
              )}
              {op && base.itens > 0 && <p className={juntar(texto.auxiliar, "mt-1 tabular-nums")}>{textoDaOpcao(op, base)}</p>}
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}
