-- Teste da própria biblioteca: direitos de membro, sem atalho de administrador.
-- Depende apenas da migração base; também funciona no replay antes da prévia das 18h.
BEGIN;
CREATE TABLE public.membros_teste_progresso (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.membros_materiais(id) ON DELETE CASCADE,
  posicao numeric NOT NULL DEFAULT 0 CHECK (posicao BETWEEN 0 AND 604800),
  duracao numeric NOT NULL DEFAULT 0 CHECK (duracao BETWEEN 0 AND 604800),
  concluido boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,material_id), CHECK (posicao <= duracao OR duracao=0)
);
ALTER TABLE public.membros_teste_progresso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membros_teste_progresso FROM PUBLIC,anon,authenticated,service_role;
-- Sem políticas permissivas: acesso somente pelas funções que conferem auth.uid().

CREATE FUNCTION public.membros_direitos_membro(_produto uuid,_usuario uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM auth.users WHERE id=_usuario AND email_confirmed_at IS NOT NULL AND NOT COALESCE(is_anonymous,false))
 THEN ARRAY[]::text[] ELSE ARRAY(
   SELECT origem FROM (
     SELECT 'gratuito'::text origem FROM public.membros_produtos WHERE id=_produto AND gratuito AND estado='publicado'
     UNION
     SELECT a.origem FROM public.membros_acessos a JOIN public.membros_produtos p ON p.id=a.produto_id
     WHERE a.produto_id=_produto AND a.user_id=_usuario AND a.inicio<=now() AND (a.fim IS NULL OR a.fim>now()) AND a.revogado_em IS NULL AND p.estado='publicado'
     UNION
     SELECT 'plano'::text FROM public.membros_beneficios_plano b
     JOIN public.financial_plan_versions v ON v.plan_id=b.plano_id
     JOIN public.financial_client_terms t ON t.plan_version_id=v.id
     JOIN public.membros_produtos p ON p.id=b.produto_id
     WHERE b.produto_id=_produto AND b.ativo AND p.estado='publicado'
       AND t.client_id=_usuario AND public.has_role(_usuario,'client'::public.app_role)
       AND t.status='active' AND t.starts_on<=current_date AND (t.ends_on IS NULL OR t.ends_on>=current_date)
   ) direitos
 ) END
