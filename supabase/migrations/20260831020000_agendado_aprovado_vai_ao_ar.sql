-- ═══════════════════════════════════════════════════════════════════════
-- O QUE ESTA APROVADO E TEM HORA MARCADA VAI AO AR.
--
-- Falha grave em 31/08 as 11:28: um post da aJenda com a arte APROVADA
-- PELO CLIENTE em 27/08, com conta conectada e horario marcado, nao saiu.
-- E ninguem foi avisado.
--
-- A causa nao era aprovacao nem arquivo. A publicacao ficou em `planned`
-- e nunca virou `scheduled` — e o publicador so olha `scheduled`
-- (attempt_count zero: nunca tentou). O caminho oficial que promove,
-- social_private.schedule_captured_editorial_publications, exige um
-- snapshot de entrega que essas publicacoes nunca ganharam, e abortava
-- com "delivery snapshot is unresolved".
--
-- O agravante e meu: o alarme que eu escrevi filtra `status = 'scheduled'`.
-- Tudo preso em `planned` era INVISIVEL para ele. Eu previ "agendado e nao
-- saiu" e nao previ "nunca chegou a ser agendado" — o silencio custou
-- quatro posts.
--
-- A REGRA DO DONO, agora no banco: quem sobe a arte e marca a hora ja
-- aprovou; se houver aprovacao de cliente e o cliente aprovar, conta
-- sozinho. Nao existe terceiro passo.
--
-- Nao altera valores, historico, conteudo nem horarios. Rollback: drop das
-- duas funcoes novas e reapontar o cron para editorial_autopublish_tick.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Promover o que esta pronto ──────────────────────────────────────
--
-- A janela de atraso existe de proposito. Um post uma hora atrasado quase
-- sempre ainda serve; um post de cinco dias atras vira ruido no perfil do
-- cliente. Passou da janela, o painel NAO publica sozinho — ele grita, e
-- a decisao volta para quem responde pela conta.
create or replace function public.editorial_promover_planejados(
  _janela_de_atraso interval default interval '6 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  _pub record;
  _assets jsonb;
  _fingerprint text;
  _admin uuid;
  _quando timestamptz;
  _promovidos integer := 0;
  _ignorados integer := 0;
  _falhas jsonb := '[]'::jsonb;
begin
  -- A transicao oficial exige ator autenticado e o cron nao tem JWT. Mesmo
  -- padrao que editorial_autopublish_tick usa para dar a baixa: assume o
  -- admin, para o evento na trilha ter autor real em vez de nascer orfao.
  select user_id into _admin
    from public.user_roles
   where role = 'admin'::public.app_role
   order by user_id limit 1;

  if _admin is null then
    return jsonb_build_object('promovidos', 0, 'nao_promovidos', 0,
      'falhas', jsonb_build_array(jsonb_build_object(
        'erro', 'nenhum admin cadastrado: nao ha em nome de quem promover')),
      'em', now());
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', _admin::text, 'role', 'authenticated')::text, true);

  for _pub in
    select p.id, p.client_id, p.project_id, p.version, p.scheduled_at,
           coalesce(p.scheduled_timezone, 'America/Sao_Paulo') as tz,
           coalesce(p.delivery_mode, 'manual') as delivery_mode,
           po.title
      from public.editorial_publications p
      join public.editorial_posts po on po.id = p.post_id
     where p.status = 'planned'
       and p.scheduled_at is not null
       and p.external_account_id is not null
       and po.content_type in ('static', 'story', 'carousel', 'reel', 'video', 'short')
       -- A APROVACAO, em uma linha: a arte estar liberada ja significa que
       -- o admin subiu e, quando havia aprovacao de cliente, o cliente
       -- aprovou. Nao ha nada mais para conferir.
       and coalesce(public.editorial_file_is_publishable(
             coalesce(p.file_id, po.primary_file_id), p.client_id, p.project_id
           ), false)
       -- Atrasado demais nao entra sozinho: vira alarme, nao post.
       and p.scheduled_at >= now() - _janela_de_atraso
     order by p.scheduled_at
     limit 100
  loop
    begin
      -- A transicao recusa horario no passado. Sem esta linha a janela de
      -- atraso seria decorativa: um post que perdesse o minuto ficaria
      -- preso para sempre, porque o horario dele so envelhece. Recuperar
      -- um atrasado significa dar a ele um horario NOVO — e o original
      -- continua na trilha, no evento de criacao.
      _quando := greatest(_pub.scheduled_at, now() + interval '1 minute');

      -- O snapshot de entrega, que faltava. Sem ele, um save posterior
      -- volta a abortar com "delivery snapshot is unresolved" e a
      -- publicacao trava de novo pelo mesmo motivo.
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
      values
        (_pub.id, _pub.client_id, _fingerprint, _pub.delivery_mode,
         jsonb_array_length(_assets))
      on conflict (publication_id) do nothing;

      -- A transicao OFICIAL: ela dispara os guards, grava o evento e
      -- mantem a versao. Escrever o status na mao pularia tudo isso.
      perform public.transition_editorial_publication_unlocked(
        _pub.id, 'schedule', _pub.version, _quando, _pub.tz
      );
      _promovidos := _promovidos + 1;
    exception when others then
      -- Uma publicacao que nao promove nao pode derrubar as outras. E a
      -- falha vai NOMEADA no retorno: promover em silencio e o defeito que
      -- estamos consertando.
      _ignorados := _ignorados + 1;
      _falhas := _falhas || jsonb_build_object(
        'publication_id', _pub.id, 'titulo', _pub.title, 'erro', sqlerrm
      );
    end;
  end loop;

  return jsonb_build_object(
    'promovidos', _promovidos,
    'nao_promovidos', _ignorados,
    'falhas', _falhas,
    'em', now()
  );
end;
$$;

revoke all on function public.editorial_promover_planejados(interval) from anon;

-- ─── 1b) O Kanban nao desaprova o que ja foi aprovado ───────────────────
--
-- ESTA foi a causa de hoje. As tarefas foram de `review` para `doing` as
-- 12:46 — duas horas antes do post — e o sync arrastou os posts de `ready`
-- para `production`. Post em `production` nao passa no guard "requires
-- ready content", e entao nunca poderia virar `scheduled`.
--
-- O guard que impediria isso ja existia, mas so protegia de `scheduled` em
-- diante. `planned` era tratado como "nada comprometido ainda", quando uma
-- publicacao com arte aprovada e hora marcada E um compromisso — so estava
-- parada no estado errado.
--
-- Recusar alto e melhor que aceitar em silencio: antes, arrastar o card
-- rebaixava o post e a falha so aparecia horas depois, na hora do post que
-- nao saiu.
create or replace function public.editorial_sync_post_from_task_trigger()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  _post_id uuid;
  _client_id uuid;
  _from_status text;
  _to_status text;
  _post_version integer;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
    OR left(COALESCE(NEW.source, ''), 15) = 'client_request:' THEN
    RETURN NEW;
  END IF;

  _to_status := public.editorial_production_status_for_task(NEW.status);
  IF _to_status IS NULL THEN
    RETURN NEW;
  END IF;

  _post_id := public.editorial_current_post_id_for_task(NEW.id);
  IF _post_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT post.client_id, post.production_status
  INTO _client_id, _from_status
  FROM public.editorial_posts AS post
  WHERE post.id = _post_id
  FOR UPDATE;

  IF NOT FOUND OR _from_status IS NOT DISTINCT FROM _to_status THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.post_id = _post_id
      AND publication.status NOT IN ('planned', 'cancelled')
  ) THEN
    RAISE EXCEPTION
      'Publicações agendadas ou finalizadas não podem voltar de etapa pelo Kanban.';
  END IF;

  -- A trava nova. Só vale para quem REBAIXA uma publicação já aprovada e
  -- com data; avançar o card continua livre.
  IF _to_status <> 'ready' AND EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.post_id = _post_id
      AND publication.status = 'planned'
      AND publication.scheduled_at IS NOT NULL
      AND COALESCE(public.editorial_file_is_publishable(
            COALESCE(publication.file_id, post.primary_file_id),
            publication.client_id, publication.project_id), false)
  ) THEN
    RAISE EXCEPTION
      'Esta arte já está aprovada e tem publicação marcada. Mover o card para trás cancelaria o post sem avisar ninguém: cancele ou reagende a publicação na Agenda primeiro.';
  END IF;

  UPDATE public.editorial_posts
  SET production_status = _to_status
  WHERE id = _post_id
  RETURNING version INTO _post_version;

  INSERT INTO public.editorial_events (
    client_id, post_id, actor_id, event_type, from_status, to_status, metadata
  ) VALUES (
    _client_id, _post_id, auth.uid(),
    'production_status_synced_from_task', _from_status, _to_status,
    jsonb_build_object(
      'source', 'kanban',
      'task_id', NEW.id,
      'task_status_before', OLD.status,
      'task_status_after', NEW.status,
      'post_version', _post_version
    )
  );

  RETURN NEW;
