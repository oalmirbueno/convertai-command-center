-- Mesa do cliente: referência em destaque (pedido do dono, 23/09).
-- A equipe marca as referências preferidas do cliente; o diretor de arte usa
-- sempre essas antes das outras. A equipe já tem UPDATE em cliente_referencias
-- pela RLS (is_staff + can_access_client), então basta a coluna.
ALTER TABLE public.cliente_referencias ADD COLUMN IF NOT EXISTS destaque boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.cliente_referencias.destaque IS 'Marcada pela equipe como referência preferida: o diretor de arte usa sempre, antes das outras.';
CREATE INDEX IF NOT EXISTS cliente_referencias_destaque_idx ON public.cliente_referencias (client_id) WHERE destaque;
