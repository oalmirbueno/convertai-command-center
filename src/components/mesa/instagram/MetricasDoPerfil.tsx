import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { juntar, texto } from "@/components/sistema/estilos";
import {
  agruparPorConta,
  contaPrincipal,
  formatMetricNumber,
  semanaEmAndamento,
  useSocialMetricsWeekly,
  useSocialPostMetrics,
  weekDeltaPct,
  type SocialMetricsWeek,
  type SocialPostMetric,
} from "@/hooks/useSocialMetrics";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";

/**
 * Métricas do perfil e dos posts, organizadas (rodada 2, 28/09): os números
 * da semana numa faixa, a linha das últimas semanas (seguidores e alcance) e
 * os posts numa lista que ordena por data ou por engajamento. As mesmas
 * tabelas do robô semanal (social_metrics_weekly e social_post_metrics), as
 * do /metricas e do MCP de métricas. Nada novo é coletado aqui.
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

/** Pontos da linha (0 a 1) de uma série; vazio quando há menos de 2 valores. */
export function pontosDaLinha(valores: Array<number | null>, largura: number, altura: number): string {
  const v = valores.filter((x): x is number => typeof x === "number" && isFinite(x));
  if (v.length < 2) return "";
  const min = Math.min.apply(null, v);
  const max = Math.max.apply(null, v);
  const faixa = max - min || 1;
  return v.map((x, i) => `${Math.round((i / (v.length - 1)) * largura)},${Math.round(altura - ((x - min) / faixa) * altura)}`).join(" ");
}

function Linha({ rotulo, linhas, campo }: { rotulo: string; linhas: SocialMetricsWeek[]; campo: "followers" | "reach" }) {
  const serie = linhas.slice(0, 12).reverse().map((l) => l[campo]);
  const pontos = pontosDaLinha(serie, 200, 40);
  const ultimo = serie.length ? serie[serie.length - 1] : null;
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className={texto.rotulo}>{rotulo}</span>
        <span className="text-[12px] tabular-nums text-foreground">{formatMetricNumber(ultimo)}</span>
      </div>
      {pontos ? (
        <svg viewBox="0 0 200 44" preserveAspectRatio="none" className="mt-1 h-10 w-full" role="img" aria-label={`${rotulo} nas últimas semanas`}>
          <polyline points={pontos} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <p className={juntar(texto.auxiliar, "mt-1")}>Poucas semanas para a linha.</p>
      )}
    </div>
  );
}

const interacoes = (p: SocialPostMetric) => Number(p.total_interactions ?? (p.like_count || 0) + (p.comments_count || 0));
const ROTULO_DO_TIPO: Record<string, string> = { IMAGE: "Estático", CAROUSEL_ALBUM: "Carrossel", VIDEO: "Reels" };

