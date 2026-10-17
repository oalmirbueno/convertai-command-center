-- 17/10/2026: a base de cada agente (dono: "cada um tendo uma base de aprendizado,
-- onde eu consigo mandar documentos, atualizar, complementar com mais prompt;
-- quanto mais eu carrego, mais inteligente ele fica"; "pesquisar na internet algo
-- que complemente").
--
-- Decisões do dono (17/10):
--   - vale para todos os clientes, com ficha opcional só de um cliente (client_id);
--   - o que chega (texto, documento, link) vira fichas de técnica já em uso;
--   - a pesquisa semanal na internet também entra direto em uso.
--
-- Uma FONTE é o que o dono mandou (ou a pesquisa da semana); cada fonte vira
-- FICHAS curtas de técnica. Na geração, a função do agente lê as fichas ativas
-- dele (gerais + do cliente), o Jev escolhe as que servem ao pedido quando não
-- cabem todas, e o uso fica registrado (contagem na ficha e linha em _usos).
--
-- Escrita só pela função base-dos-agentes (chave de serviço). A equipe lê.
-- A chave do agente segue "mesa.papel" (ex.: estudio.diretor, ads.video), o
-- catálogo fica em supabase/functions/_shared/base-do-agente.ts.

CREATE TABLE IF NOT EXISTS public.agente_base_fontes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente text NOT NULL CHECK (agente ~ '^[a-z]+\.[a-z_]+$'),
  client_id uuid NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('texto', 'documento', 'link', 'pesquisa')),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 300),
  url text NULL,
  status text NOT NULL DEFAULT 'pronta' CHECK (status IN ('lendo', 'pronta', 'erro')),
  erro text NULL,
  fichas integer NOT NULL DEFAULT 0,
  custo_usd numeric(10, 4) NOT NULL DEFAULT 0,
  criado_por uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agente_base_fichas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id uuid NULL REFERENCES public.agente_base_fontes(id) ON DELETE CASCADE,
  agente text NOT NULL CHECK (agente ~ '^[a-z]+\.[a-z_]+$'),
  client_id uuid NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 3 AND 160),
  tecnica text NOT NULL CHECK (char_length(tecnica) BETWEEN 10 AND 2400),
  quando_usar text NOT NULL DEFAULT '',
  exemplo text NOT NULL DEFAULT '',
  fonte_url text NULL,
  ativa boolean NOT NULL DEFAULT true,
  usos integer NOT NULL DEFAULT 0,
  ultimo_uso timestamptz NULL,
  criado_por uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  busca tsvector GENERATED ALWAYS AS (
    to_tsvector('portuguese'::regconfig, coalesce(titulo, '') || ' ' || coalesce(tecnica, '') || ' ' || coalesce(quando_usar, ''))
  ) STORED
);

CREATE TABLE IF NOT EXISTS public.agente_base_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ficha_id uuid NOT NULL REFERENCES public.agente_base_fichas(id) ON DELETE CASCADE,
  agente text NOT NULL,
  client_id uuid NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referencia_tipo text NULL,
  referencia_id text NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agente_base_fichas_agente_idx ON public.agente_base_fichas (agente, ativa, criado_em DESC);
CREATE INDEX IF NOT EXISTS agente_base_fichas_cliente_idx ON public.agente_base_fichas (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agente_base_fichas_busca_idx ON public.agente_base_fichas USING gin (busca);
CREATE INDEX IF NOT EXISTS agente_base_fontes_agente_idx ON public.agente_base_fontes (agente, criado_em DESC);
CREATE INDEX IF NOT EXISTS agente_base_usos_ficha_idx ON public.agente_base_usos (ficha_id, criado_em DESC);

ALTER TABLE public.agente_base_fontes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_base_fichas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_base_usos ENABLE ROW LEVEL SECURITY;

-- A equipe lê; ninguém escreve direto (só a função, com a chave de serviço).
DROP POLICY IF EXISTS agente_base_fontes_select ON public.agente_base_fontes;
CREATE POLICY agente_base_fontes_select ON public.agente_base_fontes
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())));
DROP POLICY IF EXISTS agente_base_fichas_select ON public.agente_base_fichas;
CREATE POLICY agente_base_fichas_select ON public.agente_base_fichas
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())));
DROP POLICY IF EXISTS agente_base_usos_select ON public.agente_base_usos;
CREATE POLICY agente_base_usos_select ON public.agente_base_usos
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())));

REVOKE ALL ON public.agente_base_fontes, public.agente_base_fichas, public.agente_base_usos FROM PUBLIC, anon;
GRANT SELECT ON public.agente_base_fontes, public.agente_base_fichas, public.agente_base_usos TO authenticated;
GRANT ALL ON public.agente_base_fontes, public.agente_base_fichas, public.agente_base_usos TO service_role;

-- O uso numa geração: soma na ficha e deixa a linha (para cruzar com aprovação depois).
CREATE OR REPLACE FUNCTION public.agente_base_registrar_uso(
  _ids uuid[], _agente text, _client_id uuid, _referencia_tipo text DEFAULT NULL, _referencia_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN RETURN; END IF;
  UPDATE public.agente_base_fichas SET usos = usos + 1, ultimo_uso = now() WHERE id = ANY(_ids);
  INSERT INTO public.agente_base_usos (ficha_id, agente, client_id, referencia_tipo, referencia_id)
  SELECT f.id, _agente, _client_id, _referencia_tipo, _referencia_id
  FROM public.agente_base_fichas f WHERE f.id = ANY(_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.agente_base_registrar_uso(uuid[], text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agente_base_registrar_uso(uuid[], text, uuid, text, text) TO service_role;

-- A pesquisa da semana: terça, 9h23 a 14h23 UTC (6h23 a 11h23 em São Paulo), uma
-- chamada por hora, até 2 agentes por chamada, cada agente no máximo 1 vez por
-- semana (cerca de US$ 0,10 por agente, na carteira da agência).
-- Para desligar: select cron.unschedule(jobid) from cron.job where jobname = 'base-dos-agentes-pesquisa-semanal';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'base-dos-agentes-pesquisa-semanal';
    PERFORM cron.schedule('base-dos-agentes-pesquisa-semanal', '23 9-14 * * 2', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/base-dos-agentes',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'pesquisa_semanal'),
        timeout_milliseconds := 300000
      );
    $cron$);
  END IF;
END $$;
