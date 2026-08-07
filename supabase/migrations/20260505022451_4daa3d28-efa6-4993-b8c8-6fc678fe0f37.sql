create extension if not exists pg_net;

create or replace function public.notify_ops_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
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

  -- Legacy bridge configuration is deployment-specific and must never be
  -- embedded in a migration. A fresh environment keeps this retired bridge
  -- disabled until both Vault entries are explicitly provisioned.
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'ops_receive_portal_sync_url'
     limit 1;
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'ops_webhook_secret'
     limit 1;
  exception when others then
    return coalesce(NEW, OLD);
  end;

  if v_url is null or v_secret is null then
    return coalesce(NEW, OLD);
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

do $$
declare
  t text;
begin
  foreach t in array array['profiles','clients','projects','milestones','tasks']
  loop
    if exists (
      select 1 from information_schema.tables
       where table_schema='public' and table_name=t
    ) then
      execute format('drop trigger if exists trg_ops_sync on public.%I', t);
      execute format(
        'create trigger trg_ops_sync
           after insert or update or delete on public.%I
           for each row execute function public.notify_ops_sync()', t);
    end if;
  end loop;
end$$;
