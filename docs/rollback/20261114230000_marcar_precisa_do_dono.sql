-- Rollback de supabase/migrations/20261114230000_marcar_precisa_do_dono.sql
--
-- NÃO é migration: este arquivo fica fora de supabase/migrations de propósito.
-- Só roda à mão, com autorização explícita do Almir.
--
-- O que desfaz: a função marcar_precisa_do_dono e o índice único da chave.
-- O que NÃO desfaz sozinho: os pedidos já gravados continuam em
-- operator_approvals (com action_kind 'pedir_decisao_do_dono'), e por isso o
-- check de action_kind continua aceitando esse valor. Tirar a função já fecha
-- a única porta de entrada do valor novo; o que ficou gravado segue visível
-- na Execução e pode ser decidido normalmente.

DROP FUNCTION IF EXISTS public.marcar_precisa_do_dono(text, text, text, text, uuid, uuid, uuid, numeric);

DROP INDEX IF EXISTS public.operator_approvals_precisa_do_dono_key;

-- OPCIONAL, só se o operador decidir apagar os pedidos e voltar o catálogo de
-- ações ao que era. Apaga histórico de decisão: confira antes quantos são e se
-- algum já foi decidido.
--
--   SELECT status, count(*) FROM public.operator_approvals
--    WHERE action_kind = 'pedir_decisao_do_dono' GROUP BY status;
--
--   DELETE FROM public.operator_approvals
--    WHERE action_kind = 'pedir_decisao_do_dono';
--
--   ALTER TABLE public.operator_approvals
--     DROP CONSTRAINT IF EXISTS operator_approvals_action_kind_check;
--   ALTER TABLE public.operator_approvals
--     ADD CONSTRAINT operator_approvals_action_kind_check CHECK (action_kind IN (
--       'publicar', 'agendar', 'enviar_mensagem', 'contatar_cliente',
--       'criar_proposta', 'enviar_contrato', 'ativar_campanha',
--       'alterar_orcamento', 'gastar', 'alterar_financeiro',
--       'alterar_permissoes', 'exportar_dados', 'excluir_dados',
--       'mudar_estrategia', 'alterar_responsavel', 'promover_autonomia'
--     ));
