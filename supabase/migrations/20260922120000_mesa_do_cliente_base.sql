-- Mesa do cliente: base de banco (docs/mesa-do-cliente/SPEC.md, secao 2).
--
-- So acrescenta. Nenhuma tabela, funcao ou politica existente muda.
-- Regras:
-- - toda linha nova tem client_id e RLS de equipe (is_staff + can_access_client);
--   o cliente final nao le nada destas tabelas;
-- - carteira, movimentos e usos de IA so mudam por RPC (nem o backend escreve
--   direto nessas tres tabelas);
-- - recarga so por admin ou manager; registro de uso so pelo backend;
-- - o client_id aponta para profiles com cascata, igual as tabelas do cliente
--   (ver 20260909100000_admin_apaga_sem_briga.sql), para a exclusao de conta
--   seguir funcionando sem briga;
-- - quem criou (criado_por, atualizado_por) fica como uuid solto, sem vinculo,
--   para o rastro sobreviver a saida da pessoa.

-- ---------------------------------------------------------------------------
-- 0. Carimbo de atualizacao
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mesa_tocar_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $body$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$body$;

REVOKE ALL ON FUNCTION public.mesa_tocar_atualizado_em()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Catalogo de modelos (semeado por outra migration)
-- ---------------------------------------------------------------------------
CREATE TABLE public.ia_modelos (
  id text PRIMARY KEY,
  provedor text NOT NULL CHECK (provedor IN ('openai', 'anthropic', 'openrouter')),
  modelo_api text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('texto', 'imagem')),
  rotulo text NOT NULL,
  preco_entrada_1m numeric CHECK (preco_entrada_1m IS NULL OR preco_entrada_1m >= 0),
  preco_saida_1m numeric CHECK (preco_saida_1m IS NULL OR preco_saida_1m >= 0),
  preco_cache_1m numeric CHECK (preco_cache_1m IS NULL OR preco_cache_1m >= 0),
  -- preco por imagem 1024x1536: {"baixa": .., "media": .., "alta": ..}
  preco_imagem jsonb CHECK (preco_imagem IS NULL OR jsonb_typeof(preco_imagem) = 'object'),
  raciocinio text[] NOT NULL DEFAULT '{}'::text[],
  padrao_para text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (padrao_para <@ ARRAY['estrategista', 'diretor_arte', 'imagem', 'leitura']::text[]),
  ativo boolean NOT NULL DEFAULT true,
  fonte_preco text,
  conferido_em timestamptz
);

-- ---------------------------------------------------------------------------
-- 2. Carteira, movimentos e usos de IA (escrita so por RPC)
-- ---------------------------------------------------------------------------
CREATE TABLE public.ia_carteiras (
  client_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  saldo_usd numeric NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ia_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tarefa text NOT NULL
    CHECK (tarefa IN ('calendario', 'estudio', 'conversa', 'leitura_referencia', 'verificacao')),
  agente text NOT NULL
    CHECK (agente IN ('estrategista', 'diretor_arte', 'gerador_imagem', 'leitor', 'jev')),
  -- sem vinculo ao catalogo: o historico de custo fica mesmo se o modelo sair
  modelo_id text NOT NULL,
  provedor text NOT NULL,
  tokens_entrada integer NOT NULL DEFAULT 0 CHECK (tokens_entrada >= 0),
  tokens_saida integer NOT NULL DEFAULT 0 CHECK (tokens_saida >= 0),
  tokens_cache integer NOT NULL DEFAULT 0 CHECK (tokens_cache >= 0),
  imagens integer NOT NULL DEFAULT 0 CHECK (imagens >= 0),
  qualidade text,
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  custo_fonte text NOT NULL DEFAULT 'tabela' CHECK (custo_fonte IN ('provedor', 'tabela')),
  referencia_tipo text,
  referencia_id uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ia_usos_cliente_criado_idx
  ON public.ia_usos (client_id, criado_em DESC);

CREATE TABLE public.ia_carteira_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('recarga', 'debito', 'estorno', 'ajuste')),
  -- positivo na recarga, negativo no debito
  valor_usd numeric NOT NULL CHECK (
    valor_usd <> 0
    AND (tipo <> 'recarga' OR valor_usd > 0)
    AND (tipo <> 'debito' OR valor_usd < 0)
  ),
  uso_id uuid REFERENCES public.ia_usos(id) ON DELETE SET NULL,
  observacao text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ia_carteira_movimentos_cliente_criado_idx
  ON public.ia_carteira_movimentos (client_id, criado_em DESC);
CREATE INDEX ia_carteira_movimentos_uso_idx
  ON public.ia_carteira_movimentos (uso_id)
  WHERE uso_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Contexto do cliente: kit de marca, fontes, referencias, rostos
-- ---------------------------------------------------------------------------
CREATE TABLE public.cliente_kit_marca (
  client_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- [{nome, hex, papel}]
  paleta jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(paleta) = 'array'),
  logo_file_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  logo_alt_file_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  estilo text,
  regras text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

