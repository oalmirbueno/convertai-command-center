-- Frente PRO (30/09/2026): gerador de proposta comercial (/mesa-proposta e /proposta/:token).
-- Só amplia e é idempotente (pode rodar mais de uma vez). Não mexe em dado existente.
--
-- 1) proposta_modelos: os modelos de proposta como dados, com o "Padrão Aceleriq".
--    O dono evolui os modelos junto com a equipe (salvar como modelo, trocar o padrão).
-- 2) propostas: uma proposta por cliente (e marca), ligada ao lead do Comercial
--    quando houver. Status rascunho -> enviada -> vista -> aceita | recusada | expirada,
--    validade, versão, conteúdo por bloco (jsonb), itens e totais (o preço sai
--    só dos itens), token público (nasce no envio) e o aceite com prova.
-- 3) proposta_versoes: cada gravação guarda a versão anterior (Desfazer e histórico).
-- 4) proposta_eventos: criada, gerada, enviada, aberta, leitura (tempo), aceita...
--    O evento "enviada" leva o resumo e as provas (gancho do documento de entrega);
--    o "aceita" é o que a frente de contratos consome (gerar_do_aceite).
-- 5) RPCs do link público por token (só a função proposta-publica, com a chave de
--    serviço, chama): ler (marca expirada na hora), evento (abertura e tempo de
--    leitura) e aceitar (nome, e-mail, IP, navegador e o hash do que foi enviado).
-- 6) A escolha de clientes por mesa aceita 'proposta' (sem apagar o que outras
--    frentes acrescentaram).
--
-- RLS: só admin e gestor leem, e só do cliente a que têm acesso (can_access_client).
-- Ninguém escreve pela API: toda escrita passa pela função mesa-proposta (service_role)
-- ou pelas RPCs security definer acima.

-- ------------------------------------------------------------------ 1) modelos

CREATE TABLE IF NOT EXISTS public.proposta_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  descricao text,
  padrao boolean NOT NULL DEFAULT false,
  blocos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocos) = 'array'),
  validade_dias integer NOT NULL DEFAULT 15 CHECK (validade_dias BETWEEN 1 AND 120),
  condicoes text,
  arquivado_em timestamptz,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Um padrão vivo por vez.
CREATE UNIQUE INDEX IF NOT EXISTS proposta_modelos_um_padrao ON public.proposta_modelos (padrao) WHERE padrao AND arquivado_em IS NULL;

-- ------------------------------------------------------------------ 2) propostas

CREATE TABLE IF NOT EXISTS public.propostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid REFERENCES public.cliente_marcas(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.commercial_leads(id) ON DELETE SET NULL,
  modelo_id uuid REFERENCES public.proposta_modelos(id) ON DELETE SET NULL,
  numero text NOT NULL,
  titulo text NOT NULL DEFAULT 'Proposta comercial',
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'enviada', 'vista', 'aceita', 'recusada', 'expirada')),
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  conteudo jsonb NOT NULL DEFAULT '{"blocos": []}'::jsonb CHECK (jsonb_typeof(conteudo) = 'object'),
  itens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(itens) = 'array'),
  total_unico numeric(14, 2) NOT NULL DEFAULT 0 CHECK (total_unico >= 0),
  total_mensal numeric(14, 2) NOT NULL DEFAULT 0 CHECK (total_mensal >= 0),
  -- Os nomes que a frente de contratos lê (gerar_do_aceite): espelho dos totais e das condições, nunca gravados à mão.
  valor_total numeric(14, 2) GENERATED ALWAYS AS (total_unico) STORED,
  valor_mensal numeric(14, 2) GENERATED ALWAYS AS (total_mensal) STORED,
  condicoes_pagamento text GENERATED ALWAYS AS (jsonb_path_query_first(conteudo, '$.blocos[*] ? (@.tipo == "investimento").dados.condicoes') #>> '{}') STORED,
  validade_ate date,
  -- Notas e transcrição da reunião e o texto dos arquivos anexados na conversa.
  contexto jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(contexto) = 'object'),
  pendencias jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pendencias) = 'array'),
  logo_cliente_path text,
  token text,
  hash_enviado text,
  aceite jsonb,
  enviada_em timestamptz,
  enviada_por uuid,
  vista_em timestamptz,
  aceita_em timestamptz,
  recusada_em timestamptz,
  motivo_recusa text,
  expirada_em timestamptz,
  arquivada_em timestamptz,
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT propostas_token_tamanho CHECK (token IS NULL OR length(token) >= 32)
);

