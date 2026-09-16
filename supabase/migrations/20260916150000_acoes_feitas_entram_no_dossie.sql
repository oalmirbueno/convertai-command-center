-- Acao feita e acao de verdade, nao caixinha de checklist.
--
-- Regra do dono (2026-09-16): cada acao concluida persiste no historico do
-- cliente e entra como complemento e atualizacao do dossie. E o ritual
-- enviado (pelo painel ou pelo Hermes) marca o Ciclo sozinho.
--
-- 1) tasks: ao virar 'done', vira registro em project_memory (kind 'acao')
--    e o dossie geral recebe a secao automatica de avancos na hora.
-- 2) A secao de avancos passa a listar tambem as acoes registradas no
--    diario (esteira, ciclo, marcos) e nao so tarefas/publicacoes.
-- 3) operator_approvals (origin central) com executed_at: marca o ritual
--    da semana em cycle_rituals (source central) e grava o texto enviado
--    no diario do cliente (kind 'ritual', visivel ao cliente).

-- 1) Tarefa concluida = acao registrada + dossie atualizado ----------------
CREATE OR REPLACE FUNCTION public.tasks_acao_feita_no_dossie()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _client uuid;
  _projeto text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'done' OR OLD.status IS NOT DISTINCT FROM 'done' THEN
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT p.client_id, p.name INTO _client, _projeto FROM public.projects p WHERE p.id = NEW.project_id;
  IF _client IS NULL THEN RETURN NEW; END IF;

  -- Uma vez por conclusao: se a mesma tarefa ja foi registrada como feita
  -- nas ultimas 24h (reabriu e fechou de novo), nao duplica.
  IF EXISTS (
    SELECT 1 FROM public.project_memory m
     WHERE m.client_id = _client AND m.kind = 'acao'
       AND m.metadata->>'task_id' = NEW.id::text
       AND m.created_at > now() - interval '24 hours'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.project_memory (client_id, project_id, kind, source, title, content, tags, metadata, created_by)
  VALUES (
    _client, NEW.project_id, 'acao', 'ciclo',
    left('Feito · ' || COALESCE(NULLIF(btrim(NEW.title), ''), 'tarefa'), 200),
    left(concat_ws(' · ',
      'Tarefa concluída' || CASE WHEN _projeto IS NOT NULL THEN ' em ' || _projeto ELSE '' END,
      NULLIF(btrim(COALESCE(NEW.description, '')), '')
    ), 8000),
    ARRAY['acao', 'tarefa'],
    jsonb_build_object('task_id', NEW.id, 'auto', true, 'client_visible', false, 'source_task', NEW.source, 'assigned_to', NEW.assigned_to),
    COALESCE(auth.uid(), NEW.assigned_to)
  );

  -- O dossie recebe a secao automatica na hora; falha aqui nao pode segurar
  -- a conclusao da tarefa.
  BEGIN
    PERFORM public.dossie_registrar_avancos(_client);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'dossie_registrar_avancos falhou para %: %', _client, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_acao_feita_no_dossie_trg ON public.tasks;
CREATE TRIGGER tasks_acao_feita_no_dossie_trg
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_acao_feita_no_dossie();

-- 2) A secao automatica de avancos le tambem o diario -----------------------
CREATE OR REPLACE FUNCTION public.dossie_avancos_texto(_client_id uuid, _dias integer DEFAULT 7)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  with proj as (
    select id, name from public.projects where client_id = _client_id and deleted_at is null
  ),
  tarefas as (
    select t.title from public.tasks t
    join proj on proj.id = t.project_id
    where t.status = 'done' and t.deleted_at is null
      and t.updated_at >= now() - make_interval(days => _dias)
    order by t.updated_at desc limit 12
  ),
  pubs as (
    select coalesce(p.title, 'publicação') as title, e.published_at, e.platform
    from public.editorial_publications e
    left join public.editorial_posts p on p.id = e.post_id
    where e.client_id = _client_id and e.status = 'published'
      and e.published_at >= now() - make_interval(days => _dias)
    order by e.published_at desc limit 12
  ),
  aprovadas as (
    select distinct f.file_name
    from public.file_approval_events ev
    join public.files f on f.id = ev.file_id
    where ev.client_id = _client_id and ev.to_status = 'approved'
      and ev.created_at >= now() - make_interval(days => _dias)
    limit 12
  ),
  marcos as (
    select m.title, m.updated_at from public.milestones m
    join proj on proj.id = m.project_id
    where m.status = 'completed' and m.deleted_at is null
      and m.updated_at >= now() - make_interval(days => _dias)
    order by m.updated_at desc limit 8
  ),
  -- Acoes registradas no diario pela esteira e pelo ciclo (feito de verdade,
  -- com nome), fora as tarefas que ja entram acima.
  acoes as (
    -- O mesmo item pode ter entrado como marco e como ciclo; conta uma vez.
    select regexp_replace(m.title, '^(Feito|Feita|Já tem|Ja tem)\s*·\s*', '') as title, max(m.created_at) as created_at
    from public.project_memory m
    where m.client_id = _client_id
      and m.created_at >= now() - make_interval(days => _dias)
      and (
        (m.kind = 'ciclo' and m.metadata->>'acao' = 'done')
        or m.kind = 'marco'
        or (m.kind = 'acao' and m.metadata->>'task_id' is null)
      )
      and m.title is not null
    group by 1
    order by 2 desc limit 12
  ),
  rituais as (
    select m.title, m.created_at from public.project_memory m
    where m.client_id = _client_id and m.kind = 'ritual'
      and m.created_at >= now() - make_interval(days => _dias)
    order by m.created_at desc limit 6
  ),
  agenda as (
    select count(*) as n from public.editorial_publications e
    where e.client_id = _client_id and e.status = 'scheduled' and e.scheduled_at > now()
  )
  select concat_ws(E'\n',
    '## Avanços recentes (automático, ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ')',
    'Registro gerado pelo painel a partir do que aconteceu nos últimos ' || _dias || ' dias. Não edite esta seção: ela é reescrita.',
    case when exists (select 1 from tarefas) then
      E'\n**Tarefas concluídas:** ' || (select string_agg(title, '; ') from tarefas) end,
    case when exists (select 1 from acoes) then
      E'\n**Ações feitas na esteira e no ciclo:** ' || (select string_agg(title, '; ' order by created_at desc) from acoes) end,
    case when exists (select 1 from pubs) then
      E'\n**Publicações no ar:** ' || (select string_agg(title || ' (' || to_char(published_at at time zone 'America/Sao_Paulo', 'DD/MM') || ')', '; ') from pubs) end,
    case when exists (select 1 from aprovadas) then
      E'\n**Materiais aprovados pelo cliente:** ' || (select string_agg(file_name, '; ') from aprovadas) end,
    case when exists (select 1 from marcos) then
      E'\n**Marcos concluídos:** ' || (select string_agg(title, '; ') from marcos) end,
    case when exists (select 1 from rituais) then
      E'\n**Mensagens enviadas ao cliente:** ' || (select string_agg(title || ' (' || to_char(created_at at time zone 'America/Sao_Paulo', 'DD/MM') || ')', '; ') from rituais) end,
    E'\n**Agenda à frente:** ' || (select n from agenda) || ' publicação(ões) agendada(s).'
  );
