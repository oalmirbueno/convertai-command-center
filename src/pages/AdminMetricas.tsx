import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Heart,
  Megaphone,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import SaudeDasContas from "@/components/admin/SaudeDasContas";
import LogoDoCliente, { useIdentidadesPorConta } from "@/components/admin/LogoDoCliente";
import IdentidadeDoCliente from "@/components/admin/IdentidadeDoCliente";
import {
  agruparPorConta,
  collectSocialMetricsNow,
  formatMetricNumber,
  semanaEmAndamento,
  useSocialClientIdentity,
  useSocialMetricsWeekly,
  useSocialPostMetrics,
  weekDeltaPct,
  type SocialMetricsWeek,
  type SocialPostMetric,
} from "@/hooks/useSocialMetrics";
import { useAdsConnection, useAdsDaily, type AdsDaily } from "@/hooks/useAdsMetrics";
import { dinheiro, numero, summarizeAccount } from "@/lib/adsLanguage";
import { custoDoResultado, resultadosPorObjetivo, rotuloDoResultado } from "@/lib/adsResumo";
import {
  conselhoDoCliente,
  formatoDoPost,
  interacoesDoPost,
  rankearPosts,
  totaisDosPosts,
} from "@/lib/metricasResumo";
import { pedirLeituraDaMesa, useDesempenhoDaMesa, useUltimaEvolucao } from "@/hooks/useConselhoDaMesa";

/**
 * Métricas por cliente (pedido do dono em 26/09: "mais organizada, mais
 * bonita, puxa todas as informações completas, alinhada com a Mesa, que
 * aconselha junto").
 *
 * No dossiê, blocos claros e nesta ordem: o conselho curto (números da
 * semana + leitura de evolução da Mesa + anúncios), o perfil orgânico
 * (alcance, seguidores, interações, salvamentos, compartilhamentos), os
 * anúncios somados do cliente e os posts que mais performaram, com miniatura.
 */

const fmtWeek = (row: SocialMetricsWeek) => {
  const d = (value: string) => {
    const [, month, day] = value.split("-");
    return `${day}/${month}`;
  };
  // A semana corrente aparece com os números parciais e diz isso na cara:
  // sem o aviso, 3 dias de alcance pareciam uma semana fraca.
  return `${d(row.week_start)} a ${d(row.week_end)}${semanaEmAndamento(row) ? " (em andamento)" : ""}`;
};

const ROTULO = "text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
        up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {`${up ? "+" : ""}${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
    </span>
  );
}

function Indicador({ rotulo, valor, delta, nota }: { rotulo: string; valor: string; delta?: number | null; nota?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-secondary/30 px-3 py-2.5">
      <p className={ROTULO}>{rotulo}</p>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
        <p className="truncate font-mono text-[15px] font-semibold text-foreground">{valor}</p>
        <DeltaBadge pct={delta ?? null} />
      </div>
      {nota && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{nota}</p>}
    </div>
  );
}

function Bloco({ titulo, icone, acao, children, destaque }: { titulo: string; icone?: ReactNode; acao?: ReactNode; children: ReactNode; destaque?: boolean }) {
  return (
    <section className={`min-w-0 rounded-2xl border bg-card ${destaque ? "border-primary/30" : "border-border"}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-foreground">
          {icone}
          {titulo}
        </h3>
        {acao}
      </div>
      <div className="min-w-0 px-4 py-3">{children}</div>
    </section>
  );
}

/** Resultado dos anúncios em frase curta: o objetivo com mais dinheiro. */
function resumoDosAnuncios(rows: AdsDaily[]) {
  const carteira = summarizeAccount(rows);
  const lista = resultadosPorObjetivo(rows).filter((r) => r.kind !== "alcance" && r.resultados > 0);
  const principal = lista[0] || null;
  return {
    carteira,
    resultado: principal ? rotuloDoResultado(principal) : null,
    custo: principal ? custoDoResultado(principal) : null,
    outros: lista.slice(1).map(rotuloDoResultado).join(" · "),
  };
}

