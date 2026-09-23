-- ═══════════════════════════════════════════════════════════════════════
-- MESA DO CLIENTE, VERSÃO 3: ACERVO DE IMAGENS REAIS, LOGO DE QUALQUER
-- PASTA, HASHTAGS, PAPEL DE CONTEXTO E MELHORES HORÁRIOS.
--
-- Pedido do dono (23/09): a arte precisa usar as fotos reais do cliente
-- (quartos, antes e depois, pessoas), organizadas por pasta e categoria; a
-- logo alternativa pode vir de qualquer pasta do workspace ou de Arquivos;
-- a legenda ganha 4 a 5 hashtags; o agente de contexto tem modelo próprio no
-- catálogo; e o horário de publicação sai dos melhores horários de cada tipo
-- de post (histórico de alcance), sem deixar de poder ser mudado.
-- Contrato completo: docs/mesa-do-cliente/CONTRATOS-V3.md.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Acervo de imagens reais do cliente ──────────────────────────────

CREATE TABLE public.cliente_imagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  origem text NOT NULL CHECK (origem IN ('workspace', 'arquivo', 'upload')),
  workspace_node_id uuid,
  file_id uuid,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  nome text NOT NULL,
  pasta text,
  categoria text,
  tags text[] NOT NULL DEFAULT '{}',
  descricao text,
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cliente_imagens_no_unico ON public.cliente_imagens (client_id, workspace_node_id) WHERE workspace_node_id IS NOT NULL;
CREATE UNIQUE INDEX cliente_imagens_arquivo_unico ON public.cliente_imagens (client_id, file_id) WHERE file_id IS NOT NULL;
CREATE INDEX cliente_imagens_cliente_idx ON public.cliente_imagens (client_id, categoria);

CREATE TRIGGER cliente_imagens_tocar
BEFORE UPDATE ON public.cliente_imagens
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

ALTER TABLE public.cliente_imagens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cliente_imagens FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY cliente_imagens_equipe_le ON public.cliente_imagens
FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));
CREATE POLICY cliente_imagens_equipe_altera ON public.cliente_imagens
FOR UPDATE TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id))
WITH CHECK (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT, UPDATE ON public.cliente_imagens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cliente_imagens TO service_role;

-- ─── 2) Logo de qualquer pasta, hashtags e horário automático ───────────

ALTER TABLE public.cliente_kit_marca
  ADD COLUMN logo_path text,
  ADD COLUMN logo_alt_path text;

ALTER TABLE public.estudio_trabalhos
  ADD COLUMN hashtags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.mesa_cliente_config
  ADD COLUMN horario_automatico boolean NOT NULL DEFAULT true;

-- ─── 3) Papel "contexto" no catálogo de modelos ─────────────────────────

ALTER TABLE public.ia_modelos DROP CONSTRAINT ia_modelos_padrao_para_check;
ALTER TABLE public.ia_modelos
  ADD CONSTRAINT ia_modelos_padrao_para_check
  CHECK (padrao_para <@ ARRAY['estrategista', 'diretor_arte', 'imagem', 'leitura', 'contexto']::text[]);

UPDATE public.ia_modelos
   SET padrao_para = array_append(padrao_para, 'contexto')
 WHERE id = 'openrouter:openai/gpt-6-luna'
   AND NOT ('contexto' = ANY(padrao_para));

-- ─── 4) Melhores horários por tipo de post ──────────────────────────────
--
-- Pelo alcance dos posts publicados (social_post_metrics), no fuso de São
-- Paulo, entre 7h e 22h. Pontuação: alcance + 3x salvamentos + 5x
-- compartilhamentos. Com pelo menos 6 posts do tipo, vale o histórico do
-- próprio cliente; senão, o da agência toda; sem nada, o padrão.
CREATE FUNCTION public.mesa_melhor_hora(_client_id uuid, _tipo text)
RETURNS time
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _midia text := CASE _tipo WHEN 'carousel' THEN 'CAROUSEL_ALBUM' WHEN 'static' THEN 'IMAGE' WHEN 'design' THEN 'IMAGE' ELSE 'VIDEO' END;
  _hora integer;
