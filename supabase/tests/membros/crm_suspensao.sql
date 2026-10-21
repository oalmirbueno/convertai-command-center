-- Contrato real em PostgreSQL descartável; todos os dados abaixo são fictícios.
DO $$ BEGIN IF current_database()<>'membros_test' THEN RAISE EXCEPTION 'Banco descartável obrigatório'; END IF; END $$;
BEGIN;

INSERT INTO public.membros_produtos(id,titulo,estado) VALUES
 ('31000000-0000-0000-0000-000000000001','CRM isolado para suspensão','publicado'),
 ('31000000-0000-0000-0000-000000000002','Outro motor isolado','publicado');
INSERT INTO public.membros_ferramentas(produto_id,motor,ativo) VALUES
 ('31000000-0000-0000-0000-000000000001','crm',true),
 ('31000000-0000-0000-0000-000000000002','proxima_resposta',true);
INSERT INTO public.membros_licencas(id,produto_id,user_id,origem,referencia,confirmado_em,revogado_em,suspenso_em) VALUES
 ('61000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','validacao_manual','validacao-inicial',now()-interval '1 day',null,null),
 ('61000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','validacao_manual','outro-titular',now()-interval '1 day',null,null),
 ('61000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','validacao_manual','vencida',now()-interval '13 months',null,now()-interval '1 hour'),
 ('61000000-0000-0000-0000-000000000004','31000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','pagamento','revogada',now()-interval '1 day',now()-interval '1 hour',now()-interval '1 hour'),
 ('61000000-0000-0000-0000-000000000005','31000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','validacao_manual','outro-motor',now()-interval '1 day',null,null),
 ('61000000-0000-0000-0000-000000000006','31000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','validacao_manual','futura',now()+interval '1 day',null,now()-interval '1 hour');

SELECT set_config('test.crm.licenca_antes',(
 SELECT (to_jsonb(l)-'suspenso_em')::text FROM public.membros_licencas l
 WHERE id='61000000-0000-0000-0000-000000000001'),false);
SELECT set_config('test.crm.outras_antes',(
 SELECT jsonb_agg(to_jsonb(l) ORDER BY id)::text FROM public.membros_licencas l
 WHERE produto_id IN('31000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002')
 AND id<>'61000000-0000-0000-0000-000000000001'),false);

SELECT public.testar(has_function_privilege('authenticated','public.membros_crm_licenca_suspender(uuid)','execute')
 AND has_function_privilege('authenticated','public.membros_crm_licenca_reativar(uuid)','execute'),'RPCs disponíveis para authenticated com autorização interna');
SELECT public.testar(NOT has_function_privilege('anon','public.membros_crm_licenca_suspender(uuid)','execute')
 AND NOT has_function_privilege('anon','public.membros_crm_licenca_reativar(uuid)','execute')
 AND NOT has_function_privilege('service_role','public.membros_crm_licenca_suspender(uuid)','execute')
 AND NOT has_function_privilege('service_role','public.membros_crm_licenca_reativar(uuid)','execute'),'RPCs sem execução anônima, PUBLIC ou service_role');
SET ROLE anon;
SELECT set_config('request.jwt.claim.sub','',false);
SELECT public.testar(public.recusa('select public.membros_crm_licenca_suspender(''61000000-0000-0000-0000-000000000001'')')
 AND public.recusa('select public.membros_crm_licenca_reativar(''61000000-0000-0000-0000-000000000001'')'),'anônimo não suspende nem reativa');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
SELECT public.testar(public.recusa('select public.membros_crm_licenca_suspender(''61000000-0000-0000-0000-000000000001'')')
 AND public.recusa('select public.membros_crm_licenca_reativar(''61000000-0000-0000-0000-000000000001'')'),'titular não suspende nem reativa a própria licença');
SELECT public.testar(public.recusa('update public.membros_licencas set suspenso_em=null'),'titular não contorna suspensão pela tabela');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT public.testar(public.recusa('select public.membros_ferramenta_sessao(''31000000-0000-0000-0000-000000000001'',repeat(''c'',64))'),'admin sem licença própria não recebe atalho de acesso');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
SELECT public.membros_ferramenta_sessao('31000000-0000-0000-0000-000000000001',repeat('c',64));
SELECT public.membros_crm_operar('31000000-0000-0000-0000-000000000001',repeat('c',64),'salvar_contato',
 '{"id":"71000000-0000-0000-0000-000000000001","nome":"Contato fictício preservado","empresa":"Teste descartável"}');
