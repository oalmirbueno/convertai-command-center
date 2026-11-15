-- Instagram da Aceleriq: comentários (e depois Direct). Pedido do Almir em 11/11/2026.
-- A COLETA fica no banco: o token do Instagram nunca sai do cofre (vault). O n8n só lê os eventos pendentes,
-- julga (Jev), redige e grava de volta. Nada aqui publica no Instagram.

create table if not exists acq_n8n.instagram_posts (
  media_id text primary key,
  legenda text,
  permalink text,
  tipo text,
  publicado_em timestamptz,
  comentarios integer not null default 0,
  visto_em timestamptz not null default now()
);

create table if not exists acq_n8n.instagram_eventos (
  id text primary key,                       -- id do comentário ou da mensagem na Meta (idempotência)
  canal text not null check (canal in ('comentario', 'direct')),
  media_id text,
  de_id text,
  de_usuario text,
  texto text,
  em timestamptz,
  proprio boolean not null default false,
  ja_respondido boolean not null default false,
  recebido_em timestamptz not null default now(),
  estado text not null default 'novo' check (estado in ('novo', 'rascunho', 'publicado', 'ignorado', 'aviso', 'erro', 'historico')),
  tipo text,
  julgamento jsonb,
  acao text,
  resposta_comentario text,
  resposta_direct text,
  aviso text,
  avisado_em timestamptz,
  virou_lead boolean not null default false,
  motivos jsonb,
  tentativas integer not null default 0,
  tratado_em timestamptz,
  publicado_em timestamptz
);
create index if not exists instagram_eventos_estado on acq_n8n.instagram_eventos (estado, recebido_em);

create table if not exists acq_n8n.instagram_coletas (
  id bigserial primary key,
  pedido_em timestamptz not null default now(),
  request_id bigint,
  colhido_em timestamptz,
  status integer,
  posts integer,
  novos integer,
  erro text
);

