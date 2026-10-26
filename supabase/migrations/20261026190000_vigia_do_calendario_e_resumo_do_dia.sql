-- Vigia do calendário, publicação atrasada e resumo do dia (26/10/2026). Só amplia e é idempotente.
--
-- Pedido do dono: "não pode o cliente ficar sem postar mais de 3 dias"; ver quem está sem conteúdo na agenda,
-- quem tem agendado que não saiu, preparar a pauta (tema em alta, formato, legenda) e avisar; o dono gera nas
-- Mesas. Enxuto: 1 resumo por dia na tela /hoje + 1 aviso no sino às 8h.
--
-- O cálculo é código, sem IA:
-- 1) public.vigia_calendario_fatos(): os fatos de cada cliente ativo com social (último post, agenda dos
--    próximos 21 dias, agendados que passaram da hora, mês, hype da semana, posts que foram mal). Só leitura.
--    A classificação ("sem post agendado", "vai ficar 3 dias sem post em X", "atrasado: agendado não
--    publicado", "calendário abaixo do plano") fica em agente-calendario/modulos/vigia-do-calendario.ts.
-- 2) public.vigia_calendario_estado: UM estado por cliente (chave client_id), atualizado a cada medição.
-- 3) public.vigia_publicar_atrasado(pub, motivo): post planejado, APROVADO (arte liberada), com conta e fora
--    da janela de 6 h do promotor recebe UMA tentativa de ir ao ar pelo caminho oficial (a transição
--    'schedule'; o editorial-autopublish publica no minuto seguinte). Nunca sem aprovação, nunca segurado
--    pela Mesa, nunca duas vezes (public.vigia_publicacoes_tentadas).
-- 4) public.resumo_do_dia(): a tela /hoje (Anúncios, Calendário, Precisa de você, Feito ontem), no máximo 10
--    linhas por seção. public.resumo_do_dia_avisar(): um aviso por dia no sino (tipo resumo_do_dia, /hoje).
-- 5) Crons: 'vigia-calendario' (agente-calendario, acao vigia_do_calendario_interno, 06h07 a 18h37 BRT,
--    a cada 30 min; mede todos e prepara no máximo um cliente por vez) e 'resumo-do-dia-aviso' (08h BRT).

-- ------------------------------------------------------------------ estado por cliente

create table if not exists public.vigia_calendario_estado (
  client_id uuid primary key references public.profiles(id) on delete cascade,
  estado text not null default 'em_dia'
    check (estado in ('em_dia', 'sem_post_agendado', 'vai_ficar_sem_post', 'atrasado', 'abaixo_do_plano')),
  situacao text not null default 'em dia',
  motivos jsonb not null default '[]'::jsonb check (jsonb_typeof(motivos) = 'array'),
  meta_semana integer not null default 3,
  meta_fonte text not null default 'padrao',
  prox7 integer not null default 0,
  prox14 integer not null default 0,
  dias_sem_post integer,
  ultimo_post_em date,
  buraco_em date,
  atrasados jsonb not null default '[]'::jsonb check (jsonb_typeof(atrasados) = 'array'),
  pct_mes numeric,
  faltam integer not null default 0,
  preparar_ate date,
  sugestao text,
  pautas jsonb not null default '[]'::jsonb check (jsonb_typeof(pautas) = 'array'),
  preparo text not null default 'nao_precisa'
    check (preparo in ('nao_precisa', 'pendente', 'feito', 'parcial', 'sem_saldo', 'falhou')),
  preparado_em timestamptz,
  custo_usd numeric not null default 0,
  task_id uuid,
  em_risco_desde timestamptz,
  medido_em timestamptz not null default now(),
  mudou_em timestamptz not null default now()
);
create index if not exists vigia_calendario_estado_risco on public.vigia_calendario_estado (estado) where estado <> 'em_dia';

alter table public.vigia_calendario_estado enable row level security;
drop policy if exists vigia_calendario_estado_equipe_le on public.vigia_calendario_estado;
create policy vigia_calendario_estado_equipe_le on public.vigia_calendario_estado
  for select to authenticated using (public.is_staff(auth.uid()));
revoke all on public.vigia_calendario_estado from anon;
grant select on public.vigia_calendario_estado to authenticated;
grant select, insert, update, delete on public.vigia_calendario_estado to service_role;

-- Cada publicação atrasada recebe no máximo UMA tentativa da vigia.
create table if not exists public.vigia_publicacoes_tentadas (
  publication_id uuid primary key references public.editorial_publications(id) on delete cascade,
  client_id uuid not null,
  motivo text not null check (length(motivo) between 1 and 500),
  resultado text not null default 'tentando' check (resultado in ('tentando', 'agendado', 'falhou')),
  erro text,
  agendado_para timestamptz,
  tentado_em timestamptz not null default now()
);
alter table public.vigia_publicacoes_tentadas enable row level security;
drop policy if exists vigia_publicacoes_tentadas_equipe_le on public.vigia_publicacoes_tentadas;
create policy vigia_publicacoes_tentadas_equipe_le on public.vigia_publicacoes_tentadas
  for select to authenticated using (public.is_staff(auth.uid()));