$$;
REVOKE ALL ON FUNCTION public.membros_direitos_membro(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.membros_biblioteca(_teste boolean DEFAULT false,_bloqueado boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE resultado jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada' USING ERRCODE='42501'; END IF;
 IF _teste IS NULL OR _bloqueado IS NULL OR (_bloqueado AND NOT _teste) THEN RAISE EXCEPTION 'Modo inválido' USING ERRCODE='22023'; END IF;
 IF _teste AND NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF NOT _teste THEN PERFORM public.membros_reivindicar_compras(); END IF;
 WITH progresso AS (
   SELECT material_id,posicao,duracao,concluido,atualizado_em FROM public.membros_progresso WHERE user_id=auth.uid() AND NOT _teste
   UNION ALL
   SELECT material_id,posicao,duracao,concluido,atualizado_em FROM public.membros_teste_progresso WHERE user_id=auth.uid() AND _teste
 ), direitos AS MATERIALIZED (
   SELECT p.*,CASE WHEN _bloqueado THEN ARRAY[]::text[] WHEN _teste THEN public.membros_direitos_membro(p.id,auth.uid()) ELSE public.membros_origens(p.id) END origens
   FROM public.membros_produtos p WHERE p.estado='publicado' OR (NOT _teste AND public.membros_admin())
 ), catalogo AS (
   SELECT d.*,COALESCE(s.total,0) materiais_total,COALESCE(s.feitos,0) materiais_concluidos,
     CASE WHEN s.total>0 AND s.feitos=s.total THEN 100 WHEN s.total>0 THEN LEAST(99,round(100.0*s.fracao/s.total)) ELSE 0 END progresso,
     s.ultimo_material
   FROM direitos d LEFT JOIN LATERAL (
     SELECT count(*) total,count(*) FILTER(WHERE pr.concluido) feitos,
       COALESCE(sum(CASE WHEN pr.concluido THEN 1 WHEN pr.duracao>0 THEN LEAST(pr.posicao/pr.duracao,0.99) ELSE 0 END),0) fracao,
       (array_agg(m.id ORDER BY pr.atualizado_em DESC) FILTER(WHERE pr.posicao>0 OR pr.concluido))[1] ultimo_material
     FROM public.membros_materiais m LEFT JOIN progresso pr ON pr.material_id=m.id
     WHERE m.produto_id=d.id AND cardinality(d.origens)>0
   ) s ON true
 ) SELECT jsonb_build_object(
   'produtos',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.ordem,c.titulo) FROM catalogo c),'[]'::jsonb),
   'pendentes',CASE WHEN _teste THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('produto_id',produto_id,'estado',estado)) FROM public.membros_compras WHERE user_id=auth.uid() AND estado='pendente'),'[]'::jsonb) END,
   'jornada',(SELECT jsonb_build_object('materiais',COALESCE(sum(materiais_total),0),'concluidos',COALESCE(sum(materiais_concluidos),0),
      'produtos_concluidos',count(*) FILTER(WHERE materiais_total>0 AND materiais_concluidos=materiais_total),
      'em_andamento',count(*) FILTER(WHERE progresso>0 AND progresso<100)) FROM catalogo),
   'teste',_teste,'bloqueado',_bloqueado
 ) INTO resultado;
 RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION public.membros_biblioteca(boolean,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_biblioteca(boolean,boolean) TO authenticated;

CREATE FUNCTION public.membros_teste_materiais(_produto uuid,_bloqueado boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) OR _bloqueado IS DISTINCT FROM false OR cardinality(public.membros_direitos_membro(_produto,auth.uid()))=0
 THEN RAISE EXCEPTION 'Conteúdo não liberado neste teste' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('materiais',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.ordem,m.id) FROM public.membros_materiais m WHERE m.produto_id=_produto),'[]'::jsonb),
   'progresso',COALESCE((SELECT jsonb_agg(to_jsonb(pr)-'user_id') FROM public.membros_teste_progresso pr JOIN public.membros_materiais m ON m.id=pr.material_id WHERE pr.user_id=auth.uid() AND m.produto_id=_produto),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.membros_teste_materiais(uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_teste_materiais(uuid,boolean) TO authenticated;

CREATE FUNCTION public.membros_teste_salvar_progresso(_material uuid,_posicao numeric,_duracao numeric,_concluido boolean,_bloqueado boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE produto uuid;
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) OR _bloqueado IS DISTINCT FROM false THEN RAISE EXCEPTION 'Teste indisponível' USING ERRCODE='42501'; END IF;
 SELECT produto_id INTO produto FROM public.membros_materiais WHERE id=_material;
 IF produto IS NULL OR cardinality(public.membros_direitos_membro(produto,auth.uid()))=0 THEN RAISE EXCEPTION 'Conteúdo não liberado neste teste' USING ERRCODE='42501'; END IF;
 -- As constraints rejeitam valores nulos, negativos, infinitos e fora do limite.
 INSERT INTO public.membros_teste_progresso(user_id,material_id,posicao,duracao,concluido)
 VALUES(auth.uid(),_material,_posicao,_duracao,_concluido)
 ON CONFLICT(user_id,material_id) DO UPDATE SET posicao=EXCLUDED.posicao,duracao=EXCLUDED.duracao,concluido=EXCLUDED.concluido,atualizado_em=now();
END $$;
REVOKE ALL ON FUNCTION public.membros_teste_salvar_progresso(uuid,numeric,numeric,boolean,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_teste_salvar_progresso(uuid,numeric,numeric,boolean,boolean) TO authenticated;

CREATE FUNCTION public.membros_teste_reiniciar() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE quantidade integer;
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 DELETE FROM public.membros_teste_progresso WHERE user_id=auth.uid();
 GET DIAGNOSTICS quantidade=ROW_COUNT;
 RETURN quantidade;
END $$;
REVOKE ALL ON FUNCTION public.membros_teste_reiniciar() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_teste_reiniciar() TO authenticated;
COMMIT;
