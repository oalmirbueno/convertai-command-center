-- Contrato real em PostgreSQL descartável. Todos os registros são fictícios.
DO $$ BEGIN IF current_database()<>'membros_test' THEN RAISE EXCEPTION 'Banco descartável obrigatório'; END IF; END $$;
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('00000000-0000-0000-0000-000000000006','equipe-renovacao@example.invalid',now()),
 ('00000000-0000-0000-0000-000000000007','admin-nao-confirmado@example.invalid',NULL);
INSERT INTO public.user_roles(user_id,role) VALUES
 ('00000000-0000-0000-0000-000000000006','design'),
 ('00000000-0000-0000-0000-000000000007','admin');
INSERT INTO public.membros_produtos(id,titulo,estado)
 SELECT ('32000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Teste renovação '||i,
 CASE WHEN i=6 THEN 'rascunho' ELSE 'publicado' END FROM generate_series(1,12) i;
INSERT INTO public.membros_ferramentas(produto_id,motor,ativo)
 SELECT id,CASE WHEN id='32000000-0000-0000-0000-000000000004' THEN 'proxima_resposta' ELSE 'crm' END,
 id<>'32000000-0000-0000-0000-000000000005' FROM public.membros_produtos WHERE id::text LIKE '32000000-%';
INSERT INTO public.membros_licencas(id,produto_id,user_id,origem,referencia,confirmado_em,criado_em,revogado_em,suspenso_em)
 SELECT ('62000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 ('32000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 CASE WHEN i=12 THEN '00000000-0000-0000-0000-000000000005'::uuid ELSE '00000000-0000-0000-0000-000000000002'::uuid END,
 'validacao_manual','fonte-'||i,
 CASE WHEN i IN(1,10) THEN now()-interval '13 months' WHEN i=8 THEN now()+interval '1 day' ELSE now()-interval '1 month' END,
 now()-interval '1 day',CASE WHEN i=7 THEN now()-interval '1 hour' END,
 CASE WHEN i=3 THEN now()-interval '1 hour' END FROM generate_series(1,12) i;
-- Outro período pode terminar depois da fonte mais recente: a renovação guarda todo o prazo restante.
INSERT INTO public.membros_licencas(id,produto_id,user_id,origem,referencia,confirmado_em,criado_em) VALUES
 ('62000000-0000-0000-0000-000000000099','32000000-0000-0000-0000-000000000009',
 '00000000-0000-0000-0000-000000000002','pagamento','periodo-antigo-mais-longo',now()-interval '1 day',now()-interval '2 days');
INSERT INTO public.membros_licencas(id,produto_id,user_id,origem,referencia,confirmado_em,criado_em,revogado_em) VALUES
 ('62000000-0000-0000-0000-000000000097','32000000-0000-0000-0000-000000000009',
 '00000000-0000-0000-0000-000000000002','pagamento','periodo-revogado-ignorado',now()+interval '1 year',now()-interval '3 days',now());
INSERT INTO public.membros_crm_contatos(id,user_id,produto_id,nome,empresa) VALUES
 ('72000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',
 '32000000-0000-0000-0000-000000000001','Contato anterior à renovação','Empresa fictícia');
INSERT INTO public.membros_crm_negocios(id,user_id,produto_id,contato_id,titulo,estagio,valor,proxima_acao) VALUES
 ('82000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',
 '32000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','Negócio anterior à renovação','proposta',321.45,'Conferir preservação');
INSERT INTO public.membros_ferramentas_historico(user_id,produto_id,ator,acao,registro_id) VALUES
 ('00000000-0000-0000-0000-000000000002','32000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000002','salvar_negocio','82000000-0000-0000-0000-000000000001');
SELECT set_config('test.renovacao.licencas',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id)::text FROM public.membros_licencas l),false);
SELECT set_config('test.renovacao.historico',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id)::text FROM public.membros_ferramentas_historico h),false);
SELECT set_config('test.renovacao.contatos',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id)::text FROM public.membros_crm_contatos c),false);
SELECT set_config('test.renovacao.negocios',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id)::text FROM public.membros_crm_negocios n),false);
SELECT set_config('test.renovacao.acessos',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb)::text FROM public.membros_acessos a),false);
SELECT set_config('test.renovacao.gateways',(SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY id),'[]'::jsonb)::text FROM public.vendas_integracoes v),false);

SELECT public.testar(NOT has_function_privilege('anon','public.membros_crm_licenca_renovacao_previa(uuid)','execute')
 AND NOT has_function_privilege('service_role','public.membros_crm_licenca_renovar(uuid,timestamptz,timestamptz,timestamptz)','execute'),
 'renovação administrativa não é executável por anônimo ou service_role');
