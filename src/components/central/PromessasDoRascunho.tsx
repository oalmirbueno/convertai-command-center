import { promessasDoRitual } from "./ritualAvisos";

/**
 * O combinado da última mensagem enviada, conferido agora contra o painel
 * (frente CE, 28/09). Só para a equipe: mostra o que a mensagem nova conta
 * como entregue (com a prova) e o que ela trata como "em andamento". O que
 * está em andamento desde a semana passada virou tarefa urgente no Kanban.
 */
export default function PromessasDoRascunho({ metricas }: { metricas: unknown }) {
  const lista = promessasDoRitual(metricas as Record<string, unknown> | null);
  if (!lista.length) return null;
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <p className="text-[12px] font-medium text-foreground">Combinado na última mensagem (conferido no painel, só para a equipe)</p>
      <ul className="mt-0.5 space-y-0.5">
        {lista.map((p, i) => (
          <li key={i} className="text-[12px] leading-snug text-foreground/85">
            <span className={p.situacao === "cumprida" ? "font-medium text-primary" : "font-medium text-warning"}>{p.situacao === "cumprida" ? "Cumprido" : "Em andamento"}</span>
            {": "}{p.texto}{p.prova ? ` (prova: ${p.prova})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
