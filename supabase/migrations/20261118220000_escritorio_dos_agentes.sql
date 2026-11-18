-- Escritório da Aceleriq (18/11/2026): a camada que deixa qualquer agente, de qualquer plataforma,
-- saber quem ele é, quem são os outros e conversar com eles pelo MCP do Aceleriq OS.
--
-- O que entra:
--  1) origem 'openbot' (o Fred e os agentes do OpenBot) no cadastro dos operadores.
--  2) grau do operador: orquestrador, coordenador, executor ou leitor. O dono é sempre gente, nunca operador.
--  3) Salas por área (escritorio_grupos + membros), conversas e mensagens de agente para agente,
--     leituras (caixa de entrada), presença (batimento) e automações (workflows do n8n, com dono).
--  4) Bloquear e desbloquear um agente (tira a credencial dele na hora e guarda o que tirou, para desfazer)
--     e ligar uma credencial a um agente. Só o dono (admin).
--
-- O que NÃO entra: nenhuma mensagem a cliente, nenhum gasto, nenhuma publicação, nada no financeiro.
-- Nenhum segredo é gravado aqui: o MCP recusa mensagem que pareça ter senha, token ou chave.
-- Escrita dos agentes só pelo MCP (service_role). A equipe lê; o dono escreve pela tela.

-- ───────────────────────── 1) origem openbot ─────────────────────────
ALTER TABLE public.internal_operators DROP CONSTRAINT IF EXISTS internal_operators_origem_check;
ALTER TABLE public.internal_operators
  ADD CONSTRAINT internal_operators_origem_check
  CHECK (origem IN ('hermes', 'grok', 'paperclip', 'n8n', 'claude_code', 'codex', 'chatgpt', 'openbot'));

CREATE OR REPLACE FUNCTION app_private.operador_origem_no_cadastro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  _prefixo text := split_part(COALESCE(NEW.hermes_profile_ref, ''), ':', 1);
BEGIN
  IF NEW.origem IS NULL OR NEW.origem = 'hermes' THEN
    NEW.origem := CASE
      WHEN _prefixo IN ('grok', 'n8n', 'claude_code', 'codex', 'chatgpt', 'paperclip', 'openbot') THEN _prefixo
      WHEN NEW.parent_slug = 'paperclip' THEN 'paperclip'
      ELSE 'hermes'
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Quem já estava cadastrado com a referência "openbot:..." passa a ter a origem certa.
UPDATE public.internal_operators
   SET origem = 'openbot'
 WHERE split_part(COALESCE(hermes_profile_ref, ''), ':', 1) = 'openbot'
   AND origem IS DISTINCT FROM 'openbot';

-- ───────────────────────── 2) grau ─────────────────────────
ALTER TABLE public.internal_operators
  ADD COLUMN IF NOT EXISTS grau text NOT NULL DEFAULT 'executor';
ALTER TABLE public.internal_operators DROP CONSTRAINT IF EXISTS internal_operators_grau_check;
ALTER TABLE public.internal_operators
  ADD CONSTRAINT internal_operators_grau_check
  CHECK (grau IN ('orquestrador', 'coordenador', 'executor', 'leitor'));

COMMENT ON COLUMN public.internal_operators.grau IS
  'Escritório: orquestrador fala com todos; coordenador, com a própria área e os orquestradores; executor, com o coordenador e as salas dele; leitor só lê e manda alerta. O dono é gente, não operador.';

-- Ponto de partida (o dono ajusta na tela): os dois orquestradores, quem já coordena, e as automações só leem.
UPDATE public.internal_operators SET grau = 'orquestrador'
 WHERE grau = 'executor' AND (slug IN ('default', 'jori') OR hermes_profile_ref = 'grok:jori');
UPDATE public.internal_operators SET grau = 'coordenador'
 WHERE grau = 'executor' AND is_coordinator;
UPDATE public.internal_operators SET grau = 'leitor'
 WHERE grau = 'executor' AND origem = 'n8n';

