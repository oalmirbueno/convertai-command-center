-- Frente SUP (01/10/2026): Aceleriq Motores, o supervisor invisível com instalador.
--
-- Pedido do dono: "sempre que eu abrir o painel, dê para instalar as dependências
-- em qualquer computador... e este tem que abrir junto, mas sem ficar com os
-- terminais abertos". Esta migration dá ao painel:
--
-- 1) motores_maquinas: cada computador com os motores (render, código, navegador),
--    nome, versão, último sinal e o estado de cada motor; "Remover máquina" revoga.
-- 2) motores_pareamentos: código de pareamento de uso único (10 min), gerado só por
--    admin, guardado SÓ como HMAC (o código em si nunca fica no banco), revogável.
-- 3) motores_tentativas: limite de tentativas da troca do código (por origem e geral).
-- 4) motores_versoes + bucket privado motores-pacotes: o pacote dos workers por versão.
-- 5) motores_auditoria: quem gerou, qual máquina usou, quando; recusas; remoções.
--
-- RPCs:
-- * service_role (função motores-parear e o supervisor das máquinas):
--   motores_pareamento_criar, motores_pareamento_trocar, motores_maquina_sinal,
--   motores_versao_publicar.
-- * admin (tela Configurações › Estado dos motores): motores_admin_painel,
--   motores_admin_maquina_motores, motores_admin_maquina_remover,
--   motores_admin_pareamento_revogar.
--
-- Segurança: nada aqui guarda chave. A chave de serviço vai para a máquina uma vez,
-- pela função motores-parear (HTTPS), e fica no cofre DPAPI do Windows. Remover a
-- máquina faz o supervisor dela parar e apagar o cofre na próxima batida; para
-- invalidar a chave em si (máquina perdida ou roubada), troque a chave de serviço
-- no Supabase (docs/motores/ACELERIQ-MOTORES.md, seção Segurança).
--
-- Idempotente, só amplia. RLS ligada em tudo; leitura só por admin, escrita só por RPC.

-- ─── 1) Máquinas ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.motores_maquinas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 80),
  hostname text CHECK (hostname IS NULL OR char_length(hostname) <= 80),
  sistema text NOT NULL DEFAULT 'windows' CHECK (sistema IN ('windows', 'macos', 'linux')),
  motores text[] NOT NULL DEFAULT ARRAY['render', 'codigo', 'navegador']::text[]
    CHECK (motores <@ ARRAY['render', 'codigo', 'navegador']::text[]),
  -- O que o supervisor disse na última batida: situação de cada motor, pausa, atualização.
  estado jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(estado) = 'object' AND pg_column_size(estado) <= 12000),
  -- Nome de cada worker desta máquina em render_workers, motor_executores e computador_executores.
  executores jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(executores) = 'object' AND pg_column_size(executores) <= 2000),
  versao text CHECK (versao IS NULL OR char_length(versao) <= 40),
  ultimo_sinal timestamptz,
  origem text NOT NULL DEFAULT 'pareamento' CHECK (origem IN ('pareamento', 'migracao')),
  pareamento_id uuid,
  criada_por uuid,
  criada_em timestamptz NOT NULL DEFAULT now(),
  revogada_em timestamptz,
  revogada_por uuid
);

CREATE INDEX IF NOT EXISTS motores_maquinas_ativas_idx ON public.motores_maquinas (ultimo_sinal DESC) WHERE revogada_em IS NULL;

-- ─── 2) Códigos de pareamento (só o HMAC) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.motores_pareamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_hash text NOT NULL UNIQUE CHECK (codigo_hash ~ '^[0-9a-f]{64}$'),
  nome_sugerido text CHECK (nome_sugerido IS NULL OR char_length(nome_sugerido) <= 80),
  motores text[] NOT NULL DEFAULT ARRAY['render', 'codigo', 'navegador']::text[]
    CHECK (motores <@ ARRAY['render', 'codigo', 'navegador']::text[]),
  criado_por uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  maquina_id uuid REFERENCES public.motores_maquinas(id) ON DELETE SET NULL,
  revogado_em timestamptz,
  revogado_por uuid,
  CHECK (expira_em > criado_em AND expira_em <= criado_em + interval '30 minutes')
);

CREATE INDEX IF NOT EXISTS motores_pareamentos_abertos_idx ON public.motores_pareamentos (criado_em DESC) WHERE usado_em IS NULL AND revogado_em IS NULL;

