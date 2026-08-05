# ADR-0002: Analytics e atribuição manual-first

- Status: proposto
- Data: 29/07/2026
- Escopo: Bloco 6 — Analytics, Conversões e UTMs

## Contexto

O Aceleriq OS já possui relatórios com métricas importadas, controle financeiro e
artefatos legados de integração com o Ops. Esses três domínios possuem finalidades
distintas:

- `reports` guarda apresentações e snapshots publicados para o cliente;
- Financeiro registra cobranças, recebimentos e despesas da operação Aceleriq;
- Ops foi descontinuado e permanece apenas como histórico técnico.

Nenhum deles oferece um contrato confiável para atribuir uma conversão a uma
campanha. Relatórios podem representar períodos sobrepostos, cobranças não são
receita gerada para o cliente e o Ops não integra mais a arquitetura canônica.

O primeiro lote do Bloco 6 precisa funcionar sem credenciais externas e sem
depender de Meta Ads, Google Ads, CRM, Pixel ou CAPI. A operação inicial será
manual-first: a equipe cadastra campanhas, gera links UTM, define o que conta como
conversão, registra eventos e informa métricas observadas.

## Decisão

### 1. Fonte da verdade

O domínio `analytics_*` é a fonte da verdade do Bloco 6. A V1 usa cinco estruturas:

| Estrutura | Responsabilidade |
|---|---|
| `analytics_campaigns` | Campanha por cliente e projeto, com objetivo, canal, orçamento e moeda |
| `analytics_utm_links` | URL de destino e conjunto imutável de parâmetros UTM |
| `analytics_conversion_definitions` | Contrato do que conta como conversão, etapa do funil e receita |
| `analytics_conversion_events` | Ocorrências append-only e idempotentes de conversão |
| `analytics_metric_entries` | Métricas observadas manualmente para um período e escopo |

Todas as linhas pertencem a um `client_id` e `project_id` válidos. Campanha, link,
definição e evento só podem se relacionar dentro do mesmo cliente e projeto por
meio de chaves estrangeiras compostas.

`external_accounts` continua sendo o catálogo de canais e contas do cliente, mas
não é fonte de métricas ou atribuição nesta V1. Uma integração posterior poderá
usar esse catálogo sem alterar o contrato analítico.

### 2. Campanhas e UTMs

Cada campanha possui um `utm_campaign` normalizado e único dentro do projeto. A
aplicação deve gerar links com:

- `utm_source`: origem, como `meta`, `google`, `instagram` ou `email`;
- `utm_medium`: meio, como `paid_social`, `cpc`, `organic_social` ou `email`;
- `utm_campaign`: identificador estável da campanha;
- `utm_content`: criativo, peça ou variação, quando aplicável;
- `utm_term`: termo ou público, quando aplicável.

Os valores UTM usam apenas letras minúsculas, números, `_` e `-`. Não podem conter
nome, e-mail, telefone ou qualquer outro dado pessoal.

O link deve preservar parâmetros legítimos e o fragmento da URL de destino, mas
substituir UTMs anteriores ao compor a URL final. A combinação semântica de
projeto, campanha, destino e UTMs é única enquanto o link não estiver arquivado.

Os campos de rastreamento de um link são imutáveis após a criação. Uma correção
gera novo link; o anterior é desativado e arquivado. Isso preserva a interpretação
histórica dos eventos já atribuídos.

### 3. Definições de conversão

Uma conversão só existe a partir de uma definição ativa no mesmo cliente e
projeto. A definição registra:

- nome e `event_key`;
- tipo: `lead`, `message`, `appointment`, `purchase`, `signup` ou `custom`;
- se é uma conversão primária;
- se contribui para receita;
- valor padrão e moeda, quando existirem;
- posição no funil por `funnel_order`.

`event_key` é único no projeto. A ordem do funil organiza a leitura, mas não
autoriza somar definições diferentes como se fossem pessoas únicas. Na V1 não há
deduplicação de indivíduos ou CRM: cada evento representa uma ocorrência
declarada.

Ao inserir um evento, nome, chave, tipo, flags e valor padrão da definição são
copiados para o próprio evento. Alterar ou arquivar a definição depois não
reescreve o passado.

