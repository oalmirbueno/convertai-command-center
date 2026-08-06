---
name: editorial-calendar
description: Consultar o calendário editorial por cliente e criar pautas publicáveis sem aprovar, agendar ou publicar.
scopes: [editorial:read, editorial:write]
tools: [aceleriq_list_editorial_calendar, aceleriq_create_editorial_item]
---

# Calendário editorial

## Fonte única

Use `aceleriq_list_editorial_calendar` para arte, post estático, carrossel,
Reels, Stories, vídeo, Short, artigo e Google Post. Tarefas de planejamento,
branding, site, automação, tráfego, SEO, documento e relatório permanecem no
Kanban operacional e não entram nesta lista.

O retorno já elimina duplicidade: quando existe post editorial ativo, ele é o
item canônico e traz `task_id`/`task`; a tarefa ligada não aparece de novo.

## Leitura

Obrigatório:

- `client_id`

Filtros opcionais:

- `project_id`
- `date_from` / `date_to` (`YYYY-MM-DD`)
- `format`: `design`, `static`, `carousel`, `reel`, `story`, `video`,
  `short`, `article` ou `google_post`
- `status` para tarefas ainda sem post
- `production_status` para posts
- `publication_status` para planos/publicações
- `include_unscheduled`
- `limit` / `offset`

Com período, tarefas usam `due_date` e posts usam `scheduled_at`.
`include_unscheduled` é `false` por padrão quando há período e `true` sem
período. Use `include_unscheduled=true` apenas quando o usuário também quiser
o backlog ainda sem data de publicação.

O alias legado `delivery_type` ainda é aceito no lugar de `format`, mas não
envie os dois com valores diferentes.

## Criar pauta

`aceleriq_create_editorial_item` exige:

- `client_id` e `project_id` coerentes
- `title`
- `description` ou `context`
- `format` publicável (`delivery_type` é alias temporário)
- `due_date`
- `idempotency_key` estável, 8–128 caracteres

Ela cria somente a tarefa de produção em `backlog`, com `workstream` derivado
e prefixo de origem `mcp:editorial:`. O sufixo é um fingerprint técnico
imutável usado para impedir duplicatas concorrentes; não contém senha ou token.
Não cria post, não escolhe conta social, não aprova,
não agenda e não publica. Essas etapas continuam no painel e nos gates humanos.

## Isolamento

Admin pode consultar todos os clientes. Manager, design e traffic só acessam
clientes presentes em `team_client_assignments`. Uma chave sem proprietário
não recebe acesso de dados por herdar o `service_role`; ela falha fechada.