$$;

-- 3) Ritual enviado (painel ou Hermes) marca o Ciclo e entra no diario -----
CREATE OR REPLACE FUNCTION public.central_review_enviado_marca_ciclo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _ritual text;
  _chave text;
  _semana date;
  _texto text;
  _passo text;
  _titulo text;
BEGIN
  IF NEW.origin IS DISTINCT FROM 'central' OR NEW.executed_at IS NULL OR OLD.executed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  _ritual := NEW.payload->'report'->'metrics'->>'ritual_type';
  _chave := CASE _ritual WHEN 'rota_semana' THEN 'segunda' WHEN 'meio_semana' THEN 'quarta' WHEN 'prova_movimento' THEN 'sexta' ELSE NULL END;
  _semana := date_trunc('week', (now() at time zone 'America/Sao_Paulo'))::date;
  IF _chave IS NOT NULL THEN
    INSERT INTO public.cycle_rituals (client_id, week_start, ritual_key, source, done_by, done_at)
    VALUES (NEW.client_id, _semana, _chave, 'central', auth.uid(), now())
    ON CONFLICT (client_id, week_start, ritual_key) DO UPDATE SET source = 'central', done_at = now();
  END IF;

  _texto := COALESCE(NEW.payload->'report'->>'summary', '');
  _passo := COALESCE(NEW.payload->'report'->>'next_steps', '');
  _titulo := COALESCE(NULLIF(NEW.payload->'report'->>'title', ''), NEW.o_que, 'Mensagem enviada');
  IF length(btrim(_texto)) > 0 THEN
    INSERT INTO public.project_memory (client_id, project_id, kind, source, title, content, tags, metadata, created_by)
    VALUES (
      NEW.client_id, NULLIF(NEW.payload->'report'->>'project_id', '')::uuid, 'ritual', 'central',
      left(_titulo, 200),
      left(concat_ws(E'\n\n', _texto, CASE WHEN length(btrim(_passo)) > 0 THEN 'Próximo passo combinado: ' || _passo ELSE NULL END), 8000),
      ARRAY[COALESCE(_ritual, 'ritual')],
      jsonb_build_object('report_id', NEW.report_id, 'ritual_type', _ritual, 'approval_id', NEW.id, 'client_visible', true,
                         'sent_via', COALESCE(current_setting('app.agent_actor', true), 'painel'), 'evidence', NEW.execution_evidence),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS central_review_enviado_marca_ciclo_trg ON public.operator_approvals;
CREATE TRIGGER central_review_enviado_marca_ciclo_trg
  AFTER UPDATE OF executed_at ON public.operator_approvals
  FOR EACH ROW EXECUTE FUNCTION public.central_review_enviado_marca_ciclo();
