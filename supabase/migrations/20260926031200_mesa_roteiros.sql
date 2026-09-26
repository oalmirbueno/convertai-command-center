-- Frente R2 (26/09): Mesa Roteiros (/mesa-roteiros).
-- Só amplia e é idempotente (pode rodar mais de uma vez). Não mexe em dado existente.
--
-- 1) roteiros: um roteiro por peça da agenda (ou avulso), com as versões em
--    jsonb (versão aprovada é imutável; corrigir cria versão nova), os
--    comentários, o status rascunho/aprovado/gravado e o arquivamento; e a
--    view roteiros_aprovados_para_video que a Mesa Vídeos (V2) já lê.
-- 2) roteiro_modelos: memória. Roteiro aprovado vira modelo do cliente; o
--    modelo da agência só existe por escolha explícita, já sem dado privado.
-- 3) A escolha de clientes por mesa aceita 'roteiros' (sem apagar os valores
--    que outras frentes já tenham acrescentado) e a RPC deixa o CHECK da
--    tabela decidir quais mesas existem (nenhuma frente precisa reescrevê-la).
--
-- RLS: equipe lê com is_staff + can_access_client. Só service_role escreve
-- (a função mesa-roteiros). Sem esta migração a mesa abre e gera o roteiro,
-- mas avisa que não consegue guardar.

-- ------------------------------------------------------------------ 1) roteiros

CREATE TABLE IF NOT EXISTS public.roteiros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  proposta_id uuid REFERENCES public.calendario_propostas(id) ON DELETE SET NULL,
  campanha_id uuid REFERENCES public.mesa_campanhas(id) ON DELETE SET NULL,
  titulo text NOT NULL DEFAULT 'Roteiro',
  tipo text NOT NULL DEFAULT 'fala_camera' CHECK (tipo IN ('fala_camera', 'tutorial', 'ugc', 'cinema')),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'aprovado', 'gravado')),
  versao_atual integer NOT NULL DEFAULT 1 CHECK (versao_atual >= 1),
  versao_aprovada integer CHECK (versao_aprovada IS NULL OR versao_aprovada >= 1),
  versoes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(versoes) = 'array'),
  comentarios jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(comentarios) = 'array'),
  aprovado_por uuid,
  aprovado_em timestamptz,
  gravado_em timestamptz,
  arquivado_em timestamptz,
  arquivado_por uuid,
  arquivo_pdf_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roteiros_cliente_idx ON public.roteiros (client_id, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS roteiros_tarefa_idx ON public.roteiros (task_id) WHERE task_id IS NOT NULL;
-- Uma peça da agenda tem um roteiro vivo (as versões moram dentro dele).
CREATE UNIQUE INDEX IF NOT EXISTS roteiros_um_por_tarefa ON public.roteiros (task_id) WHERE task_id IS NOT NULL AND arquivado_em IS NULL;

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

DROP TRIGGER IF EXISTS roteiros_tocar_atualizado_em ON public.roteiros;
CREATE TRIGGER roteiros_tocar_atualizado_em
BEFORE UPDATE ON public.roteiros
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

ALTER TABLE public.roteiros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roteiros_equipe_le ON public.roteiros;
CREATE POLICY roteiros_equipe_le ON public.roteiros
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.roteiros FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.roteiros FROM authenticated;
GRANT SELECT ON public.roteiros TO authenticated;
GRANT ALL ON public.roteiros TO service_role;

-- Contrato com a Mesa Vídeos (frente V2, _shared/roteiros-para-video.ts): os
-- roteiros aprovados, com as cenas da versão aprovada (um bloco = uma cena).
-- security_invoker: quem lê passa pela RLS da tabela roteiros.
CREATE OR REPLACE VIEW public.roteiros_aprovados_para_video
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.client_id,
  r.titulo,
  r.aprovado_em,
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'ref', COALESCE(NULLIF(b.valor->>'id', ''), 'b' || b.n::text),
        'ordem', CASE WHEN (b.valor->>'ordem') ~ '^[0-9]+$' THEN (b.valor->>'ordem')::int ELSE b.n::int END,
        'titulo', COALESCE(b.valor->>'funcao', ''),
        'fala', b.valor->>'fala',
        'visual', b.valor->>'visual'
      )
      ORDER BY b.n
    )
    FROM jsonb_array_elements(COALESCE(v.versao->'conteudo'->'blocos', '[]'::jsonb)) WITH ORDINALITY AS b(valor, n)
  ), '[]'::jsonb) AS cenas