BEGIN
  SELECT h INTO _hora FROM (
    SELECT extract(hour FROM m.posted_at AT TIME ZONE 'America/Sao_Paulo')::int AS h,
           avg(COALESCE(m.reach, 0) + 3 * COALESCE(m.saved, 0) + 5 * COALESCE(m.shares, 0)) AS nota,
           count(*) AS n
      FROM public.social_post_metrics m
     WHERE m.client_id = _client_id AND m.media_type = _midia AND m.posted_at > now() - interval '180 days'
     GROUP BY 1
  ) x
  WHERE h BETWEEN 7 AND 22 AND (SELECT count(*) FROM public.social_post_metrics m2 WHERE m2.client_id = _client_id AND m2.media_type = _midia) >= 6
  ORDER BY nota DESC
  LIMIT 1;

  IF _hora IS NULL THEN
    SELECT h INTO _hora FROM (
      SELECT extract(hour FROM m.posted_at AT TIME ZONE 'America/Sao_Paulo')::int AS h,
             avg(COALESCE(m.reach, 0) + 3 * COALESCE(m.saved, 0) + 5 * COALESCE(m.shares, 0)) AS nota,
             count(*) AS n
        FROM public.social_post_metrics m
       WHERE m.media_type = _midia AND m.posted_at > now() - interval '180 days'
       GROUP BY 1
    ) x
    WHERE h BETWEEN 7 AND 22 AND n >= 5
    ORDER BY nota DESC
    LIMIT 1;
  END IF;

  RETURN COALESCE(make_time(_hora, 0, 0), CASE _tipo WHEN 'carousel' THEN '11:30'::time WHEN 'static' THEN '12:00'::time ELSE '19:00'::time END);
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_melhor_hora(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_melhor_hora(uuid, text) TO service_role;

CREATE FUNCTION public.mesa_melhores_horarios(_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _amostra integer;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO _amostra FROM public.social_post_metrics WHERE client_id = _client_id AND posted_at > now() - interval '180 days';
  RETURN jsonb_build_object(
    'por_tipo', jsonb_build_object(
      'carousel', to_char(public.mesa_melhor_hora(_client_id, 'carousel'), 'HH24:MI'),
      'static', to_char(public.mesa_melhor_hora(_client_id, 'static'), 'HH24:MI'),
      'reel', to_char(public.mesa_melhor_hora(_client_id, 'reel'), 'HH24:MI')
    ),
    'fonte', CASE WHEN _amostra >= 6 THEN 'historico' ELSE 'padrao' END,
    'amostra', _amostra
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_melhores_horarios(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_melhores_horarios(uuid) TO authenticated;

-- O agendador da Entrega usa o melhor horário do tipo quando o horário
-- automático está ligado (padrão); a equipe continua podendo fixar a hora.
DO $patch$
DECLARE
  _fonte text;
  _alvo text := '_hora := COALESCE(_hora, ''09:00''::time);';
BEGIN
  SELECT pg_get_functiondef('public.mesa_agendar_aprovados()'::regprocedure) INTO _fonte;
  IF position(_alvo IN _fonte) = 0 THEN
    RAISE EXCEPTION 'patch mesa_agendar_aprovados: alvo nao encontrado';
  END IF;
  EXECUTE replace(_fonte, _alvo,
    'IF COALESCE((SELECT c.horario_automatico FROM public.mesa_cliente_config c WHERE c.client_id = _t.client_id), true) THEN
          _hora := public.mesa_melhor_hora(_t.client_id, CASE WHEN cardinality(_t.file_ids) > 1 THEN ''carousel'' ELSE ''static'' END);
        END IF;
        _hora := COALESCE(_hora, ''09:00''::time);');
END
$patch$;

-- ─── 5) Liga e desliga o horário automático (admin e gestor) ────────────
CREATE FUNCTION public.mesa_config_horario_automatico(_client_id uuid, _ligado boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL
    OR NOT (public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'manager'::public.app_role))
    OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'só admin ou gestor com acesso ao cliente muda este ajuste' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.mesa_cliente_config (client_id, horario_automatico, atualizado_em, atualizado_por)
  VALUES (_client_id, COALESCE(_ligado, true), now(), _uid)
  ON CONFLICT (client_id) DO UPDATE SET horario_automatico = EXCLUDED.horario_automatico, atualizado_em = now(), atualizado_por = _uid;
  RETURN jsonb_build_object('horario_automatico', COALESCE(_ligado, true));
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_config_horario_automatico(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_config_horario_automatico(uuid, boolean) TO authenticated;
