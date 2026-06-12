// Dashboard premium auto-renderizado por modelo (Google Ads / Meta Ads / Social / Vendas)
// Recebe os dados brutos parseados (rows) salvos em metrics.__breakdown e renderiza
// gráficos extras: top campanhas, mix de plataforma, funil, distribuição.

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Treemap,
} from "recharts";
import {
  Trophy, Layers, TrendingUp, Target, DollarSign, Users, Activity,
  ShoppingCart, Sparkles, ArrowDownRight,
} from "lucide-react";

const PALETTE = [
  "hsl(145, 100%, 50%)", "hsl(200, 100%, 50%)", "hsl(263, 70%, 66%)",
  "hsl(38, 92%, 50%)",  "hsl(346, 87%, 60%)", "hsl(188, 94%, 43%)",
  "hsl(221, 83%, 53%)", "hsl(280, 70%, 60%)",
];

interface Props {
  source: string;
  sourceLabel: string;
  rows: Array<Record<string, any>>;
  dimensionKey: string;
  metrics: Record<string, any>;
}

const fmtN = (v: number) => v >= 1000 ? (v / 1000).toFixed(1) + "K" : Math.round(v).toLocaleString("pt-BR");
const fmtMoney = (v: number) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Busca uma coluna preferindo termos mais específicos (ordem dos candidates importa)
 *  e ignorando colunas que contenham qualquer dos termos de `exclude` (ex.: "custo por",
 *  "cpc", "início", "únicos"). Isso evita pegar "Custo por resultados" quando o que
 *  queremos é "Valor usado" (investimento), ou "Resultados" (conversões). */
function pickKey(rows: any[], candidates: string[], exclude: string[] = []): string | null {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]);
  const isBad = (lk: string) => exclude.some(e => lk.includes(e));
  for (const cand of candidates) {
    const c = cand.toLowerCase();
    const found = keys.find(k => {
      const lk = k.toLowerCase();
      return lk.includes(c) && !isBad(lk);
    });
    if (found) return found;
  }
  return null;
}

/** Infere o TIPO de conversão a partir do nome da coluna detectada como "resultados".
 *  Evita o termo genérico "Conversões" — o cliente precisa saber conversão DE QUÊ. */
function detectConvType(convKey: string | null, source: string): {
  noun: string;          // rótulo curto p/ KPI/funil (ex.: "Mensagens")
  short: string;         // versão muito curta p/ chips (ex.: "msgs")
  explainer: string;     // frase explicativa (ex.: "conversas iniciadas pelo anúncio")
} {
  const k = (convKey || "").toLowerCase();
  if (!convKey) {
    return { noun: source === "sales" ? "Vendas" : "Resultados", short: "result.",
             explainer: "ações que o anúncio gerou no período" };
  }
  if (/mensag|conversa|messag|chat|whats/.test(k))
    return { noun: "Mensagens",      short: "msgs",     explainer: "conversas iniciadas a partir do anúncio (clicaram em 'Enviar mensagem')" };
  if (/lead|cadastr|formul/.test(k))
    return { noun: "Leads",          short: "leads",    explainer: "cadastros recebidos via formulário do anúncio" };
  if (/compra|purchase|pedido|order|venda|sale/.test(k))
    return { noun: "Compras",        short: "vendas",   explainer: "vendas concluídas atribuídas ao anúncio" };
  if (/instal|install|app/.test(k))
    return { noun: "Instalações",    short: "installs", explainer: "instalações de app geradas pelo anúncio" };
  if (/visualiz|view|reprod|play/.test(k))
    return { noun: "Visualizações",  short: "views",    explainer: "visualizações de vídeo/conteúdo geradas pelo anúncio" };
  if (/cadastr|sign|inscr|register/.test(k))
    return { noun: "Inscrições",     short: "inscr.",   explainer: "inscrições/cadastros gerados" };
  if (/contat|chamad|call/.test(k))
    return { noun: "Contatos",       short: "contatos", explainer: "contatos diretos gerados pelo anúncio" };
  if (/resultado|result/.test(k))
    // "Resultados" é a métrica nativa do Meta — usamos a própria coluna como subtítulo
    return { noun: "Resultados",     short: "result.",  explainer: `meta de otimização configurada no anúncio (coluna "${convKey}")` };
  // fallback: usa o próprio nome da coluna como rótulo (capitalizado)
  const pretty = convKey.replace(/\b\w/g, c => c.toUpperCase());
  return { noun: pretty, short: pretty.slice(0, 8).toLowerCase(), explainer: `valor agregado da coluna "${convKey}"` };
}

