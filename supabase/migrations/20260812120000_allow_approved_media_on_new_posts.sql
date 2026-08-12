-- Permite montar um post NOVO com um arquivo que o cliente já aprovou.
--
-- Contexto: o fluxo real da agência aprova a arte em Arquivos (visibilidade
-- "approval", aprovação da agência + do cliente e trava de imutabilidade) e só
-- depois monta o conteúdo na Agenda. A guarda de imutabilidade de
-- save_editorial_post barrava esse caminho com
-- "approved editorial copy is immutable; create a revision", obrigando a
-- reaprovar o que o cliente já tinha aprovado.
--
-- Esta migration afrouxa a guarda APENAS para posts novos e APENAS para
-- arquivos totalmente publicáveis (duplo gate + travados) no mesmo
-- cliente/projeto. Editar um post existente continua exigindo revisão, então
-- ninguém troca a arte de um conteúdo já aprovado pelas costas do cliente.
--
-- Forward-only e aditiva: nenhuma tabela, coluna ou registro é alterado. A
-- função é reescrita a partir da própria definição vigente no banco, com uma
-- substituição textual verificada; se o trecho esperado não existir, a
-- migration falha e nada é aplicado.

DO $migration$
DECLARE
  _definition text;
  _patched text;
  _old_guard constant text :=
$old$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )$old$;
  _new_guard constant text :=
$new$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )
      AND NOT (
        _is_new
        AND COALESCE(
          public.editorial_file_is_publishable(
            requested.file_id,
            _client_id,
            _project_id
          ),
          false
        )
      )$new$;
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
  IF position(_new_guard IN _definition) > 0 THEN
    RAISE NOTICE 'approved-media guard already relaxed; skipping';
    RETURN;
  END IF;

  IF position(_old_guard IN _definition) = 0 THEN
    RAISE EXCEPTION
      'expected immutability guard not found in save_editorial_post; aborting patch';
  END IF;

  _patched := replace(_definition, _old_guard, _new_guard);

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
  'Salva post editorial. Posts novos podem reusar arquivos já aprovados pelo cliente (duplo gate + travados); posts existentes continuam exigindo revisão para trocar arte aprovada.';
