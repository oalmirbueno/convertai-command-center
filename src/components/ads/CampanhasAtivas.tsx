import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity, AlertTriangle, Clock, Flame, Lightbulb, MousePointerClick, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import {
  recomendar, resumirCampanha,
  type CampanhaAtiva, type DiaDaCampanha, type Gravidade,
} from "@/lib/recomendacoesDeAnuncios";

/**
 * O que está rodando AGORA, e o que fazer a respeito.
 *
 * A área de anúncios mostrava números acumulados sem dizer o que está no
 * ar neste momento nem o que eles pedem. Número sem recomendação é
 * relatório; recomendação sem número é palpite. Aqui os dois andam juntos:
 * cada aviso traz a conta que o gerou.
 */

const dinheiro = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;
const inteiro = (v: number) => v.toLocaleString("pt-BR");

const TOM: Record<Gravidade, string> = {
  alta: "border-destructive/50 bg-destructive/[0.06]",
  media: "border-warning/50 bg-warning/[0.06]",
  baixa: "border-border bg-secondary/40",
};
const ICONE: Record<Gravidade, typeof AlertTriangle> = {
  alta: AlertTriangle,
  media: Flame,
  baixa: Lightbulb,
};

export default function CampanhasAtivas({
  clientId,
  nomesDeClientes,
  aoAbrirCliente,
}: {
  clientId?: string;
  /** client_id -> nome. Sem isto a lista mistura campanhas de todo mundo. */
  nomesDeClientes?: Map<string, string>;
  aoAbrirCliente?: (clientId: string) => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: identidades } = useIdentidadesDosClientes();

  const { data, error, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["campanhas-ativas", clientId ?? "todas"],
    queryFn: async () => {
      let q = (supabase as any).from("ads_campaigns")
        .select("campaign_id, name, effective_status, objective, daily_budget, lifetime_budget, client_id, updated_at");
      if (clientId) q = q.eq("client_id", clientId);
      const { data: campanhas, error: erroCampanhas } = await q;
      if (erroCampanhas) throw new Error(erroCampanhas.message);

      let qd = (supabase as any).from("ads_campaign_daily")
        .select("campaign_id, day, spend, impressions, clicks, link_clicks, ctr, cpc, frequency")
        .gte("day", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
      if (clientId) qd = qd.eq("client_id", clientId);
      const { data: dias, error: erroDias } = await qd;
      if (erroDias) throw new Error(erroDias.message);

      return {
        campanhas: (campanhas || []) as Array<CampanhaAtiva & { client_id: string }>,
        dias: (dias || []) as DiaDaCampanha[],
      };
    },
    // O dono pediu tempo real. Um minuto é o intervalo em que a Meta
    // realmente atualiza — pedir mais rápido gastaria chamada sem trazer
    // número novo.
    refetchInterval: 60_000,
  });

  const ativas = useMemo(
    () => (data?.campanhas ?? []).filter(
      (c) => (c.effective_status || "").toUpperCase() === "ACTIVE"),
    [data],
  );

  /** De qual cliente é uma campanha: o aviso sem dono não diz onde agir. */
  const nomeDoClienteDaCampanha = (campaignId: string) => {
    const c = (data?.campanhas ?? []).find((x) => x.campaign_id === campaignId);
    return c ? nomesDeClientes?.get((c as any).client_id) ?? null : null;
  };

  const recomendacoes = useMemo(
    () => data ? recomendar(data.campanhas, data.dias, hoje) : [],
    [data, hoje],
  );

  /**
   * As campanhas ativas agrupadas por CLIENTE.
   *
   * Uma lista corrida com uma etiqueta pequena em cada linha ainda obriga
   * a ler linha por linha para saber de quem é. Agrupar responde a
   * pergunta antes dela ser feita — e é ela que o dono fez: "não consigo
   * entender qual campanha está ativa de qual cliente".
   *
   * A ordem é por gasto de 14 dias: quem consome mais dinheiro merece o
   * primeiro olhar.
   */
  const porCliente = useMemo(() => {
    const grupos = new Map<string, typeof ativas>();
    for (const c of ativas) {
      const id = (c as any).client_id as string;
      const atual = grupos.get(id);
      if (atual) atual.push(c);
      else grupos.set(id, [c]);
    }
    return [...grupos.entries()]
      .map(([id, lista]) => ({
        clientId: id,
        nome: nomesDeClientes?.get(id) ?? "Cliente",
        campanhas: lista,
        gasto: lista.reduce(
          (s, c) => s + resumirCampanha(data?.dias ?? [], c.campaign_id, 14, hoje).gasto, 0),
      }))
      .sort((a, b) => b.gasto - a.gasto || a.nome.localeCompare(b.nome));
  }, [ativas, nomesDeClientes, data, hoje]);

  const clientesAtivos = porCliente;

  const totalHoje = useMemo(() => {
    if (!data) return { gasto: 0, impressoes: 0, cliques: 0 };
    const doDia = data.dias.filter((d) => String(d.day).slice(0, 10) === hoje);
    return {
      gasto: doDia.reduce((s, d) => s + Number(d.spend || 0), 0),
      impressoes: doDia.reduce((s, d) => s + Number(d.impressions || 0), 0),
      cliques: doDia.reduce((s, d) => s + Number(d.clicks || 0), 0),
    };
  }, [data, hoje]);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-secondary p-3 text-[12px] text-destructive">
        Não consegui ler as campanhas: {error instanceof Error ? error.message : String(error)}.
        Nenhuma campanha está sendo dada como parada — a leitura falhou.
      </div>
    );
  }
  if (isLoading) {
    return <p className="py-4 text-center text-[11px] text-muted-foreground">lendo as campanhas…</p>;
  }

  return (
    <div className="space-y-4">
      {/* O AGORA, em três números. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-success" /> No ar agora
          </p>
          {/* DE QUEM são estes números. Três totais sem escopo fazem quem lê
              achar que é de um cliente só — e decidir errado por isso. */}
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-foreground">
            {clientId
              ? (nomesDeClientes?.get(clientId) ?? "este cliente")
              : `todos os clientes · ${clientesAtivos.length}`}
          </span>
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">
            {ativas.length} {ativas.length === 1 ? "campanha ativa" : "campanhas ativas"}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            atualizado {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { r: "Gasto hoje", v: dinheiro(totalHoje.gasto), c: "text-warning" },
            { r: "Impressões hoje", v: inteiro(totalHoje.impressoes), c: "text-foreground" },
            { r: "Cliques hoje", v: inteiro(totalHoje.cliques), c: "text-info" },
          ].map((k) => (
            <div key={k.r} className="rounded-lg bg-secondary/50 p-2.5">
              <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{k.r}</p>
              <p className={cn("mt-0.5 font-mono text-base font-semibold", k.c)}>{k.v}</p>
            </div>
          ))}
        </div>
        {totalHoje.impressoes === 0 && ativas.length > 0 && (
          /* Zero hoje não é zero sempre: a Meta consolida o dia com atraso,
             e chamar isso de "parado" às 9h da manhã seria alarme falso. */
          <p className="mt-2 text-[10.5px] text-muted-foreground">
            Sem números de hoje ainda. A Meta consolida o dia com algumas horas de atraso —
            os últimos 30 dias abaixo já estão fechados.
          </p>
        )}
      </div>

      {/* AS RECOMENDAÇÕES, cada uma com a conta que a gerou. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Lightbulb className="h-3.5 w-3.5 text-warning" /> O que fazer
          {recomendacoes.length > 0 && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold normal-case text-warning">
              {recomendacoes.length}
            </span>
          )}
        </p>
        {recomendacoes.length === 0 ? (
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Nada pede ação agora. As regras olham gasto sem clique, fadiga de público,
            CTR abaixo da média da própria conta, orçamento no teto e campanha ativa sem
            entrega — e só opinam com volume suficiente para não confundir ruído com sinal.
          </p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {recomendacoes.map((r, i) => {
              const Icone = ICONE[r.gravidade];
              return (
                <div key={`${r.campaign_id}-${i}`} className={cn("rounded-lg border p-2.5", TOM[r.gravidade])}>
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                    <Icone className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      r.gravidade === "alta" ? "text-destructive"
                        : r.gravidade === "media" ? "text-warning" : "text-muted-foreground",
                    )} />
                    {r.titulo}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {!clientId && nomeDoClienteDaCampanha(r.campaign_id) && (
                      <span className="font-semibold text-foreground/80">
                        {nomeDoClienteDaCampanha(r.campaign_id)} ·{" "}
                      </span>
                    )}
                    {r.campanha}
                  </p>
                  {/* O NÚMERO. Sem ele o aviso vira palpite. */}
                  <p className="mt-1 text-[11.5px] text-foreground/90">{r.porque}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{r.acao}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* AS CAMPANHAS ATIVAS, com o desempenho de 14 dias. */}
      {ativas.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-info" /> Campanhas ativas · últimos 14 dias
          </p>
          <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
            {porCliente.map((grupo) => (
              <div key={grupo.clientId} className="space-y-1.5">
                {/* O cliente como cabeçalho, e não como etiqueta miúda. */}
                {!clientId && (
                  <button
                    type="button"
                    onClick={() => aoAbrirCliente?.(grupo.clientId)}
                    className="flex w-full items-center gap-2 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-left transition-colors hover:bg-secondary"
                  >
                    <LogoDoCliente
                      url={identidades?.get(grupo.clientId)?.profile_picture_url}
                      nome={grupo.nome}
                      tamanho={22}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
                      {grupo.nome}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {grupo.campanhas.length} ativa{grupo.campanhas.length > 1 ? "s" : ""}
                      {grupo.gasto > 0 && ` · ${dinheiro(grupo.gasto)} em 14 dias`}
                    </span>
                  </button>
                )}
            {grupo.campanhas.map((c) => {
              const r = resumirCampanha(data!.dias, c.campaign_id, 14, hoje);
              const temAviso = recomendacoes.some((x) => x.campaign_id === c.campaign_id);
              return (
                <div
                  key={c.campaign_id}
                  role={aoAbrirCliente ? "button" : undefined}
                  tabIndex={aoAbrirCliente ? 0 : undefined}
                  onClick={() => aoAbrirCliente?.((c as any).client_id)}
                  onKeyDown={(e) => {
                    if (!aoAbrirCliente || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    aoAbrirCliente((c as any).client_id);
                  }}
                  className={cn(
                    "rounded-lg border p-2.5",
                    aoAbrirCliente && "cursor-pointer transition-colors hover:border-primary/50",
                    temAviso ? "border-warning/40 bg-warning/[0.04]" : "border-border bg-secondary/40",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                      {c.name || c.campaign_id}
                    </span>
                    {c.objective && (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[9.5px] text-muted-foreground">
                        {String(c.objective).replace(/_/g, " ").toLowerCase()}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px]">
                    <span className="font-mono text-foreground">{dinheiro(r.gasto)}</span>
                    <span className="text-muted-foreground">{inteiro(r.impressoes)} impressões</span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <MousePointerClick className="h-2.5 w-2.5" />
                      {inteiro(r.cliques)} · CTR {pct(r.ctr)}
                    </span>
                    {r.cpc > 0 && <span className="text-muted-foreground">CPC {dinheiro(r.cpc)}</span>}
                    {r.frequencia > 0 && (
                      <span className={cn(
                        "text-muted-foreground",
                        r.frequencia >= 3.5 && "font-semibold text-warning",
                      )}>
                        freq. {r.frequencia.toFixed(1)}
                      </span>
                    )}
                    {c.daily_budget ? (
                      <span className="ml-auto text-muted-foreground">
                        teto {dinheiro(Number(c.daily_budget))}/dia
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
