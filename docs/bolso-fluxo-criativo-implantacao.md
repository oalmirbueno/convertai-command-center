# Fluxo criativo do Aceleriq de Bolso

Preparado em 27/10/2026. Migração e ativação dependem da aprovação final. Este documento não autoriza alterações em produção.

## Contratos e custo comercial

O banco continua sendo a autoridade do saldo. `bolso_pedir_criativo` reutiliza `bolso_pedir`, suas travas, limites, idempotência e reserva. Exige a política vigente de 1 crédito para texto e 5 para imagem; o cliente só informa a tarifa que viu, que o banco confere.

| Natureza | Resultado | Modelo | Créditos |
|---|---|---|---|
| briefing | Proposta de briefing para revisar e aplicar | `openai/gpt-6.1-sol` | 1 |
| legenda | Nova versão de copy e legenda | `openai/gpt-6.1-terra` | 1 |
| imagem | Novo arquivo | `google/gemini-3.1-flash-image` | 5 |
| ajuste | Novo arquivo usando a arte original como primeira referência | `google/gemini-3.1-flash-image` | 5 |

Aplicar uma proposta, editar à mão e baixar arquivos não geram pedido nem consumo. Uma falha definitiva usa a liberação já existente. Resposta incerta conserva o lease para conferência. Nenhum fallback de modelo é acrescentado.

Sol e Terra foram conferidos por GET público sem credenciais no [catálogo oficial OpenRouter](https://openrouter.ai/api/v1/models). Sol exige raciocínio e aceita `low`; Terra aceita `none`. Ambos ficam limitados a `max_tokens: 1200` por chamada e a 16.000 caracteres de contexto serializado. As duas etapas são pedidos separados, cada qual com confirmação e reserva própria. O custo efetivamente informado pelo provedor permanece separado dos créditos comerciais.

Depois da implantação autorizada, configurar `BOLSO_OPENROUTER_MODELO_TEXTO=openai/gpt-6.1-terra` para que também chamadas legadas de texto usem Terra e o prompt de redação humana. A UI nova usa natureza `legenda` para qualquer nova copy quando a capacidade estiver ativa. A rota antiga GPT-4.1 Mini continua aceita apenas para compatibilidade e reversão explícita; não é fallback automático.

## Persistência e referências

O pedido guarda snapshots de marca e briefing. A proposta de briefing fica no resultado do próprio job; não sobrescreve a campanha. O histórico inclui a natureza para reabrir a proposta com `bolso_criativo_resultado`. Aplicar e salvar usam a versão concorrente já existente da campanha.

Um ajuste guarda a versão de copy da arte original e reutiliza o contexto do seu pedido de origem. A copy selecionada depois na campanha não altera esse ajuste nem o replay da mesma chave. O prompt de edição inclui somente a instrução visual e os textos originais. Para artes antigas sem snapshot, o worker recebe contexto comercial vazio e preserva a própria arte, sem introduzir a oferta ou o preço atuais.

Referências usam o bucket privado `bolso`, no caminho exclusivo de usuário e campanha. O servidor registra e assina um upload específico. Após o upload, verifica a existência do objeto, tamanho exato e assinatura PNG/JPEG/WEBP antes de marcar `confirmada_em`. Somente referências confirmadas e não removidas aparecem na lista ou podem entrar em pedidos.

Registrar uploads exige acesso ativo em modo real no servidor, além da capacidade habilitada. Cadastro confirmado sem licença, modo simulado e pausa de geração não liberam uploads. Registros pendentes há pelo menos 15 minutos são removidos logicamente na próxima tentativa de upload da campanha, liberando os três slots caso a aba tenha fechado antes da confirmação. Referências já confirmadas não expiram por essa regra.

O worker confere novamente dono, campanha, disponibilidade e bytes antes de gerar. URLs assinadas duram 180 segundos e seguem diretamente do servidor ao OpenRouter em `input_references`, conforme a [Image API oficial](https://openrouter.ai/docs/guides/overview/multimodal/image-generation). O catálogo de imagens confirmou suporte a referências para Gemini 3.1 Flash Image. O produto limita a três referências de até 5 MB e, no ajuste, uma arte original de até 10 MB. As credenciais de IA nunca entram na interface.

Remover uma referência é remoção lógica; o blob permanece privado. Uma futura coleta de objetos removidos/orfãos precisa de política de retenção e autorização própria. Se uma referência for removida durante uma geração ainda não iniciada, o pedido falha de forma definitiva e libera sua reserva. Alterações com IA não substituem o arquivo original.

## Migração e reversão operacional

`20261027230000_bolso_fluxo_criativo.sql` adiciona metadados de job, referências privadas e wrappers. Não modifica checksums de migrations anteriores. Não altera pagamentos, preços, concessões, reservas existentes ou políticas de Storage. Funções internas renomeadas perdem acesso direto de `authenticated`; wrappers preservam as verificações existentes.

A coluna `recursos_criativos` nasce `false`. A capacidade só aparece como ativa em `bolso_estado` quando essa flag estiver habilitada e o membro estiver em modo real. A ativação administrativa registra auditoria. Mesmo com a flag desligada, propostas já pagas permanecem recuperáveis.

Sequência para revisão e implantação aprovada:

1. Conferir diff, testes, backup e compatibilidade dos wrappers com a versão atual do banco.
2. Aplicar somente a nova migration aprovada. Manter `recursos_criativos=false` e `pagamentos=false`.
3. Publicar worker e UI compatíveis; configurar o modelo de texto Terra no servidor.
4. Conferir capacidades, permissões de referências, estado dos pagamentos e retorno de erros seguros.
5. Habilitar `bolso_admin_recursos_criativos(true)` somente após aprovação; testar um pedido confirmado de cada natureza na conta autorizada.
6. Em reversão, usar `bolso_admin_recursos_criativos(false)`. Preservar dados, ledger e arquivos; não desfazer capturas nem apagar resultados. Pedidos já reservados continuam sujeitos às regras normais da fila.

## Validação local e limites

- `src/test/bolso-criativo.test.ts`: seleção real dos modelos, limites, CTA, custo, falhas, payload multimodal e ajuste sem referência.
- `src/test/bolso-referencias-worker.test.ts`: isolamento entre contas/campanhas, remoção, confirmação, MIME, referência original e assinatura curta.
- Suítes existentes de provedor, OpenRouter e fila continuam sendo executadas.
- `node supabase/testes/bolso_criativo_runner.mjs`: PGlite em memória, sem credenciais, URL de banco ou conexão externa. Aplica baselines e incremento nesse banco efêmero; os cenários terminam em `ROLLBACK`. Usa a dependência local já instalada em `work/bolso-db-test`.

Não usar `scripts/bolso-testar-banco.mjs` para esta verificação. O runner novo testa permissão, idempotência, isolamento, tarifa, concorrência, recuperação de proposta, referência confirmada, nova reserva de ajuste, cancelamento, saldo e pagamentos desligados. Testes locais não confirmam latência ou qualidade de uma chamada real, nem o comportamento de tokens de upload no Storage hospedado; essa etapa fica para a implantação autorizada.
