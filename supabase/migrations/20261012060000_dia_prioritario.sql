-- 12/10/2026: Dia Prioritário do Cliente (aprovado pelo CEO).
--
-- Cada cliente recorrente tem um dia útil fixo (segunda a sexta) de atenção estratégica: conversa,
-- revisão de resultados, pendências, próximos passos e, quando combinado, captações. NÃO é o único dia
-- de atendimento e NÃO muda rituais (segunda, quarta, sexta), postagens ou urgências.
--
-- 1. cliente_dia_prioritario: o dia atual de cada cliente (um por cliente), com situação e origem.
-- 2. cliente_dia_prioritario_historico: toda mudança, com quem mudou e o motivo (nada se perde).
-- 3. dia_prioritario_definir: única porta de escrita (admin ou backend confiável); dia manual nunca é
--    trocado por sugestão sem pedido explícito.
-- 4. dia_prioritario_registrar: conversa, alinhamento ou "sem necessidade de contato" no project_memory
--    (o mesmo que alimenta dossiê e movimentos) e o dossiê entra na fila.
-- 5. dia_prioritario_video: o vídeo oficial (linha única), invisível ao cliente até ser publicado.
-- 6. A distribuição aprovada, só para os IDs reais que existirem (em outro ambiente não faz nada).

-- ---------------------------------------------------------------------------
-- 1. O dia de cada cliente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_dia_prioritario (
  client_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 1 segunda ... 5 sexta (ISO). Nulo só quando não se aplica.
  dia smallint CHECK (dia BETWEEN 1 AND 5),
  situacao text NOT NULL CHECK (situacao IN ('confirmado', 'provisorio', 'sugerido', 'nao_aplicavel')),
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'sugerida')),
  observacao text CHECK (observacao IS NULL OR char_length(observacao) <= 500),
  -- Dias que a equipe sabe que o cliente não pode (a sugestão respeita).
  dias_indisponiveis smallint[] NOT NULL DEFAULT '{}'::smallint[]
    CHECK (dias_indisponiveis <@ ARRAY[1, 2, 3, 4, 5]::smallint[]),
  definido_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_dia_prioritario_dia_coerente CHECK (
    (situacao = 'nao_aplicavel' AND dia IS NULL) OR (situacao <> 'nao_aplicavel' AND dia IS NOT NULL)
  )
);

COMMENT ON TABLE public.cliente_dia_prioritario IS
  'Dia Prioritário do cliente (1 segunda a 5 sexta). Escrita só por public.dia_prioritario_definir. O cliente lê só o próprio, e só confirmado.';

CREATE TABLE IF NOT EXISTS public.cliente_dia_prioritario_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dia_antes smallint,
  dia_depois smallint,
  situacao_antes text,
  situacao_depois text NOT NULL,
  origem text NOT NULL,
  observacao text,
  motivo text CHECK (motivo IS NULL OR char_length(motivo) <= 500),
  autor uuid,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cliente_dia_prioritario_historico_cliente ON public.cliente_dia_prioritario_historico (client_id, em DESC);

ALTER TABLE public.cliente_dia_prioritario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_dia_prioritario_historico ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cliente_dia_prioritario FROM anon, authenticated;
REVOKE ALL ON TABLE public.cliente_dia_prioritario_historico FROM anon, authenticated;
GRANT SELECT ON TABLE public.cliente_dia_prioritario TO authenticated;
GRANT SELECT ON TABLE public.cliente_dia_prioritario_historico TO authenticated;
GRANT ALL ON TABLE public.cliente_dia_prioritario TO service_role;
GRANT ALL ON TABLE public.cliente_dia_prioritario_historico TO service_role;

DROP POLICY IF EXISTS cliente_dia_prioritario_equipe_le ON public.cliente_dia_prioritario;
CREATE POLICY cliente_dia_prioritario_equipe_le ON public.cliente_dia_prioritario
FOR SELECT TO authenticated
USING (COALESCE(public.is_staff((select auth.uid())), false) AND COALESCE(public.can_access_client(client_id), false));

-- O cliente vê só o próprio dia, e só quando confirmado (provisório e sugerido são internos).
DROP POLICY IF EXISTS cliente_dia_prioritario_cliente_le_o_seu ON public.cliente_dia_prioritario;
CREATE POLICY cliente_dia_prioritario_cliente_le_o_seu ON public.cliente_dia_prioritario
FOR SELECT TO authenticated
USING (client_id = (select auth.uid()) AND situacao = 'confirmado');

