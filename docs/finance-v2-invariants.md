# Clientes + Financeiro V2: invariantes e rollback

## Invariantes

- A migration `20260810190000` é aditiva. Não renomeia, apaga nem reescreve `profiles`, `billing`, `expenses`, `project_payments` ou `payment_installments`.
- Dinheiro usa `numeric` com escala explícita; nenhum `real`, `double precision` ou `float` novo.
- Os campos `profiles.plan_*` permanecem como espelho temporário. A fonte de verdade V2 é a assinatura versionada.
- A importação legada cria o plano Personalizado e assinatura `is_custom=true` / `review_status=needs_review`; preserva o valor final de `plan_value` e os campos originais em `source_details`. Não cria cobrança.
- O catálogo tem identidade estável. Preço nunca é sobrescrito: nasce uma nova `finance_plan_versions` e a janela anterior é encerrada.
- A troca de assinatura encerra a anterior e insere outra na mesma transação. Existe somente uma assinatura aberta por cliente.
- A cobrança recorrente é única por `(subscription_id, billing_period_start)`. `finance_generate_monthly_billing` é manual, admin-only, serializada e idempotente. Não existe cron neste lote.
- Custos fixos são templates de planejamento. R$ 2.500 de ferramentas e R$ 3.000 de pró-labore são sugestões editáveis. Templates entram somente na previsão e nunca lançam `expenses` ou caixa automaticamente.
- Os regimes não são somados entre si: competência usa vencimento/valor nominal; caixa usa pagamento/valor recebido; previsão usa apenas saldo futuro e inclui template ainda não materializado. `project_receipts_mode` evita somar projeto se ele já estiver incluído em billing.
- Para `paid_amount=0` legado com status pago, recebido equivale ao valor total; parcial usa `min(paid_amount, amount)`; saldo nunca é negativo.
- O fechamento guarda snapshot e hash por revisão. O dashboard de período fechado lê o snapshot e não recomputa o vivo. Reabrir exige admin, motivo e preserva a revisão anterior.
- É permitido pagar em mês aberto uma obrigação cuja competência já fechou. É proibido alterar valor, competência ou vencimento fechados, e mexer em caixa cuja `paid_date` esteja fechada.
- Escritas financeiras ocorrem somente via RPC e são admin-only. Admin e manager leem. Cliente autenticado vê apenas sua assinatura e versões/catálogo vinculados. `anon` não acessa.
- Toda mutação nova e das tabelas financeiras legadas é auditada. Alteração de plano em `profiles` audita apenas os quatro campos financeiros.

## Pré-deploy

1. Rodar todas as migrations em banco limpo.
2. Rodar pgTAP completo, testes, typecheck e build.
3. Inspecionar `profiles` com `plan_value < 0` ou mais de duas casas; a migration aborta inteira se encontrar.
4. Confirmar se projetos estão separados de billing e ajustar `project_receipts_mode` antes de usar os totais.
5. Gerar os tipos Supabase depois da migration.
6. Executar o deploy pelo workflow protegido e conferir os advisors do Supabase.

## Rollback

Preferir forward-fix. Antes de qualquer rollback, exportar as tabelas novas e `finance_audit_log`.

1. Desativar a UI e as RPCs V2.
2. Remover policies, grants e triggers V2 das tabelas legadas.
3. Remover índices, constraints opcionais e colunas V2 de `billing` / `expenses` somente se estiverem comprovadamente sem uso.
4. Remover funções V2 e, por último, tabelas na ordem: audit, closures, fixed costs, subscriptions, versions, catalog, settings.
5. Não restaurar `profiles.plan_*`: eles nunca foram removidos e seguem compatíveis.
6. Nunca apagar cobranças ou despesas criadas depois da ativação; desvincular FKs e preservar o ledger.

Não há SQL destrutivo de rollback automático de propósito.
