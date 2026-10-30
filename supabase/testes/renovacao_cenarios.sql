-- Executar SOMENTE em PostgreSQL isolado (PGlite) com o fixture do runner e a
-- migration 20261030190000_renovacao_nasce_no_banco aplicada. Dados sintéticos.
BEGIN;
CREATE TEMP TABLE r(n serial,teste text,ok boolean,detalhe text);
CREATE FUNCTION pg_temp.ok(_teste text,_ok boolean,_detalhe text DEFAULT NULL) RETURNS void LANGUAGE sql AS
$$ INSERT INTO pg_temp.r(teste,ok,detalhe) VALUES(_teste,COALESCE(_ok,false),_detalhe) $$;
CREATE FUNCTION pg_temp.renova(_c uuid) RETURNS date LANGUAGE sql AS $$ SELECT plan_renewal_date FROM public.profiles WHERE id=_c $$;
CREATE FUNCTION pg_temp.qtd(_c uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.billing WHERE client_id=_c $$;

-- Clientes: A ativo (pago no dia), B renovação à frente (cobrança velha), C inativo,
-- D standby, E empresa do grupo, F régua pausada, G com outra vencida, H paga adiantado,
-- I já tem a próxima cobrança, J sem data de renovação.
INSERT INTO public.profiles(id,plan_status,plan_renewal_date,plan_value,plan_name,overdue_since,services_config,cobranca_pausada) VALUES
('a0000000-0000-4000-8000-000000000001','active','2026-11-06',597,'Start','2026-11-06','{}',false),
('b0000000-0000-4000-8000-000000000002','active','2026-11-21',500,NULL,NULL,'{}',false),
('c0000000-0000-4000-8000-000000000003','inactive','2026-11-10',300,'Start',NULL,'{}',false),
('d0000000-0000-4000-8000-000000000004','standby','2026-11-10',797,'Start',NULL,'{}',false),
('e0000000-0000-4000-8000-000000000005','active','2026-11-10',100,'Casa',NULL,'{"internal_company":true}',false),
('f0000000-0000-4000-8000-000000000006','active','2026-11-10',450,'Presença',NULL,'{}',true),
('a1000000-0000-4000-8000-000000000007','active','2026-11-10',550,'Start','2000-01-01','{}',false),
('a2000000-0000-4000-8000-000000000008','active','2026-10-01',700,'Start',NULL,'{}',false),
('a3000000-0000-4000-8000-000000000009','active','2026-11-10',800,'Start',NULL,'{}',false),
('a4000000-0000-4000-8000-000000000010','active',NULL,900,'Start',NULL,'{}',false);

INSERT INTO public.billing(id,client_id,type,amount,due_date,description) VALUES
('10000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','renewal',597,'2026-11-06','Renovação · Start'),
('10000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','renewal',500,'2026-10-21','Renovação Mensal'),
('10000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003','renewal',300,'2026-11-10','x'),
('10000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000004','renewal',797,'2026-11-10','x'),
('10000000-0000-4000-8000-000000000005','e0000000-0000-4000-8000-000000000005','renewal',100,'2026-11-10','x'),
('10000000-0000-4000-8000-000000000006','f0000000-0000-4000-8000-000000000006','renewal',450,'2026-11-10','x'),
('10000000-0000-4000-8000-000000000007','a1000000-0000-4000-8000-000000000007','renewal',550,'2026-11-10','x'),
('10000000-0000-4000-8000-000000000071','a1000000-0000-4000-8000-000000000007','one_off',200,'2000-01-01','vencida'),
('10000000-0000-4000-8000-000000000008','a2000000-0000-4000-8000-000000000008','renewal',700,'2026-10-15','x'),
('10000000-0000-4000-8000-000000000009','a3000000-0000-4000-8000-000000000009','renewal',800,'2026-11-10','x'),
('10000000-0000-4000-8000-000000000091','a3000000-0000-4000-8000-000000000009','renewal',800,'2026-12-10','já existia'),
('10000000-0000-4000-8000-000000000010','a4000000-0000-4000-8000-000000000010','renewal',900,'2026-11-10','x'),
('10000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000001','one_off',150,'2026-11-30','avulso');

INSERT INTO public.projects(id,client_id,status,deleted_at) VALUES
('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','paused',NULL),
('20000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','paused',now()),
('20000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','done',NULL);

-- 1) Pago no dia: avança 1 mês e cria a próxima.
UPDATE public.billing SET status='paid',paid_date='2026-11-06',paid_amount=597 WHERE id='10000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok('pago no dia avança 1 mês',pg_temp.renova('a0000000-0000-4000-8000-000000000001')='2026-12-06',pg_temp.renova('a0000000-0000-4000-8000-000000000001')::text);
SELECT pg_temp.ok('pago no dia cria a próxima pendente com valor e descrição do plano',
  (SELECT count(*)=1 AND bool_and(status='pending' AND type='renewal' AND amount=597 AND description='Renovação · Start')
     FROM public.billing WHERE client_id='a0000000-0000-4000-8000-000000000001' AND due_date='2026-12-06'));
