-- Frente PERF-banco (30/09/2026), achado B13: higiene de segurança apontada
-- pelo advisor, sem efeito na tela.
--
-- 1) function_search_path_mutable (3): notificacao_merece_email(text),
--    operator_audit_imutavel() e operator_approval_payload_imutavel() não
--    fixavam o search_path. Nenhum corpo cita objeto sem esquema (só
--    literais, IN, NEW/OLD e RAISE), então search_path = '' não muda nada.
--
-- 2) anon_security_definer_function_executable: 12 funções de GATILHO
--    SECURITY DEFINER apareciam como RPC para anon e authenticated (proacl com
--    '=X/postgres', ou seja, EXECUTE para PUBLIC). Hoje a chamada direta já
--    falha, porque função de gatilho só roda como gatilho, mas a exposição não
--    serve para nada. O REVOKE inclui PUBLIC: revogar só de anon e
--    authenticated não surtiria efeito. Os gatilhos continuam disparando: o
--    EXECUTE só é conferido no CREATE TRIGGER (update_updated_at_column já
--    está assim, com proacl {postgres,service_role} e 28 gatilhos ativos).
--    postgres (dono) e service_role mantêm EXECUTE.
--
-- Fora daqui, de propósito: as 7 RPCs públicas por token (briefing_public_*,
-- idv_*), que são intencionais; mover pg_trgm do public (exige revisar
-- similarity() e os operadores usados sem esquema); e a proteção contra senha
-- vazada no Auth, que muda o cadastro de senha e fica a critério do dono.
--
-- Idempotente (ALTER e REVOKE podem rodar de novo). Não aplicar direto: o
-- dono aplica na integração (SQL Editor).

-- ─── 1) search_path fixo ───────────────────────────────────────────────
ALTER FUNCTION public.notificacao_merece_email(text) SET search_path = '';
ALTER FUNCTION public.operator_audit_imutavel() SET search_path = '';
ALTER FUNCTION public.operator_approval_payload_imutavel() SET search_path = '';

-- ─── 2) funções de gatilho fora do alcance de chamada direta ──────────
REVOKE EXECUTE ON FUNCTION
  public.central_review_avisar_decisao(),
  public.central_review_avisar_pedido(),
  public.central_review_enviado_marca_ciclo(),
  public.client_request_avisa_equipe(),
  public.commercial_lead_liga_empresa(),
  public.file_approval_avisa_equipe(),
  public.movimento_atualiza_dossie(),
  public.notificacao_por_email(),
  public.notifications_sem_duplicata(),
  public.operator_avisar_ordem_executada(),
  public.tasks_acao_feita_no_dossie(),
  public.tasks_encerra_propostas()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.central_review_avisar_decisao(),
  public.central_review_avisar_pedido(),
  public.central_review_enviado_marca_ciclo(),
  public.client_request_avisa_equipe(),
  public.commercial_lead_liga_empresa(),
  public.file_approval_avisa_equipe(),
  public.movimento_atualiza_dossie(),
  public.notificacao_por_email(),
  public.notifications_sem_duplicata(),
  public.operator_avisar_ordem_executada(),
  public.tasks_acao_feita_no_dossie(),
  public.tasks_encerra_propostas()
TO service_role;

-- Conferência depois de aplicar (só leitura):
-- select p.oid::regprocedure, p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname in ('central_review_avisar_decisao', 'tasks_encerra_propostas');
--   -> {postgres=X/postgres,service_role=X/postgres}
-- get_advisors security: anon_security_definer_function_executable cai para 7 (briefing_public_*, idv_*)
-- e function_search_path_mutable para 0.
-- Fumaça (begin/rollback no SQL Editor, como authenticated): um UPDATE em tasks e um INSERT em
-- notifications disparam os gatilhos normalmente.