SELECT public.membros_crm_operar('31000000-0000-0000-0000-000000000001',repeat('c',64),'salvar_negocio',
 '{"id":"81000000-0000-0000-0000-000000000001","titulo":"Negócio fictício preservado","contato_id":"71000000-0000-0000-0000-000000000001","estagio":"proposta","valor":123,"proxima_acao":"Conferir persistência"}');
SELECT set_config('test.crm.dados_antes',public.membros_crm_operar('31000000-0000-0000-0000-000000000001',repeat('c',64))::text,false);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT public.membros_crm_licenca_suspender('61000000-0000-0000-0000-000000000001');
SELECT public.testar(EXISTS(SELECT 1 FROM jsonb_array_elements(public.membros_ferramentas_admin()->'licencas') l
 WHERE l->>'id'='61000000-0000-0000-0000-000000000001' AND l->>'suspenso_em' IS NOT NULL
 AND l->>'revogado_em' IS NULL),'JSON administrativo inclui suspensão sem revogação');
RESET ROLE;
-- Usa um carimbo distinto de now() para provar que a repetição não regrava a data.
UPDATE public.membros_licencas SET suspenso_em=now()-interval '1 second'
 WHERE id='61000000-0000-0000-0000-000000000001';
SELECT set_config('test.crm.suspenso_antes',(SELECT suspenso_em::text FROM public.membros_licencas
 WHERE id='61000000-0000-0000-0000-000000000001'),false);
SET ROLE authenticated;
SELECT public.membros_crm_licenca_suspender('61000000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT public.testar((SELECT suspenso_em=current_setting('test.crm.suspenso_antes')::timestamptz
 AND to_jsonb(l)-'suspenso_em'=current_setting('test.crm.licenca_antes')::jsonb
 FROM public.membros_licencas l WHERE id='61000000-0000-0000-0000-000000000001'),'suspensão repetida preserva carimbo, identidade e vigência');
SELECT public.testar((SELECT count(*) FROM public.membros_ferramentas_historico
 WHERE registro_id='61000000-0000-0000-0000-000000000001' AND acao='crm_licenca_suspensa'
 AND ator='00000000-0000-0000-0000-000000000001')=1,'uma linha de histórico por suspensão real');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
SELECT public.testar(EXISTS(SELECT 1 FROM jsonb_array_elements(public.membros_ferramentas_catalogo()) f
 WHERE f->>'produto_id'='31000000-0000-0000-0000-000000000001' AND f->>'fim' IS NULL),'catálogo não apresenta licença suspensa como liberada');
SELECT public.testar(EXISTS(SELECT 1 FROM jsonb_array_elements(public.membros_ferramentas_catalogo()) f
 WHERE f->>'produto_id'='31000000-0000-0000-0000-000000000002' AND f->>'fim' IS NOT NULL),'outro produto do titular continua liberado');
SELECT public.testar(public.recusa('select public.membros_ferramenta_sessao(''31000000-0000-0000-0000-000000000001'',repeat(''c'',64),true)'),'suspensão impede renovar ou substituir sessão');
SELECT public.testar(public.recusa('select public.membros_crm_operar(''31000000-0000-0000-0000-000000000001'',repeat(''c'',64))'),'sessão aberta antes da suspensão não lê CRM');
SELECT public.testar(public.recusa('select public.membros_crm_operar(''31000000-0000-0000-0000-000000000001'',repeat(''c'',64),''salvar_contato'',''{"id":"71000000-0000-0000-0000-000000000001","nome":"Alteração proibida","versao":1}'')'),'sessão aberta antes da suspensão não altera contato');
SELECT public.testar(public.recusa('select public.membros_crm_operar(''31000000-0000-0000-0000-000000000001'',repeat(''c'',64),''salvar_negocio'',''{"id":"81000000-0000-0000-0000-000000000001","titulo":"Alteração proibida","estagio":"ganho","versao":1}'')'),'sessão aberta antes da suspensão não altera negócio');
SELECT public.testar(public.recusa('select public.membros_crm_operar(''31000000-0000-0000-0000-000000000001'',repeat(''c'',64),''salvar_contato'',''{"nome":"Inserção proibida"}'')'),'suspensão também impede novos registros');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
SELECT public.membros_ferramenta_sessao('31000000-0000-0000-0000-000000000001',repeat('d',64));
SELECT public.testar(jsonb_array_length(public.membros_crm_operar('31000000-0000-0000-0000-000000000001',repeat('d',64))->'contatos')=0,'outro titular do mesmo produto continua usando seu CRM isolado');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT public.testar((public.membros_ferramentas_admin('00000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000001')
 -'ferramentas'-'licencas'-'exclusoes')=current_setting('test.crm.dados_antes')::jsonb,'suspensão e operações recusadas preservam integralmente os registros');
