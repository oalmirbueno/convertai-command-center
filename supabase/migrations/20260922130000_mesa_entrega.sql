-- ═══════════════════════════════════════════════════════════════════════
-- MESA DO CLIENTE, ETAPA 3: ENTREGA.
--
-- O que o dono pediu: a arte sai do Estúdio, vai para a aprovação do
-- cliente pelo caminho que já existe, e quando o cliente aprova o post entra
-- agendado sozinho na Agenda, de segunda a sexta, no horário do cliente.
--
-- Nada do que existe muda. A Mesa só chama o que a tela de Arquivos e a
-- tela da Agenda já chamam:
--   · envio: admin_release_file_now (admin e gestor) ou
--     request_file_agency_review (design, que passa pela revisão da agência);
--   · agendamento: save_editorial_post, pelo caminho aprovado, com o mesmo
--     payload que a Agenda monta em buildEditorialSchedulePayload.
--
-- POR QUE O POST SÓ NASCE DEPOIS DA APROVAÇÃO: o gatilho
-- editorial_record_file_decision recusa a decisão do cliente quando existe
-- post ligado ao arquivo sem selo de aprovação válido. Criar o post antes
-- arriscaria travar o botão "Aprovar" do cliente. Depois da aprovação o
-- arquivo já é publicável e o caminho aprovado cria o post com selo.
--
-- REGRA DA CASA: gatilho só anota e enfileira. O trabalho pesado (montar o
-- post, agendar) roda no cron de um minuto, e qualquer falha no gatilho vira
-- aviso, nunca erro: a aprovação do cliente não pode cair por causa da Mesa.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Ajustes de publicação e plano por cliente ────────────────────────

CREATE TABLE public.mesa_cliente_config (
  client_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  hora_publicacao time NOT NULL DEFAULT '09:00',
  fuso text NOT NULL DEFAULT 'America/Sao_Paulo',
  agendar_ao_aprovar boolean NOT NULL DEFAULT true,
  -- Plano: quantos posts o cliente contratou por mês e quantas lâminas em
  -- média cada um tem. Serve para a previsão de custo e para saber quanto
  -- recarregar. Nulo = ainda não definido.
  posts_por_mes integer CHECK (posts_por_mes IS NULL OR posts_por_mes BETWEEN 1 AND 200),
  laminas_por_post integer CHECK (laminas_por_post IS NULL OR laminas_por_post BETWEEN 1 AND 20),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

ALTER TABLE public.mesa_cliente_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mesa_cliente_config FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY mesa_cliente_config_equipe_le
ON public.mesa_cliente_config
FOR SELECT TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND public.can_access_client(client_id)
);

GRANT SELECT ON public.mesa_cliente_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mesa_cliente_config TO service_role;

-- ─── 2) Estado da entrega no trabalho do estúdio ─────────────────────────

ALTER TABLE public.estudio_trabalhos
  ADD COLUMN entrega_status text
    CHECK (entrega_status IS NULL OR entrega_status IN (
      'aguardando_agencia', 'aguardando_cliente', 'reprovado',
      'aprovado', 'agendado', 'precisa_de_atencao'
    )),
  ADD COLUMN entrega_aviso text,
  ADD COLUMN entrega_rodada integer NOT NULL DEFAULT 1 CHECK (entrega_rodada >= 1),
  ADD COLUMN enviado_em timestamptz,
  ADD COLUMN enviado_por uuid,
  ADD COLUMN aprovado_em timestamptz,
  ADD COLUMN post_id uuid,
  ADD COLUMN agendado_para timestamptz;

-- O gatilho de aprovação acha o trabalho pelo arquivo principal da entrega.
CREATE INDEX estudio_trabalhos_arquivo_principal_idx
  ON public.estudio_trabalhos ((file_ids[1]))
  WHERE cardinality(file_ids) > 0;

-- ─── 3) Fila de agendamento ──────────────────────────────────────────────

CREATE TABLE public.mesa_agendamento_fila (
  trabalho_id uuid PRIMARY KEY REFERENCES public.estudio_trabalhos(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  tentativas integer NOT NULL DEFAULT 0,
  processado_em timestamptz,
  erro text
);

CREATE INDEX mesa_agendamento_fila_pendentes_idx
  ON public.mesa_agendamento_fila (criado_em)
  WHERE processado_em IS NULL;

ALTER TABLE public.mesa_agendamento_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mesa_agendamento_fila FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY mesa_agendamento_fila_equipe_le
ON public.mesa_agendamento_fila
FOR SELECT TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND public.can_access_client(client_id)
);

