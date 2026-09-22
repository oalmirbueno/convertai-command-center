import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import BarraDeCusto, { DialogoDeRecarga, type ConsumoDoMes } from "@/components/mesa/BarraDeCusto";
import ChavesECotas from "@/components/mesa/ChavesECotas";
import ModelosDeIa from "@/components/mesa/ModelosDeIa";
import AbaContexto from "@/components/mesa/AbaContexto";
import AbaMes from "@/components/mesa/AbaMes";
import AbaEstudio from "@/components/mesa/AbaEstudio";
import AbaEntrega from "@/components/mesa/AbaEntrega";
import { MesaProvider, useCatalogo, type MesaValor } from "@/components/mesa/MesaContexto";
import { inicioDoMes, lerPrevisao } from "@/lib/mesa/api";

/**
 * Mesa do cliente (/mesa, só equipe: admin, gestor e design).
 *
 * Traz para dentro do painel o calendário e a arte que eram feitos fora.
 * Quatro abas em sequência (Contexto, Mês, Estúdio, Entrega) e uma barra de
 * custo fixa no topo. Endereço completo:
 * /mesa?client=<id>&aba=estudio&task=<id>&mes=AAAA-MM-01
 */

const ABAS = [
  { valor: "contexto", rotulo: "Contexto" },
  { valor: "mes", rotulo: "Mês" },
  { valor: "estudio", rotulo: "Estúdio" },
  { valor: "entrega", rotulo: "Entrega" },
] as const;

type Aba = (typeof ABAS)[number]["valor"];

const MES_VALIDO = /^\d{4}-\d{2}-01$/;

export default function MesaDoCliente() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientId = params.get("client") || "";
  const abaUrl = params.get("aba") as Aba | null;
  const aba: Aba = ABAS.some((a) => a.valor === abaUrl) ? (abaUrl as Aba) : "contexto";
  const tarefaId = params.get("task");
  const mesUrl = params.get("mes") || "";
  const mes = MES_VALIDO.test(mesUrl) ? mesUrl : inicioDoMes();

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);

  const role = profile?.role || "";
  const isAdmin = role === "admin";
  const podeRecarregar = role === "admin" || role === "manager";

  const clientes = useMemo(
    () =>
      ((clientesQuery.data || []) as any[])
        .map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [clientesQuery.data],
  );
  const cliente = clientes.find((c) => c.id === clientId) || null;

  const mudar = (mudancas: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    setParams(next, { replace: false });
  };

  const saldo = useQuery({
    queryKey: ["mesa", "saldo", clientId],
    enabled: !!cliente,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("ia_saldo", { _client_id: clientId });
      if (error) throw error;
      return Number(data || 0);
    },
  });

  const consumo = useQuery({
    queryKey: ["mesa", "consumo", clientId, inicioDoMes()],
    enabled: !!cliente,
    queryFn: async (): Promise<ConsumoDoMes> => {
      const { data, error } = await (supabase as any).rpc("ia_consumo_cliente", { _client_id: clientId, _mes: inicioDoMes() });
      if (error) throw error;
      return (data || {}) as ConsumoDoMes;
    },
  });

  // Mesma chave que a aba Entrega usa: salvar o plano lá atualiza a barra.
  const previsao = useQuery({
    queryKey: ["mesa", "previsao", clientId],
    enabled: !!cliente,
    queryFn: () => lerPrevisao(clientId),
  });

  const saldoUsd = saldo.data ?? (consumo.data?.saldo_usd !== undefined ? Number(consumo.data.saldo_usd) : null);

  const atualizarCusto = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "saldo", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "consumo", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
  };

  const valor: MesaValor | null = cliente
    ? {
        clientId: cliente.id,
        clientName: cliente.nome,
        userId: user?.id || null,
        isAdmin,
        podeRecarregar,
        saldoUsd,
        catalogo: catalogo.data || [],
        catalogoCarregando: catalogo.isLoading,
        atualizarCusto,
        abrirRecarga: () => setRecargaAberta(true),
        abrirChaves: () => setChavesAbertas(true),
        abrirModelos: () => setModelosAbertos(true),
      }
    : null;

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="heading-page">Mesa do cliente</h1>
        </div>
        <Select value={cliente ? cliente.id : ""} onValueChange={(v) => mudar({ client: v, task: null })}>
          <SelectTrigger className="h-9 w-full min-w-0 text-[13px] sm:w-[280px]">
            <SelectValue placeholder={clientesQuery.isLoading ? "Carregando clientes…" : "Escolha o cliente"} />
          </SelectTrigger>
          <SelectContent>
            {clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Barra fixa de custo e etapas. No celular a página rola dentro do
          main (top-0); no computador rola a janela, abaixo do cabeçalho de 80px. */}
      {cliente && (
        <header className="sticky top-0 z-20 -mx-4 space-y-2.5 border-b border-border bg-background/95 px-4 pb-2.5 pt-2.5 backdrop-blur md:-mx-6 md:top-[calc(env(safe-area-inset-top)+80px)] md:px-6">
          <BarraDeCusto
            saldoUsd={saldoUsd}
            consumo={consumo.data || null}
            previsao={previsao.data || null}
            carregando={saldo.isLoading || consumo.isLoading}
            podeRecarregar={podeRecarregar}
            isAdmin={isAdmin}
            onRecarregar={() => setRecargaAberta(true)}
            onChaves={() => setChavesAbertas(true)}
            onModelos={() => setModelosAbertos(true)}
          />
          <nav aria-label="Etapas da Mesa" className="grid grid-cols-4 gap-1 rounded-xl bg-secondary/50 p-1">
            {ABAS.map((a, i) => (
              <button
                key={a.valor}
                type="button"
                onClick={() => mudar({ aba: a.valor })}
                aria-current={aba === a.valor ? "page" : undefined}
                className={`min-w-0 rounded-lg px-1 py-2 text-[12.5px] font-medium transition-colors ${
                  aba === a.valor ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="mr-1 hidden text-[11px] text-muted-foreground sm:inline">{i + 1}</span>
                {a.rotulo}
              </button>
            ))}
          </nav>
        </header>
      )}

      {!cliente && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-[14px] font-medium">Escolha um cliente para abrir a mesa dele.</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Contexto, calendário do mês, estúdio de arte e entrega, com o custo de IA sempre à vista.
          </p>
        </div>
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <div key={valor.clientId} className="min-w-0">
            {aba === "contexto" && <AbaContexto />}
            {aba === "mes" && <AbaMes />}
            {aba === "estudio" && (
              <AbaEstudio
                mes={mes}
                onMes={(m) => mudar({ mes: m, task: null })}
                tarefaId={tarefaId}
                onTarefa={(id) => mudar({ task: id })}
              />
            )}
            {aba === "entrega" && (
              <AbaEntrega mes={mes} onMes={(m) => mudar({ mes: m })} onAbrir={(id) => mudar({ aba: "estudio", task: id })} />
            )}
          </div>

          {podeRecarregar && (
            <DialogoDeRecarga
              aberto={recargaAberta}
              onOpenChange={setRecargaAberta}
              clientId={valor.clientId}
              clientName={valor.clientName}
              onRecarregado={atualizarCusto}
              sugestaoUsd={previsao.data?.recarga_sugerida_usd ?? null}
            />
          )}
          {isAdmin && (
            <>
              <ChavesECotas aberto={chavesAbertas} onOpenChange={setChavesAbertas} clientId={valor.clientId} clientName={valor.clientName} />
              <ModelosDeIa aberto={modelosAbertos} onOpenChange={setModelosAbertos} />
            </>
          )}
        </MesaProvider>
      )}
    </div>
  );
}
