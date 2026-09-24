-- ═══════════════════════════════════════════════════════════════════════
-- MESA ADS: criativos de anúncio para alta conversão (docs/mesa-ads/SPEC.md).
-- Briefing de performance, biblioteca de referências com escala de
-- evidência E0 a E4, plano de teste por ângulos, criativos (imagem no motor
-- do Estúdio e copy do anúncio) e aprendizados com métricas reais.
-- Escritas pesadas passam pela função mesa-ads (chave de serviço); a equipe
-- lê e ajusta o que é dela na tela.
-- ═══════════════════════════════════════════════════════════════════════

-- 1) Briefing de performance (versões; uma atual por cliente)
CREATE TABLE IF NOT EXISTS public.ads_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  versao integer NOT NULL DEFAULT 1,
  atual boolean NOT NULL DEFAULT true,
  oferta jsonb NOT NULL DEFAULT '{}'::jsonb,
  publico jsonb NOT NULL DEFAULT '{}'::jsonb,
  objecoes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(objecoes) = 'array'),
  provas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provas) = 'array'),
  destino jsonb NOT NULL DEFAULT '{}'::jsonb,
  objetivo jsonb NOT NULL DEFAULT '{}'::jsonb,
  restricoes text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ads_briefings_um_atual ON public.ads_briefings (client_id) WHERE atual;
CREATE INDEX IF NOT EXISTS ads_briefings_cliente_idx ON public.ads_briefings (client_id, versao DESC);

-- 2) Biblioteca de referências (client_id nulo = biblioteca da agência)
CREATE TABLE IF NOT EXISTS public.ads_referencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  url text,
  origem text NOT NULL DEFAULT 'outro' CHECK (origem IN ('meta_ad_library', 'tiktok', 'swiped', 'pinterest', 'instagram', 'upload', 'anuncio_proprio', 'catalogo', 'outro')),
  storage_path text,
  ad_id text,
  plataforma text,
  formato text,
  evidencia text NOT NULL DEFAULT 'E0' CHECK (evidencia IN ('E0', 'E1', 'E2', 'E3', 'E4')),
  metricas jsonb NOT NULL DEFAULT '{}'::jsonb,
  ficha jsonb NOT NULL DEFAULT '{}'::jsonb,
  mecanismo text,
  tags text[] NOT NULL DEFAULT '{}',
  destaque boolean NOT NULL DEFAULT false,
  ativa boolean NOT NULL DEFAULT true,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_referencias_cliente_idx ON public.ads_referencias (client_id, criado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ads_referencias_anuncio_proprio ON public.ads_referencias (client_id, ad_id) WHERE ad_id IS NOT NULL;

-- 3) Plano de teste (ângulos e hipóteses)
CREATE TABLE IF NOT EXISTS public.ads_planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  briefing_id uuid REFERENCES public.ads_briefings(id) ON DELETE SET NULL,
  nome text NOT NULL DEFAULT 'Plano de teste',
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'aprovado', 'em_teste', 'concluido')),
  angulos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(angulos) = 'array'),
  estrutura jsonb NOT NULL DEFAULT '{}'::jsonb,
  pedido text,
  conversa_id uuid,
  custo_usd numeric NOT NULL DEFAULT 0,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_planos_cliente_idx ON public.ads_planos (client_id, criado_em DESC);

