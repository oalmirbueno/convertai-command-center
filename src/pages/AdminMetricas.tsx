import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  ExternalLink,
  Heart,
  MessageCircle,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import SaudeDasContas from "@/components/admin/SaudeDasContas";
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import IdentidadeDoCliente from "@/components/admin/IdentidadeDoCliente";
import {
  collectSocialMetricsNow,
  formatMetricNumber,
  useSocialClientIdentity,
  useSocialMetricsWeekly,
  useSocialPostMetrics,
  weekDeltaPct,
  type SocialMetricsWeek,
} from "@/hooks/useSocialMetrics";

const fmtWeek = (row: SocialMetricsWeek) => {
  const d = (value: string) => {
    const [, month, day] = value.split("-");
    return `${day}/${month}`;
  };
  return `${d(row.week_start)} a ${d(row.week_end)}`;
};

const MEDIA_TYPE_LABELS: Record<string, string> = {
  IMAGE: "Post",
  CAROUSEL_ALBUM: "Carrossel",
  VIDEO: "Reel/Vídeo",
};

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
        up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {`${up ? "+" : ""}${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
    </span>
  );
}

/**
 * Dossiê completo de UM cliente: as semanas com variação, o histórico de
 * alcance e o ranking do que performou (curtidas + comentários por post).
 */
function ClientMetricsDetail({
  clientId,
  clientName,
  rows,
  onBack,
}: {
  clientId: string;
  clientName: string;
  rows: SocialMetricsWeek[];
  onBack: () => void;
}) {
  // 200 e nao 25: agora que a coleta pagina, limitar aqui esconderia
  // justamente os posts que passaram a existir.
  const { data: posts } = useSocialPostMetrics(clientId, 200);
  const [abaDoCliente, setAbaDoCliente] = useState<"desempenho" | "identidade">("desempenho");
  const { data: identity } = useSocialClientIdentity(clientId);
  const latest = rows[0];
  const maxReach = Math.max(...rows.map((row) => row.reach || 0), 1);
  const rankedPosts = useMemo(
    () =>
      [...(posts || [])].sort(
        (a, b) =>
          (b.like_count || 0) + (b.comments_count || 0) -
          ((a.like_count || 0) + (a.comments_count || 0)),
      ),
    [posts],
  );
  const topEngagement = rankedPosts.length
    ? (rankedPosts[0].like_count || 0) + (rankedPosts[0].comments_count || 0)
    : 0;

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Todos os clientes
      </button>

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
            {abaDoCliente === x.id && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {abaDoCliente === "identidade" && (
        <IdentidadeDoCliente clientId={clientId} clientName={clientName} />
      )}

      {abaDoCliente === "desempenho" && (
      <>
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {identity?.profile_picture_url && (
              <img
                src={identity.profile_picture_url}
                alt=""
                className="h-12 w-12 shrink-0 rounded-full border border-border object-cover"
                onError={(event) => {
                  (event.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <div className="min-w-0">
              <Link
                to={`/clientes?client=${clientId}`}
                className="text-base font-bold text-foreground hover:text-primary"
              >
                {clientName}
              </Link>
              <p className="truncate text-[11px] text-muted-foreground">
                {identity?.username ? `@${identity.username} · ` : ""}
                {latest ? `Última semana coletada: ${fmtWeek(latest)}` : "Sem coleta ainda"}
              </p>
              {identity?.biography && (
                <p className="mt-0.5 line-clamp-2 max-w-xl text-[11px] leading-snug text-muted-foreground">
                  {identity.biography}
                </p>
              )}
            </div>
          </div>
          {identity?.website && (
            <a
              href={identity.website}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-primary hover:underline"
            >
              {identity.website.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>

        {latest && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Seguidores", value: latest.followers, delta: weekDeltaPct(rows, "followers") },
              { label: "Alcance na semana", value: latest.reach, delta: weekDeltaPct(rows, "reach") },
              { label: "Interações", value: latest.total_interactions, delta: weekDeltaPct(rows, "total_interactions") },
              { label: "Visitas ao perfil", value: latest.profile_views, delta: weekDeltaPct(rows, "profile_views") },
              { label: "Contas engajadas", value: latest.accounts_engaged, delta: weekDeltaPct(rows, "accounts_engaged") },
              { label: "Publicações no perfil", value: latest.media_count, delta: null },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-secondary/25 p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {item.label}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <p className="font-mono text-sm font-semibold text-foreground">
                    {formatMetricNumber(item.value)}
                  </p>
                  <DeltaBadge pct={item.delta} />
                </div>
              </div>
            ))}
          </div>
        )}

        {rows.length > 1 && (
          <div className="mt-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Alcance semana a semana
            </p>
            <div className="mt-2 space-y-1.5">
              {rows.slice(0, 12).map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 font-mono text-[10px] text-muted-foreground">
                    {fmtWeek(row)}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(((row.reach || 0) / maxReach) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-[10px] text-foreground">
                    {formatMetricNumber(row.reach)}
                  </span>
                  <span className="hidden w-24 shrink-0 text-right font-mono text-[10px] text-muted-foreground sm:block">
                    {formatMetricNumber(row.followers)} seg.
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {(() => {
        // Leitura e direcionamento calculados dos numeros reais, sem achismo.
        const lines: string[] = [];
        const followersPct = weekDeltaPct(rows, "followers");
        const reachPct = weekDeltaPct(rows, "reach");
        if (reachPct != null) {
          lines.push(
            reachPct >= 0
              ? `Alcance subiu ${reachPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% na semana. O conteúdo está encontrando gente nova; mantenha o ritmo.`
              : `Alcance caiu ${Math.abs(reachPct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% na semana. Vale variar formato e horário nos próximos posts.`,
          );
        }
        if (followersPct != null && followersPct < 0) {
          lines.push("Seguidores em queda leve: reforce conteúdo de valor (dica, bastidor, prova) antes de conteúdo de venda.");
        }
        const byType = new Map<string, { total: number; count: number }>();
        for (const post of rankedPosts) {
          const key = MEDIA_TYPE_LABELS[post.media_type || ""] || post.media_type || "Post";
          const bucket = byType.get(key) || { total: 0, count: 0 };
          bucket.total += (post.like_count || 0) + (post.comments_count || 0);
          bucket.count += 1;
          byType.set(key, bucket);
        }
        const typeAvgs = [...byType.entries()]
          .filter(([, b]) => b.count >= 2)
          .map(([type, b]) => ({ type, avg: b.total / b.count }))
          .sort((a, b) => b.avg - a.avg);
        if (typeAvgs.length >= 2) {
          lines.push(
            `${typeAvgs[0].type} engaja em média ${Math.round(typeAvgs[0].avg)} por post, contra ${Math.round(typeAvgs[typeAvgs.length - 1].avg)} de ${typeAvgs[typeAvgs.length - 1].type.toLowerCase()}: priorize ${typeAvgs[0].type.toLowerCase()}.`,
          );
        }
        const recent30 = rankedPosts.filter(
          (post) => post.posted_at && Date.now() - new Date(post.posted_at).getTime() < 30 * 86400000,
        ).length;
        if (recent30 > 0) {
          lines.push(`Ritmo atual: ${recent30} publicações nos últimos 30 dias.`);
        }
        const top = rankedPosts[0];
        const copySummary = () => {
          const d = (value: string) => {
            const [, month, day] = value.split("-");
            return `${day}/${month}`;
          };
          const pct = (value: number | null) =>
            value == null ? "" : ` (${value >= 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`;
          const parts = [
            `📊 ${clientName} · Instagram · semana ${latest ? `${d(latest.week_start)} a ${d(latest.week_end)}` : ""}`,
            latest?.followers != null ? `Seguidores: ${formatMetricNumber(latest.followers)}${pct(followersPct)}` : "",
            latest?.reach != null ? `Alcance: ${formatMetricNumber(latest.reach)}${pct(reachPct)}` : "",
            latest?.total_interactions != null
              ? `Interações: ${formatMetricNumber(latest.total_interactions)}${pct(weekDeltaPct(rows, "total_interactions"))}`
              : "",
            top
              ? `Post destaque: "${(top.caption || "").slice(0, 70)}" · ${formatMetricNumber(top.like_count)} curtidas · ${formatMetricNumber(top.comments_count)} comentários`
              : "",
            lines[0] ? `Leitura: ${lines[0]}` : "",
            "Acompanhamento contínuo pela Aceleriq 🚀",
          ].filter(Boolean);
          navigator.clipboard
            .writeText(parts.join("\n"))
            .then(() => toast.success("Resumo copiado. É só colar no grupo do cliente."))
            .catch(() => toast.error("Não foi possível copiar. Selecione e copie manualmente."));
        };
        return (
          <div className="rounded-2xl border border-primary/25 bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Leitura e direcionamento</p>
              <Button size="sm" variant="outline" onClick={copySummary}>
                Copiar resumo para o grupo
              </Button>
            </div>
            {lines.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Assim que houver 2 semanas coletadas, a leitura aparece aqui.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {lines.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <p className="text-sm font-semibold text-foreground">O que performou</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Publicações recentes ordenadas por engajamento (curtidas + comentários),
          direto da conta. Atualiza sozinho a cada 3 dias.
        </p>
        {rankedPosts.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Ainda sem publicações coletadas. Clique em "Atualizar agora" no topo;
            os posts chegam em alguns minutos.
          </p>
        ) : (
          <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {rankedPosts.map((post, index) => {
              const engagement = (post.like_count || 0) + (post.comments_count || 0);
              return (
                <div
                  key={post.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-secondary/20 px-3 py-2.5"
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      index === 0
                        ? "bg-primary/15 text-primary"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {index + 1}
                  </span>
                  {(post.thumbnail_url || post.media_url) && (
                    <img
                      src={post.thumbnail_url || post.media_url || ""}
                      alt=""
                      loading="lazy"
                      className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover"
                      onError={(event) => {
                        (event.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {post.caption?.trim() || "(sem legenda)"}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {MEDIA_TYPE_LABELS[post.media_type || ""] || post.media_type || "Post"}
                      {post.posted_at
                        ? ` · ${new Date(post.posted_at).toLocaleDateString("pt-BR")}`
                        : ""}
                      {post.reach != null ? ` · alcance ${formatMetricNumber(post.reach)}` : ""}
                      {post.saved != null ? ` · ${formatMetricNumber(post.saved)} salvos` : ""}
                      {post.shares != null ? ` · ${formatMetricNumber(post.shares)} compart.` : ""}
                    </p>
                    <div className="mt-1 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{
                          width: `${Math.max((engagement / Math.max(topEngagement, 1)) * 100, 3)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[11px] font-medium text-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Heart className="h-3.5 w-3.5 text-destructive" />
                      {formatMetricNumber(post.like_count)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5 text-primary" />
                      {formatMetricNumber(post.comments_count)}
                    </span>
                    {post.permalink && (
                      <a
                        href={post.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground transition-colors hover:text-primary"
                        aria-label="Abrir no Instagram"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

export default function AdminMetricas() {
  const { profile } = useAuth();
  const isStaff = ["admin", "manager", "design", "traffic"].includes(profile?.role || "");
  const { data: clients } = useClients();
  const { data: rows, isLoading } = useSocialMetricsWeekly();
  const queryClient = useQueryClient();
  // Uma consulta so para a grade inteira: uma por cartao seria N chamadas
  // para desenhar a mesma tela.
  const { data: identidades } = useIdentidadesDosClientes();
  const [collecting, setCollecting] = useState(false);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedClientId = searchParams.get("client") || "";

  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of (clients || []) as any[]) {
      map.set(String(client.id), client.company_name || client.full_name || "Cliente");
    }
    return map;
  }, [clients]);

  const byClient = useMemo(() => {
    const map = new Map<string, SocialMetricsWeek[]>();
    for (const row of rows || []) {
      const list = map.get(row.client_id) || [];
      list.push(row);
      map.set(row.client_id, list);
    }
    return [...map.entries()].sort((a, b) =>
      (clientNames.get(a[0]) || "").localeCompare(clientNames.get(b[0]) || "", "pt-BR"),
    );
  }, [rows, clientNames]);

  const filteredHubs = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return byClient;
    return byClient.filter(([clientId]) =>
      (clientNames.get(clientId) || "").toLocaleLowerCase("pt-BR").includes(term),
    );
  }, [byClient, clientNames, search]);

  const openClient = (clientId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("client", clientId);
    setSearchParams(next);
  };
  const closeClient = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("client");
    setSearchParams(next);
  };

  const refreshNow = async () => {
    setCollecting(true);
    try {
      const result = await collectSocialMetricsNow();
      toast.success(
        result.dispatched > 0
          ? `Coleta disparada para a Meta (${result.dispatched} chamadas). Os números chegam em alguns minutos.`
          : "Tudo em dia: semanas e publicações já coletadas.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["social-metrics-weekly"] }),
        queryClient.invalidateQueries({ queryKey: ["social-post-metrics"] }),
      ]);
    } catch (error: unknown) {
      toast.error(
        (error as { message?: string })?.message || "Não foi possível atualizar agora.",
      );
    } finally {
      setCollecting(false);
    }
  };

  if (!isStaff) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Esta área é da equipe.</div>
    );
  }

  const selectedRows = selectedClientId
    ? byClient.find(([clientId]) => clientId === selectedClientId)?.[1] || []
    : [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <BarChart3 className="h-5 w-5 text-primary" />
            Métricas · Instagram real
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Um hub por cliente. Clique para abrir o dossiê completo: semanas com
            variação, alcance e o ranking do que performou por publicação.
          </p>
        </div>
        <Button size="sm" onClick={refreshNow} disabled={collecting} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${collecting ? "animate-spin" : ""}`} />
          {collecting ? "Atualizando..." : "Atualizar agora"}
        </Button>
      </div>

      {/* Saber QUAIS contas medem vem antes de ler o que elas mediram: uma
          conta nunca conectada some do gráfico igual a um perfil parado, e
          são coisas diferentes. */}
      {!selectedClientId && <SaudeDasContas />}

      {selectedClientId ? (
        <ClientMetricsDetail
          clientId={selectedClientId}
          clientName={clientNames.get(selectedClientId) || "Cliente"}
          rows={selectedRows}
          onBack={closeClient}
        />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando métricas...</p>
      ) : byClient.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Nenhuma métrica coletada ainda. Clique em "Atualizar agora": a coleta é
          disparada para todas as contas Instagram conectadas e os números chegam
          em alguns minutos. Depois disso, o robô coleta sozinho toda semana.
        </div>
      ) : (
        <>
          {byClient.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar cliente..."
                className="w-full rounded-xl border border-border bg-secondary px-9 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
              />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredHubs.map(([clientId, list]) => {
              const latest = list[0];
              const reachDelta = weekDeltaPct(list, "reach");
              const followersDelta = weekDeltaPct(list, "followers");
              return (
                <button
                  key={clientId}
                  type="button"
                  onClick={() => openClient(clientId)}
                  className="group rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center gap-2.5">
                    {/* A marca antes do nome: o olho acha antes da palavra. */}
                    <LogoDoCliente
                      url={identidades?.get(clientId)?.profile_picture_url}
                      nome={clientNames.get(clientId)}
                      tamanho={36}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {clientNames.get(clientId) || "Cliente"}
                      </p>
                      {identidades?.get(clientId)?.username && (
                        <p className="truncate text-[10px] text-muted-foreground">
                          @{identidades.get(clientId)!.username}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Semana {fmtWeek(latest)}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Seguidores
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <p className="font-mono text-sm font-semibold text-foreground">
                          {formatMetricNumber(latest.followers)}
                        </p>
                        <DeltaBadge pct={followersDelta} />
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Alcance
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <p className="font-mono text-sm font-semibold text-foreground">
                          {formatMetricNumber(latest.reach)}
                        </p>
                        <DeltaBadge pct={reachDelta} />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
