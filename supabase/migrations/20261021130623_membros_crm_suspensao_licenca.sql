-- Suspensão temporária do CRM, independente de revogação, vigência e pagamentos.
-- Rollback lógico: reativar somente licenças suspensas, vigentes e não revogadas.
BEGIN;

ALTER TABLE public.membros_licencas ADD COLUMN suspenso_em timestamptz;
COMMENT ON COLUMN public.membros_licencas.suspenso_em IS
  'Suspensão temporária administrativa. Não altera a vigência nem desfaz revogação.';

CREATE FUNCTION public.membros_crm_licenca_suspender(_licenca uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE licenca public.membros_licencas;
BEGIN
  IF NOT COALESCE(public.membros_admin(),false) THEN
    RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501';
  END IF;
  SELECT l.* INTO licenca FROM public.membros_licencas l
  JOIN public.membros_ferramentas f ON f.produto_id=l.produto_id
  WHERE l.id=_licenca AND f.motor='crm' FOR UPDATE OF l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Licença de CRM indisponível.' USING ERRCODE='22023';
  END IF;
  IF licenca.suspenso_em IS NULL THEN
    UPDATE public.membros_licencas SET suspenso_em=now() WHERE id=licenca.id;
    INSERT INTO public.membros_ferramentas_historico(user_id,produto_id,ator,acao,registro_id)
    VALUES(licenca.user_id,licenca.produto_id,auth.uid(),'crm_licenca_suspensa',licenca.id);
  END IF;
END $$;

CREATE FUNCTION public.membros_crm_licenca_reativar(_licenca uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE licenca public.membros_licencas;
BEGIN
  IF NOT COALESCE(public.membros_admin(),false) THEN
    RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501';
  END IF;
  SELECT l.* INTO licenca FROM public.membros_licencas l
  JOIN public.membros_ferramentas f ON f.produto_id=l.produto_id
  WHERE l.id=_licenca AND f.motor='crm' FOR UPDATE OF l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Licença de CRM indisponível.' USING ERRCODE='22023';
  END IF;
  IF licenca.revogado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Esta licença foi revogada e não pode ser reativada.' USING ERRCODE='22023';
  END IF;
  IF licenca.fim<=now() OR licenca.confirmado_em>now() THEN
    RAISE EXCEPTION 'Esta licença venceu ou ainda não começou.' USING ERRCODE='22023';
  END IF;
  IF licenca.suspenso_em IS NOT NULL THEN
    UPDATE public.membros_licencas SET suspenso_em=NULL WHERE id=licenca.id;
    INSERT INTO public.membros_ferramentas_historico(user_id,produto_id,ator,acao,registro_id)
    VALUES(licenca.user_id,licenca.produto_id,auth.uid(),'crm_licenca_reativada',licenca.id);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.membros_crm_licenca_suspender(uuid),
  public.membros_crm_licenca_reativar(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_crm_licenca_suspender(uuid),
  public.membros_crm_licenca_reativar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION membros_privado.autorizar_ferramenta(_produto uuid,_motor text DEFAULT NULL)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE vencimento timestamptz;
BEGIN
  IF NOT public.membros_usuario_confirmado() THEN
    RAISE EXCEPTION 'Entre e confirme seu cadastro' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.membros_ferramentas f
    JOIN public.membros_produtos p ON p.id=f.produto_id
    WHERE f.produto_id=_produto AND f.ativo AND p.estado='publicado'
      AND (_motor IS NULL OR f.motor=_motor)) THEN
    RAISE EXCEPTION 'Ferramenta indisponível' USING ERRCODE='42501';
  END IF;
  SELECT max(fim) INTO vencimento FROM public.membros_licencas
  WHERE produto_id=_produto AND user_id=auth.uid() AND revogado_em IS NULL
    AND suspenso_em IS NULL AND confirmado_em<=now() AND fim>now();
  IF vencimento IS NULL THEN
    RAISE EXCEPTION 'O acesso a esta ferramenta não está liberado ou venceu. Seus dados permanecem privados.'
      USING ERRCODE='42501';
  END IF;
  RETURN vencimento;
END $$;

CREATE OR REPLACE FUNCTION public.membros_ferramentas_catalogo()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.membros_usuario_confirmado() THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'produto_id',f.produto_id,'motor',f.motor,'titulo',p.titulo,'capa_url',p.capa_url,
    'disponivel',f.ativo AND p.estado='publicado',
    'fim',CASE WHEN f.ativo AND p.estado='publicado' THEN (
      SELECT max(l.fim) FROM public.membros_licencas l
      WHERE l.produto_id=f.produto_id AND l.user_id=auth.uid()
        AND l.revogado_em IS NULL AND l.suspenso_em IS NULL
        AND l.confirmado_em<=now() AND l.fim>now()
    ) END) ORDER BY p.ordem)
    FROM public.membros_ferramentas f JOIN public.membros_produtos p ON p.id=f.produto_id
    WHERE (f.ativo AND p.estado='publicado') OR EXISTS(
      SELECT 1 FROM public.membros_licencas l
      WHERE l.produto_id=f.produto_id AND l.user_id=auth.uid()
    )),'[]'::jsonb);
END $$;

-- membros_ferramentas_admin já usa to_jsonb(l), incluindo suspenso_em automaticamente.
-- Os privilégios existentes das funções substituídas e a revogação legada são preservados.
COMMIT;
