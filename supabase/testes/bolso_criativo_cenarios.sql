-- SOMENTE no PGlite em memória do runner irmão. Fixtures sintéticas; nenhum fornecedor é chamado.
BEGIN;
CREATE TEMP TABLE r(n serial,teste text,ok boolean,detalhe text);
GRANT ALL ON r TO PUBLIC; GRANT ALL ON SEQUENCE r_n_seq TO PUBLIC;
CREATE FUNCTION pg_temp.ok(t text,v boolean,d text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ INSERT INTO pg_temp.r(teste,ok,detalhe) VALUES(t,COALESCE(v,false),d) $$;
CREATE FUNCTION pg_temp.falha(t text,s text,trecho text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE s; PERFORM pg_temp.ok(t,false,'não recusou');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok(t,position(lower(trecho) IN lower(SQLERRM))>0,SQLERRM); END $$;
CREATE FUNCTION pg_temp.login(u text,perfil text DEFAULT 'authenticated') RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',jsonb_build_object('sub',u,'role',perfil)::text,true)::text IS NOT NULL
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

INSERT INTO auth.users(id,email,email_confirmed_at,aud,role,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT u,concat('criativo-',n,'@exemplo.invalid'),now(),'authenticated','authenticated','{}','{}',now(),now()
FROM (VALUES('aaaaaaaa-2000-4000-8000-000000000001'::uuid,1),('bbbbbbbb-2000-4000-8000-000000000002'::uuid,2),('cccccccc-2000-4000-8000-000000000003'::uuid,3),('eeeeeeee-2000-4000-8000-000000000004'::uuid,4)) t(u,n);
INSERT INTO public.user_roles(user_id,role) VALUES('aaaaaaaa-2000-4000-8000-000000000001','client'),('bbbbbbbb-2000-4000-8000-000000000002','client'),('cccccccc-2000-4000-8000-000000000003','admin'),('eeeeeeee-2000-4000-8000-000000000004','client');
INSERT INTO public.bolso_politicas(id,versao,estado,teste,dados) VALUES('11111111-2000-4000-8000-000000000001',992001,'aprovado',false,'{"creditos_iniciais":100,"tarifa_texto":1,"tarifa_imagem":5,"validade_meses":12,"formatos":["feed_1x1"]}');
INSERT INTO public.bolso_direitos(id,user_id,tipo,carteira,origem,referencia,politica_id,inicio,fim) VALUES
('dddddddd-2000-4000-8000-000000000001','aaaaaaaa-2000-4000-8000-000000000001','anual','real','validacao_manual','fixture-criativo-a','11111111-2000-4000-8000-000000000001',now()-interval '1 day',now()+interval '1 year'),
('dddddddd-2000-4000-8000-000000000002','bbbbbbbb-2000-4000-8000-000000000002','anual','real','validacao_manual','fixture-criativo-b','11111111-2000-4000-8000-000000000001',now()-interval '1 day',now()+interval '1 year');
INSERT INTO public.bolso_creditos(user_id,direito_id,carteira,tipo,quantidade,delta_disponivel,delta_reservado)
SELECT user_id,id,'real','concessao',100,100,0 FROM public.bolso_direitos;
UPDATE public.bolso_config SET modulo_exposto=true,geracao_real=true,pagamentos=false,modo_simulado=false,kill_switch=false,
  limites='{"paralelo_por_usuario":20,"pedidos_por_dia_usuario":100,"teto_global_dia":1000}';
SELECT pg_temp.ok('incremento nasce desativado',(SELECT NOT recursos_criativos AND NOT pagamentos FROM public.bolso_config));

SELECT pg_temp.login('aaaaaaaa-2000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT public.bolso_marca_salvar('{"nome":"Marca A","direitos_confirmados":true}');
SELECT set_config('c.a',public.bolso_campanha_salvar('{"briefing":{"tipo":"venda","produto":"Bolo","cta":"Peça pelo WhatsApp"}}')::text,true);
SELECT public.bolso_versao_salvar(current_setting('c.a')::uuid,'{"mensagem":"Seu bolo","texto":"Conheça o bolo","cta":"Peça pelo WhatsApp"}');
SELECT pg_temp.falha('flag desligada impede pedido novo',format('SELECT public.bolso_pedir_criativo(%L,''briefing'',NULL,''desligado-001'',1,''{"ideia":"Apresentar sabores"}'')',current_setting('c.a')),'não está disponível');
SELECT pg_temp.ok('falha de admissão reverte a reserva',(public.bolso_estado()->'saldo'->>'disponivel')::int=100 AND (public.bolso_estado()->'saldo'->>'reservado')::int=0);
SELECT pg_temp.falha('membro não ativa recursos','SELECT public.bolso_admin_recursos_criativos(true)','admin');
SELECT pg_temp.login('cccccccc-2000-4000-8000-000000000003'); SELECT public.bolso_admin_recursos_criativos(true);
SELECT pg_temp.login('eeeeeeee-2000-4000-8000-000000000004');
SELECT public.bolso_marca_salvar('{"nome":"Sem acesso","direitos_confirmados":true}');
SELECT set_config('c.sem_acesso',public.bolso_campanha_salvar('{"briefing":{"tipo":"venda","produto":"Produto sem acesso"}}')::text,true);
SELECT pg_temp.falha('cadastro confirmado sem licença não recebe upload',format('SELECT public.bolso_referencia_registrar(%L,''produto.png'',''image/png'',70)',current_setting('c.sem_acesso')),'acesso ativo');
SELECT pg_temp.ok('sem acesso não anuncia capacidade de referência',NOT(public.bolso_estado()->'recursos_criativos'->>'referencias')::boolean);
SELECT pg_temp.login('aaaaaaaa-2000-4000-8000-000000000001');
RESET ROLE; UPDATE public.bolso_config SET kill_switch=true;
SET LOCAL ROLE authenticated;
SELECT pg_temp.falha('kill switch impede upload mesmo com licença',format('SELECT public.bolso_referencia_registrar(%L,''produto.png'',''image/png'',70)',current_setting('c.a')),'geração real');
RESET ROLE; UPDATE public.bolso_config SET kill_switch=false;
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok('capacidade agora fica explícita',(public.bolso_estado()->'recursos_criativos'->>'briefing')::boolean);
SELECT set_config('c.job',public.bolso_pedir_criativo(current_setting('c.a')::uuid,'briefing',NULL,'briefing-fixture-001',1,'{"ideia":"Apresentar sabores"}')->>'job_id',true);
SELECT pg_temp.ok('mesma intenção retorna o mesmo job',public.bolso_pedir_criativo(current_setting('c.a')::uuid,'briefing',NULL,'briefing-fixture-001',1,'{"ideia":"Apresentar sabores"}')->>'job_id'=current_setting('c.job'));
SELECT pg_temp.falha('mesma chave com outra ideia é recusada',format('SELECT public.bolso_pedir_criativo(%L,''briefing'',NULL,''briefing-fixture-001'',1,''{"ideia":"Outra ideia"}'')',current_setting('c.a')),'outro pedido');
SELECT pg_temp.falha('mesma chave com outra natureza é recusada',format('SELECT public.bolso_pedir_criativo(%L,''legenda'',NULL,''briefing-fixture-001'',1,''{}'')',current_setting('c.a')),'outro pedido');
SELECT pg_temp.falha('tarifa não vem do cliente',format('SELECT public.bolso_pedir_criativo(%L,''legenda'',NULL,''custo-falso-001'',0,''{}'')',current_setting('c.a')),'custo mudou');
SELECT pg_temp.falha('membro não chama worker base',format('SELECT public.bolso_trabalho_pegar_base_criativo(%L)',current_setting('c.job')),'permission denied');
SELECT pg_temp.ok('apenas um crédito fica reservado',(public.bolso_estado()->'saldo'->>'reservado')::int=1);
SELECT pg_temp.ok('extrato identifica preparação',EXISTS(SELECT 1 FROM jsonb_array_elements(public.bolso_extrato()) x WHERE x->>'job_id'=current_setting('c.job') AND x->>'natureza'='briefing' AND x->>'descricao' LIKE '%Preparação%'));

SELECT pg_temp.login('bbbbbbbb-2000-4000-8000-000000000002');
SELECT public.bolso_marca_salvar('{"nome":"Marca B","direitos_confirmados":true}');
SELECT set_config('c.b',public.bolso_campanha_salvar('{"briefing":{"tipo":"venda","produto":"Produto B"}}')::text,true);
SELECT pg_temp.falha('B não lê proposta de A',format('SELECT public.bolso_criativo_resultado(%L)',current_setting('c.job')),'não encontrado');
SELECT pg_temp.falha('B não lê campanha e histórico de A',format('SELECT public.bolso_campanha_ler(%L)',current_setting('c.a')),'não encontrada');
SELECT set_config('c.refb',public.bolso_referencia_registrar(current_setting('c.b')::uuid,'produto-b.png','image/png',70)->>'id',true);
SELECT pg_temp.login('aaaaaaaa-2000-4000-8000-000000000001');
SELECT set_config('c.refa',public.bolso_referencia_registrar(current_setting('c.a')::uuid,'produto-a.png','image/png',70)->>'id',true);
SELECT pg_temp.ok('upload não confirmado não aparece',public.bolso_referencias_listar(current_setting('c.a')::uuid)='[]'::jsonb);
SELECT pg_temp.falha('membro não confirma referência direto na tabela',format('UPDATE public.bolso_referencias SET confirmada_em=now() WHERE id=%L',current_setting('c.refa')),'permission denied');
RESET ROLE;
UPDATE public.bolso_referencias SET confirmada_em=now() WHERE id IN(current_setting('c.refa')::uuid,current_setting('c.refb')::uuid);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok('só referência confirmada do dono aparece',jsonb_array_length(public.bolso_referencias_listar(current_setting('c.a')::uuid))=1);
SELECT pg_temp.falha('referência B não entra em campanha A',format('SELECT public.bolso_pedir_criativo(%L,''imagem'',''feed_1x1'',''ref-outro-001'',5,%L)',current_setting('c.a'),jsonb_build_object('referencias',jsonb_build_array(current_setting('c.refb')))::text),'não encontrada');
SELECT pg_temp.ok('recusa de referência não consome reserva',(public.bolso_estado()->'saldo'->>'reservado')::int=1);
SELECT public.bolso_campanha_salvar(jsonb_build_object('id',current_setting('c.a'),'briefing',jsonb_build_object('tipo','venda','produto','Bolo','objetivo','Manual preservado','cta','Peça pelo WhatsApp')),1);

RESET ROLE; SELECT pg_temp.login(NULL,'service_role'); SET LOCAL ROLE service_role;
SELECT pg_temp.ok('worker recebe natureza e snapshot',(public.bolso_trabalho_pegar(current_setting('c.job')::uuid)->'job'->>'natureza')='briefing');
SELECT pg_temp.ok('briefing conclui uma única vez',(public.bolso_trabalho_concluir(current_setting('c.job')::uuid,1,'{"briefing":{"tipo":"venda","produto":"Bolo","objetivo":"Apresentar sabores","cta":"Peça pelo WhatsApp"}}')->>'aceito')::boolean);
SELECT pg_temp.ok('segunda conclusão é ignorada',NOT(public.bolso_trabalho_concluir(current_setting('c.job')::uuid,1,'{"briefing":{"tipo":"venda","produto":"Bolo"}}')->>'aceito')::boolean);
RESET ROLE;
SELECT pg_temp.ok('captura soma exatamente um crédito',(SELECT sum(quantidade)=1 FROM public.bolso_creditos WHERE job_id=current_setting('c.job')::uuid AND tipo='captura'));
SELECT pg_temp.login('aaaaaaaa-2000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok('proposta não sobrescreveu edição concorrente',(public.bolso_campanha_ler(current_setting('c.a')::uuid)->'briefing'->>'objetivo')='Manual preservado');
SELECT pg_temp.ok('proposta é recuperável após nova consulta',public.bolso_criativo_resultado(current_setting('c.job')::uuid)->'briefing'->>'objetivo'='Apresentar sabores');
SELECT pg_temp.ok('histórico identifica o briefing para reabrir',EXISTS(SELECT 1 FROM jsonb_array_elements(public.bolso_campanha_ler(current_setting('c.a')::uuid)->'jobs') j WHERE j->>'id'=current_setting('c.job') AND j->>'natureza'='briefing'));
SELECT set_config('c.imagem',public.bolso_pedir_criativo(current_setting('c.a')::uuid,'imagem','feed_1x1','imagem-fixture-001',5,jsonb_build_object('referencias',jsonb_build_array(current_setting('c.refa'))))->>'job_id',true);
SELECT pg_temp.ok('imagem reserva cinco créditos',(public.bolso_estado()->'saldo'->>'reservado')::int=5);
SELECT public.bolso_cancelar(current_setting('c.imagem')::uuid);
SELECT pg_temp.ok('cancelamento devolve cinco e mantém captura anterior',(public.bolso_estado()->'saldo'->>'disponivel')::int=99 AND (public.bolso_estado()->'saldo'->>'reservado')::int=0);

-- Uma arte concluída serve de original; cada ajuste é outro pedido, nunca reaproveita a captura anterior.
SELECT set_config('c.original',public.bolso_pedir_criativo(current_setting('c.a')::uuid,'imagem','feed_1x1','original-fixture-001',5,'{}')->>'job_id',true);
RESET ROLE; SELECT pg_temp.login(NULL,'service_role'); SET LOCAL ROLE service_role;
SELECT public.bolso_trabalho_pegar(current_setting('c.original')::uuid);
SELECT public.bolso_trabalho_concluir(current_setting('c.original')::uuid,1,'{}',jsonb_build_object('caminho','aaaaaaaa-2000-4000-8000-000000000001/'||current_setting('c.a')||'/'||current_setting('c.original')||'.png','mime','image/png','bytes',70));
RESET ROLE;
SELECT set_config('c.arte',(SELECT id::text FROM public.bolso_arquivos WHERE job_id=current_setting('c.original')::uuid),true);
SELECT pg_temp.login('aaaaaaaa-2000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT public.bolso_versao_salvar(current_setting('c.a')::uuid,'{"mensagem":"Copy V2 atual","texto":"Outra copy atual","cta":"Visite o site"}');
SELECT public.bolso_campanha_salvar(jsonb_build_object('id',current_setting('c.a'),'briefing',jsonb_build_object('tipo','venda','produto','Outra oferta','condicoes','R$ 999','cta','Visite o site')),2);
SELECT set_config('c.ajuste',public.bolso_pedir_criativo(current_setting('c.a')::uuid,'ajuste','feed_1x1','ajuste-fixture-001',5,jsonb_build_object('arte_origem',current_setting('c.arte'),'ajuste','Fundo claro'))->>'job_id',true);
SELECT pg_temp.ok('ajuste reserva cinco créditos novos',(public.bolso_estado()->'saldo'->>'reservado')::int=5 AND current_setting('c.ajuste')<>current_setting('c.original'));
SELECT public.bolso_versao_salvar(current_setting('c.a')::uuid,'{"mensagem":"Copy V3 selecionada depois","texto":"Terceira copy atual","cta":"Link da bio"}');
SELECT pg_temp.ok('repetir ajuste mantém job e reserva',public.bolso_pedir_criativo(current_setting('c.a')::uuid,'ajuste','feed_1x1','ajuste-fixture-001',5,jsonb_build_object('arte_origem',current_setting('c.arte'),'ajuste','Fundo claro'))->>'job_id'=current_setting('c.ajuste') AND (public.bolso_estado()->'saldo'->>'reservado')::int=5);
SELECT pg_temp.ok('ajustar arte antiga não muda a copy selecionada',(public.bolso_campanha_ler(current_setting('c.a')::uuid)->>'versao_escolhida')::int=3);
RESET ROLE; SELECT pg_temp.login(NULL,'service_role'); SET LOCAL ROLE service_role;
SELECT set_config('c.pegado_ajuste',public.bolso_trabalho_pegar(current_setting('c.ajuste')::uuid)::text,true);
SELECT pg_temp.ok('worker usa copy V1 da arte e não V2/V3 atuais',current_setting('c.pegado_ajuste')::jsonb->'versao'->>'mensagem'='Seu bolo');
SELECT pg_temp.ok('ajuste usa oferta original e não preço atual',current_setting('c.pegado_ajuste')::jsonb->'briefing'->>'produto'='Bolo' AND current_setting('c.pegado_ajuste')::jsonb->'briefing'->>'condicoes'='');
SELECT public.bolso_trabalho_falhar(current_setting('c.ajuste')::uuid,1,'Retorno transitório sintético',false);
RESET ROLE; SELECT pg_temp.login('aaaaaaaa-2000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT pg_temp.falha('mesma chave não muda instrução de ajuste',format('SELECT public.bolso_pedir_criativo(%L,''ajuste'',''feed_1x1'',''ajuste-fixture-001'',5,%L)',current_setting('c.a'),jsonb_build_object('arte_origem',current_setting('c.arte'),'ajuste','Fundo escuro')::text),'outro pedido');
SELECT public.bolso_cancelar(current_setting('c.ajuste')::uuid);
SELECT pg_temp.ok('cancelar ajuste não estorna arte já concluída',(public.bolso_estado()->'saldo'->>'disponivel')::int=94 AND (public.bolso_estado()->'saldo'->>'reservado')::int=0);

-- Artes anteriores ao incremento não têm snapshot; a edição não incorpora a oferta atual.
RESET ROLE;
UPDATE public.bolso_jobs SET contexto_criativo='{}' WHERE id=current_setting('c.original')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('c.ajuste_legado',public.bolso_pedir_criativo(current_setting('c.a')::uuid,'ajuste','feed_1x1','ajuste-legado-fixture-001',5,jsonb_build_object('arte_origem',current_setting('c.arte'),'ajuste','Mais contraste'))->>'job_id',true);
RESET ROLE; SELECT pg_temp.login(NULL,'service_role'); SET LOCAL ROLE service_role;
SELECT set_config('c.pegado_legado',public.bolso_trabalho_pegar(current_setting('c.ajuste_legado')::uuid)::text,true);
SELECT pg_temp.ok('arte legada conserva a copy original',current_setting('c.pegado_legado')::jsonb->'versao'->>'mensagem'='Seu bolo');
SELECT pg_temp.ok('arte legada não herda briefing nem marca atuais',current_setting('c.pegado_legado')::jsonb->'briefing'='{"tipo":"venda","produto":""}'::jsonb AND current_setting('c.pegado_legado')::jsonb->'marca'='{"nome":""}'::jsonb);
SELECT public.bolso_trabalho_falhar(current_setting('c.ajuste_legado')::uuid,1,'Retorno transitório sintético',false);
RESET ROLE; SELECT pg_temp.login('aaaaaaaa-2000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT public.bolso_cancelar(current_setting('c.ajuste_legado')::uuid);

-- Upload abandonado fica invisível, mas seu slot expira sem apagar arquivos confirmados.
SELECT set_config('c.pendentes',public.bolso_campanha_salvar('{"briefing":{"tipo":"venda","produto":"Campanha de uploads"}}')::text,true);
SELECT public.bolso_referencia_registrar(current_setting('c.pendentes')::uuid,'pendente1.png','image/png',70);
SELECT public.bolso_referencia_registrar(current_setting('c.pendentes')::uuid,'pendente2.png','image/png',70);
SELECT public.bolso_referencia_registrar(current_setting('c.pendentes')::uuid,'pendente3.png','image/png',70);
SELECT pg_temp.ok('três uploads incompletos não viram referência utilizável',public.bolso_referencias_listar(current_setting('c.pendentes')::uuid)='[]'::jsonb);
SELECT pg_temp.falha('limite de uploads recentes informa recuperação',format('SELECT public.bolso_referencia_registrar(%L,''pendente4.png'',''image/png'',70)',current_setting('c.pendentes')),'15 minutos');
RESET ROLE; UPDATE public.bolso_referencias SET criada_em=now()-interval '16 minutes' WHERE campanha_id=current_setting('c.pendentes')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('c.ref_recuperada',public.bolso_referencia_registrar(current_setting('c.pendentes')::uuid,'recuperada.png','image/png',70)->>'id',true);
RESET ROLE;
SELECT pg_temp.ok('pendências expiradas liberam os três slots',(SELECT count(*)=3 FROM public.bolso_referencias WHERE campanha_id=current_setting('c.pendentes')::uuid AND removida_em IS NOT NULL));
SELECT pg_temp.ok('novo upload entra após expiração',(SELECT count(*)=1 FROM public.bolso_referencias WHERE campanha_id=current_setting('c.pendentes')::uuid AND removida_em IS NULL));
UPDATE public.bolso_referencias SET criada_em=now()-interval '1 day',confirmada_em=now()-interval '1 day' WHERE id=current_setting('c.ref_recuperada')::uuid;
SET LOCAL ROLE authenticated;
SELECT public.bolso_referencia_registrar(current_setting('c.pendentes')::uuid,'novo.png','image/png',70);
SELECT pg_temp.ok('TTL não remove referência já confirmada',public.bolso_referencias_listar(current_setting('c.pendentes')::uuid)->0->>'id'=current_setting('c.ref_recuperada'));

SELECT public.bolso_referencia_remover(current_setting('c.refa')::uuid);
SELECT pg_temp.ok('referência removida some sem apagar histórico',public.bolso_referencias_listar(current_setting('c.a')::uuid)='[]'::jsonb);
SELECT pg_temp.falha('referência removida não volta a gerar',format('SELECT public.bolso_pedir_criativo(%L,''imagem'',''feed_1x1'',''ref-removida-001'',5,%L)',current_setting('c.a'),jsonb_build_object('referencias',jsonb_build_array(current_setting('c.refa')))::text),'não encontrada');
SELECT pg_temp.login('cccccccc-2000-4000-8000-000000000003'); SELECT public.bolso_admin_recursos_criativos(false);
SELECT pg_temp.login('aaaaaaaa-2000-4000-8000-000000000001');
SELECT pg_temp.ok('desligar não perde proposta já paga',public.bolso_criativo_resultado(current_setting('c.job')::uuid)->>'estado'='concluido');
SELECT pg_temp.ok('retry existente não cria nova reserva mesmo desligado',public.bolso_pedir_criativo(current_setting('c.a')::uuid,'briefing',NULL,'briefing-fixture-001',1,'{"ideia":"Apresentar sabores"}')->>'job_id'=current_setting('c.job'));
RESET ROLE;
SELECT pg_temp.ok('pagamentos permaneceram desligados',(SELECT NOT pagamentos FROM public.bolso_config));
SELECT pg_temp.ok('nenhum saldo ficou negativo',NOT EXISTS(SELECT 1 FROM public.bolso_creditos GROUP BY direito_id HAVING sum(delta_disponivel)<0 OR sum(delta_reservado)<0));
SELECT n,teste,ok,detalhe FROM pg_temp.r ORDER BY n;
ROLLBACK;
