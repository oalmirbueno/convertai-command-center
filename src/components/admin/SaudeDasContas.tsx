import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, Link2Off, PlugZap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Quais contas estão realmente medindo — e quais só parecem estar.
 *
 * A queixa: "alguns perfis não funcionam de verdade, apesar de estar ok".
 * Ela é justa. Uma conta cadastrada aparece na tela como qualquer outra,
 * mesmo que nunca tenha sido conectada: ela não captura nada e nada na
 * interface dizia isso. O painel mostrava a ausência de dados do mesmo
 * jeito que mostraria um perfil parado — e são coisas diferentes.
 *
 * Aqui a diferença é dita em voz alta, com o motivo e o que fazer.
 */

type Linha = {
  id: string;
  handle: string | null;
  display_name: string | null;
  cliente: string | null;
  conectada: boolean;
  automacao: boolean;
  vencida: boolean;
  posts: number;
  ultima: string | null;
};

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }) : null;

export default function SaudeDasContas() {
  const { data: linhas = [], error, isLoading } = useQuery({
    queryKey: ["saude-das-contas"],
    queryFn: async () => {
      const { data: contas, error: erroContas } = await (supabase as any)
        .from("external_accounts")
        .select("id, client_id, handle, display_name, platform, status")
        .eq("platform", "instagram");
      if (erroContas) throw new Error(erroContas.message);

      const ids = ((contas || []) as any[]).map((c) => c.id);
      if (ids.length === 0) return [] as Linha[];

      const [conexoes, perfis, metricas] = await Promise.all([
        (supabase as any).from("external_account_connections")
          .select("external_account_id, connection_status, automation_enabled, expires_at")
          .in("external_account_id", ids),
        (supabase as any).from("profiles").select("id, full_name, company_name")
          .in("id", [...new Set(((contas || []) as any[]).map((c) => c.client_id))].filter(Boolean)),
        (supabase as any).from("social_post_metrics")
          .select("external_account_id, captured_at").in("external_account_id", ids),
      ]);

      const conexaoDe = new Map(((conexoes.data || []) as any[]).map((c) => [c.external_account_id, c]));
      const nomeDe = new Map(((perfis.data || []) as any[]).map(
        (p) => [p.id, (p.company_name || "").trim() || p.full_name]));
      const porConta = new Map<string, { n: number; ultima: string | null }>();
      for (const m of ((metricas.data || []) as any[])) {
        const atual = porConta.get(m.external_account_id) ?? { n: 0, ultima: null };
        atual.n += 1;
        if (!atual.ultima || String(m.captured_at) > atual.ultima) atual.ultima = m.captured_at;
        porConta.set(m.external_account_id, atual);
      }

      return ((contas || []) as any[]).map((c) => {
        const cx = conexaoDe.get(c.id);
        const met = porConta.get(c.id) ?? { n: 0, ultima: null };
        return {
          id: c.id,
          handle: c.handle,
          display_name: c.display_name,
          cliente: nomeDe.get(c.client_id) ?? null,
          conectada: cx?.connection_status === "connected",
          automacao: cx?.automation_enabled === true,
          vencida: Boolean(cx?.expires_at && new Date(cx.expires_at) < new Date()),
          posts: met.n,
          ultima: met.ultima,
        } as Linha;
      }).sort((a, b) => Number(a.conectada) - Number(b.conectada) || a.posts - b.posts);
    },
    refetchInterval: 120_000,
  });

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-secondary p-3 text-[12px] text-destructive">
        Não consegui ler a saúde das contas: {error instanceof Error ? error.message : String(error)}.
        Nenhuma conta está marcada como boa ou ruim — a leitura falhou.
      </div>
    );
  }
  if (isLoading || linhas.length === 0) return null;

  const quebradas = linhas.filter((l) => !l.conectada || l.vencida || l.posts === 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <PlugZap className="h-3.5 w-3.5 text-info" /> Saúde das contas
        {quebradas.length > 0 ? (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold normal-case text-warning">
            {quebradas.length} não está medindo
          </span>
        ) : (
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold normal-case text-success">
            todas medindo
          </span>
        )}
      </p>

      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {linhas.map((l) => {
          // O motivo, em ordem de gravidade. Cada um pede uma ação diferente,
          // e um rótulo genérico faria o dono adivinhar qual.
          const motivo = !l.conectada
            ? "nunca foi conectada · o painel não busca nada dela"
            : l.vencida
              ? "o token venceu · reconecte para voltar a medir"
              : l.posts === 0
                ? "conectada, mas nenhum post capturado ainda"
                : null;
          return (
            <div
              key={l.id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5",
                motivo ? "border-warning/40 bg-warning/[0.05]" : "border-border bg-secondary/40",
              )}
            >
              {motivo
                ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-foreground">
                  {l.handle || l.display_name || "(sem handle)"}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {l.cliente || "sem cliente"}
                  {motivo && <span className="text-warning"> · {motivo}</span>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[11.5px] tabular-nums text-foreground">
                  {l.posts} {l.posts === 1 ? "post" : "posts"}
                </span>
                {l.ultima && (
                  <span className="block text-[9.5px] text-muted-foreground">{quando(l.ultima)}</span>
                )}
              </span>
              {!l.conectada && <Link2Off className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
        Conta não conectada aparece aqui porque o cadastro dela existe, mas o painel
        não consegue buscar nada — e um perfil sem dados por falta de conexão é
        diferente de um perfil parado. Posts anteriores a 29/06 não têm insights:
        a coleta começou depois deles, e o histórico não foi preenchido para trás.
      </p>
    </div>
  );
}
