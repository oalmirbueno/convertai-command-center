-- ═══════════════════════════════════════════════════════════════════════
-- MESA FOTO: área "Book" (estúdio fotográfico do produto ou da pessoa).
-- Pedido do dono em 26/09: "pegar as referências, trabalhar em cima de cada
-- produto ('quero o produto desse jeito') ou da pessoa; arsenal de prompts
-- lateral; o agente gera; selecionar as imagens; mais referências embaixo;
-- um book completo profissional".
--
-- NÃO APLICADA. Aplicar só com o ok do dono, validando antes com
-- begin; ... rollback; no SQL Editor (regra da casa: migration em arquivo não
-- chega ao banco sozinha). Sem ela, a aba Book responde "a migration 05 foi
-- aplicada?" e o resto da Mesa Foto segue igual.
--
-- foto_books guarda só o plano do book: o assunto (produto do kit, persona
-- sintética, clone de pessoa real ou uma foto do acervo), as referências de
-- estilo, a fila de pedidos (prompts da biblioteca, do diretor ou livres), a
-- seleção final em ordem e a conversa curta com o diretor. As fotos geradas
-- ficam no acervo único (cliente_imagens) com a tag book:<id>; nada novo lá.
--
-- Escrita só pela função mesa-foto (chave de serviço); leitura pela equipe
-- com acesso ao cliente. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.foto_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  -- { tipo: produto|persona|clone|foto, id, nome }
  assunto jsonb NOT NULL CHECK (
    jsonb_typeof(assunto) = 'object'
    AND (assunto ->> 'tipo') IN ('produto', 'persona', 'clone', 'foto')
    AND (assunto ->> 'id') IS NOT NULL
  ),
  -- [{ tipo: acervo|biblioteca, id }] (só estilo; nunca identidade)
  referencias jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(referencias) = 'array'),
  -- [{ id, titulo, prompt, formato, origem: { tipo: biblioteca|diretor|livre, id? } }]
  pedidos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pedidos) = 'array'),
  -- ids de cliente_imagens do book final, na ordem
  selecao jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selecao) = 'array'),
  -- [{ papel: equipe|diretor, texto, em }] (as últimas 20)
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

-- Transferir clone (clone_transferir) NÃO precisa de SQL: a função move as
-- linhas e os arquivos com a chave de serviço e desfaz se falhar no meio; o
-- registro fica em foto_modelos.etica.transferencias.

-- Conferência (rodar depois de aplicar):
-- select count(*) from public.foto_books;
-- select polname from pg_policy where polrelid = 'public.foto_books'::regclass;
-- Deve falhar (assunto inválido):
-- begin; insert into public.foto_books (client_id, nome, assunto) select id, 'x', '{"tipo": "outro", "id": "1"}' from public.profiles limit 1; rollback;
