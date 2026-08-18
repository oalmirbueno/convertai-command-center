import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { SERVICE_LABELS } from "@/lib/cycleDefs";
import { etapasDoServico, resumoDoTime, servicosDoCliente } from "@/lib/servicosCliente";
import { listEtapasFeitas, marcarEtapa } from "@/lib/entregaAvulsa";

/**
 * O andamento da entrega de um cliente avulso.
 *
 * Substitui o checklist semanal quando a folha é de avulso. As seis etapas do
 * ciclo descrevem rotina de contrato correndo — "posts agendados", "verba
 * conferida" — e o avulso não tem rotina: tem uma entrega, do serviço dele.
 * Mostrar aquele checklist descrevia um trabalho que não era o dele.
 */

interface Props {
  client: any;
  servico: string;
  canWrite: boolean;
}

export default function EtapasDaEntrega({ client, servico, canWrite }: Props) {
  const queryClient = useQueryClient();
  const [salvando, setSalvando] = useState<number | null>(null);

  const etapas = useMemo(() => etapasDoServico(servico), [servico]);
  const resumo = useMemo(() => resumoDoTime(client), [client]);
  const outros = useMemo(
    () => servicosDoCliente(client).filter((s) => s !== servico),
    [client, servico],
  );

  const chaveDaConsulta = ["entrega-etapas", client?.id, servico];
  const { data: feitas } = useQuery({
    queryKey: chaveDaConsulta,
    queryFn: () => listEtapasFeitas(client.id, servico),
    enabled: Boolean(client?.id && servico),
  });

  const concluidas = feitas ?? new Set<number>();
  const nomeDoServico = SERVICE_LABELS[servico] || servico;

  const alternar = async (step: number, rotulo: string) => {
    if (!canWrite) return;
    setSalvando(step);
    const feito = !concluidas.has(step);
    const ok = await marcarEtapa({ clientId: client.id, servico, step, rotulo, feito });
    setSalvando(null);
    if (!ok) {
      toast.error("Não foi possível salvar. Tente de novo.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: chaveDaConsulta });
  };

  return (
    <>
      {/* O que a Aceleriq faz para este cliente, na língua dele. */}
      {resumo && (
        <div className="mt-3 rounded-xl border border-primary/20 bg-primary/[0.05] px-3 py-2.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-primary">
            O seu time é
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-foreground">{resumo}</p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Entrega de {nomeDoServico}
        </p>
        {etapas.length > 0 && (
          <span className="shrink-0 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
            {etapas.filter((_, i) => concluidas.has(i + 1)).length}/{etapas.length}
          </span>
        )}
      </div>

      {etapas.length === 0 ? (
        // Serviço sem trilho próprio ainda aparece com nome e história; só não
        // inventa etapas que ninguém combinou.
        <p className="mt-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {nomeDoServico} ainda não tem etapas próprias desenhadas. O histórico e os
          trabalhos avulsos abaixo continuam registrando o que foi feito.
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {etapas.map((rotulo, index) => {
            const step = index + 1;
            const done = concluidas.has(step);
            return (
              <button
                key={rotulo}
                type="button"
                disabled={!canWrite || salvando === step}
                onClick={() => void alternar(step, rotulo)}
                className={`flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${
                  done ? "border-primary/30 bg-primary/[0.06]" : "border-border bg-card"
                } ${salvando === step ? "opacity-50" : ""}`}
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums ${
                    done ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[12.5px] leading-snug ${
                      done ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {rotulo}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {done ? "concluído" : "pendente"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {outros.length > 0 && (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Este cliente também tem{" "}
          {outros.map((s) => SERVICE_LABELS[s] || s).join(", ")}. Troque o serviço na
          fila de cima para ver a entrega de cada um.
        </p>
      )}
    </>
  );
}
