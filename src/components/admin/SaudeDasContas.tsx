import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, Link2Off } from "lucide-react";
import { EstadoDeErro, Painel, Secao, botao, etiqueta, juntar, texto } from "@/components/sistema";

/**
 * Quais contas estão realmente medindo, e quais só parecem estar.
 *
 * A queixa: "alguns perfis não funcionam de verdade, apesar de estar ok".
 * Ela é justa. Uma conta cadastrada aparece na tela como qualquer outra,
 * mesmo que nunca tenha sido conectada: ela não captura nada e nada na
 * interface dizia isso. O painel mostrava a ausência de dados do mesmo
 * jeito que mostraria um perfil parado, e são coisas diferentes.
 *
 * Aqui a diferença é dita em voz alta, com o motivo e o que fazer.
 * Sistema de design (26/09): uma seção sem caixa em volta, a lista com
 * divisória (nada de um cartão por conta) e a explicação no "?".
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
  const { data: linhas = [], error, isLoading, refetch } = useQuery({
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

  const ajuda =
    "Quais contas de Instagram estão medindo de verdade. Conta não conectada aparece aqui porque o cadastro dela existe, mas o painel não consegue buscar nada: um perfil sem dados por falta de conexão é diferente de um perfil parado. Posts anteriores a 29/06 não têm insights: a coleta começou depois deles, e o histórico não foi preenchido para trás.";

  if (error && linhas.length === 0) {
    return (
      <Secao divisoria titulo="Saúde das contas" ajuda={ajuda}>
        <EstadoDeErro
          titulo="Não consegui ler a saúde das contas."
          descricao={`${error instanceof Error ? error.message : String(error)}. Nenhuma conta está marcada como boa ou ruim: a leitura falhou.`}
          acao={
            <button type="button" onClick={() => refetch()} className={botao.secundario}>
              Tentar de novo
            </button>
          }
        />
      </Secao>
    );
  }
  if (isLoading || linhas.length === 0) return null;

  const quebradas = linhas.filter((l) => !l.conectada || l.vencida || l.posts === 0);

  return (
    <Secao
      divisoria
      titulo="Saúde das contas"
      ajuda={ajuda}
      descricao={
        <span className="flex min-w-0 items-center">
          <span className="truncate">{linhas.length} {linhas.length === 1 ? "conta" : "contas"} de Instagram</span>
          {quebradas.length > 0 ? (
            <span className={juntar(etiqueta, "ml-2 bg-warning/15 text-warning")}>{quebradas.length} não está medindo</span>
          ) : (
            <span className={juntar(etiqueta, "ml-2 bg-success/15 text-success")}>todas medindo</span>
          )}
        </span>
      }
    >
      <Painel semEspaco className="overflow-hidden">
        {/* No computador a lista rola por dentro; no celular a página rola. */}
        <ul className="min-w-0 divide-y divide-border lg:max-h-64 lg:overflow-y-auto lg:overscroll-contain" aria-label="Saúde das contas">
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
              <li key={l.id} className="flex min-w-0 items-center px-4 py-2.5">
                {motivo
                  ? <AlertTriangle className="mr-2.5 h-4 w-4 shrink-0 text-warning" aria-label="Não está medindo" />
                  : <CheckCircle2 className="mr-2.5 h-4 w-4 shrink-0 text-success" aria-label="Medindo" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {l.handle || l.display_name || "(sem handle)"}
                  </p>
                  <p className={juntar(texto.auxiliar, "truncate")}>
                    {l.cliente || "sem cliente"}
                    {motivo && <span className="text-warning"> · {motivo}</span>}
                  </p>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <p className="text-[13px] tabular-nums text-foreground">
                    {l.posts} {l.posts === 1 ? "post" : "posts"}
                  </p>
                  {l.ultima && <p className={juntar(texto.auxiliar, "tabular-nums")}>{quando(l.ultima)}</p>}
                </div>
                {!l.conectada && <Link2Off className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Não conectada" />}
              </li>
            );
          })}
        </ul>
      </Painel>
    </Secao>
  );
}
