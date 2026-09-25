-- Desfaz 01_cliente_marcas.sql (e os dados de 02). NAO APLICADO.
-- Referencias e fontes voltam a ser so do cliente (a coluna marca_id sai).
-- O painel e as funcoes seguem funcionando sem a tabela: sem marca, tudo
-- volta ao caminho de antes.

BEGIN;

ALTER TABLE public.cliente_referencias DROP CONSTRAINT IF EXISTS cliente_referencias_marca_fk;
ALTER TABLE public.cliente_fontes DROP CONSTRAINT IF EXISTS cliente_fontes_marca_fk;
DROP INDEX IF EXISTS public.cliente_referencias_marca_idx;
DROP INDEX IF EXISTS public.cliente_fontes_marca_idx;
ALTER TABLE public.cliente_referencias DROP COLUMN IF EXISTS marca_id;
ALTER TABLE public.cliente_fontes DROP COLUMN IF EXISTS marca_id;

DROP TABLE IF EXISTS public.cliente_marcas;
DROP FUNCTION IF EXISTS public.cliente_marcas_conferir_projeto();

NOTIFY pgrst, 'reload schema';

COMMIT;
