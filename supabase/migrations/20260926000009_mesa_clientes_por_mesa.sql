-- Frente T (25/09 noite): clientes de cada mesa (Mesa, Mesa Ads, Mesa Foto).
-- O padrão fica no código (src/components/mesa/clientesDaMesa.ts): plano ativo,
-- não avulso; na Mesa Ads, também o Ads marcado (services_config.trafego).
-- Esta tabela guarda só o que a equipe mudou por cima do padrão.
CREATE TABLE IF NOT EXISTS public.mesa_cliente_escolhas (
  mesa text NOT NULL CHECK (mesa IN ('organica', 'ads', 'foto')),
  client_id uuid NOT NULL,
  modo text NOT NULL CHECK (modo IN ('incluir', 'retirar')),
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mesa, client_id)
);

CREATE INDEX IF NOT EXISTS mesa_cliente_escolhas_client_idx ON public.mesa_cliente_escolhas (client_id);

ALTER TABLE public.mesa_cliente_escolhas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mesa_cliente_escolhas_staff_read ON public.mesa_cliente_escolhas;
CREATE POLICY mesa_cliente_escolhas_staff_read ON public.mesa_cliente_escolhas
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE INSERT, UPDATE, DELETE ON public.mesa_cliente_escolhas FROM anon, authenticated;
GRANT SELECT ON public.mesa_cliente_escolhas TO authenticated;
GRANT ALL ON public.mesa_cliente_escolhas TO service_role;

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
  IF _mesa IS NULL OR _mesa NOT IN ('organica', 'ads', 'foto') THEN
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

  INSERT INTO public.mesa_cliente_escolhas (mesa, client_id, modo, atualizado_por, atualizado_em)
  VALUES (_mesa, _client_id, _modo, auth.uid(), now())
  ON CONFLICT (mesa, client_id)
  DO UPDATE SET modo = EXCLUDED.modo, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = EXCLUDED.atualizado_em;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_escolher_cliente(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_escolher_cliente(text, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
