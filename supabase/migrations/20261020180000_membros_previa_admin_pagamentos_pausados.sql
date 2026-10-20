-- Prévia administrativa somente leitura e trava explícita dos pagamentos.
BEGIN;
CREATE FUNCTION public.membros_pagamentos_habilitados() RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.membros_pagamentos_habilitados() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.membros_pagamentos_habilitados() TO authenticated,service_role;
ALTER FUNCTION public.membros_conciliar_pagamento(uuid,text,text,text,text) RENAME TO membros_conciliar_pagamento_validacao;
REVOKE ALL ON FUNCTION public.membros_conciliar_pagamento_validacao(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.membros_conciliar_pagamento(_evento uuid,_pedido text,_produto_externo text,_email text,_estado text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Somente servidor' USING ERRCODE='42501'; END IF;
  IF NOT public.membros_pagamentos_habilitados() THEN
    RETURN jsonb_build_object('ok',true,'pendente',true,'motivo','pagamentos_desativados');
  END IF;
  RETURN public.membros_conciliar_pagamento_validacao(_evento,_pedido,_produto_externo,_email,_estado);
END $$;
REVOKE ALL ON FUNCTION public.membros_conciliar_pagamento(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.membros_conciliar_pagamento(uuid,text,text,text,text) TO service_role;
ALTER FUNCTION public.membros_reivindicar_compras() RENAME TO membros_reivindicar_compras_validacao;
REVOKE ALL ON FUNCTION public.membros_reivindicar_compras_validacao() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.membros_reivindicar_compras() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.membros_pagamentos_habilitados() THEN PERFORM public.membros_reivindicar_compras_validacao(); END IF;
END $$;
REVOKE ALL ON FUNCTION public.membros_reivindicar_compras() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.membros_reivindicar_compras() TO authenticated,service_role;
CREATE FUNCTION public.membros_origens_usuario(_produto uuid,_usuario uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN public.has_role(_usuario,'admin'::public.app_role) THEN ARRAY['administracao']::text[]
  WHEN NOT EXISTS(SELECT 1 FROM auth.users WHERE id=_usuario AND email_confirmed_at IS NOT NULL AND NOT COALESCE(is_anonymous,false)) THEN ARRAY[]::text[] ELSE ARRAY(
    SELECT origem FROM (
      SELECT 'gratuito'::text origem FROM public.membros_produtos WHERE id=_produto AND gratuito AND estado='publicado'
      UNION
      SELECT a.origem FROM public.membros_acessos a JOIN public.membros_produtos p ON p.id=a.produto_id
      WHERE a.produto_id=_produto AND a.user_id=_usuario AND a.inicio <= now() AND (a.fim IS NULL OR a.fim > now()) AND a.revogado_em IS NULL AND p.estado='publicado'
      UNION
      SELECT 'plano'::text FROM public.membros_beneficios_plano b
      JOIN public.financial_plan_versions v ON v.plan_id=b.plano_id
      JOIN public.financial_client_terms t ON t.plan_version_id=v.id
      JOIN public.membros_produtos p ON p.id=b.produto_id
      WHERE b.produto_id=_produto AND b.ativo AND p.estado='publicado'
        AND t.client_id=_usuario AND public.has_role(_usuario,'client'::public.app_role)
        AND t.status='active' AND t.starts_on <= current_date AND (t.ends_on IS NULL OR t.ends_on >= current_date)
    ) direitos
  ) END
$$;

REVOKE ALL ON FUNCTION public.membros_origens_usuario(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- A consulta normal e a prévia usam a mesma regra de direitos, sem duplicar regras.
CREATE OR REPLACE FUNCTION public.membros_origens(_produto uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.membros_origens_usuario(_produto,auth.uid())
$$;
CREATE FUNCTION public.membros_previa(_usuario uuid,_produto uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE resultado jsonb;
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=_usuario) THEN RAISE EXCEPTION 'Pessoa indisponível' USING ERRCODE='22023'; END IF;
 IF _produto IS NOT NULL THEN
   IF cardinality(public.membros_origens_usuario(_produto,_usuario))=0 THEN RAISE EXCEPTION 'Conteúdo não liberado para esta pessoa' USING ERRCODE='42501'; END IF;
   RETURN jsonb_build_object('materiais',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.ordem) FROM public.membros_materiais m WHERE m.produto_id=_produto),'[]'::jsonb),
    'progresso',COALESCE((SELECT jsonb_agg(to_jsonb(pr)) FROM public.membros_progresso pr JOIN public.membros_materiais m ON m.id=pr.material_id WHERE pr.user_id=_usuario AND m.produto_id=_produto),'[]'::jsonb));
 END IF;
 SELECT jsonb_build_object('pessoa',(SELECT jsonb_build_object('id',id,'nome',COALESCE(NULLIF(full_name,''),email)) FROM public.profiles WHERE id=_usuario),
  'produtos',COALESCE((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('origens',public.membros_origens_usuario(p.id,_usuario),
    'progresso',CASE WHEN cardinality(public.membros_origens_usuario(p.id,_usuario))>0 THEN COALESCE((SELECT round(100.0*sum(CASE WHEN pr.concluido THEN 1 WHEN pr.duracao>0 THEN LEAST(pr.posicao/pr.duracao,0.99) ELSE 0 END)/NULLIF(count(*),0)) FROM public.membros_materiais m LEFT JOIN public.membros_progresso pr ON pr.material_id=m.id AND pr.user_id=_usuario WHERE m.produto_id=p.id),0) ELSE 0 END,
    'ultimo_material',CASE WHEN cardinality(public.membros_origens_usuario(p.id,_usuario))>0 THEN (SELECT m.id FROM public.membros_materiais m JOIN public.membros_progresso pr ON pr.material_id=m.id AND pr.user_id=_usuario WHERE m.produto_id=p.id AND (pr.posicao>0 OR pr.concluido) ORDER BY pr.atualizado_em DESC LIMIT 1) END
  ) ORDER BY p.ordem,p.titulo) FROM public.membros_produtos p WHERE p.estado='publicado' OR public.has_role(_usuario,'admin'::public.app_role)),'[]'::jsonb),
  'pendentes',COALESCE((SELECT jsonb_agg(jsonb_build_object('produto_id',produto_id,'estado',estado)) FROM public.membros_compras WHERE user_id=_usuario AND estado='pendente'),'[]'::jsonb)) INTO resultado;
 RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION public.membros_previa(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.membros_previa(uuid,uuid) TO authenticated;
COMMIT;
