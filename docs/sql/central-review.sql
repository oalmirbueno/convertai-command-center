-- Central: authenticated review of an immutable report snapshot; no transport.
BEGIN;
ALTER TABLE public.reports ADD COLUMN review_version integer NOT NULL DEFAULT 1 CHECK (review_version > 0);
GRANT SELECT (review_version) ON public.reports TO authenticated;
ALTER TABLE public.operator_approvals
 ADD COLUMN origin text NOT NULL DEFAULT 'operator' CHECK (origin IN ('operator','central')),
 ADD COLUMN report_id uuid REFERENCES public.reports(id) ON DELETE RESTRICT,
 ADD COLUMN client_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
 ADD COLUMN payload_hash text,
 ADD COLUMN request_key text,
 ADD COLUMN review_group_key text,
 ADD COLUMN invalidated_at timestamptz,
 ADD COLUMN invalidation_reason text;
ALTER TABLE public.operator_approvals ALTER COLUMN operator_id DROP NOT NULL;
ALTER TABLE public.operator_approvals ADD CONSTRAINT central_approval_identity CHECK (
 (origin='operator' AND operator_id IS NOT NULL) OR
 (origin='central' AND report_id IS NOT NULL AND client_id IS NOT NULL AND payload_hash IS NOT NULL AND request_key IS NOT NULL)
);
CREATE UNIQUE INDEX central_approval_request_key ON public.operator_approvals(request_key) WHERE origin='central';
CREATE INDEX central_approval_report ON public.operator_approvals(report_id) WHERE origin='central';
ALTER POLICY staff_le_aprovacoes ON public.operator_approvals USING (
 public.has_role(auth.uid(),'admin'::public.app_role)
 OR (origin='operator' AND public.is_staff(auth.uid()))
);
CREATE TABLE public.central_review_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 approval_id uuid NOT NULL REFERENCES public.operator_approvals(id) ON DELETE RESTRICT,
 actor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
 event text NOT NULL,
 comment text,
 idempotency_key text,
 input_hash text,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX central_review_event_key ON public.central_review_events(actor_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.central_review_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY central_review_events_admin_read ON public.central_review_events FOR SELECT TO authenticated
 USING(public.has_role(auth.uid(),'admin'::public.app_role));
REVOKE ALL ON public.central_review_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.central_review_events TO authenticated;
CREATE TABLE public.central_review_dispatches (
 approval_id uuid PRIMARY KEY REFERENCES public.operator_approvals(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'preparado' CHECK(status IN ('preparado','aprovado','enviado','confirmado','erro','incerto','invalidado')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.central_review_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY central_review_dispatches_admin_read ON public.central_review_dispatches FOR SELECT TO authenticated
 USING(public.has_role(auth.uid(),'admin'::public.app_role));
REVOKE ALL ON public.central_review_dispatches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.central_review_dispatches TO authenticated;

CREATE FUNCTION app_private.central_review_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.has_role(auth.uid(),'admin'::public.app_role),false) THEN
  RAISE EXCEPTION 'CENTRAL_ADMIN_REQUIRED' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.central_review_admin() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.central_review_source(_client_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.client_dossiers%rowtype; scope jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) OR NOT public.can_access_client(_client_id) THEN
  RAISE EXCEPTION 'CENTRAL_CLIENT_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object(
  'client_id',p.id,'plan_name',to_jsonb(p)->'plan_name','services_config',to_jsonb(p)->'services_config',
  'plan_status',to_jsonb(p)->'plan_status',
  'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'status',to_jsonb(pr)->'status',
    'name',to_jsonb(pr)->'name','description',to_jsonb(pr)->'description','scope',to_jsonb(pr)->'scope',
    'objectives',to_jsonb(pr)->'objectives','updated_at',to_jsonb(pr)->'updated_at',
    'project_type',to_jsonb(pr)->'project_type') ORDER BY pr.id)
   FROM public.projects pr WHERE pr.client_id=p.id AND pr.deleted_at IS NULL),'[]'::jsonb),
  'dossiers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',cd.id,'project_id',cd.project_id,
    'dossier_type',cd.dossier_type,'version',cd.version,'updated_at',cd.updated_at,'content',cd.content,
    'summary',to_jsonb(cd)->'summary') ORDER BY cd.id)
   FROM public.client_dossiers cd WHERE cd.client_id=p.id AND cd.is_current),'[]'::jsonb))
 INTO scope FROM public.profiles p WHERE p.id=_client_id AND p.deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'CENTRAL_CLIENT_UNAVAILABLE'; END IF;
 SELECT * INTO d FROM public.client_dossiers WHERE client_id=_client_id AND is_current
 ORDER BY (dossier_type='contexto' AND project_id IS NULL) DESC,updated_at DESC,id LIMIT 1;
 RETURN jsonb_build_object('dossier_id',d.id,'dossier_version',d.version,'dossier_updated_at',d.updated_at,
  'scope_hash',encode(extensions.digest(scope::text,'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.central_review_source(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.central_review_source(uuid) TO authenticated;

CREATE FUNCTION app_private.central_review_result(a public.operator_approvals) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',a.id,'approval_id',a.id,'client_id',a.client_id,'report_id',a.report_id,
 'payload_version',a.payload_version,'payload_hash',a.payload_hash,'status',a.status,'payload',a.payload,
 'created_at',a.created_at,'decision_note',a.decision_note,'valid_until',a.valid_until)
$$;
REVOKE ALL ON FUNCTION app_private.central_review_result(public.operator_approvals) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.central_review_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.origin='central' OR NEW.origin='central' THEN
  IF (to_jsonb(NEW)-ARRAY['status','decided_by','decided_at','decision_note','executed_at','execution_evidence','execution_run_key','invalidated_at','invalidation_reason'])
   IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','decided_by','decided_at','decision_note','executed_at','execution_evidence','execution_run_key','invalidated_at','invalidation_reason']) THEN
   RAISE EXCEPTION 'CENTRAL_SNAPSHOT_IMMUTABLE';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.central_review_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER central_review_immutable BEFORE UPDATE ON public.operator_approvals
 FOR EACH ROW EXECUTE FUNCTION app_private.central_review_immutable();

CREATE FUNCTION app_private.central_review_report_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.review_version:=1; RETURN NEW; END IF;
 NEW.review_version:=OLD.review_version;
 -- Include every report field except status/version; published immutability
 -- remains enforced by the existing reports_secure_guard trigger.
 IF (to_jsonb(NEW)-ARRAY['review_version','status']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['review_version','status']) THEN
  NEW.review_version:=OLD.review_version+1;
  WITH invalidated AS (
   UPDATE public.operator_approvals SET status='expirado',invalidated_at=now(),invalidation_reason='report_changed'
   WHERE origin='central' AND report_id=OLD.id AND executed_at IS NULL
     AND status IN ('pendente','adiado','aprovado') RETURNING id
  )
  INSERT INTO public.central_review_events(approval_id,actor_id,event)
   SELECT id,auth.uid(),'report_changed' FROM invalidated;
  UPDATE public.central_review_dispatches SET status='invalidado',updated_at=now()
   WHERE approval_id IN (SELECT id FROM public.operator_approvals WHERE origin='central' AND report_id=OLD.id AND invalidated_at IS NOT NULL);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.central_review_report_version() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER central_review_report_version BEFORE INSERT OR UPDATE ON public.reports
 FOR EACH ROW EXECUTE FUNCTION app_private.central_review_report_version();

CREATE FUNCTION public.central_review_prepare(_report_id uuid,_expected_version integer,_destination jsonb,_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reports%rowtype; a public.operator_approvals%rowtype; src jsonb; snapshot jsonb; fingerprint text; scope_display jsonb; period_key text;
BEGIN
 PERFORM app_private.central_review_admin();
 IF length(COALESCE(_idempotency_key,'')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'CENTRAL_INVALID_KEY'; END IF;
 IF jsonb_typeof(_destination) IS DISTINCT FROM 'object' OR
  (_destination->>'channel') IS NULL OR (_destination->>'channel') NOT IN ('portal','whatsapp') OR
  length(btrim(COALESCE(_destination->>'recipient',''))) NOT BETWEEN 1 AND 250 OR
  (_destination-ARRAY['channel','recipient']) <> '{}'::jsonb THEN RAISE EXCEPTION 'CENTRAL_INVALID_DESTINATION'; END IF;
 SELECT * INTO r FROM public.reports WHERE id=_report_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CENTRAL_REPORT_NOT_FOUND'; END IF;
 IF _destination->>'channel'='portal' AND _destination->>'recipient' IS DISTINCT FROM r.client_id::text THEN
  RAISE EXCEPTION 'CENTRAL_PORTAL_RECIPIENT_MISMATCH' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('central-key:'||_idempotency_key,0));
 SELECT * INTO a FROM public.operator_approvals WHERE origin='central' AND request_key=_idempotency_key;
 IF FOUND THEN
  IF a.report_id IS DISTINCT FROM _report_id OR a.payload_version IS DISTINCT FROM _expected_version
    OR a.payload->'destination' IS DISTINCT FROM _destination THEN
   RAISE EXCEPTION 'CENTRAL_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
  END IF;
  RETURN app_private.central_review_result(a);
 END IF;
 IF _expected_version IS NULL OR r.review_version<>_expected_version THEN RAISE EXCEPTION 'CENTRAL_REPORT_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF r.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'CENTRAL_REPORT_NOT_DRAFT'; END IF;
 IF length(btrim(COALESCE(r.summary,'')))=0 THEN RAISE EXCEPTION 'CENTRAL_SUMMARY_REQUIRED'; END IF;
 IF length(btrim(COALESCE(r.next_steps,'')))=0 THEN RAISE EXCEPTION 'CENTRAL_NEXT_STEPS_REQUIRED'; END IF;
 PERFORM 1 FROM public.projects WHERE id=r.project_id AND client_id=r.client_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'CENTRAL_PROJECT_UNAVAILABLE'; END IF;
 src:=public.central_review_source(r.client_id);
 IF src->>'dossier_id' IS NULL OR r.metrics->'central_review_source' IS DISTINCT FROM src THEN
  RAISE EXCEPTION 'CENTRAL_SOURCE_STALE' USING ERRCODE='40001';
 END IF;
 SELECT jsonb_build_object('plan_name',p.plan_name,'service_keys',COALESCE((
  SELECT jsonb_agg(s.key ORDER BY s.key) FROM jsonb_each(
   CASE WHEN jsonb_typeof(p.services_config)='object' THEN p.services_config ELSE '{}'::jsonb END
  ) s WHERE s.value='true'::jsonb),'[]'::jsonb)) INTO scope_display FROM public.profiles p WHERE p.id=r.client_id;
 snapshot:=jsonb_build_object(
  'report',jsonb_build_object('id',r.id,'client_id',r.client_id,'project_id',r.project_id,'title',r.title,
   'summary',r.summary,'next_steps',to_jsonb(r)->'next_steps','metrics',r.metrics,
   'period_start',r.period_start,'period_end',r.period_end,'review_version',r.review_version),
  'destination',_destination,'source',src,'scope',scope_display);
 fingerprint:=encode(extensions.digest(snapshot::text,'sha256'),'hex');
 period_key:=concat_ws(':',r.client_id,COALESCE(r.metrics->>'ritual_type',''),
  COALESCE(r.period_start::text,to_char(date_trunc('week',r.created_at AT TIME ZONE 'UTC'),'YYYY-MM-DD')),
  COALESCE(r.period_end::text,''));
 PERFORM pg_advisory_xact_lock(hashtextextended('central-period:'||period_key,0));
 WITH invalidated AS (
  UPDATE public.operator_approvals olda SET status='expirado',invalidated_at=now(),invalidation_reason='replaced_by_new_request'
  WHERE olda.origin='central' AND olda.client_id=r.client_id AND olda.executed_at IS NULL
   AND olda.status IN ('pendente','adiado','aprovado')
   AND olda.review_group_key=period_key
  RETURNING olda.id
 ) INSERT INTO public.central_review_events(approval_id,actor_id,event)
    SELECT id,auth.uid(),'replaced_by_new_request' FROM invalidated;
 UPDATE public.central_review_dispatches SET status='invalidado',updated_at=now()
  WHERE approval_id IN (SELECT id FROM public.operator_approvals WHERE origin='central' AND client_id=r.client_id AND invalidated_at IS NOT NULL);
 INSERT INTO public.operator_approvals(origin,operator_id,report_id,client_id,action_kind,o_que,por_que,destino,
   payload,payload_version,payload_hash,request_key,review_group_key,valid_until)
 VALUES('central',NULL,r.id,r.client_id,'enviar_mensagem',r.title,'Revisar o texto e o destino antes de qualquer envio',
  _destination->>'recipient',snapshot,r.review_version,fingerprint,_idempotency_key,period_key,now()+interval '7 days') RETURNING * INTO a;
 INSERT INTO public.central_review_events(approval_id,actor_id,event) VALUES(a.id,auth.uid(),'preparado');
 INSERT INTO public.central_review_dispatches(approval_id) VALUES(a.id);
 RETURN app_private.central_review_result(a);
END $$;
REVOKE ALL ON FUNCTION public.central_review_prepare(uuid,integer,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.central_review_prepare(uuid,integer,jsonb,text) TO authenticated;

CREATE FUNCTION public.central_review_decide(_approval_id uuid,_expected_client_id uuid,_expected_version integer,
 _expected_payload_hash text,_decision text,_comment text,_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.operator_approvals%rowtype; r public.reports%rowtype; rid uuid; h text; e public.central_review_events%rowtype; result jsonb;
BEGIN
 PERFORM app_private.central_review_admin();
 IF length(COALESCE(_idempotency_key,'')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'CENTRAL_INVALID_KEY'; END IF;
 IF _decision IS NULL OR _decision NOT IN ('aprovado','rejeitado','alteracoes_pedidas','comentario') THEN RAISE EXCEPTION 'CENTRAL_INVALID_DECISION'; END IF;
 IF _decision IN ('comentario','rejeitado','alteracoes_pedidas') AND length(btrim(COALESCE(_comment,'')))=0 THEN RAISE EXCEPTION 'CENTRAL_COMMENT_REQUIRED'; END IF;
 IF length(COALESCE(_comment,''))>4000 THEN RAISE EXCEPTION 'CENTRAL_COMMENT_TOO_LONG'; END IF;
 h:=encode(extensions.digest(jsonb_build_array(_approval_id,_expected_client_id,_expected_version,_expected_payload_hash,_decision,_comment)::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('central-decision:'||auth.uid()::text||':'||_idempotency_key,0));
 SELECT * INTO e FROM public.central_review_events WHERE actor_id=auth.uid() AND idempotency_key=_idempotency_key;
 IF FOUND THEN
  IF e.input_hash<>h THEN RAISE EXCEPTION 'CENTRAL_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN e.result;
 END IF;
 SELECT report_id INTO rid FROM public.operator_approvals WHERE id=_approval_id AND origin='central';
 IF rid IS NULL THEN RAISE EXCEPTION 'CENTRAL_APPROVAL_NOT_FOUND'; END IF;
 SELECT * INTO r FROM public.reports WHERE id=rid FOR UPDATE;
 SELECT * INTO a FROM public.operator_approvals WHERE id=_approval_id AND origin='central' FOR UPDATE;
 IF a.client_id IS DISTINCT FROM _expected_client_id OR r.client_id IS DISTINCT FROM a.client_id THEN RAISE EXCEPTION 'CENTRAL_CLIENT_MISMATCH' USING ERRCODE='42501'; END IF;
 IF _expected_version IS NULL OR a.payload_version<>_expected_version OR
  a.payload_hash IS DISTINCT FROM _expected_payload_hash OR
  a.payload_hash<>encode(extensions.digest(a.payload::text,'sha256'),'hex') THEN RAISE EXCEPTION 'CENTRAL_REPORT_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 -- A comment belongs to the exact immutable historical snapshot and does not
 -- reopen its decision. Only actions require the current report/source.
 IF _decision<>'comentario' THEN
  IF r.review_version<>_expected_version THEN RAISE EXCEPTION 'CENTRAL_REPORT_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF a.invalidated_at IS NOT NULL OR a.status NOT IN ('pendente','adiado') OR a.executed_at IS NOT NULL THEN RAISE EXCEPTION 'CENTRAL_ALREADY_DECIDED' USING ERRCODE='40001'; END IF;
  IF a.valid_until IS NULL OR a.valid_until<=now() THEN RAISE EXCEPTION 'CENTRAL_APPROVAL_EXPIRED'; END IF;
  IF a.payload->'source' IS DISTINCT FROM public.central_review_source(a.client_id) THEN RAISE EXCEPTION 'CENTRAL_SOURCE_STALE' USING ERRCODE='40001'; END IF;
  IF r.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'CENTRAL_REPORT_NOT_DRAFT'; END IF;
  IF _decision='aprovado' AND length(btrim(COALESCE(r.summary,'')))=0 THEN RAISE EXCEPTION 'CENTRAL_SUMMARY_REQUIRED'; END IF;
  IF _decision='aprovado' AND length(btrim(COALESCE(r.next_steps,'')))=0 THEN RAISE EXCEPTION 'CENTRAL_NEXT_STEPS_REQUIRED'; END IF;
  UPDATE public.operator_approvals SET status=_decision,decided_by=auth.uid(),decided_at=now(),decision_note=NULLIF(btrim(_comment),'')
   WHERE id=a.id RETURNING * INTO a;
  UPDATE public.central_review_dispatches SET status=CASE WHEN _decision='aprovado' THEN 'aprovado' ELSE 'invalidado' END,updated_at=now() WHERE approval_id=a.id;
 END IF;
 result:=app_private.central_review_result(a)||jsonb_build_object('decision',_decision);
 INSERT INTO public.central_review_events(approval_id,actor_id,event,comment,idempotency_key,input_hash,result)
 VALUES(a.id,auth.uid(),_decision,NULLIF(btrim(_comment),''),_idempotency_key,h,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.central_review_decide(uuid,uuid,integer,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.central_review_decide(uuid,uuid,integer,text,text,text,text) TO authenticated;

-- Preserve the existing operator API/body and add serialization + central denial.
DO $patch$
DECLARE def text; src text; updated text;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO src,def FROM pg_proc
 WHERE oid='public.operator_approval_decidir(uuid,text,text)'::regprocedure;
 IF position('select * into _aprov from public.operator_approvals where id = _approval_id;' IN src)=0 THEN
  RAISE EXCEPTION 'CENTRAL_LEGACY_DECISION_ANCHOR_CHANGED';
 END IF;
 updated:=replace(src,'select * into _aprov from public.operator_approvals where id = _approval_id;',
  'select * into _aprov from public.operator_approvals where id = _approval_id for update;
  if _aprov.origin = ''central'' then raise exception ''CENTRAL_USE_REVIEW_DECIDE''; end if;
  if _aprov.valid_until is not null and _aprov.valid_until <= now() then raise exception ''CENTRAL_APPROVAL_EXPIRED''; end if;');
 EXECUTE replace(def,src,updated);
END $patch$;
COMMIT;