CREATE INDEX cliente_kit_marca_logo_idx
  ON public.cliente_kit_marca (logo_file_id) WHERE logo_file_id IS NOT NULL;
CREATE INDEX cliente_kit_marca_logo_alt_idx
  ON public.cliente_kit_marca (logo_alt_file_id) WHERE logo_alt_file_id IS NOT NULL;

CREATE TRIGGER cliente_kit_marca_tocar
BEFORE UPDATE ON public.cliente_kit_marca
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

CREATE TABLE public.cliente_fontes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL,
  papel text NOT NULL CHECK (papel IN ('titulo', 'texto', 'destaque')),
  storage_path text NOT NULL,
  amostra_path text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cliente_fontes_cliente_idx ON public.cliente_fontes (client_id);

CREATE TABLE public.cliente_referencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  origem text NOT NULL CHECK (origem IN ('workspace', 'pinterest', 'upload')),
  workspace_node_id uuid REFERENCES public.workspace_nodes(id) ON DELETE SET NULL,
  url_origem text,
  storage_path text,
  -- o que o leitor viu: composicao, hierarquia, tipografia, luz
  leitura text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_referencias_workspace_unico UNIQUE (client_id, workspace_node_id),
  CONSTRAINT cliente_referencias_url_unico UNIQUE (client_id, url_origem)
);

CREATE INDEX cliente_referencias_node_idx
  ON public.cliente_referencias (workspace_node_id) WHERE workspace_node_id IS NOT NULL;

CREATE TABLE public.cliente_rostos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pessoa text NOT NULL,
  storage_path text NOT NULL,
  autorizacao_registrada_em timestamptz NOT NULL,
  autorizado_por text NOT NULL CHECK (btrim(autorizado_por) <> ''),
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cliente_rostos_cliente_idx ON public.cliente_rostos (client_id);

-- ---------------------------------------------------------------------------
-- 4. Agentes: prompts, memoria, conversas e mensagens
-- ---------------------------------------------------------------------------
-- client_id nulo = prompt global. Prompt efetivo = global ativo + complemento
-- ativo do cliente. Um ativo por agente e escopo; versao unica por escopo.
CREATE TABLE public.agente_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente text NOT NULL CHECK (agente IN ('estrategista', 'diretor_arte')),
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  versao integer NOT NULL CHECK (versao >= 1),
  conteudo text NOT NULL,
  ativo boolean NOT NULL DEFAULT false,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agente_prompts_versao_unica
  ON public.agente_prompts (
    agente,
    COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid),
    versao
  );
CREATE UNIQUE INDEX agente_prompts_um_ativo
  ON public.agente_prompts (
    agente,
    COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE ativo;
CREATE INDEX agente_prompts_cliente_idx
  ON public.agente_prompts (client_id) WHERE client_id IS NOT NULL;

CREATE TABLE public.agente_memoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agente text NOT NULL CHECK (agente IN ('estrategista', 'diretor_arte')),
  tipo text NOT NULL CHECK (tipo IN ('aprendizado', 'preferencia', 'evitar')),
  texto text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('aprovacao', 'ajuste', 'metrica', 'manual')),
  referencia_id uuid,
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agente_memoria_cliente_agente_idx
  ON public.agente_memoria (client_id, agente, criado_em DESC);

CREATE TABLE public.agente_conversas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agente text NOT NULL CHECK (agente IN ('estrategista', 'diretor_arte')),
  referencia_tipo text,
  referencia_id uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- alvo do vinculo composto das mensagens (mensagem nunca troca de cliente)
  CONSTRAINT agente_conversas_id_cliente_unico UNIQUE (id, client_id)
);

CREATE INDEX agente_conversas_cliente_idx
  ON public.agente_conversas (client_id, criado_em DESC);
CREATE INDEX agente_conversas_referencia_idx
  ON public.agente_conversas (referencia_id) WHERE referencia_id IS NOT NULL;

-- client_id repetido de proposito: toda linha nova tem client_id, e o vinculo
-- composto garante que ele e o mesmo da conversa.
CREATE TABLE public.agente_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  papel text NOT NULL CHECK (papel IN ('usuario', 'agente', 'sistema')),
  conteudo text NOT NULL,
  anexos jsonb NOT NULL DEFAULT '[]'::jsonb,
  uso_id uuid REFERENCES public.ia_usos(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agente_mensagens_conversa_fk
    FOREIGN KEY (conversa_id, client_id)
    REFERENCES public.agente_conversas (id, client_id)
    ON DELETE CASCADE
);

CREATE INDEX agente_mensagens_conversa_idx
  ON public.agente_mensagens (conversa_id, criado_em);
CREATE INDEX agente_mensagens_cliente_idx
  ON public.agente_mensagens (client_id);
CREATE INDEX agente_mensagens_uso_idx
  ON public.agente_mensagens (uso_id) WHERE uso_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Mes (propostas de calendario) e Estudio (trabalhos de arte)
