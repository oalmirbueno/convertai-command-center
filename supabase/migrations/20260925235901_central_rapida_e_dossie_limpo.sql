-- Frente R (25/09 noite): Central lenta e dossiê com linhas em branco.
-- 1) Leitura rápida para o admin: política permissiva que o Postgres avalia
--    antes (nome zz_) e vira InitPlan; o admin já lê todas as linhas destas
--    tabelas pelas regras atuais (conferido: contagem do admin = total nas 14).
--    files liberados: 1.104 ms -> ~5 ms. Equipe segue pelo caminho de hoje.
DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY[
    'files', 'reports', 'project_memory', 'client_dossiers', 'editorial_posts',
    'editorial_publications', 'milestones', 'weekly_cycle_progress', 'cycle_rituals',
    'social_metrics_weekly', 'ads_campaign_daily', 'ads_campaigns', 'ads_sales'
  ] LOOP
    IF to_regclass('public.' || _t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS zz_admin_leitura_rapida ON public.%I', _t);
    EXECUTE format(
      'CREATE POLICY zz_admin_leitura_rapida ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin''::public.app_role)))',
      _t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS zz_admin_leitura_rapida ON public.tasks;
CREATE POLICY zz_admin_leitura_rapida ON public.tasks FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)) AND project_id IS NOT NULL);

-- 2) Dossiê sem as linhas em branco acumuladas: rtrim também tira \n, \r e \t.
CREATE OR REPLACE FUNCTION public.dossie_registrar_avancos_interno(_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _atual public.client_dossiers%rowtype;
  _marcador constant text := '## Avanços recentes (automático';
  _humano text; _secao text; _novo text; _pos integer;
BEGIN
  select * into _atual from public.client_dossiers d
    where d.client_id = _client_id and d.dossier_type = 'contexto' and d.project_id is null and d.is_current limit 1;
  if not found then return false; end if;
  _secao := public.dossie_avancos_texto(_client_id, 14);
  _pos := position(_marcador in _atual.content);
  _humano := case when _pos > 0 then rtrim(left(_atual.content, _pos - 1), E' \t\r\n') else rtrim(_atual.content, E' \t\r\n') end;
  if _pos > 0 and trim(substr(_atual.content, _pos)) = trim(_secao)
     and left(_atual.content, _pos - 1) = _humano || E'\n\n' then return false; end if;
  _novo := _humano || E'\n\n' || _secao;
  perform public.upsert_current_dossier(
    _client_id := _client_id, _content := _novo, _dossier_type := 'contexto', _project_id := null,
    _summary := _atual.summary, _change_reason := 'Movimentos automáticos do painel (14 dias)',
    _source := 'painel', _actor := 'ciclo', _tags := array['avancos-automaticos'],
    _metadata := coalesce(_atual.metadata, '{}'::jsonb) || jsonb_build_object('auto_avancos', true, 'auto_avancos_em', now()),
    _expected_version := _atual.version);
  return true;
end; $function$;