END
$function$;

-- ─── 2) O alarme enxerga `planned` tambem ───────────────────────────────
--
-- Reescrito para cobrir os DOIS jeitos de nao ir ao ar: o que foi agendado
-- e nao saiu, e o que nunca chegou a ser agendado. O segundo era o ponto
-- cego que deixou a falha das 11:28 passar sem uma linha de aviso.
create or replace function public.editorial_alerta_agendamento_atrasado()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  _pub record;
  _cliente text;
  _quando text;
  _motivo text;
  _avisados integer := 0;
begin
  for _pub in
    select p.id, p.client_id, p.platform, p.scheduled_at, p.delivery_mode, p.status,
           po.title as titulo,
           coalesce(
             public.editorial_file_is_publishable(
               coalesce(p.file_id, po.primary_file_id), p.client_id, p.project_id
             ), false) as arte_liberada,
           coalesce(p.file_id, po.primary_file_id) is null as sem_arte,
           p.external_account_id is null as sem_conta,
           po.production_status,
           (select count(*) from public.social_post_metrics m
             where m.external_account_id = p.external_account_id
               and m.posted_at between p.scheduled_at - interval '30 minutes'
                                   and p.scheduled_at + interval '6 hours') as posts_na_janela
      from public.editorial_publications p
      left join public.editorial_posts po on po.id = p.post_id
     where p.status in ('scheduled', 'planned')
       and p.scheduled_at is not null
       and p.scheduled_at < now() - interval '90 minutes'
       and not exists (
         select 1 from public.notifications n
          where n.notification_type = 'agendamento_atrasado'
            and n.link = '/calendario?publicacao=' || p.id::text
       )
     order by p.scheduled_at
     limit 200
  loop
    select coalesce(nullif(trim(pr.company_name), ''), pr.full_name)
      into _cliente
      from public.profiles pr where pr.id = _pub.client_id;

    _quando := to_char(_pub.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');

    _motivo := case
      -- Os motivos de `planned` vem primeiro: sao os que o alarme antigo
      -- nao via, e cada um pede uma acao diferente.
      when _pub.status = 'planned' and _pub.sem_arte then
        'ficou so planejada: nao ha arte anexada ao post'
      when _pub.status = 'planned' and _pub.sem_conta then
        'ficou so planejada: falta conectar a conta desta publicacao'
      when _pub.status = 'planned' and not _pub.arte_liberada then
        'ficou so planejada: a arte ainda nao esta aprovada'
      when _pub.status = 'planned' and _pub.production_status <> 'ready' then
        'a arte esta aprovada, mas o post voltou para "' || _pub.production_status
        || '" — provavelmente o card andou para tras no Kanban. Devolva o card '
        || 'para revisao e ele vai ao ar no proximo minuto'
      when _pub.status = 'planned' then
        'estava aprovada e com hora marcada, mas passou da janela de 6 horas '
        || 'sem ser promovida a agendada. O painel NAO publica sozinho um post '
        || 'tao atrasado: confirme se ainda faz sentido e publique pelo painel'
      when _pub.posts_na_janela > 1 then
        'o painel achou MAIS DE UM post na conta nessa janela e nao quis chutar qual e: confirme qual deles e este e de a baixa pelo painel'
      when not _pub.arte_liberada then
        'a arte ainda nao esta aprovada dos dois lados'
      when _pub.delivery_mode <> 'automatic' then
        'esta pronta e aprovada, o painel conferiu a conta e nao achou nenhum post nessa janela: publique, ou ligue a automacao dessa conta para sair sozinho'
      else
        'esta liberada e automatica, e mesmo assim nao saiu: verifique a conexao da conta'
    end;

    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id,
           format('Agendamento de %s passou da hora (%s) e o painel nao encontrou publicacao: %s',
                  coalesce(_cliente, 'cliente'), _quando, _motivo),
           'agendamento_atrasado',
           '/calendario?publicacao=' || _pub.id::text
      from public.user_roles ur
     where ur.role = 'admin'::public.app_role;

    _avisados := _avisados + 1;
  end loop;

  return jsonb_build_object('avisados', _avisados, 'em', now());
end;
$$;

-- ─── 3) Promover ANTES de publicar, no mesmo minuto ─────────────────────
--
-- A promocao precisa acontecer no ciclo de um minuto, junto do publicador.
-- Deixa-la no ciclo de 15 minutos faria um post das 11:28 sair as 11:30 no
-- melhor caso — e o dono marcou 11:28.
--
-- Funcao separada, e nao um SELECT com duas chamadas, porque a ordem de
-- avaliacao dos itens de um SELECT nao e garantida: publicar antes de
-- promover perderia exatamente o minuto marcado.
create or replace function public.editorial_ciclo_publicacao()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  _promocao jsonb;
  _tick jsonb;
begin
  _promocao := public.editorial_promover_planejados();
  _tick := public.editorial_autopublish_tick();
  return jsonb_build_object('promocao', _promocao, 'publicacao', _tick);
end;
$$;

revoke all on function public.editorial_ciclo_publicacao() from anon;

-- O cron de cada minuto passa a promover e so entao publicar.
select cron.unschedule('editorial-autopublish')
where exists (select 1 from cron.job where jobname = 'editorial-autopublish');

select cron.schedule(
  'editorial-autopublish',
  '* * * * *',
  'SELECT public.editorial_ciclo_publicacao();'
);