-- A cada 5 min: colhe a resposta do pedido anterior e dispara o próximo (pg_net é assíncrono).
create or replace function acq_n8n.instagram_tick(_ig text default '17841475698260402', _usuario text default 'aceleriq')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare _c record; _r record; _j jsonb; _m jsonb; _k jsonb; _novos int; _posts int; _tok text; _req bigint; _colhidas int := 0; _em timestamptz;
begin
  for _c in select * from acq_n8n.instagram_coletas where colhido_em is null and request_id is not null order by id loop
    select status_code, content, error_msg, timed_out into _r from net._http_response where id = _c.request_id;
    if not found then
      if _c.pedido_em < now() - interval '20 minutes' then
        update acq_n8n.instagram_coletas set colhido_em = now(), erro = 'sem_resposta' where id = _c.id;
      end if;
      continue;
    end if;
    _colhidas := _colhidas + 1;
    if _r.status_code is distinct from 200 then
      update acq_n8n.instagram_coletas set colhido_em = now(), status = _r.status_code,
        erro = left(coalesce(_r.error_msg, _r.content, case when _r.timed_out then 'tempo esgotado' else 'falha' end), 300) where id = _c.id;
      continue;
    end if;
    _j := _r.content::jsonb; _novos := 0; _posts := 0;
    for _m in select * from jsonb_array_elements(coalesce(_j->'data', '[]'::jsonb)) loop
      _posts := _posts + 1;
      insert into acq_n8n.instagram_posts (media_id, legenda, permalink, tipo, publicado_em, comentarios)
      values (_m->>'id', _m->>'caption', _m->>'permalink', _m->>'media_product_type', (_m->>'timestamp')::timestamptz, coalesce((_m->>'comments_count')::int, 0))
      on conflict (media_id) do update set legenda = excluded.legenda, comentarios = excluded.comentarios, visto_em = now();
      for _k in select * from jsonb_array_elements(coalesce(_m->'comments'->'data', '[]'::jsonb)) loop
        _em := (_k->>'timestamp')::timestamptz;
        insert into acq_n8n.instagram_eventos (id, canal, media_id, de_id, de_usuario, texto, em, proprio, ja_respondido, estado)
        values (_k->>'id', 'comentario', _m->>'id', _k->'from'->>'id', _k->>'username', _k->>'text', _em,
          lower(coalesce(_k->>'username', '')) = lower(_usuario),
          exists (select 1 from jsonb_array_elements(coalesce(_k->'replies'->'data', '[]'::jsonb)) x where lower(x->>'username') = lower(_usuario)),
          case when lower(coalesce(_k->>'username', '')) = lower(_usuario) then 'ignorado'
               when _em < now() - interval '7 days' then 'historico' else 'novo' end)
        on conflict (id) do nothing;
        if found then _novos := _novos + 1; end if;
      end loop;
    end loop;
    update acq_n8n.instagram_coletas set colhido_em = now(), status = 200, posts = _posts, novos = _novos where id = _c.id;
  end loop;

  if not exists (select 1 from acq_n8n.instagram_coletas where colhido_em is null) then
    select s.decrypted_secret into _tok
      from social_private.external_account_grants e join vault.decrypted_secrets s on s.id = e.resource_access_token_secret_id
     where e.provider_resource_id = _ig and e.revoked_at is null order by e.connected_at desc limit 1;
    if _tok is null then
      insert into acq_n8n.instagram_coletas (colhido_em, erro) values (now(), 'sem_token');
    else
      select net.http_get(
        url := 'https://graph.facebook.com/v26.0/' || _ig || '/media?limit=60&fields=id,caption,permalink,timestamp,media_product_type,comments_count,comments.limit(50){id,text,username,timestamp,from,replies.limit(10){username}}',
        headers := jsonb_build_object('Authorization', 'Bearer ' || _tok), timeout_milliseconds := 20000) into _req;
      insert into acq_n8n.instagram_coletas (request_id) values (_req);
    end if;
  end if;
  delete from acq_n8n.instagram_coletas where pedido_em < now() - interval '14 days';
  return jsonb_build_object('colhidas', _colhidas, 'pedido', _req);
end $$;

-- O n8n pega os pendentes (com a legenda do post). Três tentativas; depois vira erro e o vigia avisa.
create or replace function acq_n8n.instagram_pendentes(_limite integer default 10)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare _out jsonb;
begin
  update acq_n8n.instagram_eventos set estado = 'erro', tratado_em = now() where estado = 'novo' and tentativas >= 3;
  with p as (
    select e.id from acq_n8n.instagram_eventos e where e.estado = 'novo' order by e.recebido_em limit greatest(1, least(_limite, 25)) for update skip locked
  ), u as (
    update acq_n8n.instagram_eventos e set tentativas = e.tentativas + 1 from p where e.id = p.id
    returning e.id, e.canal, e.media_id, e.de_id, e.de_usuario, e.texto, e.em, e.proprio, e.ja_respondido
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'canal', u.canal, 'media_id', u.media_id, 'de_id', u.de_id, 'de_usuario', u.de_usuario,
    'texto', u.texto, 'em', u.em, 'proprio', u.proprio, 'ja_respondido', u.ja_respondido, 'legenda', po.legenda, 'permalink', po.permalink)), '[]'::jsonb)
    into _out from u left join acq_n8n.instagram_posts po on po.media_id = u.media_id;
  return _out;
end $$;

-- Aviso que chega fora do painel: tipo 'aprovacao_necessaria' vira e-mail (public.notificacao_merece_email).
create or replace function acq_n8n.instagram_avisar(_texto text, _link text default '/execucao')
returns integer language plpgsql security definer set search_path to '' as $$
declare _n integer;
begin
  insert into public.notifications (user_id, message, notification_type, link)
  select distinct ur.user_id, left(_texto, 500), 'aprovacao_necessaria', _link
    from public.user_roles ur join public.profiles p on p.id = ur.user_id
   where ur.role = 'admin'::public.app_role and p.deleted_at is null and coalesce(p.email, '') not ilike 'n8n@%' and coalesce(p.full_name, '') not ilike '%tempor%';
  get diagnostics _n = row_count;
  return _n;
