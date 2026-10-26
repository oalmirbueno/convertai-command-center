-- Aprovou, agenda sozinho (27/10/2026). Só amplia e é idempotente.
--
-- Diagnóstico de 26/10: 11 peças aprovadas sem data; "publicar ao aprovar" usado em 2 de 132 trabalhos.
-- Dono: o cliente aprovou uma peça sem data? O painel escolhe o próximo espaço do calendário e agenda pelo
-- caminho de sempre (publicação só com aprovação + data, como já é a regra).
--
-- A chave por cliente é a que já existe e estava sem efeito: mesa_cliente_config.agendar_ao_aprovar (padrão
-- ligado; sem linha de configuração = ligado). O dono desliga na Mesa, Entrega, "Agendar sozinho na Agenda
-- quando o cliente aprovar".
--
-- 1) public.agenda_sozinha_fatos(): só leitura. Uma linha por peça aprovada sem data (estudio_trabalhos com
--    aprovado_em, sem agendado_para), com a configuração do cliente (ligado, horário do tipo, fuso, fim de
--    semana, posts por mês) e os dias já ocupados no calendário. A escolha do dia é código, sem IA, em
--    supabase/functions/agente-calendario/modulos/agenda-sozinha.ts (meta da semana igual à da vigia, um
--    post por dia, 9h às 20h).
-- 2) public.agenda_sozinha_aplicar(trabalho, quando): confere TUDO de novo no banco (aprovação, publicação
--    planejada sem data, conta, dia livre, horário entre 9h e 20h, fim de semana) e agenda pelos mesmos
--    passos do agendador da Mesa e da vigia: lâminas congeladas (capture_editorial_asset_snapshots), selo de
--    aprovação e a transição oficial 'schedule'. Um aviso para a equipe.
-- 3) Cron 'agenda-sozinha' (agente-calendario, acao agenda_sozinha_interno), a cada 15 min das 08h às 20h
--    BRT. A mesma ação com simular=true devolve a lista sem gravar (para as peças que já estavam paradas).

-- ------------------------------------------------------------------ fatos (só leitura)

create or replace function public.agenda_sozinha_fatos()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
-- [fatos]
with pecas as (
  select t.id, t.client_id, t.task_id, t.post_id, t.file_ids, t.direcao, t.aprovado_em, t.entrega_status, t.entrega_aviso,
         t.publicar_em_desfeito_em, t.publicacao_dispensada_em,
         coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), ''), 'Cliente') as cliente,
         (p.deleted_at is null and p.plan_status = 'active') as cliente_ativo,
         c.agendar_ao_aprovar, c.hora_publicacao, c.horario_automatico, c.fuso, c.postar_fim_de_semana, c.posts_por_mes,
         tk.title as tarefa_titulo, (tk.id is not null and tk.deleted_at is null) as tarefa_ok
    from public.estudio_trabalhos t
    join public.profiles p on p.id = t.client_id
    left join public.mesa_cliente_config c on c.client_id = t.client_id
    left join public.tasks tk on tk.id = t.task_id
   where t.aprovado_em is not null
     and t.agendado_para is null
     and t.status = 'entregue'
     and coalesce(t.tipo, '') <> 'ads'
     and t.entrega_status in ('aprovado', 'precisa_de_atencao')
     and not exists (select 1 from public.editorial_publications e where e.post_id = t.post_id and e.status = 'published')
),
com_pub as (
  select pc.*,
         po.id as post_ok,
         pub.id as publicacao_id, pub.status as publicacao_status, pub.scheduled_at as publicacao_quando,
         pub.external_account_id,
         coalesce(public.editorial_file_is_publishable(coalesce(pub.file_id, po.primary_file_id), pub.client_id, pub.project_id), false) as liberada,
         case when cardinality(pc.file_ids) > 1 then 'carousel' when pc.direcao ->> 'formato' = 'stories_9x16' then 'story' else 'static' end as tipo
    from pecas pc
    left join public.editorial_posts po on po.id = pc.post_id and po.archived_at is null
    left join lateral (
      select e.* from public.editorial_publications e
       where e.post_id = po.id and e.platform = 'instagram' and e.status in ('planned', 'scheduled', 'failed')
       order by (e.status = 'planned') desc, e.created_at limit 1
    ) pub on true
)
select coalesce(jsonb_agg(jsonb_build_object(
  'trabalho_id', x.id,
  'client_id', x.client_id,
  'cliente', x.cliente,
  'titulo', left(coalesce(nullif(btrim(x.tarefa_titulo), ''), 'Peça aprovada'), 160),
  'aprovado_em', x.aprovado_em,
  'entrega_status', x.entrega_status,
  'entrega_aviso', left(x.entrega_aviso, 200),
  'ligado', coalesce(x.agendar_ao_aprovar, true),
  'desfeito', x.publicar_em_desfeito_em is not null,
  'dispensada', x.publicacao_dispensada_em is not null,
  'cliente_ativo', x.cliente_ativo,
  'tarefa_ok', x.tarefa_ok,
  'post_id', x.post_ok,
  'publicacao_id', x.publicacao_id,
  'publicacao_status', x.publicacao_status,
  'publicacao_tem_data', x.publicacao_quando is not null,
  'conta', x.external_account_id is not null,
  'liberada', x.liberada,
  'tipo', x.tipo,
  'hora', to_char(coalesce(
            case when coalesce(x.horario_automatico, true) then public.mesa_melhor_hora(x.client_id, x.tipo) end,
            x.hora_publicacao, '09:00'::time), 'HH24:MI'),
  'fuso', coalesce(x.fuso, 'America/Sao_Paulo'),
  'fim_de_semana', coalesce(x.postar_fim_de_semana, false),
  'posts_por_mes', x.posts_por_mes,
  'ocupados', coalesce((
    select jsonb_agg(jsonb_build_object('dia', o.dia, 'n', o.n) order by o.dia) from (
      select (coalesce(e.published_at, e.scheduled_at) at time zone coalesce(x.fuso, 'America/Sao_Paulo'))::date as dia,
             count(distinct e.post_id) as n
        from public.editorial_publications e
        join public.editorial_posts po2 on po2.id = e.post_id
       where e.client_id = x.client_id
         and po2.archived_at is null
         and e.post_id is distinct from x.post_ok
         and e.status in ('planned', 'scheduled', 'published', 'publishing')
         and coalesce(e.published_at, e.scheduled_at) is not null
         and coalesce(e.published_at, e.scheduled_at) >= now() - interval '8 days'
         and coalesce(e.published_at, e.scheduled_at) < now() + interval '43 days'
       group by 1
    ) o), '[]'::jsonb)
) order by x.aprovado_em), '[]'::jsonb) as pecas
from com_pub x;
-- [/fatos]
$$;
revoke all on function public.agenda_sozinha_fatos() from public, anon, authenticated;
grant execute on function public.agenda_sozinha_fatos() to service_role;

