-- Frente PRO2 (30/09/2026): a Mesa Proposta mais completa.
-- Só amplia e é idempotente (pode rodar mais de uma vez). Não mexe em dado existente.
--
-- 1) propostas ganha: pacotes (3 pacotes cumulativos pelo nível de cada item),
--    pagamento (à vista com desconto, parcelado, mensal), visual (modelo visual e
--    as cores do cliente), anexos (link de portfólio e PDF no Storage), a origem
--    da duplicação, o pacote e o pagamento escolhidos no aceite e o último follow-up.
-- 2) proposta_versoes guarda também pacotes e pagamento (Desfazer e comparar versões);
--    a origem da versão e o tipo de evento aceitam os nomes novos.
-- 3) proposta_servicos: a biblioteca de serviços da agência (preço, unidade, horas, entregáveis).
-- 4) proposta_provas: cases e depoimentos reais, com a autorização registrada.
-- 5) proposta_calculadora: os parâmetros da hora técnica (uma linha só).
-- 6) O link público lê os campos novos e o aceite v2 grava o pacote e o pagamento escolhidos.
--
-- RLS: as tabelas novas são da agência (não de um cliente): só admin e gestor leem.
-- Ninguém escreve pela API: toda escrita passa pelas funções mesa-proposta e
-- proposta-biblioteca (service_role) ou pela RPC security definer do aceite.

-- ------------------------------------------------------------------ 1) propostas

