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
 *
 * v4 (15/11/2026, o que faltava das referências):
 * - StatCard: `progress` (anel no ícone), `unit` (unidade em pílula), `footer` (faixa "Ver detalhes"),
 *   `size="hero"` (número herói leve) e centavos apagados sozinhos em valor "R$ 1.234,56".
 * - StatTrio: números-resumo sem cartão para o cabeçalho de telas de trabalho.
 * - IconButton (ícone em círculo com fundo), ArrowUpRight (a seta "abrir") e FloatingToolbar.
 * - AvatarStack (pilha de avatares com "+N"), StatusPill `plain` (bolinha + texto, para tabela).
 * - Gráficos: RingIcon, SegmentBar (barra segmentada com % e hachura), Stepper (etapas) e Heatmap.
 * - Card `icon` (ícone em círculo no cabeçalho), PageHeader `eyebrow` e `stats`, EmptyState hachurado.
 * - CSS: .ds-hatch / .ds-hatch-forte (hachura), .gap-bento / .gap-section (dois ritmos de espaço).
 *
 * B3 (rolagem): de 768 px para cima o topo fica parado e só o <main> rola. ScrollPanel é o painel com
 * rolagem própria (altura da janela menos o topo e `offset`, só de 1024 px para cima; no celular a página
 * rola). CSS: .rolagem-fina (barra fina + overscroll contido), .painel-rolavel / .painel-rolavel-max
 * com --painel-desconto, e --altura-do-topo.
 */
export { default as Card, CardSurface } from "./Card";
export { default as StatCard, StatGrid, StatTrio, type StatCardProps } from "./StatCard";
export { Sparkline, MiniBars, ProgressBar, Donut, ChartLegend, RingIcon, SegmentBar, Stepper, Heatmap, chartColor, type ChartTone, type DonutSegment, type BarSegment } from "./charts";
export { default as ListRow, List, Avatar, AvatarStack, initialsOf, type ListRowProps } from "./ListRow";
export { default as IconButton, ArrowUpRight, FloatingToolbar } from "./IconButton";
export { default as PageHeader } from "./PageHeader";
export { default as Toolbar, SearchField } from "./Toolbar";
export { default as PillTabs, type PillTab } from "./PillTabs";
export { default as Chip, DeltaChip, StatusDot, StatusPill, type Tone } from "./Chip";
export { default as EmptyState } from "./EmptyState";
export { default as Collapsible } from "./Collapsible";
export { default as HelpTooltip } from "./HelpTooltip";
export { default as OverflowMenu, type OverflowItem } from "./OverflowMenu";
export { default as DataTable, CellIdentity, type DataColumn } from "./DataTable";
export { default as ScrollPanel } from "./ScrollPanel";
