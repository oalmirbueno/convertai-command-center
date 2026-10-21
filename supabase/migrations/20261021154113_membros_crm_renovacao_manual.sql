-- Renovação manual administrativa: novo período, sem editar a licença anterior.
-- Rollback lógico: suspender explicitamente o novo período, preservando o histórico.
BEGIN;

CREATE FUNCTION public.membros_crm_licenca_renovacao_previa(_licenca uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fonte public.membros_licencas; nova public.membros_licencas;
  inicio timestamptz; agora timestamptz:=clock_timestamp();
BEGIN
  IF NOT COALESCE(public.membros_admin(),false)
    OR NOT COALESCE(public.membros_usuario_confirmado(),false) THEN
    RAISE EXCEPTION 'Somente administração com cadastro confirmado' USING ERRCODE='42501';
  END IF;
  SELECT l.* INTO fonte FROM public.membros_licencas l
  JOIN public.membros_ferramentas f ON f.produto_id=l.produto_id
  JOIN public.membros_produtos p ON p.id=f.produto_id
  WHERE l.id=_licenca AND f.motor='crm' AND f.ativo AND p.estado='publicado';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Licença de CRM indisponível.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=fonte.user_id
    AND u.email_confirmed_at IS NOT NULL AND NOT COALESCE(u.is_anonymous,false)) THEN
    RAISE EXCEPTION 'O titular precisa confirmar o cadastro.' USING ERRCODE='22023';
  END IF;
  IF fonte.revogado_em IS NOT NULL OR fonte.confirmado_em>agora
    OR NOT isfinite(fonte.confirmado_em) OR NOT isfinite(fonte.fim) THEN
    RAISE EXCEPTION 'Não é possível renovar uma licença revogada ou que ainda não começou.' USING ERRCODE='22023';
  END IF;
  SELECT l.* INTO nova FROM public.membros_licencas l
  WHERE l.user_id=fonte.user_id AND l.produto_id=fonte.produto_id
    AND l.origem='validacao_manual' AND l.referencia='renovacao-manual-crm:'||fonte.id::text;
  IF FOUND THEN
    -- Repetir a fonte identifica a concessão existente; não desfaz suspensão/revogação.
    RETURN jsonb_build_object('licenca_anterior_id',fonte.id,'user_id',fonte.user_id,
      'produto_id',fonte.produto_id,'inicio',nova.confirmado_em,'fim',nova.fim,
      'fim_anterior',fonte.fim,'suspenso_em',nova.suspenso_em,
      'ja_renovada',true,'licenca_nova_id',nova.id);
  END IF;
  IF fonte.id IS DISTINCT FROM (SELECT l.id FROM public.membros_licencas l
    WHERE l.user_id=fonte.user_id AND l.produto_id=fonte.produto_id
    ORDER BY l.criado_em DESC,l.id DESC LIMIT 1) THEN
    RAISE EXCEPTION 'Escolha o período mais recente deste titular para renovar.' USING ERRCODE='22023';
  END IF;
  SELECT greatest(agora,max(l.fim)) INTO inicio FROM public.membros_licencas l
  WHERE l.user_id=fonte.user_id AND l.produto_id=fonte.produto_id AND l.revogado_em IS NULL;
  RETURN jsonb_build_object('licenca_anterior_id',fonte.id,'user_id',fonte.user_id,
    'produto_id',fonte.produto_id,'inicio',inicio,'fim',membros_privado.fim_anual(inicio),
    'fim_anterior',fonte.fim,'suspenso_em',fonte.suspenso_em,
    'ja_renovada',false,'licenca_nova_id',NULL);
END $$;

