-- 28/09: "Aprovar tudo agora" (admin aprova pelo cliente) falhava com
-- file_approval_events_type_check: a função record_offline_client_approval
-- grava 'client_approved_offline', que a regra da tabela nunca aceitou.
-- A regra passa a aceitar esse tipo; nada mais muda.
ALTER TABLE public.file_approval_events
  DROP CONSTRAINT IF EXISTS file_approval_events_type_check;
ALTER TABLE public.file_approval_events
  ADD CONSTRAINT file_approval_events_type_check CHECK (
    event_type = ANY (ARRAY[
      'agency_review_requested'::text,
      'agency_approved'::text,
      'agency_rejected'::text,
      'released_client_shared'::text,
      'released_for_approval'::text,
      'client_approved'::text,
      'client_rejected'::text,
      'client_approved_offline'::text,
      'contract_signed'::text
    ])
  );