-- ─── 3) Tentativas de troca (limite) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.motores_tentativas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origem_hash text NOT NULL CHECK (char_length(origem_hash) BETWEEN 8 AND 128),
  ok boolean NOT NULL DEFAULT false,
  em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS motores_tentativas_origem_idx ON public.motores_tentativas (origem_hash, em DESC);
CREATE INDEX IF NOT EXISTS motores_tentativas_em_idx ON public.motores_tentativas (em DESC);

-- ─── 4) Versões publicadas dos workers ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.motores_versoes (
  versao text PRIMARY KEY CHECK (versao ~ '^[0-9a-f]{10}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  caminho text NOT NULL CHECK (caminho ~ '^[0-9a-f]{10}/[A-Za-z0-9._-]{1,80}\.zip$'),
  tamanho bigint CHECK (tamanho IS NULL OR tamanho BETWEEN 1 AND 524288000),
  notas text CHECK (notas IS NULL OR char_length(notas) <= 500),
  publicada_por text CHECK (publicada_por IS NULL OR char_length(publicada_por) <= 80),
  publicada_em timestamptz NOT NULL DEFAULT now(),
  -- Retirada: nenhuma máquina troca para ela (a anterior volta a ser a alvo).
  retirada_em timestamptz
);

CREATE INDEX IF NOT EXISTS motores_versoes_vigente_idx ON public.motores_versoes (publicada_em DESC) WHERE retirada_em IS NULL;

-- ─── 5) Auditoria ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.motores_auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  em timestamptz NOT NULL DEFAULT now(),
  acao text NOT NULL CHECK (acao IN (
    'codigo_gerado', 'codigo_usado', 'codigo_recusado', 'codigo_revogado',
    'maquina_registrada', 'maquina_removida', 'motores_trocados', 'maquina_atualizada', 'versao_publicada'
  )),
  ator uuid,
  maquina_id uuid,
  pareamento_id uuid,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detalhes) = 'object' AND pg_column_size(detalhes) <= 4000)
);

CREATE INDEX IF NOT EXISTS motores_auditoria_em_idx ON public.motores_auditoria (em DESC);

-- ─── RLS: tudo fechado; admin lê máquinas e auditoria; escrita só pelas RPCs ─────
ALTER TABLE public.motores_maquinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motores_pareamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motores_tentativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motores_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motores_auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS motores_maquinas_admin_le ON public.motores_maquinas;
CREATE POLICY motores_maquinas_admin_le ON public.motores_maquinas
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS motores_versoes_admin_le ON public.motores_versoes;
CREATE POLICY motores_versoes_admin_le ON public.motores_versoes
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS motores_auditoria_admin_le ON public.motores_auditoria;
CREATE POLICY motores_auditoria_admin_le ON public.motores_auditoria
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- Pareamentos e tentativas: ninguém lê pela API (nem admin: o hash não sai do banco).
REVOKE ALL ON public.motores_maquinas, public.motores_pareamentos, public.motores_tentativas, public.motores_versoes, public.motores_auditoria FROM anon, authenticated;
GRANT SELECT ON public.motores_maquinas, public.motores_versoes, public.motores_auditoria TO authenticated;
GRANT ALL ON public.motores_maquinas, public.motores_pareamentos, public.motores_tentativas, public.motores_versoes, public.motores_auditoria TO service_role;

