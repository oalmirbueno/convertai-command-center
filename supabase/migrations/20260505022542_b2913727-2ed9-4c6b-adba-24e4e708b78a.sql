create or replace function public.notify_ops_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := 'https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-portal-sync';
  v_secret text := 'aceleriq-ops-portal-bridge-2025-x7k9m2n4p8q';
  v_event text;
  v_data jsonb;
  v_old jsonb;
  v_type text := TG_TABLE_NAME;
  v_ctx jsonb := '{}'::jsonb;
  v_proj record;
begin
  if TG_OP = 'INSERT' then
    v_event := v_type || '_created';
    v_data := to_jsonb(NEW);
    v_old := null;
  elsif TG_OP = 'UPDATE' then
    v_event := v_type || '_updated';
    v_data := to_jsonb(NEW);
    v_old := to_jsonb(OLD);
  else
    v_event := v_type || '_deleted';
    v_data := to_jsonb(OLD);
    v_old := to_jsonb(OLD);
  end if;

  if v_type in ('tasks','milestones') then
    begin
      select p.name as project_title, p.client_id as client_id
        into v_proj
        from public.projects p
       where p.id = nullif(v_data->>'project_id','')::uuid;
      if found then
        v_ctx := jsonb_build_object(
          'project_title', v_proj.project_title,
          'client_id', v_proj.client_id
        );
      end if;
    exception when others then
      v_ctx := '{}'::jsonb;
    end;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'event', v_event,
      'type', v_type,
      'table', v_type,
      'op', TG_OP,
      'data', v_data,
      'record', v_data,
      'old_record', v_old,
      'context', coalesce(v_ctx,'{}'::jsonb),
      'source', 'portal'
    )
  );

  return coalesce(NEW, OLD);
end;
$$;