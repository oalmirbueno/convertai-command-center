import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BookOpen, ExternalLink, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O que os agentes fizeram — e onde você acha cada coisa.
 *
 * O dono liberou os agentes para agirem sozinhos no que não precisa de
 * aprovação, com uma condição: "tem que me dizer o que foi feito, como, e
 * como eu acesso e documento, senão fico perdido".
 *
 * Essa condição é o que torna a autonomia sustentável. Trabalho que
 * acontece e ninguém acha depois não é trabalho entregue — é trabalho
 * perdido com passos extras. Por isso o link de acesso não é um detalhe
 * no rodapé: é a linha mais importante de cada item.
 *
 * A distinção entre "decidiu sozinho" e "cumpriu sua ordem" fica visível
 * de propósito. São coisas diferentes, e misturá-las esconderia quanto os
 * agentes estão realmente decidindo por conta.
 */

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }) : "";

const ehLink = (s?: string | null) => Boolean(s && /^https?:\/\//i.test(s));

/** Uma rota do painel vira link clicável; texto solto continua texto. */
export function comoAbrir(onde: string): { tipo: "url" | "rota" | "texto"; valor: string } {
  const limpo = String(onde ?? "").trim();
  if (/^https?:\/\//i.test(limpo)) return { tipo: "url", valor: limpo };
  if (/^\/[a-z0-9\-_/?=&.]*$/i.test(limpo)) return { tipo: "rota", valor: limpo };
  return { tipo: "texto", valor: limpo };
}

export default function OQueFoiFeito({ clientId }: { clientId?: string }) {
  const { data = [], error, isLoading } = useQuery({
    queryKey: ["o-que-foi-feito", clientId ?? "todos"],
    queryFn: async () => {
      let q = (supabase as any)
        .from("operator_deliveries")
        .select("id, o_que, como, onde_acessar, onde_documentado, approval_id, "
          + "operator_id, occurred_at, kanban_task_id")
        .order("occurred_at", { ascending: false })
        .limit(30);
      if (clientId) q = q.eq("client_id", clientId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const linhas = (data || []) as any[];
      if (linhas.length === 0) return [];

      const { data: ops } = await (supabase as any)
        .from("internal_operators").select("id, display_name")
        .in("id", [...new Set(linhas.map((l) => l.operator_id))]);
      const nome = new Map(((ops || []) as any[]).map((o) => [o.id, o.display_name]));
      return linhas.map((l) => ({ ...l, agente: nome.get(l.operator_id) || "agente" }));
    },
    refetchInterval: 120_000,
  });

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-secondary p-3 text-[12px] text-destructive">
        Não consegui ler o que foi feito: {error instanceof Error ? error.message : String(error)}.
        Isso não quer dizer que nada foi feito — a leitura é que falhou.
      </div>
    );
  }
  if (isLoading) return null;

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-[12px] leading-relaxed text-muted-foreground">
        Nenhuma entrega registrada ainda. Quando um agente fizer algo, ele registra
        aqui <strong className="text-foreground">o que fez, como, e onde você acessa</strong> —
        a função recusa o registro sem o link de acesso, justamente para não sobrar
        trabalho que ninguém acha depois.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5 text-primary" /> O que foi feito
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px]">{data.length}</span>
      </p>

      <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
        {data.map((d: any) => {
          const autonoma = !d.approval_id;
          const acesso = comoAbrir(d.onde_acessar);
          return (
            <div key={d.id} className="rounded-lg border border-border bg-secondary/40 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Decidiu sozinho ou cumpriu sua ordem: são coisas
                    diferentes, e misturá-las esconderia quanto o agente
                    está realmente decidindo por conta. */}
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                  autonoma ? "bg-info/15 text-info" : "bg-success/15 text-success",
                )}>
                  {autonoma ? <Sparkles className="h-2.5 w-2.5" /> : <ShieldCheck className="h-2.5 w-2.5" />}
                  {autonoma ? "por conta" : "sua ordem"}
                </span>
                <span className="text-[10px] font-medium text-foreground/80">{d.agente}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{quando(d.occurred_at)}</span>
              </div>

              <p className="mt-1 text-[12.5px] font-medium text-foreground">{d.o_que}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{d.como}</p>

              {/* O ACESSO. É a linha mais importante do item: sem ela, saber
                  que algo foi feito não ajuda em nada. */}
              <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5">
                <span className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  onde acessar
                </span>
                {acesso.tipo === "url" ? (
                  <a
                    href={acesso.valor}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 break-all text-[11.5px] text-primary underline"
                  >
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />{acesso.valor}
                  </a>
                ) : acesso.tipo === "rota" ? (
                  <a href={acesso.valor} className="break-all text-[11.5px] text-primary underline">
                    {acesso.valor}
                  </a>
                ) : (
                  <span className="break-words text-[11.5px] text-foreground/85">{acesso.valor}</span>
                )}
              </div>

              {d.onde_documentado && (
                <p className="mt-0.5 break-words text-[10.5px] text-muted-foreground">
                  documentado em: {ehLink(d.onde_documentado)
                    ? <a href={d.onde_documentado} target="_blank" rel="noopener noreferrer" className="text-primary underline">{d.onde_documentado}</a>
                    : d.onde_documentado}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