revoke all on public.vigia_publicacoes_tentadas from anon;
grant select on public.vigia_publicacoes_tentadas to authenticated;
grant select, insert, update on public.vigia_publicacoes_tentadas to service_role;

-- ------------------------------------------------------------------ fatos (só leitura)

create or replace function public.vigia_calendario_fatos(_agora timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
-- [fatos]
with hoje as (
  select (_agora at time zone 'America/Sao_Paulo')::date as d
),
clientes as (
  select p.id,
         coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), ''), 'Cliente') as nome,
         p.plan_name,
         c.posts_por_mes,
         coalesce(c.postar_fim_de_semana, false) as fim_de_semana
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id and ur.role = 'client'
    left join public.mesa_cliente_config c on c.client_id = p.id
   where p.deleted_at is null
     and p.plan_status = 'active'
     and p.client_type::text in ('recurring', 'hybrid')
     and coalesce(p.services_config ->> 'social', 'false') = 'true'
)
select coalesce(jsonb_agg(jsonb_build_object(
  'client_id', c.id,
  'nome', c.nome,
  'plano', c.plan_name,
  'posts_por_mes', c.posts_por_mes,
  'fim_de_semana', c.fim_de_semana,
  'hoje', h.d,
  'ultimo_post', (
    select (greatest(
      (select max(e.published_at) from public.editorial_publications e
        where e.client_id = c.id and e.status = 'published'),
      (select max(m.posted_at) from public.social_post_metrics m where m.client_id = c.id)
    ) at time zone 'America/Sao_Paulo')::date),
  'futuros', coalesce((
    select jsonb_agg(jsonb_build_object('dia', f.dia, 'n', f.n, 'aprovados', f.aprovados) order by f.dia)
      from (
        select (e.scheduled_at at time zone 'America/Sao_Paulo')::date as dia,
               count(distinct e.post_id) as n,
               count(distinct e.post_id) filter (where e.status = 'scheduled') as aprovados
          from public.editorial_publications e
          join public.editorial_posts po on po.id = e.post_id
         where e.client_id = c.id
           and e.status in ('scheduled', 'planned')
           and e.scheduled_at >= _agora
           and e.scheduled_at < _agora + interval '22 days'
           and po.archived_at is null
         group by 1
      ) f), '[]'::jsonb),
  'atrasados', coalesce((
    select jsonb_agg(a order by a ->> 'quando') from (
      select jsonb_build_object(
               'id', e.id,
               'post_id', e.post_id,
               'titulo', left(coalesce(nullif(btrim(po.title), ''), 'Post sem título'), 120),
               'quando', e.scheduled_at,
               'status', e.status,
               'tipo', po.content_type,
               'plataforma', e.platform,
               'conta', e.external_account_id is not null,
               'liberada', coalesce(public.editorial_file_is_publishable(
                   coalesce(e.file_id, po.primary_file_id), e.client_id, e.project_id), false),
               'segurada', coalesce(public.mesa_publicacao_segurada(
                   e.post_id, e.scheduled_at, coalesce(e.file_id, po.primary_file_id)), false),
               'job', (select j.stage from social_private.autopublish_jobs j where j.publication_id = e.id),
               'job_erro', (select left(j.last_error, 200) from social_private.autopublish_jobs j where j.publication_id = e.id),
               'tentativa', (select t.resultado from public.vigia_publicacoes_tentadas t where t.publication_id = e.id)
             ) as a
        from public.editorial_publications e
        join public.editorial_posts po on po.id = e.post_id
       where e.client_id = c.id
         and e.status in ('scheduled', 'planned')
         and e.scheduled_at < _agora - interval '90 minutes'
         and e.scheduled_at >= _agora - interval '14 days'
         and po.archived_at is null
       order by e.scheduled_at
       limit 20
    ) x), '[]'::jsonb),
  'publicados_mes', greatest(
    (select count(distinct e.post_id) from public.editorial_publications e
      where e.client_id = c.id and e.status = 'published'
        and (e.published_at at time zone 'America/Sao_Paulo')::date >= date_trunc('month', h.d)::date),
    (select count(*) from public.social_post_metrics m
      where m.client_id = c.id
        and (m.posted_at at time zone 'America/Sao_Paulo')::date >= date_trunc('month', h.d)::date)),
  'agendados_mes', (
    select count(distinct e.post_id) from public.editorial_publications e
      join public.editorial_posts po on po.id = e.post_id
     where e.client_id = c.id and e.status in ('scheduled', 'planned') and e.scheduled_at >= _agora
       and po.archived_at is null
       and (e.scheduled_at at time zone 'America/Sao_Paulo')::date < (date_trunc('month', h.d) + interval '1 month')::date),
  'temas_na_agenda', coalesce((
    select jsonb_agg(distinct left(po.title, 120))
      from public.editorial_publications e
      join public.editorial_posts po on po.id = e.post_id
     where e.client_id = c.id and e.status in ('scheduled', 'planned', 'published')
       and e.scheduled_at >= _agora - interval '30 days' and e.scheduled_at < _agora + interval '30 days'
       and nullif(btrim(po.title), '') is not null), '[]'::jsonb),
  'hype_desta_semana', exists (
    select 1 from public.mesa_hypes mh where mh.client_id = c.id and mh.semana = date_trunc('week', h.d)::date),
  'hypes', coalesce((
    select jsonb_agg(i order by (i ->> 'nota')::numeric desc nulls last) from (
      select jsonb_build_object(
               'semana', mh.semana,
               'tipo', coalesce(it ->> 'tipo', 'hype'),
               'titulo', left(it ->> 'titulo', 160),
               'janela', it ->> 'janela',
               'formato', it ->> 'formato',
               'nota', case when jsonb_typeof(it -> 'nota') = 'number' then (it ->> 'nota')::numeric end,
               'por_que_agora', left(it ->> 'por_que_agora', 300),
               'pauta', case when jsonb_typeof(it -> 'pauta') = 'object' then it -> 'pauta' end
             ) as i
        from public.mesa_hypes mh
        cross join lateral jsonb_array_elements(case when jsonb_typeof(mh.itens) = 'array' then mh.itens else '[]'::jsonb end) it
       where mh.client_id = c.id
         and mh.semana >= date_trunc('week', h.d)::date - 21
         and jsonb_typeof(it) = 'object'
       order by mh.semana desc
       limit 40
    ) y), '[]'::jsonb),
  'ruins', coalesce((
    select jsonb_agg(r) from (
      select jsonb_build_object(
               'titulo', left(coalesce(nullif(btrim(po.title), ''), regexp_replace(coalesce(m.caption, ''), '\s+', ' ', 'g')), 100),
               'alcance', m.reach,
               'mediana', s.mediana,
               'dia', (m.posted_at at time zone 'America/Sao_Paulo')::date
             ) as r
        from public.social_post_metrics m
        cross join (
          select percentile_cont(0.5) within group (order by m2.reach) as mediana, count(*) as n
            from public.social_post_metrics m2
           where m2.client_id = c.id and m2.posted_at >= _agora - interval '60 days' and m2.reach is not null
        ) s
        left join lateral (
          select ep.post_id from public.editorial_publications ep
           where ep.client_id = m.client_id and ep.permalink = m.permalink limit 1
        ) ep on true
        left join public.editorial_posts po on po.id = ep.post_id
       where m.client_id = c.id
         and m.posted_at >= _agora - interval '60 days'
         and m.reach is not null
         and s.n >= 6
         and m.reach < 0.5 * s.mediana
       order by m.reach asc
       limit 3
    ) z), '[]'::jsonb),
  'projeto_id', (
    select pj.id from public.projects pj
     where pj.client_id = c.id and pj.deleted_at is null
     order by (pj.project_type in ('social_media', 'marketing', 'marketing_digital')) desc,
              (pj.status = 'active') desc,
              (select count(*) from public.tasks tk where tk.project_id = pj.id and tk.deleted_at is null) desc,
              pj.created_at
     limit 1),
  'tarefa', (
    select jsonb_build_object('id', tk.id, 'project_id', tk.project_id, 'titulo', tk.title, 'status', tk.status,
                              'descricao', tk.description, 'due_date', tk.due_date)
      from public.tasks tk join public.projects pj on pj.id = tk.project_id
     where pj.client_id = c.id and tk.origem_externa = 'vigia:calendario' and tk.deleted_at is null
     order by tk.created_at limit 1),
  'saldo_usd', (select w.saldo_usd from public.ia_carteiras w where w.client_id = c.id),
  'autor', (
    select cp.criado_por from public.calendario_propostas cp
     where cp.client_id = c.id and cp.criado_por is not null
     order by cp.criado_em desc limit 1),
  'estado_anterior', (
    select jsonb_build_object('estado', v.estado, 'preparo', v.preparo, 'preparado_em', v.preparado_em,
                              'faltam', v.faltam, 'em_risco_desde', v.em_risco_desde, 'pautas', v.pautas,
                              'custo_usd', v.custo_usd)
      from public.vigia_calendario_estado v where v.client_id = c.id)
) order by c.nome), '[]'::jsonb)
from clientes c cross join hoje h;
-- [/fatos]
$$;
revoke all on function public.vigia_calendario_fatos(timestamptz) from public, anon, authenticated;
grant execute on function public.vigia_calendario_fatos(timestamptz) to service_role;

