import { useQuery } from "@tanstack/react-query";
import { Bot, Hourglass, PackageCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { leituraSimples } from "@/lib/cadernoExecucao";
import { eRuidoDoDiario, pedidoEmAberto, type EntradaDoDiarioMinima } from "@/lib/decisaoDoVinculo";
import { juntar, texto } from "@/components/sistema";

/**
 * 26/10/2026 (dono: tarefa com um único dono, e eu preciso ver o que esperam de
 * mim e o que já foi entregue): três linhas no cartão da Execução. Dono (o
 * operador do vínculo, um só), o que está esperando o dono (o pedido do agente
 * ainda sem resposta) e o que foi entregue (entrada com prova anexada).
 */
export default function DonoDaTarefa({ linkId, agente }: { linkId: string; agente: string }) {
  const { data: entradas = [] } = useQuery({
    queryKey: ["diario-resumo", linkId],
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_participations")
        .select("*")
        .eq("task_link_id", linkId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return (data || []) as EntradaDoDiarioMinima[];
    },
  });
  const pedido = pedidoEmAberto(entradas);
  const entregas = entradas.filter((e) => e.author_kind === "operador" && !eRuidoDoDiario(e) && (e.entry_type === "evidencia" || (Array.isArray(e.attachments) && e.attachments.length > 0)));
  const ultima = entregas[0];
  return (
    <dl className="space-y-1.5" data-dono-da-tarefa="">
      <div className="flex min-w-0 items-start">
        <dt className="mr-1.5 mt-0.5 shrink-0 text-muted-foreground" title="Dono da tarefa"><Bot className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Dono</span></dt>
        <dd className={juntar(texto.corpo, "min-w-0 truncate")}><span className="font-medium">{agente}</span><span className="text-muted-foreground"> · único dono, só ele executa</span></dd>
      </div>
      <div className="flex min-w-0 items-start">
        <dt className="mr-1.5 mt-0.5 shrink-0 text-warning" title="Esperando você"><Hourglass className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Esperando você</span></dt>
        <dd className={juntar(texto.corpo, "min-w-0 line-clamp-2")} title={pedido ? leituraSimples(String(pedido.body || "")).resumo : undefined}>
          {pedido ? leituraSimples(String(pedido.title ? `${pedido.title}: ${pedido.body || ""}` : pedido.body || "")).resumo : <span className="text-muted-foreground">Nenhum pedido do agente esperando você.</span>}
        </dd>
      </div>
      <div className="flex min-w-0 items-start">
        <dt className="mr-1.5 mt-0.5 shrink-0 text-success" title="Entregue"><PackageCheck className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Entregue</span></dt>
        <dd className={juntar(texto.corpo, "min-w-0 truncate")}>
          {ultima
            ? <>{leituraSimples(String(ultima.title || ultima.body || "")).resumo}<span className="text-muted-foreground"> · {entregas.length} {entregas.length === 1 ? "entrega com prova" : "entregas com prova"}</span></>
            : <span className="text-muted-foreground">Nada entregue com prova ainda.</span>}
        </dd>
      </div>
    </dl>
  );
}