ALTER TABLE public.propostas ADD COLUMN IF NOT EXISTS pacotes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.propostas ADD COLUMN IF NOT EXISTS pagamento jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.propostas ADD COLUMN IF NOT EXISTS visual jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.propostas ADD COLUMN IF NOT EXISTS anexos jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.propostas ADD COLUMN IF NOT EXISTS duplicada_de uuid REFERENCES public.propostas(id) ON DELETE SET NULL;
ALTER TABLE public.propostas ADD COLUMN IF NOT EXISTS pacote_aceito text;
ALTER TABLE public.propostas ADD COLUMN IF NOT EXISTS pagamento_aceito text;
ALTER TABLE public.propostas ADD COLUMN IF NOT EXISTS ultimo_followup_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.propostas'::regclass AND conname = 'propostas_pacotes_objeto') THEN
    ALTER TABLE public.propostas ADD CONSTRAINT propostas_pacotes_objeto CHECK (jsonb_typeof(pacotes) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.propostas'::regclass AND conname = 'propostas_pagamento_objeto') THEN
    ALTER TABLE public.propostas ADD CONSTRAINT propostas_pagamento_objeto CHECK (jsonb_typeof(pagamento) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.propostas'::regclass AND conname = 'propostas_visual_objeto') THEN
    ALTER TABLE public.propostas ADD CONSTRAINT propostas_visual_objeto CHECK (jsonb_typeof(visual) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.propostas'::regclass AND conname = 'propostas_anexos_lista') THEN
    ALTER TABLE public.propostas ADD CONSTRAINT propostas_anexos_lista CHECK (jsonb_typeof(anexos) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.propostas'::regclass AND conname = 'propostas_pacote_aceito_valido') THEN
    ALTER TABLE public.propostas ADD CONSTRAINT propostas_pacote_aceito_valido CHECK (pacote_aceito IS NULL OR pacote_aceito IN ('essencial', 'recomendado', 'completo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS propostas_followup_idx ON public.propostas (status, enviada_em) WHERE status IN ('enviada', 'vista') AND arquivada_em IS NULL;

-- ------------------------------------------------------------------ 2) versões e eventos

ALTER TABLE public.proposta_versoes ADD COLUMN IF NOT EXISTS pacotes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.proposta_versoes ADD COLUMN IF NOT EXISTS pagamento jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Origem da versão: os nomes de antes mais os da PRO2 (sem tirar nenhum).
ALTER TABLE public.proposta_versoes DROP CONSTRAINT IF EXISTS proposta_versoes_origem_check;
ALTER TABLE public.proposta_versoes ADD CONSTRAINT proposta_versoes_origem_check CHECK (origem IN (
  'manual', 'agente', 'geracao', 'pesquisa', 'restauracao', 'envio',
  'duplicacao', 'preenchimento', 'pacotes', 'margem', 'resumo'
));

-- Tipos de evento: os de antes mais os da PRO2 (sem tirar nenhum).
ALTER TABLE public.proposta_eventos DROP CONSTRAINT IF EXISTS proposta_eventos_tipo_check;
ALTER TABLE public.proposta_eventos ADD CONSTRAINT proposta_eventos_tipo_check CHECK (tipo IN (
  'criada', 'gerada', 'pesquisada', 'editada', 'revisada', 'enviada', 'email_enviado', 'aberta', 'leitura',
  'aceita', 'recusada', 'expirada', 'arquivada', 'restaurada', 'contrato_pedido', 'contrato_pendente',
  'duplicada', 'followup', 'pacotes_montados', 'anexo', 'preenchida'
));

-- ------------------------------------------------------------------ 3) biblioteca de serviços

CREATE TABLE IF NOT EXISTS public.proposta_servicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (btrim(nome) <> '' AND length(nome) <= 120),
  categoria text,
  descricao text,
  unidade text NOT NULL DEFAULT 'projeto' CHECK (unidade IN ('projeto', 'mes', 'hora', 'peca', 'pagina', 'video', 'diaria', 'campanha')),
  preco numeric(14, 2) NOT NULL CHECK (preco >= 0 AND preco <= 10000000),
  recorrencia text NOT NULL DEFAULT 'unico' CHECK (recorrencia IN ('unico', 'mensal')),
  horas numeric(10, 2) CHECK (horas IS NULL OR (horas > 0 AND horas <= 10000)),
  entregaveis jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(entregaveis) = 'array'),
  ordem integer NOT NULL DEFAULT 0,
  arquivado_em timestamptz,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposta_servicos_vivos_idx ON public.proposta_servicos (categoria, ordem, nome) WHERE arquivado_em IS NULL;

DROP TRIGGER IF EXISTS proposta_servicos_tocar_atualizado_em ON public.proposta_servicos;
CREATE TRIGGER proposta_servicos_tocar_atualizado_em
BEFORE UPDATE ON public.proposta_servicos
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- ------------------------------------------------------------------ 4) provas com autorização

CREATE TABLE IF NOT EXISTS public.proposta_provas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('case', 'depoimento')),
  titulo text,
  texto text,
  nome text,
  cargo text,
  empresa text,
  link text CHECK (link IS NULL OR link ~* '^https?://'),
  nicho text,
  -- Cliente do case (quando é cliente do painel): só para achar; a prova é da agência.
  client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  autorizado boolean NOT NULL DEFAULT false,
  -- Como e por quem a autorização foi dada (ex.: "e-mail da Joana em 12/09").
  autorizacao text,
  autorizado_em date,
  autorizado_por uuid,
  arquivado_em timestamptz,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proposta_provas_forma CHECK (
    (tipo = 'case' AND btrim(coalesce(titulo, '')) <> '')
    OR (tipo = 'depoimento' AND btrim(coalesce(nome, '')) <> '' AND btrim(coalesce(texto, '')) <> '')
  ),
  -- Autorizado sem registro de como foi autorizado não vale.
  CONSTRAINT proposta_provas_autorizacao_registrada CHECK (NOT autorizado OR length(btrim(coalesce(autorizacao, ''))) >= 3)
);

CREATE INDEX IF NOT EXISTS proposta_provas_vivas_idx ON public.proposta_provas (tipo, criado_em DESC) WHERE arquivado_em IS NULL;

DROP TRIGGER IF EXISTS proposta_provas_tocar_atualizado_em ON public.proposta_provas;
CREATE TRIGGER proposta_provas_tocar_atualizado_em
BEFORE UPDATE ON public.proposta_provas
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- ------------------------------------------------------------------ 5) calculadora da hora técnica

