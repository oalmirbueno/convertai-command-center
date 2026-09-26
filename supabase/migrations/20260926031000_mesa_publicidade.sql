-- Frente P (26/09 madrugada): Mesa Publicidade (/mesa-publicidade).
-- Kit: scratchpad/kits/publicidade. Código: supabase/functions/mesa-publicidade.
--
-- A Mesa Publicidade DIRIGE a campanha; a Mesa Foto PRODUZ (foto_ensaios,
-- cliente_imagens); a Mesa Ads testa. Estas tabelas guardam só a direção
-- (campanha, briefing versionado, territórios, plano de tomadas, revisões e
-- encaminhamentos com linhagem). Nenhum acervo novo, nenhuma carteira nova.
--
-- Só amplia, idempotente. Sem este SQL a mesa funciona em modo rascunho
-- (a campanha fica só na tela; o ensaio e as fotos continuam salvos na Mesa Foto).
--
-- RLS padrão: equipe lê (is_staff + can_access_client); só a service_role
-- escreve (a função mesa-publicidade confere o acesso antes de gravar).

-- ─── 1) campanhas ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.publicidade_campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid,
  nome text NOT NULL DEFAULT '',
  categoria text,
  kit_id uuid REFERENCES public.foto_kits(id) ON DELETE SET NULL,
  kit_nome text NOT NULL DEFAULT '',
  kit_tipo text NOT NULL DEFAULT '',
  produto_fontes uuid[] NOT NULL DEFAULT '{}',
  briefing jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(briefing) = 'object'),
  briefing_versao integer NOT NULL DEFAULT 1 CHECK (briefing_versao >= 1),
  territorio_id uuid,
  ensaio_id uuid REFERENCES public.foto_ensaios(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN (
    'rascunho', 'briefing_pronto', 'direcao_aprovada', 'em_producao', 'em_revisao', 'pronta', 'em_distribuicao', 'pausada', 'cancelada'
  )),
  arquivada boolean NOT NULL DEFAULT false,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publicidade_campanhas_cliente_idx ON public.publicidade_campanhas (client_id, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS publicidade_campanhas_kit_idx ON public.publicidade_campanhas (kit_id);
CREATE INDEX IF NOT EXISTS publicidade_campanhas_ensaio_idx ON public.publicidade_campanhas (ensaio_id);

-- ─── 2) briefing versionado (imutável: cada salvar com mudança cria versão) ──
CREATE TABLE IF NOT EXISTS public.publicidade_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.publicidade_campanhas(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  versao integer NOT NULL CHECK (versao >= 1),
  briefing jsonb NOT NULL CHECK (jsonb_typeof(briefing) = 'object'),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, versao)
);
CREATE INDEX IF NOT EXISTS publicidade_briefings_cliente_idx ON public.publicidade_briefings (client_id);

-- ─── 3) territórios criativos ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.publicidade_territorios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.publicidade_campanhas(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 1,
  briefing_versao integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'proposto' CHECK (status IN ('proposto', 'aprovado', 'descartado')),
  dados jsonb NOT NULL CHECK (jsonb_typeof(dados) = 'object'),
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  decidido_por uuid,
  decidido_em timestamptz
);
CREATE INDEX IF NOT EXISTS publicidade_territorios_campanha_idx ON public.publicidade_territorios (campanha_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS publicidade_territorios_cliente_idx ON public.publicidade_territorios (client_id);

-- ─── 4) plano de tomadas (seis, uma por função) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.publicidade_tomadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.publicidade_campanhas(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  territorio_id uuid REFERENCES public.publicidade_territorios(id) ON DELETE SET NULL,
  ordem integer NOT NULL CHECK (ordem BETWEEN 1 AND 6),
  funcao text NOT NULL CHECK (funcao IN ('atrair', 'apresentar_produto', 'contextualizar_uso', 'mostrar_detalhe', 'expressar_conceito', 'apoiar_acao')),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dados) = 'object'),
  ensaio_id uuid REFERENCES public.foto_ensaios(id) ON DELETE SET NULL,
  foto_tomada_id text,
  status text NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada', 'pedida', 'gerada', 'aprovada', 'reprovada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, funcao)
);
CREATE INDEX IF NOT EXISTS publicidade_tomadas_cliente_idx ON public.publicidade_tomadas (client_id);

