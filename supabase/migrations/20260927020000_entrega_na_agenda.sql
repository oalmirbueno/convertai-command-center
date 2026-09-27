-- ═══════════════════════════════════════════════════════════════════════
-- EA-01 · ENTREGA DO ESTÚDIO → AGENDA, DATA CONFIRMADA E PUBLICAÇÃO APÓS
-- APROVAÇÃO (frente EA, 27/09). NÃO APLICADO. Aplicar ANTES de publicar a
-- função estudio-arte nova.
--
-- Pedido do dono: ao entregar, a peça já entra (ou se atualiza) na Agenda;
-- ele confirma a data na Entrega; depois da aprovação do cliente publica na
-- data e hora escolhidas. Sem aprovação nunca publica.
--
-- O que já existe e continua igual (é quem publica):
--   · editorial_ciclo_publicacao (cron editorial-autopublish, todo minuto):
--     editorial_promover_planejados (planejada + data + arte aprovada →
--     agendada) e editorial_autopublish_tick (container + publish no
--     Instagram, uma fila por publicação, sem retry automático depois de
--     falhar; "Tentar de novo" = retry_autopublish).
--   · mesa_entrega_acompanha_aprovacao (gatilho) e mesa_agendar_aprovados
--     (cron mesa-agendar-aprovados, todo minuto).
--
-- O que este arquivo acrescenta (só amplia, idempotente, nenhum cron novo):
--   1) colunas no trabalho do estúdio: data proposta/confirmada, quem
--      confirmou, "publicar assim que aprovar", desfazer, aviso e histórico
--      da Agenda;
--   2) mesa_publicacao_segurada: o promotor NÃO agenda a peça da Mesa que o
--      cliente aprovou depois do horário (mais de 5 min) quando o dono não
--      marcou "publicar assim que aprovar", nem enquanto o dono desfaz o
--      agendamento (10 min). Só vale para peças da frente EA
--      (agenda_sincronizada_em preenchido): o resto da Agenda não muda;
--   3) mesa_agendar_aprovados: quando a arte aprovada já tem post na Agenda
--      (a entrega pôs), o estado sai da data confirmada: agendado, aprovado
--      sem data ("confirme a data") ou aprovado depois do horário ("escolha
--      nova data"), com aviso para a equipe. Aprovação que chega depois da
--      janela de 6 h do promotor com "publicar assim que aprovar" é agendada
--      para o minuto seguinte pelo mesmo caminho do promotor;
--   4) o gatilho enfileira a peça da frente EA mesmo com "agendar ao
--      aprovar" desligado (a fila aqui só sincroniza o estado; quem agenda é
--      a data confirmada pelo dono);
--   5) o pedido de ajuste do cliente fica na peça (ajustes_do_cliente, com a
--      lâmina citada) para a Agenda e o Estúdio;
--   6) avisos da peça (aprovado, agendado, publicado, falhou, ajuste), um por
--      evento, para o admin e a equipe do cliente, pela tabela notifications.
--
-- RLS: estudio_trabalhos já tem RLS (equipe lê pelo can_access_client; só a
-- função escreve pela chave de serviço). A função nova é SECURITY DEFINER sem
-- EXECUTE para anon/authenticated.
--
-- Os patches de função usam o texto vivo (pg_get_functiondef + replace) e
-- param com erro se o alvo não existir: ou tudo entra, ou nada entra.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Colunas da Agenda no trabalho do estúdio ─────────────────────────

ALTER TABLE public.estudio_trabalhos
  ADD COLUMN IF NOT EXISTS publicar_em timestamptz,
  ADD COLUMN IF NOT EXISTS publicar_em_confirmado_em timestamptz,
  ADD COLUMN IF NOT EXISTS publicar_em_confirmado_por uuid,
  ADD COLUMN IF NOT EXISTS publicar_em_desfeito_em timestamptz,
  ADD COLUMN IF NOT EXISTS publicar_ao_aprovar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agenda_sincronizada_em timestamptz,
  ADD COLUMN IF NOT EXISTS agenda_aviso text,
  ADD COLUMN IF NOT EXISTS agenda_historico jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estudio_trabalhos_agenda_historico_lista'
  ) THEN
    ALTER TABLE public.estudio_trabalhos
      ADD CONSTRAINT estudio_trabalhos_agenda_historico_lista
      CHECK (jsonb_typeof(agenda_historico) = 'array');
  END IF;
