import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  type Atividade,
  type Lead,
  concluirAtividade,
  rotuloDaAtividade,
} from "@/lib/comercial";

/**
 * O dia do comercial: tudo que está marcado, em todos os leads.
 *
 * O funil responde "como está cada conversa"; esta tela responde a pergunta
 * que vem antes de abrir o painel — "o que eu tenho que fazer hoje". Sem ela,
 * a agenda só existia dentro de cada lead, e saber o que estava atrasado
 * exigia abrir os leads um a um.
 *
 * O mesmo dado alimenta o sininho: o robô de lembretes lê estas linhas e
 * avisa o dono às 8h. Agenda que não cobra é lista de desejos.
 */

interface Props {
  atividades: Atividade[];
  leads: Lead[];
  onAbrirLead: (lead: Lead) => void;
  onMudou: () => Promise<unknown>;
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function AgendaComercial({
  atividades,
  leads,
  onAbrirLead,
  onMudou,
}: Props) {
  const queryClient = useQueryClient();
  const agora = new Date();
  const agoraIso = agora.toISOString();
  const fimDoDia = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate(),
    23,
    59,
    59,
  ).toISOString();

  const porLead = useMemo(
    () => new Map(leads.map((lead) => [lead.id, lead])),
    [leads],
  );

  const abertas = useMemo(
    () =>
      atividades
        .filter((a) => !a.done_at && porLead.has(a.lead_id))
        .sort((a, b) => a.due_at.localeCompare(b.due_at)),
    [atividades, porLead],
  );

  const grupos = [
    {
      titulo: "Atrasadas",
      itens: abertas.filter((a) => a.due_at < agoraIso),
      tom: "warning" as const,
    },
    {
      titulo: "Hoje",
      itens: abertas.filter((a) => a.due_at >= agoraIso && a.due_at <= fimDoDia),
      tom: "primary" as const,
    },
    {
      titulo: "Depois",
      itens: abertas.filter((a) => a.due_at > fimDoDia),
      tom: "muted" as const,
    },
  ].filter((grupo) => grupo.itens.length > 0);

  const concluir = async (atividade: Atividade) => {
    if (!(await concluirAtividade(atividade, true))) {
      toast.error("Não foi possível concluir.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["comercial-atividades"] });
    await onMudou();
    toast.success("Feito.");
  };

  if (abertas.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium text-foreground">Nada agendado</p>
        <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
          Abra um lead no funil e marque a ligação, a reunião ou o envio da proposta.
          O que estiver vencendo chega no seu sininho às 8h.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {grupos.map((grupo) => (
        <div key={grupo.titulo}>
          <p
            className={`text-[9.5px] font-semibold uppercase tracking-[0.12em] ${
              grupo.tom === "warning"
                ? "text-warning"
                : grupo.tom === "primary"
                  ? "text-primary"
                  : "text-muted-foreground"
            }`}
          >
            {grupo.titulo} · {grupo.itens.length}
          </p>
          <div className="mt-1.5 space-y-1.5">
            {grupo.itens.map((atividade) => {
              const lead = porLead.get(atividade.lead_id)!;
              return (
                <div
                  key={atividade.id}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
                    grupo.tom === "warning"
                      ? "border-warning/40 bg-warning/[0.05]"
                      : "border-border bg-card"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void concluir(atividade)}
                    title="Concluir"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAbrirLead(lead)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[12.5px] font-medium text-foreground">
                      {atividade.title}
                    </p>
                    <p
                      className={`flex items-center gap-1 truncate text-[10.5px] ${
                        grupo.tom === "warning"
                          ? "font-semibold text-warning"
                          : "text-muted-foreground"
                      }`}
                    >
                      <Clock className="h-3 w-3 shrink-0" />
                      {rotuloDaAtividade(atividade.kind)} · {quando(atividade.due_at)} ·{" "}
                      {lead.name}
                      {lead.company ? ` (${lead.company})` : ""}
                    </p>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
