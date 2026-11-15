import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { texto } from "@/components/sistema";
import { CardSurface, ChartLegend, Donut, ProgressBar, StatCard, type DonutSegment } from "@/components/ds";
import { caixaDaCasa, dinheiro, recebidoDoMes, type CaixaDaCasa, type RecebidoDoMes } from "@/lib/comercial";

/**
 * O dinheiro do mês, lido do Financeiro geral (13/11/2026, pedido do dono):
 * em cima o que entrou, o que saiu e o saldo em caixa; embaixo, de onde
 * entrou (mensalidades, avulsos, projetos e o produto CRM e E-mail). Mesmas
 * contas do Financeiro, à vista no Comercial e na Visão geral do Financeiro.
 */
export default function DinheiroDoMes({ recebido, caixa }: { recebido?: RecebidoDoMes; caixa?: CaixaDaCasa }) {
  const ou = (v: number | undefined) => (v === undefined ? "…" : dinheiro(v));
  const resultado = recebido && caixa ? recebido.total - caixa.saiuNoMes : undefined;
  const saldoNegativo = !!caixa && caixa.saldo < 0;
  // De onde entrou: as quatro partes do recebido do mês (a mesma conta do Financeiro), em rosca.
  const partes: DonutSegment[] = recebido
    ? [
        { label: "Mensalidades", value: recebido.mensalidades, tone: 1 },
        { label: "Avulsos e extras", value: recebido.avulsos, tone: 2 },
        { label: "Projetos", value: recebido.projetos, tone: 4 },
        { label: "CRM e E-mail", value: recebido.crmEmail, tone: 5 },
      ]
    : [];
  const apoios = [
    recebido ? `${recebido.clientesRecorrentes} ${recebido.clientesRecorrentes === 1 ? "cliente" : "clientes"}` : undefined,
    "à parte",
    "parcelas",
    "assinaturas",
  ];
  const valores = [recebido?.mensalidades, recebido?.avulsos, recebido?.projetos, recebido?.crmEmail];
  const rotulos = ["Mensalidades", "Avulsos e extras", "Projetos", "CRM e E-mail"];
  return (
    <section aria-label="Dinheiro do mês" className="grid min-w-0 gap-4 sm:gap-5 xl:grid-cols-12" data-dinheiro-do-mes="">
      {/* Rodada ousada (15/11/2026): o que entrou, o que saiu e o saldo em cartões de número grande; de onde
          entrou vira rosca com legenda. Os mesmos sete números de antes. */}
      <div role="group" aria-label="Dinheiro do mês, do Financeiro" className="grid min-w-0 grid-cols-2 gap-3 sm:gap-5 xl:col-span-7 xl:grid-cols-2">
        <StatCard
          className="col-span-2"
          size="xl"
          icon={<ArrowDownLeft className="h-5 w-5" />}
          label="Entrou no mês"
          value={ou(recebido?.total)}
          hint="tudo que foi recebido"
          chart={
            recebido && caixa && recebido.total > 0 ? (
              <span className="block min-w-0">
                <ProgressBar value={caixa.saiuNoMes} max={recebido.total} tone={4} striped height={10} label={`Saiu ${dinheiro(caixa.saiuNoMes)} de ${dinheiro(recebido.total)} que entraram`} />
                <span className="mt-2 flex min-w-0 items-center justify-between text-[12px] leading-4 text-muted-foreground">
                  <span className="truncate">Saídas sobre as entradas</span>
                  <span className="ml-2 shrink-0 font-medium tabular-nums text-foreground">{Math.round((caixa.saiuNoMes / recebido.total) * 100)}%</span>
                </span>
              </span>
            ) : !recebido || !caixa ? (
              // v4 (15/11/2026): enquanto os números chegam, a barra reserva o lugar (o cartão não cresce depois).
              <span aria-hidden="true" className="block min-w-0">
                <span className="block h-2.5 rounded-full bg-muted" />
                <span className="mt-2 block h-4" />
              </span>
            ) : undefined
          }
        />
        <StatCard
          size="md"
          icon={<ArrowUpRight className="h-4 w-4" />}
          label="Saiu no mês"
          value={ou(caixa?.saiuNoMes)}
          hint={resultado === undefined ? "despesas pagas" : resultado >= 0 ? `sobrou ${dinheiro(resultado)}` : `faltou ${dinheiro(-resultado)}`}
        />
        <StatCard
          size="md"
          className="max-sm:[&>span:first-child_.truncate]:whitespace-normal"
          variant={saldoNegativo ? "default" : "ink"}
          icon={<Wallet className="h-4 w-4" />}
          label="Saldo em caixa"
          value={saldoNegativo ? <span className="text-destructive">{ou(caixa?.saldo)}</span> : ou(caixa?.saldo)}
          hint="hoje, igual ao Financeiro"
        />
      </div>
      <CardSurface padded className="flex min-w-0 flex-col xl:col-span-5" data-de-onde-entrou="">
        <p className={texto.tituloSecao}>De onde entrou</p>
        <div role="group" aria-label="De onde entrou" className="mt-5 flex min-w-0 flex-1 flex-col items-center sm:flex-row">
          {!recebido && <span aria-hidden="true" className="mb-4 block h-[132px] w-[132px] shrink-0 rounded-full border-[16px] border-muted sm:mb-0 sm:mr-6" />}
          {recebido && recebido.total > 0 && (
            <Donut segments={partes} size={132} thickness={16} className="mb-4 shrink-0 sm:mb-0 sm:mr-6" label="Partes do recebido do mês">
              <span className="block text-center text-[11px] font-medium leading-4 text-muted-foreground">recebido</span>
            </Donut>
          )}
          <ChartLegend
            className="w-full min-w-0 flex-1"
            items={rotulos.map((rotulo, i) => ({
              tone: ([1, 2, 4, 5] as const)[i],
              label: (
                <>
                  <span className="text-foreground">{rotulo}</span>
                  {apoios[i] && <span className="ml-1.5 text-[12px]">{apoios[i]}</span>}
                </>
              ),
              value: ou(valores[i]),
            }))}
          />
        </div>
      </CardSurface>
    </section>
  );
}

/**
 * O mesmo bloco, lendo sozinho: é o que a Visão geral do Financeiro usa,
 * com o mês escolhido lá em cima ("AAAA-MM-01").
 */
export function DinheiroDoMesLido({ periodo }: { periodo: string }) {
  const recebido = useQuery({
    queryKey: ["comercial-receita", periodo],
    queryFn: () => recebidoDoMes(periodo),
    placeholderData: (anterior) => anterior,
  });
  const caixa = useQuery({
    queryKey: ["comercial-caixa", periodo],
    queryFn: () => caixaDaCasa(periodo),
    placeholderData: (anterior) => anterior,
  });
  return <DinheiroDoMes recebido={recebido.data} caixa={caixa.data} />;
}
