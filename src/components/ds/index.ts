/**
 * Design system do painel (redesenho de 14/11/2026; rodada ousada de 15/11/2026). Fonte única da aparência:
 * tokens em src/index.css e tailwind.config.ts; classes e primitivos em
 * src/components/sistema; aqui, os componentes de tela com nome curto.
 *
 *   import { Card, StatCard, PageHeader, Toolbar, PillTabs, Chip, Collapsible } from "@/components/ds";
 *
 * Regras (docs/design/SISTEMA.md, seção 0):
 * - Menos texto: título curto e, no máximo, uma linha de estado. Explicação longa vai no HelpTooltip ("?").
 * - Uma ação principal por cartão; o resto no OverflowMenu ("…").
 * - Toda página começa com PageHeader e, se tiver busca/filtro/visão, uma Toolbar.
 * - Cartão: canto de 24 px e 24 px de respiro. Controle: 12 px. Botão, etiqueta e aba: pílula.
 * - Número grande (StatCard), rótulo pequeno e apagado, variação em pílula com seta.
 * - Por fileira, no máximo UM cartão sólido na cor da marca (`variant="accent"`) e UM de tinta (`variant="ink"`).
 * - Gráfico pequeno (ds/charts) só com dado que a tela já tem; sem dado, sem gráfico.
 * - Lista e tabela: avatar ou ícone, nome + linha apagada, StatusPill, valor à direita, ações no "…".
 */
export { default as Card, CardSurface } from "./Card";
export { default as StatCard, StatGrid, type StatCardProps } from "./StatCard";
export { Sparkline, MiniBars, ProgressBar, Donut, ChartLegend, chartColor, type ChartTone, type DonutSegment } from "./charts";
export { default as ListRow, List, Avatar, initialsOf, type ListRowProps } from "./ListRow";
export { default as PageHeader } from "./PageHeader";
export { default as Toolbar, SearchField } from "./Toolbar";
export { default as PillTabs, type PillTab } from "./PillTabs";
export { default as Chip, DeltaChip, StatusDot, StatusPill, type Tone } from "./Chip";
export { default as EmptyState } from "./EmptyState";
export { default as Collapsible } from "./Collapsible";
export { default as HelpTooltip } from "./HelpTooltip";
export { default as OverflowMenu, type OverflowItem } from "./OverflowMenu";
export { default as DataTable, CellIdentity, type DataColumn } from "./DataTable";
