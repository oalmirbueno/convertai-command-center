import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Workflow } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Chip, StatusDot } from "@/components/ds";
import { Carregando, EstadoVazio, botao, juntar, lista, texto } from "@/components/sistema";
import { fluxosDoCliente, haQuanto, nomeCurto, normalizarPainel } from "@/lib/centralDeAutomacoes";

/*
 * Automações do cliente (19/11/2026), na ficha do cliente. Dono: "uma pasta para automações de cliente dentro
 * de cada cliente". Mostra os fluxos do n8n feitos para este cliente (ligado ou não, última rodada) e leva à
 * pasta dele na Central de Automações, onde se liga, desliga e vê o desenho.
 */

export function useAutomacoesDoCliente(clientId: string | null | undefined) {
  const q = useQuery({
    queryKey: ["automacoes-painel"],
    enabled: Boolean(clientId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("automacoes_painel");
      if (error) throw new Error(error.message);
      return normalizarPainel(data);
    },
  });
  const fluxos = useMemo(() => (clientId && q.data ? fluxosDoCliente(q.data.fluxos, clientId) : []), [q.data, clientId]);
  return { ...q, fluxos };
}

export default function AutomacoesDoCliente({ clientId }: { clientId: string }) {
  const navigate = useNavigate();
  const q = useAutomacoesDoCliente(clientId);
  const agora = Date.now();
  if (q.isLoading) return <Carregando rotulo="Lendo as automações" linhas={3} />;
  if (q.error) return <EstadoVazio compacto titulo="Não deu para ler as automações agora." />;
  return (
    <section aria-label="Automações do cliente" className="space-y-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className={texto.auxiliar}>{q.fluxos.length === 0 ? "nenhuma automação" : `${q.fluxos.length} ${q.fluxos.length === 1 ? "fluxo" : "fluxos"} · ${q.fluxos.filter((f) => f.ativo).length} ligados`}</span>
        <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => navigate(`/automacoes?cliente=${clientId}`)}>
          Abrir na Central<ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {q.fluxos.length === 0 ? (
        <EstadoVazio compacto icone={<Workflow className="h-5 w-5" />} titulo="Este cliente ainda não tem automação própria." descricao="Na Central de Automações, abra um fluxo e escolha este cliente em 'De quem é'." />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Fluxos do cliente">
          {q.fluxos.map((f) => (
            <li key={f.id} className={lista.linha}>
              <StatusDot tone={!f.ativo ? "neutral" : f.erros24h > 0 ? "danger" : "success"} className="mr-3 h-2 w-2" />
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium", !f.ativo && "text-muted-foreground")}>{nomeCurto(f)}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{f.gatilhos[0]?.descricao ?? "sem gatilho"}</span>
              </span>
              <span className="ml-3 shrink-0 text-right">
                {f.ativo ? <Chip tone={f.erros24h > 0 ? "danger" : "success"} dot>{f.erros24h > 0 ? `${f.erros24h} erros` : "ligado"}</Chip> : <Chip>desligado</Chip>}
                <span className={juntar(texto.auxiliar, "mt-0.5 block tabular-nums")}>{f.ultima ? haQuanto(f.ultima.inicio, agora) : "sem rodada"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