END
$chk$;

COMMENT ON COLUMN public.estudio_trabalhos.publicar_em IS
  'Frente EA: data e hora de publicação. Proposta na entrega (dia da peça + melhor horário); vale quando publicar_em_confirmado_em está preenchido.';
COMMENT ON COLUMN public.estudio_trabalhos.publicar_ao_aprovar IS
  'Frente EA: aprovação que chega depois do horário publica logo em seguida (true) ou pede nova data (false).';
COMMENT ON COLUMN public.estudio_trabalhos.agenda_historico IS
  'Frente EA: entregas e mudanças de data da peça na Agenda (últimas 30).';

-- O promotor procura a peça pelo post a cada minuto.
CREATE INDEX IF NOT EXISTS estudio_trabalhos_post_id_idx
  ON public.estudio_trabalhos (post_id)
  WHERE post_id IS NOT NULL;

-- ─── 2) A trava da Mesa no promotor ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mesa_publicacao_segurada(
  _post_id uuid,
  _scheduled_at timestamptz,
  _file_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.estudio_trabalhos t
     WHERE t.post_id = _post_id
       AND t.agenda_sincronizada_em IS NOT NULL
       AND (
         -- O dono está desfazendo o agendamento: não promove no meio.
         (t.publicar_em_desfeito_em IS NOT NULL
           AND t.publicar_em_confirmado_em IS NULL
           AND t.publicar_em_desfeito_em > now() - interval '10 minutes')
         OR
         -- Aprovado depois do horário, sem "publicar assim que aprovar".
         (NOT t.publicar_ao_aprovar
           AND _scheduled_at IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM public.files f
              WHERE f.id = _file_id
                AND f.client_decided_at IS NOT NULL
                AND f.client_decided_at > _scheduled_at + interval '5 minutes'
           ))
       )
  );
$$;

