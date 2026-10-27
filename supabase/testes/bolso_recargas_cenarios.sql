-- Executar SOMENTE em PostgreSQL isolado com baseline + incremento aplicados.
-- Tudo é sintético e revertido; não aponta um projeto nem chama fornecedor.
BEGIN;
CREATE TEMP TABLE r(n serial,teste text,ok boolean,detalhe text);
GRANT ALL ON r TO PUBLIC; GRANT ALL ON SEQUENCE r_n_seq TO PUBLIC;
CREATE FUNCTION pg_temp.ok(_teste text,_ok boolean,_detalhe text DEFAULT NULL) RETURNS void LANGUAGE sql AS
$$ INSERT INTO pg_temp.r(teste,ok,detalhe) VALUES(_teste,COALESCE(_ok,false),_detalhe) $$;
CREATE FUNCTION pg_temp.falha(_teste text,_sql text,_trecho text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; PERFORM pg_temp.ok(_teste,false,'passou sem erro');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok(_teste,position(lower(_trecho) IN lower(SQLERRM))>0,SQLERRM); END $$;
CREATE FUNCTION pg_temp.login(_id text,_role text DEFAULT 'authenticated') RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims',jsonb_build_object('sub',_id,'role',_role)::text,true)::text IS NOT NULL $$;
CREATE FUNCTION pg_temp.lote(_u uuid,_tipo text,_q integer,_dias integer,_p uuid) RETURNS uuid
LANGUAGE plpgsql AS $$ DECLARE d uuid; BEGIN
INSERT INTO public.bolso_direitos(user_id,tipo,carteira,origem,referencia,politica_id,inicio,fim)
VALUES(_u,_tipo,CASE WHEN _tipo='teste' THEN 'teste' ELSE 'real' END,'validacao_manual',gen_random_uuid()::text,_p,now()-interval '1 day',now()+make_interval(days=>_dias)) RETURNING id INTO d;
INSERT INTO public.bolso_creditos(user_id,direito_id,carteira,tipo,quantidade,delta_disponivel,delta_reservado)
VALUES(_u,d,CASE WHEN _tipo='teste' THEN 'teste' ELSE 'real' END,'concessao',_q,_q,0);
RETURN d; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

INSERT INTO auth.users(id,email,email_confirmed_at,aud,role,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT u,concat('bolso-recarga-',n,'@exemplo.invalid'),now(),'authenticated','authenticated','{}','{}',now(),now()
FROM (VALUES ('aaaaaaaa-1000-4000-8000-000000000001'::uuid,1),('bbbbbbbb-1000-4000-8000-000000000002'::uuid,2),
('cccccccc-1000-4000-8000-000000000003'::uuid,3),('dddddddd-1000-4000-8000-000000000004'::uuid,4)) t(u,n);
DELETE FROM public.user_roles WHERE user_id IN ('aaaaaaaa-1000-4000-8000-000000000001','bbbbbbbb-1000-4000-8000-000000000002','cccccccc-1000-4000-8000-000000000003','dddddddd-1000-4000-8000-000000000004');
INSERT INTO public.user_roles(user_id,role) VALUES
('aaaaaaaa-1000-4000-8000-000000000001','client'),('bbbbbbbb-1000-4000-8000-000000000002','client'),
('cccccccc-1000-4000-8000-000000000003','admin'),('dddddddd-1000-4000-8000-000000000004','client');
INSERT INTO public.bolso_politicas(id,versao,estado,teste,dados) VALUES
('11111111-1000-4000-8000-000000000001',991001,'aprovado',false,'{"creditos_iniciais":1,"tarifa_texto":3,"tarifa_imagem":4,"validade_meses":12,"formatos":["feed_1x1"]}'),
('11111111-1000-4000-8000-000000000002',991002,'aprovado',false,'{"creditos_iniciais":1,"tarifa_texto":9,"tarifa_imagem":9,"validade_meses":12,"formatos":["feed_1x1"]}'),
('11111111-1000-4000-8000-000000000003',991003,'rascunho',false,'{"creditos_iniciais":1,"tarifa_texto":3,"tarifa_imagem":4,"validade_meses":12,"formatos":["feed_1x1"]}');
SELECT set_config('r.anual',pg_temp.lote('aaaaaaaa-1000-4000-8000-000000000001','anual',1,10,'11111111-1000-4000-8000-000000000001')::text,true);
SELECT pg_temp.lote('aaaaaaaa-1000-4000-8000-000000000001','recarga',1,20,'11111111-1000-4000-8000-000000000002');
SELECT pg_temp.lote('aaaaaaaa-1000-4000-8000-000000000001','recarga',1,30,'11111111-1000-4000-8000-000000000002');
SELECT pg_temp.lote('bbbbbbbb-1000-4000-8000-000000000002','anual',10,90,'11111111-1000-4000-8000-000000000001');
SELECT pg_temp.lote('dddddddd-1000-4000-8000-000000000004','recarga',10,90,'11111111-1000-4000-8000-000000000001');
UPDATE public.bolso_config SET modulo_exposto=true,geracao_real=true,pagamentos=false,modo_simulado=false,kill_switch=false,
limites='{"paralelo_por_usuario":20,"pedidos_por_dia_usuario":100,"teto_global_dia":1000}';

SELECT pg_temp.login('aaaaaaaa-1000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT public.bolso_marca_salvar('{"nome":"Marca sintética A","direitos_confirmados":true}');
SELECT set_config('r.camp',public.bolso_campanha_salvar('{"briefing":{"tipo":"venda","produto":"Produto de teste"}}')::text,true);
SELECT pg_temp.ok('saldo soma os três lotes',(public.bolso_estado()->'saldo'->>'disponivel')::int=3);
SELECT pg_temp.ok('tarifa vem do anual, não da recarga',public.bolso_estado()->'politica'->>'tarifa_texto'='3');
SELECT pg_temp.falha('tarifa da recarga não pode substituir a do acesso',format('SELECT public.bolso_pedir(%L,''texto'',NULL,''tarifa-errada-01'',9)',current_setting('r.camp')),'custo mudou');
SELECT set_config('r.job',public.bolso_pedir(current_setting('r.camp')::uuid,'texto',NULL,'fragmentado-001',3)->>'job_id',true);
SELECT pg_temp.ok('pedido repetido devolve o mesmo job',public.bolso_pedir(current_setting('r.camp')::uuid,'texto',NULL,'fragmentado-001',3)->>'job_id'=current_setting('r.job'));
SELECT pg_temp.ok('disponível zero e reservado três',public.bolso_estado()->'saldo'='{"disponivel":0,"reservado":3}'::jsonb);
RESET ROLE;
SELECT pg_temp.ok('reserva distribuída por três lotes',(SELECT count(*)=3 AND sum(quantidade)=3 FROM public.bolso_creditos WHERE job_id=current_setting('r.job')::uuid AND tipo='reserva'));
SELECT pg_temp.ok('novo trabalho real usa OpenRouter',(SELECT provedor='openrouter' FROM public.bolso_jobs WHERE id=current_setting('r.job')::uuid));
SELECT pg_temp.falha('ledger impede trocar dono do lote',format('INSERT INTO public.bolso_creditos(user_id,direito_id,carteira,tipo,quantidade,delta_disponivel,delta_reservado) VALUES(''bbbbbbbb-1000-4000-8000-000000000002'',%L,''real'',''concessao'',1,1,0)',current_setting('r.anual')),'não pertence');
SELECT pg_temp.login('bbbbbbbb-1000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok('saldo B não foi alterado',(public.bolso_estado()->'saldo'->>'disponivel')::int=10);
SELECT pg_temp.falha('B não cancela pedido A',format('SELECT public.bolso_cancelar(%L)',current_setting('r.job')),'não encontrado');
SELECT pg_temp.falha('B não pede campanha A',format('SELECT public.bolso_pedir(%L,''texto'',NULL,''outro-dono-001'',3)',current_setting('r.camp')),'não encontrada');
SELECT pg_temp.ok('extrato B não contém pedido A',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.bolso_extrato()) x WHERE x->>'job_id'=current_setting('r.job')));
RESET ROLE; SELECT pg_temp.login(NULL,'service_role'); SET LOCAL ROLE service_role;
SELECT public.bolso_trabalho_pegar(current_setting('r.job')::uuid);
SELECT pg_temp.ok('captura funciona com vários lotes',(public.bolso_trabalho_concluir(current_setting('r.job')::uuid,1,'{"mensagem":"Mensagem","texto":"Texto"}')->>'aceito')::boolean);
SELECT pg_temp.ok('conclusão repetida é ignorada',NOT(public.bolso_trabalho_concluir(current_setting('r.job')::uuid,1,'{"mensagem":"Mensagem","texto":"Texto"}')->>'aceito')::boolean);
RESET ROLE;
SELECT pg_temp.ok('cada lote capturado exatamente uma vez',(SELECT count(*)=3 AND sum(quantidade)=3 FROM public.bolso_creditos WHERE job_id=current_setting('r.job')::uuid AND tipo='captura'));
SELECT pg_temp.ok('nenhum saldo reservado depois da captura',(SELECT sum(delta_reservado)=0 FROM public.bolso_creditos WHERE job_id=current_setting('r.job')::uuid));
SELECT pg_temp.falha('histórico continua imutável',format('UPDATE public.bolso_creditos SET descricao=''alteração'' WHERE job_id=%L',current_setting('r.job')),'não muda');

-- Anual zerado não bloqueia a nova recarga; cancelamento devolve aos mesmos lotes.
SELECT set_config('r.recarga2',pg_temp.lote('aaaaaaaa-1000-4000-8000-000000000001','recarga',2,40,'11111111-1000-4000-8000-000000000002')::text,true);
SELECT set_config('r.recarga1',pg_temp.lote('aaaaaaaa-1000-4000-8000-000000000001','recarga',1,50,'11111111-1000-4000-8000-000000000002')::text,true);
SELECT pg_temp.login('aaaaaaaa-1000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT set_config('r.cancelar',public.bolso_pedir(current_setting('r.camp')::uuid,'texto',NULL,'recarga-anual-zerado',3)->>'job_id',true);
SELECT public.bolso_cancelar(current_setting('r.cancelar')::uuid);
SELECT pg_temp.ok('cancelar devolve saldo fragmentado',public.bolso_estado()->'saldo'='{"disponivel":3,"reservado":0}'::jsonb);
RESET ROLE;
SELECT pg_temp.ok('cancelamento devolveu dois lotes',(SELECT count(*)=2 AND sum(quantidade)=3 FROM public.bolso_creditos WHERE job_id=current_setting('r.cancelar')::uuid AND tipo='liberacao'));
SELECT bolso_privado.liberar(j,'Repetição técnica') FROM public.bolso_jobs j WHERE id=current_setting('r.cancelar')::uuid;
SELECT pg_temp.ok('liberação repetida não duplica',(SELECT count(*)=2 FROM public.bolso_creditos WHERE job_id=current_setting('r.cancelar')::uuid AND tipo='liberacao'));

-- Falha após revogação: devolve a reserva, estorna somente o lote revogado.
SELECT pg_temp.login('aaaaaaaa-1000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT set_config('r.falha',public.bolso_pedir(current_setting('r.camp')::uuid,'texto',NULL,'falha-lote-revogado',3)->>'job_id',true);
RESET ROLE; SELECT pg_temp.login(NULL,'service_role'); SET LOCAL ROLE service_role;
SELECT public.bolso_trabalho_pegar(current_setting('r.falha')::uuid);
RESET ROLE; SELECT pg_temp.login('cccccccc-1000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT public.bolso_admin_revogar(current_setting('r.recarga2')::uuid,'Teste sintético de estorno');
RESET ROLE; SELECT pg_temp.login(NULL,'service_role'); SET LOCAL ROLE service_role;
SELECT public.bolso_trabalho_falhar(current_setting('r.falha')::uuid,1,'Falha sintética',true);
RESET ROLE;
SELECT pg_temp.ok('lote revogado não ressuscita',(SELECT sum(delta_disponivel)=0 AND sum(delta_reservado)=0 FROM public.bolso_creditos WHERE direito_id=current_setting('r.recarga2')::uuid));
SELECT pg_temp.ok('saldo do lote válido volta',(SELECT sum(delta_disponivel)=1 FROM public.bolso_creditos WHERE direito_id=current_setting('r.recarga1')::uuid));
SELECT bolso_privado.expirar('aaaaaaaa-1000-4000-8000-000000000001');
SELECT pg_temp.ok('estorno não se repete',(SELECT count(*)=1 AND sum(quantidade)=2 FROM public.bolso_creditos WHERE direito_id=current_setting('r.recarga2')::uuid AND tipo='estorno'));

-- Expiração com sobra e reserva: a liberação exige uma segunda expiração legítima.
SELECT set_config('r.expira',pg_temp.lote('aaaaaaaa-1000-4000-8000-000000000001','recarga',5,1,'11111111-1000-4000-8000-000000000001')::text,true);
SELECT pg_temp.login('aaaaaaaa-1000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT set_config('r.expjob',public.bolso_pedir(current_setting('r.camp')::uuid,'texto',NULL,'expira-e-libera-01',3)->>'job_id',true);
RESET ROLE;
UPDATE public.bolso_direitos SET inicio=now()-interval '2 days',fim=now()-interval '1 day' WHERE id=current_setting('r.expira')::uuid;
SELECT bolso_privado.expirar('aaaaaaaa-1000-4000-8000-000000000001');
SELECT pg_temp.login('aaaaaaaa-1000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT public.bolso_cancelar(current_setting('r.expjob')::uuid);
RESET ROLE;
SELECT pg_temp.ok('créditos devolvidos ao lote vencido expiram',(SELECT sum(delta_disponivel)=0 AND sum(delta_reservado)=0 FROM public.bolso_creditos WHERE direito_id=current_setting('r.expira')::uuid));
SELECT pg_temp.ok('duas expirações correspondem somente ao total original',(SELECT count(*)=2 AND sum(quantidade)=5 FROM public.bolso_creditos WHERE direito_id=current_setting('r.expira')::uuid AND tipo='expiracao'));
SELECT bolso_privado.expirar('aaaaaaaa-1000-4000-8000-000000000001');
SELECT pg_temp.ok('reler saldo não duplica expiração',(SELECT count(*)=2 FROM public.bolso_creditos WHERE direito_id=current_setting('r.expira')::uuid AND tipo='expiracao'));

-- Incerteza OpenRouter não reexecuta sozinha; reconciliação mantém lotes.
SELECT pg_temp.lote('aaaaaaaa-1000-4000-8000-000000000001','recarga',2,80,'11111111-1000-4000-8000-000000000001');
SELECT pg_temp.login('aaaaaaaa-1000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT set_config('r.incerto',public.bolso_pedir(current_setting('r.camp')::uuid,'texto',NULL,'lease-openrouter-01',3)->>'job_id',true);
RESET ROLE; SELECT pg_temp.login(NULL,'service_role'); SET LOCAL ROLE service_role;
SELECT public.bolso_trabalho_pegar(current_setting('r.incerto')::uuid);
RESET ROLE; UPDATE public.bolso_jobs SET lease_ate=now()-interval '1 second' WHERE id=current_setting('r.incerto')::uuid;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok('OpenRouter com lease vencido não é retomado',public.bolso_trabalho_pegar(current_setting('r.incerto')::uuid) IS NULL);
RESET ROLE;
SELECT pg_temp.ok('OpenRouter vencido vira incerto',(SELECT estado='incerto' FROM public.bolso_jobs WHERE id=current_setting('r.incerto')::uuid));
SELECT pg_temp.login('cccccccc-1000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT public.bolso_admin_reconciliar(current_setting('r.incerto')::uuid,'liberar');
RESET ROLE;
SELECT pg_temp.ok('reconciliação devolve todos os lotes',(SELECT sum(delta_reservado)=0 AND sum(delta_disponivel)=0 FROM public.bolso_creditos WHERE job_id=current_setting('r.incerto')::uuid));

-- Recarga nunca é acesso nem extensão do anual.
UPDATE public.bolso_direitos SET inicio=now()-interval '2 days',fim=now()-interval '1 day' WHERE id=current_setting('r.anual')::uuid;
SELECT pg_temp.login('aaaaaaaa-1000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok('anual vencido com recarga restante continua sem acesso',public.bolso_estado()->>'modo'='sem_acesso');
SELECT pg_temp.ok('saldo real de recarga continua visível após anual vencer',public.bolso_estado()->>'carteira'='real' AND (public.bolso_estado()->'saldo'->>'disponivel')::int=3);
SELECT pg_temp.falha('recarga não renova geração',format('SELECT public.bolso_pedir(%L,''texto'',NULL,''anual-vencido-01'',3)',current_setting('r.camp')),'não está ativo');
SELECT pg_temp.login('dddddddd-1000-4000-8000-000000000004');
SELECT pg_temp.ok('conta só com recarga não ganha acesso',public.bolso_estado()->>'modo'='sem_acesso');
SELECT pg_temp.ok('conta só com recarga enxerga seus créditos reais',(public.bolso_estado()->'saldo'->>'disponivel')::int=10);
SELECT pg_temp.ok('catálogo informa falta de acesso',NOT(public.bolso_ofertas_listar()->>'acesso_ativo')::boolean);

-- Ofertas não têm seeds e nunca habilitam cobrança; valores abaixo são fixtures.
SELECT pg_temp.login('cccccccc-1000-4000-8000-000000000003');
SELECT pg_temp.ok('catálogo inicialmente vazio',public.bolso_admin_ofertas_listar()='[]'::jsonb);
SELECT set_config('r.oferta',public.bolso_admin_oferta_salvar('{"codigo":"fixture-recarga","nome":"Oferta sintética","descricao":"Somente teste","preco_centavos":1234,"creditos":7,"validade_dias":30,"provisao_ia_centavos":234,"politica_id":"11111111-1000-4000-8000-000000000001"}')::text,true);
SELECT pg_temp.ok('salvar cria rascunho',public.bolso_admin_ofertas_listar()->0->>'estado'='rascunho');
SELECT pg_temp.falha('provisão não pode superar preço',$x$SELECT public.bolso_admin_oferta_salvar('{"codigo":"fixture-invalida","nome":"X","preco_centavos":10,"creditos":7,"validade_dias":30,"provisao_ia_centavos":11,"politica_id":"11111111-1000-4000-8000-000000000001"}')$x$,'check constraint');
SELECT pg_temp.falha('quantidade fracionada recusada',$x$SELECT public.bolso_admin_oferta_salvar('{"codigo":"fixture-invalida","nome":"X","preco_centavos":10,"creditos":1.5,"validade_dias":30,"provisao_ia_centavos":1,"politica_id":"11111111-1000-4000-8000-000000000001"}')$x$,'inteiro');
SELECT pg_temp.login('bbbbbbbb-1000-4000-8000-000000000002');
SELECT pg_temp.ok('cliente não vê oferta rascunho',public.bolso_ofertas_listar()->'ofertas'='[]'::jsonb);
SELECT pg_temp.falha('cliente não lista administração','SELECT public.bolso_admin_ofertas_listar()','Somente administração');
SELECT pg_temp.falha('cliente não publica oferta',format('SELECT public.bolso_admin_oferta_aprovar(%L)',current_setting('r.oferta')),'Somente administração');
SELECT pg_temp.falha('cliente não lê tabela de ofertas','SELECT * FROM public.bolso_ofertas','permission denied');
SELECT pg_temp.login('cccccccc-1000-4000-8000-000000000003');
SELECT public.bolso_admin_oferta_aprovar(current_setting('r.oferta')::uuid);
SELECT pg_temp.login('bbbbbbbb-1000-4000-8000-000000000002');
SELECT pg_temp.ok('cliente vê oferta publicada',jsonb_array_length(public.bolso_ofertas_listar()->'ofertas')=1);
SELECT pg_temp.ok('provisão, autor e política interna não chegam ao cliente',NOT(public.bolso_ofertas_listar()->'ofertas'->0 ?| ARRAY['provisao_ia_centavos','criado_por','aprovado_por','politica_id']));
SELECT pg_temp.ok('catálogo não permite pagar',NOT(public.bolso_ofertas_listar()->>'pagamentos_habilitados')::boolean);
SELECT pg_temp.ok('listar catálogo não muda saldo B',(public.bolso_estado()->'saldo'->>'disponivel')::int=10);
SELECT pg_temp.login('cccccccc-1000-4000-8000-000000000003');
SELECT set_config('r.oferta2',public.bolso_admin_oferta_salvar('{"codigo":"fixture-recarga","nome":"Nova oferta sintética","preco_centavos":2222,"creditos":9,"validade_dias":31,"provisao_ia_centavos":500,"politica_id":"11111111-1000-4000-8000-000000000001"}')::text,true);
SELECT public.bolso_admin_oferta_aprovar(current_setting('r.oferta2')::uuid);
RESET ROLE;
SELECT pg_temp.ok('nova versão arquiva antiga sem sobrescrever',(SELECT estado='arquivado' AND preco_centavos=1234 FROM public.bolso_ofertas WHERE id=current_setting('r.oferta')::uuid)
AND (SELECT estado='publicado' AND versao=2 AND preco_centavos=2222 FROM public.bolso_ofertas WHERE id=current_setting('r.oferta2')::uuid));
SELECT pg_temp.falha('publicada é imutável',format('UPDATE public.bolso_ofertas SET preco_centavos=1 WHERE id=%L',current_setting('r.oferta2')),'outra versão');
SELECT pg_temp.login('cccccccc-1000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT public.bolso_admin_oferta_arquivar(current_setting('r.oferta2')::uuid);
SELECT public.bolso_admin_oferta_arquivar(current_setting('r.oferta2')::uuid);
SELECT pg_temp.login('bbbbbbbb-1000-4000-8000-000000000002');
SELECT pg_temp.ok('arquivada desaparece do catálogo',public.bolso_ofertas_listar()->'ofertas'='[]'::jsonb);

-- Nenhum evento legado pode conceder uma compra sem ordem/valor verificados.
RESET ROLE;
SELECT set_config('r.direitos_antes',(SELECT count(*)::text FROM public.bolso_direitos),true);
SELECT pg_temp.login(NULL,'service_role'); SET LOCAL ROLE service_role;
SELECT pg_temp.ok('pagamentos OFF somente guarda evento',public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"recarga-off","tipo":"aprovado","produto":"recarga","referencia":"compra-fixture-off","user_id":"bbbbbbbb-1000-4000-8000-000000000002","ocorrido_em":"2026-10-27T12:00:00Z"}')='guardado: pagamentos desligados');
RESET ROLE; UPDATE public.bolso_config SET pagamentos=true;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok('mesmo flag ON, recarga exige pedido verificado',public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"recarga-on","tipo":"aprovado","produto":"recarga","referencia":"compra-fixture-on","user_id":"bbbbbbbb-1000-4000-8000-000000000002","ocorrido_em":"2026-10-27T12:00:00Z"}') LIKE '%pedido autenticado%');
SELECT pg_temp.ok('anual legado também exige valor verificado',public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"anual-on","tipo":"aprovado","produto":"anual","referencia":"anual-fixture-on","user_id":"bbbbbbbb-1000-4000-8000-000000000002","ocorrido_em":"2026-10-27T12:00:00Z"}') LIKE '%pedido autenticado%');
SELECT pg_temp.ok('evento repetido idempotente',public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"recarga-on","tipo":"aprovado","produto":"recarga","referencia":"compra-fixture-on","user_id":"bbbbbbbb-1000-4000-8000-000000000002","ocorrido_em":"2026-10-27T12:00:00Z"}')='repetido');
RESET ROLE;
SELECT pg_temp.ok('nenhuma aprovação criou direito',(SELECT count(*) FROM public.bolso_direitos)=current_setting('r.direitos_antes')::int);
SELECT pg_temp.ok('nenhum lote ficou negativo',NOT EXISTS(SELECT 1 FROM public.bolso_creditos GROUP BY direito_id HAVING sum(delta_disponivel)<0 OR sum(delta_reservado)<0));
SELECT pg_temp.ok('nenhum trabalho fecha lote de dois jeitos',NOT EXISTS(SELECT 1 FROM public.bolso_creditos WHERE tipo IN ('captura','liberacao') GROUP BY job_id,direito_id HAVING count(*)>1));
SELECT n,teste,ok,detalhe FROM pg_temp.r ORDER BY n;
ROLLBACK;