-- ------------------------------------------------------------------ aplicar (uma peça)

create or replace function public.agenda_sozinha_aplicar(_trabalho_id uuid, _quando timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  _t record;
  _pub record;
  _cfg record;
  _tem_cfg boolean;
  _fuso text;
  _local timestamp;
  _admin uuid;
  _modo text;
  _versao integer;
  _automatica boolean;
begin
  if _trabalho_id is null or _quando is null then
    return jsonb_build_object('ok', false, 'motivo', 'pedido_incompleto');
  end if;

  select t.* into _t from public.estudio_trabalhos t where t.id = _trabalho_id for update skip locked;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'trabalho_ocupado_ou_inexistente'); end if;
  if _t.aprovado_em is null or _t.agendado_para is not null or _t.status <> 'entregue' or coalesce(_t.tipo, '') = 'ads'
     or _t.publicacao_dispensada_em is not null or _t.publicar_em_desfeito_em is not null
     or coalesce(cardinality(_t.file_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'peca_nao_elegivel');
  end if;

  select c.agendar_ao_aprovar, c.fuso, c.postar_fim_de_semana into _cfg
    from public.mesa_cliente_config c where c.client_id = _t.client_id;
  _tem_cfg := found;
  if _tem_cfg and _cfg.agendar_ao_aprovar is false then
    return jsonb_build_object('ok', false, 'motivo', 'desligado_para_o_cliente');
  end if;
  _fuso := case when _tem_cfg then coalesce(_cfg.fuso, 'America/Sao_Paulo') else 'America/Sao_Paulo' end;
  _local := _quando at time zone _fuso;

  -- Horário: futuro (10 min de folga), entre 9h e 20h, fim de semana só para quem posta no fim de semana.
  if _quando < now() + interval '10 minutes' then
    return jsonb_build_object('ok', false, 'motivo', 'horario_no_passado');
  end if;
  if _local::time < '09:00'::time or _local::time > '20:00'::time then
    return jsonb_build_object('ok', false, 'motivo', 'fora_das_9h_as_20h');
  end if;
  if extract(isodow from _local) in (6, 7) and not (_tem_cfg and coalesce(_cfg.postar_fim_de_semana, false)) then
    return jsonb_build_object('ok', false, 'motivo', 'cliente_nao_posta_no_fim_de_semana');
  end if;

  -- Mesma ordem de trava do promotor: global antes da publicação.
  perform public.editorial_lock_task_sync();

  select p.id, p.post_id, p.client_id, p.project_id, p.external_account_id,
         coalesce(p.scheduled_timezone, _fuso) as tz, coalesce(p.file_id, po.primary_file_id) as raiz
    into _pub
    from public.editorial_publications p
    join public.editorial_posts po on po.id = p.post_id
   where p.post_id = _t.post_id
     and p.platform = 'instagram'
     and p.status = 'planned'
     and p.scheduled_at is null
     and p.external_account_id is not null
     and po.archived_at is null
   order by p.created_at
   limit 1
   for update of p skip locked;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sem_publicacao_planejada_sem_data'); end if;

  -- A APROVAÇÃO: arte liberada. Sem ela, nunca.
  if not coalesce(public.editorial_file_is_publishable(_pub.raiz, _pub.client_id, _pub.project_id), false) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_aprovacao');
  end if;

  -- Nunca dois posts no mesmo dia do cliente.
  if exists (
    select 1 from public.editorial_publications e
      join public.editorial_posts po on po.id = e.post_id
     where e.client_id = _t.client_id
       and e.post_id <> _pub.post_id
       and po.archived_at is null
       and e.status in ('planned', 'scheduled', 'published', 'publishing')
       and (coalesce(e.published_at, e.scheduled_at) at time zone _fuso)::date = _local::date
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'dia_ocupado');
  end if;

  select user_id into _admin from public.user_roles where role = 'admin'::public.app_role order by user_id limit 1;
  if _admin is null then return jsonb_build_object('ok', false, 'motivo', 'sem_admin'); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', _admin::text, 'role', 'authenticated')::text, true);

  begin
    -- Modo de entrega pela mesma regra do agendador da Mesa.
    _automatica := exists (
      select 1 from public.external_account_connections c
       where c.external_account_id = _pub.external_account_id and c.client_id = _t.client_id and c.provider = 'meta'
         and c.connection_status = 'connected' and coalesce(c.automation_enabled, false)
         and (c.expires_at is null or c.expires_at > now()));
    _modo := case
      when _automatica and cardinality(_t.file_ids) between 1 and 10
        and not exists (
          select 1 from public.files fr
           where (fr.id = _t.file_ids[1] or fr.parent_file_id = _t.file_ids[1])
             and (fr.sha256 is null or lower(fr.sha256) !~ '^[0-9a-f]{64}$'))
        then 'automatic'
      else 'manual'
    end;

    -- Lâminas na ordem do Estúdio e o pedido de entrega (com a data nova), como o agendador da Mesa.
    perform social_private.capture_editorial_asset_snapshots(
      _pub.post_id,
      jsonb_build_object('publications', jsonb_build_array(jsonb_build_object(
        'id', _pub.id,
        'external_account_id', _pub.external_account_id,
        'asset_file_ids', to_jsonb(_t.file_ids),
        'delivery_mode', _modo,
        'scheduled_at', _quando,
        'scheduled_timezone', _pub.tz
      ))),
      false
    );
    update public.editorial_post_internal
       set approval_fingerprint = public.editorial_compute_approval_fingerprint(_pub.post_id),
           updated_by = coalesce(auth.uid(), updated_by)
     where post_id = _pub.post_id and approval_fingerprint is not null;

    if public.mesa_publicacao_segurada(_pub.post_id, _quando, _pub.raiz) then
      raise exception 'publicação segurada pela Mesa';
    end if;

    select p.version into _versao from public.editorial_publications p where p.id = _pub.id;
    perform public.transition_editorial_publication_unlocked(_pub.id, 'schedule', _versao, _quando, _pub.tz);
  exception when others then
    raise warning 'agenda_sozinha_aplicar: peça % não agendada: %', _trabalho_id, sqlerrm;
    return jsonb_build_object('ok', false, 'motivo', 'falhou', 'erro', left(sqlerrm, 300));
  end;

  update public.estudio_trabalhos
     set publicar_em = _quando,
         agendado_para = _quando,
         entrega_status = 'agendado',
         entrega_aviso = null,
         agenda_historico = (
           select coalesce(jsonb_agg(h order by i), '[]'::jsonb)
             from jsonb_array_elements(agenda_historico) with ordinality as x(h, i)
            where i > jsonb_array_length(agenda_historico) - 49
         ) || jsonb_build_array(jsonb_build_object('em', now(), 'por', null, 'acao', 'agendou_sozinho', 'quando', _quando))
   where id = _t.id;

  perform public.avisar_equipe(
    public.mesa_com_cliente(_t.client_id, 'Mesa: uma peça aprovada sem data entrou sozinha na Agenda para '
      || to_char(_local, 'DD/MM "às" HH24:MI') || ' (próximo dia livre do plano).'),
    'publication',
    '/calendario?client=' || _t.client_id::text || '&content=' || _pub.post_id::text
  );

  return jsonb_build_object('ok', true, 'trabalho_id', _t.id, 'publicacao_id', _pub.id, 'post_id', _pub.post_id, 'quando', _quando, 'modo', _modo);
end;
$$;
revoke all on function public.agenda_sozinha_aplicar(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.agenda_sozinha_aplicar(uuid, timestamptz) to service_role;

-- ------------------------------------------------------------------ cron

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'agenda-sozinha';
    perform cron.schedule('agenda-sozinha', '1,16,31,46 11-23 * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/agente-calendario',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'agenda_sozinha_interno'),
        timeout_milliseconds := 120000
      );
    $cron$);
  end if;
end $$;

-- Conferência (todas true):
-- select exists (select 1 from pg_proc where proname = 'agenda_sozinha_fatos'),
--   exists (select 1 from pg_proc where proname = 'agenda_sozinha_aplicar'),
--   exists (select 1 from cron.job where jobname = 'agenda-sozinha');
-- Simulação (não grava): POST agente-calendario {"acao":"agenda_sozinha_interno","simular":true} com
-- x-cron-secret (incluir_antigas=true para as peças aprovadas há mais de 30 dias).