-- ───────────────────────── 3) salas ─────────────────────────
CREATE TABLE IF NOT EXISTS public.escritorio_grupos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{1,38}$'),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 80),
  area text,
  descricao text CHECK (descricao IS NULL OR char_length(descricao) <= 400),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.escritorio_grupo_membros (
  grupo_id uuid NOT NULL REFERENCES public.escritorio_grupos(id) ON DELETE CASCADE,
  operator_slug text NOT NULL CHECK (operator_slug ~ '^[a-z][a-z0-9-]{1,38}$'),
  papel text NOT NULL DEFAULT 'membro' CHECK (papel IN ('dono_da_sala', 'membro', 'observador')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (grupo_id, operator_slug)
);
CREATE INDEX IF NOT EXISTS escritorio_grupo_membros_slug_idx ON public.escritorio_grupo_membros (operator_slug);

INSERT INTO public.escritorio_grupos (slug, nome, area, descricao) VALUES
  ('coordenacao', 'Coordenação', NULL, 'Orquestradores e coordenadores: prioridade do dia, repasse entre áreas e o que precisa do dono.'),
  ('conteudo', 'Conteúdo', 'Conteúdo', 'Social media, calendário, mesas e conversas dos grupos dos clientes.'),
  ('trafego', 'Tráfego', 'Tráfego', 'Anúncios: um dono (Trafe), vigia e reserva. Só leitura e rascunho sem aprovação.'),
  ('comercial', 'Comercial', 'Comercial', 'Prospecção, respostas, propostas e repasses.'),
  ('video', 'Vídeo', 'Vídeo', 'Roteiro, corte, montagem e entrega de vídeo.'),
  ('tecnologia', 'Tecnologia', 'Tecnologia', 'Integrações, código, automações e saúde dos sistemas.')
ON CONFLICT (slug) DO NOTHING;

-- Membros de partida, pela área de cada operador ativo. O dono ajusta na tela.
INSERT INTO public.escritorio_grupo_membros (grupo_id, operator_slug)
SELECT g.id, o.slug
  FROM public.internal_operators o
  JOIN public.escritorio_grupos g ON (
       (g.slug = 'coordenacao' AND o.grau IN ('orquestrador', 'coordenador'))
    OR (g.slug = 'conteudo'    AND o.area ~* 'conte')
    OR (g.slug = 'trafego'     AND o.area ~* '(tr[aá]fego|an[uú]ncio|ads)')
    OR (g.slug = 'comercial'   AND o.area ~* 'comerc')
    OR (g.slug = 'video'       AND o.area ~* 'v[ií]deo')
    OR (g.slug = 'tecnologia'  AND o.area ~* '(tecno|integra|infra|c[oó]digo)')
  )
 WHERE o.status = 'active' AND o.slug ~ '^[a-z][a-z0-9-]{1,38}$'
ON CONFLICT DO NOTHING;

-- ───────────────────────── 4) conversas e mensagens ─────────────────────────
CREATE TABLE IF NOT EXISTS public.escritorio_conversas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('direta', 'grupo')),
  grupo_id uuid REFERENCES public.escritorio_grupos(id) ON DELETE SET NULL,
  assunto text CHECK (assunto IS NULL OR char_length(assunto) <= 160),
  client_id uuid,
  task_id uuid,
  criada_por text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ultima_em timestamptz NOT NULL DEFAULT now(),
  CHECK (tipo = 'grupo' OR grupo_id IS NULL)
);
CREATE INDEX IF NOT EXISTS escritorio_conversas_ultima_idx ON public.escritorio_conversas (ultima_em DESC);
CREATE INDEX IF NOT EXISTS escritorio_conversas_task_idx ON public.escritorio_conversas (task_id) WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.escritorio_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL REFERENCES public.escritorio_conversas(id) ON DELETE CASCADE,
  -- 'dono' é o lugar reservado da pessoa: nenhum operador usa esse slug.
  de_slug text NOT NULL CHECK (de_slug ~ '^[a-z][a-z0-9-]{1,38}$'),
  de_tipo text NOT NULL DEFAULT 'operador' CHECK (de_tipo IN ('operador', 'humano')),
  autor_id uuid,
  para_slug text CHECK (para_slug IS NULL OR para_slug ~ '^[a-z][a-z0-9-]{1,38}$'),
  grupo_id uuid REFERENCES public.escritorio_grupos(id) ON DELETE SET NULL,
  corpo text NOT NULL CHECK (char_length(corpo) BETWEEN 1 AND 4000),
  responde_a uuid REFERENCES public.escritorio_mensagens(id) ON DELETE SET NULL,
  client_id uuid,
  task_id uuid,
  idempotency_key text CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((de_tipo = 'humano') = (de_slug = 'dono')),
  CHECK (para_slug IS NOT NULL OR grupo_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS escritorio_mensagens_repeticao_idx
  ON public.escritorio_mensagens (de_slug, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS escritorio_mensagens_conversa_idx ON public.escritorio_mensagens (conversa_id, created_at);
CREATE INDEX IF NOT EXISTS escritorio_mensagens_para_idx ON public.escritorio_mensagens (para_slug, created_at DESC) WHERE para_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS escritorio_mensagens_grupo_idx ON public.escritorio_mensagens (grupo_id, created_at DESC) WHERE grupo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS escritorio_mensagens_task_idx ON public.escritorio_mensagens (task_id, created_at) WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.escritorio_leituras (
  mensagem_id uuid NOT NULL REFERENCES public.escritorio_mensagens(id) ON DELETE CASCADE,
  leitor_slug text NOT NULL CHECK (leitor_slug ~ '^[a-z][a-z0-9-]{1,38}$'),
  lida_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mensagem_id, leitor_slug)
);
CREATE INDEX IF NOT EXISTS escritorio_leituras_leitor_idx ON public.escritorio_leituras (leitor_slug, lida_em DESC);

-- ───────────────────────── 5) presença e automações ─────────────────────────
CREATE TABLE IF NOT EXISTS public.escritorio_presenca (
  operator_slug text PRIMARY KEY CHECK (operator_slug ~ '^[a-z][a-z0-9-]{1,38}$'),
  batimento_em timestamptz NOT NULL DEFAULT now(),
  fazendo text CHECK (fazendo IS NULL OR char_length(fazendo) <= 240),
  plataforma text,
  client_id uuid,
  task_id uuid
);

