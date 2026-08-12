-- COMO APLICAR (nao gasta credito de IA):
-- 1. Abra o SQL Editor do banco (Lovable > Backend/Database > SQL, ou o painel do Supabase do projeto).
-- 2. Cole TODO o conteudo abaixo e execute.
-- 3. Se aparecer 'expected immutability guards not found', pare e avise: nada foi alterado.
-- Seguro: forward-only, idempotente, nao altera nenhuma tabela ou registro.

-- Permite montar um post ainda não aprovado com uma arte que o cliente já
-- aprovou, sem pedir uma segunda aprovação da mesma peça.
--
-- Contexto do fluxo real: a arte é enviada em Arquivos, passa pelo duplo gate
-- (aprovação da agência + do cliente) e fica travada. Só então a equipe monta o
-- conteúdo na Agenda. As duas guardas de imutabilidade de save_editorial_post
-- barravam esse caminho com
--   "the editorial primary file is already under review; create a revision"
--   "approved editorial copy is immutable; create a revision"
-- porque tratavam qualquer arquivo travado como intocável, inclusive o já
-- aprovado que se quer justamente reaproveitar.
--
-- Regra desta migration: um arquivo TOTALMENTE publicável (duplo gate aprovado,
-- travado, do mesmo cliente e projeto) pode ser anexado enquanto o POST ainda
-- não está aprovado, ou seja, quando o post é novo ou quando a arte atual dele
-- ainda é editável. Trocar a arte de um post já aprovado continua exigindo
-- revisão: ninguém altera pelas costas do cliente aquilo que ele aprovou.
--
-- Forward-only e aditiva: nenhuma tabela, coluna ou registro é alterado. A
-- função é reescrita a partir da própria definição vigente no banco, com
-- substituições textuais verificadas; se qualquer trecho esperado não existir,
-- a migration falha inteira e nada é aplicado.

DO $migration$
DECLARE
  _definition text;
  _patched text;

  -- Condição comum: a peça está aprovada de ponta a ponta E o post ainda não
  -- carrega uma arte aprovada (novo, sem arte, ou com arte ainda editável).
  _allow_primary constant text :=
$allow$    AND NOT (
      COALESCE(
        public.editorial_file_is_publishable(
          _primary_file_id,
          _client_id,
          _project_id
        ),
        false
      )
      AND (
        _is_new
        OR _existing_post.primary_file_id IS NULL
        OR COALESCE(
          public.file_is_editable(_existing_post.primary_file_id),
          false
        )
      )
    )$allow$;

  _old_primary constant text :=
$old1$  IF _primary_file_id IS NOT NULL
    AND (
      _is_new
      OR _existing_post.primary_file_id IS DISTINCT FROM _primary_file_id
    )
    AND NOT COALESCE(
      public.file_is_editable(_primary_file_id),
      false
    ) THEN
    RAISE EXCEPTION 'the editorial primary file is already under review; create a revision';$old1$;

  _old_copy constant text :=
$old2$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )$old2$;

  _new_copy constant text :=
$new2$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )
      AND NOT (
        COALESCE(
          public.editorial_file_is_publishable(
            requested.file_id,
            _client_id,
            _project_id
          ),
          false
        )
        AND (
          _is_new
          OR _existing_post.primary_file_id IS NULL
          OR COALESCE(
            public.file_is_editable(_existing_post.primary_file_id),
            false
          )
        )
      )$new2$;

  _new_primary text;
BEGIN
  SELECT pg_get_functiondef(procedure_row.oid)
  INTO _definition
  FROM pg_proc AS procedure_row
  JOIN pg_namespace AS schema_row
    ON schema_row.oid = procedure_row.pronamespace
  WHERE schema_row.nspname = 'public'
    AND procedure_row.proname = 'save_editorial_post';

  IF _definition IS NULL THEN
    RAISE EXCEPTION 'save_editorial_post not found; nothing to patch';
  END IF;

  -- Já aplicada: mantém idempotente para reexecução do lote.
  IF position(_new_copy IN _definition) > 0 THEN
    RAISE NOTICE 'approved-media reuse already enabled; skipping';
    RETURN;
  END IF;

  IF position(_old_primary IN _definition) = 0
    OR position(_old_copy IN _definition) = 0 THEN
    RAISE EXCEPTION
      'expected immutability guards not found in save_editorial_post; aborting patch';
  END IF;

  -- Guarda 1: arquivo principal do post.
  _new_primary := replace(
    _old_primary,
    $anchor$    ) THEN
    RAISE EXCEPTION 'the editorial primary file is already under review; create a revision';$anchor$,
    '    )' || E'\n' || _allow_primary || ' THEN' || E'\n'
      || '    RAISE EXCEPTION ''the editorial primary file is already under review; create a revision'';'
  );

  _patched := replace(_definition, _old_primary, _new_primary);

  -- Guarda 2: demais arquivos do plano de publicação.
  _patched := replace(_patched, _old_copy, _new_copy);

  IF _patched = _definition THEN
    RAISE EXCEPTION 'patch produced no change; aborting';
  END IF;

  EXECUTE _patched;
END
$migration$;

-- Reafirma as permissões da função (CREATE OR REPLACE preserva, mas o lote
-- oficial exige que o estado final seja explícito).
REVOKE ALL ON FUNCTION public.save_editorial_post(jsonb, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_editorial_post(jsonb, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.save_editorial_post(jsonb, integer) IS
  'Salva post editorial. Post ainda nao aprovado pode reusar arte ja aprovada pelo cliente (duplo gate + travada, mesmo cliente/projeto); trocar a arte de um post aprovado continua exigindo revisao.';