DROP POLICY IF EXISTS cliente_dia_prioritario_historico_equipe_le ON public.cliente_dia_prioritario_historico;
CREATE POLICY cliente_dia_prioritario_historico_equipe_le ON public.cliente_dia_prioritario_historico
FOR SELECT TO authenticated
USING (COALESCE(public.is_staff((select auth.uid())), false) AND COALESCE(public.can_access_client(client_id), false));

-- ---------------------------------------------------------------------------
-- 2. Definir o dia (única porta de escrita)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dia_prioritario_definir(
  _client_id uuid,
  _dia smallint,
  _situacao text,
  _origem text DEFAULT 'manual',
  _observacao text DEFAULT NULL,
  _motivo text DEFAULT NULL,
  _dias_indisponiveis smallint[] DEFAULT NULL,
  _substituir_manual boolean DEFAULT false
)
RETURNS public.cliente_dia_prioritario
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _antes public.cliente_dia_prioritario;
  _depois public.cliente_dia_prioritario;
  _autor uuid := auth.uid();
BEGIN
  PERFORM app_private.require_rpc_admin();
  IF _client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
     WHERE r.user_id = _client_id AND r.role = 'client'::public.app_role AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DIA_PRIORITARIO_CLIENTE_INVALIDO';
  END IF;
  IF _situacao NOT IN ('confirmado', 'provisorio', 'sugerido', 'nao_aplicavel') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DIA_PRIORITARIO_SITUACAO_INVALIDA';
  END IF;
  IF _origem NOT IN ('manual', 'sugerida') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DIA_PRIORITARIO_ORIGEM_INVALIDA';
  END IF;
  IF _situacao = 'nao_aplicavel' THEN
    _dia := NULL;
  ELSIF _dia IS NULL OR _dia NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DIA_PRIORITARIO_DIA_INVALIDO';
  END IF;

  SELECT * INTO _antes FROM public.cliente_dia_prioritario WHERE client_id = _client_id FOR UPDATE;

  -- Nunca sobrescrever em silêncio um dia definido à mão com uma sugestão.
  IF FOUND AND _antes.origem = 'manual' AND _antes.situacao IN ('confirmado', 'provisorio')
     AND _origem = 'sugerida' AND NOT COALESCE(_substituir_manual, false)
     AND _antes.dia IS DISTINCT FROM _dia THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DIA_PRIORITARIO_MANUAL_PRESERVADO';
  END IF;

  INSERT INTO public.cliente_dia_prioritario AS c
    (client_id, dia, situacao, origem, observacao, dias_indisponiveis, definido_por, atualizado_em)
  VALUES
    (_client_id, _dia, _situacao, _origem, NULLIF(btrim(_observacao), ''),
     COALESCE(_dias_indisponiveis, '{}'::smallint[]), _autor, now())
  ON CONFLICT (client_id) DO UPDATE SET
    dia = EXCLUDED.dia,
    situacao = EXCLUDED.situacao,
    origem = EXCLUDED.origem,
    observacao = EXCLUDED.observacao,
    dias_indisponiveis = COALESCE(_dias_indisponiveis, c.dias_indisponiveis),
    definido_por = EXCLUDED.definido_por,
    atualizado_em = now()
  RETURNING * INTO _depois;

  IF _antes.client_id IS NULL
     OR _antes.dia IS DISTINCT FROM _depois.dia
     OR _antes.situacao IS DISTINCT FROM _depois.situacao
     OR _antes.origem IS DISTINCT FROM _depois.origem
     OR _antes.observacao IS DISTINCT FROM _depois.observacao
     OR _antes.dias_indisponiveis IS DISTINCT FROM _depois.dias_indisponiveis THEN
    INSERT INTO public.cliente_dia_prioritario_historico
      (client_id, dia_antes, dia_depois, situacao_antes, situacao_depois, origem, observacao, motivo, autor)
    VALUES
      (_client_id, _antes.dia, _depois.dia, _antes.situacao, _depois.situacao, _depois.origem,
       _depois.observacao, NULLIF(btrim(_motivo), ''), _autor);
  END IF;
  RETURN _depois;
END;
$fn$;