end $$;

create or replace function acq_n8n.instagram_registrar(_id text, _r jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare _e acq_n8n.instagram_eventos; _avisou boolean := false;
begin
  select * into _e from acq_n8n.instagram_eventos where id = _id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'nao_existe'); end if;
  if _e.estado in ('publicado') then return jsonb_build_object('ok', true, 'repetido', true); end if;
  update acq_n8n.instagram_eventos set
    estado = case when _r->>'estado' in ('rascunho', 'publicado', 'ignorado', 'aviso', 'erro') then _r->>'estado' else 'erro' end,
    tipo = _r->>'tipo', julgamento = _r->'julgamento', acao = _r->>'acao', resposta_comentario = _r->>'comentario', resposta_direct = _r->>'direct',
    aviso = _r->>'aviso', virou_lead = coalesce((_r->>'lead')::boolean, false), motivos = _r->'motivos', tratado_em = now()
  where id = _id;
  if nullif(_r->>'aviso_texto', '') is not null and _e.avisado_em is null then
    perform acq_n8n.instagram_avisar(_r->>'aviso_texto');
    update acq_n8n.instagram_eventos set avisado_em = now() where id = _id;
    _avisou := true;
  end if;
  return jsonb_build_object('ok', true, 'avisou', _avisou);
end $$;

-- Vigia: coleta parada, token perto de vencer, evento sem tratar. Abre incidente (sino) e manda e-mail uma vez; fecha sozinho quando volta.
create or replace function acq_n8n.instagram_vigia(_ig text default '17841475698260402')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare _ult timestamptz; _erro text; _venc timestamptz; _parados int; _r jsonb; _abertos text[] := '{}'; _x record;
begin
  select max(colhido_em) into _ult from acq_n8n.instagram_coletas where status = 200;
  select erro into _erro from acq_n8n.instagram_coletas where colhido_em is not null order by id desc limit 1;
  select g.data_access_expires_at into _venc from social_private.external_account_grants e join social_private.oauth_grants g on g.id = e.grant_id
   where e.provider_resource_id = _ig and e.revoked_at is null order by e.connected_at desc limit 1;
  select count(*) into _parados from acq_n8n.instagram_eventos where estado = 'erro' or (estado = 'novo' and recebido_em < now() - interval '45 minutes');

  for _x in select * from (values
    ('IG|coleta_parada', (_ult is null or _ult < now() - interval '40 minutes'), 'alto', 'Instagram: a leitura dos comentários parou',
      jsonb_build_object('ultima_leitura_ok', _ult, 'ultimo_erro', _erro, 'o_que_fazer', 'Se o erro fala em token ou permissão, reconectar o Instagram da Aceleriq no painel.')),
    ('IG|token_vencendo', (_venc is not null and _venc < now() + interval '14 days'), 'aviso', 'Instagram: o acesso da Aceleriq vence em ' || coalesce(to_char(_venc at time zone 'America/Sao_Paulo', 'DD/MM'), '?'),
      jsonb_build_object('vence_em', _venc, 'o_que_fazer', 'Reconectar o Instagram da Aceleriq no painel ou gravar o token do usuário do sistema.')),
    ('IG|eventos_parados', _parados > 0, 'aviso', 'Instagram: ' || _parados || ' comentário(s) sem tratar',
      jsonb_build_object('quantos', _parados, 'o_que_fazer', 'Conferir se o fluxo do Instagram está publicado no n8n e se o Jev e o OpenRouter respondem.'))
  ) v(chave, ruim, sev, titulo, detalhe) loop
    if _x.ruim then
      _r := acq_n8n.incidente_registrar(_x.chave, 'Instagram', null, _x.sev, _x.titulo, _x.detalhe);
      if (_r->>'novo')::boolean or (_r->>'reaberto')::boolean then perform acq_n8n.instagram_avisar(_x.titulo || E'\n' || (_x.detalhe->>'o_que_fazer')); end if;
      _abertos := _abertos || _x.chave;
    else
      update acq_n8n.incidentes set estado = 'resolvido', resolvido_em = now(), resolucao = 'voltou sozinho' where incident_key = _x.chave and estado <> 'resolvido';
    end if;
  end loop;
  return jsonb_build_object('abertos', _abertos, 'ultima_leitura_ok', _ult, 'vence_em', _venc, 'parados', _parados);
