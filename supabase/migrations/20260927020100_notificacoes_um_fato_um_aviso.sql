-- ═══════════════════════════════════════════════════════════════════════
-- N-01 · NOTIFICAÇÕES FUNCIONANDO (frente N, 27/09). NÃO APLICADO.
--
-- Pedido do dono: "todas as notificações funcionando corretamente".
-- Só amplia e é idempotente (CREATE OR REPLACE, IF NOT EXISTS). Nenhuma
-- tabela nova, nenhum cron novo. Ensaio sem gravar: N-01-notificacoes.dry.sql
-- (mesmo conteúdo, termina em ROLLBACK e mostra a conferência).
--
-- O que estava errado (medido no banco em 27/09):
--   1) Cada decisão de cliente virava DOIS avisos (e dois e-mails) para cada
--      admin: "Aprovação recebida: ..." (gatilho) e "Cliente aprovou: ..."
--      (decide_file_approval). Pedido de ajuste idem ("Cliente solicitou
--      ajustes em" + "Ajustes solicitados" da tela), e o gatilho nem
--      reconhecia o 'rejected' que a função grava.
--   2) O robô do N8N (admin) recebia tudo como não lido: foi a pilha das
--      2.891 marcadas como lidas em 26/09. Voltaria a acumular.
--   3) Rajada de "Nova entrega disponível" no portal: 9 a 12 avisos no mesmo
--      minuto para o mesmo cliente (26 e 27/09). E os agentes: 1.113
--      sugestões de responsável e 228 relatos, um aviso por passo.
--   4) Contagem de não lidas lenta de achar (sem índice parcial).
--   5) Aviso de post que não saiu (agendamento_atrasado) abria a Agenda sem
--      o cliente e sem o post; e não ia por e-mail.
--   6) Não havia como testar os canais sem esperar um cliente agir.
--
-- Ordem com a frente EA: pode aplicar antes ou depois do EA-01. Enquanto o
-- gatilho da EA (mesa_avisos_da_decisao_trg) não existir, o aviso genérico
-- cobre toda decisão; quando existir, o genérico cede a vez para a peça da
-- Mesa que a EA já avisa (um fato, um aviso).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Coluna do agrupamento e índice das não lidas ─────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS agrupados integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.notifications.agrupados IS
  'Quantos avisos da mesma rajada este aviso resume (N-01). 1 = aviso único.';

CREATE INDEX IF NOT EXISTS notifications_nao_lidas_idx
  ON public.notifications (user_id)
  WHERE NOT read;

-- ─── 2) A trava na fonte: duplicata, robô e rajada ───────────────────────
-- Continua descartando o aviso idêntico em 10 minutos (usuário, tipo,
-- mensagem e link). Acrescenta:
--   · robô (e-mail n8n@) ou perfil apagado: o aviso nasce lido. Não some
--     (a API do N8N ainda lista), só não acumula como pendência;
--   · rajada do portal: "Nova entrega disponível" e "Nova entrega aguardando
--     sua aprovação" para a mesma pessoa, mesmo link, ainda não lido, em 15
--     minutos, viram UM aviso com o total ("12 novas entregas disponíveis");
--   · rajada dos agentes: relatos do mesmo trabalho (operator) e sugestões de
--     responsável (responsavel_sugerido) não lidos em 30 minutos viram um
--     aviso com o último passo e o total.
CREATE OR REPLACE FUNCTION public.notifications_sem_duplicata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _familia text;
  _item text;
  _grupo uuid;
  _total integer;
