import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { DeltaChip, Sparkline } from "@/components/ds";
import { NumerosAbertos } from "../ousado";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, juntar, texto } from "@/components/sistema/estilos";
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
import { useMarcaDaMesa } from "../MesaContexto";

/**
 * Métricas do perfil e dos posts, organizadas (rodada 2, 28/09): os números
 * da semana numa faixa, a linha das últimas semanas (seguidores e alcance) e
 * os posts numa lista que ordena por data ou por engajamento. As mesmas
 * tabelas do robô semanal (social_metrics_weekly e social_post_metrics), as
 * do /metricas e do MCP de métricas. Nada novo é coletado aqui.
 */

/** Variação da semana em pílula com seta (uma casa decimal). */
function Variacao({ pct }: { pct: number | null }) {
  if (pct === null || !isFinite(pct)) return null;
  return <DeltaChip value={Math.round(pct * 10) / 10} />;
}

/** Série das últimas 12 semanas de um campo, da mais antiga para a mais nova (para o minigráfico). */
function serieDe(linhas: SocialMetricsWeek[], campo: "followers" | "reach" | "total_interactions" | "profile_views"): number[] {
  return linhas.slice(0, 12).reverse().map((l) => l[campo]).filter((x): x is number => typeof x === "number" && isFinite(x));
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
    <div className="min-w-0 rounded-md bg-muted/60 px-4 py-4">
      <div className="flex items-center justify-between">
        <span className={texto.rotulo}>{rotulo}</span>
        <span className="text-[18px] font-semibold leading-6 tracking-[-0.02em] tabular-nums text-foreground">{formatMetricNumber(ultimo)}</span>
      </div>
      {pontos ? (
        <svg viewBox="0 0 200 44" preserveAspectRatio="none" className="mt-3 h-14 w-full" role="img" aria-label={`${rotulo} nas últimas semanas`}>
          <polyline points={pontos} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary" vectorEffect="non-scaling-stroke" />
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
  // Frente MC: com outra marca aberta (CME) e sem conta dela, nunca cai nos números de outra conta do cliente (a da Acerbi).
  const { marca } = useMarcaDaMesa();
  const soDaConta = !!marca && !marca.principal;
  const semanas = useSocialMetricsWeekly(clientId, 16);
  const linhas = useMemo(() => {
    const porConta = agruparPorConta(semanas.data);
    if (soDaConta) return (contaId && porConta.get(contaId)) || [];
    return (contaId && porConta.get(contaId)) || contaPrincipal(semanas.data);
  }, [semanas.data, contaId, soDaConta]);
  const contaDosPosts = contaId || (soDaConta ? "00000000-0000-0000-0000-000000000000" : linhas[0] ? linhas[0].external_account_id : undefined);
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
  if (soDaConta && !contaId && marca) {
    return (
      <p className={juntar(texto.auxiliar, "flex items-center")} data-metricas-sem-conta-da-marca="">
        A {marca.nome} ainda não tem Instagram ligado ao projeto dela
        <AjudaRecolhida className="ml-1" rotulo="Como ligar o Instagram da marca">
          Os números de outra conta do cliente não aparecem aqui. Ligue a conta ao projeto da {marca.nome} em Config, Integrações.
        </AjudaRecolhida>
      </p>
    );
  }
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
    <div className="min-w-0 space-y-6" data-metricas-do-perfil="">
      {/* Rodada ousada (15/11/2026): número grande, variação em pílula e a linha das últimas semanas (a série que o robô já coletou). */}
      <NumerosAbertos
        rotulo="Números da conta"
        colunas={4}
        className="grid-cols-2 lg:grid-cols-2 xl:grid-cols-4"
        itens={[
          { rotulo: "Seguidores", valor: formatMetricNumber(ultima.followers), apoio: <Variacao pct={weekDeltaPct(linhas, "followers")} />, grafico: <Sparkline values={serieDe(linhas, "followers")} height={36} tone={1} label="Seguidores nas últimas semanas" /> },
          { rotulo: "Alcance", valor: formatMetricNumber(fechada ? fechada.reach : ultima.reach), apoio: <Variacao pct={weekDeltaPct(linhas, "reach")} />, grafico: <Sparkline values={serieDe(linhas, "reach")} height={36} tone={2} label="Alcance nas últimas semanas" /> },
          { rotulo: "Interações", valor: formatMetricNumber(fechada ? fechada.total_interactions : ultima.total_interactions), apoio: <Variacao pct={weekDeltaPct(linhas, "total_interactions")} />, grafico: <Sparkline values={serieDe(linhas, "total_interactions")} height={36} tone={1} label="Interações nas últimas semanas" /> },
          { rotulo: "Visitas", valor: formatMetricNumber(fechada ? fechada.profile_views : ultima.profile_views), apoio: <Variacao pct={weekDeltaPct(linhas, "profile_views")} />, grafico: <Sparkline values={serieDe(linhas, "profile_views")} height={36} tone={2} label="Visitas ao perfil nas últimas semanas" /> },
        ]}
      />

      <div className="min-w-0">
        <TituloRecolhivel titulo="Últimas semanas" recolhido={linhaRecolhida} onAlternar={() => setLinhaRecolhida(!linhaRecolhida)} resumo={`${Math.min(12, linhas.length)} semanas`} />
        {!linhaRecolhida && (
          <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:gap-3 sm:grid-cols-2">
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
          <ul className="-mx-2 mt-2 min-w-0 divide-y divide-border/60" aria-label="Posts e números">
            {lista.map((p) => (
              <li key={p.id} className="min-w-0">
                <a href={p.permalink || "#"} target="_blank" rel="noreferrer" className="flex min-w-0 items-center rounded-md px-2 py-3 transition-colors hover:bg-muted/60">
                  <span className="relative mr-3 block h-14 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
                    {(p.thumbnail_url || p.media_url) && (
                      <img src={(p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url || p.thumbnail_url) || ""} alt={p.caption ? p.caption.slice(0, 60) : "Post"} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium leading-5 text-foreground">{p.caption ? p.caption.slice(0, 90) : "(sem legenda)"}</span>
                    <span className="block text-[12px] leading-4 text-muted-foreground">
                      {p.posted_at ? p.posted_at.slice(0, 10).split("-").reverse().join("/") : ""} · {ROTULO_DO_TIPO[String(p.media_type || "")] || "Post"}
                    </span>
                    <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(3, Math.round((interacoes(p) / maior) * 100))}%` }} />
                    </span>
                  </span>
                  <span className="ml-3 w-[96px] shrink-0 text-right text-[12px] leading-4 tabular-nums text-muted-foreground">
                    <span className="block text-[13px] font-semibold leading-5 text-foreground">{formatMetricNumber(interacoes(p))} inter.</span>
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
        {/* 16/10/2026 (dono: "texto + ícone vira só o ícone, sem bordas"): o nome fica no title e no leitor de tela. */}
        <Link to={`/metricas?client=${encodeURIComponent(clientId)}`} className={juntar(botao.icone, "shrink-0")} aria-label="Métricas completas" title="Métricas completas">
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
