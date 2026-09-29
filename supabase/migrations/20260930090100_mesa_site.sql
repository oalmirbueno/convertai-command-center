-- Frente SIT (30/09/2026): Mesa Site (/mesa-site). Um site por linha, por
-- cliente e marca (marca_id), com o que cada etapa decidiu: briefing,
-- referências e DNA, direção, conteúdo (3 opções e a escolhida), imagens,
-- revisão e publicação. O código mora no worker (git) e o zip no Storage
-- (mesa/<cliente>/site/<site>/codigo/); aqui fica o estado.
--
-- Só amplia, idempotente. RLS: equipe com acesso ao cliente lê; escrita só
-- pela service_role (tudo passa pela função mesa-site). Apagar = arquivar.

-- ─── 1) Seletor de clientes: a Mesa Site ganha o seu valor ('site') ────────

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
  -- Lê as duas formas que o Postgres mostra: 'a'::text, 'b'::text  e  '{a,b}'::text[] (integração 30/09: a forma com chaves zerava as outras mesas).
  SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(coalesce(_def, ''), '''([a-z_]+)''', 'g') AS m;
  _valores := coalesce(_valores, '{}'::text[]) || coalesce((SELECT array_agg(DISTINCT btrim(v)) FROM regexp_matches(coalesce(_def, ''), '\{([^}]*)\}', 'g') AS mm, unnest(string_to_array(mm[1], ',')) AS v), '{}'::text[]);
  _valores := ARRAY(SELECT DISTINCT unnest(_valores || ARRAY['organica', 'ads', 'foto', 'publicidade', 'videos', 'roteiros', 'edicao', 'identidade', 'proposta', 'site']));
  EXECUTE 'ALTER TABLE public.mesa_cliente_escolhas DROP CONSTRAINT IF EXISTS mesa_cliente_escolhas_mesa_check';
  EXECUTE format('ALTER TABLE public.mesa_cliente_escolhas ADD CONSTRAINT mesa_cliente_escolhas_mesa_check CHECK (mesa = ANY (%L::text[]))', _valores);
END $$;

-- ─── 2) Sites ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  projeto text NOT NULL UNIQUE CHECK (projeto ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  etapa text NOT NULL DEFAULT 'briefing' CHECK (etapa IN ('briefing', 'referencias', 'direcao', 'conteudo', 'imagens', 'construcao', 'revisao', 'publicacao')),
  briefing jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(briefing) = 'object'),
  referencias jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(referencias) = 'array'),
  dna jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dna) = 'object'),
  direcao jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(direcao) = 'object'),
  conteudo jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conteudo) = 'object'),
  imagens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(imagens) = 'array'),
  revisao jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(revisao) = 'object'),
  publicacao jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(publicacao) = 'object'),
  modelo text,
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  arquivado_em timestamptz,
  arquivado_por uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sites_cliente_idx ON public.sites (client_id, atualizado_em DESC);

DROP TRIGGER IF EXISTS sites_tocar ON public.sites;
CREATE TRIGGER sites_tocar
  BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.motor_trabalhos_tocar();

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sites_staff_read ON public.sites;
CREATE POLICY sites_staff_read ON public.sites
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE INSERT, UPDATE, DELETE ON public.sites FROM anon, authenticated;
REVOKE ALL ON public.sites FROM anon;
GRANT SELECT ON public.sites TO authenticated;
GRANT ALL ON public.sites TO service_role;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'mesa_cliente_escolhas_mesa_check';
-- select count(*) from public.sites;
-- select policyname from pg_policies where tablename = 'sites';
