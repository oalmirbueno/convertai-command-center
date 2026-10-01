-- Frente MOV (30/09/2026): voz da marca na Mesa Motion (ElevenLabs).
--
-- motion_vozes: as vozes que a equipe escolheu, desenhou ou clonou para um
-- cliente e uma marca (marca_id), com a voz padrão de cada marca. A voz em
-- si mora na conta da ElevenLabs da agência (voice_id); aqui fica o vínculo,
-- o modelo, os ajustes e, no clone, a autorização da pessoa (quem, como e
-- quando). A narração de cada filme fica em motion_filmes.som.narracao.
--
-- Só amplia, idempotente. RLS: a equipe com acesso ao cliente lê; escrita só
-- pela service_role (tudo passa pela função mesa-motion). Apagar = arquivar.

CREATE TABLE IF NOT EXISTS public.motion_vozes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid,
  provedor text NOT NULL DEFAULT 'elevenlabs' CHECK (provedor IN ('elevenlabs')),
  voice_id text NOT NULL CHECK (voice_id ~ '^[A-Za-z0-9]{8,64}$'),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 80),
  descricao text CHECK (descricao IS NULL OR char_length(descricao) <= 600),
  origem text NOT NULL CHECK (origem IN ('biblioteca', 'desenhada', 'clonada')),
  modelo text CHECK (modelo IS NULL OR char_length(modelo) <= 60),
  ajustes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ajustes) = 'object'),
  previa_path text CHECK (previa_path IS NULL OR char_length(previa_path) <= 400),
  previa_url text CHECK (previa_url IS NULL OR (char_length(previa_url) <= 600 AND previa_url ~ '^https://')),
  padrao boolean NOT NULL DEFAULT false,
  -- Clone só com a autorização registrada (quem autorizou e como).
  autorizacao jsonb CHECK (autorizacao IS NULL OR jsonb_typeof(autorizacao) = 'object'),
  arquivado_em timestamptz,
  arquivado_por uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT motion_vozes_clone_autorizado CHECK (
    origem <> 'clonada' OR (autorizacao IS NOT NULL AND autorizacao ? 'quem' AND autorizacao ? 'como')
  )
);

COMMENT ON TABLE public.motion_vozes IS
  'Frente MOV (30/09): vozes da marca na Mesa Motion (ElevenLabs): da biblioteca, desenhadas ou clonadas com autorização. Uma padrão por cliente e marca.';

-- Uma voz viva por cliente, marca e voice_id; uma padrão por cliente e marca.
CREATE UNIQUE INDEX IF NOT EXISTS motion_vozes_unica
  ON public.motion_vozes (client_id, COALESCE(marca_id, '00000000-0000-0000-0000-000000000000'::uuid), voice_id)
  WHERE arquivado_em IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS motion_vozes_uma_padrao
  ON public.motion_vozes (client_id, COALESCE(marca_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE padrao AND arquivado_em IS NULL;
CREATE INDEX IF NOT EXISTS motion_vozes_cliente_idx ON public.motion_vozes (client_id, criado_em DESC);

CREATE OR REPLACE FUNCTION public.motion_vozes_tocar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS motion_vozes_tocar ON public.motion_vozes;
CREATE TRIGGER motion_vozes_tocar
  BEFORE UPDATE ON public.motion_vozes
  FOR EACH ROW EXECUTE FUNCTION public.motion_vozes_tocar();

ALTER TABLE public.motion_vozes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS motion_vozes_equipe_le ON public.motion_vozes;
CREATE POLICY motion_vozes_equipe_le ON public.motion_vozes
  FOR SELECT TO authenticated USING (public.is_staff((SELECT auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.motion_vozes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.motion_vozes FROM authenticated;
GRANT SELECT ON public.motion_vozes TO authenticated;
GRANT ALL ON public.motion_vozes TO service_role;

-- Conferência (só leitura):
-- select id, client_id, marca_id, nome, origem, padrao from public.motion_vozes order by criado_em desc limit 20;