-- ─── Bucket privado dos pacotes: só a chave de serviço (publicar e as máquinas) ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('motores-pacotes', 'motores-pacotes', false, 524288000, ARRAY['application/zip', 'application/x-zip-compressed', 'application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public = false;

-- ─── Helpers ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_private.motores_exigir_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT COALESCE(public.has_role(_uid, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MOTORES_SO_ADMIN';
  END IF;
  RETURN _uid;
END;
$body$;

REVOKE ALL ON FUNCTION app_private.motores_exigir_admin() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.motores_limpar_motores(_motores text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $body$
  SELECT COALESCE(array_agg(m ORDER BY array_position(ARRAY['render', 'codigo', 'navegador'], m)), ARRAY[]::text[])
  FROM (SELECT DISTINCT m FROM unnest(COALESCE(_motores, ARRAY[]::text[])) AS m WHERE m IN ('render', 'codigo', 'navegador')) AS x;
$body$;

REVOKE ALL ON FUNCTION app_private.motores_limpar_motores(text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.motores_versao_alvo()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
  SELECT jsonb_build_object('versao', v.versao, 'sha256', v.sha256, 'caminho', v.caminho, 'tamanho', v.tamanho, 'publicada_em', v.publicada_em)
  FROM public.motores_versoes AS v
  WHERE v.retirada_em IS NULL
  ORDER BY v.publicada_em DESC
  LIMIT 1;
$body$;

REVOKE ALL ON FUNCTION app_private.motores_versao_alvo() FROM PUBLIC, anon, authenticated;

-- ─── RPCs da função motores-parear (service_role) ────────────────────────────────

-- Guarda um código novo (a função gera o código e manda só o HMAC). Até 5 abertos por admin.
CREATE OR REPLACE FUNCTION public.motores_pareamento_criar(_hash text, _ator uuid, _nome text, _motores text[], _minutos integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _id uuid;
  _expira timestamptz;
  _abertos integer;
  _motores_limpos text[] := app_private.motores_limpar_motores(_motores);
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MOTORES_SO_SERVIDOR';
  END IF;
  IF _hash IS NULL OR _hash !~ '^[0-9a-f]{64}$' OR _ator IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MOTORES_CODIGO_INVALIDO';
  END IF;
  IF cardinality(_motores_limpos) = 0 THEN
    _motores_limpos := ARRAY['render', 'codigo', 'navegador'];
  END IF;
  SELECT count(*) INTO _abertos
  FROM public.motores_pareamentos AS p
  WHERE p.criado_por = _ator AND p.usado_em IS NULL AND p.revogado_em IS NULL AND p.expira_em > now();
  IF _abertos >= 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MOTORES_CODIGOS_DEMAIS';
  END IF;
  _expira := now() + make_interval(mins => LEAST(GREATEST(COALESCE(_minutos, 10), 1), 30));
  INSERT INTO public.motores_pareamentos (codigo_hash, nome_sugerido, motores, criado_por, expira_em)
  VALUES (_hash, NULLIF(left(btrim(COALESCE(_nome, '')), 80), ''), _motores_limpos, _ator, _expira)
  RETURNING id INTO _id;
  INSERT INTO public.motores_auditoria (acao, ator, pareamento_id, detalhes)
  VALUES ('codigo_gerado', _ator, _id, jsonb_build_object('expira_em', _expira, 'nome', NULLIF(left(btrim(COALESCE(_nome, '')), 80), ''), 'motores', to_jsonb(_motores_limpos)));
  RETURN jsonb_build_object('id', _id, 'expira_em', _expira, 'motores', to_jsonb(_motores_limpos));
END;
$body$;

-- Troca o código pela máquina. Uma vez só, dentro do prazo, não revogado, com limite de tentativas.
-- Devolve {ok, motivo?, maquina_id?, nome?, motores?}. Quem devolve a chave é a função, só com ok.
CREATE OR REPLACE FUNCTION public.motores_pareamento_trocar(_hash text, _origem text, _nome text, _hostname text, _sistema text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _p public.motores_pareamentos%ROWTYPE;
  _maquina uuid;
  _nome_final text;
  _origem_limpa text := left(COALESCE(NULLIF(btrim(_origem), ''), 'sem-origem'), 128);
  _motivo text;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MOTORES_SO_SERVIDOR';
  END IF;
  IF char_length(_origem_limpa) < 8 THEN
    _origem_limpa := rpad(_origem_limpa, 8, '-');
  END IF;
  -- Tentativas velhas saem (o limite olha 15 min; um dia de histórico basta).
  DELETE FROM public.motores_tentativas WHERE em < now() - interval '1 day';
  -- Limite: 8 erros por origem em 15 min, 60 erros no total em 15 min.
  IF (SELECT count(*) FROM public.motores_tentativas t WHERE t.origem_hash = _origem_limpa AND NOT t.ok AND t.em > now() - interval '15 minutes') >= 8
     OR (SELECT count(*) FROM public.motores_tentativas t WHERE NOT t.ok AND t.em > now() - interval '15 minutes') >= 60 THEN
    INSERT INTO public.motores_tentativas (origem_hash, ok) VALUES (_origem_limpa, false);
    RETURN jsonb_build_object('ok', false, 'motivo', 'muitas_tentativas');
  END IF;

  IF _hash IS NOT NULL AND _hash ~ '^[0-9a-f]{64}$' THEN
    SELECT * INTO _p FROM public.motores_pareamentos AS p WHERE p.codigo_hash = _hash FOR UPDATE;
  END IF;
  IF _p.id IS NULL THEN
    _motivo := 'codigo_invalido';
  ELSIF _p.usado_em IS NOT NULL THEN
    _motivo := 'ja_usado';
  ELSIF _p.revogado_em IS NOT NULL THEN
    _motivo := 'revogado';
  ELSIF _p.expira_em <= now() THEN
    _motivo := 'expirado';
  END IF;

  IF _motivo IS NOT NULL THEN
    INSERT INTO public.motores_tentativas (origem_hash, ok) VALUES (_origem_limpa, false);
    INSERT INTO public.motores_auditoria (acao, pareamento_id, detalhes)
    VALUES ('codigo_recusado', _p.id, jsonb_build_object('motivo', _motivo, 'hostname', left(COALESCE(_hostname, ''), 80)));
    RETURN jsonb_build_object('ok', false, 'motivo', _motivo);
  END IF;

  _nome_final := left(COALESCE(NULLIF(btrim(_p.nome_sugerido), ''), NULLIF(btrim(_nome), ''), NULLIF(btrim(_hostname), ''), 'Máquina'), 80);
  INSERT INTO public.motores_maquinas (nome, hostname, sistema, motores, origem, pareamento_id, criada_por)
  VALUES (
    _nome_final,
    NULLIF(left(btrim(COALESCE(_hostname, '')), 80), ''),
    CASE WHEN _sistema IN ('windows', 'macos', 'linux') THEN _sistema ELSE 'windows' END,
    _p.motores,
    'pareamento',
    _p.id,
    _p.criado_por
  )
  RETURNING id INTO _maquina;
  UPDATE public.motores_pareamentos SET usado_em = now(), maquina_id = _maquina WHERE id = _p.id;
  INSERT INTO public.motores_tentativas (origem_hash, ok) VALUES (_origem_limpa, true);
  INSERT INTO public.motores_auditoria (acao, ator, maquina_id, pareamento_id, detalhes)
  VALUES ('codigo_usado', _p.criado_por, _maquina, _p.id, jsonb_build_object('nome', _nome_final, 'hostname', left(COALESCE(_hostname, ''), 80), 'sistema', _sistema));
  RETURN jsonb_build_object('ok', true, 'maquina_id', _maquina, 'nome', _nome_final, 'motores', to_jsonb(_p.motores));
END;
$body$;

-- ─── Batida da máquina (supervisor, service_role) ────────────────────────────────
-- _maquina NULL: máquina migrada (modo migrar-desta-maquina) se registra na primeira batida.
CREATE OR REPLACE FUNCTION public.motores_maquina_sinal(
  _maquina uuid, _nome text, _hostname text, _sistema text, _versao text, _estado jsonb, _executores jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _m public.motores_maquinas%ROWTYPE;
  _estado_limpo jsonb := CASE WHEN jsonb_typeof(_estado) = 'object' AND pg_column_size(_estado) <= 12000 THEN _estado ELSE '{}'::jsonb END;
  _exec_limpo jsonb := CASE WHEN jsonb_typeof(_executores) = 'object' AND pg_column_size(_executores) <= 2000 THEN _executores ELSE '{}'::jsonb END;
  _versao_limpa text := NULLIF(left(btrim(COALESCE(_versao, '')), 40), '');
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MOTORES_SO_SERVIDOR';
  END IF;
  IF _maquina IS NOT NULL THEN
    SELECT * INTO _m FROM public.motores_maquinas WHERE id = _maquina FOR UPDATE;
  END IF;
  IF _m.id IS NULL THEN
    -- Id desconhecido também cai aqui (banco restaurado): registra de novo, sem herdar nada.
    INSERT INTO public.motores_maquinas (nome, hostname, sistema, origem, versao, ultimo_sinal, estado, executores)
    VALUES (
      left(COALESCE(NULLIF(btrim(_nome), ''), NULLIF(btrim(_hostname), ''), 'Máquina'), 80),
      NULLIF(left(btrim(COALESCE(_hostname, '')), 80), ''),
      CASE WHEN _sistema IN ('windows', 'macos', 'linux') THEN _sistema ELSE 'windows' END,
      'migracao', _versao_limpa, now(), _estado_limpo, _exec_limpo
    )
    RETURNING * INTO _m;
    INSERT INTO public.motores_auditoria (acao, maquina_id, detalhes)
    VALUES ('maquina_registrada', _m.id, jsonb_build_object('nome', _m.nome, 'hostname', _m.hostname, 'origem', 'migracao', 'id_antigo', _maquina));
  ELSIF _m.revogada_em IS NOT NULL THEN
    RETURN jsonb_build_object('maquina_id', _m.id, 'revogada', true);
  ELSE
    IF _versao_limpa IS DISTINCT FROM _m.versao AND _m.versao IS NOT NULL AND _versao_limpa IS NOT NULL THEN
      INSERT INTO public.motores_auditoria (acao, maquina_id, detalhes)
      VALUES ('maquina_atualizada', _m.id, jsonb_build_object('de', _m.versao, 'para', _versao_limpa));
    END IF;
    UPDATE public.motores_maquinas
       SET ultimo_sinal = now(),
           versao = COALESCE(_versao_limpa, versao),
           estado = _estado_limpo,
           executores = _exec_limpo,
           hostname = COALESCE(NULLIF(left(btrim(COALESCE(_hostname, '')), 80), ''), hostname)
     WHERE id = _m.id
     RETURNING * INTO _m;
  END IF;
  RETURN jsonb_build_object(
    'maquina_id', _m.id,
    'revogada', false,
    'nome', _m.nome,
    'motores', to_jsonb(_m.motores),
    'versao_alvo', app_private.motores_versao_alvo()
  );
END;
$body$;

-- ─── Publicação de versão (npm run publicar, service_role) ───────────────────────
CREATE OR REPLACE FUNCTION public.motores_versao_publicar(_versao text, _sha256 text, _caminho text, _tamanho bigint, _notas text, _por text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MOTORES_SO_SERVIDOR';
  END IF;
  INSERT INTO public.motores_versoes (versao, sha256, caminho, tamanho, notas, publicada_por)
  VALUES (_versao, _sha256, _caminho, _tamanho, NULLIF(left(btrim(COALESCE(_notas, '')), 500), ''), NULLIF(left(btrim(COALESCE(_por, '')), 80), ''))
  ON CONFLICT (versao) DO UPDATE
    SET sha256 = EXCLUDED.sha256, caminho = EXCLUDED.caminho, tamanho = EXCLUDED.tamanho,
        notas = COALESCE(EXCLUDED.notas, public.motores_versoes.notas),
        publicada_por = EXCLUDED.publicada_por, publicada_em = now(), retirada_em = NULL;
  INSERT INTO public.motores_auditoria (acao, detalhes)
  VALUES ('versao_publicada', jsonb_build_object('versao', _versao, 'tamanho', _tamanho, 'por', left(COALESCE(_por, ''), 80)));
  RETURN app_private.motores_versao_alvo();
END;
$body$;

-- ─── RPCs do admin (tela) ────────────────────────────────────────────────────────

-- Tudo o que a tela mostra, numa leitura: máquinas, códigos abertos (sem hash), versão vigente, auditoria.
CREATE OR REPLACE FUNCTION public.motores_admin_painel()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
BEGIN
  PERFORM app_private.motores_exigir_admin();
  RETURN jsonb_build_object(
    'maquinas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'nome', m.nome, 'hostname', m.hostname, 'sistema', m.sistema, 'motores', to_jsonb(m.motores),
        'estado', m.estado, 'executores', m.executores, 'versao', m.versao, 'ultimo_sinal', m.ultimo_sinal,
        'origem', m.origem, 'criada_em', m.criada_em,
        'criada_por_nome', (SELECT left(COALESCE(NULLIF(btrim(pr.full_name), ''), 'admin'), 80) FROM public.profiles pr WHERE pr.id = m.criada_por)
      ) ORDER BY m.ultimo_sinal DESC NULLS LAST, m.criada_em DESC)
      FROM public.motores_maquinas AS m
      WHERE m.revogada_em IS NULL
    ), '[]'::jsonb),
    'codigos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome_sugerido', p.nome_sugerido, 'motores', to_jsonb(p.motores), 'criado_em', p.criado_em, 'expira_em', p.expira_em,
        'criado_por_nome', (SELECT left(COALESCE(NULLIF(btrim(pr.full_name), ''), 'admin'), 80) FROM public.profiles pr WHERE pr.id = p.criado_por)
      ) ORDER BY p.criado_em DESC)
      FROM public.motores_pareamentos AS p
      WHERE p.usado_em IS NULL AND p.revogado_em IS NULL AND p.expira_em > now()
    ), '[]'::jsonb),
    'versao', app_private.motores_versao_alvo(),
    'auditoria', COALESCE((
      SELECT jsonb_agg(x.j ORDER BY x.em DESC)
      FROM (
        SELECT a.em, jsonb_build_object(
          'em', a.em, 'acao', a.acao, 'maquina_id', a.maquina_id, 'detalhes', a.detalhes,
          'ator_nome', (SELECT left(COALESCE(NULLIF(btrim(pr.full_name), ''), 'admin'), 80) FROM public.profiles pr WHERE pr.id = a.ator)
        ) AS j
        FROM public.motores_auditoria AS a
        ORDER BY a.em DESC
        LIMIT 30
      ) AS x
    ), '[]'::jsonb)
  );
END;
$body$;

-- Quais motores rodam numa máquina (numa máquina fraca, só o navegador, por exemplo).
CREATE OR REPLACE FUNCTION public.motores_admin_maquina_motores(_maquina uuid, _motores text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _ator uuid := app_private.motores_exigir_admin();
  _limpos text[] := app_private.motores_limpar_motores(_motores);
  _antes text[];
BEGIN
  SELECT motores INTO _antes FROM public.motores_maquinas WHERE id = _maquina AND revogada_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MOTORES_MAQUINA_NAO_ENCONTRADA';
  END IF;
  UPDATE public.motores_maquinas SET motores = _limpos WHERE id = _maquina;
  INSERT INTO public.motores_auditoria (acao, ator, maquina_id, detalhes)
  VALUES ('motores_trocados', _ator, _maquina, jsonb_build_object('de', to_jsonb(_antes), 'para', to_jsonb(_limpos)));
  RETURN jsonb_build_object('id', _maquina, 'motores', to_jsonb(_limpos));
END;
$body$;

-- Remover máquina = revogar: na próxima batida o supervisor dela para com calma e apaga o cofre local.
CREATE OR REPLACE FUNCTION public.motores_admin_maquina_remover(_maquina uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _ator uuid := app_private.motores_exigir_admin();
  _nome text;
BEGIN
  UPDATE public.motores_maquinas SET revogada_em = now(), revogada_por = _ator
   WHERE id = _maquina AND revogada_em IS NULL
  RETURNING nome INTO _nome;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MOTORES_MAQUINA_NAO_ENCONTRADA';
  END IF;
  INSERT INTO public.motores_auditoria (acao, ator, maquina_id, detalhes)
  VALUES ('maquina_removida', _ator, _maquina, jsonb_build_object('nome', _nome));
  RETURN jsonb_build_object('id', _maquina, 'revogada', true);
END;
$body$;

CREATE OR REPLACE FUNCTION public.motores_admin_pareamento_revogar(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _ator uuid := app_private.motores_exigir_admin();
BEGIN
  UPDATE public.motores_pareamentos SET revogado_em = now(), revogado_por = _ator
   WHERE id = _id AND usado_em IS NULL AND revogado_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MOTORES_CODIGO_NAO_ENCONTRADO';
  END IF;
  INSERT INTO public.motores_auditoria (acao, ator, pareamento_id, detalhes)
  VALUES ('codigo_revogado', _ator, _id, '{}'::jsonb);
  RETURN jsonb_build_object('id', _id, 'revogado', true);
END;
$body$;

-- ─── Permissões das RPCs ─────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.motores_pareamento_criar(text, uuid, text, text[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.motores_pareamento_trocar(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.motores_maquina_sinal(uuid, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.motores_versao_publicar(text, text, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.motores_admin_painel() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.motores_admin_maquina_motores(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.motores_admin_maquina_remover(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.motores_admin_pareamento_revogar(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.motores_pareamento_criar(text, uuid, text, text[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.motores_pareamento_trocar(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.motores_maquina_sinal(uuid, text, text, text, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.motores_versao_publicar(text, text, text, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.motores_admin_painel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.motores_admin_maquina_motores(uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.motores_admin_maquina_remover(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.motores_admin_pareamento_revogar(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.motores_maquinas IS
  'Frente SUP: computadores com o Aceleriq Motores (supervisor invisível dos workers). Admin lê; escrita só pelas RPCs motores_*.';
COMMENT ON TABLE public.motores_pareamentos IS
  'Frente SUP: códigos de pareamento de uso único (10 min). Só o HMAC do código fica aqui; ninguém lê pela API.';
COMMENT ON TABLE public.motores_versoes IS
  'Frente SUP: pacotes dos workers por versão (hash da árvore workers/ no git), no bucket privado motores-pacotes.';

NOTIFY pgrst, 'reload schema';
