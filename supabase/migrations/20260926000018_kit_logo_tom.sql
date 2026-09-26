-- Frente T (25/09 noite): a logo é clara ou escura, guardado no kit.
ALTER TABLE public.cliente_kit_marca ADD COLUMN IF NOT EXISTS logo_tom text;
ALTER TABLE public.cliente_kit_marca ADD COLUMN IF NOT EXISTS logo_alt_tom text;
ALTER TABLE public.cliente_marcas ADD COLUMN IF NOT EXISTS logo_tom text;
ALTER TABLE public.cliente_marcas ADD COLUMN IF NOT EXISTS logo_alt_tom text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_kit_marca_logo_tom_valido') THEN
    ALTER TABLE public.cliente_kit_marca ADD CONSTRAINT cliente_kit_marca_logo_tom_valido
      CHECK (logo_tom IS NULL OR logo_tom IN ('clara', 'escura'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_kit_marca_logo_alt_tom_valido') THEN
    ALTER TABLE public.cliente_kit_marca ADD CONSTRAINT cliente_kit_marca_logo_alt_tom_valido
      CHECK (logo_alt_tom IS NULL OR logo_alt_tom IN ('clara', 'escura'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_marcas_logo_tom_valido') THEN
    ALTER TABLE public.cliente_marcas ADD CONSTRAINT cliente_marcas_logo_tom_valido
      CHECK (logo_tom IS NULL OR logo_tom IN ('clara', 'escura'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_marcas_logo_alt_tom_valido') THEN
    ALTER TABLE public.cliente_marcas ADD CONSTRAINT cliente_marcas_logo_alt_tom_valido
      CHECK (logo_alt_tom IS NULL OR logo_alt_tom IN ('clara', 'escura'));
  END IF;
END $$;

COMMENT ON COLUMN public.cliente_kit_marca.logo_tom IS 'Logo principal clara (vai sobre fundo escuro) ou escura (vai sobre fundo claro). Gravado pela tela ao definir a logo.';
COMMENT ON COLUMN public.cliente_kit_marca.logo_alt_tom IS 'Mesmo que logo_tom, para a logo alternativa.';
COMMENT ON COLUMN public.cliente_marcas.logo_tom IS 'Logo da marca clara ou escura. Gravado pela tela ao enviar a logo.';
COMMENT ON COLUMN public.cliente_marcas.logo_alt_tom IS 'Mesmo que logo_tom, para a logo alternativa da marca.';

NOTIFY pgrst, 'reload schema';