GRANT SELECT ON public.mesa_agendamento_fila TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mesa_agendamento_fila TO service_role;

-- ─── 4a) UUID estável ────────────────────────────────────────────────────
--
-- As chaves de idempotência da Agenda precisam ter a forma de um UUID de
-- verdade (versão 1 a 8, variante 8, 9, a ou b): a captura do snapshot de
-- entrega procura a publicação por essa forma. md5(...)::uuid não garante
-- isso, então a Mesa monta um UUID versão 4 a partir do md5 da semente.
CREATE FUNCTION public.mesa_uuid_estavel(_semente text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT (
    substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-'
    || substr('89ab', (get_byte(decode(substr(h, 17, 2), 'hex'), 0) % 4) + 1, 1)
    || substr(h, 18, 3) || '-' || substr(h, 21, 12)
  )::uuid
  FROM (SELECT md5(_semente) AS h) AS x;
$$;

REVOKE ALL ON FUNCTION public.mesa_uuid_estavel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_uuid_estavel(text) TO authenticated, service_role;

-- ─── 4b) Próximo horário útil ────────────────────────────────────────────
--
-- O dia do item quando ainda dá tempo; senão o próximo dia útil. Sábado e
-- domingo pulam para segunda. Margem de 15 minutos para o agendamento não
-- nascer no passado.
CREATE FUNCTION public.mesa_proximo_horario_util(
  _dia date,
  _hora time,
  _fuso text,
  _agora timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $$
DECLARE
  _d date := greatest(COALESCE(_dia, (_agora AT TIME ZONE _fuso)::date), (_agora AT TIME ZONE _fuso)::date);
  _quando timestamptz;
BEGIN
  FOR _i IN 1..21 LOOP
    _quando := (_d + _hora) AT TIME ZONE _fuso;
    IF extract(isodow FROM _d) < 6 AND _quando >= _agora + interval '15 minutes' THEN
      RETURN _quando;
    END IF;
    _d := _d + 1;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_proximo_horario_util(date, time, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_proximo_horario_util(date, time, text, timestamptz) TO authenticated, service_role;

-- ─── 5) Gatilho: a Mesa acompanha a aprovação ────────────────────────────

CREATE FUNCTION public.mesa_entrega_acompanha_aprovacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _t record;
  _titulo text;
  _agendar boolean;
BEGIN
  IF NEW.event_type NOT IN (
    'agency_review_requested', 'released_for_approval', 'agency_rejected',
    'client_approved', 'client_approved_offline', 'client_rejected'
  ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT t.id, t.client_id, t.task_id
      INTO _t
      FROM public.estudio_trabalhos t
     WHERE t.client_id = NEW.client_id
       AND cardinality(t.file_ids) > 0
       AND t.file_ids[1] = NEW.file_id
     ORDER BY t.criado_em DESC
     LIMIT 1;
    IF _t.id IS NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.event_type = 'agency_review_requested' THEN
      UPDATE public.estudio_trabalhos
         SET entrega_status = 'aguardando_agencia', entrega_aviso = NULL
       WHERE id = _t.id;

    ELSIF NEW.event_type = 'released_for_approval' THEN
      UPDATE public.estudio_trabalhos
         SET entrega_status = 'aguardando_cliente', entrega_aviso = NULL
       WHERE id = _t.id;

    ELSIF NEW.event_type IN ('agency_rejected', 'client_rejected') THEN
      -- Volta para o Estúdio: o trabalho reabre para ajuste e a próxima
      -- entrega vira arquivo novo (rodada seguinte). O pedido de ajuste vai
      -- para a memória do diretor de arte deste cliente.
      UPDATE public.estudio_trabalhos
         SET entrega_status = 'reprovado',
             entrega_aviso = left(NULLIF(btrim(COALESCE(NEW.feedback, '')), ''), 1000),
             status = 'pronto',
             entrega_rodada = entrega_rodada + 1
       WHERE id = _t.id;

      IF NULLIF(btrim(COALESCE(NEW.feedback, '')), '') IS NOT NULL THEN
        SELECT title INTO _titulo FROM public.tasks WHERE id = _t.task_id;
        INSERT INTO public.agente_memoria (client_id, agente, tipo, texto, origem, referencia_id)
        VALUES (
          _t.client_id,
          'diretor_arte',
          'evitar',
          left(
            CASE WHEN NEW.event_type = 'client_rejected' THEN 'O cliente pediu ajuste' ELSE 'A agência pediu ajuste' END
            || COALESCE(' em "' || _titulo || '"', '') || ': ' || btrim(NEW.feedback),
            1500
          ),
          'aprovacao',
          _t.id
        );
      END IF;

    ELSE
      -- Aprovado (no painel ou registrado pela equipe como aprovação fora dele).
      UPDATE public.estudio_trabalhos
         SET entrega_status = 'aprovado', aprovado_em = NEW.created_at, entrega_aviso = NULL
       WHERE id = _t.id;

      SELECT c.agendar_ao_aprovar INTO _agendar
        FROM public.mesa_cliente_config c
       WHERE c.client_id = _t.client_id;

      IF COALESCE(_agendar, true) THEN
        INSERT INTO public.mesa_agendamento_fila (trabalho_id, client_id, file_id)
        VALUES (_t.id, _t.client_id, NEW.file_id)
        ON CONFLICT (trabalho_id) DO UPDATE
          SET file_id = EXCLUDED.file_id,
              criado_em = now(),
              tentativas = 0,
              processado_em = NULL,
              erro = NULL;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- A decisão do cliente vale mais que o acompanhamento da Mesa.
    RAISE WARNING 'mesa_entrega_acompanha_aprovacao: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_entrega_acompanha_aprovacao() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER mesa_entrega_acompanha_aprovacao_trg
AFTER INSERT ON public.file_approval_events
FOR EACH ROW EXECUTE FUNCTION public.mesa_entrega_acompanha_aprovacao();

-- ─── 6) Agendador (cron de um minuto) ────────────────────────────────────

CREATE FUNCTION public.mesa_agendar_aprovados()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _f record;
  _t record;
  _task record;
  _root record;
  _conta record;
  _hora time;
  _fuso text;
  _admin uuid;
  _ator uuid;
  _quando timestamptz;
  _tipo text;
  _modo text;
  _payload jsonb;
  _res jsonb;
  _post uuid;
  _atencao text;
  _agendados integer := 0;
  _precisam integer := 0;
  _falhas jsonb := '[]'::jsonb;
BEGIN
  SELECT user_id INTO _admin
    FROM public.user_roles
   WHERE role = 'admin'::public.app_role
   ORDER BY user_id
   LIMIT 1;
  IF _admin IS NULL THEN
    RETURN jsonb_build_object('agendados', 0, 'erro', 'nenhum admin cadastrado');
  END IF;

  FOR _f IN
    SELECT *
      FROM public.mesa_agendamento_fila
     WHERE processado_em IS NULL
       AND tentativas < 5
     ORDER BY criado_em
     LIMIT 20
     FOR UPDATE SKIP LOCKED
  LOOP
    _atencao := NULL;
    _post := NULL;
    BEGIN
      SELECT * INTO _t FROM public.estudio_trabalhos WHERE id = _f.trabalho_id;
      SELECT id, project_id, due_date, title INTO _task
        FROM public.tasks
       WHERE id = _t.task_id AND deleted_at IS NULL;
      SELECT id, file_name, caption, description INTO _root
        FROM public.files
       WHERE id = _f.file_id;

      IF _task.id IS NULL THEN
        _atencao := 'O item da agenda foi apagado. A arte aprovada está em Arquivos.';
      ELSIF _t.file_ids[1] IS DISTINCT FROM _f.file_id THEN
        _atencao := 'A arte aprovada não é a entrega atual deste trabalho. Confira em Arquivos antes de agendar.';
      END IF;

      -- Alguém já agendou esta arte pela Agenda: só sincroniza.
      IF _atencao IS NULL THEN
        SELECT p.id INTO _post
          FROM public.editorial_posts p
         WHERE p.primary_file_id = _f.file_id AND p.archived_at IS NULL
         LIMIT 1;
      END IF;

      IF _atencao IS NULL AND _post IS NULL THEN
        IF public.editorial_current_post_id_for_task(_task.id) IS NOT NULL THEN
          _atencao := 'O item já tem um post na Agenda. Ligue a arte aprovada por lá.';
        END IF;
      END IF;

      IF _atencao IS NULL AND _post IS NULL THEN
        SELECT ea.id,
               (c.connection_status = 'connected' AND COALESCE(c.automation_enabled, false)) AS automatica
          INTO _conta
          FROM public.project_external_accounts pea
          JOIN public.external_accounts ea ON ea.id = pea.external_account_id
          LEFT JOIN public.external_account_connections c ON c.external_account_id = ea.id
         WHERE pea.project_id = _task.project_id
           AND ea.client_id = _t.client_id
           AND ea.platform = 'instagram'
           AND ea.status = 'active'
         ORDER BY (c.connection_status = 'connected') DESC NULLS LAST, ea.created_at
         LIMIT 1;
        IF _conta.id IS NULL THEN
          _atencao := 'O projeto não tem conta do Instagram ligada. Ligue a conta na Agenda e agende por lá.';
        END IF;
      END IF;

      IF _atencao IS NULL AND _post IS NULL THEN
        SELECT c.hora_publicacao, c.fuso INTO _hora, _fuso
          FROM public.mesa_cliente_config c
         WHERE c.client_id = _t.client_id;
        _hora := COALESCE(_hora, '09:00'::time);
        _fuso := COALESCE(_fuso, 'America/Sao_Paulo');
        _quando := public.mesa_proximo_horario_util(_task.due_date, _hora, _fuso);
        _tipo := CASE WHEN cardinality(_t.file_ids) > 1 THEN 'carousel' ELSE 'static' END;
        -- Automático só com conexão oficial ligada, até 10 lâminas e o
        -- sha256 de todas (as mesmas exigências da captura da Agenda).
        _modo := CASE
          WHEN _conta.automatica
            AND cardinality(_t.file_ids) BETWEEN 1 AND 10
            AND NOT EXISTS (
              SELECT 1 FROM public.files fr
               WHERE (fr.id = _f.file_id OR fr.parent_file_id = _f.file_id)
                 AND (fr.sha256 IS NULL OR lower(fr.sha256) !~ '^[0-9a-f]{64}$')
            )
            THEN 'automatic'
          ELSE 'manual'
        END;

        -- Quem enviou para aprovação assina o agendamento quando é admin;
        -- senão, o admin da casa (mesmo padrão do promotor da Agenda).
        _ator := CASE
          WHEN _t.enviado_por IS NOT NULL AND public.has_role(_t.enviado_por, 'admin'::public.app_role) THEN _t.enviado_por
          ELSE _admin
        END;
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', _ator::text, 'role', 'authenticated')::text, true);

        -- O mesmo payload que a Agenda monta (buildEditorialSchedulePayload).
        _payload := jsonb_build_object(
          'id', NULL,
          'idempotency_key', public.mesa_uuid_estavel('mesa-post:' || _f.file_id::text),
          'mutation_id', public.mesa_uuid_estavel('mesa-mutacao:' || _f.file_id::text || ':' || _f.tentativas::text),
          'client_id', _t.client_id,
          'project_id', _task.project_id,
          'primary_file_id', _f.file_id,
          'title', COALESCE(NULLIF(btrim(_task.title), ''), _root.file_name),
          'content_type', _tipo,
          'objective', NULLIF(btrim(COALESCE(_root.description, '')), ''),
          'default_caption', NULLIF(btrim(COALESCE(_root.caption, '')), ''),
          'production_status', 'ready',
          'task_id', _task.id,
          'responsible_id', NULL,
          'internal_notes', 'Agendado pela Mesa do cliente quando a arte foi aprovada.',
          'revision_of_post_id', NULL,
          'publications', jsonb_build_array(jsonb_build_object(
            'id', NULL,
            'idempotency_key', public.mesa_uuid_estavel('mesa-publicacao:' || _f.file_id::text || ':' || _conta.id::text),
            'external_account_id', _conta.id,
            'file_id', _f.file_id,
            'caption', NULLIF(btrim(COALESCE(_root.caption, '')), ''),
            'first_comment', NULL,
            'alt_text', NULL,
            'asset_file_ids', to_jsonb(_t.file_ids),
            'delivery_mode', _modo,
            'scheduled_at', to_jsonb(_quando),
            'scheduled_timezone', _fuso
          ))
        );

        _res := public.save_editorial_post(_payload, NULL);
        _post := NULLIF(_res->>'post_id', '')::uuid;

        UPDATE public.estudio_trabalhos
           SET post_id = _post,
               agendado_para = _quando,
               entrega_status = 'agendado',
               entrega_aviso = CASE WHEN _modo = 'manual'
                 THEN 'Agendado. A conta não publica sozinha: no horário, a equipe publica pela Agenda.'
                 ELSE NULL END
         WHERE id = _t.id;

        PERFORM public.avisar_equipe(
          'Mesa: "' || COALESCE(_task.title, 'post') || '" foi aprovado e entrou na Agenda para '
            || to_char(_quando AT TIME ZONE _fuso, 'DD/MM "às" HH24:MI') || '.',
          'publication',
          '/calendario'
        );
        _agendados := _agendados + 1;

      ELSIF _atencao IS NULL AND _post IS NOT NULL THEN
        UPDATE public.estudio_trabalhos
           SET post_id = _post,
               entrega_status = 'agendado',
               agendado_para = (
                 SELECT min(pub.scheduled_at) FROM public.editorial_publications pub
                  WHERE pub.post_id = _post AND pub.status IN ('planned', 'scheduled', 'published')
               ),
               entrega_aviso = 'Esta arte já estava na Agenda.'
         WHERE id = _t.id;

      ELSE
        UPDATE public.estudio_trabalhos
           SET entrega_status = 'precisa_de_atencao', entrega_aviso = _atencao
         WHERE id = _t.id;
        PERFORM public.avisar_equipe(
          'Mesa: "' || COALESCE(_task.title, 'arte aprovada') || '" foi aprovado, mas não entrou sozinho na Agenda. ' || _atencao,
          'aprovacao_necessaria',
          '/mesa?client=' || _t.client_id::text || '&aba=entrega'
        );
        _precisam := _precisam + 1;
      END IF;

      UPDATE public.mesa_agendamento_fila
         SET processado_em = now(), erro = NULL
       WHERE trabalho_id = _f.trabalho_id;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.mesa_agendamento_fila
         SET tentativas = tentativas + 1,
             erro = left(SQLERRM, 500),
             processado_em = CASE WHEN tentativas + 1 >= 5 THEN now() ELSE NULL END
       WHERE trabalho_id = _f.trabalho_id;
      IF _f.tentativas + 1 >= 5 THEN
        UPDATE public.estudio_trabalhos
           SET entrega_status = 'precisa_de_atencao',
               entrega_aviso = left('Não consegui agendar sozinho: ' || SQLERRM, 1000)
         WHERE id = _f.trabalho_id;
        PERFORM public.avisar_equipe(
          'Mesa: uma arte aprovada não entrou sozinha na Agenda depois de 5 tentativas. Agende pela Agenda.',
          'aprovacao_necessaria',
          '/mesa?client=' || _f.client_id::text || '&aba=entrega'
        );
      END IF;
      _falhas := _falhas || jsonb_build_object('trabalho_id', _f.trabalho_id, 'erro', left(SQLERRM, 300));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'agendados', _agendados,
    'precisam_de_atencao', _precisam,
    'falhas', _falhas,
    'em', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_agendar_aprovados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_agendar_aprovados() TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mesa-agendar-aprovados') THEN
    PERFORM cron.unschedule('mesa-agendar-aprovados');
  END IF;
  PERFORM cron.schedule('mesa-agendar-aprovados', '* * * * *', 'SELECT public.mesa_agendar_aprovados();');
END
$cron$;

-- ─── 7) Envio em lote para aprovação ─────────────────────────────────────