### 4. Atribuição explícita

A atribuição da V1 é explícita, não probabilística:

1. um evento com `utm_link_id` pertence obrigatoriamente à campanha do link;
2. um evento com apenas `campaign_id` é atribuído à campanha, sem detalhamento de
   link;
3. um evento sem campanha e sem link é classificado como não atribuído.

Não existe nesta fase janela automática de atribuição, identidade anônima,
first-touch, last-touch, view-through ou distribuição fracionada. Essas regras
dependem de captura automática e serão definidas somente quando Pixel/CAPI,
Analytics ou APIs de mídia entrarem em lote próprio.

Campanhas e links são identificados pelos IDs internos. Renomear uma campanha não
move eventos entre campanhas. Os parâmetros do link permanecem congelados.

### 5. Eventos append-only e idempotência

`analytics_conversion_events` é append-only. Depois de criado, um evento não pode
alterar escopo, definição, atribuição, origem, identificador externo, valor, moeda,
data ou snapshot da definição.

A unicidade `(client_id, source, external_id)` torna a ingestão idempotente. Para
entrada manual, a aplicação gera um `external_id` por envio e bloqueia envios
concorrentes. Integrações futuras devem criar o identificador antes da tentativa e
reutilizá-lo em retries.

Correções seguem o fluxo:

1. arquivar o evento incorreto, registrando ator e data;
2. criar novo evento com outro `external_id`;
3. excluir eventos arquivados de contagens, funil e receita.

Eventos não são apagados. Restauração só desarquiva o mesmo evento quando a
correção for revertida de forma consciente.

### 6. Métricas observadas

`analytics_metric_entries` registra fatos manuais no contrato:

`metric_key + metric_value + period_start + period_end + captured_at`.

O escopo pode ser projeto, campanha ou link. O mesmo fato é protegido por duas
formas de unicidade:

- origem, ID externo e métrica;
- escopo semântico, origem, métrica e período.

Repetir o mesmo fato é rejeitado pela chave semântica, permitindo que a observação
existente seja corrigida sem somar uma segunda linha.

As chaves canônicas da V1 são:

- `ad_spend`: investimento realizado;
- `impressions`: impressões informadas pela plataforma;
- `clicks`: cliques informados pela plataforma;
- `sessions`: sessões observadas no destino.

Conversões e receita real vêm exclusivamente de
`analytics_conversion_events`. Nenhum resultado agregado da plataforma pode ser
somado aos eventos como se representasse a mesma ocorrência.

CTR, CPC, CPM, taxa de conversão, CPA e ROAS são derivados e não devem ser
gravados como fatos.

Entradas do mesmo escopo, origem e métrica com períodos sobrepostos são bloqueadas
no banco, inclusive em inserções concorrentes. A correção preserva a identidade e
altera somente o valor observado.

### 7. Fórmulas canônicas

Para o período e filtros selecionados:

| Métrica | Fórmula |
|---|---|
| Investimento | soma de `ad_spend` sem sobreposição |
| Impressões | soma de `impressions` sem sobreposição |
| Tráfego | `sessions`, quando disponível; caso contrário `clicks`, com rótulo explícito |
| CTR | cliques ÷ impressões × 100 |
| CPC | investimento ÷ cliques |
| CPM | investimento ÷ impressões × 1.000 |
| Conversões | quantidade de eventos ativos das definições filtradas |
| Conversões primárias | quantidade de eventos ativos com `is_primary = true` |
| Taxa de conversão | conversões primárias ÷ tráfego |
| CPA | investimento ÷ conversões primárias |
| Receita atribuída | soma de `value` dos eventos ativos com `counts_as_revenue = true` |
| ROAS | receita atribuída ÷ investimento |
| Cobertura por campanha | conversões primárias com `campaign_id` ÷ todas as conversões primárias |
| Cobertura por UTM | conversões primárias com `utm_link_id` ÷ todas as conversões primárias |

Um denominador ausente ou igual a zero produz `null` e deve aparecer como “Sem
dados”. Não produz zero, infinito ou interpretação automática.

Valores monetários só podem ser agregados dentro da mesma moeda. A V1 não faz
conversão cambial.

