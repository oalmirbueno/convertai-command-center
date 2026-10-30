# Plano de ativação

> **Estado em 15/10/2026 (autorizado pelo Almir):** produção gerada (`--ambiente production`) e importada.
> Ligados: ACQ-00-Erros, ACQ-00-Ferramenta-Aceleriq e ACQ-05 (`tools/ativar-producao.mjs ligar ...`).
> ACQ-01 e ACQ-03 esperam a chave do n8n com `aceleriq:write`; ACQ-02 e ACQ-04 esperam o WhatsApp oficial.
> Desligar qualquer um: `node tools/ativar-producao.mjs desligar <fluxo>`.

Nada aqui foi executado. Cada passo pede autorização explícita do Almir e é reversível na ordem
inversa. A ordem respeita as dependências: estado → identidade → leitura → escrita → transporte.

## Fase 0 — pré-requisitos (sem efeito em cliente)
1. **Estado:** aplicar `migrations/20261014120000_acq_n8n_estado.sql` num Postgres de produção para a automação
   (schema `acq_n8n` no mesmo Supabase, papel `acq_n8n_worker` com senha própria e acesso só a esse schema;
   ou um Postgres à parte). Rollback: `drop schema acq_n8n cascade` (não toca tabela do painel).
2. **Credenciais no n8n** (por nome, valores só no cofre do n8n):
   - `ACQ Estado (Postgres acq_n8n)` — papel `acq_n8n_worker`.
   - `ACQ MCP Aceleriq (máquina n8n)` — chave `mcp_live_*` criada por admin (item 1 de MUDANCAS-NO-PAINEL.md).
   - `TypeSafe Jev (servidor)` — chave TypeSafe do servidor.
   - `ACQ Webhook mensagens (segredo)` e `ACQ Webhook recibos (segredo)` — cabeçalho `x-acq-segredo`.
3. **Operador `n8n`** em `internal_operators` e troca de `operador` em `config/ambientes.json` (production).
4. **Publicar o `ACQ-00-Erros` e o `ACQ-00-Ferramenta-Aceleriq`** (nenhum dos dois tem gatilho de agenda ou
   webhook) e ligar `errorWorkflow` nos demais. Motivo comprovado no n8n 2.42.7: fora do modo manual
   (agenda, webhook, CLI), `Execute Sub-workflow` só roda sub-workflow **publicado** ("Workflow is not active
   and cannot be executed"); em execução manual pelo editor ele usa o rascunho. E o vínculo `errorWorkflow`
   também exige workflow de erro publicado. Por isso nada disso foi feito na homologação.

## Fase 1 — leitura em produção, saídas internas (piloto Mirante continua)
5. Gerar com `--ambiente pilot` (dry-run forçado, só Mirante) e importar na instância de produção.
6. Rodar **manualmente** ACQ-01 (`Executar piloto (Mirante)`), ACQ-03 (`Executar manualmente`) e ACQ-05
   (`Executar pauta manualmente`). Conferir `acq_n8n.propostas` e `acq_n8n.eventos`.
7. Publicar (ativar) primeiro só os **gatilhos de leitura** do ACQ-05 (15 min técnico) e do ACQ-03 (10 min):
   na primeira rodada o ACQ-03 inicializa o cursor sem anunciar o histórico.
   Rollback: `unpublish_workflow`.

## Fase 2 — escrita no painel (sem mensagem a cliente)
8. Resolver o limite do dossiê da Mirante (57.361 de 60.000 caracteres) antes de liberar
   `aceleriq_upsert_current_dossier`.
9. Em `production`: `dry_run=false` e `escritas_liberadas` = `upsert_current_dossier`,
   `create_report_draft`, `central_review_preparar`, `operator_report`. Gerar, importar, rodar manual, conferir
   em `/relatorios`, `/ciclo/revisao` e `/execucao`. Só então publicar os gatilhos de seg/qua/sex do ACQ-01.

## Fase 3 — transporte (depende de validação externa)
10. Homologar o provedor oficial de WhatsApp **no tipo exato de grupo** (recebimento de texto/áudio, envio com
    recibo). Sem isso, ACQ-02 e ACQ-04 continuam só com transporte e entrada de teste.
11. Cadastrar destinos técnicos aprovados (`acq_n8n.destinos_aprovados` ou a tabela proposta no painel).
12. Implementar o nó de transporte oficial no ACQ-02 (substitui o `Transporte de teste`), liberar
    `central_review_marcar_enviado`, publicar o ACQ-02 com 1 cliente e acompanhar `envio_incerto` = 0.
13. Publicar o webhook de recibos e o do ACQ-04 com o segredo; validar assinatura do provedor (app secret
    numa credencial; a validação HMAC já existe em `lib/nucleo.js`).

## Fase 4 — avisos de publicação
14. Depois da extensão da revisão para aviso de publicação (item 7 de MUDANCAS-NO-PAINEL.md), trocar o destino
    das propostas do ACQ-03 de `aguardando_extensao_revisao` para o pedido de revisão do painel; o envio segue
    pelo ACQ-02.

## Rollback geral
- Despublicar os workflows (`unpublish_workflow`) — param gatilhos e webhooks.
- Revogar a chave `mcp_live_*` do n8n.
- O schema `acq_n8n` guarda só estado da automação; pode ser mantido para auditoria ou removido.