SET ROLE anon;
SELECT set_config('request.jwt.claim.sub','',false);
SELECT public.testar(public.recusa('select public.membros_crm_licenca_renovacao_previa(''62000000-0000-0000-0000-000000000001'')')
 AND public.recusa('select public.membros_crm_licenca_renovar(''62000000-0000-0000-0000-000000000001'',now(),now())'),'anônimo não confere nem confirma renovação');
RESET ROLE;
SET ROLE authenticated;
DO $$ DECLARE usuario uuid; BEGIN
 FOREACH usuario IN ARRAY ARRAY['00000000-0000-0000-0000-000000000002'::uuid,
 '00000000-0000-0000-0000-000000000006'::uuid,'00000000-0000-0000-0000-000000000007'::uuid] LOOP
  PERFORM set_config('request.jwt.claim.sub',usuario::text,true);
  PERFORM public.testar(public.recusa('select public.membros_crm_licenca_renovacao_previa(''62000000-0000-0000-0000-000000000001'')')
   AND public.recusa('select public.membros_crm_licenca_renovar(''62000000-0000-0000-0000-000000000001'',now(),now())'),
   'membro, equipe e admin não confirmado não renovam');
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE i integer; alvo uuid; BEGIN
 FOREACH i IN ARRAY ARRAY[4,5,6,7,8,12,98] LOOP
  alvo:=('62000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid;
  BEGIN
   PERFORM public.membros_crm_licenca_renovacao_previa(alvo);
   RAISE EXCEPTION 'Prévia indevida';
  EXCEPTION WHEN invalid_parameter_value THEN
   PERFORM public.testar(true,'recusa outro motor, ferramenta inativa, rascunho, revogada, futura, titular não confirmado ou ID inexistente');
  END;
  BEGIN
   PERFORM public.membros_crm_licenca_renovar(alvo,clock_timestamp(),clock_timestamp(),NULL);
   RAISE EXCEPTION 'Confirmou renovação indevida';
  EXCEPTION WHEN invalid_parameter_value THEN
   PERFORM public.testar(true,'confirmação repete a elegibilidade do motor, produto, titular e licença');
  END;
 END LOOP;
 BEGIN
  PERFORM public.membros_crm_licenca_renovacao_previa('62000000-0000-0000-0000-000000000099');
  RAISE EXCEPTION 'Renovou fonte antiga';
 EXCEPTION WHEN invalid_parameter_value THEN PERFORM public.testar(true,'somente o período criado mais recentemente pode iniciar renovação'); END;
END $$;
SELECT set_config('test.renovacao.previa_vencida',public.membros_crm_licenca_renovacao_previa('62000000-0000-0000-0000-000000000001')::text,false);
SELECT set_config('test.renovacao.previa_ativa',public.membros_crm_licenca_renovacao_previa('62000000-0000-0000-0000-000000000002')::text,false);
SELECT set_config('test.renovacao.previa_suspensa',public.membros_crm_licenca_renovacao_previa('62000000-0000-0000-0000-000000000003')::text,false);
SELECT public.testar((public.membros_crm_licenca_renovacao_previa('62000000-0000-0000-0000-000000000009')->>'inicio')::timestamptz
 =(SELECT (l->>'fim')::timestamptz FROM jsonb_array_elements(current_setting('test.renovacao.licencas')::jsonb) l WHERE l->>'id'='62000000-0000-0000-0000-000000000099'),
 'base preserva o maior fim de todos os períodos não revogados, inclusive um período antigo mais longo');
RESET ROLE;
SELECT public.testar((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.membros_licencas l)=current_setting('test.renovacao.licencas')::jsonb
 AND (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.membros_ferramentas_historico h)=current_setting('test.renovacao.historico')::jsonb,
 'prévias e recusas não escrevem licença nem histórico');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE p jsonb:=current_setting('test.renovacao.previa_ativa')::jsonb; inicio timestamptz; BEGIN
 FOREACH inicio IN ARRAY ARRAY[(p->>'inicio')::timestamptz-interval '1 second',(p->>'inicio')::timestamptz+interval '1 second',clock_timestamp()] LOOP
  BEGIN
   PERFORM public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,inicio,(p->>'fim_anterior')::timestamptz,NULL);
   RAISE EXCEPTION 'Aceitou base futura arbitrária';
  EXCEPTION WHEN serialization_failure THEN PERFORM public.testar(true,'licença vigente exige a base futura exata da prévia'); END;
 END LOOP;
