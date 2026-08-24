import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ChevronDown, ChevronUp, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  CONTEXTO_KINDS, dossieMaisRecente, idadeEmPalavras,
} from "@/lib/contextoDoCliente";
import { AO_VIVO_CALMO } from "@/lib/consultaAoVivo";

/**
 * O dossiê do cliente, com o texto inteiro.
 *
 * A fonte é a CHAVE CANÔNICA: client_dossiers com is_current=true — o mesmo
 * registro que o MCP grava e devolve. Antes, o card escolhia "o registro
 * mais novo dentro de uma lista de tipos" de project_memory: bastava a
 * rotina gravar com um tipo fora da lista, ou duas fontes escreverem em
 * sequência, para um dossiê VELHO aparecer como atual. A heurística antiga
 * fica só como transição, para clientes que a migração ainda não semeou.
 */

interface Props {
  clientId: string;
  clientName?: string;
}

interface DossieAtual {
  content: string | null;
  summary: string | null;
  version: number | null;
  change_reason: string | null;
  source: string | null;
  updated_at: string | null;
  effective_at: string | null;
}

interface VersaoDoHistorico {
  id: string;
  version: number;
  summary: string | null;
  change_reason: string | null;
  source: string | null;
  created_at: string;
  is_current: boolean;
}

export default function DossieDoCliente({ clientId, clientName }: Props) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const chave = ["dossie-cliente", clientId];
  const { data, isFetching, refetch } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      // 1) A chave canônica. maybeSingle: o índice único garante no máximo um.
      const atual = await (supabase as any)
        .from("client_dossiers")
        .select("content, summary, version, change_reason, source, updated_at, effective_at")
        .eq("client_id", clientId)
        .eq("dossier_type", "contexto")
        .eq("is_current", true)
        .is("project_id", null)
        .maybeSingle();
      if (!atual.error && atual.data) {
        return { atual: atual.data as DossieAtual, legado: null };
      }
      // 2) Transição: cliente ainda não migrado (ou tabela ainda não criada).
      const { data: legado, error } = await (supabase as any)
        .from("project_memory")
        .select("kind, title, content, source, created_at")
        .eq("client_id", clientId)
        .in("kind", [...CONTEXTO_KINDS])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return { atual: null, legado: [] };
      return { atual: null, legado: legado || [] };
    },
    enabled: Boolean(clientId),
    staleTime: 15_000,
    ...AO_VIVO_CALMO,
  });

  const { data: historico } = useQuery({
    queryKey: ["dossie-historico", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("client_dossiers")
        .select("id, version, summary, change_reason, source, created_at, is_current")
        .eq("client_id", clientId)
        .eq("dossier_type", "contexto")
        .is("project_id", null)
        .order("version", { ascending: false })
        .limit(20);
      if (error) return [];
      return (data || []) as VersaoDoHistorico[];
    },
    enabled: Boolean(clientId) && historicoAberto,
  });

  const atual = data?.atual ?? null;
  const legado = atual ? null : dossieMaisRecente(data?.legado || []);
  const corpo = String(atual?.content ?? legado?.content ?? "").trim();
  const quando = atual?.updated_at ?? atual?.effective_at ?? legado?.created_at ?? null;
  const idade = idadeEmPalavras(quando ?? undefined);

  const atualizar = async () => {
    await queryClient.invalidateQueries({ queryKey: chave });
    await queryClient.invalidateQueries({ queryKey: ["dossie-historico", clientId] });
    await refetch();
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Dossiê de contexto
        </span>
        {corpo && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {idade}
          </span>
        )}
        {atual?.version != null && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            v{atual.version}
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

      {!corpo ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Nenhum dossiê escrito para {clientName || "este cliente"} ainda. A rotina de
          contexto grava aqui, e o texto aparece inteiro nesta caixa.
        </p>
      ) : (
        <>
          {/* O corpo é o que muda entre versões. */}
          <p
            className={`mt-2 whitespace-pre-line text-[12px] leading-relaxed text-foreground/90 ${
              aberto ? "" : "line-clamp-6"
            }`}
          >
            {corpo}
          </p>
          {atual?.change_reason && (
            <p className="mt-1.5 text-[10.5px] italic text-muted-foreground">
              Última mudança: {atual.change_reason}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[10.5px] font-medium text-primary hover:opacity-80"
            >
              {aberto ? "Mostrar menos" : "Ler o dossiê inteiro"}
              {aberto ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {atual && (
              <button
                type="button"
                onClick={() => setHistoricoAberto((v) => !v)}
                className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[10.5px] font-medium text-primary hover:opacity-80"
              >
                <History className="h-3 w-3" />
                {historicoAberto ? "Fechar histórico" : "Ver histórico"}
              </button>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {quando
                ? new Date(quando).toLocaleString("pt-BR", {
                    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                  })
                : ""}
            </span>
          </div>

          {historicoAberto && (
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              {(historico || []).map((v) => (
                <div key={v.id} className="flex items-baseline gap-2 text-[10.5px]">
                  <span className={`shrink-0 font-semibold tabular-nums ${v.is_current ? "text-primary" : "text-muted-foreground"}`}>
                    v{v.version}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {v.change_reason || v.summary || v.source || "sem descrição"}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/70">
                    {new Date(v.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  </span>
                </div>
              ))}
              {(historico || []).length === 0 && (
                <p className="text-[10.5px] text-muted-foreground">Carregando histórico…</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