-- ---------------------------------------------------------------------------
CREATE TABLE public.calendario_propostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  -- frequencia, objetivo, oferta, regiao, modelo, raciocinio
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'temas'
    CHECK (status IN ('temas', 'detalhando', 'pronta', 'gravada', 'descartada')),
  diagnostico text,
  temas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(temas) = 'array'),
  itens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(itens) = 'array'),
  conversa_id uuid REFERENCES public.agente_conversas(id) ON DELETE SET NULL,
  task_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  gravada_em timestamptz,
  CONSTRAINT calendario_propostas_periodo_ok CHECK (periodo_fim >= periodo_inicio)
);

CREATE INDEX calendario_propostas_cliente_idx
  ON public.calendario_propostas (client_id, periodo_inicio DESC);
CREATE INDEX calendario_propostas_projeto_idx
  ON public.calendario_propostas (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX calendario_propostas_conversa_idx
  ON public.calendario_propostas (conversa_id) WHERE conversa_id IS NOT NULL;

CREATE TRIGGER calendario_propostas_tocar
BEFORE UPDATE ON public.calendario_propostas
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

CREATE TABLE public.estudio_trabalhos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- item editorial da agenda (tasks); se a tarefa sumir, o trabalho fica
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'dirigido', 'gerando', 'pronto', 'entregue', 'erro')),
  -- {conceito, carrossel_infinito, cards:[{ordem, funcao, texto_exato, composicao, ilustracao, prompt_imagem}]}
  direcao jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(direcao) = 'object'),
  modelo_imagem_id text REFERENCES public.ia_modelos(id) ON UPDATE CASCADE ON DELETE SET NULL,
  qualidade text,
  -- [{ordem, versao, storage_path, verificacao:{texto_lido, ortografia_ok, identidade}}]
  cards jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cards) = 'array'),
  legenda text,
  file_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  conversa_id uuid REFERENCES public.agente_conversas(id) ON DELETE SET NULL,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX estudio_trabalhos_cliente_idx
  ON public.estudio_trabalhos (client_id, criado_em DESC);
CREATE INDEX estudio_trabalhos_task_idx
  ON public.estudio_trabalhos (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX estudio_trabalhos_modelo_idx
  ON public.estudio_trabalhos (modelo_imagem_id) WHERE modelo_imagem_id IS NOT NULL;
CREATE INDEX estudio_trabalhos_conversa_idx
  ON public.estudio_trabalhos (conversa_id) WHERE conversa_id IS NOT NULL;

CREATE TRIGGER estudio_trabalhos_tocar
BEFORE UPDATE ON public.estudio_trabalhos
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.ia_modelos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_carteiras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_carteira_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_usos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_kit_marca ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_fontes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_referencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_rostos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_memoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendario_propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estudio_trabalhos ENABLE ROW LEVEL SECURITY;

-- Sem nada herdado dos privilegios padrao: cada papel recebe so o que precisa.
REVOKE ALL ON TABLE
  public.ia_modelos,
  public.ia_carteiras,
  public.ia_carteira_movimentos,
  public.ia_usos,
  public.cliente_kit_marca,
  public.cliente_fontes,
  public.cliente_referencias,
  public.cliente_rostos,
  public.agente_prompts,
  public.agente_memoria,
  public.agente_conversas,
  public.agente_mensagens,
  public.calendario_propostas,
  public.estudio_trabalhos
FROM PUBLIC, anon, authenticated, service_role;

-- 6.1 Catalogo: leitura da equipe, escrita so do admin.
CREATE POLICY ia_modelos_equipe_le
ON public.ia_modelos
FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())));

CREATE POLICY ia_modelos_admin_insere
ON public.ia_modelos
FOR INSERT TO authenticated
WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));

CREATE POLICY ia_modelos_admin_altera
ON public.ia_modelos
FOR UPDATE TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role))
WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));

CREATE POLICY ia_modelos_admin_apaga
ON public.ia_modelos
FOR DELETE TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ia_modelos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ia_modelos TO service_role;

-- 6.2 Carteira, movimentos e usos: equipe so le. Escrita so pelas RPCs.
CREATE POLICY ia_carteiras_equipe_le
ON public.ia_carteiras
FOR SELECT TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND public.can_access_client(client_id)
);

CREATE POLICY ia_carteira_movimentos_equipe_le
ON public.ia_carteira_movimentos
FOR SELECT TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND public.can_access_client(client_id)
);

CREATE POLICY ia_usos_equipe_le
ON public.ia_usos
FOR SELECT TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND public.can_access_client(client_id)
);

GRANT SELECT ON public.ia_carteiras, public.ia_carteira_movimentos, public.ia_usos
  TO authenticated, service_role;

-- 6.3 Tabelas de trabalho da equipe: le e escreve quem tem acesso ao cliente.
DO $migration$
DECLARE
  _tabela text;