end $$;

-- Resumo: diário só quando houve movimento; semanal sempre. Chega por e-mail e no sino.
create or replace function acq_n8n.instagram_resumo(_dias integer default 1, _sempre boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare _t record; _txt text; _pend text;
begin
  select count(*) filter (where canal = 'comentario') com, count(*) filter (where canal = 'direct') dm,
         count(*) filter (where estado = 'publicado') resp, count(*) filter (where estado = 'rascunho') rasc,
         count(*) filter (where virou_lead) leads, count(*) filter (where aviso is not null) avisos,
         count(*) filter (where estado in ('novo', 'erro')) sem, count(*) filter (where acao = 'palavra_chave') palavras
    into _t from acq_n8n.instagram_eventos where recebido_em >= now() - make_interval(days => _dias) and not proprio and estado <> 'historico';
  if not _sempre and _t.com + _t.dm = 0 then return jsonb_build_object('enviado', false, 'motivo', 'sem_movimento'); end if;
  select string_agg('@' || coalesce(de_usuario, '?') || ': "' || left(coalesce(texto, ''), 60) || '"', E'\n' order by recebido_em desc) into _pend
    from (select * from acq_n8n.instagram_eventos where recebido_em >= now() - make_interval(days => _dias) and estado in ('rascunho', 'aviso', 'novo', 'erro') and not proprio order by recebido_em desc limit 4) s;
  _txt := 'Instagram @aceleriq, ' || case when _dias = 1 then 'hoje' else 'últimos ' || _dias || ' dias' end || ': '
    || _t.com || ' comentário(s), ' || _t.dm || ' Direct, ' || _t.palavras || ' palavra(s)-chave, ' || _t.leads || ' lead(s). '
    || _t.resp || ' respondido(s), ' || _t.rasc || ' em rascunho, ' || _t.sem || ' sem tratar.'
    || coalesce(E'\nEsperando você:\n' || _pend, '');
  perform acq_n8n.instagram_avisar(_txt);
  return jsonb_build_object('enviado', true, 'texto', _txt);
end $$;

revoke all on function acq_n8n.instagram_tick(text, text), acq_n8n.instagram_pendentes(integer), acq_n8n.instagram_avisar(text, text),
  acq_n8n.instagram_registrar(text, jsonb), acq_n8n.instagram_vigia(text), acq_n8n.instagram_resumo(integer, boolean) from public, anon, authenticated;
grant execute on function acq_n8n.instagram_pendentes(integer), acq_n8n.instagram_registrar(text, jsonb) to acq_n8n_worker;
alter table acq_n8n.instagram_posts enable row level security;
alter table acq_n8n.instagram_eventos enable row level security;
alter table acq_n8n.instagram_coletas enable row level security;

select cron.schedule('acq-instagram-coleta', '*/5 * * * *', $$select acq_n8n.instagram_tick()$$);
select cron.schedule('acq-instagram-vigia', '7,37 * * * *', $$select acq_n8n.instagram_vigia()$$);
select cron.schedule('acq-instagram-resumo-dia', '30 21 * * *', $$select acq_n8n.instagram_resumo(1, false)$$);      -- 18h30 de Brasília, só se houve movimento
select cron.schedule('acq-instagram-resumo-semana', '0 11 * * 1', $$select acq_n8n.instagram_resumo(7, true)$$);     -- segunda, 8h de Brasília
