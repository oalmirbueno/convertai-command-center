-- Regra de espera pela aprovacao no publicador automatico.
--
-- Antes: uma publicacao agendada com arte ainda nao aprovada entrava na fila
-- na hora marcada e falhava no ultimo passo (a baixa oficial exige o duplo
-- gate). Agora ela simplesmente ESPERA: so entra na fila quando a arte esta
-- aprovada, e se a aprovacao chegou depois do horario marcado, a publicacao
-- sai ate 1 hora depois da aprovacao - nunca antes.
--
-- Patch textual verificado sobre a funcao vigente: se o trecho esperado nao
-- existir, nada e aplicado. Idempotente.

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_fragment text;
  new_fragment text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO original_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'editorial_autopublish_tick';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION 'editorial_autopublish_tick nao encontrada; nada a aplicar';
  END IF;

  old_fragment := $a$      AND post.content_type IN ('static', 'design', 'story', 'carousel', 'reel', 'video', 'short')$a$;

  new_fragment := $b$      AND post.content_type IN ('static', 'design', 'story', 'carousel', 'reel', 'video', 'short')
      -- Espera a aprovacao: arte precisa estar publicavel, e se a aprovacao
      -- veio depois do horario marcado, respeita 1 hora de carencia.
      AND COALESCE(
        public.editorial_file_is_publishable(
          COALESCE(publication.file_id, post.primary_file_id),
          publication.client_id,
          publication.project_id
        ),
        false
      )
      AND COALESCE((
        SELECT approval_file.client_decided_at <= publication.scheduled_at
            OR now() >= approval_file.client_decided_at + interval '1 hour'
        FROM public.files AS approval_file
        WHERE approval_file.id = COALESCE(publication.file_id, post.primary_file_id)
      ), true)$b$;

  IF position(new_fragment IN original_definition) > 0 THEN
    RAISE NOTICE 'regra de espera pela aprovacao ja aplicada; nada a fazer';
    RETURN;
  END IF;

  IF position(old_fragment IN original_definition) = 0 THEN
    RAISE EXCEPTION 'trecho de enfileiramento nao encontrado; nada foi alterado';
  END IF;

  patched_definition := replace(original_definition, old_fragment, new_fragment);

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION 'nenhuma alteracao produzida; nada foi aplicado';
  END IF;

  EXECUTE patched_definition;
  RAISE NOTICE 'regra de espera pela aprovacao aplicada com sucesso';
END
$patch$;
