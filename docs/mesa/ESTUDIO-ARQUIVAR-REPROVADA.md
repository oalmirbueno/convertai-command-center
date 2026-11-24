# Protótipo de arquivamento interno de entregas reprovadas

**Publicação bloqueada.** No PostgreSQL descartável, o gatilho do trabalho renovou `atualizado_em` ao gravar e ao remover o marcador. Com duas peças na mesma pauta, isso fez a Agenda da equipe escolher a peça reprovada no lugar da substituta aprovada. Com duas peças sincronizadas no mesmo post, o gatilho de avisos também mudou a referência para a peça reprovada em um evento simulado. A prova conferiu cinco tabelas relacionadas e a soma de verificação do objeto de teste antes e depois da ação. Tudo foi executado em dados sintéticos.

A próxima revisão deve manter o carimbo de edição do trabalho intacto, inclusive ao desfazer. Um registro interno separado por trabalho e rodada permite isso. A operação precisa validar as permissões e travar o trabalho durante a gravação. O plano de schema exige aprovação explícita, teste em ambiente descartável e revisão antes de qualquer implantação.

## Contrato

- Ação `estudio-arte` `reprovado_arquivar { trabalho_id, desfazer?, motivo?, esperado_atualizado_em? }`.
- Quem chama: equipe (`is_staff`) com `can_access_client` no cliente do trabalho. O cliente final não chama a função.
- O que aceita: só `entrega_status = 'reprovado'`, tanto social padrão (com ou sem `task_id`) quanto arte rápida. Criativo de anúncio e Laboratório são recusados (409).
- O que grava: só `direcao`. O social padrão recebe `direcao.arquivo_da_reprovacao = { arquivado_em, arquivado_por, rodada, motivo }`. A arte rápida usa o marcador legado `direcao.arte_rapida.arquivada_em`, o mesmo de `rapida_arquivar`. A ação nunca cria `direcao.arte_rapida` num social.
- O que não toca: tarefa, post, publicação, Arquivos, storage, aprovação, fila e geração. Não dispara nada.
- Trava otimista: o UPDATE exige o mesmo `id`, `client_id` e `atualizado_em` (o gatilho `estudio_trabalhos_tocar` renova esse campo) e `entrega_status = 'reprovado'`. Quando o UPDATE perde a corrida, a ação relê e decide de novo. Com `esperado_atualizado_em` (a tela envia), qualquer mudança no meio do caminho devolve 409 `trabalho_mudou`.
- Idempotência e reversão: repetir a ação devolve `ja_estava: true` sem gravar, e `desfazer: true` retira os marcadores.
- Validade: o marcador novo só vale na mesma `entrega_rodada` e enquanto a entrega estiver reprovada. Reabrir, reentregar ou aprovar devolve o trabalho às listas.
- Trilha: `mcp_audit_log` com `estudio_arquivar_reprovado` ou `estudio_desarquivar_reprovado`, registrando client_id, trabalho_id, task_id e se houve mudança.
- Leitura única: `_shared/arquivo-da-reprovacao.ts` (`estadoDoArquivo`). É usada pela tela, pelo MCP `aceleriq_estudio_trabalhos` (`arquivado_internamente`, `arquivado_em`, `arquivo_origem`) e pelo servidor.
- O botão Arquivar da faixa das pautas continua chamando o agente-calendario para arquivar a pauta e, quando aplicável, o post. O botão da Arte Rápida também mantém seu caminho atual.

## Aceite em ambiente isolado

1. Abra um item com arte reprovada e entre na aba Entrega. Clique em "Arquivar reprovada" e confirme. O selo passa a "reprovada, arquivada", e a pauta, o post e a aprovação continuam iguais.
2. Use "Desfazer" no aviso ou "Desarquivar": o selo volta a "ajuste pedido".
3. Aprove em outra aba antes de arquivar: a ação deve recusar com 409.
4. No MCP, `aceleriq_estudio_trabalhos` deve trazer `arquivado_internamente`.
5. Use o "Arquivar" da faixa das pautas e o da arte rápida: ambos devem se comportar como antes.
6. Com uma peça reprovada antiga e uma substituta aprovada na mesma pauta e no mesmo post, confirme que a Agenda e os avisos continuam apontando para a substituta ao arquivar e ao desfazer.

## Rollback

O protótipo não foi implantado. A próxima versão precisa definir a reversão antes da publicação. Reverter o código do protótipo depois de uso não recuperaria o carimbo anterior do trabalho.
