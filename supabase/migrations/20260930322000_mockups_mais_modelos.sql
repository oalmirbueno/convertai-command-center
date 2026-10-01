-- Frente MCK, rodada 2 (30/09/2026): mais mockups no estúdio da Mesa Identidade Visual.
--
-- 1) Categorias novas no catálogo: fachada e sinalizacao (os mockups de IA trazem fachada de loja,
--    placa na parede, totem, cavalete, parede da recepção e placa de porta).
-- 2) Coluna `fonte`: 'psd' (pré-processado dos pacotes da agência) ou 'ia' (cena gerada por IA,
--    com a superfície lisa; a marca entra pelo código). A tela filtra e marca cada um.
--    O fundo trocável não pede coluna: quando existe, o caminho do fundo.png vai em caminhos.
--
-- Só amplia e é idempotente. RLS e grants das tabelas continuam os da 20260930110000.

DO $$
BEGIN
  ALTER TABLE public.mockup_catalogo DROP CONSTRAINT IF EXISTS mockup_catalogo_categoria_check;
  ALTER TABLE public.mockup_catalogo ADD CONSTRAINT mockup_catalogo_categoria_check CHECK (categoria IN (
    'papelaria', 'cartao', 'sacola', 'caneca', 'vestuario', 'embalagem', 'outdoor', 'dispositivo',
    'poster', 'veiculo', 'logo-efeito', 'folder', 'livro', 'fachada', 'sinalizacao'
  ));
END $$;

ALTER TABLE public.mockup_catalogo ADD COLUMN IF NOT EXISTS fonte text NOT NULL DEFAULT 'psd';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mockup_catalogo_fonte_check' AND conrelid = 'public.mockup_catalogo'::regclass) THEN
    ALTER TABLE public.mockup_catalogo ADD CONSTRAINT mockup_catalogo_fonte_check CHECK (fonte IN ('psd', 'ia'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS mockup_catalogo_fonte_idx ON public.mockup_catalogo (fonte, categoria) WHERE ativo;

COMMENT ON COLUMN public.mockup_catalogo.fonte IS 'psd = pré-processado de um PSD da agência (tools/mockups/psd_mockup.py, com calibrar.py quando recuperado pela prévia); ia = cena gerada por IA com a superfície lisa (tools/mockups/mockup_de_ia.py). A marca sempre entra pelo código.';
COMMENT ON TABLE public.mockup_catalogo IS 'Mockups pré-processados (tools/mockups). Arquivos no bucket mockups: catalogo/<id>/{alta,trabalho}/{base.jpg,vazio.jpg,ganho.png,uv.png,mapa.png[,fundo.png]} e thumb.jpg. fundo.png (fundo trocável): R = objeto, G = luz do fundo / 1,25. Só a chave de serviço escreve.';

NOTIFY pgrst, 'reload schema';