CREATE FUNCTION public.mesa_enviar_para_aprovacao(_trabalho_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _gestor boolean;
  _id uuid;
  _t record;
  _root record;
  _estado text;
  _saida jsonb := '[]'::jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
  END IF;
  IF _trabalho_ids IS NULL OR cardinality(_trabalho_ids) = 0 OR cardinality(_trabalho_ids) > 60 THEN
    RAISE EXCEPTION 'envie de 1 a 60 artes por vez' USING ERRCODE = '22023';
  END IF;
  _gestor := public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'manager'::public.app_role);

  FOREACH _id IN ARRAY _trabalho_ids LOOP
    BEGIN
      SELECT id, client_id, status, file_ids INTO _t FROM public.estudio_trabalhos WHERE id = _id;
      IF _t.id IS NULL THEN
        RAISE EXCEPTION 'trabalho não encontrado';
      END IF;
      IF NOT public.can_access_client(_t.client_id) THEN
        RAISE EXCEPTION 'sem acesso a este cliente';
      END IF;
      IF _t.status <> 'entregue' OR COALESCE(cardinality(_t.file_ids), 0) = 0 THEN
        RAISE EXCEPTION 'a arte ainda não foi entregue em Arquivos';
      END IF;

      SELECT id, visibility, approval_status, agency_approval_status INTO _root
        FROM public.files
       WHERE id = _t.file_ids[1];
      IF _root.id IS NULL THEN
        RAISE EXCEPTION 'o arquivo da entrega não existe mais';
      END IF;

      IF _root.visibility <> 'internal' THEN
        -- Já foi enviado (pela Mesa ou pela tela de Arquivos): só lê o estado.
        _estado := CASE _root.approval_status
          WHEN 'approved' THEN 'aprovado'
          WHEN 'rejected' THEN 'reprovado'
          ELSE 'aguardando_cliente'
        END;
      ELSIF _gestor THEN
        PERFORM public.admin_release_file_now(_root.id, 'approval');
        _estado := 'aguardando_cliente';
      ELSIF _root.agency_approval_status = 'pending' THEN
        _estado := 'aguardando_agencia';
      ELSE
        PERFORM public.request_file_agency_review(_root.id);
        _estado := 'aguardando_agencia';
      END IF;

      UPDATE public.estudio_trabalhos
         SET entrega_status = _estado,
             entrega_aviso = NULL,
             enviado_em = now(),
             enviado_por = _uid
       WHERE id = _id;
      _saida := _saida || jsonb_build_object('trabalho_id', _id, 'ok', true, 'estado', _estado);
    EXCEPTION WHEN OTHERS THEN
      _saida := _saida || jsonb_build_object('trabalho_id', _id, 'ok', false, 'erro', left(SQLERRM, 300));
    END;
  END LOOP;

  RETURN jsonb_build_object('resultados', _saida);
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_enviar_para_aprovacao(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_enviar_para_aprovacao(uuid[]) TO authenticated;

-- ─── 8) Salvar os ajustes do cliente (admin e gestor) ────────────────────

