import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, PauseCircle, RotateCcw, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, EstadoDeErro, EstadoVazio, RegiaoRolavel, Secao, botao, juntar, superficie, texto } from "@/components/sistema";
import { Etiqueta, GradeDeKpis, Kpi, botaoDeLinha, botaoPrincipalDeLinha } from "@/components/finance/pecasDoFinanceiro";
import { todayBR } from "@/lib/dateBR";
import {
  encerrar, parcelaEmAberto, pausar, porMes, reassinar, resumoDoCorte, vencimentoAoReassinar,
  type LinhaDeDespesa,
} from "@/lib/financeiro/corteDeCustos";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const dataBr = (v?: string | null) => (v ? new Date(v.length > 10 ? v : `${v}T12:00:00`).toLocaleDateString("pt-BR") : "-");

/**
 * Aba "Corte de custos" (27/11/2026): o que foi pausado ou encerrado, quanto isso liberou por mês, e o que
 * está ativo do maior para o menor, para decidir o próximo corte. Reassinar devolve a recorrência.
 */
export default function CorteDeCustos() {
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const r = useMemo(() => resumoDoCorte(data as LinhaDeDespesa[]), [data]);
  const hoje = todayBR();

  const agir = async (id: string, fazer: () => Promise<unknown>, ok: string) => {
    setOcupado(id);
    try {
      await fazer();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["expenses"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui salvar.");
    } finally {
      setOcupado(null);
    }
  };

  if (error) {
    return <EstadoDeErro titulo="Não consegui ler os custos." acao={<button type="button" onClick={() => refetch()} className={botao.secundario}>Tentar de novo</button>} />;
  }
  if (isLoading) return <Carregando linhas={4} rotulo="Carregando o corte de custos" />;

  const linhaCortada = (e: LinhaDeDespesa) => {
    const rec = e.corte_recorrencia === "yearly" ? "yearly" : "monthly";
    const vaiVencer = vencimentoAoReassinar(e.due_date, rec, hoje);
    return (
      <li key={e.id} className="flex min-w-0 flex-wrap items-center py-3 transition-colors hover:bg-muted/40">
        <div className="mr-3 min-w-0 flex-1 basis-56">
          <p className="truncate text-[13px] font-medium text-foreground">{e.description}</p>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center [&>*]:mb-0.5">
            <span className={juntar(texto.auxiliar, "mr-2")}>
              {e.corte_estado === "pausada" ? "Pausada" : "Encerrada"} em {dataBr(e.corte_em)} · {rec === "yearly" ? "anual" : "mensal"}
            </span>
            {parcelaEmAberto(e) && (
              <Etiqueta tom="aviso">Parcela de {dataBr(e.due_date)} em aberto no Fluxo de caixa</Etiqueta>
            )}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center py-1 [&>*+*]:ml-2">
          <p className="whitespace-nowrap text-right text-[13px] font-semibold tabular-nums text-success">
            +{fmt(porMes(e.amount, e.corte_recorrencia))}<span className="text-[11px] font-normal text-muted-foreground">/mês</span>
          </p>
          {e.corte_estado === "pausada" && (
            <button type="button" disabled={!!ocupado} onClick={() => void agir(e.id, () => encerrar(e), `${e.description} encerrada.`)} className={botaoDeLinha}>
              <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Encerrar
            </button>
          )}
          <button
            type="button"
            disabled={!!ocupado}
            title={`Volta a se repetir; próximo vencimento ${dataBr(vaiVencer)}`}
            onClick={() => void agir(e.id, () => reassinar(e, hoje), `${e.description} reassinada. Próximo vencimento ${dataBr(vaiVencer)}.`)}
            className={botaoPrincipalDeLinha}
          >
            {ocupado === e.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
            Reassinar
          </button>
        </div>
      </li>
    );
  };

  const lista = (itens: LinhaDeDespesa[], memoria: string, rotulo: string, render: (e: LinhaDeDespesa) => JSX.Element) => (
    <RegiaoRolavel memoria={memoria} rotulo={rotulo} sobre="cartao" classeDeFora={juntar(superficie.painel, "overflow-hidden")} className="lg:max-h-[420px]">
      <ul className="py-1.5 [&>li]:px-4 sm:[&>li]:px-6">{itens.map(render)}</ul>
    </RegiaoRolavel>
  );

  return (
    <div className="min-w-0 [&>*+*]:mt-8">
      <GradeDeKpis>
        <Kpi rotulo="Liberado por mês" valor={fmt(r.liberado)} apoio={`${r.pausadas.length + r.encerradas.length} assinaturas cortadas`} tom="sucesso" />
        <Kpi rotulo="Custos fixos agora" valor={fmt(r.agora)} apoio={`${r.ativos.length} ativos, sem pró-labore`} tom="aviso" />
        <Kpi rotulo="Antes do corte" valor={fmt(r.antes)} apoio="Agora + o que foi cortado" />
        <Kpi rotulo="Redução" valor={`${(r.fracao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`} apoio={`${fmt(r.liberado * 12)} por ano`} tom="primario" />
      </GradeDeKpis>

      <Secao titulo="Pausadas" descricao={r.pausadas.length ? `${r.pausadas.length} · voltam com Reassinar` : undefined}>
        {r.pausadas.length ? (
          lista(r.pausadas, "financeiro:corte:pausadas", "Assinaturas pausadas", linhaCortada)
        ) : (
          <EstadoVazio compacto titulo="Nada pausado." descricao="Pause pelo botão da lista abaixo: deixa de contar no mês e volta quando você reassinar." />
        )}
      </Secao>

      <Secao divisoria titulo="Encerradas" descricao={r.encerradas.length ? `${r.encerradas.length} · ${fmt(r.encerradas.reduce((s, e) => s + porMes(e.amount, e.corte_recorrencia), 0))}/mês liberados` : undefined}>
        {r.encerradas.length ? (
          lista(r.encerradas, "financeiro:corte:encerradas", "Assinaturas encerradas", linhaCortada)
        ) : (
          <EstadoVazio compacto titulo="Nada encerrado ainda." />
        )}
        {r.encerradas.some(parcelaEmAberto) || r.pausadas.some(parcelaEmAberto) ? (
          <p className={juntar(texto.auxiliar, "mt-3")}>
            Parcela em aberto: o último vencimento ficou pendente no Fluxo de caixa. Se pagou, dê baixa lá; se não deve, remova o lançamento lá. Reassinar recomeça do próximo vencimento a partir de hoje.
          </p>
        ) : null}
      </Secao>

      <Secao divisoria titulo="Ativos, do maior para o menor" descricao={`${fmt(r.agora)}/mês · onde olhar primeiro para o próximo corte`}>
        {r.ativos.length ? (
          lista(r.ativos, "financeiro:corte:ativos", "Custos ativos", (e) => (
            <li key={e.id} className="flex min-w-0 flex-wrap items-center py-3 transition-colors hover:bg-muted/40">
              <div className="mr-3 min-w-0 flex-1 basis-56">
                <p className="truncate text-[13px] font-medium text-foreground">{e.description}</p>
                <p className={texto.auxiliar}>
                  {e.recurrence === "yearly" ? `Anual (${fmt(Number(e.amount) || 0)})` : "Mensal"} · {r.agora > 0 ? `${Math.round((porMes(e.amount, e.recurrence) / r.agora) * 100)}% do fixo` : ""}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center py-1 [&>*+*]:ml-2">
                <p className="whitespace-nowrap text-right text-[13px] font-semibold tabular-nums text-foreground">
                  {fmt(porMes(e.amount, e.recurrence))}<span className="text-[11px] font-normal text-muted-foreground">/mês</span>
                </p>
                <button type="button" disabled={!!ocupado} onClick={() => void agir(e.id, () => pausar(e.id), `${e.description} pausada. Cancele também no fornecedor.`)} className={botaoDeLinha}>
                  {ocupado === e.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <PauseCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                  Pausar
                </button>
                <button type="button" disabled={!!ocupado} onClick={() => void agir(e.id, () => encerrar(e), `${e.description} encerrada. Cancele também no fornecedor.`)} className={botaoDeLinha}>
                  <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Encerrar
                </button>
              </div>
            </li>
          ))
        ) : (
          <EstadoVazio compacto titulo="Nenhum custo fixo ativo." />
        )}
      </Secao>
    </div>
  );
}