begin
  if exists (
    select 1
    from public.notifications n
    where n.user_id = new.user_id
      and n.notification_type is not distinct from new.notification_type
      and n.message = new.message
      and coalesce(n.link, '') = coalesce(new.link, '')
      and n.created_at > now() - interval '10 minutes'
  ) then
    -- O MESMO aviso, nao um novo: descarta sem erro, para nenhum caminho
    -- de quem grava (tela, edge, trigger) quebrar por causa da trava.
    return null;
  end if;

  -- Robô e conta apagada: nasce lido (não vira pendência de ninguém).
  if exists (
    select 1 from public.profiles p
     where p.id = new.user_id
       and (p.deleted_at is not null or coalesce(p.email, '') ilike 'n8n@%')
  ) then
    new.read := true;
    return new;
  end if;

  -- Rajada: agrupa no aviso não lido mais recente da mesma família.
  --   entrega/aprovacao: portal do cliente, mesmo link, 15 min;
  --   agente: relatos do mesmo trabalho de um agente (mesmo link de
  --     vínculo e execução), 30 min. O dono continua sabendo de tudo, num
  --     aviso só por trabalho, com o último passo;
  --   sugestao: sugestões de responsável dos agentes (a pilha de 1.113 do
  --     Hermes), 30 min, com o link da mais recente.
  _familia := case
    when new.notification_type = 'delivery' and new.message like 'Nova entrega disponível: %' then 'entrega'
    when new.notification_type = 'approval' and new.message like 'Nova entrega aguardando sua aprovação: %' then 'aprovacao'
    when new.notification_type = 'operator' then 'agente'
    when new.notification_type = 'responsavel_sugerido' then 'sugestao'
    else null
  end;
  if _familia is not null then
    _item := btrim(substr(new.message, strpos(new.message, ': ') + 2));
    select n.id, n.agrupados + 1 into _grupo, _total
      from public.notifications n
     where n.user_id = new.user_id
       and n.notification_type = new.notification_type
       and not n.read
       and (_familia = 'sugestao' or coalesce(n.link, '') = coalesce(new.link, ''))
       and n.created_at > now() - case when _familia in ('agente', 'sugestao') then interval '30 minutes' else interval '15 minutes' end
       and (
         _familia in ('agente', 'sugestao')
         or (_familia = 'entrega' and (n.message like 'Nova entrega disponível: %' or n.message like '% novas entregas disponíveis. A mais recente: %'))
         or (_familia = 'aprovacao' and (n.message like 'Nova entrega aguardando sua aprovação: %' or n.message like '% entregas aguardando sua aprovação. A mais recente: %'))
       )
     order by n.created_at desc
     limit 1
     for update;
    if _grupo is not null then
      update public.notifications
         set agrupados = _total,
             message = left(case _familia
               when 'entrega' then _total::text || ' novas entregas disponíveis. A mais recente: ' || _item
               when 'aprovacao' then _total::text || ' entregas aguardando sua aprovação. A mais recente: ' || _item
               when 'sugestao' then _total::text || ' sugestões de responsável esperando você. A última: ' || new.message
               else new.message || ' (' || _total::text || ' atualizações deste trabalho)'
             end, 500),
             link = case when _familia = 'sugestao' then new.link else link end,
             created_at = now()
       where id = _grupo;
      return null;
    end if;
  end if;

  return new;
end;
$function$;

