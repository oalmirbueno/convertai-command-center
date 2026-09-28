// Dashboard premium auto-renderizado por modelo (Google Ads / Meta Ads / Social / Vendas)
// Recebe os dados brutos parseados (rows) salvos em metrics.__breakdown e renderiza
// gráficos extras: top campanhas, mix de plataforma, funil, distribuição.

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Treemap,
} from "recharts";
import { useState } from "react";
import {
  Layers, TrendingUp, Target, DollarSign, Users, Activity,
  ShoppingCart, ArrowDownRight,
} from "lucide-react";
import { Painel, Secao, botao, etiqueta, juntar, texto } from "@/components/sistema";
import { CelulaDeNumero, FaixaDeNumeros } from "@/components/sistema";

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
  borderRadius: 8, fontSize: 12, color: "hsl(var(--foreground))",
};


export default function SourceDashboard({ source, sourceLabel, rows, dimensionKey }: Props) {
  // A tabela mostra 10 linhas; o resto abre ao pedir.
  const [verTudo, setVerTudo] = useState(false);
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
    if (totalConv > 0)   heroKpis.push({ label: convType.noun, value: fmtN(totalConv), sub: totalSpend > 0 ? `Custo ${fmtMoney(totalSpend/totalConv)} / ${convType.short}` : convType.explainer.split("(")[0].trim().slice(0, 32), icon: TrendingUp, color: PALETTE[3] });
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

  const graficosLado = (topChart.length > 0 && sortKey ? 1 : 0) + (pieData.length >= 2 ? 1 : 0);
  const linhasDaTabela = topRows.concat(rows.slice(8, 50).filter(r => !topRows.includes(r)));
  const colunasDaTabela = Object.keys(rows[0]);
  const LIMITE = 10;
  const nomeDosItens = isSales ? "itens" : isSocial ? "posts" : "linhas";

  return (
    <Secao
      titulo={sourceLabel}
      descricao={`Detectado automaticamente · ${rows.length} ${nomeDosItens}`}
      ajuda="Gráficos montados a partir da planilha importada: principais itens, distribuição, funil e o detalhamento linha a linha."
      divisoria
      corpoClassName="space-y-4"
    >
      {/* Números da planilha numa faixa só */}
      {heroKpis.length > 0 && (
        <Painel semEspaco>
          <FaixaDeNumeros semMoldura grade="grid-cols-2 lg:grid-cols-4">
            {heroKpis.map((k, i) => (
              <CelulaDeNumero key={i} rotulo={k.label} valor={k.value} apoio={k.sub ? <span className="block truncate">{k.sub}</span> : undefined} />
            ))}
          </FaixaDeNumeros>
        </Painel>
      )}

      {/* Funil de conversão (Ads) */}
      {funnelStages && funnelStages.length >= 2 && (() => {
        const sorted = [...funnelStages].sort((a, b) => b.value - a.value);
        const top = sorted[0].value;
        const bottom = sorted[sorted.length - 1].value;
        const globalRate = top > 0 ? (bottom / top) * 100 : 0;
        const rowH = 64;
        const totalH = sorted.length * rowH + 12;
        return (
          <Painel
            className="page-break-inside-avoid"
            titulo={<>Funil de {convType.noun}</>}
            ajuda={
              <>
                Como cada impressão evoluiu até virar {convType.noun.toLowerCase()} no período.
                {convKey ? ` Conversão = ${convType.noun}: ${convType.explainer}.` : ""}
              </>
            }
            descricao={`${sourceLabel} · ${convType.short} por impressão: ${globalRate.toFixed(2)}%`}
          >
            <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-5">
              {/* Funil em trapézios */}
              <div className="min-w-0 lg:col-span-3">
                <svg viewBox={`0 0 400 ${totalH}`} className="w-full" style={{ height: totalH }} preserveAspectRatio="none" role="img" aria-label={`Funil de ${convType.noun}`}>
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
                        <polygon points={points} fill={stage.fill} fillOpacity={0.85} />
                        <text
                          x={cx}
                          y={y + h / 2 + 5}
                          textAnchor="middle"
                          fontSize={15}
                          fontWeight={600}
                          fill="hsl(var(--background))"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {stage.value.toLocaleString("pt-BR")}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Etapas */}
              <ol className="min-w-0 divide-y divide-border lg:col-span-2">
                {sorted.map((stage, i) => {
                  const prev = i > 0 ? sorted[i - 1].value : stage.value;
                  const rate = prev > 0 ? (stage.value / prev) * 100 : 100;
                  const dropOff = i > 0 ? prev - stage.value : 0;
                  return (
                    <li key={i} className="min-w-0 py-2.5 first:pt-0 last:pb-0">
                      <div className="flex min-w-0 items-center">
                        <span className="mr-2 w-4 shrink-0 text-[12px] tabular-nums text-muted-foreground">{i + 1}</span>
                        <span className="mr-2 h-2 w-2 shrink-0 rounded-full" style={{ background: stage.fill }} aria-hidden="true" />
                        <span className="mr-3 min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{stage.name}</span>
                        <span className={juntar(etiqueta, "bg-muted text-foreground")}>{i > 0 ? rate.toFixed(1) + "%" : "100%"}</span>
                      </div>
                      <div className="ml-8 mt-1 flex min-w-0 items-baseline justify-between">
                        <span className="text-[15px] font-semibold leading-5 tabular-nums text-foreground">{stage.value.toLocaleString("pt-BR")}</span>
                        {dropOff > 0 && (
                          <span className={juntar(texto.auxiliar, "ml-2 inline-flex items-center tabular-nums")}>
                            <ArrowDownRight className="mr-0.5 h-3 w-3 text-destructive" aria-hidden="true" />
                            {dropOff.toLocaleString("pt-BR")} saíram
                          </span>
                        )}
                      </div>
                      <div className="ml-8 mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${Math.min((stage.value / top) * 100, 100)}%`, background: stage.fill }} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Painel>
        );
      })()}

      {(graficosLado > 0 || (treemapData && treemapData.length > 0)) && (
        <div className={juntar("grid min-w-0 grid-cols-1 gap-4", graficosLado === 2 && "lg:grid-cols-2")}>
          {/* Principais campanhas/itens */}
          {topChart.length > 0 && sortKey && (
            <Painel titulo={`Principais ${isSales ? "produtos" : isSocial ? "posts" : "campanhas"}`} descricao={<span className="block truncate">Por {sortKey}</span>}>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topChart} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtN(v)} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} width={130} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmtN(Number(v)), sortKey]} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                      {topChart.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Painel>
          )}

          {/* Distribuição com legenda ao lado */}
          {pieData.length >= 2 && (
            <Painel titulo="Distribuição" descricao={<span className="block truncate">Participação por {pieKey}</span>}>
              <div className="grid min-w-0 grid-cols-1 items-center gap-3 sm:grid-cols-5">
                <div className="relative h-44 sm:col-span-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={42} outerRadius={72} paddingAngle={2} dataKey="value"
                        stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={false}>
                        {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmtN(Number(v)), ""]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <p className={texto.auxiliar}>Total</p>
                    <p className="text-[15px] font-semibold tabular-nums text-foreground">{fmtN(pieTotal)}</p>
                  </div>
                </div>
                <ul className="min-w-0 divide-y divide-border sm:col-span-3">
                  {pieData.map((d, i) => {
                    const pct = pieTotal > 0 ? (d.value / pieTotal) * 100 : 0;
                    return (
                      <li key={i} className="min-w-0 py-2 first:pt-0 last:pb-0">
                        <div className="flex min-w-0 items-center">
                          <span className="mr-2 h-2 w-2 shrink-0 rounded-full" style={{ background: d.fill }} aria-hidden="true" />
                          <span className="mr-2 min-w-0 flex-1 truncate text-[12px] text-foreground">{d.name}</span>
                          <span className="shrink-0 text-[12px] font-medium tabular-nums text-foreground">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="ml-4 mt-1 h-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: d.fill }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Painel>
          )}

          {/* Mapa de receita (vendas) */}
          {treemapData && treemapData.length > 0 && (
            <Painel
              className={graficosLado === 2 ? "lg:col-span-2" : ""}
              titulo={<>Receita por {dimensionKey}</>}
                ajuda="Tamanho proporcional à receita gerada."
            >
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap data={treemapData} dataKey="size" stroke="hsl(var(--card))" fill="hsl(var(--primary))" isAnimationActive={false}
                    content={(({ x, y, width, height, name, payload }: any) => (
                      <g>
                        <rect x={x} y={y} width={width} height={height} fill={payload?.fill} stroke="hsl(var(--card))" strokeWidth={2} rx={4} />
                        {width > 60 && height > 30 && (
                          <text x={x + 8} y={y + 18} fill="hsl(var(--background))" fontSize={11} fontWeight={600}>{name}</text>
                        )}
                      </g>
                    )) as any}
                  />
                </ResponsiveContainer>
              </div>
            </Painel>
          )}
        </div>
      )}

      {/* Detalhamento linha a linha: 10 na tela, o resto ao pedir (e todas na impressão) */}
      <Painel semEspaco titulo={`Detalhamento por ${dimensionKey}`} descricao={`${rows.length} ${nomeDosItens}`}>
        {/* Celular: cada linha vira um item (nome em cima, valores embaixo) */}
        <ul className="divide-y divide-border md:hidden print:hidden">
          {linhasDaTabela.map((r, i) => {
            const nome = String(r[dimensionKey] ?? Object.values(r).find((v) => typeof v === "string") ?? "·");
            const valores = Object.entries(r).filter(([k]) => k !== dimensionKey);
            return (
              <li key={i} className={juntar("min-w-0 px-4 py-2.5", !verTudo && i >= LIMITE && "hidden")}>
                <p className="truncate text-[13px] font-medium text-foreground">{nome}</p>
                <p className={juntar(texto.auxiliar, "mt-0.5 leading-5 tabular-nums")}>
                  {valores.map(([k, v]) => `${k}: ${typeof v === "number" ? (k === spendKey || k === revenueKey ? fmtMoney(v) : fmtN(v)) : String(v)}`).join(" · ")}
                </p>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto md:block print:block">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                {colunasDaTabela.map((k) => (
                  <th key={k} scope="col" className={juntar(texto.rotulo, "whitespace-nowrap px-3 py-2.5 first:pl-4 last:pr-4", typeof rows[0][k] === "number" ? "text-right" : "text-left")}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {linhasDaTabela.map((r, i) => (
                <tr key={i} className={!verTudo && i >= LIMITE ? "hidden print:table-row" : undefined}>
                  {Object.entries(r).map(([k, v], j) => (
                    <td key={j} className={juntar("px-3 py-2 first:pl-4 last:pr-4", typeof v === "number" ? "whitespace-nowrap text-right tabular-nums text-foreground" : "text-foreground/80")}>
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
        {linhasDaTabela.length > LIMITE && (
          <div className="no-print border-t border-border px-4 py-2">
            <button type="button" onClick={() => setVerTudo((v) => !v)} className={juntar(botao.discreto, "-ml-2.5 h-8")} aria-expanded={verTudo}>
              {verTudo ? "Mostrar menos" : `Mostrar as ${linhasDaTabela.length} linhas`}
            </button>
          </div>
        )}
      </Painel>
    </Secao>
  );
}
