-- Frente MC (29/09/2026): marcas completas (Acerbi e CME). Pedido do dono: "eu mudo para CME e ele já muda
-- tudo certinho, igual quando a gente seleciona outro cliente; nada da Acerbi pode vazar para a CME".
-- Regra única de herança: supabase/functions/_shared/heranca-da-marca.ts (a mesma na tela).
--
-- Só amplia e é idempotente. Nada de RLS novo nem mexida em can_access_client. Apagar = arquivar (nada é apagado).
--
-- 1. Perfis do Instagram (referências e concorrentes) por marca: marca_id em cliente_perfis_instagram,
--    no mesmo formato de cliente_referencias e cliente_fontes (nulo = do cliente, usado pela principal).
-- 2. Fotos do acervo com a marca de origem: gatilho que põe a etiqueta marca:<id> na foto nova que é
--    derivada de uma foto da marca ou que vem de um arquivo do projeto da marca (a Mesa Foto e o Estúdio
--    filtram pela etiqueta). A sincronização do acervo (contexto-cliente.ts) já põe a etiqueta pelo caminho.
-- 3. Dados: etiqueta nas fotos que já existem e são provadamente da marca (arquivo do projeto dela ou pasta
--    do Workspace com o nome dela). Evidência lida em 29/09 (SELECT): 11 fotos de Arquivos do projeto
--    "CME Acerbi | Conteúdo e Empreendedorismo Feminino 2026" e 1 foto da pasta "CME - Conselho da Mulher
--    Empresaria / CME Logo" do Workspace. Nenhuma foto tinha etiqueta de marca antes.
--
-- A logo da CME NÃO é ligada aqui: ela está no Workspace (CME - Conselho da Mulher Empresaria / CME Logo /
-- "ChatGPT Image 29 de jul. de 2026, 15_49_32.png", nó 9c5c32af-34dc-4f02-bd8f-b8644c24d09a), não em Arquivos,
-- então logo_file_id (FK para files) não serve, e logo_path exige a cópia no bucket mesa. A tela oferece
-- "Kit da CME achado no que já existe" com Confirmar e Desfazer (agente-contexto, sugerir_kit_da_marca +
-- definir_logo com marca_id), que copia a imagem e grava só na CME.

-- ---------------------------------------------------------------------------
-- 1. Perfis do Instagram por marca
-- ---------------------------------------------------------------------------
ALTER TABLE public.cliente_perfis_instagram ADD COLUMN IF NOT EXISTS marca_id uuid;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_perfis_instagram_marca_fk') THEN
    ALTER TABLE public.cliente_perfis_instagram
      ADD CONSTRAINT cliente_perfis_instagram_marca_fk
      FOREIGN KEY (marca_id, client_id)
      REFERENCES public.cliente_marcas (id, client_id)
      ON DELETE SET NULL (marca_id);
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS cliente_perfis_instagram_marca_idx
  ON public.cliente_perfis_instagram (marca_id) WHERE marca_id IS NOT NULL;

COMMENT ON COLUMN public.cliente_perfis_instagram.marca_id IS
  'Marca do perfil de referência ou concorrente (cliente_marcas). Nulo = do cliente, usado pela marca principal.';

-- ---------------------------------------------------------------------------
-- 2. Etiqueta da marca na foto nova do acervo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cliente_imagens_etiqueta_da_marca()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $body$
DECLARE
  _etiquetas text[];
  _marca uuid;