CREATE TABLE IF NOT EXISTS public.proposta_calculadora (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Ligado: custos fixos e pró-labore vêm das regras recorrentes do Financeiro.
  usar_financeiro boolean NOT NULL DEFAULT true,
  custos_fixos_mes numeric(14, 2) NOT NULL DEFAULT 0 CHECK (custos_fixos_mes >= 0),
  pro_labore_mes numeric(14, 2) NOT NULL DEFAULT 0 CHECK (pro_labore_mes >= 0),
  horas_produtivas_mes numeric(10, 2) NOT NULL DEFAULT 120 CHECK (horas_produtivas_mes > 0),
  impostos_pct numeric(5, 2) NOT NULL DEFAULT 6 CHECK (impostos_pct >= 0 AND impostos_pct <= 60),
  margem_pct numeric(5, 2) NOT NULL DEFAULT 25 CHECK (margem_pct >= 0 AND margem_pct <= 80),
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.proposta_calculadora (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------ RLS das tabelas novas

ALTER TABLE public.proposta_servicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposta_provas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposta_calculadora ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposta_servicos_gestao_le ON public.proposta_servicos;
CREATE POLICY proposta_servicos_gestao_le ON public.proposta_servicos
  FOR SELECT TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR public.has_role((select auth.uid()), 'manager'::public.app_role)
  );

DROP POLICY IF EXISTS proposta_provas_gestao_le ON public.proposta_provas;
CREATE POLICY proposta_provas_gestao_le ON public.proposta_provas
  FOR SELECT TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR public.has_role((select auth.uid()), 'manager'::public.app_role)
  );

DROP POLICY IF EXISTS proposta_calculadora_gestao_le ON public.proposta_calculadora;
CREATE POLICY proposta_calculadora_gestao_le ON public.proposta_calculadora
  FOR SELECT TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR public.has_role((select auth.uid()), 'manager'::public.app_role)
  );

REVOKE ALL ON public.proposta_servicos, public.proposta_provas, public.proposta_calculadora FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.proposta_servicos, public.proposta_provas, public.proposta_calculadora FROM authenticated;
GRANT SELECT ON public.proposta_servicos, public.proposta_provas, public.proposta_calculadora TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposta_servicos, public.proposta_provas, public.proposta_calculadora TO service_role;

-- ------------------------------------------------------------------ 6) link público

-- Ler pelo token: o mesmo de antes (marca expirada na hora) mais pacotes,
-- pagamento, visual, anexos e o pacote aceito. Os caminhos dos anexos saem
-- daqui e a função proposta-publica troca por link assinado.
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
    'pacotes', _p.pacotes,
    'pagamento', _p.pagamento,
    'visual', _p.visual,
    'anexos', _p.anexos,
    'pacote_aceito', _p.pacote_aceito,
    'pagamento_aceito', _p.pagamento_aceito,
    'aceite', CASE WHEN _p.aceite IS NULL THEN NULL ELSE jsonb_build_object('nome', _p.aceite->>'nome', 'em', _p.aceita_em) END
  );
END;
$$;