END $$;
DO $$ DECLARE p jsonb; r jsonb; repetida jsonb; BEGIN
 p:=current_setting('test.renovacao.previa_vencida')::jsonb;
 r:=public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,(p->>'inicio')::timestamptz,(p->>'fim_anterior')::timestamptz,NULL);
 PERFORM set_config('test.renovacao.nova_vencida',r::text,false);
 PERFORM public.testar(NOT (r->>'ja_renovada')::boolean AND r->>'licenca_nova_id' IS NOT NULL
  AND r->>'licenca_nova_id'<>p->>'licenca_anterior_id' AND r->>'user_id'=p->>'user_id'
  AND r->>'produto_id'=p->>'produto_id' AND r->>'inicio'=p->>'inicio','vencimento cria um período novo do mesmo titular/produto no instante confirmado');
 repetida:=public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,(p->>'inicio')::timestamptz,(p->>'fim_anterior')::timestamptz,NULL);
 PERFORM public.testar((repetida->>'ja_renovada')::boolean AND repetida->>'licenca_nova_id'=r->>'licenca_nova_id',
  'retry devolve a mesma concessão, sem novo período');
 p:=current_setting('test.renovacao.previa_ativa')::jsonb;
 r:=public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,(p->>'inicio')::timestamptz,(p->>'fim_anterior')::timestamptz,NULL);
 PERFORM public.testar((r->>'inicio')::timestamptz=(p->>'fim_anterior')::timestamptz
  AND (r->>'fim')::timestamptz=(((r->>'inicio')::timestamptz AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC','renovação vigente acrescenta 12 meses depois do prazo restante');
 p:=current_setting('test.renovacao.previa_suspensa')::jsonb;
 r:=public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,(p->>'inicio')::timestamptz,(p->>'fim_anterior')::timestamptz,(p->>'suspenso_em')::timestamptz);
 PERFORM set_config('test.renovacao.nova_suspensa',r::text,false);
 PERFORM public.testar(r->>'suspenso_em'=p->>'suspenso_em','renovação preserva a suspensão do titular');
END $$;
-- Testa a janela curta sem token extra: timestamp antigo/futuro/arbitrário não é aceito.
DO $$ DECLARE p jsonb; inicio timestamptz; BEGIN
 p:=public.membros_crm_licenca_renovacao_previa('62000000-0000-0000-0000-000000000010');
 FOREACH inicio IN ARRAY ARRAY[clock_timestamp()-interval '6 minutes',clock_timestamp()+interval '1 day','infinity'::timestamptz,NULL::timestamptz] LOOP
  BEGIN
   PERFORM public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,inicio,(p->>'fim_anterior')::timestamptz,NULL);
   RAISE EXCEPTION 'Aceitou início fora da janela';
  EXCEPTION WHEN serialization_failure THEN PERFORM public.testar(true,'prévia vencida ou início arbitrário pede nova confirmação'); END;
 END LOOP;
 BEGIN
  PERFORM public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,(p->>'inicio')::timestamptz,(p->>'fim_anterior')::timestamptz+interval '1 second',NULL);
  RAISE EXCEPTION 'Aceitou fim anterior diferente';
 EXCEPTION WHEN serialization_failure THEN PERFORM public.testar(true,'fim anterior diferente invalida a confirmação'); END;
END $$;
SAVEPOINT previa_suspensao;
SELECT set_config('test.renovacao.stale',public.membros_crm_licenca_renovacao_previa('62000000-0000-0000-0000-000000000010')::text,false);
SELECT public.membros_crm_licenca_suspender('62000000-0000-0000-0000-000000000010');
DO $$ DECLARE p jsonb:=current_setting('test.renovacao.stale')::jsonb; BEGIN
 BEGIN
  PERFORM public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,(p->>'inicio')::timestamptz,(p->>'fim_anterior')::timestamptz,NULL);
  RAISE EXCEPTION 'Confirmou suspensão alterada';
 EXCEPTION WHEN serialization_failure THEN PERFORM public.testar(true,'suspensão ocorrida depois da prévia impede renovação desatualizada'); END;
END $$;
ROLLBACK TO previa_suspensao;
RELEASE previa_suspensao;
RESET ROLE;
SAVEPOINT historico_atomico;
CREATE FUNCTION public.testar_renovacao_historico_falhar() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
 BEGIN RAISE EXCEPTION 'TESTE_RENOVACAO_HISTORICO_INTERROMPIDO'; END $$;
CREATE TRIGGER testar_renovacao_historico BEFORE INSERT ON public.membros_ferramentas_historico
 FOR EACH ROW WHEN (NEW.acao='crm_licenca_renovada_manual') EXECUTE FUNCTION public.testar_renovacao_historico_falhar();
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE p jsonb; BEGIN
 p:=public.membros_crm_licenca_renovacao_previa('62000000-0000-0000-0000-000000000010');
 BEGIN
  PERFORM public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,(p->>'inicio')::timestamptz,(p->>'fim_anterior')::timestamptz,NULL);
  RAISE EXCEPTION 'Aceitou histórico interrompido';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'TESTE_RENOVACAO_HISTORICO_INTERROMPIDO' THEN RAISE; END IF;
  PERFORM public.testar(true,'falha de histórico faz a confirmação falhar por inteiro');
 END;