-- ─── 5) revisões (produto antes da estética) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.publicidade_revisoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.publicidade_campanhas(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tomada_id uuid REFERENCES public.publicidade_tomadas(id) ON DELETE SET NULL,
  ensaio_id uuid REFERENCES public.foto_ensaios(id) ON DELETE SET NULL,
  foto_tomada_id text NOT NULL,
  versao integer NOT NULL CHECK (versao >= 1),
  imagem_id uuid,
  storage_path text,
  avaliacao jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(avaliacao) = 'object'),
  aviso_jev jsonb,
  decisao text CHECK (decisao IS NULL OR decisao IN ('aprovada', 'reprovada')),
  motivo text,
  decidido_por uuid,
  decidido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, foto_tomada_id, versao)
);
CREATE INDEX IF NOT EXISTS publicidade_revisoes_cliente_idx ON public.publicidade_revisoes (client_id);
CREATE INDEX IF NOT EXISTS publicidade_revisoes_imagem_idx ON public.publicidade_revisoes (imagem_id);

-- ─── 6) encaminhamentos com linhagem (Mesa e Mesa Ads) ──────────────────
CREATE TABLE IF NOT EXISTS public.publicidade_encaminhamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.publicidade_campanhas(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  revisao_id uuid REFERENCES public.publicidade_revisoes(id) ON DELETE SET NULL,
  imagem_id uuid NOT NULL,
  destino text NOT NULL CHECK (destino IN ('mesa', 'ads')),
  linhagem jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(linhagem) = 'object'),
  -- Aprovar a foto não aprova anúncio nem verba: estes ficam false aqui; a Mesa Ads decide.
  anuncio_aprovado boolean NOT NULL DEFAULT false,
  verba_aprovada boolean NOT NULL DEFAULT false,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, imagem_id, destino)
);
CREATE INDEX IF NOT EXISTS publicidade_encaminhamentos_cliente_idx ON public.publicidade_encaminhamentos (client_id, destino, criado_em DESC);
CREATE INDEX IF NOT EXISTS publicidade_encaminhamentos_imagem_idx ON public.publicidade_encaminhamentos (imagem_id);

-- ─── 7) RLS: equipe lê, só a service_role escreve ───────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['publicidade_campanhas', 'publicidade_briefings', 'publicidade_territorios', 'publicidade_tomadas', 'publicidade_revisoes', 'publicidade_encaminhamentos']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_staff_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id))',
      t || '_staff_read', t
    );
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ─── 8) seletor de clientes: a mesa 'publicidade' ───────────────────────
-- ATENÇÃO coordenador: outras frentes da mesma noite (R2, V2) podem ampliar
-- esta mesma lista. Junte os valores numa execução só (a última vence).
ALTER TABLE public.mesa_cliente_escolhas DROP CONSTRAINT IF EXISTS mesa_cliente_escolhas_mesa_check;
ALTER TABLE public.mesa_cliente_escolhas
  ADD CONSTRAINT mesa_cliente_escolhas_mesa_check CHECK (mesa IN ('organica', 'ads', 'foto', 'publicidade'));

CREATE OR REPLACE FUNCTION public.mesa_escolher_cliente(_mesa text, _client_id uuid, _modo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre no painel para mudar os clientes da mesa.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'Só admin e gestor mudam os clientes da mesa.' USING ERRCODE = '42501';
  END IF;
  IF _mesa IS NULL OR _mesa NOT IN ('organica', 'ads', 'foto', 'publicidade') THEN
    RAISE EXCEPTION 'Mesa desconhecida.' USING ERRCODE = '22023';
  END IF;
  IF _client_id IS NULL OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'Cliente fora do seu acesso.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _client_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = '22023';
  END IF;

  IF _modo IS NULL THEN
    DELETE FROM public.mesa_cliente_escolhas WHERE mesa = _mesa AND client_id = _client_id;
    RETURN;
  END IF;
  IF _modo NOT IN ('incluir', 'retirar') THEN
    RAISE EXCEPTION 'Modo desconhecido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.mesa_cliente_escolhas (mesa, client_id, modo, atualizado_por, atualizado_em)
  VALUES (_mesa, _client_id, _modo, auth.uid(), now())
  ON CONFLICT (mesa, client_id)
  DO UPDATE SET modo = EXCLUDED.modo, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = EXCLUDED.atualizado_em;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_escolher_cliente(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_escolher_cliente(text, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