CREATE FUNCTION public.membros_crm_licenca_renovar(_licenca uuid,_inicio timestamptz,
  _fim_anterior timestamptz,_suspenso_em_esperado timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fonte public.membros_licencas; nova public.membros_licencas; previa jsonb;
  titular uuid; produto uuid; agora timestamptz; base_fim timestamptz;
BEGIN
  IF NOT COALESCE(public.membros_admin(),false)
    OR NOT COALESCE(public.membros_usuario_confirmado(),false) THEN
    RAISE EXCEPTION 'Somente administração com cadastro confirmado' USING ERRCODE='42501';
  END IF;
  SELECT l.user_id,l.produto_id INTO titular,produto FROM public.membros_licencas l WHERE l.id=_licenca;
  IF NOT FOUND THEN RAISE EXCEPTION 'Licença de CRM indisponível.' USING ERRCODE='22023'; END IF;
  -- Uma confirmação por titular/produto, inclusive quando duas fontes concorrem.
  PERFORM pg_advisory_xact_lock(hashtextextended(titular::text||':'||produto::text||':renovacao-crm',1));
  SELECT l.* INTO fonte FROM public.membros_licencas l WHERE l.id=_licenca FOR UPDATE;
  IF NOT FOUND OR fonte.user_id IS DISTINCT FROM titular OR fonte.produto_id IS DISTINCT FROM produto THEN
    RAISE EXCEPTION 'A licença mudou. Confira uma nova prévia.' USING ERRCODE='40001';
  END IF;
  previa:=public.membros_crm_licenca_renovacao_previa(_licenca);
  IF (previa->>'ja_renovada')::boolean THEN RETURN previa; END IF;
  IF _fim_anterior IS DISTINCT FROM fonte.fim OR _suspenso_em_esperado IS DISTINCT FROM fonte.suspenso_em THEN
    RAISE EXCEPTION 'A licença mudou. Confira uma nova prévia.' USING ERRCODE='40001';
  END IF;
  agora:=clock_timestamp();
  SELECT max(l.fim) INTO base_fim FROM public.membros_licencas l
  WHERE l.user_id=fonte.user_id AND l.produto_id=fonte.produto_id AND l.revogado_em IS NULL;
  -- Prévia é somente leitura, sem token persistido. Admin já autorizado confirma
  -- a base futura exata ou um instante de início ocorrido nos últimos 5 minutos.
  -- Aceita também a virada de vencimento durante o diálogo, sem perder o prazo.
  IF _inicio IS NULL OR NOT isfinite(_inicio)
    OR (base_fim>agora AND _inicio IS DISTINCT FROM base_fim)
    OR (base_fim<=agora AND (_inicio>agora OR _inicio<agora-interval '5 minutes')) THEN
    RAISE EXCEPTION 'A prévia venceu ou a data mudou. Confira uma nova prévia.' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.membros_licencas(produto_id,user_id,origem,referencia,confirmado_em,suspenso_em,criado_por,criado_em)
  VALUES(fonte.produto_id,fonte.user_id,'validacao_manual','renovacao-manual-crm:'||fonte.id::text,
    _inicio,fonte.suspenso_em,auth.uid(),clock_timestamp())
  ON CONFLICT(produto_id,user_id,origem,referencia) DO NOTHING RETURNING * INTO nova;
  IF NOT FOUND THEN
    RETURN public.membros_crm_licenca_renovacao_previa(_licenca);
  END IF;
  INSERT INTO public.membros_ferramentas_historico(user_id,produto_id,ator,acao,registro_id)
  VALUES(fonte.user_id,fonte.produto_id,auth.uid(),'crm_licenca_renovada_manual',nova.id);
  RETURN jsonb_build_object('licenca_anterior_id',fonte.id,'user_id',fonte.user_id,
    'produto_id',fonte.produto_id,'inicio',nova.confirmado_em,'fim',nova.fim,
    'fim_anterior',fonte.fim,'suspenso_em',nova.suspenso_em,
    'ja_renovada',false,'licenca_nova_id',nova.id);
END $$;

REVOKE ALL ON FUNCTION public.membros_crm_licenca_renovacao_previa(uuid),
  public.membros_crm_licenca_renovar(uuid,timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_crm_licenca_renovacao_previa(uuid),
  public.membros_crm_licenca_renovar(uuid,timestamptz,timestamptz,timestamptz) TO authenticated;

COMMIT;
