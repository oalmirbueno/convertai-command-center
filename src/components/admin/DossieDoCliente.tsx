import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  CONTEXTO_KINDS, dossieMaisRecente, idadeEmPalavras,
} from "@/lib/contextoDoCliente";

/**
 * O dossiê do cliente, com o texto inteiro.
 *
 * Existia escrito no banco — milhares de caracteres por cliente, atualizados
 * pela rotina do GPT — e não tinha lugar nenhum na Central. O que a tela
 * mostrava era o título, um rótulo com data igual em toda versão, então
 * atualizar o dossiê não mudava nada visível.
 *
 * Consulta o cliente diretamente em vez de reaproveitar a lista geral da
 * Central: aquela busca as N linhas mais recentes de TODOS os clientes e
 * filtra depois, então bastava a carteira crescer para o cliente aberto
 * simplesmente não vir na janela — e a tela diria "sem contexto" com o
 * contexto gravado no banco.
 */

interface Props {
  clientId: string;
  clientName?: string;
}

export default function DossieDoCliente({ clientId, clientName }: Props) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);

  const chave = ["dossie-cliente", clientId];
  const { data, isFetching, refetch } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("project_memory")
        .select("kind, title, content, source, created_at")
        .eq("client_id", clientId)
        .in("kind", [...CONTEXTO_KINDS])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      return data || [];
    },
    enabled: Boolean(clientId),
    staleTime: 15_000,
  });

  const dossie = dossieMaisRecente(data || []);
  const idade = idadeEmPalavras(dossie?.created_at);

  const atualizar = async () => {
    await queryClient.invalidateQueries({ queryKey: chave });
    await refetch();
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Dossiê de contexto
        </span>
        {dossie && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {idade}
          </span>
        )}
        <button
          type="button"
          onClick={() => void atualizar()}
          disabled={isFetching}
          className="ml-auto cursor-pointer rounded border-none bg-transparent p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label="Atualizar dossiê"
          title="Buscar a versão mais recente"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!dossie ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Nenhum dossiê escrito para {clientName || "este cliente"} ainda. A rotina de
          contexto do GPT grava aqui, e o texto aparece inteiro nesta caixa.
        </p>
      ) : (
        <>
          {/* O corpo é o que muda entre versões. O título é rótulo com data e
              ficava sozinho na tela, dando a impressão de que nada atualizou. */}
          <p
            className={`mt-2 whitespace-pre-line text-[12px] leading-relaxed text-foreground/90 ${
              aberto ? "" : "line-clamp-6"
            }`}
          >
            {String(dossie.content || "").trim()}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[10.5px] font-medium text-primary hover:opacity-80"
            >
              {aberto ? "Mostrar menos" : "Ler o dossiê inteiro"}
              {aberto ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {new Date(dossie.created_at || "").toLocaleString("pt-BR", {
                day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
              })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
