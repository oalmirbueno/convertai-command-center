-- Post no ar: o aviso chega aos dois lados, e leva ao post de verdade.
--
-- O RELATO: publicou (a máquina publica sozinha no horário marcado) e
-- ninguém fica sabendo. O dono descobre olhando o perfil; o cliente, nunca.
--
-- O QUE O RECIBO FAZIA E POR QUE NÃO BASTAVA:
--
-- 1. Avisava só a EQUIPE. O filtro final exige papel admin/manager/design/
--    traffic — o cliente é justamente quem não passa por ele. Quem mais
--    quer ver a peça no ar era o único a não ser avisado.
-- 2. O link era '/kanban?task=...' — uma tela interna, que o cliente nem
--    abre. O post público existia (permalink confirmado é condição para o
--    recibo sequer ser aceito) e não levava a lugar nenhum.
-- 3. Publicação SEM tarefa vinculada saía calada: 'IF _task_id IS NULL
--    THEN RETURN NEW' desligava o aviso inteiro por falta de um vínculo
--    interno que nada tem a ver com o post estar no ar.
--
-- E uma bomba de menor calibre: tarefa APAGADA fazia o recibo levantar
-- exceção ('task scope mismatch'), e como o recibo roda dentro da baixa
-- oficial da publicação, apagar a tarefa passava a impedir que um post já
-- publicado fosse marcado como publicado. O desencontro que a regra quer
-- pegar é tarefa VIVA em outro projeto — esse continua barrando.
--
-- Formato patch, e não CREATE OR REPLACE de corpo inteiro: a mudança é
-- localizada, e uma substituição CONTADA falha alto se o texto em produção
-- tiver mudado, em vez de sobrescrever em silêncio uma versão diferente.

