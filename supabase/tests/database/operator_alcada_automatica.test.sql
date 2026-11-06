-- Alçada automática: dentro da faixa o pedido nasce aprovado; fora dela,
-- segue pendente para o dono. Fixtures sintéticas, tudo em rollback.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT * FROM no_plan();

-- Estrutura e privilégios -------------------------------------------------
SELECT has_table('public', 'operator_alcadas', 'a alçada existe');
SELECT has_column('public', 'operator_approvals', 'alcada_id', 'a aprovação lembra a alçada');

SELECT throws_ok(
  $$INSERT INTO public.operator_alcadas (action_kind) VALUES ('gastar')$$,
  '23514', NULL,
  'gastar (saldo, dívida) nunca entra na alçada'
);
SELECT throws_ok(
  $$INSERT INTO public.operator_alcadas (action_kind) VALUES ('contatar_cliente')$$,
  '23514', NULL,
  'contatar cliente nunca entra na alçada'
);

SELECT is(has_function_privilege('authenticated',
  'public.operator_alcada_avaliar(text,uuid,text,numeric,boolean,jsonb)', 'EXECUTE'),
  false, 'ninguém de fora chama a avaliação interna');
SELECT is(has_function_privilege('anon',
  'public.operator_alcada_definir(text,uuid,text,boolean,numeric,numeric,numeric,boolean,text)', 'EXECUTE'),
  false, 'anon não define alçada');
SELECT is(has_function_privilege('authenticated',
  'public.operator_alcada_avisar_dia()', 'EXECUTE'),
  false, 'o aviso do dia é só do cron');

-- Fixtures -----------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('a4100000-0000-4000-8000-000000000001', 'alcada-admin@test.local'),
  ('a4100000-0000-4000-8000-00000000000a', 'alcada-cliente-a@test.local'),
  ('a4100000-0000-4000-8000-00000000000b', 'alcada-cliente-b@test.local');
DELETE FROM public.user_roles WHERE user_id = 'a4100000-0000-4000-8000-000000000001';
INSERT INTO public.user_roles (user_id, role) VALUES
  ('a4100000-0000-4000-8000-000000000001', 'admin'::public.app_role);

INSERT INTO public.projects (id, client_id, name, project_type, status, start_date, deadline, billing_mode) VALUES
  ('a4200000-0000-4000-8000-00000000000a', 'a4100000-0000-4000-8000-00000000000a', 'Alçada A', 'recurring', 'active', current_date, current_date + 30, 'included'),
  ('a4200000-0000-4000-8000-00000000000b', 'a4100000-0000-4000-8000-00000000000b', 'Alçada B', 'recurring', 'active', current_date, current_date + 30, 'included');
INSERT INTO public.tasks (id, project_id, title) VALUES
  ('a4300000-0000-4000-8000-00000000000a', 'a4200000-0000-4000-8000-00000000000a', 'Tráfego A'),
  ('a4300000-0000-4000-8000-00000000000b', 'a4200000-0000-4000-8000-00000000000b', 'Tráfego B');

INSERT INTO public.internal_operators (id, slug, display_name, role, scope, hermes_profile_ref, status) VALUES
  ('a4400000-0000-4000-8000-000000000001', 'pgtap-trafego', 'pgTAP Tráfego', 'Tráfego', 'Meta', 'hermes:pgtap-trafego', 'active');
INSERT INTO public.operator_task_links (id, operator_id, kanban_task_id) VALUES
  ('a4500000-0000-4000-8000-00000000000a', 'a4400000-0000-4000-8000-000000000001', 'a4300000-0000-4000-8000-00000000000a'),
  ('a4500000-0000-4000-8000-00000000000b', 'a4400000-0000-4000-8000-000000000001', 'a4300000-0000-4000-8000-00000000000b');

-- Faixa conhecida para o teste, independente do padrão semeado.
DELETE FROM public.operator_alcadas;
INSERT INTO public.operator_alcadas (action_kind, valor_max_por_acao, teto_mensal, aumento_max_pct, exige_plano_aprovado) VALUES
  ('alterar_orcamento', 300, 500, 20, false),
  ('publicar', 0, NULL, NULL, true);

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb);
CREATE FUNCTION pg_temp.pede(_k text, _link uuid, _kind text, _custo numeric, _payload jsonb, _rev boolean DEFAULT true)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO r VALUES (_k, public.operator_request_approval(
    'pgtap-trafego', _link, _kind, 'ação concreta de teste', 'motivo concreto de teste',
    _payload, _custo_previsto => _custo, _reversivel => _rev));
$$;

