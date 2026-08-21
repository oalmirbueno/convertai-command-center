import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheckBig, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { SERVICE_LABELS } from "@/lib/cycleDefs";
import { etapasDoServico, resumoDoTime, servicosDoCliente } from "@/lib/servicosCliente";
import {
  concluirEntrega,
  entregaConcluida,
  listEtapasFeitas,
  marcarEtapa,
} from "@/lib/entregaAvulsa";

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
  /** Concluir tira o cliente da lista viva; a folha aberta precisa sair junto. */
  onConcluido?: () => void;
}

export default function EtapasDaEntrega({ client, servico, canWrite, onConcluido }: Props) {
  const queryClient = useQueryClient();
  const [salvando, setSalvando] = useState<number | null>(null);
  const [concluindo, setConcluindo] = useState(false);

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
    // A lista do Ciclo conta as etapas destes mesmos registros: sem isto o
    // card do cliente continuava mostrando o número velho, que é exatamente
    // o "marco e não atualiza".
    await queryClient.invalidateQueries({ queryKey: ["entrega-etapas-lista"] });
  };

  const concluido = entregaConcluida(client);

  const alternarConclusao = async () => {
    if (!canWrite || concluindo) return;
    setConcluindo(true);
    const feitas = etapas.filter((_, i) => concluidas.has(i + 1)).length;
    const ok = await concluirEntrega({
      clientId: client.id,
      servicesConfig: client.services_config || null,
      resumo: `Entrega de ${nomeDoServico} concluída (${feitas} de ${etapas.length} etapas registradas).`,
      concluir: !concluido,
    });
    setConcluindo(false);
    if (!ok) {
      toast.error("Não foi possível salvar. Tente de novo.");
      return;
    }
    // O cadastro é a fonte do "concluído": a lista do Ciclo e a de Clientes
    // leem dali, então as duas precisam reler.
    await queryClient.invalidateQueries({ queryKey: ["clients"] });
    if (concluido) {
      toast.success("Projeto reaberto.");
      return;
    }
    toast.success("Projeto concluído. Ele fica no histórico do cliente.");
    onConcluido?.();
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

      {/* Entrega avulsa tem fim — e o fim precisa de um lugar para ser dito.
          Sem isto o cliente entregue ficava na lista de trabalho para sempre,
          ocupando espaço de quem ainda está em andamento. */}
      {canWrite && (
        <div className="mt-4 border-t border-border pt-3">
          {concluido ? (
            <>
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-success">
                <CircleCheckBig className="h-3.5 w-3.5" />
                Projeto concluído
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Ele saiu da lista de avulsos e ficou no histórico do cliente.
              </p>
              <button
                type="button"
                disabled={concluindo}
                onClick={() => void alternarConclusao()}
                className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reabrir projeto
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={concluindo}
                onClick={() => void alternarConclusao()}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-success/40 bg-success/10 text-[12.5px] font-semibold text-success transition-colors hover:bg-success/20 disabled:opacity-50"
              >
                <CircleCheckBig className="h-4 w-4" />
                Concluir projeto
              </button>
              {/* Concluir com etapa em aberto é decisão de quem toca o
                  trabalho, não erro: nem toda entrega passa por todas. O
                  aviso informa, não impede. */}
              {etapas.length > 0 && concluidas.size < etapas.length && (
                <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
                  {etapas.length - concluidas.size}{" "}
                  {etapas.length - concluidas.size === 1 ? "etapa segue" : "etapas seguem"} sem
                  marcação — dá para concluir assim mesmo.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
