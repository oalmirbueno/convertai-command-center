-- Marcas por projeto dentro do mesmo cliente (frente G, fase 2, pedido do dono em 25/09).
--
-- NAO APLICADO. Rodar no SQL Editor (ou virar migration) nesta ordem:
--   1. este arquivo (estrutura, sem dado nenhum);
--   2. 02_dados_acerbi_cme.sql (opcional: cria as marcas Acerbi e CME).
-- Desfazer: 03_desfazer.sql.
--
-- So acrescenta. Nenhuma coluna existente muda de tipo ou de regra:
-- - cliente_marcas: uma marca e opcional por projeto. Cliente sem linha aqui
--   segue exatamente como hoje (o painel e as funcoes so mudam de caminho
--   quando o cliente tem marca cadastrada);
-- - a marca principal usa o kit do cliente (cliente_kit_marca); o que ela
--   tiver preenchido aqui vale por cima. Uma principal por cliente;
-- - marca que nao e principal tem kit proprio: logo e paleta NUNCA vem do
--   cliente (a logo errada e o pior erro); estilo, regras e tom vem do
--   cliente quando a marca deixa vazio; o contexto extra soma ao do cliente;
-- - projeto de uma marca: no maximo uma marca por projeto (project_id unico).
--   A principal fica tambem com os projetos que nao sao de nenhuma marca;
-- - marca_id em cliente_referencias e cliente_fontes (nulo = do cliente,
--   que e o que a principal usa). O vinculo composto (marca_id, client_id)
--   garante que a marca e do mesmo cliente da linha.
-- RLS igual as tabelas da Mesa: equipe com acesso ao cliente le e escreve;
-- o cliente final nao le nada.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_marcas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 80),
  principal boolean NOT NULL DEFAULT false,
  ordem integer NOT NULL DEFAULT 0,
  -- kit no mesmo formato de cliente_kit_marca
  -- [{nome, hex, papel}]
  paleta jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(paleta) = 'array'),
  logo_file_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  logo_alt_file_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  -- caminho no bucket mesa, sempre sob a pasta do cliente
  logo_path text CHECK (logo_path IS NULL OR (logo_path LIKE client_id::text || '/%' AND position('..' IN logo_path) = 0)),
  logo_alt_path text CHECK (logo_alt_path IS NULL OR (logo_alt_path LIKE client_id::text || '/%' AND position('..' IN logo_alt_path) = 0)),
  estilo text,
  regras text,
  tom text,
  -- mesmo formato do contexto consolidado (negocio, publico, oferta, tom_de_voz, diferenciais, ...)
  contexto jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(contexto) = 'object'),
  -- dossie curto da marca, somado ao do cliente
  contexto_extra text CHECK (contexto_extra IS NULL OR char_length(contexto_extra) <= 8000),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_marcas_projeto_unico UNIQUE (project_id),
  -- alvo do vinculo composto de referencias e fontes
  CONSTRAINT cliente_marcas_id_cliente_unico UNIQUE (id, client_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS cliente_marcas_uma_principal
  ON public.cliente_marcas (client_id) WHERE principal;
CREATE UNIQUE INDEX IF NOT EXISTS cliente_marcas_nome_unico
  ON public.cliente_marcas (client_id, lower(btrim(nome)));
CREATE INDEX IF NOT EXISTS cliente_marcas_cliente_idx
  ON public.cliente_marcas (client_id, ordem);
CREATE INDEX IF NOT EXISTS cliente_marcas_logo_idx
  ON public.cliente_marcas (logo_file_id) WHERE logo_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cliente_marcas_logo_alt_idx
  ON public.cliente_marcas (logo_alt_file_id) WHERE logo_alt_file_id IS NOT NULL;

DROP TRIGGER IF EXISTS cliente_marcas_tocar ON public.cliente_marcas;
CREATE TRIGGER cliente_marcas_tocar
BEFORE UPDATE ON public.cliente_marcas
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- O projeto da marca precisa ser do mesmo cliente (projects nao tem unico
-- composto com client_id, entao a conferencia e por gatilho).
CREATE OR REPLACE FUNCTION public.cliente_marcas_conferir_projeto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $body$
DECLARE
  _dono uuid;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.client_id INTO _dono FROM public.projects p WHERE p.id = NEW.project_id;
  IF _dono IS NULL OR _dono <> NEW.client_id THEN
    RAISE EXCEPTION 'MARCA_PROJETO_DE_OUTRO_CLIENTE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$body$;

REVOKE ALL ON FUNCTION public.cliente_marcas_conferir_projeto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cliente_marcas_projeto_do_cliente ON public.cliente_marcas;
CREATE TRIGGER cliente_marcas_projeto_do_cliente
BEFORE INSERT OR UPDATE OF project_id, client_id ON public.cliente_marcas
FOR EACH ROW EXECUTE FUNCTION public.cliente_marcas_conferir_projeto();

-- ---------------------------------------------------------------------------
-- 2. Referencias e fontes da marca (nulo = do cliente, como hoje)
-- ---------------------------------------------------------------------------
ALTER TABLE public.cliente_referencias ADD COLUMN IF NOT EXISTS marca_id uuid;
ALTER TABLE public.cliente_fontes ADD COLUMN IF NOT EXISTS marca_id uuid;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_referencias_marca_fk') THEN
    ALTER TABLE public.cliente_referencias
      ADD CONSTRAINT cliente_referencias_marca_fk
      FOREIGN KEY (marca_id, client_id)
      REFERENCES public.cliente_marcas (id, client_id)
      ON DELETE SET NULL (marca_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_fontes_marca_fk') THEN
    ALTER TABLE public.cliente_fontes
      ADD CONSTRAINT cliente_fontes_marca_fk
      FOREIGN KEY (marca_id, client_id)
      REFERENCES public.cliente_marcas (id, client_id)
      ON DELETE SET NULL (marca_id);
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS cliente_referencias_marca_idx
  ON public.cliente_referencias (marca_id) WHERE marca_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cliente_fontes_marca_idx
  ON public.cliente_fontes (marca_id) WHERE marca_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. RLS igual as tabelas da Mesa
-- ---------------------------------------------------------------------------
ALTER TABLE public.cliente_marcas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cliente_marcas FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS cliente_marcas_equipe_le ON public.cliente_marcas;
CREATE POLICY cliente_marcas_equipe_le
ON public.cliente_marcas
FOR SELECT TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND public.can_access_client(client_id)
);

DROP POLICY IF EXISTS cliente_marcas_equipe_insere ON public.cliente_marcas;
CREATE POLICY cliente_marcas_equipe_insere
ON public.cliente_marcas
FOR INSERT TO authenticated
WITH CHECK (
  public.is_staff((select auth.uid()))
  AND public.can_access_client(client_id)
);

DROP POLICY IF EXISTS cliente_marcas_equipe_altera ON public.cliente_marcas;
CREATE POLICY cliente_marcas_equipe_altera
ON public.cliente_marcas
FOR UPDATE TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND public.can_access_client(client_id)
)
WITH CHECK (
  public.is_staff((select auth.uid()))
  AND public.can_access_client(client_id)
);

DROP POLICY IF EXISTS cliente_marcas_equipe_apaga ON public.cliente_marcas;
CREATE POLICY cliente_marcas_equipe_apaga
ON public.cliente_marcas
FOR DELETE TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND public.can_access_client(client_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cliente_marcas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cliente_marcas TO service_role;

COMMENT ON TABLE public.cliente_marcas IS
  'Marca opcional por projeto dentro do mesmo cliente (ex.: Acerbi e CME). Sem linha = cliente com uma marca so, como antes.';
COMMENT ON COLUMN public.cliente_referencias.marca_id IS
  'Marca da referencia (cliente_marcas). Nulo = do cliente, usada pela marca principal.';
COMMENT ON COLUMN public.cliente_fontes.marca_id IS
  'Marca da fonte (cliente_marcas). Nulo = do cliente.';

-- A API le a tabela nova sem esperar o recarregamento automatico.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Conferencia depois de aplicar (so leitura):
-- select count(*) from public.cliente_marcas;                       -- 0
-- select count(*) from public.cliente_referencias where marca_id is not null; -- 0
-- select policyname from pg_policies where tablename = 'cliente_marcas';     -- 4 politicas