END $$;
RESET ROLE;
SELECT public.testar(NOT EXISTS(SELECT 1 FROM public.membros_licencas
 WHERE referencia='renovacao-manual-crm:62000000-0000-0000-0000-000000000010'),
 'falha no histórico não deixa licença nova parcialmente salva');
ROLLBACK TO historico_atomico;
RELEASE historico_atomico;
-- Uma fonte que vence entre a prévia e a confirmação pode aproveitar a mesma janela.
SAVEPOINT virada_vencimento;
UPDATE public.membros_licencas SET confirmado_em=((clock_timestamp() AT TIME ZONE 'UTC')-interval '12 months'+interval '2 seconds') AT TIME ZONE 'UTC'
 WHERE id='62000000-0000-0000-0000-000000000011';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE p jsonb; r jsonb; BEGIN
 p:=public.membros_crm_licenca_renovacao_previa('62000000-0000-0000-0000-000000000011');
 PERFORM public.testar((p->>'inicio')::timestamptz=(p->>'fim_anterior')::timestamptz AND (p->>'inicio')::timestamptz>clock_timestamp(),'prévia da virada captura prazo ainda vigente');
 PERFORM pg_sleep(2.2);
 r:=public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,(p->>'inicio')::timestamptz,(p->>'fim_anterior')::timestamptz,NULL);
 PERFORM public.testar((r->>'inicio')::timestamptz=(p->>'fim_anterior')::timestamptz,'aceita a virada de vencimento recente dentro dos 5 minutos');
END $$;
ROLLBACK TO virada_vencimento;
RELEASE virada_vencimento;
RESET ROLE;
-- Um bloqueio posterior da concessão nova nunca é desfeito por retry da fonte antiga.
UPDATE public.membros_licencas SET suspenso_em=now(),revogado_em=now()
 WHERE id=(current_setting('test.renovacao.nova_vencida')::jsonb->>'licenca_nova_id')::uuid;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE p jsonb:=current_setting('test.renovacao.previa_vencida')::jsonb; r jsonb; BEGIN
 r:=public.membros_crm_licenca_renovar((p->>'licenca_anterior_id')::uuid,(p->>'inicio')::timestamptz,(p->>'fim_anterior')::timestamptz,NULL);
 PERFORM public.testar((r->>'ja_renovada')::boolean AND r->>'suspenso_em' IS NOT NULL,'retry reconhece novo período já bloqueado sem levantar suspensão');
END $$;
RESET ROLE;
SELECT public.testar((SELECT revogado_em IS NOT NULL AND suspenso_em IS NOT NULL FROM public.membros_licencas
 WHERE id=(current_setting('test.renovacao.nova_vencida')::jsonb->>'licenca_nova_id')::uuid),'retry não remove revogação nem suspensão da concessão nova');
SELECT public.testar((SELECT count(*) FROM public.membros_licencas WHERE referencia LIKE 'renovacao-manual-crm:%')=3
 AND (SELECT count(*) FROM public.membros_ferramentas_historico WHERE acao='crm_licenca_renovada_manual')=3,
 'três confirmações reais geram somente três períodos e três linhas de histórico');
SELECT public.testar(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_setting('test.renovacao.licencas')::jsonb) original
 LEFT JOIN public.membros_licencas l ON l.id=(original->>'id')::uuid WHERE to_jsonb(l) IS DISTINCT FROM original),
 'todas as licenças anteriores permanecem integralmente idênticas');
SELECT public.testar(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_setting('test.renovacao.historico')::jsonb) original
 LEFT JOIN public.membros_ferramentas_historico h ON h.id=(original->>'id')::bigint WHERE to_jsonb(h) IS DISTINCT FROM original),
 'histórico anterior não é editado nem removido');
SELECT public.testar((SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.membros_crm_contatos c)=current_setting('test.renovacao.contatos')::jsonb
 AND (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.membros_crm_negocios n)=current_setting('test.renovacao.negocios')::jsonb,
 'contatos e negócios anteriores preservam todos os campos e versões');
SELECT public.testar((SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.membros_acessos a)=current_setting('test.renovacao.acessos')::jsonb
 AND (SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY id),'[]'::jsonb) FROM public.vendas_integracoes v)=current_setting('test.renovacao.gateways')::jsonb
 AND NOT public.membros_pagamentos_habilitados(),'renovação não concede acervo nem altera gateways ou liberação automática');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
SELECT public.testar(public.recusa('select public.membros_acervo(''32000000-0000-0000-0000-000000000001'')'),'licença renovada não autoriza acervo do produto');
RESET ROLE;
SELECT public.testar(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('membros_crm_licenca_renovacao_previa','membros_crm_licenca_renovar')
 AND (NOT p.prosecdef OR NOT COALESCE('search_path=""'=ANY(p.proconfig),false))),'renovação usa funções administrativas com busca fixa');
ROLLBACK;
