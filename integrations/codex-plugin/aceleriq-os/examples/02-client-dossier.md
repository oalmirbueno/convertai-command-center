# Exemplo 02 — Dossiê de cliente

```
User: preciso do resumo atual do cliente "Itamar"

Agent:
1. aceleriq_list_clients { query: "Itamar" }
   → { items: [{ id: "…", full_name: "Itamar …", company: "…" }] }
2. aceleriq_get_client_context { client_id: "…" }
   → profile, projects[], open_tasks[], upcoming_milestones[], briefings[]
```

Saída para o usuário (formato recomendado):

```
Cliente: Itamar (empresa X)
Projetos ativos: 2
- Projeto A · progresso 62% · marco atual: revisão criativa
- Projeto B · progresso 20% · aguardando briefing
Tarefas abertas: 7 (2 em review)
Próximo marco: 2026-07-15 — Entrega criativa v2
Briefings: 1 respondido, 0 pendentes
```
