# Aceleriq OS — contexto canônico do ecossistema

## Identidade

A Aceleriq é uma operação de Engenharia de Crescimento apoiada no Método A.C.E.L.E.R.A.: Analisar, Clarear, Estruturar, Lançar, Executar, Revisar e Acelerar. O Aceleriq OS organiza estratégia, execução, aprovações, arquivos, clientes, operação, financeiro e memória permanente.

## Fontes da verdade

1. O painel é a fonte da verdade do estado operacional e dos dados por cliente.
2. O GitHub é a fonte da verdade do código, prompts versionados e arquitetura.
3. O Segundo Cérebro guarda memória estratégica persistente e aprendizados.
4. MCP fornece acesso vivo e autorizado; não substitui banco nem documentação.

## Ambiente existente

- Repositório canônico: `oalmirbueno/convertai-command-center`.
- Projeto Lovable: Aceleriq Comando OS.
- Lovable Cloud/Postgres atual: projeto existente registrado no inventário
  operacional privado.
- O Lovable continua como host atual do frontend e camada de compatibilidade, mas o build e a hospedagem não dependem exclusivamente dele. A portabilidade está registrada no [`ADR-0003`](decisions/ADR-0003-portabilidade-do-frontend-e-endpoints-mcp.md).
- O runtime portátil não exige Lovable para MCP, IA ou e-mail: IA usa provider OpenAI-compatible/OpenAI, o transporte chama Resend diretamente e os hooks portáteis usam Standard Webhooks. `LOVABLE_API_KEY` e `/functions/v1/mcp` permanecem somente como fallbacks de transição.
- O sistema já é usado por clientes e pela equipe; evolução deve ser incremental e compatível.
- Neste lote, não criar novo Cloud nem migrar de plataforma. “Migration” significa SQL incremental e controlado no mesmo banco; uma eventual migração do projeto Supabase exige plano, autorização e validação próprios.

## Arquitetura inegociável

- Blackboard: agentes não trocam estado diretamente; leem e escrevem pelo painel.
- Uma lógica central e interfaces compatíveis para GPT Work, Codex/Claude Code, OpenClaw e Hermes.
- Silo real por cliente imposto por autenticação, autorização e RLS.
- Credenciais nunca saem do servidor.
- Toda transição, aprovação, publicação e notificação importante é auditável.
- LLM raciocina e cria; código determinístico executa publicação, filas, retries e métricas.
- Kill switch e orçamento operacional por cliente desde o início.

## Dois Kanbans conciliados

- Kanban interno dos agentes: visível apenas para admin e equipe. Mostra análise, geração, revisão, falhas e execução automática.
- Kanban normal do cliente: continua simples e mostra entregas e avanço real.
- Uma entrega interna gera ou atualiza automaticamente o item correspondente no fluxo visível ao cliente, sem expor raciocínio dos agentes.

## Fluxo de conteúdo e aprovação

1. Estratégia e briefing usam contexto, marca, contrato, referências e métricas.
2. Criador gera versão, artefatos e justificativa estratégica.
3. Gate 1: aprovação humana da agência.
4. Gate 2: aprovação humana do cliente quando o tipo de entrega exigir.
5. Reprovação exige feedback; uma nova versão é criada sem interromper os outros conteúdos da rotina.
6. Após três ciclos automáticos, escalar para humano.
7. Aprovado e agendado entra em fila determinística; publicação possui idempotência e retry.
8. Métricas alimentam o próximo ciclo e a memória permanente.

Documentos estratégicos e técnicos podem ser apenas disponibilizados ao cliente, sem Gate 2, conforme regra do contrato e do tipo de entrega. Aprovação formal acontece no painel, não por mensagem de WhatsApp.

## Conexões oficiais e publicação externa

- Redes sociais são conectadas apenas por OAuth oficial. Senhas de clientes nunca são solicitadas ou armazenadas.
- Metadados sanitizados da conexão podem ficar no schema público com RLS; tokens e referências operacionais permanecem em schema privado e Vault.
- Descobrir ou conectar uma conta não ativa publicação automática. A ativação depende de um lote posterior com worker determinístico, kill switch, idempotência, retry e auditoria.
- O calendário congela a ordem e a integridade dos arquivos aprovados. O worker futuro só poderá consumir esse snapshot depois dos dois gates humanos.
- Sessões abandonadas, reconexões, expiração e desconexão devem revogar credenciais que não estejam servindo uma conexão ativa.
- A fundação inicial para Meta está descrita no [`ADR-0002`](decisions/ADR-0002-meta-oauth-e-fundacao-de-publicacao.md).

## Produção de ativos

- Carrosséis, artes e criativos: GPT Work com o melhor modelo visual disponível, seguindo manual do cliente e banco de referências.
- Vídeos: pipeline de código/Remotion e skills adequadas, podendo usar diferentes executores em nuvem.
- Documentos: padrão visual profissional, logo do cliente e da Aceleriq, alinhamento, hierarquia, espaçamento e ausência de sobreposição.
- Artes do cliente usam apenas a identidade do cliente; marca Aceleriq aparece em documentos institucionais, não nas artes, salvo quando o conteúdo é da própria Aceleriq.
- Cada ativo registra modelo, executor, versão, custo, referências e feedback que o originou.

## Agentes e conectividade

