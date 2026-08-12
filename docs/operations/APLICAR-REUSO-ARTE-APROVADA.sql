-- COMO APLICAR (nao consome credito de IA do Lovable)
-- 1. Abra o SQL Editor do banco: no Lovable, Backend/Database > SQL Editor
--    (ou o painel do Supabase do projeto, secao SQL Editor).
-- 2. Cole TODO o conteudo abaixo em uma unica execucao e clique em Run.
-- 3. Sucesso: aparece o aviso 'reuso de arte aprovada habilitado com sucesso'.
--    Se aparecer 'guarda ... nao encontrada', pare e me avise: nada foi alterado.
-- Seguro: forward-only, idempotente, nao altera tabelas nem registros.

-- Permite montar um post ainda nao aprovado com uma arte que o cliente ja
-- aprovou, sem pedir uma segunda aprovacao da mesma peca.
--
-- As duas guardas de imutabilidade de save_editorial_post_unlocked (funcao
-- interna chamada pelo wrapper public.save_editorial_post) tratavam qualquer
-- arquivo travado como intocavel, inclusive o ja aprovado que se quer
-- justamente reaproveitar, barrando o fluxo com:
--   "the editorial primary file is already under review; create a revision"
--   "approved editorial copy is immutable; create a revision"
--
-- Regra final: arte totalmente publicavel (duplo gate aprovado, travada, mesmo
-- cliente e projeto) pode ser anexada enquanto o POST ainda nao esta aprovado
-- (post novo, sem arte, ou com arte ainda editavel). Trocar a arte de um post
-- ja aprovado continua exigindo revisao.
--
-- Forward-only, aditiva e idempotente: nenhuma tabela, coluna ou registro e
-- alterado. A funcao e reescrita a partir da definicao vigente no banco; se um
-- trecho esperado nao existir, nada e aplicado.

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_primary_guard text;
  new_primary_guard text;
  old_copy_guard text;
  new_copy_guard text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO original_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_editorial_post_unlocked';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION 'save_editorial_post_unlocked nao encontrada; nada a aplicar';
  END IF;

  old_primary_guard := $a$    AND NOT COALESCE(
      public.file_is_editable(_primary_file_id),
      false
    ) THEN
    RAISE EXCEPTION 'the editorial primary file is already under review; create a revision';$a$;

  new_primary_guard := $b$    AND NOT COALESCE(
      public.file_is_editable(_primary_file_id),
      false
    )
    AND NOT (
      COALESCE(public.editorial_file_is_publishable(_primary_file_id, _client_id, _project_id), false)
      AND (
        _is_new
        OR _existing_post.primary_file_id IS NULL
        OR COALESCE(public.file_is_editable(_existing_post.primary_file_id), false)
      )
    ) THEN
    RAISE EXCEPTION 'the editorial primary file is already under review; create a revision';$b$;

  old_copy_guard := $c$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )$c$;

  new_copy_guard := $d$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )
      AND NOT (
        COALESCE(public.editorial_file_is_publishable(requested.file_id, _client_id, _project_id), false)
        AND (
          _is_new
          OR _existing_post.primary_file_id IS NULL
          OR COALESCE(public.file_is_editable(_existing_post.primary_file_id), false)
        )
      )$d$;

  IF position(new_copy_guard IN original_definition) > 0 THEN
    RAISE NOTICE 'reuso de arte aprovada ja habilitado; nada a fazer';
    RETURN;
  END IF;

  IF position(old_primary_guard IN original_definition) = 0 THEN
    RAISE EXCEPTION 'guarda do arquivo principal nao encontrada; nada foi alterado';
  END IF;

  IF position(old_copy_guard IN original_definition) = 0 THEN
    RAISE EXCEPTION 'guarda da copia aprovada nao encontrada; nada foi alterado';
  END IF;

  patched_definition := replace(original_definition, old_primary_guard, new_primary_guard);
  patched_definition := replace(patched_definition, old_copy_guard, new_copy_guard);

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION 'nenhuma alteracao produzida; nada foi aplicado';
  END IF;

  EXECUTE patched_definition;
  RAISE NOTICE 'reuso de arte aprovada habilitado com sucesso';
END
$patch$;

-- A funcao interna nunca e chamada direto pelo cliente: quem expoe e o wrapper
-- public.save_editorial_post, cujas permissoes permanecem intactas.
REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  TO service_role;
