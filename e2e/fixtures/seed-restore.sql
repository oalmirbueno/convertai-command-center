-- Restore hook metadata even if the subsequent no-HTTP assertion fails.
DO $ci$
DECLARE item record; mode text;
BEGIN
  IF session_user <> 'postgres' OR current_database() <> 'postgres'
     OR to_regclass('aceleriq_ci_replay.operator_parent_attestation') IS NULL THEN
    RAISE EXCEPTION 'E2E_RESTORE_REQUIRES_EPHEMERAL_CI_STACK';
  END IF;
  IF to_regclass('aceleriq_ci_replay.e2e_seed_guard') IS NULL THEN RETURN; END IF;
  FOR item IN SELECT h.* FROM aceleriq_ci_replay.e2e_seed_guard g,
    jsonb_to_recordset(g.hook_state) AS h(table_oid oid,trigger_oid oid,function_oid oid,name text,enabled text) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.oid=item.trigger_oid
      AND t.tgrelid=item.table_oid AND t.tgfoid=item.function_oid AND t.tgname=item.name) THEN
      RAISE EXCEPTION 'E2E_HOOK_IDENTITY_CHANGED';
    END IF;
    mode:=CASE item.enabled WHEN 'O' THEN 'ENABLE' WHEN 'A' THEN 'ENABLE ALWAYS'
      WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'D' THEN 'DISABLE' END;
    IF mode IS NULL THEN RAISE EXCEPTION 'E2E_UNKNOWN_ORIGINAL_HOOK_MODE'; END IF;
    EXECUTE format('ALTER TABLE %s %s TRIGGER %I',item.table_oid::regclass,mode,item.name);
  END LOOP;
  UPDATE aceleriq_ci_replay.e2e_seed_guard SET restored=true;
END
$ci$;