REVOKE ALL ON FUNCTION public.dia_prioritario_definir(uuid, smallint, text, text, text, text, smallint[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dia_prioritario_definir(uuid, smallint, text, text, text, text, smallint[], boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Registrar o que aconteceu no Dia Prioritário (equipe ou Hermes pelo backend)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dia_prioritario_registrar(
  _client_id uuid,
  _tipo text,
  _resumo text DEFAULT NULL,
  _combinados text DEFAULT NULL,
  _proximos_passos text DEFAULT NULL,
  _data date DEFAULT NULL,
  _autor uuid DEFAULT NULL,
  _origem text DEFAULT 'painel'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _id uuid;
  _dia_do_cliente smallint;
  _quando date := COALESCE(_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  _rotulo text;
  _quem uuid := COALESCE(auth.uid(), _autor);
BEGIN
  PERFORM app_private.require_rpc_client_staff(_client_id);
  IF _tipo NOT IN ('ligacao', 'reuniao', 'alinhamento', 'mensagem', 'sem_contato') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DIA_PRIORITARIO_TIPO_INVALIDO';
  END IF;
  IF _origem NOT IN ('painel', 'hermes') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DIA_PRIORITARIO_ORIGEM_INVALIDA';
  END IF;
  IF _quando > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DIA_PRIORITARIO_DATA_FUTURA';
  END IF;
  SELECT dia INTO _dia_do_cliente FROM public.cliente_dia_prioritario WHERE client_id = _client_id;
  _rotulo := CASE _tipo
    WHEN 'ligacao' THEN 'ligação com o cliente'
    WHEN 'reuniao' THEN 'reunião com o cliente'
    WHEN 'alinhamento' THEN 'alinhamento interno do cliente'
    WHEN 'mensagem' THEN 'conversa por mensagem'
    ELSE 'sem necessidade de contato nesta semana' END;

  INSERT INTO public.project_memory (client_id, kind, source, title, content, tags, metadata, created_by)
  VALUES (
    _client_id, 'acao', CASE WHEN _origem = 'hermes' THEN 'hermes' ELSE 'manual' END,
    'Dia Prioritário: ' || _rotulo,
    COALESCE(NULLIF(concat_ws(E'\n',
      NULLIF(btrim(_resumo), ''),
      CASE WHEN NULLIF(btrim(_combinados), '') IS NOT NULL THEN 'Combinados: ' || btrim(_combinados) END,
      CASE WHEN NULLIF(btrim(_proximos_passos), '') IS NOT NULL THEN 'Próximos passos: ' || btrim(_proximos_passos) END
    ), ''), 'Registrado no Dia Prioritário.'),
    ARRAY['dia_prioritario', _tipo],
    jsonb_build_object(
      'origem', 'dia_prioritario',
      'dia_prioritario', jsonb_build_object(
        'tipo', _tipo,
        'data', _quando,
        'no_dia', _dia_do_cliente IS NOT NULL AND extract(isodow FROM _quando)::smallint = _dia_do_cliente,
        'combinados', NULLIF(btrim(_combinados), ''),
        'proximos_passos', NULLIF(btrim(_proximos_passos), ''),
        'registrado_por', _origem
      ),
      'client_visible', false
    ),
    _quem
  )
  RETURNING id INTO _id;

  BEGIN
    PERFORM public.dossie_enfileirar(_client_id, 'dia_prioritario');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'dia_prioritario_registrar: dossiê não entrou na fila (%)', SQLERRM;
  END;
  RETURN _id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.dia_prioritario_registrar(uuid, text, text, text, text, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dia_prioritario_registrar(uuid, text, text, text, text, date, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Vídeo oficial (motion design, produzido depois). Linha única; o cliente só vê publicado.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dia_prioritario_video (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  titulo text NOT NULL DEFAULT 'Como funciona o seu Dia Prioritário' CHECK (char_length(titulo) BETWEEN 3 AND 120),
  fonte text CHECK (fonte IS NULL OR fonte IN ('arquivo', 'link')),
  video_path text CHECK (video_path IS NULL OR video_path LIKE 'agencia/dia-prioritario/%'),
  video_url text CHECK (video_url IS NULL OR video_url ~ '^https://'),
  capa_path text CHECK (capa_path IS NULL OR capa_path LIKE 'agencia/dia-prioritario/%'),
  publicado boolean NOT NULL DEFAULT false,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dia_prioritario_video_publicado_tem_video CHECK (
    NOT publicado OR (fonte = 'arquivo' AND video_path IS NOT NULL) OR (fonte = 'link' AND video_url IS NOT NULL)
  )
);
INSERT INTO public.dia_prioritario_video (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.dia_prioritario_video_carimbo()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  NEW.atualizado_em := now();
  NEW.atualizado_por := COALESCE(auth.uid(), NEW.atualizado_por);
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS dia_prioritario_video_carimbo ON public.dia_prioritario_video;
CREATE TRIGGER dia_prioritario_video_carimbo BEFORE UPDATE ON public.dia_prioritario_video
  FOR EACH ROW EXECUTE FUNCTION app_private.dia_prioritario_video_carimbo();

ALTER TABLE public.dia_prioritario_video ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dia_prioritario_video FROM anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.dia_prioritario_video TO authenticated;
GRANT ALL ON TABLE public.dia_prioritario_video TO service_role;

DROP POLICY IF EXISTS dia_prioritario_video_le ON public.dia_prioritario_video;
CREATE POLICY dia_prioritario_video_le ON public.dia_prioritario_video
FOR SELECT TO authenticated
USING (publicado OR COALESCE(public.is_staff((select auth.uid())), false));

DROP POLICY IF EXISTS dia_prioritario_video_admin_altera ON public.dia_prioritario_video;
CREATE POLICY dia_prioritario_video_admin_altera ON public.dia_prioritario_video
FOR UPDATE TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role))
WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));

-- Arquivos do vídeo no bucket mesa, pasta agencia/dia-prioritario/ (o admin já envia para agencia/).
-- Qualquer pessoa logada lê só o arquivo que o vídeo publicado aponta.
DROP POLICY IF EXISTS "mesa: logado le o video do dia prioritario" ON storage.objects;
CREATE POLICY "mesa: logado le o video do dia prioritario" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'mesa'
  AND (storage.foldername(name))[1] = 'agencia'
  AND (storage.foldername(name))[2] = 'dia-prioritario'
  AND EXISTS (
    SELECT 1 FROM public.dia_prioritario_video v
     WHERE v.publicado AND (v.video_path = name OR v.capa_path = name)
  )
);

-- ---------------------------------------------------------------------------
-- 5. Distribuição aprovada pelo CEO (12/10/2026), só para IDs reais que existirem
-- ---------------------------------------------------------------------------
WITH aprovada(client_id, dia, situacao, observacao) AS (
  VALUES
    ('d3dacbac-0da6-49eb-8322-31ae22bd79b4'::uuid, 1::smallint, 'confirmado', NULL::text),  -- Casa dos Assados
    ('52f2efb6-9928-4074-b8e2-bc972baf1f6a'::uuid, 1::smallint, 'confirmado', NULL),         -- RD AR Climatização
    ('6a847578-ba39-44cd-be61-08e34e18e4c9'::uuid, 2::smallint, 'provisorio',
       'Provisório: continuidade operacional documentada, vigência comercial ainda a confirmar.'), -- Stop Informática
    ('e590497e-f985-47be-b8f2-493bae1da7df'::uuid, 2::smallint, 'confirmado', NULL),         -- Verzelo
    ('39ebda82-637c-498b-a23a-b622f645e852'::uuid, 3::smallint, 'confirmado',
       'Acerbi institucional e CME são frentes do mesmo cliente.'),                            -- Acerbi
    ('eb1270a5-4d9e-4c67-bb17-e25fa12ada34'::uuid, 3::smallint, 'confirmado', NULL),         -- Mirante Luz Floripa
    ('8801caa5-7505-44c9-9c14-e3019eace772'::uuid, 4::smallint, 'confirmado', NULL),         -- Terra Flor
    ('bad69252-05ad-4b80-ab76-4a0e9fd3c314'::uuid, 4::smallint, 'confirmado', NULL),         -- SKC Tecnologia Contábil
    ('5ae0705e-6f8c-40f1-b076-867fd2ab3178'::uuid, 4::smallint, 'confirmado', NULL),         -- Preserva Eco
    ('3d08338c-0c3b-453f-a64f-79a55c5711e8'::uuid, 5::smallint, 'confirmado', NULL),         -- Softy Móveis
    ('3ba9540c-bc09-4026-b575-05fd0df4195f'::uuid, 5::smallint, 'confirmado', NULL),         -- Thainá Rosa Advogada
    ('20c96cea-6ada-4db5-a408-25a3b0c978ba'::uuid, NULL::smallint, 'nao_aplicavel',
       'Sem renovação: fora da recorrência até renovar.')                                     -- Para Si Ótica
),
inseridos AS (
  INSERT INTO public.cliente_dia_prioritario (client_id, dia, situacao, origem, observacao)
  SELECT a.client_id, a.dia, a.situacao, 'manual', a.observacao
    FROM aprovada a
   WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = a.client_id AND p.deleted_at IS NULL)
  ON CONFLICT (client_id) DO NOTHING
  RETURNING client_id, dia, situacao, origem, observacao
)
INSERT INTO public.cliente_dia_prioritario_historico (client_id, dia_antes, dia_depois, situacao_antes, situacao_depois, origem, observacao, motivo)
SELECT client_id, NULL, dia, NULL, situacao, origem, observacao, 'Distribuição semanal aprovada pelo CEO em 12/10/2026.'
  FROM inseridos;
