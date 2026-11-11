-- Reabertura explícita e retirada da aprovação.
-- Roda no banco descartável depois das migrations. Só lê definições.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT * FROM no_plan();

SELECT ok(
  pg_get_functiondef('public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure)
    LIKE '%reabrir_cancelada%'
    AND pg_get_functiondef('public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure)
      LIKE '%editorial_can_publish_client%'
    AND pg_get_functiondef('public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure)
      LIKE '%cancelled publication stays cancelled until an admin or manager reopens it%',
  'o save comum só reabre cancelada com marca e admin/gestor'
);

SELECT ok(
  pg_get_functiondef('public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure)
    LIKE '%reabrir_cancelada%'
    AND pg_get_functiondef('public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure)
      LIKE '%publication_reopened%',
  'o save aprovado também exige a marca e grava publication_reopened'
);

SELECT ok(
  pg_get_functiondef('public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure)
    LIKE '%scheduled_at = NULL%'
    AND pg_get_functiondef('public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure)
      LIKE '%editorial_file_is_publishable_media%'
    AND pg_get_functiondef('public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure)
      LIKE '%from_status = ''scheduled''%',
  'o reopen limpa a data e não estende aprovação de plano que não estava agendado'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.reagendar_publicacao_cancelada(uuid,integer,timestamptz,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.reagendar_publicacao_cancelada(uuid,integer,timestamptz,text)', 'EXECUTE'),
  'só quem está autenticado reagenda a cancelada, numa função só'
);

SELECT ok(
  pg_get_functiondef('public.withdraw_file_client_approval(uuid)'::regprocedure) LIKE '%can_manage_client%'
  AND pg_get_functiondef('public.withdraw_file_client_approval(uuid)'::regprocedure) LIKE '%approval_withdrawn%'
  AND pg_get_functiondef('public.mesa_entrega_acompanha_aprovacao()'::regprocedure) LIKE '%approval_withdrawn%'
  AND pg_get_functiondef('public.mesa_entrega_acompanha_aprovacao()'::regprocedure) LIKE '%sent_for_approval_file_id = NULL%',
  'retirar da aprovação volta ao rascunho e a Mesa solta o vínculo'
);

SELECT * FROM finish();
ROLLBACK;