CREATE UNIQUE INDEX IF NOT EXISTS propostas_numero_unico ON public.propostas (numero);
CREATE UNIQUE INDEX IF NOT EXISTS propostas_token_unico ON public.propostas (token) WHERE token IS NOT NULL;
CREATE INDEX IF NOT EXISTS propostas_cliente_idx ON public.propostas (client_id, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS propostas_lead_idx ON public.propostas (lead_id) WHERE lead_id IS NOT NULL;

-- atualizado_em sozinho (a função já existe nas mesas; criada aqui se faltar).
CREATE OR REPLACE FUNCTION public.mesa_tocar_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS propostas_tocar_atualizado_em ON public.propostas;
CREATE TRIGGER propostas_tocar_atualizado_em
BEFORE UPDATE ON public.propostas
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

DROP TRIGGER IF EXISTS proposta_modelos_tocar_atualizado_em ON public.proposta_modelos;
CREATE TRIGGER proposta_modelos_tocar_atualizado_em
BEFORE UPDATE ON public.proposta_modelos
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- ------------------------------------------------------------------ 3) versões

CREATE TABLE IF NOT EXISTS public.proposta_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposta_id uuid NOT NULL REFERENCES public.propostas(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  versao integer NOT NULL CHECK (versao >= 1),
  titulo text,
  conteudo jsonb NOT NULL,
  itens jsonb NOT NULL DEFAULT '[]'::jsonb,
  validade_ate date,
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'agente', 'geracao', 'pesquisa', 'restauracao', 'envio')),
  nota text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proposta_versoes_unica UNIQUE (proposta_id, versao)
);

CREATE INDEX IF NOT EXISTS proposta_versoes_proposta_idx ON public.proposta_versoes (proposta_id, versao DESC);

-- ------------------------------------------------------------------ 4) eventos

CREATE TABLE IF NOT EXISTS public.proposta_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposta_id uuid NOT NULL REFERENCES public.propostas(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN (
    'criada', 'gerada', 'pesquisada', 'editada', 'revisada', 'enviada', 'email_enviado', 'aberta', 'leitura',
    'aceita', 'recusada', 'expirada', 'arquivada', 'restaurada', 'contrato_pedido', 'contrato_pendente'
  )),
  sessao text,
  segundos integer CHECK (segundos IS NULL OR segundos >= 0),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  user_agent text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposta_eventos_proposta_idx ON public.proposta_eventos (proposta_id, criado_em DESC);
-- Uma abertura por sessão do navegador (o tempo de leitura atualiza a mesma linha).
CREATE UNIQUE INDEX IF NOT EXISTS proposta_eventos_abertura_por_sessao ON public.proposta_eventos (proposta_id, sessao) WHERE tipo = 'aberta' AND sessao IS NOT NULL;

-- ------------------------------------------------------------------ RLS

ALTER TABLE public.proposta_modelos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposta_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposta_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposta_modelos_gestao_le ON public.proposta_modelos;
CREATE POLICY proposta_modelos_gestao_le ON public.proposta_modelos
  FOR SELECT TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR public.has_role((select auth.uid()), 'manager'::public.app_role)
  );

