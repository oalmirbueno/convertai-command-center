-- Licenças DK no Financeiro: só admin lê, ninguém grava pelo app, o id do Asaas não duplica e a taxa é bruto - líquido.
-- Fixtures sintéticas dentro de BEGIN/ROLLBACK; nunca tocam produção.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT * FROM no_plan();

ALTER TABLE public.profiles DISABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

INSERT INTO auth.users (id, email)
VALUES
  ('98100000-0000-0000-0000-000000000001', 'licencas-admin@test.local'),
  ('98100000-0000-0000-0000-000000000003', 'licencas-design@test.local'),
  ('98100000-0000-0000-0000-00000000000a', 'licencas-cliente@test.local');

DELETE FROM public.user_roles WHERE user_id IN (
  '98100000-0000-0000-0000-000000000001', '98100000-0000-0000-0000-000000000003', '98100000-0000-0000-0000-00000000000a');
INSERT INTO public.user_roles (user_id, role)
VALUES
  ('98100000-0000-0000-0000-000000000001', 'admin'),
  ('98100000-0000-0000-0000-000000000003', 'design'),
  ('98100000-0000-0000-0000-00000000000a', 'client');

-- O servidor (dono) grava como a Edge Function: o mesmo pagamento duas vezes vira uma linha só.
INSERT INTO public.licencas_dk_pagamentos (asaas_pagamento_id, cliente_id, referencia, descricao, forma, situacao, bruto, liquido, pago_em, recebido_em)
VALUES ('pay_teste_lic1', '98100000-0000-0000-0000-00000000000a', 'LICC19F9CA5', 'Infraestrutura, servidor e suporte da plataforma', 'CREDIT_CARD', 'confirmado', 597, 571.61, '2026-11-05', '2026-11-05')
ON CONFLICT (asaas_pagamento_id) DO UPDATE SET situacao = EXCLUDED.situacao;
INSERT INTO public.licencas_dk_pagamentos (asaas_pagamento_id, cliente_id, referencia, descricao, forma, situacao, bruto, liquido, pago_em, recebido_em)
VALUES ('pay_teste_lic1', '98100000-0000-0000-0000-00000000000a', 'LICC19F9CA5', 'Infraestrutura, servidor e suporte da plataforma', 'CREDIT_CARD', 'recebido', 597, 571.61, '2026-11-05', '2026-12-05')
ON CONFLICT (asaas_pagamento_id) DO UPDATE SET situacao = EXCLUDED.situacao, recebido_em = EXCLUDED.recebido_em;

SELECT is((SELECT count(*)::int FROM public.licencas_dk_pagamentos WHERE asaas_pagamento_id = 'pay_teste_lic1'), 1, 'o mesmo pagamento do Asaas não duplica');
SELECT is((SELECT situacao FROM public.licencas_dk_pagamentos WHERE asaas_pagamento_id = 'pay_teste_lic1'), 'recebido', 'a segunda leitura atualiza a mesma linha');
SELECT is((SELECT taxa FROM public.licencas_dk_pagamentos WHERE asaas_pagamento_id = 'pay_teste_lic1'), 25.39::numeric, 'a taxa é bruto menos líquido');

SELECT throws_ok(
  $$INSERT INTO public.licencas_dk_pagamentos (asaas_pagamento_id, referencia, situacao, bruto, liquido, recebido_em) VALUES ('pay_x', 'LIC1', 'recebido', 100, 120, '2026-11-01')$$,
  '23514', NULL, 'líquido maior que o bruto é recusado');
SELECT throws_ok(
  $$INSERT INTO public.licencas_dk_pagamentos (asaas_pagamento_id, referencia, situacao, bruto, liquido, recebido_em) VALUES ('pay_y', 'PLANO1', 'recebido', 100, 90, '2026-11-01')$$,
  '23514', NULL, 'referência que não é LIC é recusada');

-- O cliente (mesmo vinculado à linha) não vê nada.
SELECT pg_temp.act_as('98100000-0000-0000-0000-00000000000a');
SELECT is((SELECT count(*)::int FROM public.licencas_dk_pagamentos), 0, 'o cliente não lê as licenças');
SELECT is((SELECT count(*)::int FROM public.licencas_dk_ajuste), 0, 'o cliente não lê o ajuste');
SELECT throws_ok(
  $$INSERT INTO public.licencas_dk_pagamentos (asaas_pagamento_id, referencia, situacao, bruto, liquido, recebido_em) VALUES ('pay_z', 'LIC9', 'recebido', 100, 90, '2026-11-01')$$,
  '42501', NULL, 'o cliente não grava');
RESET ROLE;

-- A equipe também não.
SELECT pg_temp.act_as('98100000-0000-0000-0000-000000000003');
SELECT is((SELECT count(*)::int FROM public.licencas_dk_pagamentos), 0, 'a equipe não lê as licenças');
RESET ROLE;

-- O admin lê, mas não grava pelo app (só o servidor grava).
SELECT pg_temp.act_as('98100000-0000-0000-0000-000000000001');
SELECT is((SELECT count(*)::int FROM public.licencas_dk_pagamentos WHERE asaas_pagamento_id = 'pay_teste_lic1'), 1, 'o admin lê as licenças');
SELECT throws_ok(
  $$UPDATE public.licencas_dk_pagamentos SET bruto = 1 WHERE asaas_pagamento_id = 'pay_teste_lic1'$$,
  '42501', NULL, 'o admin não altera pelo app');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.billing WHERE description ILIKE 'Infraestrutura, servidor e suporte%'), 0, 'nada entra em public.billing, que o cliente lê');

SELECT * FROM finish();
ROLLBACK;
