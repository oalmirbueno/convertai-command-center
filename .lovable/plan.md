# Plano: Sistema operacional inteligente (Onboarding + Checklists + Voice conversacional)

Entrega em 3 frentes integradas, todas visíveis apenas para admin/equipe (clientes não veem).

---

## 1. Esteira de Onboarding por cliente

**Objetivo:** cada cliente novo entra numa esteira estruturada com etapas e checklists por tipo de serviço. Modo **híbrido sugestivo**: alerta no topo, mas não trava.

### Schema (migration)

- `service_checklists` — catálogo de templates por tipo de serviço:
  - `service_type` (meta_ads, google_ads, social_media, video, site, automation, geral)
  - `phase` (contrato, briefing, acessos, kickoff, producao)
  - `title`, `description`, `order_index`, `is_required`
  - itens em `service_checklist_items` (label, hint, order)
- `client_onboarding` — instância por cliente:
  - `client_id`, `service_types[]` (array de serviços ativos), `started_at`, `completed_at`
- `client_onboarding_items` — item check do cliente:
  - `client_id`, `template_item_id`, `is_done`, `value` (texto opcional p/ ex. "link da BM"), `completed_by`, `completed_at`

RLS: leitura/escrita apenas para `is_staff()`. GRANTS para authenticated e service_role.

### Seed inicial (templates)

Etapa **Contrato** (geral): enviar minuta → assinatura → arquivar.
Etapa **Briefing** (geral): enviar link → cliente responder → revisar.
Etapa **Acessos** (por serviço):
- Meta Ads: acesso BM, conta de anúncios, pixel instalado, cartão validado, públicos base
- Google Ads: acesso MCC, conversões configuradas, faturamento, GTM
- Social Media: acesso IG/FB/TikTok, identidade visual, linha editorial aprovada
- Vídeo: briefing audiovisual, roteiro, locação, equipamentos
- Site: domínio, hospedagem, conteúdo base, integrações
- Automação: ferramentas (n8n/CRM), fluxos mapeados, credenciais APIs

Etapa **Kickoff**: reunião agendada, grupo WhatsApp criado, cronograma compartilhado.

### UI

- Novo componente `ClientOnboardingPanel` dentro do `EditClientDrawer` (aba "Esteira").
- Mostra timeline vertical: Contrato → Briefing → Acessos → Kickoff, com % por fase.
- Banner sugestivo no topo do drawer/dashboard do cliente quando `< 100%`: "Onboarding incompleto: 3 itens pendentes".
- Ação rápida: checkbox inline + campo "valor" (link/observação).

---

## 2. Biblioteca de checklists prontos para tarefas

**Objetivo:** dentro de qualquer tarefa, equipe seleciona um template pronto e popula os checklist items de uma vez.

### Schema

- `task_checklist_templates`:
  - `category` (campanha_meta, campanha_google, reel, post_carrossel, video_curto, landing_page, automacao_n8n, etc.)
  - `title`, `description`
  - `items[]` em `task_checklist_template_items` (label, order, is_required)

Seed: ~10 templates cobrindo casos comuns dos serviços listados.

### UI

- No `TaskDetailDrawer`, botão "📋 Aplicar checklist pronto" → popover com lista filtrada por categoria → cria itens em `task_checklist_items` existente.

---

## 3. Voice Assistant conversacional

**Objetivo:** transformar o assistente atual em fluxo guiado com perguntas em sequência, sugestões inteligentes e escopo completo.

### Mudanças em `VoiceAssistant.tsx` + `voiceCommands.ts`

Novo state machine no drawer:
1. **Captura** — usuário fala/digita intenção inicial.
2. **Parse + Gaps** — `parseCommand` retorna intent + lista de campos faltantes (cliente, prazo, nome, tipo).
3. **Perguntas em sequência** — para cada gap, mostra card com pergunta + sugestão pré-preenchida:
   - "Qual cliente?" → autocomplete
   - "Sugestão de nome: *Campanha Meta Ads — Black Friday*. Aceita?" (gerado por heurística: tipo + cliente + contexto sazonal/data)
   - "Prazo: 30 dias (até 03/jul). Confirma?"
   - "Quer aplicar template de tarefas para esse tipo de projeto?" (Sim/Não)
4. **Preview completo** — mostra escopo final: nome, datas início/fim, descrição gerada, milestones com tasks, cada task com checklist pré-populado dos templates de Item 2.
5. **Executar** — cria tudo em transação (projeto + milestones + tasks + checklist items).

### Heurísticas profissionais (sem custo de IA)

- **Nome do projeto**: `{tipo} — {cliente} — {mês/ano}` ou `{Objetivo extraído} para {cliente}`.
- **Datas**: início = hoje; fim = hoje + `deadlineDays` (default por tipo: ads=30, site=45, video=14, automacao=21).
- **Descrição**: template por tipo (escopo padrão + objetivo do usuário).
- **Tasks**: usa `projectTemplates.ts` existente; cada task ganha checklist do template correspondente em `task_checklist_templates`.
- **Conteúdo de entrega por task**: campo `description` enriquecido com bullet points padronizados (Objetivo / Entrega / Critério de aceite).

### Resultados do voice (auditoria)

Já existe `voice_command_log`. Adicionar `clarifications jsonb` (perguntas/respostas) e `preview jsonb` (escopo aprovado).

---

## Detalhes técnicos

**Arquivos novos:**
- `supabase/migrations/<ts>_onboarding_and_checklists.sql`
- `src/lib/onboardingTemplates.ts` (seed em código + helpers)
- `src/lib/taskChecklistTemplates.ts`
- `src/lib/voiceConversation.ts` (state machine + gap detection + sugestões)
- `src/components/admin/ClientOnboardingPanel.tsx`
- `src/components/admin/TaskChecklistTemplatePicker.tsx`

**Arquivos editados:**
- `src/components/admin/VoiceAssistant.tsx` (fluxo conversacional + preview rico)
- `src/lib/voiceCommands.ts` (retornar gaps)
- `src/components/admin/EditClientDrawer.tsx` (nova aba Esteira)
- `src/components/admin/TaskDetailDrawer.tsx` (botão aplicar template)
- `src/integrations/supabase/types.ts` (auto-regen após migration)

**Ordem de execução:**
1. Migration (schema + grants + RLS + seed via INSERTs).
2. Templates em TS + helpers.
3. Voice conversacional + preview.
4. ClientOnboardingPanel + integração no drawer.
5. TaskChecklistTemplatePicker no TaskDetailDrawer.
6. Banner sugestivo de onboarding incompleto.

**Fora de escopo deste release:**
- Notificações automáticas de onboarding atrasado (próximo release).
- Integração do onboarding com o briefing público existente (sincronização bidirecional fica para depois).