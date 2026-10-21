# Administrar a licença do CRM

Na administração da biblioteca, em **Ferramentas > Titulares e prazos**, a licença
vigente do CRM oferece **Suspender licença**. Após a suspensão, a mesma linha passa
a oferecer **Reativar licença**. Os dois comandos preservam o titular, o produto,
a data de confirmação e o vencimento original.

A suspensão é separada da revogação: não pode restaurar acesso revogado por outra
regra nem renovar licença vencida. Uma licença suspensa que vencer durante a pausa
continua vencida. Os contatos e negócios permanecem privados e salvos.

## Renovar manualmente

Em **Ferramentas > Titulares e prazos**, o período mais recente de cada titular
oferece **Renovar licença**. A janela identifica a pessoa e o CRM e mostra o prazo
anterior e as datas exatas do novo período, conferidas pelo servidor. Abrir a janela
ou cancelar não altera o acesso.

A confirmação cria um período de 12 meses de calendário, mantendo a licença anterior
e todo o histórico. Se ainda houver prazo, o novo período começa após o último
vencimento não revogado; se já venceu, começa no instante conferido na prévia.
A renovação não cobra nem ativa Kiwify ou Asaas e não concede aulas ou materiais.

Contatos, negócios e histórico continuam vinculados ao mesmo titular e produto.
Uma licença suspensa é renovada com a suspensão preservada. Reativar continua sendo
uma ação separada. Não é possível renovar uma licença revogada ou um período futuro.
Repetir a confirmação da mesma licença devolve a renovação existente sem duplicar
períodos nem histórico. Se a licença mudar durante a confirmação ou a prévia expirar,
é preciso conferir novamente antes de confirmar.

### Migração da renovação

- Fonte: `supabase/migrations/20261021154113_membros_crm_renovacao_manual.sql`.
- Acrescenta duas RPCs administrativas, sem alterar tabelas, períodos ou dados existentes.
- Prévia sem escrita; confirmação serializada por titular e produto, com histórico
  na mesma transação e referência única derivada da licença anterior.
- A confirmação exige as datas e a suspensão conferidas. Para períodos vencidos, a
  prévia vale por até cinco minutos; não há token adicional persistido para a prévia.
- Autorização interna exige administração com cadastro confirmado e CRM publicado
  e ativo. Membros comuns não podem renovar a própria licença.
- Aplicar somente pelo workflow forward-only, no tip revisado de `main`, com backup
  restaurável e checklist privado reais. Conferir ledger e pagamentos antes e depois.
- Retorno lógico: voltar o Worker à versão anterior e, se necessário, suspender o
  novo período pela administração. Preservar a migration, as licenças e o histórico.
  Nunca apagar registros ou encurtar o período anterior para desfazer a publicação.

## Cartão na biblioteca

No Início e na Minha lista, o cartão do CRM mostra **Licença ativa** somente
quando o catálogo de ferramentas confirma uma licença própria vigente. O clique
abre diretamente o CRM, que revalida a licença no servidor. Links antigos com
`?produto=` para o CRM também seguem esse caminho. Sem licença válida, o cartão
mostra **Sem licença ativa** e os registros permanecem bloqueados.

A licença do CRM não concede aulas, materiais ou downloads do produto nem de
outros produtos. Esses conteúdos mantêm suas permissões próprias. Cursos e guias
já liberados continuam acessíveis se a consulta de licenças estiver indisponível.
Prévias administrativas não abrem ferramentas com a licença da administração.
Esta correção não altera concessões, pagamentos, validade ou dados do CRM.

## Aplicação incremental

- Fonte: `supabase/migrations/20261021130623_membros_crm_suspensao_licenca.sql`.
- Backend canônico: `jjjtkowvxemvituvywvf`, no mesmo banco existente.
- Acrescenta `membros_licencas.suspenso_em`, sem atualizar licenças existentes.
- Os comandos exigem administração, licença existente e ferramenta CRM.
- Leituras e escritas do CRM conferem licença vigente, não revogada e não suspensa.
- Cada transição efetiva registra histórico; repetir a ação não duplica a transição.
- Kiwify e Asaas continuam sem liberação automática; não há alteração de checkout,
  cobrança, eventos de pagamento ou valores.

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