SELECT public.membros_crm_licenca_reativar('61000000-0000-0000-0000-000000000001');
SELECT public.membros_crm_licenca_reativar('61000000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT public.testar((SELECT suspenso_em IS NULL AND revogado_em IS NULL
 AND to_jsonb(l)-'suspenso_em'=current_setting('test.crm.licenca_antes')::jsonb
 FROM public.membros_licencas l WHERE id='61000000-0000-0000-0000-000000000001'),'reativação preserva a mesma licença e não renova prazo');
SELECT public.testar((SELECT count(*) FROM public.membros_ferramentas_historico
 WHERE registro_id='61000000-0000-0000-0000-000000000001' AND acao='crm_licenca_reativada')=1,'reativação repetida não duplica histórico');
SELECT public.testar((SELECT count(*) FROM public.membros_licencas
 WHERE produto_id IN('31000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002'))=6,'suspender e reativar não criam licenças');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
SELECT public.testar(public.membros_crm_operar('31000000-0000-0000-0000-000000000001',repeat('c',64))
 =current_setting('test.crm.dados_antes')::jsonb,'reativação recupera os mesmos contatos e negócios com a sessão existente');
SELECT public.membros_ferramenta_sessao('31000000-0000-0000-0000-000000000001',repeat('c',64));
SELECT public.testar(EXISTS(SELECT 1 FROM jsonb_array_elements(public.membros_ferramentas_catalogo()) f
 WHERE f->>'produto_id'='31000000-0000-0000-0000-000000000001' AND f->>'fim' IS NOT NULL),'catálogo volta a liberar somente após reativar');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE alvo uuid; BEGIN
 FOREACH alvo IN ARRAY ARRAY[
  '61000000-0000-0000-0000-000000000003'::uuid,
  '61000000-0000-0000-0000-000000000004'::uuid,
  '61000000-0000-0000-0000-000000000005'::uuid,
  '61000000-0000-0000-0000-000000000006'::uuid,
  '61000000-0000-0000-0000-000000000099'::uuid
 ] LOOP
  BEGIN
   PERFORM public.membros_crm_licenca_reativar(alvo);
   RAISE EXCEPTION 'Reativação indevida de licença %',alvo;
  EXCEPTION WHEN invalid_parameter_value THEN
   PERFORM public.testar(true,'não reativa licença vencida, revogada, futura, de outro motor ou inexistente');
  END;
 END LOOP;
 BEGIN
  PERFORM public.membros_crm_licenca_suspender('61000000-0000-0000-0000-000000000005');
  RAISE EXCEPTION 'Suspendeu outro motor';
 EXCEPTION WHEN invalid_parameter_value THEN
  PERFORM public.testar(true,'suspensão administrativa é exclusiva do motor CRM');
 END;
END $$;
RESET ROLE;
SELECT public.testar((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.membros_licencas l
 WHERE produto_id IN('31000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002')
 AND id<>'61000000-0000-0000-0000-000000000001')=current_setting('test.crm.outras_antes')::jsonb,'recusas não alteram revogação, vencimento ou outras licenças');

SET ROLE authenticated;
SELECT public.membros_crm_licenca_suspender('61000000-0000-0000-0000-000000000001');
SELECT public.membros_ferramenta_revogar('61000000-0000-0000-0000-000000000001');
SELECT public.testar(public.membros_ferramenta_licenca_teste('31000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')
 ='61000000-0000-0000-0000-000000000001'::uuid,'concessão antiga continua idempotente sem criar licença de substituição');
DO $$ BEGIN
 BEGIN
  PERFORM public.membros_crm_licenca_reativar('61000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'Reativação desfez revogação definitiva';
 EXCEPTION WHEN invalid_parameter_value THEN
  PERFORM public.testar(true,'reativação temporária nunca desfaz a revogação legada');
 END;
END $$;
SELECT public.testar(NOT public.membros_pagamentos_habilitados(),'suspensão e reativação mantêm pagamentos desligados');
RESET ROLE;
SELECT public.testar((SELECT revogado_em IS NOT NULL AND suspenso_em IS NOT NULL FROM public.membros_licencas
 WHERE id='61000000-0000-0000-0000-000000000001'),'revogação e suspensão permanecem estados distintos');
SELECT public.testar(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('membros_crm_licenca_suspender','membros_crm_licenca_reativar')
 AND (NOT p.prosecdef OR NOT COALESCE('search_path=""'=ANY(p.proconfig),false))),'RPCs administrativas usam SECURITY DEFINER com search_path fixo');

ROLLBACK;
