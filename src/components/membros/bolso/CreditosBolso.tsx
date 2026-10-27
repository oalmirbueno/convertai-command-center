import { useQuery } from "@tanstack/react-query";
import { Coins, RotateCcw } from "lucide-react";
import TituloMembros from "@/components/membros/TituloMembros";
import { erroDoBolso, lerExtrato } from "@/lib/bolso/api";
import { dataCurta, ROTULO_DO_LANCAMENTO, situacaoDoEstudio } from "@/lib/bolso/modelo";
import { FaixaDeDemonstracao, useEstadoDoBolso } from "./EstudioBolso";

/**
 * Créditos e acesso do Aceleriq de Bolso (26/10/2026): saldo disponível e reservado, validade do acesso e o
 * extrato, sem jargão. Os números vêm do banco (soma do extrato); nada aqui é calculado pela tela.
 */

const TIPO_DO_ACESSO: Record<string, string> = { anual: "Acesso de 12 meses", mensal: "Mensal", recarga: "Recarga", teste: "Teste (demonstração)" };

export default function CreditosBolso() {
  const estado = useEstadoDoBolso();
  const extrato = useQuery({ queryKey: ["bolso", "extrato"], queryFn: () => lerExtrato(80), retry: false, enabled: !!estado.data && estado.data.exposto });
  if (estado.isPending) return <p role="status">Carregando seus créditos…</p>;
  if (estado.isError)
    return (
      <div role="alert" className="space-y-3">
        <p>{erroDoBolso(estado.error)}</p>
        <button type="button" className="membros-acao" onClick={() => void estado.refetch()}>
          <RotateCcw size={16} aria-hidden="true" />
          Tentar de novo
        </button>
      </div>
    );
  const e = estado.data;
  const situacao = situacaoDoEstudio(e);
  if (!e.exposto) return <p className="text-[13px] text-muted-foreground">{situacao.texto}</p>;
  const vencido = !e.direito;
  return (
    <section className="space-y-6" aria-labelledby="bolso-creditos-titulo">
      {situacao.demonstracao && <FaixaDeDemonstracao />}
      <TituloMembros titulo="Créditos e acesso" principal icone={<Coins size={20} className="text-primary" aria-hidden="true" />}>
        Cada pedido ao estúdio mostra quantos créditos usa antes de confirmar. Os créditos ficam reservados enquanto o pedido roda: se não der
        certo, voltam. Editar à mão, consultar e baixar não usam crédito.
      </TituloMembros>
      <h2 id="bolso-creditos-titulo" className="sr-only">
        Seu saldo
      </h2>
      <dl className="bolso-numeros">
        <div>
          <dt>Disponível</dt>
          <dd>{e.saldo ? e.saldo.disponivel : 0}</dd>
        </div>
        <div>
          <dt>Reservado</dt>
          <dd>{e.saldo ? e.saldo.reservado : 0}</dd>
        </div>
        <div>
          <dt>Acesso</dt>
          <dd className="text-[14px]">
            {e.direito ? (
              <>
                {TIPO_DO_ACESSO[e.direito.tipo] || e.direito.tipo}
                <span className="block text-[12px] font-normal text-muted-foreground">até {dataCurta(e.direito.fim)}</span>
              </>
            ) : (
              "Sem acesso ativo"
            )}
          </dd>
        </div>
      </dl>
      {e.carteira === "teste" && <p className="text-[12px] text-muted-foreground">Estes créditos são de teste e não valem para o acesso real.</p>}
      {vencido && (
        <p role="status" className="bolso-aviso">
          Seu acesso ao estúdio não está ativo. Campanhas, textos e artes que você já fez continuam aqui para consultar e baixar.
        </p>
      )}
      <div className="space-y-3">
        <h3 className="text-[15px] font-semibold">Extrato</h3>
        {extrato.isPending ? (
          <p role="status">Carregando o extrato…</p>
        ) : extrato.isError ? (
          <p role="alert">{erroDoBolso(extrato.error)}</p>
        ) : extrato.data.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nenhuma movimentação ainda.</p>
        ) : (
          <ul className="bolso-lista" aria-label="Movimentações de créditos">
            {extrato.data.map((l) => (
              <li key={l.id} className="bolso-extrato-linha">
                <span className="min-w-0">
                  <strong className="block">{ROTULO_DO_LANCAMENTO[l.tipo]}</strong>
                  <span className="text-[12px] text-muted-foreground">
                    {l.descricao} · {dataCurta(l.criado_em)}
                    {l.carteira === "teste" ? " · teste" : ""}
                  </span>
                </span>
                <span className="tabular-nums text-[13px]" aria-label={`${l.delta_disponivel >= 0 ? "mais" : "menos"} ${Math.abs(l.delta_disponivel || l.quantidade)} créditos`}>
                  {l.tipo === "captura" ? `${l.quantidade} usado${l.quantidade === 1 ? "" : "s"}` : `${l.delta_disponivel > 0 ? "+" : "−"}${Math.abs(l.delta_disponivel)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
