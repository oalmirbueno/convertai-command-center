# Comparação de Relatórios — v2

Três correções na seção *Comparação com Relatório Anterior* do `ReportDetail`.

## 1. Botão "Comparar com anterior" no topo

A comparação deixa de aparecer automaticamente. No header do relatório (perto de Imprimir / WhatsApp) entra um toggle:

- Estado off (padrão): seção escondida, só mostra um chip discreto "Relatório anterior disponível · {data}"
- Estado on: expande a seção completa de comparação
- Quando não existe relatório anterior: botão fica desabilitado com tooltip "Primeiro relatório deste projeto"

Persiste preferência em `localStorage` por relatório (`report-compare-{id}`).

## 2. Leitura robusta dos dados do relatório anterior

Hoje a comparação lê só `metrics.ad_spend / impressions / clicks` direto. Quando o relatório antigo guardou os dados via `__breakdown` (linhas brutas da planilha) sem mapear pro schema, os totais aparecem zerados — foi o que aconteceu com o anterior do SERB que tinha custo real.

A nova função `extractTotals(report)` tenta na ordem:

1. `metrics.ad_spend / impressions / link_clicks / clicks / results / messages / leads / revenue` (caminho atual)
2. Se vazio, soma a partir de `metrics.__breakdown` detectando as colunas por nome (mesma heurística do `SourceDashboard.pickKey`: "valor usado", "amount spent", "impressões", "cliques no link" etc.)
3. Aplica o mesmo *auto-heal* de taxas que já existe (CTR/CPC/CPM/ROAS derivados dos totais)

Resultado: comparação funciona mesmo em relatórios antigos importados antes do parser novo.

## 3. Análise contextual (não só seta pra cima/baixo)

Cada métrica recebe uma *interpretação* que considera o contexto, não apenas o sinal do delta. Substitui o atual "subiu/desceu = bom/ruim".

Regras principais:

- **Investimento caiu** → não é regressão. Mostra "Investimento -30% (R$X → R$Y) · menos verba alocada no período"
- **Resultados caíram proporcionalmente ao investimento** → neutro. "Volume acompanhou a redução de verba · eficiência mantida"
- **Resultados caíram MAIS que o investimento** → atenção real. "Queda de eficiência: -40% em resultados com -10% em verba"
- **Resultados caíram MENOS que o investimento** → ganho. "Mais eficiente: -10% em resultados com -30% em verba"
- **CPC/CPM subiu mas CTR também subiu** → contexto positivo. "Custo subiu, mas público mais qualificado (CTR +X%)"
- **ROAS caiu com receita estável** → investigar. "Receita igual mas com mais investimento"
- **Período diferente** (ex: 7 dias vs 30 dias) → normaliza para diária e mostra aviso "Períodos de tamanhos diferentes — comparação ajustada para média diária"

Cada métrica vira um card com:
- Valor atual e anterior (sem cores alarmantes)
- Δ absoluto e %
- Tag de contexto: `Esperado` / `Ganho` / `Atenção` / `Crítico` (não apenas "bom/ruim")
- Uma frase explicando *por que* aquele delta significa o que significa, considerando as outras métricas

Os cards de "O que melhorou / Pontos de atenção" são reescritos pra usar essa classificação contextual em vez do `LOWER_IS_BETTER` cego.

## Detalhes técnicos

- `ReportComparison.tsx`: extrai `extractTotals()` no topo, refatora `rows` pra incluir `{ context, severity, narrative }` em vez de `{ good, trend }`
- Período normalizado: calcula `days = (period_end - period_start)` para current e previous; quando diferem >20%, divide volumétricos por dias e marca `normalized: true`
- `ReportDetail.tsx`: adiciona estado `showComparison`, lê do localStorage, renderiza botão toggle perto do print/WhatsApp e condiciona o `<ReportComparison />`
- Query do previous report continua igual; só passa pra exibir quando toggle ligado (mantém prefetch pra mostrar a data no chip)

## Não muda

- Auditoria de Métricas (`MetricsAudit`) continua igual, sempre visível
- Auto-heal de taxas no `analysis` useMemo continua igual
- Parser de importação (`adsParser.ts`) não é alterado
