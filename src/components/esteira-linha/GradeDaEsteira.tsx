import { AlertTriangle } from "lucide-react";
import { juntar, texto } from "@/components/sistema";
import type { DiaDaGrade, FaixaDaEsteira } from "@/lib/esteiraLinha/esteiraLinha";
import CartaoDaPeca from "./CartaoDaPeca";

/**
 * A grade da semana: os dias em cima, uma faixa por cliente (a coluna do
 * cliente fica presa à esquerda) e os cartões das peças em cada dia. Rola na
 * horizontal por dentro quando a tela é estreita. Só leitura.
 */
export default function GradeDaEsteira({ dias, faixas, hoje }: { dias: DiaDaGrade[]; faixas: FaixaDaEsteira[]; hoje: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border" data-grade-da-esteira="">
      <table className="w-full min-w-[1040px] table-fixed border-collapse text-left">
        <caption className="sr-only">Esteira da semana: peças por cliente e por dia</caption>
        <colgroup>
          <col className="w-[176px]" />
          {dias.map((d) => <col key={d.data} />)}
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th scope="col" className={juntar(texto.rotulo, "sticky left-0 z-20 border-r border-border bg-muted px-3 py-2")}>Cliente</th>
            {dias.map((d) => (
              <th
                key={d.data}
                scope="col"
                aria-label={d.data === hoje ? `${d.rotuloLongo} (hoje)` : d.rotuloLongo}
                aria-current={d.data === hoje ? "date" : undefined}
                className={juntar(texto.rotulo, "border-l border-border px-2 py-2", d.data === hoje && "text-foreground")}
              >
                {d.rotulo}
                {d.data === hoje && <span className="ml-1.5 rounded bg-primary/15 px-1 py-0.5 text-[11px] font-medium text-primary">Hoje</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {faixas.map((faixa) => (
            <tr key={faixa.clientId} className="border-b border-border last:border-b-0" data-faixa-da-esteira={faixa.clientId}>
              <th scope="row" className="sticky left-0 z-10 border-r border-border bg-background px-3 py-2 align-top font-normal">
                <span className="block break-words text-[14px] font-medium leading-5 text-foreground">{faixa.nome}</span>
                {faixa.diaPrioritario !== null && (
                  <span className={juntar(texto.auxiliar, "mt-0.5 block")}>Dia prioritário: {faixa.nomeDoDiaPrioritario}</span>
                )}
                {faixa.aprovacaoDoClienteDispensada && (
                  <span
                    className={juntar(texto.auxiliar, "mt-0.5 block")}
                    data-aprovacao-dispensada=""
                    title="Regra do cadastro deste cliente: a revisão interna da agência basta. As peças não passam pela aprovação do cliente."
                  >
                    Aprovação do cliente dispensada
                  </span>
                )}
              </th>
              {faixa.celulas.map((celula) => (
                <td
                  key={celula.data}
                  data-dia={celula.data}
                  data-prioritario={celula.prioritario ? "sim" : undefined}
                  data-alerta={celula.alerta ? "sim" : undefined}
                  className={juntar(
                    "border-l border-border p-1.5 align-top",
                    celula.alerta ? "bg-amber-500/15" : celula.prioritario && "bg-accent",
                  )}
                >
                  {celula.prioritario && !celula.alerta && <span className="sr-only">Dia prioritário</span>}
                  {celula.alerta ? (
                    <p className="flex items-start text-[12px] font-medium leading-4 text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="mr-1 mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      Dia prioritário sem peça
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {celula.cartoes.map((cartao) => <CartaoDaPeca key={cartao.chave} cartao={cartao} />)}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
