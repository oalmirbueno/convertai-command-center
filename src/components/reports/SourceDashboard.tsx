// Dashboard premium auto-renderizado por modelo (Google Ads / Meta Ads / Social / Vendas)
// Recebe os dados brutos parseados (rows) salvos em metrics.__breakdown e renderiza
// gráficos extras: top campanhas, mix de plataforma, funil, distribuição.

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, FunnelChart, Funnel, LabelList, Treemap,
} from "recharts";
import {
  Trophy, Layers, TrendingUp, Target, DollarSign, Users, Activity,
  ShoppingCart, Sparkles,
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

function pickKey(rows: any[], candidates: string[]): string | null {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]);
  for (const cand of candidates) {
    const found = keys.find(k => k.toLowerCase().includes(cand));
    if (found) return found;
  }
  return null;
}

const tooltipStyle = {
  background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
  borderRadius: 12, fontSize: 12, color: "hsl(var(--foreground))",
  boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
};

export default function SourceDashboard({ source, sourceLabel, rows, dimensionKey }: Props) {
  if (!rows || rows.length === 0) return null;

  const spendKey = pickKey(rows, ["spend", "cost", "custo", "investimento", "amount"]);
  const clicksKey = pickKey(rows, ["click", "clique"]);
  const impressKey = pickKey(rows, ["impress"]);
  const reachKey = pickKey(rows, ["reach", "alcance"]);
  const convKey = pickKey(rows, ["conver", "result", "lead", "messag"]);
  const revenueKey = pickKey(rows, ["revenue", "receita", "vendas", "sales"]);
  const ordersKey = pickKey(rows, ["order", "pedido", "purchase", "compra"]);
  const engagementKey = pickKey(rows, ["engag"]);

  const isAds = source === "google_ads" || source === "meta_ads";
  const isSales = source === "sales";
  const isSocial = source === "social_media";

  // ── 1. TOP itens por dimensão (campanhas/posts/produtos) ──
  const sortKey = spendKey || revenueKey || clicksKey || engagementKey;
  const topRows = sortKey
    ? [...rows].sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0)).slice(0, 8)
    : rows.slice(0, 8);

  const topChart = topRows.map((r, i) => ({
    name: String(r[dimensionKey] || "—").slice(0, 28),
    value: sortKey ? Number(r[sortKey]) || 0 : 0,
    fill: PALETTE[i % PALETTE.length],
  }));

  // ── 2. Mix de distribuição (pie) ──
  const pieKey = spendKey || revenueKey || convKey || clicksKey;
  const pieRows = pieKey
    ? [...rows].sort((a, b) => (Number(b[pieKey]) || 0) - (Number(a[pieKey]) || 0)).slice(0, 6)
    : [];
  const pieData = pieRows.map((r, i) => ({
    name: String(r[dimensionKey] || "—").slice(0, 24),
    value: pieKey ? Number(r[pieKey]) || 0 : 0,
    fill: PALETTE[i % PALETTE.length],
  })).filter(d => d.value > 0);

  // ── 3. Funil (Ads): Impressões → Cliques → Conversões ──
  const funnelData = (isAds && impressKey && clicksKey)
    ? [
        { name: "Impressões", value: rows.reduce((s, r) => s + (Number(r[impressKey]) || 0), 0), fill: PALETTE[2] },
        { name: "Cliques",    value: rows.reduce((s, r) => s + (Number(r[clicksKey]) || 0), 0), fill: PALETTE[1] },
        ...(convKey ? [{ name: "Conversões", value: rows.reduce((s, r) => s + (Number(r[convKey]) || 0), 0), fill: PALETTE[0] }] : []),
      ].filter(d => d.value > 0)
    : null;

  // ── 4. Treemap (Sales: receita por produto/canal) ──
  const treemapData = (isSales && revenueKey)
    ? rows.slice().sort((a, b) => (Number(b[revenueKey]) || 0) - (Number(a[revenueKey]) || 0))
        .slice(0, 12).map((r, i) => ({
          name: String(r[dimensionKey] || "—").slice(0, 24),
          size: Number(r[revenueKey]) || 0,
          fill: PALETTE[i % PALETTE.length],
        })).filter(d => d.size > 0)
    : null;

  // KPIs derivados
  const totalSpend = spendKey ? rows.reduce((s, r) => s + (Number(r[spendKey]) || 0), 0) : 0;
  const totalRevenue = revenueKey ? rows.reduce((s, r) => s + (Number(r[revenueKey]) || 0), 0) : 0;
  const totalClicks = clicksKey ? rows.reduce((s, r) => s + (Number(r[clicksKey]) || 0), 0) : 0;
  const totalConv = convKey ? rows.reduce((s, r) => s + (Number(r[convKey]) || 0), 0) : 0;
  const totalOrders = ordersKey ? rows.reduce((s, r) => s + (Number(r[ordersKey]) || 0), 0) : 0;

  const heroKpis: Array<{ label: string; value: string; icon: any; color: string }> = [];
  if (isAds) {
    if (totalSpend > 0) heroKpis.push({ label: "Investido", value: fmtMoney(totalSpend), icon: DollarSign, color: PALETTE[0] });
    if (totalClicks > 0) heroKpis.push({ label: "Cliques", value: fmtN(totalClicks), icon: Activity, color: PALETTE[1] });
    if (totalConv > 0) heroKpis.push({ label: "Conversões", value: fmtN(totalConv), icon: Target, color: PALETTE[2] });
    if (totalSpend > 0 && totalConv > 0) heroKpis.push({ label: "CPA Médio", value: fmtMoney(totalSpend / totalConv), icon: TrendingUp, color: PALETTE[3] });
  } else if (isSales) {
    if (totalRevenue > 0) heroKpis.push({ label: "Receita", value: fmtMoney(totalRevenue), icon: DollarSign, color: PALETTE[0] });
    if (totalOrders > 0) heroKpis.push({ label: "Pedidos", value: fmtN(totalOrders), icon: ShoppingCart, color: PALETTE[1] });
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
          ⚡ Auto-detectado
        </span>
      </div>

      {/* Hero KPI strip */}
      {heroKpis.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {heroKpis.map((k, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-[0.05]" style={{ background: k.color, transform: "translate(30%,-30%)" }} />
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5" style={{ background: `${k.color}15`, border: `1px solid ${k.color}25` }}>
                <k.icon className="w-4 h-4" style={{ color: k.color }} />
              </div>
              <p className="text-2xl font-bold font-mono text-foreground tracking-tight">{k.value}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top campanhas/itens */}
        {topChart.length > 0 && sortKey && (
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              Top {isSales ? "Produtos" : isSocial ? "Posts" : "Campanhas"} por {sortKey}
            </h3>
            <p className="text-[10px] text-muted-foreground mb-3">Maiores performers do período</p>
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

        {/* Mix pie */}
        {pieData.length >= 2 && (
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              Distribuição por {pieKey}
            </h3>
            <p className="text-[10px] text-muted-foreground mb-3">Participação relativa de cada item</p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={95} paddingAngle={3} dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmtN(Number(v)), ""]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Funil de conversão (Ads) */}
        {funnelData && funnelData.length >= 2 && (
          <div className="bg-card border border-border rounded-2xl p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Funil de Conversão
            </h3>
            <p className="text-[10px] text-muted-foreground mb-3">
              Impressões → Cliques{funnelData.length > 2 ? " → Conversões" : ""} · Taxa global: {((funnelData[funnelData.length - 1].value / funnelData[0].value) * 100).toFixed(2)}%
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmtN(Number(v)), ""]} />
                  <Funnel dataKey="value" data={funnelData} isAnimationActive>
                    <LabelList position="right" fill="hsl(var(--foreground))" stroke="none" dataKey="name" fontSize={12} />
                    <LabelList position="center" fill="#fff" stroke="none" dataKey="value" formatter={(v: any) => fmtN(Number(v))} fontSize={13} />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
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
            <p className="text-[10px] text-muted-foreground mb-3">Tamanho proporcional à receita gerada</p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <Treemap data={treemapData} dataKey="size" stroke="hsl(var(--card))" fill="hsl(var(--primary))"
                  content={(({ x, y, width, height, name, payload }: any) => (
                    <g>
                      <rect x={x} y={y} width={width} height={height} fill={payload?.fill} stroke="hsl(var(--card))" strokeWidth={2} rx={6} />
                      {width > 60 && height > 30 && (
                        <text x={x + 8} y={y + 18} fill="#000" fontSize={11} fontWeight={600}>{name}</text>
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
