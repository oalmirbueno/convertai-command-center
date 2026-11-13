import { FaixaDeNumeros } from "@/components/sistema";
import { dinheiro, type CaixaDaCasa, type RecebidoDoMes } from "@/lib/comercial";

/**
 * O dinheiro do mês, lido do Financeiro geral (13/11/2026, pedido do dono):
 * em cima o que entrou, o que saiu e o saldo em caixa; embaixo, de onde
 * entrou. Mesmas contas da tela do Financeiro, só que à vista no Comercial.
 */
export default function DinheiroDoMes({ recebido, caixa }: { recebido?: RecebidoDoMes; caixa?: CaixaDaCasa }) {
  const ou = (v: number | undefined) => (v === undefined ? "…" : dinheiro(v));
  const resultado = recebido && caixa ? recebido.total - caixa.saiuNoMes : undefined;
  return (
    <section aria-label="Dinheiro do mês" className="min-w-0 space-y-2">
      <FaixaDeNumeros
        rotulo="Dinheiro do mês, do Financeiro"
        itens={[
          { rotulo: "Entrou no mês", valor: ou(recebido?.total), ponto: "verde", apoio: "tudo que foi recebido" },
          {
            rotulo: "Saiu no mês",
            valor: ou(caixa?.saiuNoMes),
            ponto: "alerta",
            apoio:
              resultado === undefined
                ? "despesas pagas"
                : resultado >= 0
                  ? `sobrou ${dinheiro(resultado)}`
                  : `faltou ${dinheiro(-resultado)}`,
          },
          {
            rotulo: "Saldo em caixa",
            valor: ou(caixa?.saldo),
            ponto: caixa && caixa.saldo < 0 ? "perigo" : "info",
            corDoValor: caixa && caixa.saldo < 0 ? "text-destructive" : undefined,
            apoio: "hoje, igual ao Financeiro",
          },
        ]}
      />
      <FaixaDeNumeros
        tamanho="compacto"
        apoioAoLado
        rotulo="De onde entrou"
        itens={[
          {
            rotulo: "Mensalidades",
            valor: ou(recebido?.mensalidades),
            apoio: recebido ? `${recebido.clientesRecorrentes} ${recebido.clientesRecorrentes === 1 ? "cliente" : "clientes"}` : undefined,
          },
          { rotulo: "Avulsos e extras", valor: ou(recebido?.avulsos), apoio: "fora da mensalidade" },
          { rotulo: "Projetos", valor: ou(recebido?.projetos), apoio: "parcelas pagas" },
        ]}
      />
    </section>
  );
}