-- ─── 3) Um fato, um aviso: a decisão do cliente ──────────────────────────
-- Quem decide na casa (admin e gestor humanos) e quem cuida do cliente
-- (team_client_assignments). Nunca o robô, nunca conta apagada.
CREATE OR REPLACE FUNCTION public.avisar_equipe_do_cliente(
  _client_id uuid,
  _message text,
  _type text,
  _link text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE _n integer := 0;
BEGIN
  INSERT INTO public.notifications (user_id, message, notification_type, link)
  SELECT DISTINCT d.user_id, left(_message, 500), _type, _link
    FROM (
      SELECT ur.user_id FROM public.user_roles ur
       WHERE ur.role IN ('admin'::public.app_role, 'manager'::public.app_role)
      UNION
      SELECT a.user_id FROM public.team_client_assignments a
       WHERE _client_id IS NOT NULL AND a.client_id = _client_id
    ) AS d
    JOIN public.profiles p ON p.id = d.user_id
   WHERE p.deleted_at IS NULL
     AND COALESCE(p.email, '') NOT ILIKE 'n8n@%'
     AND public.is_staff(d.user_id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

REVOKE ALL ON FUNCTION public.avisar_equipe_do_cliente(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_equipe_do_cliente(uuid, text, text, text) TO service_role;

-- O gatilho da decisão passa a ser o ÚNICO remetente do aviso genérico:
-- reconhece o 'rejected' que decide_file_approval grava, avisa também a
-- equipe do cliente, e nunca derruba a decisão (falha vira WARNING).
-- Texto e link iguais aos da tela antiga: um painel ainda aberto com o
-- código anterior manda a cópia, e a trava de 10 minutos descarta.
CREATE OR REPLACE FUNCTION public.file_approval_avisa_equipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _cliente text;
  _arquivo text;
  _aprovou boolean;
  _mesa_cobre boolean := false;
BEGIN
  IF NEW.actor_id IS DISTINCT FROM NEW.client_id THEN RETURN NEW; END IF;
  IF NEW.to_status NOT IN ('approved', 'changes_requested', 'rejected') THEN RETURN NEW; END IF;
  _aprovou := NEW.to_status = 'approved';

  BEGIN
    -- A frente EA avisa a peça da Mesa com mais detalhe (data de publicação,
    -- lâmina citada). Quando o gatilho dela existe e a peça é dela, o aviso
    -- genérico sai de cena. to_jsonb lê a coluna nova sem depender dela.
    IF EXISTS (
      SELECT 1 FROM pg_trigger tg
       WHERE tg.tgrelid = 'public.file_approval_events'::regclass
         AND tg.tgname = 'mesa_avisos_da_decisao_trg'
         AND tg.tgenabled <> 'D'
    ) THEN
      SELECT CASE WHEN _aprovou THEN (to_jsonb(t) ->> 'agenda_sincronizada_em') IS NOT NULL ELSE true END
        INTO _mesa_cobre
        FROM public.estudio_trabalhos t
       WHERE t.client_id = NEW.client_id
         AND cardinality(t.file_ids) > 0
         AND t.file_ids[1] = NEW.file_id
       ORDER BY t.criado_em DESC
       LIMIT 1;
    END IF;
    IF COALESCE(_mesa_cobre, false) THEN RETURN NEW; END IF;

    SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name, 'Cliente') INTO _cliente FROM public.profiles p WHERE p.id = NEW.client_id;
    SELECT f.file_name INTO _arquivo FROM public.files f WHERE f.id = NEW.file_id;
    IF _aprovou THEN
      PERFORM public.avisar_equipe_do_cliente(NEW.client_id,
        'Aprovação recebida: ' || COALESCE(_cliente, 'Cliente') || ' aprovou "' || COALESCE(_arquivo, 'material') || '". Pronto para agendar na Agenda.',
        'approval', '/calendario');
    ELSE
      PERFORM public.avisar_equipe_do_cliente(NEW.client_id,
        'Ajustes solicitados: ' || COALESCE(_cliente, 'Cliente') || ' pediu mudanças em "' || COALESCE(_arquivo, 'material') || '".',
        'approval', '/aprovacoes');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'file_approval_avisa_equipe: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

-- decide_file_approval: IGUAL à versão em produção, só sem o INSERT em
-- notifications do fim ("Cliente aprovou" / "Cliente solicitou ajustes em"),
-- que era a segunda cópia do mesmo fato. O aviso sai do gatilho acima.
CREATE OR REPLACE FUNCTION public.decide_file_approval(p_file_id uuid, p_expected_version integer, p_decision text, p_feedback text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _file public.files%ROWTYPE; _actor uuid := auth.uid(); _feedback text := NULLIF(btrim(p_feedback), '');
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid client decision'; END IF;
  SELECT * INTO _file FROM public.files WHERE id = p_file_id AND parent_file_id IS NULL FOR UPDATE;
  IF NOT FOUND OR _actor IS NULL OR NOT public.has_role(_actor, 'client'::public.app_role) OR _file.client_id <> _actor THEN RAISE EXCEPTION 'file not found or client decision access denied'; END IF;
  IF p_expected_version IS NULL OR COALESCE(_file.version, 1) <> p_expected_version THEN RAISE EXCEPTION 'file version changed; refresh before deciding'; END IF;
  IF _file.agency_approval_status <> 'approved' OR _file.visibility <> 'approval' OR _file.approval_status <> 'pending' OR _file.locked_at IS NOT NULL OR _file.archived_at IS NOT NULL OR COALESCE(_file.status, 'ready') <> 'ready' THEN RAISE EXCEPTION 'file is not awaiting this client decision'; END IF;
  IF p_decision = 'rejected' AND COALESCE(length(_feedback), 0) < 10 THEN RAISE EXCEPTION 'client feedback must contain at least 10 characters'; END IF;
  UPDATE public.files SET approval_status = 'none', client_decided_by = NULL, client_decided_at = NULL, locked_at = now() WHERE parent_file_id = p_file_id;
  UPDATE public.files SET approval_status = p_decision, feedback = CASE WHEN p_decision = 'rejected' THEN _feedback ELSE NULL END, client_decided_by = _actor, client_decided_at = now(), locked_at = now() WHERE id = p_file_id;
  INSERT INTO public.file_approval_events (file_id, client_id, actor_id, event_type, from_status, to_status, feedback, metadata) VALUES (_file.id, _file.client_id, _actor, CASE WHEN p_decision = 'approved' THEN 'client_approved' ELSE 'client_rejected' END, _file.approval_status, p_decision, _feedback, jsonb_build_object('version', p_expected_version));
  IF p_decision = 'rejected' AND _file.project_id IS NOT NULL THEN
    INSERT INTO public.tasks (project_id, title, description, status, priority, assigned_to, source)
    VALUES (_file.project_id, 'Ajustar: ' || _file.file_name, 'Feedback do cliente:' || E'\n' || _feedback, 'backlog', 'high',
      CASE WHEN EXISTS (SELECT 1 FROM public.user_roles AS role_row WHERE role_row.user_id = _file.uploaded_by AND (role_row.role = 'admin'::public.app_role OR (role_row.role IN ('manager'::public.app_role, 'design'::public.app_role, 'traffic'::public.app_role) AND EXISTS (SELECT 1 FROM public.team_client_assignments AS assignment WHERE assignment.user_id = _file.uploaded_by AND assignment.client_id = _file.client_id)))) THEN _file.uploaded_by ELSE NULL END,
      'client_feedback');
  END IF;
  -- Aviso da equipe: file_approval_avisa_equipe (gatilho em file_approval_events).
  RETURN p_file_id;
END
$function$;

-- ─── 4) Quais avisos viram e-mail ────────────────────────────────────────
-- Acrescenta: post que não saiu (agendamento_atrasado, um por publicação,
-- já tem trava própria) e o teste de avisos do admin.
CREATE OR REPLACE FUNCTION public.notificacao_merece_email(_tipo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT _tipo IN ('approval', 'request', 'aprovacao_necessaria', 'central_review_pendente', 'central_review_decidida', 'central_review_enviada', 'responsavel_designado', 'agendamento_atrasado', 'teste');
$function$;

-- ─── 5) Post que não saiu: o link abre o cliente e o post ────────────────
-- IGUAL à versão em produção, com o link novo
-- /calendario?client=<cliente>&content=<post>&publicacao=<publicação>
-- (a Agenda lê client e content). A trava "um aviso por publicação" e a
-- limpeza reconhecem o formato antigo e o novo.
CREATE OR REPLACE FUNCTION public.editorial_alerta_agendamento_atrasado()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _pub record; _cliente text; _quando text; _motivo text; _avisados integer := 0; _link text;
begin
  for _pub in
    select p.id, p.client_id, p.post_id, p.platform, p.scheduled_at, p.delivery_mode, p.status,
           po.title as titulo,
           coalesce(public.editorial_file_is_publishable(
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
       and (
         coalesce(p.file_id, po.primary_file_id) is not null
         or p.scheduled_at >= now() - interval '7 days'
       )
       and not exists (
         select 1 from public.notifications n
          where n.notification_type = 'agendamento_atrasado'
            and (n.link = '/calendario?publicacao=' || p.id::text
                 or n.link like '%&publicacao=' || p.id::text))
     order by p.scheduled_at limit 200
  loop
    select coalesce(nullif(trim(pr.company_name), ''), pr.full_name)
      into _cliente from public.profiles pr where pr.id = _pub.client_id;
    _quando := to_char(_pub.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
    _motivo := case
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
        'estava aprovada e com hora marcada, mas passou da janela de 6 horas sem '
        || 'ser promovida. O painel NAO publica sozinho um post tao atrasado: '
        || 'confirme se ainda faz sentido e publique pelo painel'
      when _pub.posts_na_janela > 1 then
        'o painel achou MAIS DE UM post na conta nessa janela e nao quis chutar qual e: confirme qual deles e este e de a baixa pelo painel'
      when not _pub.arte_liberada then
        'a arte ainda nao esta aprovada dos dois lados'
      when _pub.delivery_mode <> 'automatic' then
        'esta pronta e aprovada, o painel conferiu a conta e nao achou nenhum post nessa janela: publique, ou ligue a automacao dessa conta para sair sozinho'
      else
        'esta liberada e automatica, e mesmo assim nao saiu: verifique a conexao da conta'
    end;
    _link := '/calendario?client=' || _pub.client_id::text
      || coalesce('&content=' || _pub.post_id::text, '')
      || '&publicacao=' || _pub.id::text;
    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id,
           format('Agendamento de %s passou da hora (%s) e o painel nao encontrou publicacao: %s',
                  coalesce(_cliente, 'cliente'), _quando, _motivo),
           'agendamento_atrasado', _link
      from public.user_roles ur where ur.role = 'admin'::public.app_role;
    _avisados := _avisados + 1;
  end loop;
  return jsonb_build_object('avisados', _avisados, 'em', now());
end;
$function$;

CREATE OR REPLACE FUNCTION public.editorial_limpar_alertas_resolvidos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _apagados integer;
begin
  with resolvidos as (
    delete from public.notifications n
     where n.notification_type = 'agendamento_atrasado'
       and exists (
         select 1 from public.editorial_publications p
          where p.id::text = coalesce(substring(n.link from 'publicacao=([0-9a-fA-F-]{36})'), '')
            -- RESOLVIDO e publicado ou cancelado. `planned` nao e
            -- resolucao: e a publicacao ainda parada, e apagar o aviso
            -- dela fazia o alarme renascer no ciclo seguinte.
            and p.status in ('published', 'cancelled')
       )
    returning 1
  )
  select count(*) into _apagados from resolvidos;
  return coalesce(_apagados, 0);
end;
$function$;

-- ─── 6) Teste de ponta a ponta, só para admin, só para ele mesmo ─────────
-- Dispara um aviso tipo 'teste' para quem chamou (nunca para cliente):
-- sino (linha em notifications), e-mail (gatilho notificacao_por_email ->
-- send-transactional-email -> fila -> Resend) e aviso do navegador (a tela
-- mostra quando chega). O resultado de cada etapa sai em
-- notificacoes_teste_resultado.
CREATE OR REPLACE FUNCTION public.notificacoes_teste_disparar()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _email text;
  _na_hora integer;
  _segredos integer;
  _req bigint;
  _motivo text;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'apenas_admin: o teste de avisos é só para administrador';
  END IF;

  SELECT p.email INTO _email FROM public.profiles p WHERE p.id = _uid AND p.deleted_at IS NULL;
  SELECT count(*) INTO _na_hora FROM public.notification_email_log l
   WHERE l.user_id = _uid AND l.created_at > now() - interval '1 hour';
  SELECT count(*) INTO _segredos FROM vault.decrypted_secrets
   WHERE name IN ('cron_secret', 'email_queue_service_role_key');

  INSERT INTO public.notifications (user_id, message, notification_type, link)
  VALUES (_uid,
          'Teste de avisos: chegou no sino. Confira também o e-mail e o aviso do navegador. ('
            || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') || ')',
          'teste', '/config')
  RETURNING id INTO _id;

  IF _id IS NOT NULL THEN
    SELECT l.request_id INTO _req FROM public.notification_email_log l WHERE l.notification_id = _id;
  END IF;

  _motivo := CASE
    WHEN _id IS NULL THEN 'o aviso foi descartado pela trava de duplicata; tente de novo em 1 minuto'
    WHEN _req IS NOT NULL THEN NULL
    WHEN _email IS NULL OR _email = '' THEN 'seu perfil está sem e-mail'
    WHEN _email ILIKE 'n8n@%' THEN 'conta de robô não recebe e-mail'
    WHEN _na_hora >= 20 THEN 'freio de 20 e-mails por hora atingido; tente mais tarde'
    WHEN _segredos < 2 THEN 'faltam os segredos cron_secret ou email_queue_service_role_key no cofre'
    ELSE 'o gatilho de e-mail não registrou o pedido (confira notificacao_por_email_trg)'
  END;

  RETURN jsonb_build_object(
    'notification_id', _id,
    'criado', _id IS NOT NULL,
    'email_pedido', _req IS NOT NULL,
    'request_id', _req,
    'email_destino', CASE WHEN _email IS NULL THEN NULL
      ELSE left(_email, 2) || '***' || substr(_email, strpos(_email, '@')) END,
    'motivo_sem_email', _motivo,
    'em', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificacoes_teste_resultado(_notification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _lida boolean;
  _criado timestamptz;
  _req bigint;
  _status integer;
  _erro_http text;
  _timeout boolean;
  _resposta text;
  _msgid text;
  _envio text;
  _envio_erro text;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'apenas_admin: o teste de avisos é só para administrador';
  END IF;

  SELECT n.read, n.created_at INTO _lida, _criado
    FROM public.notifications n
   WHERE n.id = _notification_id AND n.user_id = _uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sino', jsonb_build_object('criado', false));
  END IF;

  SELECT l.request_id INTO _req FROM public.notification_email_log l WHERE l.notification_id = _notification_id;
  IF _req IS NOT NULL THEN
    SELECT r.status_code, r.error_msg, r.timed_out, left(r.content, 300)
      INTO _status, _erro_http, _timeout, _resposta
      FROM net._http_response r WHERE r.id = _req;
  END IF;

  -- Mesmo id que send-transactional-email calcula da idempotencyKey.
  _msgid := encode(extensions.digest('idempotency:notificacao-' || _notification_id::text, 'sha256'), 'hex');
  SELECT s.status, s.error_message INTO _envio, _envio_erro
    FROM public.email_send_log s
   WHERE s.message_id = _msgid
   ORDER BY CASE s.status WHEN 'sent' THEN 0 WHEN 'dlq' THEN 1 WHEN 'failed' THEN 2 WHEN 'suppressed' THEN 3 ELSE 4 END,
            s.created_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'sino', jsonb_build_object('criado', true, 'lida', _lida, 'criado_em', _criado),
    'email', jsonb_build_object(
      'pedido', _req IS NOT NULL,
      'request_id', _req,
      'http_status', _status,
      'http_erro', COALESCE(_erro_http, CASE WHEN _timeout THEN 'tempo esgotado' END),
      'http_resposta', CASE WHEN _status IS NOT NULL AND _status >= 300 THEN _resposta END,
      'envio_status', _envio,
      'envio_erro', _envio_erro
    ),
    'em', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.notificacoes_teste_disparar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notificacoes_teste_resultado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notificacoes_teste_disparar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notificacoes_teste_resultado(uuid) TO authenticated, service_role;

-- ─── Conferência (só leitura, depois de aplicar) ─────────────────────────
-- select position('agrupados' in pg_get_functiondef('public.notifications_sem_duplicata()'::regprocedure)) > 0 as trava_ok,
--        position('rejected' in pg_get_functiondef('public.file_approval_avisa_equipe()'::regprocedure)) > 0 as gatilho_ok,
--        position('INSERT INTO public.notifications' in pg_get_functiondef('public.decide_file_approval(uuid,integer,text,text)'::regprocedure)) = 0 as decisao_sem_copia,
--        public.notificacao_merece_email('agendamento_atrasado') and public.notificacao_merece_email('teste') as email_ok,
--        to_regprocedure('public.notificacoes_teste_disparar()') is not null as teste_ok;
-- select count(*) from pg_indexes where indexname = 'notifications_nao_lidas_idx';
--
-- ─── Voltar atrás (se precisar) ──────────────────────────────────────────
-- As funções antigas estão no banco de hoje (pg_get_functiondef) e em
-- supabase/migrations (20260918120000_avisos_chegam_de_verdade.sql para o
-- gatilho e a trava; 20260727132145_secure_file_approval_double_gate.sql e
-- sucessoras para decide_file_approval). A coluna agrupados e o índice
-- podem ficar: não mudam nada para quem não os usa.
