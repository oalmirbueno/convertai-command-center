import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, OctagonAlert } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { foco, juntar } from "@/components/sistema/estilos";
import { chavesAuditoria, lerAlertas, type AlertaNaTela } from "./auditoriaApi";

/**
 * Alertas da Conta ao vivo (12/10/2026, claude-ads ads-monitor e ads-creative): fadiga de criativo,
 * custo por resultado subindo, acima do custo máximo, ROAS abaixo do equilíbrio, gasto sem resultado
 * e coleta parada. Calculados no servidor em código, com a régua da memória da conta (C01 e C04).
 * Nada muda na conta: "Resolver com o agente" leva o pedido para o agente sênior, que propõe com Confirmar.
 */
export default function AlertasDaConta({ onPedirAoAgente }: { onPedirAoAgente?: (texto: string) => void }) {
  const { clientId } = useMesa();
  const q = useQuery({ queryKey: chavesAuditoria.alertas(clientId), queryFn: () => lerAlertas(clientId), enabled: !!clientId, staleTime: 2 * 60_000 });
  const alertas = q.data ?? [];
  if (!clientId || q.isLoading || q.isError || alertas.length === 0) return null;
  const criticos = alertas.filter((a) => a.nivel === "critico").length;

  const pedido = (a: AlertaNaTela) =>
    `Alerta da conta (${a.camada}): ${a.titulo}${a.alvo ? ` em "${a.alvo.nome}"` : ""}. ${a.texto} Proponha o que fazer, com a lista exata para eu confirmar.`;

  return (
    <section className="min-w-0" aria-label="Alertas da conta">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-[13px]">
        <span className="font-semibold">Alertas da conta</span>
        <span className="text-muted-foreground">
          {criticos ? `${criticos} ${criticos === 1 ? "crítico" : "críticos"}, ` : ""}
          {alertas.length} no total, últimos 14 dias
        </span>
        <AjudaRecolhida titulo="De onde vêm">
          Calculados pelo painel com os números da Meta e a régua da memória da conta: fadiga é frequência alta com o CTR caindo da primeira para a segunda semana; custo e ROAS são comparados com o custo máximo e o equilíbrio das finanças (C01). Só alerta com volume suficiente.
        </AjudaRecolhida>
      </div>
      <ul className="min-w-0 divide-y divide-border border-y border-border">
        {alertas.slice(0, 8).map((a, i) => (
          <li key={i} className="flex min-w-0 items-start gap-2.5 py-2 text-[12.5px] leading-5">
            {a.nivel === "critico" ? <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
            <div className="min-w-0 flex-1">
              <p className="min-w-0 break-words">
                <span className="font-medium">{a.titulo}</span>
                {a.alvo && <span className="text-muted-foreground"> · {a.alvo.nome}</span>}
              </p>
              <p className="min-w-0 break-words text-muted-foreground">{a.texto}</p>
            </div>
            {onPedirAoAgente && (
              <button type="button" onClick={() => onPedirAoAgente(pedido(a))} className={juntar("inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-primary hover:underline", foco)}>
                Resolver com o agente <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {alertas.length > 8 && <p className="mt-1 text-[11.5px] text-muted-foreground">E mais {alertas.length - 8}. O agente sênior vê todos.</p>}
    </section>
  );
}