REVOKE ALL ON FUNCTION public.mesa_publicacao_segurada(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_publicacao_segurada(uuid, timestamptz, uuid) TO service_role;

DO $patch$
DECLARE
  _fonte text;
  _alvo text := '       and p.scheduled_at >= now() - _janela_de_atraso';
BEGIN
  SELECT pg_get_functiondef('public.editorial_promover_planejados(interval)'::regprocedure) INTO _fonte;
  IF position('mesa_publicacao_segurada' IN _fonte) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  IF position(_alvo IN _fonte) = 0 THEN
    RAISE EXCEPTION 'patch editorial_promover_planejados: alvo nao encontrado';
  END IF;
  EXECUTE replace(_fonte, _alvo, _alvo || '
       -- Mesa (frente EA): aprovada depois do horário sem "publicar assim que
       -- aprovar", ou com o dono desfazendo o agendamento: não promove.
       and not public.mesa_publicacao_segurada(p.post_id, p.scheduled_at, coalesce(p.file_id, po.primary_file_id))');
END
$patch$;

-- ─── 3) Agendador da Mesa: a data que vale é a confirmada ────────────────

DO $patch$
DECLARE
  _fonte text;
  _decl text := '  _atencao text;';
  _alvo text := '      ELSIF _atencao IS NULL AND _post IS NOT NULL THEN
        UPDATE public.estudio_trabalhos
           SET post_id = _post,
               entrega_status = ''agendado'',
               agendado_para = (
                 SELECT min(pub.scheduled_at) FROM public.editorial_publications pub
                  WHERE pub.post_id = _post AND pub.status IN (''planned'', ''scheduled'', ''published'')
               ),
               entrega_aviso = ''Esta arte já estava na Agenda.''
         WHERE id = _t.id;';
  _novo text := '      ELSIF _atencao IS NULL AND _post IS NOT NULL THEN
        -- Frente EA: a entrega já pôs o post na Agenda. A data que vale é a
        -- da publicação (o dono confirmou na Entrega ou a equipe na Agenda).
        _pub_id := NULL;
        _quando := NULL;
        SELECT pub.id, pub.version, pub.status, pub.scheduled_at,
               COALESCE(pub.scheduled_timezone, ''America/Sao_Paulo''),
               COALESCE(pub.delivery_mode, ''manual'')
          INTO _pub_id, _pub_versao, _pub_status, _quando, _pub_fuso, _pub_modo
          FROM public.editorial_publications pub
         WHERE pub.post_id = _post AND pub.status IN (''planned'', ''scheduled'', ''published'')
         ORDER BY (pub.platform = ''instagram'') DESC, pub.scheduled_at NULLS LAST
         LIMIT 1;

        -- "Publicar assim que aprovar" e aprovação além da janela de 6 h do
        -- promotor: agenda para o minuto seguinte, pelo mesmo caminho do
        -- promotor (pedido de entrega, selo de aprovação e transição oficial).
        IF _pub_id IS NOT NULL AND _pub_status = ''planned'' AND _quando IS NOT NULL
          AND _t.agenda_sincronizada_em IS NOT NULL
          AND COALESCE(_t.publicar_ao_aprovar, false)
          AND _quando < now() - interval ''6 hours'' THEN
          _quando := now() + interval ''1 minute'';
          PERFORM set_config(''request.jwt.claims'',
            json_build_object(''sub'', _admin::text, ''role'', ''authenticated'')::text, true);
          SELECT COALESCE(jsonb_agg(a.file_id::text ORDER BY a.position), ''[]''::jsonb)
            INTO _assets
            FROM social_private.editorial_publication_assets a
           WHERE a.publication_id = _pub_id;
          INSERT INTO social_private.editorial_publication_delivery_requests
            (publication_id, client_id, request_fingerprint, delivery_mode, asset_count)
          VALUES (
            _pub_id, _t.client_id,
            encode(sha256(convert_to(jsonb_build_object(
              ''delivery_mode'', _pub_modo,
              ''asset_file_ids'', _assets,
              ''scheduled_at'', _quando,
              ''scheduled_timezone'', _pub_fuso
            )::text, ''UTF8'')), ''hex''),
            _pub_modo, jsonb_array_length(_assets)
          )
          ON CONFLICT (publication_id) DO NOTHING;
          UPDATE public.editorial_post_internal
             SET approval_fingerprint = public.editorial_compute_approval_fingerprint(_post),
                 updated_by = COALESCE(auth.uid(), updated_by)
           WHERE post_id = _post AND approval_fingerprint IS NOT NULL;
          PERFORM public.transition_editorial_publication_unlocked(_pub_id, ''schedule'', _pub_versao, _quando, _pub_fuso);
        END IF;

        _segurada := _quando IS NOT NULL AND public.mesa_publicacao_segurada(_post, _quando, _f.file_id);
        UPDATE public.estudio_trabalhos
           SET post_id = _post,
               entrega_status = CASE WHEN _quando IS NOT NULL AND NOT _segurada THEN ''agendado'' ELSE ''aprovado'' END,
               agendado_para = _quando,
               entrega_aviso = CASE
                 WHEN _t.agenda_sincronizada_em IS NULL AND _quando IS NOT NULL THEN ''Esta arte já estava na Agenda.''
                 WHEN _quando IS NULL THEN ''Aprovado. Confirme a data para agendar.''
                 WHEN _segurada THEN ''Aprovado depois do horário. Escolha uma nova data.''
                 ELSE NULL
               END
         WHERE id = _t.id;
';
BEGIN
  SELECT pg_get_functiondef('public.mesa_agendar_aprovados()'::regprocedure) INTO _fonte;
  IF position('_segurada' IN _fonte) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  IF position(_decl IN _fonte) = 0 OR position(_alvo IN _fonte) = 0 THEN
    RAISE EXCEPTION 'patch mesa_agendar_aprovados: alvo nao encontrado';
  END IF;
  _fonte := replace(_fonte, _decl, _decl || '
  _pub_id uuid;
  _pub_versao integer;
  _pub_status text;
  _pub_fuso text;
  _pub_modo text;
  _assets jsonb;
  _segurada boolean;');
  EXECUTE replace(_fonte, _alvo, _novo);
END
$patch$;

-- (O aviso de "aprovado" da peça da frente EA sai do gatilho de avisos da seção 6.)

-- ─── 4) Gatilho: a peça da frente EA sempre sincroniza o estado ─────────

DO $patch$
DECLARE
  _fonte text;
  _alvo text := '      IF COALESCE(_agendar, true) THEN';
BEGIN
  SELECT pg_get_functiondef('public.mesa_entrega_acompanha_aprovacao()'::regprocedure) INTO _fonte;
  IF position('agenda_sincronizada_em' IN _fonte) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  IF position(_alvo IN _fonte) = 0 THEN
    RAISE EXCEPTION 'patch mesa_entrega_acompanha_aprovacao: alvo nao encontrado';
  END IF;
  EXECUTE replace(_fonte, _alvo,
    '      -- Frente EA: a peça que a entrega já pôs na Agenda entra na fila para o
      -- estado acompanhar a data confirmada (agendar ao aprovar é o caminho antigo).
      IF COALESCE(_agendar, true) OR EXISTS (
        SELECT 1 FROM public.estudio_trabalhos x
         WHERE x.id = _t.id AND x.agenda_sincronizada_em IS NOT NULL AND x.post_id IS NOT NULL
      ) THEN');
END
$patch$;

-- ─── 5) Pedido de ajuste do cliente ligado à peça ───────────────────────
--
-- Hoje o pedido vive em file_approval_events.feedback (portal: "Pedir
-- ajuste") e o gatilho da Mesa copia o texto para entrega_aviso e para a
-- memória do diretor de arte (continua igual). Agora cada pedido também fica
-- guardado no trabalho (lista, com a lâmina citada quando o cliente marca ou
-- escreve "lâmina 3"), para a Agenda e o Estúdio mostrarem e para marcar
-- "atendido" na reentrega (a função estudio-arte marca, com o histórico).

ALTER TABLE public.estudio_trabalhos
  ADD COLUMN IF NOT EXISTS ajustes_do_cliente jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estudio_trabalhos_ajustes_do_cliente_lista'
  ) THEN
    ALTER TABLE public.estudio_trabalhos
      ADD CONSTRAINT estudio_trabalhos_ajustes_do_cliente_lista
      CHECK (jsonb_typeof(ajustes_do_cliente) = 'array');
  END IF;
END
$chk$;

COMMENT ON COLUMN public.estudio_trabalhos.ajustes_do_cliente IS
  'Frente EA: pedidos de ajuste do cliente (evento, texto, lâmina, rodada, atendido_em/atendido_por na reentrega).';

-- Lâmina citada no pedido ("Lâmina 3: ...", "no slide 2", "a capa"). Regra fixa,
-- a mesma de laminaCitada em supabase/functions/_shared/entrega-na-agenda.ts.
CREATE OR REPLACE FUNCTION public.mesa_lamina_citada(_texto text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN _texto IS NULL THEN NULL
    WHEN lower(_texto) ~ '(l[aâ]mina|slide|card|imagem|tela|p[aá]gina)\s*(n[ºo°]?\.?\s*)?[0-9]{1,2}' THEN
      NULLIF(
        (substring(lower(_texto) from '(?:l[aâ]mina|slide|card|imagem|tela|p[aá]gina)\s*(?:n[ºo°]?\.?\s*)?([0-9]{1,2})'))::integer,
        0
      )
    WHEN lower(_texto) ~ '\mcapa\M' THEN 1
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.mesa_lamina_citada(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_lamina_citada(text) TO authenticated, service_role;

-- ─── 6) Avisos da peça: aprovado, agendado, publicado, falhou, ajuste ───
--
-- Um aviso por evento (livro-caixa mesa_avisos_da_peca: a mesma chave não
-- avisa duas vezes), para o admin e a equipe ligada ao cliente
-- (team_client_assignments), pela tabela notifications que já existe (o
-- e-mail e o aviso do navegador seguem as regras de hoje:
-- notificacao_merece_email). Nenhum tipo novo: approval (aprovado, ajuste),
-- publication (agendado, publicado) e aprovacao_necessaria (falhou).
-- Aprovado, agendado, publicado e falhou: só peças da frente EA. Ajuste: toda
-- peça do Estúdio (o link abre o Estúdio no mesmo trabalho).

CREATE TABLE IF NOT EXISTS public.mesa_avisos_da_peca (
  chave text PRIMARY KEY,
  trabalho_id uuid REFERENCES public.estudio_trabalhos(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mesa_avisos_da_peca ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mesa_avisos_da_peca FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS mesa_avisos_da_peca_equipe_le ON public.mesa_avisos_da_peca;
CREATE POLICY mesa_avisos_da_peca_equipe_le
ON public.mesa_avisos_da_peca
FOR SELECT TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.estudio_trabalhos t
     WHERE t.id = trabalho_id AND public.can_access_client(t.client_id)
  )
);

GRANT SELECT ON public.mesa_avisos_da_peca TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mesa_avisos_da_peca TO service_role;

CREATE OR REPLACE FUNCTION public.mesa_avisar_peca(
  _trabalho_id uuid,
  _chave text,
  _tipo text,
  _mensagem text,
  _link text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _client uuid;
  _n integer := 0;
BEGIN
  SELECT client_id INTO _client FROM public.estudio_trabalhos WHERE id = _trabalho_id;
  IF _client IS NULL OR NULLIF(btrim(COALESCE(_chave, '')), '') IS NULL THEN
    RETURN 0;
  END IF;
  INSERT INTO public.mesa_avisos_da_peca (chave, trabalho_id, tipo)
  VALUES (left(_chave, 300), _trabalho_id, _tipo)
  ON CONFLICT (chave) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 0; -- este evento já avisou
  END IF;
  -- Mesmos destinatários do aviso genérico (frente N, no mesmo lote): admin,
  -- gestor e a equipe do cliente; nunca o robô nem conta apagada.
  _n := public.avisar_equipe_do_cliente(_client, _mensagem, _tipo, _link);
  RETURN COALESCE(_n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_avisar_peca(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_avisar_peca(uuid, text, text, text, text) TO service_role;

-- Decisão do cliente: guarda o pedido de ajuste e avisa (aprovado ou ajuste).
-- Só anota e avisa; qualquer falha vira WARNING (a decisão do cliente vale mais).
CREATE OR REPLACE FUNCTION public.mesa_avisos_da_decisao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _t_id uuid;
  _t_client uuid;
  _t_task uuid;
  _t_post uuid;
  _t_sincronizada timestamptz;
  _t_ao_aprovar boolean;
  _t_rodada integer;
  _titulo text;
  _quando timestamptz;
  _lamina integer;
  _texto text;
  _msg text;
BEGIN
  IF NEW.event_type NOT IN ('client_approved', 'client_approved_offline', 'client_rejected') THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT t.id, t.client_id, t.task_id, t.post_id, t.agenda_sincronizada_em, t.publicar_ao_aprovar, t.entrega_rodada
      INTO _t_id, _t_client, _t_task, _t_post, _t_sincronizada, _t_ao_aprovar, _t_rodada
      FROM public.estudio_trabalhos t
     WHERE t.client_id = NEW.client_id
       AND cardinality(t.file_ids) > 0
       AND t.file_ids[1] = NEW.file_id
     ORDER BY t.criado_em DESC
     LIMIT 1;
    IF _t_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT NULLIF(btrim(title), '') INTO _titulo FROM public.tasks WHERE id = _t_task;
    _titulo := COALESCE(_titulo, 'post');

    IF NEW.event_type = 'client_rejected' THEN
      _texto := left(NULLIF(btrim(COALESCE(NEW.feedback, '')), ''), 1000);
      _lamina := public.mesa_lamina_citada(_texto);
      UPDATE public.estudio_trabalhos
         SET ajustes_do_cliente = COALESCE(ajustes_do_cliente, '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
               'evento_id', NEW.id,
               'texto', _texto,
               'lamina', _lamina,
               'pedido_em', NEW.created_at,
               'file_id', NEW.file_id,
               'post_id', _t_post,
               'rodada', COALESCE(_t_rodada, 1)
             )))
       WHERE id = _t_id
         AND NOT (COALESCE(ajustes_do_cliente, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('evento_id', NEW.id)));
      PERFORM public.mesa_avisar_peca(
        _t_id,
        'ajuste:' || NEW.id::text,
        'approval',
        'Mesa: o cliente pediu ajuste em "' || _titulo || '"'
          || COALESCE(' (lâmina ' || _lamina::text || ')', '')
          || COALESCE(': ' || left(_texto, 300), '.'),
        '/mesa?client=' || _t_client::text || '&aba=estudio&task=' || _t_task::text || '&ajuste=cliente'
          || COALESCE('&lamina=' || _lamina::text, '')
      );
    ELSIF _t_sincronizada IS NOT NULL THEN
      SELECT pub.scheduled_at INTO _quando
        FROM public.editorial_publications pub
       WHERE pub.post_id = _t_post AND pub.status IN ('planned', 'scheduled')
       ORDER BY (pub.platform = 'instagram') DESC
       LIMIT 1;
      _msg := 'Mesa: "' || _titulo || '" foi aprovado pelo cliente. ' || CASE
        WHEN _quando IS NULL THEN 'Confirme a data para agendar.'
        WHEN NOT COALESCE(_t_ao_aprovar, false) AND NEW.created_at > _quando + interval '5 minutes'
          THEN 'A aprovação chegou depois do horário: escolha uma nova data.'
        ELSE 'Publica em ' || to_char(greatest(_quando, NEW.created_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '.'
      END;
      PERFORM public.mesa_avisar_peca(
        _t_id,
        'aprovado:' || NEW.id::text,
        'approval',
        _msg,
        '/calendario?client=' || _t_client::text || COALESCE('&content=' || _t_post::text, '')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'mesa_avisos_da_decisao: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_avisos_da_decisao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mesa_avisos_da_decisao_trg ON public.file_approval_events;
CREATE TRIGGER mesa_avisos_da_decisao_trg
AFTER INSERT ON public.file_approval_events
FOR EACH ROW EXECUTE FUNCTION public.mesa_avisos_da_decisao();

-- Publicação da peça: agendado (com data e hora), publicado (com o link) e
-- falhou (com o motivo). Nunca derruba a transição da publicação.
CREATE OR REPLACE FUNCTION public.mesa_avisos_da_publicacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _t_id uuid;
  _t_task uuid;
  _titulo text;
  _motivo text;
  _link text;
BEGIN
  BEGIN
    SELECT t.id, t.task_id
      INTO _t_id, _t_task
      FROM public.estudio_trabalhos t
     WHERE t.post_id = NEW.post_id
       AND t.agenda_sincronizada_em IS NOT NULL
     ORDER BY t.atualizado_em DESC
     LIMIT 1;
    IF _t_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT NULLIF(btrim(title), '') INTO _titulo FROM public.tasks WHERE id = _t_task;
    _titulo := COALESCE(_titulo, 'post');
    _link := '/calendario?client=' || NEW.client_id::text || '&content=' || NEW.post_id::text;

    IF NEW.status = 'scheduled' AND NEW.scheduled_at IS NOT NULL THEN
      PERFORM public.mesa_avisar_peca(
        _t_id,
        'agendado:' || NEW.id::text || ':' || floor(extract(epoch FROM NEW.scheduled_at))::bigint::text,
        'publication',
        'Mesa: "' || _titulo || '" agendado para '
          || to_char(NEW.scheduled_at AT TIME ZONE COALESCE(NEW.scheduled_timezone, 'America/Sao_Paulo'), 'DD/MM "às" HH24:MI') || '.',
        _link
      );
    ELSIF NEW.status = 'published' THEN
      PERFORM public.mesa_avisar_peca(
        _t_id,
        'publicado:' || NEW.id::text,
        'publication',
        'Mesa: "' || _titulo || '" foi publicado no Instagram.',
        COALESCE(NULLIF(btrim(COALESCE(NEW.permalink, '')), ''), _link)
      );
    ELSIF NEW.status = 'failed' THEN
      SELECT failure_reason INTO _motivo FROM public.editorial_publication_internal WHERE publication_id = NEW.id;
      PERFORM public.mesa_avisar_peca(
        _t_id,
        'falhou:' || NEW.id::text || ':' || NEW.version::text,
        'aprovacao_necessaria',
        'Mesa: "' || _titulo || '" falhou ao publicar' || COALESCE(': ' || left(_motivo, 200), '.') || ' Use Tentar de novo.',
        _link
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'mesa_avisos_da_publicacao: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_avisos_da_publicacao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mesa_avisos_da_publicacao_trg ON public.editorial_publications;
CREATE TRIGGER mesa_avisos_da_publicacao_trg
AFTER UPDATE OF status ON public.editorial_publications
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('scheduled', 'published', 'failed'))
EXECUTE FUNCTION public.mesa_avisos_da_publicacao();

-- ─── Conferência (rodar depois de aplicar, só leitura) ───────────────────
-- select position('mesa_publicacao_segurada' in pg_get_functiondef('public.editorial_promover_planejados(interval)'::regprocedure)) > 0 as promotor_ok,
--        position('_segurada' in pg_get_functiondef('public.mesa_agendar_aprovados()'::regprocedure)) > 0 as agendador_ok,
--        position('agenda_sincronizada_em' in pg_get_functiondef('public.mesa_entrega_acompanha_aprovacao()'::regprocedure)) > 0 as gatilho_ok;
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'estudio_trabalhos'
--    and column_name like any (array['publicar_%', 'agenda_%']);
--
-- ─── Crons ───────────────────────────────────────────────────────────────
-- Nenhum cron novo: a publicação é a do ciclo que já existe
-- (editorial-autopublish e mesa-agendar-aprovados, ambos ligados hoje).
-- A mudança só vale para peças entregues pela função nova
-- (agenda_sincronizada_em preenchido): até publicar a função, nada muda.
-- Para desligar só a parte nova sem mexer no resto:
--   update public.estudio_trabalhos set agenda_sincronizada_em = null where agenda_sincronizada_em is not null;
--   (as peças voltam ao caminho antigo de agendar ao aprovar).
--
-- ─── Para a frente N (avisos), NÃO aplicado aqui ─────────────────────────
-- Avisos que já existem e se sobrepõem aos da peça (seção 6):
--   · file_approval_avisa_equipe (gatilho em file_approval_events): "Aprovação
--     recebida ... Pronto para agendar na Agenda." (approval, /calendario), para
--     admin e gestor, em toda aprovação feita pelo cliente;
--   · ClientApprovals.tsx chama notify-admin com o mesmo texto (o gatilho
--     notifications_sem_duplicata junta os dois) e "Ajustes solicitados ..." na
--     reprovação;
--   · editorial_record_published_receipt avisa o post publicado.
-- Para a peça da frente EA ficar com UM aviso por evento, a frente N pode
-- pular esses genéricos quando o arquivo é de um trabalho da Mesa, por exemplo
-- no começo de file_approval_avisa_equipe:
--   IF EXISTS (SELECT 1 FROM public.estudio_trabalhos t
--               WHERE cardinality(t.file_ids) > 0 AND t.file_ids[1] = NEW.file_id
--                 AND t.agenda_sincronizada_em IS NOT NULL) THEN RETURN NEW; END IF;