/** Cartão de post com a miniatura grande: o que performou se reconhece pela imagem. */
function CartaoDoPost({ post, posicao }: { post: SocialPostMetric; posicao: number }) {
  const imagem = post.thumbnail_url || post.media_url || "";
  const numeros = [
    post.reach != null ? `${formatMetricNumber(post.reach)} alcance` : null,
    `${formatMetricNumber(interacoesDoPost(post))} interações`,
  ].filter(Boolean).join(" · ");
  return (
    <a
      href={post.permalink || undefined}
      target="_blank"
      rel="noreferrer"
      className="group block min-w-0 overflow-hidden rounded-xl border border-border bg-secondary/20 transition-colors hover:border-primary/40"
    >
      <div className="relative h-40 w-full bg-secondary">
        {imagem ? (
          <img
            src={imagem}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-semibold text-foreground">
          {posicao}º · {formatoDoPost(post.media_type)}
        </span>
      </div>
      <div className="min-w-0 space-y-1 px-3 py-2">
        <p className="line-clamp-2 text-[11.5px] leading-snug text-foreground [overflow-wrap:anywhere]">
          {post.caption?.trim() || "(sem legenda)"}
        </p>
        <p className="truncate text-[10.5px] text-muted-foreground">
          {post.posted_at ? `${new Date(post.posted_at).toLocaleDateString("pt-BR")} · ` : ""}
          {numeros}
        </p>
        <p className="flex flex-wrap gap-x-2.5 text-[10.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5"><Heart className="h-3 w-3" />{formatMetricNumber(post.like_count)}</span>
          <span className="inline-flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{formatMetricNumber(post.comments_count)}</span>
          <span className="inline-flex items-center gap-0.5"><Bookmark className="h-3 w-3" />{formatMetricNumber(post.saved)}</span>
          <span className="inline-flex items-center gap-0.5"><Send className="h-3 w-3" />{formatMetricNumber(post.shares)}</span>
        </p>
      </div>
    </a>
  );
}

/**
 * Dossiê de UMA conta de Instagram do cliente, com os anúncios do cliente e
 * o conselho da Mesa. Tudo do orgânico aqui é DESTA conta: o cliente pode ter
 * outra, e ela tem o próprio dossiê.
 */
function ClientMetricsDetail({
  clientId,
  accountId,
  clientName,
  rows,
  adsRows,
  onBack,
}: {
  clientId: string;
  accountId: string;
  clientName: string;
  rows: SocialMetricsWeek[];
  adsRows: AdsDaily[];
  onBack: () => void;
}) {
  // 200 e não 25: a coleta pagina, e limitar aqui esconderia posts reais.
  const { data: posts } = useSocialPostMetrics(clientId, 200, accountId);
  const [abaDoCliente, setAbaDoCliente] = useState<"desempenho" | "identidade">("desempenho");
  const [todosOsPosts, setTodosOsPosts] = useState(false);
  const [pedindoLeitura, setPedindoLeitura] = useState(false);
  const queryClient = useQueryClient();
  const { data: identity } = useSocialClientIdentity(clientId, accountId);
  const { data: evolucao } = useUltimaEvolucao(clientId);
  const { data: daMesa } = useDesempenhoDaMesa(clientId, 30);
  const { data: conexao } = useAdsConnection();

  const latest = rows[0];
  const rankedPosts = useMemo(() => rankearPosts(posts), [posts]);
  const totais = useMemo(() => totaisDosPosts(posts, 30), [posts]);
  const anuncios = useMemo(() => resumoDosAnuncios(adsRows), [adsRows]);
  const contasDeAds = (conexao?.contas || []).filter((c) => c.client_id === clientId && c.status === "active");
  const saldo = contasDeAds.some((c) => c.saldo_disponivel != null)
    ? contasDeAds.reduce((t, c) => t + Number(c.saldo_disponivel || 0), 0)
    : null;

  const deltaAlcance = weekDeltaPct(rows, "reach");
  const deltaSeguidores = weekDeltaPct(rows, "followers");
  const ultimasSemanas = rows.slice(0, 8);
  const maxReach = Math.max(...ultimasSemanas.map((row) => row.reach || 0), 1);

  const leituraDaMesa = evolucao ? evolucao.leitura : null;
  const conselho = useMemo(
    () =>
      conselhoDoCliente({
        semanas: rows,
        deltaAlcance,
        deltaSeguidores,
        posts: rankedPosts,
        evolucao: leituraDaMesa
          ? {
              resumo: leituraDaMesa.explicacao ? leituraDaMesa.explicacao.resumo : null,
              vencedores: leituraDaMesa.vencedores,
              proximos_testes: leituraDaMesa.proximos_testes,
              aprendizados: leituraDaMesa.aprendizados,
            }
          : null,
        anuncios: { investido: anuncios.carteira.investido, resultado: anuncios.resultado, custo: anuncios.custo },
      }),
    [rows, deltaAlcance, deltaSeguidores, rankedPosts, leituraDaMesa, anuncios],
  );

  const pedirLeitura = async () => {
    setPedindoLeitura(true);
    try {
      await pedirLeituraDaMesa(clientId, 30);
      await queryClient.invalidateQueries({ queryKey: ["metricas", "ultima-evolucao", clientId] });
      toast.success("A Mesa leu o cliente de novo. O conselho foi atualizado.");
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "A Mesa não respondeu agora. Tente de novo em instantes.");
    } finally {
      setPedindoLeitura(false);
    }
  };

  const copiarResumo = () => {
    const d = (value: string) => {
      const [, month, day] = value.split("-");
      return `${day}/${month}`;
    };
    const pct = (value: number | null) =>
      value == null ? "" : ` (${value >= 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`;
    const top = rankedPosts[0];
    const parts = [
      `📊 ${clientName} · Instagram · semana ${latest ? `${d(latest.week_start)} a ${d(latest.week_end)}` : ""}`,
      latest?.followers != null ? `Seguidores: ${formatMetricNumber(latest.followers)}${pct(deltaSeguidores)}` : "",
      latest?.reach != null ? `Alcance: ${formatMetricNumber(latest.reach)}${pct(deltaAlcance)}` : "",
      latest?.total_interactions != null
        ? `Interações: ${formatMetricNumber(latest.total_interactions)}${pct(weekDeltaPct(rows, "total_interactions"))}`
        : "",
      top
        ? `Post destaque: "${(top.caption || "").slice(0, 70)}" · ${formatMetricNumber(interacoesDoPost(top))} interações`
        : "",
      anuncios.carteira.investido > 0 && anuncios.resultado
        ? `Anúncios (30 dias): ${anuncios.resultado}${anuncios.custo ? `, ${anuncios.custo}` : ""}`
        : "",
      conselho[0] ? `Leitura: ${conselho[0]}` : "",
      "Acompanhamento contínuo pela Aceleriq 🚀",
    ].filter(Boolean);
    navigator.clipboard
      .writeText(parts.join("\n"))
      .then(() => toast.success("Resumo copiado. É só colar no grupo do cliente."))
      .catch(() => toast.error("Não foi possível copiar. Selecione e copie manualmente."));
  };

  const destaques = rankedPosts.slice(0, 6);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Todos os clientes
      </button>

      {/* Quem é: a cara do perfil, numa linha. */}
      <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        {identity?.profile_picture_url ? (
          <img
            src={identity.profile_picture_url}
            alt=""
            referrerPolicy="no-referrer"
            className="h-11 w-11 shrink-0 rounded-full border border-border object-cover"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <LogoDoCliente url={null} nome={clientName} tamanho={44} />
        )}
        <div className="min-w-0 flex-1">
          <Link to={`/clientes?client=${clientId}`} className="text-base font-bold text-foreground hover:text-primary">
            {clientName}
          </Link>
          <p className="truncate text-[11px] text-muted-foreground">
            {identity?.username ? `@${identity.username} · ` : ""}
            {latest ? `semana ${fmtWeek(latest)}` : "sem coleta ainda"}
          </p>
        </div>
        {identity?.website && (
          <a href={identity.website} target="_blank" rel="noreferrer" className="max-w-full truncate text-[11px] text-primary hover:underline">
            {identity.website.replace(/^https?:\/\//, "")}
          </a>
        )}
      </div>

      {/* Duas leituras diferentes, e por isso duas abas: desempenho responde
          "como foi", identidade responde "como a marca é". */}
      <div className="flex gap-1 border-b border-border">
        {([
          { id: "desempenho", rotulo: "Desempenho" },
          { id: "identidade", rotulo: "Identidade" },
        ] as const).map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setAbaDoCliente(x.id)}
            className={`relative px-3 pb-2 pt-1 text-[13px] font-semibold transition-colors ${
              abaDoCliente === x.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {x.rotulo}
            {abaDoCliente === x.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {abaDoCliente === "identidade" && <IdentidadeDoCliente clientId={clientId} clientName={clientName} />}

      {abaDoCliente === "desempenho" && (
        <>
          {/* 1. O conselho, curto e com o número que o gerou. */}
          <Bloco
            destaque
            titulo="Conselho"
            icone={<Sparkles className="h-4 w-4 text-primary" />}
            acao={
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" className="h-8 text-[12px]" onClick={pedirLeitura} disabled={pedindoLeitura}>
                  <RefreshCw className={`mr-1 h-3.5 w-3.5 ${pedindoLeitura ? "animate-spin" : ""}`} />
                  {pedindoLeitura ? "A Mesa está lendo..." : "Pedir leitura da Mesa"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={copiarResumo}>
                  Copiar resumo para o grupo
                </Button>
              </div>
            }
          >
            {conselho.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                Com duas semanas coletadas ou uma leitura da Mesa, o conselho aparece aqui.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {conselho.map((linha) => (
                  <li key={linha} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-foreground">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{linha}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              {evolucao
                ? `Leitura da Mesa de ${new Date(evolucao.criadoEm).toLocaleDateString("pt-BR")}.`
                : "A Mesa ainda não leu este cliente."}{" "}
              <Link to={`/mesa?client=${clientId}`} className="text-primary hover:underline">Abrir a Mesa</Link>
            </p>
          </Bloco>

          {/* 2. O perfil orgânico. */}
          <Bloco titulo="Perfil orgânico" acao={latest ? <span className="text-[11px] text-muted-foreground">semana {fmtWeek(latest)}</span> : null}>
            {!latest ? (
              <p className="text-[12px] text-muted-foreground">
                Sem semana coletada ainda. "Atualizar agora" no topo pede a coleta; os números chegam em alguns minutos.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Indicador rotulo="Seguidores" valor={formatMetricNumber(latest.followers)} delta={deltaSeguidores} />
                  <Indicador rotulo="Alcance" valor={formatMetricNumber(latest.reach)} delta={deltaAlcance} nota="na semana" />
                  <Indicador rotulo="Interações" valor={formatMetricNumber(latest.total_interactions)} delta={weekDeltaPct(rows, "total_interactions")} nota="na semana" />
                  <Indicador rotulo="Salvamentos" valor={formatMetricNumber(totais.salvos)} nota="posts de 30 dias" />
                  <Indicador rotulo="Compartilhamentos" valor={formatMetricNumber(totais.compartilhamentos)} nota="posts de 30 dias" />
                  <Indicador rotulo="Visitas ao perfil" valor={formatMetricNumber(latest.profile_views)} delta={weekDeltaPct(rows, "profile_views")} nota="na semana" />
                </div>
                {ultimasSemanas.length > 1 && (
                  <div className="mt-4">
                    <p className={ROTULO}>Alcance semana a semana</p>
                    <div className="mt-2 space-y-1">
                      {ultimasSemanas.map((row) => (
                        <div key={row.id} className="flex min-w-0 items-center gap-2">
                          <span className="w-28 shrink-0 truncate font-mono text-[10px] text-muted-foreground">{fmtWeek(row)}</span>
                          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-primary/70"
                              style={{ width: `${Math.max(((row.reach || 0) / maxReach) * 100, 2)}%` }}
                            />
                          </div>
                          <span className="w-16 shrink-0 text-right font-mono text-[10px] text-foreground">{formatMetricNumber(row.reach)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </Bloco>

          {/* 3. Os anúncios do cliente, somados, e a soma com o orgânico que a Mesa faz. */}
          <Bloco
            titulo="Anúncios do cliente · 30 dias"
            icone={<Megaphone className="h-4 w-4 text-muted-foreground" />}
            acao={
              <Link to={`/anuncios?cliente=${encodeURIComponent(clientId)}`} className="text-[11.5px] text-primary hover:underline">
                Abrir em Anúncios
              </Link>
            }
          >
            {adsRows.length === 0 && contasDeAds.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                Sem conta de anúncio ligada a este cliente. Ligue em Anúncios para os números entrarem aqui.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Indicador rotulo="Investido" valor={dinheiro(anuncios.carteira.investido)} />
                  <Indicador rotulo="Resultado" valor={anuncios.resultado || "sem resultado"} nota={anuncios.custo || undefined} />
                  <Indicador rotulo="Alcance pago" valor={numero(anuncios.carteira.alcance)} />
                  <Indicador rotulo="Saldo na conta" valor={saldo != null ? dinheiro(saldo) : "não lido"} />
                </div>
                {anuncios.outros && <p className="mt-2 text-[11px] text-muted-foreground">Também: {anuncios.outros}</p>}
              </>
            )}
            {daMesa && daMesa.somado.explicacao && (
              <p className="mt-3 rounded-lg bg-secondary/50 px-3 py-2 text-[11.5px] leading-relaxed text-foreground">
                <span className="font-semibold">Somado pela Mesa: </span>
                {daMesa.somado.alcance_aprox != null ? `alcance aproximado ${formatMetricNumber(daMesa.somado.alcance_aprox)} · ` : ""}
                {`${formatMetricNumber(daMesa.somado.interacoes)} interações · ${dinheiro(daMesa.somado.investimento)} investidos. `}
                <span className="text-muted-foreground">{daMesa.somado.explicacao}</span>
              </p>
            )}
          </Bloco>

          {/* 4. Os posts que mais performaram, com a miniatura. */}
          <Bloco
            titulo="Posts que mais performaram"
            acao={<span className="text-[11px] text-muted-foreground">por interações (curtidas, comentários, salvos e compartilhamentos)</span>}
          >
            {rankedPosts.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                Ainda sem publicações coletadas. "Atualizar agora" no topo pede a coleta; os posts chegam em alguns minutos.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
                  {destaques.map((post, i) => (
                    <CartaoDoPost key={post.id} post={post} posicao={i + 1} />
                  ))}
                </div>
                {rankedPosts.length > destaques.length && (
                  <button
                    type="button"
                    onClick={() => setTodosOsPosts((v) => !v)}
                    aria-expanded={todosOsPosts}
                    className="mt-3 flex items-center gap-1 text-[12px] font-medium text-primary"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${todosOsPosts ? "" : "-rotate-90"}`} />
                    {todosOsPosts ? "Esconder a lista" : `Ver todas as ${rankedPosts.length} publicações`}
                  </button>
                )}
                {todosOsPosts && (
                  <div className="mt-2 max-h-[520px] min-w-0 divide-y divide-border overflow-y-auto overscroll-contain rounded-xl border border-border">
                    {rankedPosts.map((post, index) => (
                      <div key={post.id} className="flex min-w-0 items-center gap-3 px-3 py-2">
                        <span className="w-6 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">{index + 1}</span>
                        {(post.thumbnail_url || post.media_url) && (
                          <img
                            src={post.thumbnail_url || post.media_url || ""}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
                            onError={(event) => {
                              (event.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] text-foreground">{post.caption?.trim() || "(sem legenda)"}</p>
                          <p className="truncate text-[10.5px] text-muted-foreground">
                            {formatoDoPost(post.media_type)}
                            {post.posted_at ? ` · ${new Date(post.posted_at).toLocaleDateString("pt-BR")}` : ""}
                            {post.reach != null ? ` · alcance ${formatMetricNumber(post.reach)}` : ""}
                            {post.saved != null ? ` · ${formatMetricNumber(post.saved)} salvos` : ""}
                            {post.shares != null ? ` · ${formatMetricNumber(post.shares)} compart.` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] text-foreground">{formatMetricNumber(interacoesDoPost(post))}</span>
                        {post.permalink && (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                            aria-label="Abrir no Instagram"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Bloco>
        </>
      )}
    </div>
  );
}

export default function AdminMetricas() {
  const { profile } = useAuth();
  const isStaff = ["admin", "manager", "design", "traffic"].includes(profile?.role || "");
  const { data: clients } = useClients();
  const { data: rows, isLoading, error } = useSocialMetricsWeekly();
  const { data: adsRows } = useAdsDaily(undefined, 30);
  const queryClient = useQueryClient();
  // Uma consulta só para a grade inteira, por CONTA: cada hub é uma conta.
  const { data: identidades } = useIdentidadesPorConta();
  const [collecting, setCollecting] = useState(false);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedClientId = searchParams.get("client") || "";
  const selectedAccountId = searchParams.get("account") || "";

  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of (clients || []) as any[]) {
      map.set(String(client.id), client.company_name || client.full_name || "Cliente");
    }
    return map;
  }, [clients]);

  /** Anúncios dos últimos 30 dias por cliente: uma leitura só para a grade. */
  const adsPorCliente = useMemo(() => {
    const mapa = new Map<string, AdsDaily[]>();
    for (const row of adsRows || []) {
      const lista = mapa.get(row.client_id) || [];
      lista.push(row);
      mapa.set(row.client_id, lista);
    }
    return mapa;
  }, [adsRows]);

  // Um hub por CONTA de Instagram, não por cliente: agrupar por cliente
  // misturava as semanas de duas contas (500 x 53 virava "-89%").
  const byAccount = useMemo(() => {
    const porConta = agruparPorConta(rows);
    const nomeDe = (accountId: string, clientId: string) => {
      const user = identidades?.get(accountId)?.username;
      return `${clientNames.get(clientId) || ""} ${user ? "@" + user : ""}`;
    };
    return [...porConta.entries()].sort((a, b) =>
      nomeDe(a[0], a[1][0].client_id).localeCompare(nomeDe(b[0], b[1][0].client_id), "pt-BR"),
    );
  }, [rows, clientNames, identidades]);

  const filteredHubs = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return byAccount;
    return byAccount.filter(([accountId, list]) =>
      `${clientNames.get(list[0].client_id) || ""} ${identidades?.get(accountId)?.username || ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(term),
    );
  }, [byAccount, clientNames, identidades, search]);

  const openAccount = (clientId: string, accountId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("client", clientId);
    next.set("account", accountId);
    setSearchParams(next);
  };
  const closeClient = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("client");
    next.delete("account");
    setSearchParams(next);
  };

  const refreshNow = async () => {
    setCollecting(true);
    try {
      const result = await collectSocialMetricsNow();
      toast.success(
        result.dispatched > 0
          ? `Coleta pedida à Meta (${result.dispatched} chamadas). Os números chegam em alguns minutos.`
          : "Tudo em dia: semanas e publicações já coletadas.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["social-metrics-weekly"] }),
        queryClient.invalidateQueries({ queryKey: ["social-post-metrics"] }),
      ]);
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível atualizar agora.");
    } finally {
      setCollecting(false);
    }
  };

  if (!isStaff) {
    return <div className="p-6 text-sm text-muted-foreground">Esta área é da equipe.</div>;
  }

  // Link antigo só com ?client= continua abrindo: cai na primeira conta do cliente.
  const selectedHub = selectedClientId
    ? byAccount.find(([accountId, list]) =>
        list[0].client_id === selectedClientId && (!selectedAccountId || accountId === selectedAccountId))
    : undefined;
  const selectedRows = selectedHub?.[1] || [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <BarChart3 className="h-5 w-5 text-primary" />
            Métricas
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Instagram de cada cliente, os anúncios somados e o conselho da Mesa.
          </p>
        </div>
        <Button size="sm" onClick={refreshNow} disabled={collecting} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${collecting ? "animate-spin" : ""}`} />
          {collecting ? "Pedindo coleta..." : "Atualizar agora"}
        </Button>
      </header>

      {error && (
        <p className="rounded-xl border border-destructive/30 bg-card px-4 py-3 text-[12px] text-destructive">
          Não consegui ler as métricas: {(error as { message?: string })?.message || "erro desconhecido"}.
        </p>
      )}

      {selectedClientId && selectedHub ? (
        <ClientMetricsDetail
          clientId={selectedClientId}
          accountId={selectedHub[0]}
          clientName={clientNames.get(selectedClientId) || "Cliente"}
          rows={selectedRows}
          adsRows={adsPorCliente.get(selectedClientId) || []}
          onBack={closeClient}
        />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando métricas...</p>
      ) : byAccount.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-[12.5px] text-muted-foreground">
          Nenhuma métrica coletada ainda. "Atualizar agora" pede a coleta de todas as contas de Instagram
          conectadas; os números chegam em alguns minutos e depois o robô coleta sozinho toda semana.
        </div>
      ) : (
        <>
          {byAccount.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar cliente..."
                className="h-9 w-full rounded-lg border border-border bg-secondary px-9 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
              />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredHubs.map(([accountId, list]) => {
              const latest = list[0];
              const clientId = latest.client_id;
              const ads = resumoDosAnuncios(adsPorCliente.get(clientId) || []);
              const temAds = ads.carteira.investido > 0;
              return (
                <button
                  key={accountId}
                  type="button"
                  onClick={() => openAccount(clientId, accountId)}
                  className="group min-w-0 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {/* A marca antes do nome: o olho acha antes da palavra. */}
                    <LogoDoCliente
                      url={identidades?.get(accountId)?.profile_picture_url}
                      nome={clientNames.get(clientId)}
                      tamanho={36}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{clientNames.get(clientId) || "Cliente"}</p>
                      <p className="truncate text-[10.5px] text-muted-foreground">
                        {identidades?.get(accountId)?.username ? `@${identidades.get(accountId)!.username} · ` : ""}
                        semana {fmtWeek(latest)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      { r: "Seguidores", v: latest.followers, d: weekDeltaPct(list, "followers") },
                      { r: "Alcance", v: latest.reach, d: weekDeltaPct(list, "reach") },
                      { r: "Interações", v: latest.total_interactions, d: weekDeltaPct(list, "total_interactions") },
                    ].map((k) => (
                      <div key={k.r} className="min-w-0">
                        <p className={ROTULO}>{k.r}</p>
                        <p className="truncate font-mono text-[13px] font-semibold text-foreground">{formatMetricNumber(k.v)}</p>
                        <DeltaBadge pct={k.d} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 truncate border-t border-border pt-2 text-[11px] text-muted-foreground">
                    <Megaphone className="mr-1 inline h-3 w-3" />
                    {temAds
                      ? `Anúncios 30 dias: ${dinheiro(ads.carteira.investido)}${ads.resultado ? ` · ${ads.resultado}` : ""}`
                      : "Sem anúncios nos últimos 30 dias"}
                  </p>
                </button>
              );
            })}
          </div>
          {filteredHubs.length === 0 && <p className="text-[12px] text-muted-foreground">Nenhum cliente com esse nome.</p>}

          {/* A saúde das contas vem DEPOIS dos cartões: diagnóstico é consulta, não abertura. */}
          <SaudeDasContas />
        </>
      )}
    </div>
  );
}