BEGIN
  FOREACH _tabela IN ARRAY ARRAY[
    'cliente_kit_marca',
    'cliente_fontes',
    'cliente_referencias',
    'cliente_rostos',
    'agente_memoria',
    'agente_conversas',
    'agente_mensagens',
    'calendario_propostas',
    'estudio_trabalhos'
  ] LOOP
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
      FOR SELECT TO authenticated
      USING (
        public.is_staff((select auth.uid()))
        AND public.can_access_client(client_id)
      )
    $p$, _tabela || '_equipe_le', _tabela);

    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
      FOR INSERT TO authenticated
      WITH CHECK (
        public.is_staff((select auth.uid()))
        AND public.can_access_client(client_id)
      )
    $p$, _tabela || '_equipe_insere', _tabela);

    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
      FOR UPDATE TO authenticated
      USING (
        public.is_staff((select auth.uid()))
        AND public.can_access_client(client_id)
      )
      WITH CHECK (
        public.is_staff((select auth.uid()))
        AND public.can_access_client(client_id)
      )
    $p$, _tabela || '_equipe_altera', _tabela);

    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
      FOR DELETE TO authenticated
      USING (
        public.is_staff((select auth.uid()))
        AND public.can_access_client(client_id)
      )
    $p$, _tabela || '_equipe_apaga', _tabela);

    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role',
      _tabela
    );
  END LOOP;
END;
$migration$;

-- 6.4 Prompts: globais (client_id nulo) a equipe le e so o admin escreve;
-- complemento do cliente segue a regra da equipe com acesso ao cliente.
CREATE POLICY agente_prompts_equipe_le
ON public.agente_prompts
FOR SELECT TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND (client_id IS NULL OR public.can_access_client(client_id))
);

CREATE POLICY agente_prompts_equipe_insere
ON public.agente_prompts
FOR INSERT TO authenticated
WITH CHECK (
  public.is_staff((select auth.uid()))
  AND (
    (client_id IS NULL AND public.has_role((select auth.uid()), 'admin'::public.app_role))
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
  )
);

CREATE POLICY agente_prompts_equipe_altera
ON public.agente_prompts
FOR UPDATE TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND (
    (client_id IS NULL AND public.has_role((select auth.uid()), 'admin'::public.app_role))
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
  )
)
WITH CHECK (
  public.is_staff((select auth.uid()))
  AND (
    (client_id IS NULL AND public.has_role((select auth.uid()), 'admin'::public.app_role))
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
  )
);

CREATE POLICY agente_prompts_equipe_apaga
ON public.agente_prompts
FOR DELETE TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND (
    (client_id IS NULL AND public.has_role((select auth.uid()), 'admin'::public.app_role))
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agente_prompts TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Bucket privado `mesa`: fontes, amostras, referencias baixadas, rascunhos
-- ---------------------------------------------------------------------------
-- Caminho sempre comeca pelo id do cliente: <client_id>/fontes/..., etc.
INSERT INTO storage.buckets (id, name, public)
VALUES ('mesa', 'mesa', false)
ON CONFLICT (id) DO UPDATE
SET public = false;

CREATE OR REPLACE FUNCTION public.mesa_storage_acesso(_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _client_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_staff(auth.uid()), false) THEN
    RETURN false;
  END IF;
  _client_id := public.try_uuid((storage.foldername(_name))[1]);
  RETURN _client_id IS NOT NULL
    AND COALESCE(public.can_access_client(_client_id), false);
END;
$body$;

REVOKE ALL ON FUNCTION public.mesa_storage_acesso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_storage_acesso(text) TO authenticated, service_role;

CREATE POLICY "mesa: equipe le"
ON storage.objects
FOR SELECT TO authenticated
USING (
  storage.objects.bucket_id = 'mesa'
  AND public.mesa_storage_acesso(storage.objects.name)
);

CREATE POLICY "mesa: equipe envia"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  storage.objects.bucket_id = 'mesa'
  AND public.mesa_storage_acesso(storage.objects.name)
);

CREATE POLICY "mesa: equipe altera"
ON storage.objects
FOR UPDATE TO authenticated
USING (
  storage.objects.bucket_id = 'mesa'
  AND public.mesa_storage_acesso(storage.objects.name)
)
WITH CHECK (
  storage.objects.bucket_id = 'mesa'
  AND public.mesa_storage_acesso(storage.objects.name)
);

CREATE POLICY "mesa: equipe apaga"
ON storage.objects
FOR DELETE TO authenticated
USING (
  storage.objects.bucket_id = 'mesa'
  AND public.mesa_storage_acesso(storage.objects.name)
);

