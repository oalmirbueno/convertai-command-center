/**
 * Gerado por scripts/uiux/importar-base.mjs a partir de UI UX Pro Max 2.15.0 (MIT, Next Level Builder, github.com/nextlevelbuilder/ui-ux-pro-max-skill). Não edite à mão.
 * Fonte: workers/motor-codigo/vendor/ui-ux-pro-max/data/charts.csv (SHA-256 4115cf1120680f2cedef0676cb648f30c7ef4699e2a947535d4113e71ed3b12a), 25 linhas.
 */

/** Chave nossa -> coluna de charts.csv (o teste de igualdade usa o mesmo mapa). */
export const COLUNAS = {"no":"No","tipoDeDado":"Data Type","melhor":"Best Chart Type","alternativaA11y":"A11y Fallback"} as const;

export type GraficoDaBase = { no: string; tipoDeDado: string; melhor: string; alternativaA11y: string };

const LINHAS: string[][] = [
  ["1","Trend Over Time","Line Chart","Visible data table plus concise trend summary. Keyboard: focus reveals hover values; +/- buttons zoom; Reset restores the full range."],
  ["2","Compare Categories","Bar Chart (Horizontal or Vertical)","Visible sortable data table plus concise comparison summary. Keyboard: focus reveals hover values; focusable headers with Enter/Space sort and aria-sort reports direction."],
  ["3","Part-to-Whole","Pie Chart or Donut","Percentage data table and concise part-to-whole summary; offer a stacked bar view. Keyboard: focus reveals slice values; Enter/Space drills in; Back button returns."],
  ["4","Correlation / Distribution","Scatter Plot or Bubble Chart","Visible data table plus correlation summary. Keyboard: focus reveals point values; labeled start/end range inputs replace brush dragging."],
  ["5","Heatmap / Intensity","Heat Map or Choropleth","Grid data table plus intensity summary. Keyboard: focus reveals cell values; +/- buttons zoom; Reset restores the grid."],
  ["6","Geographic Data","Choropleth Map or Bubble Map","Sortable region table plus geographic summary. Keyboard: arrow keys or labeled pan buttons move the map; +/- buttons zoom; Enter drills into a focused region; Back returns."],
  ["7","Funnel / Flow","Funnel Chart or Sankey","Linear stage table/list plus conversion summary. Keyboard: focus reveals stage values; Enter/Space drills in; Back returns."],
  ["8","Performance vs Target","Gauge Chart or Bullet Chart","Visible KPI/target text and a one-row data table plus status summary. Keyboard: focus reveals the same detail as hover."],
  ["9","Time-Series Forecast","Line with Confidence Band","Visible forecast table plus uncertainty summary. Keyboard: focus reveals hover values; buttons toggle actual/forecast; +/- buttons zoom; Reset restores range."],
  ["10","Anomaly Detection","Line Chart with Highlights","Anomaly event list/table plus narrative alert summary. Keyboard: focus reveals point details; alerts are available in the persistent list without hover."],
  ["11","Hierarchical / Nested Data","Treemap","Collapsible tree table plus hierarchy summary; treemap remains supplementary. Keyboard: focus reveals hover values; Enter/Space drills or expands; Back collapses/returns."],
  ["12","Flow / Process Data","Sankey Diagram","Source-to-target flow table plus flow summary. Keyboard: focus reveals hover values; Enter/Space drills into a node; Back returns."],
  ["13","Cumulative Changes","Waterfall Chart","Running-total table plus variance summary. Keyboard: focus reveals the same value as hover."],
  ["14","Multi-Variable Comparison","Radar / Spider Chart","Raw data table and grouped-bar alternative plus comparison summary. Keyboard: focus reveals values; buttons toggle series."],
  ["15","Stock / Trading OHLC","Candlestick Chart","Sortable OHLC table plus daily-change summary. Keyboard: focus reveals candle values; +/- buttons zoom; Reset restores range; live updates do not steal focus."],
  ["16","Relationship / Connection Data","Network Graph","Adjacency list/table and relationship summary; tree view when applicable. Keyboard: focus reveals node details; Enter drills; Move up/down/left/right buttons replace drag."],
  ["17","Distribution / Statistical","Box Plot","Statistics table plus distribution summary. Keyboard: focus reveals the same statistics as hover."],
  ["18","Performance vs Target (Compact)","Bullet Chart","Visible KPI/target table plus status summary. Keyboard: focus reveals the same detail as hover."],
  ["19","Proportional / Percentage","Waffle Chart","Percentage table/list plus part-to-whole summary. Keyboard: focus reveals each cell value."],
  ["20","Hierarchical Proportional","Sunburst Chart","Collapsible indented list/table plus hierarchy summary and breadcrumbs. Keyboard: Enter/Space drills or expands; Back button returns; focus reveals hover detail."],
  ["21","Root Cause Analysis","Decomposition Tree","Expandable tree table plus root-cause summary. Keyboard: Enter/Space drills and expands; Back collapses; dedicated expand/collapse buttons expose the same operations."],
  ["22","3D Spatial Data","3D Scatter / Surface Plot","Mandatory 2D projection, data table, and spatial summary. Keyboard: rotate/pan buttons and +/- zoom controls replace pointer/VR manipulation; Reset returns the camera."],
  ["23","Real-Time Streaming","Streaming Area Chart","Streaming data table plus current-value/trend summary. Keyboard: Pause/Resume button controls updates; focus reveals values; +/- buttons zoom; Reset restores range."],
  ["24","Sentiment / Emotion","Word Cloud with Sentiment","Sortable term table/list plus sentiment summary; word cloud is supplementary. Keyboard: focus reveals word details; labeled controls filter with Space/Enter."],
  ["25","Process Mining","Process Map / Graph","Path summary table plus bottleneck narrative. Keyboard: Move buttons replace drag; focus reveals node details; Enter activates a node; Back returns."],
];

export const GRAFICOS_DA_BASE: GraficoDaBase[] = LINHAS.map((l) => ({ no: l[0], tipoDeDado: l[1], melhor: l[2], alternativaA11y: l[3] }));