export default function MetricasDoPerfil({ clientId, contaId }: { clientId: string; contaId: string | null }) {
  const semanas = useSocialMetricsWeekly(clientId, 16);
  const linhas = useMemo(() => {
    const porConta = agruparPorConta(semanas.data);
    return (contaId && porConta.get(contaId)) || contaPrincipal(semanas.data);
  }, [semanas.data, contaId]);
  const contaDosPosts = contaId || (linhas[0] ? linhas[0].external_account_id : undefined);
  const posts = useSocialPostMetrics(clientId, 24, contaDosPosts);
  const [ordem, setOrdem] = useState<"recentes" | "engajados">("recentes");
  const [postsRecolhidos, setPostsRecolhidos] = useRecolhido(`mesa:instagram:metricas-posts:${clientId}`, false);
  const [linhaRecolhida, setLinhaRecolhida] = useRecolhido(`mesa:instagram:metricas-linha:${clientId}`, false);
  const ultima = linhas[0] || null;
  const fechada = linhas.find((l) => !semanaEmAndamento(l)) || null;
  const lista = useMemo(() => {
    const todos = (posts.data || []).slice();
    if (ordem === "engajados") todos.sort((a, b) => interacoes(b) - interacoes(a));
    return todos.slice(0, 12);
  }, [posts.data, ordem]);
  const maior = lista.reduce((m, p) => Math.max(m, interacoes(p)), 1);

  if (semanas.isLoading) return <p className={texto.auxiliar}>Carregando as métricas...</p>;
  if (!ultima) {
    return (
      <p className={juntar(texto.auxiliar, "flex items-center")}>
        Sem números coletados ainda
        <AjudaRecolhida className="ml-1" rotulo="Quando os números chegam">
          O robô semanal ainda não coletou números desta conta. Eles aparecem aqui depois da primeira semana com o Instagram conectado.
        </AjudaRecolhida>
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-3" data-metricas-do-perfil="">
      <FaixaDeNumeros
        rotulo="Números da conta"
        tamanho="compacto"
        grade="grid-cols-2 xl:grid-cols-4"
        itens={[
          { rotulo: "Seguidores", valor: formatMetricNumber(ultima.followers), aoLado: <Variacao pct={weekDeltaPct(linhas, "followers")} /> },
          { rotulo: "Alcance", valor: formatMetricNumber(fechada ? fechada.reach : ultima.reach), aoLado: <Variacao pct={weekDeltaPct(linhas, "reach")} /> },
          { rotulo: "Interações", valor: formatMetricNumber(fechada ? fechada.total_interactions : ultima.total_interactions), aoLado: <Variacao pct={weekDeltaPct(linhas, "total_interactions")} /> },
          { rotulo: "Visitas", valor: formatMetricNumber(fechada ? fechada.profile_views : ultima.profile_views), aoLado: <Variacao pct={weekDeltaPct(linhas, "profile_views")} /> },
        ]}
      />

      <div className="min-w-0">
        <TituloRecolhivel titulo="Últimas semanas" recolhido={linhaRecolhida} onAlternar={() => setLinhaRecolhida(!linhaRecolhida)} resumo={`${Math.min(12, linhas.length)} semanas`} />
        {!linhaRecolhida && (
          <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <Linha rotulo="Seguidores" linhas={linhas} campo="followers" />
            <Linha rotulo="Alcance" linhas={linhas} campo="reach" />
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center justify-between">
          <TituloRecolhivel titulo="Posts" recolhido={postsRecolhidos} onAlternar={() => setPostsRecolhidos(!postsRecolhidos)} resumo={`${lista.length} posts`} />
          {!postsRecolhidos && (
            <SeletorCompacto
              rotulo="Ordem dos posts"
              valor={ordem}
              onEscolher={(v) => setOrdem(v === "engajados" ? "engajados" : "recentes")}
              opcoes={[
                { valor: "recentes", rotulo: "Recentes" },
                { valor: "engajados", rotulo: "Mais engajados" },
              ]}
            />
          )}
        </div>
        {!postsRecolhidos && (
          <ul className="mt-2 min-w-0 space-y-1" aria-label="Posts e números">
            {lista.map((p) => (
              <li key={p.id} className="min-w-0">
                <a href={p.permalink || "#"} target="_blank" rel="noreferrer" className="flex min-w-0 items-center rounded-md px-1.5 py-1 hover:bg-muted">
                  <span className="relative mr-2 block h-12 w-9 shrink-0 overflow-hidden rounded bg-muted">
                    {(p.thumbnail_url || p.media_url) && (
                      <img src={(p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url || p.thumbnail_url) || ""} alt={p.caption ? p.caption.slice(0, 60) : "Post"} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] leading-4 text-foreground">{p.caption ? p.caption.slice(0, 90) : "(sem legenda)"}</span>
                    <span className="block text-[11.5px] leading-4 text-muted-foreground">
                      {p.posted_at ? p.posted_at.slice(0, 10).split("-").reverse().join("/") : ""} · {ROTULO_DO_TIPO[String(p.media_type || "")] || "Post"}
                    </span>
                    <span className="mt-0.5 block h-1 w-full overflow-hidden rounded bg-muted" aria-hidden="true">
                      <span className="block h-full rounded bg-primary/70" style={{ width: `${Math.max(3, Math.round((interacoes(p) / maior) * 100))}%` }} />
                    </span>
                  </span>
                  <span className="ml-2 w-[92px] shrink-0 text-right text-[11.5px] leading-4 tabular-nums text-muted-foreground">
                    <span className="block text-foreground">{formatMetricNumber(interacoes(p))} inter.</span>
                    {p.reach ? <span className="block">{formatMetricNumber(p.reach)} alcance</span> : null}
                    {p.saved ? <span className="block">{formatMetricNumber(p.saved)} salvos</span> : null}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <p className={texto.auxiliar}>
          Semana de {ultima.week_start.split("-").reverse().join("/")}
          {semanaEmAndamento(ultima) ? " (em andamento)" : ""}. Coleta do robô semanal.
        </p>
        <Link to={`/metricas?client=${encodeURIComponent(clientId)}`} className="inline-flex items-center text-[12px] text-muted-foreground hover:text-foreground">
          Métricas completas
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
