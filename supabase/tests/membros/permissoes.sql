DO $$ BEGIN IF current_database()<>'membros_test' THEN RAISE EXCEPTION 'Banco de teste obrigatório'; END IF; END $$;
CREATE FUNCTION public.testar(_condicao boolean,_nome text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT COALESCE(_condicao,false) THEN RAISE EXCEPTION 'FALHOU: %',_nome; END IF; RAISE NOTICE 'PASSOU: %',_nome; END $$;
CREATE FUNCTION public.recusa(_sql text) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN EXECUTE _sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-000000000001','admin@example.invalid',now(),'{}'),
 ('00000000-0000-0000-0000-000000000002','comprador@example.invalid',now(),'{"role":"admin"}'),
 ('00000000-0000-0000-0000-000000000003','mensal@example.invalid',now(),'{}'),
 ('00000000-0000-0000-0000-000000000004','outro@example.invalid',now(),'{}'),
 ('00000000-0000-0000-0000-000000000005','semconfirmacao@example.invalid',null,'{}');
INSERT INTO public.user_roles(user_id,role) VALUES('00000000-0000-0000-0000-000000000001','admin'),('00000000-0000-0000-0000-000000000003','client'),('00000000-0000-0000-0000-000000000004','client');
INSERT INTO public.projects VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003'),('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004');
INSERT INTO public.documents VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','Documento operacional de teste');
INSERT INTO public.financial_plans VALUES('20000000-0000-0000-0000-000000000001','Plano de teste',true);
INSERT INTO public.financial_plan_versions VALUES('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
INSERT INTO public.financial_client_terms VALUES('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','active',current_date-1,null);
INSERT INTO public.membros_produtos(id,titulo,estado,gratuito) VALUES
 ('30000000-0000-0000-0000-000000000001','Produto pago de teste','publicado',false),
 ('30000000-0000-0000-0000-000000000002','Produto gratuito de teste','publicado',true),
 ('30000000-0000-0000-0000-000000000003','Rascunho de teste','rascunho',false);
INSERT INTO public.membros_materiais(id,produto_id,titulo,tipo,texto) VALUES
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Guia pago','texto','Segredo protegido de teste'),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','Guia gratuito','texto','Texto gratuito de teste');
INSERT INTO public.membros_materiais(id,produto_id,titulo,tipo,arquivo) VALUES('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','PDF pago','pdf','30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000003/guia.pdf');
INSERT INTO storage.objects(bucket_id,name) VALUES('membros-materiais','30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000003/guia.pdf');
INSERT INTO public.membros_acessos(user_id,produto_id,origem,referencia,inicio,fim) VALUES
 ('00000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','manual','concessao-teste',now()-interval '1 day',now()+interval '1 day');
INSERT INTO public.membros_beneficios_plano(plano_id,produto_id) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
SELECT public.testar(NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='00000000-0000-0000-0000-000000000002'),'metadado de cadastro não concede papel operacional');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT public.testar((SELECT count(*) FROM public.projects)=0,'comprador não lê projetos');
SELECT public.testar((SELECT count(*) FROM public.documents)=0,'comprador não lê documentos');
SELECT public.testar((SELECT count(*) FROM public.financial_client_terms)=0,'comprador não lê financeiro');
SELECT public.testar((SELECT count(*) FROM public.membros_produtos)=2,'catálogo esconde rascunho');
SELECT public.testar((SELECT count(*) FROM public.membros_materiais)=3,'comprador lê somente materiais permitidos');
SELECT public.testar((SELECT count(*) FROM storage.objects)=1,'arquivo privado permitido com direito');
SELECT public.testar(public.recusa('insert into public.membros_acessos(user_id,produto_id,origem,referencia) values(''00000000-0000-0000-0000-000000000002'',''30000000-0000-0000-0000-000000000003'',''manual'',''forjado'')'),'comprador não concede acesso a si próprio');
SELECT public.testar(public.recusa('insert into public.membros_checklist(chave) values(''forjado'')'),'checklist não aceita membro');
SELECT public.testar(NOT has_function_privilege('authenticated','public.membros_conciliar_pagamento(uuid,text,text,text,text)','execute'),'browser não confirma compra por RPC');
INSERT INTO public.membros_progresso(material_id,concluido) VALUES('40000000-0000-0000-0000-000000000001',true);
SELECT public.testar((SELECT count(*) FROM public.membros_progresso)=1,'progresso persiste para comprador');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
SELECT public.testar((SELECT count(*) FROM public.projects)=1,'cliente mantém somente seu projeto');
SELECT public.testar(public.membros_origens('30000000-0000-0000-0000-000000000001')=ARRAY['plano']::text[],'cliente recebe somente benefício configurado');
SELECT public.testar((SELECT count(*) FROM public.membros_progresso)=0,'progresso isolado por identidade');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
SELECT public.testar((SELECT count(*) FROM public.membros_materiais)=1,'cliente sem benefício só recebe gratuito');
SELECT public.testar((SELECT count(*) FROM storage.objects)=0,'URL privada negada a outro cliente apesar de política antiga ampla');
SELECT public.testar(public.recusa('insert into public.membros_progresso(material_id) values(''40000000-0000-0000-0000-000000000001'')'),'API de progresso recusa produto bloqueado');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
SELECT public.testar((SELECT count(*) FROM public.membros_materiais)=0,'identidade sem confirmação não consome nem gratuito');
RESET ROLE;
UPDATE public.financial_client_terms SET status='ended';
INSERT INTO public.membros_acessos(user_id,produto_id,origem,referencia) VALUES('00000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','compra','compra-independente-teste');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
SELECT public.testar(public.membros_origens('30000000-0000-0000-0000-000000000001')=ARRAY['compra']::text[],'encerrar plano preserva compra');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
INSERT INTO public.membros_checklist(chave,estado,evidencia) VALUES('acesso_perfis','concluido','Verificação de teste isolado');
UPDATE public.membros_checklist SET estado='em_andamento' WHERE chave='acesso_perfis';
SELECT public.testar((SELECT count(*) FROM public.membros_checklist_historico)=2,'checklist registra histórico real de alterações');
SELECT public.testar((SELECT atualizado_por FROM public.membros_checklist WHERE chave='acesso_perfis')=auth.uid(),'autor do checklist vem da sessão');
RESET ROLE;
SET ROLE anon;
SELECT public.testar((SELECT count(*) FROM storage.objects)=0,'arquivo de membros não é anônimo');
SELECT public.testar(NOT has_function_privilege('anon','public.membros_catalogo()','execute'),'catálogo RPC exige sessão');
RESET ROLE;
-- Conciliação idempotente, reembolso terminal e origens independentes.
INSERT INTO public.vendas_integracoes(id,gateway,chave) VALUES('50000000-0000-0000-0000-000000000001','asaas','chave-teste');
INSERT INTO public.membros_vinculos_venda(integracao_id,produto_externo_id,produto_id,regra,dias,revogar_reembolso) VALUES('50000000-0000-0000-0000-000000000001','produto-externo-teste','30000000-0000-0000-0000-000000000001','dias',30,true);
INSERT INTO public.vendas_eventos VALUES('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','produto-externo-teste','pay_teste:compra_aprovada');
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.membros_conciliar_pagamento('60000000-0000-0000-0000-000000000001','pay_teste','produto-externo-teste','comprador@example.invalid','pago');
SELECT public.membros_conciliar_pagamento('60000000-0000-0000-0000-000000000001','pay_teste','produto-externo-teste','comprador@example.invalid','pago');
SELECT public.testar((SELECT count(*) FROM public.membros_compras)=1,'evento repetido gera uma compra');
SELECT public.testar((SELECT count(*) FROM public.membros_acessos WHERE origem='compra' AND user_id='00000000-0000-0000-0000-000000000002')=1,'evento repetido gera um direito');
SELECT public.membros_conciliar_pagamento('60000000-0000-0000-0000-000000000001','pay_teste','produto-externo-teste','comprador@example.invalid','reembolsado');
SELECT public.membros_conciliar_pagamento('60000000-0000-0000-0000-000000000001','pay_teste','produto-externo-teste','comprador@example.invalid','pago');
SELECT public.testar((SELECT estado FROM public.membros_compras LIMIT 1)='reembolsado','aprovação atrasada não ressuscita reembolso');
SELECT set_config('request.jwt.claim.role','authenticated',false);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
SELECT public.testar(public.membros_origens('30000000-0000-0000-0000-000000000001')=ARRAY['manual']::text[],'reembolso preserva concessão manual independente');
RESET ROLE;
UPDATE public.membros_acessos SET revogado_em=now() WHERE user_id='00000000-0000-0000-0000-000000000002' AND origem='manual';
SET ROLE authenticated;
SELECT public.testar((SELECT count(*) FROM public.membros_materiais)=1,'revogação final bloqueia material protegido');
SELECT public.testar((SELECT count(*) FROM storage.objects)=0,'revogação final bloqueia nova leitura de arquivo');
RESET ROLE;
INSERT INTO public.membros_acessos(user_id,produto_id,origem,referencia,inicio,fim) VALUES
 ('00000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','manual','expirado-teste',now()-interval '2 days',now()-interval '1 day'),
 ('00000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','manual','futuro-teste',now()+interval '1 day',now()+interval '2 days');
SET ROLE authenticated;
SELECT public.testar(NOT public.membros_pode_acessar('30000000-0000-0000-0000-000000000001'),'concessão vencida ou futura não libera produto');
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',false);
INSERT INTO public.vendas_eventos VALUES('60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','produto-externo-teste','pay_segunda:compra_aprovada');
SELECT public.membros_conciliar_pagamento('60000000-0000-0000-0000-000000000002','pay_segunda','produto-externo-teste','comprador@example.invalid','pago');
SELECT public.membros_conciliar_pagamento('60000000-0000-0000-0000-000000000001','pay_teste','produto-externo-teste','comprador@example.invalid','reembolsado');
SELECT set_config('request.jwt.claim.role','authenticated',false);
SET ROLE authenticated;
SELECT public.testar(public.membros_origens('30000000-0000-0000-0000-000000000001')=ARRAY['compra']::text[],'reembolso da primeira compra preserva uma segunda compra válida');
RESET ROLE;
SELECT 'TESTES SQL CONCLUÍDOS' as resultado;