CREATE TABLE IF NOT EXISTS public.escritorio_automacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plataforma text NOT NULL DEFAULT 'n8n' CHECK (plataforma IN ('n8n', 'hermes', 'paperclip', 'outro')),
  ref text NOT NULL CHECK (char_length(ref) BETWEEN 1 AND 120),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 160),
  o_que_faz text CHECK (o_que_faz IS NULL OR char_length(o_que_faz) <= 400),
  dono_slug text CHECK (dono_slug IS NULL OR dono_slug ~ '^[a-z][a-z0-9-]{1,38}$'),
  ativo boolean NOT NULL DEFAULT true,
  ultima_execucao_em timestamptz,
  ultimo_status text CHECK (ultimo_status IS NULL OR ultimo_status IN ('ok', 'erro', 'rodando')),
  ultimo_erro text CHECK (ultimo_erro IS NULL OR char_length(ultimo_erro) <= 600),
  ultimo_erro_em timestamptz,
  execucoes integer NOT NULL DEFAULT 0,
  erros integer NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plataforma, ref)
);

-- ───────────────────────── 6) bloqueio (guarda o que tirou, para desfazer) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.escritorio_bloqueios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_slug text NOT NULL,
  status_anterior text,
  vinculos jsonb NOT NULL DEFAULT '[]'::jsonb,
  chaves_desligadas uuid[] NOT NULL DEFAULT '{}',
  motivo text CHECK (motivo IS NULL OR char_length(motivo) <= 300),
  bloqueado_por uuid,
  bloqueado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz,
  desfeito_por uuid
);
CREATE INDEX IF NOT EXISTS escritorio_bloqueios_slug_idx ON public.escritorio_bloqueios (operator_slug, bloqueado_em DESC);

-- ───────────────────────── 7) acesso ─────────────────────────
-- A equipe lê tudo do Escritório. Agente escreve só pelo MCP (service_role). O dono escreve pela tela.
DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['escritorio_grupos', 'escritorio_grupo_membros', 'escritorio_conversas',
                            'escritorio_mensagens', 'escritorio_leituras', 'escritorio_presenca',
                            'escritorio_automacoes', 'escritorio_bloqueios'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', _t || '_equipe_le', _t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())))', _t || '_equipe_le', _t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', _t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', _t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', _t);
  END LOOP;
END $$;

-- O dono mexe nas salas, nos membros e no cadastro das automações direto pela tela.
DROP POLICY IF EXISTS escritorio_grupos_dono_escreve ON public.escritorio_grupos;
CREATE POLICY escritorio_grupos_dono_escreve ON public.escritorio_grupos
  FOR ALL TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));