- Analista/Estrategista: lê métricas e memória, atualiza aprendizados e briefing.
- Criador: gera e revisa ativos; não aprova nem publica.
- Publicador: worker determinístico, não LLM.
- Comercial: diagnóstico de leads com gate humano antes de proposta.
- GPT Work, Codex/Claude Code, OpenClaw e Hermes acessam capacidades autorizadas pelo mesmo ecossistema MCP.
- Preferência econômica: usar assinaturas existentes para trabalho interativo; APIs pagas de modelos só entram quando aprovadas e justificadas.

## Onboarding

Contrato assinado → cadastro do cliente → projeto e permissões → manual de marca e referências → contexto/Segundo Cérebro → estratégia e documentos iniciais → aprovação interna para ativar automação. Entregas respeitam contrato, com excedente planejado apenas quando protege margem e fidelização.

## Financeiro e ofertas

Planos-base editáveis: R$ 597, R$ 1.197, R$ 2.297, R$ 5.597 e Sob Medida. Serviços avulsos são variáveis. O painel deve calcular receita, custos fixos, equipe, ferramentas, custo por cliente/peça, margem, capacidade, projeções e ponto de equilíbrio. Vídeo inicia a partir do plano de R$ 1.197 conforme catálogo vigente.

## Método de entrega técnica

1. Ler código e estado remoto atuais.
2. Definir lote, riscos e critério de aceite.
3. Criar branch a partir do `main` atualizado.
4. Implementar sem misturar lotes.
5. Testar, revisar diff e abrir draft PR.
6. Validar Preview e fluxos de admin/cliente.
7. Fazer merge após aprovação humana.
8. Aplicar migrations pelo workflow GitHub forward-only, somente no tip atual de `main`, depois de confirmar backup restaurável; nunca usar reset, seed ou repair em produção.
9. Confirmar o binding OAuth no banco e só então publicar ou reverter o MCP pelo workflow GitHub a partir de SHA imutável, validando o smoke remoto.
10. Confirmar sincronização no Lovable e gerar, quando aplicável, o artefato portátil a partir do mesmo commit.
11. Publish manual no host aprovado somente depois do aceite; o Lovable permanece o destino atual até um corte explicitamente autorizado.

## Estado atual de referência

- O Segundo Cérebro está ao vivo. Houve anteriormente um período de respostas transitórias 503, mantido aqui apenas como histórico; não tratar esse incidente como estado atual.
- O Ops foi descontinuado e está fora da arquitetura e do caminho crítico do Aceleriq OS. Artefatos legados com `ops` permanecem somente como histórico técnico: não devem ser chamados, ampliados, reativados ou removidos fora de um lote separado, reversível e explicitamente autorizado. Ops não é o Segundo Cérebro nem o OpenClaw.
- Baseline documental em 20/07/2026: `main` em `3129a07042a27bf6abfd6502383a1dbed407a9c1`, merge do PR #8 (`fix: tornar nova entrada financeira consistente`). Este SHA é uma fotografia histórica; antes de cada lote, confirmar novamente o `main` remoto.
- O `mcp-server`, acompanhado de `mcp-oauth-metadata`, é a superfície MCP portátil e independente do host do frontend. O endpoint `mcp` gerado para o Lovable permanece como compatibilidade controlada, sem ser o único caminho de integração.
- `Deploy Supabase Database`, `Deploy Supabase Public Edge` e `Deploy Supabase MCP` compartilham a concorrência `supabase-production`. O banco aplica migrations forward-only com backup confirmado. O lote não-MCP usa Preview não publicado para revisar os escopos, publica a allowlist de cinco Edge Functions, valida os contratos antigo e novo do Inbox e só então publica o frontend do mesmo SHA. O MCP publica ou reverte separadamente suas duas funções. A migration `20260807210000_bind_mcp_oauth_clients.sql` é pré-requisito obrigatório, e rollback MCP nunca reverte o banco.
- Um banco remoto realmente vazio recebe `supabase/bootstrap/legacy_prerequisites.sql` diretamente, uma única vez e sem registro em `schema_migrations`; só depois recebe a ledger versionada. A cópia temporária como migration é exclusiva de local/CI, e o bootstrap nunca deve ser aplicado ao banco atual já existente.
- As seis funções de IA usam `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` ou `OPENAI_API_KEY`; e-mail usa `RESEND_API_KEY`; Auth e supressão usam `SEND_EMAIL_HOOK_SECRET` e `SUPPRESSION_WEBHOOK_SECRET` no formato Standard Webhooks.
- O contrato público de configuração está em [`ENVIRONMENT-INVENTORY.md`](../operations/ENVIRONMENT-INVENTORY.md); o inventário operacional real permanece privado. Release, rollback e migração estão em [`MCP-PORTABLE-DEPLOY.md`](../operations/MCP-PORTABLE-DEPLOY.md).
- O primeiro objetivo é estabilizar contexto, segurança e fluxo de trabalho antes de ampliar o ecossistema autônomo.
- A decisão proposta para classificação de tarefas e sincronização Kanban/editorial está registrada em [`ADR-0001`](decisions/ADR-0001-workstream-e-sincronizacao-editorial.md).
- A decisão de portabilidade do frontend e dos endpoints MCP está registrada no [`ADR-0003`](decisions/ADR-0003-portabilidade-do-frontend-e-endpoints-mcp.md), sem autorizar migração do backend atual.
- Mudanças futuras devem atualizar este documento e um registro de estado/decisões para evitar perda de contexto.
