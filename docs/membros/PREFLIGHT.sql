-- Somente leitura. Executar antes de qualquer proposta de aplicação em produção.
SELECT version();
SELECT table_name,column_name,data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('financial_plans','financial_plan_versions','financial_client_terms','vendas_integracoes','vendas_eventos','profiles','user_roles')
ORDER BY table_name,ordinal_position;
SELECT p.proname,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('handle_new_user','has_role','is_staff','can_access_client');
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'membros_%';
SELECT id,public FROM storage.buckets WHERE id='membros-materiais';
SELECT schemaname,tablename,policyname,permissive,cmd,qual,with_check FROM pg_policies
WHERE (schemaname='storage' AND tablename='objects') OR (schemaname='public' AND tablename IN ('profiles','user_roles','projects','documents'));
