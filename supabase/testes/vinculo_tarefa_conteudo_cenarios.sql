-- Executar SOMENTE em PostgreSQL isolado (PGlite) com o fixture do runner e a
-- migration 20261101230000_cliente_ve_vinculo_tarefa_conteudo aplicada. Dados sintéticos.
BEGIN;
CREATE TEMP TABLE r(n serial,teste text,ok boolean,detalhe text);
CREATE FUNCTION pg_temp.ok(_teste text,_ok boolean,_detalhe text DEFAULT NULL) RETURNS void LANGUAGE sql AS
$$ INSERT INTO pg_temp.r(teste,ok,detalhe) VALUES(_teste,COALESCE(_ok,false),_detalhe) $$;

-- Clientes A e B, e um admin. A tem: post ativo ligado à tarefa 1, post arquivado
-- ligado à tarefa 2, post publicado (fora do recorte) ligado à tarefa 3, post sem
-- tarefa, e a revisão de um post (revision_of_post_id). B tem um post ligado à tarefa 9.
INSERT INTO public.user_roles(user_id,role) VALUES
('a0000000-0000-4000-8000-00000000000a','client'),
('b0000000-0000-4000-8000-00000000000b','client'),
('d0000000-0000-4000-8000-00000000000d','admin');

INSERT INTO public.editorial_posts(id,client_id,production_status,archived_at) VALUES
('10000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','production',NULL),
('10000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-00000000000a','ready','2026-10-01'),
('10000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-00000000000a','published',NULL),
('10000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-00000000000a','draft',NULL),
('10000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-00000000000a','ready',NULL),
('20000000-0000-4000-8000-000000000009','b0000000-0000-4000-8000-00000000000b','ready',NULL);

INSERT INTO public.editorial_post_internal(post_id,client_id,task_id,revision_of_post_id,internal_notes) VALUES
('10000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-000000000001',NULL,'nota interna'),
('10000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-000000000002',NULL,NULL),
('10000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-000000000003',NULL,NULL),
('10000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-00000000000a',NULL,NULL,NULL),
('10000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',NULL),
('20000000-0000-4000-8000-000000000009','b0000000-0000-4000-8000-00000000000b','f0000000-0000-4000-8000-000000000009',NULL,'nota de B');

-- Cliente A
SELECT set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-00000000000a',true);
SELECT pg_temp.ok('cliente A vê o vínculo do conteúdo ativo dele',
  EXISTS (SELECT 1 FROM public.editorial_client_task_links() WHERE post_id='10000000-0000-4000-8000-000000000001' AND task_id='f0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('cliente A vê a revisão com o post de origem (para o índice escolher a versão viva)',
  EXISTS (SELECT 1 FROM public.editorial_client_task_links() WHERE post_id='10000000-0000-4000-8000-000000000005' AND revision_of_post_id='10000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('arquivado não entra',
  NOT EXISTS (SELECT 1 FROM public.editorial_client_task_links() WHERE post_id='10000000-0000-4000-8000-000000000002'));
SELECT pg_temp.ok('publicado não entra (mesmo recorte da equipe: draft, production, ready)',
  NOT EXISTS (SELECT 1 FROM public.editorial_client_task_links() WHERE post_id='10000000-0000-4000-8000-000000000003'));
SELECT pg_temp.ok('post sem tarefa não entra',
  NOT EXISTS (SELECT 1 FROM public.editorial_client_task_links() WHERE post_id='10000000-0000-4000-8000-000000000004'));
SELECT pg_temp.ok('cliente A não vê nada do cliente B',
  NOT EXISTS (SELECT 1 FROM public.editorial_client_task_links() WHERE post_id='20000000-0000-4000-8000-000000000009' OR task_id='f0000000-0000-4000-8000-000000000009'));
SELECT pg_temp.ok('cliente A recebe exatamente 2 vínculos', (SELECT count(*) FROM public.editorial_client_task_links()) = 2,
  (SELECT count(*)::text FROM public.editorial_client_task_links()));

-- Cliente B
SELECT set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-00000000000b',true);
SELECT pg_temp.ok('cliente B vê só o dele',
  (SELECT array_agg(post_id::text) FROM public.editorial_client_task_links()) = ARRAY['20000000-0000-4000-8000-000000000009']);

-- Admin (não é cliente): nada (a equipe já lê pela tabela, com a policy dela).
SELECT set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-00000000000d',true);
SELECT pg_temp.ok('quem não tem papel de cliente não recebe nada',
  NOT EXISTS (SELECT 1 FROM public.editorial_client_task_links()));

-- Sem sessão
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.ok('sem sessão não recebe nada', NOT EXISTS (SELECT 1 FROM public.editorial_client_task_links()));

-- Só ids saem: a função não devolve nota interna nem outra coluna.
SELECT pg_temp.ok('só devolve post_id, task_id e revision_of_post_id',
  (SELECT pg_get_function_result('public.editorial_client_task_links()'::regprocedure))
      = 'TABLE(post_id uuid, task_id uuid, revision_of_post_id uuid)',
  (SELECT pg_get_function_result('public.editorial_client_task_links()'::regprocedure)));

-- Permissões: anon não executa; authenticated executa; função é SECURITY DEFINER com search_path vazio.
SELECT pg_temp.ok('anon não pode executar', NOT has_function_privilege('anon','public.editorial_client_task_links()','EXECUTE'));
SELECT pg_temp.ok('authenticated pode executar', has_function_privilege('authenticated','public.editorial_client_task_links()','EXECUTE'));
SELECT pg_temp.ok('SECURITY DEFINER com search_path vazio',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.editorial_client_task_links()'::regprocedure),
  (SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid='public.editorial_client_task_links()'::regprocedure));

SELECT * FROM pg_temp.r ORDER BY n;
ROLLBACK;