GRANT INSERT, UPDATE, DELETE ON public.escritorio_grupos TO authenticated;

DROP POLICY IF EXISTS escritorio_grupo_membros_dono_escreve ON public.escritorio_grupo_membros;
CREATE POLICY escritorio_grupo_membros_dono_escreve ON public.escritorio_grupo_membros
  FOR ALL TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));
GRANT INSERT, UPDATE, DELETE ON public.escritorio_grupo_membros TO authenticated;

DROP POLICY IF EXISTS escritorio_automacoes_dono_escreve ON public.escritorio_automacoes;
CREATE POLICY escritorio_automacoes_dono_escreve ON public.escritorio_automacoes
  FOR UPDATE TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));
GRANT UPDATE (dono_slug, o_que_faz, nome) ON public.escritorio_automacoes TO authenticated;

-- ───────────────────────── 8) o dono fala, lê, bloqueia e liga credencial ─────────────────────────

-- O dono manda mensagem a um agente ou a uma sala. Sempre como 'dono'.
CREATE OR REPLACE FUNCTION public.escritorio_dono_enviar(
  _corpo text,
  _para text DEFAULT NULL,
  _grupo text DEFAULT NULL,
  _conversa_id uuid DEFAULT NULL,
  _assunto text DEFAULT NULL,
  _client_id uuid DEFAULT NULL,
  _task_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _eu uuid := auth.uid();
  _g public.escritorio_grupos%ROWTYPE;
  _c public.escritorio_conversas%ROWTYPE;
  _id uuid;
  _texto text := btrim(COALESCE(_corpo, ''));
BEGIN
  IF _eu IS NULL OR NOT public.has_role(_eu, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'so_o_dono' USING ERRCODE = '42501';
  END IF;
  IF char_length(_texto) < 1 OR char_length(_texto) > 4000 THEN
    RAISE EXCEPTION 'texto_invalido' USING ERRCODE = '22023';
  END IF;

  IF _conversa_id IS NOT NULL THEN
    SELECT * INTO _c FROM public.escritorio_conversas WHERE id = _conversa_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'conversa_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
    IF _c.tipo = 'grupo' THEN
      SELECT * INTO _g FROM public.escritorio_grupos WHERE id = _c.grupo_id;
    ELSIF _para IS NULL THEN
      -- Resposta numa conversa direta: vai para quem não é o dono.
      SELECT CASE WHEN m.de_slug = 'dono' THEN m.para_slug ELSE m.de_slug END INTO _para
        FROM public.escritorio_mensagens m WHERE m.conversa_id = _c.id ORDER BY m.created_at DESC LIMIT 1;
    END IF;
  ELSIF _grupo IS NOT NULL THEN
    SELECT * INTO _g FROM public.escritorio_grupos WHERE slug = lower(btrim(_grupo)) AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'sala_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO public.escritorio_conversas (tipo, grupo_id, assunto, client_id, task_id, criada_por)
    VALUES ('grupo', _g.id, NULLIF(btrim(COALESCE(_assunto, '')), ''), _client_id, _task_id, 'dono') RETURNING * INTO _c;
  ELSE
    IF _para IS NULL OR NOT EXISTS (SELECT 1 FROM public.internal_operators o WHERE o.slug = lower(btrim(_para))) THEN
      RAISE EXCEPTION 'agente_nao_encontrado' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO public.escritorio_conversas (tipo, assunto, client_id, task_id, criada_por)
    VALUES ('direta', NULLIF(btrim(COALESCE(_assunto, '')), ''), _client_id, _task_id, 'dono') RETURNING * INTO _c;
  END IF;

  INSERT INTO public.escritorio_mensagens (conversa_id, de_slug, de_tipo, autor_id, para_slug, grupo_id, corpo, client_id, task_id)
  VALUES (_c.id, 'dono', 'humano', _eu,
          CASE WHEN _c.tipo = 'direta' THEN lower(btrim(_para)) END,
          CASE WHEN _c.tipo = 'grupo' THEN _g.id END,
          _texto, COALESCE(_client_id, _c.client_id), COALESCE(_task_id, _c.task_id))
  RETURNING id INTO _id;
  UPDATE public.escritorio_conversas SET ultima_em = now() WHERE id = _c.id;
  RETURN jsonb_build_object('ok', true, 'mensagem_id', _id, 'conversa_id', _c.id);
END;
$$;

-- O dono marca como lidas as mensagens de uma conversa (ou todas as que são para ele).
CREATE OR REPLACE FUNCTION public.escritorio_dono_marcar_lidas(_conversa_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE _n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'so_o_dono' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.escritorio_leituras (mensagem_id, leitor_slug)
  SELECT m.id, 'dono' FROM public.escritorio_mensagens m
   WHERE m.de_slug <> 'dono'
     AND (_conversa_id IS NULL OR m.conversa_id = _conversa_id)
     AND (m.para_slug = 'dono' OR _conversa_id IS NOT NULL)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

-- Bloquear: pausa o agente, tira as credenciais que assinam por ele e desliga a chave que era só dele.
CREATE OR REPLACE FUNCTION public.escritorio_bloquear_agente(_slug text, _motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _eu uuid := auth.uid();
  _o public.internal_operators%ROWTYPE;
  _vinculos jsonb;
  _chaves uuid[];
BEGIN
  IF _eu IS NULL OR NOT public.has_role(_eu, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'so_o_dono' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _o FROM public.internal_operators WHERE slug = lower(btrim(_slug)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agente_nao_encontrado' USING ERRCODE = 'P0002'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('principal', b.principal, 'padrao', b.padrao, 'rotulo', b.rotulo)), '[]'::jsonb)
    INTO _vinculos FROM public.operator_key_bindings b WHERE b.operator_slug = _o.slug;

  -- Chave que só assinava por este agente: desliga. Chave dividida com outros agentes continua ligada para eles.
  SELECT COALESCE(array_agg(k.id), '{}') INTO _chaves
    FROM public.api_keys k
   WHERE k.is_active
     AND EXISTS (SELECT 1 FROM public.operator_key_bindings b WHERE b.principal = 'key:' || k.id::text AND b.operator_slug = _o.slug)
     AND NOT EXISTS (SELECT 1 FROM public.operator_key_bindings b WHERE b.principal = 'key:' || k.id::text AND b.operator_slug <> _o.slug);

  UPDATE public.api_keys SET is_active = false, revoked_at = now() WHERE id = ANY(_chaves);
  DELETE FROM public.operator_key_bindings WHERE operator_slug = _o.slug;
  UPDATE public.internal_operators SET status = 'paused' WHERE id = _o.id AND status = 'active';

  INSERT INTO public.escritorio_bloqueios (operator_slug, status_anterior, vinculos, chaves_desligadas, motivo, bloqueado_por)
  VALUES (_o.slug, _o.status, _vinculos, _chaves, NULLIF(btrim(COALESCE(_motivo, '')), ''), _eu);
  INSERT INTO public.operator_audit_log (actor, operator_id, action, old_status, new_status, evidence)
  VALUES ('humano:' || _eu::text, _o.id, 'escritorio_bloqueado', _o.status, 'paused',
          left('Bloqueado no Escritório. Credenciais desligadas: ' || COALESCE(array_length(_chaves, 1), 0)::text
               || '; vínculos retirados: ' || jsonb_array_length(_vinculos)::text
               || COALESCE('. Motivo: ' || NULLIF(btrim(COALESCE(_motivo, '')), ''), ''), 500));
  RETURN jsonb_build_object('ok', true, 'slug', _o.slug, 'chaves_desligadas', COALESCE(array_length(_chaves, 1), 0),
                            'vinculos_retirados', jsonb_array_length(_vinculos));
END;
$$;

-- Desbloquear: devolve os vínculos e o status de antes. Chave desligada NÃO volta: gera-se outra.
CREATE OR REPLACE FUNCTION public.escritorio_desbloquear_agente(_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _eu uuid := auth.uid();
  _o public.internal_operators%ROWTYPE;
  _b public.escritorio_bloqueios%ROWTYPE;
  _v jsonb;
  _voltaram integer := 0;
BEGIN
  IF _eu IS NULL OR NOT public.has_role(_eu, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'so_o_dono' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _o FROM public.internal_operators WHERE slug = lower(btrim(_slug)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agente_nao_encontrado' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO _b FROM public.escritorio_bloqueios
   WHERE operator_slug = _o.slug AND desfeito_em IS NULL ORDER BY bloqueado_em DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sem_bloqueio_aberto' USING ERRCODE = 'P0002'; END IF;

  FOR _v IN SELECT * FROM jsonb_array_elements(_b.vinculos) LOOP
    -- Só volta o vínculo de credencial que continua viva (a chave desligada no bloqueio fica de fora).
    IF (_v->>'principal') LIKE 'oauth:%' OR EXISTS (
      SELECT 1 FROM public.api_keys k WHERE 'key:' || k.id::text = _v->>'principal' AND k.is_active
    ) THEN
      INSERT INTO public.operator_key_bindings (principal, operator_slug, padrao, rotulo)
      VALUES (_v->>'principal', _o.slug,
              COALESCE((_v->>'padrao')::boolean, false)
                AND NOT EXISTS (SELECT 1 FROM public.operator_key_bindings x WHERE x.principal = _v->>'principal' AND x.padrao),
              _v->>'rotulo')
      ON CONFLICT DO NOTHING;
      _voltaram := _voltaram + 1;
    END IF;
  END LOOP;

  UPDATE public.internal_operators SET status = 'active'
   WHERE id = _o.id AND status = 'paused' AND COALESCE(_b.status_anterior, 'active') = 'active';
  UPDATE public.escritorio_bloqueios SET desfeito_em = now(), desfeito_por = _eu WHERE id = _b.id;
  INSERT INTO public.operator_audit_log (actor, operator_id, action, old_status, new_status, evidence)
  VALUES ('humano:' || _eu::text, _o.id, 'escritorio_desbloqueado', _o.status,
          (SELECT status FROM public.internal_operators WHERE id = _o.id),
          'Desbloqueado no Escritório. Vínculos devolvidos: ' || _voltaram::text);
  RETURN jsonb_build_object('ok', true, 'slug', _o.slug, 'vinculos_devolvidos', _voltaram,
                            'chaves_que_nao_voltam', COALESCE(array_length(_b.chaves_desligadas, 1), 0));
END;
$$;

-- Liga uma credencial (chave já criada no painel) a um agente: a partir daí ela assina e lê só por ele.
CREATE OR REPLACE FUNCTION public.escritorio_ligar_credencial(_key_id uuid, _slug text, _padrao boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _eu uuid := auth.uid();
  _principal text := 'key:' || _key_id::text;
  _s text := lower(btrim(_slug));
BEGIN
  IF _eu IS NULL OR NOT public.has_role(_eu, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'so_o_dono' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = _key_id AND k.is_active) THEN
    RAISE EXCEPTION 'credencial_nao_encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.internal_operators o WHERE o.slug = _s) THEN
    RAISE EXCEPTION 'agente_nao_encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF _padrao THEN
    UPDATE public.operator_key_bindings SET padrao = false WHERE principal = _principal AND padrao;
  END IF;
  INSERT INTO public.operator_key_bindings (principal, operator_slug, padrao, rotulo)
  VALUES (_principal, _s, _padrao, 'ligada no Escritório')
  ON CONFLICT (principal, operator_slug) DO UPDATE SET padrao = EXCLUDED.padrao;
  INSERT INTO public.operator_audit_log (actor, operator_id, action, evidence)
  SELECT 'humano:' || _eu::text, o.id, 'escritorio_credencial_ligada', 'Credencial ' || left(_key_id::text, 8) || ' ligada a este agente.'
    FROM public.internal_operators o WHERE o.slug = _s;
  RETURN jsonb_build_object('ok', true, 'principal', _principal, 'slug', _s);
END;
$$;

DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY[
    'public.escritorio_dono_enviar(text, text, text, uuid, text, uuid, uuid)',
    'public.escritorio_dono_marcar_lidas(uuid)',
    'public.escritorio_bloquear_agente(text, text)',
    'public.escritorio_desbloquear_agente(text)',
    'public.escritorio_ligar_credencial(uuid, text, boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', _f);
  END LOOP;
END $$;

-- A tela escuta mensagens e presença ao vivo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.escritorio_mensagens;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.escritorio_presenca;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