FROM public.roteiros r
CROSS JOIN LATERAL (
  SELECT x AS versao
  FROM jsonb_array_elements(r.versoes) AS x
  WHERE (x->>'numero') ~ '^[0-9]+$' AND (x->>'numero')::int = r.versao_aprovada
  LIMIT 1
) v
WHERE r.versao_aprovada IS NOT NULL
  AND r.status IN ('aprovado', 'gravado')
  AND r.arquivado_em IS NULL;

REVOKE ALL ON public.roteiros_aprovados_para_video FROM PUBLIC, anon;
GRANT SELECT ON public.roteiros_aprovados_para_video TO authenticated, service_role;

-- ------------------------------------------------------------------ 2) roteiro_modelos

CREATE TABLE IF NOT EXISTS public.roteiro_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escopo text NOT NULL CHECK (escopo IN ('cliente', 'agencia')),
  -- Modelo do cliente: o cliente dono. Modelo da agência: sem cliente (já sanitizado).
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'fala_camera' CHECK (tipo IN ('fala_camera', 'tutorial', 'ugc', 'cinema')),
  estrutura jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(estrutura) = 'object'),
  -- Proveniência só para a equipe (a leitura já é só da equipe).
  origem_roteiro_id uuid REFERENCES public.roteiros(id) ON DELETE SET NULL,
  origem_versao integer,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  revogado_em timestamptz,
  CONSTRAINT roteiro_modelos_escopo_cliente CHECK (
    (escopo = 'cliente' AND client_id IS NOT NULL) OR (escopo = 'agencia' AND client_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS roteiro_modelos_cliente_idx ON public.roteiro_modelos (client_id, criado_em DESC) WHERE revogado_em IS NULL;
CREATE INDEX IF NOT EXISTS roteiro_modelos_agencia_idx ON public.roteiro_modelos (criado_em DESC) WHERE escopo = 'agencia' AND revogado_em IS NULL;
-- Um modelo do cliente por roteiro de origem (aprovar de novo atualiza o mesmo).
CREATE UNIQUE INDEX IF NOT EXISTS roteiro_modelos_um_por_origem ON public.roteiro_modelos (origem_roteiro_id, escopo) WHERE origem_roteiro_id IS NOT NULL AND revogado_em IS NULL;

ALTER TABLE public.roteiro_modelos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roteiro_modelos_equipe_le ON public.roteiro_modelos;
CREATE POLICY roteiro_modelos_equipe_le ON public.roteiro_modelos
  FOR SELECT TO authenticated
  USING (
    public.is_staff((select auth.uid()))
    AND (
      (escopo = 'agencia' AND client_id IS NULL)
      OR (escopo = 'cliente' AND public.can_access_client(client_id))
    )
  );

REVOKE ALL ON public.roteiro_modelos FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.roteiro_modelos FROM authenticated;
GRANT SELECT ON public.roteiro_modelos TO authenticated;
GRANT ALL ON public.roteiro_modelos TO service_role;

-- ------------------------------------------------------------------ 3) clientes da mesa: 'roteiros'

-- Junta 'roteiros' aos valores que o CHECK já aceita (lidos do próprio CHECK),
-- para não apagar o que outra frente (publicidade, vídeos) tenha acrescentado.
DO $$
DECLARE
  _def text;
  _valores text[];
BEGIN
  IF to_regclass('public.mesa_cliente_escolhas') IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO _def
  FROM pg_constraint
  WHERE conrelid = 'public.mesa_cliente_escolhas'::regclass AND conname = 'mesa_cliente_escolhas_mesa_check';
  IF _def IS NULL THEN
    _valores := ARRAY['organica', 'ads', 'foto'];
  ELSE
    SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m;
  END IF;
  IF NOT ('roteiros' = ANY (_valores)) THEN
    _valores := _valores || ARRAY['roteiros'];
  END IF;
  EXECUTE 'ALTER TABLE public.mesa_cliente_escolhas DROP CONSTRAINT IF EXISTS mesa_cliente_escolhas_mesa_check';
  EXECUTE format(
    'ALTER TABLE public.mesa_cliente_escolhas ADD CONSTRAINT mesa_cliente_escolhas_mesa_check CHECK (mesa = ANY (%L::text[]))',
    _valores
  );
END $$;

-- A RPC valida só o formato do nome da mesa; o CHECK acima decide quais existem.
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
  IF _mesa IS NULL OR _mesa !~ '^[a-z_]{2,30}$' THEN
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

  BEGIN
    INSERT INTO public.mesa_cliente_escolhas (mesa, client_id, modo, atualizado_por, atualizado_em)
    VALUES (_mesa, _client_id, _modo, auth.uid(), now())
    ON CONFLICT (mesa, client_id)
    DO UPDATE SET modo = EXCLUDED.modo, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = EXCLUDED.atualizado_em;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Mesa desconhecida.' USING ERRCODE = '22023';
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_escolher_cliente(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_escolher_cliente(text, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