CREATE FUNCTION public.mesa_config_salvar(
  _client_id uuid,
  _hora_publicacao time,
  _fuso text,
  _agendar_ao_aprovar boolean,
  _posts_por_mes integer,
  _laminas_por_post integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _fuso_ok text := COALESCE(NULLIF(btrim(COALESCE(_fuso, '')), ''), 'America/Sao_Paulo');
  _linha public.mesa_cliente_config;
BEGIN
  IF _uid IS NULL
    OR NOT (public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'manager'::public.app_role))
    OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'só admin ou gestor com acesso ao cliente muda estes ajustes' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = _fuso_ok) THEN
    RAISE EXCEPTION 'fuso horário inválido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.mesa_cliente_config AS c (
    client_id, hora_publicacao, fuso, agendar_ao_aprovar, posts_por_mes, laminas_por_post, atualizado_em, atualizado_por
  ) VALUES (
    _client_id, COALESCE(_hora_publicacao, '09:00'::time), _fuso_ok, COALESCE(_agendar_ao_aprovar, true),
    _posts_por_mes, _laminas_por_post, now(), _uid
  )
  ON CONFLICT (client_id) DO UPDATE SET
    hora_publicacao = EXCLUDED.hora_publicacao,
    fuso = EXCLUDED.fuso,
    agendar_ao_aprovar = EXCLUDED.agendar_ao_aprovar,
    posts_por_mes = EXCLUDED.posts_por_mes,
    laminas_por_post = EXCLUDED.laminas_por_post,
    atualizado_em = now(),
    atualizado_por = _uid
  RETURNING * INTO _linha;

  RETURN to_jsonb(_linha);
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_config_salvar(uuid, time, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_config_salvar(uuid, time, text, boolean, integer, integer) TO authenticated;

-- ─── 9) Previsão do mês pelo plano ───────────────────────────────────────
--
-- Custo por post: a média real das artes entregues nos últimos 90 dias mais
-- a parte do calendário que cabe a cada post. Sem histórico, a tabela do
-- catálogo: lâminas vezes o preço da imagem em qualidade alta, mais uma folga
-- de US$ 0,05 por post para direção, legenda e conferência.
CREATE FUNCTION public.mesa_previsao_cliente(_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cfg public.mesa_cliente_config;
  _saldo numeric;
  _media_arte numeric;
  _amostra integer;
  _gasto_calendario numeric;
  _posts_planejados integer;
  _preco_imagem numeric;
  _laminas integer;
  _custo_post numeric;
  _fonte text;
  _inicio_mes timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  _entregues_mes integer;
  _gasto_mes numeric;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _cfg FROM public.mesa_cliente_config WHERE client_id = _client_id;
  SELECT saldo_usd INTO _saldo FROM public.ia_carteiras WHERE client_id = _client_id;

  SELECT avg(custo_usd), count(*) INTO _media_arte, _amostra
    FROM public.estudio_trabalhos
   WHERE client_id = _client_id
     AND file_ids <> '{}'
     AND custo_usd > 0
     AND criado_em > now() - interval '90 days';

  SELECT COALESCE(sum(custo_usd), 0) INTO _gasto_calendario
    FROM public.ia_usos
   WHERE client_id = _client_id
     AND tarefa IN ('calendario', 'conversa')
     AND criado_em > now() - interval '90 days';
  SELECT COALESCE(sum(cardinality(task_ids)), 0) INTO _posts_planejados
    FROM public.calendario_propostas
   WHERE client_id = _client_id
     AND status = 'gravada'
     AND criado_em > now() - interval '90 days';

  SELECT NULLIF(m.preco_imagem->>'alta', '')::numeric INTO _preco_imagem
    FROM public.ia_modelos m
   WHERE m.ativo AND m.tipo = 'imagem' AND 'imagem' = ANY(m.padrao_para)
   ORDER BY m.id
   LIMIT 1;
  _laminas := COALESCE(_cfg.laminas_por_post, 4);

  IF _amostra > 0 THEN
    _custo_post := _media_arte + CASE WHEN _posts_planejados > 0 THEN _gasto_calendario / _posts_planejados ELSE 0 END;
    _fonte := 'historico';
  ELSE
    _custo_post := _laminas * COALESCE(_preco_imagem, 0.05) + 0.05;
    _fonte := 'tabela';
  END IF;

  SELECT count(*) INTO _entregues_mes
    FROM public.estudio_trabalhos
   WHERE client_id = _client_id AND file_ids <> '{}' AND atualizado_em >= _inicio_mes;
  SELECT COALESCE(sum(custo_usd), 0) INTO _gasto_mes
    FROM public.ia_usos
   WHERE client_id = _client_id AND criado_em >= _inicio_mes;

  RETURN jsonb_build_object(
    'posts_por_mes', _cfg.posts_por_mes,
    'laminas_por_post', _cfg.laminas_por_post,
    'hora_publicacao', to_char(COALESCE(_cfg.hora_publicacao, '09:00'::time), 'HH24:MI'),
    'fuso', COALESCE(_cfg.fuso, 'America/Sao_Paulo'),
    'agendar_ao_aprovar', COALESCE(_cfg.agendar_ao_aprovar, true),
    'custo_por_post_usd', round(_custo_post, 4),
    'fonte', _fonte,
    'amostra', _amostra,
    'previsao_mes_usd', CASE WHEN _cfg.posts_por_mes IS NULL THEN NULL ELSE round(_custo_post * _cfg.posts_por_mes, 2) END,
    'saldo_usd', COALESCE(_saldo, 0),
    'posts_que_o_saldo_cobre', CASE WHEN _custo_post > 0 THEN floor(greatest(COALESCE(_saldo, 0), 0) / _custo_post)::integer ELSE NULL END,
    'recarga_sugerida_usd', CASE WHEN _cfg.posts_por_mes IS NULL THEN NULL
      ELSE greatest(round(_custo_post * _cfg.posts_por_mes - COALESCE(_saldo, 0), 2), 0) END,
    'artes_entregues_no_mes', _entregues_mes,
    'gasto_mes_usd', round(_gasto_mes, 4)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_previsao_cliente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_previsao_cliente(uuid) TO authenticated;
