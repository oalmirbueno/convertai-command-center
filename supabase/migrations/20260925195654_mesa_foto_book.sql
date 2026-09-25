-- Mesa Foto, aba Book (26/09): plano do book do produto ou da pessoa. Fonte: docs/mesa-foto/migrations/05_book.sql.
-- As fotos ficam em cliente_imagens com a tag book:<id>. Escrita só pela função mesa-foto; leitura pela equipe.
CREATE TABLE IF NOT EXISTS public.foto_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  assunto jsonb NOT NULL CHECK (
    jsonb_typeof(assunto) = 'object'
    AND (assunto ->> 'tipo') IN ('produto', 'persona', 'clone', 'foto')
    AND (assunto ->> 'id') IS NOT NULL
  ),
  referencias jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(referencias) = 'array'),
  pedidos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pedidos) = 'array'),
  selecao jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selecao) = 'array'),
  conversa jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conversa) = 'array'),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'entregue', 'arquivado')),
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS foto_books_cliente_idx ON public.foto_books (client_id, atualizado_em DESC);
DROP TRIGGER IF EXISTS foto_books_tocar ON public.foto_books;
CREATE TRIGGER foto_books_tocar BEFORE UPDATE ON public.foto_books FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();
ALTER TABLE public.foto_books ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.foto_books FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS foto_books_equipe_le ON public.foto_books;
CREATE POLICY foto_books_equipe_le ON public.foto_books FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));
GRANT SELECT ON public.foto_books TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.foto_books TO service_role;
COMMENT ON TABLE public.foto_books IS
  'Mesa Foto, aba Book: plano do book (assunto, referências de estilo, pedidos, seleção em ordem). As fotos ficam em cliente_imagens com a tag book:<id>.';