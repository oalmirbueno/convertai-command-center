# MCP — envio de MP4 à pauta pela credencial de projeto (lote em revisão, 23/11/2026)

Estado: código e migration **somente no repositório**. Nada aplicado, publicado ou configurado. Não autoriza
Publish, migração, criação de chave, de perfil ou de vínculo.

## O que existe

Três tools só para a chave presa a um projeto e um operador (`mcp_project_grants`), ausentes para qualquer
outra credencial:

| Tool | Efeito |
| --- | --- |
| `aceleriq_projeto_video_preparar` | Abre uma sessão para UMA tarefa viva do projeto e devolve `upload_url` (PUT). |
| `aceleriq_projeto_video_finalizar` | Confere o objeto e cria `files` + `task_attachments` (mesmo objeto, autoria do perfil dedicado). |
| `aceleriq_projeto_video_pedir_aprovacao` | Chama `request_file_agency_review` só para esse arquivo (Gate 1, humano). |

Todas exigem `confirmar: true` e `idempotency_key`. O chamador nunca informa cliente, projeto, operador,
bucket, caminho, URL ou autor; o banco deriva tudo da chave autenticada.

## Liberação restrita ao Corte

1. `mcp_project_grants.allow_video_upload = true` na criação da concessão (padrão `false`, imutável).
2. Vínculo ativo em `mcp_operator_author_profiles` (operador → perfil dedicado), criado por admin.
3. Atestado ativo e conta de Auth dedicada, bloqueada para login, sem histórico de login e com `aceleriq_mcp_author_operator=corte` no metadado administrado pelo servidor.
4. `MCP_PROJECT_VIDEO_WRITE=true` e `MCP_PROJECT_VIDEO_PROJECT_ID` igual ao projeto autorizado no servidor.

Sem qualquer uma delas as tools não aparecem (`tools/list`) ou o banco recusa (`mcp_video:negado`/`autoria`).

## Autoria

`files.uploaded_by`, `task_attachments.uploaded_by` e `file_approval_events.actor_id` exigem `profiles.id`, e
`internal_operators.slug` não é perfil. A autoria vem de um **perfil dedicado ao agente** (ex.: "Corte (agente)"):
só `design`/`traffic`, nunca `admin`/`manager`/`client`, não é cliente de projeto, não é quem configurou, serve a um
operador só e precisa estar na carteira do cliente (`team_client_assignments`). Tudo é conferido na criação do
vínculo e de novo em cada RPC. Não usa perfil do cliente, de pessoa da equipe, UUID inventado nem admin.
Na tela o autor aparece com o nome desse perfil; a trilha completa (chave, concessão, operador, tarefa, objeto,
arquivo, anexo) fica em `mcp_project_video_uploads`, além de `mcp_audit_log` e `mcp_assinaturas_log`.

O pedido de revisão empresta `auth.uid()` = perfil dedicado só durante a chamada a `request_file_agency_review`
(mesma transação, restaurado em seguida), para reaproveitar o contrato e o histórico de sempre.

## Conferência viva e isolamento

Cada RPC (`mcp_project_video_prepare/open/finalize/request_review`, `SECURITY DEFINER`, só `service_role`) confere,
na mesma transação e com `FOR SHARE`: chave ativa só com `mcp:project`, exatamente uma concessão ativa com opt-in,
operador ativo, projeto vivo do cliente, vínculo de autoria e carteira. A sessão (`FOR UPDATE`) precisa ser da mesma
chave, concessão, operador e autoria do preparo, e a tarefa precisa continuar no mesmo projeto, não apagada, com o
mesmo `status` e o mesmo `assigned_to`. Qualquer mudança nega finalizar e pedir revisão (prepare de novo).

## Objeto e janela do PUT

- Caminho gerado pelo banco: `mcp-files/<client_id>/mcp-project-video/<upload_id>.mp4` (bucket privado, chave única).
- URL de envio por `createSignedUploadUrl` **sem upsert**: o primeiro PUT grava; nenhum PUT posterior sobrescreve.
- **Janela do PUT**: a URL assinada vale o padrão do Storage (cerca de 2 h) e não é revogável. Depois de revogar a
  concessão, ainda é possível fazer o PUT dentro dessa janela, mas o objeto fica órfão: finalizar e pedir revisão
  são negados e nada é registrado em `files`/`task_attachments`. A sessão expira 3 h após o preparo.
  O objeto órfão fica ilegível no painel. Equipe e clientes ficam sem permissão de escrita nesse prefixo. A limpeza de órfãos é uma operação separada.
- Finalizar confere: tamanho e MIME registrados pelo Storage (`video/mp4`), download pelo service role, tamanho
  exato, `sha256` declarado e cabeçalho `ftyp` de MP4. A revisão e as repetições exigem o mesmo ID e versão validados. Teto 100 MiB.
- A URL só existe na resposta de `preparar`: não vai para banco, cache, auditoria, log ou mensagem de erro.

## Ativação (manual, fora deste lote, depois de aprovada)

1. Aplicar `20261123120000` e `20261123130000` pelo workflow do banco (backup confirmado).
2. Admin cria e bloqueia a conta dedicada ao Corte, define o marcador técnico e registra o atestado. O perfil recebe papel `design` e só a carteira autorizada.
3. Admin insere o vínculo em `mcp_operator_author_profiles` (`configured_by` = o próprio admin).
4. Emitir chave nova `mcp:project` e a concessão com `allow_video_upload = true`.
5. Configurar `MCP_PROJECT_VIDEO_PROJECT_ID` para Skyfleet, então ligar `MCP_PROJECT_VIDEO_WRITE=true` e publicar pelo workflow autorizado.

## Preview e rollback

Preview com dados sintéticos: preparar → PUT de MP4 sintético → finalizar (repetir) → pedir revisão (repetir);
conferir um `files`, um anexo, um evento `agency_review_requested` com o perfil dedicado, nenhum aviso.
Negativos: chave sem opt-in, outra tarefa/projeto, tarefa movida, concessão revogada.

Rollback lógico: `MCP_PROJECT_VIDEO_WRITE` desligado, ou revogar o vínculo/concessão. Nada é apagado.
