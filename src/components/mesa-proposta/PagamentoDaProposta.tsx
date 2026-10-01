import { useEffect, useState } from "react";
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
import type { Proposta } from "./propostaApi";
import { useSecaoSuja } from "./edicaoDaProposta";

/**
 * Condições de pagamento da proposta (frente PRO2): à vista com desconto,
 * parcelado (com ou sem entrada) e mensal. A página do cliente mostra o valor
 * de cada forma (pelo pacote recomendado, quando há pacotes) e o cliente
 * escolhe no aceite. O valor continua saindo dos itens.
 *
 * Frente UXS (30/09): sem Salvar próprio. A seção avisa a barra do pé do
 * Contexto quando muda (comparando com a base da edição) e o Salvar único
 * leva o pagamento junto; versão nova só atualiza a seção limpa.
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

/** Resumo de uma linha das formas ligadas ("à vista 5% · parcelado 3x"), para a linha do "Mais opções". */
export function resumoDoPagamento(opcoes: OpcaoDePagamento[]): string {
  return opcoes
    .map((o) => (o.tipo === "a_vista" ? `à vista${o.desconto_pct ? ` ${String(o.desconto_pct).replace(".", ",")}%` : ""}` : o.tipo === "parcelado" ? `parcelado ${o.parcelas}x` : "mensal"))
    .join(" · ");
}

export default function PagamentoDaProposta({ proposta, embutido = false }: { proposta: Proposta; /** PRS: sem a seção própria, dentro do "Mais opções de preço" (o Salvar é o mesmo da barra). */ embutido?: boolean }) {
  // Base da edição: as formas de quando a seção carregou ou foi salva por último.
  const [base, setBase] = useState<{ versao: number; opcoes: OpcaoDePagamento[] }>(() => ({ versao: proposta.versao, opcoes: proposta.pagamento.opcoes }));
  const [estado, setEstado] = useState<Estado>(() => paraTela(proposta.pagamento.opcoes));

  const opcoes = daTela(estado);
  const mudou = JSON.stringify(opcoes) !== JSON.stringify(base.opcoes);
  const pacotes = resumoDosPacotes(proposta.itens, proposta.pacotes);
  const totaisDaBase = pacotes.length ? (pacotes.find((p) => p.destaque) || pacotes[1]).totais : totaisDosItens(proposta.itens);
  const m = (t: TipoDePagamento, c: Partial<OpcaoNaTela>) => setEstado((e) => ({ ...e, [t]: { ...e[t], ...c } }));
  const recarregar = (p: Proposta) => {
    setBase({ versao: p.versao, opcoes: p.pagamento.opcoes });
    setEstado(paraTela(p.pagamento.opcoes));
  };
  // Versão nova (agente, anexo, outra pessoa): a seção limpa segue o banco; a suja fica com o que a pessoa escolheu.
  useEffect(() => {
    if (!mudou && base.versao !== proposta.versao) recarregar(proposta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposta.id, proposta.versao, mudou]);
  useSecaoSuja("pagamento", mudou, {
    rotulo: "Pagamento",
    chaves: ["pagamento"],
    campos: () => ({ pagamento: { opcoes } }),
    depois: recarregar,
    descartar: () => recarregar(proposta),
  });

  const sugerido = !opcoes.length ? (
    <button type="button" className={embutido ? juntar(botao.discreto, "h-8 px-2 text-[12px]") : botao.discreto} onClick={() => setEstado(paraTela(PAGAMENTO_SUGERIDO.opcoes))}>
      Usar o sugerido
    </button>
  ) : undefined;
  const formas = (
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
            {op && totaisDaBase.itens > 0 && <p className={juntar(texto.auxiliar, "mt-1 tabular-nums")}>{textoDaOpcao(op, totaisDaBase)}</p>}
          </li>
        );
      })}
    </ul>
  );
  if (embutido)
    return (
      <div className="min-w-0" data-pagamento-embutido="">
        <div className="mb-2 flex min-w-0 items-center">
          <span className={juntar(texto.rotulo, "mr-2")}>Formas de pagamento</span>
          {sugerido}
        </div>
        {formas}
      </div>
    );
  return (
    <Secao
      titulo="Pagamento"
      divisoria
      descricao={`${opcoes.length ? `${opcoes.length} forma(s)` : "Só o texto das condições"}${mudou ? " · não salvo" : ""}`}
      ajuda="As formas de pagamento aparecem com o valor calculado na página do cliente, que escolhe uma no aceite. O desconto vale só para o valor único; o mensal segue mensal. Sem nenhuma forma ligada, vale o texto das condições do Rascunho. O Salvar fica na barra do pé da etapa."
      acao={sugerido}
    >
      {formas}
    </Secao>
  );
}
