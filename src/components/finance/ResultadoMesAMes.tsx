import { useQuery } from "@tanstack/react-query";
import { PiggyBank, Wallet } from "lucide-react";
import { Secao, juntar, texto } from "@/components/sistema";
import { DataTable, DeltaChip, MiniBars, StatCard, StatGrid, type DataColumn } from "@/components/ds";
import { historicoDoCaixa } from "@/lib/comercial";
import { variacao, type MesDoHistorico } from "@/lib/financeiro/historicoDoCaixa";

/**
 * Resultado mês a mês (16/11/2026, pedido do dono): o lucro do mês, quanto ficou no caixa no fim do
 * mês e o histórico para comparar. Lucro = o que entrou − o que saiu (despesas pagas). O caixa no fim
 * de cada mês sai do saldo de hoje andando para trás, então o mês corrente fecha com o "Saldo em caixa".
 */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_CHEIOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const dinheiro = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const nomeDoMes = (mes: string, curto = true) => {
  const [a, m] = mes.split("-").map(Number);
  return curto ? `${MESES[m - 1]}/${String(a).slice(2)}` : `${MESES_CHEIOS[m - 1]} ${a}`;
};

export function useHistoricoDoCaixa(periodo: string, versao = "") {
  return useQuery({
    queryKey: ["historico-do-caixa", periodo, versao],
    queryFn: () => historicoDoCaixa(periodo, 12),
    placeholderData: (anterior) => anterior,
  });
}

export default function ResultadoMesAMes({ periodo, versao, ehMesCorrente }: { periodo: string; versao?: string; ehMesCorrente: boolean }) {
  const { data, isLoading, isError, refetch } = useHistoricoDoCaixa(periodo, versao);
  const meses = Array.isArray(data?.meses) ? data.meses : [];
  const atual = meses[meses.length - 1];
  const anterior = meses.length > 1 ? meses[meses.length - 2] : undefined;
  const nome = atual ? nomeDoMes(atual.mes, false) : "";
  const vsAnterior = atual && anterior ? variacao(atual.lucro, anterior.lucro) : null;
  const vsMedia = atual && data?.media ? variacao(atual.lucro, data.media.lucro) : null;

  const colunas: DataColumn<MesDoHistorico>[] = [
    { key: "mes", header: "Mês", cell: (m) => <span className="font-medium text-foreground">{nomeDoMes(m.mes, false)}</span> },
    { key: "entrou", header: "Entrou", numeric: true, align: "right", cell: (m) => dinheiro(m.entrou) },
    { key: "saiu", header: "Saiu", numeric: true, align: "right", cell: (m) => dinheiro(m.saiu) },
    { key: "lucro", header: "Lucro", numeric: true, align: "right", cell: (m) => <span className={juntar("font-medium", m.lucro < 0 ? "text-destructive" : "text-foreground")}>{dinheiro(m.lucro)}</span> },
    { key: "margem", header: "Margem", numeric: true, align: "right", hideOnMobile: true, cell: (m) => (m.margem === null ? "-" : `${String(m.margem).replace(".", ",")}%`) },
    { key: "caixa", header: "Caixa no fim", numeric: true, align: "right", hideOnMobile: true, cell: (m) => <span className={m.caixaNoFim < 0 ? "text-destructive" : undefined}>{dinheiro(m.caixaNoFim)}</span> },
  ];

  return (
    <section aria-label="Resultado mês a mês" className="min-w-0 space-y-6" data-resultado-mes-a-mes="">
      {isError && (
        <p className={juntar(texto.auxiliar, "text-destructive")}>
          Não consegui ler o histórico agora. <button type="button" className="underline" onClick={() => void refetch()}>Tentar de novo</button>
        </p>
      )}
      <StatGrid cols={3} label={`Resultado de ${nome || "do mês"}`}>
        <StatCard
          size="lg"
          variant="ink"
          icon={<PiggyBank className="h-4 w-4" />}
          label={`Lucro de ${nome || "do mês"}`}
          value={isLoading || !atual ? "R$ --.---,--" : <span className={atual.lucro < 0 ? "text-destructive" : undefined}>{dinheiro(atual.lucro)}</span>}
          hint={atual ? `entrou ${dinheiro(atual.entrou)} · saiu ${dinheiro(atual.saiu)}` : undefined}
          help="O que entrou no mês menos as despesas pagas no mês. Aporte de investidor fica fora."
        />
        <StatCard
          size="lg"
          icon={<Wallet className="h-4 w-4" />}
          label={ehMesCorrente ? "Caixa hoje" : `Caixa no fim de ${nome}`}
          value={isLoading || !atual ? "R$ --.---,--" : <span className={atual.caixaNoFim < 0 ? "text-destructive" : undefined}>{dinheiro(atual.caixaNoFim)}</span>}
          hint={anterior ? `começou o mês com ${dinheiro(anterior.caixaNoFim)}` : undefined}
          help="Quanto ficou no caixa no fim do mês: o saldo de hoje voltando mês a mês pelo que entrou e saiu."
        />
        <StatCard
          size="lg"
          label="Comparado"
          value={
            atual ? (
              <span className="flex flex-wrap items-center text-[15px] font-medium leading-6 [&>*]:mb-1 [&>*]:mr-2">
                {vsAnterior !== null ? <DeltaChip value={vsAnterior} label={`${vsAnterior > 0 ? "+" : ""}${String(vsAnterior).replace(".", ",")}% vs mês anterior`} /> : <span className={texto.auxiliar}>sem mês anterior</span>}
                {vsMedia !== null && <DeltaChip value={vsMedia} label={`${vsMedia > 0 ? "+" : ""}${String(vsMedia).replace(".", ",")}% vs média`} />}
              </span>
            ) : "-"
          }
          hint={data?.media ? `média de lucro ${dinheiro(data.media.lucro)} por mês` : undefined}
          help="Lucro deste mês comparado ao mês anterior e à média dos meses fechados mostrados abaixo."
        />
      </StatGrid>

      {meses.length > 1 && (
        <Secao
          titulo="Lucro mês a mês"
          descricao={data?.melhor ? `melhor ${nomeDoMes(data.melhor.mes)} (${dinheiro(data.melhor.lucro)})${data.pior ? ` · pior ${nomeDoMes(data.pior.mes)} (${dinheiro(data.pior.lucro)})` : ""}` : undefined}
          ajuda="Cada barra é o lucro de um mês (só os meses positivos têm altura). O destaque é o mês escolhido lá em cima."
        >
          <MiniBars
            values={meses.map((m) => m.lucro)}
            labels={meses.map((m) => nomeDoMes(m.mes))}
            showLabels
            highlightIndex={meses.length - 1}
            height={72}
            label={`Lucro por mês: ${meses.map((m) => `${nomeDoMes(m.mes)} ${dinheiro(m.lucro)}`).join(", ")}`}
          />
          <DataTable
            className="mt-4"
            columns={colunas}
            rows={[...meses].reverse()}
            rowKey={(m) => m.mes}
            isHighlighted={(m) => m.mes === atual?.mes}
            dense
            caption="Entrou, saiu, lucro e caixa no fim de cada mês"
          />
        </Secao>
      )}
    </section>
  );
}
