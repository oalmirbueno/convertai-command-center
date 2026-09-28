-- ═══════════════════════════════════════════════════════════════════════
-- AP-02 · POSTS DO ESTÚDIO NA DATA DO CONTEÚDO (frente AP, 28/09). NÃO APLICADO.
--
-- Bug do dono (28/09): "tem que entender as datas corretas e não atropelar
-- tudo no dia da criação; tem que seguir a data de onde está o conteúdo".
-- A entrega do Estúdio (frente EA, 27/09) punha o post na Agenda com a
-- publicação SEM data. A função estudio-arte nova já cria na data do conteúdo
-- (dia da pauta + melhor horário). Este arquivo acerta os que já existem.
--
-- Só mexe no que é do Estúdio e ainda está no começo:
--   · trabalho entregue pela frente EA (agenda_sincronizada_em preenchido),
--     ainda SEM aprovação do cliente (aguardando_cliente ou aguardando_agencia);
--   · publicação PLANEJADA sem data, num post não arquivado;
--   · pauta (tasks.due_date) de hoje em diante, e o horário ainda à frente
--     (pelo menos 15 min). Pauta que já passou fica sem data: o Estúdio pergunta.
-- Aprovada sem data NÃO entra: não agenda nada sozinho aqui; ela aparece na
-- pergunta "sem data" do Estúdio e na Agenda com um clique.
--
-- Grava pelo caminho da Agenda (save_editorial_post, em nome do admin, como
-- o agendador da Mesa), um post por vez: nada sai do plano, só ganha a data.
-- Idempotente: rodar de novo não acha mais nada (as publicações já têm data).
-- Falha em um post vira WARNING e segue com os outros.
-- ═══════════════════════════════════════════════════════════════════════

DO $backfill$
DECLARE
  _admin uuid;
  _t record;
  _post record;
  _i record;
  _hora time;
  _fuso text;
  _quando timestamptz;
  _pubs jsonb;
  _feitos integer := 0;
  _pulados integer := 0;
BEGIN
  SELECT user_id INTO _admin FROM public.user_roles WHERE role = 'admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF _admin IS NULL THEN
    RAISE NOTICE 'AP-02: sem admin, nada feito';
    RETURN;
  END IF;

  FOR _t IN
    SELECT DISTINCT ON (w.post_id) w.id, w.client_id, w.post_id, w.file_ids, tk.due_date
      FROM public.estudio_trabalhos w
      JOIN public.tasks tk ON tk.id = w.task_id AND tk.deleted_at IS NULL
      JOIN public.editorial_posts p ON p.id = w.post_id AND p.archived_at IS NULL
     WHERE w.agenda_sincronizada_em IS NOT NULL
       AND w.status = 'entregue'
       AND w.entrega_status IN ('aguardando_cliente', 'aguardando_agencia')
       AND tk.due_date IS NOT NULL
       AND tk.due_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
       AND EXISTS (
         SELECT 1 FROM public.editorial_publications pu
          WHERE pu.post_id = w.post_id AND pu.status = 'planned' AND pu.scheduled_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.editorial_publications pu
          WHERE pu.post_id = w.post_id AND pu.status IN ('scheduled', 'published', 'failed')
       )
     ORDER BY w.post_id, w.atualizado_em DESC
  LOOP
    BEGIN
      SELECT c.hora_publicacao, c.fuso INTO _hora, _fuso FROM public.mesa_cliente_config c WHERE c.client_id = _t.client_id;
      IF COALESCE((SELECT c.horario_automatico FROM public.mesa_cliente_config c WHERE c.client_id = _t.client_id), true) THEN
        _hora := COALESCE(public.mesa_melhor_hora(_t.client_id, CASE WHEN cardinality(_t.file_ids) > 1 THEN 'carousel' ELSE 'static' END), _hora);
      END IF;
      _hora := COALESCE(_hora, '09:00'::time);
      _fuso := COALESCE(_fuso, 'America/Sao_Paulo');
      _quando := (_t.due_date + _hora) AT TIME ZONE _fuso;
      IF _quando < now() + interval '15 minutes' THEN
        _pulados := _pulados + 1;
        CONTINUE;
      END IF;

      SELECT * INTO _post FROM public.editorial_posts WHERE id = _t.post_id;
      SELECT * INTO _i FROM public.editorial_post_internal WHERE post_id = _t.post_id;
      SELECT jsonb_agg(jsonb_build_object(
               'id', pu.id,
               'idempotency_key', pi.idempotency_key,
               'external_account_id', pu.external_account_id,
               'file_id', pu.file_id,
               'caption', pu.caption,
               'first_comment', pu.first_comment,
               'alt_text', pu.alt_text,
               'scheduled_at', COALESCE(pu.scheduled_at, _quando),
               'scheduled_timezone', COALESCE(pu.scheduled_timezone, _fuso)
             ) ORDER BY pu.created_at)
        INTO _pubs
        FROM public.editorial_publications pu
        JOIN public.editorial_publication_internal pi ON pi.publication_id = pu.id
       WHERE pu.post_id = _t.post_id AND pu.status = 'planned';

      PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin::text, 'role', 'authenticated')::text, true);
      PERFORM public.save_editorial_post(
        jsonb_build_object(
          'id', _post.id,
          'idempotency_key', _i.idempotency_key,
          'mutation_id', public.mesa_uuid_estavel('ap02-data-do-conteudo:' || _post.id::text || ':' || _post.version::text),
          'client_id', _post.client_id,
          'project_id', _post.project_id,
          'primary_file_id', _post.primary_file_id,
          'title', _post.title,
          'content_type', _post.content_type,
          'objective', _post.objective,
          'default_caption', _post.default_caption,
          'production_status', _post.production_status,
          'task_id', _i.task_id,
          'responsible_id', _i.responsible_id,
          'internal_notes', _i.internal_notes,
          'revision_of_post_id', _i.revision_of_post_id,
          'publications', COALESCE(_pubs, '[]'::jsonb)
        ),
        _post.version
      );
      UPDATE public.estudio_trabalhos
         SET publicar_em = _quando,
             agenda_historico = public.estudio_trabalhos.agenda_historico || jsonb_build_array(jsonb_build_object(
               'em', now(), 'por', NULL, 'acao', 'data_do_conteudo', 'quando', _quando))
       WHERE id = _t.id;
      _feitos := _feitos + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'AP-02: post % sem data do conteúdo: %', _t.post_id, SQLERRM;
      _pulados := _pulados + 1;
    END;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'AP-02: % posts na data do conteúdo, % pulados', _feitos, _pulados;
END
$backfill$;
