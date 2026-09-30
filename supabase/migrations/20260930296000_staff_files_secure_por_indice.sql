-- EX-04 (30/09): a view de arquivos da equipe passa a usar os índices de files.
--
-- Antes, public.staff_files_secure lia de app_private.staff_files_secure_rows(),
-- uma função SQL SECURITY DEFINER (não pode ser inlinada): toda leitura
-- percorria a tabela files inteira, com can_access_client linha a linha, e só
-- depois aplicava o filtro por id ou por cliente. Buscar 2 arquivos custava o
-- mesmo que buscar todos. EXPLAIN ANALYZE em 30/09 (só leitura):
--   admin:   2 ids 312 ms, um cliente (329 arquivos) 382 ms, limit 500 607 a 642 ms
--   gerente: 2 ids 764 ms, um cliente 906 ms, limit 500 1.107 ms
-- Com a SQL desta migration lida do mesmo jeito:
--   admin:   2,3 ms, 5,5 a 6 ms, 20 a 22 ms
--   gerente: 16 ms, 28 ms, 47 ms
--
-- O que muda:
-- 1) A fonte das linhas é uma view privada, dona postgres e com
--    security_barrier. Como a função, ela lê files com os privilégios do dono
--    (authenticated não tem SELECT em files); a igualdade de uuid é leakproof,
--    então o filtro de id e de client_id desce até o índice.
-- 2) A regra é a mesma, com can_access_client como fonte da verdade, mas
--    conferida uma vez por cliente (26 perfis) em vez de uma vez por arquivo:
--    app_private.staff_clientes_acessiveis devolve os clientes que a pessoa
--    pode ver, e o arquivo entra quando o client_id está nessa lista.
--    files.client_id é FK para profiles(id); client_id nulo continua fora para
--    quem não é admin (can_access_client(null) é falso para eles). Se um dia a
--    FK mudar, o erro é para menos (fecha), nunca para mais.
-- 3) Atalho do admin (resultado idêntico): para o admin, can_access_client é
--    sempre verdadeiro; o teste de papel roda uma vez por consulta (InitPlan).
--    is_staff também passa a rodar uma vez.
--
-- Mesmas linhas para todo mundo (conferido em 30/09, só leitura, com a SQL
-- desta migration: count e md5 iguais para admin, gerente, design e cliente).
-- A view pública continua security_invoker (os joins em profiles e projects
-- seguem com a RLS de quem consulta), com as mesmas colunas, na mesma ordem, e
-- os mesmos privilégios. A regra de acesso não fica mais fraca.
-- Idempotente. A função antiga fica sem uso (pode sair depois).

CREATE OR REPLACE VIEW app_private.staff_clientes_acessiveis
WITH (security_barrier = true) AS
  SELECT p.id
  FROM public.profiles AS p
  WHERE public.can_access_client(p.id);

ALTER VIEW app_private.staff_clientes_acessiveis OWNER TO postgres;

REVOKE ALL ON TABLE app_private.staff_clientes_acessiveis FROM PUBLIC;
REVOKE ALL ON TABLE app_private.staff_clientes_acessiveis FROM anon;
REVOKE ALL ON TABLE app_private.staff_clientes_acessiveis FROM authenticated;
REVOKE ALL ON TABLE app_private.staff_clientes_acessiveis FROM service_role;
-- Só os ids que a própria pessoa já pode ver (can_access_client dela).
GRANT SELECT ON TABLE app_private.staff_clientes_acessiveis TO authenticated;
GRANT SELECT ON TABLE app_private.staff_clientes_acessiveis TO service_role;

CREATE OR REPLACE VIEW app_private.staff_files_rows
WITH (security_barrier = true) AS
  SELECT f.*
  FROM public.files AS f
  WHERE (SELECT public.is_staff((SELECT auth.uid())))
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR f.client_id IN (SELECT a.id FROM app_private.staff_clientes_acessiveis AS a)
    );

ALTER VIEW app_private.staff_files_rows OWNER TO postgres;

REVOKE ALL ON TABLE app_private.staff_files_rows FROM PUBLIC;
REVOKE ALL ON TABLE app_private.staff_files_rows FROM anon;
REVOKE ALL ON TABLE app_private.staff_files_rows FROM authenticated;
REVOKE ALL ON TABLE app_private.staff_files_rows FROM service_role;
-- Mesma exposição da função de hoje (EXECUTE para authenticated e service_role).
-- O schema app_private continua fora da API e sem USAGE para authenticated: a
-- view pública referencia esta pelo OID, como fazia com a função.
GRANT SELECT ON TABLE app_private.staff_files_rows TO authenticated;
GRANT SELECT ON TABLE app_private.staff_files_rows TO service_role;

CREATE OR REPLACE VIEW public.staff_files_secure
WITH (security_barrier = true, security_invoker = true) AS
 SELECT file_row.id,
    file_row.project_id,
    file_row.client_id,
    file_row.uploaded_by,
    file_row.file_name,
    file_row.file_url,
    file_row.file_type,
    file_row.folder,
    file_row.approval_status,
    file_row.feedback,
    file_row.created_at,
    file_row.version,
    file_row.parent_file_id,
    file_row.caption,
    file_row.carousel_text,
    file_row.description,
    file_row.mime_type,
    file_row.extension,
    file_row.size_bytes,
    file_row.sha256,
    file_row.storage_bucket,
    file_row.storage_path,
    file_row.tags,
    file_row.visibility,
    file_row.sensitivity,
    file_row.requires_approval,
    file_row.status,
    file_row.extraction_status,
    file_row.extraction_error,
    file_row.page_count,
    file_row.sheet_count,
    file_row.slide_count,
    file_row.extracted_metadata,
    file_row.source,
    file_row.idempotency_key,
    file_row.archived_at,
    file_row.updated_at,
    file_row.agency_approval_status,
    file_row.agency_feedback,
    file_row.agency_reviewed_by,
    file_row.agency_reviewed_at,
    file_row.client_decided_by,
    file_row.client_decided_at,
    file_row.approval_requested_at,
    file_row.revision_of_file_id,
    file_row.locked_at,
    jsonb_build_object('full_name', uploader.full_name) AS uploader,
    jsonb_build_object('name', project.name) AS project,
    jsonb_build_object('full_name', client.full_name, 'company_name', client.company_name) AS client
   FROM app_private.staff_files_rows file_row
     LEFT JOIN public.profiles uploader ON uploader.id = file_row.uploaded_by
     LEFT JOIN public.projects project ON project.id = file_row.project_id
     LEFT JOIN public.profiles client ON client.id = file_row.client_id
  WHERE (SELECT public.is_staff((SELECT auth.uid())))
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR file_row.client_id IN (SELECT a.id FROM app_private.staff_clientes_acessiveis AS a)
    );

REVOKE ALL ON TABLE public.staff_files_secure FROM PUBLIC;
REVOKE ALL ON TABLE public.staff_files_secure FROM anon;
GRANT SELECT ON TABLE public.staff_files_secure TO authenticated;
