import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BookOpen, ExternalLink, ShieldCheck, Sparkles } from "lucide-react";
import { Carregando, EstadoDeErro, EstadoVazio, Secao, botao, etiqueta, juntar, superficie, texto } from "@/components/sistema";

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
  const { data = [], error, isLoading, refetch } = useQuery({
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
      <EstadoDeErro
        titulo="Não consegui ler o que foi feito."
        descricao={<>{error instanceof Error ? error.message : String(error)}. Isso não quer dizer que nada foi feito: a leitura é que falhou.</>}
        acao={<button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => void refetch()}>Tentar de novo</button>}
      />
    );
  }
  if (isLoading) return <Carregando linhas={3} rotulo="Carregando o que foi feito" />;

  if (data.length === 0) {
    return (
      <EstadoVazio
        icone={<BookOpen className="h-5 w-5" />}
        titulo="Nenhuma entrega registrada ainda."
        descricao="Toda entrega traz onde acessar; a função recusa o registro sem o link de acesso."
      />
    );
  }

  return (
    <Secao
      titulo="O que foi feito"
      descricao={`${data.length} ${data.length === 1 ? "entrega" : "entregas"}`}
      ajuda="O que os agentes fizeram, como, e onde você acessa cada coisa. Por conta: o agente decidiu sozinho. Sua ordem: cumpriu algo que você aprovou."
    >
      <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")} aria-label="Entregas dos agentes">
        {data.map((d: any) => {
          const autonoma = !d.approval_id;
          const acesso = comoAbrir(d.onde_acessar);
          return (
            <li key={d.id} className="min-w-0 px-4 py-3">
              <div className="flex min-w-0 items-center">
                {/* Decidiu sozinho ou cumpriu sua ordem: são coisas
                    diferentes, e misturá-las esconderia quanto o agente
                    está realmente decidindo por conta. */}
                <span className={juntar(
                  etiqueta,
                  "mr-1.5",
                  autonoma ? "bg-info/15 text-info" : "bg-success/15 text-success",
                )}>
                  {autonoma ? <Sparkles className="mr-1 h-2.5 w-2.5" aria-hidden="true" /> : <ShieldCheck className="mr-1 h-2.5 w-2.5" aria-hidden="true" />}
                  {autonoma ? "por conta" : "sua ordem"}
                </span>
                <span className="min-w-0 truncate text-[12px] font-medium text-foreground/80">{d.agente}</span>
                <span className="ml-auto shrink-0 pl-2 text-[11.5px] tabular-nums text-muted-foreground">{quando(d.occurred_at)}</span>
              </div>

              <p className="mt-1 text-[13px] font-medium text-foreground [overflow-wrap:anywhere]">{d.o_que}</p>
              {d.como && <p className={juntar(texto.auxiliar, "mt-0.5 leading-5")}>{d.como}</p>}

              {/* O ACESSO. É a linha mais importante do item: sem ela, saber
                  que algo foi feito não ajuda em nada. */}
              <p className="mt-1.5 min-w-0 text-[12.5px]">
                <span className="mr-1.5 text-[12px] font-medium text-muted-foreground">onde acessar</span>
                {acesso.tipo === "url" ? (
                  <a
                    href={acesso.valor}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-primary underline"
                  >
                    <ExternalLink className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />{acesso.valor}
                  </a>
                ) : acesso.tipo === "rota" ? (
                  <a href={acesso.valor} className="break-all text-primary underline">
                    {acesso.valor}
                  </a>
                ) : (
                  <span className="break-words text-foreground/85">{acesso.valor}</span>
                )}
              </p>

              {d.onde_documentado && (
                <p className={juntar(texto.auxiliar, "mt-0.5 break-words leading-5")}>
                  documentado em: {ehLink(d.onde_documentado)
                    ? <a href={d.onde_documentado} target="_blank" rel="noopener noreferrer" className="text-primary underline">{d.onde_documentado}</a>
                    : d.onde_documentado}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}
