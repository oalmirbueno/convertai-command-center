-- Agenda do cliente: a mesma peça aparecia duas vezes (01/11/2026).
--
-- A agenda esconde a pílula da tarefa quando ela já virou conteúdo (o card do
-- conteúdo é quem aparece). O índice tarefa -> conteúdo vem de
-- editorial_post_internal, que só a equipe lê (dados internos). Para o cliente
-- o índice vinha vazio: ele via a tarefa no prazo antigo E o card do conteúdo
-- no dia novo (ou o conteúdo em "sem data").
--
-- Esta função devolve ao cliente SÓ os identificadores do vínculo (post_id,
-- task_id, revision_of_post_id) dos conteúdos DELE, ativos e não arquivados -
-- o mesmo recorte que a equipe usa para montar o índice. Nada de nota interna,
-- responsável ou outro campo de editorial_post_internal sai daqui.
--
-- Somente acrescenta: nenhuma tabela, coluna, policy ou dado muda.
--
-- Preflight (antes de aplicar, no SQL Editor, só leitura):
--   SELECT to_regprocedure('public.editorial_client_task_links()');  -- deve vir NULL
--   SELECT to_regprocedure('public.has_role(uuid, public.app_role)'); -- deve existir
--
-- Rollback lógico (desfaz por completo; a tela volta ao comportamento anterior
-- sozinha, porque trata a função ausente como "sem vínculo"):
--   DROP FUNCTION IF EXISTS public.editorial_client_task_links();

CREATE OR REPLACE FUNCTION public.editorial_client_task_links()
RETURNS TABLE (post_id uuid, task_id uuid, revision_of_post_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT internal.post_id, internal.task_id, internal.revision_of_post_id
  FROM public.editorial_post_internal AS internal
  JOIN public.editorial_posts AS post
    ON post.id = internal.post_id
  WHERE internal.task_id IS NOT NULL
    AND post.archived_at IS NULL
    AND post.production_status IN ('draft', 'production', 'ready')
    AND post.client_id = auth.uid()
    AND internal.client_id = auth.uid()
    AND public.has_role(auth.uid(), 'client'::public.app_role)
$$;

REVOKE ALL ON FUNCTION public.editorial_client_task_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editorial_client_task_links() TO authenticated;

COMMENT ON FUNCTION public.editorial_client_task_links() IS
  'Agenda do cliente: vínculo tarefa -> conteúdo (só ids) dos conteúdos ativos do próprio cliente, para não mostrar a mesma peça duas vezes.';