BEGIN
  NEW.tags := coalesce(NEW.tags, '{}'::text[]);
  -- Já veio com etiqueta de marca: quem gravou sabe a marca.
  IF EXISTS (SELECT 1 FROM unnest(NEW.tags) t WHERE t LIKE 'marca:%') THEN
    RETURN NEW;
  END IF;
  -- Derivada de uma foto (clone, canvas, book): herda a etiqueta da foto de origem.
  IF NEW.derivada_de IS NOT NULL THEN
    SELECT array_agg(t) INTO _etiquetas
    FROM public.cliente_imagens o, unnest(o.tags) t
    WHERE o.id = NEW.derivada_de AND o.client_id = NEW.client_id AND t LIKE 'marca:%';
    IF _etiquetas IS NOT NULL THEN
      NEW.tags := NEW.tags || _etiquetas;
      RETURN NEW;
    END IF;
  END IF;
  -- Arquivo do projeto de uma marca que não é a principal: é dela.
  IF NEW.file_id IS NOT NULL THEN
    SELECT m.id INTO _marca
    FROM public.files f
    JOIN public.cliente_marcas m ON m.project_id = f.project_id AND m.client_id = f.client_id AND NOT m.principal
    WHERE f.id = NEW.file_id AND f.client_id = NEW.client_id
    LIMIT 1;
    IF _marca IS NOT NULL THEN
      NEW.tags := NEW.tags || ARRAY['marca:' || _marca::text];
    END IF;
  END IF;
  RETURN NEW;
END;
$body$;

REVOKE ALL ON FUNCTION public.cliente_imagens_etiqueta_da_marca() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cliente_imagens_etiqueta_da_marca ON public.cliente_imagens;
CREATE TRIGGER cliente_imagens_etiqueta_da_marca
BEFORE INSERT ON public.cliente_imagens
FOR EACH ROW EXECUTE FUNCTION public.cliente_imagens_etiqueta_da_marca();

-- ---------------------------------------------------------------------------
-- 3. Dados: fotos que já existem e são provadamente da marca
-- ---------------------------------------------------------------------------
-- 3a. Arquivo do projeto da marca.
UPDATE public.cliente_imagens ci
SET tags = coalesce(ci.tags, '{}'::text[]) || ARRAY['marca:' || m.id::text]
FROM public.files f
JOIN public.cliente_marcas m ON m.project_id = f.project_id AND m.client_id = f.client_id AND NOT m.principal
WHERE ci.file_id = f.id
  AND ci.client_id = m.client_id
  AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(ci.tags, '{}'::text[])) t WHERE t LIKE 'marca:%');

-- 3b. Pasta do Workspace que cita o nome da marca (palavra inteira, sem acento), como citaMarca na tela.
WITH RECURSIVE m AS (
  SELECT id, client_id,
    ' ' || trim(regexp_replace(translate(lower(nome), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[^a-z0-9]+', ' ', 'g')) || ' ' AS palavra
  FROM public.cliente_marcas
  WHERE NOT principal
), arv AS (
  SELECT n.id, n.client_id, n.name::text AS caminho
  FROM public.workspace_nodes n
  WHERE n.parent_id IS NULL AND n.client_id IN (SELECT client_id FROM m)
  UNION ALL
  SELECT c.id, c.client_id, arv.caminho || ' / ' || c.name
  FROM public.workspace_nodes c
  JOIN arv ON c.parent_id = arv.id
), alvo AS (
  SELECT DISTINCT ON (ci.id) ci.id, m.id AS marca_id
  FROM public.cliente_imagens ci
  JOIN arv ON arv.id = ci.workspace_node_id
  JOIN m ON m.client_id = ci.client_id
  WHERE (' ' || regexp_replace(translate(lower(arv.caminho), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[^a-z0-9]+', ' ', 'g') || ' ') LIKE '%' || m.palavra || '%'
    AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(ci.tags, '{}'::text[])) t WHERE t LIKE 'marca:%')
)
UPDATE public.cliente_imagens ci
SET tags = coalesce(ci.tags, '{}'::text[]) || ARRAY['marca:' || alvo.marca_id::text]
FROM alvo
WHERE ci.id = alvo.id;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura, depois de aplicar):
-- select count(*) from cliente_imagens where exists (select 1 from unnest(tags) t where t like 'marca:%');  -- esperado 12 (Acerbi/CME, 29/09)
-- select column_name from information_schema.columns where table_name = 'cliente_perfis_instagram' and column_name = 'marca_id';
-- select tgname from pg_trigger where tgname = 'cliente_imagens_etiqueta_da_marca';
