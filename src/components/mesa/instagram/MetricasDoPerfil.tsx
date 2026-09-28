import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import { juntar, texto } from "@/components/sistema/estilos";
import { agruparPorConta, contaPrincipal, formatMetricNumber, semanaEmAndamento, useSocialMetricsWeekly, useSocialPostMetrics, weekDeltaPct } from "@/hooks/useSocialMetrics";

/**
 * Métricas do perfil e dos posts: as mesmas do robô semanal (tabelas
 * social_metrics_weekly e social_post_metrics, as do /metricas e do MCP de
 * métricas). Nada novo é coletado aqui: é a leitura resumida da conta aberta.
 */

function Variacao({ pct }: { pct: number | null }) {
  if (pct === null || !isFinite(pct)) return null;
  const alta = pct >= 0;
  return (
    <span className={juntar("text-[11.5px] tabular-nums", alta ? "text-success" : "text-destructive")}>
      {alta ? "+" : ""}
      {pct.toFixed(1).replace(".", ",")}%
    </span>
  );
}

export default function MetricasDoPerfil({ clientId, contaId }: { clientId: string; contaId: string | null }) {
  const semanas = useSocialMetricsWeekly(clientId, 16);
  const linhas = useMemo(() => {
    const porConta = agruparPorConta(semanas.data);
    return (contaId && porConta.get(contaId)) || contaPrincipal(semanas.data);
  }, [semanas.data, contaId]);
  const contaDosPosts = contaId || (linhas[0] ? linhas[0].external_account_id : undefined);
  const posts = useSocialPostMetrics(clientId, 12, contaDosPosts);
  const ultima = linhas[0] || null;
  const fechada = linhas.find((l) => !semanaEmAndamento(l)) || null;
  const melhores = useMemo(
    () =>
      (posts.data || [])
        .slice()
        .sort((a, b) => Number(b.total_interactions ?? (b.like_count || 0) + (b.comments_count || 0)) - Number(a.total_interactions ?? (a.like_count || 0) + (a.comments_count || 0)))
        .slice(0, 3),
    [posts.data],
  );

  if (semanas.isLoading) return <p className={texto.auxiliar}>Carregando as métricas...</p>;
  if (!ultima) {
    return <p className={juntar(texto.auxiliar, "leading-5")}>O robô semanal ainda não coletou números desta conta. Eles aparecem aqui depois da primeira semana com o Instagram conectado.</p>;
  }

  return (
    <div className="min-w-0 space-y-3" data-metricas-do-perfil="">
      <FaixaDeNumeros
        rotulo="Números da conta"
        tamanho="compacto"
        colunas={4}
        itens={[
          { rotulo: "Seguidores", valor: formatMetricNumber(ultima.followers), aoLado: <Variacao pct={weekDeltaPct(linhas, "followers")} /> },
          { rotulo: "Alcance na semana", valor: formatMetricNumber(fechada ? fechada.reach : ultima.reach), aoLado: <Variacao pct={weekDeltaPct(linhas, "reach")} /> },
          { rotulo: "Interações", valor: formatMetricNumber(fechada ? fechada.total_interactions : ultima.total_interactions), aoLado: <Variacao pct={weekDeltaPct(linhas, "total_interactions")} /> },
          { rotulo: "Visitas ao perfil", valor: formatMetricNumber(fechada ? fechada.profile_views : ultima.profile_views), aoLado: <Variacao pct={weekDeltaPct(linhas, "profile_views")} /> },
        ]}
      />
      {melhores.length > 0 && (
        <div className="min-w-0">
          <p className={texto.rotulo}>Posts que mais engajaram (últimos 12)</p>
          <ul className="mt-1.5 grid min-w-0 grid-cols-3 gap-2">
            {melhores.map((p) => (
              <li key={p.id} className="min-w-0">
                <a href={p.permalink || "#"} target="_blank" rel="noreferrer" className="block min-w-0">
                  <span className="relative block w-full overflow-hidden rounded bg-muted" style={{ paddingBottom: "133.333%" }}>
                    {(p.thumbnail_url || p.media_url) && (
                      <img src={(p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url || p.thumbnail_url) || ""} alt={p.caption ? p.caption.slice(0, 80) : "Post"} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="mt-1 block truncate text-[11.5px] tabular-nums text-muted-foreground">
                    {formatMetricNumber(p.total_interactions ?? (p.like_count || 0) + (p.comments_count || 0))} interações
                    {p.reach ? ` · ${formatMetricNumber(p.reach)} alcance` : ""}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <p className={texto.auxiliar}>Semana de {ultima.week_start.split("-").reverse().join("/")}{semanaEmAndamento(ultima) ? " (em andamento)" : ""}. Coleta do robô semanal.</p>
        <Link to={`/metricas?client=${encodeURIComponent(clientId)}`} className="inline-flex items-center text-[12.5px] font-medium text-primary hover:underline">
          Abrir Métricas
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