SELECT pg_temp.ok('pago no dia limpa overdue_since',(SELECT overdue_since IS NULL FROM public.profiles WHERE id='a0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('pago no dia reativa projeto pausado (não o apagado nem o concluído)',
  (SELECT string_agg(status,',' ORDER BY id) FROM public.projects WHERE client_id='a0000000-0000-4000-8000-000000000001')='active,paused,done',
  (SELECT string_agg(status,',' ORDER BY id) FROM public.projects WHERE client_id='a0000000-0000-4000-8000-000000000001'));

-- 2) Pagar duas vezes não duplica: paid->paid, desfazer e pagar de novo.
UPDATE public.billing SET status='paid',paid_amount=597 WHERE id='10000000-0000-4000-8000-000000000001';
UPDATE public.billing SET status='pending',paid_date=NULL,paid_amount=NULL WHERE id='10000000-0000-4000-8000-000000000001';
UPDATE public.billing SET status='paid',paid_date='2026-11-07',paid_amount=597 WHERE id='10000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok('pagar duas vezes não avança de novo',pg_temp.renova('a0000000-0000-4000-8000-000000000001')='2026-12-06',pg_temp.renova('a0000000-0000-4000-8000-000000000001')::text);
SELECT pg_temp.ok('pagar duas vezes não duplica a cobrança',pg_temp.qtd('a0000000-0000-4000-8000-000000000001')=3,pg_temp.qtd('a0000000-0000-4000-8000-000000000001')::text);

-- 3) Cobrança velha paga com a renovação já à frente: não mexe.
UPDATE public.billing SET status='paid',paid_date='2026-10-30',paid_amount=500 WHERE id='10000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok('cobrança velha não avança',pg_temp.renova('b0000000-0000-4000-8000-000000000002')='2026-11-21');
SELECT pg_temp.ok('cobrança velha não cria cobrança',pg_temp.qtd('b0000000-0000-4000-8000-000000000002')=1);

-- 4) e 5) Inativo, standby e empresa do grupo: nada.
UPDATE public.billing SET status='paid' WHERE id IN ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005');
SELECT pg_temp.ok('cliente inativo não gera',pg_temp.renova('c0000000-0000-4000-8000-000000000003')='2026-11-10' AND pg_temp.qtd('c0000000-0000-4000-8000-000000000003')=1);
SELECT pg_temp.ok('recorrência pausada (standby) não gera',pg_temp.renova('d0000000-0000-4000-8000-000000000004')='2026-11-10' AND pg_temp.qtd('d0000000-0000-4000-8000-000000000004')=1);
SELECT pg_temp.ok('recorrência pausada (empresa do grupo) não gera',pg_temp.renova('e0000000-0000-4000-8000-000000000005')='2026-11-10' AND pg_temp.qtd('e0000000-0000-4000-8000-000000000005')=1);

-- 6) Régua de cobrança pausada só cala lembrete: a próxima mensalidade nasce.
UPDATE public.billing SET status='paid' WHERE id='10000000-0000-4000-8000-000000000006';
SELECT pg_temp.ok('cobranca_pausada ainda gera a próxima',pg_temp.renova('f0000000-0000-4000-8000-000000000006')='2026-12-10' AND pg_temp.qtd('f0000000-0000-4000-8000-000000000006')=2);

-- 7) Outra cobrança vencida em aberto mantém overdue_since.
UPDATE public.billing SET status='paid' WHERE id='10000000-0000-4000-8000-000000000007';
SELECT pg_temp.ok('sobrou vencida: avança mas mantém overdue_since',
  pg_temp.renova('a1000000-0000-4000-8000-000000000007')='2026-12-10'
  AND (SELECT overdue_since='2000-01-01' FROM public.profiles WHERE id='a1000000-0000-4000-8000-000000000007'));

-- 8) Vencimento pago maior que a renovação: parte dele.
UPDATE public.billing SET status='paid' WHERE id='10000000-0000-4000-8000-000000000008';
SELECT pg_temp.ok('vencimento pago maior parte dele',pg_temp.renova('a2000000-0000-4000-8000-000000000008')='2026-11-15',pg_temp.renova('a2000000-0000-4000-8000-000000000008')::text);

-- 9) Já existe a próxima: avança sem duplicar.
UPDATE public.billing SET status='paid' WHERE id='10000000-0000-4000-8000-000000000009';
SELECT pg_temp.ok('próxima já existente não duplica',pg_temp.renova('a3000000-0000-4000-8000-000000000009')='2026-12-10' AND pg_temp.qtd('a3000000-0000-4000-8000-000000000009')=2);

-- 10) Sem data de renovação: nada.
UPDATE public.billing SET status='paid' WHERE id='10000000-0000-4000-8000-000000000010';
SELECT pg_temp.ok('sem plan_renewal_date não gera',pg_temp.renova('a4000000-0000-4000-8000-000000000010') IS NULL AND pg_temp.qtd('a4000000-0000-4000-8000-000000000010')=1);

-- 11) Cobrança que não é renovação: nada.
UPDATE public.billing SET status='paid' WHERE id='10000000-0000-4000-8000-000000000011';
SELECT pg_temp.ok('avulso pago não mexe na renovação',pg_temp.renova('a0000000-0000-4000-8000-000000000001')='2026-12-06' AND pg_temp.qtd('a0000000-0000-4000-8000-000000000001')=3);

-- 12) Função fechada para anon/authenticated.
SELECT pg_temp.ok('sem EXECUTE para anon',NOT has_function_privilege('anon','app_private.renovacao_ao_pagar()','EXECUTE'));
SELECT pg_temp.ok('sem EXECUTE para authenticated',NOT has_function_privilege('authenticated','app_private.renovacao_ao_pagar()','EXECUTE'));
SELECT pg_temp.ok('função SECURITY DEFINER com search_path fixo',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='app_private.renovacao_ao_pagar()'::regprocedure),
  (SELECT proconfig::text FROM pg_proc WHERE oid='app_private.renovacao_ao_pagar()'::regprocedure));

SELECT n,teste,ok,detalhe FROM pg_temp.r ORDER BY n;
ROLLBACK;
