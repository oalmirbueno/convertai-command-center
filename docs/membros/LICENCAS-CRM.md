# Suspender e reativar o CRM

Na administração da biblioteca, em **Ferramentas > Titulares e prazos**, a licença
vigente do CRM oferece **Suspender licença**. Após a suspensão, a mesma linha passa
a oferecer **Reativar licença**. Os dois comandos preservam o titular, o produto,
a data de confirmação e o vencimento original.

A suspensão é separada da revogação: não pode restaurar acesso revogado por outra
regra nem renovar licença vencida. Uma licença suspensa que vencer durante a pausa
continua vencida. Os contatos e negócios permanecem privados e salvos.

## Aplicação incremental

- Fonte: `supabase/migrations/20261021130623_membros_crm_suspensao_licenca.sql`.
- Backend canônico: `jjjtkowvxemvituvywvf`, no mesmo banco existente.
- Acrescenta `membros_licencas.suspenso_em`, sem atualizar licenças existentes.
- Os comandos exigem administração, licença existente e ferramenta CRM.
- Leituras e escritas do CRM conferem licença vigente, não revogada e não suspensa.
- Cada transição efetiva registra histórico; repetir a ação não duplica a transição.
- Kiwify e Asaas continuam sem liberação automática; não há alteração de checkout,
  cobrança, eventos de pagamento, valores ou renovação.

## Conferência antes de publicar

1. Conferir backup físico concluído do projeto, ledger existente e pagamentos desligados.
2. Aprovar os testes SQL no PostgreSQL descartável, os testes de interface, tipos e build.
3. Conferir a migração nova e os hashes, sem reescrever SQL histórico ou reparar ledger.
4. Integrar o commit revisado, aplicar somente a migração pendente no workflow do banco
   e publicar o frontend do mesmo código validado.
5. Suspender e reativar a licença de teste pela interface. Conferir bloqueio da sessão,
   recuperação dos mesmos registros e vencimento inalterado. Deixar o acesso liberado.

## Retorno lógico

Se houver falha no frontend, retornar a versão anterior do Worker. A coluna nova e os
registros ficam preservados. Antes de retornar a interface, reativar pelo comando
administrativo as licenças CRM pausadas por este teste que devam permanecer liberadas.
Não remover tabelas, apagar contatos, negócios ou histórico, limpar revogações ou
recriar licenças. A regra de suspensão continua valendo no servidor após retorno da UI.

## Evidência

Os testes automatizados ficam em `supabase/tests/membros/` e
`src/test/membros-ferramentas.test.tsx`. Os contratos de membros executam no banco
local descartável ou no CI; nunca devem ser executados no banco real.

O teste operacional usa somente os registros identificados como `TESTE CRM 21/10/2026`
e a licença manual existente. O registro final da publicação, dos testes e das
capturas de tela deve acompanhar o PR e a entrada no segundo cérebro.