SELECT pg_temp.pede('dentro', 'a4500000-0000-4000-8000-00000000000a', 'alterar_orcamento', 200, '{"aumento_pct": 15}');
SELECT pg_temp.pede('aumento', 'a4500000-0000-4000-8000-00000000000a', 'alterar_orcamento', 100, '{"aumento_pct": 30}');
SELECT pg_temp.pede('valor', 'a4500000-0000-4000-8000-00000000000a', 'alterar_orcamento', 400, '{}');
SELECT pg_temp.pede('gastar', 'a4500000-0000-4000-8000-00000000000a', 'gastar', 10, '{}');
SELECT pg_temp.pede('sem_plano', 'a4500000-0000-4000-8000-00000000000a', 'publicar', NULL, '{}');
SELECT pg_temp.pede('com_plano', 'a4500000-0000-4000-8000-00000000000a', 'publicar', NULL, '{"plano_ref": "calendário novembro"}');
SELECT pg_temp.pede('irreversivel', 'a4500000-0000-4000-8000-00000000000a', 'alterar_orcamento', 0, '{}', false);
SELECT pg_temp.pede('divergente', 'a4500000-0000-4000-8000-00000000000a', 'alterar_orcamento', 0, '{"client_id": "a4100000-0000-4000-8000-00000000000b"}');
SELECT pg_temp.pede('teto_ok', 'a4500000-0000-4000-8000-00000000000a', 'alterar_orcamento', 300, '{}');
SELECT pg_temp.pede('teto_estourado', 'a4500000-0000-4000-8000-00000000000a', 'alterar_orcamento', 100, '{}');

SELECT is((SELECT v->>'status' FROM r WHERE k = 'dentro'), 'aprovado', 'subir 15% com R$ 200 cabe na alçada');
SELECT is((SELECT v->>'aprovado_por' FROM r WHERE k = 'dentro'), 'alcada', 'a resposta diz que foi a alçada');
SELECT is((SELECT v->>'status' FROM r WHERE k = 'aumento'), 'pendente', 'subir 30% passa da alçada');
SELECT is((SELECT v->>'status' FROM r WHERE k = 'valor'), 'pendente', 'R$ 400 numa ação passa da alçada');
SELECT is((SELECT v->>'status' FROM r WHERE k = 'gastar'), 'pendente', 'gastar continua com o dono');
SELECT is((SELECT v->>'status' FROM r WHERE k = 'sem_plano'), 'pendente', 'publicar sem plano aprovado pede ao dono');
SELECT is((SELECT v->>'status' FROM r WHERE k = 'com_plano'), 'aprovado', 'publicar o que está no plano cabe');
SELECT is((SELECT v->>'status' FROM r WHERE k = 'irreversivel'), 'pendente', 'ação irreversível fica com o dono');
SELECT is((SELECT v->>'status' FROM r WHERE k = 'divergente'), 'pendente', 'client_id diferente do da tarefa não usa alçada');
SELECT is((SELECT v->>'status' FROM r WHERE k = 'teto_ok'), 'aprovado', 'R$ 500 no mês ainda cabe no teto');
SELECT is((SELECT v->>'status' FROM r WHERE k = 'teto_estourado'), 'pendente', 'passar do teto mensal pede ao dono');

SELECT is(
  (SELECT count(*)::int FROM public.operator_ordens_abertas('pgtap-trafego')),
  3, 'o que a alçada aprovou já aparece como ordem aberta');

SELECT is(
  (SELECT decided_by FROM public.operator_approvals WHERE id = (SELECT (v->>'approval_id')::uuid FROM r WHERE k = 'dentro')),
  NULL, 'aprovado pela alçada não finge ter um humano como decisor');

-- Desligar só para um cliente --------------------------------------------
SET LOCAL request.jwt.claim.sub = 'a4100000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claims = '{"sub": "a4100000-0000-4000-8000-000000000001", "role": "authenticated"}';
SELECT is(
  (public.operator_alcada_definir('alterar_orcamento', 'a4100000-0000-4000-8000-00000000000b', _ativo => false))->>'ok',
  'true', 'o dono desliga a alçada de um cliente');
RESET request.jwt.claim.sub;
RESET request.jwt.claims;

SELECT pg_temp.pede('b_desligado', 'a4500000-0000-4000-8000-00000000000b', 'alterar_orcamento', 0, '{}');
SELECT is((SELECT v->>'status' FROM r WHERE k = 'b_desligado'), 'pendente', 'cliente desligado volta a pedir ao dono');

SET LOCAL request.jwt.claim.sub = 'a4100000-0000-4000-8000-00000000000a';
SET LOCAL request.jwt.claims = '{"sub": "a4100000-0000-4000-8000-00000000000a", "role": "authenticated"}';
SELECT throws_like(
  $$SELECT public.operator_alcada_definir('publicar')$$,
  'apenas_admin%', 'só o dono define alçada');
RESET request.jwt.claim.sub;
RESET request.jwt.claims;

SELECT * FROM finish();
ROLLBACK;
