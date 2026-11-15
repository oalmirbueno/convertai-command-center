/**
 * Design system do painel (redesenho de 14/11/2026). Fonte única da aparência:
 * tokens em src/index.css e tailwind.config.ts; classes e primitivos em
 * src/components/sistema; aqui, os componentes de tela com nome curto.
 *
 *   import { Card, StatCard, PageHeader, Toolbar, PillTabs, Chip, Collapsible } from "@/components/ds";
 *
 * Regras (docs/design/SISTEMA.md, seção 0):
 * - Menos texto: título curto e, no máximo, uma linha de estado. Explicação longa vai no HelpTooltip ("?").
 * - Uma ação principal por cartão; o resto no OverflowMenu ("…").
 * - Toda página começa com PageHeader e, se tiver busca/filtro/visão, uma Toolbar.
 * - Cartão: canto de 20 px. Controle: 12 px. Botão, etiqueta e aba: pílula.
 * - Um destaque só (o verde da marca). Estado usa os tons suaves (Chip tone).
 */
export { default as Card, CardSurface } from "./Card";
export { default as StatCard, StatGrid, Sparkline, type StatCardProps } from "./StatCard";
export { default as PageHeader } from "./PageHeader";
export { default as Toolbar, SearchField } from "./Toolbar";
export { default as PillTabs, type PillTab } from "./PillTabs";
export { default as Chip, DeltaChip, StatusDot, type Tone } from "./Chip";
export { default as EmptyState } from "./EmptyState";
export { default as Collapsible } from "./Collapsible";
export { default as HelpTooltip } from "./HelpTooltip";
export { default as OverflowMenu, type OverflowItem } from "./OverflowMenu";
export { default as DataTable, type DataColumn } from "./DataTable";