const tooltipStyle = {
  background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
  borderRadius: 12, fontSize: 12, color: "hsl(var(--foreground))",
  boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
};


export default function SourceDashboard({ source, sourceLabel, rows, dimensionKey }: Props) {
  if (!rows || rows.length === 0) return null;

  // Excludes globais — colunas derivadas/qualificadas que NÃO representam volume bruto.
  const NOT_SPEND   = ["custo por", "cost per", "cpc", "cpm", "cpa", "cpr"];
  const NOT_CLICKS  = ["custo por", "cost per", "cpc", "ctr", "%", "unico", "único", "único"];
  const NOT_IMPR    = ["cpm", "custo por", "cost per"];
  const NOT_REACH   = ["custo por", "cost per", "cpm"];
  const NOT_CONV    = ["custo por", "cost per", "início", "inicio", "encerramento", "cpa", "cpl"];
  const NOT_REVENUE = ["custo", "cost", "cpa"];
  const NOT_ORDERS  = ["custo", "cost", "valor"];
  const NOT_ENGAG   = ["taxa", "rate", "%"];

  const spendKey      = pickKey(rows, ["valor usado", "valor gasto", "amount spent", "amountspent", "investimento", "investido", "spend", "custo total", "valor"], NOT_SPEND);
  const clicksKey     = pickKey(rows, ["cliques no link", "link clicks", "cliques (todos)", "cliques todos", "cliques", "clicks"], NOT_CLICKS);
  const impressKey    = pickKey(rows, ["impressões", "impressoes", "impressions", "impr"], NOT_IMPR);
  const reachKey      = pickKey(rows, ["alcance", "reach", "pessoas alcanç"], NOT_REACH);
  const convKey       = pickKey(rows, ["resultados", "results", "conversões", "conversoes", "conversions", "mensagens", "messag", "leads"], NOT_CONV);
  const revenueKey    = pickKey(rows, ["revenue", "receita", "vendas", "sales", "valor das compras", "valor de conversão"], NOT_REVENUE);
  const ordersKey     = pickKey(rows, ["pedidos", "orders", "compras", "purchases"], NOT_ORDERS);
  const engagementKey = pickKey(rows, ["engajamento", "engagement", "interações", "interacoes"], NOT_ENGAG);

  const isAds = source === "google_ads" || source === "meta_ads";
  const isSales = source === "sales";
  const isSocial = source === "social_media";

  // ── 1. TOP itens por dimensão (campanhas/posts/produtos) ──
  const sortKey = spendKey || revenueKey || clicksKey || engagementKey;
  const topRows = sortKey
    ? [...rows].sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0)).slice(0, 8)
    : rows.slice(0, 8);

  const topChart = topRows.map((r, i) => ({
    name: String(r[dimensionKey] || "·").slice(0, 28),
    value: sortKey ? Number(r[sortKey]) || 0 : 0,
    fill: PALETTE[i % PALETTE.length],
  }));

  // ── 2. Mix de distribuição (pie) ──
  const pieKey = spendKey || revenueKey || convKey || clicksKey;
  const pieRows = pieKey
    ? [...rows].sort((a, b) => (Number(b[pieKey]) || 0) - (Number(a[pieKey]) || 0)).slice(0, 6)
    : [];
  const pieData = pieRows.map((r, i) => ({
    name: String(r[dimensionKey] || "·").slice(0, 24),
    value: pieKey ? Number(r[pieKey]) || 0 : 0,
    fill: PALETTE[i % PALETTE.length],
  })).filter(d => d.value > 0);
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);

  const convType = detectConvType(convKey, source);

  // ── 3. Funil (Ads): Impressões → Cliques → {convType.noun} ──
  const funnelStages = (isAds && impressKey && clicksKey)
    ? [
        { name: "Impressões", value: rows.reduce((s, r) => s + (Number(r[impressKey]) || 0), 0), fill: PALETTE[2] },
        { name: "Cliques",    value: rows.reduce((s, r) => s + (Number(r[clicksKey]) || 0), 0), fill: PALETTE[1] },
        ...(convKey ? [{ name: convType.noun, value: rows.reduce((s, r) => s + (Number(r[convKey]) || 0), 0), fill: PALETTE[0] }] : []),
      ].filter(d => d.value > 0)
    : null;


  // ── 4. Treemap (Sales: receita por produto/canal) ──
  const treemapData = (isSales && revenueKey)
    ? rows.slice().sort((a, b) => (Number(b[revenueKey]) || 0) - (Number(a[revenueKey]) || 0))
        .slice(0, 12).map((r, i) => ({
          name: String(r[dimensionKey] || "·").slice(0, 24),
          size: Number(r[revenueKey]) || 0,
          fill: PALETTE[i % PALETTE.length],
        })).filter(d => d.size > 0)
    : null;

  // KPIs derivados
  const totalSpend = spendKey ? rows.reduce((s, r) => s + (Number(r[spendKey]) || 0), 0) : 0;
  const totalRevenue = revenueKey ? rows.reduce((s, r) => s + (Number(r[revenueKey]) || 0), 0) : 0;
  const totalClicks = clicksKey ? rows.reduce((s, r) => s + (Number(r[clicksKey]) || 0), 0) : 0;
  const totalImpr = impressKey ? rows.reduce((s, r) => s + (Number(r[impressKey]) || 0), 0) : 0;
  const totalConv = convKey ? rows.reduce((s, r) => s + (Number(r[convKey]) || 0), 0) : 0;
  const totalOrders = ordersKey ? rows.reduce((s, r) => s + (Number(r[ordersKey]) || 0), 0) : 0;

  const heroKpis: Array<{ label: string; value: string; sub?: string; icon: any; color: string }> = [];
  if (isAds) {
    if (totalSpend > 0) heroKpis.push({ label: "Investido", value: fmtMoney(totalSpend), icon: DollarSign, color: PALETTE[0] });
    if (totalImpr > 0)  heroKpis.push({ label: "Impressões", value: fmtN(totalImpr), icon: Activity, color: PALETTE[2] });
    if (totalClicks > 0) heroKpis.push({ label: "Cliques", value: fmtN(totalClicks), sub: totalImpr > 0 ? `CTR ${((totalClicks/totalImpr)*100).toFixed(2)}%` : undefined, icon: Target, color: PALETTE[1] });
    if (totalConv > 0)   heroKpis.push({ label: "Conversões", value: fmtN(totalConv), sub: totalSpend > 0 ? `CPA ${fmtMoney(totalSpend/totalConv)}` : undefined, icon: TrendingUp, color: PALETTE[3] });
  } else if (isSales) {
    if (totalRevenue > 0) heroKpis.push({ label: "Receita", value: fmtMoney(totalRevenue), icon: DollarSign, color: PALETTE[0] });
    if (totalOrders > 0)  heroKpis.push({ label: "Pedidos", value: fmtN(totalOrders), icon: ShoppingCart, color: PALETTE[1] });
    if (totalRevenue > 0 && totalOrders > 0) heroKpis.push({ label: "Ticket Médio", value: fmtMoney(totalRevenue / totalOrders), icon: TrendingUp, color: PALETTE[2] });
    heroKpis.push({ label: "Itens", value: String(rows.length), icon: Layers, color: PALETTE[3] });
  } else if (isSocial) {
    if (reachKey) heroKpis.push({ label: "Alcance", value: fmtN(rows.reduce((s, r) => s + (Number(r[reachKey]) || 0), 0)), icon: Users, color: PALETTE[0] });
    if (engagementKey) heroKpis.push({ label: "Engajamento", value: fmtN(rows.reduce((s, r) => s + (Number(r[engagementKey]) || 0), 0)), icon: Activity, color: PALETTE[1] });
    heroKpis.push({ label: "Posts", value: String(rows.length), icon: Layers, color: PALETTE[2] });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          Dashboard {sourceLabel}
        </h2>
        <span className="text-[10px] px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold uppercase tracking-wider">
          ● Auto-detectado
        </span>
      </div>

      {/* Hero KPI strip — refinado com sub-métrica */}
      {heroKpis.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {heroKpis.map((k, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-4 relative overflow-hidden hover:border-primary/30 transition-colors">
              <div className="absolute top-0 right-0 w-28 h-28 rounded-full opacity-[0.07]" style={{ background: k.color, transform: "translate(30%,-30%)" }} />
              <div className="relative">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5" style={{ background: `${k.color}15`, border: `1px solid ${k.color}30` }}>
                  <k.icon className="w-4 h-4" style={{ color: k.color }} />
                </div>
                <p className="text-2xl font-bold font-mono text-foreground tracking-tight leading-none">{k.value}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5 font-medium">{k.label}</p>
                {k.sub && (
                  <p className="text-[10px] font-mono font-semibold mt-1.5 px-1.5 py-0.5 rounded-md inline-block border" style={{ color: k.color, background: `${k.color}10`, borderColor: `${k.color}30` }}>{k.sub}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Funil de conversão (Ads) — design SVG premium, mesma linguagem do funil inteligente */}
      {funnelStages && funnelStages.length >= 2 && (() => {
        const sorted = [...funnelStages].sort((a, b) => b.value - a.value);
        const top = sorted[0].value;
        const bottom = sorted[sorted.length - 1].value;
        const globalRate = top > 0 ? (bottom / top) * 100 : 0;
        const rowH = 64;
        const totalH = sorted.length * rowH + 12;
        return (
          <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
            <div className="relative flex items-center justify-between flex-wrap gap-2 mb-1">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Funil de Conversão · {sourceLabel}
              </h3>
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold uppercase tracking-wider">
                Taxa global {globalRate.toFixed(2)}%
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-5 relative">
              Como cada impressão evoluiu até a conversão no período analisado.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 relative">
              {/* Trapezoid funnel */}
              <div className="lg:col-span-3">
                <svg viewBox={`0 0 400 ${totalH}`} className="w-full" style={{ height: totalH }} preserveAspectRatio="none">
                  <defs>
                    {sorted.map((s, i) => (
                      <linearGradient key={i} id={`sdfg-${i}`} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={s.fill} stopOpacity={0.95} />
                        <stop offset="100%" stopColor={s.fill} stopOpacity={0.55} />
                      </linearGradient>
                    ))}
                  </defs>
                  {sorted.map((stage, i) => {
                    const pct = top > 0 ? stage.value / top : 0;
                    const maxW = 380;
                    const w = Math.max(64, maxW * (0.25 + 0.75 * pct));
                    const next = sorted[i + 1];
                    const nextPct = next && top > 0 ? next.value / top : pct;
                    const wNext = next ? Math.max(64, maxW * (0.25 + 0.75 * nextPct)) : w * 0.92;
                    const cx = 200;
                    const y = i * rowH + 6;
                    const h = rowH - 10;
                    const points = [
                      [cx - w / 2, y],
                      [cx + w / 2, y],
                      [cx + wNext / 2, y + h],
                      [cx - wNext / 2, y + h],
                    ].map(p => p.join(",")).join(" ");
                    return (
                      <g key={i}>
                        <polygon
                          points={points}
                          fill={`url(#sdfg-${i})`}
                          stroke={stage.fill}
                          strokeWidth={1}
                          style={{ filter: `drop-shadow(0 4px 12px ${stage.fill}33)` }}
                        />
                        <text
                          x={cx}
                          y={y + h / 2 + 5}
                          textAnchor="middle"
                          fontSize={15}
                          fontWeight={700}
                          fill="hsl(var(--background))"
                          style={{ fontFamily: "JetBrains Mono, monospace" }}
                        >
                          {stage.value.toLocaleString("pt-BR")}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Stage list */}
              <div className="lg:col-span-2 space-y-2">
                {sorted.map((stage, i) => {
                  const prev = i > 0 ? sorted[i - 1].value : stage.value;
                  const rate = prev > 0 ? (stage.value / prev) * 100 : 100;
                  const dropOff = i > 0 ? prev - stage.value : 0;
                  return (
                    <div key={i} className="rounded-xl border border-border/60 bg-secondary/20 p-3 hover:border-primary/30 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono shrink-0"
                            style={{ background: `${stage.fill}18`, color: stage.fill, border: `1px solid ${stage.fill}30` }}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="text-[12px] font-semibold text-foreground truncate">{stage.name}</span>
                        </div>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-card border border-border text-foreground">
                          {i > 0 ? rate.toFixed(1) + "%" : "100%"}
                        </span>
                      </div>
                      <div className="flex items-end justify-between gap-2">
                        <p className="text-lg font-mono font-bold text-foreground leading-none">
                          {stage.value.toLocaleString("pt-BR")}
                        </p>
                        {dropOff > 0 && (
                          <span className="text-[9.5px] text-muted-foreground inline-flex items-center gap-0.5">
                            <ArrowDownRight className="w-2.5 h-2.5 text-destructive" />
                            {dropOff.toLocaleString("pt-BR")} saíram
                          </span>
                        )}
                      </div>
                      <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${Math.min((stage.value / top) * 100, 100)}%`, background: `linear-gradient(90deg, ${stage.fill}, ${stage.fill}99)` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top campanhas/itens */}
        {topChart.length > 0 && sortKey && (
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              Top {isSales ? "Produtos" : isSocial ? "Posts" : "Campanhas"}
            </h3>
            <p className="text-[10.5px] text-muted-foreground mb-3">Maiores performers por <span className="font-mono text-foreground/80">{sortKey}</span></p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topChart} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtN(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--foreground))" }} width={130} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmtN(Number(v)), sortKey]} />
                  <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                    {topChart.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Mix donut com legenda lateral */}
        {pieData.length >= 2 && (
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              Distribuição
            </h3>
            <p className="text-[10.5px] text-muted-foreground mb-3">Participação por <span className="font-mono text-foreground/80">{pieKey}</span></p>
            <div className="grid grid-cols-5 gap-3 items-center">
              <div className="col-span-2 h-44 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={42} outerRadius={72} paddingAngle={3} dataKey="value"
                      stroke="hsl(var(--card))" strokeWidth={2}>
                      {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmtN(Number(v)), ""]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-[8px] uppercase tracking-widest text-muted-foreground">Total</p>
                  <p className="text-[15px] font-mono font-bold text-foreground">{fmtN(pieTotal)}</p>
                </div>
              </div>
              <div className="col-span-3 space-y-1.5">
                {pieData.map((d, i) => {
                  const pct = pieTotal > 0 ? (d.value / pieTotal) * 100 : 0;
                  return (
                    <div key={i} className="rounded-lg border border-border/50 bg-secondary/20 px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.fill }} />
                          <span className="text-[10.5px] font-semibold text-foreground truncate">{d.name}</span>
                        </div>
                        <span className="text-[10px] font-mono font-bold text-foreground shrink-0">{pct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: d.fill }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Treemap vendas */}
        {treemapData && treemapData.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              Mapa de Receita por {dimensionKey}
            </h3>
            <p className="text-[10.5px] text-muted-foreground mb-3">Tamanho proporcional à receita gerada</p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <Treemap data={treemapData} dataKey="size" stroke="hsl(var(--card))" fill="hsl(var(--primary))"
                  content={(({ x, y, width, height, name, payload }: any) => (
                    <g>
                      <rect x={x} y={y} width={width} height={height} fill={payload?.fill} stroke="hsl(var(--card))" strokeWidth={2} rx={6} />
                      {width > 60 && height > 30 && (
                        <text x={x + 8} y={y + 18} fill="hsl(var(--background))" fontSize={11} fontWeight={700}>{name}</text>
                      )}
                    </g>
                  )) as any}
                />
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Tabela de breakdown */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Detalhamento por {dimensionKey}</h3>
          <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded">{rows.length} itens</span>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr>
                {Object.keys(rows[0]).map((k) => (
                  <th key={k} className="text-left py-2.5 px-3 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold whitespace-nowrap">{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topRows.concat(rows.slice(8, 50).filter(r => !topRows.includes(r))).map((r, i) => (
                <tr key={i} className="border-b border-border/30 hover:bg-secondary/20">
                  {Object.entries(r).map(([k, v], j) => (
                    <td key={j} className={`py-2 px-3 ${typeof v === "number" ? "text-right font-mono text-foreground" : "text-foreground/80"}`}>
                      {typeof v === "number"
                        ? (k === spendKey || k === revenueKey ? fmtMoney(v) : fmtN(v))
                        : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