-- ------------------------------------------------------------------ dono das tarefas da vigia

-- O admin que mais mexe no Mês (o dono), nunca o robô do n8n.
create or replace function public.vigia_dono()
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select ur.user_id
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
   where ur.role = 'admin' and p.deleted_at is null and coalesce(p.email, '') not ilike 'n8n@%'
   order by (select count(*) from public.calendario_propostas cp
              where cp.criado_por = ur.user_id and cp.criado_em > now() - interval '60 days') desc,
            ur.user_id
   limit 1;
$$;
revoke all on function public.vigia_dono() from public, anon, authenticated;
grant execute on function public.vigia_dono() to service_role;

-- ------------------------------------------------------------------ publicar o atrasado (uma vez)

create or replace function public.vigia_publicar_atrasado(_publication_id uuid, _motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _pub record;
  _admin uuid;
  _quando timestamptz;
  _assets jsonb;
  _fingerprint text;
begin
  if _publication_id is null or nullif(btrim(coalesce(_motivo, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'pedido_incompleto');
  end if;
  -- Uma vez só: tentada (deu certo ou não) nunca volta a ser tentada pela vigia.
  if exists (select 1 from public.vigia_publicacoes_tentadas t where t.publication_id = _publication_id) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tentado');
  end if;

  -- Mesma ordem de trava do promotor (editorial_promover_planejados): global antes da publicação.
  perform public.editorial_lock_task_sync();

  select p.id, p.post_id, p.client_id, p.project_id, p.version, p.scheduled_at,
         coalesce(p.scheduled_timezone, 'America/Sao_Paulo') as tz,
         coalesce(p.delivery_mode, 'manual') as delivery_mode
    into _pub
    from public.editorial_publications p
    join public.editorial_posts po on po.id = p.post_id
   where p.id = _publication_id
     and p.status = 'planned'
     and p.platform = 'instagram'
     and p.scheduled_at is not null
     -- Dentro de 6 h quem cuida é o promotor de todo minuto; mais de 7 dias, o post perdeu o sentido.
     and p.scheduled_at < now() - interval '6 hours'
     and p.scheduled_at >= now() - interval '7 days'
     and p.external_account_id is not null
     and po.archived_at is null
     and po.content_type in ('static', 'story', 'carousel', 'reel', 'video', 'short')
     -- A APROVAÇÃO: arte liberada (o admin subiu e, quando havia, o cliente aprovou). Sem ela, nunca.
     and coalesce(public.editorial_file_is_publishable(
           coalesce(p.file_id, po.primary_file_id), p.client_id, p.project_id), false)
     -- Aprovada depois do horário sem "publicar assim que aprovar": decisão do dono, não da vigia.
     and not public.mesa_publicacao_segurada(p.post_id, p.scheduled_at, coalesce(p.file_id, po.primary_file_id))
   for update of p skip locked;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_elegivel');
  end if;

  insert into public.vigia_publicacoes_tentadas (publication_id, client_id, motivo)
  values (_pub.id, _pub.client_id, left(btrim(_motivo), 500));

  select user_id into _admin from public.user_roles where role = 'admin'::public.app_role order by user_id limit 1;
  if _admin is null then
    update public.vigia_publicacoes_tentadas set resultado = 'falhou', erro = 'nenhum admin cadastrado'
     where publication_id = _pub.id;
    return jsonb_build_object('ok', false, 'motivo', 'sem_admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', _admin::text, 'role', 'authenticated')::text, true);

  begin
    -- Os mesmos passos do promotor oficial: horário novo (a transição recusa passado), snapshot de
    -- entrega, impressão de aprovação recalculada e a transição 'schedule' (guards, evento e versão).
    _quando := now() + interval '1 minute';

    select coalesce(jsonb_agg(a.file_id::text order by a.position), '[]'::jsonb)
      into _assets
      from social_private.editorial_publication_assets a
     where a.publication_id = _pub.id;

    _fingerprint := encode(sha256(convert_to(jsonb_build_object(
      'delivery_mode', _pub.delivery_mode,
      'asset_file_ids', _assets,
      'scheduled_at', _quando,
      'scheduled_timezone', _pub.tz
    )::text, 'UTF8')), 'hex');

    insert into social_private.editorial_publication_delivery_requests
      (publication_id, client_id, request_fingerprint, delivery_mode, asset_count)
    values (_pub.id, _pub.client_id, _fingerprint, _pub.delivery_mode, jsonb_array_length(_assets))
    on conflict (publication_id) do nothing;

    update public.editorial_post_internal
       set approval_fingerprint = public.editorial_compute_approval_fingerprint(_pub.post_id),
           updated_by = coalesce(auth.uid(), updated_by)
     where post_id = _pub.post_id
       and approval_fingerprint is not null;

    perform public.transition_editorial_publication_unlocked(_pub.id, 'schedule', _pub.version, _quando, _pub.tz);

    update public.vigia_publicacoes_tentadas set resultado = 'agendado', agendado_para = _quando
     where publication_id = _pub.id;
  exception when others then
    update public.vigia_publicacoes_tentadas set resultado = 'falhou', erro = left(sqlerrm, 300)
     where publication_id = _pub.id;
    raise warning 'vigia_publicar_atrasado: publicacao % nao foi ao ar: %', _pub.id, sqlerrm;
    return jsonb_build_object('ok', false, 'motivo', 'falhou', 'erro', left(sqlerrm, 300));
  end;

  return jsonb_build_object('ok', true, 'publication_id', _pub.id, 'agendado_para', _quando);
end;
$$;
revoke all on function public.vigia_publicar_atrasado(uuid, text) from public, anon, authenticated;
grant execute on function public.vigia_publicar_atrasado(uuid, text) to service_role;

-- ------------------------------------------------------------------ resumo do dia

-- Formato (o mesmo de src/lib/resumoDoDia.ts):
-- { gerado_em, dia,
--   anuncios: { mudancas: [{id, client_id, cliente, acao, resumo, alvo, antes, depois, quem, quando, prova_url}],
--               alertas: [{client_id, cliente, nivel, texto}] },
--   calendario: { clientes_em_risco: [{client_id, nome, situacao, dias_sem_post, falta, sugestao, em_risco_ha_dias,
--                                      pct_mes, task_id, link}],
--                 campanhas: [{client_id, nome, tema, por_que}] },
--   precisa_de_voce: [{id, tipo, titulo, client_id, cliente, area, motivo, link, link_id, aprovacao_id}],
--   feito_ontem: [{id, titulo, client_id, cliente, area, agente, quando, prova_url, link_id}] }
-- No máximo 10 linhas por lista (campanhas, 5).
create or replace function public.resumo_do_dia_interno()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  _hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  _hoje_ini timestamptz := (_hoje::timestamp at time zone 'America/Sao_Paulo');
  _ontem_ini timestamptz := ((_hoje - 1)::timestamp at time zone 'America/Sao_Paulo');
  _mudancas jsonb;
  _alertas jsonb;
  _risco jsonb;
  _campanhas jsonb;
  _precisa jsonb;
  _feito jsonb;
begin
  -- Anúncios: o que os agentes FIZERAM nas contas desde ontem (ads_rotina_acoes 'feita').
  select coalesce(jsonb_agg(x.j order by x.quando desc), '[]'::jsonb) into _mudancas from (
    select a.criado_em as quando, jsonb_build_object(
             'id', a.id, 'client_id', a.client_id,
             'cliente', coalesce(nullif(btrim(p.company_name), ''), p.full_name),
             'acao', a.tipo, 'resumo', a.resumo,
             'alvo', coalesce(a.alvo ->> 'nome', a.alvo ->> 'name', a.alvo ->> 'meta_id'),
             'antes', a.prova ->> 'antes',
             'depois', coalesce(a.prova ->> 'depois', case when a.resultado_depois is not null then a.resultado_depois::text end),
             'quem', coalesce(a.prova ->> 'operator', a.origem),
             'quando', a.criado_em,
             'prova_url', coalesce(a.prova ->> 'prova_url', a.prova ->> 'url', a.prova ->> 'link')) as j
      from public.ads_rotina_acoes a
      left join public.profiles p on p.id = a.client_id
     where a.estado = 'feita' and a.criado_em >= _ontem_ini
     order by a.criado_em desc
     limit 10
  ) x;

  -- Alertas dos boletins de hoje (o boletim mais novo de cada período).
  select coalesce(jsonb_agg(x.j), '[]'::jsonb) into _alertas from (
    select case when jsonb_typeof(al) = 'object' then jsonb_build_object(
                  'client_id', al ->> 'client_id',
                  'cliente', coalesce(al ->> 'cliente', (select coalesce(nullif(btrim(p.company_name), ''), p.full_name)
                                                           from public.profiles p where p.id::text = al ->> 'client_id')),
                  'nivel', coalesce(al ->> 'nivel', 'atencao'),
                  'texto', left(coalesce(al ->> 'texto', al ->> 'mensagem', ''), 400))
                else jsonb_build_object('client_id', null, 'cliente', null, 'nivel', 'atencao', 'texto', left(al #>> '{}', 400))
           end as j
      from public.ads_boletins b
      cross join lateral jsonb_array_elements(b.alertas) al
     where b.dia = _hoje
     order by b.atualizado_em desc
     limit 10
  ) x
  where coalesce(x.j ->> 'texto', '') <> '';

  -- Calendário: clientes em risco (medidos nas últimas 36 h), o mais grave primeiro.
  select coalesce(jsonb_agg(x.j order by x.peso, x.dias desc nulls last), '[]'::jsonb) into _risco from (
    select case v.estado when 'sem_post_agendado' then 1 when 'vai_ficar_sem_post' then 2 when 'atrasado' then 3 else 4 end as peso,
           v.dias_sem_post as dias,
           jsonb_build_object(
             'client_id', v.client_id,
             'nome', coalesce(nullif(btrim(p.company_name), ''), p.full_name),
             'situacao', v.situacao,
             'dias_sem_post', v.dias_sem_post,
             'falta', case when v.faltam > 0 and v.preparar_ate is not null
                           then 'preparar ' || v.faltam || case when v.faltam = 1 then ' post' else ' posts' end
                                || ' até ' || to_char(v.preparar_ate, 'DD/MM')
                           when jsonb_array_length(v.atrasados) > 0
                           then jsonb_array_length(v.atrasados) || case when jsonb_array_length(v.atrasados) = 1
                                then ' agendado não saiu' else ' agendados não saíram' end
                      end,
             'sugestao', v.sugestao,
             'em_risco_ha_dias', case when v.em_risco_desde is not null
                                      then (_hoje - (v.em_risco_desde at time zone 'America/Sao_Paulo')::date) end,
             'pct_mes', v.pct_mes,
             'task_id', v.task_id,
             'link', '/mesa?client=' || v.client_id::text) as j
      from public.vigia_calendario_estado v
      join public.profiles p on p.id = v.client_id
     where v.estado <> 'em_dia' and v.medido_em > now() - interval '36 hours'
     order by 1, v.dias_sem_post desc nulls last
     limit 10
  ) x;

  -- Dá para fazer campanha: calendário sem buraco e um hype forte desta semana.
  select coalesce(jsonb_agg(x.j), '[]'::jsonb) into _campanhas from (
    select distinct on (v.client_id) jsonb_build_object(
             'client_id', v.client_id,
             'nome', coalesce(nullif(btrim(p.company_name), ''), p.full_name),
             'tema', left(it ->> 'titulo', 160),
             'por_que', left(it ->> 'por_que_agora', 300)) as j,
           (it ->> 'nota')::numeric as nota
      from public.vigia_calendario_estado v
      join public.profiles p on p.id = v.client_id
      join public.mesa_hypes mh on mh.client_id = v.client_id and mh.semana = date_trunc('week', _hoje)::date
      cross join lateral jsonb_array_elements(case when jsonb_typeof(mh.itens) = 'array' then mh.itens else '[]'::jsonb end) it
     where v.estado in ('em_dia', 'abaixo_do_plano')
       and v.medido_em > now() - interval '36 hours'
       and jsonb_typeof(it) = 'object'
       and coalesce(it ->> 'tipo', 'hype') = 'hype'
       and jsonb_typeof(it -> 'nota') = 'number' and (it ->> 'nota')::numeric >= 8
     order by v.client_id, (it ->> 'nota')::numeric desc
     limit 5
  ) x;

  -- Precisa de você: o que só o dono decide, o mais antigo primeiro.
  select coalesce(jsonb_agg(x.j order by x.peso, x.desde), '[]'::jsonb) into _precisa from (
    select * from (
      -- Mensagens da semana (uma por rascunho).
      select 1 as peso, m.desde, jsonb_build_object(
               'id', m.id, 'tipo', 'mensagem',
               'titulo', 'Mensagem da semana para aprovar',
               'client_id', m.client_id,
               'cliente', (select coalesce(nullif(btrim(p.company_name), ''), p.full_name) from public.profiles p where p.id = m.client_id),
               'area', 'Atendimento', 'motivo', null, 'link', '/central/mensagens', 'link_id', null,
               'aprovacao_id', m.id) as j
        from (
          select min(oa.created_at) as desde,
                 (array_agg(oa.id order by oa.created_at))[1] as id,
                 (array_agg(oa.client_id order by oa.created_at))[1] as client_id
            from public.operator_approvals oa
           where oa.origin = 'central' and oa.status in ('pendente', 'adiado') and oa.executed_at is null
             and (oa.valid_until is null or oa.valid_until > now())
           group by coalesce(oa.report_id::text, oa.id::text)
        ) m
      union all
      -- Aprovações dos agentes.
      select 1, oa.created_at, jsonb_build_object(
               'id', oa.id, 'tipo', 'aprovacao', 'titulo', left(coalesce(oa.o_que, 'Aprovação pendente'), 200),
               'client_id', oa.client_id,
               'cliente', (select coalesce(nullif(btrim(p.company_name), ''), p.full_name) from public.profiles p where p.id = oa.client_id),
               'area', null, 'motivo', left(oa.por_que, 300), 'link', '/execucao?aprovacao=' || oa.id::text,
               'link_id', oa.task_link_id, 'aprovacao_id', oa.id)
        from public.operator_approvals oa
       where coalesce(oa.origin, '') <> 'central' and oa.status in ('pendente', 'adiado') and oa.executed_at is null
         and oa.invalidated_at is null and (oa.valid_until is null or oa.valid_until > now())
      union all
      -- Acessos que o agente pediu.
      select 2, pa.created_at, jsonb_build_object(
               'id', pa.id, 'tipo', 'acesso',
               'titulo', 'Acesso: ' || left(coalesce(nullif(pa.site, ''), nullif(pa.conta, ''), pa.tipo, 'login'), 120),
               'client_id', pa.client_id,
               'cliente', (select coalesce(nullif(btrim(p.company_name), ''), p.full_name) from public.profiles p where p.id = pa.client_id),
               'area', 'Operação', 'motivo', left(pa.mensagem, 300), 'link', '/execucao', 'link_id', null, 'aprovacao_id', null)
        from public.pedidos_de_acesso pa
       where pa.status = 'aberto' and (pa.expira_em is null or pa.expira_em > now())
      union all
      -- Propostas de mudança nos anúncios.
      select 3, a.criado_em, jsonb_build_object(
               'id', a.id, 'tipo', 'anuncio', 'titulo', left(coalesce(a.resumo, 'Proposta nos anúncios'), 200),
               'client_id', a.client_id,
               'cliente', (select coalesce(nullif(btrim(p.company_name), ''), p.full_name) from public.profiles p where p.id = a.client_id),
               'area', 'Tráfego', 'motivo', left(a.porque, 300), 'link', null, 'link_id', null, 'aprovacao_id', null)
        from public.ads_rotina_acoes a
       where a.estado = 'proposta' and a.criado_em > now() - interval '3 days'
      union all
      -- Agentes esperando resposta (o que está parado há mais de 14 dias é da faxina, não do dia).
      select 4, l.updated_at, jsonb_build_object(
               'id', l.id, 'tipo', 'vinculo', 'titulo', left(coalesce(t.title, l.last_action, 'Agente esperando'), 200),
               'client_id', pj.client_id,
               'cliente', (select coalesce(nullif(btrim(p.company_name), ''), p.full_name) from public.profiles p where p.id = pj.client_id),
               'area', o.area, 'motivo', left(coalesce(l.block_reason, l.next_step, l.last_action), 300),
               'link', null, 'link_id', l.id, 'aprovacao_id', null)
        from public.operator_task_links l
        join public.tasks t on t.id = coalesce(l.painel_task_id, l.kanban_task_id)
        left join public.projects pj on pj.id = t.project_id
        left join public.internal_operators o on o.id = l.operator_id
       where l.status in ('awaiting_input', 'review', 'blocked')
         and t.deleted_at is null and t.status <> 'done'
         and l.updated_at > now() - interval '14 days'
    ) u
    order by peso, desde
    limit 10
  ) x;

  -- Feito ontem: entregas com prova (operator_deliveries) e posts que foram ao ar.
  select coalesce(jsonb_agg(x.j order by x.quando desc), '[]'::jsonb) into _feito from (
    select * from (
      select d.occurred_at as quando, jsonb_build_object(
               'id', d.id, 'titulo', left(d.o_que, 200), 'client_id', d.client_id,
               'cliente', (select coalesce(nullif(btrim(p.company_name), ''), p.full_name) from public.profiles p where p.id = d.client_id),
               'area', o.area, 'agente', o.display_name, 'quando', d.occurred_at,
               'prova_url', d.onde_acessar, 'link_id', d.task_link_id) as j
        from public.operator_deliveries d
        left join public.internal_operators o on o.id = d.operator_id
       where d.occurred_at >= _ontem_ini and d.occurred_at < _hoje_ini
      union all
      select max(e.published_at), jsonb_build_object(
               'id', (array_agg(e.id order by e.published_at desc))[1],
               'titulo', case when count(distinct e.post_id) = 1
                              then left(coalesce((array_agg(po.title order by e.published_at desc))[1], 'Post'), 160) || ' (publicado)'
                              else count(distinct e.post_id) || ' posts publicados' end,
               'client_id', e.client_id,
               'cliente', (select coalesce(nullif(btrim(p.company_name), ''), p.full_name) from public.profiles p where p.id = e.client_id),
               'area', 'Conteúdo', 'agente', null, 'quando', max(e.published_at),
               'prova_url', (array_agg(e.permalink order by e.published_at desc))[1], 'link_id', null)
        from public.editorial_publications e
        join public.editorial_posts po on po.id = e.post_id
       where e.status = 'published' and e.published_at >= _ontem_ini and e.published_at < _hoje_ini
       group by e.client_id
    ) u
    order by quando desc
    limit 10
  ) x;

  return jsonb_build_object(
    'gerado_em', now(),
    'dia', _hoje,
    'anuncios', jsonb_build_object('mudancas', _mudancas, 'alertas', _alertas),
    'calendario', jsonb_build_object('clientes_em_risco', _risco, 'campanhas', _campanhas),
    'precisa_de_voce', _precisa,
    'feito_ontem', _feito
  );
end;
$$;
revoke all on function public.resumo_do_dia_interno() from public, anon, authenticated;
grant execute on function public.resumo_do_dia_interno() to service_role;

-- A tela /hoje (equipe). O cron usa a interna.
create or replace function public.resumo_do_dia()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.is_staff(auth.uid()), false) then
    raise exception 'resumo_do_dia: só a equipe' using errcode = '42501';
  end if;
  return public.resumo_do_dia_interno();
end;
$$;
revoke all on function public.resumo_do_dia() from public, anon;
grant execute on function public.resumo_do_dia() to authenticated, service_role;

-- Um aviso por dia, às 8h: só para os admins (o dono), nunca o robô do n8n. Sem nada a dizer, não toca.
create or replace function public.resumo_do_dia_avisar()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  _hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  _r jsonb;
  _risco integer;
  _decisoes integer;
  _feitos integer;
  _alertas integer;
  _mudancas integer;
  _partes text[] := array[]::text[];
  _n integer := 0;
begin
  if exists (
    select 1 from public.notifications n
     where n.notification_type = 'resumo_do_dia'
       and n.created_at >= (_hoje::timestamp at time zone 'America/Sao_Paulo')
  ) then
    return jsonb_build_object('ok', true, 'avisados', 0, 'motivo', 'ja_avisado_hoje');
  end if;

  _r := public.resumo_do_dia_interno();
  _risco := jsonb_array_length(_r #> '{calendario,clientes_em_risco}');
  _decisoes := jsonb_array_length(_r -> 'precisa_de_voce');
  _feitos := jsonb_array_length(_r -> 'feito_ontem');
  _alertas := jsonb_array_length(_r #> '{anuncios,alertas}');
  _mudancas := jsonb_array_length(_r #> '{anuncios,mudancas}');

  if _risco > 0 then _partes := _partes || (_risco || case when _risco = 1 then ' cliente com calendário em risco' else ' clientes com calendário em risco' end); end if;
  if _decisoes > 0 then _partes := _partes || (_decisoes || case when _decisoes = 1 then ' decisão sua' else ' decisões suas' end); end if;
  if _alertas > 0 then _partes := _partes || (_alertas || case when _alertas = 1 then ' alerta nos anúncios' else ' alertas nos anúncios' end); end if;
  if _mudancas > 0 then _partes := _partes || (_mudancas || case when _mudancas = 1 then ' mudança nos anúncios' else ' mudanças nos anúncios' end); end if;
  if _feitos > 0 then _partes := _partes || (_feitos || case when _feitos = 1 then ' entrega ontem' else ' entregas ontem' end); end if;

  if coalesce(array_length(_partes, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'avisados', 0, 'motivo', 'nada_a_avisar');
  end if;

  insert into public.notifications (user_id, message, notification_type, link)
  select distinct ur.user_id, left('Hoje: ' || array_to_string(_partes, ' · ') || '.', 500), 'resumo_do_dia', '/hoje'
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
   where ur.role = 'admin' and p.deleted_at is null and coalesce(p.email, '') not ilike 'n8n@%';
  get diagnostics _n = row_count;
  return jsonb_build_object('ok', true, 'avisados', _n);
end;
$$;
revoke all on function public.resumo_do_dia_avisar() from public, anon, authenticated;
grant execute on function public.resumo_do_dia_avisar() to service_role;

-- ------------------------------------------------------------------ crons

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('vigia-calendario', 'resumo-do-dia-aviso');

    -- 06h07 a 18h37 BRT, a cada 30 min: mede todos (sem IA) e prepara no máximo um cliente por chamada.
    perform cron.schedule('vigia-calendario', '7,37 9-21 * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/agente-calendario',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'vigia_do_calendario_interno'),
        timeout_milliseconds := 300000
      );
    $cron$);

    -- 08h00 BRT: um aviso no sino com o link /hoje.
    perform cron.schedule('resumo-do-dia-aviso', '0 11 * * *', $cron$ select public.resumo_do_dia_avisar(); $cron$);
  end if;
end;
$$;

-- Conferência (todas true):
-- select exists (select 1 from information_schema.tables where table_name = 'vigia_calendario_estado'),
--   exists (select 1 from information_schema.tables where table_name = 'vigia_publicacoes_tentadas'),
--   exists (select 1 from pg_proc where proname = 'vigia_calendario_fatos'),
--   exists (select 1 from pg_proc where proname = 'vigia_publicar_atrasado'),
--   exists (select 1 from pg_proc where proname = 'resumo_do_dia'),
--   exists (select 1 from cron.job where jobname = 'vigia-calendario'),
--   exists (select 1 from cron.job where jobname = 'resumo-do-dia-aviso');
