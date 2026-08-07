# Inbox público do Workspace

O Inbox permite que uma pessoa externa envie arquivos para uma pasta específica sem criar conta. O bearer UUID continua no link público para preservar compatibilidade, mas o frontend o transmite à Edge Function pelo header `x-inbox-token`, nunca pela URL da função. O endpoint legado com `?token=` permanece aceito durante a expiração dos links antigos.

## Política aplicada

- validade padrão: 7 dias;
- rotação: gera novo token e invalida o anterior imediatamente;
- revogação: remove token, validade e geração;
- arquivo: máximo de 25 MiB, enviado como body binário bruto;
- janela móvel por token: 20 arquivos ou 100 MiB em 24 horas;
- rate limit: 10 reservas por minuto;
- lote do navegador: até 10 arquivos, enviados sequencialmente;
- extensões ativas ou executáveis conhecidas são recusadas;
- todo arquivo público entra com estado `pending`; o frontend novo bloqueia thumbnail, preview, abertura e handoff;
- respostas usam `Cache-Control: no-store`, e a aplicação usa política `no-referrer`.

A migration `20260807213000_harden_workspace_inbox_tokens.sql` cria uma geração interna por token, garante expiração, inclui o bucket privado `workspace` em projetos novos e adiciona o ledger `workspace_inbox_upload_reservations`. Reservas são serializadas com lock na pasta, portanto abas, browsers e remetentes simultâneos não ultrapassam a quota por condição de corrida. `request_id` torna uma repetição de rede idempotente.

O ledger força RLS e não concede leitura a `anon` nem `authenticated`. As RPCs de reserva, conclusão e cancelamento aceitam apenas `service_role`. A RPC de rotação/revogação usa `SECURITY INVOKER`, continua sujeita ao RLS de `workspace_nodes` e só é executável por usuário autenticado.

## Ordem de release em duas fases

1. Aplicar as migrations EXPAND pelo workflow forward-only de banco, inclusive `20260807221000_harden_workspace_quarantine_boundary.sql`.
2. Confirmar que tokens existentes receberam validade e geração, e que o bucket `workspace` continua privado.
3. Abrir o Preview do frontend do mesmo SHA, sem publicá-lo, e validar as telas administrativas e a criação, rotação e revogação de links. Não testar ainda o upload público: a Edge Function anterior aceita somente `?token=`, multipart e o payload legado, enquanto a UI nova usa `x-inbox-token`, body binário e o contrato de quota da fase EXPAND.
4. Depois da revisão operacional pré-Edge, executar `Deploy Supabase Public Edge`, que inclui somente `workspace-inbox` e as outras quatro funções da allowlist protegida. A Edge nova mantém temporariamente os dois contratos do frontend antigo: token em `?token=` e POST multipart com os campos `file` e `sender`.
5. Com o Preview ainda não publicado, validar agora os dois contratos contra a Edge nova: um envio pela produção ainda antiga, usando query + multipart, e outro pelo Preview, usando header + body binário. Nos dois casos, confirmar o nó `pending`; no protocolo novo, testar também quota, rejeição acima de 25 MiB, download estrito e a RPC auditada `pending -> clean`.
6. Somente depois desse smoke, publicar o frontend do mesmo SHA e repetir o caminho feliz de criação do link e envio.
7. Em um release posterior, aplicar a migration CUTOVER que bloqueia alterações diretas do estado e incorpora o predicado de quarentena a **todas** as policies de leitura de `storage.objects`; repetir a matriz pgTAP e o smoke real antes de liberar produção.

Enquanto a EXPAND não estiver aplicada, o novo frontend não deve ser publicado, pois as RPCs ainda não existirão. O frontend antigo segue aceito após a migration: qualquer escrita que informe apenas `inbox_token` recebe metadados e validade pelo trigger. Até o CUTOVER separado, o bloqueio de preview no frontend é defesa de aplicação, não uma fronteira completa do Storage; as policies antigas ainda precisam ser substituídas de forma coordenada, pois policies permissivas são combinadas por `OR`.

## Compensação e operação

No protocolo novo, headers pequenos permitem reservar quota antes de consumir o body. Depois da reserva, a Edge Function transmite o stream binário diretamente ao Storage, sem `arrayBuffer` ou `Uint8Array`, e confirma que o tamanho persistido coincide com `Content-Length`. O bridge multipart temporário precisa materializar o formulário legado antes da reserva, mas impõe um teto ao `Content-Length` antes de chamar `formData()` e encaminha `file.stream()` para o mesmo fluxo de quota, Storage, quarentena e compensação. Após o Storage aceitar o objeto, uma RPC atômica cria o nó com `inbox_scan_status=pending` e conclui a reserva. Se a conclusão falhar, a função tenta remover o objeto e registra a reserva como `failed`; se a remoção também falhar, registra `orphaned` e mantém seus bytes contando na quota.

Reservas `pending` por mais de 15 minutos também passam a `orphaned` no próximo envio daquele link. Isso evita liberar quota quando um processo pode ter sido interrompido depois de gravar no Storage. Objetos `orphaned` exigem reconciliação operacional pela API do Storage antes de mudar o estado para `cleaned`; não é seguro apagar apenas `storage.objects` por SQL.

Esta versão não inclui antivírus automático. A UI oferece apenas download explícito para verificação externa e exige confirmação humana antes de mudar o estado para `clean`; até lá não gera URL de thumbnail/preview, não abre, não copia link e não envia o item para Arquivos. Essa marcação não substitui um scanner: operacionalmente, só libere depois de uma ferramenta de segurança confiável considerar o conteúdo seguro.

## Rollback lógico

Não reverta a migration. Em incidente, revogue os links pela UI, mantenha a Edge Function antiga indisponível para novos uploads e faça uma migration corretiva forward-only. A tabela de ledger e os metadados de token podem permanecer sem impacto nos arquivos já registrados.
