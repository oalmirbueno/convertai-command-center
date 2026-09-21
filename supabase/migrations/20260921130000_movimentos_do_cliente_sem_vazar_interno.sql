-- Auditoria de 2026-09-21: o cliente conseguia pedir o histórico interno.
--
-- movimentos_do_cliente deixava o próprio cliente passar pela guarda e o
-- parâmetro _somente_visiveis ficava sob controle dele: bastava chamar a RPC
-- com false para ler descrições de tarefas internas, ações da esteira e nome
-- de materiais que ainda não foram liberados. E dossie_avancos_texto (que
-- chama a leitura completa) estava executável por qualquer usuário logado.
--
-- Correção: a leitura completa vai para app_private (só backend/equipe por
-- dentro) e a porta pública força "só visível" quando quem chama é o próprio
-- cliente e não é equipe. O texto do dossiê perde o EXECUTE de authenticated.

ALTER FUNCTION public.movimentos_do_cliente(uuid, timestamptz, timestamptz, boolean) RENAME TO movimentos_do_cliente_bruto;
ALTER FUNCTION public.movimentos_do_cliente_bruto(uuid, timestamptz, timestamptz, boolean) SET SCHEMA app_private;
REVOKE ALL ON FUNCTION app_private.movimentos_do_cliente_bruto(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.movimentos_do_cliente(
  _client_id uuid,
  _desde timestamptz DEFAULT now() - interval '30 days',
  _ate timestamptz DEFAULT now(),
  _somente_visiveis boolean DEFAULT false
)
RETURNS TABLE(
  quando timestamptz,
  tipo text,
  titulo text,
  titulo_cliente text,
  detalhe text,
  visivel_ao_cliente boolean,
  origem text,
  ref_id uuid,
  link text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _so_visiveis boolean := _somente_visiveis;
BEGIN
  -- O cliente lê o próprio histórico, mas NUNCA escolhe ver o interno: o
  -- parâmetro é forçado no banco, não no front.
  IF NOT app_private.rpc_trusted_backend() THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RPC_AUTH_REQUIRED';
    END IF;
    IF auth.uid() <> _client_id THEN
      PERFORM app_private.require_rpc_client_staff(_client_id);
    ELSIF NOT coalesce(public.is_staff(auth.uid()), false) THEN
      _so_visiveis := true;
    END IF;
  END IF;
  RETURN QUERY SELECT * FROM app_private.movimentos_do_cliente_bruto(_client_id, _desde, _ate, _so_visiveis);
END; $$;
REVOKE ALL ON FUNCTION public.movimentos_do_cliente(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.movimentos_do_cliente(uuid, timestamptz, timestamptz, boolean) TO authenticated, service_role;

-- O texto do dossiê é só do backend (cron, gatilhos) e da equipe por dentro.
REVOKE EXECUTE ON FUNCTION public.dossie_avancos_texto(uuid, integer) FROM PUBLIC, anon, authenticated;