### 8. Fronteiras do lote

Não são fontes de atribuição:

- `reports.metrics`, `chart_data` ou breakdowns de relatórios;
- `billing`, `project_payments`, `payment_installments`, `expenses`,
  `ads_wallet` ou recargas;
- tabelas, funções ou webhooks do Ops.

Relatórios podem futuramente consumir um snapshot do domínio analítico, mas um
relatório publicado não altera os fatos nem é reimportado automaticamente.
Financeiro continua medindo a operação Aceleriq. Orçamento de campanha não é
investimento realizado.

Ficam para fases separadas:

- importação e sincronização com Meta Ads, Google Ads ou GA4;
- CRM, identificação de pessoas e deduplicação de leads;
- Pixel, CAPI, webhooks públicos e captura automática;
- first-touch, last-touch, view-through ou modelos multi-touch;
- câmbio e receita financeira conciliada;
- backfill automático de relatórios legados.

## Acesso e segurança

- Todas as tabelas usam RLS.
- Admin pode operar qualquer cliente.
- Manager e Tráfego só escrevem em clientes aos quais estão atribuídos.
- Clientes e equipe autorizada podem ler apenas linhas permitidas por
  `can_access_client`.
- `anon` e `PUBLIC` não recebem acesso.
- `client_id`, `project_id`, autoria e criação são imutáveis.
- Arquivamento substitui exclusão física.
- Credenciais de integrações futuras permanecem no servidor e fora deste schema.

## Rollout

1. Executar a migration e a suíte pgTAP/RLS em banco descartável.
2. Confirmar criação das cinco tabelas, FKs compostas, índices, triggers, grants e
   políticas.
3. Aplicar a migration no mesmo Lovable Cloud/Postgres antes de publicar qualquer
   frontend que consulte `analytics_*`.
4. Não executar backfill e não criar dados sintéticos em produção.
5. Publicar a interface manual-first para admin, manager e tráfego atribuídos.
6. Fazer smoke test com um cliente e projeto de teste operacional: campanha, link,
   definição, evento idempotente e métricas de um período.
7. Confirmar o isolamento com uma sessão de cliente e outra de equipe antes de
   liberar a rota de Analytics de forma ampla.

## Rollback e fix-forward

A migration é aditiva: não altera tabelas existentes e não possui backfill.

- Se o frontend falhar, reverter apenas o frontend. As tabelas podem permanecer
  vazias ou inativas sem afetar rotas existentes.
- Se um cadastro estiver incorreto, arquivar campanha, link ou definição.
- Se um evento estiver incorreto, arquivar e criar substituto; nunca editar ou
  apagar.
- Se uma métrica manual estiver incorreta, corrigir a observação identificada,
  preservando `created_by`, `created_at` e o `external_id`.
- Se uma regra de banco precisar mudar após existir dado, criar migration
  incremental de fix-forward. Não reescrever a migration já aplicada.
- Drop das estruturas só é aceitável antes de qualquer dado real e mediante
  autorização explícita. Após uso real, o rollback físico é evitado para preservar
  o histórico.

## Consequências

- O painel passa a distinguir orçamento, investimento, resultado de plataforma,
  conversão declarada e receita atribuída.
- A equipe consegue operar Analytics sem esperar integrações externas.
- Atribuição sem campanha permanece visível como “Não atribuída”, em vez de ser
  adivinhada.
- Eventos e definições preservam a semântica histórica.
- Dados históricos de relatórios não aparecem automaticamente no Bloco 6.
- A V1 mede ocorrências, não pessoas únicas; essa limitação deve aparecer na
  interface.
- Novas integrações deverão escrever neste contrato idempotente, sem criar uma
  segunda fonte de verdade.

## Referências

- `supabase/migrations/20260729180204_add_growth_analytics_v1.sql`
- `docs/architecture/ACELERIQ-CONTEXTO-CANONICO.md`
- `src/lib/adsParser.ts`
- `src/pages/AdminReportCreate.tsx`
- `src/pages/ReportDetail.tsx`
- `src/components/finance/CashFlow.tsx`
- `supabase/functions/submit-quiz/index.ts`