DO $patch$
DECLARE
  _fonte text;
  _alvo text;
  _sub text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _fonte
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'editorial_record_published_receipt';

  -- ── 1. Variáveis novas ────────────────────────────────────────────────
  _alvo := E'  _task_id uuid;\n'
        || E'  _task_assignee uuid;\n'
        || E'  _comment text;\n';
  _sub  := E'  _task_id uuid;\n'
        || E'  _task_assignee uuid;\n'
        || E'  _task_project uuid;\n'
        || E'  _comment text;\n'
        || E'  _link text;\n'
        || E'  _cliente uuid;\n'
        || E'  _onde text;\n'
        || E'  _titulo text;\n';
  IF (length(_fonte) - length(replace(_fonte, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch recibo (declare): alvo nao encontrado exatamente 1 vez';
  END IF;
  _fonte := replace(_fonte, _alvo, _sub);

  -- ── 2. A tarefa deixa de ser condição para avisar ─────────────────────
  _alvo := E'  IF _task_id IS NULL THEN\n'
        || E'    RETURN NEW;\n'
        || E'  END IF;\n'
        || E'\n'
        || E'  SELECT task.assigned_to\n'
        || E'  INTO _task_assignee\n'
        || E'  FROM public.tasks AS task\n'
        || E'  WHERE task.id = _task_id\n'
        || E'    AND task.project_id = _post.project_id\n'
        || E'    AND task.deleted_at IS NULL;\n'
        || E'  IF NOT FOUND THEN\n'
        || E'    RAISE EXCEPTION ''published receipt task scope mismatch'';\n'
        || E'  END IF;\n'
        || E'\n'
        || E'  _comment := format(\n'
        || E'    ''Publicado em %s: %s'',\n'
        || E'    _publication.platform,\n'
        || E'    btrim(_publication.permalink)\n'
        || E'  );\n'
        || E'\n'
        || E'  INSERT INTO public.task_comments (\n'
        || E'    task_id,\n'
        || E'    author_id,\n'
        || E'    content\n'
        || E'  ) VALUES (\n'
        || E'    _task_id,\n'
        || E'    NEW.published_by,\n'
        || E'    _comment\n'
        || E'  );\n';

  _sub  := E'  -- A tarefa vinculada rende o comentario de sempre, mas a\n'
        || E'  -- AUSENCIA dela nao cala mais o aviso: o post esta no ar de\n'
        || E'  -- qualquer forma, e e disso que dono e cliente precisam saber.\n'
        || E'  IF _task_id IS NOT NULL THEN\n'
        || E'    SELECT task.assigned_to, task.project_id\n'
        || E'    INTO _task_assignee, _task_project\n'
        || E'    FROM public.tasks AS task\n'
        || E'    WHERE task.id = _task_id\n'
        || E'      AND task.deleted_at IS NULL;\n'
        || E'\n'
        || E'    IF FOUND THEN\n'
        || E'      -- Tarefa VIVA em outro projeto e desencontro real de\n'
        || E'      -- escopo: continua barrando, como antes.\n'
        || E'      IF _task_project IS DISTINCT FROM _post.project_id THEN\n'
        || E'        RAISE EXCEPTION ''published receipt task scope mismatch'';\n'
        || E'      END IF;\n'
        || E'\n'
        || E'      _comment := format(\n'
        || E'        ''Publicado em %s: %s'',\n'
        || E'        _publication.platform,\n'
        || E'        btrim(_publication.permalink)\n'
        || E'      );\n'
        || E'\n'
        || E'      INSERT INTO public.task_comments (\n'
        || E'        task_id,\n'
        || E'        author_id,\n'
        || E'        content\n'
        || E'      ) VALUES (\n'
        || E'        _task_id,\n'
        || E'        NEW.published_by,\n'
        || E'        _comment\n'
        || E'      );\n'
        || E'    ELSE\n'
        || E'      -- Tarefa apagada nao pode impedir a baixa de um post que\n'
        || E'      -- JA esta publicado: sem comentario, o aviso segue.\n'
        || E'      _task_assignee := NULL;\n'
        || E'    END IF;\n'
        || E'  END IF;\n'
        || E'\n'
        || E'  -- O aviso aponta para o POST PUBLICO. O permalink e condicao\n'
        || E'  -- para este recibo existir (checada no topo), entao aqui ele\n'
        || E'  -- e sempre um endereco valido.\n'
        || E'  _link := btrim(_publication.permalink);\n'
        || E'  _onde := initcap(_publication.platform);\n'
        || E'  -- O titulo do conteudo E o nome do arquivo. Mandar\n'
        || E'  -- "peca.png" para o cliente e deixar vazar a mecanica de\n'
        || E'  -- dentro de casa. A lista de extensoes e fechada de\n'
        || E'  -- proposito: um titulo como "Oferta 10.50" nao pode\n'
        || E'  -- perder o final para um regex ganancioso.\n'
        || E'  _titulo := NULLIF(btrim(regexp_replace(\n'
        || E'    COALESCE(_post.title, ''''),\n'
        || E'    ''[.](png|jpe?g|jpe|webp|gif|heic|heif|mp4|mov|m4v|webm)$'',\n'
        || E'    '''', ''i'')), '''');\n'
        || E'  _titulo := COALESCE(_titulo, _post.title, ''conteudo'');\n';
  IF (length(_fonte) - length(replace(_fonte, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch recibo (tarefa): alvo nao encontrado exatamente 1 vez';
  END IF;
  _fonte := replace(_fonte, _alvo, _sub);

  -- ── 3. O aviso da equipe passa a levar ao post ────────────────────────
  _alvo := E'      ''Conteúdo publicado em %s: %s'',\n'
        || E'      _publication.platform,\n'
        || E'      _post.title\n'
        || E'    ),\n'
        || E'    ''publication'',\n'
        || E'    ''/kanban?task='' || _task_id::text\n';
  _sub  := E'      ''Conteúdo publicado no %s: %s'',\n'
        || E'      _onde,\n'
        || E'      _titulo\n'
        || E'    ),\n'
        || E'    ''publication'',\n'
        || E'    _link\n';
  IF (length(_fonte) - length(replace(_fonte, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch recibo (link): alvo nao encontrado exatamente 1 vez';
  END IF;
  _fonte := replace(_fonte, _alvo, _sub);

  -- ── 4. O cliente entra na lista, na língua dele ───────────────────────
  _alvo := E'    );\n'
        || E'\n'
        || E'  RETURN NEW;\n'
        || E'END\n';
  _sub  := E'    );\n'
        || E'\n'
        || E'  -- O cliente e avisado tambem. O filtro de papeis acima existe\n'
        || E'  -- para nao vazar tela interna a quem nao e da equipe; aqui nao\n'
        || E'  -- ha o que proteger: o post ja e publico, e e o proprio\n'
        || E'  -- conteudo dele. A mensagem fala do negocio, nao do processo.\n'
        || E'  _cliente := _publication.client_id;\n'
        || E'  IF _cliente IS NOT NULL AND EXISTS (\n'
        || E'    SELECT 1\n'
        || E'    FROM public.user_roles AS role_row\n'
        || E'    WHERE role_row.user_id = _cliente\n'
        || E'      AND role_row.role = ''client''::public.app_role\n'
        || E'  ) THEN\n'
        || E'    INSERT INTO public.notifications (\n'
        || E'      user_id,\n'
        || E'      message,\n'
        || E'      notification_type,\n'
        || E'      link\n'
        || E'    ) VALUES (\n'
        || E'      _cliente,\n'
        || E'      format(\n'
        || E'        ''Seu conteúdo já está no ar no %s: %s'',\n'
        || E'        _onde,\n'
        || E'        _titulo\n'
        || E'      ),\n'
        || E'      ''publication'',\n'
        || E'      _link\n'
        || E'    );\n'
        || E'  END IF;\n'
        || E'\n'
        || E'  RETURN NEW;\n'
        || E'END\n';
  IF (length(_fonte) - length(replace(_fonte, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch recibo (cliente): alvo nao encontrado exatamente 1 vez';
  END IF;
  _fonte := replace(_fonte, _alvo, _sub);

  EXECUTE _fonte;
END
$patch$;