-- 4) Criativos produzidos (uma linha por variação e formato)
CREATE TABLE IF NOT EXISTS public.ads_criativos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plano_id uuid REFERENCES public.ads_planos(id) ON DELETE SET NULL,
  angulo_id text,
  trabalho_id uuid REFERENCES public.estudio_trabalhos(id) ON DELETE SET NULL,
  nome text,
  formato text NOT NULL DEFAULT 'feed_4x5' CHECK (formato IN ('feed_4x5', 'quadrado_1x1', 'stories_9x16', 'carrossel')),
  copy jsonb NOT NULL DEFAULT '{}'::jsonb,
  roteiro_video jsonb,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'pronto', 'no_ar', 'pausado', 'encerrado')),
  ad_id text,
  evidencia text NOT NULL DEFAULT 'E0' CHECK (evidencia IN ('E0', 'E1', 'E2', 'E3', 'E4')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_criativos_cliente_idx ON public.ads_criativos (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ads_criativos_plano_idx ON public.ads_criativos (plano_id);

-- 5) Aprendizados (resultado documentado)
CREATE TABLE IF NOT EXISTS public.ads_aprendizados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  criativo_id uuid REFERENCES public.ads_criativos(id) ON DELETE SET NULL,
  plano_id uuid REFERENCES public.ads_planos(id) ON DELETE SET NULL,
  periodo_inicio date,
  periodo_fim date,
  metricas jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostico jsonb NOT NULL DEFAULT '{}'::jsonb,
  texto text NOT NULL,
  evidencia text NOT NULL DEFAULT 'E3' CHECK (evidencia IN ('E3', 'E4')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_aprendizados_cliente_idx ON public.ads_aprendizados (client_id, criado_em DESC);

-- atualizado_em automático
DROP TRIGGER IF EXISTS ads_referencias_tocar ON public.ads_referencias;
CREATE TRIGGER ads_referencias_tocar BEFORE UPDATE ON public.ads_referencias FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();
DROP TRIGGER IF EXISTS ads_planos_tocar ON public.ads_planos;
CREATE TRIGGER ads_planos_tocar BEFORE UPDATE ON public.ads_planos FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();
DROP TRIGGER IF EXISTS ads_criativos_tocar ON public.ads_criativos;
CREATE TRIGGER ads_criativos_tocar BEFORE UPDATE ON public.ads_criativos FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- 6) Estúdio: trabalho de anúncio
ALTER TABLE public.estudio_trabalhos ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'social';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estudio_trabalhos_tipo_check') THEN
    ALTER TABLE public.estudio_trabalhos ADD CONSTRAINT estudio_trabalhos_tipo_check CHECK (tipo IN ('social', 'ads'));
  END IF;
END $$;

-- 7) Uso de IA e conversas aceitam a tarefa e o agente de ads
ALTER TABLE public.ia_usos DROP CONSTRAINT IF EXISTS ia_usos_tarefa_check;
ALTER TABLE public.ia_usos ADD CONSTRAINT ia_usos_tarefa_check CHECK (tarefa = ANY (ARRAY['calendario', 'estudio', 'conversa', 'leitura_referencia', 'verificacao', 'contexto', 'ads']));
ALTER TABLE public.ia_usos DROP CONSTRAINT IF EXISTS ia_usos_agente_check;
ALTER TABLE public.ia_usos ADD CONSTRAINT ia_usos_agente_check CHECK (agente = ANY (ARRAY['estrategista', 'diretor_arte', 'gerador_imagem', 'leitor', 'jev', 'contexto', 'estrategista_ads']));
ALTER TABLE public.agente_conversas DROP CONSTRAINT IF EXISTS agente_conversas_agente_check;
ALTER TABLE public.agente_conversas ADD CONSTRAINT agente_conversas_agente_check CHECK (agente = ANY (ARRAY['estrategista', 'diretor_arte', 'contexto', 'estrategista_ads']));

-- 8) RLS: equipe com acesso ao cliente; biblioteca da agência só leitura
ALTER TABLE public.ads_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_referencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_criativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_aprendizados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ads_briefings, public.ads_referencias, public.ads_planos, public.ads_criativos, public.ads_aprendizados FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS ads_briefings_equipe_le ON public.ads_briefings;
CREATE POLICY ads_briefings_equipe_le ON public.ads_briefings FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS ads_referencias_equipe_le ON public.ads_referencias;
CREATE POLICY ads_referencias_equipe_le ON public.ads_referencias FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)));
DROP POLICY IF EXISTS ads_referencias_equipe_escreve ON public.ads_referencias;
CREATE POLICY ads_referencias_equipe_escreve ON public.ads_referencias FOR INSERT TO authenticated
WITH CHECK (public.is_staff((select auth.uid())) AND client_id IS NOT NULL AND public.can_access_client(client_id));
DROP POLICY IF EXISTS ads_referencias_equipe_altera ON public.ads_referencias;
CREATE POLICY ads_referencias_equipe_altera ON public.ads_referencias FOR UPDATE TO authenticated
USING (public.is_staff((select auth.uid())) AND client_id IS NOT NULL AND public.can_access_client(client_id))
WITH CHECK (public.is_staff((select auth.uid())) AND client_id IS NOT NULL AND public.can_access_client(client_id));
DROP POLICY IF EXISTS ads_referencias_equipe_apaga ON public.ads_referencias;
CREATE POLICY ads_referencias_equipe_apaga ON public.ads_referencias FOR DELETE TO authenticated
USING (public.is_staff((select auth.uid())) AND client_id IS NOT NULL AND public.can_access_client(client_id));

DROP POLICY IF EXISTS ads_planos_equipe_le ON public.ads_planos;
CREATE POLICY ads_planos_equipe_le ON public.ads_planos FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));
DROP POLICY IF EXISTS ads_planos_equipe_altera ON public.ads_planos;
CREATE POLICY ads_planos_equipe_altera ON public.ads_planos FOR UPDATE TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id))
WITH CHECK (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS ads_criativos_equipe_le ON public.ads_criativos;
CREATE POLICY ads_criativos_equipe_le ON public.ads_criativos FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));
DROP POLICY IF EXISTS ads_criativos_equipe_altera ON public.ads_criativos;
CREATE POLICY ads_criativos_equipe_altera ON public.ads_criativos FOR UPDATE TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id))
WITH CHECK (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS ads_aprendizados_equipe_le ON public.ads_aprendizados;
CREATE POLICY ads_aprendizados_equipe_le ON public.ads_aprendizados FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT ON public.ads_briefings, public.ads_planos, public.ads_criativos, public.ads_aprendizados TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads_referencias TO authenticated;
GRANT UPDATE (nome, status, angulos) ON public.ads_planos TO authenticated;
GRANT UPDATE (nome, status, ad_id, copy) ON public.ads_criativos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads_briefings, public.ads_referencias, public.ads_planos, public.ads_criativos, public.ads_aprendizados TO service_role;