-- ---------------------------------------------------------------------------
-- 8. RPCs
-- ---------------------------------------------------------------------------
-- 8.1 Recarga: so admin (qualquer cliente) ou manager (clientes que ele
-- acessa). Nem o backend recarrega sozinho: toda recarga tem uma pessoa.
CREATE OR REPLACE FUNCTION public.ia_carteira_recarregar(
  _client_id uuid,
  _valor_usd numeric,
  _observacao text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _ator uuid := auth.uid();
  _saldo numeric;
BEGIN
  IF _ator IS NULL OR NOT (
    COALESCE(public.has_role(_ator, 'admin'::public.app_role), false)
    OR (
      COALESCE(public.has_role(_ator, 'manager'::public.app_role), false)
      AND COALESCE(public.can_access_client(_client_id), false)
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IA_RECARGA_SO_ADMIN_OU_MANAGER';
  END IF;

  IF _client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_CLIENTE_OBRIGATORIO';
  END IF;

  IF _valor_usd IS NULL OR _valor_usd <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_RECARGA_VALOR_INVALIDO';
  END IF;

  INSERT INTO public.ia_carteira_movimentos (client_id, tipo, valor_usd, observacao, criado_por)
  VALUES (_client_id, 'recarga', _valor_usd, NULLIF(btrim(_observacao), ''), _ator);

  INSERT INTO public.ia_carteiras AS carteira (client_id, saldo_usd, atualizado_em)
  VALUES (_client_id, _valor_usd, now())
  ON CONFLICT (client_id) DO UPDATE
  SET saldo_usd = carteira.saldo_usd + EXCLUDED.saldo_usd,
      atualizado_em = now()
  RETURNING carteira.saldo_usd INTO _saldo;

  RETURN _saldo;
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_carteira_recarregar(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_carteira_recarregar(uuid, numeric, text)
  TO authenticated, service_role;

-- 8.2 Registro de uso: so o backend (funcoes de borda com a chave de servico).
-- Insere o uso, lanca o debito e baixa o saldo na mesma transacao. A carteira
-- pode ficar negativa por um uso: a checagem previa de saldo e da funcao.
-- Uso de custo zero fica registrado sem movimento (nao ha o que debitar).
CREATE OR REPLACE FUNCTION public.ia_registrar_uso(
  _client_id uuid,
  _tarefa text,
  _agente text,
  _modelo_id text,
  _provedor text,
  _tokens_entrada integer DEFAULT 0,
  _tokens_saida integer DEFAULT 0,
  _tokens_cache integer DEFAULT 0,
  _imagens integer DEFAULT 0,
  _qualidade text DEFAULT NULL,
  _custo_usd numeric DEFAULT 0,
  _custo_fonte text DEFAULT 'tabela',
  _referencia_tipo text DEFAULT NULL,
  _referencia_id uuid DEFAULT NULL,
  _criado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _uso_id uuid;
  _custo numeric := COALESCE(_custo_usd, 0);
  _saldo numeric;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IA_USO_SO_BACKEND';
  END IF;

  IF _client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_CLIENTE_OBRIGATORIO';
  END IF;

  IF _custo < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_CUSTO_NEGATIVO';
  END IF;

  INSERT INTO public.ia_usos (
    client_id, tarefa, agente, modelo_id, provedor,
    tokens_entrada, tokens_saida, tokens_cache, imagens, qualidade,
    custo_usd, custo_fonte, referencia_tipo, referencia_id, criado_por
  )
  VALUES (
    _client_id, _tarefa, _agente, _modelo_id, _provedor,
    COALESCE(_tokens_entrada, 0), COALESCE(_tokens_saida, 0),
    COALESCE(_tokens_cache, 0), COALESCE(_imagens, 0), _qualidade,
    _custo, COALESCE(_custo_fonte, 'tabela'), _referencia_tipo, _referencia_id, _criado_por
  )
  RETURNING id INTO _uso_id;

  IF _custo > 0 THEN
    INSERT INTO public.ia_carteira_movimentos (client_id, tipo, valor_usd, uso_id, observacao, criado_por)
    VALUES (_client_id, 'debito', -_custo, _uso_id, _tarefa || ' / ' || _agente || ' / ' || _modelo_id, _criado_por);
  END IF;

  INSERT INTO public.ia_carteiras AS carteira (client_id, saldo_usd, atualizado_em)
  VALUES (_client_id, -_custo, now())
  ON CONFLICT (client_id) DO UPDATE
  SET saldo_usd = carteira.saldo_usd + EXCLUDED.saldo_usd,
      atualizado_em = now()
  RETURNING carteira.saldo_usd INTO _saldo;

  RETURN jsonb_build_object('uso_id', _uso_id, 'saldo_usd', _saldo);
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_registrar_uso(
  uuid, text, text, text, text, integer, integer, integer, integer,
  text, numeric, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_registrar_uso(
  uuid, text, text, text, text, integer, integer, integer, integer,
  text, numeric, text, text, uuid, uuid
) TO service_role;

-- 8.3 Saldo atual (equipe com acesso ao cliente). Sem carteira = 0.
CREATE OR REPLACE FUNCTION public.ia_saldo(_client_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _saldo numeric;
BEGIN
  PERFORM app_private.require_rpc_client_staff(_client_id);
  SELECT carteira.saldo_usd INTO _saldo
  FROM public.ia_carteiras AS carteira
  WHERE carteira.client_id = _client_id;
  RETURN COALESCE(_saldo, 0);
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_saldo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_saldo(uuid) TO authenticated, service_role;

-- 8.4 Consumo do mes (equipe): totais por modelo e por tarefa, recargas do
-- mes e saldo atual. O mes e o do calendario de Sao Paulo, nao o de UTC.
CREATE OR REPLACE FUNCTION public.ia_consumo_cliente(_client_id uuid, _mes date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _mes_inicio date;
  _inicio timestamptz;
  _fim timestamptz;
  _resultado jsonb;
BEGIN
  PERFORM app_private.require_rpc_client_staff(_client_id);

  _mes_inicio := date_trunc(
    'month',
    COALESCE(_mes, (now() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp
  )::date;
  _inicio := _mes_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo';
  _fim := (_mes_inicio + interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo';

  SELECT jsonb_build_object(
    'client_id', _client_id,
    'mes', _mes_inicio,
    'saldo_usd', COALESCE((
      SELECT carteira.saldo_usd FROM public.ia_carteiras AS carteira
      WHERE carteira.client_id = _client_id
    ), 0),
    'total_usd', COALESCE((
      SELECT sum(uso.custo_usd) FROM public.ia_usos AS uso
      WHERE uso.client_id = _client_id AND uso.criado_em >= _inicio AND uso.criado_em < _fim
    ), 0),
    'usos', (
      SELECT count(*) FROM public.ia_usos AS uso
      WHERE uso.client_id = _client_id AND uso.criado_em >= _inicio AND uso.criado_em < _fim
    ),
    'recargas_usd', COALESCE((
      SELECT sum(mov.valor_usd) FROM public.ia_carteira_movimentos AS mov
      WHERE mov.client_id = _client_id AND mov.tipo = 'recarga'
        AND mov.criado_em >= _inicio AND mov.criado_em < _fim
    ), 0),
    'por_modelo', COALESCE((
      SELECT jsonb_agg(linha ORDER BY (linha->>'custo_usd')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'modelo_id', uso.modelo_id,
          'provedor', uso.provedor,
          'rotulo', max(modelo.rotulo),
          'usos', count(*),
          'tokens_entrada', sum(uso.tokens_entrada),
          'tokens_saida', sum(uso.tokens_saida),
          'tokens_cache', sum(uso.tokens_cache),
          'imagens', sum(uso.imagens),
          'custo_usd', sum(uso.custo_usd)
        ) AS linha
        FROM public.ia_usos AS uso
        LEFT JOIN public.ia_modelos AS modelo ON modelo.id = uso.modelo_id
        WHERE uso.client_id = _client_id AND uso.criado_em >= _inicio AND uso.criado_em < _fim
        GROUP BY uso.modelo_id, uso.provedor
      ) AS por_modelo
    ), '[]'::jsonb),
    'por_tarefa', COALESCE((
      SELECT jsonb_agg(linha ORDER BY (linha->>'custo_usd')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'tarefa', uso.tarefa,
          'usos', count(*),
          'custo_usd', sum(uso.custo_usd)
        ) AS linha
        FROM public.ia_usos AS uso
        WHERE uso.client_id = _client_id AND uso.criado_em >= _inicio AND uso.criado_em < _fim
        GROUP BY uso.tarefa
      ) AS por_tarefa
    ), '[]'::jsonb)
  ) INTO _resultado;

  RETURN _resultado;
END;
$body$;

REVOKE ALL ON FUNCTION public.ia_consumo_cliente(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_consumo_cliente(uuid, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Prompts globais v1 (conteudo exato de docs/mesa-do-cliente/prompts/)
-- ---------------------------------------------------------------------------
INSERT INTO public.agente_prompts (agente, client_id, versao, conteudo, ativo)
SELECT 'estrategista', NULL, 1, $prompt$Você será o estrategista editorial da Aceleriq.

Crie uma linha editorial profissional, prática e orientada a resultados para o cliente informado.

FORMATO OBRIGATÓRIO:

- Carrossel.
- Post estático quando fizer sentido.

FORMATO PROIBIDO:

- Reels.
- Vídeos.
- Stories.
- Lives.
- Roteiros de vídeo.
- Sugestões de gravação.

Mesmo que esses formatos pareçam relevantes, não os inclua, não os sugira e não reserve espaço para eles.

DADOS DO PROJETO:

Cliente: [NOME DO CLIENTE]
Projeto: [NOME NO PAINEL ACELERIQ]
Instagram: [@PERFIL]
Região: [CIDADE, BAIRROS E ÁREA DE ATUAÇÃO]
Período: [30, 60 OU 90 DIAS]
Data inicial: [DATA EXATA OU A PARTIR DE HOJE]
Frequência: [QUANTIDADE DE PUBLICAÇÕES]
Objetivo principal: [VENDAS, VISITAS, LEADS, RECONHECIMENTO ETC.]
Oferta principal: [PRODUTO OU SERVIÇO]
Modo de execução: [PLANEJAR OU PLANEJAR E ATUALIZAR NO PAINEL]

Antes de criar o calendário:

1. Analise o histórico, briefing, serviços, diferenciais, público, região e conteúdos anteriores do cliente.
2. Analise as métricas disponíveis do Instagram, priorizando alcance, não seguidores, compartilhamentos, salvamentos, comentários, visitas ao perfil, cliques, mensagens, leads e vendas.
3. Identifique os conteúdos que tiveram melhor e pior desempenho.
4. Pesquise dúvidas, necessidades, buscas, comportamentos e oportunidades relacionadas ao nicho e à região.
5. Não invente métricas, informações locais, resultados ou diferenciais.

A linha editorial deverá trabalhar cinco objetivos:

1. Viralização e descoberta.
2. Conscientização e educação.
3. Autoridade e confiança.
4. Engajamento e relacionamento.
5. Conversão e vendas.

Cada publicação deverá ter apenas um objetivo principal.

Organize o período em uma sequência lógica:

FASE 1:
Descoberta, identificação do problema e reconhecimento da marca.

FASE 2:
Educação, diferenciais, funcionamento, localização e quebra de objeções.

FASE 3:
Provas, benefícios, ofertas, conversão, recorrência e indicação.

Para cada publicação, informe:

- Data.
- Formato: carrossel ou post estático.
- Pilar.
- Fase.
- Público.
- Tema.
- Gancho.
- Resumo do conteúdo.
- Estrutura dos cards, quando for carrossel.
- CTA.
- Objetivo.
- Métrica principal.
- Palavra-chave.
- Termo regional, quando relevante.
- Status.
- Indicação se é conteúdo principal ou extra sazonal.

REGRAS DOS CARROSSÉIS:

- Uma ideia principal por carrossel.
- Capa forte, específica e fácil de entender.
- Conteúdo direto, sem excesso de texto.
- Progressão lógica entre os cards.
- Informações úteis, específicas e aplicáveis.
- CTA final conectado ao objetivo.
- Evitar repetição de temas e estruturas.
- Não utilizar conteúdo genérico que serviria para qualquer empresa.
- Respeitar a identidade e o padrão visual do cliente.

DATAS SAZONAIS:

- Pesquise datas nacionais, locais e relacionadas ao nicho.
- Inclua somente datas com conexão real com o público e a empresa.
- Não crie publicação apenas para desejar feliz data.
- Utilize a data para educar, gerar identificação, relacionamento ou vender.
- Quando definido como extra, o conteúdo sazonal não poderá substituir a frequência principal.

SELEÇÃO DE TEMAS:

Priorize temas que:

- Resolvem dúvidas reais.
- Geram identificação.
- Possuem potencial de compartilhamento ou salvamento.
- Mostram benefícios concretos.
- Reduzem objeções.
- Fortalecem a presença regional.
- Levam o público para uma ação comercial.

Descarte temas genéricos, repetitivos, superficiais ou sem relação com o objetivo do cliente.

EXECUÇÃO NO PAINEL ACELERIQ:

Quando a atualização for solicitada:

- Trabalhe somente no projeto informado.
- Leia o calendário existente antes de editar.
- Preserve conteúdos publicados e aprovados.
- Não misture clientes.
- Evite duplicidades.
- Use datas exatas.
- Organize os status corretamente.
- Marque conteúdos sazonais como extras.
- Não diga que atualizou o painel sem realmente executar a atualização.

ENTREGA FINAL:

1. Diagnóstico resumido.
2. Públicos prioritários.
3. Pilares editoriais e distribuição.
4. Sequência estratégica do período.
5. Calendário completo.
6. Datas sazonais selecionadas.
7. Métricas que deverão ser acompanhadas.
8. Conteúdos criados, atualizados e preservados no painel, quando aplicável.

Se algum dado estiver indisponível, avance com uma hipótese claramente identificada.

Seja profissional, específico e direto.

Não entregue explicações longas sobre marketing.

Não crie formatos além de carrossel e post estático.

Não demore construindo estruturas desnecessárias. Priorize diagnóstico, calendário e execução.
$prompt$, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.agente_prompts
  WHERE agente = 'estrategista' AND client_id IS NULL AND versao = 1
);

INSERT INTO public.agente_prompts (agente, client_id, versao, conteudo, ativo)
SELECT 'diretor_arte', NULL, 1, $prompt$PROMPT MESTRE, DIREÇÃO DE ARTE PARA CARROSSEL

Crie o design final do carrossel fornecido com padrão profissional de direção de arte.

O design deve se adaptar integralmente ao nicho, marca, público, tema, identidade visual, conteúdo e referências fornecidas em cada solicitação.

Não aplique uma estética fixa. Uma empresa de contabilidade, restaurante, tecnologia, jardinagem, hotel, saúde ou varejo deve receber soluções visuais coerentes com seu próprio universo.

FORMATO

* 1080 × 1350 px por card
* Proporção vertical 4:5 real
* Utilizar toda a área da prancheta
* Arte final completa, nunca imagem-base ou mockup
* Preservar margens de segurança para textos e elementos importantes

DIREÇÃO DE ARTE

Transforme o conteúdo em uma composição visual, não apenas em texto sobre uma imagem.

Priorize:

* Hierarquia visual forte
* Pouco texto
* Headline dominante
* Leitura rápida no celular
* Espaçamento e respiro
* Grid bem estruturado
* Contraste
* Equilíbrio entre texto e imagem
* Profundidade por planos
* Recortes e sobreposições
* Escala e perspectiva
* Sombras e iluminação coerentes
* Texturas sutis quando agregarem
* Elementos gráficos contextualizados
* Imagens integradas à narrativa
* Ambientação relacionada diretamente ao assunto

Cada elemento precisa ter função. Não preencher espaços apenas para deixar a arte mais cheia.

ADAPTAÇÃO AO NICHO

Antes de definir a estética, interprete o universo visual da marca e do conteúdo.

Escolha imagens, objetos, materiais, texturas, cenários, símbolos, iluminação e recursos gráficos coerentes com aquele nicho.

Não force estética tecnológica, corporativa, minimalista, luxuosa ou cinematográfica quando ela não fizer sentido.

A identidade da marca permanece consistente. A solução criativa muda conforme o assunto.

CAPA

A capa é o principal ponto de interrupção da rolagem.

Ela deve:

* Usar a logo oficial da marca
* Ter headline curta, forte e imediatamente legível
* Criar curiosidade sem entregar todo o conteúdo
* Possuir um ponto focal dominante
* Trabalhar escala, contraste e composição para gerar impacto
* Utilizar imagem, objeto, número, tipografia ou metáfora visual de maneira contextual
* Ter poucos elementos competindo pela atenção

A capa precisa funcionar visualmente antes mesmo de o usuário começar a ler os detalhes.

CARDS INTERMEDIÁRIOS

Não utilizar logo.

Cada card deve comunicar uma ideia principal.

Variar intencionalmente:

* Enquadramento
* Escala
* Posição da headline
* Relação entre imagem e texto
* Peso visual
* Uso de espaço negativo
* Objetos
* Recortes
* Perspectiva
* Composição

Os cards devem pertencer ao mesmo sistema visual sem parecer duplicações do mesmo template.

CARD FINAL

Retornar com a logo oficial.

O CTA deve possuir destaque e hierarquia claros, integrado à composição.

O último card precisa funcionar como fechamento da narrativa e também se conectar visualmente à capa quando houver carrossel infinito.

CARROSSEL INFINITO

Quando solicitado como carrossel infinito, planeje toda a sequência como uma composição panorâmica contínua, posteriormente dividida em cards 1080 × 1350.

A continuidade deve ser estrutural, não decorativa.

Elementos podem atravessar as bordas entre cards, como:

* Fotografias
* Cenários
* Objetos
* Formas
* Texturas
* Linhas
* Tipografia
* Sombras
* Luz
* Ilustrações
* Elementos gráficos relacionados ao nicho

Tudo que atravessar uma borda deve continuar no card seguinte com posição, escala, perspectiva, direção e iluminação coerentes.

O último card deve possuir conexão visual com o primeiro para completar o ciclo.

Mesmo conectados, todos os cards precisam funcionar individualmente.

ANTI-REPETIÇÃO

Nunca transforme a identidade visual em um template repetitivo.

Antes de criar, observe as artes e referências anteriores disponíveis e evite repetir:

* Mesmo layout
* Mesmo enquadramento
* Mesmo fundo
* Mesmo objeto central
* Mesmo posicionamento de headline
* Mesma metáfora
* Mesma distribuição de elementos
* Mesma iluminação
* Mesmo recurso gráfico
* Mesma estrutura de capa
* Mesmo CTA visual

Mantenha consistência de marca com variedade de direção de arte.

REFERÊNCIAS

Quando referências forem fornecidas, analise:

* Composição
* Hierarquia
* Grid
* Profundidade
* Tipografia
* Escala
* Enquadramento
* Recortes
* Espaçamento
* Ritmo
* Iluminação
* Integração entre fotografia e elementos gráficos

Absorva a técnica, não copie a peça.

Adapte o nível de execução ao conteúdo e à identidade da marca.

EVITAR

* Foto com texto simplesmente colocado por cima
* Template genérico
* Poluição visual
* Texto excessivo
* Tipografia pequena
* Elementos decorativos sem função
* Centralização automática de tudo
* Excesso de efeitos
* Neon e brilhos sem contexto
* Imagens artificiais ou deformadas
* Elementos desconectados do nicho
* Repetição visual entre cards
* Logo nos cards intermediários
* Composições bonitas, mas sem hierarquia
* Sacrificar legibilidade para criar efeito visual

PADRÃO FINAL

O resultado deve unir:

impacto + clareza + organização + profundidade + contexto + identidade + variedade + continuidade.

A arte precisa chamar atenção no feed sem ficar poluída, conduzir naturalmente a leitura e parecer desenvolvida especificamente para aquela marca e aquele conteúdo, nunca saída de um template genérico.

Capa: impacto + logo.
Miolo: narrativa + variedade + sem logo.
Final: CTA + logo.
Carrossel infinito: continuidade real entre todos os cards.

Antes da entrega, faça uma revisão visual completa de hierarquia, alinhamento, espaçamento, legibilidade, proporção, ortografia, consistência da identidade e encaixe entre os cards.
$prompt$, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.agente_prompts
  WHERE agente = 'diretor_arte' AND client_id IS NULL AND versao = 1
);
