# Execução e Hermes — continuidade de 07/10/2026

## Contrato publicado pelo painel

- MCP 2.5 mantém os campos anteriores de `aceleriq_operator_report` e adiciona `detail` opcional: `title`, `summary`, `page_url`, `attachments: [{ name, url }]`.
- As comprovações usam HTTPS sem credenciais ou `files://task-attachments/<tarefa>/...`. URLs assinadas não são persistidas. O leitor autenticado assina arquivos privados ao abrir.
- O relato guarda ação, evidência, próximo passo e contexto resolvido da tarefa em `operator_runs.detail`. A leitura do quadro devolve `detalhe`, `link_id` e `deep_link` nas execuções. Não altera o estado ao ler.
- Use uma tarefa real e a mesma `run_key` durante cada atividade; informe o andamento enquanto trabalha e encerre com resultado verificável. Transportar um arquivo não equivale a concluir sua análise.
- `/execucao?run=<id>` abre a execução específica, inclusive fora da primeira página; `/execucao?vinculo=<id>&aba=diario` abre a conversa. `agente` aceita ID ou slug.
- O diário permanece persistido no painel. O consumidor Hermes precisa ler novas entradas humanas, deduplicar por ID, aplicar apenas a instrução autorizada e responder no mesmo vínculo. A interface não afirma que o agente respondeu antes de haver resposta registrada.

## Organização e aprovação

- Departamentos são `internal_operators.area`, compartilhados entre painel e Hermes. Criar um nome ao organizar um agente cria seu departamento; o RPC existente preserva autenticação de administrador e auditoria.
- Trabalho separa tarefas e execuções externas. Contagem de tarefas usa IDs distintos, sem somar quadro/fila/concluídas novamente.
- Notificações de agentes têm aba própria, consulta própria e marcação de leitura restrita a essa aba. Links abrem a conversa específica e o contexto é resolvido pela tarefa/projeto/cliente sob RLS.
- Aprovações de origem Central usam `central_review_decide` com cliente, hash, versão e chave de idempotência. Outras aprovações continuam em `operator_approval_decidir`. A mensagem congelada, destino e próximos passos aparecem antes dos botões.

## Implantação e limites

Sem migração de banco, sem credencial no navegador e sem remoção de permissões existentes. Frontend via Cloudflare `aceleriq-painel`; funções `mcp-server` e compatibilidade `mcp` no Supabase `jjjtkowvxemvituvywvf`.

O código deste repositório não instala sozinho os serviços do host Hermes. Configuração de consumidor, rotinas e testes reais do host deve ser comprovada separadamente, com seus IDs e resultados, antes de anunciar operação automática. Não transformar execução de transporte, coleta ou teste em campanha otimizada.

Rollback: publicar a versão anterior do Worker e as duas funções MCP do commit anterior. `detail` é aditivo e permanece legível no banco; não apagar histórico ou evidências.

## Complemento 2.5.1 e verificação do host

- O diário também aceita `attachments: [{ name, url }]`. O caminho `mcp-files://...` retornado pelo upload privado é aceito no diário e no relato; a interface reutiliza a assinatura autenticada de Arquivos. Texto com apenas `file_id` não constitui prévia visual.
- Execuções anteriores ao campo `detail` recuperam o título da auditoria do mesmo agente e mesma execução. A projeção não modifica o histórico nem o estado.
- Hermes informou instalação do consumidor de entradas humanas no job `cdd3966dd810` (a cada minuto, sem despertar o modelo na fila vazia); a resposta a entrada humana real deve ser validada antes de considerar o circuito completo.
- Jobs de dossiê criados no Hermes: `11f2dca8be04` segunda/sexta 09h e `757cc36b2a41` quarta 15h, America/Sao_Paulo. Rituais administrativos anteriores preservados.
- A ponte Meta registra coleta de dados como revisão, com relatório como prova. Isso não comprova otimização de campanhas nem substitui a análise especializada.
