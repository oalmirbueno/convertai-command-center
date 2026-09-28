import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Clock, ExternalLink, Zap } from "lucide-react";
import { Carregando, EstadoDeErro, Secao, botao, juntar, superficie, texto } from "@/components/sistema";

/**
 * O que já foi AUTORIZADO e ainda espera o agente fazer.
 *
 * Este estado não existia. O painel tinha "esperando você" e "feito", e
 * entre os dois havia um vão: a ordem autorizada, de pé, que ninguém
 * executou ainda. Sem mostrá-lo, autorizar parecia concluir — e um post
 * que você liberou há dois dias e nunca foi ao ar ficaria invisível
 * exatamente como se tivesse ido.
 *
 * A leitura aqui é curta de propósito: quem olha quer saber se a coisa
 * que ele liberou aconteceu. Isso é uma linha por ordem, não um dossiê.
 */

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }) : "";

/** Quantos dias uma ordem está de pé sem ninguém cumprir. */
export function diasParada(aprovadaEm?: string | null, agora = new Date()): number {
  if (!aprovadaEm) return 0;
  const t = new Date(aprovadaEm).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((agora.getTime() - t) / 86_400_000));
}

export default function OrdensAutorizadas() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["ordens-autorizadas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_approvals")
        .select("id, action_kind, o_que, destino, prazo, decided_at, executed_at, "
          + "execution_evidence, operator_id, kanban_task_id")
        .eq("status", "aprovado")
        .order("decided_at", { ascending: false })
        .limit(40);
      if (error) throw new Error(error.message);
      const linhas = (data || []) as any[];
      if (linhas.length === 0) return { pendentes: [], cumpridas: [] };

      const { data: ops } = await (supabase as any)
        .from("internal_operators").select("id, display_name")
        .in("id", [...new Set(linhas.map((l) => l.operator_id))]);
      const nome = new Map(((ops || []) as any[]).map((o) => [o.id, o.display_name]));
      const com = linhas.map((l) => ({ ...l, agente: nome.get(l.operator_id) || "agente" }));

      return {
        pendentes: com.filter((l) => !l.executed_at),
        cumpridas: com.filter((l) => l.executed_at).slice(0, 6),
      };
    },
    refetchInterval: 120_000,
  });

  if (error) {
    return (
      <EstadoDeErro
        titulo="Não consegui ler as ordens."
        descricao={<>{error instanceof Error ? error.message : String(error)}. Nada está sendo dado como cumprido nem como pendente: a leitura falhou.</>}
        acao={<button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => void refetch()}>Tentar de novo</button>}
      />
    );
  }
  if (isLoading) return <Carregando linhas={2} rotulo="Carregando as ordens" />;

  const pendentes = data?.pendentes ?? [];
  const cumpridas = data?.cumpridas ?? [];
  if (pendentes.length === 0 && cumpridas.length === 0) return null;

  return (
    <div className="space-y-6">
      {pendentes.length > 0 && (
        <Secao
          nivel={3}
          recolher="execucao:ordens:autorizadas"
          titulo={<span className="inline-flex items-center"><Zap className="mr-1.5 h-3.5 w-3.5 text-info" aria-hidden="true" />Autorizado · esperando o agente fazer</span>}
          descricao={`${pendentes.length} ${pendentes.length === 1 ? "ordem" : "ordens"}`}
          ajuda="Você liberou; o agente ainda não executou. Autorizar não é o mesmo que estar feito, e sem esta lista as duas coisas pareceriam iguais."
        >
          <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
            {pendentes.map((o: any) => {
              const dias = diasParada(o.decided_at);
              return (
                <li key={o.id} className="min-w-0 px-4 py-2.5">
                  <p className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>{o.o_que}</p>
                  <p className="-mx-1 mt-0.5 flex flex-wrap items-center text-[12px] text-muted-foreground [&>*]:mx-1">
                    <span className="font-medium text-foreground/80">{o.agente}</span>
                    <span>· {String(o.action_kind).replace(/_/g, " ")}</span>
                    {o.destino && <span>· para {o.destino}</span>}
                    <span className={juntar(
                      "inline-flex items-center",
                      // Três dias parada é o ponto em que "vai sair" deixa de
                      // ser verdade sozinho e vira uma pergunta.
                      dias >= 3 && "font-semibold text-warning",
                    )}>
                      <Clock className="mr-1 h-2.5 w-2.5" aria-hidden="true" />
                      autorizado há {dias === 0 ? "menos de um dia" : `${dias} dia${dias > 1 ? "s" : ""}`}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        </Secao>
      )}

      {cumpridas.length > 0 && (
        <Secao
          nivel={3}
          recolher="execucao:ordens:cumpridas"
          titulo={<span className="inline-flex items-center"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-success" aria-hidden="true" />Feito no mundo, com prova</span>}
          descricao={`${cumpridas.length} ${cumpridas.length === 1 ? "ordem cumprida" : "ordens cumpridas"}`}
        >
          <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
            {cumpridas.map((o: any) => (
              <li key={o.id} className="min-w-0 px-4 py-2.5">
                <p className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>{o.o_que}</p>
                <p className={juntar(texto.auxiliar, "mt-0.5")}>
                  {o.agente} · {quando(o.executed_at)}
                </p>
                {o.execution_evidence && (
                  /* A prova é o ponto: ação externa não pode ser afirmada sem
                     ela, porque ninguém consegue desfazer depois. */
                  <p className="mt-0.5 break-all text-[12px]">
                    {/^https?:\/\//i.test(o.execution_evidence) ? (
                      <a
                        href={o.execution_evidence}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-primary underline"
                      >
                        <ExternalLink className="mr-1 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                        {o.execution_evidence}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{o.execution_evidence}</span>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  );
}
