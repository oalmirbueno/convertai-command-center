DO $$ BEGIN IF current_database()<>'membros_test' THEN RAISE EXCEPTION 'Banco descartável obrigatório'; END IF; END $$;
INSERT INTO public.membros_modulos(id,produto_id,titulo,estado) VALUES
 ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Módulo publicado','publicado'),
 ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Módulo rascunho','rascunho');
UPDATE public.membros_materiais SET modulo_id='50000000-0000-0000-0000-000000000001' WHERE id='40000000-0000-0000-0000-000000000001';
INSERT INTO public.membros_materiais(id,produto_id,modulo_id,titulo,tipo,texto) VALUES
 ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','Aula em rascunho','texto','Conteúdo ainda não publicado');
UPDATE public.membros_produtos SET comunidade_ativa=true WHERE id='30000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
SELECT public.testar(jsonb_array_length(public.membros_acervo('30000000-0000-0000-0000-000000000001')->'modulos')=1,'membro só vê módulos publicados');
SELECT public.testar(jsonb_array_length(public.membros_acervo('30000000-0000-0000-0000-000000000001')->'materiais')=2,'módulo rascunho não vaza aula por RPC');
SELECT public.testar((SELECT count(*) FROM public.membros_materiais WHERE id='40000000-0000-0000-0000-000000000004')=0,'módulo rascunho também é protegido no REST');
SELECT public.testar(public.recusa('select public.membros_pessoas()'),'membro não consulta funil de outras pessoas');
SELECT public.testar(public.recusa('select public.membros_liberar(ARRAY[auth.uid()],ARRAY[''30000000-0000-0000-0000-000000000003'']::uuid[])'),'membro não se libera por RPC');
SELECT public.membros_favoritar('30000000-0000-0000-0000-000000000001',true,false);
SELECT public.testar(cardinality(public.membros_minha_lista())=1,'minha lista persiste no servidor');
SELECT public.membros_comunidade_salvar('30000000-0000-0000-0000-000000000001','Dúvida de teste');
SELECT public.testar(jsonb_array_length(public.membros_comunidade_ler('30000000-0000-0000-0000-000000000001'))=1,'participante publica e lê na comunidade do curso');
SELECT public.testar(public.recusa('select public.membros_comunidade_salvar(''30000000-0000-0000-0000-000000000001'',''Forçar destaque'',null,null,false,true)'),'membro não fixa conversa');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
SELECT public.testar(public.recusa('select public.membros_comunidade_ler(''30000000-0000-0000-0000-000000000001'')'),'comunidade exige direito ao curso');
SELECT public.testar(cardinality(public.membros_minha_lista())=0,'minha lista não cruza identidades');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT public.testar(jsonb_array_length(public.membros_acervo('30000000-0000-0000-0000-000000000001',true)->'materiais')=2,'teste de admin não recebe rascunho');
SELECT public.testar(jsonb_array_length(public.membros_acervo('30000000-0000-0000-0000-000000000001')->'materiais')=3,'admin pode editar conteúdo ainda não publicado');
SELECT public.membros_liberar(ARRAY['00000000-0000-0000-0000-000000000004']::uuid[],ARRAY['30000000-0000-0000-0000-000000000001']::uuid[]);
SELECT public.membros_liberar(ARRAY['00000000-0000-0000-0000-000000000004']::uuid[],ARRAY['30000000-0000-0000-0000-000000000001']::uuid[]);
SELECT public.testar((SELECT count(*) FROM public.membros_acessos WHERE user_id='00000000-0000-0000-0000-000000000004' AND produto_id='30000000-0000-0000-0000-000000000001' AND origem='manual')=1,'repetir concessão não duplica acesso manual');
SELECT public.testar(jsonb_array_length(public.membros_pessoa_detalhe('00000000-0000-0000-0000-000000000004')->'historico')=2,'histórico registra criação e atualização');
SELECT public.membros_revogar_manual('00000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001');
SELECT public.testar((public.membros_pessoas('outro','30000000-0000-0000-0000-000000000001')->'pessoas'->0->>'liberados')::int=0,'funil reflete acesso retirado');
SELECT public.testar(NOT public.membros_pagamentos_habilitados(),'comunidade e funil não ativam pagamentos');
SELECT public.testar(public.recusa('select public.membros_kiwify_credenciais()'),'administrador não lê segredos do cofre por RPC');
SELECT public.testar(public.recusa('select * from public.membros_kiwify_config'),'configuração privada não aparece por REST');
SELECT public.testar((public.membros_kiwify_estado()->>'automatico')::boolean=false,'configurar Kiwify não ativa liberação');
DO $$ BEGIN
 BEGIN PERFORM public.membros_ordenar('30000000-0000-0000-0000-000000000001',null,'modulos'); RAISE EXCEPTION 'Lista nula foi aceita';
 EXCEPTION WHEN invalid_parameter_value THEN PERFORM public.testar(true,'ordenação recusa lista nula'); END;
END $$;
SELECT public.testar(public.recusa('select public.membros_acervo(''30000000-0000-0000-0000-000000000001'',true,false,''00000000-0000-0000-0000-000000000002'')'),'leitor não mistura prévia e teste');
DO $$ BEGIN
 BEGIN PERFORM public.membros_liberar(ARRAY[]::uuid[],ARRAY[]::uuid[]); RAISE EXCEPTION 'Concessão vazia foi aceita';
 EXCEPTION WHEN invalid_parameter_value THEN PERFORM public.testar(true,'concessão vazia não altera acessos'); END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
SELECT public.testar(public.recusa('select public.membros_kiwify_estado()'),'membro não acessa configuração de pagamentos');
SELECT public.testar(public.recusa('select public.membros_minha_lista(null)'),'favoritos recusam contexto nulo');
RESET ROLE;