-- Aceite v2: o mesmo do aceite de antes (nome, e-mail, IP, navegador, hash,
-- idempotente, validade no dia de São Paulo) mais o pacote e a forma de
-- pagamento escolhidos. Com pacotes ligados, o pacote é obrigatório e os
-- itens e os totais passam a ser os do pacote aceito (os itens enviados
-- ficam no aceite, como prova).
CREATE OR REPLACE FUNCTION public.proposta_publica_aceitar_v2(
  p_token text,
  p_nome text,
  p_email text,
  p_ip text,
  p_user_agent text,
  p_pacote text,
  p_pagamento text
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
  _pacote text := nullif(btrim(coalesce(p_pacote, '')), '');
  _pagamento text := nullif(left(btrim(coalesce(p_pagamento, '')), 30), '');
  _com_pacotes boolean;
  _ordem integer;
  _itens jsonb;
  _unico numeric(14, 2);
  _mensal numeric(14, 2);
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
    RETURN jsonb_build_object('proposta_id', _p.id, 'client_id', _p.client_id, 'aceita_em', _p.aceita_em, 'ja_aceita', true, 'pacote', _p.pacote_aceito);
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

  _com_pacotes := coalesce((_p.pacotes->>'ativo')::boolean, false);
  _itens := _p.itens;
  IF _com_pacotes THEN
    IF _pacote IS NULL OR _pacote NOT IN ('essencial', 'recomendado', 'completo') THEN
      RAISE EXCEPTION 'package required';
    END IF;
    _ordem := CASE _pacote WHEN 'essencial' THEN 1 WHEN 'recomendado' THEN 2 ELSE 3 END;
    SELECT coalesce(jsonb_agg(i ORDER BY n), '[]'::jsonb) INTO _itens
    FROM jsonb_array_elements(_p.itens) WITH ORDINALITY AS t(i, n)
    WHERE (CASE coalesce(_p.pacotes->'niveis'->>(i->>'id'), 'essencial') WHEN 'completo' THEN 3 WHEN 'recomendado' THEN 2 ELSE 1 END) <= _ordem;
  ELSE
    _pacote := NULL;
  END IF;
  IF _pagamento IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(_p.pagamento->'opcoes', '[]'::jsonb)) AS o(x) WHERE o.x->>'id' = _pagamento
  ) THEN
    RAISE EXCEPTION 'invalid payment option';
  END IF;

  SELECT
    coalesce(sum(round(coalesce((i->>'quantidade')::numeric, 1) * coalesce((i->>'valor_unitario')::numeric, 0), 2)) FILTER (WHERE coalesce(i->>'recorrencia', 'unico') <> 'mensal'), 0),
    coalesce(sum(round(coalesce((i->>'quantidade')::numeric, 1) * coalesce((i->>'valor_unitario')::numeric, 0), 2)) FILTER (WHERE i->>'recorrencia' = 'mensal'), 0)
  INTO _unico, _mensal
  FROM jsonb_array_elements(_itens) AS t(i);

  UPDATE public.propostas
  SET status = 'aceita',
      aceita_em = now(),
      itens = _itens,
      total_unico = _unico,
      total_mensal = _mensal,
      pacote_aceito = _pacote,
      pagamento_aceito = _pagamento,
      aceite = jsonb_build_object(
        'nome', _nome, 'email', _email, 'ip', left(p_ip, 80), 'user_agent', left(p_user_agent, 300),
        'hash', _p.hash_enviado, 'versao', _p.versao, 'em', now(),
        'pacote', _pacote, 'pagamento', _pagamento,
        'itens_enviados', CASE WHEN _com_pacotes THEN _p.itens ELSE NULL END
      )
  WHERE id = _p.id;

  INSERT INTO public.proposta_eventos (proposta_id, client_id, tipo, ip, user_agent, dados)
  VALUES (_p.id, _p.client_id, 'aceita', left(p_ip, 80), left(p_user_agent, 300),
    jsonb_build_object('nome', _nome, 'email', _email, 'hash', _p.hash_enviado, 'versao', _p.versao, 'total_unico', _unico, 'total_mensal', _mensal, 'pacote', _pacote, 'pagamento', _pagamento));

  IF _p.lead_id IS NOT NULL THEN
    INSERT INTO public.commercial_lead_events (lead_id, kind, note)
    VALUES (_p.lead_id, 'nota', 'Proposta ' || _p.numero || ' aceita por ' || _nome || coalesce(' (pacote ' || _pacote || ')', '') || '.');
  END IF;

  RETURN jsonb_build_object('proposta_id', _p.id, 'client_id', _p.client_id, 'aceita_em', now(), 'ja_aceita', false, 'pacote', _pacote);
END;
$$;

REVOKE ALL ON FUNCTION public.proposta_publica_ler(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proposta_publica_aceitar_v2(text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proposta_publica_ler(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.proposta_publica_aceitar_v2(text, text, text, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select column_name from information_schema.columns where table_name = 'propostas' and column_name in ('pacotes', 'pagamento', 'visual', 'anexos', 'duplicada_de', 'pacote_aceito', 'pagamento_aceito', 'ultimo_followup_em');
-- select count(*) from public.proposta_calculadora;
-- select proname, prosecdef from pg_proc where proname in ('proposta_publica_ler', 'proposta_publica_aceitar_v2');