DROP POLICY IF EXISTS propostas_gestao_le ON public.propostas;
CREATE POLICY propostas_gestao_le ON public.propostas
  FOR SELECT TO authenticated
  USING (
    (public.has_role((select auth.uid()), 'admin'::public.app_role) OR public.has_role((select auth.uid()), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  );

DROP POLICY IF EXISTS proposta_versoes_gestao_le ON public.proposta_versoes;
CREATE POLICY proposta_versoes_gestao_le ON public.proposta_versoes
  FOR SELECT TO authenticated
  USING (
    (public.has_role((select auth.uid()), 'admin'::public.app_role) OR public.has_role((select auth.uid()), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  );

DROP POLICY IF EXISTS proposta_eventos_gestao_le ON public.proposta_eventos;
CREATE POLICY proposta_eventos_gestao_le ON public.proposta_eventos
  FOR SELECT TO authenticated
  USING (
    (public.has_role((select auth.uid()), 'admin'::public.app_role) OR public.has_role((select auth.uid()), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  );

REVOKE ALL ON public.proposta_modelos, public.propostas, public.proposta_versoes, public.proposta_eventos FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.proposta_modelos, public.propostas, public.proposta_versoes, public.proposta_eventos FROM authenticated;
GRANT SELECT ON public.proposta_modelos, public.propostas, public.proposta_versoes, public.proposta_eventos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposta_modelos, public.propostas, public.proposta_versoes, public.proposta_eventos TO service_role;

-- ------------------------------------------------------------------ modelo padrão Aceleriq

INSERT INTO public.proposta_modelos (id, nome, descricao, padrao, validade_dias, condicoes, blocos)
VALUES (
  'a0c1e1a0-0000-4000-8000-000000000001',
  'Padrão Aceleriq',
  'Proposta vertical em 12 blocos, com mercado e preço pelos itens.',
  true,
  15,
  '50% na aprovação e 50% na entrega, por PIX ou boleto. Os detalhes ficam no contrato.',
  '[
    {"tipo": "capa", "titulo": "Capa", "visivel": true, "dados": {}},
    {"tipo": "desafio", "titulo": "O desafio", "visivel": true, "dados": {"compromisso": "Nosso compromisso é resolver isso com método, prazo claro e conversa aberta em cada etapa."}},
    {"tipo": "diagnostico", "titulo": "Onde vocês estão hoje", "visivel": true, "dados": {}},
    {"tipo": "mercado", "titulo": "O mercado", "visivel": true, "dados": {}},
    {"tipo": "solucao", "titulo": "O que vamos fazer", "visivel": true, "dados": {}},
    {"tipo": "entregaveis", "titulo": "O que você recebe", "visivel": true, "dados": {"nao_inclui": ["Custos de terceiros (impressão, mídia paga, domínio e hospedagem), salvo quando listados nos itens."]}},
    {"tipo": "processo", "titulo": "Como trabalhamos", "visivel": true, "dados": {"etapas": [
      {"titulo": "Imersão", "texto": "Reunião de kickoff, briefing e leitura do que já existe."},
      {"titulo": "Estratégia", "texto": "Diagnóstico, referências e a direção aprovada com você."},
      {"titulo": "Criação", "texto": "Produção das entregas com revisões combinadas."},
      {"titulo": "Entrega", "texto": "Arquivos finais, orientação de uso e próximos passos."}
    ]}},
    {"tipo": "cronograma", "titulo": "Cronograma", "visivel": true, "dados": {"observacao": "As datas contam a partir da aprovação e podem mudar com o tempo de resposta de cada etapa."}},
    {"tipo": "investimento", "titulo": "Investimento", "visivel": true, "dados": {}},
    {"tipo": "provas", "titulo": "Quem já trabalhou com a gente", "visivel": true, "dados": {}},
    {"tipo": "quem_somos", "titulo": "Quem somos", "visivel": true, "dados": {}},
    {"tipo": "proximos_passos", "titulo": "Próximos passos", "visivel": true, "dados": {"passos": ["Aceite esta proposta pelo botão abaixo.", "Enviamos o contrato para assinatura.", "Marcamos o kickoff."], "chamada": "Vamos começar?"}}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------ 5) link público (só service_role)

-- Ler pelo token: devolve só o que o cliente vê. Enviada ou vista depois da
-- validade vira expirada aqui mesmo (com o evento), sem cron.
CREATE OR REPLACE FUNCTION public.proposta_publica_ler(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _p public.propostas%ROWTYPE;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _cliente text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'proposta publica requires the trusted backend';
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) < 32 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _p FROM public.propostas
  WHERE token = btrim(p_token) AND status <> 'rascunho' AND arquivada_em IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF _p.status IN ('enviada', 'vista') AND _p.validade_ate IS NOT NULL AND _p.validade_ate < _hoje THEN
    UPDATE public.propostas SET status = 'expirada', expirada_em = now() WHERE id = _p.id;
    INSERT INTO public.proposta_eventos (proposta_id, client_id, tipo, dados)
    VALUES (_p.id, _p.client_id, 'expirada', jsonb_build_object('validade_ate', _p.validade_ate));
    _p.status := 'expirada';
  END IF;

  SELECT coalesce(nullif(btrim(company_name), ''), nullif(btrim(full_name), ''), 'Cliente') INTO _cliente
  FROM public.profiles WHERE id = _p.client_id;

  RETURN jsonb_build_object(
    'id', _p.id,
    'numero', _p.numero,
    'titulo', _p.titulo,
    'status', _p.status,
    'validade_ate', _p.validade_ate,
    'enviada_em', _p.enviada_em,
    'conteudo', _p.conteudo,
    'itens', _p.itens,
    'total_unico', _p.total_unico,
    'total_mensal', _p.total_mensal,
    'cliente', _cliente,
    'logo_cliente_path', _p.logo_cliente_path,
    'aceite', CASE WHEN _p.aceite IS NULL THEN NULL ELSE jsonb_build_object('nome', _p.aceite->>'nome', 'em', _p.aceita_em) END
  );
END;
$$;

-- Abertura (uma linha por sessão do navegador) e tempo de leitura (a mesma linha cresce, até 4 h).
CREATE OR REPLACE FUNCTION public.proposta_publica_evento(
  p_token text,
  p_tipo text,
  p_sessao text,
  p_segundos integer,
  p_ip text,
  p_user_agent text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _p public.propostas%ROWTYPE;
  _sessao text := left(btrim(coalesce(p_sessao, '')), 64);
  _segundos integer := least(greatest(coalesce(p_segundos, 0), 0), 14400);
  _novo boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'proposta publica requires the trusted backend';
  END IF;
  IF p_tipo NOT IN ('aberta', 'leitura') OR length(_sessao) < 8 THEN
    RAISE EXCEPTION 'invalid proposal event';
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) < 32 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT * INTO _p FROM public.propostas
  WHERE token = btrim(p_token) AND status <> 'rascunho' AND arquivada_em IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  -- Teto de linhas por proposta (link espalhado não enche o banco).
  IF (SELECT count(*) FROM public.proposta_eventos WHERE proposta_id = _p.id AND tipo = 'aberta') >= 2000 THEN
    RETURN jsonb_build_object('ok', true, 'limite', true);
  END IF;

  INSERT INTO public.proposta_eventos (proposta_id, client_id, tipo, sessao, segundos, ip, user_agent)
  VALUES (_p.id, _p.client_id, 'aberta', _sessao, CASE WHEN p_tipo = 'leitura' THEN _segundos ELSE 0 END, left(p_ip, 80), left(p_user_agent, 300))
  ON CONFLICT (proposta_id, sessao) WHERE tipo = 'aberta' AND sessao IS NOT NULL
  DO UPDATE SET segundos = greatest(coalesce(public.proposta_eventos.segundos, 0), EXCLUDED.segundos)
  RETURNING (xmax = 0) INTO _novo;

  IF _p.vista_em IS NULL THEN
    UPDATE public.propostas
    SET vista_em = now(), status = CASE WHEN status = 'enviada' THEN 'vista' ELSE status END
    WHERE id = _p.id;
    IF _p.lead_id IS NOT NULL THEN
      INSERT INTO public.commercial_lead_events (lead_id, kind, note)
      VALUES (_p.lead_id, 'nota', 'Proposta ' || _p.numero || ' aberta pelo cliente.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'nova_sessao', _novo);
END;
$$;

-- Aceite: nome, e-mail, IP, navegador e o hash do texto enviado. Idempotente.
CREATE OR REPLACE FUNCTION public.proposta_publica_aceitar(
  p_token text,
  p_nome text,
  p_email text,
  p_ip text,
  p_user_agent text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _p public.propostas%ROWTYPE;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _nome text := left(btrim(coalesce(p_nome, '')), 200);
  _email text := lower(left(btrim(coalesce(p_email, '')), 200));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'proposta publica requires the trusted backend';
  END IF;
  IF length(_nome) < 3 OR _email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN
    RAISE EXCEPTION 'invalid acceptance input';
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) < 32 THEN
    RAISE EXCEPTION 'proposal not found';
  END IF;

  SELECT * INTO _p FROM public.propostas
  WHERE token = btrim(p_token) AND status <> 'rascunho' AND arquivada_em IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal not found';
  END IF;

  IF _p.status = 'aceita' THEN
    RETURN jsonb_build_object('proposta_id', _p.id, 'client_id', _p.client_id, 'aceita_em', _p.aceita_em, 'ja_aceita', true);
  END IF;
  IF _p.status NOT IN ('enviada', 'vista') THEN
    RAISE EXCEPTION 'proposal not open';
  END IF;
  IF _p.validade_ate IS NOT NULL AND _p.validade_ate < _hoje THEN
    UPDATE public.propostas SET status = 'expirada', expirada_em = now() WHERE id = _p.id;
    INSERT INTO public.proposta_eventos (proposta_id, client_id, tipo, dados)
    VALUES (_p.id, _p.client_id, 'expirada', jsonb_build_object('validade_ate', _p.validade_ate));
    RAISE EXCEPTION 'proposal expired';
  END IF;

  UPDATE public.propostas
  SET status = 'aceita',
      aceita_em = now(),
      aceite = jsonb_build_object(
        'nome', _nome, 'email', _email, 'ip', left(p_ip, 80), 'user_agent', left(p_user_agent, 300),
        'hash', _p.hash_enviado, 'versao', _p.versao, 'em', now()
      )
  WHERE id = _p.id;

  INSERT INTO public.proposta_eventos (proposta_id, client_id, tipo, ip, user_agent, dados)
  VALUES (_p.id, _p.client_id, 'aceita', left(p_ip, 80), left(p_user_agent, 300),
    jsonb_build_object('nome', _nome, 'email', _email, 'hash', _p.hash_enviado, 'versao', _p.versao, 'total_unico', _p.total_unico, 'total_mensal', _p.total_mensal));

  IF _p.lead_id IS NOT NULL THEN
    INSERT INTO public.commercial_lead_events (lead_id, kind, note)
    VALUES (_p.lead_id, 'nota', 'Proposta ' || _p.numero || ' aceita por ' || _nome || '.');
  END IF;

  RETURN jsonb_build_object('proposta_id', _p.id, 'client_id', _p.client_id, 'aceita_em', now(), 'ja_aceita', false);
END;
$$;

REVOKE ALL ON FUNCTION public.proposta_publica_ler(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proposta_publica_evento(text, text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proposta_publica_aceitar(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proposta_publica_ler(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.proposta_publica_evento(text, text, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.proposta_publica_aceitar(text, text, text, text, text) TO service_role;

-- ------------------------------------------------------------------ 6) escolha de clientes por mesa

DO $$
DECLARE
  _def text;
  _valores text[];
BEGIN
  IF to_regclass('public.mesa_cliente_escolhas') IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
  WHERE conrelid = 'public.mesa_cliente_escolhas'::regclass AND conname = 'mesa_cliente_escolhas_mesa_check';
  SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(coalesce(_def, ''), '''([a-z_]+)''', 'g') AS m;
  _valores := ARRAY(SELECT DISTINCT unnest(coalesce(_valores, '{}'::text[]) || ARRAY['organica', 'ads', 'foto', 'publicidade', 'videos', 'roteiros', 'edicao', 'proposta']));
  EXECUTE 'ALTER TABLE public.mesa_cliente_escolhas DROP CONSTRAINT IF EXISTS mesa_cliente_escolhas_mesa_check';
  EXECUTE format('ALTER TABLE public.mesa_cliente_escolhas ADD CONSTRAINT mesa_cliente_escolhas_mesa_check CHECK (mesa = ANY (%L::text[]))', _valores);
END $$;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select count(*) from public.proposta_modelos where padrao;
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'mesa_cliente_escolhas_mesa_check';
-- select proname, prosecdef from pg_proc where proname like 'proposta_publica_%';
